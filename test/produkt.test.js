// Quelle mit frei gestaltbarem Produkt: Der Erzeuger macht Teile in der Form seines
// Produkt-Körpers (Kiste, Zylinder, L-Profil …), der im Baum unter der Quelle hängt.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { neueAnlage, kopie } = require('./helpers/anlage');
const plaene = require('./helpers/plaene');

function nahe(ist, soll, tol, text) {
  assert.ok(Math.abs(ist - soll) <= tol, (text || '') + ': ' + ist + ' statt ' + soll + ' ± ' + tol);
}

// L-Profil 0,3 × 0,3 m, Schenkel 0,1 m (konkav), Ursprung in der Ecke des Hüllrechtecks
const L = [[0, 0], [0.3, 0], [0.3, 0.1], [0.1, 0.1], [0.1, 0.3], [0, 0.3]];
const L_FLAECHE = 0.3 * 0.1 + 0.1 * 0.2;

// Strecke Q1 → B1 (4 m, 0,5 m/s) → SE1 mit Lichtschranke LS1 bei x 2,75 m
function strecke() {
  return neueAnlage(plaene.strecke({ schranke: {} }));
}

// Flanken von LS1.Belegt zählen, während die Anlage läuft
function laufenMitSchranke(a, sekunden) {
  let vorher = a.signal('LS1.Belegt'), steigend = 0;
  a.laufenBis(function () {
    const v = a.signal('LS1.Belegt');
    if (v && !vorher) steigend++;
    vorher = v;
    return false;
  }, sekunden);
  return steigend;
}

test('Neue Quelle hat ein Produkt (Kiste 0,3 m, 5,4 kg), das im Baum direkt unter ihr hängt', function () {
  const a = neueAnlage();
  const q = a.anlegen('source', 1, 3);
  const p = a.produkt(q);
  assert.ok(p, 'Produkt angelegt');
  assert.equal(a.istProdukt(p), true);
  assert.equal(a.name(p), 'Produkt ' + q);
  assert.equal(a.koerperart(p), 'dynamic');
  const f = a.form(p);
  assert.deepEqual([f.typ, f.w, f.d, f.h, f.x, f.y, f.z, f.rot], ['rect', 0.3, 0.3, 0.3, 0, 0, 0, 0]);
  assert.equal(a.material(p).density, 200);
  nahe(a.produktMasse(p), 5.4, 1e-9, 'Masse');
  assert.deepEqual(a.signale(p), [], 'keine Signale');
  // Baum: direkt unter der Quelle; Produkte zählen nicht als Elemente der Anlage
  const reihe = a.baumReihenfolge('plant');
  assert.equal(reihe.indexOf(p), reihe.indexOf(q) + 1);
  assert.equal(a.eltern(p), q);
  assert.equal(a.elemente().indexOf(p), -1);
  // Lage in der Welt: an der Quelle
  const lq = a.lage(q), lp = a.lage(p);
  assert.deepEqual([lp.x, lp.y, lp.z], [lq.x, lq.y, lq.z]);
  // Die Beispielanlage hat es auch
  assert.equal(a.produkt('Q1'), 'P1');
});

