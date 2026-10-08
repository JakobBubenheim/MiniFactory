// Migration auf Dateiformat 3 (Körper in Metern) und Speichern/Laden von Version 3.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { neueAnlage, kopie } = require('./helpers/anlage');
const plaene = require('./helpers/plaene');

function nahe(ist, soll, text) {
  assert.ok(Math.abs(ist - soll) < 1e-9, (text || '') + ' erwartet ' + soll + ', ist ' + ist);
}

// Beispielanlage in Version 1 (Raster, Zelle 0,5 m)
const ALT_V1 = {
  format: 'mini-fabrik', version: 1, name: 'Alte Anlage',
  settings: { dtMs: 50, cellM: 0.5 },
  elements: [
    { id: 'Q1', type: 'source', name: 'Quelle 1', group: 'Förderstrecke 1', x: 2, y: 4, w: 1, h: 1, props: { interval: 2, maxCount: 0, enabled: true } },
    { id: 'B1', type: 'conveyor', name: 'Förderband 1', group: 'Förderstrecke 1', x: 3, y: 4, w: 9, h: 1, props: { running: true, speed: 0.5, direction: 'rechts' } },
    { id: 'LS1', type: 'sensor', name: 'Lichtschranke 1', group: 'Förderstrecke 1', x: 9, y: 4, w: 1, h: 1, props: { invert: false } },
    { id: 'S1', type: 'pusher', name: 'Schieber 1', group: 'Förderstrecke 1', x: 9, y: 3, w: 1, h: 1, props: { stroke: 600, speed: 0.3, returnDelay: 0.5, direction: 'auto' } },
    { id: 'SE1', type: 'sink', name: 'Senke 1', group: 'Förderstrecke 1', x: 12, y: 4, w: 1, h: 1, props: {} },
    { id: 'SE2', type: 'sink', name: 'Senke 2', group: 'Ausschleusung', x: 9, y: 5, w: 1, h: 1 }
  ],
  rules: [{ id: 'R1', name: 'Regel 1', when: 'LS1.Belegt', then: 'S1.Ausfahren' }]
};

function koerper(d, id) {
  return d.bodies.filter(function (b) { return b.id === id; })[0];
}

test('Migration 1 → 3: Elemente werden Körper in Metern mit Funktionen', function () {
  const a = neueAnlage();
  const d = a.migrieren(ALT_V1);
  assert.equal(d.version, 3);
  assert.equal(d.elements, undefined, 'keine Raster-Elemente mehr');
  assert.equal(d.settings.cellM, undefined, 'keine Rasterzelle mehr');
  assert.equal(d.settings.dtMs, 50, 'Zeitschritt bleibt');
  assert.deepEqual(a.pruefen(d), []);
  assert.deepEqual(d.bodies.map(function (b) { return b.id; }), ['Q1', 'B1', 'LS1', 'S1', 'SE1', 'SE2']);

  // Förderband: fest, 9 Zellen = 4,5 m lang, Oberkante 0,7 m, Transportfläche nach rechts
  const b1 = koerper(d, 'B1');
  assert.equal(b1.template, 'conveyor');
  assert.equal(b1.kind, 'static');
  assert.deepEqual(b1.shape, { type: 'rect', w: 4.5, d: 0.5, h: 0.1 });
  assert.deepEqual(b1.pose, { x: 3.75, y: 2.25, z: 0.6, rot: 0 });
  assert.deepEqual(b1.surface, { speed: 0.5, dir: 0, running: true });

  // Lichtschranke: immateriell, 5 cm schmaler Streifen quer über dem Band, knapp über der Oberkante
  const ls1 = koerper(d, 'LS1');
  assert.equal(ls1.kind, 'ghost');
  assert.equal(ls1.shape.w, 0.05);
  assert.equal(ls1.shape.d, 0.5);
  nahe(ls1.pose.x, 4.75, 'LS1 x');
  assert.ok(ls1.pose.z >= 0.7 && ls1.pose.z < 0.75, 'LS1 sitzt auf dem Band: z = ' + ls1.pose.z);
  assert.deepEqual(ls1.sensor, { invert: false, debounce: 0 });

  // Schieber: kinematisch, lineare Achse zweipunkt, Hub 600 mm -> max 0,6 m, Tempo -> vmax.
  // "auto" ist fest aufgelöst: vom Schieber weg über das Band = nach unten (+y)
  const s1 = koerper(d, 'S1');
  assert.equal(s1.kind, 'kinematic');
  assert.equal(s1.axis.type, 'linear');
  assert.equal(s1.axis.mode, 'zweipunkt');
  assert.equal(s1.axis.max, 0.6);
  assert.equal(s1.axis.vmax, 0.3);
  assert.equal(s1.axis.returnDelay, 0.5);
  const b = neueAnlage(ALT_V1);
  assert.equal(b.eigenschaft('S1', 'direction'), 'unten');
  assert.equal(b.eigenschaft('S1', 'stroke'), 600);

  // Quelle liegt dort, wo die Kisten aufs Band kommen, 2 cm über dem Band
  const q1 = koerper(d, 'Q1');
  assert.equal(q1.kind, 'ghost');
  assert.deepEqual(q1.spawner && [q1.spawner.interval, q1.spawner.maxCount, q1.spawner.enabled], [2, 0, true]);
  nahe(q1.pose.x, 1.75, 'Q1 x');
  nahe(q1.pose.z, 0.72, 'Q1 z');

  // Senken liegen tiefer als das Band
  ['SE1', 'SE2'].forEach(function (id) {
    const s = koerper(d, id);
    assert.equal(s.kind, 'ghost');
    assert.deepEqual(s.sink, {});
    assert.ok(s.pose.z + s.shape.h < 0.7, id + ' liegt tiefer als das Band');
  });
});

