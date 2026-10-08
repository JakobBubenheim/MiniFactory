// Modell: Körper mit Funktionen, Vorlagen (Katalog), Beispielanlage und Store.
//
// Alles, was in der Anlage liegt, ist ein Körper (Idee/Konzept-3D.md, Abschnitt 2):
// Form (shape), Lage (pose), Körperart (kind) und optionale Funktionen
// (surface, axis, sensor, spawner, sink). Die Signale (I/O) hängen an den
// Funktionen, nicht an einer Vorlage – so funktionieren sie später auch bei frei
// gezeichneten Körpern. Der Katalog legt vorkonfigurierte Körper an (template).
//
// Das Modell im Speicher hat dieselbe Form wie das Dateiformat Version 3
// (sim/file.js), dazu Laufzeitdaten, die nie gespeichert werden:
//   rt    – Laufzeit der Funktionen (Achsstellung, Zähler, Entprellung …)
//   force – Ausgänge, deren Wert von Hand festgehalten wird, z. B. { Belegt: 1 }
// Baum, Eigenschaften und Zeichenfläche lesen alle aus diesem einen Zustand.
window.MF = window.MF || {};

// ---------- Werkstoffe und Maße (Konzept, Abschnitt 1) ----------

MF.MATERIALS = {
  box:   { friction: 0.6, restitution: 0, density: 200 },   // 0,3 m Kiste = 5,4 kg
  belt:  { friction: 0.8, restitution: 0, density: 1 },     // nur für die Nachführung der Transportfläche
  steel: { friction: 0.3, restitution: 0, density: 1 },
  slide: { friction: 0.05, restitution: 0, density: 1 },   // Gleitbelag (PE) am Schieber
  floor: { friction: 0.6, restitution: 0, density: 1 },
  ghost: { friction: 0, restitution: 0, density: 1 }
};

MF.BELT_TOP = 0.7;      // Oberkante der Förderbänder (m)
MF.BOX_SIZE = 0.3;      // Kantenlänge der Kisten aus Erzeugern (m)
MF.BOX_COLOR = '#C79A5B';

// Laufrichtungen in der Draufsicht (y nach unten): Grad im Uhrzeigersinn, 0° = rechts
MF.DIRS = { rechts: 0, unten: 90, links: 180, oben: 270 };

// Richtungsname zu einem Winkel, '' wenn es keine der vier Himmelsrichtungen ist
MF.dirName = function (deg) {
  var d = MF.geom.normDeg(deg);
  for (var k in MF.DIRS) if (Math.abs(MF.DIRS[k] - d) < 1e-6) return k;
  return '';
};

// ---------- Funktionen und ihre Signale ----------
//
// io: Signale der Funktion. dir 'in' = Eingang (Regeln/SCL schreiben ihn),
// 'out' = Ausgang (die Engine berechnet ihn). init = Startwert eines Eingangs.
// prop = Eingang ist direkt an ein Feld der Funktion gekoppelt (Tempo -> surface.speed).
MF.FN_KEYS = ['spawner', 'surface', 'sensor', 'axis', 'sink'];   // Reihenfolge der Signale

MF.FUNCTIONS = {
  spawner: {
    label: 'Erzeuger', kinds: ['ghost'],
    io: function () {
      return [
        { name: 'Freigabe', dir: 'in', type: 'BOOL', init: 1 },
        { name: 'Erzeugt', dir: 'out', type: 'INT32' }
      ];
    }
  },
  surface: {
    label: 'Transportfläche', kinds: ['static', 'kinematic'],
    io: function () {
      return [
        { name: 'Ein', dir: 'in', type: 'BOOL', init: 1 },
        { name: 'Läuft', dir: 'out', type: 'BOOL' },
        { name: 'Tempo', dir: 'in', type: 'FLOAT32', prop: 'speed', min: 0, max: 5 }   // Sollwert = Eigenschaft "Tempo"
      ];
    }
  },
  sensor: {
    label: 'Sensor', kinds: ['ghost'],
    io: function () {
      return [{ name: 'Belegt', dir: 'out', type: 'BOOL' }];
    }
  },
  axis: {
    label: 'Achse', kinds: ['kinematic'],
    // Signale je Betriebsart. Phase 2 kennt nur 'zweipunkt' (linear);
    // 'position' und 'geschwindigkeit' sowie rotatorische Achsen folgen in Phase 4.
    MODES: {
      zweipunkt: [
        { name: 'Ausfahren', dir: 'in', type: 'BOOL' },
        { name: 'Ausgefahren', dir: 'out', type: 'BOOL' },
        { name: 'Eingefahren', dir: 'out', type: 'BOOL' },
        { name: 'Ist', dir: 'out', type: 'FLOAT32' }
      ]
    },
    io: function (axis) {
      return (this.MODES[axis.mode] || this.MODES.zweipunkt).map(function (s) {
        var c = {};
        for (var k in s) c[k] = s[k];
        return c;
      });
    }
  },
  sink: {
    label: 'Senke', kinds: ['ghost'],
    io: function () {
      return [
        { name: 'Reset', dir: 'in', type: 'BOOL' },
        { name: 'Anzahl', dir: 'out', type: 'INT32' }
      ];
    }
  }
};