test('Alte Dateien (Version 1 und 3 mit Kistenvorlage) bekommen beim Laden ein Produkt und laufen genau wie mit Produkt', function () {
  // Version 1: wie bisher migriert, das Produkt ist die Standard-Kiste
  const v1 = strecke();
  assert.equal(v1.produkt('Q1'), 'P1');
  assert.deepEqual(v1.form('P1'), { typ: 'rect', w: 0.3, d: 0.3, h: 0.3, x: 0, y: 0, z: 0, rot: 0 });

  // Version 3 wie bis 09.10.2026 gespeichert: spawner.template statt Produkt-Körper,
  // hier mit kleinerer, schwererer, roter Kiste
  const d = v1.datei();
  const q1 = d.bodies.find(function (b) { return b.id === 'Q1'; });
  d.bodies = d.bodies.filter(function (b) { return b.id !== 'P1'; });
  delete q1.spawner.product;
  q1.spawner.template = { shape: { type: 'rect', w: 0.2, d: 0.25, h: 0.15 }, material: { friction: 0.6, restitution: 0, density: 300 },
    look: { color: '#AA3311' } };
  assert.deepEqual(v1.pruefen(d), [], 'alte Datei ist gültig');
  const alt = neueAnlage(d);
  const p = alt.produkt('Q1');
  assert.deepEqual(alt.form(p), { typ: 'rect', w: 0.2, d: 0.25, h: 0.15, x: 0, y: 0, z: 0, rot: 0 });
  assert.equal(alt.material(p).density, 300);
  assert.equal(alt.koerper(p).look.color, '#AA3311');
  assert.equal(alt.koerper('Q1').spawner.template, undefined, 'die Kistenvorlage gibt es danach nicht mehr');

  // Dieselbe Anlage mit dem Produkt als Körper (so wie sie jetzt gespeichert wird) läuft bitgenau gleich
  const neu = neueAnlage(alt.datei());
  alt.laufen(12);
  neu.laufen(12);
  assert.ok(alt.kistenAnzahl() > 0);
  assert.deepEqual(neu.kisten3d(), alt.kisten3d());
  assert.equal(neu.signal('SE1.Anzahl'), alt.signal('SE1.Anzahl'));
  nahe(alt.teile()[0].masse, 0.2 * 0.25 * 0.15 * 300, 1e-6, 'Masse aus der Vorlage');
});

test('Produkt Kreis r 0,1 m, h 0,2 m: Teile sind Zylinder mit dieser Masse, fahren mit Bandtempo, LS1 sieht sie, SE1 zählt sie', function () {
  const a = strecke();
  assert.equal(a.form('P1', { typ: 'circle', r: 0.1, h: 0.2 }), true);
  assert.deepEqual(a.form('P1'), { typ: 'circle', r: 0.1, h: 0.2, x: 0, y: 0, z: 0, rot: 0 });
  nahe(a.produktMasse('P1'), Math.PI * 0.01 * 0.2 * 200, 1e-9, 'Masse im Panel');

  const flanken = laufenMitSchranke(a, 4);
  const t = a.teile();
  assert.ok(t.length >= 2);
  t.forEach(function (x) {
    assert.equal(x.form, 'circle');
    assert.equal(x.produkt, 'P1');
    assert.equal(x.quelle, 'Q1');
    nahe(x.h, 0.2, 1e-12, 'Höhe');
    nahe(x.masse, Math.PI * 0.01 * 0.2 * 200, 0.02, 'Masse aus der Physik');   // Rapier: Zylinder, float32
  });
  // Liegt auf dem Band: Mittelpunkt auf halber Höhe über der Oberkante (0,7 m)
  nahe(t[0].z, 0.7 + 0.1, 0.01, 'z');
  // Tempo in Laufrichtung: 0,5 m/s ± 5 %
  const v = a.kistenTempo()[0];
  nahe(v.x, 0.5, 0.025, 'Tempo');
  nahe(v.y, 0, 0.025, 'quer');

  const mehr = laufenMitSchranke(a, 16);
  assert.ok(flanken + mehr >= 7, 'LS1 sieht die Dosen: ' + (flanken + mehr));
  assert.ok(a.signal('SE1.Anzahl') >= 6, 'SE1 zählt: ' + a.signal('SE1.Anzahl'));
  assert.ok(Math.abs(a.signal('SE1.Anzahl') - (flanken + mehr)) <= 2, 'jede Dose an LS1 kommt in SE1 an');
});

