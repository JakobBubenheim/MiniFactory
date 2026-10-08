// Spike Phase 1: Physik-Szene der Mini-Fabrik in Rapier 3D – ohne Darstellung.
//
// Läuft im Browser (spike-3d.html) und in Node (spike/node-*.js) gleich, damit
// Messungen und Determinismus-Läufe überall denselben Code nutzen.
//
// Koordinaten wie im Konzept: x nach rechts, y in der Draufsicht nach unten,
// z nach oben, Boden bei z = 0, Einheiten Meter / Sekunden.
//
// Ein Schritt läuft in der Reihenfolge des SPS-Zyklus (Konzept Abschnitt 4):
// Sensoren lesen → Eingänge übernehmen → Aktoren → Physik-Schritt
// (inkl. Transportflächen) → Erzeuger und Senken.
//
// Transportfläche, zwei umschaltbare Methoden:
//   'velocity'  – Band ist statisch und reibungsfrei. Vor jedem Schritt wird die
//                 Geschwindigkeit aufliegender Kisten in der Bandebene zur
//                 Bandgeschwindigkeit gezogen: v += k·(v_band − v), wobei die
//                 Änderung pro Schritt auf μ·g·dt begrenzt ist (wie Haftreibung).
//   'kinematic' – „Laufband-Trick“: Band ist ein kinematischer Körper mit
//                 gesetzter Geschwindigkeit; nach jedem Schritt wird seine Lage
//                 zurückgesetzt. Die normale Reibung nimmt die Kisten mit.
(function (global) {
  'use strict';

  var G = 9.81;
  var BOX = 0.3;                 // Kantenlänge einer Kiste (m)
  var BOX_DENSITY = 200;         // kg/m³ → 5,4 kg pro Kiste
  var BELT_TOP = 0.7;            // Oberkante der Bänder (m)
  var BELT_SPEED = 0.5;          // m/s
  var SURFACE_K = 1;             // Nachführfaktor k der Methode 'velocity'
  var ALLOWED_ERROR = 0.005;     // erlaubtes Eindringen (m); Rapier-Standard
  // Kontaktsteifigkeit: Rapier-Standard 30 Hz lässt Kisten im Stau ~5 mm ineinander
  // rutschen; 60 Hz → ~1 mm ohne Zittern, ab 120 Hz zittert der Stau (Spike-Messung)
  var CONTACT_HZ = 60;

  // Reibungswerte. Rapier mittelt standardmäßig (Average) zwischen zwei Körpern;
  // Rutsche und Band (Methode 'velocity') nutzen Min, damit ihr Wert gilt.
  var MU = { belt: 0.8, box: 0.6, floor: 0.6, steel: 0.3, chute: 0.1 };

  var COLORS = {
    floor: '#d9dde3', belt: '#2a3340', frame: '#8a94a3', steel: '#9aa5b4',
    chute: '#b8c2cf', pusher: '#e0a030', stopper: '#c0392b',
    sensor: '#2e86de', sink: '#27ae60', spawner: '#8e44ad'
  };

  // Rapier-Quaternion {x, y, z, w} für eine Drehung um eine Einheitsachse
  function quatAxis(ax, ay, az, rad) {
    var s = Math.sin(rad / 2);
    return { x: ax * s, y: ay * s, z: az * s, w: Math.cos(rad / 2) };
  }

  // Drehung um z aus einem Quaternion (für schräg aufgelegte Kisten)
  function yawOf(q) {
    return Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));
  }

  function now() {
    return global.performance ? global.performance.now() : Date.now();
  }

  function inBox(p, g) {
    return Math.abs(p.x - g.pos.x) <= g.half.x &&
      Math.abs(p.y - g.pos.y) <= g.half.y &&
      Math.abs(p.z - g.pos.z) <= g.half.z;
  }

  /**
   * Baut die Spike-Anlage in einer eigenen Rapier-Welt.
   * @param {object} R        das Rapier-Modul (window.RAPIER nach init())
   * @param {object} [opts]
   * @param {string} [opts.method='velocity']  Transportflächen-Methode
   * @param {number} [opts.dtMs=20]            fester Zeitschritt
   * @param {boolean} [opts.spawner=true]      Erzeuger eingeschaltet
   * @param {number} [opts.solverIterations]   Rapier-Standard ist 4
   * @param {number} [opts.allowedError]       erlaubtes Eindringen in m (Rapier-Standard 0,005)
   * @param {number} [opts.contactHz=60]       Kontaktsteifigkeit (Rapier-Standard 30 Hz)
   */
  function createScene(R, opts) {
    opts = opts || {};
    var dt = (opts.dtMs || 20) / 1000;
    var world = new R.World({ x: 0, y: 0, z: -G });
    world.timestep = dt;
    if (opts.solverIterations) world.numSolverIterations = opts.solverIterations;
    world.integrationParameters.normalizedAllowedLinearError = opts.allowedError || ALLOWED_ERROR;
    world.integrationParameters.contact_natural_frequency = opts.contactHz || CONTACT_HZ;

    var scene = {
      R: R,
      world: world,
      dt: dt,
      method: opts.method || 'velocity',
      tick: 0,
      parts: [],      // alles Feste/Kinematische/Immaterielle fürs Zeichnen
      belts: [],
      boxes: [],
      nextBoxId: 1,
      // Eingänge (wie Signale der Steuerung)
      input: { pusherOut: false, stopperOn: false, spawnerOn: opts.spawner !== false },
      // Ausgänge
      sensorBusy: false,
      sinkCount: [0, 0],
      lost: 0,
      // Messwerte
      stepMs: 0,       // letzter Schritt gesamt
      worldStepMs: 0   // davon world.step()
    };

    // ---------- Teile ----------

    function addPart(p) {
      p.visible = true;
      p.rot = p.rot || { x: 0, y: 0, z: 0, w: 1 };
      scene.parts.push(p);
      return p;
    }

    function addStatic(name, half, pos, opt) {
      opt = opt || {};
      var rot = opt.rot || { x: 0, y: 0, z: 0, w: 1 };
      var body = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z).setRotation(rot));
      var cd = R.ColliderDesc.cuboid(half.x, half.y, half.z).setFriction(opt.mu !== undefined ? opt.mu : MU.steel);
      if (opt.minFriction) cd.setFrictionCombineRule(R.CoefficientCombineRule.Min);
      var collider = world.createCollider(cd, body);
      return addPart({ name: name, kind: 'static', half: half, pos: pos, rot: rot, color: opt.color || COLORS.steel,
        body: body, collider: collider });
    }

    // Boden
    addStatic('Boden', { x: 10, y: 10, z: 0.05 }, { x: 2, y: 1, z: -0.05 }, { mu: MU.floor, color: COLORS.floor });

    // Bänder: A läuft in +x, B in +y (90°-Ecke am Ende von A)
    function addBelt(name, half, pos, dir, speed) {
      var belt = addPart({ name: name, kind: 'belt', half: half, pos: pos, color: COLORS.belt,
        dir: dir, speed: speed, running: true, body: null, collider: null, offset: 0 });
      scene.belts.push(belt);
      // Gestell nur zur Anschauung (ohne Kollision)
      addPart({ name: name + ' Gestell', kind: 'deco', color: COLORS.frame,
        half: { x: Math.max(half.x - 0.1, 0.05), y: Math.max(half.y - 0.1, 0.05), z: (pos.z - half.z) / 2 },
        pos: { x: pos.x, y: pos.y, z: (pos.z - half.z) / 2 } });
      return belt;
    }
    var beltZ = BELT_TOP - 0.05;
    addBelt('Band A', { x: 2.85, y: 0.3, z: 0.05 }, { x: 2.85, y: 0, z: beltZ }, { x: 1, y: 0 }, BELT_SPEED);
    // Band B liegt 2 mm tiefer: bei exakt gleicher Höhe hakt die Kiste an der Kante
    // von B ein und springt bis zu 3 cm hoch (interne Kante zweier Quader).
    // B läuft doppelt so schnell wie A (Beschleunigungsband): bei gleichem Tempo
    // klemmt eine dicht gestaute Schlange die erste Kiste in der Ecke dauerhaft fest.
    addBelt('Band B', { x: 0.3, y: 2.15, z: 0.05 }, { x: 6.0, y: 1.85, z: beltZ - 0.002 }, { x: 0, y: 1 }, 2 * BELT_SPEED);

    // Seitenführungen an Band B (die rechte fängt die Kisten von Band A ab)
    addStatic('Führung rechts', { x: 0.03, y: 2.2, z: 0.06 }, { x: 6.34, y: 1.8, z: BELT_TOP + 0.06 });
    addStatic('Führung links', { x: 0.03, y: 1.8, z: 0.06 }, { x: 5.66, y: 2.18, z: BELT_TOP + 0.06 });

    // Schräge Rutsche am Ende von Band B, führt in Senke 1
    var CHUTE_DEG = 25, CHUTE_LEN = 1.4, CHUTE_T = 0.025;
    var a = CHUTE_DEG * Math.PI / 180;
    var cDir = { y: Math.cos(a), z: -Math.sin(a) };   // entlang der Rutsche (abwärts)
    var cNrm = { y: Math.sin(a), z: Math.cos(a) };    // Flächennormale
    var cRot = quatAxis(1, 0, 0, -a);
    var cTop = { y: 4.0, z: BELT_TOP - 0.01 };        // Oberkante Anfang, knapp unter dem Band
    function chutePos(along, up) {
      return { x: 6.0, y: cTop.y + cDir.y * along + cNrm.y * up, z: cTop.z + cDir.z * along + cNrm.z * up };
    }
    addStatic('Rutsche', { x: 0.3, y: CHUTE_LEN / 2, z: CHUTE_T }, chutePos(CHUTE_LEN / 2, -CHUTE_T),
      { rot: cRot, mu: MU.chute, minFriction: true, color: COLORS.chute });
    [5.66, 6.34].forEach(function (x, i) {
      var p = chutePos(CHUTE_LEN / 2, 0.06);
      p.x = x;
      addStatic('Rutsche Wange ' + (i + 1), { x: 0.03, y: CHUTE_LEN / 2, z: 0.06 }, p,
        { rot: cRot, mu: MU.chute, minFriction: true, color: COLORS.chute });
    });

    // Stopper quer über Band A (1 cm Luft zum Band)
    var stopper = addStatic('Stopper', { x: 0.05, y: 0.34, z: 0.1 }, { x: 4.2, y: 0, z: BELT_TOP + 0.11 },
      { color: COLORS.stopper });

    // Schieber: kinematisch, lineare Achse quer zu Band A
    var pusher = addPart({ name: 'Schieber', kind: 'kinematic', color: COLORS.pusher,
      half: { x: 0.25, y: 0.05, z: 0.12 }, pos: { x: 2.6, y: -0.42, z: BELT_TOP + 0.14 },
      axis: { min: -0.42, max: 0.40, vmax: 1.0 }, prevY: -0.42 });
    pusher.body = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(pusher.pos.x, pusher.pos.y, pusher.pos.z));
    pusher.collider = world.createCollider(R.ColliderDesc.cuboid(0.25, 0.05, 0.12).setFriction(MU.steel), pusher.body);

    // Immaterielle Körper: Sensor, Erzeuger, Senken
    var sensor = addPart({ name: 'Sensor', kind: 'ghost', color: COLORS.sensor,
      half: { x: 0.03, y: 0.32, z: 0.15 }, pos: { x: 1.6, y: 0, z: BELT_TOP + 0.15 } });
    sensor.shape = new R.Cuboid(sensor.half.x, sensor.half.y, sensor.half.z);
    var spawner = addPart({ name: 'Erzeuger', kind: 'ghost', color: COLORS.spawner,
      half: { x: 0.16, y: 0.16, z: 0.16 }, pos: { x: 0.35, y: 0, z: BELT_TOP + 0.17 }, interval: 1, timer: 1 });
    spawner.shape = new R.Cuboid(0.16, 0.16, 0.16);
    var sinks = [
      addPart({ name: 'Senke 1', kind: 'ghost', color: COLORS.sink,
        half: { x: 0.6, y: 0.6, z: 0.3 }, pos: { x: 6.0, y: 5.9, z: 0.3 } }),
      addPart({ name: 'Senke 2', kind: 'ghost', color: COLORS.sink,
        half: { x: 0.6, y: 0.55, z: 0.3 }, pos: { x: 2.6, y: 1.0, z: 0.3 } })
    ];

    var DYNAMIC_ONLY = R.QueryFilterFlags.EXCLUDE_FIXED | R.QueryFilterFlags.EXCLUDE_KINEMATIC;

    // ---------- Bänder je nach Methode (neu) aufbauen ----------

    function buildBelts() {
      scene.belts.forEach(function (belt) {
        if (belt.body) world.removeRigidBody(belt.body);
        var kinematic = scene.method === 'kinematic';
        var desc = kinematic ? R.RigidBodyDesc.kinematicVelocityBased() : R.RigidBodyDesc.fixed();
        belt.body = world.createRigidBody(desc.setTranslation(belt.pos.x, belt.pos.y, belt.pos.z));
        var cd = R.ColliderDesc.cuboid(belt.half.x, belt.half.y, belt.half.z);
        if (kinematic) {
          cd.setFriction(MU.belt);
        } else {
          // Reibung übernimmt die Nachführung – Rapier selbst soll nicht bremsen
          cd.setFriction(0).setFrictionCombineRule(R.CoefficientCombineRule.Min);
        }
        belt.collider = world.createCollider(cd, belt.body);
      });
      scene.boxes.forEach(function (b) { b.body.wakeUp(); });
    }
    buildBelts();

    // ---------- Kisten ----------

    function addBox(x, y, z, yawDeg, canSleep) {
      var q = quatAxis(0, 0, 1, (yawDeg || 0) * Math.PI / 180);
      var body = world.createRigidBody(R.RigidBodyDesc.dynamic()
        .setTranslation(x, y, z).setRotation(q).setCanSleep(canSleep !== false));
      world.createCollider(R.ColliderDesc.cuboid(BOX / 2, BOX / 2, BOX / 2)
        .setDensity(BOX_DENSITY).setFriction(MU.box).setRestitution(0), body);
      var p = { x: x, y: y, z: z };
      var box = { id: scene.nextBoxId++, body: body, prev: { p: p, q: q }, cur: { p: p, q: q } };
      scene.boxes.push(box);
      return box;
    }

    function removeBox(i) {
      world.removeRigidBody(scene.boxes[i].body);
      scene.boxes.splice(i, 1);
    }

    function spawnFree() {
      var free = true;
      world.intersectionsWithShape(spawner.pos, { x: 0, y: 0, z: 0, w: 1 }, spawner.shape,
        function () { free = false; return false; }, DYNAMIC_ONLY);
      return free;
    }

    // ---------- Transportfläche ----------

    // Methode 'velocity': aufliegende Kisten zur Bandgeschwindigkeit ziehen.
    // Gewichtet wird mit der Normalkraft (Kontaktimpuls J des letzten Schritts):
    // liegt eine Kiste auf zwei Bändern, zieht das Band stärker, das mehr Gewicht
    // trägt. Die Änderung ist wie Coulomb-Reibung auf μ·J/m begrenzt.
    function applySurfaceVelocity() {
      var targets = {};
      scene.belts.forEach(function (belt) {
        var speed = belt.running ? belt.speed : 0;
        world.contactPairsWith(belt.collider, function (other) {
          var body = other.parent();
          if (!body || !body.isDynamic()) return;
          var j = 0;
          world.contactPair(belt.collider, other, function (m) {
            if (Math.abs(m.normal().z) < 0.7) return;   // nur Auflage, keine Seitenkante
            for (var i = 0; i < m.numContacts(); i++) j += m.contactImpulse(i);
          });
          if (!(j > 0)) return;
          var t = targets[body.handle] || (targets[body.handle] = { body: body, x: 0, y: 0, j: 0 });
          t.x += belt.dir.x * speed * j;
          t.y += belt.dir.y * speed * j;
          t.j += j;
        });
      });
      Object.keys(targets).forEach(function (h) {
        var t = targets[h];
        var maxDv = MU.belt * t.j / t.body.mass();   // Haftreibungsgrenze für diesen Schritt
        var maxDw = maxDv / (BOX / 4);               // dito für Drehung um z (grob)
        var v = t.body.linvel();
        var dx = SURFACE_K * (t.x / t.j - v.x);
        var dy = SURFACE_K * (t.y / t.j - v.y);
        var len = Math.sqrt(dx * dx + dy * dy);
        if (len > maxDv) { dx *= maxDv / len; dy *= maxDv / len; }
        t.body.setLinvel({ x: v.x + dx, y: v.y + dy, z: v.z }, true);
        // Reibung bremst auch das Drehen um die Hochachse
        var w = t.body.angvel();
        var wz = Math.abs(w.z) <= maxDw ? 0 : w.z - (w.z > 0 ? maxDw : -maxDw);
        t.body.setAngvel({ x: w.x, y: w.y, z: wz }, true);
      });
    }

    // ---------- Ein Schritt ----------

    scene.step = function () {
      var t0 = now();
      var inp = scene.input;

      // 1. Sensoren lesen
      var busy = false;
      world.intersectionsWithShape(sensor.pos, { x: 0, y: 0, z: 0, w: 1 }, sensor.shape,
        function () { busy = true; return false; }, DYNAMIC_ONLY);
      scene.sensorBusy = busy;

      // 2. Logik: im Spike kommen die Eingänge von Tasten oder dem Szenario

      // 3. Aktoren
      var ax = pusher.axis;
      var target = inp.pusherOut ? ax.max : ax.min;
      var y = pusher.pos.y;
      var dy = Math.max(-ax.vmax * scene.dt, Math.min(ax.vmax * scene.dt, target - y));
      pusher.prevY = y;
      pusher.pos = { x: pusher.pos.x, y: y + dy, z: pusher.pos.z };
      pusher.body.setNextKinematicTranslation(pusher.pos);

      if (stopper.collider.isEnabled() !== inp.stopperOn) {
        stopper.collider.setEnabled(inp.stopperOn);
        stopper.visible = inp.stopperOn;
        scene.boxes.forEach(function (b) { b.body.wakeUp(); });
      }

      scene.belts.forEach(function (belt) {
        var v = belt.running ? belt.speed : 0;
        belt.offset += v * scene.dt;   // nur für die Streifen in der Darstellung
        if (scene.method === 'kinematic') belt.body.setLinvel({ x: belt.dir.x * v, y: belt.dir.y * v, z: 0 }, true);
      });

      // 4. Physik-Schritt
      if (scene.method === 'velocity') applySurfaceVelocity();
      var i, b;
      for (i = 0; i < scene.boxes.length; i++) scene.boxes[i].prev = scene.boxes[i].cur;
      var t1 = now();
      world.step();
      scene.worldStepMs = now() - t1;
      if (scene.method === 'kinematic') {
        scene.belts.forEach(function (belt) { belt.body.setTranslation(belt.pos, false); });
      }
      for (i = 0; i < scene.boxes.length; i++) {
        b = scene.boxes[i];
        b.cur = { p: b.body.translation(), q: b.body.rotation() };
      }

      // 5. Erzeuger und Senken
      if (inp.spawnerOn) {
        spawner.timer += scene.dt;
        if (spawner.timer >= spawner.interval - 1e-9 && spawnFree()) {
          addBox(spawner.pos.x, spawner.pos.y, spawner.pos.z, 0);
          spawner.timer -= spawner.interval;
          if (spawner.timer > spawner.interval) spawner.timer = spawner.interval; // kein Nachholen nach Stau
        }
      }
      for (i = scene.boxes.length - 1; i >= 0; i--) {
        var p = scene.boxes[i].cur.p;
        if (inBox(p, sinks[0])) { scene.sinkCount[0]++; removeBox(i); }
        else if (inBox(p, sinks[1])) { scene.sinkCount[1]++; removeBox(i); }
        else if (p.z < -2) { scene.lost++; removeBox(i); }
      }

      scene.tick++;
      scene.stepMs = now() - t0;
    };

    // ---------- Bedienung ----------

    scene.setMethod = function (m) {
      if (m === scene.method) return;
      scene.method = m;
      buildBelts();
    };

    // Kiste von Hand auflegen (z. B. schräg, yaw in Grad)
    scene.addBox = addBox;
    scene.removeBox = removeBox;
    scene.yawOf = yawOf;
    scene.pusher = pusher;
    scene.stopper = stopper;
    scene.sensor = sensor;
    scene.spawner = spawner;
    scene.sinks = sinks;
    scene.BOX = BOX;
    scene.BELT_TOP = BELT_TOP;
    scene.BELT_SPEED = BELT_SPEED;
    scene.MU = MU;

    // Viele Kisten auf einmal: Raster über dem Boden neben der Anlage
    scene.addMany = function (n, canSleep) {
      for (var k = 0; k < n; k++) {
        var col = k % 10, row = Math.floor(k / 10) % 10, layer = Math.floor(k / 100);
        addBox(-4.5 + col * 0.4, -4.2 + row * 0.4, 0.4 + layer * 0.5 + (col + row) * 0.01, (k * 7) % 45, canSleep);
      }
    };

    // Lage aller Kisten als Zahlenreihe (für Determinismus-Vergleich)
    scene.snapshot = function () {
      var out = [];
      scene.boxes.forEach(function (b) {
        var p = b.body.translation(), q = b.body.rotation();
        out.push(b.id, p.x, p.y, p.z, q.x, q.y, q.z, q.w);
      });
      return out;
    };

    scene.destroy = function () { world.free(); };

    return scene;
  }

  // FNV-1a über die Bytes der Zahlen (als Float64) → 8-stelliger Hex-Wert
  function hashNumbers(nums) {
    var bytes = new Uint8Array(new Float64Array(nums).buffer);
    var h = 0x811c9dc5;
    for (var i = 0; i < bytes.length; i++) {
      h ^= bytes[i];
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8);
  }

  // Festes Szenario für den Determinismus-Test: 30 s, Eingänge nach Zeitplan
  function scenarioInputs(scene) {
    var t = scene.tick * scene.dt;   // Zeit am Anfang dieses Schritts
    var ms = Math.round(t * 1000);
    scene.input.stopperOn = ms >= 6000 && ms < 14000;
    scene.input.pusherOut = (ms >= 9000 && ms < 10000) || (ms >= 17000 && ms < 18000) || (ms >= 24000 && ms < 25000);
    if (ms === 4000) scene.addBox(0.9, 0, BELT_TOP + 0.16, 30);   // schräg aufgelegte Kiste
  }

  function runScenario(R, method, seconds) {
    var scene = createScene(R, { method: method });
    var steps = Math.round((seconds || 30) / scene.dt);
    var t0 = now();
    for (var i = 0; i < steps; i++) {
      scenarioInputs(scene);
      scene.step();
    }
    var snap = scene.snapshot();
    var result = {
      method: method,
      seconds: seconds || 30,
      ms: now() - t0,
      hash: hashNumbers(snap),
      boxes: scene.boxes.length,
      sinks: scene.sinkCount.slice(),
      lost: scene.lost,
      snapshot: snap
    };
    scene.destroy();
    return result;
  }

  global.MF = global.MF || {};
  global.MF.spike3d = {
    createScene: createScene,
    runScenario: runScenario,
    hashNumbers: hashNumbers,
    yawOf: yawOf,
    COLORS: COLORS
  };
})(typeof window !== 'undefined' ? window : globalThis);
