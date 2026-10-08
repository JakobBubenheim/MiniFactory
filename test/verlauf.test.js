// Rückgängig / Wiederholen: anlegen, ändern, löschen.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { neueAnlage } = require('./helpers/anlage');

test('Zu Beginn gibt es nichts rückgängig zu machen', function () {
  const a = neueAnlage();
  assert.equal(a.kannRueckgaengig(), false);
  assert.equal(a.kannWiederholen(), false);
  a.rueckgaengig();
  assert.match(a.meldungen().join('\n'), /Nichts zum Rückgängigmachen/);
});

test('Anlegen rückgängig machen und wiederholen', function () {
  const a = neueAnlage();
  const vorher = a.elemente();
  const id = a.anlegen('conveyor', 2, 8);
  assert.equal(id, 'B2');
  assert.deepEqual(a.elemente(), vorher.concat(['B2']));

  a.rueckgaengig();
  assert.deepEqual(a.elemente(), vorher);
  assert.equal(a.kannWiederholen(), true);

  a.wiederholen();
  assert.deepEqual(a.elemente(), vorher.concat(['B2']));
  assert.equal(a.eigenschaft('B2', 'speed'), 0.5);
});

test('Ändern rückgängig machen und wiederholen', function () {
  const a = neueAnlage();
  a.eigenschaft('B1', 'speed', 1.2);
  a.umbenennen('B1', 'Hauptband');
  assert.equal(a.eigenschaft('B1', 'speed'), 1.2);

  a.rueckgaengig();
  assert.equal(a.name('B1'), 'Förderband 1');
  assert.equal(a.eigenschaft('B1', 'speed'), 1.2, 'nur ein Schritt zurück');
  a.rueckgaengig();
  assert.equal(a.eigenschaft('B1', 'speed'), 0.5);

  a.wiederholen();
  assert.equal(a.eigenschaft('B1', 'speed'), 1.2);
  a.wiederholen();
  assert.equal(a.name('B1'), 'Hauptband');
  assert.equal(a.kannWiederholen(), false);
});

test('Löschen rückgängig machen stellt auch den Bezug der Regel wieder her', function () {
  const a = neueAnlage();
  a.loeschen('LS1');
  assert.equal(a.elemente().indexOf('LS1'), -1);
  assert.equal(a.regel('R1').when, '');

  a.rueckgaengig();
  assert.ok(a.elemente().indexOf('LS1') >= 0);
  assert.equal(a.regel('R1').when, 'LS1.Belegt');
  // Die wiederhergestellte Anlage funktioniert
  a.laufen(20);
  assert.ok(a.signal('SE2.Anzahl') >= 3);

  a.wiederholen();
  assert.equal(a.elemente().indexOf('LS1'), -1);
  assert.equal(a.regel('R1').when, '');
});

test('Neue Änderung nach Rückgängig verwirft den Wiederholen-Zweig', function () {
  const a = neueAnlage();
  a.anlegen('sink', 0, 0);
  a.rueckgaengig();
  a.eigenschaft('B1', 'speed', 2);
  assert.equal(a.kannWiederholen(), false);
  assert.equal(a.elemente().indexOf('SE3'), -1);
});

test('Rückgängig setzt die Simulation nicht zurück', function () {
  const a = neueAnlage();
  a.laufen(5);
  const kisten = a.kisten();
  const zeit = a.zeit();
  a.eigenschaft('B1', 'speed', 1);
  a.rueckgaengig();
  assert.equal(a.zeit(), zeit);
  assert.deepEqual(a.kisten(), kisten);
  assert.equal(a.eigenschaft('B1', 'speed'), 0.5);
});

test('Laden einer Datei leert den Verlauf', function () {
  const a = neueAnlage();
  a.eigenschaft('B1', 'speed', 1);
  assert.equal(a.kannRueckgaengig(), true);
  a.laden(a.datei());
  assert.equal(a.kannRueckgaengig(), false);
});
