// Mini-Fabrik ohne Browser: lädt die App-Skripte in einen vm-Kontext.
//
// Gemeinsam genutzt von den Tests (test/helpers/load.js) und vom MCP-Server
// (mcp/server.js). Reihenfolge wie in index.html, aber nur die Teile ohne
// Oberfläche. Für die Oberfläche gibt es nur so viel Ersatz (Stubs), wie diese
// Skripte brauchen. Jeder Aufruf von laden() liefert einen frischen Kontext.
//
// Physik (Rapier): lib/rapier.js braucht einmal das asynchrone RAPIER.init()
// (WASM laden); ein synchrones initSync gibt das Bündel nicht her. Laden der
// Anlage ist aber synchron. Lösung:
// - vorbereiten() lädt lib/rapier.js EINMAL je Prozess in einen eigenen
//   vm-Kontext und wartet auf RAPIER.init().
// - laden() legt dieses fertige RAPIER-Objekt als window.RAPIER in jeden neuen
//   App-Kontext. Rapier hat keinen globalen Zustand außer dem WASM-Speicher: jede
//   Anlage baut ihre eigene Welt (MF.engine.world), Läufe beeinflussen sich nicht
//   und bleiben bitgenau deterministisch (Spike-Ergebnis, Abschnitt 3).
// - Tempo: Jeder Prozess übersetzt das 3-MB-WASM neu. V8 optimiert es nach dem
//   ersten Lauf im Hintergrund nach (TurboFan) – bei sieben parallelen Testdateien
//   kostet das mehr, als es bringt (Suite 15 s statt 5 s). Darum rechnen die Tests
//   nur mit dem schnellen Basis-Übersetzer (--liftoff-only, Standard hier).
//   Ergebnisse sind gleich, WASM rechnet in beiden Stufen bitgenau gleich.
// - Der Rapier-Kontext braucht TextDecoder (sonst ReferenceError beim Laden) und
//   performance (sonst "RuntimeError: unreachable" in world.step()) – beides
//   gehört in Node nicht zu V8 und fehlt in einem neuen vm-Kontext.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const v8 = require('node:v8');

const ROOT = path.join(__dirname, '..');

// Skripte in der Reihenfolge aus index.html (ohne ui/*.js außer dem Verlauf)
const SKRIPTE = [
  'sim/geom.js',
  'sim/snap.js',      // Fangen: Raster und Objektfang (reine Rechnung)
  'sim/model.js',
  'sim/sim.js',       // nur für Zoom/Verschiebung beim Speichern; zeichnet ohne Canvas nichts
  'sim/clock.js',
  'sim/engine.js',
  'logic/scl.js',
  'logic/logic.js',
  'sim/migrate.js',
  'sim/file.js',
  'ui/history.js',
  'ui/view3d-core.js',  // 3D-Ansicht: reine Rechnung (Prisma, Interpolation, Kamera)
  'ui/view3d.js'        // lädt ohne Three.js und DOM; Renderer erst in start(), hier nie
];

// Dateien, die ein Prozess ohne Browser braucht (für das MCP-Bündel)
const DATEIEN = SKRIPTE.concat(['lib/rapier.js', 'tools/headless.js']);

// Quelltexte erst beim ersten laden() lesen und übersetzen, ausgeführt wird je Kontext neu
let quellen = null;
function uebersetzt() {
  if (!quellen) {
    quellen = SKRIPTE.map(function (datei) {
      const code = fs.readFileSync(path.join(ROOT, datei), 'utf8');
      return new vm.Script(code, { filename: datei });
    });
  }
  return quellen;
}

// ---------- Rapier, einmal je Prozess ----------

let rapier = null;
let rapierPromise = null;

/**
 * Lädt und initialisiert Rapier (einmal je Prozess). Gibt ein Promise zurück.
 * @param {object} [opt]
 * @param {boolean} [opt.nurLiftoff=true] WASM nur mit dem Basis-Übersetzer rechnen (siehe oben)
 */
function vorbereiten(opt) {
  opt = opt || {};
  if (!rapierPromise) {
    if (opt.nurLiftoff !== false) v8.setFlagsFromString('--liftoff-only');
    const rctx = { console: console, TextDecoder: TextDecoder, performance: performance };
    rctx.window = rctx;
    vm.createContext(rctx);
    const code = fs.readFileSync(path.join(ROOT, 'lib', 'rapier.js'), 'utf8');
    vm.runInContext(code, rctx, { filename: 'lib/rapier.js' });
    rapierPromise = rctx.RAPIER.init().then(function () { rapier = rctx.RAPIER; });
  }
  return rapierPromise;
}

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
 * @returns {object} der globale Kontext (window), darin window.MF;
 *   Meldungen der Statusleiste sammelt window.__meldungen
 */
function laden(opt) {
  opt = opt || {};
  if (!rapier) throw new Error('Rapier ist nicht geladen – vorher einmal await vorbereiten()');
  const meldungen = [];
  const timer = [];

  const ctx = {
    console: console,
    localStorage: speicher(),
    document: stubDocument(),
    // Zeichenschleife läuft nie von selbst; die Zeit treibt man über die Uhr
    requestAnimationFrame: function () { return 1; },
    cancelAnimationFrame: function () {},
    // Timer (Autosave) werden nur gemerkt, damit niemand auf sie wartet
    setTimeout: function (fn) { timer.push(fn); return timer.length; },
    clearTimeout: function () {},
    addEventListener: function () {},
    removeEventListener: function () {},
    confirm: function () { return true; },
    RAPIER: rapier,
    // Meldungen der Statusleiste sammeln, damit Tests und MCP sie lesen können
    __meldungen: meldungen
  };
  ctx.window = ctx;
  vm.createContext(ctx);

  uebersetzt().forEach(function (s) { s.runInContext(ctx); });

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

module.exports = { laden: laden, vorbereiten: vorbereiten, SKRIPTE: SKRIPTE, DATEIEN: DATEIEN, ROOT: ROOT };
