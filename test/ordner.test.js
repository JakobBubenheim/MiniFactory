// Strukturbaum: Ordner anlegen, verschieben, löschen, speichern und migrieren.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { neueAnlage, kopie } = require('./helpers/anlage');

// Datei aus Version 1: Gruppen als Text in el.group, keine Ordner
const ALT_V1 = {
  format: 'mini-fabrik', version: 1, name: 'Alte Anlage',
  settings: { dtMs: 50, cellM: 0.5 },
  elements: [
    { id: 'Q1', type: 'source', name: 'Quelle 1', group: 'Förderstrecke 1', x: 2, y: 4, w: 1, h: 1 },
    { id: 'B1', type: 'conveyor', name: 'Förderband 1', group: 'Förderstrecke 1', x: 3, y: 4, w: 9, h: 1 },
    { id: 'SE1', type: 'sink', name: 'Senke 1', group: 'Förderstrecke 1', x: 12, y: 4, w: 1, h: 1 },
    { id: 'SE2', type: 'sink', name: 'Senke 2', group: 'Ausschleusung', x: 9, y: 5, w: 1, h: 1 }
  ],
  rules: [{ id: 'R1', name: 'Regel 1', when: 'B1.Läuft', then: 'Q1.Freigabe' }]
};

test('Migration 1 → 2: jede Gruppe wird ein Ordner unter Anlage', function () {
  const a = neueAnlage(ALT_V1);
  const ordner = a.ordnerListe();
  assert.deepEqual(ordner.map(function (f) { return [f.name, f.parent, f.area]; }), [
    ['Förderstrecke 1', null, 'plant'],
    ['Ausschleusung', null, 'plant']
  ]);
  const idVon = {};
  ordner.forEach(function (f) { idVon[f.name] = f.id; });
  assert.equal(a.eltern('Q1'), idVon['Förderstrecke 1']);
  assert.equal(a.eltern('SE1'), idVon['Förderstrecke 1']);
  assert.equal(a.eltern('SE2'), idVon['Ausschleusung']);
  assert.equal(a.eltern('R1'), null, 'Regeln landen direkt unter Logik');
  const d = a.datei();
  assert.equal(d.version, a.dateiVersion);
  assert.equal(JSON.stringify(d).indexOf('"group"'), -1, 'kein group mehr in der Datei');
});

test('Speichern und Laden erhält verschachtelte Ordner und Reihenfolge', function () {
  const a = neueAnlage();
  const fa = a.ordnerAnlegen('plant', null, 'Halle A');
  const fb = a.ordnerAnlegen('plant', fa, 'Linie 1');
  const fl = a.ordnerAnlegen('logic', null, 'Sicherheit');
  assert.equal(a.verschieben(['SE2'], 'plant', fb), 1);
  assert.equal(a.verschieben(['R1'], 'logic', fl), 1);

  const d = a.datei();
  const b = neueAnlage(d);
  assert.deepEqual(b.datei(), d);
  assert.equal(b.eltern('SE2'), fb);
  assert.equal(b.eltern(fb), fa);
  assert.equal(b.eltern('R1'), fl);
  assert.deepEqual(b.baumReihenfolge('plant'), a.baumReihenfolge('plant'));
});

test('Ordner löschen: Inhalt und Unterordner wandern eine Ebene nach oben', function () {
  const a = neueAnlage();
  const aussen = a.ordnerAnlegen('plant', null, 'Außen');
  const mitte = a.ordnerAnlegen('plant', aussen, 'Mitte');
  const innen = a.ordnerAnlegen('plant', mitte, 'Innen');
  a.verschieben(['B1'], 'plant', mitte);
  a.verschieben(['SE1'], 'plant', innen);
  const vorher = a.elemente().slice().sort();

  a.ordnerLoeschen(mitte);
  assert.deepEqual(a.elemente().slice().sort(), vorher, 'kein Element verloren');
  assert.equal(a.eltern('B1'), aussen);
  assert.equal(a.eltern(innen), aussen);
  assert.equal(a.eltern('SE1'), innen);
  assert.equal(a.ordnerListe().some(function (f) { return f.id === mitte; }), false);
});

