/* Offline selenographic gazetteer.
   Everything resolves locally - no geocoding service, so the page works with no
   network and there is nothing to rate-limit or fail mid-interaction.

   Coordinates are selenographic: latitude north of the lunar equator, longitude
   east of the prime meridian, which is the point that faces Earth. Anything
   past |90| is on the far side and never rises over an Earth horizon.

   `r` is how far out the name still describes where you are, in km. Craters and
   landing sites take FEATURE_KM below; the maria carry their own extent because
   Oceanus Procellarum is 2,500 km across and calling its middle "Kepler" would
   be absurd. Beyond that radius the reverse lookup reports a bearing and a
   distance rather than the name. */

export const FEATURE_KM = 60;

export const PLACES = [
  /* ── maria: the basalt seas, and the reason the near side has a face ──── */
  { name: 'Mare Tranquillitatis', region: 'mare · near side', lat: 8.5, lon: 31.4, r: 440 },
  { name: 'Mare Serenitatis', region: 'mare · near side', lat: 28.0, lon: 17.5, r: 350 },
  { name: 'Mare Imbrium', region: 'mare · near side', lat: 32.8, lon: -15.6, r: 570 },
  { name: 'Oceanus Procellarum', region: 'mare · near side', lat: 18.4, lon: -57.4, r: 1000 },
  { name: 'Mare Crisium', region: 'mare · near side', lat: 17.0, lon: 59.1, r: 270 },
  { name: 'Mare Fecunditatis', region: 'mare · near side', lat: -7.8, lon: 51.3, r: 460 },
  { name: 'Mare Nectaris', region: 'mare · near side', lat: -15.2, lon: 35.5, r: 170 },
  { name: 'Mare Nubium', region: 'mare · near side', lat: -21.3, lon: -16.6, r: 350 },
  { name: 'Mare Humorum', region: 'mare · near side', lat: -24.4, lon: -38.6, r: 210 },
  { name: 'Mare Frigoris', region: 'mare · near side', lat: 56.0, lon: 1.4, r: 700 },
  { name: 'Mare Vaporum', region: 'mare · near side', lat: 13.3, lon: 3.6, r: 120 },
  { name: 'Mare Smythii', region: 'mare · limb', lat: 1.3, lon: 87.5, r: 190 },
  { name: 'Mare Australe', region: 'mare · limb', lat: -38.9, lon: 93.0, r: 300 },
  { name: 'Mare Orientale', region: 'mare · limb', lat: -19.4, lon: -92.8, r: 320 },
  { name: 'Mare Moscoviense', region: 'mare · far side', lat: 27.3, lon: 147.9, r: 140 },
  { name: 'Mare Ingenii', region: 'mare · far side', lat: -33.7, lon: 163.5, r: 160 },
  { name: 'Sinus Iridum', region: 'bay · near side', lat: 44.1, lon: -31.5, r: 120 },
  { name: 'Sinus Medii', region: 'bay · near side', lat: 2.4, lon: 1.7, r: 90 },
  { name: 'Lacus Somniorum', region: 'lake · near side', lat: 38.0, lon: 29.2, r: 130 },
  { name: 'Palus Putredinis', region: 'marsh · near side', lat: 26.5, lon: 0.4, r: 90 },

  /* ── craters, near side ────────────────────────────────────────────────── */
  { name: 'Tycho', region: 'crater · near side', lat: -43.3, lon: -11.4, r: 85 },
  { name: 'Copernicus', region: 'crater · near side', lat: 9.6, lon: -20.1, r: 90 },
  { name: 'Kepler', region: 'crater · near side', lat: 8.1, lon: -38.0 },
  { name: 'Aristarchus', region: 'crater · near side', lat: 23.7, lon: -47.4 },
  { name: 'Plato', region: 'crater · near side', lat: 51.6, lon: -9.4, r: 80 },
  { name: 'Clavius', region: 'crater · near side', lat: -58.4, lon: -14.4, r: 130 },
  { name: 'Grimaldi', region: 'crater · limb', lat: -5.5, lon: -68.3, r: 110 },
  { name: 'Gassendi', region: 'crater · near side', lat: -17.6, lon: -40.1, r: 75 },
  { name: 'Theophilus', region: 'crater · near side', lat: -11.4, lon: 26.4, r: 75 },
  { name: 'Petavius', region: 'crater · near side', lat: -25.3, lon: 60.4, r: 110 },
  { name: 'Langrenus', region: 'crater · near side', lat: -8.9, lon: 61.1, r: 85 },
  { name: 'Archimedes', region: 'crater · near side', lat: 29.7, lon: -4.0, r: 70 },
  { name: 'Eratosthenes', region: 'crater · near side', lat: 14.5, lon: -11.3 },
  { name: 'Ptolemaeus', region: 'crater · near side', lat: -9.2, lon: -1.8, r: 100 },
  { name: 'Alphonsus', region: 'crater · near side', lat: -13.7, lon: -3.2, r: 80 },
  { name: 'Arzachel', region: 'crater · near side', lat: -18.2, lon: -1.9, r: 70 },
  { name: 'Hipparchus', region: 'crater · near side', lat: -5.5, lon: 4.8, r: 95 },
  { name: 'Albategnius', region: 'crater · near side', lat: -11.2, lon: 4.1, r: 85 },
  { name: 'Aristoteles', region: 'crater · near side', lat: 50.2, lon: 17.4, r: 70 },
  { name: 'Eudoxus', region: 'crater · near side', lat: 44.3, lon: 16.3 },
  { name: 'Posidonius', region: 'crater · near side', lat: 31.8, lon: 29.9, r: 70 },
  { name: 'Fracastorius', region: 'crater · near side', lat: -21.5, lon: 33.2, r: 80 },
  { name: 'Maurolycus', region: 'crater · near side', lat: -42.0, lon: 14.0, r: 80 },
  { name: 'Stofler', region: 'crater · near side', lat: -41.1, lon: 6.0, r: 85 },
  { name: 'Schickard', region: 'crater · limb', lat: -44.3, lon: -55.3, r: 130 },
  { name: 'Bailly', region: 'crater · limb', lat: -66.5, lon: -69.1, r: 170 },
  { name: 'Humboldt', region: 'crater · limb', lat: -27.0, lon: 80.9, r: 120 },

  /* ── far side, which nobody saw at all until Luna 3 in 1959 ───────────── */
  { name: 'Tsiolkovskiy', region: 'crater · far side', lat: -20.4, lon: 129.1, r: 110 },
  { name: 'Korolev', region: 'basin · far side', lat: -4.0, lon: 157.4, r: 240 },
  { name: 'Hertzsprung', region: 'basin · far side', lat: 1.4, lon: -128.7, r: 300 },
  { name: 'Apollo', region: 'basin · far side', lat: -36.1, lon: -151.8, r: 260 },
  { name: 'Aitken', region: 'crater · far side', lat: -16.8, lon: 173.4, r: 90 },
  { name: 'Daedalus', region: 'crater · far side', lat: -5.9, lon: 179.4 },
  { name: 'Jackson', region: 'crater · far side', lat: 22.4, lon: -163.1, r: 70 },
  { name: 'Van de Graaff', region: 'crater · far side', lat: -27.4, lon: 172.2, r: 90 },
  { name: 'South Pole-Aitken', region: 'basin · far side', lat: -53.0, lon: -169.0, r: 1200 },

  /* ── poles: those floors have not seen the sun in two billion years ───── */
  { name: 'Shackleton', region: 'crater · south pole', lat: -89.9, lon: 0.0, r: 45 },
  { name: 'Peary', region: 'crater · north pole', lat: 88.6, lon: 33.0, r: 70 },
  { name: 'Malapert', region: 'crater · south pole', lat: -84.9, lon: -12.9, r: 60 },

  /* ── highlands relief ──────────────────────────────────────────────────── */
  { name: 'Montes Apenninus', region: 'range · near side', lat: 18.9, lon: -3.7, r: 300 },
  { name: 'Montes Caucasus', region: 'range · near side', lat: 38.4, lon: 10.0, r: 200 },
  { name: 'Montes Alpes', region: 'range · near side', lat: 46.4, lon: -0.8, r: 200 },
  { name: 'Vallis Alpes', region: 'valley · near side', lat: 48.5, lon: 3.2, r: 90 },
  { name: 'Rupes Recta', region: 'scarp · near side', lat: -22.1, lon: -7.8, r: 60 },
  { name: 'Mons Huygens', region: 'peak · near side', lat: 19.9, lon: -2.9, r: 40 },
  { name: 'Marius Hills', region: 'domes · near side', lat: 12.5, lon: -54.0, r: 90 },

  /* ── where the hardware is ─────────────────────────────────────────────── */
  { name: 'Tranquility Base', region: 'landing site · Apollo 11', lat: 0.674, lon: 23.473, r: 30 },
  { name: 'Statio Cognitum', region: 'landing site · Apollo 12', lat: -3.012, lon: -23.422, r: 30 },
  { name: 'Fra Mauro', region: 'landing site · Apollo 14', lat: -3.645, lon: -17.472, r: 30 },
  { name: 'Hadley-Apennine', region: 'landing site · Apollo 15', lat: 26.132, lon: 3.634, r: 30 },
  { name: 'Descartes Highlands', region: 'landing site · Apollo 16', lat: -8.973, lon: 15.501, r: 30 },
  { name: 'Taurus-Littrow', region: 'landing site · Apollo 17', lat: 20.191, lon: 30.772, r: 30 },
  { name: 'Luna 9', region: 'landing site · 1966', lat: 7.08, lon: -64.37, r: 25 },
  { name: 'Luna 16', region: 'landing site · 1970', lat: -0.68, lon: 56.30, r: 25 },
  { name: 'Lunokhod 1', region: 'rover · Luna 17', lat: 38.24, lon: -35.00, r: 25 },
  { name: 'Surveyor 1', region: 'landing site · 1966', lat: -2.47, lon: -43.34, r: 25 },
  { name: 'Chang’e 4', region: 'landing site · far side', lat: -45.44, lon: 177.60, r: 30 },
  { name: 'Chang’e 5', region: 'landing site · 2020', lat: 43.06, lon: -51.92, r: 30 },
  { name: 'Shiv Shakti Point', region: 'landing site · Chandrayaan-3', lat: -69.37, lon: 32.32, r: 30 },
  { name: 'Luna 2 impact', region: 'impact site · 1959', lat: 29.1, lon: 0.0, r: 25 },
];