test('Migration: Signalnamen, Richtung und Typen bleiben gleich', function () {
  const a = neueAnlage(ALT_V1);
  ['Q1.Freigabe', 'Q1.Erzeugt', 'B1.Ein', 'B1.Läuft', 'B1.Tempo', 'LS1.Belegt',
    'S1.Ausfahren', 'S1.Ausgefahren', 'S1.Eingefahren', 'SE1.Reset', 'SE1.Anzahl'].forEach(function (s) {
    assert.equal(typeof a.signal(s), 'number', s);
  });
  assert.equal(a.signal('B1.Ein'), 1, 'Startwert');
  assert.equal(a.signal('B1.Tempo'), 0.5, 'Tempo = Eigenschaft');
  assert.equal(a.signal('S1.Ist'), 0, 'neuer Ausgang: Achsstellung');
  assert.throws(function () { a.forcen('B1.Ein', 1); }, /kein Ausgang/, 'Ein bleibt ein Eingang');
  assert.throws(function () { a.setzen('LS1.Belegt', 1); }, /kein Eingang/, 'Belegt bleibt ein Ausgang');
});

test('Migration: Bandrichtung wird zu Grad (rechts 0°, unten 90°, links 180°, oben 270°)', function () {
  const a = neueAnlage();
  const d = a.migrieren(plaene.datei([
    plaene.element('B1', 'conveyor', 0, 0, 4, 1, { direction: 'rechts' }),
    plaene.element('B2', 'conveyor', 0, 2, 1, 4, { direction: 'unten' }),
    plaene.element('B3', 'conveyor', 2, 2, 4, 1, { direction: 'links' }),
    plaene.element('B4', 'conveyor', 8, 2, 1, 4, { direction: 'oben' })
  ]));
  assert.deepEqual(d.bodies.map(function (b) { return b.surface.dir; }), [0, 90, 180, 270]);
  // Hochkant liegende Bänder: lang in y
  const b2 = koerper(d, 'B2');
  assert.deepEqual([b2.shape.w, b2.shape.d], [0.5, 2]);
  // Das Eigenschaften-Panel zeigt dieselbe Richtung
  const b = neueAnlage(d);
  ['B1', 'B2', 'B3', 'B4'].forEach(function (id, i) {
    assert.equal(b.eigenschaft(id, 'direction'), ['rechts', 'unten', 'links', 'oben'][i]);
  });
});

