// Logik: Wenn-dann-Regeln, Abschalten, ODER-Verknüpfung, Forcen.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { neueAnlage } = require('./helpers/anlage');
const plaene = require('./helpers/plaene');

const DT = 0.05;
const ZWEI_REGELN = [
  { id: 'R1', name: 'Regel 1', when: 'LS1.Belegt', then: 'S1.Ausfahren' },
  { id: 'R2', name: 'Regel 2', when: 'LS2.Belegt', then: 'S1.Ausfahren' }
];

test('Mit Regel R1 landen die Kisten in SE2', function () {
  const a = neueAnlage();
  assert.notEqual(a.laufenBis(function () { return a.signal('SE2.Anzahl') >= 3; }, 20), null, 'SE2: ' + a.signal('SE2.Anzahl'));
  assert.equal(a.signal('SE1.Anzahl'), 0);
});

test('Abgeschaltete Regel wirkt nicht: Kisten laufen nach SE1', function () {
  const a = neueAnlage();
  a.regel('R1', { enabled: false });
  assert.notEqual(a.laufenBis(function () { return a.signal('SE1.Anzahl') >= 3; }, 20), null, 'SE1: ' + a.signal('SE1.Anzahl'));
  assert.equal(a.signal('SE2.Anzahl'), 0);
});

test('Abschalten gibt das Ziel frei: es fällt auf den Startwert zurück', function () {
  const a = neueAnlage(plaene.zweiSchranken([ZWEI_REGELN[0]]));
  a.forcen('LS1.Belegt', 1);
  a.laufen(DT);
  assert.equal(a.signal('S1.Ausfahren'), 1);
  a.regel('R1', { enabled: false });
  assert.equal(a.signal('S1.Ausfahren'), 0, 'sofort beim Abschalten');
  a.laufen(DT);
  assert.equal(a.signal('S1.Ausfahren'), 0);
  a.regel('R1', { enabled: true });
  a.laufen(DT);
  assert.equal(a.signal('S1.Ausfahren'), 1, 'wieder eingeschaltet');
});

test('Mehrere Regeln auf dasselbe Ziel sind ODER-verknüpft', function () {
  const a = neueAnlage(plaene.zweiSchranken(ZWEI_REGELN));
  const faelle = [[0, 0, 0], [1, 0, 1], [0, 1, 1], [1, 1, 1], [0, 0, 0]];
  faelle.forEach(function (f) {
    a.forcen('LS1.Belegt', f[0]);
    a.forcen('LS2.Belegt', f[1]);
    a.laufen(DT);
    assert.equal(a.signal('S1.Ausfahren'), f[2], 'LS1=' + f[0] + ', LS2=' + f[1]);
  });
});

test('Geforcter Ausgang wirkt auf die Regeln, Freigeben hebt das auf', function () {
  const a = neueAnlage(plaene.zweiSchranken([ZWEI_REGELN[0]]));
  a.forcen('LS1.Belegt', 1);
  assert.equal(a.istGeforct('LS1.Belegt'), true);
  assert.equal(a.signal('LS1.Belegt'), 1);
  a.laufen(DT);
  assert.equal(a.signal('S1.Ausfahren'), 1);
  a.laufen(3);
  assert.equal(a.signal('S1.Ausgefahren'), 1, 'Schieber ist ausgefahren');

  a.freigeben('LS1.Belegt');
  assert.equal(a.istGeforct('LS1.Belegt'), false);
  assert.equal(a.signal('LS1.Belegt'), 0, 'zeigt wieder den gemessenen Wert');
  a.laufen(DT);
  assert.equal(a.signal('S1.Ausfahren'), 0);
});

test('Forcen von LS1 in der Beispielanlage schleust auch ohne Kiste aus', function () {
  const a = neueAnlage();
  a.forcen('LS1.Belegt', 1);
  a.laufen(3);
  assert.equal(a.signal('S1.Ausgefahren'), 1);
});

test('Regel auf ein gelöschtes Element wirkt nicht mehr', function () {
  const a = neueAnlage(plaene.zweiSchranken([ZWEI_REGELN[0]]));
  a.forcen('LS1.Belegt', 1);
  a.laufen(DT);
  assert.equal(a.signal('S1.Ausfahren'), 1);
  a.loeschen('LS1');
  assert.equal(a.regel('R1').when, '');
  a.laufen(DT);
  assert.equal(a.signal('S1.Ausfahren'), 0);
});
