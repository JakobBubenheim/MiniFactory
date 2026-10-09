// Gradgenau drehen (feature/drehung): Richtung der Vorlagen in Grad, Feld "Drehung"
// 0,1° genau, Werkzeug Drehen mit Ziehen – und schräge Winkel in der Physik.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { neueAnlage } = require('./helpers/anlage');
const { leer } = require('./helpers/naht');

function nahe(ist, soll, tol, text) {
  assert.ok(Math.abs(ist - soll) <= tol, (text || '') + ': ' + ist + ' statt ' + soll);
}

// Punkt in einem gedrehten Koordinatensystem: Mitte c, Winkel grad, u entlang, v quer (nach rechts der Laufrichtung)
function punkt(c, grad, u, v) {
  const a = grad * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a);
  return { x: c.x + u * cs - v * sn, y: c.y + u * sn + v * cs };
}

test('Richtung in Grad setzen und lesen, alte Namen gelten weiter', function () {
  const a = neueAnlage();
  assert.equal(a.richtung('B1'), 0);
  a.richtung('B1', 37.5);
  assert.equal(a.form('B1').rot, 37.5, 'das Band dreht sich mit');
  assert.equal(a.richtung('B1'), 37.5);
  assert.equal(a.eigenschaft('B1', 'direction'), '', 'schräg: keiner der vier Namen');
  a.richtung('B1', 12.345);
  assert.equal(a.richtung('B1'), 12.3, '0,1° genau');
  a.richtung('B1', -30);
  assert.equal(a.richtung('B1'), 330);
  a.richtung('B1', '22,5');
  assert.equal(a.richtung('B1'), 22.5, 'Text mit Komma wie im Panel');
  a.richtung('B1', 'quer');
  assert.equal(a.richtung('B1'), 22.5, 'Unbekanntes ändert nichts');

  // Alte Namen: über richtung() und eigenschaft()
  a.richtung('B1', 'unten');
  assert.equal(a.richtung('B1'), 90);
  a.eigenschaft('B1', 'direction', 'links');
  assert.equal(a.richtung('B1'), 180);
  assert.equal(a.eigenschaft('B1', 'direction'), 'links');
  a.eigenschaft('B1', 'direction', 210.25);
  assert.equal(a.form('B1').rot, 210.3);

  // Schieber: Schubrichtung lokal +y (90°), der Körper dreht so, dass sie in die Welt zeigt
  assert.equal(a.richtung('S1'), 90);
  a.richtung('S1', 120);
  assert.equal(a.form('S1').rot, 30);
  assert.equal(a.richtung('S1'), 120);

  // Speichern und Laden: die Drehung steckt in pose.rot
  const b = neueAnlage(a.datei());
  assert.equal(b.richtung('B1'), 210.3);
  assert.equal(b.richtung('S1'), 120);
  assert.equal(b.form('S1').rot, 30);
});

test('Feld "Drehung": Eingabe 0,1° genau auch ohne Fangen, − / + auf den Fangwinkel', function () {
  const a = neueAnlage();
  a.fangenEinstellen({ on: false });
  a.drehung('B1', 37.46);
  assert.equal(a.drehung('B1'), 37.5);
  a.drehung('B1', 12.34);
  assert.equal(a.drehung('B1'), 12.3, 'ohne Fangen nicht auf ganze Grad');
  assert.equal(a.drehungSchritt('B1', 1), 13, 'ohne Fangen gehen − / + ganze Grad');

  a.fangenEinstellen({ on: true, angle: 5 });
  a.drehung('B1', 37.3);
  assert.equal(a.drehung('B1'), 37.3, 'Eingabe fängt nicht');
  assert.equal(a.drehungSchritt('B1', 1), 40, 'erst auf die nächste Rasterlinie');
  assert.equal(a.drehungSchritt('B1', 1), 45);
  assert.equal(a.drehungSchritt('B1', -1), 40);
  assert.equal(a.drehungSchritt('B1', 10), 90, 'Shift: zehn Schritte');
  a.drehung('B1', 37.3);
  assert.equal(a.drehungSchritt('B1', -1), 35);
  assert.equal(a.drehungSchritt('B1', -10), 345, 'über 0° hinweg');
  a.fangenEinstellen({ angle: 15 });
  assert.equal(a.drehungSchritt('B1', 1), 0, '345° + 15° = 0°');
  assert.equal(a.richtung('B1'), 0, 'Richtung zieht mit');

  // Jede Eingabe ist ein Schritt im Verlauf
  a.drehung('B1', 10);
  a.drehung('B1', 20.5);
  a.rueckgaengig();
  assert.equal(a.drehung('B1'), 10);
});

