import { auth, db } from "./firebase.js";
import {
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";

const loginPanel = document.querySelector("#loginPanel");
const dashboard = document.querySelector("#dashboard");
const loginForm = document.querySelector("#loginForm");
const loginError = document.querySelector("#loginError");
const signOutButton = document.querySelector("#signOutButton");
const refreshButton = document.querySelector("#refreshButton");
const userLabel = document.querySelector("#userLabel");
const updatedLabel = document.querySelector("#updatedLabel");
const emptyState = document.querySelector("#emptyState");
const table = document.querySelector("#snapshotTable");
const tbody = document.querySelector("#snapshotRows");
const invitesValue = document.querySelector("#invitesValue");
const invitesDelta = document.querySelector("#invitesDelta");
const activeValue = document.querySelector("#activeValue");
const activeDelta = document.querySelector("#activeDelta");
const viewsValue = document.querySelector("#viewsValue");
const viewsDelta = document.querySelector("#viewsDelta");
const errorBanner = document.querySelector("#dataError");

const integer = new Intl.NumberFormat("en-GB");
const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Europe/London"
});
const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/London"
});

let currentUser = null;

function setMessage(element, message, visible) {
  element.textContent = message || "";
  element.hidden = !visible;
}

function formatNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? integer.format(Number(value)) : "—";
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value + "T12:00:00Z");
  return Number.isNaN(date.getTime()) ? String(value) : dateFormatter.format(date);
}

function formatCapturedAt(value) {
  if (!value) return "—";
  const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateTimeFormatter.format(date);
}

function deltaText(current, previous, previousDate, currentDate) {
  if (current === null || current === undefined || previous === null || previous === undefined || !Number.isFinite(Number(current)) || !Number.isFinite(Number(previous))) return "—";
  const delta = Number(current) - Number(previous);
  const days = Math.round((Date.parse(currentDate + "T12:00:00Z") - Date.parse(previousDate + "T12:00:00Z")) / 86400000);
  const period = days === 1 ? "since yesterday" : "since " + formatDate(previousDate);
  return (delta > 0 ? "+" : "") + integer.format(delta) + " " + period;
}

function appendCell(row, value, className) {
  const cell = document.createElement("td");
  cell.textContent = value;
  if (className) cell.className = className;
  row.appendChild(cell);
}

function showNoData() {
  tbody.replaceChildren();
  table.hidden = true;
  emptyState.hidden = false;
  invitesValue.textContent = "—";
  activeValue.textContent = "—";
  viewsValue.textContent = "—";
  invitesDelta.textContent = "Waiting for first successful sync";
  activeDelta.textContent = "Waiting for first successful sync";
  viewsDelta.textContent = "Waiting for first successful sync";
  updatedLabel.textContent = "No snapshots recorded";
}

function snapshotValue(snapshot, field, nestedSource, nestedField) {
  if (snapshot[field] !== undefined && snapshot[field] !== null) return snapshot[field];
  const nested = snapshot[nestedSource];
  return nested && nested[nestedField] !== undefined ? nested[nestedField] : null;
}

function renderSnapshots(records) {
  records.sort((a, b) => String(b.metricDate || b.id).localeCompare(String(a.metricDate || a.id)));
  if (!records.length) {
    showNoData();
    return;
  }

  const latest = records[0];
  const previous = records.length > 1 ? records[1] : null;
  const latestDate = latest.metricDate || latest.id;
  const previousDate = previous ? (previous.metricDate || previous.id) : null;
  const latestInvites = snapshotValue(latest, "invitesTotal", "hipobuy", "invitesTotal");
  const latestActive = snapshotValue(latest, "activeTotal", "hipobuy", "activeTotal");
  const latestViews = snapshotValue(latest, "repscentralDailyPageViews", "repscentral", "dailyPageViews");

  invitesValue.textContent = formatNumber(latestInvites);
  activeValue.textContent = formatNumber(latestActive);
  viewsValue.textContent = formatNumber(latestViews);

  invitesDelta.textContent = previous
    ? deltaText(latestInvites, snapshotValue(previous, "invitesTotal", "hipobuy", "invitesTotal"), previousDate, latestDate)
    : "First recorded snapshot";
  activeDelta.textContent = previous
    ? deltaText(latestActive, snapshotValue(previous, "activeTotal", "hipobuy", "activeTotal"), previousDate, latestDate)
    : "First recorded snapshot";
  viewsDelta.textContent = previous
    ? deltaText(latestViews, snapshotValue(previous, "repscentralDailyPageViews", "repscentral", "dailyPageViews"), previousDate, latestDate)
    : "First recorded snapshot";

  updatedLabel.textContent = "Last snapshot " + formatCapturedAt(latest.capturedAt);
  tbody.replaceChildren();

  records.forEach((snapshot, index) => {
    const date = snapshot.metricDate || snapshot.id;
    const earlier = records[index + 1];
    const earlierDate = earlier ? (earlier.metricDate || earlier.id) : null;
    const invites = snapshotValue(snapshot, "invitesTotal", "hipobuy", "invitesTotal");
    const active = snapshotValue(snapshot, "activeTotal", "hipobuy", "activeTotal");
    const views = snapshotValue(snapshot, "repscentralDailyPageViews", "repscentral", "dailyPageViews");
    const row = document.createElement("tr");
    appendCell(row, formatDate(date));
    appendCell(row, formatNumber(invites), "numeric");
    appendCell(row, earlier ? deltaText(invites, snapshotValue(earlier, "invitesTotal", "hipobuy", "invitesTotal"), earlierDate, date) : "—", "numeric");
    appendCell(row, formatNumber(active), "numeric");
    appendCell(row, earlier ? deltaText(active, snapshotValue(earlier, "activeTotal", "hipobuy", "activeTotal"), earlierDate, date) : "—", "numeric");
    appendCell(row, formatNumber(views), "numeric");
    tbody.appendChild(row);
  });

  table.hidden = false;
  emptyState.hidden = true;
}

async function loadSnapshots(user) {
  setMessage(errorBanner, "", false);
  refreshButton.disabled = true;
  refreshButton.textContent = "Refreshing…";
  try {
    const path = collection(db, "users", user.uid, "dailySnapshots");
    const result = await getDocs(path);
    const records = result.docs.map((item) => ({ id: item.id, ...item.data() }));
    renderSnapshots(records);
  } catch (error) {
    console.error("Could not load daily snapshots:", error.code || error.message);
    showNoData();
    setMessage(errorBanner, "Couldn't load your snapshots. Check that Firestore is enabled and its read rule matches users/{uid}/dailySnapshots.", true);
  } finally {
    refreshButton.disabled = false;
    refreshButton.textContent = "Refresh";
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage(loginError, "", false);
  const email = document.querySelector("#email").value.trim();
  const password = document.querySelector("#password").value;
  const submit = document.querySelector("#loginSubmit");
  submit.disabled = true;
  submit.textContent = "Signing in…";
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    console.warn("Sign-in failed:", error.code);
    setMessage(loginError, "Sign-in failed. Check the email and password for your Firebase account.", true);
  } finally {
    submit.disabled = false;
    submit.textContent = "Sign in";
  }
});

signOutButton.addEventListener("click", async () => {
  await signOut(auth);
});

refreshButton.addEventListener("click", () => {
  if (currentUser) loadSnapshots(currentUser);
});

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  loginPanel.hidden = Boolean(user);
  dashboard.hidden = !user;
  signOutButton.hidden = !user;
  refreshButton.hidden = !user;
  if (!user) return;
  userLabel.textContent = user.email || "Signed in";
  await loadSnapshots(user);
});
