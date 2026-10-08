// Engine: was in einem Zeitschritt mit der Anlage passiert – echte 3D-Physik mit Rapier.
//
// Die Zeit selbst steuert die Uhr aus sim/clock.js: feste Schritte, Zeitfaktor,
// Start/Pause/Schritt/Reset und Interpolation beim Zeichnen. Die Engine liefert
// den Inhalt eines Schritts in der Reihenfolge eines SPS-Zyklus
// (Idee/Konzept-3D.md, Abschnitt 4):
//   1. Sensoren lesen   – Rapier-Schnittabfragen der Sensorflächen (+ Entprellung)
//   2. Logik            – Wenn-dann-Regeln, dann SCL-Bausteine
//   3. Aktoren          – Achsen fahren (kinematische Körper), Transportflächen an/aus/Tempo
//   4. Physik-Schritt   – world.step(); Transportflächen ziehen aufliegende Kisten mit
//   5. Erzeuger und Senken
//
// Der SPS-Zyklus ist settings.dtMs lang (wie bisher frei wählbar: 10/20/50/100 ms).
// Die Physik rechnet darin in gleich langen Unterschritten von höchstens 20 ms
// (50 ms -> 3 × 16,7 ms), weil Rapier mit großen Schritten unruhig wird.
//
// Rapier ist eine Laufzeit-Abhängigkeit aus lib/rapier.js (window.RAPIER), die vor
// MF.engine.init() mit RAPIER.init() geladen sein muss (main.js wartet darauf).
// Rapier-Objekte stehen nur in der Engine (phys, boxes), nie im Modell.
window.MF = window.MF || {};

