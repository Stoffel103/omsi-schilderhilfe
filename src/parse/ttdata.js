// Liest den Fahrplan einer Karte (Ordner maps/<Karte>/TTData).
//
// Formate laut openOMSI docs/FORMATS.md und crates/omsi-timetable:
// - *.ttl  Linie (Dateiname = Linienname): [userallowed], [priority],
//          [newtour] Nummer, AI-Gruppe, Tagesmaske
//          [addtrip] Fahrt (= .ttp-Dateiname), Profil, Abfahrt in Minuten nach Mitternacht
// - *.ttp  Fahrt: [trip] Strecke, Zielname, Linientext
//          [station_typ2] Objekt-ID der Haltestelle (neues Format)
//          [station] 8 Zeilen, Name in Zeile 3 (altes Format)
//          [profile] Name, Faktor
// - Busstops.cfg  [busstop] Name, Gruppe, Objekt-ID, 3 Zahlen

import { BlockReader } from './cfg.js';

/**
 * @typedef {{trip:string, profile:number, departure:number}} TourTrip
 * @typedef {{number:string, aiGroup:string, mask:number, trips:TourTrip[]}} Tour
 * @typedef {{name:string, userAllowed:boolean, priority:number, tours:Tour[]}} Line
 * @typedef {{name:string, track:string, terminus:string, line:string, stationIds:number[], stationNames:string[]}} Trip
 */

export function stem(fileName) {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  return base.replace(/\.[^.]*$/, '');
}

/** @returns {Line} */
export function parseTtl(text, fileName) {
  const r = new BlockReader(text);
  /** @type {Line} */
  const line = { name: stem(fileName), userAllowed: false, priority: 0, tours: [] };
  let kw;
  while ((kw = r.nextKeyword()) !== null) {
    switch (kw) {
      case 'userallowed':
        line.userAllowed = true;
        break;
      case 'priority':
        line.priority = r.int();
        break;
      case 'newtour': {
        const number = r.str().trim();
        const aiGroup = r.str().trim();
        const extra = r.str().trim();
        const mask = extra === '' ? 1023 : parseInt(extra, 10);
        line.tours.push({ number, aiGroup, mask: Number.isFinite(mask) ? mask : 1023, trips: [] });
        break;
      }
      case 'addtrip': {
        const trip = r.str().trim();
        const profile = r.int();
        const departure = r.num();
        line.tours[line.tours.length - 1]?.trips.push({ trip, profile, departure });
        break;
      }
      default:
        break;
    }
  }
  return line;
}

/** @returns {Trip} */
export function parseTtp(text, fileName) {
  const r = new BlockReader(text);
  /** @type {Trip} */
  const trip = { name: stem(fileName), track: '', terminus: '', line: '', stationIds: [], stationNames: [] };
  let kw;
  while ((kw = r.nextKeyword()) !== null) {
    switch (kw) {
      case 'trip':
        trip.track = r.str().trim();
        trip.terminus = r.str().trim();
        trip.line = r.str().trim();
        break;
      case 'station_typ2': {
        const id = parseInt(r.str().trim(), 10);
        if (Number.isFinite(id)) trip.stationIds.push(id);
        break;
      }
      case 'station': {
        const block = Array.from({ length: 8 }, () => r.str());
        trip.stationNames.push(block[2].trim());
        break;
      }
      default:
        break;
    }
  }
  return trip;
}

/** @returns {Map<number,string>} Objekt-ID → Haltestellenname */
export function parseBusstops(text) {
  const r = new BlockReader(text);
  const map = new Map();
  let kw;
  while ((kw = r.nextKeyword()) !== null) {
    if (kw === 'busstop') {
      const name = r.str().trim();
      r.str(); // Gruppe
      const id = parseInt(r.str().trim(), 10);
      if (Number.isFinite(id) && !map.has(id)) map.set(id, name);
    }
  }
  return map;
}

/**
 * Tagesmaske eines Umlaufs: Bit 0–6 Mo–So, Bit 7 Feiertag,
 * Bit 8 fährt in den Schulferien, Bit 9 fährt an Schultagen. Leer = 1023 (immer).
 */
export function decodeMask(mask) {
  const days = Array.from({ length: 7 }, (_, i) => Boolean(mask & (1 << i)));
  return {
    days,
    holiday: Boolean(mask & (1 << 7)),
    schoolHolidays: Boolean(mask & (1 << 8)),
    schoolDays: Boolean(mask & (1 << 9)),
  };
}
