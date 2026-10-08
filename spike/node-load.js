// Lädt lib/rapier.js und Spike-Skripte in einen node:vm-Kontext – so, wie die
// künftigen Tests (test/helpers/load.js) die Skripte der App laden.
//
// Rapier braucht im Kontext zusätzlich zwei Globals, die in Node zwar global
// sind, aber nicht zu V8 gehören und deshalb in einem neuen vm-Kontext fehlen:
//   TextDecoder  – sonst ReferenceError schon beim Laden des Skripts
//   performance  – sonst bricht world.step() mit „RuntimeError: unreachable“ ab
// WebAssembly und FinalizationRegistry bringt V8 selbst mit.
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');

/**
 * @param {string[]} [scripts] weitere Skripte relativ zum Wurzelverzeichnis
 * @returns {Promise<{ctx: object, loadMs: number, initMs: number}>}
 */
function load(scripts) {
  var ctx = { console: console, TextDecoder: TextDecoder, performance: performance };
  ctx.window = ctx;
  vm.createContext(ctx);
  var t0 = performance.now();
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'lib', 'rapier.js'), 'utf8'), ctx, { filename: 'lib/rapier.js' });
  var loadMs = performance.now() - t0;
  (scripts || []).forEach(function (s) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, s), 'utf8'), ctx, { filename: s });
  });
  var t1 = performance.now();
  return ctx.RAPIER.init().then(function () {
    return { ctx: ctx, loadMs: loadMs, initMs: performance.now() - t1 };
  });
}

module.exports = { load: load, ROOT: ROOT };