export function findPlaces(query, limit = 6) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored = [];
  for (const p of PLACES) {
    const name = p.name.toLowerCase();
    const region = p.region.toLowerCase();
    let score;
    if (name === q) score = 0;
    else if (name.startsWith(q)) score = 1;
    else if (name.includes(q)) score = 2;
    else if (region.startsWith(q)) score = 3;
    else if (region.includes(q)) score = 4;
    else continue;
    scored.push({ p, score: score * 1000 + p.name.length });
  }
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, limit).map((s) => s.p);
}

const toRad = Math.PI / 180;
const R_KM = 1737.4;      // lunar mean radius

/* great-circle distance, km */
export function haversine(lat1, lon1, lat2, lon2) {
  const la1 = lat1 * toRad, la2 = lat2 * toRad;
  const dLa = la2 - la1, dLo = (lon2 - lon1) * toRad;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLo / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/* initial great-circle bearing from 1 to 2, as a 16-point compass name */
export function bearing(lat1, lon1, lat2, lon2) {
  const la1 = lat1 * toRad, la2 = lat2 * toRad, dLo = (lon2 - lon1) * toRad;
  const y = Math.sin(dLo) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLo);
  const deg = (Math.atan2(y, x) / toRad + 360) % 360;
  return COMPASS[Math.round(deg / 22.5) % 16];
}

