// Lädt die Browser-Skripte der Mini-Fabrik ohne Browser in einen vm-Kontext.
//
// Reihenfolge wie in index.html, aber nur die Teile ohne Oberfläche. Für die
// Oberfläche gibt es nur so viel Ersatz (Stubs), wie diese Skripte brauchen.
// Jeder Aufruf liefert einen frischen Kontext – Tests beeinflussen sich nicht.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');

// Skripte in der Reihenfolge aus index.html (ohne ui/*.js außer dem Verlauf)
const SKRIPTE = [
  'sim/model.js',
  'sim/sim.js',       // nur für Zoom/Verschiebung beim Speichern; zeichnet ohne Canvas nichts
  'sim/clock.js',
  'sim/engine.js',
  'logic/scl.js',
  'logic/logic.js',
  'sim/file.js',
  'ui/history.js'
];

// Quelltexte nur einmal lesen und übersetzen, ausgeführt wird je Kontext neu
const quellen = SKRIPTE.map(function (datei) {
  const code = fs.readFileSync(path.join(ROOT, datei), 'utf8');
  return new vm.Script(code, { filename: datei });
});

// localStorage mit Speicher im Objekt
function speicher() {
  const daten = {};
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(daten, k) ? daten[k] : null; },
    setItem: function (k, v) { daten[k] = String(v); },
    removeItem: function (k) { delete daten[k]; },
    clear: function () { Object.keys(daten).forEach(function (k) { delete daten[k]; }); }
  };
}

// Minimales Element bzw. Dokument: Abfragen liefern nichts, Ereignisse werden ignoriert
function stubElement() {
  return {
    style: {}, classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {}, removeEventListener() {},
    appendChild() {}, removeChild() {}, click() {}
  };
}

function stubDocument() {
  return {
    addEventListener() {}, removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getElementById() { return null; },
    createElement: stubElement,
    body: stubElement()
  };
}

/**
 * Neuer Kontext mit geladenen Skripten.
 * @param {object} [opt]
 * @param {boolean} [opt.start=true] wie main.js initialisieren (ohne Oberfläche)
 * @returns {object} der globale Kontext (window), darin window.MF
 */
function laden(opt) {
  opt = opt || {};
  const meldungen = [];
  const timer = [];

  const ctx = {
    console: console,
    localStorage: speicher(),
    document: stubDocument(),
    // Zeichenschleife läuft nie von selbst; Tests treiben die Zeit über die Uhr
    requestAnimationFrame: function () { return 1; },
    cancelAnimationFrame: function () {},
    // Timer (Autosave) werden nur gemerkt, damit kein Test auf sie wartet
    setTimeout: function (fn) { timer.push(fn); return timer.length; },
    clearTimeout: function () {},
    addEventListener: function () {},
    removeEventListener: function () {},
    confirm: function () { return true; },
    // Meldungen der Statusleiste sammeln, damit Tests sie prüfen können
    __meldungen: meldungen
  };
  ctx.window = ctx;
  vm.createContext(ctx);

  quellen.forEach(function (s) { s.runInContext(ctx); });

  // Statusleiste (ui/ui.js) wird nicht geladen – nur die Aufrufe der Kernskripte
  ctx.MF.ui = {
    message: function (text) { meldungen.push(text); },
    updateStatus: function () {},
    updateSimStatus: function () {}
  };

  if (opt.start !== false) {
    // Wie main.js, ohne Fläche, Baum, Panels und Editor
    ctx.MF.file.restoreAutosave();
    ctx.MF.engine.init();
    ctx.MF.logic.init();
    ctx.MF.file.init();
    ctx.MF.history.init();
  }
  return ctx;
}

module.exports = { laden: laden, SKRIPTE: SKRIPTE };
