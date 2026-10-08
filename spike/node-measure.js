// Führt alle Spike-Messungen (spike/measure.js) in Node aus und prüft den
// Determinismus: zwei Läufe des 30-s-Szenarios pro Methode müssen identische
// Kistenlagen liefern.
//
// Aufruf: node spike/node-measure.js [--json]
'use strict';

var load = require('./node-load').load;

function maxDiff(a, b) {
  if (a.length !== b.length) return Infinity;
  var d = 0;
  for (var i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i]));
  return d;
}

function round(obj) {
  return JSON.parse(JSON.stringify(obj, function (k, v) {
    return typeof v === 'number' && !Number.isInteger(v) ? Number(v.toPrecision(4)) : v;
  }));
}

load(['spike/scene.js', 'spike/measure.js']).then(function (env) {
  var R = env.ctx.RAPIER, MF = env.ctx.MF;
  var res = MF.spike3dMeasure.runAll(R, function (s) { process.stderr.write(s + '\n'); });

  res.repeat = ['velocity', 'kinematic'].map(function (m) {
    var a = MF.spike3d.runScenario(R, m, 30), b = MF.spike3d.runScenario(R, m, 30);
    return { method: m, hashA: a.hash, hashB: b.hash, identical: a.hash === b.hash, maxDiff: maxDiff(a.snapshot, b.snapshot) };
  });
  res.env = { node: process.version, rapier: R.version(), loadMs: env.loadMs, initMs: env.initMs };

  if (process.argv.indexOf('--json') >= 0) {
    console.log(JSON.stringify(round(res), null, 2));
    return;
  }
  console.log(JSON.stringify(round(res), null, 1).replace(/\n\s*/g, ' ').replace(/ ?\} ?,/g, ' },\n'));
}).catch(function (e) {
  console.error(e);
  process.exitCode = 1;
});
