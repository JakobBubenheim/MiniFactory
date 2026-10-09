// Physik (Rapier): Erzeuger, Transportfläche, Sensor, Schieber, Stau.
// Die langen Läufe der Beispielanlage (mit/ohne R1, Determinismus) stehen in
// beispielanlage.test.js – eigene Datei, damit node:test sie parallel rechnet.
// Geprüft wird Verhalten (Zähler, Signale, Lagen in Metern), keine Interna der Engine.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { neueAnlage } = require('./helpers/anlage');
const plaene = require('./helpers/plaene');

const KISTE_Z = 0.7 + 0.15;   // Mittelpunkt einer 0,3-m-Kiste auf dem Band (Oberkante 0,7 m)

// Laufen, bis der Stau voll ist: die Quelle hat sekunden lang keine Kiste mehr
// erzeugt (kein Platz). Höchstens maxSekunden; gibt die Zeit zurück oder null.
function bisStauVoll(a, maxSekunden, sekunden) {
  let zuletzt = -1, seit = 0;
  return a.laufenBis(function () {
    const n = a.signal('Q1.Erzeugt');
    if (n !== zuletzt) { zuletzt = n; seit = a.zeit(); }
    return a.zeit() - seit >= (sekunden || 2);
  }, maxSekunden);
}

test('Kiste fällt aus dem Erzeuger auf das Band, fährt mit Bandtempo und wird in der Senke gezählt', function () {
  const a = neueAnlage(plaene.strecke());
  a.laufen(0.05);
  assert.equal(a.kistenAnzahl(), 1);
  const start = a.kisten3d()[0];
  assert.ok(start.z > KISTE_Z, 'Kiste startet über dem Band: z = ' + start.z);

  // Sie fällt auf das Band und bleibt dort liegen
  a.laufen(0.5);
  const k = a.kisten3d()[0];
  assert.ok(Math.abs(k.z - KISTE_Z) < 0.005, 'liegt auf dem Band: z = ' + k.z);

  // Tempo auf dem Band: 0,5 m/s ± 5 %, nur in Laufrichtung
  const x0 = a.kisten()[0].x;
  a.laufen(2);
  const v = a.kistenTempo()[0];
  const weg = a.kisten()[0].x - x0;
  assert.ok(Math.abs(v.x - 0.5) <= 0.025, 'Tempo ' + v.x + ' m/s');
  assert.ok(Math.abs(weg / 2 - 0.5) <= 0.025, 'mittleres Tempo ' + weg / 2 + ' m/s');
  assert.ok(Math.abs(v.y) < 1e-3 && Math.abs(v.z) < 1e-3, 'fährt gerade: ' + JSON.stringify(v));

  // Am Bandende fällt sie in die Senke und wird gezählt
  const t = a.laufenBis(function () { return a.signal('SE1.Anzahl') === 1; }, 10);
  assert.notEqual(t, null, 'Kiste kommt nicht in der Senke an');
});

test('Ohne Band fällt die Kiste auf den Boden und bleibt dort liegen', function () {
  const a = neueAnlage(plaene.datei([plaene.element('Q1', 'source', 0, 0, 1, 1, { maxCount: 1 })]));
  a.laufen(2);
  const k = a.kisten3d();
  assert.equal(k.length, 1);
  assert.ok(Math.abs(k[0].z - 0.15) < 0.005, 'liegt auf dem Boden: z = ' + k[0].z);
  const vorher = a.kisten();
  a.laufen(1);
  assert.deepEqual(a.kisten(), vorher);
});

test('Lichtschranke mit Entprellung und Invertieren meldet die durchfahrende Kiste', function () {
  const a = neueAnlage(plaene.strecke({ schranke: { invert: true, debounce: 200 } }));
  const b = neueAnlage(plaene.strecke({ schranke: {} }));
  a.laufen(0.05);
  assert.equal(a.signal('LS1.Belegt'), 1, 'invertiert: frei = 1');
  const an = b.laufenBis(function () { return b.signal('LS1.Belegt') === 1; }, 10);
  const aus = a.laufenBis(function () { return a.signal('LS1.Belegt') === 0; }, 10);
  assert.notEqual(an, null);
  assert.notEqual(aus, null);
  assert.ok(Math.abs(aus - an - 0.2) <= 0.05 + 1e-9, 'invertierte Meldung kommt 0,2 s später: ' + (aus - an));
  const frei = a.laufenBis(function () { return a.signal('LS1.Belegt') === 1; }, 5);
  assert.notEqual(frei, null, 'Strahl wird wieder frei');
});

test('Schieber meldet seine Stellung (Ist) und fährt kinematisch: Kisten weichen aus, er nicht', function () {
  const a = neueAnlage(plaene.zweiSchranken([]));   // Hub 600 mm, 0,3 m/s
  assert.equal(a.signal('S1.Ist'), 0);
  a.setzen('S1.Ausfahren', 1);
  a.laufen(1);
  assert.ok(Math.abs(a.signal('S1.Ist') - 0.3) < 1e-6, 'nach 1 s 0,3 m: ' + a.signal('S1.Ist'));
  a.laufen(2);
  assert.equal(a.signal('S1.Ist'), 0.6);
});

test('Stau am Schieber-Anschlag löst sich wieder, wenn er einfährt', function () {
  const d = plaene.strecke({ quelle: { interval: 0.7 } });
  // Schieber über dem Bandende, ausgefahren: sperrt das Band vor der Senke
  const s = plaene.element('S1', 'pusher', 8, -1, 1, 1, { stroke: 400, speed: 1, returnDelay: 0, direction: 'unten' });
  s.inputs = { Ausfahren: 1 };
  d.elements.push(s);
  const a = neueAnlage(d);
  bisStauVoll(a, 15, 3);   // bisher fest 15 s; nach gut 7 s kommt keine Kiste mehr dazu (3 s Reserve)
  assert.equal(a.signal('SE1.Anzahl'), 0, 'Anschlag hält alles auf');
  const imStau = a.kistenAnzahl();
  assert.ok(imStau >= 8, 'Stau: ' + imStau + ' Kisten');
  // Stehende Kisten bewegen sich nicht mehr
  const vorher = a.kisten();
  a.laufen(1);
  a.kisten().slice(0, vorher.length).forEach(function (k, i) {
    assert.ok(Math.abs(k.x - vorher[i].x) < 0.001, 'Kiste ' + i + ' kriecht');
  });

  a.setzen('Q1.Freigabe', 0);
  a.setzen('S1.Ausfahren', 0);
  const t = a.laufenBis(function () { return a.kistenAnzahl() === 0; }, 20);
  assert.notEqual(t, null, 'Stau löst sich nicht auf: noch ' + a.kistenAnzahl() + ' Kisten');
  assert.equal(a.signal('SE1.Anzahl'), a.signal('Q1.Erzeugt'), 'alle Kisten in der Senke');
});

test('Band aus: die Kiste bleibt liegen, Band wieder an: sie fährt weiter', function () {
  const a = neueAnlage(plaene.strecke({ quelle: { maxCount: 1 } }));
  a.laufen(2);
  a.setzen('B1.Ein', 0);
  a.laufen(1);
  const steht = a.kisten();
  a.laufen(3);
  assert.deepEqual(a.kisten(), steht, 'Kiste steht');
  assert.equal(a.kistenTempo()[0].x, 0);
  a.setzen('B1.Ein', 1);
  a.laufen(1);
  assert.ok(a.kisten()[0].x > steht[0].x + 0.4, 'fährt weiter');
});
