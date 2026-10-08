// SCL: Sprache, Bausteine, Fehlermeldungen und Gleichwertigkeit mit Regel R1.
// Reize kommen über geforcte Lichtschranken LS1/LS2, Ergebnisse stehen in Variablen.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { neueAnlage } = require('./helpers/anlage');
const plaene = require('./helpers/plaene');

const DT = 0.05;

// SCL-Baustein auf leerer Testfläche; prüft, dass er fehlerfrei übersetzt
function baustein(code) {
  const a = neueAnlage(plaene.sclPlatz());
  const id = a.neuerScl(code);
  assert.equal(a.sclFehler(id), null, 'Übersetzungsfehler');
  a.forcen('LS1.Belegt', 0);
  a.forcen('LS2.Belegt', 0);
  a.var = function (name) { return a.sclVariable(id, name); };
  a.id = id;
  return a;
}

test('SCL: Zuweisung an Variablen und Signale', function () {
  const a = baustein([
    'VAR',
    '  i : INT;',
    '  r : REAL;',
    '  b : BOOL := TRUE;',
    'END_VAR',
    'i := 7.9;            // INT schneidet ab',
    'r := 2.5;',
    'b := NOT b;',
    '"S1".Ausfahren := TRUE;'
  ].join('\n'));
  assert.equal(a.var('i'), 0, 'vor dem ersten Zyklus');
  assert.equal(a.var('b'), 1, 'Startwert aus VAR');
  a.laufen(DT);
  assert.equal(a.var('i'), 7);
  assert.equal(a.var('r'), 2.5);
  assert.equal(a.var('b'), 0);
  assert.equal(a.signal('S1.Ausfahren'), 1);
  a.laufen(DT);
  assert.equal(a.var('b'), 1, 'Variablen behalten ihren Wert über Zyklen');
});

test('SCL: IF / ELSIF / ELSE', function () {
  const a = baustein([
    'VAR n, k : INT; END_VAR',
    'n := "LS1".Belegt + 2 * "LS2".Belegt;',
    'IF n = 0 THEN',
    '  k := 10;',
    'ELSIF n = 1 THEN',
    '  k := 20;',
    'ELSIF n = 2 THEN',
    '  k := 30;',
    'ELSE',
    '  k := 40;',
    'END_IF;'
  ].join('\n'));
  [[0, 0, 10], [1, 0, 20], [0, 1, 30], [1, 1, 40]].forEach(function (f) {
    a.forcen('LS1.Belegt', f[0]);
    a.forcen('LS2.Belegt', f[1]);
    a.laufen(DT);
    assert.equal(a.var('k'), f[2], 'LS1=' + f[0] + ', LS2=' + f[1]);
  });
});

test('SCL: CASE mit Einzelwerten, Bereichen und ELSE', function () {
  const a = baustein([
    'VAR c, k : INT; END_VAR',
    'c := c + 1;',
    'CASE c OF',
    '  1: k := 10;',
    '  2..3: k := 20;',
    '  5, 7: k := 50;',
    'ELSE',
    '  k := 99;',
    'END_CASE;'
  ].join('\n'));
  const soll = [10, 20, 20, 99, 50, 99, 50, 99];
  soll.forEach(function (k, i) {
    a.laufen(DT);
    assert.equal(a.var('k'), k, 'Zyklus ' + (i + 1));
  });
});

test('SCL: TON – Einschaltverzögerung', function () {
  const a = baustein([
    'VAR t : TON; q : BOOL; END_VAR',
    't(IN := "LS1".Belegt, PT := T#200ms);',
    'q := t.Q;'
  ].join('\n'));
  a.forcen('LS1.Belegt', 1);
  a.laufen(0.15);
  assert.equal(a.var('q'), 0, 'nach 150 ms noch aus');
  a.laufen(0.15);
  assert.equal(a.var('q'), 1, 'nach 300 ms an');
  assert.equal(a.var('t.ET'), 200, 'ET bleibt bei PT stehen');
  a.forcen('LS1.Belegt', 0);
  a.laufen(DT);
  assert.equal(a.var('q'), 0, 'IN weg: sofort aus');
  assert.equal(a.var('t.ET'), 0);
});

