// Objektfang: Körper rasten an Ecken, Mitten, Kanten und Bandenden anderer Körper ein.
// Die Fang-Rechnung (sim/snap.js) ist rein und wird direkt geprüft; Verschieben,
// Bandhöhe, Physik an der Naht und der Schalter über die Fassade.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { neueAnlage, kopie } = require('./helpers/anlage');
const { laden } = require('./helpers/load');

// ---------- reine Rechnung ----------

// Reichweite 8 px bei 80 px/m (Zoom 100 %) = 0,1 m
function rechnung() {
  const MF = laden({ start: false }).MF;
  const snap = { on: true, obj: true, pos: 0.05, angle: 5 };
  // R1: 2 × 1 m um (0, 0); K1 hängt an R1 (Kopplung); C1: Kreis r 0,5 bei (5, 0)
  const bodies = [
    { id: 'R1', shape: { type: 'rect', w: 2, d: 1, h: 0.1 }, pose: { x: 0, y: 0, z: 0, rot: 0 }, look: { visible: true }, parent: null },
    { id: 'K1', shape: { type: 'rect', w: 0.4, d: 0.4, h: 0.1 }, pose: { x: 3, y: 2, z: 0, rot: 0 }, look: { visible: true }, parent: 'R1' },
    { id: 'C1', shape: { type: 'circle', r: 0.5, h: 0.1 }, pose: { x: 5, y: 0, z: 0, rot: 0 }, look: { visible: true }, parent: null },
    { id: 'U1', shape: { type: 'rect', w: 1, d: 1, h: 0.1 }, pose: { x: 0, y: 5, z: 0, rot: 0 }, look: { visible: false }, parent: null }
  ];
  function ctx(opt) {
    opt = opt || {};
    return MF.snap.context({ snap: opt.snap || snap, bodies: bodies, skip: opt.skip || null,
      scale: 80 * (opt.zoom || 1), poseOf: function (b) { return b.pose; } });
  }
  function punkt(x, y, opt) {
    opt = opt || {};
    const q = MF.snap.point(ctx(opt), { x: x, y: y }, !!opt.alt);
    return kopie({ x: q.x, y: q.y, art: q.hit ? q.hit.kind : null, text: q.hit ? q.hit.text : null });
  }
  return { MF: MF, snap: snap, bodies: bodies, ctx: ctx, punkt: punkt };
}

test('Objektfang: Ecke, Kantenmitte, Mittelpunkt, Quadrant und Kante in Reichweite rasten ein', function () {
  const r = rechnung();
  assert.deepEqual(r.punkt(1.06, 0.53), { x: 1, y: 0.5, art: 'corner', text: 'an Ecke von R1' });
  assert.deepEqual(r.punkt(0.03, -0.54), { x: 0, y: -0.5, art: 'mid', text: 'an Kantenmitte von R1' });
  assert.deepEqual(r.punkt(0.04, 0.03), { x: 0, y: 0, art: 'center', text: 'an Mitte von R1' });
  assert.deepEqual(r.punkt(5.53, 0.02), { x: 5.5, y: 0, art: 'quad', text: 'an Quadrant von C1' });
  // Auf der Kante: die Kante legt y fest, x fängt weiter am Raster
  assert.deepEqual(r.punkt(0.41, 0.53), { x: 0.4, y: 0.5, art: 'edge', text: 'an Kante von R1' });
});

test('Objektfang: außer Reichweite fängt das Raster; Flucht richtet eine Achse aus', function () {
  const r = rechnung();
  assert.deepEqual(r.punkt(0.37, 0.71), { x: 0.35, y: 0.7, art: null, text: null });
  // Reichweite in Pixeln: bei Zoom 200 % ist dieselbe Stelle zu weit weg
  assert.equal(r.punkt(1.06, 0.56).art, 'corner');
  assert.deepEqual(r.punkt(1.06, 0.56, { zoom: 2 }), { x: 1.05, y: 0.55, art: null, text: null });
  // In Flucht mit der Ecke von R1: x = 1, y fängt am Raster, mit Hilfslinie
  const q = r.MF.snap.point(r.ctx(), { x: 1.04, y: 3.02 }, false);
  assert.deepEqual({ x: q.x, y: q.y, text: q.hit.text }, { x: 1, y: 3, text: 'in Flucht mit R1' });
  assert.equal(q.hit.guides.length, 1);
  assert.equal(q.hit.guides[0].x1, 1);
});