// Alle Signale eines Körpers; jedes Signal kennt seine Funktion (fn)
MF.io = function (body) {
  var out = [];
  MF.FN_KEYS.forEach(function (fn) {
    if (!body[fn]) return;
    MF.FUNCTIONS[fn].io(body[fn]).forEach(function (s) {
      s.fn = fn;
      out.push(s);
    });
  });
  return out;
};

MF.ioDef = function (body, name) {
  var list = MF.io(body);
  for (var i = 0; i < list.length; i++) if (list[i].name === name) return list[i];
  return null;
};

// Eingänge auf ihre Startwerte, keine geforcten Ausgänge.
// inputs: von Hand oder von Regeln geschriebene Eingänge, z. B. { Ein: 1 }
MF.initIo = function (body) {
  body.inputs = {};
  body.force = {};
  MF.io(body).forEach(function (s) {
    if (s.dir === 'in' && !s.prop) body.inputs[s.name] = s.init || 0;
  });
};

// ---------- Vorlagen (Katalog) ----------

// Schieber: kinematischer Stößel mit Platte und kurzem Fangwinkel, in Grundstellung
// (Lage-Drehung 0) schiebt er in +y ("unten"). Lokaler Ursprung = Mitte der Grundfläche.
//   cw, cl  Breite quer zur bzw. Länge in Schubrichtung der Grundfläche (m)
//   stroke  Hub (m) – der Stößel ist so lang, dass er ausgefahren das Band sperrt
//   armSide +1/−1: Fangwinkel auf der Seite +x/−x (Abströmseite des Bands), 0 = keiner
// Der Fangwinkel ragt in Grundstellung 5 cm über die Platte (Bandrand) hinaus und
// hält eine Kiste fest, die das Band sonst seitlich an der Platte vorbeizöge – ein
// langsamer Schieber (0,3 m/s) an einem laufenden Band (0,5 m/s) braucht diesen
// Anschlag, sonst rutscht die Kiste durch (siehe Konzept, Abschnitt 4).
// Ausgefahren sperrt der Stößel das Band für nachfolgende Kisten (wie früher).
MF.PUSHER = { PLATE: 0.8, ARM_T: 0.1, ARM_L: 0.05, H: 0.2 };

MF.pusherOutline = function (cw, cl, stroke, armSide) {
  var P = MF.PUSHER;
  var a = cw / 2, f = cl / 2, back = f - Math.max(stroke + 0.05, 0.2);
  var r = function (v) { return Math.round(v * 1e6) / 1e6; };
  var pts;
  if (!armSide) {
    var pw = P.PLATE * a;
    pts = [[-pw, back], [pw, back], [pw, f], [-pw, f]];
  } else {
    // Platte über die ganze Breite, der Fangwinkel am Rand der Abströmseite
    var inner = a - P.ARM_T * cw;
    pts = [[-a, back], [a, back], [a, f + P.ARM_L], [inner, f + P.ARM_L], [inner, f], [-a, f]];
    if (armSide < 0) pts = pts.map(function (p) { return [-p[0], p[1]]; }).reverse();
  }
  return pts.map(function (p) { return [r(p[0]), r(p[1])]; });
};

// Körper so drehen, dass seine Richtung (lokal dirLocal Grad) in der Welt nach
// worldDeg zeigt. Gedreht wird um die Lage (pose).
MF.turnTo = function (body, dirLocal, worldDeg) {
  body.pose.rot = MF.geom.normDeg(worldDeg - dirLocal);
};

// Richtung eines Vektors [x, y, …] in Grad
MF.vecDeg = function (v) {
  return MF.geom.normDeg(Math.atan2(v[1], v[0]) * 180 / Math.PI);
};

