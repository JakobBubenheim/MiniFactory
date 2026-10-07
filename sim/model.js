// Modell: Elementtypen, Beispielanlage und zentrale Auswahl.
// Baum, Eigenschaften und Canvas lesen alle aus diesem einen Zustand.
window.MF = window.MF || {};

// Beschreibung der fünf Elementtypen: Eigenschaften und Signale (I/O).
MF.types = {
  source: {
    label: 'Quelle', icon: 'i-source', prefix: 'Q', size: [1, 1], color: '#D9701A',
    defaults: { interval: 2, maxCount: 0, enabled: true },
    props: [
      { key: 'enabled', label: 'Aktiv', type: 'bool', hint: 'Erzeugt die Quelle Kisten?' },
      { key: 'interval', label: 'Takt', type: 'number', unit: 's', step: 0.1, min: 0.1, max: 60, hint: 'Abstand zwischen zwei Kisten' },
      { key: 'maxCount', label: 'Max. Anzahl', type: 'number', step: 1, min: 0, hint: '0 = unbegrenzt' }
    ],
    io: [
      { name: 'Freigabe', dir: 'in', type: 'BOOL', init: 1 },
      { name: 'Erzeugt', dir: 'out', type: 'INT32' }
    ]
  },
  conveyor: {
    label: 'Förderband', icon: 'i-conveyor', prefix: 'B', size: [4, 1], color: '#1B2430',
    defaults: { running: true, speed: 0.5, direction: 'rechts' },
    props: [
      { key: 'running', label: 'Antrieb', type: 'bool', hint: 'Band ein- oder ausschalten' },
      { key: 'speed', label: 'Tempo', type: 'number', unit: 'm/s', step: 0.1, min: 0, max: 5, hint: 'Bandgeschwindigkeit' },
      { key: 'direction', label: 'Richtung', type: 'select', options: ['rechts', 'links', 'oben', 'unten'], hint: 'Laufrichtung des Bands' }
    ],
    io: [
      { name: 'Ein', dir: 'in', type: 'BOOL', init: 1 },
      { name: 'Läuft', dir: 'out', type: 'BOOL' },
      { name: 'Tempo', dir: 'in', type: 'FLOAT32', prop: 'speed' }  // Sollwert = Eigenschaft "Tempo"
    ]
  },
  sensor: {
    label: 'Lichtschranke', icon: 'i-sensor', prefix: 'LS', size: [1, 1], color: '#1B2430',
    defaults: { invert: false, debounce: 0 },
    props: [
      { key: 'invert', label: 'Invertieren', type: 'bool', onText: 'Ja', offText: 'Nein', hint: 'Meldet "belegt", wenn der Strahl frei ist' },
      { key: 'debounce', label: 'Entprellzeit', type: 'number', unit: 'ms', step: 10, min: 0, max: 5000, hint: 'Belegt/frei wechselt erst, wenn der Strahl so lange unverändert ist' }
    ],
    io: [
      { name: 'Belegt', dir: 'out', type: 'BOOL' }
    ]
  },
  pusher: {
    label: 'Schieber', icon: 'i-pusher', prefix: 'S', size: [1, 1], color: '#1B2430',
    defaults: { stroke: 400, speed: 0.3, returnDelay: 0.5, direction: 'auto' },
    props: [
      { key: 'stroke', label: 'Hub', type: 'number', unit: 'mm', step: 10, min: 0, max: 2000, hint: 'Wie weit der Schieber ausfährt' },
      { key: 'speed', label: 'Tempo', type: 'number', unit: 'm/s', step: 0.1, min: 0.1, max: 5, hint: 'Ausfahrgeschwindigkeit' },
      { key: 'returnDelay', label: 'Rückfahrverzug', type: 'number', unit: 's', step: 0.1, min: 0, max: 60, hint: 'Wartezeit vor dem Einfahren' },
      { key: 'direction', label: 'Richtung', type: 'select', options: ['auto', 'rechts', 'links', 'oben', 'unten'], hint: 'Schubrichtung; auto = vom Schieber weg über das angrenzende Band' }
    ],
    io: [
      { name: 'Ausfahren', dir: 'in', type: 'BOOL' },
      { name: 'Ausgefahren', dir: 'out', type: 'BOOL' },
      { name: 'Eingefahren', dir: 'out', type: 'BOOL' }
    ]
  },
  sink: {
    label: 'Senke', icon: 'i-sink', prefix: 'SE', size: [1, 1], color: '#1B2430',
    defaults: { count: 0 },
    props: [
      { key: 'count', label: 'Zählerstand', type: 'number', readonly: true, hint: 'Aufgenommene Kisten' }
    ],
    io: [
      { name: 'Reset', dir: 'in', type: 'BOOL' },
      { name: 'Anzahl', dir: 'out', type: 'INT32' }
    ]
  }
};