test('Migration 2 → 3: Ordner, Eingänge und Darstellung bleiben', function () {
  const a = neueAnlage();
  const v2 = {
    format: 'mini-fabrik', version: 2, name: 'Version 2',
    settings: { dtMs: 20, cellM: 1 },
    folders: [{ id: 'F1', name: 'Halle', parent: null, area: 'plant' }, { id: 'F2', name: 'Logik', parent: null, area: 'logic' }],
    elements: [
      { id: 'B1', type: 'conveyor', name: 'Band', parent: 'F1', x: 1, y: 1, w: 3, h: 1, rot: 0,
        props: { running: false, speed: 1.5, direction: 'rechts' }, inputs: { Ein: 0 },
        look: { color: '#123456', visible: false, locked: true } }
    ],
    rules: [{ id: 'R1', name: 'R', parent: 'F2', kind: 'scl', enabled: true, description: '', when: '', then: '', code: '"B1".Ein := 1;' }],
    view: { zoom: 2, panX: 10, panY: 20, grid: false, tags: true, folded: ['F1'] }
  };
  const d = a.migrieren(v2);
  assert.deepEqual(a.pruefen(d), []);
  const b1 = koerper(d, 'B1');
  assert.equal(b1.parent, 'F1');
  assert.deepEqual(b1.inputs, { Ein: 0 });
  assert.deepEqual(b1.look, { color: '#123456', visible: false, locked: true });
  assert.deepEqual(b1.surface, { speed: 1.5, dir: 0, running: false });
  assert.deepEqual([b1.shape.w, b1.shape.d, b1.pose.x, b1.pose.y], [3, 1, 2.5, 1.5], 'Zelle 1 m');
  assert.deepEqual(d.folders, v2.folders);
  assert.deepEqual(d.rules, v2.rules);
  assert.equal(d.view.zoom, 2);
  assert.equal(d.settings.dtMs, 20);
});

test('Aneinanderstoßende Bänder sind nicht bündig: das abnehmende liegt 2 mm tiefer', function () {
  const a = neueAnlage();
  // B1 nach rechts liefert auf B2 (nach unten), B2 liefert auf B3 (nach links); B4 steht allein
  const datei = plaene.datei([
    plaene.element('Q1', 'source', 0, 0, 1, 1, { interval: 3 }),
    plaene.element('B1', 'conveyor', 1, 0, 6, 1, { direction: 'rechts' }),
    plaene.element('B2', 'conveyor', 7, 0, 1, 5, { direction: 'unten' }),
    plaene.element('B3', 'conveyor', 2, 5, 6, 1, { direction: 'links' }),
    plaene.element('B4', 'conveyor', 1, 8, 4, 1, { direction: 'rechts' }),
    plaene.element('SE1', 'sink', 1, 5, 1, 1)
  ]);
  const d = a.migrieren(datei);
  const z = {};
  d.bodies.forEach(function (b) { z[b.id] = b.pose.z; });
  nahe(z.B1, 0.6, 'B1');
  nahe(z.B2, 0.598, 'B2 2 mm unter B1');
  nahe(z.B3, 0.596, 'B3 2 mm unter B2');
  nahe(z.B4, 0.6, 'B4 berührt keins');

  // Über beide Ecken hinweg kommen Kisten in der Senke an
  const b = neueAnlage(datei);
  const t = b.laufenBis(function () { return b.signal('SE1.Anzahl') >= 2; }, 30);
  assert.notEqual(t, null, 'Kisten kommen nicht über die Ecken: SE1 = ' + b.signal('SE1.Anzahl'));
});

test('Unbekannte Elementtypen in alten Dateien werden gemeldet, nicht geladen', function () {
  const a = neueAnlage();
  const d = plaene.datei([plaene.element('X1', 'roboter', 0, 0, 1, 1)]);
  assert.match(a.pruefen(d).join('\n'), /roboter/);
  assert.equal(a.laden(d), false);
});

test('Speichern → Laden in Version 3 ergibt dieselbe Anlage, auch nach einer Migration', function () {
  const a = neueAnlage(ALT_V1);
  a.eigenschaft('B1', 'speed', 0.7);
  a.eigenschaft('S1', 'stroke', 550);
  a.eigenschaft('LS1', 'debounce', 120);
  a.setzen('Q1.Freigabe', 0);
  const d1 = a.datei();
  assert.equal(d1.version, 3);
  const b = neueAnlage(d1);
  assert.deepEqual(b.datei(), d1);
  assert.deepEqual(b.koerper('S1'), a.koerper('S1'));
  assert.equal(b.eigenschaft('S1', 'stroke'), 550);
  assert.equal(b.signal('Q1.Freigabe'), 0);

  // Datei → Laden → Datei ist stabil (keine schleichende Änderung)
  const c = neueAnlage(kopie(b.datei()));
  assert.deepEqual(c.datei(), d1);
});
