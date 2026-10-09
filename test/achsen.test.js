// Achsen (Phase 4): linear und rotatorisch, Betriebsarten zweipunkt, position,
// geschwindigkeit, Achse in der Draufsicht ziehen, neue Vorlagen im Katalog
// (Drehtisch, Hubtisch, Stopper, Weiche) und was sie mit Kisten machen.
// Geprüft wird Soll-Verhalten über die Fassade (Meter, Grad, Signale).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { neueAnlage } = require('./helpers/anlage');

// Leere Anlage, SPS-Zyklus 20 ms
const LEER = { format: 'mini-fabrik', version: 3, name: 'Achsen', settings: { dtMs: 20 }, folders: [], bodies: [], rules: [] };

// Förderband aus dem Katalog: Mitte (x, y), Länge w, Drehung rot, Oberkante top
function band(a, x, y, w, rot, top) {
  const id = a.anlegen('conveyor', x, y);
  a.form(id, { w: w, rot: rot || 0, z: (top === undefined ? 0.7 : top) - 0.1 });
  return id;
}

function nahe(ist, soll, tol, text) {
  assert.ok(Math.abs(ist - soll) <= tol, (text || 'Wert') + ': ' + ist + ' statt ' + soll + ' ± ' + tol);
}

// Winkelabstand in Grad (−180 … 180)
function winkel(a, b) { return ((a - b) % 360 + 540) % 360 - 180; }

// Drehtisch in Betriebsart position, −180 … 180° – so kam er bis zum Handbetrieb-Branch
// aus dem Katalog (seitdem zweipunkt 0 … 90°). Für Tests der Betriebsart position.
function drehtischPosition(a, x, y) {
  const id = a.anlegen('turntable', x, y);
  assert.equal(a.achse(id, { mode: 'position', min: -180, max: 180 }), true);
  return id;
}

// ---------- Drehtisch per SCL (Abnahmekriterium des Umbaus, Konzept Abschnitt 5) ----------

test('Drehtisch per SCL auf 90°: erreicht 90° ± Toleranz, meldet InPosition und fährt nie schneller als vmax', function () {
  const a = neueAnlage(LEER);
  const dt = drehtischPosition(a, 2, 2);
  assert.equal(dt, 'DT1');
  const vmax = a.achse('DT1').vmax;
  assert.equal(a.achse('DT1').type, 'rotary');
  assert.equal(a.achse('DT1').mode, 'position');

  const r = a.neuerScl('DT1.Soll := 90.0;\nDT1.Freigabe := TRUE;');
  assert.equal(a.sclFehler(r), null);

  let vorher = a.signal('DT1.Ist'), schnellste = 0, unterwegs = false;
  const t = a.laufenBis(function () {
    const ist = a.signal('DT1.Ist');
    schnellste = Math.max(schnellste, Math.abs(ist - vorher) / 0.02);
    vorher = ist;
    if (ist > 1 && ist < 89) unterwegs = unterwegs || a.signal('DT1.InPosition') === 0;
    return a.signal('DT1.InPosition') === 1 && ist > 45;
  }, 5);
  assert.notEqual(t, null, 'Drehtisch kommt nicht an');
  assert.ok(unterwegs, 'InPosition ist während der Fahrt 0');
  nahe(a.signal('DT1.Ist'), 90, 0.1, 'Ist');
  nahe(winkel(a.lage('DT1').rot, 90), 0, 0.1, 'Drehung in der Welt');
  assert.ok(schnellste <= vmax + 1e-6, 'zu schnell: ' + schnellste + ' °/s bei vmax ' + vmax);
  nahe(t, 90 / vmax, 0.05, 'Fahrzeit');

  // Bleibt stehen und in Position
  a.laufen(1);
  assert.equal(a.signal('DT1.InPosition'), 1);
  nahe(a.signal('DT1.Ist'), 90, 0.1, 'Ist nach 1 s');
});

