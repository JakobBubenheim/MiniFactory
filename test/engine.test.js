// Engine: Quelle, Band, Senke, Stau und die Uhr (Start/Pause/Schritt/Reset).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { neueAnlage } = require('./helpers/anlage');
const plaene = require('./helpers/plaene');

// Zeitvergleiche mit Spielraum von einem Zeitschritt
const DT = 0.05;
function ungefaehr(ist, soll, toleranz, text) {
  assert.ok(Math.abs(ist - soll) <= toleranz + 1e-9, (text || '') + ' erwartet ' + soll + ' ± ' + toleranz + ', ist ' + ist);
}

test('Quelle erzeugt im eingestellten Takt', function () {
  const a = neueAnlage(plaene.strecke({ quelle: { interval: 2 } }));
  a.laufen(DT);
  assert.equal(a.signal('Q1.Erzeugt'), 1, 'erste Kiste sofort');
  a.laufen(1.9 - DT);
  assert.equal(a.signal('Q1.Erzeugt'), 1, 'vor Ablauf des Takts keine zweite Kiste');
  a.laufen(0.2);
  assert.equal(a.signal('Q1.Erzeugt'), 2, 'nach 2 s die zweite Kiste');
  a.laufen(8);
  assert.equal(a.signal('Q1.Erzeugt'), 6, 'nach gut 10 s sechs Kisten');
});

test('Quelle hält Max. Anzahl ein und erzeugt ohne Freigabe nichts', function () {
  const a = neueAnlage(plaene.strecke({ quelle: { interval: 1, maxCount: 3 } }));
  a.laufen(10);
  assert.equal(a.signal('Q1.Erzeugt'), 3);

  const b = neueAnlage(plaene.strecke());
  b.setzen('Q1.Freigabe', 0);
  b.laufen(5);
  assert.equal(b.signal('Q1.Erzeugt'), 0);
  assert.equal(b.kistenAnzahl(), 0);
});

test('Kiste erreicht die Senke SE1 am Bandende', function () {
  const a = neueAnlage(plaene.strecke());
  // Von der Quelle (0,75 m) bis zur Senke (4,5 m) bei 0,5 m/s: rund 7,5 s
  const t = a.laufenBis(function () { return a.signal('SE1.Anzahl') === 1; }, 20);
  assert.notEqual(t, null, 'Kiste ist nie angekommen');
  ungefaehr(t, 7.5, 1, 'Ankunftszeit');
  assert.ok(a.kistenAnzahl() < a.signal('Q1.Erzeugt'), 'Senke entfernt die Kiste');
});

test('Kisten stauen sich am Bandende, statt sich zu überlappen', function () {
  const a = neueAnlage(plaene.strecke({ senke: false, quelle: { interval: 0.5 } }));
  a.laufen(30);
  const kisten = a.kisten();
  const s = a.kistenGroesse();
  assert.ok(kisten.length >= 8, 'genug Kisten für einen Stau: ' + kisten.length);
  for (let i = 0; i < kisten.length; i++) {
    for (let j = i + 1; j < kisten.length; j++) {
      const dx = Math.abs(kisten[i].x - kisten[j].x), dy = Math.abs(kisten[i].y - kisten[j].y);
      assert.ok(!(dx < s - 1e-6 && dy < s - 1e-6), 'Kisten ' + i + ' und ' + j + ' überlappen');
    }
  }
  // Der Stau steht: weitere Zeit ändert nichts mehr an den Lagen
  a.laufen(2);
  assert.deepEqual(a.kisten().slice(0, kisten.length), kisten);
});

test('Band aus: Kisten bleiben stehen, Läuft = 0', function () {
  const a = neueAnlage(plaene.strecke());
  a.laufen(3);
  assert.equal(a.signal('B1.Läuft'), 1);
  a.setzen('B1.Ein', 0);
  const vorher = a.kisten();
  assert.ok(vorher.length > 0);
  a.laufen(3);
  assert.equal(a.signal('B1.Läuft'), 0);
  assert.deepEqual(a.kisten().slice(0, vorher.length), vorher);

  // Gleiches über die Eigenschaft "Antrieb"
  const b = neueAnlage(plaene.strecke());
  b.laufen(3);
  b.eigenschaft('B1', 'running', false);
  const vorherB = b.kisten();
  b.laufen(3);
  assert.deepEqual(b.kisten().slice(0, vorherB.length), vorherB);
  assert.equal(b.signal('B1.Läuft'), 0);
});

