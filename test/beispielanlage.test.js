// Lange Läufe der Beispielanlage (Physik, Rapier): mit und ohne Regel R1,
// Determinismus. Aus physik.test.js herausgelöst, weil sie die meiste Zeit
// brauchen – node:test rechnet Testdateien parallel.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { neueAnlage } = require('./helpers/anlage');

test('Beispielanlage: mit R1 landen alle Kisten über den Schieber in SE2, ohne R1 in SE1', function () {
  const mit = neueAnlage();
  assert.notEqual(mit.laufenBis(function () { return mit.signal('SE2.Anzahl') >= 20; }, 60), null, 'SE2: ' + mit.signal('SE2.Anzahl'));
  const ausgeschleust = mit.signal('SE2.Anzahl');
  assert.equal(mit.signal('SE1.Anzahl'), 0);
  // Keine Kiste liegt daneben: alles, was nicht in SE2 ist, liegt noch auf dem Band
  mit.kisten3d().forEach(function (k) { assert.ok(k.z > 0.7, 'Kiste neben der Anlage: ' + JSON.stringify(k)); });
  assert.equal(ausgeschleust + mit.kistenAnzahl(), mit.signal('Q1.Erzeugt'));

  const ohne = neueAnlage();
  ohne.regel('R1', { enabled: false });
  assert.notEqual(ohne.laufenBis(function () { return ohne.signal('SE1.Anzahl') >= 20; }, 60), null, 'SE1: ' + ohne.signal('SE1.Anzahl'));
  assert.equal(ohne.signal('SE2.Anzahl'), 0);
  ohne.kisten3d().forEach(function (k) { assert.ok(k.z > 0.7, 'Kiste neben der Anlage: ' + JSON.stringify(k)); });
});

test('Determinismus: zwei gleiche Läufe ergeben bitgenau dieselben Kistenlagen', function () {
  const a = neueAnlage();
  const b = neueAnlage();
  a.laufen(30);
  b.laufen(30);
  assert.ok(a.kistenAnzahl() > 3);
  assert.deepEqual(b.kisten3d(), a.kisten3d());
  assert.deepEqual(b.kistenTempo(), a.kistenTempo());
});
