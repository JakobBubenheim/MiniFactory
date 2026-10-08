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
    this.initSimControls();
    this.initFileKeys();
    this.updateStatus();
  },

  // ---------- Simulation: Zeitfaktor, Zeitschritt, Tastenkürzel ----------

  STATES: {
    stopped: { lamp: 'STOP',  text: 'Gestoppt', cls: '' },
    running: { lamp: 'RUN',   text: 'Läuft',    cls: 'is-running' },
    paused:  { lamp: 'PAUSE', text: 'Pausiert', cls: 'is-paused' }
  },

  initSimControls: function () {
    var self = this;

    document.getElementById('timescale').addEventListener('change', function (e) {
      MF.engine.setTimeScale(parseFloat(e.target.value));
    });

    document.getElementById('dtms').addEventListener('change', function (e) {
      self.changeDtMs(parseInt(e.target.value, 10));
    });

    // Leertaste = Start/Pause, S = Einzelschritt, R = Reset (nicht beim Tippen)
    document.addEventListener('keydown', function (e) {
      var t = e.target.tagName;
      if (t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target.closest && e.target.closest('[role="tree"]') && e.key === ' ') return;
      if (e.key === ' ') { MF.engine.toggle(); e.preventDefault(); }
      else if (e.key === 's' || e.key === 'S') MF.engine.stepOnce();
      else if (e.key === 'r' || e.key === 'R') MF.engine.reset();
    });

    MF.engine.on(function () { self.updateSimStatus(); });
    this.updateSimStatus();
  },

  // Zeitschritt ändern; während die Simulation läuft, wird das abgelehnt
  changeDtMs: function (ms) {
    if (!MF.engine.setDtMs(ms)) this.message('Zeitschritt nur in der Pause änderbar.');
    MF.store.changed();
    this.updateSimStatus();
  },

  // Zeit als mm:ss.hh (Hundertstel), aus ganzen Millisekunden
  formatTime: function (ms) {
    var cs = Math.floor(ms / 10);
    var m = Math.floor(cs / 6000);
    var sec = Math.floor(cs / 100) % 60;
    var h = cs % 100;
    return (m < 10 ? '0' : '') + m + ':' + (sec < 10 ? '0' : '') + sec + '.' + (h < 10 ? '0' : '') + h;
  },

  updateSimStatus: function () {
    var e = MF.engine;
    var st = this.STATES[e.state];
    var lamp = document.getElementById('state-lamp');
    lamp.textContent = st.lamp;
    lamp.className = 'state-lamp ' + st.cls;
    var chip = document.getElementById('sb-state');
    chip.textContent = st.text;
    chip.className = 'state-chip ' + st.cls;

    var running = e.state === 'running';
    document.getElementById('sb-time').textContent = this.formatTime(e.timeMs);
    document.getElementById('sb-tick').textContent = e.ticks;
    document.getElementById('sb-scale').textContent = String(e.timeScale).replace('.', ',') + '×';
    document.getElementById('sb-dt').textContent = MF.model.settings.dtMs + ' ms';
    var dtSel = document.getElementById('dtms');
    dtSel.value = String(MF.model.settings.dtMs);
    dtSel.disabled = running;
    document.querySelectorAll('[data-action="sim-step"]').forEach(function (b) {
      b.disabled = running;
    });
    document.getElementById('sb-boxes').textContent = e.boxes.length;

    document.querySelectorAll('[data-action="sim-start"]').forEach(function (b) {
      b.classList.toggle('is-active', e.state === 'running');
    });
    document.querySelectorAll('[data-action="sim-pause"]').forEach(function (b) {
      b.classList.toggle('is-active', e.state === 'paused');
    });

    if (MF.props) MF.props.refreshLive();
    if (MF.signals) MF.signals.refreshLive();
    if (MF.sclEditor) MF.sclEditor.refreshLive();
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
        case 'sim-start': MF.engine.start(); break;
        case 'sim-pause': MF.engine.pause(); break;
        case 'sim-step':  MF.engine.stepOnce(); break;
        case 'sim-reset': MF.engine.reset(); break;
        case 'duplicate':   MF.editor.duplicateSelected(); break;
        case 'delete':      MF.editor.deleteSelected(); break;
        case 'delete-rule': MF.editor.deleteSelectedRule(); break;
        case 'new-folder':  MF.tree.newFolderHere(); break;
        case 'new-rule':    MF.editor.newRule('rule'); break;
        case 'new-scl':     MF.editor.newRule('scl'); break;
        case 'scl-editor':  MF.editor.openSclEditor(); break;
        case 'scl-close':   MF.sclEditor.close(); break;
        case 'lexikon':     MF.sclEditor.openLexikon(); break;
        case 'lexikon-close': document.getElementById('lex-dlg').close(); break;
        case 'signal-list': MF.signals.toggle(); break;
        case 'signal-list-close': MF.signals.close(); break;
        case 'tool-select': MF.editor.setTool('select'); break;
        case 'tool-move':   MF.editor.setTool('move'); break;
        case 'tool-rotate': MF.editor.setTool('rotate'); break;
        case 'toggle-snap': MF.editor.toggleSnap(); break;
        case 'file-new':  MF.file.newPlant(); break;
        case 'file-open': MF.file.open(); break;
        case 'file-save': MF.file.save(); break;
        case 'undo':        MF.history.undo(); break;
        case 'redo':        MF.history.redo(); break;
      }
      self.syncToggles();
      self.updateStatus();
    });
    this.syncToggles();
  },

  // Strg+N / Strg+O / Strg+S (Mac: Cmd), auch beim Tippen in Feldern.
  // preventDefault verhindert Seite speichern bzw. Datei öffnen des Browsers.
  initFileKeys: function () {
    document.addEventListener('keydown', function (e) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      var k = e.key.toLowerCase();
      if (k !== 'n' && k !== 'o' && k !== 's') return;
      e.preventDefault();
      if (e.repeat) return;
      // Feld zuerst verlassen, damit eine laufende Eingabe übernommen wird
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      if (k === 'n') MF.file.newPlant();
      else if (k === 'o') MF.file.open();
      else MF.file.save();
    });
  },

  // Markiert Raster-, Namen- und Fangen-Buttons als aktiv, wenn eingeschaltet,
  // und genau einen Werkzeug-Button.
  syncToggles: function () {
    ['select', 'move', 'rotate'].forEach(function (t) {
      document.querySelectorAll('[data-action="tool-' + t + '"]').forEach(function (b) {
        b.classList.toggle('is-active', MF.editor.tool === t);
        b.setAttribute('aria-pressed', String(MF.editor.tool === t));
      });
    });
    document.querySelectorAll('[data-action="toggle-snap"]').forEach(function (b) {
      b.classList.toggle('is-active', MF.editor.snap);
      b.setAttribute('aria-pressed', String(MF.editor.snap));
    });
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

    // Anlagenname im Fenstertitel; Stern = ungespeicherte Änderungen
    var dirty = MF.file && MF.file.dirty;
    document.title = (dirty ? '* ' : '') + MF.model.name + ' – Mini-Fabrik';
    var nameEl = document.getElementById('sb-name');
    nameEl.textContent = MF.model.name + (dirty ? ' *' : '');
    nameEl.title = dirty ? 'Ungespeicherte Änderungen' : 'Gespeichert';
    nameEl.classList.toggle('is-dirty', !!dirty);

    // Pfad des gewählten Knotens, wie im Baum
    var path = '/' + MF.model.name;
    var id = MF.store.selectedId;
    var n = MF.store.findNode(id);
    if (n) {
      var folders = MF.store.folderPath(n.kind === 'folder' ? n.obj.id : MF.store.parentOf(n.obj, n.area));
      path += '/' + MF.store.AREAS[n.area] + (folders.length ? '/' + folders.join('/') : '') +
        (n.kind === 'folder' ? '' : '/' + n.obj.name);
    }
    else if (id === 'plant') path += '/Anlage';
    else if (id === 'logic') path += '/Logik';
    document.getElementById('sb-path').textContent = path;
  }
};