test('Tempo-Eingang ist auf 0 … 5 m/s begrenzt und wirkt auf das Band', function () {
  const a = neueAnlage(plaene.strecke());
  a.setzen('B1.Tempo', 9);
  assert.equal(a.signal('B1.Tempo'), 5);
  a.setzen('B1.Tempo', -2);
  assert.equal(a.signal('B1.Tempo'), 0);
  assert.equal(a.signal('B1.Läuft'), 0, 'Tempo 0: Band läuft nicht');
  a.setzen('B1.Tempo', 1.5);
  assert.equal(a.signal('B1.Tempo'), 1.5);
  assert.equal(a.eigenschaft('B1', 'speed'), 1.5, 'Tempo ist die Eigenschaft des Bands');

  // Doppeltes Tempo: Kiste ist etwa doppelt so schnell an der Senke
  const b = neueAnlage(plaene.strecke());
  b.setzen('B1.Tempo', 1);
  const t = b.laufenBis(function () { return b.signal('SE1.Anzahl') === 1; }, 20);
  ungefaehr(t, 3.75, 0.5, 'Ankunftszeit bei 1 m/s');
});

test('Start, Pause, Schritt und Reset', function () {
  const a = neueAnlage(plaene.strecke());
  assert.equal(a.zustand(), 'stopped');

  a.start();
  assert.equal(a.zustand(), 'running');
  a.echtzeit(1);
  ungefaehr(a.zeit(), 1, 2 * DT, 'Simulationszeit nach 1 s');

  a.pause();
  assert.equal(a.zustand(), 'paused');
  const t = a.zeit();
  a.echtzeit(1);
  assert.equal(a.zeit(), t, 'in der Pause steht die Zeit');

  a.schritt();
  ungefaehr(a.zeit(), t + DT, 1e-9, 'ein Schritt = ein Zeitschritt');
  assert.equal(a.zustand(), 'paused');

  a.laufen(10);
  assert.ok(a.kistenAnzahl() > 0);
  assert.ok(a.signal('SE1.Anzahl') > 0);
  assert.ok(a.signal('Q1.Erzeugt') > 0);

  a.reset();
  assert.equal(a.zustand(), 'stopped');
  assert.equal(a.zeit(), 0);
  assert.equal(a.kistenAnzahl(), 0, 'Reset leert die Kisten');
  assert.equal(a.signal('SE1.Anzahl'), 0, 'Reset setzt die Senke zurück');
  assert.equal(a.signal('Q1.Erzeugt'), 0, 'Reset setzt die Quelle zurück');

  // Nach dem Reset läuft alles wie beim ersten Mal
  a.laufen(DT);
  assert.equal(a.signal('Q1.Erzeugt'), 1);
});

test('Zeitfaktor 2 lässt doppelt so viel Simulationszeit vergehen', function () {
  const a = neueAnlage(plaene.strecke());
  a.zeitfaktor(2);
  a.start();
  a.echtzeit(1);
  ungefaehr(a.zeit(), 2, 2 * DT);
});

test('Zeitschritt ist nur in der Pause änderbar', function () {
  const a = neueAnlage(plaene.strecke());
  assert.equal(a.zeitschritt(), 50);
  a.start();
  assert.equal(a.zeitschritt(20), false, 'während des Laufs abgelehnt');
  assert.equal(a.zeitschritt(), 50);

  a.pause();
  assert.equal(a.zeitschritt(20), true);
  assert.equal(a.zeitschritt(), 20);
  assert.equal(a.datei().settings.dtMs, 20, 'Zeitschritt gehört zur Anlage');

  const t = a.zeit();
  a.schritt();
  ungefaehr(a.zeit(), t + 0.02, 1e-9, 'Schritt mit neuem Zeitschritt');
});
