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
      if (el.type === 'sensor') el.rt.occupied = self.sensorHit(el);
    });

    // 2. Logik – die Wenn-dann-Regeln werden ab Etappe 4 hier ausgewertet
    // 3. Aktoren – Schieber fahren ab Etappe 3 hier

    // 4. Bewegung
    this.moveBelts(dt);
    this.moveBoxes(dt);

    // 5. Quelle und Senke
    this.collectSinks();
    els.forEach(function (el) {
      if (el.type === 'source') self.stepSource(el, dt);
    });
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
    if (!p.enabled) return;
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

  // Läuft das Band? Schalter "Antrieb" im Eigenschaften-Panel und Signal "Ein" (kommt mit der Logik)
  beltOn: function (belt) {
    return belt.props.running !== false && (!belt.rt || belt.rt.on !== false);
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
      b.x = nx;
      b.y = ny;
    });
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
  // Schieber und Regeln steuern noch nichts (Etappe 3 und 4), daher 0.
  signal: function (el, name) {
    var p = el.props, rt = el.rt || {};
    var on = el.type === 'conveyor' ? this.beltOn(el) : rt.on !== false;
    switch (el.type + '.' + name) {
      case 'source.Freigabe':  return p.enabled ? 1 : 0;
      case 'source.Erzeugt':   return rt.made || 0;
      case 'conveyor.Ein':     return on ? 1 : 0;
      case 'conveyor.Läuft':   return on && p.speed > 0 ? 1 : 0;
      case 'conveyor.Tempo':   return on ? p.speed : 0;
      case 'sensor.Belegt':    return (!!rt.occupied !== !!p.invert) ? 1 : 0;  // Wert aus dem letzten Schritt
      case 'sink.Anzahl':      return p.count;
      default:                 return 0;
    }
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
  }
};
