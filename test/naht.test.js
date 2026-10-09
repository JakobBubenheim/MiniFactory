// Nähte zwischen Förderbändern (MF.fixBeltSeams): Stoßen zwei Transportflächen
// aneinander, liegt die abnehmende 1 cm tiefer – egal, wie die Bänder dorthin
// kamen (Objektfang, ohne Fangen, Zahleneingabe). Sonst bleiben dicht folgende
// Kisten an der Stirnkante des nächsten Bands hängen, vor allem, wenn es
// langsamer läuft (Fehler vom 09.10.2026, gemessen: bei 2 mm Absatz hingen 6 von 10).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { neueAnlage } = require('./helpers/anlage');

function leer() {
  return neueAnlage({ format: 'mini-fabrik', version: 3, name: 'Naht',
    settings: { dtMs: 20, gravity: -9.81, snap: { on: true, pos: 0.05, angle: 5 } },
    folders: [], bodies: [], rules: [] });
}

// Zwei Katalog-Bänder (je 2 m) hintereinander, ohne Fangen exakt bündig angelegt
// und per Zahleneingabe auf gleiche Höhe gesetzt; Quelle vor dem ersten.
function strecke(v1, v2, takt) {
  const a = leer();
  const b1 = a.anlegen('conveyor', 0, 0);
  const b2 = a.anlegen('conveyor', 4, 2);
  a.ziehen(b2, 2, 0, { ohneFangen: true });
  a.form(b2, { z: 0.6 });
  a.eigenschaft(b1, 'speed', v1);
  a.eigenschaft(b2, 'speed', v2);
  const q = a.anlegen('source', -0.7, 0);
  a.funktion(q, 'Erzeuger', { interval: takt, maxCount: 10 });
  return { a: a, b1: b1, b2: b2 };
}

// Kisten, die vor der Naht (x = 1) auf dem ersten Band stehen
function haengen(a) {
  const v = a.kistenTempo();
  return a.kisten3d().filter(function (k, i) { return k.x < 1.2 && k.z > 0.8 && Math.abs(v[i].x) < 0.15; }).length;
}

test('Bündig angelegtes Band wird zur Naht: das abnehmende liegt 1 cm tiefer, auch nach Zahleneingabe', function () {
  const s = strecke(0.5, 0.5, 1);
  assert.equal(s.a.koerper(s.b1).pose.z, 0.6);
  assert.equal(s.a.koerper(s.b2).pose.z, 0.59, 'B2 nimmt ab');
  // Höher setzen geht nicht: die Naht stellt sich wieder ein
  s.a.form(s.b2, { z: 0.61 });
  assert.equal(s.a.koerper(s.b2).pose.z, 0.59);
  // Tiefer ist erlaubt (keine Naht-Verletzung)
  s.a.form(s.b2, { z: 0.55 });
  assert.equal(s.a.koerper(s.b2).pose.z, 0.55);
});

test('Dicht folgende Kisten laufen über die Naht, auch wenn das Folgeband langsamer ist', function () {
  [[0.5, 0.25], [0.5, 0.5], [1, 0.5]].forEach(function (v) {
    const s = strecke(v[0], v[1], 0.3);
    s.a.laufen(25);
    assert.equal(haengen(s.a), 0, 'Tempo ' + v[0] + ' → ' + v[1] + ': Kisten hängen vor der Naht');
    assert.equal(s.a.signal('Q1.Erzeugt'), 10);
  });
});

test('Band hinter einem Drehtisch wird abgesenkt, eine Stufe nach oben (Hubtisch) nicht', function () {
  const a = leer();
  const dt = a.anlegen('turntable', 2.4, 2);              // Oberkante 0,69 m
  const ab = a.anlegen('conveyor', 2.4, 3.4);             // abgehend nach unten, Rückseite am Tisch
  a.form(ab, { rot: 90, z: 0.6 });
  assert.ok(a.koerper(ab).pose.z <= a.koerper(dt).pose.z + 0.1 - 0.01 - 0.1 + 1e-9,
    'abgehendes Band 1 cm unter dem Tisch: z = ' + a.koerper(ab).pose.z);

  // Oberes Band am Hubtisch liegt 30 cm höher: das ist keine Naht und bleibt
  const b = leer();
  b.anlegen('lift', 2.3, 2);
  const oben = b.anlegen('conveyor', 3.6, 2);
  b.form(oben, { z: 0.88 });
  assert.equal(b.koerper(oben).pose.z, 0.88);
});
