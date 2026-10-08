// Datei: Speichern/Laden, Prüfen und Migration älterer Versionen.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { neueAnlage, kopie } = require('./helpers/anlage');
const plaene = require('./helpers/plaene');

// Beispielanlage, wie sie eine frühe Version (1) gespeichert hat:
// ohne kind/enabled/description bei Regeln, ohne look und inputs bei Elementen.
const ALT_V1 = {
  format: 'mini-fabrik', version: 1, name: 'Alte Anlage',
  settings: { dtMs: 50, cellM: 0.5 },
  elements: [
    { id: 'Q1', type: 'source', name: 'Quelle 1', group: 'Förderstrecke 1', x: 2, y: 4, w: 1, h: 1, props: { interval: 2, maxCount: 0, enabled: true } },
    { id: 'B1', type: 'conveyor', name: 'Förderband 1', group: 'Förderstrecke 1', x: 3, y: 4, w: 9, h: 1, props: { running: true, speed: 0.5, direction: 'rechts' } },
    { id: 'LS1', type: 'sensor', name: 'Lichtschranke 1', group: 'Förderstrecke 1', x: 9, y: 4, w: 1, h: 1, props: { invert: false } },
    { id: 'S1', type: 'pusher', name: 'Schieber 1', group: 'Förderstrecke 1', x: 9, y: 3, w: 1, h: 1, props: { stroke: 600, speed: 0.3, returnDelay: 0.5, direction: 'unten' } },
    { id: 'SE1', type: 'sink', name: 'Senke 1', group: 'Förderstrecke 1', x: 12, y: 4, w: 1, h: 1, props: {} },
    { id: 'SE2', type: 'sink', name: 'Senke 2', group: 'Ausschleusung', x: 9, y: 5, w: 1, h: 1 }
  ],
  rules: [{ id: 'R1', name: 'Regel 1', when: 'LS1.Belegt', then: 'S1.Ausfahren' }]
};

test('serialize → deserialize ergibt dieselbe Anlage', function () {
  const a = neueAnlage();
  // Etwas ändern, damit nicht nur Standardwerte geprüft werden
  a.eigenschaft('B1', 'speed', 0.8);
  a.setzen('Q1.Freigabe', 0);
  a.umbenennen('LS1', 'Schranke vorn');
  a.regel('R1', { enabled: false, description: 'aus' });
  a.neuerScl('"S1".Ausfahren := "LS1".Belegt;');
  const d1 = a.datei();

  const b = neueAnlage(d1);
  assert.deepEqual(b.datei(), d1);
  assert.equal(b.name('LS1'), 'Schranke vorn');
  assert.equal(b.signal('Q1.Freigabe'), 0);
  assert.equal(b.regel('R1').enabled, false);
});

test('Geladene Anlage verhält sich wie das Original', function () {
  const a = neueAnlage();
  const b = neueAnlage(a.datei());
  a.laufen(20);
  b.laufen(20);
  assert.deepEqual(b.kisten(), a.kisten());
  assert.equal(b.signal('SE2.Anzahl'), a.signal('SE2.Anzahl'));
});

test('Laufzeitdaten werden nicht gespeichert', function () {
  const a = neueAnlage();
  a.forcen('LS1.Belegt', 1);
  a.laufen(10);
  assert.ok(a.signal('SE2.Anzahl') > 0 || a.kistenAnzahl() > 0);
  const d = a.datei();
  const se2 = d.elements.filter(function (e) { return e.id === 'SE2'; })[0];
  assert.equal(se2.props.count, 0, 'Zählerstand');
  assert.equal(JSON.stringify(d).indexOf('force'), -1, 'geforcte Ausgänge');
  assert.equal(JSON.stringify(d).indexOf('boxes'), -1, 'Kisten');

  const b = neueAnlage(d);
  assert.equal(b.kistenAnzahl(), 0);
  assert.equal(b.istGeforct('LS1.Belegt'), false);
});

