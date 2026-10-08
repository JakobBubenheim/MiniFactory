// Verlauf: Rückgängig / Wiederholen über Schnappschüsse des Modells.
// - Nach jeder Modelländerung (MF.store.changed) wird ein Schnappschuss abgelegt,
//   wenn er sich vom aktuellen unterscheidet.
// - Änderungen kurz hintereinander (Tippen, Ziehen) ergeben einen Eintrag.
// - Zurückholen setzt weder die Simulation zurück noch löscht es Kisten:
//   Laufzeitdaten (el.rt, Zählerstand der Senken) bleiben erhalten.
window.MF = window.MF || {};

MF.history = {
  MERGE_MS: 500,    // Änderungen innerhalb dieser Zeit ergeben einen Eintrag
  MAX: 100,         // höchstens so viele Einträge

  entries: [],      // Schnappschüsse als JSON-Text, ältester zuerst
  pos: 0,           // Index des Eintrags, der dem Modell entspricht
  lastTime: 0,      // Zeitpunkt der letzten aufgezeichneten Änderung
  canMerge: false,  // darf die nächste Änderung den aktuellen Eintrag ersetzen?
  restoring: false, // true, während undo/redo selbst MF.store.changed() auslöst

  init: function () {
    var self = this;
    this.reset();
    MF.store.on(function (reason) {
      if (reason === 'change' && !self.restoring) self.record();
    });
    this.initKeys();
  },

  // Verlauf leeren, aktueller Stand ist der Ausgangspunkt (Neu / Öffnen).
  reset: function () {
    this.entries = [this.snapshot()];
    this.pos = 0;
    this.canMerge = false;
    this.updateButtons();
  },

  // ---------- Schnappschuss ----------

  // Modell ohne Ansicht und ohne Laufzeitwerte, als JSON-Text.
  snapshot: function () {
    var data;
    if (MF.file && MF.file.serialize) {
      data = MF.file.serialize();
      if (typeof data === 'string') data = JSON.parse(data);
      else data = JSON.parse(JSON.stringify(data));
      delete data.view;
      // Dateiformat (look) zurück in die flachen Felder des Modells
      (data.elements || []).forEach(function (el) {
        var look = el.look || {};
        el.color = look.color; el.visible = look.visible; el.locked = look.locked;
        delete el.look;
      });
    } else {
      data = {
        name: MF.model.name,
        settings: MF.model.settings,
        folders: MF.model.folders,
        elements: MF.model.elements,
        rules: MF.model.rules
      };
      data = JSON.parse(JSON.stringify(data));
    }
    // Laufzeitwerte, die die Engine ändert, gehören nicht in den Verlauf
    (data.elements || []).forEach(function (el) {
      delete el.rt;
      if (el.type === 'sink' && el.props) delete el.props.count;
    });
    return JSON.stringify(data);
  },

  // Nach einer Änderung: neuen Eintrag ablegen oder den letzten ersetzen.
  record: function () {
    var snap = this.snapshot();
    if (snap === this.entries[this.pos]) return;
    var now = Date.now();

    if (this.canMerge && this.pos > 0 && now - this.lastTime < this.MERGE_MS) {
      this.entries[this.pos] = snap;
    } else {
      this.entries.length = this.pos + 1;   // Wiederholen-Zweig verwerfen
      this.entries.push(snap);
      if (this.entries.length > this.MAX) this.entries.shift();
      this.pos = this.entries.length - 1;
    }
    this.lastTime = now;
    this.canMerge = true;
    this.updateButtons();
  },

  // ---------- Rückgängig / Wiederholen ----------

  canUndo: function () { return this.pos > 0; },
  canRedo: function () { return this.pos < this.entries.length - 1; },

  undo: function () {
    if (!this.canUndo()) { MF.ui.message('Nichts zum Rückgängigmachen.'); return; }
    if (this.go(this.pos - 1)) MF.ui.message('Rückgängig gemacht.');
  },

  redo: function () {
    if (!this.canRedo()) { MF.ui.message('Nichts zum Wiederholen.'); return; }
    if (this.go(this.pos + 1)) MF.ui.message('Wiederholt.');
  },

  go: function (pos) {
    var data = JSON.parse(this.entries[pos]);
    // Der Zeitschritt lässt sich nur in der Pause ändern
    var dtMs = data.settings && data.settings.dtMs;
    if (dtMs && dtMs !== MF.model.settings.dtMs && MF.engine.state === 'running') {
      MF.ui.message('Dieser Schritt ändert den Zeitschritt – nur in der Pause möglich.');
      return false;
    }
    this.pos = pos;
    this.canMerge = false;
    this.apply(data);
    this.updateButtons();
    return true;
  },

  // Schnappschuss ins Modell übernehmen. Vorhandene Objekte werden weiterverwendet,
  // damit Verweise darauf (Engine, offene Eingaben) gültig bleiben.
  apply: function (data) {
    var model = MF.model;
    if (data.name !== undefined) model.name = data.name;

    if (data.settings) {
      Object.keys(data.settings).forEach(function (k) {
        if (k === 'dtMs') { if (data.settings.dtMs !== model.settings.dtMs) MF.engine.setDtMs(data.settings.dtMs); }
        else model.settings[k] = data.settings[k];
      });
    }

    var old = {};
    model.elements.forEach(function (el) { old[el.id] = el; });
    model.elements = (data.elements || []).map(function (src) {
      var el = old[src.id];
      var rt = el ? el.rt : {};
      var count = el && el.type === 'sink' ? el.props.count : 0;
      el = this.assign(el || {}, src);
      el.rt = rt || {};
      if (!el.force) el.force = {};
      if (el.type === 'sink') el.props.count = count || 0;
      return el;
    }, this);

    // Ordner (Strukturbaum): vorhandene Objekte weiterverwenden
    var oldFolders = {};
    (model.folders || []).forEach(function (f) { oldFolders[f.id] = f; });
    model.folders = (data.folders || []).map(function (src) {
      return this.assign(oldFolders[src.id] || {}, src);
    }, this);

    var oldRules = {};
    model.rules.forEach(function (r) { oldRules[r.id] = r; });
    model.rules = (data.rules || []).map(function (src) {
      return this.assign(oldRules[src.id] || {}, src);
    }, this);

    // Auswahl nur behalten, wenn es den Knoten noch gibt
    var id = MF.store.selectedId;
    var keep = !id || id === 'project' || id === 'plant' || id === 'logic' ||
      MF.store.findNode(id);
    if (!keep) MF.store.selectedId = null;

    this.restoring = true;
    try { MF.store.changed(); } finally { this.restoring = false; }
    MF.ui.updateSimStatus();
  },

  // Alle Felder von src übernehmen, übrige (außer rt und force) entfernen
  assign: function (target, src) {
    Object.keys(target).forEach(function (k) {
      if (k !== 'rt' && k !== 'force' && !(k in src)) delete target[k];
    });
    Object.keys(src).forEach(function (k) { target[k] = src[k]; });
    return target;
  },

  // ---------- Buttons und Tastatur ----------

  updateButtons: function () {
    var undos = this.pos;
    var redos = this.entries.length - 1 - this.pos;
    document.querySelectorAll('[data-action="undo"]').forEach(function (b) {
      b.disabled = undos === 0;
      b.title = 'Rückgängig (Strg+Z) – ' + (undos === 1 ? '1 Schritt' : undos + ' Schritte');
    });
    document.querySelectorAll('[data-action="redo"]').forEach(function (b) {
      b.disabled = redos === 0;
      b.title = 'Wiederholen (Strg+Y) – ' + (redos === 1 ? '1 Schritt' : redos + ' Schritte');
    });
  },

  // Strg+Z, Strg+Y, Strg+Shift+Z – nicht in Eingabefeldern, dort gilt das Undo des Browsers
  initKeys: function () {
    var self = this;
    document.addEventListener('keydown', function (e) {
      var t = e.target;
      if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      var k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) self.undo();
      else if (k === 'y' || (k === 'z' && e.shiftKey)) self.redo();
      else return;
      e.preventDefault();
    });
  }
};
