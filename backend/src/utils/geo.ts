// Great-circle distance between two {lat, lng} points, in kilometers.
// Used to rank events by how close they are to the attendee's saved location.
export const EARTH_RADIUS_KM: number = 6371;

export interface LatLng {
  lat: number;
  lng: number;
}

const toRad = (deg: number): number => (deg * Math.PI) / 180;

export const haversineKm = (a: LatLng | null | undefined, b: LatLng | null | undefined): number | null => {
  if (!a || !b) return null;
  if (![a.lat, a.lng, b.lat, b.lng].every((n) => typeof n === "number")) {
    return null;
  }
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.asin(Math.sqrt(h));
};

// True when a lat/lng pair is present and within valid earth ranges.
export const hasValidCoords = (loc: any): boolean =>
  !!loc &&
  typeof loc.lat === "number" &&
  typeof loc.lng === "number" &&
  loc.lat >= -90 &&
  loc.lat <= 90 &&
  loc.lng >= -180 &&
  loc.lng <= 180;

export default { haversineKm, hasValidCoords };