test('SCL: TOF – Ausschaltverzögerung', function () {
  const a = baustein([
    'VAR t : TOF; q : BOOL; END_VAR',
    't(IN := "LS1".Belegt, PT := T#200ms);',
    'q := t.Q;'
  ].join('\n'));
  a.laufen(DT);
  assert.equal(a.var('q'), 0);
  a.forcen('LS1.Belegt', 1);
  a.laufen(DT);
  assert.equal(a.var('q'), 1, 'IN an: sofort an');
  a.forcen('LS1.Belegt', 0);
  a.laufen(0.1);
  assert.equal(a.var('q'), 1, 'nach dem Abfall noch 200 ms an');
  a.laufen(0.2);
  assert.equal(a.var('q'), 0, 'danach aus');
});

test('SCL: TP – Impuls fester Länge', function () {
  const a = baustein([
    'VAR t : TP; q : BOOL; END_VAR',
    't(IN := "LS1".Belegt, PT := T#200ms);',
    'q := t.Q;'
  ].join('\n'));
  a.forcen('LS1.Belegt', 1);
  a.laufen(0.1);
  assert.equal(a.var('q'), 1, 'Impuls läuft');
  a.laufen(0.2);
  assert.equal(a.var('q'), 0, 'Impuls endet nach PT, obwohl IN noch 1 ist');
  a.laufen(0.5);
  assert.equal(a.var('q'), 0, 'kein neuer Impuls ohne neue Flanke');
  a.forcen('LS1.Belegt', 0);
  a.laufen(DT);
  a.forcen('LS1.Belegt', 1);
  a.laufen(DT);
  assert.equal(a.var('q'), 1, 'neue Flanke, neuer Impuls');
});

// Verlauf von Q über 8 Zyklen nach einem Wechsel von IN, z. B. '00001111'
function zeitgliedVerlauf(typ, vorher, nachher) {
  const a = baustein('VAR t : ' + typ + '; END_VAR\nt(IN := "LS1".Belegt, PT := T#200ms);');
  a.forcen('LS1.Belegt', vorher);
  a.laufen(0.5);
  a.forcen('LS1.Belegt', nachher);
  let verlauf = '';
  for (let i = 0; i < 8; i++) { a.laufen(DT); verlauf += a.var('t.Q'); }
  return verlauf;
}

test('SCL: TON, TOF und TP halten PT = 200 ms gleich genau ein (4 Zyklen à 50 ms)', function () {
  assert.equal(zeitgliedVerlauf('TON', 0, 1), '00001111', 'TON: Q nach 200 ms');
  assert.equal(zeitgliedVerlauf('TOF', 1, 0), '11110000', 'TOF: Q noch 200 ms nach dem Abfall');
  assert.equal(zeitgliedVerlauf('TP', 0, 1), '11110000', 'TP: Impuls 200 ms');
});

test('SCL: TOF mit PT = 0 schaltet sofort ab', function () {
  const a = baustein('VAR t : TOF; END_VAR\nt(IN := "LS1".Belegt, PT := T#0ms);');
  a.forcen('LS1.Belegt', 1);
  a.laufen(DT);
  assert.equal(a.var('t.Q'), 1);
  a.forcen('LS1.Belegt', 0);
  a.laufen(DT);
  assert.equal(a.var('t.Q'), 0);
});

test('SCL: CASE mit negativen Marken', function () {
  const a = baustein([
    'VAR c, k : INT; END_VAR',
    'c := c - 1;',
    'CASE c OF',
    '  -1: k := 1;',
    '  -3..-2: k := 2;',
    '  -4, 0: k := 4;',
    'END_CASE;'
  ].join('\n'));
  [1, 2, 2, 4].forEach(function (k, i) {
    a.laufen(DT);
    assert.equal(a.var('k'), k, 'Zyklus ' + (i + 1));
  });
});

