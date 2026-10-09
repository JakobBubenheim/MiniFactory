// Migration Dateiformat 2 -> 3: Raster-Elemente werden Körper in Metern.
//
// Regeln aus Idee/Konzept-3D.md, Abschnitt 3 ("Migration 2 → 3"):
// - Zelle (x, y, w, h) × settings.cellM -> Meter. Alle Körper liegen achsparallel
//   (Lage-Drehung 0), außer Schiebern, die in Schubrichtung gedreht werden.
// - Förderband: static, Rechteck, 0,1 m hoch, Oberkante 0,7 m, Transportfläche.
//   Richtung -> surface.dir in Grad (rechts 0°, unten 90°, links 180°, oben 270°).
//   Alle Bänder liegen bündig; über die Naht hilft die Umlenkrolle an den
//   Stirnenden (Engine, Spike-3D-Ergebnis 4a).
// - Lichtschranke: ghost, 5 cm schmaler Streifen quer über dem Band (wie der
//   alte Strahl durch die Zellmitte), Sensor.
// - Schieber: kinematic, lineare Achse "zweipunkt", Hub -> max, Tempo -> vmax.
//   Richtung "auto" wird einmal fest aufgelöst (wie die alte Engine: vom Schieber
//   weg über das angrenzende Band). Form: Stößel mit Platte an der Zellkante und
//   Fangwinkel auf der Abströmseite des Bands (siehe MF.pusherOutline).
// - Quelle: ghost mit Erzeuger, liegt dort, wo die alte Engine die Kisten
//   abgelegt hat (Mitte der angrenzenden Bandzelle), 2 cm über dem Band.
// - Senke: ghost mit Senke, vom Boden bis 0,6 m (etwas tiefer als das Band),
//   damit Kisten hineinfallen.
// - Signalnamen, Eingänge, Ordner, Darstellung und Regeln bleiben gleich.
window.MF = window.MF || {};

