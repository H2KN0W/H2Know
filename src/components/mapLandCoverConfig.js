/**
 * mapLandCoverConfig.js
 *
 * Single source of truth for land-cover class definitions used by:
 *   - MapLegend.jsx (interactive legend panel)
 *   - CatchmentMap.jsx (GeoJSON polygon styling)
 *
 * The `value` field matches feature.properties.landuse (numeric string)
 * from landCover.geojson.
 */

/** Land-cover polygon classes (matches landCover.geojson landuse values) */
export const LAND_COVER_CLASSES = [
  {
    value: "1",
    label: "Water",
    color: "#3F8EDB",
    meaning: "Rivers, ponds, and open water",
    /** Selecting "Water" also highlights the river network */
    highlightsRivers: true,
  },
  {
    value: "2",
    label: "Trees",
    color: "#397D49",
    meaning: "Forest and dense tree cover",
  },
  {
    value: "5",
    label: "Crops",
    color: "#E49635",
    meaning: "Farmland and agricultural land",
  },
  {
    value: "7",
    label: "Built Area",
    color: "#C4281B",
    meaning: "Houses, roads, and buildings",
  },
  {
    value: "10",
    label: "Bare Ground",
    color: "#E3E2C3",
    iconColor: "#8a8373",
    meaning: "Exposed soil and sand",
  },
  {
    value: "11",
    label: "Rangeland",
    color: "#E3E2C3",
    iconColor: "#8a8373",
    meaning: "Open grass and shrub land",
  },
];

/** Special "Rivers" row — represents the river network line layer, not polygons */
export const RIVERS_CLASS = {
  value: "__rivers__",
  label: "Rivers",
  color: "#0891b2",
  meaning: "River network and channels",
  isRiverLayer: true,
  highlightsRivers: true,
};

/** Lookup: landuse value → color */
export const LAND_COVER_COLORS = Object.fromEntries(
  LAND_COVER_CLASSES.map((c) => [c.value, c.color])
);

/**
 * Returns the class config for a given landuse value, or undefined.
 * @param {string|number} value
 */
export function getClassByValue(value) {
  const key = String(Number.isFinite(Number(value)) ? Number(value) : value);
  return LAND_COVER_CLASSES.find((c) => c.value === key);
}
