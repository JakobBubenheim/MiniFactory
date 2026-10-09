// Engine: was in einem Zeitschritt mit der Anlage passiert – echte 3D-Physik mit Rapier.
//
// Die Zeit selbst steuert die Uhr aus sim/clock.js: feste Schritte, Zeitfaktor,
// Start/Pause/Schritt/Reset und Interpolation beim Zeichnen. Die Engine liefert
// den Inhalt eines Schritts in der Reihenfolge eines SPS-Zyklus
// (Idee/Konzept-3D.md, Abschnitt 4):
//   1. Sensoren lesen   – Rapier-Schnittabfragen der Sensorflächen (+ Entprellung)
//   2. Logik            – Wenn-dann-Regeln, dann SCL-Bausteine
//   3. Aktoren          – Achsen fahren (kinematische Körper), Transportflächen an/aus/Tempo
//   4. Physik-Schritt   – world.step(); Transportflächen ziehen aufliegende Teile mit
//   5. Erzeuger und Senken
//
// Teile: was Erzeuger erzeugen – dynamische Körper in der Form ihres Produkts
// (MF.productOf, Standard Kiste 0,3 m). Die Liste heißt aus Gewohnheit boxes.
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
  LOST_Z: -2,              // Teile darunter sind verloren und werden entfernt
  SPAWN_GAP: 0.005,        // Platz frei? Das Teil, rundum so viel größer, darf nichts schneiden

  world: null,
  phys: {},                // Körper-ID -> { sig, rb, colliders, parts } (Rapier-Teile eines Körpers)
  boxes: [],               // erzeugte Teile: { id, rb, shape, size, color, product, source, prev, cur }
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

  // Anlage in den Ausgangszustand: neue Rapier-Welt, keine Teile, Zähler und Takte zurück
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
    this.endPulses();
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
  // surface (Transportfläche): ein Rechteck bekommt an den Stirnenden die Rundung
  // der Umlenkrolle (MF.geom.rollProfile), ein Kreis (Drehtisch) einen gerundeten Rand,
  // damit Kisten bündig über die Naht laufen (MF.geom.rollOf).
  shapeParts: function (sh, surface) {
    var R = this.R, h = sh.h, ID = { x: 0, y: 0, z: 0, w: 1 };
    var roll = MF.geom.rollOf({ shape: sh, surface: surface });
    if (roll === 'x' || roll === 'y') return [{ shape: new R.ConvexPolyhedron(new Float32Array(this.rollVertices(sh, roll)), null), t: { x: 0, y: 0, z: 0 }, q: ID }];
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
      // Rapier-Zylinder stehen auf y; um x gedreht stehen sie auf z.
      // Mit Transportfläche (Drehtisch) ist der Rand rundum gerundet wie die Umlenkrolle.
      var s = Math.SQRT1_2, rr = roll === 'rim' ? MF.geom.rimRadius(sh) : 0;
      var cyl = rr > 0 ? new R.RoundCylinder(h / 2 - rr, sh.r - rr, rr) : new R.Cylinder(h / 2, sh.r);
      return [{ shape: cyl, t: { x: 0, y: 0, z: h / 2 }, q: { x: s, y: 0, z: 0, w: s } }];
    }
    return MF.geom.convexParts(sh.points).map(function (poly) {
      var v = [];
      poly.forEach(function (p) { v.push(p[0], p[1], 0, p[0], p[1], h); });
      return { shape: new R.ConvexPolyhedron(new Float32Array(v), null), t: { x: 0, y: 0, z: 0 }, q: ID };
    });
  },

  // Eckpunkte eines Bands mit gerundeten Stirnenden (Laufrichtung entlang der Achse roll)
  rollVertices: function (sh, roll) {
    var len = roll === 'x' ? sh.w : sh.d, half = len / 2, side = (roll === 'x' ? sh.d : sh.w) / 2;
    var v = [];
    MF.geom.rollProfile(sh.h, len).forEach(function (p) {
      [half - p[0], p[0] - half].forEach(function (u) {
        [-side, side].forEach(function (s) {
          if (roll === 'x') v.push(u, s, p[1]); else v.push(s, u, p[1]);
        });
      });
    });
    return v;
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

  // Aktuelle Lage eines Körpers in der Welt: kinematisch mit Achsstellung,
  // gekoppelt mit der Lage des Elternkörpers (MF.poseInWorld), dynamisch dort,
  // wo die Physik ihn gerade hat. pos: eigene Achsstellung statt der aktuellen.
  worldPose: function (b, pos) {
    if (b.kind === 'dynamic') return this.dynamicPose(b, 1);
    if (pos === undefined) return MF.poseInWorld(b, MF.axisPos);
    return MF.poseInWorld(b, function (x) { return x === b ? pos : MF.axisPos(x); });
  },

  // Dynamischer Körper aus dem Modell (gezeichnet, fällt und rutscht): Lage aus
  // Rapier, zwischen den letzten beiden Schritten mit alpha (0..1) interpoliert.
  // Nach Reset (rt leer) liegt er an seiner gezeichneten Lage. Die Draufsicht zeigt
  // nur die Drehung um z; kippt er im Raum, bleibt der Grundriss gleich.
  // Das Produkt eines Erzeugers simuliert nicht: es liegt immer am Erzeuger.
  dynamicPose: function (b, alpha) {
    var rt = b.rt || {}, c = rt.cur;
    if (!c) return MF.poseInWorld(b);
    var p = rt.prev || c;
    var y0 = MF.sim.yawOf(p.q), y1 = MF.sim.yawOf(c.q);
    var dy = Math.atan2(Math.sin(y1 - y0), Math.cos(y1 - y0));
    return {
      x: p.x + (c.x - p.x) * alpha, y: p.y + (c.y - p.y) * alpha, z: p.z + (c.z - p.z) * alpha,
      rot: MF.geom.normDeg((y0 + dy * alpha) * 180 / Math.PI)
    };
  },

  axisPos: function (b) {
    return MF.axisPos(b);
  },

  // Rapier-Körperart: kinematisch auch für feste Körper, die an einem Körper
  // hängen (Band auf dem Hubtisch) – sie bewegen sich mit und nehmen Kisten mit.
  rapierKind: function (b) {
    if (b.kind === 'static' && MF.parentBody(b)) return 'kinematic';
    return b.kind;
  },

  // Was Rapier von einem Körper wissen muss. Ändert es sich, wird er neu gebaut.
  // Die Lage gekoppelter Körper hängt vom Eltern ab; sie wird nachgeführt, nicht neu gebaut.
  signature: function (b) {
    return JSON.stringify([this.rapierKind(b), b.shape, b.pose, b.material, !!b.surface,
      MF.geom.rollOf(b),
      b.axis && [b.axis.origin, b.axis.dir, b.axis.type]]);
  },

  // Rapier-Welt an das Modell angleichen: neue, geänderte und gelöschte Körper.
  // Läuft vor jedem Schritt; Teile bleiben erhalten. Produkte sind nur Vorlagen
  // und kommen nicht in die Welt.
  sync: function () {
    var self = this, R = this.R, world = this.world;
    var seen = {}, rebuilt = false;
    MF.model.bodies.forEach(function (b) {
      if (!b.rt) b.rt = {};
      if (MF.isProduct(b)) return;
      seen[b.id] = true;
      var sig = self.signature(b);
      var p = self.phys[b.id];
      if (p && p.sig === sig) return;
      if (p && p.rb) world.removeRigidBody(p.rb);
      rebuilt = true;
      p = self.phys[b.id] = { sig: sig, rb: null, parts: self.shapeParts(b.shape, b.surface) };
      delete b.rt.cur;    // dynamischer Körper: neu an seiner gezeichneten Lage
      delete b.rt.prev;
      if (b.kind === 'ghost') return;   // nur Abfragen (Sensor, Erzeuger, Senke), keine Kollision
      var pose = self.worldPose(b);
      var kind = self.rapierKind(b);
      var desc = kind === 'kinematic' ? R.RigidBodyDesc.kinematicPositionBased()
        : kind === 'dynamic' ? R.RigidBodyDesc.dynamic() : R.RigidBodyDesc.fixed();
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
    // Bewegte Körper (Achse, Kopplung): Liegt der Rapier-Körper nicht dort, wo das
    // Modell ihn sieht (Elternkörper verschoben, Grenzen geändert …), dorthin setzen.
    MF.model.bodies.forEach(function (b) {
      var p = self.phys[b.id];
      if (!p || !p.rb || !p.rb.isKinematic() || !MF.isMoving(b)) return;
      var pose = self.worldPose(b), t = p.rb.translation();
      var q = self.quatZ(pose.rot), r = p.rb.rotation();
      // Rapier rechnet in float32: kleine Abweichungen sind kein Grund zum Umsetzen
      if (Math.abs(t.x - pose.x) + Math.abs(t.y - pose.y) + Math.abs(t.z - pose.z) < 1e-4 &&
          Math.abs(q.z * r.w - q.w * r.z) < 1e-5) return;
      p.rb.setTranslation({ x: pose.x, y: pose.y, z: pose.z }, true);
      p.rb.setRotation(q, true);
      rebuilt = true;
    });
    // Liegt ein schlafendes Teil auf einem neu gebauten Körper, soll es das merken
    if (rebuilt) this.boxes.forEach(function (bx) { bx.rb.wakeUp(); });
  },

  // Schneidet ein dynamischer Körper (Teil) die Form des Körpers (in seiner aktuellen Lage)?
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
      if (MF.hasAxis(b)) b.rt.prevPos = self.axisPos(b);
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
    var moving = bodies.filter(function (b) {
      var p = self.phys[b.id];
      return p && p.rb && p.rb.isKinematic() && MF.isMoving(b);
    });
    for (var i = 0; i < n; i++) {
      // Lage der bewegten Körper vor dem Unterschritt (für die Transportfläche)
      var before = moving.map(function (b) { return self.worldPose(b); });
      bodies.forEach(function (b) {
        if (MF.hasAxis(b)) self.stepAxis(b, h);
        if (b.surface) b.rt.travel = (b.rt.travel || 0) + self.surfaceSpeed(b) * h;   // nur für die Streifen
      });
      this.moveKinematic(moving, before, h);
      this.applySurfaces();
      this.world.step();
    }
    this.motion = {};
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
    this.endPulses();
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

  // ---------- Achse (Konzept, Abschnitt 2) ----------

  // Eine Achse um einen Physik-Unterschritt h (s) weiterfahren. rt.pos = Stellung
  // in m (linear) bzw. Grad (rotatorisch), nie schneller als vmax, immer in den
  // Grenzen min … max (liegt sie außerhalb, fährt sie mit vmax zurück).
  //   zweipunkt:       Ausfahren = 1: nach max. Ausfahren = 0: returnDelay warten, dann nach min.
  //                    Zwei Eingänge (valve 'bi'): Ausfahren = 1 bzw. Einfahren = 1 schaltet das
  //                    Ventil (rt.out) um, sonst bleibt es (beide 0 oder beide 1), kein returnDelay.
  //   position:        Freigabe = 1: auf Soll (in den Grenzen); ohne Freigabe steht sie.
  //   geschwindigkeit: Freigabe = 1: mit Soll (begrenzt auf ±vmax) bis an die Grenzen.
  stepAxis: function (b, h) {
    var ax = b.axis, rt = b.rt;
    if (rt.pos === undefined || rt.axisType !== ax.type) {
      rt.pos = MF.axisHome(ax);
      rt.wait = 0;
      rt.axisType = ax.type;
    }
    var target = rt.pos, step = ax.vmax * h;
    if (ax.mode === 'position') {
      if (this.input(b, 'Freigabe')) target = this.input(b, 'Soll');
    } else if (ax.mode === 'geschwindigkeit') {
      if (this.input(b, 'Freigabe')) target = rt.pos + Math.max(-ax.vmax, Math.min(ax.vmax, this.input(b, 'Soll'))) * h;
    } else if (ax.valve === 'bi') {
      var out = this.input(b, 'Ausfahren'), back = this.input(b, 'Einfahren');
      if (out && !back) rt.out = true;
      else if (back && !out) rt.out = false;
      target = rt.out ? ax.max : ax.min;
    } else if (this.input(b, 'Ausfahren')) {
      rt.wait = 0;
      target = ax.max;
    } else if (rt.pos > ax.min) {
      rt.wait = (rt.wait || 0) + h;
      if (rt.wait >= ax.returnDelay - 1e-9) target = ax.min;
    }
    if (target > ax.max) target = ax.max;   // Grenzen gelten immer (auch nach Ändern)
    if (target < ax.min) target = ax.min;
    var d = target - rt.pos;
    rt.pos = Math.abs(d) <= step ? target : rt.pos + (d > 0 ? step : -step);
  },

  // Bewegte Körper (Achse, Kopplung) an ihre neue Lage fahren lassen. Rapier
  // rechnet daraus ihre Geschwindigkeit; die Transportfläche braucht sie auch
  // (this.motion: Lage vor und nach dem Unterschritt).
  // Kommt ein Körper zum Stehen, rechnet Rapier seine Kontakte neu: Gleitet seine
  // Fläche an einer Kiste entlang (Stopper fährt ein, die gestaute Kiste drückt
  // seitlich dagegen), schreibt parry die Kontaktpunkte nur fort – auch über die
  // Kante hinaus – und die Kiste hinge an einem Kontakt, den es nicht mehr gibt.
  moveKinematic: function (moving, before, h) {
    var self = this;
    this.motion = {};
    moving.forEach(function (b, k) {
      var p = self.phys[b.id], rb = p.rb, cur = before[k], next = self.worldPose(b);
      self.motion[b.id] = { cur: cur, next: next, h: h };
      rb.setNextKinematicTranslation({ x: next.x, y: next.y, z: next.z });
      // Drehung nur, wenn sie sich ändern kann (Drehachse, Kopplung)
      if ((b.axis && b.axis.type === 'rotary') || MF.parentBody(b)) rb.setNextKinematicRotation(self.quatZ(next.rot));
      var moved = next.x !== cur.x || next.y !== cur.y || next.z !== cur.z || next.rot !== cur.rot;
      if (b.rt.moving && !moved) self.refreshContacts(p);
      b.rt.moving = moved;
    });
  },

  // Kontakte eines Körpers neu berechnen lassen (Collider gilt als geändert)
  refreshContacts: function (p) {
    (p.colliders || []).forEach(function (col, i) { col.setTranslationWrtParent(p.parts[i].t); });
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
  // (μ = Reibwert des Bands). Drehen um die Hochachse wird ebenso begrenzt.
  // Bewegt sich der Körper selbst (Drehtisch, Hubtisch, Kopplung), kommt die
  // Geschwindigkeit seines Oberflächenpunkts unter der Kiste dazu (v + ω × r) –
  // die Bandoberfläche hat in Rapier Reibung 0 und nähme die Kiste sonst nicht mit.
  // Die Laufrichtung dreht mit dem Körper; die Kiste dreht mit ω mit.
  applySurfaces: function () {
    var self = this, world = this.world, motion = this.motion || {};
    var targets = [], byHandle = {};
    MF.model.bodies.forEach(function (b) {
      var p = self.phys[b.id];
      if (!b.surface || !p || !p.rb) return;
      var speed = self.surfaceSpeed(b);
      var mot = motion[b.id];
      var v = MF.geom.dirVec((mot ? mot.next.rot : b.pose.rot) + b.surface.dir);
      var wz = mot ? MF.geom.rad(mot.next.rot - mot.cur.rot) / mot.h : 0;
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
          if (!t) { t = byHandle[rb.handle] = { rb: rb, x: 0, y: 0, w: 0, j: 0, muj: 0 }; targets.push(t); }
          if (mot) {
            // Punkt der Oberfläche unter der Kiste: wohin trägt ihn der Körper in diesem Unterschritt?
            var at = rb.translation(), l = MF.geom.toLocal(mot.cur, at.x, at.y), to = MF.geom.toWorld(mot.next, l.x, l.y);
            t.x += (v.x * speed + (to.x - at.x) / mot.h) * j;
            t.y += (v.y * speed + (to.y - at.y) / mot.h) * j;
            t.w += wz * j;
          } else {
            t.x += v.x * speed * j;
            t.y += v.y * speed * j;
          }
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
      var dw = t.w / t.j - w.z;   // Ziel: Drehung der Fläche (meist 0)
      var wz = Math.abs(dw) <= maxDw ? w.z + dw : w.z + (dw > 0 ? maxDw : -maxDw);
      // nichts zu tun – Kiste darf schlafen (Reste unter 1 µm/s bzw. µrad/s zählen nicht)
      if (len < 1e-6 && Math.abs(wz - w.z) < 1e-6) return;
      rb.setLinvel({ x: v.x + dx, y: v.y + dy, z: v.z }, true);
      rb.setAngvel({ x: w.x, y: w.y, z: wz }, true);
    });
  },

  // ---------- Teile (aus Erzeugern) ----------

  boxState: function (rb) {
    var p = rb.translation(), q = rb.rotation();
    return { x: p.x, y: p.y, z: p.z, q: { x: q.x, y: q.y, z: q.z, w: q.w } };
  },

  // Erzeuger: legt im Takt ein Teil in der Form seines Produkts auf – dort, wo das
  // Produkt liegt (Lage relativ zum Erzeuger, Unterseite auf seiner Höhe, seine
  // Drehung als Startdrehung). Aber nur, wenn der Platz frei ist (sonst im nächsten
  // Zyklus): das Teil, rundum SPAWN_GAP größer, darf keinen dynamischen Körper schneiden.
  stepSpawner: function (b, dt) {
    var sp = b.spawner, rt = b.rt;
    if (!sp.enabled || !this.input(b, 'Freigabe')) return;
    if (rt.made === undefined) { rt.made = 0; rt.timer = 0; }
    if (sp.maxCount > 0 && rt.made >= sp.maxCount) return;

    rt.timer -= dt;
    if (rt.timer > 1e-9) return;

    var prod = MF.productOf(b);
    if (!prod) return;
    // Erzeuger kann an einem bewegten Körper hängen
    var at = this.spawnPose(b, prod), sh = at.shape;
    var q = this.quatZ(at.rot), free = true, self = this;
    this.probeParts(sh).forEach(function (part) {
      if (!free) return;
      var t = MF.geom.toWorld(at, part.t.x, part.t.y);
      self.world.intersectionsWithShape({ x: t.x, y: t.y, z: at.z + part.t.z }, self.mulQuat(q, part.q), part.shape,
        function () { free = false; return false; }, self.DYNAMIC_ONLY);
    });
    if (!free) return;

    this.addBox(prod, at);
    rt.made++;
    rt.timer += sp.interval;
    if (rt.timer < 0) rt.timer = sp.interval;   // kein Nachholen nach einem Stau
  },

  // Wo das nächste Teil des Erzeugers b entsteht: { x, y, z, rot, shape } – Mitte
  // (Flächenschwerpunkt) des Grundrisses in der Welt, Unterseite auf z, shape um
  // den Schwerpunkt gelegt (MF.geom.centered)
  spawnPose: function (b, prod) {
    var pose = MF.composePose(this.worldPose(b), prod.pose);
    var c = MF.geom.centroid(prod.shape), w = MF.geom.toWorld(pose, c.x, c.y);
    return { x: w.x, y: w.y, z: pose.z, rot: pose.rot, shape: MF.geom.centered(prod.shape) };
  },

  // Rapier-Formen für "Platz frei?": wie shapeParts, rundum SPAWN_GAP größer
  probeParts: function (sh) {
    var R = this.R, g = this.SPAWN_GAP, ID = { x: 0, y: 0, z: 0, w: 1 };
    if (sh.type === 'rect') return [{ shape: new R.Cuboid(sh.w / 2 + g, sh.d / 2 + g, sh.h / 2 + g), t: { x: 0, y: 0, z: sh.h / 2 }, q: ID }];
    if (sh.type === 'circle') {
      var s = Math.SQRT1_2;
      return [{ shape: new R.RoundCylinder(sh.h / 2, sh.r, g), t: { x: 0, y: 0, z: sh.h / 2 }, q: { x: s, y: 0, z: 0, w: s } }];
    }
    return MF.geom.convexParts(sh.points).map(function (poly) {
      var v = [];
      poly.forEach(function (p) { v.push(p[0], p[1], 0, p[0], p[1], sh.h); });
      return { shape: new R.RoundConvexPolyhedron(new Float32Array(v), null, g), t: { x: 0, y: 0, z: 0 }, q: ID };
    });
  },

  // Teil (dynamischer Körper) nach dem Produkt prod anlegen; at aus spawnPose.
  // Der Rapier-Körper liegt im Mittelpunkt (Schwerpunkt des Grundrisses, halbe
  // Höhe), damit Lage = Mittelpunkt ist (Senke, Draufsicht, 3D-Ansicht).
  addBox: function (prod, at) {
    var self = this, R = this.R, sh = at.shape;
    var rb = this.world.createRigidBody(R.RigidBodyDesc.dynamic()
      .setTranslation(at.x, at.y, at.z + sh.h / 2).setRotation(this.quatZ(at.rot || 0)));
    this.shapeParts(sh).forEach(function (part) {
      self.world.createCollider(self.colliderDesc(part.shape, prod.material || MF.MATERIALS.box)
        .setTranslation(part.t.x, part.t.y, part.t.z - sh.h / 2).setRotation(part.q), rb);
    });
    var r = MF.geom.bounds(sh, { x: 0, y: 0, rot: 0 });
    var size = sh.type === 'rect' ? [sh.w, sh.d, sh.h] : [r.x1 - r.x0, r.y1 - r.y0, sh.h];
    var state = this.boxState(rb);
    var box = { id: this.nextBoxId++, rb: rb, shape: sh, size: size, color: (prod.look && prod.look.color) || MF.BOX_COLOR,
      product: prod.id, source: prod.parent, prev: state, cur: state };
    this.boxes.push(box);
    return box;
  },

  removeBox: function (i) {
    this.world.removeRigidBody(this.boxes[i].rb);
    this.boxes.splice(i, 1);
  },

  // Senke: nimmt Teile auf, deren Mittelpunkt in ihrer Form liegt, und zählt sie.
  // Teile unter z = −2 m sind verloren und werden ebenfalls entfernt.
  collectSinks: function () {
    var self = this;
    var sinks = MF.model.bodies.filter(function (b) { return b.sink; });
    var poses = sinks.map(function (b) { return self.worldPose(b); });
    for (var i = this.boxes.length - 1; i >= 0; i--) {
      var p = this.boxes[i].cur;   // Mittelpunkt
      var hit = null;
      for (var k = 0; k < sinks.length && !hit; k++) {
        if (MF.geom.containsPoint(sinks[k].shape, poses[k], p)) hit = sinks[k];
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
      case 'axis.InPosition':   return Math.abs(this.axisPos(b) - this.input(b, 'Soll')) <= MF.AXIS.TOL[b.axis.type] + 1e-9 ? 1 : 0;
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

  // Impuls auf einen BOOL-Eingang (Handbetrieb, Ventil mit zwei Eingängen): 1 für
  // den nächsten Zyklus, danach wieder 0. Reset nimmt ihn zurück.
  pulse: function (b, name) {
    this.setSignal(b, name, 1);
    this.pulses = (this.pulses || []).concat([{ id: b.id, name: name }]);
  },

  endPulses: function () {
    var self = this;
    (this.pulses || []).forEach(function (p) {
      var b = MF.store.findBody(p.id);
      if (b && b.inputs && self.ioDef(b, p.name)) b.inputs[p.name] = 0;
    });
    this.pulses = [];
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