test('SCL: R_TRIG und F_TRIG erkennen Flanken genau einen Zyklus lang', function () {
  const a = baustein([
    'VAR r : R_TRIG; f : F_TRIG; steigend, fallend : INT; END_VAR',
    'r(CLK := "LS1".Belegt);',
    'f(CLK := "LS1".Belegt);',
    'IF r.Q THEN steigend := steigend + 1; END_IF;',
    'IF f.Q THEN fallend := fallend + 1; END_IF;'
  ].join('\n'));
  a.forcen('LS1.Belegt', 1);
  a.laufen(0.5);
  assert.equal(a.var('steigend'), 1);
  assert.equal(a.var('fallend'), 0);
  a.forcen('LS1.Belegt', 0);
  a.laufen(0.5);
  assert.equal(a.var('fallend'), 1);
  a.forcen('LS1.Belegt', 1);
  a.laufen(DT);
  assert.equal(a.var('steigend'), 2);
  assert.equal(a.var('r.Q'), 1);
  a.laufen(DT);
  assert.equal(a.var('r.Q'), 0, 'nur einen Zyklus lang');
});

// Ein Puls auf LS1: ein Zyklus an, ein Zyklus aus
function puls(a, n) {
  for (let i = 0; i < n; i++) {
    a.forcen('LS1.Belegt', 1); a.laufen(DT);
    a.forcen('LS1.Belegt', 0); a.laufen(DT);
  }
}

test('SCL: CTU zählt vorwärts bis PV, R setzt zurück', function () {
  const a = baustein([
    'VAR c : CTU; END_VAR',
    'c(CU := "LS1".Belegt, R := "LS2".Belegt, PV := 3);'
  ].join('\n'));
  puls(a, 2);
  assert.equal(a.var('c.CV'), 2);
  assert.equal(a.var('c.Q'), 0);
  puls(a, 1);
  assert.equal(a.var('c.CV'), 3);
  assert.equal(a.var('c.Q'), 1);
  a.forcen('LS2.Belegt', 1);
  a.laufen(DT);
  assert.equal(a.var('c.CV'), 0);
  assert.equal(a.var('c.Q'), 0);
});

test('SCL: CTD zählt rückwärts ab PV, nicht unter 0', function () {
  const a = baustein([
    'VAR d : CTD; END_VAR',
    'd(CD := "LS1".Belegt, LD := "LS2".Belegt, PV := 2);'
  ].join('\n'));
  a.forcen('LS2.Belegt', 1);
  a.laufen(DT);
  a.forcen('LS2.Belegt', 0);
  assert.equal(a.var('d.CV'), 2, 'LD lädt PV');
  assert.equal(a.var('d.Q'), 0);
  puls(a, 2);
  assert.equal(a.var('d.CV'), 0);
  assert.equal(a.var('d.Q'), 1);
  puls(a, 1);
  assert.equal(a.var('d.CV'), 0, 'bleibt bei 0');
});

test('SCL: SR ist setzdominant, RS ist rücksetzdominant', function () {
  const a = baustein([
    'VAR sr1 : SR; rs1 : RS; END_VAR',
    'sr1(S1 := "LS1".Belegt, R := "LS2".Belegt);',
    'rs1(S := "LS1".Belegt, R1 := "LS2".Belegt);'
  ].join('\n'));
  const schritte = [
    // LS1, LS2, SR.Q1, RS.Q1
    [1, 0, 1, 1],   // setzen
    [0, 0, 1, 1],   // halten
    [0, 1, 0, 0],   // rücksetzen
    [1, 1, 1, 0],   // beides: SR setzt, RS setzt zurück
    [0, 0, 1, 0]    // halten
  ];
  schritte.forEach(function (s, i) {
    a.forcen('LS1.Belegt', s[0]);
    a.forcen('LS2.Belegt', s[1]);
    a.laufen(DT);
    assert.equal(a.var('sr1.Q1'), s[2], 'SR, Schritt ' + (i + 1));
    assert.equal(a.var('rs1.Q1'), s[3], 'RS, Schritt ' + (i + 1));
  });
});

