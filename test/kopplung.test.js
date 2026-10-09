// Kopplung über den Strukturbaum (Phase 4): ein Körper hängt an einem anderen
// Körper, seine Lage ist relativ zu ihm und er bewegt sich mit. Höchstens zwei
// Ebenen, keine Kreise, nichts Dynamisches. Speichern, Laden und Undo erhalten sie.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { neueAnlage } = require('./helpers/anlage');

const LEER = { format: 'mini-fabrik', version: 3, name: 'Kopplung', settings: { dtMs: 20 },
  folders: [{ id: 'F1', name: 'Zelle', parent: null, area: 'plant' }], bodies: [], rules: [] };

function nahe(ist, soll, tol, text) {
  assert.ok(Math.abs(ist - soll) <= tol, (text || 'Wert') + ': ' + ist + ' statt ' + soll + ' ± ' + tol);
}

// Drehtisch DT1 bei (2 | 2) im Ordner F1, Block K1 (fest) 0,5 m rechts daneben
function aufbau() {
  const a = neueAnlage(LEER);
  a.anlegen('turntable', 2, 2);
  a.achse('DT1', { mode: 'position', min: -180, max: 180 });   // wie die Vorlage bis zum Handbetrieb-Branch
  a.verschieben(['DT1'], 'plant', 'F1');
  const k = a.formAnlegen('rect', { w: 0.2, d: 0.2, h: 0.1 }, { x: 2.5, y: 2, z: 0.7 });
  a.koerperart(k, 'static');
  return a;
}

test('Gekoppelter Körper bleibt beim Koppeln, wo er ist, und dreht mit dem Drehtisch mit', function () {
  const a = aufbau();
  assert.equal(a.koppeln('K1', 'DT1'), true);
  assert.equal(a.gekoppeltAn('K1'), 'DT1');
  assert.equal(a.eltern('K1'), 'DT1');
  assert.equal(a.ordnerVon('K1'), 'F1', 'liegt im Ordner seines Elternkörpers');
  // Lage in der Welt unverändert, gespeichert relativ zum Drehtisch
  const l = a.lage('K1');
  nahe(l.x, 2.5, 1e-6, 'x'); nahe(l.y, 2, 1e-6, 'y'); nahe(l.z, 0.7, 1e-6, 'z');
  const p = a.koerper('K1').pose;
  nahe(p.x, 0.5, 1e-6, 'relativ x'); nahe(p.z, 0.102, 1e-6, 'relativ z');
  // Im Baum direkt unter dem Drehtisch
  const reihe = a.baumReihenfolge('plant');
  assert.equal(reihe.indexOf('K1'), reihe.indexOf('DT1') + 1);

  a.setzen('DT1.Soll', 90);
  a.setzen('DT1.Freigabe', 1);
  a.laufen(1.5);
  assert.equal(a.signal('DT1.InPosition'), 1);
  const n = a.lage('K1');
  nahe(n.x, 2, 1e-6, 'x nach 90°'); nahe(n.y, 2.5, 1e-6, 'y nach 90°'); nahe(n.rot, 90, 1e-6, 'Drehung');
  assert.deepEqual(a.zeichenLage('K1'), n, 'Draufsicht und 3D zeigen dieselbe Lage');

  // Lösen: bleibt, wo er gerade ist
  assert.equal(a.koppeln('K1', null), true);
  assert.equal(a.gekoppeltAn('K1'), null);
  assert.equal(a.ordnerVon('K1'), 'F1');
  nahe(a.lage('K1').y, 2.5, 1e-6, 'nach dem Lösen');
});

test('Band auf dem Hubtisch fährt mit hoch und nimmt die Kiste mit', function () {
  const a = neueAnlage(LEER);
  a.anlegen('lift', 2, 2);
  a.funktion('HT1', 'Transportfläche', null);          // Tisch ohne eigenes Band
  const b = a.anlegen('conveyor', 2, 2);                 // Band oben auf dem Tisch
  a.form(b, { w: 0.6, z: 0.698 });
  assert.equal(a.koppeln(b, 'HT1'), true);
  a.setzen(b + '.Ein', 0);
  const q = a.anlegen('source', 2, 2);
  a.form(q, { z: 0.82 });
  a.eigenschaft(q, 'maxCount', 1);
  a.laufen(1);
  nahe(a.kisten3d()[0].z, 0.798 + 0.15, 0.005, 'Kiste liegt auf dem Band');

  a.setzen('HT1.Ausfahren', 1);
  a.laufen(2);
  assert.equal(a.signal('HT1.Ausgefahren'), 1);
  nahe(a.lage(b).z, 0.998, 1e-6, 'Band ist mitgefahren');
  nahe(a.kisten3d()[0].z, 1.098 + 0.15, 0.005, 'Kiste ist mitgefahren');

  // Das gekoppelte Band läuft: Kiste fährt nach rechts herunter
  a.setzen(b + '.Ein', 1);
  a.laufen(0.4);
  assert.ok(a.kisten()[0].x > 2.1, 'Band nimmt die Kiste mit: x = ' + a.kisten()[0].x);
});

