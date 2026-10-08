// SCL-Editor: Code eines SCL-Bausteins schreiben.
// Links die Variablenliste (Signale der Anlage und eigene Variablen, mit
// Live-Wert) – per Ziehen oder Doppelklick in den Code einfügen.
// Mitte der Code mit Zeilennummern, Hervorhebung und Fehlermeldung.
// Rechts das Lexikon mit allen Befehlen, durchsuchbar, mit "Einfügen".
// Änderungen wirken sofort, auch während die Simulation läuft.
// Das Fenster lässt sich an der Titelleiste verschieben und an allen Kanten
// und Ecken in der Größe ändern; Variablen und Lexikon lassen sich einklappen.
// Größe, Lage und eingeklappte Bereiche merkt sich der Browser.
window.MF = window.MF || {};

MF.sclEditor = {
  rule: null,
  varFilter: '',
  lexFilter: '',
  LINE_H: 18,
  MIN_W: 520,
  MIN_H: 260,
  GEOM_KEY: 'mf.scl.geom',
  FOLD_KEY: 'mf.scl.fold',
  geom: null,               // { x, y, w, h } in px; null = Standard
  fold: { vars: false, lex: false },

  init: function () {
    var self = this;
    this.dialog = document.getElementById('scl-ed');
    this.text = document.getElementById('scl-text');
    this.hl = document.getElementById('scl-hl');
    this.layer = document.getElementById('scl-layer');
    this.marker = document.getElementById('scl-marker');
    this.gutter = document.getElementById('scl-gutter');
    this.varList = document.getElementById('scl-varlist');
    this.lexList = document.getElementById('scl-lexlist');

    this.text.addEventListener('input', function () { self.onEdit(); });
    this.text.addEventListener('scroll', function () { self.syncScroll(); });
    this.text.addEventListener('keydown', function (e) {
      if (self.handleKey(e, self.text)) { self.onEdit(); self.showPos(); }
    });
    ['keyup', 'click', 'select'].forEach(function (ev) {
      self.text.addEventListener(ev, function () { self.showPos(); });
    });

    document.getElementById('scl-varfilter').addEventListener('input', function (e) {
      self.varFilter = e.target.value.trim().toLowerCase();
      self.renderVars();
    });
    document.getElementById('scl-lexfilter').addEventListener('input', function (e) {
      self.lexFilter = e.target.value.trim().toLowerCase();
      self.renderLexikon(self.lexList, self.lexFilter, true);
    });

    // Variablen: ziehen liefert den Text fürs Einfügen, Doppelklick fügt an der Schreibmarke ein
    this.varList.addEventListener('dragstart', function (e) {
      var item = e.target.closest('[data-insert]');
      if (!item) return;
      e.dataTransfer.setData('text/plain', item.dataset.insert);
      e.dataTransfer.effectAllowed = 'copy';
    });
    this.varList.addEventListener('dblclick', function (e) {
      var item = e.target.closest('[data-insert]');
      if (item) self.insert(item.dataset.insert);
    });
    this.lexList.addEventListener('click', function (e) {
      var b = e.target.closest('[data-lex-insert]');
      if (b) self.insert(b.dataset.lexInsert);
    });

    this.dialog.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { self.close(); e.stopPropagation(); }
    });

    this.initWindow();

    // Eigenständiges Lexikon (Ribbon "Lexikon")
    this.lexDialog = document.getElementById('lex-dlg');
    document.getElementById('lex-filter').addEventListener('input', function (e) {
      self.renderLexikon(document.getElementById('lex-list'), e.target.value.trim().toLowerCase(), false);
    });
    this.lexDialog.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { self.lexDialog.close(); e.stopPropagation(); }
    });

    MF.store.on(function () {
      if (!self.isOpen()) return;
      if (!MF.store.findRule(self.rule.id) || !MF.logic.isScl(self.rule)) { self.close(); return; }
      if (self.text.value !== self.rule.code) self.load();
      self.renderHead();
      self.renderVars();
      self.renderStatus();
    });
  },

  isOpen: function () { return !!this.dialog && this.dialog.open; },

  open: function (rule) {
    this.rule = rule;
    this.load();
    this.renderHead();
    this.renderVars();
    this.renderLexikon(this.lexList, this.lexFilter, true);
    this.dialog.show();
    this.applyGeom();
    this.applyFold();
    this.text.focus();
    this.renderStatus();
  },

  close: function () {
    if (this.dialog.open) this.dialog.close();
  },

  openLexikon: function () {
    this.renderLexikon(document.getElementById('lex-list'), document.getElementById('lex-filter').value.trim().toLowerCase(), false);
    if (!this.lexDialog.open) this.lexDialog.show();
    document.getElementById('lex-filter').focus();
  },

  load: function () {
    this.text.value = this.rule.code || '';
    this.paint();
  },

  // ---------- Bearbeiten ----------

  onEdit: function () {
    this.rule.code = this.text.value;
    this.paint();
    MF.store.changed();   // Baum, Panel und I/O-Markierung aktualisieren
    this.renderStatus();
  },

  // Tasten im Code: Tab = zwei Leerzeichen, Enter übernimmt die Einrückung,
  // END_IF/ELSE/… rücken eine Ebene aus. Gibt true zurück, wenn der Text geändert wurde.
  // Wird auch vom Code-Feld im Eigenschaften-Panel benutzt.
  handleKey: function (e, t) {
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      this.insertText(t, '  ');
      return true;
    }
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
      var start = t.value.lastIndexOf('\n', t.selectionStart - 1) + 1;
      var line = t.value.slice(start, t.selectionStart);
      var indent = /^ */.exec(line)[0];
      if (/^ *(END_\w+|ELSE|ELSIF)\b/i.test(line) && indent.length >= 2) {
        var caret = t.selectionStart;
        t.setRangeText('', start, start + 2);
        t.selectionStart = t.selectionEnd = caret - 2;
        indent = indent.slice(2);
      }
      if (/\b(THEN|ELSE|OF|VAR)\s*$/i.test(line)) indent += '  ';
      e.preventDefault();
      this.insertText(t, '\n' + indent);
      return true;
    }
    return false;
  },

  // Text an der Schreibmarke einfügen; "|" in Vorlagen markiert die neue Schreibmarke
  insertText: function (t, snippet) {
    var mark = snippet.indexOf('|');
    var clean = mark >= 0 ? snippet.slice(0, mark) + snippet.slice(mark + 1) : snippet;
    var start = t.selectionStart, end = t.selectionEnd;
    t.focus();
    t.setRangeText(clean, start, end, 'end');
    if (mark >= 0) t.selectionStart = t.selectionEnd = start + mark;
  },

  insert: function (snippet) {
    this.insertText(this.text, snippet);
    this.onEdit();
    this.showPos();
  },

  // ---------- Fenster: verschieben, Größe ändern, einklappen ----------

  initWindow: function () {
    var self = this;
    this.geom = this.loadJson(this.GEOM_KEY, null);
    this.fold = this.loadJson(this.FOLD_KEY, this.fold);

    // Titelleiste ziehen verschiebt, Doppelklick setzt Größe und Lage zurück
    var head = this.dialog.querySelector('.scl-head');
    head.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || e.target.closest('button, input')) return;
      self.drag(e, 'move');
    });
    head.addEventListener('dblclick', function (e) {
      if (e.target.closest('button, input')) return;
      self.geom = null;
      self.saveJson(self.GEOM_KEY, null);
      self.applyGeom();
    });

    // Griffe an Kanten und Ecken
    this.dialog.querySelectorAll('[data-resize]').forEach(function (h) {
      h.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        self.drag(e, h.dataset.resize);
      });
    });

    this.dialog.addEventListener('click', function (e) {
      var b = e.target.closest('[data-fold]');
      if (!b) return;
      var k = b.dataset.fold;
      self.fold[k] = !self.fold[k];
      self.saveJson(self.FOLD_KEY, self.fold);
      self.applyFold();
    });

    window.addEventListener('resize', function () { if (self.isOpen()) self.applyGeom(); });
  },

  // Standard: über die ganze Breite, vom Ribbon bis zur Statusleiste
  defaultGeom: function () {
    var top = document.querySelector('.ribbon').getBoundingClientRect().bottom + 8;
    var bottom = document.querySelector('.statusbar').getBoundingClientRect().top - 8;
    return { x: 8, y: top, w: window.innerWidth - 16, h: bottom - top };
  },

  // Lage auf den sichtbaren Bereich begrenzen und setzen
  applyGeom: function () {
    var g = this.geom || this.defaultGeom();
    var vw = window.innerWidth, vh = window.innerHeight;
    var w = Math.max(this.MIN_W, Math.min(g.w, vw));
    var h = Math.max(this.MIN_H, Math.min(g.h, vh));
    var x = Math.max(0, Math.min(g.x, vw - w));
    var y = Math.max(0, Math.min(g.y, vh - h));
    var st = this.dialog.style;
    st.left = x + 'px';
    st.top = y + 'px';
    st.width = w + 'px';
    st.height = h + 'px';
    this.syncScroll();
  },

  // Ziehen an Titelleiste (mode 'move') oder an einem Griff ('n', 'se', …)
  drag: function (e, mode) {
    var self = this;
    var r = this.dialog.getBoundingClientRect();
    var start = { x: r.left, y: r.top, w: r.width, h: r.height };
    var sx = e.clientX, sy = e.clientY;
    var target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    e.preventDefault();
    this.dialog.classList.add('is-dragging');

    function move(ev) {
      var dx = ev.clientX - sx, dy = ev.clientY - sy;
      var g = { x: start.x, y: start.y, w: start.w, h: start.h };
      if (mode === 'move') { g.x += dx; g.y += dy; self.geom = g; self.applyGeom(); return; }
      if (mode.indexOf('e') >= 0) g.w = Math.max(self.MIN_W, start.w + dx);
      if (mode.indexOf('s') >= 0) g.h = Math.max(self.MIN_H, start.h + dy);
      if (mode.indexOf('w') >= 0) { g.w = Math.max(self.MIN_W, start.w - dx); g.x = start.x + start.w - g.w; }
      if (mode.indexOf('n') >= 0) { g.h = Math.max(self.MIN_H, start.h - dy); g.y = start.y + start.h - g.h; }
      self.geom = g;
      self.applyGeom();
    }
    function up() {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      self.dialog.classList.remove('is-dragging');
      self.saveJson(self.GEOM_KEY, self.geom);
    }
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  },

  applyFold: function () {
    var main = this.dialog.querySelector('.scl-main');
    main.classList.toggle('is-vars-folded', !!this.fold.vars);
    main.classList.toggle('is-lex-folded', !!this.fold.lex);
    this.dialog.querySelectorAll('[data-fold]').forEach(function (b) {
      var open = !MF.sclEditor.fold[b.dataset.fold];
      b.setAttribute('aria-expanded', String(open));
    });
    this.syncScroll();
  },

  loadJson: function (key, fallback) {
    try {
      var v = JSON.parse(localStorage.getItem(key));
      return v === null || v === undefined ? fallback : v;
    } catch (e) { return fallback; }
  },

  saveJson: function (key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* egal */ }
  },

  // ---------- Darstellung ----------

  paint: function () {
    this.hl.innerHTML = this.highlight(this.text.value) + '\n ';
    var lines = this.text.value.split('\n').length;
    var html = '';
    for (var i = 1; i <= lines; i++) html += '<div data-line="' + i + '">' + i + '</div>';
    this.gutter.innerHTML = html;
    this.syncScroll();
  },

  syncScroll: function () {
    var x = this.text.scrollLeft, y = this.text.scrollTop;
    this.layer.style.transform = 'translate(' + (-x) + 'px,' + (-y) + 'px)';
    this.gutter.style.transform = 'translateY(' + (-y) + 'px)';
  },

  showPos: function () {
    var before = this.text.value.slice(0, this.text.selectionStart).split('\n');
    document.getElementById('scl-pos').textContent = 'Zeile ' + before.length + ', Spalte ' + (before[before.length - 1].length + 1);
  },

  renderHead: function () {
    var r = this.rule;
    document.getElementById('scl-title').textContent = r.name + ' (' + r.id + ')';
    var st = document.getElementById('scl-state');
    var off = r.enabled === false;
    st.textContent = off ? 'Abgeschaltet' : 'Aktiv';
    st.className = 'scl-chip' + (off ? '' : ' is-on');
  },

  // Fehler oder "OK" unten anzeigen und die Fehlerzeile markieren
  renderStatus: function () {
    var u = MF.logic.unit(this.rule);
    var msg = document.getElementById('scl-msg');
    var err = u.error || u.runError;
    this.gutter.querySelectorAll('.is-error').forEach(function (d) { d.classList.remove('is-error'); });
    if (err) {
      var where = 'Zeile ' + err.line + (err.col ? ', Spalte ' + err.col : '');
      var tail = u.error && u.prog ? ' – es läuft weiter die letzte fehlerfreie Fassung.' : '';
      msg.textContent = (u.error ? 'Fehler' : 'Laufzeitfehler') + ' in ' + where + ': ' + err.message + tail;
      msg.className = 'scl-msg is-error';
      var g = this.gutter.querySelector('[data-line="' + err.line + '"]');
      if (g) g.classList.add('is-error');
      this.marker.hidden = !err.line;
      this.marker.style.top = (8 + (err.line - 1) * this.LINE_H) + 'px';
    } else {
      var w = u.prog.writes.length;
      msg.textContent = 'OK – schreibt ' + (w ? u.prog.writes.join(', ') : 'keine Signale') +
        (this.rule.enabled === false ? ' (Baustein ist abgeschaltet)' : '');
      msg.className = 'scl-msg is-ok';
      this.marker.hidden = true;
    }
  },

  // Code einfärben: Kommentare, Schlüsselwörter, Typen, Zahlen, Signale
  highlight: function (code) {
    var esc = function (s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
    var KW = MF.scl.KEYWORDS.concat(['END_VAR']);
    var re = /(\/\/[^\n]*|\(\*[\s\S]*?(?:\*\)|$)|\/\*[\s\S]*?(?:\*\/|$))|("[^"\n]*"?)|((?:T|TIME)#[-0-9a-z_.]+)|(\d+(?:\.\d+)?)|([A-Za-z_ÄÖÜäöüß][A-Za-z0-9_ÄÖÜäöüß]*)/gi;
    var out = '', last = 0, m;
    while ((m = re.exec(code))) {
      out += esc(code.slice(last, m.index));
      var cls = null, w = m[0];
      if (m[1]) cls = 'hl-com';
      else if (m[2]) cls = 'hl-sig';
      else if (m[3] || m[4]) cls = 'hl-num';
      else {
        var up = w.toUpperCase();
        if (KW.indexOf(up) >= 0) cls = up === 'TRUE' || up === 'FALSE' ? 'hl-num' : 'hl-kw';
        else if (MF.scl.TYPES[up]) cls = 'hl-type';
        else if (MF.scl.FUNCS[up]) cls = 'hl-fn';
      }
      out += cls ? '<span class="' + cls + '">' + esc(w) + '</span>' : esc(w);
      last = m.index + w.length;
    }
    return out + esc(code.slice(last));
  },

  // ---------- Variablenliste ----------

  renderVars: function () {
    var self = this;
    var q = this.varFilter;
    var html = '';
    var match = function (s) { return !q || s.toLowerCase().indexOf(q) >= 0; };

    // Eigene Variablen aus VAR … END_VAR
    var u = MF.logic.unit(this.rule);
    var locals = u.prog ? u.prog.vars : [];
    var lhtml = '';
    locals.forEach(function (v) {
      if (!match(v.name + ' ' + v.type)) return;
      var fb = MF.scl.FBS[v.type];
      var ins = fb ? v.name + '.' + fb.outputs[0] : v.name;
      lhtml += '<div class="scl-var" draggable="true" data-insert="' + self.attr(ins) + '" data-local="' + self.attr(v.name.toUpperCase()) + '" title="Ziehen oder Doppelklick fügt ' + self.attr(ins) + ' ein">' +
        '<span class="dot"></span><span class="scl-var-name">' + self.html(v.name) + '</span>' +
        '<span class="scl-var-type">' + v.type + '</span><span class="scl-var-val"></span></div>';
    });
    if (lhtml) html += '<div class="scl-var-group">Eigene Variablen</div>' + lhtml;

    // Signale der Anlage, je Körper
    MF.model.bodies.forEach(function (el) {
      var rows = '';
      MF.io(el).forEach(function (s) {
        if (!match(el.id + ' ' + el.name + ' ' + s.name + ' ' + s.type)) return;
        var ins = '"' + el.id + '".' + s.name;
        rows += '<div class="scl-var" draggable="true" data-insert="' + self.attr(ins) + '" data-el="' + self.attr(el.id) + '" data-signal="' + self.attr(s.name) + '"' +
          ' title="' + self.attr(ins) + (s.dir === 'in' ? ' – lesen und schreiben' : ' – nur lesen') + '">' +
          '<span class="dot"></span><span class="scl-var-name">' + self.html(s.name) + '</span>' +
          '<span class="dir dir-' + s.dir + '">' + (s.dir === 'in' ? 'EIN' : 'AUS') + '</span>' +
          '<span class="scl-var-val"></span></div>';
      });
      if (rows) html += '<div class="scl-var-group">' + self.html(el.id + ' · ' + el.name) + '</div>' + rows;
    });

    this.varList.innerHTML = html || '<div class="scl-empty">Keine Treffer.</div>';
    this.refreshLive();
  },

  // Live-Werte in der Variablenliste (pro Bild aufgerufen)
  refreshLive: function () {
    if (!this.isOpen()) return;
    var u = MF.logic.units[this.rule.id];
    this.varList.querySelectorAll('.scl-var').forEach(function (row) {
      var v;
      if (row.dataset.el) {
        var el = MF.store.findBody(row.dataset.el);
        if (!el) return;
        v = MF.engine.signal(el, row.dataset.signal);
      } else {
        var cell = u && u.state && u.state[row.dataset.local];
        if (!cell) return;
        if (cell.fb) {
          var f = cell.fb;
          var outs = MF.scl.FBS[cell.type].outputs;
          v = outs.map(function (o) { return o + '=' + MF.sclEditor.fmt(f[o]); }).join(' ');
          row.querySelector('.dot').classList.toggle('is-on', !!(f.Q || f.Q1));
          row.querySelector('.scl-var-val').textContent = v;
          return;
        }
        v = cell.value;
      }
      row.querySelector('.dot').classList.toggle('is-on', !!v);
      row.querySelector('.scl-var-val').textContent = MF.sclEditor.fmt(v);
    });
    var msg = document.getElementById('scl-msg');
    if (u && u.runError && msg.className.indexOf('is-error') < 0) this.renderStatus();
  },

  fmt: function (v) {
    if (typeof v !== 'number') return '';
    return String(Math.round(v * 1000) / 1000).replace('.', ',');
  },

  // ---------- Lexikon ----------

  renderLexikon: function (box, q, withInsert) {
    var self = this;
    var html = '', cat = null;
    MF.lexikon.forEach(function (e) {
      var hay = (e.name + ' ' + e.cat + ' ' + e.text + ' ' + e.syntax).toLowerCase();
      if (q && hay.indexOf(q) < 0) return;
      if (e.cat !== cat) { cat = e.cat; html += '<div class="lex-cat">' + self.html(cat) + '</div>'; }
      html += '<details class="lex-item"' + (q ? ' open' : '') + '><summary>' + self.html(e.name) + '</summary><div class="lex-body">' +
        (e.syntax ? '<pre class="lex-code">' + self.highlight(e.syntax) + '</pre>' : '') +
        '<p>' + self.html(e.text) + '</p>' +
        (e.example ? '<div class="lex-label">Beispiel</div><pre class="lex-code">' + self.highlight(e.example) + '</pre>' : '') +
        (withInsert && (e.insert || e.example) ? '<div class="lex-actions">' +
          (e.insert ? '<button type="button" class="props-action" data-lex-insert="' + self.attr(e.insert) + '">Einfügen</button>' : '') +
          (e.example ? '<button type="button" class="props-action" data-lex-insert="' + self.attr(e.example + '\n') + '">Beispiel einfügen</button>' : '') +
          '</div>' : '') +
        '</div></details>';
    });
    box.innerHTML = html || '<div class="scl-empty">Nichts gefunden.</div>';
  },

  html: function (s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  },

  attr: function (s) {
    return this.html(s).replace(/"/g, '&quot;');
  }
};
