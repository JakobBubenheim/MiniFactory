// Strukturbaum: Projekt > Anlage > Gruppen > Elemente, Projekt > Logik > Regeln.
// Aufbau nach WAI-ARIA "tree": Pfeiltasten, F2 zum Umbenennen, Suche filtert.
window.MF = window.MF || {};

MF.tree = {
  expanded: { project: true, plant: true, logic: true },
  filter: '',

  init: function () {
    var self = this;
    this.root = document.getElementById('tree');
    this.search = document.getElementById('tree-search');

    // Gruppen standardmäßig aufgeklappt
    this.groups().forEach(function (g) { self.expanded['grp:' + g] = true; });

    this.search.addEventListener('input', function () {
      self.filter = self.search.value.trim().toLowerCase();
      self.render();
    });

    this.root.addEventListener('click', this.onClick.bind(this));
    this.root.addEventListener('dblclick', this.onDblClick.bind(this));
    this.root.addEventListener('keydown', this.onKey.bind(this));

    MF.store.on(function (reason) {
      self.render();
      if (reason === 'select') self.scrollToSelected();
    });
    this.render();
  },

  groups: function () {
    var seen = [];
    MF.model.elements.forEach(function (el) {
      if (seen.indexOf(el.group) < 0) seen.push(el.group);
    });
    return seen;
  },

  // Baumdaten aus dem Modell erzeugen
  build: function () {
    var plant = { id: 'plant', label: 'Anlage', icon: 'i-plant', children: [] };
    this.groups().forEach(function (g) {
      plant.children.push({
        id: 'grp:' + g, label: g, icon: 'i-folder',
        children: MF.model.elements
          .filter(function (el) { return el.group === g; })
          .map(function (el) {
            return { id: el.id, label: el.name, icon: MF.types[el.type].icon, kind: el.type, el: el };
          })
      });
    });

    var logic = {
      id: 'logic', label: 'Logik', icon: 'i-logic',
      children: MF.model.rules.map(function (r) {
        return { id: r.id, label: r.name, icon: 'i-rule', kind: 'rule', rule: r };
      })
    };

    return { id: 'project', label: MF.model.name, icon: 'i-project', children: [plant, logic] };
  },

  // Filtert den Baum: Treffer bleiben samt Eltern sichtbar.
  applyFilter: function (node) {
    var q = this.filter;
    if (!q) return node;
    var hit = node.label.toLowerCase().indexOf(q) >= 0 ||
              (node.el && node.el.id.toLowerCase().indexOf(q) >= 0);
    var kids = (node.children || [])
      .map(this.applyFilter.bind(this))
      .filter(Boolean);
    if (!hit && !kids.length) return null;
    var copy = {};
    for (var k in node) copy[k] = node[k];
    copy.children = node.children ? kids : undefined;
    copy.forceOpen = kids.length > 0;
    return copy;
  },

  render: function () {
    var hadFocus = this.root.contains(document.activeElement) &&
                   document.activeElement.tagName !== 'INPUT';
    var data = this.applyFilter(this.build());

    // Eltern des gewählten Elements aufklappen
    var sel = MF.store.findElement(MF.store.selectedId);
    if (sel) {
      this.expanded.project = this.expanded.plant = true;
      this.expanded['grp:' + sel.group] = true;
    }

    this.root.innerHTML = '';
    if (!data) {
      this.root.innerHTML = '<li class="tree-empty">Keine Treffer.</li>';
      return;
    }
    this.root.appendChild(this.renderNode(data, 1));

    // Roving tabindex: genau ein Eintrag ist per Tab erreichbar
    var focusItem = this.root.querySelector('[aria-selected="true"]') ||
                    this.root.querySelector('[role="treeitem"]');
    if (focusItem) {
      focusItem.tabIndex = 0;
      if (hadFocus) focusItem.focus();
    }
  },

  renderNode: function (node, level) {
    var li = document.createElement('li');
    li.setAttribute('role', 'treeitem');
    li.setAttribute('aria-level', level);
    li.setAttribute('aria-selected', String(MF.store.selectedId === node.id));
    li.dataset.id = node.id;
    li.tabIndex = -1;

    var hasKids = node.children && node.children.length;
    var open = hasKids && (this.expanded[node.id] || node.forceOpen);
    if (hasKids) li.setAttribute('aria-expanded', String(!!open));
    if (node.el && !node.el.visible) li.classList.add('is-hidden-el');
    if (node.rule && node.rule.enabled === false) li.classList.add('is-off-rule');

    var row = document.createElement('div');
    row.className = 'tree-row';
    row.style.paddingLeft = (4 + (level - 1) * 14) + 'px';

    var iconClass = 'tree-icon' + (node.kind ? ' t-' + node.kind : '');
    var html =
      '<button class="tree-toggle' + (hasKids ? '' : ' is-leaf') + '" tabindex="-1" aria-hidden="true">' +
        '<svg><use href="#i-chevron"/></svg></button>' +
      '<svg class="' + iconClass + '"><use href="#' + node.icon + '"/></svg>' +
      '<span class="tree-label"></span>';

    if (node.el) {
      html +=
        '<span class="tree-id">' + node.el.id + '</span>' +
        '<button class="tree-act' + (node.el.locked ? ' is-on' : '') + '" data-act="lock" tabindex="-1" title="Sperren">' +
          '<svg><use href="#' + (node.el.locked ? 'i-lock' : 'i-unlock') + '"/></svg></button>' +
        '<button class="tree-act' + (!node.el.visible ? ' is-on' : '') + '" data-act="eye" tabindex="-1" title="Ein-/Ausblenden">' +
          '<svg><use href="#' + (node.el.visible ? 'i-eye' : 'i-eye-off') + '"/></svg></button>';
    } else if (hasKids) {
      html += '<span class="tree-id">' + node.children.length + '</span>';
    }
    row.innerHTML = html;
    row.querySelector('.tree-label').textContent = node.label;
    li.appendChild(row);

    if (open) {
      var ul = document.createElement('ul');
      ul.setAttribute('role', 'group');
      var self = this;
      node.children.forEach(function (child) {
        ul.appendChild(self.renderNode(child, level + 1));
      });
      li.appendChild(ul);
    }
    return li;
  },

  scrollToSelected: function () {
    var item = this.root.querySelector('[aria-selected="true"] > .tree-row');
    if (item) item.scrollIntoView({ block: 'nearest' });
  },

  // ---------- Bedienung ----------

  onClick: function (e) {
    var li = e.target.closest('[role="treeitem"]');
    if (!li) return;
    var id = li.dataset.id;

    var act = e.target.closest('.tree-act');
    if (act) {
      var el = MF.store.findElement(id);
      if (act.dataset.act === 'eye') el.visible = !el.visible;
      if (act.dataset.act === 'lock') el.locked = !el.locked;
      MF.store.changed();
      return;
    }

    if (e.target.closest('.tree-toggle')) {
      this.toggle(id);
      return;
    }

    MF.store.select(id);
    li.focus();
  },

  onDblClick: function (e) {
    var li = e.target.closest('[role="treeitem"]');
    if (!li || e.target.closest('.tree-act, .tree-toggle')) return;
    if (!this.rename(li.dataset.id)) this.toggle(li.dataset.id);
  },

  toggle: function (id) {
    this.expanded[id] = !this.expanded[id];
    this.render();
  },

  // Inline-Umbenennen für Elemente und Regeln. Enter übernimmt, Esc bricht ab.
  rename: function (id) {
    var target = MF.store.findElement(id) || MF.store.findRule(id);
    if (!target) return false;
    var label = this.root.querySelector('[data-id="' + id + '"] > .tree-row .tree-label');
    var input = document.createElement('input');
    input.value = target.name;
    label.textContent = '';
    label.appendChild(input);
    input.focus();
    input.select();

    var self = this;
    var done = false;
    function finish(save) {
      if (done) return;
      done = true;
      var v = input.value.trim();
      if (save && v) target.name = v;
      MF.store.changed();
      var li = self.root.querySelector('[data-id="' + id + '"]');
      if (li) li.focus();
    }
    input.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', function () { finish(true); });
    input.addEventListener('click', function (e) { e.stopPropagation(); });
    return true;
  },

  onKey: function (e) {
    var items = Array.prototype.slice.call(this.root.querySelectorAll('[role="treeitem"]'));
    var cur = e.target.closest('[role="treeitem"]');
    if (!cur) return;
    var idx = items.indexOf(cur);
    var id = cur.dataset.id;
    var expanded = cur.getAttribute('aria-expanded');

    switch (e.key) {
      case 'ArrowDown': if (idx < items.length - 1) MF.store.select(items[idx + 1].dataset.id); break;
      case 'ArrowUp':   if (idx > 0) MF.store.select(items[idx - 1].dataset.id); break;
      case 'Home':      MF.store.select(items[0].dataset.id); break;
      case 'End':       MF.store.select(items[items.length - 1].dataset.id); break;
      case 'ArrowRight':
        if (expanded === 'false') this.toggle(id);
        else if (expanded === 'true') MF.store.select(items[idx + 1].dataset.id);
        break;
      case 'ArrowLeft':
        if (expanded === 'true') this.toggle(id);
        else {
          var parent = cur.parentElement.closest('[role="treeitem"]');
          if (parent) MF.store.select(parent.dataset.id);
        }
        break;
      case 'F2':
        // Fokus bleibt im Eingabefeld, deshalb hier direkt zurück
        e.preventDefault();
        this.rename(id);
        return;
      case 'Enter':
      case ' ':
        MF.store.select(id); break;
      default: return;
    }
    e.preventDefault();
    var sel = this.root.querySelector('[aria-selected="true"]');
    if (sel) sel.focus();
  }
};
