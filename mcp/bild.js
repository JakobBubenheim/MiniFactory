// Bild der Draufsicht als PNG – ohne Abhängigkeiten.
//
// Ein kleiner Rasterer (Vielecke füllen, Linien als schmale Vierecke, 5×7-Schrift)
// zeichnet die Szene aus der Sitzung (sitzung.szene()) in ein RGB-Bild. Gezeichnet
// wird doppelt so groß und dann verkleinert (Kantenglättung). PNG: Zeilen mit
// Filter 0, gepackt mit node:zlib, Prüfsummen CRC-32.
//
// Darstellung wie in der App: y zeigt nach unten, Drehung im Uhrzeigersinn.
// Körper von unten nach oben (nach Oberkante), dann Umrisse, Pfeile und IDs.
'use strict';

const zlib = require('node:zlib');

// ---------- Farben ----------

function farbe(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const n = m ? parseInt(m[1], 16) : 0x8a93a0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const F = {
  hintergrund: farbe('#F6F5F1'),
  raster: farbe('#E3E1DA'),
  rasterStark: farbe('#CFCCC2'),
  text: farbe('#1B2430'),
  stahl: farbe('#8C96A0'),
  sensor: farbe('#E8871E'),
  belegt: farbe('#D33A2C'),
  quelle: farbe('#D9701A'),
  senke: farbe('#2E3440'),
  laeuft: farbe('#F2A33A'),
  steht: farbe('#A7AEB6'),
  gefaelle: farbe('#9FD4F0'),
  achse: farbe('#8E44AD'),
  weiss: [255, 255, 255]
};

// ---------- Schrift 5 × 7 ----------

// Je Zeichen 7 Zeilen zu 5 Punkten ('#' = gesetzt)
const GLYPHEN = {
  '0': '.###. #...# #..## #.#.# ##..# #...# .###.',
  '1': '..#.. .##.. ..#.. ..#.. ..#.. ..#.. .###.',
  '2': '.###. #...# ....# ...#. ..#.. .#... #####',
  '3': '##### ...#. ..#.. ...#. ....# #...# .###.',
  '4': '...#. ..##. .#.#. #..#. ##### ...#. ...#.',
  '5': '##### #.... ####. ....# ....# #...# .###.',
  '6': '..##. .#... #.... ####. #...# #...# .###.',
  '7': '##### ....# ...#. ..#.. .#... .#... .#...',
  '8': '.###. #...# #...# .###. #...# #...# .###.',
  '9': '.###. #...# #...# .#### ....# ...#. .##..',
  'A': '.###. #...# #...# ##### #...# #...# #...#',
  'B': '####. #...# #...# ####. #...# #...# ####.',
  'C': '.###. #...# #.... #.... #.... #...# .###.',
  'D': '###.. #..#. #...# #...# #...# #..#. ###..',
  'E': '##### #.... #.... ####. #.... #.... #####',
  'F': '##### #.... #.... ####. #.... #.... #....',
  'G': '.###. #...# #.... #.### #...# #...# .####',
  'H': '#...# #...# #...# ##### #...# #...# #...#',
  'I': '.###. ..#.. ..#.. ..#.. ..#.. ..#.. .###.',
  'J': '..### ...#. ...#. ...#. ...#. #..#. .##..',
  'K': '#...# #..#. #.#.. ##... #.#.. #..#. #...#',
  'L': '#.... #.... #.... #.... #.... #.... #####',
  'M': '#...# ##.## #.#.# #.#.# #...# #...# #...#',
  'N': '#...# #...# ##..# #.#.# #..## #...# #...#',
  'O': '.###. #...# #...# #...# #...# #...# .###.',
  'P': '####. #...# #...# ####. #.... #.... #....',
  'Q': '.###. #...# #...# #...# #.#.# #..#. .##.#',
  'R': '####. #...# #...# ####. #.#.. #..#. #...#',
  'S': '.#### #.... #.... .###. ....# ....# ####.',
  'T': '##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..',
  'U': '#...# #...# #...# #...# #...# #...# .###.',
  'V': '#...# #...# #...# #...# #...# .#.#. ..#..',
  'W': '#...# #...# #...# #.#.# #.#.# #.#.# .#.#.',
  'X': '#...# #...# .#.#. ..#.. .#.#. #...# #...#',
  'Y': '#...# #...# .#.#. ..#.. ..#.. ..#.. ..#..',
  'Z': '##### ....# ...#. ..#.. .#... #.... #####',
  'm': '..... ..... ##.#. #.#.# #.#.# #...# #...#',
  '.': '..... ..... ..... ..... ..... .##.. .##..',
  ',': '..... ..... ..... ..... .##.. ..#.. .#...',
  '-': '..... ..... ..... ##### ..... ..... .....',
  '+': '..... ..#.. ..#.. ##### ..#.. ..#.. .....',
  '(': '...#. ..#.. .#... .#... .#... ..#.. ...#.',
  ')': '.#... ..#.. ...#. ...#. ...#. ..#.. .#...',
  '/': '..... ....# ...#. ..#.. .#... #.... .....',
  ':': '..... .##.. .##.. ..... .##.. .##.. .....',
  '=': '..... ..... ##### ..... ##### ..... .....',
  '?': '.###. #...# ....# ...#. ..#.. ..... ..#..',
  '_': '..... ..... ..... ..... ..... ..... #####',
  '°': '.##.. #..#. .##.. ..... ..... ..... .....',
  ' ': '..... ..... ..... ..... ..... ..... .....',
  '×': '..... #...# .#.#. ..#.. .#.#. #...# .....'
};
Object.keys(GLYPHEN).forEach(function (k) { GLYPHEN[k] = GLYPHEN[k].replace(/ /g, ''); });
const ERSATZ = { 'Ä': 'A', 'Ö': 'O', 'Ü': 'U', 'ä': 'A', 'ö': 'O', 'ü': 'U', 'ß': 'S' };

function glyphe(ch) {
  if (GLYPHEN[ch]) return GLYPHEN[ch];
  if (ERSATZ[ch]) return GLYPHEN[ERSATZ[ch]];
  const gross = ch.toUpperCase();
  return GLYPHEN[gross] || GLYPHEN['?'];
}

// ---------- Rasterbild ----------

class Raster {
  constructor(w, h, hg) {
    this.w = w; this.h = h;
    this.px = new Uint8Array(w * h * 3);
    for (let i = 0; i < w * h; i++) { this.px[i * 3] = hg[0]; this.px[i * 3 + 1] = hg[1]; this.px[i * 3 + 2] = hg[2]; }
  }

  punkt(x, y, c, a) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3, p = this.px;
    if (a >= 1) { p[i] = c[0]; p[i + 1] = c[1]; p[i + 2] = c[2]; return; }
    p[i] = p[i] + (c[0] - p[i]) * a;
    p[i + 1] = p[i + 1] + (c[1] - p[i + 1]) * a;
    p[i + 2] = p[i + 2] + (c[2] - p[i + 2]) * a;
  }

  // Vieleck füllen (gerade/ungerade, Pixelmitten), pts = [[x, y], …] in Pixeln
  vieleck(pts, c, a) {
    if (pts.length < 3) return;
    if (a === undefined) a = 1;
    let y0 = Infinity, y1 = -Infinity;
    pts.forEach(function (p) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); });
    y0 = Math.max(0, Math.floor(y0)); y1 = Math.min(this.h - 1, Math.ceil(y1));
    const xs = [];
    for (let y = y0; y <= y1; y++) {
      const yc = y + 0.5;
      xs.length = 0;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const a0 = pts[j], b0 = pts[i];
        if ((a0[1] > yc) !== (b0[1] > yc)) xs.push(a0[0] + (yc - a0[1]) * (b0[0] - a0[0]) / (b0[1] - a0[1]));
      }
      xs.sort(function (p, q) { return p - q; });
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, Math.ceil(xs[k] - 0.5)), xb = Math.min(this.w - 1, Math.floor(xs[k + 1] - 0.5));
        for (let x = xa; x <= xb; x++) this.punkt(x, y, c, a);
      }
    }
  }

  // Linie mit Breite b (Pixel) als Viereck
  linie(x0, y0, x1, y1, b, c, a) {
    const dx = x1 - x0, dy = y1 - y0, l = Math.sqrt(dx * dx + dy * dy);
    if (l < 1e-9) return;
    const nx = -dy / l * b / 2, ny = dx / l * b / 2;
    const ex = dx / l * b / 2, ey = dy / l * b / 2;   // Enden etwas verlängern: Ecken schließen
    this.vieleck([[x0 + nx - ex, y0 + ny - ey], [x1 + nx + ex, y1 + ny + ey], [x1 - nx + ex, y1 - ny + ey], [x0 - nx - ex, y0 - ny - ey]], c, a);
  }

  umriss(pts, b, c, a) {
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) this.linie(pts[j][0], pts[j][1], pts[i][0], pts[i][1], b, c, a);
  }

  // Pfeil von (x0, y0) nach (x1, y1), Spitze mit Länge s
  pfeil(x0, y0, x1, y1, b, s, c) {
    const dx = x1 - x0, dy = y1 - y0, l = Math.sqrt(dx * dx + dy * dy);
    if (l < 1e-9) return;
    const ux = dx / l, uy = dy / l;
    s = Math.min(s, l * 0.6);
    this.linie(x0, y0, x1 - ux * s * 0.8, y1 - uy * s * 0.8, b, c, 1);
    this.vieleck([[x1, y1], [x1 - ux * s - uy * s * 0.55, y1 - uy * s + ux * s * 0.55], [x1 - ux * s + uy * s * 0.55, y1 - uy * s - ux * s * 0.55]], c, 1);
  }

  // Text, Schriftpixel g Pixel groß; Rückgabe: Breite
  text(x, y, str, g, c) {
    const self = this;
    Array.from(str).forEach(function (ch, n) {
      const gl = glyphe(ch), ox = x + n * 6 * g;
      for (let row = 0; row < 7; row++) {
        for (let col = 0; col < 5; col++) {
          if (gl[row * 5 + col] !== '#') continue;
          for (let yy = 0; yy < g; yy++) for (let xx = 0; xx < g; xx++) self.punkt(Math.round(ox + col * g + xx), Math.round(y + row * g + yy), c, 1);
        }
      }
    });
    return textBreite(str, g);
  }

  // Auf 1/f verkleinern (Mittelwert je f × f Block)
  verkleinert(f) {
    const w = Math.floor(this.w / f), h = Math.floor(this.h / f);
    const out = new Raster(w, h, [0, 0, 0]);
    const n = f * f;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sr = 0, sg = 0, sb = 0;
        for (let yy = 0; yy < f; yy++) {
          for (let xx = 0; xx < f; xx++) {
            const i = ((y * f + yy) * this.w + x * f + xx) * 3;
            sr += this.px[i]; sg += this.px[i + 1]; sb += this.px[i + 2];
          }
        }
        const o = (y * w + x) * 3;
        out.px[o] = Math.round(sr / n); out.px[o + 1] = Math.round(sg / n); out.px[o + 2] = Math.round(sb / n);
      }
    }
    return out;
  }

  png() { return png(this.w, this.h, this.px); }
}