// Beispielanlage, damit Baum und Eigenschaften etwas zeigen.
// Positionen und Größen in Rasterzellen, Drehung (rot) in Grad: 0, 90, 180 oder 270.
MF.model = {
  name: 'Beispielanlage',
  settings: {
    dtMs: 50,     // Zeitschritt der Simulation in Millisekunden
    cellM: 0.5    // Kantenlänge einer Rasterzelle in Metern
  },
  elements: [
    { id: 'Q1',  type: 'source',   name: 'Quelle 1',      group: 'Förderstrecke 1', x: 2,  y: 4, w: 1, h: 1,
      props: { interval: 2, maxCount: 0, enabled: true } },
    { id: 'B1',  type: 'conveyor', name: 'Förderband 1',  group: 'Förderstrecke 1', x: 3,  y: 4, w: 9, h: 1,
      props: { running: true, speed: 0.5, direction: 'rechts' } },
    { id: 'LS1', type: 'sensor',   name: 'Lichtschranke 1', group: 'Förderstrecke 1', x: 8, y: 4, w: 1, h: 1,
      props: { invert: false, debounce: 0 } },
    { id: 'S1',  type: 'pusher',   name: 'Schieber 1',    group: 'Förderstrecke 1', x: 9,  y: 3, w: 1, h: 1,
      props: { stroke: 600, speed: 0.3, returnDelay: 0.5, direction: 'unten' } },
    { id: 'SE1', type: 'sink',     name: 'Senke 1',       group: 'Förderstrecke 1', x: 12, y: 4, w: 1, h: 1,
      props: { count: 0 } },
    { id: 'SE2', type: 'sink',     name: 'Senke 2',       group: 'Ausschleusung',   x: 9,  y: 5, w: 1, h: 1,
      props: { count: 0 } }
  ],
  rules: [
    { id: 'R1', name: 'Regel 1', when: 'LS1.Belegt', then: 'S1.Ausfahren' }
  ]
};

// Eingangssignale auf ihre Startwerte, keine geforcten Ausgänge.
// Eingänge mit prop (z. B. Tempo) sind direkt an eine Eigenschaft gekoppelt.
// inputs: von Hand oder (ab Etappe 4) von Regeln geschriebene Eingänge, z. B. { Ein: 1 }
// force:  Ausgänge, deren Wert von Hand festgehalten wird, z. B. { Belegt: 1 }
MF.initIo = function (el) {
  el.inputs = {};
  el.force = {};
  MF.types[el.type].io.forEach(function (s) {
    if (s.dir === 'in' && !s.prop) el.inputs[s.name] = s.init || 0;
  });
};

// Himmelsrichtungen als Winkel im Uhrzeigersinn, 0° = rechts
MF.DIR_ROT = { rechts: 0, unten: 90, links: 180, oben: 270 };

// Typen, deren Eigenschaft "Richtung" der Drehung folgt (und umgekehrt), und
// wohin sie in Grundstellung (0°) zeigen: Band läuft nach rechts, Schieber drückt nach unten.
MF.ROT_ZERO_DIR = { conveyor: 'rechts', pusher: 'unten' };

MF.rotForDir = function (type, dir) {
  return (MF.DIR_ROT[dir] - MF.DIR_ROT[MF.ROT_ZERO_DIR[type]] + 360) % 360;
};

MF.dirForRot = function (type, rot) {
  var a = (rot + MF.DIR_ROT[MF.ROT_ZERO_DIR[type]]) % 360;
  for (var d in MF.DIR_ROT) if (MF.DIR_ROT[d] === a) return d;
  return MF.ROT_ZERO_DIR[type];
};

