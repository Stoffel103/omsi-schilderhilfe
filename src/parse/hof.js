// Liest eine OMSI-Hof-Datei (Depot): Ziele (Termini), Routen (infosystem_trip) und Haltestellen.
//
// Unterstützte Schreibweisen der Ziele:
// - [addterminus] / [addterminus_allexit]: Code, Name, dann `stringcount_terminus` Texte
// - [addterminus_list]: eine Zeile pro Ziel, durch Tabs getrennt: {ALLEX}?, Code, Name, Texte …
//   (so schreiben es Tabellen-Werkzeuge wie die HOF Suite)

import { BlockReader, isKeywordLine } from './cfg.js';

/**
 * @typedef {{code:number, name:string, allExit:boolean, strings:string[]}} Terminus
 * @typedef {{code:number, name:string, terminus:number, line:string, stops:string[]}} HofTrip
 * @typedef {{fileName:string, name:string, serviceTrip:string, termini:Terminus[], trips:HofTrip[]}} Hof
 */

/** @returns {Hof} */
export function parseHof(text, fileName = '') {
  const r = new BlockReader(text, { hof: true });
  /** @type {Hof} */
  const hof = { fileName, name: '', serviceTrip: '', termini: [], trips: [] };

  const stringCount = findStringCount(r.lines, 'stringcount_terminus') ?? 8;

  let kw;
  while ((kw = r.nextKeyword()) !== null) {
    switch (kw) {
      case 'name':
        hof.name = r.str().trim();
        break;
      case 'servicetrip':
        hof.serviceTrip = r.str().trim();
        break;
      case 'addterminus':
      case 'addterminus_allexit': {
        const code = parseInt(r.str().trim(), 10);
        const name = r.str().trim();
        const strings = [];
        for (let k = 0; k < stringCount; k++) {
          if (isKeywordLine(r.peek())) break;
          strings.push(r.str());
        }
        if (Number.isFinite(code)) hof.termini.push({ code, name, allExit: kw.endsWith('allexit'), strings });
        break;
      }
      case 'addterminus_list':
        while (!r.done && !isKeywordLine(r.peek())) {
          const line = r.str();
          if (!line.includes('\t')) continue;
          const f = line.split('\t');
          const code = parseInt((f[1] ?? '').trim(), 10);
          if (!Number.isFinite(code)) continue;
          hof.termini.push({
            code,
            name: (f[2] ?? '').trim(),
            allExit: f[0].trim().toUpperCase() === '{ALLEX}',
            strings: f.slice(3),
          });
        }
        break;
      case 'infosystem_trip': {
        const code = parseInt(r.str().trim(), 10);
        const name = r.str().trim();
        const terminus = parseInt(r.str().trim(), 10);
        const line = r.str().trim();
        if (Number.isFinite(code)) {
          hof.trips.push({ code, name, terminus: Number.isFinite(terminus) ? terminus : -1, line, stops: [] });
        }
        break;
      }
      case 'infosystem_busstop_list': {
        const n = parseInt(r.str().trim(), 10) || 0;
        const stops = [];
        for (let k = 0; k < n && !r.done; k++) stops.push(r.str().trim());
        const last = hof.trips[hof.trips.length - 1];
        if (last && last.stops.length === 0) last.stops = stops;
        break;
      }
      default:
        break;
    }
  }
  return hof;
}

/** `stringcount_terminus` steht je nach Werkzeug mit oder ohne eckige Klammern in der Datei. */
function findStringCount(lines, key) {
  for (let i = 0; i < lines.length - 1; i++) {
    const l = lines[i].trim().toLowerCase();
    if (l === key || l === `[${key}]`) {
      const n = parseInt(lines[i + 1].trim(), 10);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

/**
 * Routennummer fürs IBIS. OMSI sucht eine Route über `Code = Linie × 100 + Route`.
 * @param {HofTrip} t
 */
export function routeOf(t) {
  const line = parseInt(t.line, 10);
  if (Number.isFinite(line) && String(line) === t.line.trim()) {
    const r = t.code - line * 100;
    if (r >= 0 && r < 100) return r;
  }
  return t.code % 100;
}
