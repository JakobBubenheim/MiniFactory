// Modell: Elementtypen, Beispielanlage und zentrale Auswahl.
// Baum, Eigenschaften und Canvas lesen alle aus diesem einen Zustand.
window.MF = window.MF || {};

// Beschreibung der fünf Elementtypen: Eigenschaften und Signale (I/O).
MF.types = {
  source: {
    label: 'Quelle', icon: 'i-source', prefix: 'Q', size: [1, 1], color: '#D9701A',
    defaults: { interval: 2, maxCount: 0, enabled: true },
    props: [
      { key: 'interval', label: 'Takt', type: 'number', unit: 's', step: 0.1, min: 0.1 },
      { key: 'maxCount', label: 'Max. Anzahl', type: 'number', step: 1, min: 0 },
      { key: 'enabled', label: 'Aktiv', type: 'bool' }
    ],
    io: [
      { name: 'Freigabe', dir: 'in', type: 'BOOL' },
      { name: 'Erzeugt', dir: 'out', type: 'INT32' }
    ]
  },
  conveyor: {
    label: 'Förderband', icon: 'i-conveyor', prefix: 'B', size: [4, 1], color: '#1B2430',
    defaults: { speed: 0.5, direction: 'rechts' },
    props: [
      { key: 'speed', label: 'Tempo', type: 'number', unit: 'm/s', step: 0.1, min: 0 },
      { key: 'direction', label: 'Richtung', type: 'select', options: ['rechts', 'links', 'oben', 'unten'] }
    ],
    io: [
      { name: 'Ein', dir: 'in', type: 'BOOL' },
      { name: 'Läuft', dir: 'out', type: 'BOOL' },
      { name: 'Tempo', dir: 'out', type: 'FLOAT32' }
    ]
  },
  sensor: {
    label: 'Lichtschranke', icon: 'i-sensor', prefix: 'LS', size: [1, 1], color: '#1B2430',
    defaults: { invert: false, debounce: 0 },
    props: [
      { key: 'invert', label: 'Invertieren', type: 'bool' },
      { key: 'debounce', label: 'Entprellzeit', type: 'number', unit: 'ms', step: 10, min: 0 }
    ],
    io: [
      { name: 'Belegt', dir: 'out', type: 'BOOL' }
    ]
  },
  pusher: {
    label: 'Schieber', icon: 'i-pusher', prefix: 'S', size: [1, 1], color: '#1B2430',
    defaults: { stroke: 400, speed: 0.3, returnDelay: 0.5 },
    props: [
      { key: 'stroke', label: 'Hub', type: 'number', unit: 'mm', step: 10, min: 0 },
      { key: 'speed', label: 'Tempo', type: 'number', unit: 'm/s', step: 0.1, min: 0 },
      { key: 'returnDelay', label: 'Rückfahrverzug', type: 'number', unit: 's', step: 0.1, min: 0 }
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
      { key: 'count', label: 'Zählerstand', type: 'number', readonly: true }
    ],
    io: [
      { name: 'Reset', dir: 'in', type: 'BOOL' },
      { name: 'Anzahl', dir: 'out', type: 'INT32' }
    ]
  }
};

// Beispielanlage, damit Baum und Eigenschaften etwas zeigen.
// Positionen und Größen in Rasterzellen.
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
      props: { speed: 0.5, direction: 'rechts' } },
    { id: 'LS1', type: 'sensor',   name: 'Lichtschranke 1', group: 'Förderstrecke 1', x: 8, y: 4, w: 1, h: 1,
      props: { invert: false, debounce: 0 } },
    { id: 'S1',  type: 'pusher',   name: 'Schieber 1',    group: 'Förderstrecke 1', x: 9,  y: 3, w: 1, h: 1,
      props: { stroke: 400, speed: 0.3, returnDelay: 0.5 } },
    { id: 'SE1', type: 'sink',     name: 'Senke 1',       group: 'Förderstrecke 1', x: 12, y: 4, w: 1, h: 1,
      props: { count: 0 } },
    { id: 'SE2', type: 'sink',     name: 'Senke 2',       group: 'Ausschleusung',   x: 9,  y: 6, w: 1, h: 1,
      props: { count: 0 } }
  ],
  rules: [
    { id: 'R1', name: 'Regel 1', when: 'LS1.Belegt', then: 'S1.Ausfahren' }
  ]
};

// Standardwerte für Darstellung und Laufzeitdaten (rt = runtime)
MF.model.elements.forEach(function (el) {
  el.rt = {};
  el.visible = true;
  el.locked = false;
  el.color = MF.types[el.type].color;
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
      x: x, y: y, w: t.size[0], h: t.size[1],
      props: JSON.parse(JSON.stringify(t.defaults)),
      rt: {}, visible: true, locked: false, color: t.color
    };
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
