# Analytics

A private affiliate performance dashboard backed by Firebase Authentication and Cloud Firestore.

## Current setup

- Static, responsive dashboard with an owner sign-in screen.
- Firebase email and password authentication.
- Authenticated reads from `users/{uid}/dailySnapshots`.
- Latest invite, active member, and RepsCentral page-view totals with changes against the previous available snapshot.
- No sample metrics, provider passwords, or personal workbook values in the page.

The Firebase web configuration in `src/firebase.js` is intended to be public. Firebase web API keys identify the project; access must be protected with Firebase Authentication, restrictive Firestore rules, and Firebase App Check as appropriate. Never put a service account key, provider password, or session cookie in this repository.

## Firebase setup

1. Enable **Email/Password** in Firebase Authentication and add the authorized account.
2. Copy the account's Firebase **UID** into the Firestore rules where needed. The current `firestore.rules` permits an authenticated user to read only their own snapshots and denies browser writes.
3. Publish the rules to the Firebase project. Merge with any existing rules carefully so you do not open other collections.
4. Deploy this repository as a static site. Add the deployed site domain to Firebase Authentication's authorized domains.
5. Sign in with the account's email and password.

Firebase's built-in Email/Password provider requires an email address. A username-only Firebase sign-in is not supported by this page; if the account was created with a username only, use an email-based Firebase account or add a trusted server-side username-to-account mapping.

## Snapshot format

The dashboard reads documents at:

```
users/{firebaseUid}/dailySnapshots/{YYYY-MM-DD}
```

Expected fields:

```js
{
  metricDate: "2026-11-09",
  capturedAt: FirestoreTimestamp,
  invitesTotal: 123,
  activeTotal: 42,
  repscentralDailyPageViews: 980
}
```

It also accepts equivalent nested fields: `hipobuy.invitesTotal`, `hipobuy.activeTotal`, and `repscentral.dailyPageViews`. Each daily document should contain the cumulative Hipobuy counters and the RepsCentral page views for that date. The dashboard calculates changes from adjacent snapshots. A trusted scheduled collector will need server-side Firestore write access; do not enable browser writes for convenience.

## Automation status

Daily collection is not connected yet. The next step is to confirm the Hipobuy affiliate counters while signed in, then build a Cloudflare scheduled collector or browser automation that writes normalized snapshots. RepsCentral's admin “Total Visits” is a page-view count; the collector should use its date-filtered daily series and avoid labeling it as unique visitors. Keep provider authentication in a secure browser/session flow and store any required secret material only in Cloudflare's secret store.

Video-level attribution requires a tagged link or per-post platform data. Daily movement can be compared with traffic, but correlation alone does not prove that a specific video caused a change.
