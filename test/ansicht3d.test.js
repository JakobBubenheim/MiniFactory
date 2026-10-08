// 3D-Ansicht: alles, was ohne Three.js und WebGL prüfbar ist –
// Prisma aus dem Grundriss, Interpolation, Spiegelung, Kamera-Stand in der Datei.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { neueAnlage, kopie } = require('./helpers/anlage');
const { laden } = require('./helpers/load');

// Reine Rechnung der Ansicht (ui/view3d-core.js) in einem frischen Kontext
function kern() {
  const win = laden({ start: false });
  return { C: win.MF.view3dCore, MF: win.MF, win: win };
}

// ---------- kleine Vektor-Helfer ----------

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function kreuz(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function punkt(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function norm(a) { const l = Math.sqrt(punkt(a, a)); return [a[0] / l, a[1] / l, a[2] / l]; }

function ecke(p, i) { return [p.position[3 * i], p.position[3 * i + 1], p.position[3 * i + 2]]; }
function normale(p, i) { return [p.normal[3 * i], p.normal[3 * i + 1], p.normal[3 * i + 2]]; }

// Dreiecke einer Rolle (top/side/bottom) als Index-Tripel
function dreiecke(p, rolle) {
  const out = [];
  p.groups.filter(function (g) { return g.role === rolle; }).forEach(function (g) {
    for (let i = g.start; i < g.start + g.count; i += 3) out.push([p.index[i], p.index[i + 1], p.index[i + 2]]);
  });
  return out;
}

// Fläche der Dreiecke projiziert auf x-y
function flaeche(p, tris) {
  let a = 0;
  tris.forEach(function (t) {
    const n = kreuz(sub(ecke(p, t[1]), ecke(p, t[0])), sub(ecke(p, t[2]), ecke(p, t[0])));
    a += Math.abs(n[2]) / 2;
  });
  return a;
}

// Jedes Dreieck zeigt mit seiner Vorderseite (Umlaufsinn) dorthin, wohin seine Normalen zeigen
function pruefeUmlauf(p) {
  ['top', 'side', 'bottom'].forEach(function (rolle) {
    dreiecke(p, rolle).forEach(function (t) {
      const n = kreuz(sub(ecke(p, t[1]), ecke(p, t[0])), sub(ecke(p, t[2]), ecke(p, t[0])));
      assert.ok(punkt(n, normale(p, t[0])) > 0, rolle + ': Umlaufsinn passt nicht zur Normale');
    });
  });
}

// Seitennormalen zeigen nach außen: ein Stück außerhalb der Kantenmitte liegt nicht im Grundriss
function pruefeAussen(MF, shape, p) {
  const tris = dreiecke(p, 'side');
  for (let k = 0; k < tris.length; k += 2) {
    const t = tris[k];
    const a = ecke(p, t[0]), b = ecke(p, t[1]), n = normale(p, t[0]);
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    assert.equal(MF.geom.inOutline(shape, m[0] + n[0] * 0.01, m[1] + n[1] * 0.01), false, 'Normale zeigt nach innen');
    assert.equal(MF.geom.inOutline(shape, m[0] - n[0] * 0.01, m[1] - n[1] * 0.01), true, 'innen liegt nicht im Grundriss');
  }
}

// ---------- Prisma ----------

test('Rechteck wird ein Quader mit Höhe h, Unterseite bei z = 0', function () {
  const { C, MF } = kern();
  const shape = { type: 'rect', w: 4.5, d: 0.5, h: 0.1 };
  const p = C.prism(shape);
  const z = p.position.filter(function (v, i) { return i % 3 === 2; });
  assert.equal(Math.min.apply(null, z), 0);
  assert.equal(Math.max.apply(null, z), 0.1);
  assert.ok(Math.abs(flaeche(p, dreiecke(p, 'top')) - 4.5 * 0.5) < 1e-9, 'Oberseite = Grundfläche');
  assert.ok(Math.abs(flaeche(p, dreiecke(p, 'bottom')) - 4.5 * 0.5) < 1e-9, 'Unterseite = Grundfläche');
  assert.equal(dreiecke(p, 'side').length, 8, 'vier Seiten mit je zwei Dreiecken');
  dreiecke(p, 'top').forEach(function (t) { assert.deepEqual(normale(p, t[0]), [0, 0, 1]); });
  dreiecke(p, 'bottom').forEach(function (t) { assert.deepEqual(normale(p, t[0]), [0, 0, -1]); });
  pruefeUmlauf(p);
  pruefeAussen(MF, shape, p);
});

test('Geneigte Oberseite (Rutsche, shape.h2): Höhe läuft entlang x von h nach h2', function () {
  const { C, MF } = kern();
  const shape = { type: 'rect', w: 2, d: 0.6, h: 0.8, h2: 0.2 };
  const p = C.prism(shape);
  const oben = [];
  dreiecke(p, 'top').forEach(function (t) { t.forEach(function (i) { oben.push(ecke(p, i)); }); });
  oben.forEach(function (e) {
    const soll = e[0] < 0 ? 0.8 : 0.2;   // linke Kante hoch, rechte Kante tief
    assert.ok(Math.abs(e[2] - soll) < 1e-9, 'Oberseite bei x = ' + e[0] + ': ' + e[2] + ' statt ' + soll);
  });
  // Normale der Oberseite kippt zur tiefen Seite (+x) und steht senkrecht auf der Schräge
  const n = normale(p, dreiecke(p, 'top')[0][0]);
  assert.ok(n[0] > 0 && n[2] > 0, 'Normale zeigt schräg nach oben zur tiefen Seite: ' + n);
  assert.ok(Math.abs(punkt(n, norm([2, 0, -0.6]))) < 1e-9, 'Normale senkrecht zur Schräge');
  // Seiten reichen bis an die Schräge
  const seiteZ = [];
  dreiecke(p, 'side').forEach(function (t) { t.forEach(function (i) { seiteZ.push(ecke(p, i)[2]); }); });
  assert.equal(Math.max.apply(null, seiteZ), 0.8);
  pruefeUmlauf(p);
  pruefeAussen(MF, shape, p);
  // Einpassen berücksichtigt die hohe Seite
  const b = C.bounds([{ shape: shape, pose: { x: 0, y: 0, z: 0.5, rot: 0 } }]);
  assert.ok(Math.abs(b.z1 - 1.3) < 1e-9, 'Hüllquader bis zur hohen Kante: ' + b.z1);
});

test('Konkaves Polygon (Schieber mit Fangwinkel) wird richtig gefüllt', function () {
  const { C, MF } = kern();
  const pts = MF.pusherOutline(0.5, 0.5, 0.6, 1);
  assert.equal(MF.geom.isConvex(pts), false, 'Voraussetzung: konkav');
  const shape = { type: 'polygon', points: pts, h: 0.2 };
  const p = C.prism(shape);
  const soll = Math.abs(MF.geom.signedArea(pts));
  assert.ok(Math.abs(flaeche(p, dreiecke(p, 'top')) - soll) < 1e-9, 'Oberseite deckt genau den Grundriss');
  // Keine Fläche außerhalb: jeder Dreiecks-Schwerpunkt liegt im Grundriss
  dreiecke(p, 'top').forEach(function (t) {
    const a = ecke(p, t[0]), b = ecke(p, t[1]), c = ecke(p, t[2]);
    assert.ok(MF.geom.inPolygon(pts, (a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3));
  });
  assert.equal(dreiecke(p, 'side').length, pts.length * 2);
  pruefeUmlauf(p);
  pruefeAussen(MF, shape, p);
});

test('Polygon im Uhrzeigersinn ergibt dasselbe Prisma wie gegen den Uhrzeigersinn', function () {
  const { C, MF } = kern();
  const L = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]];   // L-Form, konkav
  const a = C.prism({ type: 'polygon', points: L, h: 0.5 });
  const b = C.prism({ type: 'polygon', points: L.slice().reverse(), h: 0.5 });
  assert.ok(Math.abs(flaeche(a, dreiecke(a, 'top')) - 3) < 1e-9);
  assert.ok(Math.abs(flaeche(b, dreiecke(b, 'top')) - 3) < 1e-9);
  pruefeUmlauf(a);
  pruefeUmlauf(b);
  pruefeAussen(MF, { type: 'polygon', points: L, h: 0.5 }, b);
});

test('Kreis wird ein glatter Zylinder', function () {
  const { C } = kern();
  const p = C.prism({ type: 'circle', r: 0.4, h: 0.3 });
  const a = flaeche(p, dreiecke(p, 'top'));
  assert.ok(Math.abs(a - Math.PI * 0.16) / (Math.PI * 0.16) < 0.01, 'Fläche ≈ πr²');
  // Seitennormalen zeigen radial nach außen
  dreiecke(p, 'side').forEach(function (t) {
    t.forEach(function (i) {
      const e = ecke(p, i), n = normale(p, i);
      const r = norm([e[0], e[1], 0]);
      assert.ok(punkt(r, n) > 0.999);
    });
  });
  pruefeUmlauf(p);
});

test('Oberseite einer Transportfläche: u läuft in Laufrichtung (Meter)', function () {
  const { C } = kern();
  const shape = { type: 'rect', w: 2, d: 1, h: 0.1 };
  function uvBei(p, x, y) {
    for (let i = 0; i < p.position.length / 3; i++) {
      const e = ecke(p, i);
      if (Math.abs(e[0] - x) < 1e-9 && Math.abs(e[1] - y) < 1e-9 && e[2] === 0.1 && p.normal[3 * i + 2] === 1) {
        return [p.uv[2 * i], p.uv[2 * i + 1]];
      }
    }
    throw new Error('Ecke nicht gefunden');
  }
  // rechts (0°): u = x
  const r = C.prism(shape, { uvDir: 0 });
  assert.ok(uvBei(r, 1, 0.5)[0] - uvBei(r, -1, 0.5)[0] - 2 < 1e-9);
  // unten (90°): u = y – vorn (große y) ist "weiter"
  const u = C.prism(shape, { uvDir: 90 });
  assert.ok(Math.abs(uvBei(u, 1, 0.5)[0] - uvBei(u, 1, -0.5)[0] - 1) < 1e-9);
  // Streifen bewegen sich mit dem Band: Weg zwischen zwei Schritten interpoliert
  assert.equal(C.travel({ prevTravel: 1, travel: 1.02 }, 0.5), 1.01);
  assert.equal(C.travel({}, 0.5), 0);
});

test('Ausdehnung einer Transportfläche entlang und quer zur Laufrichtung', function () {
  const { C } = kern();
  const e0 = C.surfaceExtent({ type: 'rect', w: 4, d: 0.5, h: 0.1 }, 0);
  assert.ok(Math.abs(e0.ex - 2) < 1e-9 && Math.abs(e0.ey - 0.25) < 1e-9);
  const e90 = C.surfaceExtent({ type: 'rect', w: 4, d: 0.5, h: 0.1 }, 90);
  assert.ok(Math.abs(e90.ex - 0.25) < 1e-9 && Math.abs(e90.ey - 2) < 1e-9);
});

test('Neu gebaut wird nur, wenn sich der Aufbau ändert, nicht bei Verschieben', function () {
  const { C, MF } = kern();
  const b = MF.bodyFromTemplate('conveyor', 1, 1);
  const k = C.bodyKey(b);
  b.pose.x = 3; b.pose.rot = 90; b.rt.travel = 5;
  assert.equal(C.bodyKey(b), k, 'Lage und Laufzeit ändern den Aufbau nicht');
  b.shape.w = 3;
  assert.notEqual(C.bodyKey(b), k, 'Form');
  const k2 = C.bodyKey(b);
  b.look.color = '#FF0000';
  assert.notEqual(C.bodyKey(b), k2, 'Farbe');
});

test('Körperarten sehen verschieden aus; belegter Sensor ändert die Farbe', function () {
  const { C, MF } = kern();
  const ls = MF.bodyFromTemplate('sensor', 0, 0);
  const frei = C.look(ls, false), belegt = C.look(ls, true);
  assert.equal(frei.solid, false, 'ghost ist durchscheinend');
  assert.ok(frei.opacity < 1);
  assert.notEqual(frei.color, belegt.color);
  const band = C.look(MF.bodyFromTemplate('conveyor', 0, 0));
  const schieber = C.look(MF.bodyFromTemplate('pusher', 0, 0));
  assert.equal(band.solid, true);
  assert.equal(schieber.solid, true);
  assert.notEqual(band.color, schieber.color, 'kinematisch anders als statisch');
});

// ---------- Interpolation ----------

function quatZ(grad) { const a = grad * Math.PI / 360; return { x: 0, y: 0, z: Math.sin(a), w: Math.cos(a) }; }
function winkelZ(q) { return Math.atan2(2 * q.w * q.z, 1 - 2 * q.z * q.z) * 180 / Math.PI; }

test('Lage wird linear interpoliert', function () {
  const { C } = kern();
  const a = { x: 0, y: 1, z: 2 }, b = { x: 1, y: 3, z: 2 };
  assert.deepEqual(kopie(C.lerpPos(a, b, 0)), a);
  assert.deepEqual(kopie(C.lerpPos(a, b, 1)), b);
  assert.deepEqual(kopie(C.lerpPos(a, b, 0.25)), { x: 0.25, y: 1.5, z: 2 });
});

test('Drehung wird per slerp interpoliert (kürzester Weg, normiert)', function () {
  const { C } = kern();
  const a = quatZ(0), b = quatZ(90);
  assert.ok(Math.abs(winkelZ(C.slerp(a, b, 0)) - 0) < 1e-9);
  assert.ok(Math.abs(winkelZ(C.slerp(a, b, 1)) - 90) < 1e-9);
  assert.ok(Math.abs(winkelZ(C.slerp(a, b, 0.5)) - 45) < 1e-9);
  // −q ist dieselbe Drehung: kein Umweg über 360°
  const nb = { x: -b.x, y: -b.y, z: -b.z, w: -b.w };
  assert.ok(Math.abs(winkelZ(C.slerp(a, nb, 0.5)) - 45) < 1e-9);
  // volle 3D-Drehung (gekippte Kiste) bleibt ein Einheits-Quaternion
  const k = { x: 0.3, y: 0.5, z: 0.1, w: 0.8 }, l = Math.sqrt(0.09 + 0.25 + 0.01 + 0.64);
  const q = C.slerp(a, { x: k.x / l, y: k.y / l, z: k.z / l, w: k.w / l }, 0.3);
  assert.ok(Math.abs(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w - 1) < 1e-12);
});

test('Kiste zwischen zwei Physik-Schritten', function () {
  const { C } = kern();
  const bx = { prev: { x: 1, y: 2, z: 0.15, q: quatZ(0) }, cur: { x: 1.02, y: 2, z: 0.15, q: quatZ(10) } };
  const p = C.boxPose(bx, 0.5);
  assert.ok(Math.abs(p.x - 1.01) < 1e-12);
  assert.ok(Math.abs(winkelZ(p.q) - 5) < 1e-9);
});

// ---------- Spiegelung ----------

test('Spiegelung: Szene hat −y, hin und zurück ergibt dasselbe', function () {
  const { C } = kern();
  assert.deepEqual(kopie(C.toScene({ x: 1, y: 2, z: 3 })), { x: 1, y: -2, z: 3 });
  assert.deepEqual(kopie(C.fromScene(C.toScene({ x: 1, y: 2, z: 3 }))), { x: 1, y: 2, z: 3 });
});

test('Richtungen wie in der Draufsicht: rechts bleibt rechts, unten bleibt unten', function () {
  const { C, MF } = kern();
  const cam = C.fitCamera(C.bounds(MF.model.bodies), 1.5);
  // Kamera in der Three.js-Szene (rechtshändig), up = (0, 0, 1)
  const p = C.toScene({ x: cam.pos[0], y: cam.pos[1], z: cam.pos[2] });
  const t = C.toScene({ x: cam.target[0], y: cam.target[1], z: cam.target[2] });
  const vor = norm([t.x - p.x, t.y - p.y, t.z - p.z]);
  const rechts = norm(kreuz(vor, [0, 0, 1]));
  const oben = kreuz(rechts, vor);
  function bild(richtung) {   // Richtung der Mini-Fabrik -> [rechts, oben] im Bild
    const s = C.toScene({ x: richtung[0], y: richtung[1], z: 0 });
    return [punkt([s.x, s.y, s.z], rechts), punkt([s.x, s.y, s.z], oben)];
  }
  // Band B1 läuft "rechts" (surface.dir 0, Lage 0°)
  const b1 = MF.store.findBody('B1');
  const v = MF.geom.dirVec(b1.pose.rot + b1.surface.dir);
  assert.ok(bild([v.x, v.y])[0] > 0.9, 'B1 läuft im Bild nach rechts');
  // y der Draufsicht zeigt nach unten: in 3D nach vorn/unten im Bild, nicht nach oben
  assert.ok(bild([0, 1])[1] < 0, '"unten" der Draufsicht liegt im Bild unten');
  assert.ok(Math.abs(bild([0, 1])[0]) < 0.3, '"unten" ist nicht seitlich vertauscht');
  // Schieber S1 schiebt nach unten zu SE2 – SE2 liegt im Bild unter S1
  const s1 = MF.store.findBody('S1'), se2 = MF.store.findBody('SE2');
  assert.ok(bild([se2.pose.x - s1.pose.x, se2.pose.y - s1.pose.y])[1] < 0);
});

// ---------- Kamera ----------

test('Kamera-Stand wird geprüft und auf Millimeter gerundet', function () {
  const { C } = kern();
  assert.deepEqual(kopie(C.normCamera({ pos: [1.23456, 2, 3], target: [0, 0, 0.0004] })),
    { pos: [1.235, 2, 3], target: [0, 0, 0] });
  assert.equal(C.normCamera(null), null);
  assert.equal(C.normCamera({ pos: [1, 2], target: [0, 0, 0] }), null);
  assert.equal(C.normCamera({ pos: [1, 2, 'x'], target: [0, 0, 0] }), null);
  assert.equal(C.normCamera({ pos: [1, 2, 3], target: [1, 2, 3] }), null, 'Kamera im Ziel');
  // Nur pos und target – nichts sonst landet in der Datei
  assert.deepEqual(Object.keys(C.normCamera({ pos: [1, 2, 3], target: [0, 0, 0], zoom: 3, mesh: {} })), ['pos', 'target']);
});

test('Einpassen: die ganze Anlage liegt im Bild', function () {
  const { C, MF } = kern();
  const b = C.bounds(MF.model.bodies);
  [0.6, 1, 2.5].forEach(function (aspect) {
    const cam = C.fitCamera(b, aspect);
    const vor = norm(sub(cam.target, cam.pos));
    // Bildachsen: waagerecht quer zu Blick und Hochachse, senkrecht quer zu beiden
    // (Vorzeichen egal, geprüft werden nur Beträge)
    const rechts = norm(kreuz(vor, [0, 0, 1]));
    const oben = norm(kreuz(rechts, vor));
    const halbV = Math.tan(C.FOV / 2 * Math.PI / 180), halbH = halbV * aspect;
    [b.x0, b.x1].forEach(function (x) {
      [b.y0, b.y1].forEach(function (y) {
        [b.z0, b.z1].forEach(function (z) {
          const d = sub([x, y, z], cam.pos);
          const f = punkt(d, vor);
          assert.ok(f > 0, 'Ecke vor der Kamera');
          assert.ok(Math.abs(punkt(d, rechts)) / f <= halbH + 1e-9, 'Ecke seitlich im Bild (aspect ' + aspect + ')');
          assert.ok(Math.abs(punkt(d, oben)) / f <= halbV + 1e-9, 'Ecke senkrecht im Bild (aspect ' + aspect + ')');
        });
      });
    });
  });
  // Ohne Körper gibt es trotzdem einen gültigen Stand
  assert.ok(C.fitCamera(null, 1));
});

test('Umschalter 2D / 3D / nebeneinander steht immer sichtbar in der Titelleiste', function () {
  const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
  const titel = html.slice(html.indexOf('<header class="titlebar">'), html.indexOf('</header>'));
  assert.ok(titel.length > 0, 'Titelleiste gefunden');
  ['layout-2d', 'layout-split', 'layout-3d'].forEach(function (aktion) {
    assert.ok(titel.indexOf('data-action="' + aktion + '"') >= 0, aktion + ' fehlt in der Titelleiste');
  });
});

test('Layout: unbekannte Werte werden zu "nebeneinander", Teilung begrenzt', function () {
  const { C } = kern();
  assert.equal(C.normMode('3d'), '3d');
  assert.equal(C.normMode('quer'), 'split');
  assert.equal(C.normSplit(0.01), 0.15);
  assert.equal(C.normSplit(NaN), 0.5);
});

test('Ansicht lädt ohne Three.js und DOM; ohne Three.js gibt es einen Hinweis statt eines Fehlers', function () {
  const { MF, win } = kern();
  const warnungen = [];
  win.console = { warn: function (t) { warnungen.push(t); }, log: function () {}, error: function () {} };
  const hinweis = { textContent: '', hidden: true };
  MF.view3d.init({}, hinweis);
  MF.view3d.setVisible(true);
  assert.equal(MF.view3d.ready, false);
  assert.equal(hinweis.hidden, false);
  assert.match(hinweis.textContent, /Draufsicht/);
  assert.equal(warnungen.length, 1);
});

// ---------- Über die Fassade: Kamera in der Datei ----------

test('3D-Kamera wird mit der Datei gespeichert und geladen', function () {
  const a = neueAnlage();
  assert.equal(a.datei().view.camera3d, null, 'Beispiel: noch kein Stand');
  a.kameraBewegen([1, 9.5, 6], [3.5, 2.25, 0.5]);
  assert.deepEqual(a.datei().view.camera3d, { pos: [1, 9.5, 6], target: [3.5, 2.25, 0.5] });

  const b = neueAnlage(a.datei());
  assert.deepEqual(b.kamera3d(), { pos: [1, 9.5, 6], target: [3.5, 2.25, 0.5] });
  assert.deepEqual(b.datei().view.camera3d, a.datei().view.camera3d);
});

test('3D-Kamera bewegen ist kein Schritt im Verlauf', function () {
  const a = neueAnlage();
  a.kameraBewegen([1, 9, 6], [3, 2, 0]);
  assert.equal(a.kannRueckgaengig(), false, 'nur Kamera bewegt');

  a.eigenschaft('B1', 'speed', 0.8);
  a.kameraBewegen([2, 8, 5], [3, 2, 0]);
  a.rueckgaengig();
  assert.equal(a.eigenschaft('B1', 'speed'), 0.5, 'Rückgängig nimmt die Modelländerung zurück');
  assert.deepEqual(a.kamera3d(), { pos: [2, 8, 5], target: [3, 2, 0] }, 'Kamera bleibt, wo sie ist');
  assert.equal(a.kannRueckgaengig(), false);
});

test('Datei ohne oder mit kaputtem Kamera-Stand lädt; die Ansicht passt dann ein', function () {
  const a = neueAnlage();
  const d = a.datei();
  delete d.view.camera3d;
  const b = neueAnlage(d);
  assert.equal(b.kamera3d(), null);

  d.view.camera3d = { pos: 'oben', target: [0, 0, 0] };
  assert.deepEqual(a.pruefen(d), []);
  const c = neueAnlage(d);
  assert.equal(c.kamera3d(), null);

  // Eine Datei ohne Stand ersetzt auch den Stand der vorigen Anlage
  a.kameraBewegen([1, 9, 6], [3, 2, 0]);
  assert.ok(a.laden(d));
  assert.equal(a.kamera3d(), null, 'neue Datei ersetzt den Stand der vorigen');
});

test('Laufzeitdaten der 3D-Ansicht landen nicht in der Datei', function () {
  const a = neueAnlage();
  a.kameraBewegen([1, 9, 6], [3, 2, 0]);
  a.laufen(6);
  assert.ok(a.kistenAnzahl() > 0);
  const d = a.datei();
  assert.deepEqual(Object.keys(d.view).sort(), ['camera3d', 'folded', 'grid', 'panX', 'panY', 'tags', 'zoom']);
  assert.deepEqual(Object.keys(d.view.camera3d), ['pos', 'target']);
  // Körper haben nur ihre Felder aus dem Dateiformat, nichts aus der Ansicht
  d.bodies.forEach(function (b) {
    assert.deepEqual(Object.keys(b), ['id', 'name', 'parent', 'template', 'kind', 'shape', 'pose', 'material',
      'surface', 'axis', 'sensor', 'spawner', 'sink', 'inputs', 'look']);
    assert.deepEqual(Object.keys(b.look).sort(), ['color', 'locked', 'visible']);
  });
  const text = JSON.stringify(d);
  ['mesh', 'geometry', 'three', 'items', 'boxMeshes'].forEach(function (wort) {
    assert.equal(text.indexOf('"' + wort + '"'), -1, wort);
  });
});