test('Werkzeug Drehen: Ziehen dreht um die Lage mit Winkel-Fangen, Alt 0,1°, ein Schritt im Verlauf', function () {
  const a = neueAnlage();
  const c = { x: a.form('B1').x, y: a.form('B1').y };
  const von = punkt(c, 0, 1, 0);                            // rechts neben der Mitte angefasst
  // über mehrere Zwischenstände bis 32° gezogen: Fangwinkel 5° -> 30°
  const rot = a.drehenZiehen('B1', von, [punkt(c, 4, 1, 0), punkt(c, 17, 1.2, 0), punkt(c, 32, 0.8, 0)]);
  assert.equal(rot, 30);
  assert.equal(a.richtung('B1'), 30);
  a.rueckgaengig();
  assert.equal(a.form('B1').rot, 0, 'ein Rückgängig nimmt die ganze Geste zurück');
  a.wiederholen();
  assert.equal(a.form('B1').rot, 30);

  // Alt: 0,1° genau, relativ zur Drehung beim Anfassen
  assert.equal(a.drehenZiehen('B1', punkt(c, 30, 1, 0), [punkt(c, 30 + 7.46, 1, 0)], { ohneFangen: true }), 37.5);
  // Fangwinkel 15°, linksherum über 0° hinweg
  a.fangenEinstellen({ angle: 15 });
  assert.equal(a.drehenZiehen('B1', punkt(c, 0, 1, 0), [punkt(c, -20, 1, 0), punkt(c, -50, 1, 0)]), 345);
  // Griff und Werkzeug rechnen gleich: Griff über der Oberkante (−y) = Anfassen bei rot − 90°
  assert.equal(a.drehenZiehen('B1', punkt(c, 345 - 90, 0.5, 0), [punkt(c, 61, 0.5, 0)]), 150);
});

// Beispielanlage (Band, Lichtschranke, Schieber, zwei Senken, Regel R1) als Ganzes um
// grad um (0, 0) gedreht – Lage und Drehung jedes Körpers, wie im Panel eingegeben.
function gedrehtesBeispiel(grad) {
  const a = neueAnlage();
  a.elemente().forEach(function (id) {
    const f = a.form(id), p = punkt({ x: 0, y: 0 }, grad, f.x, f.y);
    a.form(id, { x: Math.round(p.x * 1e6) / 1e6, y: Math.round(p.y * 1e6) / 1e6 });
    a.drehung(id, f.rot + grad);
  });
  return a;
}

test('Schräg gedrehte Beispielanlage (30°, 37,5°): Lichtschranke, Schieber und Senken wie gerade', function () {
  const gerade = neueAnlage();
  gerade.laufen(16);
  const soll = { se1: gerade.signal('SE1.Anzahl'), se2: gerade.signal('SE2.Anzahl') };
  assert.ok(soll.se2 >= 4, 'gerade: ' + JSON.stringify(soll));
  [30, 37.5].forEach(function (grad) {
    const a = gedrehtesBeispiel(grad);
    assert.equal(a.richtung('B1'), grad);
    assert.equal(a.richtung('S1'), grad + 90, 'Schieber schiebt quer zum Band');
    a.laufen(16);
    assert.deepEqual({ se1: a.signal('SE1.Anzahl'), se2: a.signal('SE2.Anzahl') }, soll, grad + '°');
  });
});

test('Schräges Band (30°) fördert mit Bandtempo in Laufrichtung', function () {
  const a = leer();
  const b = a.anlegen('conveyor', 0, 0);
  a.form(b, { w: 4 });
  a.richtung(b, 30);
  const start = punkt({ x: 0, y: 0 }, 30, -1.6, 0);
  const q = a.anlegen('source', 5, 5);
  a.form(q, { x: start.x, y: start.y });
  a.funktion(q, 'Erzeuger', { interval: 10, maxCount: 1 });
  a.laufen(2.5);                                          // Kiste liegt auf und hat Tempo aufgenommen
  const k = a.kisten()[0], v = a.kistenTempo()[0];
  const u = { x: Math.cos(Math.PI / 6), y: Math.sin(Math.PI / 6) };
  const laengs = v.x * u.x + v.y * u.y, quer = -v.x * u.y + v.y * u.x;
  nahe(laengs, 0.5, 0.025, 'Tempo in Laufrichtung');
  nahe(quer, 0, 0.025, 'Tempo quer');
  // Kiste bleibt auf der Bandachse
  nahe(-k.x * u.y + k.y * u.x, 0, 0.03, 'Abstand zur Bandachse');
});

