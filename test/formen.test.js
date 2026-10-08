// Formen (Phase 3): frei gezeichnete Körper, Körperart, Funktionen, Neigung, Fangen.
// Alles über die Fassade, Längen in Metern.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { neueAnlage } = require('./helpers/anlage');

const KISTE = 0.3;   // Kantenlänge der Kisten aus Erzeugern

// Leere Anlage (Dateiformat 3), SPS-Zyklus 20 ms
function leer() {
  return neueAnlage({ format: 'mini-fabrik', version: 3, name: 'Leer',
    settings: { dtMs: 20, gravity: -9.81, snap: { on: true, pos: 0.05, angle: 5 } },
    folders: [], bodies: [], rules: [] });
}

// Gezeichneter Erzeuger: kleines Rechteck, Unterseite auf z, legt maxCount Kisten ab
function erzeuger(a, x, y, z, maxCount) {
  const id = a.formAnlegen('rect', { w: 0.4, d: 0.4, h: 0.35 }, { x: x, y: y, z: z });
  assert.equal(a.funktion(id, 'Erzeuger', { maxCount: maxCount || 1 }), true);
  return id;
}

function nahe(ist, soll, tol, text) {
  assert.ok(Math.abs(ist - soll) <= tol, (text || '') + ' ist ' + ist + ', soll ' + soll + ' ± ' + tol);
}

test('Neu gezeichnete Form ist immateriell (ghost), heißt "Körper n" und Kisten fallen hindurch', function () {
  const a = leer();
  const platte = a.formAnlegen('rect', { w: 1, d: 1 }, { x: 0, y: 0, z: 0.5 });
  assert.equal(platte, 'K1');
  assert.equal(a.name('K1'), 'Körper 1');
  assert.equal(a.koerperart(platte), 'ghost');
  const f = a.form(platte);
  assert.equal(f.h, 0.1, 'Standardhöhe 0,1 m');
  assert.equal(f.z, 0.5);
  assert.equal(erzeuger(a, 0, 0, 1), 'K2');

  a.laufen(2);
  const k = a.kisten3d();
  assert.equal(k.length, 1);
  nahe(k[0].z, KISTE / 2, 0.005, 'Kiste liegt auf dem Boden, z');
});

test('Auf "static" gestellt trägt die Form die Kiste; zurück auf ghost fällt sie sofort durch', function () {
  const a = leer();
  const platte = a.formAnlegen('rect', { w: 1, d: 1 }, { x: 0, y: 0, z: 0.5 });
  assert.deepEqual(a.koerperart(platte, 'static'), []);
  erzeuger(a, 0, 0, 1);

  a.laufen(2);
  nahe(a.kisten3d()[0].z, 0.6 + KISTE / 2, 0.005, 'Kiste liegt auf der Platte, z');

  // Wirkt auch während die Simulation läuft
  a.koerperart(platte, 'ghost');
  a.laufen(1);
  nahe(a.kisten3d()[0].z, KISTE / 2, 0.005, 'Kiste auf dem Boden, z');
});

test('Selbst gezeichnete schräge Rutsche leitet Kisten per Schwerkraft in eine Senke', function () {
  const a = leer();
  // Keil: 2 m lang, links 1 m hoch, rechts 0,3 m (h2), glatter Belag
  const rutsche = a.formAnlegen('rect', { w: 2, d: 0.6, h: 1 }, { x: 0, y: 0 });
  a.koerperart(rutsche, 'static');
  assert.equal(a.form(rutsche, { h2: 0.3 }), true);
  a.material(rutsche, { friction: 0.1 });
  assert.equal(a.form(rutsche).h2, 0.3);

  // Erzeuger über dem oberen Ende, Senke am Fuß
  erzeuger(a, -0.7, 0, 1.0, 2);
  const senke = a.formAnlegen('rect', { w: 0.8, d: 0.8, h: 0.6 }, { x: 1.6, y: 0 });
  assert.equal(a.funktion(senke, 'Senke', {}), true);

  // Die Kiste rutscht ohne Band nach +x
  a.laufen(0.8);
  const k = a.kisten3d()[0];
  assert.ok(k.x > -0.6 && a.kistenTempo()[0].x > 0.3, 'Kiste rutscht nach +x: ' + JSON.stringify(k));
  assert.ok(k.z > 0.4, 'liegt noch auf der Rutsche: ' + JSON.stringify(k));

  const t = a.laufenBis(function () { return a.signal(senke + '.Anzahl') === 2; }, 10);
  assert.notEqual(t, null, 'beide Kisten kommen in der Senke an');
  assert.equal(a.kistenAnzahl(), 0);
});

