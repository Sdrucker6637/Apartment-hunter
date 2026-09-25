// Coarse borough lookup from coordinates, used only when a listing has map
// coordinates but no stated location. Outlines are deliberately simplified,
// so results are always marked 'inferred' (shown as "Estimated").

const POLY = {
  Manhattan: [[40.700, -74.020], [40.711, -73.975], [40.740, -73.970], [40.775, -73.940], [40.797, -73.927], [40.835, -73.933], [40.872, -73.910], [40.880, -73.925], [40.860, -73.945], [40.808, -73.965], [40.760, -74.010], [40.705, -74.022]],
  Bronx: [[40.797, -73.927], [40.835, -73.933], [40.872, -73.910], [40.880, -73.925], [40.915, -73.912], [40.915, -73.780], [40.870, -73.760], [40.800, -73.790], [40.785, -73.890]],
  Brooklyn: [[40.739, -73.962], [40.720, -73.925], [40.700, -73.912], [40.690, -73.870], [40.680, -73.866], [40.640, -73.855], [40.580, -73.855], [40.570, -73.930], [40.570, -74.040], [40.640, -74.045], [40.700, -74.020], [40.705, -73.995]],
  Queens: [[40.739, -73.962], [40.790, -73.935], [40.800, -73.770], [40.760, -73.700], [40.650, -73.725], [40.590, -73.740], [40.540, -73.940], [40.580, -73.855], [40.640, -73.855], [40.680, -73.866], [40.690, -73.870], [40.700, -73.912], [40.720, -73.925]],
};

function inside([lat, lng], poly) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i];
    const [yj, xj] = poly[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

export function boroughFromCoords(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  for (const [boro, poly] of Object.entries(POLY)) if (inside([lat, lng], poly)) return boro;
  if (lat > 40.49 && lat < 40.65 && lng < -74.05 && lng > -74.26) return 'Staten Island';
  if (lat > 40.64 && lat < 40.92 && lng < -74.015 && lng > -74.30) return 'New Jersey';
  return null;
}
