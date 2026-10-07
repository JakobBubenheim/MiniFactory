// Engine: was in einem Zeitschritt mit der Anlage passiert.
//
// Die Zeit selbst steuert die Uhr aus sim/clock.js: feste Schritte (Standard
// 50 ms), Zeitfaktor, Start/Pause/Schritt/Reset und Interpolation beim
// Zeichnen. Die Engine liefert den Inhalt eines Schritts – in der Reihenfolge
// eines SPS-Zyklus: Sensoren lesen → Logik → Aktoren → Bewegung → Quelle/Senke.
window.MF = window.MF || {};

MF.engine = {
  boxes: [],
  nextBoxId: 1,
  BOX: 0.6,          // Kantenlänge einer Kiste in Rasterzellen
  renderAlpha: 1,    // Anteil bis zum nächsten Schritt im zuletzt gezeichneten Bild

  listeners: [],
  on: function (fn) { this.listeners.push(fn); },
  emit: function () {
    for (var i = 0; i < this.listeners.length; i++) this.listeners[i](this.state);
  },

  init: function () {
    var self = this;
    this.clock = MF.createClock({
      dtMs: MF.model.settings.dtMs,
      onTick: function (dt) { self.step(dt); },
      onRender: function (alpha) { self.renderAlpha = alpha; MF.sim.draw(); },
      onReset: function () { self.resetWorld(); },
      onChange: function () { self.emit(); }
    });
    this.clock.start(); // Zeichenschleife läuft ab jetzt dauerhaft
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

  // Anlage in den Ausgangszustand: keine Kisten, Zähler und Takte zurück
  resetWorld: function () {
    this.boxes = [];
    this.nextBoxId = 1;
    MF.model.elements.forEach(function (el) {
      el.rt = {};  // Laufzeitdaten je Element
      if (el.type === 'sink') el.props.count = 0;
    });
    // Regel-Ziele auf Startwert, SCL-Variablen und Zeitglieder auf Anfang
    MF.logic.reset();
  },

  // ---------- Ein Zeitschritt ----------

  step: function (dt) {
    if (dt === undefined) dt = this.dt();
    var self = this;
    var els = MF.model.elements;

    // Alte Position merken (für Interpolation)
    this.boxes.forEach(function (b) { b.px = b.x; b.py = b.y; });

    // 1. Sensoren lesen (Prozessabbild der Eingänge)
    els.forEach(function (el) {
      if (!el.rt) el.rt = {};
      if (el.type === 'sensor') self.stepSensor(el, dt);
    });

    // 2. Logik – Wenn-dann-Regeln und SCL-Bausteine schreiben die Eingänge der Aktoren
    MF.logic.run(dt);

    // 3. Aktoren
    els.forEach(function (el) {
      if (el.type === 'pusher') self.stepPusher(el, dt);
    });

    // 4. Bewegung
    this.moveBelts(dt);
    this.moveBoxes(dt);

    // 5. Quelle und Senke
    this.collectSinks();
    els.forEach(function (el) {
      if (el.type === 'source') self.stepSource(el, dt);
    });
  },

  // Lichtschranke mit Entprellung: "belegt" wechselt erst, wenn der Rohzustand
  // props.debounce ms lang stabil anliegt. Nach Reset ist rt leer -> frei.
  stepSensor: function (el, dt) {
    var rt = el.rt;
    var raw = this.sensorHit(el);
    if (rt.occupied === undefined) { rt.occupied = false; rt.raw = false; rt.stableMs = 0; }
    if (raw !== rt.raw) { rt.raw = raw; rt.stableMs = 0; }
    else rt.stableMs += dt * 1000;
    if (rt.raw !== rt.occupied && rt.stableMs >= (el.props.debounce || 0) - 1e-6) rt.occupied = rt.raw;
  },

  // Liegt eine Kiste im Strahl der Lichtschranke (Mitte der Zelle)?
  sensorHit: function (el) {
    var h = this.BOX / 2;
    return this.boxes.some(function (b) {
      return b.x + h > el.x + 0.45 && b.x - h < el.x + 0.55 && b.y + h > el.y && b.y - h < el.y + el.h;
    });
  },

  // Quelle: legt im festen Takt eine Kiste auf das angrenzende Band
  stepSource: function (src, dt) {
    var p = src.props;
    if (!p.enabled || !this.input(src, 'Freigabe')) return;
    var rt = src.rt;
    if (rt.made === undefined) { rt.made = 0; rt.timer = 0; }
    if (p.maxCount > 0 && rt.made >= p.maxCount) return;

    rt.timer -= dt;
    if (rt.timer > 1e-9) return;

    var spot = this.spawnPoint(src);
    if (this.boxAt(spot.x, spot.y, this.BOX)) return; // Platz belegt: im nächsten Schritt erneut

    this.boxes.push({ id: this.nextBoxId++, x: spot.x, y: spot.y, px: spot.x, py: spot.y });
    rt.made++;
    rt.timer += p.interval;
    if (rt.timer < 0) rt.timer = p.interval;
  },

  // Mitte der ersten Bandzelle neben der Quelle, sonst Mitte der Quelle
  spawnPoint: function (src) {
    var cx = src.x + src.w / 2, cy = src.y + src.h / 2;
    var candidates = [
      { x: src.x + src.w + 0.5, y: cy },   // rechts
      { x: src.x - 0.5,         y: cy },   // links
      { x: cx, y: src.y + src.h + 0.5 },   // unten
      { x: cx, y: src.y - 0.5 }            // oben
    ];
    for (var i = 0; i < candidates.length; i++) {
      if (this.conveyorAt(candidates[i].x, candidates[i].y)) return candidates[i];
    }
    return { x: cx, y: cy };
  },

  DIRS: { rechts: [1, 0], links: [-1, 0], oben: [0, -1], unten: [0, 1] },

  conveyorAt: function (x, y) {
    var els = MF.model.elements;
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.type === 'conveyor' && x >= el.x && x < el.x + el.w && y >= el.y && y < el.y + el.h) return el;
    }
    return null;
  },

  // Gibt es eine Kiste, deren Mitte näher als d an (x, y) liegt?
  boxAt: function (x, y, d, except) {
    for (var i = 0; i < this.boxes.length; i++) {
      var b = this.boxes[i];
      if (b === except) continue;
      if (Math.abs(b.x - x) < d && Math.abs(b.y - y) < d) return b;
    }
    return null;
  },

  // Läuft das Band? Schalter "Antrieb" im Eigenschaften-Panel und Eingang "Ein"
  beltOn: function (belt) {
    return belt.props.running !== false && !!this.input(belt, 'Ein');
  },

  // Zurückgelegter Weg je Band in Zellen – für die wandernden Streifen.
  // Aufsummiert statt aus Zeit × Tempo berechnet, damit Tempo-Änderungen nicht springen.
  moveBelts: function (dt) {
    var cellM = MF.model.settings.cellM;
    var self = this;
    MF.model.elements.forEach(function (el) {
      if (el.type !== 'conveyor') return;
      var rt = el.rt;
      rt.travel = rt.travel || 0;
      rt.prevTravel = rt.travel;
      if (self.beltOn(el)) rt.travel += (el.props.speed / cellM) * dt;
    });
  },

  // Bänder bewegen Kisten in Laufrichtung. Kisten stauen sich, statt sich zu überlappen.
  moveBoxes: function (dt) {
    var cellM = MF.model.settings.cellM;
    var self = this;

    // Vorderste Kisten zuerst bewegen, damit der Stau sauber aufrückt
    var order = this.boxes.slice().sort(function (a, b) {
      return self.progress(b) - self.progress(a);
    });

    order.forEach(function (b) {
      var belt = self.conveyorAt(b.x, b.y);
      if (!belt) return;
      if (!self.beltOn(belt)) return;

      var dir = self.DIRS[belt.props.direction] || self.DIRS.rechts;
      var dist = (belt.props.speed / cellM) * dt;   // m/s -> Zellen pro Schritt
      var nx = b.x + dir[0] * dist;
      var ny = b.y + dir[1] * dist;

      // Auf die Bandmitte ziehen (quer zur Laufrichtung)
      if (dir[0] !== 0) ny = belt.y + belt.h / 2;
      else nx = belt.x + belt.w / 2;

      if (self.boxAt(nx, ny, self.BOX + 0.02, b)) return; // Stau
      // Ausgefahrener Schieber im Weg (liegt sie schon darin, darf sie heraus)
      if (self.pusherBlocks(nx, ny) && !self.pusherBlocks(b.x, b.y)) return;
      b.x = nx;
      b.y = ny;
    });
  },

  // ---------- Schieber ----------

  PLATE: 0.08,     // Dicke der Schieberplatte in Zellen
  PLATE_W: 0.8,    // Breite der Platte quer zur Schubrichtung

  // Schubrichtung: Eigenschaft "Richtung", bei "auto" vom Schieber weg zum
  // angrenzenden Band (ohne Band: nach unten)
  pusherDir: function (el) {
    var d = el.props.direction;
    if (d && d !== 'auto' && this.DIRS[d]) return this.DIRS[d];
    var cx = el.x + el.w / 2, cy = el.y + el.h / 2;
    var order = ['unten', 'oben', 'rechts', 'links'];
    for (var i = 0; i < order.length; i++) {
      var v = this.DIRS[order[i]];
      if (this.conveyorAt(cx + v[0] * (el.w / 2 + 0.5), cy + v[1] * (el.h / 2 + 0.5))) return v;
    }
    return this.DIRS.unten;
  },

  // Fläche, die der Schieber bei Hub ext (Zellen) überstreicht: von der Kante
  // seiner Zelle bis zur Plattenvorderseite. face = Lage der Vorderseite.
  pusherGeom: function (el, ext) {
    var dir = this.pusherDir(el);
    var cx = el.x + el.w / 2, cy = el.y + el.h / 2;
    var half = (dir[0] !== 0 ? el.w : el.h) / 2;
    var along = dir[0] !== 0 ? cx : cy;       // Achse in Schubrichtung
    var across = dir[0] !== 0 ? cy : cx;      // Achse quer dazu
    var sign = dir[0] + dir[1];
    return { dir: dir, sign: sign, axis: dir[0] !== 0 ? 'x' : 'y', across: across,
      edge: along + sign * half, face: along + sign * (half + ext) };
  },

  // Rechteck { x0, y0, x1, y1 } des ausgefahrenen Teils (Stange + Platte)
  pusherRect: function (el, ext) {
    var g = this.pusherGeom(el, ext);
    var a0 = Math.min(g.edge, g.face), a1 = Math.max(g.edge, g.face);
    var c0 = g.across - this.PLATE_W / 2, c1 = g.across + this.PLATE_W / 2;
    return g.axis === 'x' ? { x0: a0, y0: c0, x1: a1, y1: c1 } : { x0: c0, y0: a0, x1: c1, y1: a1 };
  },

  // Überlappt eine Kiste mit Mitte (x, y) ein ausgefahrenes Schieberteil?
  pusherBlocks: function (x, y) {
    var h = this.BOX / 2;
    var els = MF.model.elements;
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.type !== 'pusher' || !el.rt || !(el.rt.pos > 0)) continue;
      var r = this.pusherRect(el, el.rt.pos / MF.model.settings.cellM);
      if (x + h > r.x0 + 1e-6 && x - h < r.x1 - 1e-6 && y + h > r.y0 + 1e-6 && y - h < r.y1 - 1e-6) return true;
    }
    return false;
  },

  // Ausfahren = 1: mit props.speed bis zum Hub. Ausfahren = 0: props.returnDelay
  // warten, dann einfahren. rt.pos = Hub in Metern, rt.prevPos fürs Zeichnen.
  // Kisten vor der Platte werden mitgeschoben; stößt eine davon an eine
  // andere Kiste, bleibt der Schieber in diesem Schritt stehen.
  stepPusher: function (el, dt) {
    var rt = el.rt, p = el.props;
    var cellM = MF.model.settings.cellM;
    if (rt.pos === undefined) { rt.pos = 0; rt.wait = 0; }
    rt.prevPos = rt.pos;

    var stroke = Math.max(0, p.stroke / 1000);
    var target = rt.pos;
    if (this.input(el, 'Ausfahren')) {
      rt.wait = 0;
      target = Math.min(stroke, rt.pos + p.speed * dt);
    } else if (rt.pos > 0) {
      rt.wait += dt;
      if (rt.wait >= p.returnDelay - 1e-9) target = Math.max(0, rt.pos - p.speed * dt);
    }
    if (target > stroke) target = Math.max(stroke, rt.pos - p.speed * dt); // Hub verkleinert
    if (target <= rt.pos) { rt.pos = target; return; }

    // Ausfahren: Kisten vor der Platte mitnehmen
    var oldG = this.pusherGeom(el, rt.pos / cellM);
    var newG = this.pusherGeom(el, target / cellM);
    var h = this.BOX / 2, reach = this.PLATE_W / 2 + h;
    var ax = oldG.axis, cx = ax === 'x' ? 'y' : 'x', s = oldG.sign;
    var moves = [];
    this.boxes.forEach(function (b) {
      if (Math.abs(b[cx] - oldG.across) >= reach - 1e-6) return;  // seitlich vorbei
      var near = b[ax] - s * h;                                    // Kistenseite zur Platte
      if (s * (near - oldG.face) < -1e-6) return;                  // liegt hinter der Platte
      if (s * (near - newG.face) >= 0) return;                     // wird nicht erreicht
      moves.push({ b: b, v: newG.face + s * (h + 1e-4) });
    });

    // Prüfen, ob die geschobenen Kisten frei sind (kein Überlappen)
    var self = this;
    var pushed = moves.map(function (m) { return m.b; });
    var free = moves.every(function (m) {
      var x = ax === 'x' ? m.v : m.b.x, y = ax === 'y' ? m.v : m.b.y;
      for (var i = 0; i < self.boxes.length; i++) {
        var o = self.boxes[i];
        if (pushed.indexOf(o) >= 0) continue;
        if (Math.abs(o.x - x) < self.BOX && Math.abs(o.y - y) < self.BOX) return false;
      }
      return true;
    });
    if (!free) return;

    moves.forEach(function (m) { m.b[ax] = m.v; });
    rt.pos = target;
  },

  progress: function (b) {
    var belt = this.conveyorAt(b.x, b.y);
    if (!belt) return Infinity;
    var dir = this.DIRS[belt.props.direction] || this.DIRS.rechts;
    return b.x * dir[0] + b.y * dir[1];
  },

  // Aktueller Wert eines Signals, z. B. signal(B1, 'Läuft') -> 1.
  // Signale hängen nur vom Zustand der Anlage ab, nie davon, ob die Uhr läuft:
  // Eine Pause friert die Zeit ein, die Zustände bleiben wie im letzten Schritt.
  // Geforcte Ausgänge liefern den festgehaltenen Wert statt des berechneten.
  signal: function (el, name) {
    if (el.force && name in el.force) return el.force[name];
    var p = el.props, rt = el.rt || {};
    var on = el.type === 'conveyor' ? this.beltOn(el) : true;
    switch (el.type + '.' + name) {
      case 'source.Freigabe':  return this.input(el, name);
      case 'source.Erzeugt':   return rt.made || 0;
      case 'conveyor.Ein':     return this.input(el, name);
      case 'conveyor.Läuft':   return on && p.speed > 0 ? 1 : 0;
      case 'conveyor.Tempo':   return this.input(el, name);  // Sollwert, auch bei stehendem Band
      case 'sensor.Belegt':    return (!!rt.occupied !== !!p.invert) ? 1 : 0;  // Wert aus dem letzten Schritt
      case 'sink.Anzahl':      return p.count;
      case 'sink.Reset':       return this.input(el, name);
      case 'pusher.Ausfahren':   return this.input(el, name);
      case 'pusher.Ausgefahren': return (rt.pos || 0) >= p.stroke / 1000 - 1e-6 ? 1 : 0;
      case 'pusher.Eingefahren': return (rt.pos || 0) <= 1e-6 ? 1 : 0;
      default:                 return 0;
    }
  },

  // Wert eines Eingangs (von Hand gesetzt oder Startwert).
  // Eingänge mit prop lesen und schreiben direkt die Eigenschaft, z. B. Tempo -> props.speed.
  input: function (el, name) {
    var def = this.ioDef(el, name);
    if (def && def.prop) return el.props[def.prop];
    return el.inputs && name in el.inputs ? el.inputs[name] : 0;
  },

  // Signal von Hand setzen: Eingänge werden geschrieben, Ausgänge geforct.
  setSignal: function (el, name, v) {
    var def = this.ioDef(el, name);
    if (!def) return;
    v = def.type === 'BOOL' ? (v ? 1 : 0) : def.type === 'INT32' ? Math.round(v) : v;
    if (def.prop) {
      // Grenzen der Eigenschaft einhalten, z. B. Tempo 0 … 5 m/s
      var pd = MF.types[el.type].props.filter(function (p) { return p.key === def.prop; })[0] || {};
      if (pd.min !== undefined) v = Math.max(pd.min, v);
      if (pd.max !== undefined) v = Math.min(pd.max, v);
      el.props[def.prop] = v;
    } else if (def.dir === 'in') el.inputs[name] = v;
    else el.force[name] = v;
  },

  // Forcen eines Ausgangs aufheben – er zeigt wieder den berechneten Wert
  releaseForce: function (el, name) {
    if (el.force) delete el.force[name];
  },

  isForced: function (el, name) {
    return !!el.force && name in el.force;
  },

  ioDef: function (el, name) {
    return MF.types[el.type].io.filter(function (s) { return s.name === name; })[0] || null;
  },

  // Senke: nimmt Kisten auf, deren Mitte über ihr liegt, und zählt sie
  collectSinks: function () {
    var sinks = MF.model.elements.filter(function (el) { return el.type === 'sink'; });
    this.boxes = this.boxes.filter(function (b) {
      for (var i = 0; i < sinks.length; i++) {
        var s = sinks[i];
        if (b.x >= s.x && b.x < s.x + s.w && b.y >= s.y && b.y < s.y + s.h) {
          s.props.count++;
          return false;
        }
      }
      return true;
    });
    // Eingang "Reset" hält den Zähler auf 0, solange er 1 ist
    var self = this;
    sinks.forEach(function (s) {
      if (self.input(s, 'Reset')) s.props.count = 0;
    });
  }
};
