# H2KNOW Pre-Launch Audit

- Branch: `audit/pre-launch-prep`
- Scope: pre-launch code/application review before initial deployment.
- Status: read-only audit; no application code changed.
- Verification: `npm run lint` passed; `npm run build` passed.
- Build note: production bundle is `1,538.71 kB` JS / `415.30 kB` gzip, with a Vite
  code-splitting warning.

## 1. Showstoppers / critical bugs

### S1. Privileged Edge Functions accept unauthenticated calls
`verify_jwt = false` is set for both `log-activity` and `manage-user`
(`supabase/config.toml:4` and `:15`), and neither function checks caller identity
or role.

`supabase/functions/manage-user/index.ts:22-137` uses the service-role key to:

- create users with `auth.admin.createUser()` (`:33`);
- force `profiles` to `{ role, status: "approved" }` (`:52`);
- update any user’s email with `updateUserById()` (`:79`);
- delete any user with `deleteUser()` plus `profiles.delete()` (`:120`, `:131`).

It only validates required fields (`:25`, `:72`, `:113`). Anyone able to reach
the deployed function URL can therefore create admin accounts, change roles or
emails, hard-delete users, and bypass the frontend RBAC checks.

The same exposure applies to `log-activity` (`index.ts:15-34`): arbitrary
`{ user_id, full_name, role, activity, status }` payloads can forge or spam
activity logs.

Fix before deploy:

- Require the caller JWT.
- Resolve the caller’s `profiles` row server-side.
- Allow only `role = "admin"` and `status = "approved"` for `manage-user`.
- Restrict `log-activity` to authenticated callers, or derive identity server-side.

### S2. Fresh databases cannot be provisioned from the tracked migrations
The only tracked migrations are:

- `supabase/migrations/20260809000000_manager_portal.sql`
- `supabase/migrations/20260809000001_manager_rls_policies.sql`

They alter `alerts` and `reports` and add policies, but do not create the base
tables/columns the app expects: `profiles`, `activity_logs`,
`monitoring_sites`, `sensor_readings`, `parameters`, `thresholds`, `nodes`,
report columns such as `report_name`, `parameters`, `format`,
`date_range_start`, `date_range_end`, and `file_url`, or alert columns such as
`reviewed_at` and `status`.

For initial deployment, add a reviewed baseline/core-schema migration or schema
snapshot, then validate `supabase db push` end-to-end against an empty
Postgres 15+ project.

### S3. Activity-log status rendering can crash the page
`src/pages/admin/ActivityLogs.jsx:94`:

```jsx
className={`badge badge-${row.status.toLowerCase()}`}
```

A `NULL` or missing `status` throws and unmounts the page. Handle it with:

```jsx
(row.status || "pending")
```

plus a matching fallback label. Also guard `formatDateTime(row.created_at)` so a
missing timestamp does not render a 1970-era date.

### S4. Google sign-in flow is order-fragile
The Google OAuth handler in `src/pages/Login.jsx:204-215` calls
`signInWithOAuth()` and then immediately continues to `getSession()` and
`verifyAccess()` in the same handler. OAuth normally redirects away, so the
subsequent session/profile lookup can run against `undefined`, and a Google
user with a missing, pending, or rejected profile can be left with an active
session or miss the intended `has_password` onboarding flow.

Only continue after a verified session and profile exist, and sign out on every
verification-failure path.

### S5. Report workflow promises a download it never creates
- Admin `src/pages/admin/Reports.jsx:17-20` acknowledges that `file_url` remains
  null and rows display “Pending”.
- Manager `src/pages/manager/ManagerReports.jsx:26` inserts new report requests
  with `file_url: null`; the history table links “Download” only when a file
  exists and otherwise shows “Pending” indefinitely.
- Admin reports also do not write/read the newer
  `report_name`/`parameters`/`format` fields, so admin and manager report
  records can drift.

Either implement PDF/CSV generation before launch, or change the wording to
“request submitted” and clarify that no downloadable file is produced yet.

### S6. No tracked SPA fallback or in-app 404 route
`src/App.jsx` defines application routes without a `path="*"` fallback. No
`vercel.json`, `_redirects`, or equivalent host rewrite config is tracked.
Refreshing or deep-linking to `/admin/dashboard`, `/manager/*`, or
`/reset-password` can therefore 404 at the CDN layer. Add host-level rewrites
to `index.html` and an in-app `*` NotFound route.

## 2. Medium warnings

### M1. RBAC exists in the UI but the database policy matrix is unverified
`src/routes/ProtectedRoute.jsx:26-33` correctly denies users who are not
approved or who have the wrong role. However, direct profile updates/inserts,
report inserts, alert updates, and broad table selects succeed or fail based on
Supabase RLS, which cannot be fully reviewed from the two tracked migrations.
Before launch, verify that RLS denies cross-role writes and unauthenticated
reads/writes for every touched table. Pay particular attention to the
UserManagement delete fallback to a direct `profiles.delete()`
(`src/pages/admin/UserManagement.jsx:151-158`), because it assumes table-level
permission when the Edge Function is unavailable.