test('Betriebsart position: ohne Freigabe keine Bewegung, Grenzen gelten immer', function () {
  const a = neueAnlage(LEER);
  drehtischPosition(a, 2, 2);
  assert.equal(a.signal('DT1.InPosition'), 1, 'Grundstellung 0 = Soll 0');
  a.setzen('DT1.Soll', 90);
  assert.equal(a.signal('DT1.InPosition'), 0);
  a.laufen(2);
  assert.equal(a.signal('DT1.Ist'), 0, 'ohne Freigabe bleibt die Achse stehen');

  // Freigabe weg mitten in der Fahrt: bleibt, wo sie ist
  a.setzen('DT1.Freigabe', 1);
  a.laufen(0.5);
  const halb = a.signal('DT1.Ist');
  nahe(halb, 45, 1, 'nach 0,5 s bei 90 °/s');
  a.setzen('DT1.Freigabe', 0);
  a.laufen(1);
  assert.equal(a.signal('DT1.Ist'), halb);

  // Soll außerhalb der Grenzen: fährt bis an die Grenze, ist dort aber nicht "in Position"
  a.achse('DT1', { min: -90, max: 120 });
  a.setzen('DT1.Soll', 500);
  a.setzen('DT1.Freigabe', 1);
  a.laufen(3);
  assert.equal(a.signal('DT1.Ist'), 120);
  assert.equal(a.signal('DT1.InPosition'), 0);
  a.setzen('DT1.Soll', -500);
  a.laufen(4);
  assert.equal(a.signal('DT1.Ist'), -90);
});

test('Betriebsart geschwindigkeit: fährt mit Soll (höchstens vmax) und bleibt an den Grenzen stehen', function () {
  const a = neueAnlage(LEER);
  drehtischPosition(a, 2, 2);
  assert.equal(a.feld('DT1', 'Achse', 'mode', 'geschwindigkeit'), true);
  assert.deepEqual(a.signale('DT1'), ['Ein', 'Läuft', 'Tempo', 'Soll', 'Freigabe', 'Ist']);
  a.achse('DT1', { min: 0, max: 90 });

  a.setzen('DT1.Soll', 30);
  a.laufen(1);
  assert.equal(a.signal('DT1.Ist'), 0, 'ohne Freigabe keine Bewegung');
  a.setzen('DT1.Freigabe', 1);
  a.laufen(1);
  nahe(a.signal('DT1.Ist'), 30, 0.01, 'nach 1 s mit 30 °/s');
  a.laufen(5);
  assert.equal(a.signal('DT1.Ist'), 90, 'steht an der Grenze max');

  // Soll über vmax: begrenzt auf vmax (90 °/s), rückwärts bis an min
  a.setzen('DT1.Soll', -1000);
  a.laufen(0.5);
  nahe(a.signal('DT1.Ist'), 45, 0.01, 'mit vmax zurück');
  a.laufen(2);
  assert.equal(a.signal('DT1.Ist'), 0, 'steht an der Grenze min');

  // Linear (Hubtisch) ebenso, Werte in m bzw. m/s
  const ht = a.anlegen('lift', 5, 2);
  a.achse(ht, { mode: 'geschwindigkeit' });
  a.setzen(ht + '.Soll', 0.1);
  a.setzen(ht + '.Freigabe', 1);
  a.laufen(1);
  nahe(a.signal(ht + '.Ist'), 0.1, 1e-6, 'Hubtisch nach 1 s');
  nahe(a.lage(ht).z, 0.6 + 0.1, 1e-6, 'Hubtisch fährt nach oben');
  a.laufen(5);
  assert.equal(a.signal(ht + '.Ist'), 0.3, 'steht oben (max)');
});

test('Rotatorische Achse dreht um ihren Ursprung, Drehsinn aus der Richtung', function () {
  const a = neueAnlage(LEER);
  const w = a.anlegen('diverter', 2, 2);   // Arm 0,8 m, dreht um sein linkes Ende
  assert.equal(a.achse(w).origin[0], -0.4);
  a.setzen(w + '.Ausfahren', 1);
  a.laufen(1);
  assert.equal(a.signal(w + '.Ausgefahren'), 1);
  const l = a.lage(w);
  // Mitte des Arms: Drehpunkt (1,6 | 2) + 0,4 m unter 45° (im Uhrzeigersinn, also nach unten)
  nahe(l.x, 1.6 + 0.4 * Math.SQRT1_2, 1e-6, 'x');
  nahe(l.y, 2 + 0.4 * Math.SQRT1_2, 1e-6, 'y');
  nahe(l.rot, 45, 1e-6, 'Drehung');

  // Gegen den Uhrzeigersinn: Richtung [0, 0, −1]
  a.feld(w, 'Achse', 'turn', 'Gegenuhrzeigersinn');
  assert.deepEqual(a.achse(w).dir, [0, 0, -1]);
  a.laufen(0.1);
  nahe(a.lage(w).rot, 315, 1e-6, 'Drehung gegen den Uhrzeigersinn');
  nahe(a.lage(w).y, 2 - 0.4 * Math.SQRT1_2, 1e-6, 'y nach oben');
  assert.equal(a.zeichenLage(w).rot, a.lage(w).rot, 'Draufsicht und 3D zeigen dieselbe Lage');
});