test('Produkt L-Polygon (konkav): Teile in L-Form, Masse aus der Fläche, Mittelpunkt im Schwerpunkt, Senke zählt sie', function () {
  const a = strecke();
  assert.equal(a.form('P1', { typ: 'polygon', punkte: L, h: 0.15 }), true);
  assert.equal(a.form('P1').typ, 'polygon');
  nahe(a.produktMasse('P1'), L_FLAECHE * 0.15 * 200, 1e-9, 'Masse im Panel');

  a.laufen(0.05);   // erstes Teil liegt auf
  const t = a.teile();
  assert.equal(t.length, 1);
  assert.equal(t[0].form, 'polygon');
  nahe(t[0].masse, L_FLAECHE * 0.15 * 200, 1e-3, 'Masse aus der Physik');
  // Mittelpunkt = Flächenschwerpunkt des L an der Lage der Quelle (Ursprung der Punkte)
  const sx = (0.3 * 0.1 * 0.15 + 0.1 * 0.2 * 0.05) / L_FLAECHE, sy = (0.3 * 0.1 * 0.05 + 0.1 * 0.2 * 0.2) / L_FLAECHE;
  const q = a.lage('Q1');
  nahe(t[0].x, q.x + sx, 0.002, 'x'); nahe(t[0].y, q.y + sy, 0.002, 'y');

  const flanken = laufenMitSchranke(a, 20);
  assert.ok(a.signal('SE1.Anzahl') >= 6, 'SE1: ' + a.signal('SE1.Anzahl'));
  assert.ok(flanken >= 7, 'LS1: ' + flanken);
  a.teile().forEach(function (x) { assert.equal(x.form, 'polygon'); });
});

test('Drehung des Produkts ist die Startdrehung der Teile; die Lage relativ zur Quelle ist der Ablageort', function () {
  const a = strecke();
  a.form('P1', { w: 0.4, d: 0.2, rot: 30, x: 0.05 });
  a.laufen(0.05);
  nahe(a.kistenDrehung()[0], 30, 0.5, 'Startdrehung');
  const q = a.lage('Q1');
  nahe(a.kisten()[0].x, q.x + 0.05, 0.002, 'Versatz');
  // Die Quelle gedreht: Teile drehen mit (Drehung der Quelle + Drehung des Produkts)
  const b = strecke();
  b.form('Q1', { rot: 90 });
  b.form('P1', { rot: 30 });
  b.laufen(0.05);
  nahe(b.kistenDrehung()[0], 120, 0.5, 'mit der Quelle');
});

test('Das Produkt simuliert nicht mit: keine Kollision, keine Schwerkraft, die Teile entstehen trotzdem genau dort', function () {
  const a = strecke();
  a.form('P1', { typ: 'circle', r: 0.1, h: 0.2 });
  const vorher = a.lage('P1');
  a.laufen(5);
  assert.deepEqual(a.lage('P1'), vorher, 'fällt nicht herunter');
  assert.deepEqual(a.zeichenLage('P1'), vorher);
  // Läge das Produkt als Körper in der Welt, wäre der Platz nie frei und es entstünde kein Teil
  assert.ok(a.signal('Q1.Erzeugt') >= 3);
  // Band steht: das erste Teil bleibt liegen, die Quelle wartet ("nur wenn Platz frei", mit der echten Form)
  const b = strecke();
  b.form('P1', { typ: 'circle', r: 0.1, h: 0.2 });
  b.eigenschaft('Q1', 'interval', 0.5);
  b.setzen('B1.Ein', 0);
  b.laufen(5);
  assert.equal(b.signal('Q1.Erzeugt'), 1);
  assert.equal(b.kistenAnzahl(), 1);
  // Ein Teil daneben (außerhalb der Form + 5 mm) hält die Quelle nicht auf
  const c = strecke();
  c.form('P1', { typ: 'circle', r: 0.1, h: 0.2, y: -0.12 });
  c.eigenschaft('Q1', 'interval', 0.5);
  c.setzen('B1.Ein', 0);
  c.laufen(1);
  c.form('P1', { y: 0.12 });   // nächstes Teil daneben: 4 cm Luft zum ersten
  c.laufen(1);
  assert.equal(c.signal('Q1.Erzeugt'), 2);
});

