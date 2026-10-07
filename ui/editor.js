// Editor: Bedienung der Fläche mit Maus und Tastatur.
// - Elemente aus der Bibliothek (links oder Ribbon "Komponenten") auf die Fläche
//   ziehen; ein einfacher Klick legt das Element in die Mitte der Ansicht.
// - Elemente anklicken und verschieben (rastet auf ganze Zellen ein).
// - Löschen mit Entf/Rücktaste, Duplizieren mit Strg/Cmd+D,
//   Pfeiltasten verschieben um eine Zelle (mit Shift um fünf).
// - Freie Fläche ziehen verschiebt die Ansicht, Mausrad zoomt.
// Während die Simulation läuft, ist Bearbeiten gesperrt.
window.MF = window.MF || {};

MF.editor = {
  DRAG_START_PX: 4,   // erst ab dieser Mausbewegung zählt es als Ziehen

  init: function (canvas) {
    this.canvas = canvas;
    this.initLibrary();
    this.initCanvas();
    this.initKeys();
  },

  // Bearbeiten ist nur möglich, wenn die Simulation nicht läuft
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
    return { x: Math.round(w.x - t.size[0] / 2), y: Math.round(w.y - t.size[1] / 2), w: t.size[0], h: t.size[1] };
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

  // ---------- Fläche: Auswählen, Verschieben, Ansicht ziehen ----------

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

      if (hit) {
        MF.store.select(hit.id);
        var w = MF.sim.toWorld(p.x, p.y);
        drag = { mode: 'move', el: hit, wx: w.x, wy: w.y, ox: hit.x, oy: hit.y, sx: p.x, sy: p.y, active: false };
      } else {
        if (e.button === 0) MF.store.select(null);
        drag = { mode: 'pan', sx: p.x, sy: p.y, ox: MF.sim.offsetX, oy: MF.sim.offsetY };
        canvas.style.cursor = 'grabbing';
      }
      canvas.setPointerCapture(e.pointerId);
    });

    canvas.addEventListener('pointermove', function (e) {
      var p = self.canvasPos(e);
      MF.ui.setCursor(MF.sim.cellAt(p.x, p.y));

      if (!drag) {
        var over = MF.sim.hitTest(p.x, p.y);
        canvas.style.cursor = !over ? 'default'
          : over.locked || MF.engine.state === 'running' ? 'pointer' : 'move';
        return;
      }

      if (drag.mode === 'pan') {
        MF.sim.offsetX = drag.ox + (p.x - drag.sx);
        MF.sim.offsetY = drag.oy + (p.y - drag.sy);
        MF.sim.draw();
        return;
      }

      // Verschieben erst ab kleiner Mindestbewegung, damit ein Klick nur auswählt
      if (!drag.active) {
        if (Math.abs(p.x - drag.sx) + Math.abs(p.y - drag.sy) < self.DRAG_START_PX) return;
        if (drag.el.locked) { MF.ui.message(drag.el.name + ' ist gesperrt.'); drag = null; return; }
        if (!self.canEdit()) { drag = null; return; }
        drag.active = true;
      }
      var w = MF.sim.toWorld(p.x, p.y);
      var nx = drag.ox + Math.round(w.x - drag.wx);
      var ny = drag.oy + Math.round(w.y - drag.wy);
      if (nx !== drag.el.x || ny !== drag.el.y) {
        drag.el.x = nx;
        drag.el.y = ny;
        MF.store.changed();
      }
    });

    function end() {
      if (drag && drag.mode === 'move' && drag.active &&
          (drag.el.x !== drag.ox || drag.el.y !== drag.oy)) {
        MF.ui.message(drag.el.name + ' nach x ' + drag.el.x + ', y ' + drag.el.y + ' verschoben.');
      }
      drag = null;
      canvas.style.cursor = 'default';
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
    if (!this.canEdit()) return true;
    el.x += dx;
    el.y += dy;
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

      // Pfeiltasten im Strukturbaum navigieren dort; sonst verschieben sie das Element
      var dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (dirs[e.key] && !mod && !(t.closest && t.closest('[role="tree"]'))) {
        var step = e.shiftKey ? 5 : 1;
        if (self.nudgeSelected(dirs[e.key][0] * step, dirs[e.key][1] * step)) e.preventDefault();
      }
    });
  }
};
