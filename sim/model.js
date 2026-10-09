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
  ghost: { friction: 0, restitution: 0, density: 1 },
  body:  { friction: 0.5, restitution: 0, density: 500 }    // frei gezeichnete Körper (Holz/Kunststoff)
};

// Frei gezeichnete Körper (Phase 3): Kürzel, Name, Farbe, Standardhöhe
MF.BODY = { prefix: 'K', label: 'Körper', color: '#3A7CA5', H: 0.1 };

MF.BELT_TOP = 0.7;      // Oberkante der Förderbänder (m)
MF.BOX_SIZE = 0.3;      // Kantenlänge der Standard-Kiste (Produkt neuer Quellen, m)
MF.BOX_COLOR = '#C79A5B';

// ---------- Produkt eines Erzeugers ----------
//
// Jeder Erzeuger hat genau einen Produkt-Körper: die Vorlage der Teile, die er
// erzeugt (Idee/Konzept-3D.md, Abschnitt 3, "Produkt"). Er ist ein normaler Körper
// (Form, Höhe, Werkstoff, Farbe; Körperart immer dynamic, keine Funktionen) und
// hängt im Baum unter dem Erzeuger:
//   source.spawner.product = ID des Produkts, product.parent = ID des Erzeugers.
// Seine Lage ist relativ zum Erzeuger – dort erscheinen die Teile, seine Drehung um z
// ist ihre Startdrehung. Er simuliert nicht mit (keine Kollision, keine Schwerkraft),
// ist keine Kopplung und lässt sich nicht einzeln löschen oder umhängen.
MF.PRODUCT = { prefix: 'P', label: 'Produkt' };

// Standard-Produkt: Kiste 0,3 m, 200 kg/m³ (5,4 kg) – so sahen die Kisten bisher aus
MF.defaultProduct = function () {
  return {
    shape: { type: 'rect', w: MF.BOX_SIZE, d: MF.BOX_SIZE, h: MF.BOX_SIZE },
    material: { friction: MF.MATERIALS.box.friction, restitution: MF.MATERIALS.box.restitution, density: MF.MATERIALS.box.density },
    look: { color: MF.BOX_COLOR }
  };
};

// Ist b das Produkt eines Erzeugers?
MF.isProduct = function (b) {
  var p = MF.parentBody(b);
  return !!(p && p.spawner && p.spawner.product === b.id);
};

// Produkt-Körper eines Erzeugers oder null
MF.productOf = function (src) {
  if (!src || !src.spawner || !src.spawner.product) return null;
  var p = MF.store.findBody(src.spawner.product);
  return p && p.parent === src.id ? p : null;
};

// Erzeuger, zu dem ein Produkt gehört, oder null
MF.sourceOf = function (b) {
  return MF.isProduct(b) ? MF.parentBody(b) : null;
};

