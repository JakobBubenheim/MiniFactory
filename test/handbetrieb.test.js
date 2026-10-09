// Handbetrieb (feature/handbetrieb): Ventil mit einem oder zwei Eingängen,
// neuer Drehtisch in zweipunkt 0 … 90°, Knöpfe im Abschnitt "Handbetrieb"
// (dieselbe Funktion wie im Panel, über die Fassade). Soll-Verhalten in Metern,
// Grad und Signalen.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { neueAnlage } = require('./helpers/anlage');

const LEER = { format: 'mini-fabrik', version: 3, name: 'Handbetrieb', settings: { dtMs: 20 }, folders: [], bodies: [], rules: [] };

function nahe(ist, soll, tol, text) {
  assert.ok(Math.abs(ist - soll) <= tol, (text || 'Wert') + ': ' + ist + ' statt ' + soll + ' ± ' + tol);
}

// Schieber S1 (Hub 0,4 m, 0,3 m/s, Rückfahrverzug 0,5 s) mit Ventil valve
function schieber(valve) {
  const a = neueAnlage(LEER);
  a.anlegen('pusher', 2, 2);
  if (valve) assert.equal(a.feld('S1', 'Achse', 'valve', valve), true);
  return a;
}

// ---------- Ventil mit zwei Eingängen ----------

test('Ventil mit zwei Eingängen: Signale Ausfahren und Einfahren, kein Rückfahrverzug', function () {
  const a = schieber();
  assert.equal(a.feld('S1', 'Achse', 'valve'), 'mono', 'neue Schieber: ein Eingang');
  assert.deepEqual(a.signale('S1'), ['Ausfahren', 'Ausgefahren', 'Eingefahren', 'Ist']);
  assert.equal(a.eigenschaft('S1', 'returnDelay'), 0.5);

  assert.equal(a.feld('S1', 'Achse', 'valve', 'bi'), true);
  assert.deepEqual(a.signale('S1'), ['Ausfahren', 'Einfahren', 'Ausgefahren', 'Eingefahren', 'Ist']);
  assert.equal(a.felder('S1', 'Achse').indexOf('returnDelay'), -1, 'zwei Eingänge: kein Rückfahrverzug im Panel');
  assert.throws(function () { a.eigenschaft('S1', 'returnDelay'); }, /returnDelay/);
  assert.equal(a.feld('S1', 'Achse', 'valve', 'tri'), true, 'Feld gibt es');
  assert.equal(a.achse('S1').valve, 'bi', 'unbekannter Wert ändert nichts');

  // Zurück auf ein Eingang: Einfahren fällt weg, Rückfahrverzug ist wieder da
  a.feld('S1', 'Achse', 'valve', 'mono');
  assert.deepEqual(a.signale('S1'), ['Ausfahren', 'Ausgefahren', 'Eingefahren', 'Ist']);
  assert.equal(a.eigenschaft('S1', 'returnDelay'), 0.5);
  // Nur in zweipunkt gibt es ein Ventil
  a.feld('S1', 'Achse', 'mode', 'position');
  assert.equal(a.felder('S1', 'Achse').indexOf('valve'), -1);
  assert.equal(a.achse('S1', { valve: 'xyz' }), false);
  assert.match(a.meldungen().pop(), /Ventil/);
});

test('Ventil mit zwei Eingängen: Impuls fährt aus, Achse bleibt bei beiden 0, Impuls Einfahren fährt ein', function () {
  const a = schieber('bi');
  // Impuls Ausfahren (ein Zyklus)
  a.setzen('S1.Ausfahren', 1);
  a.schritt();
  a.setzen('S1.Ausfahren', 0);
  assert.notEqual(a.laufenBis(function () { return a.signal('S1.Ausgefahren') === 1; }, 2), null, 'fährt aus');
  nahe(a.zeit(), 0.4 / 0.3, 0.05, 'Fahrzeit mit vmax');
  a.laufen(1);   // länger als der Rückfahrverzug von 0,5 s
  assert.equal(a.signal('S1.Ausgefahren'), 1, 'bleibt draußen, obwohl beide Eingänge 0 sind');

  // Impuls Einfahren
  a.setzen('S1.Einfahren', 1);
  a.schritt();
  a.setzen('S1.Einfahren', 0);
  assert.notEqual(a.laufenBis(function () { return a.signal('S1.Eingefahren') === 1; }, 2), null, 'fährt ein');
  a.laufen(0.5);
  assert.equal(a.signal('S1.Ist'), 0, 'bleibt drin');
});