// Strecke: Quelle am Anfang von B1, B2 hängt per Objektfang am Ende von B1, Senke hinter B2.
// Gibt die Anlage zurück und den Text des Objektfangs.
function strecke(grad1, grad2, rohB2) {
  const a = leer();
  const b1 = a.anlegen('conveyor', 0, 0);
  a.richtung(b1, grad1);
  const b2 = a.anlegen('conveyor', 6, 6);
  a.richtung(b2, grad2);
  const fang = a.ziehen(b2, rohB2.x, rohB2.y);
  const f2 = a.form(b2);
  const q = a.anlegen('source', 5, 5);
  const s = punkt({ x: 0, y: 0 }, grad1, -0.7, 0);
  a.form(q, { x: s.x, y: s.y });
  a.funktion(q, 'Erzeuger', { interval: 1.2, maxCount: 6 });
  const se = a.anlegen('sink', 8, 8);
  const z = punkt(f2, grad2, 1.3, 0);
  a.form(se, { x: Math.round(z.x * 1e4) / 1e4, y: Math.round(z.y * 1e4) / 1e4 });
  a.drehung(se, grad2);
  return { a: a, b1: b1, b2: b2, se: se, fang: fang };
}

test('Zwei 30°-Bänder per Objektfang Bandende und Übergang 30° → gerade: keine Kiste hängt', function () {
  // Zwei schräge Bänder: B2 ungefähr hinter B1 gezogen, der Objektfang legt die Stirnkanten aneinander
  const ende = punkt({ x: 0, y: 0 }, 30, 2, 0);
  const s = strecke(30, 30, { x: ende.x + 0.03, y: ende.y - 0.04 });
  assert.equal(s.fang, 'an Bandende von B1 (nimmt ab, bündig)');
  const f2 = s.a.form(s.b2);
  nahe(f2.x, ende.x, 1e-6, 'B2 genau hinter B1 (x)');
  nahe(f2.y, ende.y, 1e-6, 'B2 genau hinter B1 (y)');
  assert.equal(f2.z, 0.6);
  let t = s.a.laufenBis(function () { return s.a.signal(s.se + '.Anzahl') === 6; }, 25);
  assert.notEqual(t, null, '30° → 30°: nur ' + s.a.signal(s.se + '.Anzahl') + ' von 6 in der Senke');

  // 30° → gerade: Kantenmitte an Kantenmitte (die Stirnkanten sind nicht parallel)
  const m = punkt({ x: 0, y: 0 }, 30, 1, 0);
  const g = strecke(30, 0, { x: m.x + 1.02, y: m.y + 0.03 });
  assert.equal(g.fang, 'an Kantenmitte von B1');
  nahe(g.a.form(g.b2).x, m.x + 1, 1e-6);
  nahe(g.a.form(g.b2).y, m.y, 1e-6);
  t = g.a.laufenBis(function () { return g.a.signal(g.se + '.Anzahl') === 6; }, 25);
  assert.notEqual(t, null, '30° → 0°: nur ' + g.a.signal(g.se + '.Anzahl') + ' von 6 in der Senke, Kisten ' +
    JSON.stringify(g.a.kisten()));
});

test('Objektfang an schrägen Körpern: Kante bündig an der Seite eines 30°-Bands', function () {
  const a = leer();
  const b = a.anlegen('conveyor', 0, 0);
  a.richtung(b, 30);
  const k = a.formAnlegen('rect', { w: 0.4, d: 0.2 }, { x: 5, y: 5, rot: 30 });
  // Mitte des Körpers knapp neben der Seite (quer 0,25 + 0,1 m), etwas zu weit weg
  const roh = punkt({ x: 0, y: 0 }, 30, 0.37, 0.39);
  assert.equal(a.ziehen(k, roh.x, roh.y), 'an Kante von B1');
  const f = a.form(k), quer = -f.x * Math.sin(Math.PI / 6) + f.y * Math.cos(Math.PI / 6);
  nahe(quer, 0.35, 1e-6, 'Kante liegt bündig an der Bandseite');
});