// Fehlende Produkte anlegen – für jeden Erzeuger in bodies (Modell oder Datei-
// inhalt) ohne gültiges Produkt. Aus der früheren Kistenvorlage spawner.template
// (Dateien bis 09.10.2026), sonst die Standard-Kiste; template entfällt danach.
// Das Produkt steht in der Liste direkt hinter seinem Erzeuger.
// Gibt die neu angelegten Produkte zurück.
MF.ensureProducts = function (bodies) {
  var ids = {}, made = [];
  bodies.forEach(function (b) { if (b && b.id) ids[b.id] = b; });
  function nextId() {
    var max = 0;
    Object.keys(ids).forEach(function (id) {
      var m = /^P(\d+)$/.exec(id);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return MF.PRODUCT.prefix + (max + 1);
  }
  bodies.slice().forEach(function (b) {
    var sp = b && b.spawner;
    if (!sp || typeof sp !== 'object') return;
    var tpl = sp.template;
    delete sp.template;
    var cur = typeof sp.product === 'string' ? ids[sp.product] : null;
    if (cur && cur.parent === b.id) return;
    var spec = MF.defaultProduct();
    if (tpl && typeof tpl === 'object') {
      if (tpl.shape && typeof tpl.shape === 'object') spec.shape = JSON.parse(JSON.stringify(tpl.shape));
      if (tpl.material && typeof tpl.material === 'object') spec.material = JSON.parse(JSON.stringify(tpl.material));
      if (tpl.look && typeof tpl.look.color === 'string') spec.look.color = tpl.look.color;
    }
    var p = MF.productBody(b, spec, nextId());
    ids[p.id] = p;
    sp.product = p.id;
    bodies.splice(bodies.indexOf(b) + 1, 0, p);
    made.push(p);
  });
  return made;
};

// Masse eines Teils in kg: Grundfläche × Höhe × Dichte
MF.productMass = function (p) {
  var d = p.material && p.material.density >= 0 ? p.material.density : MF.MATERIALS.box.density;
  return MF.geom.area(p.shape) * p.shape.h * d;
};

// Produkt-Körper für den Erzeuger src nach spec { shape, material, look }
MF.productBody = function (src, spec, id) {
  var p = {
    id: id, name: MF.PRODUCT.label + ' ' + src.id, parent: src.id, template: null,
    kind: 'dynamic',
    shape: JSON.parse(JSON.stringify(spec.shape)),
    pose: { x: 0, y: 0, z: 0, rot: 0 },
    material: JSON.parse(JSON.stringify(spec.material))
  };
  MF.FN_KEYS.forEach(function (k) { p[k] = null; });
  p.inputs = {};
  p.look = { color: spec.look.color, visible: true, locked: false };
  p.rt = {};
  p.force = {};
  return p;
};

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
    // product: ID des Produkt-Körpers, der im Baum unter dem Erzeuger hängt – die
    // Vorlage der erzeugten Teile (Form, Höhe, Werkstoff, Farbe). Angelegt wird er
    // vom Store (MF.store.addProduct), sobald der Erzeuger in der Anlage ist.
    make: function () {
      return { interval: 2, maxCount: 0, enabled: true, product: null };
    },
    fields: [
      { key: 'enabled', label: 'Aktiv', type: 'bool', hint: 'Erzeugt der Erzeuger Teile?', field: 'enabled' },
      { key: 'interval', label: 'Takt', type: 'number', unit: 's', step: 0.1, min: 0.1, max: 60, hint: 'Abstand zwischen zwei Teilen', field: 'interval' },
      { key: 'maxCount', label: 'Max. Anzahl', type: 'number', step: 1, min: 0, hint: '0 = unbegrenzt', field: 'maxCount' }
    ],
    io: function () {
      return [
        { name: 'Freigabe', dir: 'in', type: 'BOOL', init: 1 },
        { name: 'Erzeugt', dir: 'out', type: 'INT32' }
      ];
    }
  },
  surface: {
    label: 'Transportfläche', kinds: ['static', 'kinematic'],
    make: function () { return { speed: 0.5, dir: 0, running: true }; },
    fields: [
      { key: 'running', label: 'Antrieb', type: 'bool', hint: 'Transportfläche ein- oder ausschalten', field: 'running' },
      { key: 'speed', label: 'Tempo', type: 'number', unit: 'm/s', step: 0.1, min: 0, max: 5, hint: 'Geschwindigkeit der Oberseite', field: 'speed' },
      { key: 'dir', label: 'Laufrichtung', type: 'number', unit: '°', step: 5, min: 0, max: 359.9,
        hint: 'Lokal zum Körper: 0° = lokal +x, 90° = lokal +y (dreht mit dem Körper)',
        get: function (f) { return f.dir; }, set: function (f, v) { f.dir = MF.geom.normDeg(v); } }
    ],
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
    make: function () { return { invert: false, debounce: 0 }; },
    fields: [
      { key: 'invert', label: 'Invertieren', type: 'bool', onText: 'Ja', offText: 'Nein', hint: 'Meldet "belegt", wenn die Fläche frei ist', field: 'invert' },
      { key: 'debounce', label: 'Entprellzeit', type: 'number', unit: 'ms', step: 10, min: 0, max: 5000, hint: 'Belegt/frei wechselt erst, wenn der Zustand so lange unverändert ist', field: 'debounce' }
    ],
    io: function () {
      return [{ name: 'Belegt', dir: 'out', type: 'BOOL' }];
    }
  },
  axis: {
    label: 'Achse', kinds: ['kinematic'],
    // Linear (Werte in m) oder rotatorisch um die Hochachse (Werte in Grad), mit
    // Grenzen min/max, Höchstgeschwindigkeit vmax und einer Betriebsart (Konzept,
    // Abschnitt 2). origin und dir sind lokal zum Körper. Linear verschiebt den
    // Körper um Stellung · dir; rotatorisch dreht er sich um origin (dir = [0, 0, ±1]).
    make: function () {
      return { type: 'linear', origin: [0, 0, 0], dir: [0, 1, 0], min: 0, max: 0.4, vmax: 0.3, mode: 'zweipunkt', valve: 'mono', returnDelay: 0.5 };
    },
    // Felder im Eigenschaften-Panel. Werte, die von der Achse abhängen (Einheit,
    // Schritt, Grenzen), sind Funktionen der Achse; when blendet Felder aus.
    // MF.fieldsOf('axis', achse) löst das auf. core: auch bei Vorlagen zeigen,
    // die für diese Funktion eigene Eigenschaften haben (z. B. Schieber).
    fields: [
      { key: 'type', label: 'Typ', type: 'select', core: true,
        options: [{ value: 'linear', label: 'linear (m)' }, { value: 'rotary', label: 'rotatorisch (°)' }],
        hint: 'Linear: fährt entlang der Richtung (Meter). Rotatorisch: dreht um die Hochachse durch den Ursprung (Grad)',
        get: function (f) { return f.type; }, set: function (f, v) { MF.setAxisType(f, v); } },
      { key: 'mode', label: 'Betriebsart', type: 'select', core: true,
        options: function () {
          return Object.keys(MF.FUNCTIONS.axis.MODES).map(function (m) { return { value: m, label: MF.FUNCTIONS.axis.MODE_LABELS[m] }; });
        },
        hint: 'Zweipunkt: Ausfahren = 1 fährt nach max, sonst nach min · Position: fährt auf Soll, solange Freigabe = 1 · ' +
          'Geschwindigkeit: fährt mit Soll (m/s bzw. °/s), solange Freigabe = 1. Die Signale passen sich an',
        get: function (f) { return f.mode; }, set: function (f, v) { if (MF.FUNCTIONS.axis.MODES[v]) f.mode = v; } },
      { key: 'valve', label: 'Ventil', type: 'select', core: true,
        options: [{ value: 'mono', label: 'ein Eingang' }, { value: 'bi', label: 'zwei Eingänge' }],
        when: function (f) { return f.mode === 'zweipunkt'; },
        hint: 'Ein Eingang: Ausfahren = 1 fährt aus, 0 fährt nach dem Rückfahrverzug ein. ' +
          'Zwei Eingänge (wie ein Ventil mit zwei Spulen): Ausfahren = 1 fährt aus, Einfahren = 1 fährt ein, ' +
          'sind beide 0 (oder beide 1), bleibt die Achse, wie sie zuletzt geschaltet wurde',
        get: function (f) { return f.valve === 'bi' ? 'bi' : 'mono'; },
        set: function (f, v) { if (MF.AXIS.VALVES.indexOf(v) >= 0) f.valve = v; } },
      { key: 'axisDir', label: 'Richtung', type: 'select', options: ['rechts', 'unten', 'links', 'oben', 'hoch', 'runter'],
        when: function (f) { return f.type !== 'rotary'; },
        hint: 'Fahrrichtung lokal zum Körper (dreht mit dem Körper); hoch/runter = senkrecht (z)',
        get: function (f) { return MF.axisDirName(f.dir); },
        set: function (f, v) { var d = MF.axisDirVec(v); if (d) f.dir = d; } },
      { key: 'turn', label: 'Drehsinn', type: 'select', options: ['Uhrzeigersinn', 'Gegenuhrzeigersinn'],
        when: function (f) { return f.type === 'rotary'; },
        hint: 'In der Draufsicht: positive Stellung dreht im bzw. gegen den Uhrzeigersinn',
        get: function (f) { return f.dir[2] < 0 ? 'Gegenuhrzeigersinn' : 'Uhrzeigersinn'; },
        set: function (f, v) { f.dir = [0, 0, v === 'Gegenuhrzeigersinn' ? -1 : 1]; } },
      { key: 'min', label: 'Grenze min', type: 'number',
        unit: function (f) { return MF.axisUnit(f).pos; }, step: function (f) { return f.type === 'rotary' ? 5 : 0.05; },
        min: function (f) { return f.type === 'rotary' ? -720 : -10; }, max: function (f) { return f.type === 'rotary' ? 720 : 10; },
        hint: 'Kleinste Stellung; zweipunkt: Stellung "eingefahren"',
        get: function (f) { return f.min; }, set: function (f, v) { f.min = v; if (f.max < v) f.max = v; } },
      { key: 'max', label: 'Grenze max', type: 'number',
        unit: function (f) { return MF.axisUnit(f).pos; }, step: function (f) { return f.type === 'rotary' ? 5 : 0.05; },
        min: function (f) { return f.type === 'rotary' ? -720 : -10; }, max: function (f) { return f.type === 'rotary' ? 720 : 10; },
        hint: 'Größte Stellung; zweipunkt: Stellung "ausgefahren"',
        get: function (f) { return f.max; }, set: function (f, v) { f.max = v; if (f.min > v) f.min = v; } },
      { key: 'vmax', label: 'Tempo', type: 'number',
        unit: function (f) { return MF.axisUnit(f).speed; }, step: function (f) { return f.type === 'rotary' ? 5 : 0.1; },
        min: 0.01, max: function (f) { return f.type === 'rotary' ? 1080 : 5; },
        hint: 'Höchstgeschwindigkeit (gilt in jeder Betriebsart)', field: 'vmax' },
      { key: 'returnDelay', label: 'Rückfahrverzug', type: 'number', unit: 's', step: 0.1, min: 0, max: 60,
        when: function (f) { return f.mode === 'zweipunkt' && f.valve !== 'bi'; },
        hint: 'Wartezeit vor dem Einfahren, wenn Ausfahren auf 0 geht (zweipunkt, ein Eingang)', field: 'returnDelay' },
      { key: 'pos', label: 'Stellung', type: 'number', readonly: true, live: true, body: true,
        unit: function (b) { return MF.axisUnit(b.axis).pos; },
        hint: 'Aktuelle Stellung der Achse (Signal Ist)',
        get: function (b) { return Math.round(MF.axisPos(b) * 1000) / 1000; } }
    ],
    // Signale je Betriebsart (Konzept, Abschnitt 2). Werte linear in m bzw. m/s,
    // rotatorisch in Grad bzw. °/s.
    MODES: {
      zweipunkt: [
        { name: 'Ausfahren', dir: 'in', type: 'BOOL' },
        { name: 'Ausgefahren', dir: 'out', type: 'BOOL' },
        { name: 'Eingefahren', dir: 'out', type: 'BOOL' },
        { name: 'Ist', dir: 'out', type: 'FLOAT32' }
      ],
      position: [
        { name: 'Soll', dir: 'in', type: 'FLOAT32' },
        { name: 'Freigabe', dir: 'in', type: 'BOOL' },
        { name: 'Ist', dir: 'out', type: 'FLOAT32' },
        { name: 'InPosition', dir: 'out', type: 'BOOL' }
      ],
      geschwindigkeit: [
        { name: 'Soll', dir: 'in', type: 'FLOAT32' },
        { name: 'Freigabe', dir: 'in', type: 'BOOL' },
        { name: 'Ist', dir: 'out', type: 'FLOAT32' }
      ]
    },
    MODE_LABELS: { zweipunkt: 'Zweipunkt', position: 'Position', geschwindigkeit: 'Geschwindigkeit' },
    // Wovon die Signale abhängen (Zwischenspeicher in MF.ioDef)
    ioKey: function (axis) { return axis.mode + '|' + axis.valve; },
    // Ventil mit zwei Eingängen (valve = 'bi', nur zweipunkt): zusätzlich Einfahren
    io: function (axis) {
      var list = (this.MODES[axis.mode] || this.MODES.zweipunkt).map(function (s) {
        var c = {};
        for (var k in s) c[k] = s[k];
        return c;
      });
      if (axis.mode === 'zweipunkt' && axis.valve === 'bi') list.splice(1, 0, { name: 'Einfahren', dir: 'in', type: 'BOOL' });
      return list;
    }
  },
  sink: {
    label: 'Senke', kinds: ['ghost'],
    make: function () { return {}; },
    fields: [
      { key: 'count', label: 'Zählerstand', type: 'number', readonly: true, live: true, hint: 'Aufgenommene Teile',
        body: true, get: function (b) { return (b.rt && b.rt.count) || 0; } }
    ],
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

// Ein Signal eines Körpers nach Namen (wie in MF.io), sonst null. Die Engine
// fragt das in jedem Zyklus sehr oft; die Signale einer Funktion hängen nur von
// ihrer Art ab (bei der Achse von Betriebsart und Ventil, ioKey), darum stehen
// sie fertig in IO_CACHE. Das Ergebnis ist eingefroren – nur lesen.
MF.IO_CACHE = {};
MF.ioDef = function (body, name) {
  for (var i = 0; i < MF.FN_KEYS.length; i++) {
    var fn = MF.FN_KEYS[i], f = body[fn];
    if (!f) continue;
    var F = MF.FUNCTIONS[fn], key = fn + '|' + (F.ioKey ? F.ioKey(f) : '');
    var map = MF.IO_CACHE[key];
    if (!map) {
      map = MF.IO_CACHE[key] = {};
      F.io(f).forEach(function (s) {
        s.fn = fn;
        if (!Object.prototype.hasOwnProperty.call(map, s.name)) map[s.name] = Object.freeze(s);
      });
    }
    if (Object.prototype.hasOwnProperty.call(map, name)) return map[name];
  }
  return null;
};

// Felder einer Funktion, wie das Eigenschaften-Panel sie zeigt: ausgeblendete
// (when) fallen weg, Werte als Funktion (Einheit, Schritt, Grenzen, Auswahl)
// werden für diesen Körper ausgerechnet. get/set bleiben Funktionen.
MF.fieldsOf = function (body, fn) {
  var f = body[fn];
  if (!f) return [];
  return MF.FUNCTIONS[fn].fields.filter(function (d) { return !d.when || d.when(f); }).map(function (d) {
    var c = {};
    for (var k in d) {
      c[k] = typeof d[k] === 'function' && k !== 'get' && k !== 'set' && k !== 'when' ? d[k](d.body ? body : f) : d[k];
    }
    return c;
  });
};

// Wert eines Funktionsfelds lesen bzw. schreiben (wie das Panel). Ändern sich
// dabei die Signale (z. B. Betriebsart), werden sie angeglichen; Regeln auf
// weggefallene Signale verlieren den Bezug. Gibt false zurück, wenn es das Feld
// nicht gibt oder es nur lesbar ist.
MF.getField = function (body, fn, key) {
  var d = MF.fieldsOf(body, fn).filter(function (x) { return x.key === key; })[0];
  if (!d) return undefined;
  return d.get ? d.get(d.body ? body : body[fn]) : body[fn][d.field];
};

MF.setField = function (body, fn, key, v) {
  var d = MF.fieldsOf(body, fn).filter(function (x) { return x.key === key; })[0];
  if (!d || d.readonly) return false;
  var before = MF.io(body).map(function (s) { return s.name; });
  if (d.set) d.set(body[fn], v);
  else body[fn][d.field] = v;
  MF.store.dropSignals(body.id, MF.syncIo(body, before));
  return true;
};

// ---------- Achse (Konzept, Abschnitt 2) ----------
//
// Stellung: linear in m, rotatorisch in Grad. Die Laufzeit (rt.pos) rechnet die
// Engine; hier stehen die reinen Rechnungen, die Engine, Draufsicht, 3D-Ansicht
// und Editor teilen.

MF.AXIS = {
  TOL: { linear: 0.001, rotary: 0.1 },   // InPosition: |Ist − Soll| höchstens so groß (1 mm bzw. 0,1°)
  VALVES: ['mono', 'bi'],                // zweipunkt: ein Eingang (Standard, fehlt in alten Dateien) oder zwei
  DEFAULTS: {
    linear: { dir: [0, 1, 0], min: 0, max: 0.4, vmax: 0.3 },
    rotary: { dir: [0, 0, 1], min: 0, max: 90, vmax: 45 }
  }
};

MF.axisUnit = function (ax) {
  return ax && ax.type === 'rotary' ? { pos: '°', speed: '°/s' } : { pos: 'm', speed: 'm/s' };
};

// Typ wechseln: Richtung, Grenzen und Tempo auf sinnvolle Werte des neuen Typs
MF.setAxisType = function (ax, type) {
  var d = MF.AXIS.DEFAULTS[type];
  if (!d || ax.type === type) return;
  ax.type = type;
  ax.dir = d.dir.slice();
  ax.min = d.min;
  ax.max = d.max;
  ax.vmax = d.vmax;
};

// Richtung einer linearen Achse als Name (rechts, unten, links, oben, hoch, runter)
MF.axisDirName = function (dir) {
  var len = Math.sqrt(dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]) || 1;
  if (Math.abs(dir[2]) / len > 0.999) return dir[2] > 0 ? 'hoch' : 'runter';
  if (Math.abs(dir[2]) > 1e-9) return '';
  return MF.dirName(MF.vecDeg(dir));
};

MF.axisDirVec = function (name) {
  if (name === 'hoch') return [0, 0, 1];
  if (name === 'runter') return [0, 0, -1];
  if (!(name in MF.DIRS)) return null;
  var d = MF.geom.dirVec(MF.DIRS[name]);
  return [d.x, d.y, 0];
};

// Grundstellung nach Reset: zweipunkt eingefahren (min), sonst 0 (innerhalb der Grenzen)
MF.axisHome = function (ax) {
  return ax.mode === 'zweipunkt' ? ax.min : Math.max(ax.min, Math.min(ax.max, 0));
};

// Aktuelle Stellung (aus der Laufzeit der Engine, sonst Grundstellung)
MF.axisPos = function (b) {
  var rt = b.rt || {};
  return rt.pos !== undefined && rt.axisType === b.axis.type ? rt.pos : MF.axisHome(b.axis);
};

// Hat der Körper eine Achse, die ihn bewegt?
MF.hasAxis = function (b) {
  return !!b.axis && b.kind === 'kinematic';
};

// Lage pose (relativ zum Eltern), verschoben bzw. gedreht um die Achsstellung s
MF.axisMoved = function (pose, ax, s) {
  var d = ax.dir;
  if (ax.type === 'rotary') {
    // um origin drehen: lokaler Punkt l -> origin + R(θ)·(l − origin), hier für l = 0
    var th = (d[2] < 0 ? -s : s), a = MF.geom.rad(th), c = Math.cos(a), sn = Math.sin(a);
    var ox = ax.origin[0], oy = ax.origin[1];
    var w = MF.geom.toWorld(pose, ox - (ox * c - oy * sn), oy - (ox * sn + oy * c));
    return { x: w.x, y: w.y, z: pose.z, rot: pose.rot + th };
  }
  var len = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]) || 1;
  var o = MF.geom.toWorld({ x: 0, y: 0, rot: pose.rot }, d[0] / len * s, d[1] / len * s);
  return { x: pose.x + o.x, y: pose.y + o.y, z: pose.z + d[2] / len * s, rot: pose.rot };
};

