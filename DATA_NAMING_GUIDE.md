# H2KNOW - Data Naming Convention & Configuration Guide

This document provides the standard naming conventions, parameter definitions, and configuration required for integrating Arduino code and ensuring consistency across the H2KNOW system.

---

## 📊 Water Quality Parameters

All sensor readings in H2KNOW use the following **four standard parameters**. Use these exact names in your Arduino code and database queries.

### 1. **pH**
- **Display Name**: pH
- **Unit**: pH (dimensionless)
- **Chart Color**: `#3B82F6` (Blue)
- **Typical Range**: 0-14
- **Description**: Measures acidity or alkalinity of water

### 2. **Temperature**
- **Display Name**: Temperature
- **Unit**: °C (Celsius)
- **Chart Color**: `#F59E0B` (Amber/Orange)
- **Typical Range**: -10 to 50°C
- **Description**: Water temperature measurement

### 3. **TDS** (Total Dissolved Solids)
- **Display Name**: TDS
- **Unit**: ppm (parts per million)
- **Chart Color**: `#10B981` (Green)
- **Typical Range**: 0-2000 ppm
- **Description**: Measures dissolved mineral content in water

### 4. **Turbidity**
- **Display Name**: Turbidity
- **Unit**: NTU (Nephelometric Turbidity Units)
- **Chart Color**: `#EF4444` (Red)
- **Typical Range**: 0-40+ NTU
- **Description**: Measures water cloudiness/suspended particles

---

## 🗄️ Database Schema

### Supabase Tables

#### `parameters` Table
```sql
id (UUID, Primary Key)
name (text) -- Must be: "pH", "Temperature", "TDS", or "Turbidity"
unit (text) -- e.g., "pH", "°C", "ppm", "NTU"
created_at (timestamp)
```

#### `sensor_readings` Table
```sql
id (UUID, Primary Key)
parameter_id (UUID, Foreign Key → parameters.id)
value (numeric) -- The actual sensor reading value
source (text) -- e.g., "Arduino", "Manual", "Simulation"
recorded_at (timestamp) -- When the reading was taken
node_id (UUID, Foreign Key → nodes.id)
created_at (timestamp)
```

#### `nodes` Table
```sql
id (UUID, Primary Key)
device_label (text) -- Unique identifier for the sensor node (e.g., "Node-01", "Catchment-A")
location (text) -- Physical location of the node
created_at (timestamp)
```

#### `thresholds` Table
```sql
parameter_id (UUID, Foreign Key → parameters.id)
min_value (numeric) -- Minimum safe value
max_value (numeric) -- Maximum safe value
severity_label (text) -- "safe", "warning", or "critical"
created_at (timestamp)
```

---

## 🔌 Arduino Integration Guide

### Expected JSON Format from Arduino

When sending sensor data from Arduino to Supabase, use this format:

```json
{
  "parameter_name": "pH",
  "value": 7.2,
  "source": "Arduino",
  "node_label": "Node-01",
  "timestamp": "2026-08-29T14:30:00Z"
}
```

### Example Arduino Payload Structure

```cpp
// Arduino Code Example
struct SensorReading {
  String parameterName;  // "pH", "Temperature", "TDS", or "Turbidity"
  float value;
  String source;         // "Arduino"
  String nodeLabel;      // e.g., "Sensor-A", "Catchment-01"
  String timestamp;      // ISO 8601 format
};

// Example readings
SensorReading pH_reading = {"pH", 7.2, "Arduino", "Node-01", "2026-08-29T14:30:00Z"};
SensorReading temp_reading = {"Temperature", 25.5, "Arduino", "Node-01", "2026-08-29T14:30:00Z"};
SensorReading tds_reading = {"TDS", 450.0, "Arduino", "Node-01", "2026-08-29T14:30:00Z"};
SensorReading turbidity_reading = {"Turbidity", 3.2, "Arduino", "Node-01", "2026-08-29T14:30:00Z"};
```

### Key Requirements
- **Parameter Names**: Must exactly match one of: `"pH"`, `"Temperature"`, `"TDS"`, `"Turbidity"`
- **Values**: Should be numeric (float/double)
- **Source**: Use `"Arduino"` or `"Manual"` or `"Simulation"` for tracking
- **Node Label**: Create consistent, unique identifiers for each sensor node (e.g., "Catchment-A", "Node-01")
- **Timestamp**: Use ISO 8601 format with timezone: `YYYY-MM-DDTHH:mm:ssZ`

---

## 🔐 Supabase Configuration

### Environment Variables

Create a `.env.local` file (or `.env`) in your project root with the following variables:

```bash
# Supabase Configuration
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-key

# Alternative names (some projects use these)
REACT_APP_SUPABASE_URL=https://your-project-id.supabase.co
REACT_APP_SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-key
```

### Getting Your Supabase Keys

