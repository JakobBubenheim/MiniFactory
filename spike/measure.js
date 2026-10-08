// Spike Phase 1: Messungen der Transportfläche und der Leistung.
//
// Jede Messung baut eine eigene Szene (spike/scene.js), läuft ohne Darstellung
// und liefert Zahlen. Läuft im Browser (Taste X in spike-3d.html) und in Node
// (node spike/node-measure.js) gleich.
(function (global) {
  'use strict';

  var S = function () { return global.MF.spike3d; };

  function now() {
    return global.performance ? global.performance.now() : Date.now();
  }

  function run(scene, seconds, each) {
    var n = Math.round(seconds / scene.dt);
    for (var i = 0; i < n; i++) {
      scene.step();
      if (each) each(scene);
    }
  }

  function stats(arr) {
    if (!arr.length) return { mean: NaN, min: NaN, max: NaN };
    var sum = 0, min = Infinity, max = -Infinity;
    arr.forEach(function (v) { sum += v; if (v < min) min = v; if (v > max) max = v; });
    return { mean: sum / arr.length, min: min, max: max };
  }

  function deg(rad) { return rad * 180 / Math.PI; }

  // Kleinste Kontaktdistanz zwischen zwei Kisten (negativ = Überlappung in m)
  function minBoxContactDist(scene) {
    var w = scene.world, min = Infinity;
    scene.boxes.forEach(function (a) {
      var ca = a.body.collider(0);
      w.contactPairsWith(ca, function (cb) {
        var pb = cb.parent();
        if (!pb || !pb.isDynamic()) return;
        w.contactPair(ca, cb, function (m) {
          for (var i = 0; i < m.numContacts(); i++) min = Math.min(min, m.contactDist(i));
        });
      });
    });
    return min;
  }

  // 1. Tempo und Ruhe auf dem geraden Band
  function speedTest(R, method) {
    var sc = S().createScene(R, { method: method, spawner: false });
    var box = sc.addBox(0.6, 0, sc.BELT_TOP + sc.BOX / 2 + 0.005, 0);
    var vx = [], vyAbs = [], vzAbs = [], z = [], w = [];
    run(sc, 0.6);  // aufsetzen und anfahren
    var startStep = sc.tick;
    while (box.cur.p.x < 3.9 && sc.tick - startStep < 1000) {
      sc.step();
      var v = box.body.linvel(), av = box.body.angvel();
      vx.push(v.x); vyAbs.push(Math.abs(v.y)); vzAbs.push(Math.abs(v.z)); z.push(box.cur.p.z);
      w.push(Math.sqrt(av.x * av.x + av.y * av.y + av.z * av.z));
    }
    var s = stats(vx), sz = stats(z);
    sc.destroy();
    return {
      vMean: s.mean, vMin: s.min, vMax: s.max,
      devPct: Math.max(Math.abs(s.min - 0.5), Math.abs(s.max - 0.5)) / 0.5 * 100,
      vyMax: stats(vyAbs).max, vzMax: stats(vzAbs).max,
      zRange: sz.max - sz.min, wMax: stats(w).max
    };
  }

  // 2. Stau am Stopper: Erzeuger läuft, Stopper ist zu
  function jamTest(R, method, sceneOpts) {
    var o = { method: method };
    for (var k in sceneOpts || {}) o[k] = sceneOpts[k];
    var sc = S().createScene(R, o);
    sc.input.stopperOn = true;
    run(sc, 12);
    var queued = function () {
      return sc.boxes.filter(function (b) { return b.cur.p.x < 4.2 && b.cur.p.z > 0.7; })
        .sort(function (a, b) { return b.cur.p.x - a.cur.p.x; });
    };
    var minDist = Infinity, maxSpeed = 0, maxStepMove = 0;
    run(sc, 8, function () {
      minDist = Math.min(minDist, minBoxContactDist(sc));
      // nur stehende Kisten – die hinterste fährt noch ein, am Erzeuger fällt eine neue
      var q = queued();
      q.slice(0, Math.max(q.length - 3, 0)).forEach(function (b) {
        var v = b.body.linvel();
        maxSpeed = Math.max(maxSpeed, Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z));
      });
    });
    var q = queued();
    var gaps = [];
    for (var i = 1; i < q.length; i++) gaps.push(q[i - 1].cur.p.x - q[i].cur.p.x - sc.BOX);
    var still = q.slice(0, Math.max(q.length - 3, 0));
    still.forEach(function (b) {
      var d = Math.abs(b.cur.p.x - b.prev.p.x) + Math.abs(b.cur.p.y - b.prev.p.y) + Math.abs(b.cur.p.z - b.prev.p.z);
      maxStepMove = Math.max(maxStepMove, d);
    });
    var out = {
      queued: q.length,
      frontGap: q.length ? 4.15 - (q[0].cur.p.x + sc.BOX / 2) : NaN,   // Abstand vorderste Kiste ↔ Stopper
      gapMin: stats(gaps).min, gapMax: stats(gaps).max,
      minContactDist: minDist,
      maxSpeedQueued: maxSpeed,
      maxStepMove: maxStepMove,
      yMax: stats(q.map(function (b) { return Math.abs(b.cur.p.y); })).max
    };
    // Stopper auf: läuft der Stau wieder an und kommt durch die Ecke bis in Senke 1?
    sc.input.stopperOn = false;
    run(sc, 3);
    out.afterRelease = sc.boxes.filter(function (b) { return b.cur.p.x > 4.3; }).length;
    run(sc, 20);
    out.sink1After23s = sc.sinkCount[0];
    sc.destroy();
    return out;
  }

  // 3. Schräg aufgelegte Kiste (30°) bleibt schräg?
  function slantTest(R, method) {
    var sc = S().createScene(R, { method: method, spawner: false });
    var box = sc.addBox(0.7, 0, sc.BELT_TOP + sc.BOX / 2 + 0.005, 30);
    run(sc, 0.6);
    var y0 = deg(S().yawOf(box.cur.q)), ymin = y0, ymax = y0;
    var vx = [];
    while (box.cur.p.x < 3.9 && sc.tick < 1000) {
      sc.step();
      var y = deg(S().yawOf(box.cur.q));
      ymin = Math.min(ymin, y); ymax = Math.max(ymax, y);
      vx.push(box.body.linvel().x);
    }
    var out = { yawStart: y0, yawEnd: deg(S().yawOf(box.cur.q)), yawDrift: ymax - ymin,
      vMean: stats(vx).mean, yOff: box.cur.p.y };
    sc.destroy();
    return out;
  }

  // 4. 90°-Ecke Band A → Band B
  function cornerTest(R, method) {
    var sc = S().createScene(R, { method: method, spawner: false });
    var box = sc.addBox(4.7, 0, sc.BELT_TOP + sc.BOX / 2 + 0.005, 0);
    run(sc, 0.4);
    var t0 = sc.tick, zMax = -Infinity, zMin = Infinity, vzMax = 0, onB = null, vy = [];
    var yaw0 = deg(S().yawOf(box.cur.q));
    while (sc.tick - t0 < 400 && box.cur.p.y < 3.0) {
      sc.step();
      var p = box.cur.p, v = box.body.linvel();
      zMax = Math.max(zMax, p.z); zMin = Math.min(zMin, p.z);
      vzMax = Math.max(vzMax, Math.abs(v.z));
      if (onB === null && p.y > 0.5) onB = (sc.tick - t0) * sc.dt;
      if (p.y > 1.0) vy.push(v.y);
    }
    var s = stats(vy), vb = sc.belts[1].speed;
    var out = {
      timeToB: onB, xOnB: box.cur.p.x, yawChange: deg(S().yawOf(box.cur.q)) - yaw0,
      zMax: zMax, zMin: zMin, vzMax: vzMax,
      vB: vb, vyMean: s.mean, devPct: Math.max(Math.abs(s.min - vb), Math.abs(s.max - vb)) / vb * 100
    };
    sc.destroy();
    return out;
  }

  // 5. Band B → Rutsche → Senke 1
  function chuteTest(R, method) {
    var sc = S().createScene(R, { method: method, spawner: false });
    sc.addBox(6.0, 3.2, sc.BELT_TOP + sc.BOX / 2 + 0.005, 0);
    var t = null, vzMax = 0;
    run(sc, 10, function () {
      if (sc.boxes.length) vzMax = Math.max(vzMax, Math.abs(sc.boxes[0].body.linvel().z));
      if (t === null && sc.sinkCount[0] === 1) t = sc.tick * sc.dt;
    });
    var out = { counted: sc.sinkCount[0], timeToSink: t, lost: sc.lost };
    sc.destroy();
    return out;
  }

  // 6. Schieber stößt eine Kiste in Senke 2
  function pushTest(R, method) {
    var sc = S().createScene(R, { method: method, spawner: false });
    var box = sc.addBox(2.6, 0, sc.BELT_TOP + sc.BOX / 2 + 0.005, 0);
    // Band anhalten, damit die Kiste vor dem Schieber steht
    sc.belts[0].running = false;
    run(sc, 0.4);
    sc.input.pusherOut = true;
    run(sc, 1.2);
    sc.input.pusherOut = false;
    run(sc, 1.5);
    var out = { counted: sc.sinkCount[1], boxesLeft: sc.boxes.length };
    sc.destroy();
    return out;
  }

  // 7. Leistung: n Kisten gleichzeitig
  function perfTest(R, method, n, canSleep) {
    var sc = S().createScene(R, { method: method });
    sc.addMany(n, canSleep);
    var steps = [], worldSteps = [];
    var t0 = now();
    run(sc, 10, function () { steps.push(sc.stepMs); worldSteps.push(sc.worldStepMs); });
    var total = now() - t0;
    var first = stats(steps.slice(0, 100)), last = stats(steps.slice(-100));
    var sleeping = sc.boxes.filter(function (b) { return b.body.isSleeping(); }).length;
    var out = {
      boxes: sc.boxes.length, canSleep: canSleep !== false,
      msFirst2s: first.mean, msMaxFirst2s: first.max, msLast2s: last.mean,
      worldMsLast2s: stats(worldSteps.slice(-100)).mean,
      msAll: total / steps.length, sleeping: sleeping
    };
    sc.destroy();
    return out;
  }

  function runAll(R, log) {
    log = log || function () {};
    var res = { transport: {}, perf: {} };
    ['velocity', 'kinematic'].forEach(function (m) {
      log('Transportfläche ' + m + ' …');
      res.transport[m] = {
        speed: speedTest(R, m), jam: jamTest(R, m), slant: slantTest(R, m),
        corner: cornerTest(R, m), chute: chuteTest(R, m), push: pushTest(R, m)
      };
    });
    ['velocity', 'kinematic'].forEach(function (m) {
      log('Leistung ' + m + ' …');
      res.perf[m] = { sleep: perfTest(R, m, 200, true), awake: perfTest(R, m, 200, false) };
    });
    log('Determinismus …');
    res.determinism = ['velocity', 'kinematic'].map(function (m) {
      var r = S().runScenario(R, m, 30);
      delete r.snapshot;
      return r;
    });
    return res;
  }

  global.MF = global.MF || {};
  global.MF.spike3dMeasure = {
    speedTest: speedTest, jamTest: jamTest, slantTest: slantTest, cornerTest: cornerTest,
    chuteTest: chuteTest, pushTest: pushTest, perfTest: perfTest, runAll: runAll
  };
})(typeof window !== 'undefined' ? window : globalThis);
