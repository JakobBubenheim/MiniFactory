// Editor: Bedienung der Fläche mit Maus und Tastatur.
// - Vorlagen aus dem Katalog (Ribbon "Komponenten") auf die Fläche ziehen; ein
//   einfacher Klick legt den Körper in die Mitte der Ansicht.
// - Werkzeuge im Ribbon "Modell" (Kürzel V / M / D):
//   Auswählen  – Klick wählt aus, Ziehen verschiebt die Ansicht
//   Verschieben – Körper ziehen
//   Drehen     – Klick dreht den Körper um 90° im Uhrzeigersinn (um seine Lage)
//   Die Werkzeuge greifen auch, während die Simulation läuft.
// - Fangen an: Lage auf das Fangraster (settings.snap.pos, z. B. 5 cm); aus: 1 cm.
//   Das Raster ist nur Zeichenhilfe, die Simulation rechnet in Metern.
// - Löschen mit Entf/Rücktaste, Duplizieren mit Strg/Cmd+D, Strg/Cmd+G packt
//   die im Strukturbaum ausgewählten Einträge in einen neuen Ordner,
//   Pfeiltasten verschieben um einen Fangschritt (mit Shift um zehn).
// - Freie Fläche ziehen verschiebt die Ansicht, Mausrad zoomt.
// Einfügen, Löschen und Duplizieren sind gesperrt, solange die Simulation läuft.
window.MF = window.MF || {};