// Eigenschaft der Vorlage: Lesen/Schreiben geht immer über die Funktionen.
// key, label, type … wie das Eigenschaften-Panel sie zeigt; get/set greifen auf den Körper zu.
MF.templates = {
  source: {
    label: 'Quelle', icon: 'i-source', prefix: 'Q', color: '#D9701A',
    make: function () {
      return {
        kind: 'ghost',
        shape: { type: 'rect', w: 0.5, d: 0.5, h: 0.35 },
        pose: { z: MF.BELT_TOP + 0.02 },
        material: MF.MATERIALS.ghost,
        spawner: {
          interval: 2, maxCount: 0, enabled: true,
          template: {
            shape: { type: 'rect', w: MF.BOX_SIZE, d: MF.BOX_SIZE, h: MF.BOX_SIZE },
            material: MF.MATERIALS.box,
            look: { color: MF.BOX_COLOR }
          }
        }
      };
    },
    props: [
      { key: 'enabled', label: 'Aktiv', type: 'bool', hint: 'Erzeugt die Quelle Kisten?', fn: 'spawner', field: 'enabled' },
      { key: 'interval', label: 'Takt', type: 'number', unit: 's', step: 0.1, min: 0.1, max: 60, hint: 'Abstand zwischen zwei Kisten', fn: 'spawner', field: 'interval' },
      { key: 'maxCount', label: 'Max. Anzahl', type: 'number', step: 1, min: 0, hint: '0 = unbegrenzt', fn: 'spawner', field: 'maxCount' }
    ]
  },
  conveyor: {
    label: 'Förderband', icon: 'i-conveyor', prefix: 'B', color: '#1B2430',
    make: function () {
      return {
        kind: 'static',
        shape: { type: 'rect', w: 2, d: 0.5, h: 0.1 },
        pose: { z: MF.BELT_TOP - 0.1 },
        material: MF.MATERIALS.belt,
        surface: { speed: 0.5, dir: 0, running: true }
      };
    },
    props: [
      { key: 'running', label: 'Antrieb', type: 'bool', hint: 'Band ein- oder ausschalten', fn: 'surface', field: 'running' },
      { key: 'speed', label: 'Tempo', type: 'number', unit: 'm/s', step: 0.1, min: 0, max: 5, hint: 'Bandgeschwindigkeit', fn: 'surface', field: 'speed' },
      { key: 'direction', label: 'Richtung', type: 'select', options: ['rechts', 'links', 'oben', 'unten'],
        hint: 'Laufrichtung des Bands; das Band dreht sich mit',
        get: function (b) { return MF.dirName(b.pose.rot + b.surface.dir); },
        set: function (b, v) { if (v in MF.DIRS) MF.turnTo(b, b.surface.dir, MF.DIRS[v]); } }
    ]
  },
  sensor: {
    label: 'Lichtschranke', icon: 'i-sensor', prefix: 'LS', color: '#1B2430',
    make: function () {
      return {
        kind: 'ghost',
        shape: { type: 'rect', w: 0.05, d: 0.5, h: 0.3 },
        pose: { z: MF.BELT_TOP + 0.01 },
        material: MF.MATERIALS.ghost,
        sensor: { invert: false, debounce: 0 }
      };
    },
    props: [
      { key: 'invert', label: 'Invertieren', type: 'bool', onText: 'Ja', offText: 'Nein', hint: 'Meldet "belegt", wenn der Strahl frei ist', fn: 'sensor', field: 'invert' },
      { key: 'debounce', label: 'Entprellzeit', type: 'number', unit: 'ms', step: 10, min: 0, max: 5000, hint: 'Belegt/frei wechselt erst, wenn der Strahl so lange unverändert ist', fn: 'sensor', field: 'debounce' }
    ]
  },
  pusher: {
    label: 'Schieber', icon: 'i-pusher', prefix: 'S', color: '#1B2430',
    make: function () {
      return {
        kind: 'kinematic',
        shape: { type: 'polygon', points: MF.pusherOutline(0.5, 0.5, 0.4, 1), h: MF.PUSHER.H },
        pose: { z: MF.BELT_TOP + 0.02 },
        // Gleitbelag: sonst zieht der einfahrende Stößel eine gestaute Kiste mit zur Seite
        material: MF.MATERIALS.slide,
        axis: { type: 'linear', origin: [0, 0, 0], dir: [0, 1, 0], min: 0, max: 0.4, vmax: 0.3, mode: 'zweipunkt', returnDelay: 0.5 }
      };
    },
    props: [
      { key: 'stroke', label: 'Hub', type: 'number', unit: 'mm', step: 10, min: 0, max: 2000, hint: 'Wie weit der Schieber ausfährt',
        get: function (b) { return Math.round((b.axis.max - b.axis.min) * 1e6) / 1e3; },
        set: function (b, v) { b.axis.max = Math.round((b.axis.min + v / 1000) * 1e6) / 1e6; } },
      { key: 'speed', label: 'Tempo', type: 'number', unit: 'm/s', step: 0.1, min: 0.1, max: 5, hint: 'Ausfahrgeschwindigkeit', fn: 'axis', field: 'vmax' },
      { key: 'returnDelay', label: 'Rückfahrverzug', type: 'number', unit: 's', step: 0.1, min: 0, max: 60, hint: 'Wartezeit vor dem Einfahren', fn: 'axis', field: 'returnDelay' },
      { key: 'direction', label: 'Richtung', type: 'select', options: ['rechts', 'links', 'oben', 'unten'],
        hint: 'Schubrichtung; der Schieber dreht sich mit',
        get: function (b) { return MF.dirName(b.pose.rot + MF.vecDeg(b.axis.dir)); },
        set: function (b, v) { if (v in MF.DIRS) MF.turnTo(b, MF.vecDeg(b.axis.dir), MF.DIRS[v]); } }
    ]
  },
  sink: {
    label: 'Senke', icon: 'i-sink', prefix: 'SE', color: '#1B2430',
    make: function () {
      return {
        kind: 'ghost',
        shape: { type: 'rect', w: 0.5, d: 0.5, h: MF.BELT_TOP - 0.1 },   // etwas tiefer als das Band
        pose: { z: 0 },
        material: MF.MATERIALS.ghost,
        sink: {}
      };
    },
    props: [
      { key: 'count', label: 'Zählerstand', type: 'number', readonly: true, live: true, hint: 'Aufgenommene Kisten',
        get: function (b) { return (b.rt && b.rt.count) || 0; } }
    ]
  }
};