// ---------- Kopplung über den Strukturbaum (Konzept, Abschnitt 2) ----------
//
// Ein Körper kann einen Körper als Eltern haben (parent = Körper-ID). Seine Lage
// ist dann relativ zur aktuellen Lage des Elternkörpers (mit dessen Achse), er
// bewegt sich mit. Ordner haben keine Lage. Höchstens zwei Ebenen: ein Körper,
// der an einem Körper hängt, trägt selbst keine Körper (Konzept, Abschnitt 6).

MF.COUPLE_DEPTH = 2;

// Eltern-Körper oder null (Ordner und unbekannte Verweise zählen nicht)
MF.parentBody = function (b) {
  if (!b || !b.parent) return null;
  var p = MF.store.findBody(b.parent);
  return p && p !== b ? p : null;
};

// Körper, die direkt an b hängen (Kopplung; das Produkt eines Erzeugers zählt nicht)
MF.childBodies = function (b) {
  var prod = b.spawner && b.spawner.product;
  return MF.model.bodies.filter(function (c) { return c !== b && c.parent === b.id && c.id !== prod; });
};

// Lage local im Koordinatensystem frame -> Welt
MF.composePose = function (frame, local) {
  var w = MF.geom.toWorld(frame, local.x, local.y);
  return { x: w.x, y: w.y, z: frame.z + local.z, rot: frame.rot + local.rot };
};

// Weltlage world -> relativ zu frame (auf µm bzw. 1e-6° gerundet)
MF.relativePose = function (frame, world) {
  var l = MF.geom.toLocal(frame, world.x, world.y), r = MF.geom.round6;
  return { x: r(l.x), y: r(l.y), z: r(world.z - frame.z), rot: MF.geom.normDeg(world.rot - frame.rot) };
};

MF.WORLD = { x: 0, y: 0, z: 0, rot: 0 };

// Lage eines Körpers in der Welt mit allen Achsstellungen und Kopplungen.
// posOf(b) liefert die Achsstellung eines Körpers (Standard: MF.axisPos).
// Ohne Kopplung und Achse ist das die gezeichnete Lage (b.pose selbst).
MF.poseInWorld = function (b, posOf, depth) {
  posOf = posOf || MF.axisPos;
  var local = MF.hasAxis(b) ? MF.axisMoved(b.pose, b.axis, posOf(b)) : b.pose;
  var p = MF.parentBody(b);
  if (!p || (depth || 0) > MF.COUPLE_DEPTH) return local;
  return MF.composePose(MF.poseInWorld(p, posOf, (depth || 0) + 1), local);
};

