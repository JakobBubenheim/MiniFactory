// Eigenschaften-Panel: zeigt den im Baum oder auf der Fläche gewählten Knoten.
// Elemente haben die Tabs Eigenschaften | I/O | Darstellung.
window.MF = window.MF || {};

MF.props = {
  tab: 'props',
  selfEdit: false,   // true, während das Panel selbst eine Änderung meldet

  init: function () {
    var self = this;
    this.root = document.getElementById('props');
    MF.store.on(function () {
      if (!self.selfEdit) self.render();
    });
    this.render();
  },

  // Änderung ins Modell schreiben, ohne das Panel neu aufzubauen (Fokus bleibt).
  commit: function () {
    this.selfEdit = true;
    MF.store.changed();
    this.selfEdit = false;
  },

  render: function () {
    var id = MF.store.selectedId;
    var el = MF.store.findElement(id);
    var rule = MF.store.findRule(id);
    this.root.innerHTML = '';

    if (el) this.renderElement(el);
    else if (rule) this.renderRule(rule);
    else if (id) this.renderContainer(id);
    else this.renderEmpty();
  },

  // ---------- Bausteine ----------

  header: function (icon, title, sub) {
    var h = document.createElement('div');
    h.className = 'props-header';
    h.innerHTML =
      '<div class="big-icon"><svg><use href="#' + icon + '"/></svg></div>' +
      '<div><div class="props-title"></div><div class="props-sub"></div></div>';
    h.querySelector('.props-title').textContent = title;
    h.querySelector('.props-sub').textContent = sub;
    this.root.appendChild(h);
  },

  tabs: function (list) {
    var self = this;
    if (!list.some(function (t) { return t[0] === self.tab; })) this.tab = list[0][0];
    var bar = document.createElement('div');
    bar.className = 'props-tabs';
    bar.setAttribute('role', 'tablist');
    list.forEach(function (t) {
      var b = document.createElement('button');
      b.className = 'props-tab';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(t[0] === self.tab));
      b.textContent = t[1];
      b.addEventListener('click', function () { self.tab = t[0]; self.render(); });
      bar.appendChild(b);
    });
    this.root.appendChild(bar);
  },

  body: function () {
    var b = document.createElement('div');
    b.className = 'props-body';
    b.setAttribute('role', 'tabpanel');
    this.root.appendChild(b);
    return b;
  },

  section: function (parent, title) {
    var d = document.createElement('details');
    d.className = 'section';
    d.open = true;
    d.innerHTML = '<summary><svg><use href="#i-chevron"/></svg><span></span></summary><div class="section-body"></div>';
    d.querySelector('summary span').textContent = title;
    parent.appendChild(d);
    return d.querySelector('.section-body');
  },

  // Zahl mit deutschem Komma anzeigen, z. B. 0.5 -> "0,5"
  formatNumber: function (v) {
    if (typeof v !== 'number' || isNaN(v)) return '';
    return String(Math.round(v * 1e6) / 1e6).replace('.', ',');
  },

  // "0,5" oder "0.5" -> 0.5; NaN, wenn keine Zahl
  parseNumber: function (text) {
    var t = String(text).trim().replace(',', '.');
    return t === '' ? NaN : Number(t);
  },

  // Auf min/max begrenzen; bei Schritt 1 ganzzahlig
  clamp: function (def, v) {
    if (def.step === 1) v = Math.round(v);
    if (def.min !== undefined) v = Math.max(def.min, v);
    if (def.max !== undefined) v = Math.min(def.max, v);
    return v;
  },

  // Eine Zeile "Label | Wert".
  // def: {label, type, unit, step, min, max, options, readonly, hint, onText, offText}
  field: function (parent, def, value, onChange) {
    var row = document.createElement('label');
    row.className = 'field';
    if (def.hint) row.title = def.hint;
    var lab = document.createElement('span');
    lab.className = 'field-label';
    lab.textContent = def.label;
    if (!def.hint) lab.title = def.label;
    var val = document.createElement('span');
    val.className = 'field-value';
    var editable = onChange && !def.readonly;

    var input;
    if (def.type === 'select') {
      input = document.createElement('select');
      def.options.forEach(function (o) {
        var opt = document.createElement('option');
        opt.value = o;
        opt.textContent = o === '' ? '–' : o;
        input.appendChild(opt);
      });
      input.value = value;
      if (editable) input.addEventListener('change', function () { onChange(input.value); });
      val.appendChild(input);
    } else if (def.type === 'bool') {
      input = this.switchControl(def, value, editable ? onChange : null);
      val.appendChild(input);
    } else if (def.type === 'number') {
      input = this.numberControl(def, value, editable ? onChange : null, val);
    } else {
      input = document.createElement('input');
      input.type = def.type === 'color' ? 'color' : 'text';
      input.value = value;
      if (def.readonly) input.readOnly = true;
      if (editable) input.addEventListener('change', function () { onChange(input.value); });
      val.appendChild(input);
    }
    if (def.unit !== undefined) {
      var u = document.createElement('span');
      u.className = 'unit';
      u.textContent = def.unit;
      val.insertBefore(u, val.querySelector('.stepper'));  // Einheit direkt hinter die Zahl
    }
    row.appendChild(lab);
    row.appendChild(val);
    parent.appendChild(row);
    return input;
  },

  // An/Aus-Schalter: ein Klick schaltet um
  switchControl: function (def, value, onChange) {
    var on = !!value;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'switch';
    btn.setAttribute('role', 'switch');
    function show() {
      btn.setAttribute('aria-checked', String(on));
      btn.textContent = on ? (def.onText || 'Ein') : (def.offText || 'Aus');
    }
    show();
    if (onChange) {
      btn.addEventListener('click', function () { on = !on; show(); onChange(on); });
    } else {
      btn.disabled = true;
    }
    return btn;
  },

  // Zahlenfeld mit − / +. Änderungen wirken sofort, auch während die Simulation läuft.
  // Pfeil hoch/runter = ein Schritt, mit Shift zehn Schritte.
  numberControl: function (def, value, onChange, val) {
    var self = this;
    var input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'decimal';
    input.className = 'num';
    input.value = this.formatNumber(value);
    if (!onChange) { input.readOnly = true; val.appendChild(input); return input; }

    var current = value;
    var step = def.step || 1;

    function set(v, rewrite) {
      v = self.clamp(def, v);
      if (rewrite) input.value = self.formatNumber(v);
      if (v === current) return;
      current = v;
      onChange(v);
    }

    // Beim Tippen übernehmen, ohne das Feld umzuschreiben
    input.addEventListener('input', function () {
      var v = self.parseNumber(input.value);
      if (!isNaN(v)) set(v, false);
    });
    // Beim Verlassen oder Enter den tatsächlich gültigen Wert anzeigen
    input.addEventListener('change', function () { input.value = self.formatNumber(current); });
    input.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      var n = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1);
      set(Math.round((current + n * step) * 1e6) / 1e6, true);
    });

    function stepper(sign, text, label) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'stepper';
      b.textContent = text;
      b.setAttribute('aria-label', label);
      b.tabIndex = -1;
      b.addEventListener('click', function (e) {
        e.preventDefault();
        var n = sign * (e.shiftKey ? 10 : 1);
        set(Math.round((current + n * step) * 1e6) / 1e6, true);
      });
      return b;
    }

    val.appendChild(input);
    val.appendChild(stepper(-1, '−', def.label + ' verringern'));
    val.appendChild(stepper(1, '+', def.label + ' erhöhen'));
    return input;
  },

  // ---------- Element ----------

  renderElement: function (el) {
    var self = this;
    var type = MF.types[el.type];
    this.header(type.icon, el.name, el.id + ' · ' + type.label);
    this.tabs([['props', 'Eigenschaften'], ['io', 'I/O'], ['look', 'Darstellung']]);
    var body = this.body();

    if (this.tab === 'props') {
      var s1 = this.section(body, 'Allgemein');
      this.field(s1, { label: 'Name', type: 'text' }, el.name, function (v) { el.name = v; self.commit(); self.render(); });
      this.field(s1, { label: 'ID', type: 'text', readonly: true }, el.id);
      this.field(s1, { label: 'Typ', type: 'text', readonly: true }, type.label);
      this.field(s1, { label: 'Gruppe', type: 'text' }, el.group, function (v) { el.group = v; MF.tree.expanded['grp:' + v] = true; self.commit(); });

      var s2 = this.section(body, 'Position');
      var locked = { readonly: el.locked };
      this.field(s2, { label: 'X', type: 'number', unit: 'Zelle', step: 1, readonly: locked.readonly }, el.x, function (v) { el.x = Math.round(v); self.commit(); });
      this.field(s2, { label: 'Y', type: 'number', unit: 'Zelle', step: 1, readonly: locked.readonly }, el.y, function (v) { el.y = Math.round(v); self.commit(); });
      if (el.type === 'conveyor') {
        this.field(s2, { label: 'Länge', type: 'number', unit: 'Zelle', step: 1, min: 1, readonly: locked.readonly }, el.w, function (v) { el.w = Math.max(1, Math.round(v)); self.commit(); });
      }

      var s3 = this.section(body, 'Verhalten');
      type.props.forEach(function (p) {
        var input = self.field(s3, p, el.props[p.key], function (v) { el.props[p.key] = v; self.commit(); });
        if (p.readonly) input.dataset.live = p.key;  // z. B. Zählerstand läuft mit
      });

      if (el.type === 'sink') {
        var reset = document.createElement('button');
        reset.type = 'button';
        reset.className = 'props-action';
        reset.textContent = 'Zähler zurücksetzen';
        reset.addEventListener('click', function () {
          el.props.count = 0;
          self.commit();
          self.refreshLive();
        });
        s3.appendChild(reset);
      }
    }

    if (this.tab === 'io') {
      var table = document.createElement('table');
      table.className = 'io-table';
      table.innerHTML = '<thead><tr><th></th><th>Name</th><th>Richtung</th><th>Typ</th><th>Wert</th><th>Funktion</th></tr></thead>';
      var tbody = document.createElement('tbody');
      type.io.forEach(function (s) {
        var sig = el.id + '.' + s.name;
        var users = s.dir === 'in' ? MF.logic.rulesSetting(sig) : MF.logic.rulesReading(sig);
        var tr = document.createElement('tr');
        tr.dataset.signal = s.name;
        tr.innerHTML =
          '<td><span class="dot"></span></td>' +
          '<td class="mono"></td>' +
          '<td><span class="dir dir-' + s.dir + '">' + (s.dir === 'in' ? 'EIN' : 'AUS') + '</span></td>' +
          '<td class="mono">' + s.type + '</td>' +
          '<td class="io-cell"></td>' +
          '<td></td>';
        tr.children[1].textContent = s.name;
        tr.children[5].textContent = users.map(function (r) { return r.name; }).join(', ') || '–';
        self.ioValueCell(tr.children[4], el, s);
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      body.appendChild(table);
      var note = document.createElement('div');
      note.className = 'io-note';
      note.textContent = 'Wert anklicken und eintippen, z. B. 0 oder 1. Eingänge (EIN) wirken sofort; ' +
        'Ausgänge (AUS) werden geforct (F) und zeigen den festen Wert, bis du × klickst.';
      body.appendChild(note);
      this.refreshLive();
    }

    if (this.tab === 'look') {
      var s4 = this.section(body, 'Darstellung');
      this.field(s4, { label: 'Farbe', type: 'color' }, el.color, function (v) { el.color = v; self.commit(); });
      this.field(s4, { label: 'Sichtbar', type: 'bool' }, el.visible, function (v) { el.visible = v; self.commit(); });
      this.field(s4, { label: 'Gesperrt', type: 'bool' }, el.locked, function (v) { el.locked = v; self.commit(); self.render(); });
    }
  },

  // ---------- Regel ----------

  renderRule: function (rule) {
    var self = this;
    this.header('i-rule', rule.name, rule.id + ' · Regel');
    this.tabs([['props', 'Regel']]);
    var body = this.body();

    var sentence = document.createElement('div');
    sentence.className = 'rule-sentence';
    function updateSentence() {
      sentence.innerHTML = '<b>WENN</b> <span></span> = 1<br><b>DANN</b> <span></span> := 1';
      sentence.children[1].textContent = rule.when || '–';
      sentence.children[4].textContent = rule.then || '–';
    }
    updateSentence();

    var s1 = this.section(body, 'Allgemein');
    this.field(s1, { label: 'Name', type: 'text' }, rule.name, function (v) { rule.name = v; self.commit(); self.render(); });

    var s2 = this.section(body, 'Bedingung');
    this.field(s2, { label: 'Wenn', type: 'select', options: [''].concat(MF.store.signals('out')) }, rule.when,
      function (v) { rule.when = v; updateSentence(); self.commit(); });
    this.field(s2, { label: 'Dann', type: 'select', options: [''].concat(MF.store.signals('in')) }, rule.then,
      function (v) { rule.then = v; updateSentence(); self.commit(); });

    body.appendChild(sentence);
  },

  // ---------- Projekt, Anlage, Gruppe, Logik ----------

  renderContainer: function (id) {
    var els = MF.model.elements;
    var title, sub, icon, list;

    if (id === 'project') {
      title = MF.model.name; sub = 'Projekt'; icon = 'i-project'; list = els;
    } else if (id === 'plant') {
      title = 'Anlage'; sub = 'Ordner'; icon = 'i-plant'; list = els;
    } else if (id === 'logic') {
      title = 'Logik'; sub = MF.model.rules.length + ' Regeln'; icon = 'i-logic'; list = [];
    } else {
      var g = id.slice(4);
      title = g; sub = 'Gruppe'; icon = 'i-folder';
      list = els.filter(function (el) { return el.group === g; });
    }

    this.header(icon, title, sub);
    var body = this.body();
    var self = this;

    if (id === 'project') {
      var s0 = this.section(body, 'Projekt');
      this.field(s0, { label: 'Name', type: 'text' }, MF.model.name, function (v) { MF.model.name = v; self.commit(); self.render(); });

      var sSim = this.section(body, 'Simulation');
      this.field(sSim, { label: 'Zeitschritt', type: 'select', options: ['10', '20', '50', '100'], unit: 'ms' },
        String(MF.model.settings.dtMs), function (v) { MF.ui.changeDtMs(parseInt(v, 10)); self.render(); });
      this.field(sSim, { label: 'Rasterzelle', type: 'number', unit: 'm', step: 0.1, min: 0.1 },
        MF.model.settings.cellM, function (v) { if (v > 0) { MF.model.settings.cellM = v; self.commit(); } });
    }

    if (list.length) {
      var s1 = this.section(body, 'Inhalt');
      Object.keys(MF.types).forEach(function (t) {
        var n = list.filter(function (el) { return el.type === t; }).length;
        if (n) self.field(s1, { label: MF.types[t].label, type: 'text', readonly: true }, n);
      });
    }
    if (id === 'logic' || id === 'project') {
      var s2 = this.section(body, 'Logik');
      this.field(s2, { label: 'Regeln', type: 'text', readonly: true }, MF.model.rules.length);
      this.field(s2, { label: 'Signale', type: 'text', readonly: true }, MF.store.signals().length);
    }
  },

  // Wert-Zelle der I/O-Tabelle: eintippen setzt den Eingang bzw. forct den Ausgang
  ioValueCell: function (td, el, s) {
    var self = this;
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'io-value';
    input.inputMode = 'decimal';
    input.setAttribute('aria-label', el.id + '.' + s.name);
    input.title = s.dir === 'in' ? 'Eingang setzen' : 'Ausgang forcen';
    var release = document.createElement('button');
    release.type = 'button';
    release.className = 'io-release';
    release.textContent = '×';
    release.title = 'Forcen aufheben';
    release.hidden = true;

    function changed() {
      self.commit();      // Fläche neu zeichnen, z. B. Pfeil grau bei Ein = 0
      self.refreshLive();
    }

    input.addEventListener('focus', function () { input.select(); });
    input.addEventListener('input', function () {
      var v = self.parseNumber(input.value);
      if (isNaN(v)) return;
      MF.engine.setSignal(el, s.name, v);
      changed();
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === 'Escape') input.blur();
    });
    // Ungültiges oder angepasstes (z. B. 5 bei BOOL -> 1) wieder sauber anzeigen
    input.addEventListener('blur', function () { self.refreshLive(); });
    release.addEventListener('click', function () {
      MF.engine.releaseForce(el, s.name);
      changed();
    });

    td.appendChild(input);
    td.appendChild(release);
  },

  // Laufende Werte aktualisieren, ohne das Panel neu aufzubauen (wird pro Bild aufgerufen)
  refreshLive: function () {
    if (!this.root) return;
    var el = MF.store.findElement(MF.store.selectedId);
    if (!el) return;
    this.root.querySelectorAll('[data-live]').forEach(function (input) {
      input.value = MF.props.formatNumber(el.props[input.dataset.live]);
    });
    var type = MF.types[el.type];
    this.root.querySelectorAll('tr[data-signal]').forEach(function (tr) {
      var name = tr.dataset.signal;
      var v = MF.engine.signal(el, name);
      var def = type.io.filter(function (s) { return s.name === name; })[0];
      var forced = MF.engine.isForced(el, name);
      tr.children[0].firstChild.classList.toggle('is-on', !!v);
      tr.classList.toggle('is-forced', forced);
      var input = tr.querySelector('.io-value');
      if (input !== document.activeElement) {
        input.value = def.type === 'FLOAT32' ? v.toFixed(2).replace('.', ',') : String(v);
      }
      tr.querySelector('.io-release').hidden = !forced;
    });
  },

  renderEmpty: function () {
    var d = document.createElement('div');
    d.className = 'props-empty';
    d.innerHTML = '<strong>Nichts ausgewählt</strong>Wähle ein Element im Strukturbaum oder auf der Fläche.';
    this.root.appendChild(d);
  }
};