MF.engine = {
  MAX_SUBSTEP_MS: 20,
  CONTACT_HZ: 60,          // Kontaktsteifigkeit; Rapier-Standard 30 Hz lässt Kisten im Stau 5 mm ineinander rutschen
  SURFACE_K: 1,            // Nachführfaktor der Transportfläche
  SUPPORT_NZ: 0.7,         // Auflage: |Normale z| größer als das
  LOST_Z: -2,              // Kisten darunter sind verloren und werden entfernt

  world: null,
  phys: {},                // Körper-ID -> { sig, rb, colliders, parts } (Rapier-Teile eines Körpers)
  boxes: [],               // erzeugte Kisten: { id, rb, size, color, prev, cur }
  nextBoxId: 1,
  renderAlpha: 1,          // Anteil bis zum nächsten Schritt im zuletzt gezeichneten Bild

  listeners: [],
  on: function (fn) { this.listeners.push(fn); },
  emit: function () {
    for (var i = 0; i < this.listeners.length; i++) this.listeners[i](this.state);
  },

  init: function () {
    var self = this;
    this.R = window.RAPIER;
    this.clock = MF.createClock({
      dtMs: MF.model.settings.dtMs,
      onTick: function (dt) { self.step(dt); },
      onRender: function (alpha) { self.renderAlpha = alpha; MF.sim.draw(); },
      onReset: function () { self.resetWorld(); },
      onChange: function () { self.emit(); }
    });
    this.resetWorld();
    this.clock.start(); // Zeichenschleife läuft ab jetzt dauerhaft
    // Änderungen an Form, Lage, Körperart, Werkstoff und Funktionen wirken sofort,
    // auch in der Pause (die Draufsicht zeigt dynamische Körper aus der Physik)
    MF.store.on(function (reason) { if (reason === 'change' && self.world) self.sync(); });
  },

  // ---------- Zustand (aus der Uhr gelesen) ----------

  // 'stopped' nach Reset, 'running' während des Laufs, 'paused' sonst
  get state() {
    if (!this.clock) return 'stopped';
    if (this.clock.running) return 'running';
    return this.clock.tick > 0 ? 'paused' : 'stopped';
  },
  get time() { return this.clock ? this.clock.timeMs / 1000 : 0; },
  get timeMs() { return this.clock ? this.clock.timeMs : 0; },
  get ticks() { return this.clock ? this.clock.tick : 0; },
  get timeScale() { return this.clock ? this.clock.speed : 1; },

  dt: function () { return this.clock.dtMs / 1000; },

  // Anteil (0..1) zwischen letztem und nächstem Schritt, fürs flüssige Zeichnen
  alpha: function () {
    return this.state === 'running' ? this.renderAlpha : 1;
  },

  // ---------- Steuerung ----------

  start: function () { this.clock.play(); },
  pause: function () { this.clock.pause(); },
  toggle: function () { this.clock.toggle(); },
  stepOnce: function () { this.clock.step(); },   // nur außerhalb des Laufs
  reset: function () { this.clock.reset(); },
  setTimeScale: function (s) { this.clock.setSpeed(s); },

  // Zeitschritt ändern – nur wenn die Simulation nicht läuft. Gibt false zurück, wenn abgelehnt.
  setDtMs: function (ms) {
    if (this.clock.running) return false;
    this.clock.setDtMs(ms);
    MF.model.settings.dtMs = ms;
    return true;
  },

  // ---------- Welt ----------

  // Anlage in den Ausgangszustand: neue Rapier-Welt, keine Kisten, Zähler und Takte zurück
  resetWorld: function () {
    var R = this.R;
    if (this.world) this.world.free();
    this.world = new R.World({ x: 0, y: 0, z: MF.model.settings.gravity });
    this.world.integrationParameters.contact_natural_frequency = this.CONTACT_HZ;
    this.phys = {};
    this.boxes = [];
    this.nextBoxId = 1;
    this.DYNAMIC_ONLY = R.QueryFilterFlags.EXCLUDE_FIXED | R.QueryFilterFlags.EXCLUDE_KINEMATIC;

    // Boden bei z = 0 (Oberkante), groß genug für jede Anlage
    var floor = this.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(0, 0, -0.5));
    this.world.createCollider(this.colliderDesc(new R.Cuboid(500, 500, 0.5), MF.MATERIALS.floor), floor);

    MF.model.bodies.forEach(function (b) { b.rt = {}; });
    this.sync();
    // Regel-Ziele auf Startwert, SCL-Variablen und Zeitglieder auf Anfang
    MF.logic.reset();
  },

  // Collider-Vorlage mit Werkstoff. Reibung und Stoßzahl werden mit "Min" kombiniert:
  // der kleinere Wert der beiden Körper gilt (Rutsche, Transportfläche mit Reibung 0).
  colliderDesc: function (shape, mat, friction) {
    var R = this.R;
    return new R.ColliderDesc(shape)
      .setFriction(friction !== undefined ? friction : mat.friction)
      .setRestitution(mat.restitution || 0)
      .setDensity(mat.density || 1)
      .setFrictionCombineRule(R.CoefficientCombineRule.Min)
      .setRestitutionCombineRule(R.CoefficientCombineRule.Min);
  },

  SLOPED_CIRCLE_SEGMENTS: 32,

  // Rapier-Formen eines Körpers, lokal zur Lage (Unterseite des Grundrisses):
  // [{ shape, t: {x,y,z}, q: {x,y,z,w} }]. Konkave Polygone werden zerlegt.
  // Geneigte Oberseite (shape.h2, Konzept Abschnitt 3): jedes konvexe Teil wird ein
  // Prisma mit schräger Oberseite (ConvexPolyhedron) – auch Rechteck und Kreis.
  shapeParts: function (sh) {
    var R = this.R, h = sh.h, ID = { x: 0, y: 0, z: 0, w: 1 };
    if (MF.geom.isSloped(sh)) {
      var polys = sh.type === 'polygon' ? MF.geom.convexParts(sh.points)
        : sh.type === 'circle' ? [this.circlePoly(sh.r)] : [MF.geom.outline(sh)];
      return polys.map(function (poly) {
        var v = [];
        poly.forEach(function (p) {
          v.push(p[0], p[1], 0);
          var top = MF.geom.topAt(sh, p[0]);
          if (top > 1e-6) v.push(p[0], p[1], top);   // Keil bis auf 0: Kante statt Fläche
        });
        return { shape: new R.ConvexPolyhedron(new Float32Array(v), null), t: { x: 0, y: 0, z: 0 }, q: ID };
      });
    }
    if (sh.type === 'rect') return [{ shape: new R.Cuboid(sh.w / 2, sh.d / 2, h / 2), t: { x: 0, y: 0, z: h / 2 }, q: ID }];
    if (sh.type === 'circle') {
      // Rapier-Zylinder stehen auf y; um x gedreht stehen sie auf z
      var s = Math.SQRT1_2;
      return [{ shape: new R.Cylinder(h / 2, sh.r), t: { x: 0, y: 0, z: h / 2 }, q: { x: s, y: 0, z: 0, w: s } }];
    }
    return MF.geom.convexParts(sh.points).map(function (poly) {
      var v = [];
      poly.forEach(function (p) { v.push(p[0], p[1], 0, p[0], p[1], h); });
      return { shape: new R.ConvexPolyhedron(new Float32Array(v), null), t: { x: 0, y: 0, z: 0 }, q: ID };
    });
  },

  circlePoly: function (r) {
    var out = [], n = this.SLOPED_CIRCLE_SEGMENTS;
    for (var i = 0; i < n; i++) out.push([r * Math.cos(2 * Math.PI * i / n), r * Math.sin(2 * Math.PI * i / n)]);
    return out;
  },

  // Drehung um z (Grad) als Quaternion
  quatZ: function (deg) {
    var a = deg * Math.PI / 360;
    return { x: 0, y: 0, z: Math.sin(a), w: Math.cos(a) };
  },

  // Achse: Stellung pos (m) entlang axis.dir, in Weltkoordinaten verschoben
  axisOffset: function (b, pos) {
    var ax = b.axis, d = ax.dir;
    var len = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]) || 1;
    var w = MF.geom.toWorld({ x: 0, y: 0, rot: b.pose.rot }, ax.origin[0] + d[0] / len * pos, ax.origin[1] + d[1] / len * pos);
    return { x: w.x, y: w.y, z: ax.origin[2] + d[2] / len * pos };
  },

  // Aktuelle Lage eines Körpers in der Welt (kinematisch: mit Achsstellung,
  // dynamisch: wo die Physik ihn gerade hat)
  worldPose: function (b, pos) {
    if (b.kind === 'dynamic') return this.dynamicPose(b, 1);
    if (!b.axis || b.kind !== 'kinematic') return b.pose;
    var o = this.axisOffset(b, pos === undefined ? this.axisPos(b) : pos);
    return { x: b.pose.x + o.x, y: b.pose.y + o.y, z: b.pose.z + o.z, rot: b.pose.rot };
  },

  // Dynamischer Körper aus dem Modell (gezeichnet, fällt und rutscht): Lage aus
  // Rapier, zwischen den letzten beiden Schritten mit alpha (0..1) interpoliert.
  // Nach Reset (rt leer) liegt er an seiner gezeichneten Lage. Die Draufsicht zeigt
  // nur die Drehung um z; kippt er im Raum, bleibt der Grundriss gleich.
  dynamicPose: function (b, alpha) {
    var rt = b.rt || {}, c = rt.cur;
    if (!c) return b.pose;
    var p = rt.prev || c;
    var y0 = MF.sim.yawOf(p.q), y1 = MF.sim.yawOf(c.q);
    var dy = Math.atan2(Math.sin(y1 - y0), Math.cos(y1 - y0));
    return {
      x: p.x + (c.x - p.x) * alpha, y: p.y + (c.y - p.y) * alpha, z: p.z + (c.z - p.z) * alpha,
      rot: MF.geom.normDeg((y0 + dy * alpha) * 180 / Math.PI)
    };
  },

  axisPos: function (b) {
    var rt = b.rt || {};
    return rt.pos !== undefined ? rt.pos : b.axis.min;
  },

  // Was Rapier von einem Körper wissen muss. Ändert es sich, wird er neu gebaut.
  signature: function (b) {
    return JSON.stringify([b.kind, b.shape, b.pose, b.material, !!b.surface,
      b.axis && [b.axis.origin, b.axis.dir]]);
  },

  // Rapier-Welt an das Modell angleichen: neue, geänderte und gelöschte Körper.
  // Läuft vor jedem Schritt; Kisten bleiben erhalten.
  sync: function () {
    var self = this, R = this.R, world = this.world;
    var seen = {}, rebuilt = false;
    MF.model.bodies.forEach(function (b) {
      if (!b.rt) b.rt = {};
      seen[b.id] = true;
      var sig = self.signature(b);
      var p = self.phys[b.id];
      if (p && p.sig === sig) return;
      if (p && p.rb) world.removeRigidBody(p.rb);
      rebuilt = true;
      p = self.phys[b.id] = { sig: sig, rb: null, parts: self.shapeParts(b.shape) };
      delete b.rt.cur;    // dynamischer Körper: neu an seiner gezeichneten Lage
      delete b.rt.prev;
      if (b.kind === 'ghost') return;   // nur Abfragen (Sensor, Erzeuger, Senke), keine Kollision
      var pose = self.worldPose(b);
      var desc = b.kind === 'kinematic' ? R.RigidBodyDesc.kinematicPositionBased()
        : b.kind === 'dynamic' ? R.RigidBodyDesc.dynamic() : R.RigidBodyDesc.fixed();
      p.rb = world.createRigidBody(desc.setTranslation(pose.x, pose.y, pose.z).setRotation(self.quatZ(pose.rot)));
      // Transportfläche: in Rapier reibungsfrei, die Haftung kommt aus der Nachführung
      var friction = b.surface ? 0 : undefined;
      p.colliders = p.parts.map(function (part) {
        var cd = self.colliderDesc(part.shape, b.material || MF.MATERIALS.steel, friction)
          .setTranslation(part.t.x, part.t.y, part.t.z).setRotation(part.q);
        return world.createCollider(cd, p.rb);
      });
    });
    Object.keys(this.phys).forEach(function (id) {
      if (seen[id]) return;
      if (self.phys[id].rb) world.removeRigidBody(self.phys[id].rb);
      delete self.phys[id];
      rebuilt = true;
    });
    // Liegt eine schlafende Kiste auf einem neu gebauten Körper, soll sie es merken
    if (rebuilt) this.boxes.forEach(function (bx) { bx.rb.wakeUp(); });
  },

  // Schneidet eine dynamische Kiste die Form des Körpers (in seiner aktuellen Lage)?
  overlapsBox: function (b) {
    var self = this, hit = false, pose = this.worldPose(b);
    var q = this.quatZ(pose.rot);
    this.phys[b.id].parts.forEach(function (part) {
      if (hit) return;
      var t = MF.geom.toWorld(pose, part.t.x, part.t.y);
      self.world.intersectionsWithShape({ x: t.x, y: t.y, z: pose.z + part.t.z }, self.mulQuat(q, part.q), part.shape,
        function () { hit = true; return false; }, self.DYNAMIC_ONLY);
    });
    return hit;
  },

  mulQuat: function (a, b) {
    return {
      w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
      x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
      y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
      z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w
    };
  },

  // ---------- Ein Zeitschritt (SPS-Zyklus) ----------

  step: function (dt) {
    if (dt === undefined) dt = this.dt();
    var self = this;
    var bodies = MF.model.bodies;
    this.sync();

    // Alte Lage merken (für Interpolation beim Zeichnen)
    this.boxes.forEach(function (bx) { bx.prev = bx.cur; });
    bodies.forEach(function (b) {
      if (b.surface) { b.rt.prevTravel = b.rt.travel || 0; }
      if (b.axis) b.rt.prevPos = self.axisPos(b);
    });

    // 1. Sensoren lesen (Prozessabbild der Eingänge)
    bodies.forEach(function (b) { if (b.sensor) self.stepSensor(b, dt); });

    // 2. Logik – Wenn-dann-Regeln und SCL-Bausteine schreiben die Eingänge der Aktoren
    MF.logic.run(dt);

    // 3./4. Aktoren und Physik in Unterschritten
    var n = Math.max(1, Math.ceil(dt * 1000 / this.MAX_SUBSTEP_MS - 1e-9));
    var h = dt / n;
    this.world.timestep = h;
    var g = MF.model.settings.gravity;
    if (this.world.gravity.z !== g) this.world.gravity = { x: 0, y: 0, z: g };
    for (var i = 0; i < n; i++) {
      bodies.forEach(function (b) {
        if (b.axis && b.kind === 'kinematic') self.stepAxis(b, h);
        if (b.surface) b.rt.travel = (b.rt.travel || 0) + self.surfaceSpeed(b) * h;   // nur für die Streifen
      });
      this.applySurfaces();
      this.world.step();
    }
    this.boxes.forEach(function (bx) { bx.cur = self.boxState(bx.rb); });
    bodies.forEach(function (b) {
      var p = self.phys[b.id];
      if (b.kind !== 'dynamic' || !p || !p.rb) return;
      b.rt.prev = b.rt.cur || self.boxState(p.rb);
      b.rt.cur = self.boxState(p.rb);
    });

    // 5. Erzeuger und Senken
    bodies.forEach(function (b) { if (b.spawner) self.stepSpawner(b, dt); });
    this.collectSinks();
  },

  // ---------- Sensor ----------

  // Sensor mit Entprellung: "belegt" wechselt erst, wenn der Rohzustand
  // sensor.debounce ms lang stabil anliegt. Nach Reset ist rt leer -> frei.
  stepSensor: function (b, dt) {
    var rt = b.rt;
    var raw = this.overlapsBox(b);
    if (rt.occupied === undefined) { rt.occupied = false; rt.raw = false; rt.stableMs = 0; }
    if (raw !== rt.raw) { rt.raw = raw; rt.stableMs = 0; }
    else rt.stableMs += dt * 1000;
    if (rt.raw !== rt.occupied && rt.stableMs >= (b.sensor.debounce || 0) - 1e-6) rt.occupied = rt.raw;
  },

  // ---------- Achse (Betriebsart zweipunkt) ----------

  // Ausfahren = 1: mit vmax nach max. Ausfahren = 0: returnDelay warten, dann
  // nach min. rt.pos = Stellung in m. Weitere Betriebsarten (position,
  // geschwindigkeit) und rotatorische Achsen ergänzt Phase 4 hier.
  stepAxis: function (b, h) {
    var ax = b.axis, rt = b.rt;
    if (rt.pos === undefined) { rt.pos = ax.min; rt.wait = 0; }
    var target = rt.pos;
    if (this.input(b, 'Ausfahren')) {
      rt.wait = 0;
      target = ax.max;
    } else if (rt.pos > ax.min) {
      rt.wait += h;
      if (rt.wait >= ax.returnDelay - 1e-9) target = ax.min;
    }
    if (target > ax.max) target = ax.max;   // Hub verkleinert
    var step = ax.vmax * h;
    var d = target - rt.pos;
    rt.pos = Math.abs(d) <= step ? target : rt.pos + (d > 0 ? step : -step);
    var p = this.phys[b.id];
    if (p && p.rb) {
      var pose = this.worldPose(b, rt.pos);
      p.rb.setNextKinematicTranslation({ x: pose.x, y: pose.y, z: pose.z });
    }
  },

  // ---------- Transportfläche ----------

  // Läuft die Fläche? Schalter "Antrieb" (surface.running) und Eingang "Ein"
  surfaceOn: function (b) {
    return !!b.surface && b.surface.running !== false && !!this.input(b, 'Ein');
  },

  surfaceSpeed: function (b) {
    return this.surfaceOn(b) ? b.surface.speed : 0;
  },

  // Methode "Geschwindigkeit nachführen" (Konzept Abschnitt 4, Spike-Ergebnis 5):
  // aufliegende Kisten werden zur Bandgeschwindigkeit gezogen, gewichtet mit dem
  // Kontaktimpuls J des letzten Schritts (trägt ein Band mehr Gewicht, zieht es
  // stärker); die Änderung ist wie Coulomb-Reibung auf μ·ΣJ/m begrenzt
  // (μ = Reibwert des Bands). Drehen um die Hochachse wird ebenso abgebremst.
  applySurfaces: function () {
    var self = this, world = this.world;
    var targets = [], byHandle = {};
    MF.model.bodies.forEach(function (b) {
      var p = self.phys[b.id];
      if (!b.surface || !p || !p.rb) return;
      var speed = self.surfaceSpeed(b);
      var v = MF.geom.dirVec(b.pose.rot + b.surface.dir);
      var mu = b.material ? b.material.friction : MF.MATERIALS.belt.friction;
      p.colliders.forEach(function (col) {
        world.contactPairsWith(col, function (other) {
          var rb = other.parent();
          if (!rb || !rb.isDynamic()) return;
          var j = 0;
          world.contactPair(col, other, function (m) {
            if (Math.abs(m.normal().z) < self.SUPPORT_NZ) return;   // nur Auflage, keine Seitenkante
            for (var i = 0; i < m.numContacts(); i++) j += m.contactImpulse(i);
          });
          if (!(j > 0)) return;
          var t = byHandle[rb.handle];
          if (!t) { t = byHandle[rb.handle] = { rb: rb, x: 0, y: 0, j: 0, muj: 0 }; targets.push(t); }
          t.x += v.x * speed * j;
          t.y += v.y * speed * j;
          t.j += j;
          t.muj += mu * j;
        });
      });
    });
    if (!targets.length) return;
    var sizes = {};
    this.boxes.forEach(function (bx) { sizes[bx.rb.handle] = bx.size[0]; });
    targets.forEach(function (t) {
      var rb = t.rb;
      var maxDv = t.muj / rb.mass();               // Haftreibungsgrenze für diesen Schritt
      var size = sizes[rb.handle] || MF.BOX_SIZE;
      var maxDw = maxDv / (size / 4);              // dito für Drehung um z (grob)
      var v = rb.linvel();
      var dx = self.SURFACE_K * (t.x / t.j - v.x);
      var dy = self.SURFACE_K * (t.y / t.j - v.y);
      var len = Math.sqrt(dx * dx + dy * dy);
      if (len > maxDv) { dx *= maxDv / len; dy *= maxDv / len; }
      var w = rb.angvel();
      var wz = Math.abs(w.z) <= maxDw ? 0 : w.z - (w.z > 0 ? maxDw : -maxDw);
      if (len < 1e-12 && wz === w.z) return;       // nichts zu tun – Kiste darf schlafen
      rb.setLinvel({ x: v.x + dx, y: v.y + dy, z: v.z }, true);
      rb.setAngvel({ x: w.x, y: w.y, z: wz }, true);
    });
  },

  // ---------- Kisten ----------

  boxState: function (rb) {
    var p = rb.translation(), q = rb.rotation();
    return { x: p.x, y: p.y, z: p.z, q: { x: q.x, y: q.y, z: q.z, w: q.w } };
  },

  // Erzeuger: legt im Takt eine Kiste nach seiner Vorlage auf, Unterseite auf
  // der Lage des Erzeugers – aber nur, wenn der Platz frei ist (sonst im nächsten Zyklus).
  stepSpawner: function (b, dt) {
    var sp = b.spawner, rt = b.rt;
    if (!sp.enabled || !this.input(b, 'Freigabe')) return;
    if (rt.made === undefined) { rt.made = 0; rt.timer = 0; }
    if (sp.maxCount > 0 && rt.made >= sp.maxCount) return;

    rt.timer -= dt;
    if (rt.timer > 1e-9) return;

    var R = this.R, tpl = sp.template, sh = tpl.shape;
    var q = this.quatZ(b.pose.rot);
    var free = true;
    // Platz frei? Form der Kiste, 5 mm größer, an der Ablegestelle
    var probe = sh.type === 'rect' ? new R.Cuboid(sh.w / 2 + 0.005, sh.d / 2 + 0.005, sh.h / 2 + 0.005) : null;
    var parts = probe ? [{ shape: probe, t: { x: 0, y: 0, z: sh.h / 2 }, q: { x: 0, y: 0, z: 0, w: 1 } }] : this.shapeParts(sh);
    var self = this;
    parts.forEach(function (part) {
      if (!free) return;
      var t = MF.geom.toWorld(b.pose, part.t.x, part.t.y);
      self.world.intersectionsWithShape({ x: t.x, y: t.y, z: b.pose.z + part.t.z }, self.mulQuat(q, part.q), part.shape,
        function () { free = false; return false; }, self.DYNAMIC_ONLY);
    });
    if (!free) return;

    this.addBox(tpl, b.pose.x, b.pose.y, b.pose.z, b.pose.rot);
    rt.made++;
    rt.timer += sp.interval;
    if (rt.timer < 0) rt.timer = sp.interval;   // kein Nachholen nach einem Stau
  },

  // Kiste (dynamischer Körper) mit Unterseite auf z anlegen. Der Rapier-Körper
  // liegt im Mittelpunkt der Kiste, damit Lage = Mittelpunkt ist.
  addBox: function (tpl, x, y, z, rot) {
    var self = this, R = this.R, sh = tpl.shape;
    var rb = this.world.createRigidBody(R.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z + sh.h / 2).setRotation(this.quatZ(rot || 0)));
    this.shapeParts(sh).forEach(function (part) {
      self.world.createCollider(self.colliderDesc(part.shape, tpl.material || MF.MATERIALS.box)
        .setTranslation(part.t.x, part.t.y, part.t.z - sh.h / 2).setRotation(part.q), rb);
    });
    var size = sh.type === 'rect' ? [sh.w, sh.d, sh.h] : sh.type === 'circle' ? [2 * sh.r, 2 * sh.r, sh.h] : [MF.BOX_SIZE, MF.BOX_SIZE, sh.h];
    var state = this.boxState(rb);
    var box = { id: this.nextBoxId++, rb: rb, shape: sh, size: size, color: (tpl.look && tpl.look.color) || MF.BOX_COLOR, prev: state, cur: state };
    this.boxes.push(box);
    return box;
  },

  removeBox: function (i) {
    this.world.removeRigidBody(this.boxes[i].rb);
    this.boxes.splice(i, 1);
  },

  // Senke: nimmt Kisten auf, deren Mittelpunkt in ihrer Form liegt, und zählt sie.
  // Kisten unter z = −2 m sind verloren und werden ebenfalls entfernt.
  collectSinks: function () {
    var self = this;
    var sinks = MF.model.bodies.filter(function (b) { return b.sink; });
    for (var i = this.boxes.length - 1; i >= 0; i--) {
      var p = this.boxes[i].cur;   // Mittelpunkt
      var hit = null;
      for (var k = 0; k < sinks.length && !hit; k++) {
        if (MF.geom.containsPoint(sinks[k].shape, sinks[k].pose, p)) hit = sinks[k];
      }
      if (hit) {
        hit.rt.count = (hit.rt.count || 0) + 1;
        this.removeBox(i);
      } else if (p.z < this.LOST_Z) {
        this.removeBox(i);
      }
    }
    // Eingang "Reset" hält den Zähler auf 0, solange er 1 ist
    sinks.forEach(function (s) {
      if (self.input(s, 'Reset')) s.rt.count = 0;
    });
  },

  // ---------- Signale ----------

  // Aktueller Wert eines Signals, z. B. signal(B1, 'Läuft') -> 1.
  // Signale hängen nur vom Zustand der Anlage ab, nie davon, ob die Uhr läuft:
  // Eine Pause friert die Zeit ein, die Zustände bleiben wie im letzten Schritt.
  // Geforcte Ausgänge liefern den festgehaltenen Wert statt des berechneten.
  signal: function (b, name) {
    if (b.force && name in b.force) return b.force[name];
    var def = MF.ioDef(b, name);
    if (!def) return 0;
    if (def.dir === 'in') return this.input(b, name);
    var rt = b.rt || {};
    switch (def.fn + '.' + name) {
      case 'spawner.Erzeugt':   return rt.made || 0;
      case 'surface.Läuft':     return this.surfaceOn(b) && b.surface.speed > 0 ? 1 : 0;
      case 'sensor.Belegt':     return (!!rt.occupied !== !!b.sensor.invert) ? 1 : 0;  // Wert aus dem letzten Schritt
      case 'sink.Anzahl':       return rt.count || 0;
      case 'axis.Ausgefahren':  return this.axisPos(b) >= b.axis.max - 1e-6 ? 1 : 0;
      case 'axis.Eingefahren':  return this.axisPos(b) <= b.axis.min + 1e-6 ? 1 : 0;
      case 'axis.Ist':          return Math.round(this.axisPos(b) * 1e6) / 1e6;
      default:                  return 0;
    }
  },

  // Wert eines Eingangs (von Hand gesetzt oder Startwert).
  // Eingänge mit prop lesen und schreiben direkt die Funktion, z. B. Tempo -> surface.speed.
  input: function (b, name) {
    var def = this.ioDef(b, name);
    if (def && def.prop) return b[def.fn][def.prop];
    return b.inputs && name in b.inputs ? b.inputs[name] : 0;
  },

  // Signal von Hand setzen: Eingänge werden geschrieben, Ausgänge geforct.
  setSignal: function (b, name, v) {
    var def = this.ioDef(b, name);
    if (!def) return;
    v = def.type === 'BOOL' ? (v ? 1 : 0) : def.type === 'INT32' ? Math.round(v) : v;
    if (def.prop) {
      // Grenzen einhalten, z. B. Tempo 0 … 5 m/s
      if (def.min !== undefined) v = Math.max(def.min, v);
      if (def.max !== undefined) v = Math.min(def.max, v);
      b[def.fn][def.prop] = v;
    } else if (def.dir === 'in') b.inputs[name] = v;
    else b.force[name] = v;
  },

  // Forcen eines Ausgangs aufheben – er zeigt wieder den berechneten Wert
  releaseForce: function (b, name) {
    if (b.force) delete b.force[name];
  },

  isForced: function (b, name) {
    return !!b.force && name in b.force;
  },

  ioDef: function (b, name) {
    return MF.ioDef(b, name);
  }
};
