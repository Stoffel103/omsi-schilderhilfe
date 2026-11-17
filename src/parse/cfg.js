// Liest das [keyword]-Blockformat von OMSI (.hof, .ttl, .ttp, .cfg …).
//
// Regeln wie im Original (siehe openOMSI docs/FORMATS.md):
// - Ein Keyword steht allein auf seiner Zeile, ohne führende Leerzeichen.
// - Die folgenden Zeilen sind die Parameter, einer pro Zeile (auch leere Zeilen zählen).
// - Alles andere wird ignoriert.
// - .hof-Dateien sind oft Tabellen-Exporte: dort werden Tabs, Leerzeichen und "
//   am Zeilenende abgeschnitten.

export function splitLines(text) {
  return text.split(/\r\n|\n|\r/);
}

const KEYWORD = /^\[([^\]\s][^\]]*)\]$/;

export class BlockReader {
  constructor(text, { hof = false } = {}) {
    const trim = hof ? /[\t "]+$/ : /\s+$/;
    this.lines = splitLines(text).map((l) => l.replace(trim, ''));
    this.i = 0;
  }

  get done() {
    return this.i >= this.lines.length;
  }

  /** Springt zum nächsten Keyword und gibt seinen Namen in Kleinbuchstaben zurück (oder null). */
  nextKeyword() {
    while (this.i < this.lines.length) {
      const m = KEYWORD.exec(this.lines[this.i++]);
      if (m) return m[1].toLowerCase();
    }
    return null;
  }

  /** Nächste Zeile als Text ('' am Dateiende). */
  str() {
    return this.i < this.lines.length ? this.lines[this.i++] : '';
  }

  /** Nächste Zeile ansehen, ohne weiterzugehen. */
  peek() {
    return this.i < this.lines.length ? this.lines[this.i] : '';
  }

  int() {
    const n = parseInt(this.str().trim(), 10);
    return Number.isFinite(n) ? n : 0;
  }

  num() {
    return parseNum(this.str());
  }
}

export function parseNum(s) {
  const n = parseFloat(String(s).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

export function isKeywordLine(line) {
  return KEYWORD.test(line);
}
