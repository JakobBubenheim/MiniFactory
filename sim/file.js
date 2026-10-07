// Datei: Anlage als .mfab (JSON) speichern und laden, Autosave im Browser.
//
// Gespeichert wird nur, was die Anlage beschreibt – keine Laufzeitdaten
// (el.rt), keine geforcten Ausgänge (el.force) und keine Kisten der Engine.
window.MF = window.MF || {};

(function () {
  MF.file = {
    FORMAT: 'mini-fabrik',
    VERSION: 1,
    EXT: '.mfab',
    AUTOSAVE_KEY: 'mf.autosave',
    DIRTY_KEY: 'mf.autosave.dirty',
    AUTOSAVE_MS: 1000,
    ROTATIONS: [0, 90, 180, 270],

    dirty: false,     // ungespeicherte Änderungen seit dem letzten Speichern/Laden
    handle: null,     // Datei-Handle der geöffneten Datei (File System Access API)
    loading: false,   // true, während deserialize() selbst eine Änderung meldet
    autosaveTimer: null,

    // Ab jetzt jede Änderung merken und gedrosselt in den Browser sichern.
    init: function () {
      var self = this;
      MF.store.on(function (reason) {
        if (reason !== 'change' || self.loading) return;
        self.setDirty(true);
        self.scheduleAutosave();
      });
      // Beim Verlassen der Seite sofort sichern, auch Zoom und Verschiebung
      window.addEventListener('pagehide', function () { self.autosave(); });
    },

    // ---------- Modell -> Datei ----------

    serialize: function () {
      var m = MF.model;
      return {
        format: this.FORMAT,
        version: this.VERSION,
        name: m.name,
        settings: { dtMs: m.settings.dtMs, cellM: m.settings.cellM },
        elements: m.elements.map(function (el) {
          var props = clone(el.props);
          if (el.type === 'sink') props.count = 0;   // Zählerstand gehört zur Laufzeit
          return {
            id: el.id, type: el.type, name: el.name, group: el.group,
            x: el.x, y: el.y, w: el.w, h: el.h, rot: el.rot || 0,
            props: props,
            inputs: clone(el.inputs || {}),
            look: { color: el.color, visible: el.visible !== false, locked: !!el.locked }
          };
        }),
        rules: m.rules.map(function (r) {
          return { id: r.id, name: r.name, when: r.when || '', then: r.then || '' };
        }),
        view: {
          zoom: MF.sim.zoom, panX: MF.sim.offsetX, panY: MF.sim.offsetY,
          grid: MF.sim.showGrid, tags: MF.sim.showTags
        }
      };
    },

    // ---------- Prüfen ----------

    // Gibt eine Liste deutscher Fehlertexte zurück; leer = Datei ist in Ordnung.
    validate: function (obj) {
      var errors = [];
      if (!isObject(obj)) return ['Die Datei enthält keine Mini-Fabrik-Anlage.'];
      if (obj.format !== this.FORMAT) errors.push('Unbekanntes Dateiformat – erwartet wird "' + this.FORMAT + '".');
      if (typeof obj.version !== 'number' || obj.version < 1 || obj.version !== Math.round(obj.version)) {
        errors.push('Ungültige Versionsnummer.');
      } else if (obj.version > this.VERSION) {
        errors.push('Die Datei stammt aus einer neueren Version (' + obj.version + '), unterstützt wird bis ' + this.VERSION + '.');
      }
      if (errors.length) return errors;

      if (obj.name !== undefined && typeof obj.name !== 'string') errors.push('Der Anlagenname muss ein Text sein.');

      var s = obj.settings;
      if (s !== undefined) {
        if (!isObject(s)) errors.push('"settings" muss ein Objekt sein.');
        else {
          if (s.dtMs !== undefined && !(isNum(s.dtMs) && s.dtMs > 0 && s.dtMs === Math.round(s.dtMs))) errors.push('Zeitschritt (dtMs) muss eine ganze Zahl > 0 sein.');
          if (s.cellM !== undefined && !(isNum(s.cellM) && s.cellM > 0)) errors.push('Rasterzelle (cellM) muss eine Zahl > 0 sein.');
        }
      }

      var ids = {};
      function checkId(id, what) {
        if (typeof id !== 'string' || !id) { errors.push(what + ': ID fehlt.'); return false; }
        if (ids[id]) errors.push('Doppelte ID "' + id + '".');
        ids[id] = true;
        return true;
      }

      if (!Array.isArray(obj.elements)) errors.push('Die Liste der Elemente fehlt.');
      else obj.elements.forEach(function (el, i) {
        var what = 'Element ' + (i + 1);
        if (!isObject(el)) { errors.push(what + ' ist kein Objekt.'); return; }
        if (checkId(el.id, what)) what = 'Element "' + el.id + '"';
        if (!MF.types.hasOwnProperty(el.type)) errors.push(what + ': unbekannter Typ "' + el.type + '".');
        ['x', 'y', 'w', 'h'].forEach(function (k) {
          if (!isNum(el[k])) errors.push(what + ': "' + k + '" fehlt oder ist keine Zahl.');
        });
        if (isNum(el.w) && el.w <= 0 || isNum(el.h) && el.h <= 0) errors.push(what + ': Breite und Höhe müssen > 0 sein.');
        if (el.rot !== undefined && MF.file.ROTATIONS.indexOf(el.rot) < 0) errors.push(what + ': Drehung muss 0, 90, 180 oder 270 sein.');
        if (el.name !== undefined && typeof el.name !== 'string') errors.push(what + ': Name muss ein Text sein.');
        if (el.group !== undefined && typeof el.group !== 'string') errors.push(what + ': Gruppe muss ein Text sein.');
        if (el.props !== undefined && !isObject(el.props)) errors.push(what + ': "props" muss ein Objekt sein.');
        if (el.inputs !== undefined && !isObject(el.inputs)) errors.push(what + ': "inputs" muss ein Objekt sein.');
        if (el.look !== undefined && !isObject(el.look)) errors.push(what + ': "look" muss ein Objekt sein.');
      });

      if (obj.rules !== undefined && !Array.isArray(obj.rules)) errors.push('"rules" muss eine Liste sein.');
      else (obj.rules || []).forEach(function (r, i) {
        var what = 'Regel ' + (i + 1);
        if (!isObject(r)) { errors.push(what + ' ist kein Objekt.'); return; }
        checkId(r.id, what);
        ['name', 'when', 'then'].forEach(function (k) {
          if (r[k] !== undefined && typeof r[k] !== 'string') errors.push(what + ': "' + k + '" muss ein Text sein.');
        });
      });

      if (obj.view !== undefined && !isObject(obj.view)) errors.push('"view" muss ein Objekt sein.');
      return errors;
    },

    // ---------- Ältere Versionen ----------

    // Je Version ein Schritt auf die nächste, z. B. 1: function (o) { ...; o.version = 2; }.
    // Bisher gibt es nur Version 1, daher noch keine Schritte.
    MIGRATIONS: {},

    migrate: function (obj) {
      if (!isObject(obj) || typeof obj.version !== 'number') return obj;
      obj = clone(obj);
      while (obj.version < this.VERSION) {
        var step = this.MIGRATIONS[obj.version];
        if (!step) break;   // validate() meldet die nicht unterstützte Version
        var v = obj.version;
        step(obj);
        if (obj.version === v) obj.version = v + 1;
      }
      return obj;
    },

    // ---------- Datei -> Modell ----------

    // Prüft, migriert und baut das Modell. Gibt { model, errors } zurück, ändert nichts.
    build: function (obj) {
      if (isObject(obj) && obj.format === this.FORMAT) obj = this.migrate(obj);
      var errors = this.validate(obj);
      if (errors.length) return { model: null, errors: errors };

      var s = obj.settings || {};
      var model = {
        name: obj.name || 'Anlage',
        settings: { dtMs: s.dtMs || 50, cellM: s.cellM || 0.5 },
        elements: obj.elements.map(function (f) {
          var t = MF.types[f.type];
          var look = f.look || {};
          var el = {
            id: f.id, type: f.type, name: f.name || f.id, group: f.group || 'Anlage',
            x: f.x, y: f.y, w: f.w, h: f.h, rot: f.rot || 0,
            props: clone(t.defaults),
            rt: {},
            color: typeof look.color === 'string' ? look.color : t.color,
            visible: look.visible !== false,
            locked: !!look.locked
          };
          // Fehlende Eigenschaften aus den Standardwerten, danach die Werte der Datei
          var props = f.props || {};
          Object.keys(props).forEach(function (k) { el.props[k] = props[k]; });
          if (el.type === 'sink') el.props.count = 0;
          // Eingänge: Startwerte des Typs, darüber die gespeicherten Werte
          MF.initIo(el);
          MF.normalizeElement(el);   // Drehung passend zur Richtung, Band ggf. hochkant
          var inputs = f.inputs || {};
          Object.keys(el.inputs).forEach(function (k) {
            if (isNum(inputs[k])) el.inputs[k] = inputs[k];
          });
          return el;
        }),
        rules: (obj.rules || []).map(function (r) {
          return { id: r.id, name: r.name || r.id, when: r.when || '', then: r.then || '' };
        })
      };
      return { model: model, errors: [], view: isObject(obj.view) ? obj.view : null };
    },

    // Ersetzt MF.model komplett. Bei ungültiger Datei bleibt das alte Modell erhalten.
    // Gibt true zurück, wenn die Anlage geladen wurde.
    deserialize: function (obj) {
      var res = this.build(obj);
      if (res.errors.length) {
        this.reportErrors(res.errors);
        return false;
      }
      this.apply(res.model, res.view);
      return true;
    },

    // Neues Modell einsetzen: Engine zurück, Auswahl weg, Ansicht setzen, alles neu zeichnen.
    apply: function (model, view) {
      MF.engine.reset();
      MF.model = model;
      MF.engine.resetWorld();
      MF.engine.setDtMs(model.settings.dtMs);
      MF.store.selectedId = null;
      this.applyView(view);
      if (MF.tree) {
        MF.tree.groups().forEach(function (g) { MF.tree.expanded['grp:' + g] = true; });
      }
      this.loading = true;
      MF.store.changed();
      this.loading = false;
      // Neue Anlage: Rückgängig führt nicht zurück in die vorige
      if (MF.history) MF.history.reset();
    },

    applyView: function (view) {
      if (!view) { MF.sim.fit(); return; }
      if (isNum(view.zoom)) MF.sim.zoom = Math.max(0.25, Math.min(4, view.zoom));
      if (isNum(view.panX)) MF.sim.offsetX = view.panX;
      if (isNum(view.panY)) MF.sim.offsetY = view.panY;
      if (typeof view.grid === 'boolean') MF.sim.showGrid = view.grid;
      if (typeof view.tags === 'boolean') MF.sim.showTags = view.tags;
      if (MF.ui && MF.ui.syncToggles) MF.ui.syncToggles();
    },

    // Erste Fehler in der Statusleiste, alle in der Konsole
    reportErrors: function (errors) {
      var more = errors.length > 1 ? ' (+' + (errors.length - 1) + ' weitere)' : '';
      MF.ui.message('Datei nicht geladen: ' + errors[0] + more);
      if (window.console) console.warn('Mini-Fabrik: Datei ungültig\n- ' + errors.join('\n- '));
    },

    // ---------- Neu, Öffnen, Speichern ----------

    confirmDiscard: function () {
      return !this.dirty || window.confirm('Ungespeicherte Änderungen gehen verloren. Fortfahren?');
    },

    newPlant: function () {
      if (!this.confirmDiscard()) return;
      this.deserialize({ format: this.FORMAT, version: this.VERSION, name: 'Neue Anlage', elements: [], rules: [] });
      this.handle = null;
      this.setDirty(false);
      MF.ui.message('Neue Anlage angelegt.');
    },

    // Text einer Datei laden. name dient nur der Meldung.
    loadText: function (text, name, handle) {
      var obj;
      try { obj = JSON.parse(text); } catch (e) {
        MF.ui.message('Datei nicht geladen: "' + name + '" ist keine gültige JSON-Datei.');
        return false;
      }
      if (!this.deserialize(obj)) return false;
      this.handle = handle || null;
      this.setDirty(false);
      MF.ui.message('"' + name + '" geladen.');
      return true;
    },

    open: function () {
      if (!this.confirmDiscard()) return;
      var self = this;
      // Mit File System Access API: Handle merken, damit Speichern die Datei überschreibt
      if (window.showOpenFilePicker) {
        window.showOpenFilePicker({ types: [this.pickerType()] }).then(function (handles) {
          var h = handles[0];
          return h.getFile().then(function (f) {
            return f.text().then(function (text) { self.loadText(text, f.name, h); });
          });
        }).catch(function (e) {
          if (e && e.name !== 'AbortError') MF.ui.message('Öffnen fehlgeschlagen: ' + e.message);
        });
        return;
      }
      // Ohne accept-Filter: Safari kennt die Endung .mfab nicht und graut die Datei
      // sonst aus. Falsche Dateien fängt validate() ab.
      var input = document.createElement('input');
      input.type = 'file';
      input.style.display = 'none';
      document.body.appendChild(input);   // Safari meldet "change" nur zuverlässig im DOM
      function remove() { if (input.parentNode) input.parentNode.removeChild(input); }
      input.addEventListener('cancel', remove);
      input.addEventListener('change', function () {
        remove();
        var f = input.files && input.files[0];
        if (!f) return;
        var reader = new FileReader();
        reader.onload = function () { self.loadText(String(reader.result), f.name, null); };
        reader.onerror = function () { MF.ui.message('Datei konnte nicht gelesen werden.'); };
        reader.readAsText(f);
      });
      input.click();
    },

    fileName: function () {
      var n = (MF.model.name || 'Anlage').replace(/[\\\/:*?"<>|]+/g, '_').trim() || 'Anlage';
      return n + this.EXT;
    },

    pickerType: function () {
      return { description: 'Mini-Fabrik-Anlage', accept: { 'application/json': [this.EXT] } };
    },

    save: function () {
      var self = this;
      var text = JSON.stringify(this.serialize(), null, 2);

      if (window.showSaveFilePicker) {
        var pick = this.handle
          ? Promise.resolve(this.handle)
          : window.showSaveFilePicker({ suggestedName: this.fileName(), types: [this.pickerType()] });
        pick.then(function (h) {
          return h.createWritable().then(function (w) {
            return w.write(text).then(function () { return w.close(); });
          }).then(function () {
            self.handle = h;
            self.setDirty(false);
            MF.ui.message('Gespeichert als "' + h.name + '".');
          });
        }).catch(function (e) {
          if (e && e.name !== 'AbortError') MF.ui.message('Speichern fehlgeschlagen: ' + e.message);
        });
        return;
      }

      // Ohne API: Download über einen unsichtbaren Link
      var blob = new Blob([text], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = this.fileName();
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      this.setDirty(false);
      MF.ui.message('Gespeichert als "' + a.download + '".');
    },

    setDirty: function (d) {
      if (this.dirty === d) return;
      this.dirty = d;
      try { localStorage.setItem(this.DIRTY_KEY, d ? '1' : '0'); } catch (e) { /* egal */ }
      if (MF.ui && MF.ui.updateStatus) MF.ui.updateStatus();
    },

    // ---------- Autosave ----------

    scheduleAutosave: function () {
      var self = this;
      if (this.autosaveTimer) return;   // höchstens einmal pro Sekunde
      this.autosaveTimer = setTimeout(function () {
        self.autosaveTimer = null;
        self.autosave();
      }, this.AUTOSAVE_MS);
    },

    autosave: function () {
      try { localStorage.setItem(this.AUTOSAVE_KEY, JSON.stringify(this.serialize())); } catch (e) { /* egal */ }
    },

    // Gesicherte Anlage beim Start laden. Gibt die Ansicht zurück (oder null),
    // false, wenn nichts Brauchbares gesichert war.
    restoreAutosave: function () {
      var text = null, dirty = false;
      try {
        text = localStorage.getItem(this.AUTOSAVE_KEY);
        dirty = localStorage.getItem(this.DIRTY_KEY) === '1';
      } catch (e) { return false; }
      if (!text) return false;
      var obj;
      try { obj = JSON.parse(text); } catch (e) { return false; }
      var res = this.build(obj);
      if (res.errors.length) return false;
      MF.model = res.model;
      this.dirty = dirty;
      return { view: res.view };
    }
  };

  // Kleine Helfer, nur in dieser Datei sichtbar
  function isObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
})();
