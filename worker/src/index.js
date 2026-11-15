import puppeteer from "@cloudflare/puppeteer";

const HIPO_URL = "https://hipobuy.com/clientapi/newPromoteAlliance/getPromoteStatInfo";
const REPS_URL = "https://repscentral.net/admin/";
const REPORT_TIME_ZONE = "Europe/London";
const COLLECTOR_UID = "yBGdOLXo8AZMfb5c3JsLYTQeYgt1";

export default {
  async scheduled(controller, env) {
    await collectAndSave(env, controller.cron === "15 1 * * *");
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true, service: "affiliate-analytics-collector" });
    }

    if (request.method === "POST" && url.pathname === "/run-now") {
      const expected = env.MANUAL_RUN_TOKEN;
      if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) {
        return new Response("Not found", { status: 404 });
      }

      try {
        const result = await collectAndSave(env, url.searchParams.get("includeReps") === "true");
        return Response.json({ ok: true, metricDate: result.metricDate });
      } catch (_error) {
        return Response.json({ ok: false, error: "Collection failed; check Worker Logs." }, { status: 500 });
      }
    }

    return new Response("Not found", { status: 404 });
  }
};

async function collectAndSave(env, includeReps = false) {
  requireEnv(env, [
    "HIPO_ACCESS_TOKEN", "FIREBASE_COLLECTOR_EMAIL", "FIREBASE_COLLECTOR_PASSWORD",
    "FIREBASE_API_KEY", "FIREBASE_OWNER_UID"
  ]);
  const now = new Date();
  const metricDate = dateInZone(now, REPORT_TIME_ZONE);
  const capturedAt = now.toISOString();
  const hipo = await readHipobuy(env);
  const idToken = await firebaseSignIn(env);
  const auditId = capturedAt.replace(/[:.]/g, "-");
  // The audit history preserves each API-reported count and timestamp.
  await writeDocument(env, idToken, "orderAuditSnapshots", auditId,
    { metricDate, capturedAt, ...hipo, source: "hipobuy-affiliate-api" });
  // Field masks preserve previously written RepsCentral data.
  await writeDocument(env, idToken, "dailySnapshots", metricDate,
    { metricDate, capturedAt, ...hipo });
  let repscentral = "skipped";
  if (includeReps) {
    if (env.BROWSER && env.REPSCENTRAL_USERNAME && env.REPSCENTRAL_PASSWORD) {
      let browser;
      try {
        browser = await puppeteer.launch(env.BROWSER);
        const page = await browser.newPage();
        const yesterday = previousDateInZone(now, REPORT_TIME_ZONE);
        const dailyViews = await readRepscentral(page, env, yesterday);
        await writeDocument(env, idToken, "dailySnapshots", metricDate,
          { repscentralDailyPageViews: dailyViews, repscentralMetricDate: yesterday });
        repscentral = "saved";
      } catch (error) {
        repscentral = "failed";
        console.error("RepsCentral failed:", error.message);
      } finally {
        if (browser) await browser.close();
      }
    } else repscentral = "not configured";
  }
  // Retain the existing Active Members metric using the affiliate page, if configured.
  if (includeReps && env.BROWSER && env.HIPO_USERNAME && env.HIPO_PASSWORD) {
    let activeBrowser;
    try {
      activeBrowser = await puppeteer.launch(env.BROWSER);
      const page = await activeBrowser.newPage();
      await page.goto("https://hipobuy.com/user/com-share", {
        waitUntil: "domcontentloaded", timeout: 60000
      });
      await page.waitForTimeout(2500);
      await signInIfNeeded(page, "https://hipobuy.com/user/com-share",
        env.HIPO_USERNAME, env.HIPO_PASSWORD);
      const pageText = await page.evaluate(() => document.body.innerText || "");
      const active = parseHipobuyPair(pageText, "Active This Month");
      if (!active) throw new Error("Active members counter not found");
      await writeDocument(env, idToken, "dailySnapshots", metricDate,
        { activeTotal: active.total, activeMonth: active.monthValue });
    } catch (error) {
      console.error("Optional HipoBuy active-members scrape failed:", error.message);
    } finally {
      if (activeBrowser) await activeBrowser.close();
    }
  }
  console.log("Saved HipoBuy snapshot", auditId, "RepsCentral:", repscentral);
  return { metricDate, auditId, repscentral };
}

function dateInZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone, day: "2-digit", month: "2-digit", year: "numeric"
  }).formatToParts(date);
  const part = name => parts.find(p => p.type === name).value;
  return [part("year"), part("month"), part("day")].join("-");
}

