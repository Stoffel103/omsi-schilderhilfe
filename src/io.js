// Dateien aus einem hineingezogenen oder ausgewählten Ordner einsammeln und lesen.
// Alles passiert im Browser, es wird nichts hochgeladen.

/**
 * @typedef {{path:string, file:File}} Entry  path mit "/" getrennt, relativ zum gewählten Ordner
 */

/** Text dekodieren: erst UTF-8 (streng), sonst Windows-1252, wie ihn ältere OMSI-Dateien nutzen. */
export function decode(buffer, fallback = 'windows-1252') {
  const bytes = new Uint8Array(buffer);
  // UTF-8-BOM oder UTF-16-BOM beachten
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder(fallback).decode(bytes);
  }
}

export async function readText(file, fallback) {
  return decode(await file.arrayBuffer(), fallback);
}

/** Aus <input type="file" webkitdirectory multiple> */
export function entriesFromInput(fileList) {
  return Array.from(fileList, (file) => ({ path: (file.webkitRelativePath || file.name).replace(/\\/g, '/'), file }));
}

/** Aus einem Drop-Ereignis, Ordner werden rekursiv durchlaufen. */
export async function entriesFromDrop(dataTransfer) {
  const roots = Array.from(dataTransfer.items ?? [])
    .map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null))
    .filter(Boolean);
  if (roots.length === 0) return entriesFromInput(dataTransfer.files ?? []);
  const out = [];
  for (const root of roots) await walk(root, '', out);
  return out;
}

async function walk(entry, prefix, out) {
  const path = prefix ? `${prefix}/${entry.name}` : entry.name;
  if (entry.isFile) {
    if (!isInteresting(path)) return;
    const file = await new Promise((res, rej) => entry.file(res, rej));
    out.push({ path, file });
    return;
  }
  if (!entry.isDirectory) return;
  // Ordner, die sicher nichts Relevantes enthalten, überspringen (schneller bei großen Karten)
  if (/^(texture|sceneryobjects|splines|sounds?|model|tiles?)$/i.test(entry.name)) return;
  const reader = entry.createReader();
  for (;;) {
    const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
    if (batch.length === 0) break;
    for (const child of batch) await walk(child, path, out);
  }
}

/** Nur diese Dateien werden überhaupt gelesen. */
export function isInteresting(path) {
  return /\.(hof|ttl|ttp)$/i.test(path) || /(^|\/)busstops\.cfg$/i.test(path);
}

/**
 * Sortiert die Dateien nach Karten. Eine Karte ist der Ordner, der TTData enthält.
 * Hof-Dateien direkt im Kartenordner gehören zu dieser Karte; lose Hof-Dateien
 * (z. B. einzeln ausgewählt) werden allen Karten angeboten.
 */
export function groupByMap(entries) {
  const maps = new Map();
  const looseHofs = [];
  const get = (root) => {
    if (!maps.has(root)) maps.set(root, { root, name: root.split('/').pop() || 'Karte', hofs: [], ttl: [], ttp: [], busstops: null });
    return maps.get(root);
  };

  for (const e of entries) {
    if (!isInteresting(e.path)) continue;
    const lower = e.path.toLowerCase();
    // Chrono-Szenarien haben eigene TTData-Ordner; die lassen wir vorerst aus.
    if (lower.includes('/chrono/')) continue;
    const idx = lower.lastIndexOf('/ttdata/');
    const startsInside = lower.startsWith('ttdata/');
    if (idx >= 0 || startsInside) {
      const root = startsInside ? '' : e.path.slice(0, idx);
      const m = get(root);
      if (/\.ttl$/i.test(e.path)) m.ttl.push(e);
      else if (/\.ttp$/i.test(e.path)) m.ttp.push(e);
      else if (/busstops\.cfg$/i.test(e.path)) m.busstops = e;
    } else if (/\.hof$/i.test(e.path)) {
      looseHofs.push(e);
    } else if (/\.(ttl|ttp)$/i.test(e.path) || /busstops\.cfg$/i.test(e.path)) {
      // Einzeln ausgewählte TTData-Dateien ohne Ordner
      const m = get('');
      if (/\.ttl$/i.test(e.path)) m.ttl.push(e);
      else if (/\.ttp$/i.test(e.path)) m.ttp.push(e);
      else m.busstops = e;
    }
  }

  // Hof-Dateien den Karten zuordnen: liegt die Hof direkt im Kartenordner?
  for (const h of looseHofs) {
    const dir = h.path.includes('/') ? h.path.slice(0, h.path.lastIndexOf('/')) : '';
    if (maps.has(dir)) maps.get(dir).hofs.push(h);
  }
  const result = [...maps.values()];
  const assigned = new Set(result.flatMap((m) => m.hofs));
  const rest = looseHofs.filter((h) => !assigned.has(h));
  if (result.length === 0 && rest.length) {
    // Nur Hof-Dateien: dann zeigen wir wenigstens Ziele & Routen
    return [{ root: '', name: rest[0].path.split('/').slice(-2, -1)[0] || 'Hof', hofs: rest, ttl: [], ttp: [], busstops: null }];
  }
  for (const m of result) if (m.hofs.length === 0) m.hofs = rest;
  return result;
}