test('Objektfang aus: genau das Raster wie bisher; Alt hält Raster und Objektfang aus', function () {
  const r = rechnung(), S = r.MF.snap, aus = { on: true, obj: false, pos: 0.05, angle: 5 };
  [[1.06, 0.53], [0.03, -0.54], [5.53, 0.02], [1.04, 2.02], [-0.026, 7.9749]].forEach(function (p) {
    assert.deepEqual(r.punkt(p[0], p[1], { snap: aus }), kopie(Object.assign(S.gridPoint(p[0], p[1], aus, false), { art: null, text: null })));
  });
  assert.deepEqual(r.punkt(1.06, 0.53, { alt: true }), { x: 1.06, y: 0.53, art: null, text: null });
  assert.deepEqual(r.punkt(1.0612, 0.5349, { alt: true }), { x: 1.061, y: 0.535, art: null, text: null });
  // Verschieben ohne Objektfang: Lage wie bisher auf das Raster bzw. ohne Fangen auf 1 cm
  const d = { id: 'D1', shape: { type: 'rect', w: 1, d: 1, h: 0.1 }, pose: { x: 0, y: 0, z: 0, rot: 0 } };
  const raw = { model: { x: 1.53, y: 0.04 }, world: { x: 1.53, y: 0.04 } };
  assert.deepEqual(kopie(S.moveBody(r.ctx({ snap: aus }), d, null, raw, false, S.FREE_MOVE)), { x: 1.55, y: 0.05, hit: null });
  const ohne = { on: false, obj: false, pos: 0.05, angle: 5 };
  assert.deepEqual(kopie(S.moveBody(r.ctx({ snap: ohne }), d, null, { model: { x: 1.534, y: 0.046 }, world: { x: 0, y: 0 } }, false, S.FREE_MOVE)),
    { x: 1.53, y: 0.05, hit: null });
  assert.equal(S.moveBody(r.ctx(), d, null, raw, true, S.FREE_MOVE).hit, null);
});

test('Objektfang: der gezogene Körper, seine Kinder und ausgeblendete Körper sind keine Ziele', function () {
  const r = rechnung();
  assert.equal(r.punkt(3.22, 2.21).text, 'an Ecke von K1');
  assert.equal(r.punkt(3.22, 2.21, { skip: 'R1' }).art, null);       // K1 hängt an R1
  assert.doesNotMatch(String(r.punkt(1.06, 0.53, { skip: 'R1' }).text), /R1/);
  assert.equal(r.punkt(5.53, 0.02, { skip: 'R1' }).art, 'quad');     // andere bleiben Ziele
  assert.equal(r.punkt(0.52, 4.47).art, null);                       // U1 ist ausgeblendet
});

test('Objektfang beim Verschieben: Kante an Kante bündig, entlang der Kante Mitte auf Mitte', function () {
  const r = rechnung(), S = r.MF.snap;
  const d = { id: 'D1', shape: { type: 'rect', w: 1, d: 1, h: 0.1 }, pose: { x: 0, y: 0, z: 0, rot: 0 } };
  function ziehen(x, y) {
    const m = S.moveBody(r.ctx({ skip: 'D1' }), d, null, { model: { x: x, y: y }, world: { x: x, y: y } }, false, S.FREE_MOVE);
    return kopie({ x: m.x, y: m.y, text: m.hit && m.hit.text, z: m.z });
  }
  // Linke Kante von D1 an die rechte Kante von R1 (x = 1), y fängt am Raster
  assert.deepEqual(ziehen(1.53, 0.21), { x: 1.5, y: 0.2, text: 'an Kante von R1' });
  // Nahe an der Mitte: Kantenmitte auf Kantenmitte
  assert.deepEqual(ziehen(1.53, 0.04), { x: 1.5, y: 0, text: 'an Kante von R1' });
  // Mittelpunkt auf Mittelpunkt (z. B. Lichtschranke mittig aufs Band)
  assert.deepEqual(ziehen(0.04, -0.06), { x: 0, y: 0, text: 'an Mitte von R1' });
});

test('Verschieben: die gezeichnete Lage beim Anfassen bleibt fest, während sich die Lage ändert', function () {
  // Fehler aus Phase 4: drawPose gab ohne Achse und Kopplung b.pose selbst zurück; der
  // Editor rechnete beim Ziehen damit und der Körper lief nur halb so schnell wie die Maus.
  const MF = laden().MF, b = MF.store.findBody('B1');
  const fest = MF.sim.drawPose(b), ruhe = MF.sim.restDrawPose(b), x = b.pose.x;
  b.pose.x += 1;
  assert.equal(fest.x, x);
  assert.equal(ruhe.x, x);
  assert.equal(MF.sim.drawPose(b).x, x + 1);
});

// ---------- über die Fassade ----------

function leer() {
  return neueAnlage({ format: 'mini-fabrik', version: 3, name: 'Leer',
    settings: { dtMs: 20, gravity: -9.81, snap: { on: true, pos: 0.05, angle: 5 } },
    folders: [], bodies: [], rules: [] });
}

