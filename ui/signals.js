// Signalliste: alle Signale der Anlage mit Live-Wert in einem schwebenden Fenster.
// Filterfeld sucht in Element, Name, Richtung, Typ und Regeln.
// Klick auf eine Zeile wählt das Element und zeigt seinen I/O-Tab.
window.MF = window.MF || {};

MF.signals = {
  filter: '',

  init: function () {
    var self = this;
    this.dialog = document.getElementById('siglist');
    this.rows = document.getElementById('siglist-rows');
    this.input = document.getElementById('siglist-filter');

    this.input.addEventListener('input', function () {
      self.filter = self.input.value.trim().toLowerCase();
      self.render();
    });

    this.rows.addEventListener('click', function (e) {
      var tr = e.target.closest('tr[data-el]');
      if (!tr) return;
      MF.props.tab = 'io';
      MF.store.select(tr.dataset.el);
      MF.props.render();   // Tab wechseln, auch wenn das Element schon gewählt war
    });

    // Esc schließt das Fenster (ein nicht-modales <dialog> macht das nicht selbst)
    this.dialog.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { self.close(); e.stopPropagation(); }
    });

    // Neue Elemente, Regeln, Auswahl: Liste neu aufbauen
    MF.store.on(function () { if (self.isOpen()) self.render(); });
  },

  isOpen: function () { return this.dialog.open; },

  open: function () {
    this.render();
    this.dialog.show();
    this.input.focus();
  },

  close: function () { this.dialog.close(); },

  toggle: function () {
    if (this.isOpen()) this.close();
    else this.open();
  },

  // Alle Signale als flache Liste
  list: function () {
    var out = [];
    MF.model.elements.forEach(function (el) {
      MF.types[el.type].io.forEach(function (s) {
        var sig = el.id + '.' + s.name;
        var rules = s.dir === 'in' ? MF.logic.rulesSetting(sig) : MF.logic.rulesReading(sig);
        out.push({ el: el, def: s, sig: sig, rules: rules });
      });
    });
    return out;
  },

  render: function () {
    var self = this;
    var q = this.filter;
    this.rows.innerHTML = '';

    var items = this.list().filter(function (it) {
      if (!q) return true;
      var text = [it.el.id, it.el.name, it.def.name, it.def.dir === 'in' ? 'ein' : 'aus', it.def.type]
        .concat(it.rules.map(function (r) { return r.id + ' ' + r.name; }))
        .join(' ').toLowerCase();
      return text.indexOf(q) >= 0;
    });

    items.forEach(function (it) {
      var tr = document.createElement('tr');
      tr.dataset.el = it.el.id;
      tr.dataset.signal = it.def.name;
      if (it.el.id === MF.store.selectedId) tr.classList.add('is-selected');
      tr.title = it.el.name + ' auswählen';
      tr.innerHTML =
        '<td><span class="dot"></span></td>' +
        '<td class="mono"></td>' +
        '<td class="mono"></td>' +
        '<td><span class="dir dir-' + it.def.dir + '">' + (it.def.dir === 'in' ? 'EIN' : 'AUS') + '</span></td>' +
        '<td class="mono">' + it.def.type + '</td>' +
        '<td class="mono siglist-value"></td>' +
        '<td></td>';
      tr.children[1].textContent = it.el.id;
      tr.children[2].textContent = it.def.name;
      tr.children[6].textContent = it.rules.map(function (r) {
        return r.name + (MF.logic.isActive(r) ? '' : ' (aus)');
      }).join(', ') || '–';
      self.rows.appendChild(tr);
    });

    if (!items.length) {
      this.rows.innerHTML = '<tr><td colspan="7" class="siglist-empty">Keine Treffer.</td></tr>';
    }
    this.refreshLive();
  },

  // Werte aktualisieren, ohne die Tabelle neu aufzubauen (läuft mit der Simulation)
  refreshLive: function () {
    if (!this.dialog || !this.isOpen()) return;
    this.rows.querySelectorAll('tr[data-el]').forEach(function (tr) {
      var el = MF.store.findElement(tr.dataset.el);
      if (!el) return;
      var name = tr.dataset.signal;
      var def = MF.engine.ioDef(el, name);
      var v = MF.engine.signal(el, name);
      tr.children[0].firstChild.classList.toggle('is-on', !!v);
      tr.classList.toggle('is-forced', MF.engine.isForced(el, name));
      tr.children[5].textContent = def.type === 'FLOAT32' ? v.toFixed(2).replace('.', ',') : String(v);
    });
  }
};