function requireEnv(env, keys) {
  for (const key of keys) {
    if (!env[key]) throw new Error(`Missing Worker setting: ${key}`);
  }
}

async function readHipobuy(env) {
  const response = await fetch(HIPO_URL, {
    headers: { "X-Access-Token": env.HIPO_ACCESS_TOKEN, Accept: "application/json" },
    redirect: "error",
    cache: "no-store"
  });
  if (!response.ok) throw new Error("HipoBuy HTTP " + response.status);
  const payload = await response.json();
  if (payload.success !== true || payload.code !== 200 || !payload.result)
    throw new Error("HipoBuy API did not return success");
  const fields = {
    invitesTotal: "totalInvitedUsers",
    invitesMonth: "mouthInvitedUsers",
    orderUsersTotal: "totalOrderUsers",
    orderUsersMonth: "mouthOrderUsers",
    signUsersTotal: "totalSignUsers",
    signUsersMonth: "mouthSignUsers"
  };
  const stats = {};
  for (const [key, original] of Object.entries(fields)) {
    const value = payload.result[original];
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error("Invalid HipoBuy metric " + original);
    stats[key] = value;
  }
  if (!Number.isFinite(payload.timestamp)) throw new Error("Invalid provider timestamp");
  stats.providerTimestamp = new Date(payload.timestamp).toISOString();
  return stats;
}

function parseHipobuyPair(text, label) {
  const normalized = text.replace(/\u00a0/g, " ").replace(/,/g, "");
  const start = normalized.toLowerCase().indexOf(label.toLowerCase());
  if (start < 0) return null;
  const section = normalized.slice(start, start + 180);
  const match = section.match(/([0-9]+)\s*Total\s*([0-9]+)/i);
  if (!match) return null;
  const monthValue = Number(match[1]);
  const total = Number(match[2]);
  return Number.isSafeInteger(monthValue) && Number.isSafeInteger(total)
    ? { monthValue, total } : null;
}

async function readRepscentral(page, env, metricDate) {
  const candidates = [];
  page.on("response", async (response) => {
    try {
      const responseUrl = new URL(response.url());
      if (responseUrl.origin !== "https://repscentral.net") return;
      const contentType = response.headers()["content-type"] || "";
      if (!contentType.includes("json")) return;
      const data = await response.json();
      candidates.push(...extractDailyValues(data, metricDate));
    } catch {
      // Ignore non-JSON, expired, or unrelated responses; only use validated daily series.
    }
  });

  await page.goto(REPS_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2500);
  await signInIfNeeded(page, REPS_URL, env.REPSCENTRAL_USERNAME, env.REPSCENTRAL_PASSWORD);
  await clickDailyFilter(page);
  await page.waitForTimeout(3500);

  // Allow outstanding response listeners to finish parsing small JSON chart responses.
  await page.waitForTimeout(500);
  const values = [...new Set(candidates.map((item) => item.value))];
  if (values.length !== 1) {
    throw new Error("Could not identify one unambiguous RepsCentral daily page-view value.");
  }
  return values[0];
}

async function signInIfNeeded(page, targetUrl, username, password) {
  let passwordField = await findVisiblePasswordField(page);
  if (!passwordField) return;

  const userField = await findVisibleUsernameField(page, passwordField);
  if (!userField) throw new Error("The site's sign-in form needs a manual review.");

  await userField.click({ clickCount: 3 });
  await userField.type(username, { delay: 25 });
  await passwordField.click({ clickCount: 3 });
  await passwordField.type(password, { delay: 25 });

  const submitted = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button, input[type="submit"], [role="button"]')];
    const button = buttons.find((item) => {
      const text = (item.innerText || item.value || "").trim().toLowerCase();
      return item.type === "submit" || /^(log in|login|sign in|signin|submit)$/.test(text);
    });
    if (!button) return false;
    button.click();
    return true;
  });
  if (!submitted) throw new Error("Could not find a sign-in button.");

  await page.waitForTimeout(4500);
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2500);
  if (await findVisiblePasswordField(page)) {
    throw new Error("Sign-in did not complete; the site may require a manual step.");
  }
}

async function findVisiblePasswordField(page) {
  const fields = await page.$$('input[type="password"]');
  for (const field of fields) {
    const visible = await field.evaluate((el) => Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length));
    if (visible) return field;
  }
  return null;
}