test('Ventil mit zwei Eingängen: beide 1 – das Ventil bleibt, wie es zuletzt geschaltet wurde', function () {
  const a = schieber('bi');
  // Eingefahren, dann beide 1: bleibt eingefahren
  a.setzen('S1.Ausfahren', 1);
  a.setzen('S1.Einfahren', 1);
  a.laufen(0.5);
  assert.equal(a.signal('S1.Ist'), 0, 'beide 1 aus der Grundstellung: bleibt eingefahren');

  // Ausfahren allein schaltet um; kommt Einfahren unterwegs dazu, fährt die Achse trotzdem ganz aus
  a.setzen('S1.Einfahren', 0);
  a.laufen(0.2);
  const unterwegs = a.signal('S1.Ist');
  assert.ok(unterwegs > 0 && unterwegs < 0.4, 'unterwegs: ' + unterwegs);
  a.setzen('S1.Einfahren', 1);
  a.laufen(1.5);
  assert.equal(a.signal('S1.Ausgefahren'), 1, 'beide 1: das Ventil bleibt auf Ausfahren');

  // Ausfahren weg, Einfahren bleibt 1: fährt ein
  a.setzen('S1.Ausfahren', 0);
  assert.notEqual(a.laufenBis(function () { return a.signal('S1.Eingefahren') === 1; }, 2), null);
});

test('Alte Datei ohne Ventil: ein Eingang mit Rückfahrverzug wie bisher, die Datei bleibt ohne Ventil', function () {
  const vorlage = schieber().datei();
  const s = vorlage.bodies[0];
  delete s.axis.valve;   // so stehen Schieber in Dateien vor dem Handbetrieb
  const a = neueAnlage(vorlage);
  assert.equal(a.achse('S1').valve, undefined);
  assert.equal(a.feld('S1', 'Achse', 'valve'), 'mono');
  assert.deepEqual(a.signale('S1'), ['Ausfahren', 'Ausgefahren', 'Eingefahren', 'Ist']);

  a.setzen('S1.Ausfahren', 1);
  a.laufen(1.5);
  assert.equal(a.signal('S1.Ausgefahren'), 1);
  a.setzen('S1.Ausfahren', 0);
  a.laufen(0.4);
  assert.equal(a.signal('S1.Ausgefahren'), 1, 'wartet den Rückfahrverzug ab');
  a.laufen(0.2);
  assert.ok(a.signal('S1.Ist') < 0.4, 'nach 0,5 s fährt er ein');
  assert.equal(a.datei().bodies[0].axis.valve, undefined, 'Speichern ergänzt nichts');
});

// ---------- Drehtisch: neue Standards ----------

test('Neuer Drehtisch: Ausfahren = 1 dreht auf 90°, = 0 zurück auf 0°', function () {
  const a = neueAnlage(LEER);
  a.anlegen('turntable', 2, 2);
  const ax = a.achse('DT1');
  assert.equal(ax.mode, 'zweipunkt');
  assert.equal(ax.min, 0);
  assert.equal(ax.max, 90);
  assert.equal(a.signal('DT1.Eingefahren'), 1);

  a.setzen('DT1.Ausfahren', 1);
  assert.notEqual(a.laufenBis(function () { return a.signal('DT1.Ausgefahren') === 1; }, 3), null);
  nahe(a.zeit(), 90 / ax.vmax, 0.05, 'Fahrzeit');
  assert.equal(a.signal('DT1.Ist'), 90);
  nahe(a.lage('DT1').rot, 90, 1e-6, 'Drehung in der Welt');

  a.setzen('DT1.Ausfahren', 0);
  assert.notEqual(a.laufenBis(function () { return a.signal('DT1.Eingefahren') === 1; }, 3), null);
  assert.equal(a.signal('DT1.Ist'), 0);
  nahe(a.lage('DT1').rot, 0, 1e-6, 'zurück');
});

