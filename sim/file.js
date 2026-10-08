// Datei: Anlage als .mfab (JSON) speichern und laden, Autosave im Browser.
//
// Gespeichert wird nur, was die Anlage beschreibt – keine Laufzeitdaten
// (body.rt, Rapier-Handles, Zählerstände), keine geforcten Ausgänge (body.force)
// und keine Kisten der Engine. Ältere Dateien (Version 1 und 2, Raster in Zellen)
// werden beim Laden mit migrate() umgerechnet, auch ein alter Autosave.
window.MF = window.MF || {};

(function () {
  MF.file = {
    FORMAT: 'mini-fabrik',
    VERSION: 3,     // 2: Ordner im Strukturbaum; 3: Körper in Metern (3D-Physik)
    EXT: '.mfab',
    AUTOSAVE_KEY: 'mf.autosave',
    DIRTY_KEY: 'mf.autosave.dirty',
    AUTOSAVE_MS: 1000,

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

    // Körper ohne Laufzeitdaten (rt, force), Felder in fester Reihenfolge
    BODY_KEYS: ['id', 'name', 'parent', 'template', 'kind', 'shape', 'pose', 'material',
      'surface', 'axis', 'sensor', 'spawner', 'sink', 'inputs', 'look'],

    serializeBody: function (b) {
      var out = {};
      this.BODY_KEYS.forEach(function (k) {
        var v = b[k];
        out[k] = v === undefined ? null : clone(v);
      });
      out.parent = b.parent || null;
      out.template = b.template || null;
      return out;
    },

    serialize: function () {
      var m = MF.model, s = m.settings, self = this;
      return {
        format: this.FORMAT,
        version: this.VERSION,
        name: m.name,
        settings: { dtMs: s.dtMs, gravity: s.gravity, snap: clone(s.snap) },
        folders: (m.folders || []).map(function (f) {
          return { id: f.id, name: f.name, parent: f.parent || null, area: f.area };
        }),
        bodies: m.bodies.map(function (b) { return self.serializeBody(b); }),
        rules: m.rules.map(function (r) {
          var out = {
            id: r.id, name: r.name, parent: r.parent || null, kind: r.kind === 'scl' ? 'scl' : 'rule',
            enabled: r.enabled !== false, description: r.description || '',
            when: r.when || '', then: r.then || ''
          };
          if (r.code) out.code = r.code;
          return out;
        }),
        view: {
          zoom: MF.sim.zoom, panX: MF.sim.offsetX, panY: MF.sim.offsetY,
          grid: MF.sim.showGrid, tags: MF.sim.showTags,
          folded: MF.tree ? MF.tree.foldedIds() : [],   // zugeklappte Ordner
          camera3d: MF.view3d ? MF.view3d.cameraData() : null   // 3D-Kamera { pos, target } oder null
        }
      };
    },

    // ---------- Prüfen ----------

    KINDS: ['ghost', 'static', 'kinematic', 'dynamic'],

    // Gibt eine Liste deutscher Fehlertexte zurück; leer = Datei ist in Ordnung.
    // Ältere Versionen erst mit migrate() anheben.
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
      // Ältere Versionen werden geprüft, wie sie nach dem Umrechnen aussehen
      if (obj.version < this.VERSION) {
        obj = this.migrate(obj);
        if (obj.version !== this.VERSION) return ['Version ' + obj.version + ' lässt sich nicht umrechnen.'];
      }

      if (obj.name !== undefined && typeof obj.name !== 'string') errors.push('Der Anlagenname muss ein Text sein.');

      var s = obj.settings;
      if (s !== undefined) {
        if (!isObject(s)) errors.push('"settings" muss ein Objekt sein.');
        else {
          if (s.dtMs !== undefined && !(isNum(s.dtMs) && s.dtMs > 0 && s.dtMs === Math.round(s.dtMs))) errors.push('Zeitschritt (dtMs) muss eine ganze Zahl > 0 sein.');
          if (s.gravity !== undefined && !isNum(s.gravity)) errors.push('Schwerkraft (gravity) muss eine Zahl sein.');
          if (s.snap !== undefined && !(isObject(s.snap) && (s.snap.pos === undefined || isNum(s.snap.pos) && s.snap.pos > 0) &&
              (s.snap.angle === undefined || isNum(s.snap.angle) && s.snap.angle > 0))) errors.push('"snap" muss { on, pos > 0, angle > 0 } sein.');
        }
      }

      var ids = {};
      function checkId(id, what) {
        if (typeof id !== 'string' || !id) { errors.push(what + ': ID fehlt.'); return false; }
        if (ids[id]) errors.push('Doppelte ID "' + id + '".');
        ids[id] = true;
        return true;
      }

      // Ordner: IDs, Bereich, Eltern und Zyklen
      var folders = {};
      if (obj.folders !== undefined && !Array.isArray(obj.folders)) errors.push('"folders" muss eine Liste sein.');
      else (obj.folders || []).forEach(function (f, i) {
        var what = 'Ordner ' + (i + 1);
        if (!isObject(f)) { errors.push(what + ' ist kein Objekt.'); return; }
        if (checkId(f.id, what)) { what = 'Ordner "' + f.id + '"'; folders[f.id] = f; }
        if (typeof f.name !== 'string') errors.push(what + ': Name muss ein Text sein.');
        if (f.area !== 'plant' && f.area !== 'logic') errors.push(what + ': Bereich (area) muss "plant" oder "logic" sein.');
      });
      // parent muss null/fehlend oder ein Ordner desselben Bereichs sein
      function checkParent(o, area, what) {
        if (o.parent === undefined || o.parent === null) return;
        if (typeof o.parent !== 'string' || !folders.hasOwnProperty(o.parent)) {
          errors.push(what + ': Ordner "' + o.parent + '" gibt es nicht.');
        } else if (folders[o.parent].area !== area) {
          errors.push(what + ': Ordner "' + o.parent + '" liegt im falschen Bereich.');
        }
      }
      Object.keys(folders).forEach(function (id) {
        var f = folders[id];
        checkParent(f, f.area, 'Ordner "' + id + '"');
        // Zyklus: den Eltern folgen, bis null oder wieder bei id
        var seen = {}, p = f.parent;
        while (typeof p === 'string' && folders.hasOwnProperty(p) && !seen[p]) {
          if (p === id) { errors.push('Ordner "' + id + '" liegt (über Umwege) in sich selbst.'); break; }
          seen[p] = true;
          p = folders[p].parent;
        }
      });

      var self = this;
      // Körper nach ID, für die Kopplung (parent = Körper-ID)
      var bodies = {};
      (Array.isArray(obj.bodies) ? obj.bodies : []).forEach(function (b) {
        if (isObject(b) && typeof b.id === 'string' && !folders.hasOwnProperty(b.id)) bodies[b.id] = b;
      });
      if (!Array.isArray(obj.bodies)) errors.push('Die Liste der Körper fehlt.');
      else obj.bodies.forEach(function (b, i) {
        var what = 'Körper ' + (i + 1);
        if (!isObject(b)) { errors.push(what + ' ist kein Objekt.'); return; }
        if (checkId(b.id, what)) what = 'Körper "' + b.id + '"';
        if (b.name !== undefined && typeof b.name !== 'string') errors.push(what + ': Name muss ein Text sein.');
        if (typeof b.parent === 'string' && bodies.hasOwnProperty(b.parent)) self.checkCoupling(b, bodies, what, errors);
        else checkParent(b, 'plant', what);
        if (b.template !== undefined && b.template !== null && !MF.templates.hasOwnProperty(b.template)) {
          errors.push(what + ': unbekannte Vorlage "' + b.template + '".');
        }
        if (self.KINDS.indexOf(b.kind) < 0) errors.push(what + ': Körperart (kind) muss ghost, static, kinematic oder dynamic sein.');
        self.checkShape(b.shape, what, errors);
        if (isObject(b.shape) && isNum(b.shape.h) && isNum(b.shape.h2) && MF.geom.isSloped(b.shape)) {
          if (b.kind !== 'static') errors.push(what + ': Neigung (h2) gibt es nur bei Körperart "static".');
          if (isObject(b.surface)) errors.push(what + ': Transportfläche auf geneigter Oberseite ist nicht möglich.');
        }
        if (!isObject(b.pose)) errors.push(what + ': Lage (pose) fehlt.');
        else ['x', 'y', 'z', 'rot'].forEach(function (k) {
          if (!isNum(b.pose[k])) errors.push(what + ': Lage "' + k + '" fehlt oder ist keine Zahl.');
        });
        if (b.material !== undefined && b.material !== null) {
          if (!isObject(b.material)) errors.push(what + ': "material" muss ein Objekt sein.');
          else ['friction', 'restitution', 'density'].forEach(function (k) {
            if (b.material[k] !== undefined && !(isNum(b.material[k]) && b.material[k] >= 0)) errors.push(what + ': Werkstoff "' + k + '" muss eine Zahl ≥ 0 sein.');
          });
        }
        MF.FN_KEYS.forEach(function (fn) {
          var v = b[fn];
          if (v === undefined || v === null) return;
          if (!isObject(v)) { errors.push(what + ': "' + fn + '" muss ein Objekt oder null sein.'); return; }
          if (MF.FUNCTIONS[fn].kinds.indexOf(b.kind) < 0) {
            errors.push(what + ': ' + MF.FUNCTIONS[fn].label + ' ist bei Körperart "' + b.kind + '" nicht erlaubt.');
          }
        });
        if (isObject(b.axis)) self.checkAxis(b.axis, what, errors);
        if (b.inputs !== undefined && b.inputs !== null && !isObject(b.inputs)) errors.push(what + ': "inputs" muss ein Objekt sein.');
        if (b.look !== undefined && b.look !== null && !isObject(b.look)) errors.push(what + ': "look" muss ein Objekt sein.');
      });

      if (obj.rules !== undefined && !Array.isArray(obj.rules)) errors.push('"rules" muss eine Liste sein.');
      else (obj.rules || []).forEach(function (r, i) {
        var what = 'Regel ' + (i + 1);
        if (!isObject(r)) { errors.push(what + ' ist kein Objekt.'); return; }
        if (checkId(r.id, what)) what = 'Regel "' + r.id + '"';
        checkParent(r, 'logic', what);
        ['name', 'when', 'then', 'description', 'code'].forEach(function (k) {
          if (r[k] !== undefined && typeof r[k] !== 'string') errors.push(what + ': "' + k + '" muss ein Text sein.');
        });
        if (r.enabled !== undefined && typeof r.enabled !== 'boolean') errors.push(what + ': "enabled" muss true oder false sein.');
        if (r.kind !== undefined && r.kind !== 'rule' && r.kind !== 'scl') errors.push(what + ': "kind" muss "rule" oder "scl" sein.');
      });

      if (obj.view !== undefined && !isObject(obj.view)) errors.push('"view" muss ein Objekt sein.');
      return errors;
    },

    // Form: Rechteck (w × d), Kreis (r) oder Polygon (points), immer mit Höhe h
    checkShape: function (sh, what, errors) {
      if (!isObject(sh)) { errors.push(what + ': Form (shape) fehlt.'); return; }
      function pos(k) {
        if (!(isNum(sh[k]) && sh[k] > 0)) errors.push(what + ': Form "' + k + '" muss eine Zahl > 0 sein.');
      }
      if (sh.type === 'rect') { pos('w'); pos('d'); }
      else if (sh.type === 'circle') pos('r');
      else if (sh.type === 'polygon') {
        var ok = Array.isArray(sh.points) && sh.points.length >= 3 && sh.points.every(function (p) {
          return Array.isArray(p) && p.length === 2 && isNum(p[0]) && isNum(p[1]);
        });
        if (!ok) errors.push(what + ': Polygon braucht mindestens drei Punkte [x, y].');
        else if (MF.geom.selfIntersects(sh.points)) errors.push(what + ': Polygon schneidet sich selbst.');
        else if (Math.abs(MF.geom.signedArea(sh.points)) < 1e-9) errors.push(what + ': Polygon hat keine Fläche.');
      } else errors.push(what + ': Form muss "rect", "circle" oder "polygon" sein.');
      pos('h');
      // Neigung (Phase 3): Höhe am Ende der lokalen x-Achse, optional
      if (sh.h2 !== undefined && !(isNum(sh.h2) && sh.h2 >= 0)) errors.push(what + ': Form "h2" (Höhe am Ende) muss eine Zahl ≥ 0 sein.');
    },

    // Kopplung (Phase 4): parent ist ein anderer Körper. Kein Kreis, höchstens
    // zwei Ebenen (der Elternkörper hängt selbst nicht an einem Körper), nichts Dynamisches.
    checkCoupling: function (b, bodies, what, errors) {
      var p = bodies[b.parent];
      if (p === b) { errors.push(what + ': hängt an sich selbst.'); return; }
      if (b.kind === 'dynamic') errors.push(what + ': dynamische Körper lassen sich nicht an einen Körper koppeln.');
      if (p.kind === 'dynamic') errors.push(what + ': an den dynamischen Körper "' + p.id + '" lässt sich nichts koppeln.');
      var seen = {}, q = p, depth = 1;
      while (q && typeof q.parent === 'string' && bodies.hasOwnProperty(q.parent) && !seen[q.id]) {
        seen[q.id] = true;
        if (q.parent === b.id) { errors.push(what + ': Kopplung im Kreis (über "' + p.id + '").'); return; }
        q = bodies[q.parent];
        depth++;
      }
      if (depth >= MF.COUPLE_DEPTH) errors.push(what + ': hängt an "' + p.id + '", der selbst an einem Körper hängt – höchstens zwei Ebenen.');
    },

    // Achse (Phase 4): linear oder rotatorisch (nur um die Hochachse), Betriebsart
    // zweipunkt, position oder geschwindigkeit
    checkAxis: function (ax, what, errors) {
      if (ax.type !== 'linear' && ax.type !== 'rotary') errors.push(what + ': Achstyp muss "linear" oder "rotary" sein.');
      if (!MF.FUNCTIONS.axis.MODES.hasOwnProperty(ax.mode)) errors.push(what + ': unbekannte Betriebsart "' + ax.mode + '".');
      ['min', 'max', 'vmax', 'returnDelay'].forEach(function (k) {
        if (!isNum(ax[k])) errors.push(what + ': Achse "' + k + '" muss eine Zahl sein.');
      });
      if (isNum(ax.min) && isNum(ax.max) && ax.max < ax.min) errors.push(what + ': Achse "max" ist kleiner als "min".');
      if (isNum(ax.vmax) && ax.vmax <= 0) errors.push(what + ': Achse "vmax" muss > 0 sein.');
      ['origin', 'dir'].forEach(function (k) {
        if (!(Array.isArray(ax[k]) && ax[k].length === 3 && ax[k].every(isNum))) errors.push(what + ': Achse "' + k + '" muss [x, y, z] sein.');
      });
      if (Array.isArray(ax.dir) && ax.dir.every(isNum) && Math.abs(ax.dir[0]) + Math.abs(ax.dir[1]) + Math.abs(ax.dir[2]) < 1e-9) {
        errors.push(what + ': Achsrichtung ist null.');
      } else if (ax.type === 'rotary' && Array.isArray(ax.dir) && ax.dir.length === 3 &&
          !(Math.abs(ax.dir[0]) < 1e-9 && Math.abs(ax.dir[1]) < 1e-9)) {
        errors.push(what + ': Drehachsen gibt es nur um die Hochachse (dir = [0, 0, ±1]).');
      }
      if (isNum(ax.returnDelay) && ax.returnDelay < 0) errors.push(what + ': Achse "returnDelay" darf nicht negativ sein.');
    },

    // ---------- Ältere Versionen ----------

    // Je Version ein Schritt auf die nächste, z. B. 1: function (o) { ...; o.version = 2; }.
    MIGRATIONS: {
      // 1 -> 2: Jede Gruppe (el.group) wird ein Ordner direkt unter "Anlage",
      // in der Reihenfolge ihres ersten Auftretens. Regeln liegen direkt unter "Logik".
      1: function (o) {
        var byName = {};
        o.folders = [];
        (Array.isArray(o.elements) ? o.elements : []).forEach(function (el) {
          if (!isObject(el)) return;
          var g = typeof el.group === 'string' ? el.group.trim() : '';
          if (g && !byName[g]) {
            byName[g] = 'F' + (o.folders.length + 1);
            o.folders.push({ id: byName[g], name: g, parent: null, area: 'plant' });
          }
          el.parent = g ? byName[g] : null;
          delete el.group;
        });
        (Array.isArray(o.rules) ? o.rules : []).forEach(function (r) {
          if (isObject(r)) r.parent = null;
        });
        o.version = 2;
      },
      // 2 -> 3: Raster-Elemente werden Körper in Metern (sim/migrate.js)
      2: function (o) { MF.migrate23(o); }
    },

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
      var snap = isObject(s.snap) ? s.snap : {};
      var model = {
        name: obj.name || 'Anlage',
        settings: {
          dtMs: s.dtMs || 20,
          gravity: isNum(s.gravity) ? s.gravity : -9.81,
          snap: { on: snap.on !== false, pos: snap.pos || 0.05, angle: snap.angle || 5 }
        },
        folders: (obj.folders || []).map(function (f) {
          return { id: f.id, name: f.name, parent: f.parent || null, area: f.area };
        }),
        bodies: obj.bodies.map(function (f) { return MF.file.buildBody(f); }),
        // Ältere Dateien ohne enabled/kind: Regel ist aktiv und vom Typ Wenn-dann
        rules: (obj.rules || []).map(function (r) {
          return {
            id: r.id, name: r.name || r.id, parent: r.parent || null, kind: r.kind === 'scl' ? 'scl' : 'rule',
            enabled: r.enabled !== false, description: r.description || '',
            when: r.when || '', then: r.then || '', code: r.code || ''
          };
        })
      };
      return { model: model, errors: [], view: isObject(obj.view) ? obj.view : null };
    },

    // Körper aus der Datei: fehlende Teile aus Vorlage bzw. Standardwerten,
    // Eingänge = Startwerte, darüber die gespeicherten Werte
    buildBody: function (f) {
      var t = MF.templates[f.template];
      var look = isObject(f.look) ? f.look : {};
      var b = {
        id: f.id, name: f.name || f.id, parent: f.parent || null, template: f.template || null,
        kind: f.kind, shape: clone(f.shape), pose: clone(f.pose),
        material: clone(isObject(f.material) ? f.material : MF.MATERIALS[f.kind === 'dynamic' ? 'box' : f.kind === 'ghost' ? 'ghost' : 'steel'])
      };
      MF.FN_KEYS.forEach(function (k) { b[k] = isObject(f[k]) ? clone(f[k]) : null; });
      if (b.spawner && !isObject(b.spawner.template)) b.spawner.template = clone(MF.templates.source.make().spawner.template);
      b.look = {
        color: typeof look.color === 'string' ? look.color : (t ? t.color : '#8A93A0'),
        visible: look.visible !== false,
        locked: !!look.locked
      };
      b.rt = {};
      MF.initIo(b);
      var inputs = isObject(f.inputs) ? f.inputs : {};
      Object.keys(b.inputs).forEach(function (k) {
        if (isNum(inputs[k])) b.inputs[k] = inputs[k];
      });
      return b;
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
      MF.logic.clear();
      MF.engine.setDtMs(model.settings.dtMs);
      MF.engine.resetWorld();
      MF.store.selectedId = null;
      this.applyView(view);
      if (MF.tree) MF.tree.setFolded(view && view.folded);
      this.loading = true;
      MF.store.changed();
      this.loading = false;
      // Neue Anlage: Rückgängig führt nicht zurück in die vorige
      if (MF.history) MF.history.reset();
    },

    applyView: function (view) {
      // 3D-Kamera: gespeicherter Stand, sonst einpassen
      if (MF.view3d) MF.view3d.setCamera(view ? view.camera3d : null);
      if (!view) { MF.sim.fit(); return; }
      if (isNum(view.zoom)) MF.sim.zoom = Math.max(0.25, Math.min(4, view.zoom));
      if (isNum(view.panX)) MF.sim.offsetX = view.panX;
      if (isNum(view.panY)) MF.sim.offsetY = view.panY;
      if (typeof view.grid === 'boolean') MF.sim.showGrid = view.grid;
      if (typeof view.tags === 'boolean') MF.sim.showTags = view.tags;
      if (MF.tree && Array.isArray(view.folded)) MF.tree.setFolded(view.folded);
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
      this.deserialize({ format: this.FORMAT, version: this.VERSION, name: 'Neue Anlage',
        settings: { dtMs: 20, gravity: -9.81, snap: { on: true, pos: 0.05, angle: 5 } }, folders: [], bodies: [], rules: [] });
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