### M2. Some authentication failures can leave a session active
`src/pages/Login.jsx:89-171` throws or displays an error on profile verification
failures, but not every failure signs out first. For example, a transient
`profiles` fetch failure during email/password login can leave the user
authenticated while showing “Could not verify your account.” Use
sign-out-then-error for verification failures and keep retry safe.

### M3. Password-setup policy is inconsistent
`src/pages/ResetPassword.jsx:52` requires 6+ characters and matching entries.
The first-time password screen in `src/pages/Login.jsx:240-277` only advises
strength and does not require matching entries. Require match, minimum length,
and the same server-side password policy in both flows.

### M4. First-load bundle is heavy
The observed bundle is `1,538.71 kB` JS / `415.30 kB` gzip, with a Vite
code-split warning. Every user—including the login/landing route—pays the cost
of Leaflet and Recharts. Consider `React.lazy` splitting for admin, manager,
and map routes if mobile first-paint matters.

### M5. Leaflet default marker may not render under Vite
`src/pages/manager/CatchmentMap.jsx:73` uses the default Leaflet `Marker`
without an explicit icon image. This is a known Vite asset-path risk
(`marker-icon.png` 404). Verify that a dropped pin renders; if not, set an
explicit `L.Icon.Default` image path or a custom marker.

### M6. Unhandled-promise paths in logging/audit calls
`logActivity()` (`src/lib/logActivity.js:3-7`) awaits an Edge Function with no
try/catch, and `useLogPageView` does not catch it either. A failed or degraded
`log-activity` function can therefore create unhandled rejections/noise
alongside real page logic. Wrap audit logging defensively. Related race:
several `fetchX()` calls set `loading(true)` and then `loading(false)` at the
end, but exceptions outside their try blocks (for example,
`ManagerReports.jsx:26` `logActivity`/`fetchReports` awaits) can leave
`saving`/`loading` stuck; use `try/finally` around state flags.

### M7. Stale-channel race on dashboards
Realtime unsubscribe is cleaned up, but in-flight PostgREST requests are not
cancelled on unmount/navigation, so late resolutions can set state after
navigation. The impact is low in React 18 but worth guarding if warnings appear
during fast page switching.

### M8. Miscellaneous data/UX edges
- Admin `Dashboard.jsx:637` falls back to an empty `badge-` class for missing
  status; make unknown status explicit.
- Manager submit paths can swallow some post-submit fetch errors; show them
  instead of continuing silently.
- Report names have no length cap; date filters use string comparison plus
  appended times, so timezone/day-boundary rows can surprise users.
- Only 5 `console.error` calls remain, all in dashboard catch blocks; consider
  gating them for production.
- `index.html` title is still `h2know-dashboard`; set product title/meta if the
  app is public-facing.
- Tracked `supabase/.temp/*` (pooler host, project ref, org IDs) are
  identifiers rather than credentials, and `.env`, `dist`, and `*.log` are
  properly ignored. Consider untracking `.temp` to avoid CLI-state noise; no
  secret was found. `H2knowLogo.jpg` is tracked and all 4 logo imports now match
  its case.

## 3. Launch checklist

Environment / build:

- `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` set for Production, Preview,
  and Build in Vercel; redeploy cleanly after any change.
- `npm run build` green; confirm the deployed bundle renders `H2knowLogo-*.jpg`.
- Use Node 20+ in the deploy image (local Node 24 worked); add `engines` if the
  host does not pin Node.

Supabase:

- Confirm Postgres 15+ before applying
  `20260809000001_manager_rls_policies.sql`.
- Create/verify the base schema first, then run `20260809000000`, then
  `20260809000001`; confirm the RLS matrix for every table and role.
- Deploy `log-activity` and `manage-user`, then restrict them to authenticated
  admin callers.
- Set Auth Site URL and redirect URLs to production, not localhost.
- Seed `profiles` with `role` and `status="approved"` for real admin/manager
  accounts; seed `parameters`, `nodes`, and `thresholds`.

Host:

- Add SPA rewrites to `index.html` and an in-app `*` NotFound route.
- Smoke-test direct refresh on `/`, `/reset-password`, one admin route, and one
  manager route.

Functional smoke:

- Approve, pending, and reject login states; wrong-role redirects to `/`.
- User create/edit/enable/disable/delete; verify the auth user and profile stay
  consistent.
- Alert review/resolve changes `alerts.status`; pending profiles appear under
  “Pending Review”.
- Report inserts appear; activity-log rows render even when fields are null.
- Dashboard realtime plus polling updates; manager map tiles and pins render.
- Mobile spot-check around 360–480px and 1024px (sidebar off-canvas; tables
  scroll through `.table-wrap`).

