// Verbindet Fahrplan (TTData) und Hof-Datei: Für jede Fahrt eines Umlaufs suchen wir
// die passende Hof-Route und damit Linie, Route und Ziel fürs IBIS.
//
// Wie OMSI es selbst macht: Beim Start einer Fahrt bekommt der Bus den Linientext und den
// Zielnamen aus der .ttp; das Ziel wird in der Hof-Datei über den exakten Namen gesucht.
// Die Route gibt es in der .ttp nicht, darum vergleichen wir mit den Hof-Routen:
// Name der Fahrt, Linie, Ziel und Haltestellenfolge.

import { routeOf } from './parse/hof.js';
import { decodeMask } from './parse/ttdata.js';

/** Namen für Vergleiche vereinheitlichen. */
export function norm(s) {
  return String(s ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/�/g, '?') // kaputte Umlaute aus falsch gespeicherten Dateien
    .replace(/\s+/g, ' ')
    .trim();
}

/** Ziffern der Linie, "SB30" → "30". */
function lineDigits(s) {
  const m = String(s ?? '').match(/\d+/g);
  return m ? m.join('') : '';
}

export function indexHof(hof) {
  const termByCode = new Map();
  const termByName = new Map();
  for (const t of hof.termini) {
    if (!termByCode.has(t.code)) termByCode.set(t.code, t);
    const k = norm(t.name);
    if (!termByName.has(k)) termByName.set(k, []);
    termByName.get(k).push(t);
  }
  const tripsByName = new Map();
  const tripsByLine = new Map();
  for (const t of hof.trips) {
    tripsByName.set(norm(t.name), t);
    for (const key of new Set([norm(t.line), lineDigits(t.line)])) {
      if (!key) continue;
      if (!tripsByLine.has(key)) tripsByLine.set(key, []);
      tripsByLine.get(key).push(t);
    }
  }
  return { hof, termByCode, termByName, tripsByName, tripsByLine };
}