/* closest gazetteer entry to a coordinate, whatever the distance:
   { place, km, from } where `from` is the compass direction of the coordinate
   as seen from the place — the direction the phrase "S of Kolkata" needs. */
export function nearestPlaceInfo(lat, lon) {
  let best = null, bestD = Infinity;
  for (const p of PLACES) {
    const d = haversine(lat, lon, p.lat, p.lon);
    if (d < bestD) { bestD = d; best = p; }
  }
  if (!best) return null;
  return { place: best, km: bestD, from: bearing(best.lat, best.lon, lat, lon) };
}

/* Name for a coordinate, or null if no entry is close enough to claim it.
   `maxKm` overrides the per-place radius; leave it off to get the honest one. */
export function nearestPlace(lat, lon, maxKm) {
  const n = nearestPlaceInfo(lat, lon);
  if (!n) return null;
  const limit = maxKm ?? n.place.r ?? FEATURE_KM;
  return n.km <= limit ? n.place.name : null;
}

const fmtKm = (km) => (km < 10
  ? `${km.toFixed(1)} km`
  : `${Math.round(km).toLocaleString('en-US')} km`);

/* Past this there is no useful relationship left to state. The Moon is a
   quarter of Earth's width, so 400 km is already a long way across the disc,
   and "900 km SW of Tycho" says nothing the coordinates do not. */
const RELATIVE_KM = 400;

/* One line describing where a coordinate is, for the hover readout.

   Every branch has to survive being read off the screen and checked against the
   map, which rules out naming a crater you are 400 km from. `mare` comes from
   the mask - true, false, or null while it is still decoding - and null simply
   drops the terrain clause rather than guessing at it. */
export function describeLocation(lat, lon, mare = null) {
  const n = nearestPlaceInfo(lat, lon);
  if (!n) return mare === true ? 'mare basalt' : '—';

  if (n.km <= (n.place.r ?? FEATURE_KM)) return n.place.name;

  const rel = `${fmtKm(n.km)} ${n.from} of ${n.place.name}`;
  if (mare === null) return rel;
  const terrain = mare ? 'mare basalt' : 'highlands';
  return n.km <= RELATIVE_KM ? `${terrain} · ${rel}` : terrain;
}
