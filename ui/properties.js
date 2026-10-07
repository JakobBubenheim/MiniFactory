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

  // Eine Zeile "Label | Wert". def: {label, type, unit, step, min, options, readonly}
  field: function (parent, def, value, onChange) {
    var row = document.createElement('label');
    row.className = 'field';
    var lab = document.createElement('span');
    lab.className = 'field-label';
    lab.textContent = def.label;
    lab.title = def.label;
    var val = document.createElement('span');
    val.className = 'field-value';

    var input;
    if (def.type === 'select') {
      input = document.createElement('select');
      def.options.forEach(function (o) {
        var opt = document.createElement('option');
        opt.value = opt.textContent = o;
        input.appendChild(opt);
      });
      input.value = value;
    } else {
      input = document.createElement('input');
      input.type = def.type === 'bool' ? 'checkbox' : def.type === 'color' ? 'color' : def.type === 'number' ? 'number' : 'text';
      if (def.type === 'bool') input.checked = !!value;
      else input.value = value;
      if (def.step !== undefined) input.step = def.step;
      if (def.min !== undefined) input.min = def.min;
      if (def.readonly) input.readOnly = true;
    }

    if (onChange && !def.readonly) {
      input.addEventListener('change', function () {
        var v = def.type === 'bool' ? input.checked
              : def.type === 'number' ? parseFloat(input.value)
              : input.value;
        if (def.type === 'number' && isNaN(v)) return;
        onChange(v);
      });
    }

    val.appendChild(input);
    if (def.unit !== undefined) {
      var u = document.createElement('span');
      u.className = 'unit';
      u.textContent = def.unit;
      val.appendChild(u);
    }
    row.appendChild(lab);
    row.appendChild(val);
    parent.appendChild(row);
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
        self.field(s3, p, el.props[p.key], function (v) { el.props[p.key] = v; self.commit(); });
      });
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
        tr.innerHTML =
          '<td><span class="dot"></span></td>' +
          '<td class="mono"></td>' +
          '<td><span class="dir dir-' + s.dir + '">' + (s.dir === 'in' ? 'EIN' : 'AUS') + '</span></td>' +
          '<td class="mono">' + s.type + '</td>' +
          '<td class="mono">' + '0' + '</td>' +
          '<td></td>';
        tr.children[1].textContent = s.name;
        tr.children[5].textContent = users.map(function (r) { return r.name; }).join(', ') || '–';
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      body.appendChild(table);
      var note = document.createElement('div');
      note.className = 'io-note';
      note.textContent = 'Live-Werte erscheinen, sobald die Simulation läuft (Etappe 3).';
      body.appendChild(note);
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
      sentence.children[1].textContent = rule.when;
      sentence.children[4].textContent = rule.then;
    }
    updateSentence();

    var s1 = this.section(body, 'Allgemein');
    this.field(s1, { label: 'Name', type: 'text' }, rule.name, function (v) { rule.name = v; self.commit(); self.render(); });

    var s2 = this.section(body, 'Bedingung');
    this.field(s2, { label: 'Wenn', type: 'select', options: MF.store.signals('out') }, rule.when,
      function (v) { rule.when = v; updateSentence(); self.commit(); });
    this.field(s2, { label: 'Dann', type: 'select', options: MF.store.signals('in') }, rule.then,
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

  renderEmpty: function () {
    var d = document.createElement('div');
    d.className = 'props-empty';
    d.innerHTML = '<strong>Nichts ausgewählt</strong>Wähle ein Element im Strukturbaum oder auf der Fläche.';
    this.root.appendChild(d);
  }
};