test('Band an Bandende schieben: Stirnkanten liegen aneinander, das abnehmende Band 1 cm tiefer', function () {
  const a = leer();
  const b1 = a.anlegen('conveyor', 0, 0);   // 2 × 0,5 m, läuft nach rechts, Oberkante 0,7 m
  const b2 = a.anlegen('conveyor', 4, 2);
  assert.equal(a.ziehen(b2, 2.04, 0.03), 'an Bandende von ' + b1 + ' (nimmt ab, 1 cm tiefer)');
  assert.deepEqual(a.koerper(b2).pose, { x: 2, y: 0, z: 0.59, rot: 0 });

  // Ein drittes Band vor B1 gezogen liefert auf B1 und liegt 1 cm höher
  const b0 = a.anlegen('conveyor', -4, 2);
  assert.equal(a.ziehen(b0, -1.96, -0.02), 'an Bandende von ' + b1 + ' (liefert, 1 cm höher)');
  assert.deepEqual(a.koerper(b0).pose, { x: -2, y: 0, z: 0.61, rot: 0 });

  // Weg vom Bandende: die Höhe bleibt, wie sie beim Anfassen war; Alt fängt nicht
  assert.equal(a.ziehen(b0, -1.234, 3.012, { ohneFangen: true }), null);
  assert.deepEqual(a.koerper(b0).pose, { x: -1.234, y: 3.012, z: 0.61, rot: 0 });
  // Ein Schritt im Verlauf je Ziehen
  a.rueckgaengig();
  assert.deepEqual(a.koerper(b0).pose, { x: -2, y: 0, z: 0.61, rot: 0 });
});

test('Kiste läuft sauber über die Naht zweier per Objektfang verbundener Bänder', function () {
  const a = leer();
  a.anlegen('conveyor', 0, 0);
  const b2 = a.anlegen('conveyor', 4, 2);
  a.ziehen(b2, 2.03, -0.04);
  // Erzeuger kurz vor der Naht (x = 1)
  const q = a.formAnlegen('rect', { w: 0.4, d: 0.4, h: 0.35 }, { x: 0.7, y: 0, z: 0.72 });
  assert.equal(a.funktion(q, 'Erzeuger', { maxCount: 1 }), true);
  a.laufen(0.6);
  let zMax = 0, yMax = 0;
  for (let i = 0; i < 12; i++) {
    a.laufen(0.15);
    const k = a.kisten3d()[0];
    zMax = Math.max(zMax, k.z);
    yMax = Math.max(yMax, Math.abs(k.y));
  }
  const k = a.kisten3d()[0], v = a.kistenTempo()[0];
  assert.ok(k.x > 1.5, 'über die Naht gefahren: x = ' + k.x);
  assert.ok(Math.abs(k.z - (0.69 + 0.15)) < 0.005, 'liegt auf dem zweiten Band: z = ' + k.z);
  assert.ok(zMax < 0.7 + 0.15 + 0.005, 'springt nicht an der Naht: höchstes z = ' + zMax);
  assert.ok(yMax < 0.01, 'fährt gerade: |y| bis ' + yMax);
  assert.ok(Math.abs(v.x - 0.5) <= 0.025, 'Bandtempo ' + v.x);
});

test('Schalter Objektfang: Standard an, wird gespeichert und geladen, kein Schritt im Verlauf', function () {
  const a = leer();
  assert.equal(a.fangenEinstellungen().obj, true, 'alte Datei ohne "obj": an');
  const b1 = a.anlegen('conveyor', 0, 0);
  a.anlegen('conveyor', 4, 2);
  const schritte = a.kannRueckgaengig();
  a.fangenEinstellen({ obj: false });
  assert.equal(a.datei().settings.snap.obj, false);
  assert.equal(neueAnlage(a.datei()).fangenEinstellungen().obj, false);

  // Aus: verschieben fängt nur am Raster. B2 berührt danach das Ende von B1 und nimmt
  // ab – die Naht-Regel (MF.fixBeltSeams) gilt auch ohne Objektfang: 1 cm tiefer
  assert.equal(a.ziehen('B2', 2.04, 0.03), null);
  assert.deepEqual(a.koerper('B2').pose, { x: 2.05, y: 0.05, z: 0.59, rot: 0 });

  // Rückgängig und Wiederholen lassen den Schalter, wie er ist
  a.rueckgaengig();
  assert.equal(a.fangenEinstellungen().obj, false);
  a.fangenEinstellen({ obj: true, on: false });
  a.wiederholen();
  assert.deepEqual(a.fangenEinstellungen(), { on: false, obj: true, pos: 0.05, angle: 5 });
  a.rueckgaengig();
  assert.equal(a.kannRueckgaengig(), schritte);
  assert.ok(b1);

  // Prüfen: obj muss wahr oder falsch sein; neue Anlage hat ihn an
  const d = a.datei();
  d.settings.snap.obj = 'ja';
  assert.match(a.pruefen(d).join(' '), /"snap" muss/);
  assert.equal(neueAnlage().fangenEinstellungen().obj, true);
});