MF.editor = {
  DRAG_START_PX: 4,   // erst ab dieser Mausbewegung zählt es als Ziehen
  tool: 'select',     // 'select' | 'move' | 'rotate'
  FREE_STEP: 0.01,    // Schrittweite in m, wenn Fangen aus ist

  TOOLS: {
    select: { label: 'Auswählen',   key: 'v' },
    move:   { label: 'Verschieben', key: 'm' },
    rotate: { label: 'Drehen',      key: 'd' }
  },

  init: function (canvas) {
    this.canvas = canvas;
    this.initLibrary();
    this.initCanvas();
    this.initKeys();
    this.updateCursor(null);
    MF.ui.syncToggles();   // gemerktes Fangen im Ribbon anzeigen
  },

  // ---------- Werkzeug und Fangen ----------

  setTool: function (tool) {
    if (!this.TOOLS[tool] || tool === this.tool) return;
    this.tool = tool;
    this.updateCursor(null);
    MF.ui.syncToggles();
    MF.ui.message('Werkzeug: ' + this.TOOLS[tool].label + '.');
  },

  // Fangen gehört zur Anlage (settings.snap), wird aber nicht als Änderung gezählt
  get snap() { return MF.model.settings.snap.on !== false; },

  toggleSnap: function () {
    MF.model.settings.snap.on = !this.snap;
    MF.ui.syncToggles();
    MF.props.render();   // Schrittweite der X/Y-Felder
    MF.ui.message(this.snap ? 'Fangen an: Schritte von ' + MF.props.formatNumber(this.snapStep() * 100) + ' cm.'
      : 'Fangen aus: Schritte von 1 cm.');
  },

  // Schrittweite für Lagen in Metern
  snapStep: function () { return this.snap ? MF.model.settings.snap.pos || 0.05 : this.FREE_STEP; },

  // Lage auf das Fangraster bzw. auf 1 cm runden
  snapValue: function (v) {
    var step = this.snapStep();
    return Math.round(Math.round(v / step) * step * 1e6) / 1e6;
  },

  // Mauszeiger der Fläche: zeigt das Werkzeug, über gesperrten Körpern "verboten"
  ROTATE_CURSOR: 'url("data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
    '<g fill="none" stroke-width="5" stroke="#F4F2EC"><path d="M19 12a7 7 0 1 1-3-5.7"/><path d="M16.5 2.5v4h4"/></g>' +
    '<g fill="none" stroke-width="2" stroke="#1B2430"><path d="M19 12a7 7 0 1 1-3-5.7"/><path d="M16.5 2.5v4h4"/></g>' +
    '</svg>') + '") 12 12, alias',

  updateCursor: function (over) {
    var c;
    if (this.tool === 'select') c = over ? 'pointer' : 'default';
    else if (over && over.look.locked) c = 'not-allowed';
    else c = this.tool === 'move' ? 'move' : this.ROTATE_CURSOR;
    this.canvas.style.cursor = c;
  },

  // ---------- Drehen ----------

  // Körper auf eine Drehung (Grad) bringen; er dreht sich um seine Lage (pose).
  // Beim Förderband dreht die Laufrichtung mit, beim Schieber die Schubrichtung.
  setRotation: function (b, rot) {
    rot = MF.geom.normDeg(rot);
    if (rot === b.pose.rot) return false;
    if (b.look.locked) { MF.ui.message(b.name + ' ist gesperrt.'); return false; }
    b.pose.rot = rot;
    MF.store.changed();
    return true;
  },

  rotateBody: function (b) {
    if (this.setRotation(b, b.pose.rot + 90)) {
      var dir = MF.propDef(b, 'direction') ? MF.getProp(b, 'direction') : '';
      MF.ui.message(b.name + ' auf ' + MF.props.formatNumber(b.pose.rot) + '° gedreht' +
        (dir ? (b.surface ? ', läuft nach ' : ', schiebt nach ') + dir : '') + '.');
    }
  },

  // Einfügen, Löschen, Duplizieren nur, wenn die Simulation nicht läuft
  canEdit: function () {
    if (MF.engine.state !== 'running') return true;
    MF.ui.message('Zum Bearbeiten die Simulation pausieren.');
    return false;
  },

  // Ordner für neue Körper bzw. Regeln: der gewählte Ordner oder der Ordner des
  // gewählten Körpers bzw. der Regel – nur im passenden Bereich, sonst oberste Ebene.
  currentParent: function (area) {
    var t = MF.tree.target(MF.store.selectedId);
    return t && t.area === area ? t.parent : null;
  },

  canvasPos: function (e) {
    var r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, inside:
      e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom };
  },

  // Mitte (in Metern, gefangen) für einen neuen Körper unter (px, py)
  posFor: function (px, py) {
    var w = MF.sim.toWorld(px, py);
    return { x: this.snapValue(w.x), y: this.snapValue(w.y) };
  },

  // ---------- Bibliothek: Ziehen auf die Fläche ----------

  initLibrary: function () {
    var self = this;
    document.addEventListener('pointerdown', function (e) {
      var btn = e.target.closest('[data-create]');
      if (!btn || e.button !== 0) return;
      e.preventDefault();
      self.startLibraryDrag(btn, e);
    });
  },

  startLibraryDrag: function (btn, e) {
    var self = this;
    var type = btn.dataset.create;
    var t = MF.templates[type];
    var startX = e.clientX, startY = e.clientY;
    var chip = null;
    btn.setPointerCapture(e.pointerId);

    function move(ev) {
      if (!chip) {
        if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < self.DRAG_START_PX) return;
        if (!self.canEdit()) { end(); return; }
        chip = document.createElement('div');
        chip.className = 'drag-chip';
        chip.innerHTML = '<svg><use href="#' + t.icon + '"/></svg><span></span>';
        chip.querySelector('span').textContent = t.label;
        document.body.appendChild(chip);
        document.body.classList.add('is-dragging');
      }
      chip.style.left = ev.clientX + 'px';
      chip.style.top = ev.clientY + 'px';
      var p = self.canvasPos(ev);
      chip.classList.toggle('is-over-canvas', p.inside);
      MF.sim.ghost = p.inside ? self.ghostFor(type, p) : null;
      MF.sim.draw();
    }

    function up(ev) {
      var p = self.canvasPos(ev);
      if (chip) {
        if (p.inside) self.place(type, self.posFor(p.x, p.y));
        else MF.ui.message('Abgebrochen – zum Einfügen auf die Fläche ziehen.');
      } else if (self.canEdit()) {
        // Einfacher Klick: in die Mitte der Ansicht legen
        self.place(type, self.posFor(MF.sim.width / 2, MF.sim.height / 2));
      }
      end();
    }

    function end() {
      btn.removeEventListener('pointermove', move);
      btn.removeEventListener('pointerup', up);
      btn.removeEventListener('pointercancel', end);
      if (chip) chip.remove();
      chip = null;
      document.body.classList.remove('is-dragging');
      MF.sim.ghost = null;
      MF.sim.draw();
    }

    btn.addEventListener('pointermove', move);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', end);
  },

  ghostFor: function (type, p) {
    var c = this.posFor(p.x, p.y);
    return { template: type, x: c.x, y: c.y };
  },

  place: function (type, pos) {
    var b = MF.store.createBody(type, pos.x, pos.y, this.currentParent('plant'));
    MF.ui.message(b.name + ' (' + b.id + ') eingefügt.');
    return b;
  },

  // ---------- Fläche: Werkzeuge und Ansicht ziehen ----------

  initCanvas: function () {
    var self = this;
    var canvas = this.canvas;
    var drag = null;

    canvas.addEventListener('pointerdown', function (e) {
      // Fokus aus Baum oder Eingabefeld nehmen: Pfeiltasten wirken danach auf die Fläche,
      // offene Eingaben werden dabei übernommen
      if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
      var p = self.canvasPos(e);
      var hit = e.button === 0 ? MF.sim.hitTest(p.x, p.y) : null;
      if (e.button === 0) MF.store.select(hit ? hit.id : null);

      if (hit && self.tool === 'move') {
        var w = MF.sim.toWorld(p.x, p.y);
        drag = { mode: 'move', el: hit, wx: w.x, wy: w.y, ox: hit.pose.x, oy: hit.pose.y, sx: p.x, sy: p.y, active: false };
      } else {
        // Ansicht ziehen – auch über Körpern, damit Auswählen/Drehen nichts verschiebt.
        // Ein Klick ohne Ziehen dreht beim Werkzeug "Drehen" den Körper.
        drag = { mode: 'pan', sx: p.x, sy: p.y, ox: MF.sim.offsetX, oy: MF.sim.offsetY, el: hit, active: false };
      }
      canvas.setPointerCapture(e.pointerId);
    });

    canvas.addEventListener('pointermove', function (e) {
      var p = self.canvasPos(e);
      MF.ui.setCursor(MF.sim.toWorld(p.x, p.y));

      if (!drag) {
        self.updateCursor(MF.sim.hitTest(p.x, p.y));
        return;
      }

      // Erst ab kleiner Mindestbewegung zählt es als Ziehen, damit ein Klick nur auswählt
      if (!drag.active) {
        if (Math.abs(p.x - drag.sx) + Math.abs(p.y - drag.sy) < self.DRAG_START_PX) return;
        if (drag.mode === 'move' && drag.el.look.locked) { MF.ui.message(drag.el.name + ' ist gesperrt.'); drag = null; return; }
        drag.active = true;
        if (drag.mode === 'pan') canvas.style.cursor = 'grabbing';
      }

      if (drag.mode === 'pan') {
        MF.sim.offsetX = drag.ox + (p.x - drag.sx);
        MF.sim.offsetY = drag.oy + (p.y - drag.sy);
        MF.sim.draw();
        return;
      }

      var w = MF.sim.toWorld(p.x, p.y);
      var nx = self.snapValue(drag.ox + (w.x - drag.wx));
      var ny = self.snapValue(drag.oy + (w.y - drag.wy));
      if (nx !== drag.el.pose.x || ny !== drag.el.pose.y) {
        drag.el.pose.x = nx;
        drag.el.pose.y = ny;
        MF.store.changed();
      }
    });

    function end(e) {
      if (drag && drag.mode === 'move' && drag.active &&
          (drag.el.pose.x !== drag.ox || drag.el.pose.y !== drag.oy)) {
        MF.ui.message(drag.el.name + ' nach x ' + MF.props.formatNumber(drag.el.pose.x) +
          ' m, y ' + MF.props.formatNumber(drag.el.pose.y) + ' m verschoben.');
      }
      if (drag && drag.mode === 'pan' && !drag.active && drag.el && self.tool === 'rotate' && e.type === 'pointerup') {
        self.rotateBody(drag.el);
      }
      drag = null;
      var p = self.canvasPos(e);
      self.updateCursor(p.inside ? MF.sim.hitTest(p.x, p.y) : null);
    }
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    canvas.addEventListener('pointerleave', function () {
      if (!drag) MF.ui.setCursor(null);
    });

    // Mausrad / Trackpad: zoomen um den Mauszeiger
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      var p = self.canvasPos(e);
      MF.sim.setZoom(MF.sim.zoom * Math.exp(-e.deltaY * 0.0015), p.x, p.y);
      MF.ui.updateStatus();
    }, { passive: false });
  },

  // ---------- Befehle ----------

  deleteSelected: function () {
    var id = MF.store.selectedId;
    var el = MF.store.findBody(id);
    var rule = MF.store.findRule(id);
    // Mehrfachauswahl oder Ordner im Strukturbaum
    var sel = MF.tree.selection();
    if (sel.length > 1 || MF.store.findFolder(id)) {
      MF.tree.deleteNodes(sel.length ? sel : [id]);
      return;
    }
    if (el) {
      if (el.look.locked) { MF.ui.message(el.name + ' ist gesperrt.'); return; }
      if (!this.canEdit()) return;
      MF.store.deleteBody(id);
      MF.ui.message(el.name + ' (' + el.id + ') gelöscht.');
    } else if (rule) {
      if (!this.canEdit()) return;
      MF.store.deleteRule(id);
      MF.ui.message(rule.name + ' gelöscht.');
    } else {
      MF.ui.message('Zum Löschen einen Körper, eine Regel oder einen Ordner auswählen.');
    }
  },

  // Leere Regel anlegen und im Eigenschaften-Panel öffnen
  newRule: function (kind) {
    if (!this.canEdit()) return;
    MF.props.tab = 'props';
    var rule = MF.store.createRule(kind, this.currentParent('logic'));
    MF.tree.reveal(rule.id);   // Logik und Ordner aufklappen
    if (kind === 'scl') {
      MF.sclEditor.open(rule);
      MF.ui.message(rule.name + ' (' + rule.id + ') angelegt – Signale links in den Code ziehen.');
    } else {
      MF.ui.message(rule.name + ' (' + rule.id + ') angelegt – Wenn und Dann wählen.');
    }
  },

  // SCL-Editor für die gewählte Regel; Wenn-dann-Regeln werden dabei umgewandelt
  openSclEditor: function () {
    var rule = MF.store.findRule(MF.store.selectedId);
    if (!rule) { MF.ui.message('Zuerst einen SCL-Baustein im Strukturbaum auswählen – oder "SCL-Baustein" anlegen.'); return; }
    if (!MF.logic.isScl(rule)) {
      rule.kind = 'scl';
      rule.code = rule.code || MF.logic.toScl(rule);
      MF.store.changed();
    }
    MF.sclEditor.open(rule);
  },

  deleteSelectedRule: function () {
    if (MF.store.findRule(MF.store.selectedId)) this.deleteSelected();
    else MF.ui.message('Zuerst eine Regel im Strukturbaum auswählen.');
  },

  duplicateSelected: function () {
    var el = MF.store.findBody(MF.store.selectedId);
    var rule = MF.store.findRule(MF.store.selectedId);
    if (rule) {
      if (!this.canEdit()) return;
      var r = MF.store.duplicateRule(rule.id);
      MF.ui.message(r.name + ' (' + r.id + ') als Kopie angelegt.');
      return;
    }
    if (!el) { MF.ui.message('Zum Duplizieren einen Körper oder eine Regel auswählen.'); return; }
    if (!this.canEdit()) return;
    var copy = MF.store.duplicateBody(el.id);
    MF.ui.message(copy.name + ' (' + copy.id + ') als Kopie eingefügt.');
  },

  nudgeSelected: function (dx, dy) {
    var el = MF.store.findBody(MF.store.selectedId);
    if (!el) return false;
    if (el.look.locked) { MF.ui.message(el.name + ' ist gesperrt.'); return true; }
    el.pose.x = Math.round((el.pose.x + dx) * 1e6) / 1e6;
    el.pose.y = Math.round((el.pose.y + dy) * 1e6) / 1e6;
    MF.store.changed();
    return true;
  },

  // ---------- Tastatur ----------

  initKeys: function () {
    var self = this;
    document.addEventListener('keydown', function (e) {
      var t = e.target;
      if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return;
      var mod = e.metaKey || e.ctrlKey;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        self.deleteSelected();
        e.preventDefault();
        return;
      }
      if (mod && (e.key === 'd' || e.key === 'D')) {
        self.duplicateSelected();
        e.preventDefault();
        return;
      }
      if (mod && !e.shiftKey && (e.key === 'g' || e.key === 'G')) {
        MF.tree.groupSelected();
        e.preventDefault();
        return;
      }

      // Werkzeuge: V = Auswählen, M = Verschieben, D = Drehen
      if (!mod && !e.altKey) {
        var key = e.key.toLowerCase();
        for (var tool in self.TOOLS) {
          if (self.TOOLS[tool].key === key) { self.setTool(tool); e.preventDefault(); return; }
        }
      }

      // Pfeiltasten im Strukturbaum navigieren dort; sonst verschieben sie den Körper
      var dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (dirs[e.key] && !mod && !(t.closest && t.closest('[role="tree"]'))) {
        var step = self.snapStep() * (e.shiftKey ? 10 : 1);
        if (self.nudgeSelected(dirs[e.key][0] * step, dirs[e.key][1] * step)) e.preventDefault();
      }
    });
  }
};