1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project
3. Navigate to **Settings** → **API**
4. Copy:
   - **Project URL** → `VITE_SUPABASE_URL`
   - **Publishable Key** (anon key) → `VITE_SUPABASE_PUBLISHABLE_KEY`

⚠️ **Security**: Never commit `.env.local` to version control. Add it to `.gitignore`.

### Supabase Connection Code

The application uses this connection (in `src/lib/supabase.js`):

```javascript
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
```

---

## 📋 Query Examples

### Insert a Sensor Reading (for Arduino)

```javascript
const { data, error } = await supabase
  .from("sensor_readings")
  .insert([
    {
      parameter_id: "parameter-uuid-here",  // Get from parameters table
      value: 7.2,
      source: "Arduino",
      recorded_at: new Date().toISOString(),
      node_id: "node-uuid-here"  // Get from nodes table
    }
  ]);
```

### Fetch All Parameters

```javascript
const { data: parameters } = await supabase
  .from("parameters")
  .select("id, name, unit")
  .order("name");

// Returns:
// [
//   { id: "...", name: "pH", unit: "pH" },
//   { id: "...", name: "Temperature", unit: "°C" },
//   { id: "...", name: "TDS", unit: "ppm" },
//   { id: "...", name: "Turbidity", unit: "NTU" }
// ]
```

### Fetch Latest Reading for a Parameter

```javascript
const { data: readings } = await supabase
  .from("sensor_readings")
  .select("value, recorded_at, parameters(name, unit)")
  .eq("parameter_id", parameter_id)
  .order("recorded_at", { ascending: false })
  .limit(1);
```

---

## 🎨 UI Color Reference

Use these colors consistently across your Arduino dashboard and web interface:

| Parameter | Color | Hex Code | Usage |
|-----------|-------|----------|-------|
| pH | Blue | `#3B82F6` | Chart lines, badges |
| Temperature | Amber | `#F59E0B` | Chart lines, badges |
| TDS | Green | `#10B981` | Chart lines, badges |
| Turbidity | Red | `#EF4444` | Chart lines, badges, warnings |

---

## ⚠️ Alert/Threshold Severity Levels

Parameters use three severity levels for threshold checking:

| Severity | Label | Description |
|----------|-------|-------------|
| Safe | `"safe"` | Reading within acceptable range |
| Warning | `"warning"` | Reading slightly outside acceptable range |
| Critical | `"critical"` | Reading far outside acceptable range / dangerous |

Example threshold setup:
```sql
INSERT INTO thresholds (parameter_id, min_value, max_value, severity_label)
VALUES 
  ('ph-uuid', 6.5, 8.5, 'safe'),
  ('ph-uuid', 6.0, 9.0, 'warning'),
  ('ph-uuid', 5.0, 10.0, 'critical');
```

---

## 📱 Frontend Integration

### Parameter Display in React Components

The application defines parameters as:

```javascript
// From ManagerDashboard.jsx
const PARAMETERS = ["pH", "Turbidity", "TDS", "Temperature"];

// From AnalyticsTrends.jsx
const PARAMETER_COLORS = {
  "pH": "#3B82F6",
  "Temperature": "#F59E0B",
  "TDS": "#10B981",
  "Turbidity": "#EF4444"
};
```

Always use these exact parameter names in your Arduino code and database setup.

---

## ✅ Checklist for Arduino Integration

- [ ] Use exact parameter names: `"pH"`, `"Temperature"`, `"TDS"`, `"Turbidity"`
- [ ] Each parameter has a unique UUID in the `parameters` table
- [ ] Each sensor node has a unique UUID in the `nodes` table
- [ ] Sensor readings include `source: "Arduino"` for tracking
- [ ] Timestamps are in ISO 8601 format with timezone
- [ ] Supabase environment variables are set correctly
- [ ] Database Row Level Security (RLS) policies allow Arduino inserts
- [ ] Test data flow from Arduino → Supabase → Dashboard

---

## 🆘 Troubleshooting

### "Parameter not found" errors
- Ensure parameter name matches exactly (case-sensitive): `"pH"`, not `"ph"` or `"PH"`
- Verify the parameter exists in the Supabase `parameters` table

### "Node not found" errors
- Create a record in the `nodes` table with a unique `device_label`
- Use the `node_id` UUID when inserting sensor readings

### Missing Supabase connection
- Check `.env.local` file exists with correct keys
- Verify `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are set
- Restart dev server after changing environment variables

---

## 📞 Quick Reference

| Item | Value |
|------|-------|
| Parameter Count | 4 |
| Parameters | pH, Temperature, TDS, Turbidity |
| Primary Supabase Table | sensor_readings |
| Timestamp Format | ISO 8601 with timezone |
| Chart Color for Turbidity | `#EF4444` (Red) |
| Dashboard Route | `/manager/dashboard` |
| Analytics Route | `/manager/analytics` |

---

*Last updated: 2026-08-29*
