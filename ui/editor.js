// Editor: Bedienung der Fläche mit Maus und Tastatur.
// - Elemente aus der Bibliothek (links oder Ribbon "Komponenten") auf die Fläche
//   ziehen; ein einfacher Klick legt das Element in die Mitte der Ansicht.
// - Werkzeuge im Ribbon "Modell" (Kürzel V / M / D):
//   Auswählen  – Klick wählt aus, Ziehen verschiebt die Ansicht
//   Verschieben – Elemente ziehen
//   Drehen     – Klick dreht das Element um 90° im Uhrzeigersinn
//   Die Werkzeuge greifen auch, während die Simulation läuft.
// - Fangen an: ganze Rasterzellen; aus: 0,1-Zellen-Schritte.
// - Löschen mit Entf/Rücktaste, Duplizieren mit Strg/Cmd+D,
//   Pfeiltasten verschieben um eine Zelle (mit Shift um fünf).
// - Freie Fläche ziehen verschiebt die Ansicht, Mausrad zoomt.
// Einfügen, Löschen und Duplizieren sind gesperrt, solange die Simulation läuft.
window.MF = window.MF || {};

MF.editor = {
  DRAG_START_PX: 4,   // erst ab dieser Mausbewegung zählt es als Ziehen
  tool: 'select',     // 'select' | 'move' | 'rotate'
  snap: true,         // Fangen: auf ganze Zellen einrasten

  TOOLS: {
    select: { label: 'Auswählen',   key: 'v' },
    move:   { label: 'Verschieben', key: 'm' },
    rotate: { label: 'Drehen',      key: 'd' }
  },

  init: function (canvas) {
    this.canvas = canvas;
    try { this.snap = localStorage.getItem('mf.snap') !== '0'; } catch (e) { /* Standard: an */ }
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

  toggleSnap: function () {
    this.snap = !this.snap;
    try { localStorage.setItem('mf.snap', this.snap ? '1' : '0'); } catch (e) { /* egal */ }
    MF.ui.syncToggles();
    MF.props.render();   // Schrittweite der X/Y-Felder
    MF.ui.message(this.snap ? 'Fangen an: ganze Rasterzellen.' : 'Fangen aus: Schritte von 0,1 Zellen.');
  },

  // Schrittweite für Positionen in Zellen
  snapStep: function () { return this.snap ? 1 : 0.1; },

  // Position auf das Raster bzw. auf 0,1 Zellen runden.
  // halfDown: genau halbe Schritte abrunden statt aufrunden (für die Drehung).
  snapValue: function (v, halfDown) {
    var step = this.snapStep();
    var n = Math.round(v / step * 1e6) / 1e6;
    n = halfDown ? Math.ceil(n - 0.5) : Math.round(n);
    return Math.round(n * step * 1e6) / 1e6;
  },

  // Mauszeiger der Fläche: zeigt das Werkzeug, über gesperrten Elementen "verboten"
  ROTATE_CURSOR: 'url("data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
    '<g fill="none" stroke-width="5" stroke="#F4F2EC"><path d="M19 12a7 7 0 1 1-3-5.7"/><path d="M16.5 2.5v4h4"/></g>' +
    '<g fill="none" stroke-width="2" stroke="#1B2430"><path d="M19 12a7 7 0 1 1-3-5.7"/><path d="M16.5 2.5v4h4"/></g>' +
    '</svg>') + '") 12 12, alias',

  updateCursor: function (over) {
    var c;
    if (this.tool === 'select') c = over ? 'pointer' : 'default';
    else if (over && over.locked) c = 'not-allowed';
    else c = this.tool === 'move' ? 'move' : this.ROTATE_CURSOR;
    this.canvas.style.cursor = c;
  },

  // ---------- Drehen ----------

  // Element auf eine Drehung (0/90/180/270) bringen. Es dreht sich um seine Mitte,
  // w und h werden bei 90°/270° getauscht. Beim Förderband folgt die Laufrichtung,
  // beim Schieber die Schubrichtung.
  // Bei gerader Länge fällt die Mitte zwischen zwei Zellen; dann rundet 0°/180°
  // auf und 90°/270° ab – so landet das Element nach vier Drehungen wieder am Ausgangspunkt.
  setRotation: function (el, rot) {
    rot = ((rot % 360) + 360) % 360;
    var old = el.rot || 0;
    var follows = !!MF.ROT_ZERO_DIR[el.type];   // Richtung folgt der Drehung
    if (rot === old && !(follows && el.props.direction !== MF.dirForRot(el.type, rot))) return false;
    if (el.locked) { MF.ui.message(el.name + ' ist gesperrt.'); return false; }
    var cx = el.x + el.w / 2, cy = el.y + el.h / 2;
    if ((rot - old) % 180 !== 0) { var w = el.w; el.w = el.h; el.h = w; }
    var halfDown = rot % 180 !== 0;
    el.x = this.snapValue(cx - el.w / 2, halfDown);
    el.y = this.snapValue(cy - el.h / 2, halfDown);
    el.rot = rot;
    if (follows) el.props.direction = MF.dirForRot(el.type, rot);
    MF.store.changed();
    return true;
  },

  rotateElement: function (el) {
    var rot = el.rot || 0;
    // Schieber auf "auto": von der tatsächlichen Schubrichtung aus weiterdrehen
    if (el.type === 'pusher' && !(el.props.direction in MF.DIR_ROT)) {
      var v = MF.engine.pusherDir(el);
      for (var d in MF.engine.DIRS) {
        if (MF.engine.DIRS[d][0] === v[0] && MF.engine.DIRS[d][1] === v[1]) rot = MF.rotForDir('pusher', d);
      }
    }
    if (this.setRotation(el, rot + 90)) {
      MF.ui.message(el.name + ' auf ' + el.rot + '° gedreht' +
        (el.type === 'conveyor' ? ', läuft nach ' + el.props.direction :
         el.type === 'pusher' ? ', schiebt nach ' + el.props.direction : '') + '.');
    }
  },

  // Einfügen, Löschen, Duplizieren nur, wenn die Simulation nicht läuft
  canEdit: function () {
    if (MF.engine.state !== 'running') return true;
    MF.ui.message('Zum Bearbeiten die Simulation pausieren.');
    return false;
  },

  // Gruppe für neue Elemente: die des gewählten Elements bzw. Ordners
  currentGroup: function () {
    var id = MF.store.selectedId;
    var el = MF.store.findElement(id);
    if (el) return el.group;
    if (id && id.indexOf('grp:') === 0) return id.slice(4);
    var first = MF.model.elements[0];
    return first ? first.group : 'Förderstrecke 1';
  },

  canvasPos: function (e) {
    var r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, inside:
      e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom };
  },

  // Linke obere Zelle, damit ein Element der Größe w×h mittig unter (px, py) liegt
  cellFor: function (type, px, py) {
    var t = MF.types[type];
    var w = MF.sim.toWorld(px, py);
    return { x: this.snapValue(w.x - t.size[0] / 2), y: this.snapValue(w.y - t.size[1] / 2), w: t.size[0], h: t.size[1] };
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
    var t = MF.types[type];
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
      MF.sim.ghost = p.inside ? self.cellForGhost(type, p) : null;
      MF.sim.draw();
    }

    function up(ev) {
      var p = self.canvasPos(ev);
      if (chip) {
        if (p.inside) self.place(type, self.cellFor(type, p.x, p.y));
        else MF.ui.message('Abgebrochen – zum Einfügen auf die Fläche ziehen.');
      } else if (self.canEdit()) {
        // Einfacher Klick: in die Mitte der Ansicht legen
        self.place(type, self.cellFor(type, MF.sim.width / 2, MF.sim.height / 2));
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

  cellForGhost: function (type, p) {
    var c = this.cellFor(type, p.x, p.y);
    c.type = type;
    return c;
  },

  place: function (type, cell) {
    var el = MF.store.createElement(type, cell.x, cell.y, this.currentGroup());
    MF.ui.message(el.name + ' (' + el.id + ') eingefügt.');
    return el;
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
        drag = { mode: 'move', el: hit, wx: w.x, wy: w.y, ox: hit.x, oy: hit.y, sx: p.x, sy: p.y, active: false };
      } else {
        // Ansicht ziehen – auch über Elementen, damit Auswählen/Drehen nichts verschiebt.
        // Ein Klick ohne Ziehen dreht beim Werkzeug "Drehen" das Element.
        drag = { mode: 'pan', sx: p.x, sy: p.y, ox: MF.sim.offsetX, oy: MF.sim.offsetY, el: hit, active: false };
      }
      canvas.setPointerCapture(e.pointerId);
    });

    canvas.addEventListener('pointermove', function (e) {
      var p = self.canvasPos(e);
      MF.ui.setCursor(MF.sim.cellAt(p.x, p.y));

      if (!drag) {
        self.updateCursor(MF.sim.hitTest(p.x, p.y));
        return;
      }

      // Erst ab kleiner Mindestbewegung zählt es als Ziehen, damit ein Klick nur auswählt
      if (!drag.active) {
        if (Math.abs(p.x - drag.sx) + Math.abs(p.y - drag.sy) < self.DRAG_START_PX) return;
        if (drag.mode === 'move' && drag.el.locked) { MF.ui.message(drag.el.name + ' ist gesperrt.'); drag = null; return; }
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
      if (nx !== drag.el.x || ny !== drag.el.y) {
        drag.el.x = nx;
        drag.el.y = ny;
        MF.store.changed();
      }
    });

    function end(e) {
      if (drag && drag.mode === 'move' && drag.active &&
          (drag.el.x !== drag.ox || drag.el.y !== drag.oy)) {
        MF.ui.message(drag.el.name + ' nach x ' + MF.props.formatNumber(drag.el.x) +
          ', y ' + MF.props.formatNumber(drag.el.y) + ' verschoben.');
      }
      if (drag && drag.mode === 'pan' && !drag.active && drag.el && self.tool === 'rotate' && e.type === 'pointerup') {
        self.rotateElement(drag.el);
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
    var el = MF.store.findElement(id);
    var rule = MF.store.findRule(id);
    if (el) {
      if (el.locked) { MF.ui.message(el.name + ' ist gesperrt.'); return; }
      if (!this.canEdit()) return;
      MF.store.deleteElement(id);
      MF.ui.message(el.name + ' (' + el.id + ') gelöscht.');
    } else if (rule) {
      if (!this.canEdit()) return;
      MF.store.deleteRule(id);
      MF.ui.message(rule.name + ' gelöscht.');
    } else {
      MF.ui.message('Zum Löschen ein Element oder eine Regel auswählen.');
    }
  },

  deleteSelectedRule: function () {
    if (MF.store.findRule(MF.store.selectedId)) this.deleteSelected();
    else MF.ui.message('Zuerst eine Regel im Strukturbaum auswählen.');
  },

  duplicateSelected: function () {
    var el = MF.store.findElement(MF.store.selectedId);
    if (!el) { MF.ui.message('Zum Duplizieren ein Element auswählen.'); return; }
    if (!this.canEdit()) return;
    var copy = MF.store.duplicateElement(el.id);
    MF.ui.message(copy.name + ' (' + copy.id + ') als Kopie eingefügt.');
  },

  nudgeSelected: function (dx, dy) {
    var el = MF.store.findElement(MF.store.selectedId);
    if (!el) return false;
    if (el.locked) { MF.ui.message(el.name + ' ist gesperrt.'); return true; }
    el.x = Math.round((el.x + dx) * 1e6) / 1e6;
    el.y = Math.round((el.y + dy) * 1e6) / 1e6;
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

      // Werkzeuge: V = Auswählen, M = Verschieben, D = Drehen
      if (!mod && !e.altKey) {
        var key = e.key.toLowerCase();
        for (var tool in self.TOOLS) {
          if (self.TOOLS[tool].key === key) { self.setTool(tool); e.preventDefault(); return; }
        }
      }

      // Pfeiltasten im Strukturbaum navigieren dort; sonst verschieben sie das Element
      var dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (dirs[e.key] && !mod && !(t.closest && t.closest('[role="tree"]'))) {
        var step = e.shiftKey ? 5 : 1;
        if (self.nudgeSelected(dirs[e.key][0] * step, dirs[e.key][1] * step)) e.preventDefault();
      }
    });
  }
};
