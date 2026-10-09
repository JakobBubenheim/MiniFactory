// Messmatrix der Bandnaht (Spike-3D-Ergebnis 4a): zwei bündige Bänder, dichter Zug
// (Takt 0,3 s, Kisten berühren sich) und lockerer Zug, Folgeband langsamer, gleich
// und schneller. Je Spalt eine eigene Datei, damit sie neben den anderen Tests läuft.
// Ohne Umlenkrolle hingen hier bis zu 6 von 10 Kisten.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { messmatrix } = require('./helpers/naht');

test('Messmatrix bündig mit 1 cm Spalt: keine Kiste hängt an der Naht (4 Tempo-Paare × Takt 0,3/1 s)', function () {
  assert.deepEqual(messmatrix(0.01), []);
});
