/* Offline gazetteer.
   Everything resolves locally - no geocoding service, so the page works with no
   network and there is nothing to rate-limit or fail mid-interaction.

   `r` is how far out the name still describes where you are, in km. Cities take
   CITY_KM below — metropolitan scale — and only the wide natural features carry
   their own extent. Beyond that radius the reverse lookup reports a bearing and
   a distance rather than the name, because 400 km off the coast is not Kolkata. */

export const CITY_KM = 55;

export const PLACES = [
  { name: 'Tokyo', country: 'Japan', lat: 35.6762, lon: 139.6503 },
  { name: 'Delhi', country: 'India', lat: 28.6139, lon: 77.2090 },
  { name: 'Mumbai City', country: 'India', lat: 18.980765, lon: 72.833804 },
  { name: 'Bengaluru', country: 'India', lat: 12.9716, lon: 77.5946 },
  // SPARC pilot district. The gazetteer is a world city list, so the one place
  // the analytics actually cover was not findable from this search until now.
  { name: 'Nagpur', country: 'India', lat: 21.1458, lon: 79.0882 },
  { name: 'Kolkata', country: 'India', lat: 22.5726, lon: 88.3639 },
  { name: 'Chennai', country: 'India', lat: 13.0827, lon: 80.2707 },
  { name: 'Bhopal', country: 'India', lat: 23.2599, lon: 77.4126 },
  { name: 'Hyderabad', country: 'India', lat: 17.3850, lon: 78.4867 },
  { name: 'Pune', country: 'India', lat: 18.5204, lon: 73.8567 },
  { name: 'Ahmedabad', country: 'India', lat: 23.0225, lon: 72.5714 },
  { name: 'Jaipur', country: 'India', lat: 26.9124, lon: 75.7873 },
  { name: 'Shanghai', country: 'China', lat: 31.2304, lon: 121.4737 },
  { name: 'Beijing', country: 'China', lat: 39.9042, lon: 116.4074 },
  { name: 'Shenzhen', country: 'China', lat: 22.5431, lon: 114.0579 },
  { name: 'Guangzhou', country: 'China', lat: 23.1291, lon: 113.2644 },
  { name: 'Chengdu', country: 'China', lat: 30.5728, lon: 104.0668 },
  { name: 'Hong Kong', country: 'China', lat: 22.3193, lon: 114.1694 },
  { name: 'Seoul', country: 'South Korea', lat: 37.5665, lon: 126.9780 },
  { name: 'Osaka', country: 'Japan', lat: 34.6937, lon: 135.5023 },
  { name: 'Taipei', country: 'Taiwan', lat: 25.0330, lon: 121.5654 },
  { name: 'Manila', country: 'Philippines', lat: 14.5995, lon: 120.9842 },
  { name: 'Jakarta', country: 'Indonesia', lat: -6.2088, lon: 106.8456 },
  { name: 'Bangkok', country: 'Thailand', lat: 13.7563, lon: 100.5018 },
  { name: 'Ho Chi Minh City', country: 'Vietnam', lat: 10.8231, lon: 106.6297 },
  { name: 'Hanoi', country: 'Vietnam', lat: 21.0285, lon: 105.8542 },
  { name: 'Kuala Lumpur', country: 'Malaysia', lat: 3.1390, lon: 101.6869 },
  { name: 'Singapore', country: 'Singapore', lat: 1.3521, lon: 103.8198 },
  { name: 'Dhaka', country: 'Bangladesh', lat: 23.8103, lon: 90.4125 },
  { name: 'Karachi', country: 'Pakistan', lat: 24.8607, lon: 67.0011 },
  { name: 'Lahore', country: 'Pakistan', lat: 31.5204, lon: 74.3587 },
  { name: 'Islamabad', country: 'Pakistan', lat: 33.6844, lon: 73.0479 },
  { name: 'Kathmandu', country: 'Nepal', lat: 27.7172, lon: 85.3240 },
  { name: 'Colombo', country: 'Sri Lanka', lat: 6.9271, lon: 79.8612 },
  { name: 'Tashkent', country: 'Uzbekistan', lat: 41.2995, lon: 69.2401 },
  { name: 'Almaty', country: 'Kazakhstan', lat: 43.2220, lon: 76.8512 },
  { name: 'Ulaanbaatar', country: 'Mongolia', lat: 47.8864, lon: 106.9057 },
  { name: 'Tehran', country: 'Iran', lat: 35.6892, lon: 51.3890 },
  { name: 'Baghdad', country: 'Iraq', lat: 33.3152, lon: 44.3661 },
  { name: 'Riyadh', country: 'Saudi Arabia', lat: 24.7136, lon: 46.6753 },
  { name: 'Dubai', country: 'UAE', lat: 25.2048, lon: 55.2708 },
  { name: 'Doha', country: 'Qatar', lat: 25.2854, lon: 51.5310 },
  { name: 'Jerusalem', country: 'Israel', lat: 31.7683, lon: 35.2137 },
  { name: 'Istanbul', country: 'Turkiye', lat: 41.0082, lon: 28.9784 },
  { name: 'Ankara', country: 'Turkiye', lat: 39.9334, lon: 32.8597 },

  { name: 'London', country: 'United Kingdom', lat: 51.5074, lon: -0.1278 },
  { name: 'Edinburgh', country: 'United Kingdom', lat: 55.9533, lon: -3.1883 },
  { name: 'Dublin', country: 'Ireland', lat: 53.3498, lon: -6.2603 },
  { name: 'Paris', country: 'France', lat: 48.8566, lon: 2.3522 },
  { name: 'Madrid', country: 'Spain', lat: 40.4168, lon: -3.7038 },
  { name: 'Barcelona', country: 'Spain', lat: 41.3851, lon: 2.1734 },
  { name: 'Lisbon', country: 'Portugal', lat: 38.7223, lon: -9.1393 },
  { name: 'Rome', country: 'Italy', lat: 41.9028, lon: 12.4964 },
  { name: 'Milan', country: 'Italy', lat: 45.4642, lon: 9.1900 },
  { name: 'Berlin', country: 'Germany', lat: 52.5200, lon: 13.4050 },
  { name: 'Munich', country: 'Germany', lat: 48.1351, lon: 11.5820 },
  { name: 'Amsterdam', country: 'Netherlands', lat: 52.3676, lon: 4.9041 },
  { name: 'Brussels', country: 'Belgium', lat: 50.8503, lon: 4.3517 },
  { name: 'Zurich', country: 'Switzerland', lat: 47.3769, lon: 8.5417 },
  { name: 'Vienna', country: 'Austria', lat: 48.2082, lon: 16.3738 },
  { name: 'Prague', country: 'Czechia', lat: 50.0755, lon: 14.4378 },
  { name: 'Warsaw', country: 'Poland', lat: 52.2297, lon: 21.0122 },
  { name: 'Budapest', country: 'Hungary', lat: 47.4979, lon: 19.0402 },
  { name: 'Athens', country: 'Greece', lat: 37.9838, lon: 23.7275 },
  { name: 'Stockholm', country: 'Sweden', lat: 59.3293, lon: 18.0686 },
  { name: 'Oslo', country: 'Norway', lat: 59.9139, lon: 10.7522 },
  { name: 'Copenhagen', country: 'Denmark', lat: 55.6761, lon: 12.5683 },
  { name: 'Helsinki', country: 'Finland', lat: 60.1699, lon: 24.9384 },
  { name: 'Reykjavik', country: 'Iceland', lat: 64.1466, lon: -21.9426 },
  { name: 'Moscow', country: 'Russia', lat: 55.7558, lon: 37.6173 },
  { name: 'Saint Petersburg', country: 'Russia', lat: 59.9311, lon: 30.3609 },
  { name: 'Novosibirsk', country: 'Russia', lat: 55.0084, lon: 82.9357 },
  { name: 'Vladivostok', country: 'Russia', lat: 43.1332, lon: 131.9113 },
  { name: 'Kyiv', country: 'Ukraine', lat: 50.4501, lon: 30.5234 },
  { name: 'Bucharest', country: 'Romania', lat: 44.4268, lon: 26.1025 },

  { name: 'Cairo', country: 'Egypt', lat: 30.0444, lon: 31.2357 },
  { name: 'Lagos', country: 'Nigeria', lat: 6.5244, lon: 3.3792 },
  { name: 'Kinshasa', country: 'DR Congo', lat: -4.4419, lon: 15.2663 },
  { name: 'Nairobi', country: 'Kenya', lat: -1.2921, lon: 36.8219 },
  { name: 'Addis Ababa', country: 'Ethiopia', lat: 9.0250, lon: 38.7469 },
  { name: 'Johannesburg', country: 'South Africa', lat: -26.2041, lon: 28.0473 },
  { name: 'Cape Town', country: 'South Africa', lat: -33.9249, lon: 18.4241 },
  { name: 'Casablanca', country: 'Morocco', lat: 33.5731, lon: -7.5898 },
  { name: 'Marrakesh', country: 'Morocco', lat: 31.6295, lon: -7.9811 },
  { name: 'Algiers', country: 'Algeria', lat: 36.7538, lon: 3.0588 },
  { name: 'Tunis', country: 'Tunisia', lat: 36.8065, lon: 10.1815 },
  { name: 'Accra', country: 'Ghana', lat: 5.6037, lon: -0.1870 },
  { name: 'Dakar', country: 'Senegal', lat: 14.7167, lon: -17.4677 },
  { name: 'Khartoum', country: 'Sudan', lat: 15.5007, lon: 32.5599 },
  { name: 'Dar es Salaam', country: 'Tanzania', lat: -6.7924, lon: 39.2083 },
  { name: 'Luanda', country: 'Angola', lat: -8.8390, lon: 13.2894 },
  { name: 'Antananarivo', country: 'Madagascar', lat: -18.8792, lon: 47.5079 },

  { name: 'New York', country: 'United States', lat: 40.7128, lon: -74.0060 },
  { name: 'Los Angeles', country: 'United States', lat: 34.0522, lon: -118.2437 },
  { name: 'Chicago', country: 'United States', lat: 41.8781, lon: -87.6298 },
  { name: 'San Francisco', country: 'United States', lat: 37.7749, lon: -122.4194 },
  { name: 'Seattle', country: 'United States', lat: 47.6062, lon: -122.3321 },
  { name: 'Denver', country: 'United States', lat: 39.7392, lon: -104.9903 },
  { name: 'Houston', country: 'United States', lat: 29.7604, lon: -95.3698 },
  { name: 'Miami', country: 'United States', lat: 25.7617, lon: -80.1918 },
  { name: 'Boston', country: 'United States', lat: 42.3601, lon: -71.0589 },
  { name: 'Washington DC', country: 'United States', lat: 38.9072, lon: -77.0369 },
  { name: 'Anchorage', country: 'United States', lat: 61.2181, lon: -149.9003 },
  { name: 'Honolulu', country: 'United States', lat: 21.3069, lon: -157.8583 },
  { name: 'Toronto', country: 'Canada', lat: 43.6532, lon: -79.3832 },
  { name: 'Vancouver', country: 'Canada', lat: 49.2827, lon: -123.1207 },
  { name: 'Montreal', country: 'Canada', lat: 45.5017, lon: -73.5673 },
  { name: 'Mexico City', country: 'Mexico', lat: 19.4326, lon: -99.1332 },
  { name: 'Guadalajara', country: 'Mexico', lat: 20.6597, lon: -103.3496 },
  { name: 'Havana', country: 'Cuba', lat: 23.1136, lon: -82.3666 },
  { name: 'Panama City', country: 'Panama', lat: 8.9824, lon: -79.5199 },
  { name: 'Bogota', country: 'Colombia', lat: 4.7110, lon: -74.0721 },
  { name: 'Lima', country: 'Peru', lat: -12.0464, lon: -77.0428 },
  { name: 'Quito', country: 'Ecuador', lat: -0.1807, lon: -78.4678 },
  { name: 'Santiago', country: 'Chile', lat: -33.4489, lon: -70.6693 },
  { name: 'Buenos Aires', country: 'Argentina', lat: -34.6037, lon: -58.3816 },
  { name: 'Montevideo', country: 'Uruguay', lat: -34.9011, lon: -56.1645 },
  { name: 'Sao Paulo', country: 'Brazil', lat: -23.5505, lon: -46.6333 },
  { name: 'Rio de Janeiro', country: 'Brazil', lat: -22.9068, lon: -43.1729 },
  { name: 'Brasilia', country: 'Brazil', lat: -15.7939, lon: -47.8828 },
  { name: 'Manaus', country: 'Brazil', lat: -3.1190, lon: -60.0217 },
  { name: 'La Paz', country: 'Bolivia', lat: -16.4897, lon: -68.1193 },
  { name: 'Caracas', country: 'Venezuela', lat: 10.4806, lon: -66.9036 },

  { name: 'Sydney', country: 'Australia', lat: -33.8688, lon: 151.2093 },
  { name: 'Melbourne', country: 'Australia', lat: -37.8136, lon: 144.9631 },
  { name: 'Brisbane', country: 'Australia', lat: -27.4698, lon: 153.0251 },
  { name: 'Perth', country: 'Australia', lat: -31.9505, lon: 115.8605 },
  { name: 'Darwin', country: 'Australia', lat: -12.4634, lon: 130.8456 },
  { name: 'Auckland', country: 'New Zealand', lat: -36.8485, lon: 174.7633 },
  { name: 'Wellington', country: 'New Zealand', lat: -41.2866, lon: 174.7756 },
  { name: 'Suva', country: 'Fiji', lat: -18.1248, lon: 178.4501 },
  { name: 'Port Moresby', country: 'Papua New Guinea', lat: -9.4438, lon: 147.1803 },

  // Settlements and summits are points; the rest are regions, and a region that
  // took the city radius would report "820 km NE of Sahara Desert" from inside
  // the Sahara. These extents are deliberately conservative — a name that only
  // covers the middle of its feature is a smaller error than one that spills
  // past the edge onto something else.
  { name: 'McMurdo Station', country: 'Antarctica', lat: -77.8419, lon: 166.6863, r: 40 },
  { name: 'Longyearbyen', country: 'Svalbard', lat: 78.2232, lon: 15.6267, r: 30 },
  { name: 'Nuuk', country: 'Greenland', lat: 64.1836, lon: -51.7214, r: 30 },
  { name: 'Mount Everest', country: 'Nepal/China', lat: 27.9881, lon: 86.9250, r: 25 },
  { name: 'Kilimanjaro', country: 'Tanzania', lat: -3.0674, lon: 37.3556, r: 30 },
  { name: 'Grand Canyon', country: 'United States', lat: 36.1069, lon: -112.1129, r: 80 },
  { name: 'Great Barrier Reef', country: 'Australia', lat: -18.2871, lon: 147.6992, r: 350 },
  { name: 'Amazon Basin', country: 'Brazil', lat: -3.4653, lon: -62.2159, r: 700 },
  { name: 'Sahara Desert', country: 'Africa', lat: 23.4162, lon: 25.6628, r: 900 },
  // The oceanic pole of inaccessibility. Being nowhere near anything is the
  // whole point of it, so it is the one entry that earns a wide radius.
  { name: 'Point Nemo', country: 'Pacific Ocean', lat: -48.8767, lon: -123.3933, r: 800 },
];

