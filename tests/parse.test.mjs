// Tests: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decode } from '../src/io.js';
import { groupByMap } from '../src/io.js';
import { parseHof, routeOf } from '../src/parse/hof.js';
import { parseTtl, decodeMask } from '../src/parse/ttdata.js';
import { loadMap } from '../src/load.js';
import { fmtTime } from '../src/model.js';

const here = dirname(fileURLToPath(import.meta.url));
const mapDir = join(here, 'fixtures/maps/Testhausen');

function walk(dir, prefix = '') {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(join(dir, d.name), `${prefix}${d.name}/`) : [{ path: `${prefix}${d.name}`, file: join(dir, d.name) }],
  );
}
const read = async (e) => decode(readFileSync(e.file));

test('Windows-1252 wird erkannt', () => {
  const text = decode(readFileSync(join(mapDir, 'Testhausen.hof')));
  assert.match(text, /Grüner Weg/);
});

test('Hof im Listenformat', () => {
  const hof = parseHof(decode(readFileSync(join(mapDir, 'Testhausen.hof'))), 'Testhausen.hof');
  assert.equal(hof.name, 'Testhausen');
  assert.equal(hof.termini.length, 6);
  assert.equal(hof.termini[0].allExit, true);
  assert.deepEqual(hof.trips.map((t) => t.code), [101, 102, 103, 9901]);
  assert.deepEqual(hof.trips[0].stops, ['Bahnhof', 'Rathaus', 'Markt']);
  assert.equal(routeOf(hof.trips[0]), 1);
  assert.equal(routeOf(hof.trips[3]), 1);
});

test('Hof im klassischen Format', () => {
  const text = [
    '[name]', 'Klassik', '', 'stringcount_terminus', '3', '',
    '[addterminus_allexit]', '1', 'Betriebsfahrt', 'BETRIEBSFAHRT', '', 'x.tga', '........', '',
    '[addterminus]', '450', 'Adlersbruch', 'ADLERSBRUCH', 'Adlersbruch', '', '',
    '[infosystem_trip]', '45001', '450ZOB >> 450ADLERSBRUCH', '450', '450', '',
    '[infosystem_busstop_list]', '2', '450ZOB', '450Adlersbruch',
  ].join('\r\n');
  const hof = parseHof(text);
  assert.deepEqual(hof.termini.map((t) => [t.code, t.name, t.allExit]), [[1, 'Betriebsfahrt', true], [450, 'Adlersbruch', false]]);
  assert.equal(routeOf(hof.trips[0]), 1);
});

test('Tagesmaske', () => {
  const d = decodeMask(543);
  assert.deepEqual(d.days, [true, true, true, true, true, false, false]);
  assert.equal(d.schoolDays, true);
  assert.equal(d.schoolHolidays, false);
  const ttl = parseTtl('[newtour]\r\n7\r\nX\r\n\r\n', 'A.ttl');
  assert.equal(ttl.tours[0].mask, 1023);
});

test('Ganze Karte: Umlauf → Schildertabelle', async () => {
  const entries = walk(join(here, 'fixtures/maps')).map((e) => ({ ...e, path: `maps/${e.path}` }));
  const groups = groupByMap(entries);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].name, 'Testhausen');
  assert.equal(groups[0].hofs.length, 1);

  const model = await loadMap(groups[0], read);
  assert.equal(model.tours.length, 2);

  const t1 = model.tours.find((t) => t.number === '1');
  const sign = t1.rows.map((r) => [fmtTime(r.departure), r.match.line, r.match.route, r.match.ziel, r.match.confidence]);
  assert.deepEqual(sign, [
    ['04:50', '99', 1, 1, 'sicher'],
    ['05:00', '1', 1, 101, 'sicher'],
    ['05:16', '1', 2, 102, 'sicher'],
    ['05:30', '1', 3, 103, 'sicher'],
  ]);
  // Gleicher Zielname mit anderem Code (z. B. mit Linientext) wird als Alternative gezeigt
  assert.deepEqual(t1.rows[2].match.altZiele, [20102]);
  assert.equal(t1.rows[1].from, 'Bahnhof');

  const t2 = model.tours.find((t) => t.number === '2');
  assert.equal(fmtTime(t2.rows[0].departure), '23:50');
  assert.equal(fmtTime(t2.rows[2].departure), '00:20');
  assert.deepEqual(model.missing, ['Gibt es nicht']);
});