// Symbol im Baum und im Panel: das der Vorlage, sonst ein allgemeiner Körper
MF.bodyIcon = function (body) {
  var t = MF.templates[body.template];
  return t ? t.icon : 'i-body';
};

// Eigenschaften eines Körpers (aus seiner Vorlage); ohne Vorlage keine
MF.propsOf = function (body) {
  var t = MF.templates[body.template];
  return t ? t.props : [];
};

MF.propDef = function (body, key) {
  var list = MF.propsOf(body);
  for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i];
  return null;
};

MF.getProp = function (body, key) {
  var p = MF.propDef(body, key);
  if (!p) return undefined;
  if (p.get) return p.get(body);
  return body[p.fn] ? body[p.fn][p.field] : undefined;
};

MF.setProp = function (body, key, v) {
  var p = MF.propDef(body, key);
  if (!p || p.readonly) return false;
  if (p.set) p.set(body, v);
  else if (body[p.fn]) body[p.fn][p.field] = v;
  return true;
};

// Neuer Körper aus einer Vorlage, Lage (x, y) in Metern. Ohne ID und Namen.
MF.bodyFromTemplate = function (template, x, y) {
  var t = MF.templates[template];
  var d = JSON.parse(JSON.stringify(t.make()));
  var body = {
    id: null, name: null, parent: null, template: template,
    kind: d.kind, shape: d.shape,
    pose: { x: x, y: y, z: d.pose.z, rot: 0 },
    material: d.material
  };
  MF.FN_KEYS.forEach(function (k) { body[k] = d[k] || null; });
  body.look = { color: t.color, visible: true, locked: false };
  body.rt = {};
  MF.initIo(body);
  return body;
};

// ---------- Beispielanlage ----------
//
// Als Version 3 abgelegt (so, wie die Migration die frühere Raster-Beispielanlage
// umrechnet: Zelle 0,5 m). Strukturbaum: folders sind frei anlegbare Ordner.
// Ordner, Körper und Regeln hängen über "parent" an einem Ordner (Ordner-ID) oder
// direkt unter "Anlage" bzw. "Logik" (null). Ordner gehören zu einem Bereich
// (area: 'plant' | 'logic'). Die Reihenfolge der Geschwister ist die Reihenfolge
// in den Arrays; im Baum stehen Ordner vor den Körpern bzw. Regeln derselben Ebene.
MF.model = {
  name: 'Beispielanlage',
  settings: {
    dtMs: 50,                                    // SPS-Zyklus in Millisekunden
    gravity: -9.81,                              // Schwerkraft in m/s² (z nach oben)
    snap: { on: true, pos: 0.05, angle: 5 }      // Fangen: Raster nur als Zeichenhilfe
  },
  folders: [
    { id: 'F1', name: 'Förderstrecke 1', parent: null, area: 'plant' },
    { id: 'F2', name: 'Ausschleusung',   parent: 'F1', area: 'plant' }
  ],
  bodies: [],   // unten aus der Datei-Beschreibung gefüllt
  rules: [
    { id: 'R1', name: 'Regel 1', parent: null, kind: 'rule', when: 'LS1.Belegt', then: 'S1.Ausfahren', enabled: true,
      description: 'Kiste an der Lichtschranke wird nach Senke 2 ausgeschleust.' }
  ]
};

