/* Pure geometry + query parsing. No DOM, no three.js - so it runs under Node for
   tests and imports cleanly into the browser bundle. */

import { findPlaces, nearestPlace } from './places.js';

const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* Matches three.js SphereGeometry's default UV layout, so an equirectangular
   texture lines up: u wraps east from the antimeridian, v runs south to north. */
export function latLonToVec3(lat, lon, radius = 1) {
  const phi = (90 - lat) * DEG;
  const theta = (lon + 180) * DEG;
  return {
    x: -radius * Math.sin(phi) * Math.cos(theta),
    y: radius * Math.cos(phi),
    z: radius * Math.sin(phi) * Math.sin(theta),
  };
}

export function vec3ToLatLon(v) {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  const lat = 90 - Math.acos(clamp(v.y / len, -1, 1)) / DEG;
  let lon = Math.atan2(v.z / len, -v.x / len) / DEG - 180;
  lon = ((lon + 540) % 360) - 180;
  return { lat, lon };
}

export const fmtLat = (v) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? 'N' : 'S'}`;
export const fmtLon = (v) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? 'E' : 'W'}`;

/* Accepts "35.68, 139.69", "51°30'N 0°7'W", or a place name. Returns null on
   anything unparseable or out of range. */
export function parseQuery(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;

  const dec = text.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,;]?\s+?\s*(-?\d+(?:\.\d+)?)\s*$/)
           || text.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (dec) {
    const lat = parseFloat(dec[1]);
    const lon = parseFloat(dec[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      return { lat, lon, name: nearestPlace(lat, lon) || 'Custom target' };
    }
    return null;
  }

  const dms = /(\d+(?:\.\d+)?)\s*°?\s*(?:(\d+(?:\.\d+)?)\s*['′]\s*)?(?:(\d+(?:\.\d+)?)\s*["″]\s*)?\s*([NSEW])/gi;
  const parts = [...text.matchAll(dms)];
  if (parts.length === 2) {
    const val = (m) => {
      const v = parseFloat(m[1]) + (parseFloat(m[2]) || 0) / 60 + (parseFloat(m[3]) || 0) / 3600;
      return /[SW]/i.test(m[4]) ? -v : v;
    };
    const latFirst = /[NS]/i.test(parts[0][4]);
    const lat = latFirst ? val(parts[0]) : val(parts[1]);
    const lon = latFirst ? val(parts[1]) : val(parts[0]);
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      return { lat, lon, name: nearestPlace(lat, lon) || 'Custom target' };
    }
    return null;
  }

  const hit = findPlaces(text, 1)[0];
  return hit ? { lat: hit.lat, lon: hit.lon, name: hit.name } : null;
}