// Koordinatensystem, in dem b.pose gilt: Lage des Elternkörpers oder die Welt
MF.parentFrame = function (b, posOf) {
  var p = MF.parentBody(b);
  return p ? MF.poseInWorld(p, posOf) : MF.WORLD;
};

// Lage in der Welt ohne die eigene Achsstellung (Achse in Stellung 0)
MF.restPose = function (b, posOf) {
  var p = MF.parentBody(b);
  return p ? MF.composePose(MF.parentFrame(b, posOf), b.pose) : b.pose;
};

// Bewegt sich der Körper in der Simulation? (eigene Achse oder an einem Körper)
MF.isMoving = function (b) {
  return b.kind !== 'dynamic' && (MF.hasAxis(b) || !!MF.parentBody(b));
};

// Fehlertext, wenn die Achse so nicht gültig ist, sonst ''
MF.axisError = function (ax) {
  function num(v) { return typeof v === 'number' && isFinite(v); }
  if (ax.type !== 'linear' && ax.type !== 'rotary') return 'Achstyp muss "linear" oder "rotary" sein.';
  if (!MF.FUNCTIONS.axis.MODES[ax.mode]) return 'Unbekannte Betriebsart "' + ax.mode + '".';
  if (!(num(ax.min) && num(ax.max) && num(ax.vmax) && num(ax.returnDelay))) return 'min, max, vmax und returnDelay müssen Zahlen sein.';
  if (ax.max < ax.min) return 'Grenze max ist kleiner als min.';
  if (ax.vmax <= 0) return 'Tempo (vmax) muss größer als 0 sein.';
  if (ax.returnDelay < 0) return 'Rückfahrverzug darf nicht negativ sein.';
  if (ax.valve !== undefined && MF.AXIS.VALVES.indexOf(ax.valve) < 0) return 'Ventil muss "mono" oder "bi" sein.';
  var vec = function (v) { return Array.isArray(v) && v.length === 3 && v.every(num); };
  if (!vec(ax.origin) || !vec(ax.dir)) return 'Ursprung und Richtung müssen [x, y, z] sein.';
  var d = ax.dir;
  if (Math.abs(d[0]) + Math.abs(d[1]) + Math.abs(d[2]) < 1e-9) return 'Die Achsrichtung ist null.';
  if (ax.type === 'rotary' && (Math.abs(d[0]) > 1e-9 || Math.abs(d[1]) > 1e-9)) {
    return 'Drehachsen gibt es nur um die Hochachse (Richtung [0, 0, 1] oder [0, 0, −1]); Kippen folgt später.';
  }
  return '';
};

// Achse ändern: changes mit type, mode, valve, origin, dir, min, max, vmax, returnDelay.
// Geprüft wird vorher; bei einem Fehler bleibt alles, wie es war. Signale werden
// an eine neue Betriebsart angeglichen. Gibt einen Fehlertext zurück oder ''.
MF.setAxis = function (body, changes) {
  if (!body.axis) return body.name + ' hat keine Achse.';
  var ax = JSON.parse(JSON.stringify(body.axis));
  if (changes.type !== undefined && changes.type !== ax.type) {
    if (!MF.AXIS.DEFAULTS[changes.type]) return 'Achstyp muss "linear" oder "rotary" sein.';
    MF.setAxisType(ax, changes.type);
  }
  for (var k in changes) {
    if (k === 'type') continue;
    if (['mode', 'valve', 'origin', 'dir', 'min', 'max', 'vmax', 'returnDelay'].indexOf(k) < 0) return 'Die Achse hat kein Feld "' + k + '".';
    ax[k] = changes[k];
  }
  ['min', 'max'].forEach(function (k) { if (typeof ax[k] === 'number') ax[k] = MF.geom.round6(ax[k]); });
  var err = MF.axisError(ax);
  if (err) return err;
  var before = MF.io(body).map(function (s) { return s.name; });
  body.axis = ax;
  MF.store.dropSignals(body.id, MF.syncIo(body, before));
  return '';
};

// ---------- Handbetrieb (Eigenschaften-Panel, Abschnitt "Handbetrieb") ----------
//
// Die Knöpfe schreiben dieselben Eingänge wie der I/O-Tab (MF.engine.setSignal),
// kein Schritt im Verlauf. Sie wirken in jedem Zustand der Simulation; bewegen
// tut sich die Achse erst, wenn sie läuft. Befehle je Betriebsart:
//   zweipunkt        'out' / 'in'. Ein Eingang: Ausfahren = 1 bzw. 0, Einfahren per
//                    Knopf sofort (die Wartezeit des Rückfahrverzugs gilt als abgelaufen).
//                    Zwei Eingänge: Impuls auf Ausfahren bzw. Einfahren (ein Zyklus lang),
//                    der andere Eingang wird 0.
//   position         'goto', Ziel in m bzw. Grad: Soll (in die Grenzen geklemmt), Freigabe = 1
//   geschwindigkeit  'jog', −1 / 0 / 1: Soll = ±vmax mit Freigabe = 1, 0 hält an (Freigabe = 0)
// Gibt einen Fehlertext zurück oder ''.
MF.axisManual = function (body, cmd, value) {
  var ax = body.axis, E = MF.engine;
  if (!MF.hasAxis(body)) return body.name + ' hat keine Achse, die ihn bewegt.';
  if (!body.rt) body.rt = {};
  if (ax.mode === 'zweipunkt') {
    if (cmd !== 'out' && cmd !== 'in') return 'Zweipunkt kennt nur Ausfahren und Einfahren.';
    if (ax.valve === 'bi') {
      E.setSignal(body, cmd === 'out' ? 'Einfahren' : 'Ausfahren', 0);
      E.pulse(body, cmd === 'out' ? 'Ausfahren' : 'Einfahren');
    } else {
      E.setSignal(body, 'Ausfahren', cmd === 'out' ? 1 : 0);
      if (cmd === 'in') body.rt.wait = ax.returnDelay;
    }
  } else if (ax.mode === 'position') {
    if (cmd !== 'goto' || typeof value !== 'number' || !isFinite(value)) return 'Position braucht ein Ziel (Zahl).';
    E.setSignal(body, 'Soll', Math.max(ax.min, Math.min(ax.max, value)));
    E.setSignal(body, 'Freigabe', 1);
  } else {
    if (cmd !== 'jog' || [-1, 0, 1].indexOf(value) < 0) return 'Geschwindigkeit braucht −1, 0 oder 1.';
    E.setSignal(body, 'Soll', value * ax.vmax);
    E.setSignal(body, 'Freigabe', value ? 1 : 0);
  }
  return '';
};

// Beschriftung der Knöpfe für zweipunkt: Drehachsen drehen, senkrechte heben
MF.axisManualLabels = function (ax) {
  if (ax.type === 'rotary') return { out: 'Drehen', in: 'Zurück' };
  var n = MF.axisDirName(ax.dir);
  if (n === 'hoch') return { out: 'Heben', in: 'Senken' };
  if (n === 'runter') return { out: 'Senken', in: 'Heben' };
  return { out: 'Ausfahren', in: 'Einfahren' };
};