test('Ohne Neigung (und mit Reibung) bleibt die Kiste auf derselben Form liegen', function () {
  const a = leer();
  const block = a.formAnlegen('rect', { w: 2, d: 0.6, h: 1 }, { x: 0, y: 0 });
  a.koerperart(block, 'static');
  erzeuger(a, -0.7, 0, 1.0, 1);
  a.laufen(2);
  const k = a.kisten3d()[0];
  nahe(k.x, -0.7, 0.01, 'x');
  nahe(k.z, 1 + KISTE / 2, 0.005, 'z');
});

test('Konkaves Polygon (L-Form) als static trägt Kisten auf beiden Schenkeln', function () {
  const a = leer();
  // L: senkrechter Schenkel x 0…0,5 / y 0…2, waagrechter Schenkel x 0…2 / y 1,5…2
  const l = a.formAnlegen('polygon', { punkte: [[0, 0], [0.5, 0], [0.5, 1.5], [2, 1.5], [2, 2], [0, 2]], h: 0.4 }, { x: 0, y: 0 });
  assert.notEqual(l, null);
  a.koerperart(l, 'static');
  erzeuger(a, 0.25, 0.4, 0.8);      // über dem senkrechten Schenkel
  erzeuger(a, 1.6, 1.75, 0.8);      // über dem waagrechten Schenkel
  // Kontrolle: in der Ecke außerhalb des L fällt eine Kiste auf den Boden
  erzeuger(a, 1.5, 0.5, 0.8);

  a.laufen(2);
  const k = a.kisten3d();
  assert.equal(k.length, 3);
  nahe(k[0].z, 0.4 + KISTE / 2, 0.005, 'Kiste auf Schenkel 1, z');
  nahe(k[1].z, 0.4 + KISTE / 2, 0.005, 'Kiste auf Schenkel 2, z');
  nahe(k[2].z, KISTE / 2, 0.005, 'Kiste neben dem L, z');
});

test('Polygon, das sich selbst schneidet, wird abgelehnt', function () {
  const a = leer();
  const id = a.formAnlegen('polygon', { punkte: [[0, 0], [1, 1], [1, 0], [0, 1]] }, { x: 0, y: 0 });
  assert.equal(id, null);
  assert.deepEqual(a.elemente(), []);
  assert.match(a.meldungen().join('\n'), /schneidet sich selbst/);

  // Auch beim Ändern der Punkte
  const ok = a.formAnlegen('polygon', { punkte: [[0, 0], [1, 0], [1, 1], [0, 1]] }, { x: 0, y: 0 });
  assert.equal(a.form(ok, { punkte: [[0, 0], [1, 1], [1, 0], [0, 1]] }), false);
  assert.deepEqual(a.form(ok).punkte, [[0, 0], [1, 0], [1, 1], [0, 1]]);
});

test('Dynamischer Körper fällt zu Boden; Reset stellt ihn an seine gezeichnete Lage', function () {
  const a = leer();
  const teil = a.formAnlegen('circle', { r: 0.2, h: 0.2 }, { x: 1, y: 2, z: 1.5 });
  a.koerperart(teil, 'dynamic');
  assert.ok(a.material(teil).density >= 10, 'hat eine echte Dichte');

  a.laufen(2);
  const p = a.lage(teil);
  nahe(p.z, 0, 0.005, 'liegt auf dem Boden, Unterseite z');
  // Beim Aufprall (gut 5 m/s) rutscht der Zylinder ein paar Zentimeter
  nahe(p.x, 1, 0.1, 'x');
  nahe(p.y, 2, 0.1, 'y');
  assert.equal(a.form(teil).z, 1.5, 'gezeichnete Lage bleibt im Modell');

  a.reset();
  assert.deepEqual(a.lage(teil), { x: 1, y: 2, z: 1.5, rot: 0 });
  a.laufen(0.2);
  assert.ok(a.lage(teil).z < 1.5, 'fällt nach dem Reset wieder');
});

