// Liest die Dateien einer Karte und baut das Modell. Läuft im Browser und in Node (Tests).

import { parseHof } from './parse/hof.js';
import { parseTtl, parseTtp, parseBusstops, stem } from './parse/ttdata.js';
import { buildModel } from './model.js';

/**
 * @param {{hofs:{path:string,file:any}[], ttl:{path:string,file:any}[], ttp:{path:string,file:any}[], busstops:{path:string,file:any}|null}} group
 * @param {(entry:{path:string,file:any}) => Promise<string>} readText
 * @param {{hofIndex?:number, onProgress?:(done:number,total:number)=>void}} [opts]
 */
export async function loadMap(group, readText, opts = {}) {
  const hofEntry = group.hofs[opts.hofIndex ?? 0];
  const hof = hofEntry
    ? parseHof(await readText(hofEntry), hofEntry.path)
    : { fileName: '', name: '', serviceTrip: '', termini: [], trips: [] };

  const total = group.ttl.length + group.ttp.length + (group.busstops ? 1 : 0);
  let done = 0;
  const tick = () => opts.onProgress?.(++done, total);

  const busstops = group.busstops ? parseBusstops(await readText(group.busstops)) : new Map();
  if (group.busstops) tick();

  const lines = [];
  for (const e of group.ttl) {
    lines.push(parseTtl(await readText(e), e.path));
    tick();
  }

  // Nur Fahrten lesen, die ein Umlauf auch benutzt (große Karten haben tausende .ttp)
  const needed = new Set(lines.flatMap((l) => l.tours.flatMap((t) => t.trips.map((x) => x.trip.toLowerCase()))));
  const trips = new Map();
  const batch = [];
  for (const e of group.ttp) {
    const key = stem(e.path).toLowerCase();
    if (!needed.has(key)) {
      tick();
      continue;
    }
    batch.push(
      readText(e).then((text) => {
        trips.set(key, parseTtp(text, e.path));
        tick();
      }),
    );
    if (batch.length >= 64) await Promise.all(batch.splice(0));
  }
  await Promise.all(batch);

  return buildModel({ hof, lines, trips, busstops });
}