// Drehung prüfen bzw. aus der Richtung ableiten, z. B. nach dem Laden einer Datei.
// w und h sind immer die Maße MIT Drehung, also das Rechteck, das das Element
// auf der Fläche belegt. Ein Band liegt deshalb bei 90°/270° hochkant.
MF.normalizeElement = function (el) {
  var dir = el.props.direction;
  if (MF.ROT_ZERO_DIR[el.type] && dir in MF.DIR_ROT) el.rot = MF.rotForDir(el.type, dir);
  else if ([0, 90, 180, 270].indexOf(el.rot) < 0) el.rot = 0;   // Schieber "auto" behält seine Drehung
  if (el.type === 'conveyor' && (el.rot % 180 !== 0 ? el.w > el.h : el.h > el.w)) {
    var w = el.w; el.w = el.h; el.h = w;
  }
};

// Standardwerte für Darstellung und Laufzeitdaten (rt = runtime)
MF.model.elements.forEach(function (el) {
  MF.initIo(el);
  el.rt = {};
  el.visible = true;
  el.locked = false;
  el.color = MF.types[el.type].color;
  MF.normalizeElement(el);
});

// Zentraler Zustand mit einfachem Ereignissystem.
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

  findElement: function (id) {
    var els = MF.model.elements;
    for (var i = 0; i < els.length; i++) if (els[i].id === id) return els[i];
    return null;
  },

  findRule: function (id) {
    var rules = MF.model.rules;
    for (var i = 0; i < rules.length; i++) if (rules[i].id === id) return rules[i];
    return null;
  },

  // ---------- Elemente anlegen, löschen, duplizieren ----------

  // Nächste freie ID mit Kürzel, z. B. "B" -> "B2". Gibt auch die Nummer zurück.
  nextId: function (prefix) {
    var max = 0;
    var re = new RegExp('^' + prefix + '(\\d+)$');
    MF.model.elements.forEach(function (el) {
      var m = re.exec(el.id);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return { id: prefix + (max + 1), n: max + 1 };
  },

  // Neues Element aus der Bibliothek. Werte kommen aus den Standardwerten des Typs.
  createElement: function (type, x, y, group) {
    var t = MF.types[type];
    var next = this.nextId(t.prefix);
    var el = {
      id: next.id, type: type, name: t.label + ' ' + next.n, group: group,
      x: x, y: y, w: t.size[0], h: t.size[1], rot: 0,
      props: JSON.parse(JSON.stringify(t.defaults)),
      rt: {}, visible: true, locked: false, color: t.color
    };
    MF.initIo(el);
    MF.normalizeElement(el);
    MF.model.elements.push(el);
    this.selectedId = el.id;
    this.changed();
    return el;
  },

  // Kopie mit neuer ID, eine Zelle versetzt
  duplicateElement: function (id) {
    var src = this.findElement(id);
    if (!src) return null;
    var el = this.createElement(src.type, src.x + 1, src.y + 1, src.group);
    el.w = src.w;
    el.h = src.h;
    el.rot = src.rot || 0;
    el.props = JSON.parse(JSON.stringify(src.props));
    if (src.type === 'sink') el.props.count = 0;
    el.color = src.color;
    this.changed();
    return el;
  },

  // Element entfernen. Regeln, die seine Signale benutzen, verlieren den Bezug.
  deleteElement: function (id) {
    var els = MF.model.elements;
    var i = els.indexOf(this.findElement(id));
    if (i < 0) return false;
    els.splice(i, 1);
    MF.model.rules.forEach(function (r) {
      if (r.when && r.when.indexOf(id + '.') === 0) r.when = '';
      if (r.then && r.then.indexOf(id + '.') === 0) r.then = '';
    });
    if (this.selectedId === id) this.selectedId = null;
    this.changed();
    return true;
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

  // Liste aller Signale, z. B. "LS1.Belegt", für die Regel-Auswahl.
  signals: function (dir) {
    var out = [];
    MF.model.elements.forEach(function (el) {
      MF.types[el.type].io.forEach(function (s) {
        if (!dir || s.dir === dir) out.push(el.id + '.' + s.name);
      });
    });
    return out;
  }
};