// Welche Signale man in Regeln bzw. SCL für die Achse nimmt (ein Satz je Zeile)
MF.axisManualHint = function (body) {
  var ax = body.axis, id = body.id;
  var num = function (v) { var t = String(Math.round(v * 1000) / 1000); return t.indexOf('.') < 0 ? t + '.0' : t; };
  if (ax.mode === 'zweipunkt' && ax.valve === 'bi') {
    return ['In Regeln: DANN ' + id + '.Ausfahren bzw. DANN ' + id + '.Einfahren (ein kurzer Impuls reicht).',
      'SCL: ' + id + '.Ausfahren := TRUE; … ' + id + '.Einfahren := TRUE; – Endlagen: ' + id + '.Ausgefahren, ' + id + '.Eingefahren'];
  }
  if (ax.mode === 'zweipunkt') {
    var de = String(Math.round(ax.max * 1000) / 1000).replace('.', ',');
    return ['In Regeln: DANN ' + id + '.Ausfahren (1 = ' + de + ' ' + MF.axisUnit(ax).pos + ', 0 = zurück).',
      'SCL: ' + id + '.Ausfahren := TRUE; – Endlagen: ' + id + '.Ausgefahren, ' + id + '.Eingefahren'];
  }
  if (ax.mode === 'position') {
    var ziel = ax.type === 'rotary' ? Math.max(ax.min, Math.min(ax.max, 90)) : ax.max;
    return ['SCL: ' + id + '.Soll := ' + num(ziel) + '; ' + id + '.Freigabe := TRUE; – angekommen: ' + id + '.InPosition'];
  }
  return ['SCL: ' + id + '.Soll := ' + num(ax.vmax / 2) + '; ' + id + '.Freigabe := TRUE; (Soll in ' + MF.axisUnit(ax).speed +
    ', negativ = rückwärts) – Stellung: ' + id + '.Ist'];
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

// Vorlagen (Katalog, Reiter "Komponenten"): jede beschreibt sich vollständig –
//   label, icon (Symbol in index.html), prefix (IDs, z. B. "DT" -> DT1), color,
//   group (Gruppe im Ribbon), hint (Hinweistext), make() (Körper ohne ID/Lage x, y)
//   und props (Eigenschaften der Vorlage).
// Oberfläche, Engine und Datei haben keine Sonderfälle je Vorlage: der Katalog
// entsteht aus dieser Liste, alles Weitere aus den Funktionen des Körpers.
// Eigenschaft der Vorlage: Lesen/Schreiben geht immer über die Funktionen.
// key, label, type … wie das Eigenschaften-Panel sie zeigt; get/set greifen auf den Körper zu.
// Ohne props zeigt das Panel die allgemeinen Felder der Funktionen (MF.FUNCTIONS[fn].fields).
MF.templates = {
  source: {
    label: 'Quelle', icon: 'i-source', prefix: 'Q', color: '#D9701A', group: 'Materialfluss',
    hint: 'Erzeugt im Takt Teile und legt sie auf das Band darunter. Form, Größe, Werkstoff und Farbe der Teile bestimmt das Produkt, das im Baum unter der Quelle hängt (Standard: Kiste 0,3 m)',
    make: function () {
      return {
        kind: 'ghost',
        shape: { type: 'rect', w: 0.5, d: 0.5, h: 0.35 },
        pose: { z: MF.BELT_TOP + 0.02 },
        material: MF.MATERIALS.ghost,
        spawner: MF.FUNCTIONS.spawner.make()
      };
    },
    props: [
      { key: 'enabled', label: 'Aktiv', type: 'bool', hint: 'Erzeugt die Quelle Teile?', fn: 'spawner', field: 'enabled' },
      { key: 'interval', label: 'Takt', type: 'number', unit: 's', step: 0.1, min: 0.1, max: 60, hint: 'Abstand zwischen zwei Teilen', fn: 'spawner', field: 'interval' },
      { key: 'maxCount', label: 'Max. Anzahl', type: 'number', step: 1, min: 0, hint: '0 = unbegrenzt', fn: 'spawner', field: 'maxCount' }
    ]
  },
  conveyor: {
    label: 'Förderband', icon: 'i-conveyor', prefix: 'B', color: '#1B2430', group: 'Materialfluss',
    hint: 'Band (Transportfläche), das aufliegende Kisten mitnimmt; Oberkante 0,7 m',
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
      { key: 'direction', label: 'Richtung', type: 'select', options: ['rechts', 'links', 'oben', 'unten'], fn: 'surface',
        hint: 'Laufrichtung des Bands; das Band dreht sich mit',
        get: function (b) { return MF.dirName(b.pose.rot + b.surface.dir); },
        set: function (b, v) { if (v in MF.DIRS) MF.turnTo(b, b.surface.dir, MF.DIRS[v]); } }
    ]
  },
  sensor: {
    label: 'Lichtschranke', icon: 'i-sensor', prefix: 'LS', color: '#1B2430', group: 'Sensoren',
    hint: 'Meldet, ob eine Kiste den Strahl unterbricht (Belegt)',
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
    label: 'Schieber', icon: 'i-pusher', prefix: 'S', color: '#1B2430', group: 'Aktoren',
    hint: 'Schiebt Kisten quer vom Band (Achse linear, zweipunkt: Ausfahren)',
    make: function () {
      return {
        kind: 'kinematic',
        shape: { type: 'polygon', points: MF.pusherOutline(0.5, 0.5, 0.4, 1), h: MF.PUSHER.H },
        pose: { z: MF.BELT_TOP + 0.02 },
        // Gleitbelag: sonst zieht der einfahrende Stößel eine gestaute Kiste mit zur Seite
        material: MF.MATERIALS.slide,
        axis: { type: 'linear', origin: [0, 0, 0], dir: [0, 1, 0], min: 0, max: 0.4, vmax: 0.3, mode: 'zweipunkt', valve: 'mono', returnDelay: 0.5 }
      };
    },
    props: [
      { key: 'stroke', label: 'Hub', type: 'number', unit: 'mm', step: 10, min: 0, max: 2000, hint: 'Wie weit der Schieber ausfährt', fn: 'axis',
        get: function (b) { return Math.round((b.axis.max - b.axis.min) * 1e6) / 1e3; },
        set: function (b, v) { b.axis.max = Math.round((b.axis.min + v / 1000) * 1e6) / 1e6; } },
      { key: 'speed', label: 'Tempo', type: 'number', unit: 'm/s', step: 0.1, min: 0.1, max: 5, hint: 'Ausfahrgeschwindigkeit', fn: 'axis', field: 'vmax' },
      { key: 'returnDelay', label: 'Rückfahrverzug', type: 'number', unit: 's', step: 0.1, min: 0, max: 60, hint: 'Wartezeit vor dem Einfahren', fn: 'axis', field: 'returnDelay',
        when: function (b) { return b.axis.mode === 'zweipunkt' && b.axis.valve !== 'bi'; } },
      { key: 'direction', label: 'Richtung', type: 'select', options: ['rechts', 'links', 'oben', 'unten'], fn: 'axis',
        hint: 'Schubrichtung; der Schieber dreht sich mit',
        get: function (b) { return MF.dirName(b.pose.rot + MF.vecDeg(b.axis.dir)); },
        set: function (b, v) { if (v in MF.DIRS) MF.turnTo(b, MF.vecDeg(b.axis.dir), MF.DIRS[v]); } }
    ]
  },
  sink: {
    label: 'Senke', icon: 'i-sink', prefix: 'SE', color: '#1B2430', group: 'Materialfluss',
    hint: 'Nimmt Teile auf (Mittelpunkt in der Senke) und zählt sie (Anzahl); liegt etwas tiefer als das Band',
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
      { key: 'count', label: 'Zählerstand', type: 'number', readonly: true, live: true, hint: 'Aufgenommene Teile', fn: 'sink',
        get: function (b) { return (b.rt && b.rt.count) || 0; } }
    ]
  },

  // ---------- Achsen (Phase 4) ----------
  // Tische mit Band liegen bündig mit der Bandoberkante (0,7 m), wie alle Bänder
  // (Konzept, Abschnitt 4: Nähte bündig, Umlenkrolle an den Stirnenden).
  turntable: {
    label: 'Drehtisch', icon: 'i-turntable', prefix: 'DT', color: '#1B2430', group: 'Tische',
    hint: 'Runder Tisch mit Band, dreht um die Hochachse: Ausfahren = 1 dreht auf 90°, 0 zurück auf 0°, ' +
      'Ausgefahren/Eingefahren melden die Endlagen. Für beliebige Winkel Betriebsart Position (Soll und Freigabe). ' +
      'Liegt bündig mit den Bändern',
    make: function () {
      return {
        kind: 'kinematic',
        shape: { type: 'circle', r: 0.4, h: 0.1 },
        pose: { z: MF.BELT_TOP - 0.1 },
        material: MF.MATERIALS.belt,
        surface: { speed: 0.5, dir: 0, running: true },
        axis: { type: 'rotary', origin: [0, 0, 0], dir: [0, 0, 1], min: 0, max: 90, vmax: 90, mode: 'zweipunkt', valve: 'mono', returnDelay: 0 }
      };
    },
    props: []
  },
  lift: {
    label: 'Hubtisch', icon: 'i-lift', prefix: 'HT', color: '#1B2430', group: 'Tische',
    hint: 'Tisch mit Band, fährt senkrecht nach oben: Ausfahren hebt um den Hub (max), Ausgefahren meldet oben. ' +
      'Für beliebige Höhen Betriebsart Position wählen',
    make: function () {
      return {
        kind: 'kinematic',
        shape: { type: 'rect', w: 0.6, d: 0.5, h: 0.1 },
        pose: { z: MF.BELT_TOP - 0.1 },
        material: MF.MATERIALS.belt,
        surface: { speed: 0.5, dir: 0, running: true },
        axis: { type: 'linear', origin: [0, 0, 0], dir: [0, 0, 1], min: 0, max: 0.3, vmax: 0.2, mode: 'zweipunkt', valve: 'mono', returnDelay: 0 }
      };
    },
    props: []
  },
  stopper: {
    label: 'Stopper', icon: 'i-stopper', prefix: 'ST', color: '#1B2430', group: 'Aktoren',
    hint: 'Sperre quer im Band: Ausfahren hebt sie aus der Bandebene und hält Kisten an, Einfahren gibt sie frei. ' +
      'Eingefahren liegt sie 2 cm unter der Bandoberkante',
    make: function () {
      return {
        kind: 'kinematic',
        shape: { type: 'rect', w: 0.05, d: 0.4, h: 0.08 },
        pose: { z: MF.BELT_TOP - 0.1 },
        // Gleitbelag: mit Stahl zieht der einfahrende Stopper die vorderste Kiste
        // eines Staus mit nach unten, sie hakt an seiner Kante ein
        material: MF.MATERIALS.slide,
        axis: { type: 'linear', origin: [0, 0, 0], dir: [0, 0, 1], min: 0, max: 0.14, vmax: 0.5, mode: 'zweipunkt', valve: 'mono', returnDelay: 0 }
      };
    },
    props: []
  },
  diverter: {
    label: 'Weiche', icon: 'i-diverter', prefix: 'W', color: '#1B2430', group: 'Aktoren',
    hint: 'Schwenkarm über dem Band, dreht um sein linkes Ende: Ausfahren schwenkt ihn um 45° quer über das Band ' +
      'und lenkt Kisten zur Seite auf ein abgehendes Band. An die obere Bandkante legen',
    make: function () {
      return {
        kind: 'kinematic',
        shape: { type: 'rect', w: 0.8, d: 0.05, h: 0.15 },
        pose: { z: MF.BELT_TOP + 0.02 },
        // Gleitbelag: Kisten rutschen am Arm entlang statt hängenzubleiben
        material: MF.MATERIALS.slide,
        axis: { type: 'rotary', origin: [-0.4, 0, 0], dir: [0, 0, 1], min: 0, max: 45, vmax: 90, mode: 'zweipunkt', valve: 'mono', returnDelay: 0 }
      };
    },
    props: []
  }
};

