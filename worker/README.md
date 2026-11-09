# Cloudflare collector

This Worker runs daily at 01:15 UTC, opens the signed-in Hipobuy and RepsCentral pages in Cloudflare Browser Run, and writes a date-keyed snapshot to Firestore. It refuses to write if it cannot parse all three metrics.

## Worker settings

In Cloudflare Worker Settings → Variables and Secrets, add these as plain-text variables:

- `FIREBASE_API_KEY` (the Firebase web API key; it identifies the project and is not a password)
- `FIREBASE_OWNER_UID` (your dashboard account UID; not a password)

Add these as Secrets:

- `HIPO_USERNAME`
- `HIPO_PASSWORD`
- `REPSCENTRAL_USERNAME`
- `REPSCENTRAL_PASSWORD`
- `FIREBASE_COLLECTOR_EMAIL`
- `FIREBASE_COLLECTOR_PASSWORD`
- `MANUAL_RUN_TOKEN` (a random value protecting the one-off run endpoint)

Do not add secret values to this repository or send them in chat.

## Deploy

Connect this `worker/` directory to a Cloudflare Worker using Workers Builds. The Wrangler configuration sets the Browser Run binding and daily Cron Trigger. Install/build dependencies with `npm install`; Cloudflare's build command can be `npm install`, with deploy command `npx wrangler deploy`.

The first deploy needs the secrets above. Add the Firebase Firestore rule allowing the collector UID to create/update only documents under the dashboard owner's `users/{OWNER_UID}/dailySnapshots/{YYYY-MM-DD}` path. Keep owner reads restricted to the owner's Firebase UID and deny deletes. Do not publish a permissive write rule.

## Snapshot fields

Documents are written to `users/{FIREBASE_OWNER_UID}/dailySnapshots/{Europe-London-date}` with `metricDate`, `capturedAt`, `invitesTotal`, `activeTotal`, and `repscentralDailyPageViews`.

The collector signs into Firebase using its dedicated Firebase account, so Firestore Security Rules apply. It does not use a service-account key.

## RepsCentral extraction

The Worker captures same-origin JSON responses and looks for date/value series, then selects the previous complete Europe/London day. It also selects the Daily chart option when available. If no unambiguous daily value is found, it stops without writing. The admin's cumulative Total Visits counter is never treated as a daily count.

The first successful run must be checked in Worker Logs. If RepsCentral serves a different chart payload shape, the extractor needs to be adjusted before relying on scheduled snapshots.
