// Eigenschaften-Panel: zeigt den im Baum oder auf der Fläche gewählten Knoten.
// Körper haben die Tabs Eigenschaften | I/O | Darstellung. Eigenschaften:
//   Allgemein, Form & Lage (Maße, Höhe, Neigung, x/y/z, Drehung), Körperart,
//   je Funktion ein Abschnitt (Felder, Entfernen), Funktion hinzufügen, Werkstoff.
// Die Eigenschaften einer Vorlage (Tempo, Richtung, Hub …) erscheinen im Abschnitt
// ihrer Funktion und werden über MF.getProp/MF.setProp gelesen und geschrieben;
// frei gezeichnete Körper zeigen die allgemeinen Felder der Funktion (MF.FUNCTIONS).
// Was erlaubt ist (Funktion je Körperart, Neigung), prüft das Modell (sim/model.js).
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
    var el = MF.store.findBody(id);
    var rule = MF.store.findRule(id);
    this.root.innerHTML = '';

    if (el) this.renderBody(el);
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
      // Aktueller Wert, der keine der Optionen ist (z. B. Band schräg gedreht): als "–" zeigen
      var known = def.options.some(function (o) { return (o !== null && typeof o === 'object' ? o.value : o) === value; });
      if (!known) {
        var cur = document.createElement('option');
        cur.value = value;
        cur.textContent = value === '' ? '–' : value;
        cur.disabled = true;
        input.insertBefore(cur, input.firstChild);
      }
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

  // ---------- Körper ----------

  KIND_LABELS: MF.KIND_LABELS,
  KIND_HINT: 'immateriell: keine Kollision (Sensor, Erzeuger, Senke) · fest: bewegt sich nie (Transportfläche, Neigung) · ' +
    'kinematisch: nur über die Achse (Transportfläche, Achse) · dynamisch: fällt und rutscht mit der Physik',
  SHAPE_LABELS: { rect: 'Rechteck', circle: 'Kreis', polygon: 'Polygon' },

  renderBody: function (el) {
    var self = this;
    var t = MF.templates[el.template];
    var typeLabel = t ? t.label : 'Körper';
    this.header(MF.bodyIcon(el), el.name, el.id + ' · ' + typeLabel + ' · ' + (this.KIND_LABELS[el.kind] || el.kind));
    this.tabs([['props', 'Eigenschaften'], ['io', 'I/O'], ['look', 'Darstellung']]);
    var body = this.body();

    if (this.tab === 'props') {
      var s1 = this.section(body, 'Allgemein');
      this.field(s1, { label: 'Name', type: 'text' }, el.name, function (v) { el.name = v; self.commit(); self.render(); });
      this.field(s1, { label: 'ID', type: 'text', readonly: true }, el.id);
      this.field(s1, { label: 'Vorlage', type: 'text', readonly: true, hint: 'Vorlagen sind vorkonfigurierte Körper und lassen sich danach frei ändern' },
        t ? t.label : 'keine (gezeichnet)');
      this.folderField(s1, el, 'plant');

      this.renderForm(body, el);
      this.renderKind(body, el);
      this.renderFunctions(body, el);
      this.renderMaterial(body, el);
    }

    if (this.tab === 'io') {
      var table = document.createElement('table');
      table.className = 'io-table';
      table.innerHTML = '<thead><tr><th></th><th>Name</th><th>Richtung</th><th>Typ</th><th>Wert</th><th>Funktion</th></tr></thead>';
      var tbody = document.createElement('tbody');
      MF.io(el).forEach(function (s) {
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
      this.field(s4, { label: 'Farbe', type: 'color' }, el.look.color, function (v) { el.look.color = v; self.commit(); });
      this.field(s4, { label: 'Sichtbar', type: 'bool' }, el.look.visible, function (v) { el.look.visible = v; self.commit(); });
      this.field(s4, { label: 'Gesperrt', type: 'bool' }, el.look.locked, function (v) { el.look.locked = v; self.commit(); self.render(); });
    }
  },

  // Form und Lage über das Modell ändern (prüft z. B. Polygon, Neigung).
  // Bei einem Fehler bleibt der alte Wert; die Meldung steht in der Statusleiste.
  setForm: function (el, changes, rerender) {
    var err = MF.setForm(el, changes);
    if (err) { MF.ui.message(err); this.render(); return false; }
    this.commit();
    if (rerender) this.render();
    return true;
  },

  // Form & Lage: Formtyp, Maße, Höhe, Neigung, x, y, z, Drehung (m bzw. Grad)
  renderForm: function (body, el) {
    var self = this, sh = el.shape;
    var ro = el.look.locked;
    var s = this.section(body, 'Form & Lage');
    var step = MF.editor.snapStep();   // Schrittweite folgt dem Fangen
    var len = { type: 'number', unit: 'm', step: step, min: 0.01, max: 100, readonly: ro };
    function f(label, hint, extra) {
      var d = {};
      for (var k in len) d[k] = len[k];
      d.label = label;
      d.hint = hint;
      for (var e in extra || {}) d[e] = extra[e];
      return d;
    }
    this.field(s, { label: 'Form', type: 'text', readonly: true, hint: 'Grundriss in der Draufsicht; ändern über die Griffe auf der Fläche' },
      this.SHAPE_LABELS[sh.type] + (sh.type === 'polygon' ? ' (' + sh.points.length + ' Punkte)' : ''));
    if (sh.type === 'rect') {
      this.field(s, f('Breite', 'Ausdehnung in lokaler x-Richtung'), sh.w, function (v) { self.setForm(el, { w: v }); });
      this.field(s, f('Tiefe', 'Ausdehnung in lokaler y-Richtung'), sh.d, function (v) { self.setForm(el, { d: v }); });
    } else if (sh.type === 'circle') {
      this.field(s, f('Radius', 'Radius des Kreises'), sh.r, function (v) { self.setForm(el, { r: v }); });
    }
    var sloped = MF.geom.isSloped(sh);
    this.field(s, f(sloped ? 'Höhe Anfang' : 'Höhe', sloped ? 'Höhe am Anfang (kleinstes lokales x)' : 'Höhe des Körpers (Extrusion)'),
      sh.h, function (v) { self.setForm(el, { h: v }, sloped); });

    // Neigung: nur bei festen Körpern ohne Transportfläche (Konzept, Abschnitt 3)
    var slopeErr = sloped ? '' : MF.slopeError(el);
    this.field(s, { label: 'Oberseite', type: 'select', readonly: ro || !!slopeErr,
      options: [{ value: 'flat', label: 'eben' }, { value: 'slope', label: 'geneigt (Keil)' }],
      hint: slopeErr || 'Geneigt: Höhe läuft entlang der lokalen x-Achse von "Höhe Anfang" nach "Höhe Ende" – z. B. für eine Rutsche' },
      sloped ? 'slope' : 'flat', function (v) {
        self.setForm(el, { h2: v === 'slope' ? Math.round(el.shape.h / 2 * 1e6) / 1e6 : null }, true);
      });
    if (sloped) {
      this.field(s, f('Höhe Ende', 'Höhe am Ende (größtes lokales x)', { min: 0 }), sh.h2,
        function (v) { self.setForm(el, { h2: v }, true); });
      this.field(s, { label: 'Gefälle', type: 'text', readonly: true, hint: 'Neigung der Oberseite; bergab zeigt der Pfeil auf der Fläche' },
        this.formatNumber(Math.round(MF.geom.slopeDeg(sh) * 10) / 10) + '°');
    }

    this.field(s, f('X', 'Lage in der Draufsicht (nach rechts)', { quantize: true, min: -1000, max: 1000 }), el.pose.x,
      function (v) { self.setForm(el, { x: MF.editor.snapValue(v) }); });
    this.field(s, f('Y', 'Lage in der Draufsicht (nach unten)', { quantize: true, min: -1000, max: 1000 }), el.pose.y,
      function (v) { self.setForm(el, { y: MF.editor.snapValue(v) }); });
    this.field(s, f('Z (Unterseite)', 'Höhe der Unterseite über dem Boden', { min: -10, max: 100 }), el.pose.z,
      function (v) { self.setForm(el, { z: v }); });
    this.field(s, { label: 'Drehung', type: 'number', unit: '°', step: MF.editor.snap ? MF.model.settings.snap.angle || 5 : 1,
      min: -360, max: 720, readonly: ro, hint: 'Im Uhrzeigersinn um die Lage; Lauf- bzw. Schubrichtung drehen mit' },
      el.pose.rot, function (v) { MF.editor.setRotation(el, v); });
  },

  // Körperart. Fallen dabei Funktionen weg, wird vorher gefragt.
  renderKind: function (body, el) {
    var self = this;
    var s = this.section(body, 'Körperart');
    var options = MF.file.KINDS.map(function (k) { return { value: k, label: self.KIND_LABELS[k] + ' (' + k + ')' }; });
    this.field(s, { label: 'Körperart', type: 'select', options: options, readonly: el.look.locked, hint: this.KIND_HINT },
      el.kind, function (v) { self.changeKind(el, v); });
  },

  changeKind: function (el, kind) {
    var res = MF.setKind(el, kind, true);
    var lost = res.fns.map(function (fn) { return MF.FUNCTIONS[fn].label; });
    if (res.slope) lost.push('Neigung');
    if (lost.length && !window.confirm('Als "' + this.KIND_LABELS[kind] + '" gibt es ' + lost.join(', ') +
        ' nicht. Entfernen und Körperart wechseln?')) {
      this.render();
      return;
    }
    res = MF.setKind(el, kind);
    MF.store.dropSignals(el.id, res.signals);
    MF.store.changed();
    this.render();
    MF.ui.message(el.name + ' ist jetzt ' + this.KIND_LABELS[kind] + (lost.length ? ' – entfernt: ' + lost.join(', ') : '') +
      (res.density ? ' – Dichte auf ' + res.density + ' kg/m³ gesetzt' : '') + '.');
  },

  // Je Funktion ein Abschnitt; darunter "Funktion hinzufügen" mit den erlaubten
  renderFunctions: function (body, el) {
    var self = this;
    MF.FN_KEYS.forEach(function (fn) {
      if (el[fn]) self.renderFunction(body, el, fn);
    });

    var s = this.section(body, 'Funktion hinzufügen');
    var free = MF.allowedFns(el.kind).filter(function (fn) { return !el[fn]; });
    var options = [{ value: '', label: free.length ? 'wählen …' : 'keine weitere möglich' }];
    free.forEach(function (fn) {
      var err = MF.fnError(el, fn);
      options.push({ value: fn, label: MF.FUNCTIONS[fn].label + (err ? ' (nicht bei Neigung)' : '') });
    });
    var sel = this.field(s, { label: 'Funktion', type: 'select', options: options, readonly: !free.length,
      hint: 'Transportfläche: fest/kinematisch · Achse: kinematisch · Sensor, Erzeuger, Senke: immateriell' }, '',
      function (fn) {
        if (!fn) return;
        var err = MF.addFunction(el, fn);
        if (err) { MF.ui.message(err); self.render(); return; }
        MF.store.changed();
        self.render();
        MF.ui.message(MF.FUNCTIONS[fn].label + ' angelegt – Signale: ' +
          MF.FUNCTIONS[fn].io(el[fn]).map(function (x) { return el.id + '.' + x.name; }).join(', ') + '.');
      });
    // Nicht mögliche Funktionen ausgrauen
    Array.prototype.forEach.call(sel.options || [], function (o) {
      if (o.value && MF.fnError(el, o.value)) o.disabled = true;
    });
    var note = document.createElement('div');
    note.className = 'io-note';
    var kinds = el.kind === 'dynamic' ? 'Dynamische Körper haben keine Funktionen.'
      : 'Erlaubt bei "' + this.KIND_LABELS[el.kind] + '": ' + MF.allowedFns(el.kind).map(function (fn) { return MF.FUNCTIONS[fn].label; }).join(', ') + '.';
    note.textContent = kinds;
    s.appendChild(note);
  },

  renderFunction: function (body, el, fn) {
    var self = this, F = MF.FUNCTIONS[fn];
    var s = this.section(body, 'Funktion: ' + F.label);
    // Vorlagen zeigen ihre eigenen Eigenschaften (z. B. Hub in mm), sonst die allgemeinen Felder
    var tprops = MF.propsOf(el).filter(function (p) { return p.fn === fn; });
    if (tprops.length) {
      tprops.forEach(function (p) {
        var input = self.field(s, p, MF.getProp(el, p.key), function (v) {
          MF.setProp(el, p.key, v);
          // Richtung dreht den Körper: Lage und Panel neu zeigen
          if (p.key === 'direction') { MF.store.changed(); self.render(); return; }
          self.commit();
        });
        if (p.live) input.dataset.live = p.key;
      });
    } else {
      F.fields.forEach(function (d) {
        var get = function () { return d.get ? d.get(d.body ? el : el[fn]) : el[fn][d.field]; };
        var input = self.field(s, d, get(), d.readonly ? null : function (v) {
          if (d.set) d.set(el[fn], v);
          else el[fn][d.field] = v;
          self.commit();
        });
        if (d.live) { input.dataset.live = d.key; input.dataset.liveFn = fn; }
      });
    }

    if (fn === 'sink') {
      var reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'props-action';
      reset.textContent = 'Zähler zurücksetzen';
      reset.addEventListener('click', function () {
        el.rt.count = 0;
        self.commit();
        self.refreshLive();
      });
      s.appendChild(reset);
    }

    var rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'props-action';
    rm.textContent = F.label + ' entfernen';
    rm.disabled = el.look.locked;
    rm.title = 'Funktion und ihre Signale entfernen; Regeln darauf verlieren den Bezug';
    rm.addEventListener('click', function () {
      var gone = MF.removeFunction(el, fn);
      MF.store.dropSignals(el.id, gone);
      MF.store.changed();
      self.render();
      MF.ui.message(F.label + ' von ' + el.name + ' entfernt' + (gone.length ? ' – Signale ' + gone.join(', ') + ' gibt es nicht mehr' : '') + '.');
    });
    s.appendChild(rm);
  },

  // Werkstoff: Reibung, Stoßzahl, Dichte (nur bei dynamischen Körpern wirksam)
  renderMaterial: function (body, el) {
    var self = this;
    if (el.kind === 'ghost') return;   // keine Kollision, kein Werkstoff
    if (!el.material) el.material = JSON.parse(JSON.stringify(MF.MATERIALS.body));
    var m = el.material;
    var s = this.section(body, 'Werkstoff');
    var ro = el.look.locked;
    this.field(s, { label: 'Reibung', type: 'number', step: 0.05, min: 0, max: 2, readonly: ro,
      hint: 'Reibwert μ; zwischen zwei Körpern gilt der kleinere (Kiste 0,6, Rutsche 0,1). Bei Transportflächen: Haftung der Nachführung' },
      m.friction, function (v) { m.friction = v; self.commit(); });
    this.field(s, { label: 'Stoßzahl', type: 'number', step: 0.05, min: 0, max: 1, readonly: ro,
      hint: '0 = kein Abprallen, 1 = voll elastisch; zwischen zwei Körpern gilt der kleinere' },
      m.restitution || 0, function (v) { m.restitution = v; self.commit(); });
    if (el.kind === 'dynamic') {
      this.field(s, { label: 'Dichte', type: 'number', unit: 'kg/m³', step: 50, min: 10, max: 20000, readonly: ro,
        hint: 'Masse je Volumen; nur bei dynamischen Körpern wirksam (Kiste 200, Holz 500, Stahl 7850)' },
        m.density, function (v) { m.density = v; self.commit(); });
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
    var els = MF.model.bodies;
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
      this.field(sSim, { label: 'Schwerkraft', type: 'number', unit: 'm/s²', step: 0.1, min: -30, max: 0,
        hint: 'Beschleunigung nach unten (z), Erde: −9,81' },
        MF.model.settings.gravity, function (v) { MF.model.settings.gravity = v; self.commit(); });
      this.field(sSim, { label: 'Fangraster', type: 'number', unit: 'm', step: 0.01, min: 0.01, max: 1,
        hint: 'Schritt beim Verschieben mit "Fangen"; nur Zeichenhilfe' },
        MF.model.settings.snap.pos, function (v) { MF.model.settings.snap.pos = v; self.commit(); });
    }

    if (list.length || (folder && area === 'plant')) {
      var s1 = this.section(body, folder ? 'Inhalt (mit Unterordnern)' : 'Inhalt');
      if (!list.length) this.field(s1, { label: 'Körper', type: 'text', readonly: true }, 0);
      Object.keys(MF.templates).forEach(function (t) {
        var n = list.filter(function (el) { return el.template === t; }).length;
        if (n) self.field(s1, { label: MF.templates[t].label, type: 'text', readonly: true }, n);
      });
      var free = list.filter(function (el) { return !MF.templates[el.template]; }).length;
      if (free) self.field(s1, { label: 'Ohne Vorlage', type: 'text', readonly: true }, free);
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
    var el = MF.store.findBody(MF.store.selectedId);
    if (!el) return;
    this.root.querySelectorAll('[data-live]').forEach(function (input) {
      var fn = input.dataset.liveFn, v;
      if (fn) {
        // Allgemeines Feld einer Funktion (frei gezeichneter Körper)
        var d = (MF.FUNCTIONS[fn].fields || []).filter(function (x) { return x.key === input.dataset.live; })[0];
        v = d && el[fn] ? (d.get ? d.get(d.body ? el : el[fn]) : el[fn][d.field]) : undefined;
      } else v = MF.getProp(el, input.dataset.live);
      input.value = MF.props.formatNumber(v);
    });
    this.root.querySelectorAll('tr[data-signal]').forEach(function (tr) {
      var name = tr.dataset.signal;
      var v = MF.engine.signal(el, name);
      var def = MF.ioDef(el, name);
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
    d.innerHTML = '<strong>Nichts ausgewählt</strong>Wähle einen Körper im Strukturbaum oder auf der Fläche.';
    this.root.appendChild(d);
  }
};
