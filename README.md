# H2KNOW

**Manuscript title:** *H2KNOW: Design and Development of an IoT-Enabled Wireless Sensor Network-Based River Catchment Water Monitoring and Analytics System.*

H2KNOW is a water quality monitoring platform for the Dicklum River Catchment in Manolo Fortich, Bukidnon. Its intended purpose is to provide continuous, site-specific water readings and catchment context to DENR-EMB and local stakeholders, supporting timely investigation and decisions. The working repository contains the web application and Supabase integration; sensor firmware is described by the manuscript but is not included here.

## Project background

The manuscript identifies a gap in periodic manual sampling, which can miss short-lived changes, and a lack of regular monitoring coverage for the Dicklum River. Its objectives are to develop sensor and controller nodes for real-time measurement and telemetry, combine catchment GIS layers and water readings in a restricted web platform with historical records, threshold assessment, visual alerts and report exports, then evaluate system functionality, transmission reliability, sensor accuracy, real-time monitoring, and usability through field deployment. Intended users include environmental agencies, local government and other local stakeholders. The manuscript describes a deployment at one Dicklum River monitoring point and proposes testing for at least 14 days.

## System architecture and data flow

1. In the manuscript design, an Arduino Mega-based Sensor Node collects readings. Pumps draw in fresh water and flush the sampling line; a water-level sensor supports the sampling cycle. A separate ESP32-based Controller Node receives timestamped data over a 433 MHz LoRa link. A microSD card is described as a backup if the link drops. Solar power supports off-grid operation.
2. The controller is described as transmitting data to Supabase and a restricted web dashboard. This repository implements the Supabase-connected frontend and provides an Arduino-compatible example payload in [DATA_NAMING_GUIDE.md](DATA_NAMING_GUIDE.md), but includes no sensor firmware, LoRa receiver, or sensor ingestion service.
3. Sensor readings, parameter metadata, thresholds, nodes, alerts, profiles, reports, and activity logs are expected in the Supabase application schema. The base schema and sensor-to-cloud ingestion mechanism are not created by the migrations in this repository.
4. The React client connects to Supabase using `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. The manager and admin views query the database; dashboard data can update through Supabase Realtime and periodic/manual refresh where implemented.
5. Managers view readings, trends, catchment map, insights, and alerts, and can review/resolve alerts and request reports. Admins manage users and view dashboard summaries, data records, alert history, reports, and activity logs.

## Monitored parameters and thresholds

The manuscript specifies four water-quality measurements: pH (0–14, stated accuracy ±0.1), turbidity (0–1000 NTU), TDS (0–1000 ppm), and temperature (DS18B20, stated accuracy ±0.5°C). It describes pH sampling every 15 minutes and turbidity, TDS, and temperature sampling every 5 to 10 seconds, with a settling period before recording. The water-level sensor is operational and is not a fifth water-quality parameter. The repository and [DATA_NAMING_GUIDE.md](DATA_NAMING_GUIDE.md) use the names pH, Temperature, TDS, and Turbidity and units pH, °C, ppm, and NTU. The guide's typical ranges are not configured alert thresholds.

The manuscript says alert assessment is to use DENR DAO 2016-08 Class C standards and visually flag anomalous readings, but it does not provide numeric thresholds for the four measured parameters. In the application, threshold records (`min_value`, `max_value`, and `severity_label`) are associated with parameters and displayed with alert records; managers can update alert status. The web client does not define universal numeric thresholds or generate threshold-breach alert rows from sensor readings. The manuscript also notes that its four measurements do not cover biological contaminants, pesticides, heavy metals, or other chemical residues, that readings indicate changes rather than proving contamination or potability, and that one station does not represent the whole river. Its land-cover mapping may misclassify plantations as forest, and its analytics do not include hydrological simulation or AI forecasting.

## Implemented features

- **Admin dashboard** at `/admin/dashboard`: user, alert, reading, and pending-review summaries; recent alerts and activity; refresh and Realtime updates.
- **Admin user management** at `/admin/user-management`: user administration, including create, edit, enable/disable, and delete actions through the `manage-user` Edge Function (with a documented frontend fallback for deletes).
- **Admin activity logs** at `/admin/user-activity-logs`, **data records** at `/admin/data-records`, **alert history** at `/admin/alert-history`, and **reports** at `/admin/reports`.
- **Manager dashboard** at `/manager/dashboard`, **analytics** at `/manager/analytics`, **insights** at `/manager/insights`, **alerts** at `/manager/alerts`, and **report requests** at `/manager/reports`.
- Catchment mapping uses Leaflet and repository GeoJSON/JSON data. Insights include a Supabase Edge Function for weather-aware insights.
- Authentication uses Supabase Auth. Protected routes require an approved profile with the matching `admin` or `manager` role. Database row-level security is also configured through Supabase policies/migrations.
- Report generation/export and storage integration are implemented in the frontend. Available request formats in the manager portal schema are PDF and CSV.

## Manuscript design specifications

These describe the research system design, not hardware or firmware contained in this repository.

| Component | Manuscript specification |
| --- | --- |
| Sensor node | Arduino Mega with pH, turbidity, TDS, and DS18B20 temperature sensors; intake/drain pumps; water-level sensor; RTC and microSD backup are also specified |
| Controller and link | ESP32 controller and RA-02/SX1278 LoRa module at 433 MHz |
| Power | Solar-powered off-grid setup |
| Platform | Restricted-access dashboard with real-time readings, history, threshold alerts, catchment GIS visualization, and reports |
| Study area | One monitoring point in the Dicklum River Catchment, Manolo Fortich, Bukidnon |
| Evaluation | Field testing and SUS evaluation; the manuscript abstract leaves the results and SUS score as placeholders |

## Routes and roles

| Route | Access |
| --- | --- |
| `/` | Login |
| `/reset-password` | Password reset |
| `/admin/dashboard` | Approved admin |
| `/admin/user-activity-logs` | Approved admin |
| `/admin/user-management` | Approved admin |
| `/admin/data-records` | Approved admin |
| `/admin/alert-history` | Approved admin |
| `/admin/reports` | Approved admin |
| `/manager/dashboard` | Approved manager |
| `/manager/analytics` | Approved manager |
| `/manager/insights` | Approved manager |
| `/manager/alerts` | Approved manager |
| `/manager/reports` | Approved manager |

## Backend objects

The application expects these existing public tables: `profiles`, `alerts`, `reports`, `sensor_readings`, `parameters`, `thresholds`, `nodes`, `monitoring_sites`, and `activity_logs`. The repository migrations extend `alerts` and `reports`, add manager row-level security policies, configure Realtime publication membership for readings and alerts, harden access policies, and handle profile creation for Google OAuth. They do not create the full base schema. Although the manuscript names Supabase as its database, the actual sensor-to-Supabase ingestion path is not included in this repository.

Edge Functions in the repository:

- `log-activity`: records authenticated user activity using the caller's profile.
- `manage-user`: admin-authorized user administration actions.
- `weather-insights`: generates weather-aware insights using available sensor and profile data.

## Technology stack

Versions below are the dependency ranges declared in `package.json` (caret ranges), not locked exact install versions.

| Package | Declared version |
| --- | --- |
| React / React DOM | `^19.2.6` |
| Vite | `^8.0.12` |
| React Router DOM | `^7.18.1` |
| `@supabase/supabase-js` | `^2.110.2` |
| Leaflet / React Leaflet | `^1.9.4` / `^5.0.0` |
| Recharts | `^3.10.1` |
| Chart.js | `^4.5.1` |
| lucide-react | `^1.47.0` |
| jsPDF / jspdf-autotable | `^4.2.1` / `^5.0.8` |
| ESLint | `^10.3.0` |
| Supabase CLI package | `^2.109.1` |

## Prerequisites

- Node.js 20+ and npm
- A Supabase project with the base application schema configured
- Supabase CLI installed and authenticated for database migrations and Edge Function deployment
- PostgreSQL 15+ for the supplied manager RLS migration

## Setup

```bash
npm ci
cp .env.example .env.local
```

Set these build-time variables in `.env.local`:

```text
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-or-publishable-key
```

Configure the Supabase base schema and seed the required profile, parameter, node, threshold, and monitoring-site data. The repository migrations alter an existing schema; they are not a complete initial schema. See [DEPLOYMENT.md](DEPLOYMENT.md) for migration order, roles, RLS, Edge Functions, and hosting steps.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite development server |
| `npm run build` | Build the static frontend into `dist/` |
| `npm run preview` | Preview the production build locally |
| `npm run lint` | Run ESLint across the project |
| `npm test` | Run the insights unit tests |
| `npm run test:security` | Run cross-user authorization tests |
| `npm run test:all` | Run both test files above |
| `npm run supabase -- <args>` | Forward arguments to the Supabase CLI |

## Deployment

Build and host the static `dist/` directory, configure SPA fallback to `index.html`, and provide the two Vite environment variables at build time. Apply the migrations to a project with the required base schema, configure approved admin/manager profiles, and deploy the three Edge Functions as needed. Follow [DEPLOYMENT.md](DEPLOYMENT.md) for the full deployment runbook. Refer to [DATA_NAMING_GUIDE.md](DATA_NAMING_GUIDE.md) for parameter names, units, data conventions, and threshold record examples.

## Discrepancies

- **Research title and location scope:** the manuscript title describes a river-catchment monitoring and analytics system, while its scope limits measurements to one point in the Dicklum River Catchment. The web application contains catchment visualization assets, but its data model includes nodes/sites and does not enforce that study-area boundary.
- **Sensor system absent from repository:** the manuscript specifies Arduino Mega and ESP32 nodes, LoRa (RA-02/SX1278 at 433 MHz), solar power, pumps, water-level sensing, RTC, and microSD backup. The repository includes no embedded code, device protocol implementation, LoRa integration, or sensor ingestion Edge Function. Supabase and an Arduino-style payload are documented, but end-to-end sensor-to-cloud transmission is not implemented here.
- **Sampling schedule:** the manuscript specifies pH every 15 minutes and turbidity, TDS, and temperature every 5 to 10 seconds. No such acquisition schedule is implemented in this web repository.
- **Threshold standards:** the manuscript says alerts should use DENR DAO 2016-08 Class C standards, but does not give numeric thresholds for its measured parameters. The code reads configured threshold and alert records; it does not evaluate readings and automatically create alerts. The guide's pH threshold SQL is an example configuration, not code-backed live configuration.
- **GIS detail:** the manuscript describes GIS-derived catchment boundaries, land cover/use classification, deployment locations, and QGIS mapping. The repository renders catchment-related map assets, but its code does not implement QGIS analysis or derive land cover. The manuscript itself cautions that satellite land cover may confuse plantation crops with forest.
- **Evaluation and results:** the manuscript's abstract and results chapter still contain placeholders for deployment dates, observed readings, classifications, and SUS score. No research results or SUS outcome can be reported from it as supplied. The web application repository does not contain the field evaluation data.
- **Report workflow:** the manuscript says a requested report remains pending until prepared, then the manager manually downloads it; report delivery is not automatic. The code implements report requests and frontend generation/export, with PDF/CSV request formats. The complete operational preparation workflow depends on deployed backend setup.
- **Base schema:** the repository deployment guide says migrations assume an existing base schema. The repository does not include the complete schema or a sensor ingestion function; these must be supplied/configured separately.