/* substring match, ranked: exact > prefix > contained, shorter names first */
export function findPlaces(query, limit = 6) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored = [];
  for (const p of PLACES) {
    const name = p.name.toLowerCase();
    const country = p.country.toLowerCase();
    let score;
    if (name === q) score = 0;
    else if (name.startsWith(q)) score = 1;
    else if (name.includes(q)) score = 2;
    else if (country.startsWith(q)) score = 3;
    else if (country.includes(q)) score = 4;
    else continue;
    scored.push({ p, score: score * 1000 + p.name.length });
  }
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, limit).map((s) => s.p);
}

const toRad = Math.PI / 180;
const R_KM = 6371;

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
  const limit = maxKm ?? n.place.r ?? CITY_KM;
  return n.km <= limit ? n.place.name : null;
}

const fmtKm = (km) => (km < 10
  ? `${km.toFixed(1)} km`
  : `${Math.round(km).toLocaleString('en-US')} km`);

/* Past this there is no useful relationship left to state, and "3,180 km SW of
   Honolulu" is just a long way of saying you are in the middle of the Pacific. */
const RELATIVE_KM = 1200;

/* One line describing where a coordinate is, for the hover readout.

   Every branch has to survive being read off the screen and checked on a map,
   which rules out both of the old behaviours: naming a city you are 400 km from
   and calling unknown ground open water. `water` comes from the mask —
   true, false, or null while it is still decoding — and null simply drops the
   sea/land clause rather than guessing at it. */
export function describeLocation(lat, lon, water = null) {
  const n = nearestPlaceInfo(lat, lon);
  if (!n) return water === true ? 'open water' : '—';

  if (n.km <= (n.place.r ?? CITY_KM)) return n.place.name;

  const rel = `${fmtKm(n.km)} ${n.from} of ${n.place.name}`;
  if (water !== true) return rel;
  return n.km <= RELATIVE_KM ? `open water · ${rel}` : 'open water';
}
