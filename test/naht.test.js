// Nähte zwischen Förderbändern (Messmatrix: naht-matrix*.test.js): Alle Bänder liegen bündig (Oberkante 0,7 m), keine
// Absenkung. Über die Naht hilft die Umlenkrolle – die Stirnenden einer Transportfläche
// sind in der Physik gerundet (Konzept, Abschnitt 4). Vorher blieben bei bündigen
// Bändern bis zu 6 von 10 Kisten an der Stirnkante des nächsten Bands hängen
// (gemessen 09.10.2026, Spike-3D-Ergebnis 4a).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { neueAnlage } = require('./helpers/anlage');
const { leer, strecke, haengen } = require('./helpers/naht');

test('Bänder bleiben bündig: keine Absenkung nach Einfügen, Ziehen, Zahleneingabe und Objektfang', function () {
  const s = strecke(0.5, 0.5, 1);
  assert.equal(s.a.koerper(s.b1).pose.z, 0.6);
  assert.equal(s.a.koerper(s.b2).pose.z, 0.6, 'B2 nimmt ab und bleibt bündig');
  // Zahleneingabe gilt so, wie sie ist – auch höher oder tiefer
  s.a.form(s.b2, { z: 0.61 });
  assert.equal(s.a.koerper(s.b2).pose.z, 0.61);
  s.a.form(s.b2, { z: 0.55 });
  assert.equal(s.a.koerper(s.b2).pose.z, 0.55);
  // Objektfang an das Bandende legt es wieder bündig
  s.a.ziehen(s.b2, 2.03, 0.02);
  assert.equal(s.a.koerper(s.b2).pose.z, 0.6);

  // Drehtisch und Hubtisch aus dem Katalog liegen bündig mit den Bändern
  const dt = s.a.anlegen('turntable', 6, 0), ht = s.a.anlegen('lift', 8, 0);
  assert.equal(s.a.lage(dt).z + 0.1, 0.7);
  assert.equal(s.a.lage(ht).z + 0.1, 0.7);
});

// Takt so, dass das abnehmende Band die Kisten wegschafft (0,3 m Kiste / Tempo); bei
// Überlast schiebt der Zug Kisten über die Kanten – mit dem alten 1-cm-Absatz genauso.
// Gegen Schwung über die Außenkante hilft die Führungswand (mcp/anleitung.md).
test('90°-Ecke bündig: das Band endet in der Mitte des abnehmenden, keine Kiste hängt', function () {
  [[0.5, 0.5, 1], [0.5, 0.25, 1.5], [1, 0.5, 0.8]].forEach(function (f) {
    const a = leer();
    const b1 = a.anlegen('conveyor', 0, 0);
    a.form(b1, { x: 1.25, y: 2 });                          // nach rechts bis x = 2,25
    const b2 = a.anlegen('conveyor', 4, 4);
    a.form(b2, { x: 2.25, y: 2.75, rot: 90 });              // nach unten, y 1,75 … 3,75
    a.eigenschaft(b1, 'speed', f[0]);
    a.eigenschaft(b2, 'speed', f[1]);
    assert.equal(a.koerper(b2).pose.z, 0.6, 'bündig');
    const wand = a.formAnlegen('rect', { w: 0.1, d: 2, h: 1 }, { x: 2.55, y: 2.75 });   // glatte Führungswand außen
    a.koerperart(wand, 'static');
    a.material(wand, { friction: 0.05 });
    const q = a.anlegen('source', 0.5, 2);
    a.funktion(q, 'Erzeuger', { interval: f[2], maxCount: 6 });
    const se = a.anlegen('sink', 2.25, 4.05);
    const t = a.laufenBis(function () { return a.signal(se + '.Anzahl') === 6; }, 25);
    assert.notEqual(t, null, 'Tempo ' + f[0] + ' → ' + f[1] + ': nur ' + a.signal(se + '.Anzahl') + ' von 6 in der Senke, ' +
      a.kisten().map(function (k) { return k.x.toFixed(2) + '|' + k.y.toFixed(2); }).join(' '));
  });
});

test('Alte Datei mit Absatz an der Naht lädt unverändert, Kisten laufen weiter darüber', function () {
  const s = strecke(0.5, 0.25, 0.3);
  s.a.form(s.b2, { z: 0.59 });                            // 1 cm Absatz wie bis 09.10.2026
  const b = neueAnlage(s.a.datei());
  assert.equal(b.koerper(s.b2).pose.z, 0.59, 'Absatz bleibt');
  b.laufen(15);
  assert.equal(haengen(b), 0);
  assert.equal(b.signal('Q1.Erzeugt'), 10);
});
