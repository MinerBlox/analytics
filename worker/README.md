# HipoBuy order audit collector

The Cloudflare Worker requests the HipoBuy affiliate API with a private `X-Access-Token`, saves hourly HipoBuy audit records plus a daily rolling snapshot in Firestore, and optionally extracts yesterday's RepsCentral page views once per day.

## Firebase setup (must do before running)
1. In Firebase Console → Authentication → Users, find the **dashboard owner's UID**.
2. In `firestore.rules`, replace **both** occurrences of `REPLACE_WITH_OWNER_UID` with the owner's actual UID. Deploy these rules in Firebase Console → Firestore → Rules. Merge existing rules first if you have other collections; replacing rules outright may block them.
3. The collector uses a **separate Firebase Email/Password account** whose UID must match `yBGdOLXo8AZMfb5c3JsLYTQeYgt1`. If your collector has a different UID, update both `COLLECTOR_UID` in `worker/src/index.js` and the collector UID in `firestore.rules`. Do not use the dashboard owner's account as the collector.

## Cloudflare settings
Connect the repository's `worker/` directory to your existing Cloudflare Worker (or deploy from there with `npm install` and `npx wrangler deploy`). In Worker Settings → Variables and Secrets, add:

Plaintext variables:
- `FIREBASE_API_KEY` — Firebase web API key in `src/firebase.js`
- `FIREBASE_OWNER_UID` — dashboard owner's Auth UID

**Encrypted Secrets:**
- `HIPO_ACCESS_TOKEN` — your own HipoBuy request's X-Access-Token **value only**
- `FIREBASE_COLLECTOR_EMAIL` — dedicated Firebase collector Auth email
- `FIREBASE_COLLECTOR_PASSWORD` — dedicated Firebase collector Auth password
- `MANUAL_RUN_TOKEN` — long random secret protecting the manual trigger
- `REPSCENTRAL_USERNAME`, `REPSCENTRAL_PASSWORD` — optional, for daily RepsCentral browser extraction
- `HIPO_USERNAME`, `HIPO_PASSWORD` — optional, only to retain the existing daily Active Members counter via browser scraping

Never publish tokens, cookies, or passwords in this GitHub repository or frontend. HipoBuy ordering-user counts do not require `HIPO_USERNAME` / `HIPO_PASSWORD`. The old Active Members card still requires those credentials plus Browser Rendering if you want it to keep updating.

## Run and verify
1. Deploy Worker. Visit `https://YOUR-WORKER.workers.dev/health`; it should respond with `ok: true`.
2. From a private local PowerShell session run this manual test, substituting your Worker URL:
   ```powershell
   $secret = Read-Host "Manual run token"
   Invoke-RestMethod -Method POST -Uri "https://YOUR-WORKER.workers.dev/run-now" -Headers @{ Authorization = "Bearer $secret" }
   Remove-Variable secret
   ```
   Only enter your **MANUAL_RUN_TOKEN** here, not your HipoBuy JWT. Do not share the token or terminal history.
3. Inspect Firestore → Data → `users/{OWNER_UID}/dailySnapshots/{today YYYY-MM-DD}` and `users/{OWNER_UID}/orderAuditSnapshots/{UTC timestamp}`.
4. Deploy dashboard frontend and refresh it after signing in; the ordering-user metrics should populate.
5. Check Worker Logs/Observability for failures. A HipoBuy HTTP 401 means update the `HIPO_ACCESS_TOKEN` encrypted secret; no automated token renewal exists.
6. To test RepsCentral as well, POST to `/run-now?includeReps=true`; RepsCentral requires Browser Rendering, credentials, and a compatible page layout.

## How it runs
- `15 * * * *`: HipoBuy only, hourly at minute 15 UTC.
- `15 1 * * *`: HipoBuy + previous-day RepsCentral, daily at 01:15 UTC.
- `users/{OWNER_UID}/dailySnapshots/{YYYY-MM-DD}`: latest HipoBuy counters and previously fetched RepsCentral daily views (partial updates preserve fields).
- `users/{OWNER_UID}/orderAuditSnapshots/{UTC timestamp}`: timestamped HipoBuy counter history, never the JWT.

The displayed estimate is $50 per monthly ordering user, or $60 for all if 100+ ordering users **and** the rate applies retroactively. This is not proven commission owed. Confirm HipoBuy's commission terms, attribution and monthly reset timezone before reconciling payouts.