// Gruppen des Katalogs in der Reihenfolge ihres ersten Auftretens:
// [{ name, templates: ['source', …] }]
MF.templateGroups = function () {
  var out = [], byName = {};
  Object.keys(MF.templates).forEach(function (k) {
    var g = MF.templates[k].group || 'Weitere';
    if (!byName[g]) { byName[g] = { name: g, templates: [] }; out.push(byName[g]); }
    byName[g].templates.push(k);
  });
  return out;
};

// Symbol im Baum und im Panel: das der Vorlage, sonst ein allgemeiner Körper
MF.bodyIcon = function (body) {
  if (MF.isProduct(body)) return 'i-product';
  var t = MF.templates[body.template];
  return t ? t.icon : 'i-body';
};

// Eigenschaften eines Körpers (aus seiner Vorlage); ohne Vorlage keine.
// Jede Eigenschaft gehört zu einer Funktion (fn); fehlt die Funktion inzwischen
// (frei geändert, z. B. Transportfläche entfernt), fällt die Eigenschaft weg.
// when(body) blendet sie aus (z. B. Rückfahrverzug bei zwei Eingängen).
MF.propsOf = function (body) {
  var t = MF.templates[body.template];
  return t ? t.props.filter(function (p) { return (!p.fn || body[p.fn]) && (!p.when || p.when(body)); }) : [];
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
  var before = MF.io(body).map(function (s) { return s.name; });
  if (p.set) p.set(body, v);
  else if (body[p.fn]) body[p.fn][p.field] = v;
  MF.store.dropSignals(body.id, MF.syncIo(body, before));
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

// ---------- Frei gestaltete Körper (Phase 3) ----------
//
// Formen zeichnen und ändern, Körperart wechseln, Funktionen anlegen und entfernen.
// Editor, Eigenschaften-Panel und Tests benutzen dieselben Funktionen, damit die
// Regeln (Konzept, Abschnitt 2: "erlaubt bei") überall gleich gelten.

// Neuer Körper aus einer gezeichneten Form, ohne ID und Namen.
// shape: { type, w, d | r | points, h }, pose: { x, y, z, rot }
// Neu gezeichnete Formen sind immateriell (ghost), Konzept Abschnitt 2.
MF.bodyFromShape = function (shape, pose) {
  var body = {
    id: null, name: null, parent: null, template: null,
    kind: 'ghost',
    shape: JSON.parse(JSON.stringify(shape)),
    pose: { x: pose.x, y: pose.y, z: pose.z || 0, rot: pose.rot || 0 },
    material: JSON.parse(JSON.stringify(MF.MATERIALS.body))
  };
  if (typeof body.shape.h !== 'number') body.shape.h = MF.BODY.H;
  MF.FN_KEYS.forEach(function (k) { body[k] = null; });
  body.look = { color: MF.BODY.color, visible: true, locked: false };
  body.rt = {};
  MF.initIo(body);
  return body;
};

// Fehlertext, wenn die Form so nicht gültig ist, sonst ''
MF.shapeError = function (shape) {
  function pos(v) { return typeof v === 'number' && isFinite(v) && v > 0; }
  if (shape.type === 'rect' && !(pos(shape.w) && pos(shape.d))) return 'Breite und Tiefe müssen größer als 0 sein.';
  if (shape.type === 'circle' && !pos(shape.r)) return 'Der Radius muss größer als 0 sein.';
  if (shape.type === 'polygon') {
    var pts = shape.points || [];
    if (pts.length < 3) return 'Ein Polygon braucht mindestens drei Punkte.';
    if (MF.geom.selfIntersects(pts)) return 'Das Polygon schneidet sich selbst.';
    if (Math.abs(MF.geom.signedArea(pts)) < 1e-9) return 'Das Polygon hat keine Fläche.';
  }
  if (!pos(shape.h)) return 'Die Höhe muss größer als 0 sein.';
  if (shape.h2 !== undefined && !(typeof shape.h2 === 'number' && isFinite(shape.h2) && shape.h2 >= 0)) {
    return 'Die Höhe am Ende muss eine Zahl ≥ 0 sein.';
  }
  return '';
};

// Neigung (geneigte Oberseite, shape.h2) nur bei festen Körpern und ohne
// Transportfläche (die Nachführung kennt nur waagrechte Flächen, Spike-Ergebnis 5).
MF.slopeError = function (body) {
  if (body.kind !== 'static') return 'Neigung gibt es nur bei festen Körpern (static).';
  if (body.surface) return 'Auf einer geneigten Fläche gibt es keine Transportfläche.';
  return '';
};

// Darf der Körper die Funktion fn haben? Fehlertext oder ''
MF.fnError = function (body, fn) {
  var f = MF.FUNCTIONS[fn];
  if (!f) return 'Unbekannte Funktion "' + fn + '".';
  if (f.kinds.indexOf(body.kind) < 0) {
    var names = f.kinds.map(function (k) { return MF.KIND_LABELS[k] + 'en'; }).join(' oder ');
    return f.label + ' gibt es nur bei ' + names + ' Körpern.';
  }
  if (fn === 'surface' && MF.geom.isSloped(body.shape)) return 'Auf einer geneigten Fläche gibt es keine Transportfläche.';
  return '';
};

MF.KIND_LABELS = { ghost: 'immateriell', static: 'fest', kinematic: 'kinematisch', dynamic: 'dynamisch' };

// Funktionen, die bei dieser Körperart erlaubt sind
MF.allowedFns = function (kind) {
  return MF.FN_KEYS.filter(function (fn) { return MF.FUNCTIONS[fn].kinds.indexOf(kind) >= 0; });
};

// Signale nach einer Änderung der Funktionen angleichen: bestehende Eingänge
// behalten ihren Wert, neue bekommen den Startwert, wegfallende verschwinden
// (auch geforcte Ausgänge). before = Signalnamen vor der Änderung.
// Gibt die Namen der weggefallenen Signale zurück.
MF.syncIo = function (body, before) {
  var old = body.inputs || {}, force = body.force || {};
  var names = {}, gone = [];
  body.inputs = {};
  body.force = {};
  MF.io(body).forEach(function (s) {
    names[s.name] = true;
    if (s.dir === 'in' && !s.prop) body.inputs[s.name] = s.name in old ? old[s.name] : s.init || 0;
    if (s.name in force) body.force[s.name] = force[s.name];
  });
  (before || []).forEach(function (n) {
    if (!names[n] && gone.indexOf(n) < 0) gone.push(n);
  });
  return gone;
};

// Funktion anlegen (mit Standardwerten). Gibt einen Fehlertext zurück oder ''.
MF.addFunction = function (body, fn) {
  var err = MF.fnError(body, fn);
  if (err) return err;
  if (body[fn]) return '';
  body[fn] = MF.FUNCTIONS[fn].make();
  MF.syncIo(body);
  // Ein Erzeuger in der Anlage bekommt sein Produkt (Standard-Kiste)
  if (fn === 'spawner' && MF.store.findBody(body.id) === body) MF.store.addProduct(body);
  return '';
};

// Funktion entfernen. Gibt die Namen der weggefallenen Signale zurück.
MF.removeFunction = function (body, fn) {
  if (!body[fn]) return [];
  var before = MF.io(body).map(function (s) { return s.name; });
  if (fn === 'spawner') MF.store.dropProduct(body);
  body[fn] = null;
  return MF.syncIo(body, before);
};

// Körperart wechseln. Nicht mehr erlaubte Funktionen und eine Neigung (nur bei
// static) werden entfernt. Gibt zurück, was wegfällt:
// { fns: ['surface', …], slope: true|false, signals: ['Ein', …] }
// Mit dryRun wird nichts geändert (für die Rückfrage im Panel).
MF.setKind = function (body, kind, dryRun) {
  var res = { fns: [], slope: false, signals: [] };
  if (MF.KIND_LABELS[kind] === undefined) return res;
  // Das Produkt eines Erzeugers ist die Vorlage dynamischer Teile
  if (MF.isProduct(body) && kind !== 'dynamic') {
    res.error = body.name + ' ist das Produkt von ' + MF.parentBody(body).name + ' – Produkte sind immer dynamisch.';
    return res;
  }
  MF.FN_KEYS.forEach(function (fn) {
    if (body[fn] && MF.FUNCTIONS[fn].kinds.indexOf(kind) < 0) res.fns.push(fn);
  });
  res.slope = kind !== 'static' && MF.geom.isSloped(body.shape);
  // Dynamische Körper bewegen sich nur mit der Physik: Kopplung (an einem Körper
  // hängen oder Körper tragen) wird gelöst, alle bleiben dort, wo sie gerade sind.
  res.couple = kind === 'dynamic' && (!!MF.parentBody(body) || MF.childBodies(body).length > 0);
  if (dryRun || kind === body.kind) return res;
  if (res.couple) {
    MF.childBodies(body).forEach(function (c) { MF.store.reparent(c, MF.store.folderOf(body, 'plant')); });
    if (MF.parentBody(body)) MF.store.reparent(body, MF.store.folderOf(body, 'plant'));
  }
  var before = MF.io(body).map(function (s) { return s.name; });
  body.kind = kind;
  if (res.fns.indexOf('spawner') >= 0) MF.store.dropProduct(body);
  res.fns.forEach(function (fn) { body[fn] = null; });
  if (res.slope || (body.shape.h2 !== undefined && kind !== 'static')) delete body.shape.h2;
  body.rt = {};
  res.signals = MF.syncIo(body, before);
  // Ein dynamischer Körper braucht eine echte Dichte (Vorlagen haben 1 kg/m³,
  // weil sie fest oder kinematisch sind und ihre Masse dort keine Rolle spielt)
  if (kind === 'dynamic' && body.material && !(body.material.density >= 10)) {
    body.material.density = MF.MATERIALS.body.density;
    res.density = body.material.density;
  }
  return res;
};

// Form und Lage ändern: changes mit w, d, r, h, h2 (null = Neigung weg), points,
// x, y, z, rot. Mit type ('rect', 'circle', 'polygon') wechselt der Formtyp
// (MF.convertShape; Maße aus changes, sonst aus dem Hüllrechteck der alten Form).
// Geprüft wird vorher; bei einem Fehler bleibt alles, wie es war.
// Gibt einen Fehlertext zurück oder ''.
MF.setForm = function (body, changes) {
  var sh = JSON.parse(JSON.stringify(body.shape));
  if (changes.type !== undefined && changes.type !== sh.type) {
    sh = MF.convertShape(sh, changes.type);
    if (!sh) return 'Formtyp muss "rect", "circle" oder "polygon" sein.';
  }
  var pose = { x: body.pose.x, y: body.pose.y, z: body.pose.z, rot: body.pose.rot };
  var ok = { rect: ['w', 'd'], circle: ['r'], polygon: ['points'] }[sh.type] || [];
  for (var k in changes) {
    var v = changes[k];
    if (k === 'type') continue;
    if (k === 'x' || k === 'y' || k === 'z' || k === 'rot') {
      if (typeof v !== 'number' || !isFinite(v)) return 'Lage "' + k + '" muss eine Zahl sein.';
      pose[k] = k === 'rot' ? MF.geom.normDeg(v) : Math.round(v * 1e6) / 1e6;
    } else if (k === 'h') {
      sh.h = v;
    } else if (k === 'h2') {
      if (v === null || v === undefined) delete sh.h2;
      else sh.h2 = v;
    } else if (ok.indexOf(k) >= 0) {
      sh[k] = k === 'points' ? v.map(function (p) { return [p[0], p[1]]; }) : v;
    } else {
      return 'Die Form "' + sh.type + '" hat kein Maß "' + k + '".';
    }
  }
  var err = MF.shapeError(sh);
  if (err) return err;
  if (MF.geom.isSloped(sh) && !MF.geom.isSloped(body.shape)) {
    err = MF.slopeError(body);
    if (err) return err;
  }
  body.shape = sh;
  body.pose = pose;
  return '';
};

// Form in einen anderen Formtyp umrechnen, ungefähr gleich groß um denselben
// Ursprung: Rechteck aus dem Hüllrechteck, Kreis passt hinein, Polygon = Rechteck
// mit vier Punkten bzw. Achteck aus einem Kreis. Höhe und Neigung bleiben.
// null bei unbekanntem Typ.
MF.convertShape = function (sh, type) {
  var r6 = MF.geom.round6;
  var bb = MF.geom.bounds(sh, { x: 0, y: 0, rot: 0 });
  var w = r6(bb.x1 - bb.x0), d = r6(bb.y1 - bb.y0), out;
  if (type === 'rect') out = { type: 'rect', w: w, d: d };
  else if (type === 'circle') out = { type: 'circle', r: r6(Math.min(w, d) / 2) };
  else if (type === 'polygon') {
    var pts = [];
    if (sh.type === 'circle') {
      for (var i = 0; i < 8; i++) {
        var a = Math.PI * (2 * i + 1) / 8;
        pts.push([r6(sh.r * Math.cos(a)), r6(sh.r * Math.sin(a))]);
      }
    } else {
      pts = [[r6(bb.x0), r6(bb.y0)], [r6(bb.x1), r6(bb.y0)], [r6(bb.x1), r6(bb.y1)], [r6(bb.x0), r6(bb.y1)]];
    }
    out = { type: 'polygon', points: pts };
  } else return null;
  out.h = sh.h;
  if (sh.h2 !== undefined) out.h2 = sh.h2;
  return out;
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
    snap: { on: true, obj: true, pos: 0.05, angle: 5 }   // Fangen (Raster, Objektfang): nur Zeichenhilfe
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
    axis: { type: 'linear', origin: [0, 0, 0], dir: [0, 1, 0], min: 0, max: 0.6, vmax: 1, mode: 'zweipunkt', valve: 'mono', returnDelay: 0.5 } },
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
MF.ensureProducts(MF.model.bodies);   // Q1 bekommt sein Produkt P1 (Kiste)

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
  changed: function () {
    this.emit('change');
  },

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
    if (b.spawner) this.addProduct(b);
    this.selectedId = b.id;
    this.changed();
    return b;
  },

  // ---------- Produkt eines Erzeugers ----------

  // Produkt-Körper für den Erzeuger src anlegen (spec { shape, material, look },
  // Standard: Kiste), direkt hinter src. Ein vorhandenes Produkt wird ersetzt.
  addProduct: function (src, spec) {
    this.dropProduct(src);
    var p = MF.productBody(src, spec || MF.defaultProduct(), this.nextId(MF.PRODUCT.prefix).id);
    var bs = MF.model.bodies;
    bs.splice(bs.indexOf(src) + 1, 0, p);
    src.spawner.product = p.id;
    return p;
  },

  // Produkt des Erzeugers src entfernen (Erzeuger weg oder gelöscht). Nur für
  // Körper der Anlage – eine Probe-Kopie (MCP prüft Änderungen erst daran) lässt es stehen.
  dropProduct: function (src) {
    var p = this.findBody(src.id) === src ? MF.productOf(src) : null, bs = MF.model.bodies;
    if (p) {
      bs.splice(bs.indexOf(p), 1);
      if (this.selectedId === p.id) this.selectedId = src.id;
    }
    if (src.spawner) src.spawner.product = null;
  },

  // Neuer Körper aus einer gezeichneten Form (ghost, Name "Körper n", IDs K1, K2 …).
  // Gibt null zurück und meldet den Grund, wenn die Form ungültig ist.
  createShape: function (shape, pose, parent) {
    var b = MF.bodyFromShape(shape, pose);
    var err = MF.shapeError(b.shape);
    if (err) { if (MF.ui) MF.ui.message('Form abgelehnt: ' + err); return null; }
    var next = this.nextId(MF.BODY.prefix);
    b.id = next.id;
    b.name = MF.BODY.label + ' ' + next.n;
    b.parent = parent || null;
    MF.model.bodies.push(b);
    this.selectedId = b.id;
    this.changed();
    return b;
  },

  // Regeln, die eines der Signale (id.Name) benutzen, verlieren den Bezug –
  // wie beim Löschen eines Körpers. SCL-Code meldet das Signal selbst als Fehler.
  dropSignals: function (id, names) {
    if (!names || !names.length) return;
    MF.model.rules.forEach(function (r) {
      names.forEach(function (n) {
        if (r.when === id + '.' + n) r.when = '';
        if (r.then === id + '.' + n) r.then = '';
      });
    });
  },

  // Kopie mit neuer ID, 0,5 m versetzt; steht im Baum direkt hinter dem Original
  duplicateBody: function (id) {
    var src = this.findBody(id);
    if (!src) return null;
    if (MF.isProduct(src)) {
      if (MF.ui) MF.ui.message(src.name + ' gehört zu ' + MF.parentBody(src).name + ' – zum Duplizieren die Quelle wählen.');
      return null;
    }
    var t = MF.templates[src.template];
    var next = this.nextId(t ? t.prefix : MF.BODY.prefix);
    var b = JSON.parse(JSON.stringify(src, function (k, v) { return k === 'rt' || k === 'force' ? undefined : v; }));
    b.id = next.id;
    b.name = (t ? t.label : MF.BODY.label) + ' ' + next.n;
    b.pose.x = Math.round((b.pose.x + 0.5) * 1e6) / 1e6;
    b.pose.y = Math.round((b.pose.y + 0.5) * 1e6) / 1e6;
    b.rt = {};
    b.force = {};
    MF.model.bodies.push(b);
    this.placeAfter(MF.model.bodies, b, src);
    // Erzeuger: sein Produkt mit, als eigener Körper unter der Kopie
    var prod = MF.productOf(src);
    if (prod) {
      var pc = this.addProduct(b, { shape: prod.shape, material: prod.material, look: prod.look });
      pc.pose = { x: prod.pose.x, y: prod.pose.y, z: prod.pose.z, rot: prod.pose.rot };
      pc.look.visible = prod.look.visible;
    }
    this.selectedId = b.id;
    this.changed();
    return b;
  },

  // Körper entfernen. Regeln, die seine Signale benutzen, verlieren den Bezug.
  // Körper, die an ihm hängen, bleiben, wo sie sind, und hängen danach eine Ebene höher.
  deleteBody: function (id) {
    var bs = MF.model.bodies;
    var b = this.findBody(id);
    var i = bs.indexOf(b);
    if (i < 0) return false;
    if (MF.isProduct(b)) {
      if (MF.ui) MF.ui.message(b.name + ' gehört zu ' + MF.parentBody(b).name + ' und lässt sich nicht einzeln löschen – ' +
        'es ist die Vorlage der Teile. Ändern geht (Form, Werkstoff, Farbe), weg kommt es mit der Quelle.');
      return false;
    }
    var self = this;
    MF.childBodies(b).forEach(function (c) { self.reparent(c, self.parentOf(b, 'plant')); });
    if (b.spawner) this.dropProduct(b);
    bs.splice(bs.indexOf(b), 1);
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

  // ---------- Strukturbaum: Ordner und Kopplung ----------
  //
  // "parent" ist eine Ordner-ID, null (oberste Ebene) oder – nur bei Körpern –
  // die ID eines Körpers (Kopplung, Phase 4): der Körper hängt im Baum unter dem
  // anderen und bewegt sich mit ihm. Alle Funktionen fragen über parentOf()/
  // childrenOf() und nicht direkt nach Ordnern; folderOf() liefert den Ordner.

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

  // Gültiger Eltern-Knoten eines Objekts: Ordner im Bereich oder (bei Körpern)
  // ein anderer Körper. Unbekannte Verweise zählen als oberste Ebene.
  parentOf: function (obj, area) {
    if (!obj || !obj.parent) return null;
    var f = this.findFolder(obj.parent);
    if (f) return f.area === area ? f.id : null;
    if (area !== 'plant' || !obj.shape) return null;
    var p = this.findBody(obj.parent);
    return p && p !== obj ? p.id : null;
  },

  // Ordner, in dem ein Objekt liegt – bei gekoppelten Körpern der Ordner des Elternkörpers
  folderOf: function (obj, area) {
    var p = this.parentOf(obj, area), guard = 0;
    while (p && guard++ < 100) {
      if (this.findFolder(p)) return p;
      p = this.parentOf(this.findBody(p), area);
    }
    return null;
  },

  // Körper an einen neuen Eltern-Knoten hängen (Ordner, Körper oder null), ohne
  // dass er sich in der Welt bewegt: seine Lage wird ins neue Koordinatensystem
  // umgerechnet (Achsen in ihrer aktuellen Stellung). Prüft nichts (moveError).
  reparent: function (b, parent) {
    var oldBody = MF.parentBody(b);
    var newBody = parent ? this.findBody(parent) : null;
    if (oldBody || newBody) {
      var world = MF.restPose(b);
      b.parent = parent || null;
      b.pose = MF.relativePose(newBody ? MF.poseInWorld(newBody) : MF.WORLD, world);
    } else {
      b.parent = parent || null;
    }
  },

  // Name des Ziels für Meldungen: Ordnerpfad, Körpername oder Bereich
  placeName: function (parent, area) {
    var b = parent ? this.findBody(parent) : null;
    if (b) return b.name;
    return parent ? this.folderPath(parent).join(' / ') : this.AREAS[area];
  },

  // Darf Körper b an den Körper target gehängt werden? Fehlertext oder ''
  coupleError: function (b, target) {
    if (target === b) return 'Ein Körper kann nicht an sich selbst hängen.';
    if (MF.isProduct(target)) return target.name + ' ist die Vorlage der Teile von ' + MF.parentBody(target).name + ' – an ein Produkt lässt sich nichts koppeln.';
    if (this.isWithin(target.id, b.id)) return target.name + ' hängt an ' + b.name + ' – Kopplung im Kreis ist nicht möglich.';
    if (b.kind === 'dynamic') return b.name + ' ist dynamisch und bewegt sich nur mit der Physik – keine Kopplung möglich.';
    if (target.kind === 'dynamic') return target.name + ' ist dynamisch – an ihn lässt sich nichts koppeln.';
    if (MF.parentBody(target)) {
      return 'Höchstens zwei Ebenen: ' + target.name + ' hängt selbst an einem Körper (tiefere Ketten folgen später).';
    }
    if (MF.childBodies(b).length) {
      return 'Höchstens zwei Ebenen: an ' + b.name + ' hängen selbst Körper (tiefere Ketten folgen später).';
    }
    return '';
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
  // Ebene mit ihrem ganzen Inhalt, dann die Körper/Regeln dieser Ebene, jeder
  // Körper gefolgt von den Körpern, die an ihm hängen).
  // folder: nur den Inhalt dieses Ordners (samt Unterordnern) liefern.
  treeOrder: function (area, folder) {
    var self = this, out = [], seen = {};
    (function walk(parent) {
      if (seen[parent]) return;   // Schutz vor Zyklen in kaputten Daten
      seen[parent] = true;
      var c = self.childrenOf(area, parent);
      c.folders.forEach(function (f) { walk(f.id); });
      c.items.forEach(function (o) {
        out.push(o);
        if (area === 'plant') walk(o.id);
      });
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
    if (n.kind === 'body' && MF.isProduct(n.obj)) {
      return (parent || null) === n.obj.parent ? '' : n.obj.name + ' gehört zu ' + MF.parentBody(n.obj).name +
        ' und bleibt unter ihr – zum Verschieben die Quelle ziehen.';
    }
    if (parent && area === 'plant' && this.findBody(parent)) {
      if (n.kind !== 'body') return 'Nur Körper lassen sich an einen Körper hängen.';
      return this.coupleError(n.obj, this.findBody(parent));
    }
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
      // Körper bleiben beim Koppeln und Lösen dort, wo sie in der Welt sind
      if (n.kind === 'body') self.reparent(n.obj, parent);
      else n.obj.parent = parent;
      arr.splice(arr.indexOf(n.obj), 1);
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