/** Länge der längsten gemeinsamen Teilfolge. */
function lcs(a, b) {
  if (!a.length || !b.length) return 0;
  let prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * @typedef {{
 *   hofTrip: import('./parse/hof.js').HofTrip|null,
 *   line: string, route: number|null, ziel: number|null, zielName: string,
 *   altZiele: number[], confidence: 'sicher'|'wahrscheinlich'|'unsicher'|'keine',
 *   stops: string[]
 * }} Match
 */

/**
 * @param {import('./parse/ttdata.js').Trip} ttp
 * @param {string[]} stops  Haltestellennamen der Fahrt
 * @returns {Match}
 */
export function matchTrip(ttp, stops, idx) {
  const termCandidates = idx.termByName.get(norm(ttp.terminus)) ?? [];
  const termCodes = new Set(termCandidates.map((t) => t.code));
  const nStops = stops.map(norm);

  // Kandidaten: Hof-Routen derselben Linie, sonst alle
  let candidates = [
    ...(idx.tripsByLine.get(norm(ttp.line)) ?? []),
    ...(idx.tripsByLine.get(lineDigits(ttp.line)) ?? []),
  ];
  const byName = idx.tripsByName.get(norm(ttp.name));
  if (byName) candidates.push(byName);
  candidates = [...new Set(candidates)];
  if (candidates.length === 0) candidates = idx.hof.trips;

  let best = null;
  let bestScore = -1;
  let bestSim = 0;
  for (const c of candidates) {
    let score = 0;
    if (c === byName) score += 50;
    if (norm(c.line) === norm(ttp.line)) score += 15;
    else if (lineDigits(c.line) && lineDigits(c.line) === lineDigits(ttp.line)) score += 10;
    if (termCodes.has(c.terminus)) score += 20;
    let sim = 0;
    if (nStops.length && c.stops.length) {
      const cs = c.stops.map(norm);
      sim = lcs(nStops, cs) / Math.max(nStops.length, cs.length);
      score += sim * 40;
      if (cs[0] === nStops[0]) score += 8;
      if (cs[cs.length - 1] === nStops[nStops.length - 1]) score += 8;
    }
    if (score > bestScore) {
      best = c;
      bestScore = score;
      bestSim = sim;
    }
  }

  const fallbackTerm = termCandidates[0] ?? null;
  if (!best || bestScore < 20) {
    return {
      hofTrip: null,
      line: ttp.line,
      route: null,
      ziel: fallbackTerm ? fallbackTerm.code : null,
      zielName: fallbackTerm ? fallbackTerm.name : ttp.terminus,
      altZiele: termCandidates.slice(1).map((t) => t.code),
      confidence: 'keine',
      stops,
    };
  }

  // Das Ziel der Hof-Route ist das, was das IBIS bei dieser Route erwartet.
  const term = idx.termByCode.get(best.terminus) ?? fallbackTerm;
  const sameName = term ? (idx.termByName.get(norm(term.name)) ?? []).map((t) => t.code).filter((c) => c !== term.code) : [];
  const confidence =
    best === byName || (bestSim >= 0.999 && termCodes.has(best.terminus))
      ? 'sicher'
      : bestScore >= 60
        ? 'wahrscheinlich'
        : 'unsicher';

  return {
    hofTrip: best,
    line: best.line,
    route: routeOf(best),
    ziel: term ? term.code : best.terminus,
    zielName: term ? term.name : ttp.terminus,
    altZiele: sameName,
    confidence,
    stops,
  };
}

/** Minuten nach Mitternacht → "HH:MM" (über 24 h hinaus weiterzählen, wie OMSI). */
export function fmtTime(min) {
  const m = Math.round(min);
  const h = Math.floor(m / 60);
  return `${String(h % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** "HH:MM" → Minuten, oder null */
export function parseTime(s) {
  const m = /^\s*(\d{1,2})[:.](\d{2})\s*$/.exec(s ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * Baut das komplette Datenmodell einer Karte.
 * @param {{hof:any, lines:import('./parse/ttdata.js').Line[], trips:Map<string,any>, busstops:Map<number,string>}} input
 */
export function buildModel({ hof, lines, trips, busstops }) {
  const idx = indexHof(hof);
  const cache = new Map();
  const missing = new Set();

  const stopsOf = (ttp) =>
    ttp.stationNames.length ? ttp.stationNames : ttp.stationIds.map((id) => busstops.get(id) ?? `#${id}`);

  const resolve = (tripName) => {
    const key = tripName.toLowerCase();
    if (cache.has(key)) return cache.get(key);
    const ttp = trips.get(key);
    let res;
    if (!ttp) {
      missing.add(tripName);
      res = { ttp: null, match: null };
    } else {
      res = { ttp, match: matchTrip(ttp, stopsOf(ttp), idx) };
    }
    cache.set(key, res);
    return res;
  };

  const tours = [];
  for (const line of lines) {
    for (const tour of line.tours) {
      const rows = tour.trips
        .map((tt) => {
          const { ttp, match } = resolve(tt.trip);
          return {
            departure: tt.departure,
            tripName: tt.trip,
            ttpLine: ttp?.line ?? '',
            from: match?.stops[0] ?? '',
            to: ttp?.terminus ?? '',
            match,
          };
        })
        .sort((a, b) => a.departure - b.departure);
      tours.push({
        id: `${line.name}::${tour.number}`,
        lineFile: line.name,
        userAllowed: line.userAllowed,
        number: tour.number,
        aiGroup: tour.aiGroup,
        mask: tour.mask,
        days: decodeMask(tour.mask),
        rows,
        start: rows[0]?.departure ?? 0,
        end: rows[rows.length - 1]?.departure ?? 0,
      });
    }
  }
  tours.sort((a, b) => a.lineFile.localeCompare(b.lineFile, 'de', { numeric: true }) || a.number.localeCompare(b.number, 'de', { numeric: true }));
  return { hof, idx, tours, missing: [...missing] };
}

/** Passt ein Umlauf zu Wochentag (0 = Mo … 6 = So, 7 = Feiertag) und Schulzeit ('schule'|'ferien'|'')? */
export function tourValid(tour, day, school) {
  if (day !== null && day !== undefined && day !== '') {
    const d = Number(day);
    if (d === 7 ? !tour.days.holiday : !tour.days.days[d]) return false;
  }
  if (school === 'schule' && !tour.days.schoolDays) return false;
  if (school === 'ferien' && !tour.days.schoolHolidays) return false;
  return true;
}

/** Tagesmaske lesbar machen, z. B. "Mo–Fr · nur Schultage". */
export function describeDays(days, t) {
  const names = t.dayShort; // ['Mo','Di',…]
  const on = days.days.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
  let s;
  if (on.length === 7) s = t.daily;
  else if (on.length === 0) s = '–';
  else {
    // zusammenhängende Bereiche zusammenfassen
    const parts = [];
    let a = on[0];
    let b = on[0];
    for (const i of on.slice(1).concat([99])) {
      if (i === b + 1) b = i;
      else {
        parts.push(a === b ? names[a] : b === a + 1 ? `${names[a]}, ${names[b]}` : `${names[a]}–${names[b]}`);
        a = b = i;
      }
    }
    s = parts.join(', ');
  }
  if (days.holiday && on.length < 7) s += `, ${t.holidayShort}`;
  if (days.schoolDays && !days.schoolHolidays) s += ` · ${t.onlySchool}`;
  if (!days.schoolDays && days.schoolHolidays) s += ` · ${t.onlyHolidays}`;
  return s;
}