test('Produkt lässt sich nicht einzeln löschen, nicht umhängen und trägt nichts', function () {
  const a = neueAnlage();
  assert.equal(a.loeschen('P1'), false);
  assert.match(a.meldungen().pop(), /lässt sich nicht einzeln löschen/);
  assert.equal(a.produkt('Q1'), 'P1');
  // Ziehen im Baum: bleibt unter der Quelle
  const f = a.ordnerAnlegen('plant', null, 'Neu');
  assert.equal(a.verschieben(['P1'], 'plant', f), 0);
  assert.equal(a.eltern('P1'), 'Q1');
  assert.equal(a.koppeln('P1', 'B1'), false);
  assert.equal(a.eltern('P1'), 'Q1');
  // Quelle samt Produkt verschieben: Produkt bleibt darunter
  assert.equal(a.verschieben(['Q1'], 'plant', f), 1);
  assert.equal(a.eltern('P1'), 'Q1');
  assert.equal(a.ordnerVon('P1'), f);
  // Nichts an ein Produkt koppeln, Produkt bleibt dynamisch, keine Funktionen
  const k = a.formAnlegen('rect', { w: 0.1, d: 0.1 }, { x: 1.75, y: 2.25, z: 1 });
  assert.equal(a.koppeln(k, 'P1'), false);
  assert.deepEqual(a.koerperart('P1', 'static'), []);
  assert.equal(a.koerperart('P1'), 'dynamic');
  assert.equal(a.funktion('P1', 'Sensor', {}), false);
  assert.equal(a.duplizieren('P1'), null);
  // Die Quelle lässt sich weiter koppeln (das Produkt zählt nicht als gekoppelter Körper)
  const dt = a.anlegen('turntable', 8, 2);
  assert.equal(a.koppeln('Q1', dt), true);
  assert.equal(a.eltern('P1'), 'Q1');
  assert.deepEqual(a.pruefen(a.datei()), []);
});

test('Quelle löschen, duplizieren und Rückgängig nehmen das Produkt mit', function () {
  const a = neueAnlage();
  a.form('P1', { typ: 'circle', r: 0.12, h: 0.25, rot: 15 });
  a.material('P1', { density: 350 });

  // Duplizieren: Kopie mit eigenem Produkt in derselben Form
  const q2 = a.duplizieren('Q1');
  const p2 = a.produkt(q2);
  assert.ok(p2 && p2 !== 'P1');
  assert.equal(a.eltern(p2), q2);
  assert.deepEqual(a.form(p2), a.form('P1'));
  assert.equal(a.material(p2).density, 350);
  assert.equal(a.name(p2), 'Produkt ' + q2);

  // Löschen: Produkt geht mit; Rückgängig bringt beides zurück
  assert.equal(a.loeschen('Q1'), true);
  assert.equal(a.elemente().indexOf('Q1'), -1);
  assert.throws(function () { a.produkt('Q1'); });
  assert.throws(function () { a.form('P1'); }, /P1/);
  a.rueckgaengig();
  assert.equal(a.produkt('Q1'), 'P1');
  assert.equal(a.form('P1').typ, 'circle');
  a.wiederholen();
  assert.throws(function () { a.form('P1'); });
  a.rueckgaengig();

  // Erzeuger als Funktion an einem gezeichneten Körper: Produkt kommt und geht mit der Funktion
  const k = a.formAnlegen('rect', { w: 0.5, d: 0.5 }, { x: 8, y: 2, z: 0.72 });
  assert.equal(a.funktion(k, 'Erzeuger', {}), true);
  const pk = a.produkt(k);
  assert.ok(pk);
  a.funktion(k, 'Erzeuger', null);
  assert.equal(a.produkt(k), null);
  assert.throws(function () { a.form(pk); });
  a.rueckgaengig();
  assert.equal(a.produkt(k), pk);
  // Körperart weg von "immateriell" entfernt den Erzeuger und damit das Produkt
  assert.deepEqual(a.koerperart(k, 'static'), ['Erzeuger']);
  assert.throws(function () { a.form(pk); });
  assert.deepEqual(a.pruefen(a.datei()), []);
});

