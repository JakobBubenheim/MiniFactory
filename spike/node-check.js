// Prüft, ob lib/rapier.js in Node in einem node:vm-Kontext läuft, lässt eine
// Kiste (0,3 m Würfel) aus 1 m Höhe auf den Boden fallen und gibt die Endlage aus.
//
// Aufruf: node spike/node-check.js
'use strict';

var load = require('./node-load').load;

load().then(function (env) {
  var R = env.ctx.RAPIER;
  var world = new R.World({ x: 0, y: 0, z: -9.81 }); // z nach oben
  world.timestep = 0.02;
  world.createCollider(R.ColliderDesc.cuboid(5, 5, 0.05).setTranslation(0, 0, -0.05));
  var body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(0, 0, 1));
  world.createCollider(R.ColliderDesc.cuboid(0.15, 0.15, 0.15).setFriction(0.6), body);

  for (var i = 0; i < 150; i++) world.step(); // 3 s
  var p = body.translation();

  console.log('Rapier ' + R.version() + ' im node:vm-Kontext');
  console.log('  Skript laden: ' + env.loadMs.toFixed(1) + ' ms, init(): ' + env.initMs.toFixed(1) + ' ms');
  console.log('  Endlage nach 3 s: x=' + p.x.toFixed(4) + ' y=' + p.y.toFixed(4) + ' z=' + p.z.toFixed(4) +
    ' (erwartet z = 0,15), schläft: ' + body.isSleeping());
  if (Math.abs(p.z - 0.15) > 0.01) {
    console.error('FEHLER: Kiste liegt nicht auf dem Boden');
    process.exitCode = 1;
  }
}).catch(function (e) {
  console.error(e);
  process.exitCode = 1;
});