test('Funktionen nur wo erlaubt; Signale erscheinen und verschwinden mit der Funktion', function () {
  const a = leer();
  const k = a.formAnlegen('rect', { w: 1, d: 0.5 }, { x: 0, y: 0 });
  assert.deepEqual(a.signale(k), []);

  // Transportfläche auf ghost wird abgelehnt
  assert.equal(a.funktion(k, 'Transportfläche', {}), false);
  assert.equal(a.funktion(k, 'Transportfläche'), null);
  assert.match(a.meldungen().join('\n'), /Transportfläche gibt es nur bei festen oder kinematischen Körpern/);
  assert.equal(a.funktion(k, 'Achse', {}), false);

  // Sensor auf ghost: Signal "Belegt" erscheint, eine Regel kann es benutzen
  assert.equal(a.funktion(k, 'Sensor', { debounce: 100 }), true);
  assert.deepEqual(a.signale(k), ['Belegt']);
  assert.equal(a.funktion(k, 'Sensor').debounce, 100);
  const r = a.neueRegel(k + '.Belegt', '');
  assert.equal(a.signal(k + '.Belegt'), 0);

  // Körperart fest: Sensor ist nicht mehr erlaubt und fällt weg – samt Bezug der Regel
  assert.deepEqual(a.koerperart(k, 'static'), ['Sensor']);
  assert.deepEqual(a.signale(k), []);
  assert.equal(a.regel(r).when, '');
  assert.throws(function () { a.signal(k + '.Belegt'); }, /gibt es nicht/);

  // Jetzt ist die Transportfläche erlaubt
  assert.equal(a.funktion(k, 'Transportfläche', { speed: 0.8 }), true);
  assert.deepEqual(a.signale(k), ['Ein', 'Läuft', 'Tempo']);
  assert.equal(a.signal(k + '.Tempo'), 0.8);
  assert.equal(a.funktion(k, 'Transportfläche', null), true);
  assert.deepEqual(a.signale(k), []);
});

test('Selbst gezeichnetes Band mit Erzeuger und Senke transportiert und zählt Kisten wie die Vorlagen', function () {
  const a = leer();
  const band = a.formAnlegen('rect', { w: 3, d: 0.5 }, { x: 1.5, y: 0, z: 0.6 });
  a.koerperart(band, 'static');
  a.material(band, { friction: 0.8 });
  assert.equal(a.funktion(band, 'Transportfläche', { speed: 0.5, dir: 0 }), true);
  const q = erzeuger(a, 0.25, 0, 0.72, 0);
  a.funktion(q, 'Erzeuger', { interval: 2, maxCount: 0 });
  const senke = a.formAnlegen('rect', { w: 0.5, d: 0.5, h: 0.6 }, { x: 3.25, y: 0 });
  a.funktion(senke, 'Senke', {});

  a.laufen(1);
  const v = a.kistenTempo()[0];
  nahe(v.x, 0.5, 0.025, 'Kiste fährt mit Bandtempo, vx');
  const t = a.laufenBis(function () { return a.signal(senke + '.Anzahl') >= 2; }, 15);
  assert.notEqual(t, null, 'zwei Kisten in der Senke');

  // Band aus: die nächste Kiste bleibt liegen
  a.setzen(band + '.Ein', 0);
  a.laufen(4);
  const vs = a.kistenTempo();
  assert.ok(vs.length > 0 && vs.every(function (w) { return Math.abs(w.x) < 0.01; }), 'Kisten stehen: ' + JSON.stringify(vs));
});