test('Speichern und Laden: Produkt mit Form, Werkstoff und Farbe bleibt, die Datei prüft die Zuordnung', function () {
  const a = neueAnlage();
  a.form('P1', { typ: 'polygon', punkte: L, h: 0.12 });
  a.material('P1', { density: 420 });
  a.umbenennen('P1', 'Winkel');
  const d = a.datei();
  const q1 = d.bodies.find(function (b) { return b.id === 'Q1'; });
  assert.equal(q1.spawner.product, 'P1');
  assert.equal(q1.spawner.template, undefined);
  const b = neueAnlage(d);
  assert.deepEqual(b.datei(), d);
  assert.equal(b.name('P1'), 'Winkel');
  b.laufen(10);
  a.laufen(10);
  assert.deepEqual(b.kisten3d(), a.kisten3d());

  // Kaputte Zuordnungen werden abgelehnt
  function mit(fn) { const x = kopie(d); fn(x); return a.pruefen(x); }
  assert.match(mit(function (x) { x.bodies.find(function (k) { return k.id === 'Q1'; }).spawner.product = 'P9'; }).join(), /Produkt "P9" gibt es nicht/);
  assert.match(mit(function (x) { x.bodies.find(function (k) { return k.id === 'P1'; }).kind = 'static'; }).join(), /muss dynamisch sein/);
  assert.match(mit(function (x) { x.bodies.find(function (k) { return k.id === 'P1'; }).sensor = { invert: false, debounce: 0 }; }).join(), /keine Funktionen/);
  assert.match(mit(function (x) { x.bodies.find(function (k) { return k.id === 'P1'; }).parent = 'F1'; }).join(), /muss im Baum unter dem Erzeuger hängen/);
  assert.match(mit(function (x) { x.bodies.find(function (k) { return k.id === 'B1'; }).parent = 'P1'; }).join(), /an das Produkt "P1" lässt sich nichts koppeln/);
});

test('Zwei Quellen mit verschiedenen Produkten auf einem Band: Kisten und Dosen', function () {
  const a = neueAnlage({ format: 'mini-fabrik', version: 3, name: 'Kisten und Dosen', settings: { dtMs: 20 }, folders: [], bodies: [], rules: [] });
  const b = a.anlegen('conveyor', 2.5, 1);
  a.form(b, { w: 4 });
  const q1 = a.anlegen('source', 0.75, 1);
  const q2 = a.anlegen('source', 1.75, 1);
  a.eigenschaft(q2, 'interval', 2);
  a.form(a.produkt(q2), { typ: 'circle', r: 0.08, h: 0.2 });
  a.anlegen('sink', 4.75, 1);
  a.laufen(20);
  const formen = {};
  a.teile().forEach(function (t) { formen[t.quelle] = t.form; });
  assert.equal(formen[q1], 'rect');
  assert.equal(formen[q2], 'circle');
  assert.ok(a.signal('SE1.Anzahl') >= 8, 'SE1: ' + a.signal('SE1.Anzahl'));
  assert.ok(a.signal(q2 + '.Erzeugt') >= 4, 'Dosen erzeugt: ' + a.signal(q2 + '.Erzeugt'));
});

test('3D-Ansicht: Produkt halbtransparent an der Quelle, Teile als Prisma ihrer Form um den Mittelpunkt', function () {
  const { laden } = require('./helpers/load');
  const MF = laden().MF;
  const p = MF.store.findBody('P1');
  const lk = MF.view3dCore.look(p, false);
  assert.equal(lk.solid, false);
  assert.ok(lk.opacity > 0 && lk.opacity < 1);
  // Schlüssel ändert sich mit der Form (Mesh wird neu gebaut)
  const k0 = MF.view3dCore.bodyKey(p);
  MF.setForm(p, { type: 'circle', r: 0.1 });
  assert.notEqual(MF.view3dCore.bodyKey(p), k0);
  // L-Profil um den Schwerpunkt gelegt: Prisma hat dieselbe Fläche, Schwerpunkt bei 0
  const c = MF.geom.centered({ type: 'polygon', points: L, h: 0.15 });
  const s = MF.geom.centroid(c);
  nahe(s.x, 0, 1e-12, 'x'); nahe(s.y, 0, 1e-12, 'y');
  nahe(MF.geom.area(c), L_FLAECHE, 1e-12, 'Fläche');
  const prism = MF.view3dCore.prism(c);
  assert.ok(prism.position.length > 0 && prism.index.length % 3 === 0);
});