test('Alte Datei mit Drehtisch in Betriebsart position lädt unverändert', function () {
  const vorlage = neueAnlage(LEER);
  vorlage.anlegen('turntable', 2, 2);
  const d = vorlage.datei();
  // So speicherte die Vorlage bis zum Handbetrieb-Branch
  d.bodies[0].axis = { type: 'rotary', origin: [0, 0, 0], dir: [0, 0, 1], min: -180, max: 180, vmax: 90, mode: 'position', returnDelay: 0 };
  d.bodies[0].inputs = { Ein: 1, Soll: 0, Freigabe: 0 };
  const a = neueAnlage(d);
  assert.deepEqual(a.achse('DT1'), d.bodies[0].axis);
  assert.deepEqual(a.signale('DT1'), ['Ein', 'Läuft', 'Tempo', 'Soll', 'Freigabe', 'Ist', 'InPosition']);
  a.setzen('DT1.Soll', -90);
  a.setzen('DT1.Freigabe', 1);
  assert.notEqual(a.laufenBis(function () { return a.signal('DT1.InPosition') === 1; }, 2), null);
  assert.equal(a.signal('DT1.Ist'), -90);
  assert.deepEqual(a.datei().bodies[0].axis, d.bodies[0].axis);
});

test('Hubtisch, Stopper und Weiche starten in zweipunkt mit einem Eingang und ohne Rückfahrverzug', function () {
  const a = neueAnlage(LEER);
  ['lift', 'stopper', 'diverter'].forEach(function (k, i) {
    const id = a.anlegen(k, 2 * i, 0);
    const ax = a.achse(id);
    assert.equal(ax.mode, 'zweipunkt', k);
    assert.equal(ax.valve, 'mono', k);
    assert.equal(ax.returnDelay, 0, k);
  });
});

// ---------- Handbetrieb ----------

test('Handbetrieb zweipunkt, ein Eingang: Knopf Einfahren wirkt ohne Rückfahrverzug, kein Schritt im Verlauf', function () {
  const a = neueAnlage(schieber().datei());   // frisch geladen: Verlauf leer
  assert.equal(a.kannRueckgaengig(), false);
  assert.deepEqual(a.handbetriebHinweis('S1').knoepfe, { out: 'Ausfahren', in: 'Einfahren' });

  // Steht die Simulation, merkt sich der Eingang den Befehl, bewegt wird erst beim Laufen
  assert.equal(a.zustand(), 'stopped');
  assert.equal(a.handbetrieb('S1', 'out'), true);
  assert.equal(a.signal('S1.Ausfahren'), 1, 'schreibt denselben Eingang wie der I/O-Tab');
  assert.equal(a.signal('S1.Ist'), 0);
  assert.notEqual(a.laufenBis(function () { return a.signal('S1.Ausgefahren') === 1; }, 2), null);

  assert.equal(a.handbetrieb('S1', 'in'), true);
  assert.equal(a.signal('S1.Ausfahren'), 0);
  a.laufen(0.1);
  nahe(a.signal('S1.Ist'), 0.4 - 0.3 * 0.1, 1e-6, 'fährt sofort ein (Rückfahrverzug 0,5 s)');
  assert.equal(a.kannRueckgaengig(), false, 'Handbetrieb ist kein Schritt im Verlauf');

  // Danach gilt der Rückfahrverzug wieder für das Signal
  a.laufen(2);
  a.setzen('S1.Ausfahren', 1);
  a.laufen(1.5);
  a.setzen('S1.Ausfahren', 0);
  a.laufen(0.3);
  assert.equal(a.signal('S1.Ausgefahren'), 1, 'Signal Ausfahren = 0 wartet weiter den Rückfahrverzug ab');
  assert.equal(a.handbetrieb('S1', 'goto', 0.2), false, 'zweipunkt kennt kein Ziel');
});