// ---------- Typ und Betriebsart im Panel ----------

test('Typ und Betriebsart sind wählbar, die Signale passen sich an; der Schieber bleibt wie er war', function () {
  const a = neueAnlage();
  assert.deepEqual(a.signale('S1'), ['Ausfahren', 'Ausgefahren', 'Eingefahren', 'Ist']);
  assert.ok(a.felder('S1', 'Achse').indexOf('type') >= 0 && a.felder('S1', 'Achse').indexOf('mode') >= 0);
  assert.ok(a.felder('S1', 'Achse').indexOf('returnDelay') >= 0, 'zweipunkt hat einen Rückfahrverzug');

  assert.equal(a.feld('S1', 'Achse', 'mode', 'position'), true);
  assert.deepEqual(a.signale('S1'), ['Soll', 'Freigabe', 'Ist', 'InPosition']);
  assert.equal(a.felder('S1', 'Achse').indexOf('returnDelay'), -1, 'position: kein Rückfahrverzug');
  // R1 schrieb S1.Ausfahren – das Signal gibt es nicht mehr, die Regel verliert den Bezug
  assert.equal(a.regel('R1').then, '');

  // Typ wechseln: rotatorisch mit Grenzen in Grad
  assert.equal(a.feld('S1', 'Achse', 'type', 'rotary'), true);
  const ax = a.achse('S1');
  assert.equal(ax.type, 'rotary');
  assert.deepEqual(ax.dir, [0, 0, 1]);
  assert.equal(ax.max, 90);
  assert.equal(a.feld('S1', 'Achse', 'min'), 0);

  // Zurück: rückgängig stellt den Schieber wieder her (Signale und Regel)
  a.rueckgaengig();
  a.rueckgaengig();
  assert.equal(a.achse('S1').type, 'linear');
  assert.equal(a.achse('S1').mode, 'zweipunkt');
  assert.deepEqual(a.signale('S1'), ['Ausfahren', 'Ausgefahren', 'Eingefahren', 'Ist']);
  assert.equal(a.regel('R1').then, 'S1.Ausfahren');
});

test('Achse ändern prüft die Werte; Achse am Griff ziehen ist ein Schritt im Verlauf', function () {
  const a = neueAnlage(LEER);
  drehtischPosition(a, 2, 2);
  assert.equal(a.achse('DT1', { min: 10, max: 5 }), false);
  assert.match(a.meldungen().pop(), /max ist kleiner als min/);
  assert.equal(a.achse('DT1', { dir: [1, 0, 0] }), false);
  assert.match(a.meldungen().pop(), /Hochachse/);
  assert.equal(a.achse('DT1', { mode: 'schnell' }), false);
  assert.equal(a.achse('DT1').max, 180, 'abgelehnt: nichts geändert');

  // Grenze max am Griff in drei Zwischenständen ziehen, Ursprung verschieben
  assert.equal(a.achseZiehen('DT1', [{ max: 100 }, { max: 110 }, { max: 120 }]), 0);
  assert.equal(a.achse('DT1').max, 120);
  assert.equal(a.achseZiehen('DT1', [{ origin: [0.1, 0, 0] }, { origin: [0.2, 0, 0] }]), 0);
  a.rueckgaengig();
  assert.deepEqual(a.achse('DT1').origin, [0, 0, 0]);
  assert.equal(a.achse('DT1').max, 120);
  a.rueckgaengig();
  assert.equal(a.achse('DT1').max, 180);
  a.wiederholen();
  assert.equal(a.achse('DT1').max, 120);
});

// ---------- Neue Vorlagen ----------

