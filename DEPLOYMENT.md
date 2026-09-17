# H2KNOW – Initial Deployment Runbook

This guide walks through the first production deployment of the H2KNOW web app
(React/Vite frontend + Supabase backend). It is written for a clean/initial
deploy; existing environments can skip the already-applied steps.

> **Postgres version:** the Supabase RLS migration (`20260809000001_manager_rls_policies.sql`)
> uses `SECURITY DEFINER` functions and the `pg_policies` view, which require
> **PostgreSQL 15+** (Supabase's default). Confirm your project is on PG 15+ before
> applying it; otherwise upgrade or split the RLS policies into version-compatible SQL.

---

## 0. Prerequisites

- [ ] Node.js 20+ and npm
- [ ] A **Supabase project** (Database, Auth, Storage)
- [ ] Supabase CLI installed (`supabase --version`) and logged in
- [ ] Postgres version ≥ 15 on the project

---

## 1. Configure environment

Copy the example env file and fill in your Supabase project values:

```bash
cp .env.example .env.local
```

Required variables (used by `src/lib/supabase.js`):

| Variable | Example |
|----------|---------|
| `VITE_SUPABASE_URL` | `https://your-project-ref.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `eyJ...` (anon/publishable key) |

> These are **build-time** variables. Set them on the deploy host / CI secrets;
> do not commit real values.

---

## 2. Install & build

```bash
npm ci          # clean install from package-lock.json
npm run build   # outputs to dist/
```

Sanity-check the build:

```bash
npm run lint
```

---

## 3. Host the frontend

`dist/` is a fully static build. Serve it from any static host (Vercel, Netlify,
Cloudflare Pages, S3/nginx, etc.).

- Configure the host to:
  - serve `dist/` as the root;
  - route **all** paths back to `index.html` (SPA fallback) so routes such as
    `/admin/dashboard` and `/manager/dashboard` work on refresh;
  - expose env vars `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` to the
    build step.

---

## 4. Supabase backend

### 4.1 Base schema must exist first

This repository's migrations only **alter** existing tables (`alerts`, `reports`)
and add RLS policies. They assume the base application schema already exists
(`profiles`, `alerts`, `reports`, `sensor_readings`, `parameters`, `thresholds`,
`nodes`, `monitoring_sites`, `activity_logs`) — created via the app's
schema/seed setup rather than these migration files.

Verify before applying the migrations:

```sql
-- Should return each expected table
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('profiles','alerts','reports','sensor_readings','parameters','thresholds','nodes','monitoring_sites','activity_logs')
order by 1;
```

Also make sure `auth.uid()` is available and the auth schema is present (Supabase
default).

### 4.2 Apply migrations, in order

```bash
supabase db push
```

or apply the files manually in the SQL editor in this order:

1. `supabase/migrations/20260809000000_manager_portal.sql`
   - adds `alerts.status` (CHECK: `active|reviewed|resolved`), `alerts.reviewed_at`,
     `alerts.reviewed_by` → `profiles(id)`;
   - adds `reports.report_name`, `reports.parameters` (`text[]`),
     `reports.format` (CHECK: `pdf|csv`).
   - These `add column if not exists` guards make the file safe to re-run.
2. `supabase/migrations/20260809000001_manager_rls_policies.sql`
   - creates additive, manager-role RLS policies (never weakens existing policies):
     - `alerts`: manager SELECT + UPDATE (review/resolve)
     - `reports`: manager SELECT + INSERT (request)
     - `sensor_readings`, `parameters`, `thresholds`, `nodes`, `monitoring_sites`: manager SELECT
     - `profiles`: manager SELECT (for names/roles)
   - ensures `sensor_readings` and `alerts` are in the `supabase_realtime` publication.
   - Requires PG 15+; policies are guarded against re-runs.

> **Gotcha fixed:** `CREATE POLICY` has no `IF NOT EXISTS` option. The RLS migration
> uses an explicit `pg_policies` existence check instead — do not "fix" it back.

### 4.3 Deploy Edge Functions

```bash
supabase functions deploy log-activity
supabase functions deploy manage-user
```

- `log-activity` – records admin/manager activity (used by the dashboards).
- `manage-user` – admin user create/edit/enable/disable/delete (used by User
  Management; the frontend falls back to direct table deletes if it is not
  deployed).

### 4.4 Realtime

The RLS migration adds `sensor_readings` and `alerts` to `supabase_realtime`.
If you prefer to enable it manually on an existing project:

```sql
alter publication supabase_realtime add table sensor_readings;
alter publication supabase_realtime add table alerts;
```

---

## 5. Users & roles

- [ ] Create the initial **admin** and **manager** accounts (Auth > Users, or via
      the app's sign-up flow).
- [ ] Ensure each user's `profiles` row has the correct `role` (`admin` / `manager`)
      and `status = 'approved'`. Access is granted by:
      `profile.role = requiredRole AND profile.status = 'approved'`.
- [ ] Seed the base data per `DATA_NAMING_GUIDE.md` (parameters, nodes, thresholds).

---

## 6. Verification

- [ ] `npm run build` completes and `dist/` is served.
- [ ] Login works; unauthorized users are rejected and redirected.
- [ ] **Admin** can reach `/admin/dashboard` and **cannot** reach
      `/manager/dashboard`.
- [ ] **Manager** can reach `/manager/dashboard` and **cannot** reach
      `/admin/dashboard`.
- [ ] Admin dashboard shows live KPIs (users, active alerts, sensor readings,
      pending review) and activity logs.
- [ ] Manager dashboard/analytics show live sensor data; catchment map renders.
- [ ] Alert review/resolve updates `alerts.status`; pending profiles appear under
      "Pending Review".
- [ ] Report requests insert into `reports` with the new metadata columns.
- [ ] Supabase realtime updates flow to the dashboards (no manual refresh needed
      after a change within the refresh window).