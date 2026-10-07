// Modell: Elementtypen, Beispielanlage und zentrale Auswahl.
// Baum, Eigenschaften und Canvas lesen alle aus diesem einen Zustand.
window.MF = window.MF || {};

// Beschreibung der fünf Elementtypen: Eigenschaften und Signale (I/O).
MF.types = {
  source: {
    label: 'Quelle', icon: 'i-source',
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
    label: 'Förderband', icon: 'i-conveyor',
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
    label: 'Lichtschranke', icon: 'i-sensor',
    props: [
      { key: 'invert', label: 'Invertieren', type: 'bool' },
      { key: 'debounce', label: 'Entprellzeit', type: 'number', unit: 'ms', step: 10, min: 0 }
    ],
    io: [
      { name: 'Belegt', dir: 'out', type: 'BOOL' }
    ]
  },
  pusher: {
    label: 'Schieber', icon: 'i-pusher',
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
    label: 'Senke', icon: 'i-sink',
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
  el.color = el.type === 'source' ? '#D9701A' : '#1B2430';
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