MF.EXAMPLE_BODIES = [
  { id: 'Q1', name: 'Quelle 1', parent: 'F1', template: 'source', kind: 'ghost',
    shape: { type: 'rect', w: 0.5, d: 0.5, h: 0.35 }, pose: { x: 1.75, y: 2.25, z: 0.72, rot: 0 },
    spawner: { interval: 2, maxCount: 0, enabled: true },
    look: { color: '#D9701A' } },
  { id: 'B1', name: 'Förderband 1', parent: 'F1', template: 'conveyor', kind: 'static',
    shape: { type: 'rect', w: 4.5, d: 0.5, h: 0.1 }, pose: { x: 3.75, y: 2.25, z: 0.6, rot: 0 },
    surface: { speed: 0.5, dir: 0, running: true } },
  { id: 'LS1', name: 'Lichtschranke 1', parent: 'F1', template: 'sensor', kind: 'ghost',
    shape: { type: 'rect', w: 0.05, d: 0.5, h: 0.3 }, pose: { x: 4.75, y: 2.25, z: 0.71, rot: 0 },
    sensor: { invert: false, debounce: 0 } },
  { id: 'S1', name: 'Schieber 1', parent: 'F1', template: 'pusher', kind: 'kinematic',
    shape: { type: 'polygon', points: MF.pusherOutline(0.5, 0.5, 0.6, 1), h: MF.PUSHER.H },
    pose: { x: 4.75, y: 1.75, z: 0.72, rot: 0 },
    // 1 m/s statt früher 0,3 m/s: Mit 0,3 m/s braucht ein Schiebetakt 4,5 s, es kommt aber
    // alle 2 s eine Kiste – in echter Physik staut sich dann eine Schlange am Stößel.
    axis: { type: 'linear', origin: [0, 0, 0], dir: [0, 1, 0], min: 0, max: 0.6, vmax: 1, mode: 'zweipunkt', returnDelay: 0.5 } },
  { id: 'SE1', name: 'Senke 1', parent: 'F1', template: 'sink', kind: 'ghost',
    shape: { type: 'rect', w: 0.5, d: 0.5, h: 0.6 }, pose: { x: 6.25, y: 2.25, z: 0, rot: 0 }, sink: {} },
  { id: 'SE2', name: 'Senke 2', parent: 'F2', template: 'sink', kind: 'ghost',
    shape: { type: 'rect', w: 0.5, d: 0.5, h: 0.6 }, pose: { x: 4.75, y: 2.75, z: 0, rot: 0 }, sink: {} }
];

// Fehlende Teile (Werkstoff, Funktionen, Darstellung) aus der Vorlage ergänzen
MF.EXAMPLE_BODIES.forEach(function (src) {
  var b = MF.bodyFromTemplate(src.template, src.pose.x, src.pose.y);
  Object.keys(src).forEach(function (k) {
    if (k === 'look') { b.look.color = src.look.color; return; }
    if (MF.FN_KEYS.indexOf(k) >= 0 && b[k] && src[k]) {
      Object.keys(src[k]).forEach(function (f) { b[k][f] = src[k][f]; });
      return;
    }
    b[k] = JSON.parse(JSON.stringify(src[k]));
  });
  MF.initIo(b);
  MF.model.bodies.push(b);
});
delete MF.EXAMPLE_BODIES;

// ---------- Zentraler Zustand mit einfachem Ereignissystem ----------