test('Neigung nur bei festen Körpern und nicht zusammen mit einer Transportfläche', function () {
  const a = leer();
  const k = a.formAnlegen('rect', { w: 2, d: 0.5, h: 0.5 }, { x: 0, y: 0 });
  assert.equal(a.form(k, { h2: 0.1 }), false, 'ghost: keine Neigung');
  a.koerperart(k, 'static');
  a.funktion(k, 'Transportfläche', {});
  assert.equal(a.form(k, { h2: 0.1 }), false, 'mit Transportfläche: keine Neigung');
  a.funktion(k, 'Transportfläche', null);
  assert.equal(a.form(k, { h2: 0.1 }), true);
  assert.equal(a.funktion(k, 'Transportfläche', {}), false, 'geneigt: keine Transportfläche');
  assert.match(a.meldungen().join('\n'), /geneigten Fläche gibt es keine Transportfläche/);

  // Wechsel der Körperart nimmt die Neigung weg
  a.koerperart(k, 'kinematic');
  assert.equal(a.form(k).h2, undefined);

  // Datei mit Neigung bei einem ghost-Körper ist ungültig
  a.koerperart(k, 'static');
  a.form(k, { h2: 0.1 });
  const d = a.datei();
  assert.deepEqual(a.pruefen(d), []);
  d.bodies[0].kind = 'ghost';
  assert.match(a.pruefen(d).join('\n'), /Neigung \(h2\) gibt es nur bei Körperart "static"/);
});

test('Form ändern -> Rückgängig stellt den alten Zustand her', function () {
  const a = leer();
  const k = a.formAnlegen('rect', { w: 1, d: 0.5 }, { x: 0, y: 0 });
  const vorher = a.form(k);
  assert.equal(a.form(k, { w: 2, h: 0.3, z: 0.2, rot: 30 }), true);
  assert.deepEqual(a.form(k), Object.assign({}, vorher, { w: 2, h: 0.3, z: 0.2, rot: 30 }));

  a.rueckgaengig();
  assert.deepEqual(a.form(k), vorher);
  a.wiederholen();
  assert.equal(a.form(k).w, 2);

  // Körperart und Funktion sind je ein Schritt
  a.koerperart(k, 'static');
  a.funktion(k, 'Transportfläche', {});
  a.rueckgaengig();
  assert.equal(a.funktion(k, 'Transportfläche'), null);
  assert.equal(a.koerperart(k), 'static');
  a.rueckgaengig();
  assert.equal(a.koerperart(k), 'ghost');
});

test('Griff ziehen ist ein Schritt im Verlauf, auch mit Pausen und abgelehnten Zwischenständen', function () {
  const a = leer();
  const k = a.formAnlegen('polygon', { punkte: [[0, 0], [1, 0], [1, 1], [0, 1]] }, { x: 0, y: 0 });
  const vorher = a.form(k);
  // Punkt 3 wandert; ein Zwischenstand schneidet sich selbst und wird übersprungen
  const abgelehnt = a.griffZiehen(k, [
    { punkte: [[0, 0], [1, 0], [0.8, 0.8], [0, 1]] },
    { punkte: [[0, 0], [1, 0], [-0.5, 0.5], [0, 1]] },
    { punkte: [[0, 0], [1, 0], [0.5, 0.5], [0, 1]] }
  ]);
  assert.equal(abgelehnt, 1);
  assert.deepEqual(a.form(k).punkte, [[0, 0], [1, 0], [0.5, 0.5], [0, 1]]);
  a.griffZiehen(k, [{ rot: 10 }, { rot: 20 }, { rot: 30 }]);
  assert.equal(a.form(k).rot, 30);

  a.rueckgaengig();
  assert.equal(a.form(k).rot, 0);
  assert.deepEqual(a.form(k).punkte, [[0, 0], [1, 0], [0.5, 0.5], [0, 1]]);
  a.rueckgaengig();
  assert.deepEqual(a.form(k), vorher);
  assert.deepEqual(a.elemente(), [k], 'Anlegen ist ein eigener Schritt');
});

