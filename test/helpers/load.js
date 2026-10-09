// Lädt die Browser-Skripte der Mini-Fabrik ohne Browser in einen vm-Kontext.
//
// Die eigentliche Arbeit (Skriptliste, Stubs, Rapier einmal je Prozess) steckt in
// tools/headless.js – das nutzt auch der MCP-Server (mcp/). Neue Skripte also dort
// in SKRIPTE eintragen.
// - vorbereiten() lädt Rapier EINMAL je Testprozess (die Fassade anlage.js ruft das
//   in einem before()-Hook von node:test auf) und rechnet nur mit --liftoff-only.
// - laden() liefert je Aufruf einen frischen Kontext – Tests beeinflussen sich nicht.
'use strict';

const { laden, vorbereiten, SKRIPTE } = require('../../tools/headless');

module.exports = { laden: laden, vorbereiten: vorbereiten, SKRIPTE: SKRIPTE };