test('Handbetrieb zweipunkt, zwei Eingänge: Knopf gibt einen Impuls, Reset nimmt ihn zurück', function () {
  const a = schieber('bi');
  assert.equal(a.handbetrieb('S1', 'out'), true);
  assert.equal(a.signal('S1.Ausfahren'), 1);
  a.schritt();
  assert.equal(a.signal('S1.Ausfahren'), 0, 'Impuls: nach einem Zyklus wieder 0');
  assert.notEqual(a.laufenBis(function () { return a.signal('S1.Ausgefahren') === 1; }, 2), null);

  a.setzen('S1.Ausfahren', 1);   // z. B. im I/O-Tab stehen gelassen
  assert.equal(a.handbetrieb('S1', 'in'), true);
  assert.equal(a.signal('S1.Ausfahren'), 0, 'der Gegen-Eingang wird 0');
  assert.notEqual(a.laufenBis(function () { return a.signal('S1.Eingefahren') === 1; }, 2), null);
  assert.equal(a.signal('S1.Einfahren'), 0);

  // Impuls bei gestoppter Simulation, dann Reset: nichts bleibt hängen
  a.reset();
  a.handbetrieb('S1', 'out');
  a.reset();
  assert.equal(a.signal('S1.Ausfahren'), 0);
  a.laufen(1);
  assert.equal(a.signal('S1.Ist'), 0);
});

test('Handbetrieb position: Ziel setzt Soll (in den Grenzen) und Freigabe', function () {
  const a = neueAnlage(LEER);
  a.anlegen('turntable', 2, 2);
  assert.deepEqual(a.handbetriebHinweis('DT1').knoepfe, { out: 'Drehen', in: 'Zurück' });
  assert.match(a.handbetriebHinweis('DT1').zeilen.join(' '), /DT1\.Ausfahren/);
  a.achse('DT1', { mode: 'position', min: -180, max: 180 });

  assert.equal(a.handbetrieb('DT1', 'goto', 90), true);
  assert.equal(a.signal('DT1.Soll'), 90);
  assert.equal(a.signal('DT1.Freigabe'), 1);
  assert.notEqual(a.laufenBis(function () { return a.signal('DT1.InPosition') === 1; }, 2), null);
  assert.equal(a.signal('DT1.Ist'), 90);

  a.handbetrieb('DT1', 'goto', 500);
  assert.equal(a.signal('DT1.Soll'), 180, 'Ziel in die Grenzen geklemmt');
  assert.equal(a.handbetrieb('DT1', 'goto', 'neunzig'), false);
  assert.equal(a.handbetrieb('DT1', 'out'), false);

  // Der Hinweis nennt SCL, das so übersetzt
  const zeile = a.handbetriebHinweis('DT1').zeilen.join(' ');
  assert.match(zeile, /DT1\.Soll := 90\.0; DT1\.Freigabe := TRUE;/);
  const code = zeile.slice(zeile.indexOf('DT1.Soll'), zeile.indexOf('TRUE;') + 5);
  assert.equal(a.sclPruefen(code), null, code);
});

test('Handbetrieb geschwindigkeit: ◀ / ■ / ▶ fahren mit vmax bzw. halten an', function () {
  const a = neueAnlage(LEER);
  a.anlegen('lift', 2, 2);
  a.achse('HT1', { mode: 'geschwindigkeit' });
  assert.deepEqual(a.handbetriebHinweis('HT1').knoepfe, { out: 'Heben', in: 'Senken' });

  assert.equal(a.handbetrieb('HT1', 'jog', 1), true);
  assert.equal(a.signal('HT1.Soll'), 0.2);
  assert.equal(a.signal('HT1.Freigabe'), 1);
  a.laufen(0.5);
  nahe(a.signal('HT1.Ist'), 0.1, 1e-6, 'mit vmax 0,2 m/s');
  a.handbetrieb('HT1', 'jog', 0);
  assert.equal(a.signal('HT1.Freigabe'), 0);
  a.laufen(0.5);
  nahe(a.signal('HT1.Ist'), 0.1, 1e-6, 'steht');
  a.handbetrieb('HT1', 'jog', -1);
  a.laufen(1);
  assert.equal(a.signal('HT1.Ist'), 0, 'zurück bis an die Grenze min');
  assert.equal(a.handbetrieb('HT1', 'jog', 2), false);
});