test('Speichern und Laden behalten Form, Höhe, Neigung, Lage, Körperart, Werkstoff und Funktionen', function () {
  const a = leer();
  const r = a.formAnlegen('rect', { w: 2, d: 0.6, h: 1 }, { x: 0.5, y: 1, z: 0, rot: 15 });
  a.koerperart(r, 'static');
  a.form(r, { h2: 0.25 });
  a.material(r, { friction: 0.1, restitution: 0.2 });
  const c = a.formAnlegen('circle', { r: 0.3, h: 0.2 }, { x: 3, y: 1, z: 0.4 });
  a.funktion(c, 'Sensor', { invert: true });
  const p = a.formAnlegen('polygon', { punkte: [[0, 0], [1, 0], [1, 1], [0.5, 0.4], [0, 1]], h: 0.3 }, { x: 5, y: 0, rot: 90 });
  a.koerperart(p, 'kinematic');
  a.funktion(p, 'Achse', { max: 0.6 });
  const d = a.formAnlegen('rect', { w: 0.4, d: 0.4, h: 0.4 }, { x: 7, y: 0, z: 1 });
  a.koerperart(d, 'dynamic');

  const datei = a.datei();
  const b = leer();
  assert.equal(b.laden(datei), true);
  [r, c, p, d].forEach(function (id) {
    assert.deepEqual(b.koerper(id), a.koerper(id), id);
    assert.deepEqual(b.form(id), a.form(id), id);
  });
  assert.equal(b.form(r).h2, 0.25);
  assert.equal(b.koerperart(d), 'dynamic');
  assert.equal(b.funktion(c, 'Sensor').invert, true);
  assert.equal(b.funktion(p, 'Achse').max, 0.6);
  assert.deepEqual(b.signale(p), ['Ausfahren', 'Ausgefahren', 'Eingefahren', 'Ist']);
  // IDs laufen nach dem Laden weiter
  assert.equal(b.formAnlegen('rect', { w: 1, d: 1 }, { x: 0, y: 0 }), 'K5');
});

test('Fangen: Punkte auf das Fangraster, Winkel auf den Fangwinkel; Alt bzw. "aus" fängt nicht', function () {
  const a = leer();
  assert.deepEqual(a.fangen(1.234, -0.976), { x: 1.25, y: -1 });
  assert.deepEqual(a.fangen(1.234, -0.976, true), { x: 1.234, y: -0.976 });
  assert.equal(a.fangWinkel(47), 45);
  assert.equal(a.fangWinkel(-2), 0);
  assert.equal(a.fangWinkel(-4), 355);
  assert.equal(a.fangWinkel(47.04, true), 47);
  a.fangenEinstellen({ pos: 0.1, angle: 15 });
  assert.deepEqual(a.fangen(0.26, 0.04), { x: 0.3, y: 0 });
  assert.equal(a.fangWinkel(50), 45);
  a.fangenEinstellen({ on: false });
  assert.deepEqual(a.fangen(0.26, 0.04), { x: 0.26, y: 0.04 });
});

test('Vorlagen-Körper bleiben nach freier Änderung stimmig', function () {
  const a = neueAnlage();
  // Band länger ziehen: Richtung und Tempo bleiben, die Kiste fährt weiter
  assert.equal(a.form('B1', { w: 5 }), true);
  assert.equal(a.eigenschaft('B1', 'direction'), 'rechts');
  // Schräg gedreht: keine der vier Richtungen, aber kein Fehler
  a.form('B1', { rot: 30 });
  assert.equal(a.eigenschaft('B1', 'direction'), '');
  a.eigenschaft('B1', 'direction', 'unten');
  assert.equal(a.form('B1').rot, 90);

  // Lichtschranke wird fest: Sensor fällt weg, Regel R1 verliert den Bezug wie beim Löschen
  assert.deepEqual(a.koerperart('LS1', 'static'), ['Sensor']);
  assert.equal(a.regel('R1').when, '');
  assert.throws(function () { a.eigenschaft('LS1', 'debounce'); }, /gibt es bei LS1 nicht/);
  a.rueckgaengig();
  assert.equal(a.regel('R1').when, 'LS1.Belegt');
  assert.equal(a.eigenschaft('LS1', 'debounce'), 0);
});

test('Zeichenwerkzeuge haben einen eigenen Reiter "Design" neben "Modell"', function () {
  const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
  const reiter = html.match(/data-tab="[a-z]+"/g).map(function (t) { return t.slice(10, -1); });
  assert.equal(reiter[reiter.indexOf('modell') + 1], 'design', 'Design steht direkt nach Modell: ' + reiter);
  const start = html.indexOf('data-page="design"');
  assert.ok(start >= 0, 'Seite "design" fehlt');
  const seite = html.slice(start, html.indexOf('data-page=', start + 10));
  ['tool-rect', 'tool-circle', 'tool-polygon'].forEach(function (aktion) {
    assert.ok(seite.indexOf('data-action="' + aktion + '"') >= 0, aktion + ' fehlt im Reiter Design');
  });
});