test('Kreise, mehr als zwei Ebenen und dynamische Körper werden abgelehnt', function () {
  const a = aufbau();
  const c = a.formAnlegen('rect', { w: 0.2, d: 0.2 }, { x: 4, y: 4 });
  assert.equal(a.koppeln('K1', 'DT1'), true);
  assert.equal(a.koppeln('DT1', 'K1'), false, 'Kreis');
  assert.match(a.meldungen().pop(), /Kreis/);
  assert.equal(a.koppeln('K1', 'K1'), false, 'an sich selbst');
  assert.equal(a.koppeln(c, 'K1'), false, 'dritte Ebene');
  assert.match(a.meldungen().pop(), /zwei Ebenen/);
  assert.equal(a.koppeln('DT1', c), false, 'Drehtisch trägt schon K1');
  a.koerperart(c, 'dynamic');
  assert.equal(a.koppeln(c, 'DT1'), false, 'dynamisch');
  assert.match(a.meldungen().pop(), /dynamisch/);
  // Wird ein gekoppelter Körper dynamisch, löst sich die Kopplung
  a.koerperart('K1', 'dynamic');
  assert.equal(a.gekoppeltAn('K1'), null);
  nahe(a.lage('K1').x, 2.5, 1e-6, 'bleibt, wo er war');
});

test('Speichern und Laden erhält die Kopplung; validate() prüft sie', function () {
  const a = aufbau();
  a.koppeln('K1', 'DT1');
  const d = a.datei();
  assert.deepEqual(a.pruefen(d), []);
  const b = neueAnlage(d);
  assert.equal(b.gekoppeltAn('K1'), 'DT1');
  assert.deepEqual(b.koerper('K1'), a.koerper('K1'));

  const kreis = JSON.parse(JSON.stringify(d));
  kreis.bodies.forEach(function (x) { if (x.id === 'DT1') x.parent = 'K1'; });
  assert.ok(a.pruefen(kreis).some(function (e) { return /Kreis/.test(e); }), 'Kreis wird gemeldet');

  const tief = JSON.parse(JSON.stringify(d));
  tief.bodies.push(Object.assign({}, tief.bodies.filter(function (x) { return x.id === 'K1'; })[0], { id: 'K9', parent: 'K1' }));
  assert.ok(a.pruefen(tief).some(function (e) { return /zwei Ebenen/.test(e); }), 'dritte Ebene wird gemeldet');

  const weg = JSON.parse(JSON.stringify(d));
  weg.bodies.forEach(function (x) { if (x.id === 'K1') x.parent = 'GIBTSNICHT'; });
  assert.ok(a.pruefen(weg).length > 0, 'unbekannter Eltern wird gemeldet');
});

test('Koppeln ist ein Schritt im Verlauf; Löschen des Elternkörpers lässt das Kind stehen', function () {
  const a = aufbau();
  a.koppeln('K1', 'DT1');
  a.rueckgaengig();
  assert.equal(a.gekoppeltAn('K1'), null);
  assert.deepEqual(a.koerper('K1').pose, { x: 2.5, y: 2, z: 0.7, rot: 0 });
  a.wiederholen();
  assert.equal(a.gekoppeltAn('K1'), 'DT1');

  a.setzen('DT1.Soll', 90);
  a.setzen('DT1.Freigabe', 1);
  a.laufen(1.5);
  a.loeschen('DT1');
  assert.equal(a.gekoppeltAn('K1'), null);
  assert.equal(a.ordnerVon('K1'), 'F1', 'hängt eine Ebene höher');
  nahe(a.lage('K1').y, 2.5, 1e-6, 'bleibt, wo er gerade war');
});
