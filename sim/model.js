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
//
// Strukturbaum: folders sind frei anlegbare Ordner. Ordner, Elemente und Regeln
// hängen über "parent" an einem Ordner (Ordner-ID) oder direkt unter "Anlage"
// bzw. "Logik" (null). Ordner gehören zu einem Bereich (area: 'plant' | 'logic').
// Die Reihenfolge der Geschwister ist die Reihenfolge in den Arrays; im Baum
// stehen Ordner vor den Elementen bzw. Regeln derselben Ebene.
MF.model = {
  name: 'Beispielanlage',
  settings: {
    dtMs: 50,     // Zeitschritt der Simulation in Millisekunden
    cellM: 0.5    // Kantenlänge einer Rasterzelle in Metern
  },
  folders: [
    { id: 'F1', name: 'Förderstrecke 1', parent: null, area: 'plant' },
    { id: 'F2', name: 'Ausschleusung',   parent: 'F1', area: 'plant' }
  ],
  elements: [
    { id: 'Q1',  type: 'source',   name: 'Quelle 1',      parent: 'F1', x: 2,  y: 4, w: 1, h: 1,
      props: { interval: 2, maxCount: 0, enabled: true } },
    { id: 'B1',  type: 'conveyor', name: 'Förderband 1',  parent: 'F1', x: 3,  y: 4, w: 9, h: 1,
      props: { running: true, speed: 0.5, direction: 'rechts' } },
    { id: 'LS1', type: 'sensor',   name: 'Lichtschranke 1', parent: 'F1', x: 9, y: 4, w: 1, h: 1,
      props: { invert: false, debounce: 0 } },
    { id: 'S1',  type: 'pusher',   name: 'Schieber 1',    parent: 'F1', x: 9,  y: 3, w: 1, h: 1,
      props: { stroke: 600, speed: 0.3, returnDelay: 0.5, direction: 'unten' } },
    { id: 'SE1', type: 'sink',     name: 'Senke 1',       parent: 'F1', x: 12, y: 4, w: 1, h: 1,
      props: { count: 0 } },
    { id: 'SE2', type: 'sink',     name: 'Senke 2',       parent: 'F2', x: 9,  y: 5, w: 1, h: 1,
      props: { count: 0 } }
  ],
  rules: [
    { id: 'R1', name: 'Regel 1', parent: null, kind: 'rule', when: 'LS1.Belegt', then: 'S1.Ausfahren', enabled: true,
      description: 'Kiste an der Lichtschranke wird nach Senke 2 ausgeschleust.' }
  ]
};

// Eingangssignale auf ihre Startwerte, keine geforcten Ausgänge.
// Eingänge mit prop (z. B. Tempo) sind direkt an eine Eigenschaft gekoppelt.
// inputs: von Hand oder von Regeln geschriebene Eingänge, z. B. { Ein: 1 }
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
  // parent: Ordner-ID oder null (direkt unter "Anlage")
  createElement: function (type, x, y, parent) {
    var t = MF.types[type];
    var next = this.nextId(t.prefix);
    var el = {
      id: next.id, type: type, name: t.label + ' ' + next.n, parent: parent || null,
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

  // Kopie mit neuer ID, eine Zelle versetzt; steht im Baum direkt hinter dem Original
  duplicateElement: function (id) {
    var src = this.findElement(id);
    if (!src) return null;
    var el = this.createElement(src.type, src.x + 1, src.y + 1, src.parent);
    this.placeAfter(MF.model.elements, el, src);
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
  // 3D-Umbau dürfen dort auch Körper-IDs stehen (Kopplung). Alle Funktionen
  // fragen deshalb über parentOf()/childrenOf() und nicht direkt nach Ordnern.

  AREAS: { plant: 'Anlage', logic: 'Logik' },

  findFolder: function (id) {
    var fs = MF.model.folders || [];
    for (var i = 0; i < fs.length; i++) if (fs[i].id === id) return fs[i];
    return null;
  },

  // Elemente bzw. Regeln eines Bereichs
  itemsOf: function (area) {
    return area === 'logic' ? MF.model.rules : MF.model.elements;
  },

  // Knoten im Baum: { kind: 'folder'|'element'|'rule', obj, area } oder null
  findNode: function (id) {
    var o;
    if ((o = this.findFolder(id))) return { kind: 'folder', obj: o, area: o.area };
    if ((o = this.findElement(id))) return { kind: 'element', obj: o, area: 'plant' };
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

  // Elemente bzw. Regeln in Baum-Reihenfolge (Tiefensuche: erst die Ordner einer
  // Ebene mit ihrem ganzen Inhalt, dann die Elemente/Regeln dieser Ebene).
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
  // Ordner werden unter den Ordnern, Elemente/Regeln unter ihresgleichen einsortiert.
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
    MF.model.elements.forEach(function (el) {
      MF.types[el.type].io.forEach(function (s) {
        if (!dir || s.dir === dir) out.push(el.id + '.' + s.name);
      });
    });
    return out;
  }
};
