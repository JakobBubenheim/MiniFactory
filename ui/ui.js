// UI: Ribbon, Splitter zwischen den Bereichen und Statusleiste.
window.MF = window.MF || {};

MF.ui = {
  DEFAULT_LEFT: 260,
  DEFAULT_RIGHT: 300,

  init: function () {
    this.app = document.getElementById('app');
    this.initRibbonTabs();
    this.initActions();
    this.initSplitters();
    this.updateStatus();
  },

  // ---------- Ribbon-Reiter ----------

  initRibbonTabs: function () {
    var tabs = document.querySelectorAll('.ribbon-tab');
    var pages = document.querySelectorAll('.ribbon-page');
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        tabs.forEach(function (t) { t.setAttribute('aria-selected', String(t === tab)); });
        pages.forEach(function (p) { p.hidden = p.dataset.page !== tab.dataset.tab; });
      });
    });
  },

  // ---------- Buttons ----------

  initActions: function () {
    var self = this;
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action], [data-stage]');
      if (!btn || btn.tagName === 'SELECT') return;

      if (btn.dataset.stage) {
        var stage = btn.dataset.stage;
        var name = btn.getAttribute('title') || btn.textContent.trim();
        self.message(name + ' – kommt ' + (stage === 'später' ? 'später' : 'in Etappe ' + stage) + '.');
        return;
      }

      switch (btn.dataset.action) {
        case 'zoom-in':  MF.sim.setZoom(MF.sim.zoom * 1.25); break;
        case 'zoom-out': MF.sim.setZoom(MF.sim.zoom / 1.25); break;
        case 'zoom-fit': MF.sim.fit(); break;
        case 'toggle-grid': MF.sim.showGrid = !MF.sim.showGrid; MF.sim.draw(); break;
        case 'toggle-tags': MF.sim.showTags = !MF.sim.showTags; MF.sim.draw(); break;
        case 'reset-panels': self.setPanelWidth('left', self.DEFAULT_LEFT); self.setPanelWidth('right', self.DEFAULT_RIGHT); break;
      }
      self.syncToggles();
      self.updateStatus();
    });
    this.syncToggles();
  },

  // Markiert Raster- und Namen-Buttons als aktiv, wenn eingeschaltet.
  syncToggles: function () {
    document.querySelectorAll('[data-action="toggle-grid"]').forEach(function (b) {
      b.classList.toggle('is-active', MF.sim.showGrid);
    });
    document.querySelectorAll('[data-action="toggle-tags"]').forEach(function (b) {
      b.classList.toggle('is-active', MF.sim.showTags);
    });
  },

  // Kurze Meldung in der Statusleiste
  message: function (text) {
    var el = document.getElementById('sb-msg');
    el.textContent = text;
    clearTimeout(this.msgTimer);
    this.msgTimer = setTimeout(function () { el.textContent = ''; }, 3000);
  },

  // ---------- Splitter ----------

  initSplitters: function () {
    var self = this;
    this.setPanelWidth('left', this.load('mf.left', this.DEFAULT_LEFT));
    this.setPanelWidth('right', this.load('mf.right', this.DEFAULT_RIGHT));

    document.querySelectorAll('.splitter').forEach(function (sp) {
      var side = sp.dataset.side;

      sp.addEventListener('pointerdown', function (e) {
        sp.setPointerCapture(e.pointerId);
        sp.classList.add('is-dragging');
        var startX = e.clientX;
        var startW = self.panelWidth(side);

        function move(ev) {
          var dx = ev.clientX - startX;
          self.setPanelWidth(side, side === 'left' ? startW + dx : startW - dx);
        }
        function up() {
          sp.classList.remove('is-dragging');
          sp.removeEventListener('pointermove', move);
          sp.removeEventListener('pointerup', up);
        }
        sp.addEventListener('pointermove', move);
        sp.addEventListener('pointerup', up);
      });

      // Doppelklick setzt die Breite zurück
      sp.addEventListener('dblclick', function () {
        self.setPanelWidth(side, side === 'left' ? self.DEFAULT_LEFT : self.DEFAULT_RIGHT);
      });

      // Tastatur: Pfeil links/rechts
      sp.addEventListener('keydown', function (e) {
        var step = e.shiftKey ? 40 : 10;
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        var dir = e.key === 'ArrowRight' ? 1 : -1;
        if (side === 'right') dir = -dir;
        self.setPanelWidth(side, self.panelWidth(side) + dir * step);
        e.preventDefault();
      });
    });
  },

  panelWidth: function (side) {
    return document.querySelector('.panel-' + side).getBoundingClientRect().width;
  },

  setPanelWidth: function (side, px) {
    px = Math.round(Math.max(180, Math.min(480, px)));
    this.app.style.setProperty('--' + side, px + 'px');
    this.save('mf.' + side, px);
  },

  load: function (key, fallback) {
    try {
      var v = parseInt(localStorage.getItem(key), 10);
      return isNaN(v) ? fallback : v;
    } catch (e) { return fallback; }
  },

  save: function (key, value) {
    try { localStorage.setItem(key, String(value)); } catch (e) { /* egal */ }
  },

  // ---------- Statusleiste ----------

  setCursor: function (cell) {
    document.getElementById('sb-cursor').textContent = cell
      ? 'x ' + cell.x + '  y ' + cell.y
      : 'x –  y –';
  },

  updateStatus: function () {
    document.getElementById('sb-count').textContent = MF.model.elements.length;
    document.getElementById('zoom-label').textContent = Math.round(MF.sim.zoom * 100) + ' %';

    // Pfad des gewählten Knotens, wie im Baum
    var path = '/' + MF.model.name;
    var id = MF.store.selectedId;
    var el = MF.store.findElement(id);
    var rule = MF.store.findRule(id);
    if (el) path += '/Anlage/' + el.group + '/' + el.name;
    else if (rule) path += '/Logik/' + rule.name;
    else if (id && id.indexOf('grp:') === 0) path += '/Anlage/' + id.slice(4);
    else if (id === 'plant') path += '/Anlage';
    else if (id === 'logic') path += '/Logik';
    document.getElementById('sb-path').textContent = path;
  }
};