MF.store = {
  selectedId: null,
  listeners: [],

  on: function (fn) { this.listeners.push(fn); },

  emit: function (reason) {
    for (var i = 0; i < this.listeners.length; i++) this.listeners[i](reason);
  },

  select: function (id) {
    if (this.selectedId === id) return;
    this.selectedId = id;
    this.emit('select');
  },

  // Nach jeder Änderung am Modell aufrufen, damit alle Ansichten neu zeichnen.
  changed: function () { this.emit('change'); },

  findBody: function (id) {
    var bs = MF.model.bodies;
    for (var i = 0; i < bs.length; i++) if (bs[i].id === id) return bs[i];
    return null;
  },

  findRule: function (id) {
    var rules = MF.model.rules;
    for (var i = 0; i < rules.length; i++) if (rules[i].id === id) return rules[i];
    return null;
  },

  // ---------- Körper anlegen, löschen, duplizieren ----------

  // Nächste freie ID mit Kürzel, z. B. "B" -> "B2". Gibt auch die Nummer zurück.
  nextId: function (prefix) {
    var max = 0;
    var re = new RegExp('^' + prefix + '(\\d+)$');
    MF.model.bodies.forEach(function (b) {
      var m = re.exec(b.id);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return { id: prefix + (max + 1), n: max + 1 };
  },

  // Neuer Körper aus dem Katalog, (x, y) = Mitte in Metern.
  // parent: Ordner-ID oder null (direkt unter "Anlage")
  createBody: function (template, x, y, parent) {
    var t = MF.templates[template];
    var next = this.nextId(t.prefix);
    var b = MF.bodyFromTemplate(template, x, y);
    b.id = next.id;
    b.name = t.label + ' ' + next.n;
    b.parent = parent || null;
    MF.model.bodies.push(b);
    this.selectedId = b.id;
    this.changed();
    return b;
  },

  // Kopie mit neuer ID, 0,5 m versetzt; steht im Baum direkt hinter dem Original
  duplicateBody: function (id) {
    var src = this.findBody(id);
    if (!src) return null;
    var t = MF.templates[src.template];
    var next = this.nextId(t ? t.prefix : 'K');
    var b = JSON.parse(JSON.stringify(src, function (k, v) { return k === 'rt' || k === 'force' ? undefined : v; }));
    b.id = next.id;
    b.name = (t ? t.label : 'Körper') + ' ' + next.n;
    b.pose.x = Math.round((b.pose.x + 0.5) * 1e6) / 1e6;
    b.pose.y = Math.round((b.pose.y + 0.5) * 1e6) / 1e6;
    b.rt = {};
    b.force = {};
    MF.model.bodies.push(b);
    this.placeAfter(MF.model.bodies, b, src);
    this.selectedId = b.id;
    this.changed();
    return b;
  },

  // Körper entfernen. Regeln, die seine Signale benutzen, verlieren den Bezug.
  deleteBody: function (id) {
    var bs = MF.model.bodies;
    var i = bs.indexOf(this.findBody(id));
    if (i < 0) return false;
    bs.splice(i, 1);
    MF.model.rules.forEach(function (r) {
      if (r.when && r.when.indexOf(id + '.') === 0) r.when = '';
      if (r.then && r.then.indexOf(id + '.') === 0) r.then = '';
    });
    if (this.selectedId === id) this.selectedId = null;
    this.changed();
    return true;
  },

  // Neue, leere Regel R<n>; wird ausgewählt, damit das Panel sie zeigt.
  // kind: 'rule' (Wenn-dann) oder 'scl' (eigener Code)
  // parent: Ordner-ID oder null (direkt unter "Logik")
  createRule: function (kind, parent) {
    var max = 0;
    MF.model.rules.forEach(function (r) {
      var m = /^R(\d+)$/.exec(r.id);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    var scl = kind === 'scl';
    var rule = {
      id: 'R' + (max + 1), name: (scl ? 'SCL-Baustein ' : 'Regel ') + (max + 1), parent: parent || null,
      kind: scl ? 'scl' : 'rule', when: '', then: '', enabled: true, description: ''
    };
    if (scl) rule.code = MF.logic.toScl(rule);
    MF.model.rules.push(rule);
    this.selectedId = rule.id;
    this.changed();
    return rule;
  },

  // Kopie einer Regel (gleiche Art, gleicher Code), direkt hinter dem Original
  duplicateRule: function (id) {
    var src = this.findRule(id);
    if (!src) return null;
    var rule = this.createRule(src.kind, src.parent);
    rule.name = src.name + ' (Kopie)';
    rule.when = src.when || '';
    rule.then = src.then || '';
    rule.enabled = src.enabled !== false;
    rule.description = src.description || '';
    if (src.code !== undefined) rule.code = src.code;
    this.placeAfter(MF.model.rules, rule, src);
    this.changed();
    return rule;
  },

  deleteRule: function (id) {
    var rules = MF.model.rules;
    var i = rules.indexOf(this.findRule(id));
    if (i < 0) return false;
    rules.splice(i, 1);
    if (this.selectedId === id) this.selectedId = null;
    this.changed();
    return true;
  },

  // ---------- Strukturbaum: Ordner ----------
  //
  // "parent" ist bewusst allgemein gehalten: heute Ordner-ID oder null, im
  // 3D-Umbau (Phase 4) dürfen dort auch Körper-IDs stehen (Kopplung). Alle
  // Funktionen fragen deshalb über parentOf()/childrenOf() und nicht direkt nach Ordnern.

  AREAS: { plant: 'Anlage', logic: 'Logik' },

  findFolder: function (id) {
    var fs = MF.model.folders || [];
    for (var i = 0; i < fs.length; i++) if (fs[i].id === id) return fs[i];
    return null;
  },

  // Körper bzw. Regeln eines Bereichs
  itemsOf: function (area) {
    return area === 'logic' ? MF.model.rules : MF.model.bodies;
  },

  // Knoten im Baum: { kind: 'folder'|'body'|'rule', obj, area } oder null
  findNode: function (id) {
    var o;
    if ((o = this.findFolder(id))) return { kind: 'folder', obj: o, area: o.area };
    if ((o = this.findBody(id))) return { kind: 'body', obj: o, area: 'plant' };
    if ((o = this.findRule(id))) return { kind: 'rule', obj: o, area: 'logic' };
    return null;
  },

  // Bereich eines Knotens: 'plant', 'logic' oder null (Projekt, unbekannt)
  areaOf: function (id) {
    if (id === 'plant' || id === 'logic') return id;
    var n = this.findNode(id);
    return n ? n.area : null;
  },

  // Gültiger Eltern-Ordner eines Objekts; unbekannte Verweise zählen als oberste Ebene.
  parentOf: function (obj, area) {
    var f = obj && obj.parent ? this.findFolder(obj.parent) : null;
    return f && f.area === area ? f.id : null;
  },

  // Direkte Kinder: { folders: [...], items: [...] } in Array-Reihenfolge
  childrenOf: function (area, parent) {
    var self = this;
    parent = parent || null;
    return {
      folders: (MF.model.folders || []).filter(function (f) {
        return f.area === area && self.parentOf(f, area) === parent;
      }),
      items: this.itemsOf(area).filter(function (o) { return self.parentOf(o, area) === parent; })
    };
  },

  // Körper bzw. Regeln in Baum-Reihenfolge (Tiefensuche: erst die Ordner einer
  // Ebene mit ihrem ganzen Inhalt, dann die Körper/Regeln dieser Ebene).
  // folder: nur den Inhalt dieses Ordners (samt Unterordnern) liefern.
  treeOrder: function (area, folder) {
    var self = this, out = [], seen = {};
    (function walk(parent) {
      if (seen[parent]) return;   // Schutz vor Zyklen in kaputten Daten
      seen[parent] = true;
      var c = self.childrenOf(area, parent);
      c.folders.forEach(function (f) { walk(f.id); });
      c.items.forEach(function (o) { out.push(o); });
    })(folder || null);
    return out;
  },

  // Ist id gleich ancestor oder liegt darunter?
  isWithin: function (id, ancestor) {
    var guard = 0;
    while (id && guard++ < 1000) {
      if (id === ancestor) return true;
      var n = this.findNode(id);
      id = n ? n.obj.parent : null;
    }
    return false;
  },

  // Namen der Ordner von oben bis einschließlich parent, z. B. ['Förderstrecke 1', 'Ausschleusung']
  folderPath: function (parent) {
    var names = [], guard = 0;
    var f = this.findFolder(parent);
    while (f && guard++ < 1000) {
      names.unshift(f.name);
      f = this.findFolder(this.parentOf(f, f.area));
    }
    return names;
  },

  // Alle Ordner eines Bereichs in Baum-Reihenfolge mit Pfad und Tiefe (für Auswahllisten)
  folderList: function (area) {
    var self = this, out = [];
    (function walk(parent, depth) {
      self.childrenOf(area, parent).folders.forEach(function (f) {
        if (out.some(function (o) { return o.folder === f; })) return;
        out.push({ folder: f, path: self.folderPath(f.id).join(' / '), depth: depth });
        walk(f.id, depth + 1);
      });
    })(null, 0);
    return out;
  },

  nextFolderId: function () {
    var max = 0;
    (MF.model.folders || []).forEach(function (f) {
      var m = /^F(\d+)$/.exec(f.id);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return 'F' + (max + 1);
  },

  // Neuer Ordner im Bereich area unter parent (Ordner-ID oder null)
  createFolder: function (area, parent, name) {
    if (!MF.model.folders) MF.model.folders = [];
    var f = { id: this.nextFolderId(), name: name || 'Neuer Ordner', parent: parent || null, area: area };
    MF.model.folders.push(f);
    this.selectedId = f.id;
    this.changed();
    return f;
  },

  // Ordner löschen: Inhalt wandert eine Ebene nach oben, an die Stelle des Ordners.
  deleteFolder: function (id) {
    var fs = MF.model.folders;
    var f = this.findFolder(id);
    if (!f) return false;
    var up = this.parentOf(f, f.area);
    var i = fs.indexOf(f);
    var subs = fs.filter(function (s) { return s.parent === id; });
    fs.splice(i, 1);
    // Unterordner an die Stelle des gelöschten Ordners
    subs.forEach(function (s) { fs.splice(fs.indexOf(s), 1); });
    Array.prototype.splice.apply(fs, [i, 0].concat(subs));
    subs.forEach(function (s) { s.parent = up; });
    this.itemsOf(f.area).forEach(function (o) { if (o.parent === id) o.parent = up; });
    if (this.selectedId === id) this.selectedId = up || f.area;
    this.changed();
    return true;
  },

  // obj im Array direkt hinter ref einsortieren
  placeAfter: function (arr, obj, ref) {
    arr.splice(arr.indexOf(obj), 1);
    arr.splice(arr.indexOf(ref) + 1, 0, obj);
  },

  // Darf der Knoten id nach parent (im Bereich area) verschoben werden?
  // Gibt einen Fehlertext zurück oder '' wenn erlaubt.
  moveError: function (id, area, parent) {
    var n = this.findNode(id);
    if (!n) return 'Unbekannter Knoten.';
    if (n.area !== area) return 'Nur innerhalb von "' + this.AREAS[n.area] + '" verschiebbar.';
    if (parent) {
      var p = this.findFolder(parent);
      if (!p || p.area !== area) return 'Ziel ist kein Ordner in "' + this.AREAS[area] + '".';
      if (n.kind === 'folder' && this.isWithin(parent, id)) return 'Ein Ordner kann nicht in sich selbst liegen.';
    }
    return '';
  },

  // Knoten nach parent verschieben, vor den Geschwister-Knoten beforeId (null = ans Ende).
  // Ordner werden unter den Ordnern, Körper/Regeln unter ihresgleichen einsortiert.
  // ids in Baum-Reihenfolge übergeben, damit die Reihenfolge erhalten bleibt.
  // Gibt die Anzahl verschobener Knoten zurück; ändert nichts, wenn einer unzulässig ist.
  moveNodes: function (ids, area, parent, beforeId) {
    var self = this;
    parent = parent || null;
    for (var i = 0; i < ids.length; i++) {
      var err = this.moveError(ids[i], area, parent);
      if (err) { if (MF.ui) MF.ui.message(err); return 0; }
    }
    var nodes = ids.map(function (id) { return self.findNode(id); });
    nodes.forEach(function (n) {
      var arr = n.kind === 'folder' ? MF.model.folders : self.itemsOf(area);
      arr.splice(arr.indexOf(n.obj), 1);
      n.obj.parent = parent;
    });
    nodes.forEach(function (n) {
      var arr = n.kind === 'folder' ? MF.model.folders : self.itemsOf(area);
      var before = beforeId && ids.indexOf(beforeId) < 0 ? self.findNode(beforeId) : null;
      if (before && before.kind === n.kind && arr.indexOf(before.obj) >= 0) {
        arr.splice(arr.indexOf(before.obj), 0, n.obj);
        return;
      }
      // Ans Ende der Geschwister: hinter das letzte Geschwister, sonst ans Array-Ende
      var last = -1;
      arr.forEach(function (o, k) { if (o !== n.obj && self.parentOf(o, area) === parent) last = k; });
      if (last < 0) arr.push(n.obj);
      else arr.splice(last + 1, 0, n.obj);
    });
    this.changed();
    return nodes.length;
  },

  // Liste aller Signale, z. B. "LS1.Belegt", für die Regel-Auswahl.
  signals: function (dir) {
    var out = [];
    MF.model.bodies.forEach(function (b) {
      MF.io(b).forEach(function (s) {
        if (!dir || s.dir === dir) out.push(b.id + '.' + s.name);
      });
    });
    return out;
  }
};
