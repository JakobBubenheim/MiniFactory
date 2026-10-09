// Strukturbaum: Projekt > Anlage > Ordner > Körper, Projekt > Logik > Ordner > Regeln.
// Ordner sind frei anlegbar und beliebig verschachtelbar (MF.model.folders).
// Aufbau nach WAI-ARIA "tree": Pfeiltasten, F2 zum Umbenennen, Suche filtert.
// - Strg/Cmd+Klick und Shift+Klick wählen mehrere Einträge (für Ziehen, Strg+G, Löschen).
// - Ziehen: Elemente, Regeln und Ordner in Ordner legen oder innerhalb einer Ebene
//   umsortieren – nur im eigenen Bereich (Anlage bzw. Logik). Einen Körper auf
//   einen anderen Körper ziehen koppelt ihn (er bewegt sich mit, Konzept Abschnitt 2).
// - Rechtsklick (oder Shift+F10 / Kontextmenü-Taste) öffnet das Menü.
window.MF = window.MF || {};

MF.tree = {
  folded: {},       // zugeklappte Knoten, z. B. { F2: true }; alles andere ist offen
  filter: '',
  marked: {},       // weitere ausgewählte Knoten neben MF.store.selectedId (Mehrfachauswahl)
  keepMarks: false, // true, während der Baum selbst die Auswahl ändert
  drag: null,       // laufendes Ziehen: { ids, area, target }
  pendingRender: false,
  menu: null,       // offenes Kontextmenü

  init: function () {
    var self = this;
    this.root = document.getElementById('tree');
    this.search = document.getElementById('tree-search');

    this.search.addEventListener('input', function () {
      self.filter = self.search.value.trim().toLowerCase();
      self.render();
    });

    this.root.addEventListener('click', this.onClick.bind(this));
    this.root.addEventListener('dblclick', this.onDblClick.bind(this));
    this.root.addEventListener('keydown', this.onKey.bind(this));
    this.root.addEventListener('contextmenu', this.onContextMenu.bind(this));
    this.initDrag();

    MF.store.on(function (reason) {
      if (reason === 'select') {
        if (!self.keepMarks) self.marked = {};
        self.reveal(MF.store.selectedId);
      }
      self.render();
      if (reason === 'select') self.scrollToSelected();
    });
    this.render();
  },

  // ---------- Aufklappen ----------

  isOpen: function (id) { return !this.folded[id]; },

  // Zugeklappte Ordner für die Datei (view.folded)
  foldedIds: function () {
    var self = this;
    return Object.keys(this.folded).filter(function (id) {
      return self.folded[id] && (id === 'plant' || id === 'logic' || MF.store.findFolder(id));
    });
  },

  setFolded: function (ids) {
    var self = this;
    this.folded = {};
    (ids || []).forEach(function (id) { if (typeof id === 'string') self.folded[id] = true; });
  },

  // Alle Eltern eines Knotens aufklappen, damit er sichtbar ist
  reveal: function (id) {
    var n = MF.store.findNode(id), guard = 0;
    if (!n) return;
    this.folded.project = false;
    this.folded[n.area] = false;
    var p = MF.store.parentOf(n.obj, n.area);
    while (p && guard++ < 1000) {
      this.folded[p] = false;
      var f = MF.store.findNode(p);   // Ordner oder Elternkörper (Kopplung)
      p = f ? MF.store.parentOf(f.obj, f.area) : null;
    }
  },

  // ---------- Baumdaten ----------

  build: function () {
    var self = this;
    var seen = {};
    // Nummer jedes aktiven SCL-Bausteins in der Ausführungsreihenfolge
    var sclNo = {};
    MF.logic.sclOrder().forEach(function (r, i) { sclNo[r.id] = i + 1; });

    function kids(area, parent) {
      var c = MF.store.childrenOf(area, parent);
      return c.folders.filter(function (f) { return !seen[f.id]; }).map(function (f) {
        seen[f.id] = true;   // Schutz vor Zyklen
        return { id: f.id, label: f.name, icon: 'i-folder', kind: 'folder', folder: f, area: area, children: kids(area, f.id) };
      }).concat(c.items.map(function (o) {
        if (area === 'plant') {
          // Gekoppelte Körper hängen im Baum unter ihrem Elternkörper
          var sub = seen[o.id] ? [] : (seen[o.id] = true, kids(area, o.id));
          return { id: o.id, label: o.name, icon: MF.bodyIcon(o), kind: o.template || o.kind, el: o, area: area,
            children: sub.length ? sub : undefined };
        }
        return { id: o.id, label: o.name, icon: 'i-rule', kind: 'rule', rule: o, area: area, sclNo: sclNo[o.id] };
      }));
    }

    var plant = { id: 'plant', label: 'Anlage', icon: 'i-plant', area: 'plant', root: true, children: kids('plant', null) };
    var logic = { id: 'logic', label: 'Logik', icon: 'i-logic', area: 'logic', root: true, children: kids('logic', null) };
    return { id: 'project', label: MF.model.name, icon: 'i-project', children: [plant, logic] };
  },

  // Filtert den Baum: Treffer bleiben samt Eltern sichtbar.
  applyFilter: function (node) {
    var q = this.filter;
    if (!q) return node;
    var hit = node.label.toLowerCase().indexOf(q) >= 0 ||
              ((node.el || node.rule) && node.id.toLowerCase().indexOf(q) >= 0);
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

  // ---------- Auswahl ----------

  isSelected: function (id) {
    return MF.store.selectedId === id || !!this.marked[id];
  },

  // Alle ausgewählten Knoten (Ordner, Elemente, Regeln) in Baum-Reihenfolge
  selection: function () {
    var self = this, out = [];
    (function walk(node) {
      if (!node.root && node.id !== 'project' && self.isSelected(node.id)) out.push(node.id);
      (node.children || []).forEach(walk);
    })(this.build());
    return out;
  },

  // Auswahl setzen: primary = Hauptauswahl (Panel), marks = weitere Knoten
  setSelection: function (primary, marks) {
    this.marked = {};
    var self = this;
    (marks || []).forEach(function (id) { if (id !== primary) self.marked[id] = true; });
    this.keepMarks = true;
    try {
      if (MF.store.selectedId === primary) this.render();
      else MF.store.select(primary);
    } finally { this.keepMarks = false; }
  },

  // Nur ganze Teilbäume: Knoten weglassen, deren Ordner schon dabei ist
  topLevel: function (ids) {
    return ids.filter(function (id) {
      return !ids.some(function (other) { return other !== id && MF.store.isWithin(id, other); });
    });
  },

  // ---------- Darstellung ----------

  render: function () {
    if (this.drag) { this.pendingRender = true; return; }   // nicht während des Ziehens
    this.pendingRender = false;
    var hadFocus = this.root.contains(document.activeElement) &&
                   document.activeElement.tagName !== 'INPUT';
    var data = this.applyFilter(this.build());

    // Markierungen von Knoten, die es nicht mehr gibt, verwerfen
    var self = this;
    Object.keys(this.marked).forEach(function (id) { if (!MF.store.findNode(id)) delete self.marked[id]; });

    this.root.innerHTML = '';
    if (!data) {
      this.root.innerHTML = '<li class="tree-empty">Keine Treffer.</li>';
      return;
    }
    this.root.setAttribute('aria-multiselectable', 'true');
    this.root.appendChild(this.renderNode(data, 1));

    // Roving tabindex: genau ein Eintrag ist per Tab erreichbar
    var focusItem = this.root.querySelector('[data-id="' + MF.store.selectedId + '"]') ||
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
    li.setAttribute('aria-selected', String(this.isSelected(node.id)));
    li.dataset.id = node.id;
    li.tabIndex = -1;

    var hasKids = node.children && node.children.length;
    var open = hasKids && (this.isOpen(node.id) || node.forceOpen);
    if (hasKids) li.setAttribute('aria-expanded', String(!!open));
    if (node.el && !node.el.look.visible) li.classList.add('is-hidden-el');
    if (node.rule && node.rule.enabled === false) li.classList.add('is-off-rule');
    if (node.kind === 'folder') li.classList.add('is-folder');

    var row = document.createElement('div');
    row.className = 'tree-row';
    row.style.paddingLeft = (4 + (level - 1) * 14) + 'px';
    // Ordner, Elemente und Regeln lassen sich ziehen
    if (node.area && !node.root) row.draggable = true;

    var iconClass = 'tree-icon' + (node.kind ? ' t-' + node.kind : '');
    var html =
      '<button class="tree-toggle' + (hasKids ? '' : ' is-leaf') + '" tabindex="-1" aria-hidden="true">' +
        '<svg><use href="#i-chevron"/></svg></button>' +
      '<svg class="' + iconClass + '"><use href="#' + node.icon + '"/></svg>' +
      '<span class="tree-label"></span>';

    if (node.el) {
      html +=
        '<span class="tree-id">' + node.el.id + '</span>' +
        '<button class="tree-act' + (node.el.look.locked ? ' is-on' : '') + '" data-act="lock" tabindex="-1" title="Sperren">' +
          '<svg><use href="#' + (node.el.look.locked ? 'i-lock' : 'i-unlock') + '"/></svg></button>' +
        '<button class="tree-act' + (!node.el.look.visible ? ' is-on' : '') + '" data-act="eye" tabindex="-1" title="Ein-/Ausblenden">' +
          '<svg><use href="#' + (node.el.look.visible ? 'i-eye' : 'i-eye-off') + '"/></svg></button>';
    } else if (node.rule && node.rule.kind === 'scl') {
      // Nummer = Stelle in der Ausführungsreihenfolge der SCL-Bausteine
      html += node.sclNo
        ? '<span class="tree-id" title="Läuft im Zyklus an ' + node.sclNo + '. Stelle (Reihenfolge im Strukturbaum)">SCL ' + node.sclNo + '</span>'
        : '<span class="tree-id" title="Läuft nicht (abgeschaltet oder fehlerhaft)">SCL –</span>';
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
    var item = this.root.querySelector('[data-id="' + MF.store.selectedId + '"] > .tree-row');
    if (item) item.scrollIntoView({ block: 'nearest' });
  },

  // ---------- Bedienung ----------

  onClick: function (e) {
    var li = e.target.closest('[role="treeitem"]');
    if (!li) return;
    var id = li.dataset.id;

    var act = e.target.closest('.tree-act');
    if (act) {
      var el = MF.store.findBody(id);
      if (act.dataset.act === 'eye') el.look.visible = !el.look.visible;
      if (act.dataset.act === 'lock') el.look.locked = !el.look.locked;
      MF.store.changed();
      return;
    }

    if (e.target.closest('.tree-toggle')) {
      this.toggle(id);
      return;
    }

    if ((e.ctrlKey || e.metaKey) && MF.store.findNode(id)) this.toggleMark(id);
    else if (e.shiftKey && MF.store.findNode(id)) this.selectRange(id);
    else {
      this.marked = {};
      if (MF.store.selectedId === id) this.render();
      else MF.store.select(id);
    }
    var fresh = this.root.querySelector('[data-id="' + id + '"]');
    if (fresh) fresh.focus();
  },

  // Strg/Cmd+Klick: Knoten zur Auswahl hinzufügen bzw. herausnehmen
  toggleMark: function (id) {
    var sel = this.selection();
    var i = sel.indexOf(id);
    if (i >= 0) {
      sel.splice(i, 1);
      var primary = MF.store.selectedId === id ? (sel[sel.length - 1] || null) : MF.store.selectedId;
      this.setSelection(primary, sel);
    } else {
      sel.push(id);
      this.setSelection(id, sel);
    }
  },

  // Shift+Klick: alle sichtbaren Einträge zwischen Hauptauswahl und id (gleicher Bereich)
  selectRange: function (id) {
    var items = Array.prototype.map.call(this.root.querySelectorAll('[role="treeitem"]'), function (li) { return li.dataset.id; });
    var a = items.indexOf(MF.store.selectedId), b = items.indexOf(id);
    if (a < 0) { this.setSelection(id, []); return; }
    var area = MF.store.areaOf(id);
    var range = items.slice(Math.min(a, b), Math.max(a, b) + 1).filter(function (x) {
      return MF.store.findNode(x) && MF.store.areaOf(x) === area;
    });
    this.setSelection(id, range);
  },

  onDblClick: function (e) {
    var li = e.target.closest('[role="treeitem"]');
    if (!li || e.target.closest('.tree-act, .tree-toggle')) return;
    // Ordner klappen beim Doppelklick auf und zu, umbenannt wird mit F2 oder Menü
    if (MF.store.findFolder(li.dataset.id) || !this.rename(li.dataset.id)) this.toggle(li.dataset.id);
  },

  toggle: function (id) {
    this.folded[id] = !this.folded[id];
    this.render();
  },

  // Inline-Umbenennen für Ordner, Elemente und Regeln. Enter übernimmt, Esc bricht ab.
  rename: function (id) {
    var n = MF.store.findNode(id);
    if (!n) return false;
    var target = n.obj;
    var label = this.root.querySelector('[data-id="' + id + '"] > .tree-row .tree-label');
    if (!label) return false;
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
    input.addEventListener('dblclick', function (e) { e.stopPropagation(); });
    return true;
  },

  onKey: function (e) {
    if (e.target.tagName === 'INPUT') return;
    var items = Array.prototype.slice.call(this.root.querySelectorAll('[role="treeitem"]'));
    var cur = e.target.closest('[role="treeitem"]');
    if (!cur) return;
    var idx = items.indexOf(cur);
    var id = cur.dataset.id;
    var expanded = cur.getAttribute('aria-expanded');

    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      var r = cur.querySelector('.tree-row').getBoundingClientRect();
      this.openMenu(id, r.left + 24, r.bottom);
      return;
    }

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
    var sel = this.root.querySelector('[data-id="' + MF.store.selectedId + '"]');
    if (sel) sel.focus();
  },

  // ---------- Befehle ----------

  // Wohin kommt ein neuer Ordner bzw. ein neues Element? Bereich und Ordner
  // aus dem gewählten Knoten: Ordner -> hinein, Element/Regel -> daneben.
  target: function (id) {
    if (id === 'plant' || id === 'logic') return { area: id, parent: null };
    var n = MF.store.findNode(id);
    if (!n) return null;
    if (n.kind === 'folder') return { area: n.area, parent: n.obj.id };
    // Neben einem gekoppelten Körper: in seinen Ordner (neue Körper werden nicht gekoppelt)
    return { area: n.area, parent: MF.store.folderOf(n.obj, n.area) };
  },

  // Neuer Ordner im Bereich area unter parent; startet im Umbenennen-Modus.
  newFolder: function (area, parent) {
    if (this.filter) { this.search.value = ''; this.filter = ''; }
    var f = MF.store.createFolder(area, parent);
    this.marked = {};
    this.reveal(f.id);
    this.render();
    this.rename(f.id);
    MF.ui.message('Ordner angelegt – Namen eintippen, Enter übernimmt.');
    return f;
  },

  // Button im Baum-Kopf: Ordner dort, wo gerade ausgewählt ist (sonst unter Anlage)
  newFolderHere: function () {
    var t = this.target(MF.store.selectedId) || { area: 'plant', parent: null };
    this.newFolder(t.area, t.parent);
  },

  // Strg+G: ausgewählte Knoten in einen neuen Ordner packen.
  // Der Ordner entsteht dort, wo der erste ausgewählte Knoten liegt.
  groupSelected: function () {
    var sel = this.selection();
    if (!sel.length) { MF.ui.message('Zum Gruppieren Elemente oder Regeln im Strukturbaum auswählen.'); return; }
    var area = MF.store.areaOf(sel[0]);
    sel = this.topLevel(sel.filter(function (id) { return MF.store.areaOf(id) === area; }));
    var first = MF.store.findNode(sel[0]);
    var parent = MF.store.folderOf(first.obj, area);
    var f = MF.store.createFolder(area, parent);
    // Neuer Ordner an die Stelle des ersten ausgewählten Ordners, sonst ans Ende der Ordner
    if (first.kind === 'folder') {
      var fs = MF.model.folders;
      fs.splice(fs.indexOf(f), 1);
      fs.splice(fs.indexOf(first.obj), 0, f);
    }
    MF.store.moveNodes(sel, area, f.id, null);
    this.marked = {};
    this.reveal(f.id);
    this.folded[f.id] = false;
    MF.store.select(f.id);
    this.render();
    this.rename(f.id);
    MF.ui.message(sel.length + (sel.length === 1 ? ' Eintrag' : ' Einträge') + ' in einen neuen Ordner gepackt.');
  },

  // Knoten löschen (Ordner: Inhalt wandert eine Ebene nach oben)
  deleteNodes: function (ids) {
    var done = 0, folders = 0, self = this;
    ids = this.topLevel(ids);
    // Elemente und Regeln nur außerhalb der laufenden Simulation
    var needsEdit = ids.some(function (id) { return !MF.store.findFolder(id); });
    if (needsEdit && !MF.editor.canEdit()) return;
    ids.forEach(function (id) {
      var n = MF.store.findNode(id);
      if (!n) return;
      if (n.kind === 'folder') { MF.store.deleteFolder(id); done++; folders++; }
      else if (n.kind === 'body') {
        if (n.obj.look.locked) { MF.ui.message(n.obj.name + ' ist gesperrt.'); return; }
        MF.store.deleteBody(id); done++;
      } else { MF.store.deleteRule(id); done++; }
    });
    self.marked = {};
    if (!done) return;
    MF.ui.message((done === 1 ? (folders ? 'Ordner' : '1 Eintrag') : done + ' Einträge') + ' gelöscht.' +
      (folders ? ' Der Inhalt liegt jetzt eine Ebene höher.' : ''));
  },

  // Ausgewählte Knoten nach parent verschieben (ans Ende)
  moveTo: function (ids, area, parent) {
    ids = this.topLevel(ids);
    if (MF.store.moveNodes(ids, area, parent, null)) {
      this.folded[parent || area] = false;
      var where = MF.store.placeName(parent, area);
      MF.ui.message((ids.length === 1 ? MF.store.findNode(ids[0]).obj.name : ids.length + ' Einträge') + ' nach "' + where + '" verschoben.');
    }
  },

  // ---------- Kontextmenü ----------

  onContextMenu: function (e) {
    var li = e.target.closest('[role="treeitem"]');
    if (!li) return;
    e.preventDefault();
    var id = li.dataset.id;
    if (!this.isSelected(id)) {
      this.marked = {};
      MF.store.select(id);
    }
    this.openMenu(id, e.clientX, e.clientY);
  },

  // Einträge: [{ label, key, run, disabled }] oder '-' für Trennlinie
  menuItems: function (id) {
    var self = this;
    var n = MF.store.findNode(id);
    var items = [];
    if (id === 'plant' || id === 'logic') {
      items.push({ label: 'Neuer Ordner', run: function () { self.newFolder(id, null); } });
      if (id === 'logic') {
        items.push('-');
        items.push({ label: 'Neue Regel', run: function () { MF.store.select('logic'); MF.editor.newRule('rule'); } });
        items.push({ label: 'Neuer SCL-Baustein', run: function () { MF.store.select('logic'); MF.editor.newRule('scl'); } });
      }
      return items;
    }
    if (!n) return items;

    var sel = this.selection();
    if (sel.indexOf(id) < 0) sel = [id];
    sel = sel.filter(function (x) { return MF.store.areaOf(x) === n.area; });
    var many = sel.length > 1;

    if (n.kind === 'folder') {
      items.push({ label: 'Neuer Ordner darin', run: function () { self.newFolder(n.area, id); } });
      items.push('-');
    }
    items.push({ label: 'Umbenennen', key: 'F2', disabled: many, run: function () { self.rename(id); } });
    if (n.kind !== 'folder') {
      items.push({ label: 'Duplizieren', key: 'Strg+D', disabled: many, run: function () { MF.editor.duplicateSelected(); } });
    }
    items.push({ label: 'In Ordner verschieben …', submenu: true, run: function () { self.openMoveMenu(sel, n.area); } });
    items.push({ label: 'In neuen Ordner packen', key: 'Strg+G', run: function () { self.groupSelected(); } });
    items.push('-');
    items.push({
      label: many ? sel.length + ' Einträge löschen' : (n.kind === 'folder' ? 'Ordner löschen (Inhalt bleibt)' : 'Löschen'),
      key: 'Entf', danger: true, run: function () { self.deleteNodes(sel); }
    });
    return items;
  },

  // Zweite Stufe: Zielordner wählen
  openMoveMenu: function (ids, area) {
    var self = this;
    ids = this.topLevel(ids);
    var items = [{ label: MF.store.AREAS[area] + ' (oberste Ebene)', icon: area === 'plant' ? 'i-plant' : 'i-logic',
      run: function () { self.moveTo(ids, area, null); } }];
    MF.store.folderList(area).forEach(function (o) {
      var bad = ids.some(function (id) { return MF.store.moveError(id, area, o.folder.id); });
      items.push({ label: o.folder.name, title: o.path, icon: 'i-folder', indent: o.depth + 1, disabled: bad,
        run: function () { self.moveTo(ids, area, o.folder.id); } });
    });
    var pos = this.menuPos;
    this.openMenu(null, pos.x, pos.y, items, 'Verschieben nach');
  },

  openMenu: function (id, x, y, items, title) {
    var self = this;
    this.closeMenu();
    items = items || this.menuItems(id);
    if (!items.length) return;
    this.menuPos = { x: x, y: y };
    this.menuReturn = this.root.querySelector('[data-id="' + MF.store.selectedId + '"]');

    var m = document.createElement('div');
    m.className = 'ctx-menu';
    m.setAttribute('role', 'menu');
    if (title) {
      var h = document.createElement('div');
      h.className = 'ctx-title';
      h.textContent = title;
      m.appendChild(h);
    }
    items.forEach(function (it) {
      if (it === '-') { var s = document.createElement('div'); s.className = 'ctx-sep'; m.appendChild(s); return; }
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'ctx-item' + (it.danger ? ' is-danger' : '');
      b.setAttribute('role', 'menuitem');
      b.disabled = !!it.disabled;
      if (it.title) b.title = it.title;
      b.innerHTML = (it.icon ? '<svg><use href="#' + it.icon + '"/></svg>' : '') + '<span class="ctx-label"></span>' +
        (it.key ? '<span class="ctx-key">' + it.key + '</span>' : '') + (it.submenu ? '<span class="ctx-key">›</span>' : '');
      b.querySelector('.ctx-label').textContent = it.label;
      if (it.indent) b.style.paddingLeft = (10 + it.indent * 12) + 'px';
      b.addEventListener('click', function () {
        if (!it.submenu) self.closeMenu(true);
        it.run();
      });
      m.appendChild(b);
    });

    m.addEventListener('keydown', function (e) {
      var btns = Array.prototype.filter.call(m.querySelectorAll('.ctx-item'), function (b) { return !b.disabled; });
      var i = btns.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') btns[(i + 1) % btns.length].focus();
      else if (e.key === 'ArrowUp') btns[(i - 1 + btns.length) % btns.length].focus();
      else if (e.key === 'Escape' || e.key === 'Tab') self.closeMenu();
      else return;
      e.preventDefault();
      e.stopPropagation();
    });

    document.body.appendChild(m);
    // Im Fenster halten
    var r = m.getBoundingClientRect();
    m.style.left = Math.max(4, Math.min(x, window.innerWidth - r.width - 4)) + 'px';
    m.style.top = Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) + 'px';
    this.menu = m;
    var first = m.querySelector('.ctx-item:not(:disabled)');
    if (first) first.focus();

    // Klick außerhalb schließt
    this.menuClose = function (e) { if (!m.contains(e.target)) self.closeMenu(); };
    setTimeout(function () {
      document.addEventListener('pointerdown', self.menuClose, true);
      window.addEventListener('blur', self.menuClose);
    }, 0);
  },

  // ran: ein Eintrag wurde ausgeführt (Fokus bleibt, wo der Befehl ihn hinsetzt)
  closeMenu: function (ran) {
    if (!this.menu) return;
    this.menu.remove();
    this.menu = null;
    document.removeEventListener('pointerdown', this.menuClose, true);
    window.removeEventListener('blur', this.menuClose);
    if (!ran) {
      var li = this.root.querySelector('[data-id="' + MF.store.selectedId + '"]');
      if (li) li.focus();
    }
  },

  // ---------- Ziehen im Baum ----------

  initDrag: function () {
    var self = this;
    var root = this.root;

    root.addEventListener('dragstart', function (e) {
      var li = e.target.closest && e.target.closest('[role="treeitem"]');
      var id = li && li.dataset.id;
      var n = MF.store.findNode(id);
      if (!n) { e.preventDefault(); return; }
      // Gezogen wird die ganze Auswahl, wenn der Eintrag dazugehört
      var ids = self.isSelected(id) ? self.selection() : [id];
      ids = self.topLevel(ids.filter(function (x) { return MF.store.areaOf(x) === n.area; }));
      self.drag = { ids: ids, area: n.area, target: null, hoverId: null, hoverTimer: null };
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', ids.join(',')); } catch (err) { /* IE */ }
      li.classList.add('is-drag-src');
      // dragend direkt am Eintrag: er kann beim Aufklappen eines Ordners aus dem Baum fallen
      li.addEventListener('dragend', function () { self.endDrag(); }, { once: true });
    });

    root.addEventListener('dragover', function (e) {
      if (!self.drag) return;
      var t = self.dropTarget(e);
      self.showDrop(t);
      if (t && t.ok) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      } else {
        e.dataTransfer.dropEffect = 'none';
      }
    });

    root.addEventListener('dragleave', function (e) {
      if (self.drag && !root.contains(e.relatedTarget)) self.showDrop(null);
    });

    root.addEventListener('drop', function (e) {
      if (!self.drag) return;
      e.preventDefault();
      var t = self.drag.target;
      var d = self.drag;
      self.endDrag();
      if (t && !t.ok && t.err) MF.ui.message(t.err);
      if (!t || !t.ok) return;
      if (MF.store.moveNodes(d.ids, d.area, t.parent, t.beforeId)) {
        self.folded[t.parent || d.area] = false;
        var where = MF.store.placeName(t.parent, d.area);
        var names = d.ids.length === 1 ? MF.store.findNode(d.ids[0]).obj.name : d.ids.length + ' Einträge';
        if (t.mode === 'inside' && MF.store.findBody(t.parent)) MF.ui.message(names + ' an ' + where + ' gekoppelt – bewegt sich mit.');
        else MF.ui.message(names + (t.mode === 'inside' ? ' nach "' + where + '" verschoben.' : ' umsortiert (' + where + ').'));
      }
    });

    root.addEventListener('dragend', function () { self.endDrag(); });
  },

  endDrag: function () {
    if (!this.drag) return;
    clearTimeout(this.drag.hoverTimer);
    this.showDrop(null);
    this.drag = null;
    var src = this.root.querySelector('.is-drag-src');
    if (src) src.classList.remove('is-drag-src');
    if (this.pendingRender) this.render();
  },

  // Ziel unter dem Mauszeiger: { li, mode: 'before'|'after'|'inside', parent, beforeId, ok }
  dropTarget: function (e) {
    var d = this.drag;
    var li = e.target.closest && e.target.closest('[role="treeitem"]');
    if (!li) return null;
    var id = li.dataset.id;
    var row = li.querySelector('.tree-row');
    var r = row.getBoundingClientRect();
    var y = (e.clientY - r.top) / r.height;
    var t = { li: li, id: id, ok: false };

    if (id === 'plant' || id === 'logic') {
      t.mode = 'inside'; t.parent = null; t.beforeId = null;
      t.ok = id === d.area;
      return t;
    }
    var n = MF.store.findNode(id);
    if (!n || n.area !== d.area) return t;
    var parent = MF.store.parentOf(n.obj, n.area);
    var onlyItems = d.ids.every(function (x) { return !MF.store.findFolder(x); });
    var open = li.getAttribute('aria-expanded') === 'true';

    if (n.kind === 'folder') {
      // Elemente/Regeln landen in Ordnern (sie stehen immer hinter den Ordnern einer Ebene),
      // Ordner können davor, hinein oder dahinter.
      if (onlyItems || (y >= 0.25 && (y <= 0.75 || open))) t.mode = 'inside';
      else t.mode = y < 0.25 ? 'before' : 'after';
    } else if (n.kind === 'body' && onlyItems) {
      // Körper auf einen Körper: in der Mitte koppeln, am Rand davor/dahinter einsortieren
      t.mode = y >= 0.3 && y <= 0.7 ? 'inside' : y < 0.5 ? 'before' : 'after';
    } else {
      t.mode = y < 0.5 ? 'before' : 'after';
    }

    if (t.mode === 'inside') { t.parent = id; t.beforeId = null; }
    else {
      t.parent = parent;
      if (t.mode === 'before') t.beforeId = id;
      else {
        // Nächstes Geschwister derselben Art (Ordner bzw. Element/Regel)
        var c = MF.store.childrenOf(n.area, parent);
        var list = n.kind === 'folder' ? c.folders : c.items;
        var k = list.indexOf(n.obj);
        var next = null;
        for (var j = k + 1; j < list.length; j++) {
          if (d.ids.indexOf(list[j].id) < 0) { next = list[j]; break; }
        }
        t.beforeId = next ? next.id : null;
      }
    }
    // Nicht auf sich selbst, kein Ordner in sich selbst oder seine Kinder,
    // Kopplung nur nach den Regeln (MF.store.coupleError); der Grund steht im Tooltip
    t.err = '';
    d.ids.forEach(function (x) { if (!t.err) t.err = MF.store.moveError(x, d.area, t.parent); });
    t.ok = d.ids.indexOf(id) < 0 && !t.err;
    t.li.title = t.ok ? '' : t.err;
    return t;
  },

  // Einfügelinie bzw. Hervorhebung des Zielordners anzeigen
  showDrop: function (t) {
    var d = this.drag;
    var old = this.root.querySelectorAll('.drop-before, .drop-after, .drop-inside, .drop-bad');
    Array.prototype.forEach.call(old, function (x) { x.classList.remove('drop-before', 'drop-after', 'drop-inside', 'drop-bad'); });
    if (!d) return;
    d.target = t;
    if (!t) return;
    var row = t.li.querySelector('.tree-row');
    row.classList.add(t.ok ? 'drop-' + t.mode : 'drop-bad');

    // Über einem zugeklappten Ordner kurz warten, dann aufklappen
    var self = this;
    var hover = t.ok && t.mode === 'inside' && this.folded[t.id] ? t.id : null;
    if (hover !== d.hoverId) {
      clearTimeout(d.hoverTimer);
      d.hoverId = hover;
      if (hover) d.hoverTimer = setTimeout(function () {
        if (!self.drag) return;
        self.folded[hover] = false;
        // Neu zeichnen, ohne das Ziehen abzubrechen: gezogener Eintrag bleibt im DOM
        var drag = self.drag;
        self.drag = null;
        self.render();
        self.drag = drag;
        drag.hoverId = null;
      }, 700);
    }
  }
};
