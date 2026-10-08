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

  // Auf min/max begrenzen; bei Schritt 1 ganzzahlig, mit quantize auf Vielfache von step
  clamp: function (def, v) {
    if (def.step === 1) v = Math.round(v);
    else if (def.quantize) v = Math.round(Math.round(v / def.step) * def.step * 1e6) / 1e6;
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
      // Optionen als Text oder als { value, label }
      def.options.forEach(function (o) {
        var opt = document.createElement('option');
        if (o !== null && typeof o === 'object') {
          opt.value = o.value;
          opt.textContent = o.label;
        } else {
          opt.value = o;
          opt.textContent = o === '' ? '–' : o;
        }
        input.appendChild(opt);
      });
      input.value = value;
      if (def.readonly) input.disabled = true;
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
      this.folderField(s1, el, 'plant');

      var s2 = this.section(body, 'Position');
      var locked = { readonly: el.locked };
      // Schrittweite folgt dem Fangen: ganze Zellen oder 0,1 Zellen
      var step = MF.editor.snapStep();
      this.field(s2, { label: 'X', type: 'number', unit: 'Zelle', step: step, quantize: true, readonly: locked.readonly }, el.x,
        function (v) { el.x = MF.editor.snapValue(v); self.commit(); });
      this.field(s2, { label: 'Y', type: 'number', unit: 'Zelle', step: step, quantize: true, readonly: locked.readonly }, el.y,
        function (v) { el.y = MF.editor.snapValue(v); self.commit(); });
      this.field(s2, { label: 'Drehung', type: 'select', options: ['0', '90', '180', '270'], unit: '°',
        readonly: locked.readonly, hint: 'Im Uhrzeigersinn; beim Förderband auch die Laufrichtung' },
        String(el.rot || 0), function (v) { MF.editor.setRotation(el, parseInt(v, 10)); self.render(); });
      if (el.type === 'conveyor') {
        // Länge liegt bei 90°/270° in h statt in w
        var len = (el.rot || 0) % 180 ? 'h' : 'w';
        this.field(s2, { label: 'Länge', type: 'number', unit: 'Zelle', step: 1, min: 1, readonly: locked.readonly }, el[len], function (v) { el[len] = Math.max(1, Math.round(v)); self.commit(); });
      }

      var s3 = this.section(body, 'Verhalten');
      type.props.forEach(function (p) {
        var input = self.field(s3, p, el.props[p.key], function (v) {
          // Richtung von Band und Schieber = Drehung: das Element dreht sich mit
          if (p.key === 'direction' && MF.ROT_ZERO_DIR[el.type] && v in MF.DIR_ROT &&
              MF.rotForDir(el.type, v) !== (el.rot || 0)) {
            MF.editor.setRotation(el, MF.rotForDir(el.type, v));
            self.render();
            return;
          }
          el.props[p.key] = v;
          self.commit();
        });
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
        var byRule = s.dir === 'in' ? MF.logic.activeSetting(sig) : [];
        var tr = document.createElement('tr');
        tr.dataset.signal = s.name;
        if (byRule.length) tr.classList.add('is-rule');
        tr.innerHTML =
          '<td><span class="dot"></span></td>' +
          '<td class="mono"></td>' +
          '<td><span class="dir dir-' + s.dir + '">' + (s.dir === 'in' ? 'EIN' : 'AUS') + '</span></td>' +
          '<td class="mono">' + s.type + '</td>' +
          '<td class="io-cell"></td>' +
          '<td></td>';
        tr.children[1].textContent = s.name;
        tr.children[5].textContent = users.map(function (r) {
          return r.name + (MF.logic.isActive(r) ? '' : ' (aus)');
        }).join(', ') || '–';
        self.ioValueCell(tr.children[4], el, s, byRule);
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      body.appendChild(table);
      var note = document.createElement('div');
      note.className = 'io-note';
      note.textContent = 'Wert anklicken und eintippen, z. B. 0 oder 1. Eingänge (EIN) wirken sofort; ' +
        'Ausgänge (AUS) werden geforct (F) und zeigen den festen Wert, bis du × klickst. ' +
        'Eingänge mit R werden durch eine Regel gesetzt und sind hier nicht änderbar.';
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
    var scl = MF.logic.isScl(rule);
    this.header('i-rule', rule.name, rule.id + ' · ' + (scl ? 'SCL-Baustein' : 'Regel'));
    this.tabs([['props', scl ? 'Baustein' : 'Regel']]);
    var body = this.body();

    var s1 = this.section(body, 'Allgemein');
    this.field(s1, { label: 'Name', type: 'text' }, rule.name, function (v) { rule.name = v; self.commit(); self.render(); });
    this.folderField(s1, rule, 'logic');
    if (scl) {
      var order = MF.logic.sclOrder();
      var no = order.indexOf(rule) + 1;
      this.field(s1, { label: 'Ausführung', type: 'text', readonly: true,
        hint: 'SCL-Bausteine laufen in jedem Zyklus nacheinander, in der Reihenfolge im Strukturbaum von oben nach unten (Ordner werden dabei ganz durchlaufen). Zum Ändern im Baum verschieben.' },
        no ? no + '. von ' + order.length + ' (Reihenfolge im Baum)' : 'läuft nicht');
    }
    this.field(s1, { label: 'Aktiv', type: 'bool', onText: 'Ja', offText: 'Nein', hint: 'Abgeschaltete Regeln bleiben erhalten, werden aber nicht ausgewertet' },
      rule.enabled !== false, function (v) { rule.enabled = v; self.commit(); self.render(); });
    this.field(s1, { label: 'Art', type: 'select', options: ['Wenn-dann', 'SCL'], hint: 'Einfache Wenn-dann-Regel oder eigener SCL-Code' },
      scl ? 'SCL' : 'Wenn-dann', function (v) {
        rule.kind = v === 'SCL' ? 'scl' : 'rule';
        if (rule.kind === 'scl' && !rule.code) rule.code = MF.logic.toScl(rule);
        self.commit();
        self.render();
      });

    if (scl) this.renderSclCode(body, rule);
    else this.renderSimpleRule(body, rule);

    // Freie Beschreibung, z. B. wozu die Regel da ist
    var s3 = this.section(body, 'Beschreibung');
    var ta = document.createElement('textarea');
    ta.className = 'rule-desc';
    ta.rows = 3;
    ta.placeholder = 'Wozu ist diese Regel da? z. B. "Kisten an LS1 nach SE2 ausschleusen"';
    ta.value = rule.description || '';
    ta.setAttribute('aria-label', 'Beschreibung');
    ta.addEventListener('input', function () { rule.description = ta.value; self.commit(); });
    s3.appendChild(ta);
  },

  renderSimpleRule: function (body, rule) {
    var self = this;
    var sentence = document.createElement('div');
    sentence.className = 'rule-sentence';
    function updateSentence() {
      sentence.innerHTML = '<b>WENN</b> <span></span> = 1<br><b>DANN</b> <span></span> := 1';
      sentence.children[1].textContent = rule.when || '–';
      sentence.children[4].textContent = rule.then || '–';
      sentence.classList.toggle('is-off', rule.enabled === false);
      if (rule.enabled === false) sentence.insertAdjacentHTML('beforeend', '<br><i>abgeschaltet – Ziel steht auf Startwert</i>');
      else if (!rule.when || !rule.then) sentence.insertAdjacentHTML('beforeend', '<br><i>unvollständig – wird nicht ausgewertet</i>');
      else sentence.insertAdjacentHTML('beforeend', '<br><i>sonst ' + self.esc(rule.then) + ' := 0</i>');
    }
    updateSentence();

    var s2 = this.section(body, 'Bedingung');
    this.field(s2, { label: 'Wenn', type: 'select', options: [''].concat(MF.store.signals('out')) }, rule.when,
      function (v) { rule.when = v; updateSentence(); self.commit(); });
    this.field(s2, { label: 'Dann', type: 'select', options: [''].concat(MF.store.signals('in')) }, rule.then,
      function (v) { rule.then = v; updateSentence(); self.commit(); });
    s2.appendChild(sentence);

    var conv = document.createElement('button');
    conv.type = 'button';
    conv.className = 'props-action';
    conv.textContent = 'In SCL umwandeln …';
    conv.title = 'Regel als SCL-Code weiterschreiben, z. B. mit Zeiten, Zählern oder mehreren Bedingungen';
    conv.addEventListener('click', function () {
      rule.kind = 'scl';
      rule.code = MF.logic.toScl(rule);
      self.commit();
      self.render();
      MF.sclEditor.open(rule);
    });
    s2.appendChild(conv);
  },

  // Code direkt im Panel bearbeiten (gleiche Farben und Tasten wie im SCL-Editor).
  // Für Größeres gibt es den SCL-Editor mit Variablenliste und Lexikon.
  renderSclCode: function (body, rule) {
    var self = this;
    var s2 = this.section(body, 'SCL-Code');

    var box = document.createElement('div');
    box.className = 'scl-mini';
    box.innerHTML = '<div class="scl-layer"><pre class="scl-hl" aria-hidden="true"></pre></div>' +
      '<textarea class="scl-text" spellcheck="false" autocomplete="off" autocapitalize="off" aria-label="SCL-Code"></textarea>';
    var layer = box.firstChild, hl = layer.firstChild, ta = box.lastChild;
    ta.value = rule.code || '';
    s2.appendChild(box);

    var st = document.createElement('div');
    s2.appendChild(st);

    // Höhe wächst mit dem Code, Breite scrollt
    function paint() {
      hl.innerHTML = MF.sclEditor.highlight(ta.value) + '\n ';
      var lines = ta.value.split('\n').length;
      box.style.height = Math.max(90, lines * 16 + 26) + 'px';
      layer.style.transform = 'translateX(' + (-ta.scrollLeft) + 'px)';
    }
    function status() {
      var u = MF.logic.unit(rule);
      var err = u.error || u.runError;
      st.className = 'scl-status ' + (err ? 'is-error' : 'is-ok');
      st.textContent = err
        ? 'Zeile ' + err.line + ': ' + err.message + (u.error && u.prog ? ' (letzte fehlerfreie Fassung läuft)' : '')
        : 'OK · schreibt ' + (u.prog.writes.join(', ') || 'nichts') + (u.prog.reads.length ? ' · liest ' + u.prog.reads.join(', ') : '');
    }
    function changed() {
      rule.code = ta.value;
      paint();
      self.commit();   // Panel nicht neu aufbauen, damit der Fokus bleibt
      status();
    }

    ta.addEventListener('input', changed);
    ta.addEventListener('scroll', paint);
    ta.addEventListener('keydown', function (e) {
      if (MF.sclEditor.handleKey(e, ta)) changed();
    });
    paint();
    status();

    var open = document.createElement('button');
    open.type = 'button';
    open.className = 'props-action';
    open.textContent = 'Im großen Editor öffnen';
    open.title = 'SCL-Editor mit Variablenliste und Lexikon';
    open.addEventListener('click', function () { MF.sclEditor.open(rule); });
    s2.appendChild(open);
  },

  esc: function (s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  },

  // Auswahlliste "Ordner" mit vollem Pfad, z. B. "Förderstrecke 1 / Ausschleusung".
  // obj: Element, Regel oder Ordner; Ordner können nicht in sich selbst liegen.
  folderField: function (parent, obj, area) {
    var self = this;
    var isFolder = !!MF.store.findFolder(obj.id) && obj.area === area;
    var options = [{ value: '', label: MF.store.AREAS[area] + ' (oberste Ebene)' }];
    MF.store.folderList(area).forEach(function (o) {
      if (isFolder && MF.store.isWithin(o.folder.id, obj.id)) return;
      options.push({ value: o.folder.id, label: o.path });
    });
    this.field(parent, { label: 'Ordner', type: 'select', options: options,
      hint: 'Ordner im Strukturbaum; im Baum auch per Ziehen änderbar' },
      MF.store.parentOf(obj, area) || '', function (v) {
        MF.store.moveNodes([obj.id], area, v || null, null);
        MF.tree.reveal(obj.id);
        self.render();
      });
  },

  // ---------- Projekt, Anlage, Ordner, Logik ----------

  renderContainer: function (id) {
    var els = MF.model.elements;
    var title, sub, icon, list, folder = MF.store.findFolder(id);
    var area = id === 'logic' || (folder && folder.area === 'logic') ? 'logic' : 'plant';

    if (id === 'project') {
      title = MF.model.name; sub = 'Projekt'; icon = 'i-project'; list = els;
    } else if (id === 'plant') {
      title = 'Anlage'; sub = 'Bereich'; icon = 'i-plant'; list = els;
    } else if (id === 'logic') {
      title = 'Logik'; sub = MF.model.rules.length + ' Regeln'; icon = 'i-logic'; list = [];
    } else if (folder) {
      var path = MF.store.folderPath(folder.id);
      title = folder.name; icon = 'i-folder';
      sub = 'Ordner in ' + [MF.store.AREAS[area]].concat(path.slice(0, -1)).join(' / ');
      list = area === 'plant' ? MF.store.treeOrder('plant', folder.id) : [];
    } else {
      this.renderEmpty();
      return;
    }

    this.header(icon, title, sub);
    var body = this.body();
    var self = this;

    if (folder) {
      var sF = this.section(body, 'Ordner');
      this.field(sF, { label: 'Name', type: 'text' }, folder.name, function (v) {
        if (!v.trim()) return;
        folder.name = v.trim(); self.commit(); self.render();
      });
      this.field(sF, { label: 'ID', type: 'text', readonly: true }, folder.id);
      this.folderField(sF, folder, area);
      var c = MF.store.childrenOf(area, folder.id);
      var subs = MF.store.folderList(area).filter(function (o) {
        return o.folder !== folder && MF.store.isWithin(o.folder.id, folder.id);
      }).length;
      this.field(sF, { label: 'Unterordner', type: 'text', readonly: true, hint: 'Direkt darin (insgesamt, mit allen Ebenen)' },
        c.folders.length + (subs !== c.folders.length ? ' (' + subs + ')' : ''));
      if (area === 'logic') {
        var rules = MF.store.treeOrder('logic', folder.id);
        var sR = this.section(body, 'Inhalt');
        this.field(sR, { label: 'Regeln', type: 'text', readonly: true },
          rules.filter(function (r) { return !MF.logic.isScl(r); }).length);
        this.field(sR, { label: 'SCL-Bausteine', type: 'text', readonly: true },
          rules.filter(function (r) { return MF.logic.isScl(r); }).length);
        this.renderOrder(body, rules);
      }
    }

    if (id === 'project') {
      var s0 = this.section(body, 'Projekt');
      this.field(s0, { label: 'Name', type: 'text' }, MF.model.name, function (v) { MF.model.name = v; self.commit(); self.render(); });

      var sSim = this.section(body, 'Simulation');
      this.field(sSim, { label: 'Zeitschritt', type: 'select', options: ['10', '20', '50', '100'], unit: 'ms' },
        String(MF.model.settings.dtMs), function (v) { MF.ui.changeDtMs(parseInt(v, 10)); self.render(); });
      this.field(sSim, { label: 'Rasterzelle', type: 'number', unit: 'm', step: 0.1, min: 0.1 },
        MF.model.settings.cellM, function (v) { if (v > 0) { MF.model.settings.cellM = v; self.commit(); } });
    }

    if (list.length || (folder && area === 'plant')) {
      var s1 = this.section(body, folder ? 'Inhalt (mit Unterordnern)' : 'Inhalt');
      if (!list.length) this.field(s1, { label: 'Elemente', type: 'text', readonly: true }, 0);
      Object.keys(MF.types).forEach(function (t) {
        var n = list.filter(function (el) { return el.type === t; }).length;
        if (n) self.field(s1, { label: MF.types[t].label, type: 'text', readonly: true }, n);
      });
    }
    if (id === 'logic' || id === 'project') {
      var s2 = this.section(body, 'Logik');
      this.field(s2, { label: 'Regeln', type: 'text', readonly: true }, MF.model.rules.length);
      this.field(s2, { label: 'Signale', type: 'text', readonly: true }, MF.store.signals().length);
      if (id === 'logic') this.renderOrder(body, MF.logic.order());
    }
  },

  // Ausführungsreihenfolge der SCL-Bausteine (= Reihenfolge im Strukturbaum)
  renderOrder: function (body, rules) {
    var all = MF.logic.sclOrder();
    var scl = rules.filter(function (r) { return MF.logic.isScl(r); });
    if (!scl.length) return;
    var s = this.section(body, 'Ausführungsreihenfolge');
    var note = document.createElement('div');
    note.className = 'io-note';
    note.textContent = 'Pro Zyklus laufen erst die Wenn-dann-Regeln, dann die SCL-Bausteine nacheinander – ' +
      'in der Reihenfolge, in der sie im Strukturbaum von oben nach unten stehen (Ordner werden ganz durchlaufen). ' +
      'Zum Ändern im Baum ziehen.';
    s.appendChild(note);
    var ol = document.createElement('ol');
    ol.className = 'order-list';
    scl.forEach(function (r) {
      var li = document.createElement('li');
      var no = all.indexOf(r) + 1;
      var path = MF.store.folderPath(MF.store.parentOf(r, 'logic'));
      li.textContent = r.name + (path.length ? ' (' + path.join(' / ') + ')' : '');
      if (no) li.value = no;
      else { li.classList.add('muted'); li.textContent += ' – läuft nicht'; li.style.listStyle = 'none'; }
      ol.appendChild(li);
    });
    s.appendChild(ol);
  },

  // Wert-Zelle der I/O-Tabelle: eintippen setzt den Eingang bzw. forct den Ausgang
  // byRule: aktive Regeln, die diesen Eingang schreiben – dann nur Anzeige
  ioValueCell: function (td, el, s, byRule) {
    var self = this;
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'io-value';
    input.inputMode = 'decimal';
    input.setAttribute('aria-label', el.id + '.' + s.name);
    input.title = s.dir === 'in' ? 'Eingang setzen' : 'Ausgang forcen';
    if (byRule && byRule.length) {
      input.readOnly = true;
      input.title = 'Durch Regel gesetzt: ' + byRule.map(function (r) { return r.name; }).join(', ');
      td.appendChild(input);
      return;
    }
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
      var release = tr.querySelector('.io-release');
      if (release) release.hidden = !forced;
    });
  },

  renderEmpty: function () {
    var d = document.createElement('div');
    d.className = 'props-empty';
    d.innerHTML = '<strong>Nichts ausgewählt</strong>Wähle ein Element im Strukturbaum oder auf der Fläche.';
    this.root.appendChild(d);
  }
};