test('Gespeicherte Eingänge bleiben nach dem Laden erhalten, auch wenn die vorige Anlage sie per Regel schrieb', function () {
  const a = neueAnlage();   // Beispiel: R1 schreibt S1.Ausfahren
  a.laufen(0.5);
  const d = plaene.zweiSchranken([]);
  d.elements[2].inputs = { Ausfahren: 1 };
  assert.equal(a.laden(d), true);
  assert.equal(a.signal('S1.Ausfahren'), 1, 'direkt nach dem Laden');
  a.laufen(3);
  assert.equal(a.signal('S1.Ausfahren'), 1, 'nach dem Lauf');
  assert.equal(a.signal('S1.Ausgefahren'), 1);
});

test('validate akzeptiert gültige Dateien', function () {
  const a = neueAnlage();
  assert.deepEqual(a.pruefen(a.datei()), []);
  assert.deepEqual(a.pruefen(plaene.strecke()), []);
});

test('validate meldet kaputte Dateien', function () {
  const a = neueAnlage();
  const gut = a.datei();
  function mit(aendern) { const d = kopie(gut); aendern(d); return d; }

  const faelle = {
    'kein Objekt': null,
    'Liste statt Objekt': [],
    'falsches Format': mit(function (d) { d.format = 'tabelle'; }),
    'neuere Version': mit(function (d) { d.version = 99; }),
    'Version kein Zahl': mit(function (d) { d.version = '1'; }),
    'Elemente fehlen': mit(function (d) { delete d.elements; }),
    'doppelte ID': mit(function (d) { d.elements[1].id = d.elements[0].id; }),
    'unbekannter Typ': mit(function (d) { d.elements[0].type = 'roboter'; }),
    'x ist Text': mit(function (d) { d.elements[0].x = '2'; }),
    'Breite 0': mit(function (d) { d.elements[0].w = 0; }),
    'Drehung 45°': mit(function (d) { d.elements[0].rot = 45; }),
    'Zeitschritt 0': mit(function (d) { d.settings.dtMs = 0; }),
    'Regel ohne ID': mit(function (d) { delete d.rules[0].id; }),
    'enabled als Text': mit(function (d) { d.rules[0].enabled = 'ja'; }),
    'unbekannte Regelart': mit(function (d) { d.rules[0].kind = 'ki'; })
  };
  Object.keys(faelle).forEach(function (name) {
    const fehler = a.pruefen(faelle[name]);
    assert.ok(Array.isArray(fehler) && fehler.length > 0, name + ': kein Fehler gemeldet');
    fehler.forEach(function (f) { assert.equal(typeof f, 'string', name); });
  });
});

test('Kaputte Datei wird nicht geladen, die alte Anlage bleibt', function () {
  const a = neueAnlage();
  const vorher = a.datei();
  assert.equal(a.laden({ format: 'mini-fabrik', version: 1, elements: [{ id: 'X', type: 'roboter', x: 0, y: 0, w: 1, h: 1 }] }), false);
  assert.deepEqual(a.datei(), vorher);
  assert.match(a.meldungen().join('\n'), /Datei nicht geladen/);
});

test('migrate nimmt Version-1-Dateien an', function () {
  const a = neueAnlage();
  const neu = a.migrieren(ALT_V1);
  assert.equal(neu.version, a.dateiVersion, 'auf aktuelle Version gehoben');
  assert.deepEqual(a.pruefen(neu), []);
  assert.deepEqual(ALT_V1.rules[0].enabled, undefined, 'Original bleibt unverändert');
});

test('Alte Version-1-Datei lädt und läuft: Kisten landen über R1 in SE2', function () {
  const a = neueAnlage(ALT_V1);
  assert.equal(a.regel('R1').enabled, true, 'Regel ohne enabled ist aktiv');
  assert.equal(a.regel('R1').kind, 'rule');
  assert.equal(a.signal('B1.Ein'), 1, 'Eingänge auf Startwert');
  a.laufen(20);
  assert.ok(a.signal('SE2.Anzahl') >= 3);
  assert.equal(a.signal('SE1.Anzahl'), 0);
});