(function () {
  var DIR_VEC = { rechts: [1, 0], links: [-1, 0], oben: [0, -1], unten: [0, 1] };

  function isObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function r6(v) { return Math.round(v * 1e6) / 1e6; }

  // Wie die alte MF.normalizeElement(): Drehung aus der Richtung, Band ggf. hochkant.
  // w und h sind danach die belegten Zellen (mit Drehung).
  function normalize(el) {
    var p = el.props;
    var zero = { conveyor: 'rechts', pusher: 'unten' }[el.type];
    if (zero && p.direction in MF.DIRS) el.rot = MF.geom.normDeg(MF.DIRS[p.direction] - MF.DIRS[zero]);
    else if ([0, 90, 180, 270].indexOf(el.rot) < 0) el.rot = 0;
    if (el.type === 'conveyor' && (el.rot % 180 !== 0 ? el.w > el.h : el.h > el.w)) {
      var w = el.w; el.w = el.h; el.h = w;
    }
  }

  var DEFAULTS = {
    source: { interval: 2, maxCount: 0, enabled: true },
    conveyor: { running: true, speed: 0.5, direction: 'rechts' },
    sensor: { invert: false, debounce: 0 },
    pusher: { stroke: 400, speed: 0.3, returnDelay: 0.5, direction: 'auto' },
    sink: {}
  };

  MF.migrate23 = function (o) {
    var cellM = isObject(o.settings) && isNum(o.settings.cellM) && o.settings.cellM > 0 ? o.settings.cellM : 0.5;
    var els = (Array.isArray(o.elements) ? o.elements : []).filter(isObject).map(function (src) {
      var el = JSON.parse(JSON.stringify(src));
      var props = {}, given = isObject(el.props) ? el.props : {}, k;
      for (k in DEFAULTS[el.type] || {}) props[k] = DEFAULTS[el.type][k];
      for (k in given) props[k] = given[k];
      el.props = props;
      ['x', 'y', 'w', 'h'].forEach(function (k) { if (!isNum(el[k])) el[k] = k === 'w' || k === 'h' ? 1 : 0; });
      if (DEFAULTS[el.type]) normalize(el);
      return el;
    });
    var belts = els.filter(function (el) { return el.type === 'conveyor'; });

    // Band, das die Zelle (x, y) belegt (wie die alte conveyorAt)
    function beltAt(x, y) {
      for (var i = 0; i < belts.length; i++) {
        var b = belts[i];
        if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) return b;
      }
      return null;
    }

    function topAt(x, y) {
      var b = beltAt(x, y);
      return b ? MF.BELT_TOP : null;
    }

    // Alte Engine: Schubrichtung, bei "auto" vom Schieber weg zum angrenzenden Band
    function pusherDir(el) {
      var d = el.props.direction;
      if (DIR_VEC[d]) return d;
      var cx = el.x + el.w / 2, cy = el.y + el.h / 2;
      var order = ['unten', 'oben', 'rechts', 'links'];
      for (var i = 0; i < order.length; i++) {
        var v = DIR_VEC[order[i]];
        if (beltAt(cx + v[0] * (el.w / 2 + 0.5), cy + v[1] * (el.h / 2 + 0.5))) return order[i];
      }
      return 'unten';
    }

    // Alte Engine: Kisten der Quelle landen mittig in der angrenzenden Bandzelle,
    // zuerst in Blickrichtung der Quelle gesucht
    function spawnPoint(el) {
      var cx = el.x + el.w / 2, cy = el.y + el.h / 2;
      var sides = {
        0: { x: el.x + el.w + 0.5, y: cy }, 90: { x: cx, y: el.y + el.h + 0.5 },
        180: { x: el.x - 0.5, y: cy }, 270: { x: cx, y: el.y - 0.5 }
      };
      var order = [0, 180, 90, 270];
      order.splice(order.indexOf(el.rot), 1);
      order.unshift(el.rot);
      for (var i = 0; i < order.length; i++) {
        var c = sides[order[i]];
        if (beltAt(c.x, c.y)) return c;
      }
      return { x: cx, y: cy };
    }

    function m(v) { return r6(v * cellM); }

    o.bodies = els.map(function (el) {
      var p = el.props;
      var cx = el.x + el.w / 2, cy = el.y + el.h / 2;
      var b = MF.templates[el.type] ? MF.bodyFromTemplate(el.type, m(cx), m(cy)) : null;
      if (!b) {
        // Unbekannter Typ: bleibt erkennbar ungültig, validate() meldet ihn
        return { id: el.id, name: el.name, parent: el.parent || null, template: el.type };
      }
      b.id = el.id;
      b.name = typeof el.name === 'string' ? el.name : el.id;
      b.parent = el.parent || null;
      var top;

      switch (el.type) {
        case 'conveyor':
          b.shape.w = m(el.w);
          b.shape.d = m(el.h);
          b.pose.z = MF.BELT_TOP - 0.1;
          b.surface = { speed: p.speed, dir: MF.DIRS[p.direction] || 0, running: p.running !== false };
          break;

        case 'sensor':
          // Strahl: senkrecht bei 0°/180°, waagrecht bei 90°/270°
          if (el.rot % 180 === 0) { b.shape.w = m(0.1); b.shape.d = m(el.h); }
          else { b.shape.w = m(el.w); b.shape.d = m(0.1); }
          top = topAt(cx, cy);
          b.pose.z = r6((top === null ? 0 : top) + 0.01);
          b.sensor = { invert: !!p.invert, debounce: isNum(p.debounce) ? p.debounce : 0 };
          break;

        case 'pusher':
          var dir = pusherDir(el);
          var v = DIR_VEC[dir];
          var along = v[0] !== 0 ? el.w : el.h, across = v[0] !== 0 ? el.h : el.w;
          var belt = beltAt(cx + v[0] * (el.w / 2 + 0.5), cy + v[1] * (el.h / 2 + 0.5));
          // Grundstellung schiebt nach "unten" (+y); gedreht in die Schubrichtung
          b.pose.rot = MF.geom.normDeg(MF.DIRS[dir] - 90);
          // Fangwinkel auf der Seite, zu der das Band läuft (im lokalen x)
          var side = 0;
          if (belt) {
            var bv = DIR_VEC[belt.props.direction] || DIR_VEC.rechts;
            var lx = MF.geom.toLocal({ x: 0, y: 0, rot: b.pose.rot }, bv[0], bv[1]).x;
            side = lx > 0.5 ? 1 : lx < -0.5 ? -1 : 0;
          }
          var stroke = Math.max(0, (isNum(p.stroke) ? p.stroke : 400) / 1000);
          b.shape = { type: 'polygon', points: MF.pusherOutline(m(across), m(along), stroke, side), h: MF.PUSHER.H };
          b.pose.z = MF.BELT_TOP + 0.02;
          b.axis.max = stroke;
          b.axis.vmax = isNum(p.speed) && p.speed > 0 ? p.speed : 0.3;
          b.axis.returnDelay = isNum(p.returnDelay) ? p.returnDelay : 0.5;
          break;

        case 'source':
          var sp = spawnPoint(el);
          top = topAt(sp.x, sp.y);
          b.pose.x = m(sp.x);
          b.pose.y = m(sp.y);
          b.pose.z = r6((top === null ? 0 : top) + 0.02);
          b.shape.w = m(el.w);
          b.shape.d = m(el.h);
          b.spawner.interval = isNum(p.interval) && p.interval > 0 ? p.interval : 2;
          b.spawner.maxCount = isNum(p.maxCount) ? p.maxCount : 0;
          b.spawner.enabled = p.enabled !== false;
          break;

        case 'sink':
          b.shape.w = m(el.w);
          b.shape.d = m(el.h);
          break;
      }

      // Gespeicherte Eingänge und Darstellung übernehmen
      MF.initIo(b);
      var inputs = isObject(el.inputs) ? el.inputs : {};
      Object.keys(b.inputs).forEach(function (k) { if (isNum(inputs[k])) b.inputs[k] = inputs[k]; });
      var look = isObject(el.look) ? el.look : {};
      if (typeof look.color === 'string') b.look.color = look.color;
      b.look.visible = look.visible !== false;
      b.look.locked = !!look.locked;
      delete b.rt;
      delete b.force;
      return b;
    });
    delete o.elements;

    var s = isObject(o.settings) ? o.settings : {};
    o.settings = {
      dtMs: isNum(s.dtMs) ? s.dtMs : 50,
      gravity: -9.81,
      snap: { on: true, pos: 0.05, angle: 5 }
    };
    if (isObject(o.view)) o.view.camera3d = null;
    o.version = 3;
  };
})();