test('Drehtisch, Hubtisch, Stopper und Weiche stehen im Katalog und ergeben gültige Körper', function () {
  const a = neueAnlage(LEER);
  const v = {};
  a.vorlagen().forEach(function (t) { v[t.key] = t; });
  const erwartet = {
    turntable: ['DT1', 'Drehtisch', ['Ein', 'Läuft', 'Tempo', 'Ausfahren', 'Ausgefahren', 'Eingefahren', 'Ist']],
    lift: ['HT1', 'Hubtisch', ['Ein', 'Läuft', 'Tempo', 'Ausfahren', 'Ausgefahren', 'Eingefahren', 'Ist']],
    stopper: ['ST1', 'Stopper', ['Ausfahren', 'Ausgefahren', 'Eingefahren', 'Ist']],
    diverter: ['W1', 'Weiche', ['Ausfahren', 'Ausgefahren', 'Eingefahren', 'Ist']]
  };
  Object.keys(erwartet).forEach(function (k, i) {
    assert.ok(v[k], 'Vorlage ' + k + ' fehlt');
    assert.equal(v[k].label, erwartet[k][1]);
    assert.ok(v[k].group && v[k].icon && v[k].hint.length > 20, k + ': Gruppe, Symbol und Hinweis');
    const id = a.anlegen(k, 2 * i, 0);
    assert.equal(id, erwartet[k][0]);
    assert.equal(a.koerperart(id), 'kinematic');
    assert.deepEqual(a.signale(id), erwartet[k][2]);
  });
  // Alle Vorlagen beschreiben sich vollständig (auch die alten)
  Object.keys(v).forEach(function (k) { assert.ok(v[k].group && v[k].icon && v[k].prefix && v[k].hint, k); });
  // Signalnamen je Körper eindeutig, Datei gültig, Laden ergibt dasselbe
  a.elemente().forEach(function (id) {
    const s = a.signale(id);
    assert.equal(new Set(s).size, s.length, id + ': Signalnamen doppelt');
  });
  const d = a.datei();
  assert.deepEqual(a.pruefen(d), []);
  const b = neueAnlage(d);
  assert.deepEqual(b.datei().bodies, d.bodies);
});

// ---------- Kisten auf bewegten Körpern ----------

test('Kiste fährt auf den Drehtisch, der Tisch dreht 90°, die Kiste dreht mit und läuft auf das abgehende Band', function () {
  const a = neueAnlage(LEER);
  const q = a.anlegen('source', 0.5, 2);
  a.eigenschaft(q, 'maxCount', 1);
  band(a, 1, 2, 2);                          // zuführend nach rechts bis x = 2
  drehtischPosition(a, 2.4, 2);              // r = 0,4 m, Oberkante 0,7 m (bündig mit dem Band)
  band(a, 2.4, 3.4, 2, 90);                  // abgehend nach unten, bündig
  const se = a.anlegen('sink', 2.4, 4.65);

  // Kiste fährt auf den Tisch; mittig angekommen hält das Band auf dem Tisch an
  assert.notEqual(a.laufenBis(function () { return a.kistenAnzahl() === 1 && a.kisten()[0].x >= 2.4; }, 10), null);
  a.setzen('DT1.Ein', 0);
  a.laufen(0.3);
  const vorher = a.kisten()[0];
  nahe(vorher.x, 2.4, 0.05, 'Kiste mittig auf dem Tisch (x)');
  nahe(a.kistenDrehung()[0] > 180 ? a.kistenDrehung()[0] - 360 : a.kistenDrehung()[0], 0, 1, 'Kiste gerade');

  // Tisch dreht um 90°: Kiste dreht mit und wandert mit ihrem Punkt auf dem Tisch
  a.setzen('DT1.Soll', 90);
  a.setzen('DT1.Freigabe', 1);
  assert.notEqual(a.laufenBis(function () { return a.signal('DT1.InPosition') === 1; }, 3), null);
  a.laufen(0.1);
  nahe(winkel(a.kistenDrehung()[0], 90), 0, 3, 'Kiste dreht mit');
  const k = a.kisten()[0];
  nahe(k.x, 2.4 - (vorher.y - 2), 0.02, 'x nach der Drehung');
  nahe(k.y, 2 + (vorher.x - 2.4), 0.02, 'y nach der Drehung');
  assert.ok(a.kisten3d()[0].z > 0.83, 'liegt noch auf dem Tisch');

  // Band auf dem Tisch läuft jetzt nach unten: Kiste fährt auf das abgehende Band in die Senke
  a.setzen('DT1.Ein', 1);
  assert.notEqual(a.laufenBis(function () { return a.signal(se + '.Anzahl') === 1; }, 10), null, 'Kiste kommt nicht in der Senke an');
});