async function findVisibleUsernameField(page, passwordField) {
  const fields = await page.$$("input");
  const visibleFields = [];
  for (const field of fields) {
    if (field === passwordField) continue;
    const info = await field.evaluate((el) => ({
      visible: Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length),
      type: (el.getAttribute("type") || "text").toLowerCase(),
      placeholder: (el.getAttribute("placeholder") || "").toLowerCase(),
      autocomplete: (el.getAttribute("autocomplete") || "").toLowerCase(),
      name: (el.getAttribute("name") || "").toLowerCase()
    }));
    if (!info.visible || ["hidden", "submit", "button", "checkbox", "radio"].includes(info.type)) continue;
    visibleFields.push({ field, score: /email|user|account|login/.test(info.placeholder + " " + info.autocomplete + " " + info.name) ? 1 : 0 });
  }
  visibleFields.sort((a, b) => b.score - a.score);
  return visibleFields[0]?.field || null;
}

async function clickDailyFilter(page) {
  await page.evaluate(() => {
    const controls = [...document.querySelectorAll("button, [role='button'], a")];
    const daily = controls.find((el) => (el.innerText || "").trim().toLowerCase() === "daily");
    if (daily) daily.click();
  });
}

function extractDailyValues(data, wantedDate) {
  const found = [];
  const visited = new Set();

  function add(dateLike, valueLike) {
    const date = toDateKey(dateLike);
    const value = Number(valueLike);
    if (date === wantedDate && Number.isSafeInteger(value) && value >= 0) {
      found.push({ date, value });
    }
  }

  function visit(node, depth = 0) {
    if (!node || typeof node !== "object" || depth > 12 || visited.has(node)) return;
    visited.add(node);

    if (Array.isArray(node)) {
      for (const item of node) {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const date = item.date ?? item.day ?? item.label ?? item.timestamp ?? item.time;
          const value = item.views ?? item.visits ?? item.pageViews ?? item.page_views ?? item.count ?? item.total;
          if (date !== undefined && value !== undefined) add(date, value);
        }
        visit(item, depth + 1);
      }
      return;
    }

    if (Array.isArray(node.labels) && Array.isArray(node.datasets)) {
      for (const dataset of node.datasets) {
        if (!Array.isArray(dataset?.data) || dataset.data.length !== node.labels.length) continue;
        const label = String(dataset.label || "").toLowerCase();
        if (node.datasets.length > 1 && !/view|visit|page/.test(label)) continue;
        node.labels.forEach((date, index) => add(date, dataset.data[index]));
      }
    }

    for (const value of Object.values(node)) visit(value, depth + 1);
  }

  visit(data);
  return found;
}

function toDateKey(value) {
  if (typeof value === "number" || (typeof value === "string" && /^\d{10,13}$/.test(value))) {
    const numeric = Number(value);
    const millis = numeric < 100000000000 ? numeric * 1000 : numeric;
    return new Date(millis).toLocaleDateString("en-CA", { timeZone: REPORT_TIME_ZONE });
  }
  if (typeof value !== "string") return null;
  const iso = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? null
    : parsed.toLocaleDateString("en-CA", { timeZone: REPORT_TIME_ZONE });
}

function previousDateInZone(now, timeZone) {
  const today = dateInZone(now, timeZone);
  const noonUtc = new Date(`${today}T12:00:00.000Z`);
  noonUtc.setUTCDate(noonUtc.getUTCDate() - 1);
  return noonUtc.toISOString().slice(0, 10);
}

async function firebaseSignIn(env) {
  const response = await fetch(
    "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" +
      encodeURIComponent(env.FIREBASE_API_KEY), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: env.FIREBASE_COLLECTOR_EMAIL,
        password: env.FIREBASE_COLLECTOR_PASSWORD,
        returnSecureToken: true
      })
    });
  if (!response.ok) throw new Error("Firebase collector sign-in failed");
  const data = await response.json();
  if (!data.idToken || data.localId !== COLLECTOR_UID)
    throw new Error("Firebase collector UID mismatch");
  return data.idToken;
}

async function writeDocument(env, token, collectionName, documentId, data) {
  const path = ["users", env.FIREBASE_OWNER_UID, collectionName, documentId]
    .map(encodeURIComponent).join("/");
  const mask = new URLSearchParams();
  const fields = {};
  for (const [key, value] of Object.entries(data)) {
    mask.append("updateMask.fieldPaths", key);
    fields[key] = Number.isSafeInteger(value)
      ? { integerValue: String(value) }
      : key === "capturedAt" || key === "providerTimestamp"
      ? { timestampValue: value }
      : { stringValue: String(value) };
  }
  const url = "https://firestore.googleapis.com/v1/projects/repscentral-analytics/" +
    "databases/(default)/documents/" + path + "?" + mask.toString();
  const response = await fetch(url, {
    method: "PATCH",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify({ fields })
  });
  if (!response.ok) {
    console.error("Firestore returned", response.status);
    throw new Error("Firestore write failed");
  }
}
