// Hilfen für die Naht-Tests (naht*.test.js): zwei Bänder hintereinander mit Quelle,
// die Zählung hängender Kisten und die Messmatrix – nur über die Fassade.
'use strict';

const { neueAnlage } = require('./anlage');

function leer() {
  return neueAnlage({ format: 'mini-fabrik', version: 3, name: 'Naht',
    settings: { dtMs: 20, gravity: -9.81, snap: { on: true, pos: 0.05, angle: 5 } },
    folders: [], bodies: [], rules: [] });
}

// Zwei Katalog-Bänder (je 2 m, Naht bei x = 1 + spalt) hintereinander, ohne Fangen
// angelegt und per Zahleneingabe auf gleiche Höhe gesetzt; Quelle vor dem ersten.
function strecke(v1, v2, takt, spalt) {
  const a = leer();
  const b1 = a.anlegen('conveyor', 0, 0);
  const b2 = a.anlegen('conveyor', 4, 2);
  a.ziehen(b2, 2 + (spalt || 0), 0, { ohneFangen: true });
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

// Messmatrix für einen Spalt (m): 4 Tempo-Paare × Takt 0,3/1 s, je 10 Kisten.
// Gibt die Läufe zurück, in denen Kisten hängen oder nicht alle erzeugt wurden.
function messmatrix(spalt) {
  const fehler = [];
  [[0.5, 0.25], [0.5, 0.5], [1, 0.5], [0.5, 1]].forEach(function (v) {
    [0.3, 1].forEach(function (takt) {
      const s = strecke(v[0], v[1], takt, spalt);
      // fertig, sobald alle zehn Kisten über die Naht sind (sonst nach 25 s)
      s.a.laufenBis(function () {
        return s.a.signal('Q1.Erzeugt') === 10 && s.a.kisten().every(function (k) { return k.x > 1.2; });
      }, 25);
      const n = haengen(s.a);
      if (n || s.a.signal('Q1.Erzeugt') !== 10) {
        fehler.push('Tempo ' + v[0] + ' → ' + v[1] + ', Takt ' + takt + ' s: ' + n + ' hängen, ' +
          s.a.signal('Q1.Erzeugt') + ' erzeugt');
      }
    });
  });
  return fehler;
}

module.exports = { leer: leer, strecke: strecke, haengen: haengen, messmatrix: messmatrix };
