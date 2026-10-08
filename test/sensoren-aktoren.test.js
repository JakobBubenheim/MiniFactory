// Sensoren und Aktoren: Lichtschranke (mit Entprellung) und Schieber.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { neueAnlage } = require('./helpers/anlage');
const plaene = require('./helpers/plaene');

const DT = 0.05;

function belegtAb(debounce) {
  const a = neueAnlage(plaene.strecke({ schranke: { debounce: debounce } }));
  return a.laufenBis(function () { return a.signal('LS1.Belegt') === 1; }, 10);
}

test('LS1.Belegt wird 1, solange eine Kiste durch den Strahl läuft', function () {
  const a = neueAnlage(plaene.strecke({ schranke: {} }));
  assert.equal(a.signal('LS1.Belegt'), 0);
  const an = a.laufenBis(function () { return a.signal('LS1.Belegt') === 1; }, 10);
  assert.notEqual(an, null, 'Lichtschranke hat nie ausgelöst');
  const aus = a.laufenBis(function () { return a.signal('LS1.Belegt') === 0; }, 5);
  assert.notEqual(aus, null, 'Lichtschranke wird nicht wieder frei');
  assert.ok(aus - an > 0.3 && aus - an < 1.5, 'Kiste braucht Zeit, um den Strahl zu passieren: ' + (aus - an) + ' s');
});

test('Invertierte Lichtschranke meldet belegt, wenn der Strahl frei ist', function () {
  const a = neueAnlage(plaene.strecke({ schranke: { invert: true } }));
  a.laufen(DT);
  assert.equal(a.signal('LS1.Belegt'), 1);
  const t = a.laufenBis(function () { return a.signal('LS1.Belegt') === 0; }, 10);
  assert.notEqual(t, null);
});

test('Entprellzeit verzögert die Meldung um die eingestellte Zeit', function () {
  const ohne = belegtAb(0);
  const mit = belegtAb(300);
  assert.notEqual(ohne, null);
  assert.notEqual(mit, null);
  assert.ok(Math.abs(mit - ohne - 0.3) <= DT + 1e-9, 'Verzögerung ' + (mit - ohne) + ' s statt 0,3 s');
});

test('Entprellzeit länger als die Kiste im Strahl: keine Meldung', function () {
  const a = neueAnlage(plaene.strecke({ schranke: { debounce: 1500 } }));
  const t = a.laufenBis(function () { return a.signal('LS1.Belegt') === 1; }, 6);
  assert.equal(t, null, 'kurze Unterbrechung wurde gemeldet');
});

test('Schieber S1 fährt bei Ausfahren = 1 aus und meldet Ausgefahren / Eingefahren', function () {
  const a = neueAnlage(plaene.zweiSchranken([]));   // Hub 600 mm, 0,3 m/s, Rückfahrverzug 0,5 s
  assert.equal(a.signal('S1.Eingefahren'), 1);
  assert.equal(a.signal('S1.Ausgefahren'), 0);

  a.setzen('S1.Ausfahren', 1);
  a.laufen(0.1);
  assert.equal(a.signal('S1.Eingefahren'), 0, 'unterwegs nicht eingefahren');
  assert.equal(a.signal('S1.Ausgefahren'), 0, 'unterwegs nicht ausgefahren');

  const aus = a.laufenBis(function () { return a.signal('S1.Ausgefahren') === 1; }, 5);
  assert.ok(Math.abs(aus - 2) <= DT + 1e-9, 'Ausfahren dauert 0,6 m / 0,3 m/s = 2 s, ist ' + aus);
  a.laufen(1);
  assert.equal(a.signal('S1.Ausgefahren'), 1, 'bleibt ausgefahren');

  a.setzen('S1.Ausfahren', 0);
  const start = a.zeit();
  a.laufen(0.4);
  assert.equal(a.signal('S1.Ausgefahren'), 1, 'wartet den Rückfahrverzug ab');
  const ein = a.laufenBis(function () { return a.signal('S1.Eingefahren') === 1; }, 5);
  assert.ok(Math.abs(ein - start - 2.5) <= 2 * DT + 1e-9, 'Einfahren nach 0,5 s Verzug + 2 s, ist ' + (ein - start));
});

test('Schieber schiebt die Kiste vom Band in die Senke SE2', function () {
  const a = neueAnlage();   // Beispielanlage, R1 abgeschaltet: Schieber von Hand
  a.regel('R1', { enabled: false });
  a.laufenBis(function () { return a.signal('LS1.Belegt') === 1; }, 20);
  a.setzen('S1.Ausfahren', 1);
  a.laufen(3);
  assert.equal(a.signal('SE2.Anzahl'), 1);
});