test('SCL: Rechnen, Vorrang, Funktionen und Vergleiche', function () {
  const a = baustein([
    'VAR',
    '  vorrang, klammer, rest, potenz, ganz, mi, ma, li, ab : INT;',
    '  geteilt, neg : REAL;',
    '  gr, ug, kl, gl, und_, oder_, xo, nicht_ : BOOL;',
    'END_VAR',
    'vorrang := 1 + 2 * 3;',
    'klammer := (1 + 2) * 3;',
    'rest := 7 MOD 3;',
    'potenz := 2 ** 3;',
    'geteilt := 10 / 4;',
    'ganz := 10 / 4;',
    'neg := -1.5 * 2;',
    'mi := MIN(3, 5);',
    'ma := MAX(3, 5);',
    'li := LIMIT(0, 12, 10);',
    'ab := ABS(-4);',
    'gr := 3 > 2;',
    'ug := 3 <> 3;',
    'kl := 2 <= 2;',
    'gl := 2.5 = 2.5;',
    'und_ := TRUE AND FALSE;',
    'oder_ := TRUE OR FALSE;',
    'xo := TRUE XOR TRUE;',
    'nicht_ := NOT (1 > 2);'
  ].join('\n'));
  a.laufen(DT);
  const soll = {
    vorrang: 7, klammer: 9, rest: 1, potenz: 8, geteilt: 2.5, ganz: 2, neg: -3,
    mi: 3, ma: 5, li: 10, ab: 4, gr: 1, ug: 0, kl: 1, gl: 1, und_: 0, oder_: 1, xo: 0, nicht_: 1
  };
  Object.keys(soll).forEach(function (k) { assert.equal(a.var(k), soll[k], k); });
});

test('SCL: Syntaxfehler mit Zeilennummer, Baustein läuft dann nicht', function () {
  const a = neueAnlage(plaene.sclPlatz());
  const fehler = a.sclPruefen([
    'VAR',
    '  x : INT;',
    'END_VAR',
    'x := 1 +;'
  ].join('\n'));
  assert.ok(fehler, 'Fehler erwartet');
  assert.equal(fehler.line, 4);
  assert.match(fehler.message, /erwartet/);

  const unbekannt = a.sclPruefen('\n\ny := 1;');
  assert.equal(unbekannt.line, 3);
  assert.match(unbekannt.message, /Unbekannte Variable "y"/);

  assert.equal(a.sclPruefen('IF TRUE THEN\n  "S1".Ausfahren := 1;\n').line, 3, 'fehlendes END_IF am Ende');

  const id = a.neuerScl('"S1".Ausfahren := TRUE;\n"S1".Ausfahren = FALSE;');
  assert.equal(a.sclFehler(id).line, 2);
  a.laufen(DT);
  assert.equal(a.signal('S1.Ausfahren'), 0, 'fehlerhafter Baustein läuft nicht');
});

test('SCL: Laufzeitfehler mit Zeilennummer', function () {
  const a = baustein('VAR x : INT; END_VAR\n\nx := 1 / x;');
  a.laufen(DT);
  const f = a.sclLaufzeitfehler(a.id);
  assert.ok(f, 'Laufzeitfehler erwartet');
  assert.equal(f.line, 3);
  assert.match(f.message, /Division durch 0/);
});

test('SCL: Baustein wie Regel R1 liefert dasselbe Ergebnis', function () {
  const regel = neueAnlage();
  const scl = neueAnlage();
  scl.regel('R1', { enabled: false });
  const id = scl.neuerScl('"S1".Ausfahren := "LS1".Belegt;');
  assert.equal(scl.sclFehler(id), null);

  for (let t = 0; t < 30; t++) {
    regel.laufen(1);
    scl.laufen(1);
    ['Q1.Erzeugt', 'SE1.Anzahl', 'SE2.Anzahl', 'S1.Ausgefahren', 'LS1.Belegt'].forEach(function (s) {
      assert.equal(scl.signal(s), regel.signal(s), s + ' nach ' + (t + 1) + ' s');
    });
    assert.deepEqual(scl.kisten(), regel.kisten(), 'Kisten nach ' + (t + 1) + ' s');
  }
  assert.ok(scl.signal('SE2.Anzahl') >= 3);
});