test('Ein Ordner kann nicht in sich selbst oder in den anderen Bereich', function () {
  const a = neueAnlage();
  const oben = a.ordnerAnlegen('plant', null, 'Oben');
  const unten = a.ordnerAnlegen('plant', oben, 'Unten');
  const vorher = a.datei();

  assert.equal(a.verschieben([oben], 'plant', unten), 0);
  assert.equal(a.verschieben([oben], 'plant', oben), 0);
  assert.equal(a.verschieben(['R1'], 'plant', oben), 0, 'Regel nicht in die Anlage');
  assert.equal(a.verschieben(['B1'], 'logic', null), 0, 'Element nicht in die Logik');
  assert.deepEqual(a.datei(), vorher, 'unzulässiges Verschieben ändert nichts');
  assert.ok(a.meldungen().length >= 4, 'jedes Mal eine Meldung');
});

test('Umsortieren innerhalb einer Ebene ändert die Baum-Reihenfolge', function () {
  const a = neueAnlage();
  const f = a.ordnerAnlegen('plant', null, 'Neu');
  function beide() {
    return a.baumReihenfolge('plant').filter(function (id) { return id === 'Q1' || id === 'SE1'; });
  }
  a.verschieben(['SE1', 'Q1'], 'plant', f);
  assert.deepEqual(beide(), ['SE1', 'Q1']);
  a.verschieben(['Q1'], 'plant', f, 'SE1');
  assert.deepEqual(beide(), ['Q1', 'SE1']);
});

test('SCL-Bausteine laufen in Baum-Reihenfolge: der letzte Schreiber gewinnt', function () {
  const a = neueAnlage();
  a.regel('R1', { enabled: false });
  const r2 = a.neuerScl('"S1".Ausfahren := TRUE;');
  const r3 = a.neuerScl('"S1".Ausfahren := FALSE;');
  a.schritt();
  assert.equal(a.signal('S1.Ausfahren'), 0, 'R3 steht unten und schreibt zuletzt');

  // Ordner einer Ebene laufen vor den Regeln dieser Ebene
  const f = a.ordnerAnlegen('logic', null, 'Zuerst');
  a.verschieben([r3], 'logic', f);
  assert.deepEqual(a.baumReihenfolge('logic'), [r3, 'R1', r2]);
  a.schritt();
  assert.equal(a.signal('S1.Ausfahren'), 1, 'jetzt schreibt R2 zuletzt');
});

test('Ordner anlegen und verschieben lässt sich rückgängig machen', function () {
  const a = neueAnlage();
  const vorher = a.datei();
  const f = a.ordnerAnlegen('plant', null, 'Temp');
  a.verschieben(['B1'], 'plant', f);
  assert.equal(a.eltern('B1'), f);

  a.rueckgaengig();
  assert.notEqual(a.eltern('B1'), f);
  a.rueckgaengig();
  assert.deepEqual(a.datei().folders, vorher.folders);

  a.wiederholen();
  a.wiederholen();
  assert.equal(a.eltern('B1'), f);
});

test('Prüfen meldet kaputte Ordner-Verweise und Zyklen', function () {
  const a = neueAnlage();
  const d = a.datei();

  const unbekannt = kopie(d);
  unbekannt.elements[0].parent = 'F99';
  assert.match(a.pruefen(unbekannt).join('\n'), /F99/);

  const falscherBereich = kopie(d);
  falscherBereich.rules[0].parent = falscherBereich.folders.filter(function (f) { return f.area === 'plant'; })[0].id;
  assert.ok(a.pruefen(falscherBereich).length > 0, 'Regel in einem Anlagen-Ordner');

  const zyklus = kopie(d);
  zyklus.folders = [
    { id: 'F1', name: 'A', parent: 'F2', area: 'plant' },
    { id: 'F2', name: 'B', parent: 'F1', area: 'plant' }
  ];
  zyklus.elements.forEach(function (e) { e.parent = null; });
  assert.ok(a.pruefen(zyklus).length > 0, 'Zyklus F1 → F2 → F1');
});
