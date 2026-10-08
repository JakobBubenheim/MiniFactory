// Spike Phase 1: Darstellung und Bedienung der 3D-Demo (spike-3d.html).
//
// Die Physik steckt in spike/scene.js, die Zeit in sim/clock.js (fester
// Schritt 20 ms mit Akkumulator, Zeichnen interpoliert). Hier: Three.js-Szene,
// Orbit-Kamera, Licht und Schatten, Anzeige, Tasten.
//
// Koordinaten: Die Mini-Fabrik rechnet mit x rechts, y in der Draufsicht nach
// unten und z nach oben. Das ist (von oben gesehen) ein linkshändiges System;
// Three.js ist rechtshändig. Ohne Umrechnung wäre die 3D-Ansicht spiegelverkehrt
// zur Draufsicht. Deshalb hängt alles in einer Gruppe mit scale.y = −1; Three.js
// dreht dabei die Flächen-Reihenfolge selbst um. Kamera: camera.up = (0, 0, 1),
// OrbitControls kommt damit zurecht. Die Physik (Rapier) braucht keine Umrechnung.
(function () {
  'use strict';

  var T = window.SPIKE_T || {};
  var DT_MS = 20;

  function $(id) { return document.getElementById(id); }

  function showError(msg) {
    var el = $('error');
    el.textContent = msg;
    el.style.display = 'block';
    window.SPIKE_ERROR = msg;
  }

  if (!window.RAPIER) return showError('lib/rapier.js nicht geladen (window.RAPIER fehlt).');
  if (!window.THREE || !window.THREE_ADDONS) return showError('lib/three.js nicht geladen (window.THREE fehlt).');

  var R = window.RAPIER;
  var THREE = window.THREE;
  var OrbitControls = window.THREE_ADDONS.OrbitControls;
  var S = MF.spike3d;

  var sc = null;        // Physik-Szene
  var clock = null;
  var three = {};       // Renderer, Kamera, Gruppen
  var partMeshes = [];  // { part, mesh }
  var boxMeshes = {};   // Kisten-ID → Mesh
  var perf = { frames: 0, lastFps: performance.now(), fps: 0, steps: [], worldSteps: [] };

  // ---------- Start ----------

  var tInit = performance.now();
  R.init().then(function () {
    T.init = performance.now() - tInit;
    start();
  }, function (e) {
    showError('Rapier konnte nicht starten (WASM):\n' + (e && e.message ? e.message : e));
  });

  function start() {
    $('h-load').textContent = 'Laden: rapier.js ' + (T.rapier - T.start).toFixed(0) + ' ms, three.js ' +
      (T.three - T.rapier).toFixed(0) + ' ms, RAPIER.init() ' + T.init.toFixed(0) + ' ms · Rapier ' +
      R.version() + ', Three r' + THREE.REVISION;
    window.SPIKE_LOAD = { rapierMs: T.rapier - T.start, threeMs: T.three - T.rapier, initMs: T.init };

    initThree();
    newScene('velocity');

    clock = MF.createClock({
      dtMs: DT_MS,
      onTick: function () {
        sc.step();
        perf.steps.push(sc.stepMs);
        perf.worldSteps.push(sc.worldStepMs);
        if (perf.steps.length > 50) { perf.steps.shift(); perf.worldSteps.shift(); }
      },
      onRender: render
    });
    clock.start();
    clock.play();

    document.addEventListener('keydown', function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (command(e.key.toLowerCase())) e.preventDefault();
    });
    Array.prototype.forEach.call(document.querySelectorAll('#keys button'), function (b) {
      b.addEventListener('click', function () { command(b.getAttribute('data-key')); b.blur(); });
    });

    window.SPIKE_READY = true;
    autoRun();
  }

  // ---------- Three.js ----------

  function initThree() {
    var renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;   // PCFSoftShadowMap gibt es seit r18x nicht mehr
    $('view').appendChild(renderer.domElement);

    var scene = new THREE.Scene();
    scene.background = new THREE.Color('#eef1f5');

    // Gespiegelte Gruppe: darin gelten die Koordinaten der Mini-Fabrik (y nach „unten“)
    var world = new THREE.Group();
    world.scale.y = -1;
    scene.add(world);

    // Kamera in Three-Koordinaten (y' = −y): schaut vom unteren Rand der Draufsicht schräg auf die Anlage
    var camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.05, 200);
    camera.up.set(0, 0, 1);
    camera.position.set(-1.5, -10.5, 6.5);

    var controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(3.2, -2.2, 0.4);
    controls.enableDamping = true;
    controls.update();

    var hemi = new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.2);
    hemi.position.set(0, 0, 1);
    scene.add(hemi);

    var sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(-3, 5, 10);          // Mini-Fabrik-Koordinaten (in der Gruppe)
    sun.target.position.set(3, 1.5, 0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    var sh = sun.shadow.camera;
    sh.left = -9; sh.right = 9; sh.top = 9; sh.bottom = -9; sh.near = 1; sh.far = 30;
    sun.shadow.bias = -0.0005;
    world.add(sun);
    world.add(sun.target);

    var parts = new THREE.Group();
    var boxes = new THREE.Group();
    world.add(parts);
    world.add(boxes);

    window.addEventListener('resize', function () {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });

    three = {
      renderer: renderer, scene: scene, camera: camera, controls: controls, parts: parts, boxes: boxes,
      boxGeo: new THREE.BoxGeometry(0.3, 0.3, 0.3),
      boxMats: ['#c8a165', '#b88a4e', '#d6b27a'].map(function (c) {
        return new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 });
      }),
      qa: new THREE.Quaternion(), qb: new THREE.Quaternion()
    };
  }

  // Streifen auf der Bandoberfläche, damit man die Bewegung sieht
  function stripeTexture(alongY, length) {
    var c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    var g = c.getContext('2d');
    g.fillStyle = '#2a3340';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#3b4757';
    if (alongY) g.fillRect(0, 0, 64, 16); else g.fillRect(0, 0, 16, 64);
    var tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    var n = length / 0.25;   // ein Streifen alle 25 cm
    if (alongY) tex.repeat.set(1, n); else tex.repeat.set(n, 1);
    if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function buildPartMeshes() {
    while (three.parts.children.length) {
      var m = three.parts.children.pop();
      m.traverse(function (o) { if (o.geometry) o.geometry.dispose(); });
    }
    partMeshes = [];
    sc.parts.forEach(function (p) {
      var geo = new THREE.BoxGeometry(p.half.x * 2, p.half.y * 2, p.half.z * 2);
      var mesh;
      if (p.kind === 'ghost') {
        mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: p.color, transparent: true,
          opacity: 0.15, depthWrite: false }));
        mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo),
          new THREE.LineBasicMaterial({ color: p.color })));
      } else if (p.kind === 'belt') {
        var alongY = p.dir.y !== 0;
        p.texture = stripeTexture(alongY, alongY ? p.half.y * 2 : p.half.x * 2);
        var side = new THREE.MeshStandardMaterial({ color: '#1b2430', roughness: 0.7 });
        var top = new THREE.MeshStandardMaterial({ map: p.texture, roughness: 0.9 });
        // Reihenfolge der Seiten bei BoxGeometry: +x, −x, +y, −y, +z, −z
        mesh = new THREE.Mesh(geo, [side, side, side, side, top, side]);
        mesh.receiveShadow = true;
      } else {
        var mat = new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.6, metalness: 0.1,
          transparent: p.name === 'Stopper' });
        mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = p.name !== 'Boden';
        mesh.receiveShadow = true;
      }
      mesh.position.set(p.pos.x, p.pos.y, p.pos.z);
      mesh.quaternion.set(p.rot.x, p.rot.y, p.rot.z, p.rot.w);
      three.parts.add(mesh);
      partMeshes.push({ part: p, mesh: mesh });
    });
  }

  function newScene(method) {
    if (sc) sc.destroy();
    sc = S.createScene(R, { method: method, dtMs: DT_MS });
    buildPartMeshes();
    Object.keys(boxMeshes).forEach(function (id) { three.boxes.remove(boxMeshes[id]); });
    boxMeshes = {};
  }

  // ---------- Zeichnen ----------

  function render(alpha) {
    var i;
    // Teile: Schieber interpoliert, Stopper halb durchsichtig wenn aus, Bandstreifen
    for (i = 0; i < partMeshes.length; i++) {
      var p = partMeshes[i].part, mesh = partMeshes[i].mesh;
      if (p === sc.pusher) mesh.position.y = p.prevY + (p.pos.y - p.prevY) * alpha;
      else if (p === sc.stopper) mesh.material.opacity = p.visible ? 1 : 0.15;
      else if (p.kind === 'belt') {
        var s = -p.offset / 0.25;
        if (p.dir.y !== 0) p.texture.offset.y = s * p.dir.y; else p.texture.offset.x = s * p.dir.x;
      } else if (p === sc.sensor) {
        mesh.material.opacity = sc.sensorBusy ? 0.45 : 0.15;
      }
    }

    // Kisten: neue anlegen, entfernte löschen, Lage zwischen zwei Schritten interpolieren
    var seen = {};
    for (i = 0; i < sc.boxes.length; i++) {
      var b = sc.boxes[i];
      var m = boxMeshes[b.id];
      if (!m) {
        m = new THREE.Mesh(three.boxGeo, three.boxMats[b.id % three.boxMats.length]);
        m.castShadow = true;
        m.receiveShadow = true;
        three.boxes.add(m);
        boxMeshes[b.id] = m;
      }
      seen[b.id] = true;
      var a = b.prev, c = b.cur;
      m.position.set(a.p.x + (c.p.x - a.p.x) * alpha, a.p.y + (c.p.y - a.p.y) * alpha, a.p.z + (c.p.z - a.p.z) * alpha);
      three.qa.set(a.q.x, a.q.y, a.q.z, a.q.w);
      three.qb.set(c.q.x, c.q.y, c.q.z, c.q.w);
      m.quaternion.slerpQuaternions(three.qa, three.qb, alpha);
    }
    Object.keys(boxMeshes).forEach(function (id) {
      if (!seen[id]) { three.boxes.remove(boxMeshes[id]); delete boxMeshes[id]; }
    });

    three.controls.update();
    three.renderer.render(three.scene, three.camera);
    updateHud();
  }

  function avg(arr) {
    var s = 0;
    for (var i = 0; i < arr.length; i++) s += arr[i];
    return arr.length ? s / arr.length : 0;
  }

  function updateHud() {
    perf.frames++;
    var now = performance.now();
    if (now - perf.lastFps >= 500) {
      perf.fps = perf.frames * 1000 / (now - perf.lastFps);
      perf.frames = 0;
      perf.lastFps = now;
      window.SPIKE_FPS = perf.fps;
    }
    var inp = sc.input;
    $('h-method').textContent = sc.method === 'velocity' ? 'a) Geschwindigkeit nachführen' : 'b) Laufband-Trick (kinematisch)';
    $('h-fps').textContent = perf.fps.toFixed(0);
    $('h-phys').textContent = avg(perf.steps).toFixed(2) + ' ms (davon world.step ' + avg(perf.worldSteps).toFixed(2) + ' ms)';
    $('h-time').textContent = MF.formatTime(clock.timeMs, true) + (clock.running ? '' : ' (Pause)');
    $('h-boxes').textContent = sc.boxes.length;
    $('h-sensor').innerHTML = sc.sensorBusy ? '<span class="on">Belegt</span>' : 'frei';
    $('h-sink1').textContent = sc.sinkCount[0];
    $('h-sink2').textContent = sc.sinkCount[1];
    $('h-act').innerHTML = (inp.pusherOut ? '<span class="on">aus</span>' : 'ein') + ' / ' +
      (inp.stopperOn ? '<span class="on">zu</span>' : 'offen');
    $('h-gen').textContent = (inp.spawnerOn ? 'an' : 'aus') + ' / ' + (sc.belts[0].running ? 'laufen' : 'stehen');
  }

  // ---------- Bedienung ----------

  function command(key) {
    var inp = sc.input;
    switch (key) {
      case 'a': inp.pusherOut = !inp.pusherOut; return true;
      case 't': inp.stopperOn = !inp.stopperOn; return true;
      case 'm': sc.setMethod(sc.method === 'velocity' ? 'kinematic' : 'velocity'); return true;
      case 'b': sc.belts.forEach(function (b) { b.running = !b.running; }); return true;
      case 'e': inp.spawnerOn = !inp.spawnerOn; return true;
      case 's': sc.addBox(1.0, 0, 1.2, 30); return true;
      case 'p': sc.addMany(200); return true;
      case ' ': clock.toggle(); return true;
      case 'r': newScene(sc.method); clock.reset(); clock.play(); return true;
      case 'd': later('Determinismus-Lauf …', determinism); return true;
      case 'x': later('Messungen laufen (dauert einige Sekunden) …', measureAll); return true;
    }
    return false;
  }

  function out(text) {
    var el = $('out');
    el.textContent = text;
    el.style.display = text ? 'block' : 'none';
  }

  // Lange Rechnungen erst nach dem nächsten Bild starten, damit der Hinweis erscheint
  function later(msg, fn) {
    out(msg);
    setTimeout(function () {
      try { fn(); } catch (e) { out('Fehler: ' + (e && e.stack ? e.stack : e)); }
    }, 50);
  }

  function determinism() {
    var lines = ['Determinismus: 30 s Szenario (Stopper 6–14 s, Schieber 9/17/24 s, schräge Kiste 4 s), je zweimal'];
    var res = [];
    ['velocity', 'kinematic'].forEach(function (m) {
      var a = S.runScenario(R, m, 30), b = S.runScenario(R, m, 30);
      var same = a.hash === b.hash;
      res.push({ method: m, hashA: a.hash, hashB: b.hash, identical: same, boxes: a.boxes, sinks: a.sinks, ms: a.ms });
      lines.push(m + ': ' + a.hash + ' / ' + b.hash + (same ? '  identisch' : '  VERSCHIEDEN') +
        '  · Kisten ' + a.boxes + ', Senken ' + a.sinks.join('/') + ', ' + a.ms.toFixed(0) + ' ms Rechenzeit');
    });
    lines.push('', 'Gleiche Hashes in Node: node spike/node-measure.js (Abschnitt "determinism").');
    window.SPIKE_DETERMINISM = res;
    out(lines.join('\n'));
  }

  function round(obj) {
    return JSON.parse(JSON.stringify(obj, function (k, v) {
      return typeof v === 'number' && !Number.isInteger(v) ? Number(v.toPrecision(4)) : v;
    }));
  }

  function measureAll() {
    var res = MF.spike3dMeasure.runAll(R);
    res.load = window.SPIKE_LOAD;
    res.userAgent = navigator.userAgent;
    window.SPIKE_MEASURE = round(res);
    out(JSON.stringify(window.SPIKE_MEASURE, null, 1).replace(/\n\s*/g, ' ').replace(/ ?\} ?,/g, ' },\n'));
  }

  // Automatisch messen über die Adresse: spike-3d.html#messen bzw. #fps200
  function autoRun() {
    var h = location.hash;
    if (h === '#messen') later('Messungen laufen …', measureAll);
    if (h === '#fps200') {
      sc.input.spawnerOn = true;
      sc.addMany(200);
      // nach 3 s Einschwingen 10 s lang FPS und Physik-Zeit sammeln
      setTimeout(function () {
        var frames = 0, t0 = performance.now(), steps = [];
        var origTick = sc.step;
        sc.step = function () { origTick(); steps.push(sc.stepMs); };
        (function count() {
          frames++;
          if (performance.now() - t0 < 10000) return requestAnimationFrame(count);
          sc.step = origTick;
          window.SPIKE_FPS200 = { fps: frames * 1000 / (performance.now() - t0), boxes: sc.boxes.length,
            stepMs: avg(steps), stepMsMax: Math.max.apply(null, steps) };
          out('200 Kisten: ' + JSON.stringify(round(window.SPIKE_FPS200)));
        })();
      }, 3000);
    }
  }
})();