function textBreite(str, g) { return Array.from(str).length * 6 * g - g; }

// ---------- PNG ----------

const CRC_TAFEL = (function () {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TAFEL[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function block(typ, daten) {
  const laenge = Buffer.alloc(4);
  laenge.writeUInt32BE(daten.length);
  const td = Buffer.concat([Buffer.from(typ, 'ascii'), daten]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([laenge, td, crc]);
}

function png(w, h, rgb) {
  const kopf = Buffer.alloc(13);
  kopf.writeUInt32BE(w, 0);
  kopf.writeUInt32BE(h, 4);
  kopf[8] = 8; kopf[9] = 2; kopf[10] = 0; kopf[11] = 0; kopf[12] = 0;   // 8 Bit, RGB
  const roh = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    roh[y * (w * 3 + 1)] = 0;   // Filter "keiner"
    Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(roh, y * (w * 3 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    block('IHDR', kopf),
    block('IDAT', zlib.deflateSync(roh, { level: 9 })),
    block('IEND', Buffer.alloc(0))
  ]);
}

// ---------- Draufsicht ----------

const RASTERSCHRITTE = [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 50];

function zahl(v) {
  const t = Math.round(v * 100) / 100;
  return String(t).replace('.', ',');
}

/**
 * Draufsicht zeichnen.
 * @param {object} szene aus sitzung.szene()
 * @param {object} [opt] { width (px, Standard 1000), maxHeight (px, 800), boxes (true), labels ('id'|'name'|'none'),
 *   region { x0, y0, x1, y1 } in m (sonst alles) }
 * @returns {{ png: Buffer, width, height, pxPerM, region, text }}
 */
function draufsicht(szene, opt) {
  opt = opt || {};
  const breite = Math.max(200, Math.min(2000, opt.width || 1000));
  const maxHoehe = Math.max(150, Math.min(2000, opt.maxHeight || 800));
  const mitKisten = opt.boxes !== false;
  const beschriftung = opt.labels || 'id';
  const koerper = szene.bodies.filter(function (b) { return b.visible; });
  // Produkte (Vorlage der Teile) liegen in ihrer Quelle: gezeichnet, aber ohne eigenes Schild
  const beschriftet = function (b) { return !b.product; };

  // Ausschnitt in Metern
  let reg = opt.region;
  if (!reg) {
    reg = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    koerper.forEach(function (b) {
      b.outline.forEach(function (p) {
        reg.x0 = Math.min(reg.x0, p[0]); reg.y0 = Math.min(reg.y0, p[1]);
        reg.x1 = Math.max(reg.x1, p[0]); reg.y1 = Math.max(reg.y1, p[1]);
      });
    });
    if (mitKisten) szene.boxes.forEach(function (k) {
      const s = Math.max(k.w, k.d) * 0.75;
      reg.x0 = Math.min(reg.x0, k.x - s); reg.y0 = Math.min(reg.y0, k.y - s);
      reg.x1 = Math.max(reg.x1, k.x + s); reg.y1 = Math.max(reg.y1, k.y + s);
    });
    if (!isFinite(reg.x0)) reg = { x0: 0, y0: 0, x1: 5, y1: 3 };
    const rand = 0.4;
    reg = { x0: reg.x0 - rand, y0: reg.y0 - rand, x1: reg.x1 + rand, y1: reg.y1 + rand };
    // Nicht zu schmal: mindestens 2 m in jeder Richtung
    ['x', 'y'].forEach(function (a) {
      const d = reg[a + '1'] - reg[a + '0'];
      if (d < 2) { reg[a + '0'] -= (2 - d) / 2; reg[a + '1'] += (2 - d) / 2; }
    });
  }
  const links = 44, oben = 26, rechts = 14, unten = 34;
  const bw = reg.x1 - reg.x0, bh = reg.y1 - reg.y0;
  let ppm = Math.min((breite - links - rechts) / bw, (maxHoehe - oben - unten) / bh);
  ppm = Math.max(4, Math.min(400, ppm));
  const W = Math.round(bw * ppm + links + rechts), H = Math.round(bh * ppm + oben + unten);

  const SS = 2;   // Überabtastung
  const ras = new Raster(W * SS, H * SS, F.hintergrund);
  const s = ppm * SS;
  function px(x, y) { return [(links + (x - reg.x0) * ppm) * SS, (oben + (y - reg.y0) * ppm) * SS]; }
  function pts(outline) { return outline.map(function (p) { return px(p[0], p[1]); }); }

  // Raster: Schritt so, dass Linien mindestens ~45 px auseinander liegen
  const schritt = RASTERSCHRITTE.find(function (v) { return v * ppm >= 45; }) || 100;
  const xa = Math.ceil(reg.x0 / schritt) * schritt, ya = Math.ceil(reg.y0 / schritt) * schritt;
  const p0 = px(reg.x0, reg.y0), p1 = px(reg.x1, reg.y1);
  for (let x = xa; x <= reg.x1 + 1e-9; x += schritt) {
    const q = px(x, 0)[0], stark = Math.abs(x / (schritt * 5) - Math.round(x / (schritt * 5))) < 1e-6 || Math.abs(x) < 1e-9;
    ras.linie(q, p0[1], q, p1[1], SS, stark ? F.rasterStark : F.raster, 1);
    const t = zahl(x);
    ras.text(q - textBreite(t, SS * 1.5) / 2, 7 * SS, t, SS * 1.5, F.text);
  }
  for (let y = ya; y <= reg.y1 + 1e-9; y += schritt) {
    const q = px(0, y)[1], stark = Math.abs(y / (schritt * 5) - Math.round(y / (schritt * 5))) < 1e-6 || Math.abs(y) < 1e-9;
    ras.linie(p0[0], q, p1[0], q, SS, stark ? F.rasterStark : F.raster, 1);
    const t = zahl(y);
    ras.text(links * SS - 6 * SS - textBreite(t, SS * 1.5), q - 5 * SS, t, SS * 1.5, F.text);
  }
  ras.umriss([[p0[0], p0[1]], [p1[0], p0[1]], [p1[0], p1[1]], [p0[0], p1[1]]], SS, F.rasterStark, 1);

  // Körper von unten nach oben: niedrige Oberkante zuerst, immaterielle zuletzt
  const reihe = koerper.slice().sort(function (a, b) {
    const ga = a.product ? 2 : a.kind === 'ghost' ? 1 : 0, gb = b.product ? 2 : b.kind === 'ghost' ? 1 : 0;
    return ga - gb || a.top - b.top;
  });
  function fuellung(b) {
    if (b.product) return { c: farbe(b.color), a: 0.45 };
    if (b.sensor) return { c: b.sensor.occupied ? F.belegt : F.sensor, a: 0.45 };
    if (b.sink) return { c: F.senke, a: 0.22 };
    if (b.spawner) return { c: F.quelle, a: 0.28 };
    if (b.kind === 'ghost') return { c: farbe(b.color), a: 0.2 };
    if (b.kind === 'kinematic') return { c: F.stahl, a: 1 };
    return { c: farbe(b.color), a: 1 };
  }
  function kante(b) {
    if (b.sensor) return b.sensor.occupied ? F.belegt : F.sensor;
    if (b.spawner) return F.quelle;
    if (b.sink) return F.senke;
    return farbe(b.color);
  }
  // Senken zuerst ganz unten (liegen meist unter dem Bandende)
  reihe.filter(function (b) { return b.sink; }).concat(reihe.filter(function (b) { return !b.sink; })).forEach(function (b) {
    const f = fuellung(b);
    ras.vieleck(pts(b.outline), f.c, f.a);
  });
  reihe.forEach(function (b) {
    const p = pts(b.outline);
    ras.umriss(p, (b.kind === 'ghost' || b.product ? 1.5 : 2) * SS, b.product ? F.text : kante(b), b.kind === 'ghost' || b.product ? 0.7 : 1);
    if (b.sink) {
      // Kreuz wie in der App
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      p.forEach(function (q) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); });
      const m = Math.min(x1 - x0, y1 - y0) * 0.2;
      ras.linie(x0 + m, y0 + m, x1 - m, y1 - m, 1.5 * SS, F.senke, 0.6);
      ras.linie(x1 - m, y0 + m, x0 + m, y1 - m, 1.5 * SS, F.senke, 0.6);
    }
  });

  // Ausdehnung des Grundrisses entlang einer Richtung (Grad) durch die Mitte
  function ausdehnung(b, deg) {
    const a = deg * Math.PI / 180, ux = Math.cos(a), uy = Math.sin(a);
    let lo = Infinity, hi = -Infinity;
    b.outline.forEach(function (p) {
      const t = (p[0] - b.center[0]) * ux + (p[1] - b.center[1]) * uy;
      lo = Math.min(lo, t); hi = Math.max(hi, t);
    });
    return { ux: ux, uy: uy, lo: lo, hi: hi };
  }
  function mitte(b) {
    let x = 0, y = 0;
    b.outline.forEach(function (p) { x += p[0]; y += p[1]; });
    return [x / b.outline.length, y / b.outline.length];
  }

  // Laufrichtung, Gefälle, Achse
  reihe.forEach(function (b) {
    const m = mitte(b);
    if (b.surface) {
      const e = ausdehnung({ outline: b.outline, center: m }, b.surface.dir);
      const l = Math.max(0.15, (e.hi - e.lo) * 0.7);
      const a = px(m[0] - e.ux * l / 2, m[1] - e.uy * l / 2), z = px(m[0] + e.ux * l / 2, m[1] + e.uy * l / 2);
      ras.pfeil(a[0], a[1], z[0], z[1], Math.max(2 * SS, 0.03 * s), Math.max(9 * SS, 0.14 * s), b.surface.on ? F.laeuft : F.steht);
    }
    if (b.downhill !== undefined) {
      const e = ausdehnung({ outline: b.outline, center: m }, b.downhill);
      const l = Math.max(0.15, (e.hi - e.lo) * 0.6);
      const a = px(m[0] - e.ux * l / 2, m[1] - e.uy * l / 2), z = px(m[0] + e.ux * l / 2, m[1] + e.uy * l / 2);
      // hell mit dunklem Rand: sichtbar auf jeder Körperfarbe
      const bb = Math.max(2 * SS, 0.025 * s), sp = Math.max(9 * SS, 0.12 * s);
      ras.pfeil(a[0], a[1], z[0], z[1], bb + 2 * SS, sp + 3 * SS, F.text);
      ras.pfeil(a[0], a[1], z[0], z[1], bb, sp, F.gefaelle);
    }
    if (b.axis && b.axis.dir !== undefined) {
      const a0 = b.axis.dir * Math.PI / 180, l = Math.max(0.2, b.axis.max - b.axis.min);
      const a = px(m[0], m[1]), z = px(m[0] + Math.cos(a0) * l, m[1] + Math.sin(a0) * l);
      ras.pfeil(a[0], a[1], z[0], z[1], 1.5 * SS, 8 * SS, F.achse);
    }
  });

  // Teile im Grundriss ihres Produkts
  if (mitKisten) {
    szene.boxes.forEach(function (k) {
      const a = k.rot * Math.PI / 180, c = Math.cos(a), si = Math.sin(a);
      const ecken = k.outline ? pts(k.outline) : [[-k.w / 2, -k.d / 2], [k.w / 2, -k.d / 2], [k.w / 2, k.d / 2], [-k.w / 2, k.d / 2]].map(function (p) {
        return px(k.x + p[0] * c - p[1] * si, k.y + p[0] * si + p[1] * c);
      });
      const fc = farbe(k.color);
      ras.vieleck(ecken, fc, 1);
      ras.umriss(ecken, 1.2 * SS, [fc[0] * 0.55, fc[1] * 0.55, fc[2] * 0.55], 1);
    });
  }

  // Beschriftung: ID (oder Name) in der Mitte, Kästchen weichen einander aus
  if (beschriftung !== 'none') {
    const belegt = [];
    const g = SS * 1.5;
    reihe.slice().reverse().filter(beschriftet).forEach(function (b) {
      const t = beschriftung === 'name' ? b.name : b.id;
      const m = px.apply(null, mitte(b));
      const tw = textBreite(t, g), th = 7 * g, pad = 2 * SS;
      let x = m[0] - tw / 2, y = m[1] - th / 2;
      for (let n = 0; n < 6; n++) {
        const kollision = belegt.some(function (q) {
          return x - pad < q[2] && x + tw + pad > q[0] && y - pad < q[3] && y + th + pad > q[1];
        });
        if (!kollision) break;
        y += (n % 2 ? -1 : 1) * (n + 1) * (th + 2 * pad);
      }
      belegt.push([x - pad, y - pad, x + tw + pad, y + th + pad]);
      ras.vieleck([[x - pad, y - pad], [x + tw + pad, y - pad], [x + tw + pad, y + th + pad], [x - pad, y + th + pad]], F.weiss, 0.85);
      ras.text(x, y, t, g, F.text);
    });
  }

  // Maßstab unten links: 1 m (bzw. Rasterschritt)
  const ml = schritt;
  const mb = px(reg.x0, reg.y1);
  const yb = mb[1] + 14 * SS;
  ras.linie(mb[0], yb, mb[0] + ml * s, yb, 2 * SS, F.text, 1);
  ras.linie(mb[0], yb - 4 * SS, mb[0], yb + 4 * SS, 2 * SS, F.text, 1);
  ras.linie(mb[0] + ml * s, yb - 4 * SS, mb[0] + ml * s, yb + 4 * SS, 2 * SS, F.text, 1);
  ras.text(mb[0] + ml * s + 6 * SS, yb - 5 * SS, zahl(ml) + ' m', SS * 1.5, F.text);

  const bild = ras.verkleinert(SS);
  const r2 = function (v) { return Math.round(v * 100) / 100; };
  const region = { x0: r2(reg.x0), y0: r2(reg.y0), x1: r2(reg.x1), y1: r2(reg.y1) };
  const text = 'Draufsicht "' + szene.name + '": ' + bild.w + ' × ' + bild.h + ' px, ' + r2(ppm) + ' px je m, ' +
    'Ausschnitt x ' + region.x0 + ' … ' + region.x1 + ' m, y ' + region.y0 + ' … ' + region.y1 + ' m (y nach unten), Raster ' + schritt + ' m. ' +
    koerper.length + ' Körper' + (mitKisten ? ', ' + szene.boxes.length + ' Teile' : '') + ' (Simulationszeit ' + szene.sim.time + ' s). ' +
    'Legende: dunkel/farbig gefüllt = fest (static), grau = kinematisch, halbtransparent = immateriell (ghost); ' +
    'orange Streifen = Sensor (rot = belegt), orange Fläche = Erzeuger, dunkel mit Kreuz = Senke; ' +
    'halbtransparent mit dunklem Rand in einer Quelle = Produkt (Vorlage der Teile); ' +
    'oranger Pfeil = Laufrichtung (grau = steht), hellblauer Pfeil = bergab, violetter Pfeil = Achse; ' +
    'kräftig gefüllte Formen mit dunklem Rand = Teile (Grundriss ihres Produkts, Kisten braun).';
  return { png: bild.png(), width: bild.w, height: bild.h, pxPerM: r2(ppm), region: region, text: text };
}

module.exports = { draufsicht: draufsicht, png: png, Raster: Raster, crc32: crc32 };