test('Hubtisch hebt eine Kiste auf die Höhe eines zweiten Bands, die Kiste fährt weiter', function () {
  const a = neueAnlage(LEER);
  const q = a.anlegen('source', 0.5, 2);
  a.eigenschaft(q, 'maxCount', 1);
  band(a, 1, 2, 2);                          // unten, Oberkante 0,7 m
  a.anlegen('lift', 2.3, 2);                 // Hub 0,3 m: Oberkante 0,7 -> 1,0 m
  band(a, 3.6, 2, 2, 0, 1.0);                // oben, bündig mit dem gehobenen Tisch
  const se = a.anlegen('sink', 4.85, 2);
  a.form(se, { h: 0.85 });

  assert.notEqual(a.laufenBis(function () { return a.kistenAnzahl() === 1 && a.kisten()[0].x >= 2.3; }, 10), null);
  a.setzen('HT1.Ein', 0);
  a.setzen('HT1.Ausfahren', 1);
  assert.notEqual(a.laufenBis(function () { return a.signal('HT1.Ausgefahren') === 1; }, 3), null);
  a.laufen(0.2);
  nahe(a.kisten3d()[0].z, 1.0 + 0.15, 0.005, 'Kiste liegt oben auf dem Tisch');
  nahe(a.kisten()[0].x, 2.3, 0.05, 'Kiste ist nicht verrutscht');

  a.setzen('HT1.Ein', 1);
  const t = a.laufenBis(function () { return a.kistenAnzahl() === 1 && a.kisten()[0].x > 3; }, 5);
  assert.notEqual(t, null, 'Kiste fährt nicht auf das obere Band');
  nahe(a.kisten3d()[0].z, 1.0 + 0.15, 0.005, 'auf dem oberen Band');
  assert.notEqual(a.laufenBis(function () { return a.signal(se + '.Anzahl') === 1; }, 10), null);
});

test('Stopper hält Kisten an, der Stau löst sich beim Einfahren', function () {
  const a = neueAnlage(LEER);
  a.anlegen('source', 0.25, 2);              // alle 2 s eine Kiste
  band(a, 2.25, 2, 4);
  const st = a.anlegen('stopper', 3, 2);
  const se = a.anlegen('sink', 4.5, 2);
  a.setzen(st + '.Ausfahren', 1);
  a.laufen(0.5);
  assert.equal(a.signal(st + '.Ausgefahren'), 1);

  a.laufen(12);
  assert.equal(a.signal(se + '.Anzahl'), 0, 'keine Kiste kommt am Stopper vorbei');
  const stau = a.kisten().filter(function (k) { return k.x > 1.5; });
  assert.ok(stau.length >= 3, 'Stau vor dem Stopper: ' + stau.length);
  const vorne = Math.max.apply(null, a.kisten().map(function (k) { return k.x; }));
  nahe(vorne, 3 - 0.025 - 0.15, 0.01, 'vorderste Kiste liegt am Stopper');
  a.kisten3d().forEach(function (k) { assert.ok(k.z > 0.8, 'Kiste fällt nicht vom Band'); });

  a.setzen(st + '.Ausfahren', 0);
  assert.notEqual(a.laufenBis(function () { return a.signal(se + '.Anzahl') >= stau.length; }, 8), null,
    'Stau löst sich nicht: ' + a.signal(se + '.Anzahl') + ' von ' + stau.length);
});

test('Weiche lenkt Kisten je nach Stellung auf Band A oder Band B', function () {
  function lauf(stellung) {
    const a = neueAnlage(LEER);
    const q = a.anlegen('source', 0.25, 2);
    a.eigenschaft(q, 'interval', 2.5);
    band(a, 2.25, 2, 4);                     // Band A geradeaus nach rechts
    const w = a.anlegen('diverter', 2.1, 1.775);   // an der oberen Bandkante, Drehpunkt links
    band(a, 2.25, 3.25, 2, 90);              // Band B zweigt nach unten ab (bündig)
    const sa = a.anlegen('sink', 4.5, 2);
    const sb = a.anlegen('sink', 2.25, 4.5);
    a.setzen(w + '.Ausfahren', stellung);
    // bisher fest 20 s: fertig, sobald fünf Kisten in einer der Senken sind
    a.laufenBis(function () { return a.signal(sa + '.Anzahl') + a.signal(sb + '.Anzahl') >= 5; }, 20);
    return { a: a.signal(sa + '.Anzahl'), b: a.signal(sb + '.Anzahl'), daneben: a.kisten3d().filter(function (k) { return k.z < 0.8; }).length };
  }
  const gerade = lauf(0), ab = lauf(1);
  assert.ok(gerade.a >= 5 && gerade.b === 0, 'Weiche gerade: ' + JSON.stringify(gerade));
  assert.ok(ab.b >= 5 && ab.a === 0, 'Weiche ausgefahren: ' + JSON.stringify(ab));
  assert.equal(gerade.daneben + ab.daneben, 0, 'keine Kiste fällt daneben');
});
