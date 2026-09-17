# H2KNOW – Water Quality Monitoring Dashboard

Realtime water-quality monitoring platform with an **admin dashboard**, a **manager
monitoring portal**, and Supabase as the backend (database, auth, row-level
security, and Edge Functions).

## Features

- **Admin dashboard** – live KPIs (users, active alerts, sensor readings,
  pending-review accounts), recent alerts, user-activity logs, auto-refresh with
  realtime subscriptions + polling + manual refresh.
- **User management** – approve/review, edit, enable/disable, and delete users
  (lucide icons, confirmation states, delete-fallback handling).
- **Manager portal** – dashboard, analytics & trend charts (Recharts), catchment
  map (Leaflet), alert review/resolve, and report requests.
- **Role-based access** – admin-only and manager-only routes enforced via
  `ProtectedRoute`.

## Tech Stack

- React 19 + Vite 8
- React Router 7
- Supabase (`@supabase/supabase-js`) – auth, Postgres + RLS, Realtime, Edge Functions
- Leaflet / react-leaflet (map)
- Recharts (trend charts)
- lucide-react (icons)

## Prerequisites

- Node.js 20+ and npm
- A Supabase project (see `supabase/` and `DATA_NAMING_GUIDE.md`)

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in your Supabase values
```

Required environment variables (used by `src/lib/supabase.js`):

| Variable | Description |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase anon/publishable key |

## Scripts

```bash
npm run dev      # local dev server
npm run build    # production build -> dist/
npm run preview  # preview the production build
npm run lint     # eslint
```

## Deployment

Follow [DEPLOYMENT.md](./DEPLOYMENT.md) for the step-by-step initial-deployment
runbook (build, hosting, Supabase schema migrations, Edge Functions, RLS, and
verification).

## Documentation

- [DEPLOYMENT.md](./DEPLOYMENT.md) – initial deployment runbook
- [DATA_NAMING_GUIDE.md](./DATA_NAMING_GUIDE.md) – parameter naming, DB schema, and config guide