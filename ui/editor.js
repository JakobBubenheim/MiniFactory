// Editor: Bedienung der Fläche mit Maus und Tastatur.
// - Vorlagen aus dem Katalog (Ribbon "Komponenten") auf die Fläche ziehen; ein
//   einfacher Klick legt den Körper in die Mitte der Ansicht.
// - Werkzeuge im Ribbon "Modell" (Kürzel V / M / D):
//   Auswählen  – Klick wählt aus, Ziehen verschiebt die Ansicht
//   Verschieben – Körper ziehen
//   Drehen     – Klick dreht den Körper um 90° im Uhrzeigersinn (um seine Lage)
//   Die Werkzeuge greifen auch, während die Simulation läuft.
// - Zeichnen (Kürzel E / K / P), neue Körper sind immateriell (ghost), 0,1 m hoch:
//   Rechteck   – von Ecke zu Ecke ziehen
//   Kreis      – vom Mittelpunkt aus ziehen (Radius)
//   Polygon    – Punkte klicken; Doppelklick, Enter oder Klick auf den Startpunkt
//                schließt, Rücktaste nimmt den letzten Punkt zurück, Shift fängt
//                Kantenwinkel und -länge. Sich selbst schneidende Polygone werden abgelehnt.
//   Esc bricht ab. Während des Zeichnens stehen die Maße am Mauszeiger.
//   Gezeichnet wird nur, wenn die Simulation nicht läuft (wie Einfügen).
// - Griffe am gewählten Körper (Werkzeuge Auswählen und Verschieben): drehen
//   (Winkel-Fangen), Größe (Rechteck: Ecken/Kanten, Kreis: Radius), Polygonpunkte
//   ziehen; Doppelklick auf eine Kante fügt einen Punkt ein, auf einen Punkt löscht ihn.
//   Jede Bearbeitung ist ein Schritt im Verlauf; Esc während des Ziehens bricht ab.
// - Fangen an: Lage auf das Fangraster (settings.snap.pos, z. B. 5 cm), Drehung auf
//   settings.snap.angle (z. B. 5°); aus: 1 cm. Alt hält Fangen beim Ziehen und
//   Zeichnen vorübergehend aus. Das Raster ist nur Zeichenhilfe.
// - Löschen mit Entf/Rücktaste, Duplizieren mit Strg/Cmd+D, Strg/Cmd+G packt
//   die im Strukturbaum ausgewählten Einträge in einen neuen Ordner,
//   Pfeiltasten verschieben um einen Fangschritt (mit Shift um zehn).
// - Freie Fläche ziehen verschiebt die Ansicht, Mausrad zoomt.
// Einfügen, Löschen und Duplizieren sind gesperrt, solange die Simulation läuft.
window.MF = window.MF || {};

MF.editor = {
  DRAG_START_PX: 4,   // erst ab dieser Mausbewegung zählt es als Ziehen
  tool: 'select',     // 'select' | 'move' | 'rotate' | 'rect' | 'circle' | 'polygon'
  FREE_STEP: 0.01,    // Schrittweite in m, wenn Fangen aus ist
  HANDLE_PX: 7,       // Fangbereich der Griffe in Pixeln
  CLOSE_PX: 9,        // so nah am Startpunkt schließt ein Klick das Polygon

  TOOLS: {
    select:  { label: 'Auswählen',   key: 'v' },
    move:    { label: 'Verschieben', key: 'm' },
    rotate:  { label: 'Drehen',      key: 'd' },
    rect:    { label: 'Rechteck',    key: 'e', draw: true, hint: 'von Ecke zu Ecke ziehen' },
    circle:  { label: 'Kreis',       key: 'k', draw: true, hint: 'vom Mittelpunkt aus ziehen' },
    polygon: { label: 'Polygon',     key: 'p', draw: true,
      hint: 'Punkte klicken, Doppelklick oder Startpunkt schließt, Rücktaste nimmt einen Punkt zurück, Shift fängt den Winkel' }
  },

  draft: null,        // Form, die gerade gezeichnet wird (siehe MF.sim.draft)
  hotHandle: null,    // Griff unter der Maus (wird hervorgehoben)

  init: function (canvas) {
    this.canvas = canvas;
    this.initLibrary();
    this.initCanvas();
    this.initKeys();
    this.updateCursor(null);
    MF.ui.syncToggles();   // gemerktes Fangen im Ribbon anzeigen
  },

  // ---------- Werkzeug und Fangen ----------

  setTool: function (tool) {
    if (!this.TOOLS[tool] || tool === this.tool) return;
    this.cancelDraft();
    this.tool = tool;
    this.hotHandle = null;
    this.updateCursor(null);
    MF.ui.syncToggles();
    MF.sim.draw();
    var t = this.TOOLS[tool];
    MF.ui.message('Werkzeug: ' + t.label + (t.hint ? ' – ' + t.hint + ', Esc bricht ab.' : '.'));
  },

  // Fangen gehört zur Anlage (settings.snap), wird aber nicht als Änderung gezählt
  get snap() { return MF.model.settings.snap.on !== false; },

  toggleSnap: function () {
    MF.model.settings.snap.on = !this.snap;
    MF.ui.syncToggles();
    MF.props.render();   // Schrittweite der X/Y-Felder
    MF.ui.message(this.snap ? 'Fangen an: Schritte von ' + MF.props.formatNumber(this.snapStep() * 100) + ' cm.'
      : 'Fangen aus: Schritte von 1 cm.');
  },

  // Schrittweite für Lagen in Metern
  snapStep: function () { return this.snap ? MF.model.settings.snap.pos || 0.05 : this.FREE_STEP; },

  // Lage auf das Fangraster bzw. auf 1 cm runden; off (Alt gedrückt): auf 1 mm
  snapValue: function (v, off) {
    var step = off ? MF.geom.FREE_POS : this.snapStep();
    return Math.round(Math.round(v / step) * step * 1e6) / 1e6;
  },

  // Länge mit deutschem Komma, auf Millimeter, z. B. "1,25"
  fmtLen: function (v) {
    return String(Math.round(v * 1000) / 1000).replace('.', ',');
  },

  // Mauszeiger der Fläche: zeigt das Werkzeug, über gesperrten Körpern "verboten"
  ROTATE_CURSOR: 'url("data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
    '<g fill="none" stroke-width="5" stroke="#F4F2EC"><path d="M19 12a7 7 0 1 1-3-5.7"/><path d="M16.5 2.5v4h4"/></g>' +
    '<g fill="none" stroke-width="2" stroke="#1B2430"><path d="M19 12a7 7 0 1 1-3-5.7"/><path d="M16.5 2.5v4h4"/></g>' +
    '</svg>') + '") 12 12, alias',

  updateCursor: function (over, handle) {
    var c;
    if (this.TOOLS[this.tool].draw) c = 'crosshair';
    else if (handle) c = this.handleCursor(handle);
    else if (this.tool === 'select') c = over ? 'pointer' : 'default';
    else if (over && over.look.locked) c = 'not-allowed';
    else c = this.tool === 'move' ? 'move' : this.ROTATE_CURSOR;
    this.canvas.style.cursor = c;
  },

  // ---------- Drehen ----------

  // Körper auf eine Drehung (Grad) bringen; er dreht sich um seine Lage (pose).
  // Beim Förderband dreht die Laufrichtung mit, beim Schieber die Schubrichtung.
  setRotation: function (b, rot) {
    rot = MF.geom.normDeg(rot);
    if (rot === b.pose.rot) return false;
    if (b.look.locked) { MF.ui.message(b.name + ' ist gesperrt.'); return false; }
    b.pose.rot = rot;
    MF.store.changed();
    return true;
  },

  rotateBody: function (b) {
    if (this.setRotation(b, b.pose.rot + 90)) {
      var dir = MF.propDef(b, 'direction') ? MF.getProp(b, 'direction') : '';
      MF.ui.message(b.name + ' auf ' + MF.props.formatNumber(b.pose.rot) + '° gedreht' +
        (dir ? (b.surface ? ', läuft nach ' : ', schiebt nach ') + dir : '') + '.');
    }
  },

  // Einfügen, Löschen, Duplizieren nur, wenn die Simulation nicht läuft
  canEdit: function () {
    if (MF.engine.state !== 'running') return true;
    MF.ui.message('Zum Bearbeiten die Simulation pausieren.');
    return false;
  },

  // Ordner für neue Körper bzw. Regeln: der gewählte Ordner oder der Ordner des
  // gewählten Körpers bzw. der Regel – nur im passenden Bereich, sonst oberste Ebene.
  currentParent: function (area) {
    var t = MF.tree.target(MF.store.selectedId);
    return t && t.area === area ? t.parent : null;
  },

  canvasPos: function (e) {
    var r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, inside:
      e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom };
  },

  // Mitte (in Metern, gefangen) für einen neuen Körper unter (px, py)
  posFor: function (px, py) {
    var w = MF.sim.toWorld(px, py);
    return { x: this.snapValue(w.x), y: this.snapValue(w.y) };
  },

  // ---------- Bibliothek: Ziehen auf die Fläche ----------

  initLibrary: function () {
    var self = this;
    document.addEventListener('pointerdown', function (e) {
      var btn = e.target.closest('[data-create]');
      if (!btn || e.button !== 0) return;
      e.preventDefault();
      self.startLibraryDrag(btn, e);
    });
  },

  startLibraryDrag: function (btn, e) {
    var self = this;
    var type = btn.dataset.create;
    var t = MF.templates[type];
    var startX = e.clientX, startY = e.clientY;
    var chip = null;
    btn.setPointerCapture(e.pointerId);

    function move(ev) {
      if (!chip) {
        if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < self.DRAG_START_PX) return;
        if (!self.canEdit()) { end(); return; }
        chip = document.createElement('div');
        chip.className = 'drag-chip';
        chip.innerHTML = '<svg><use href="#' + t.icon + '"/></svg><span></span>';
        chip.querySelector('span').textContent = t.label;
        document.body.appendChild(chip);
        document.body.classList.add('is-dragging');
      }
      chip.style.left = ev.clientX + 'px';
      chip.style.top = ev.clientY + 'px';
      var p = self.canvasPos(ev);
      chip.classList.toggle('is-over-canvas', p.inside);
      MF.sim.ghost = p.inside ? self.ghostFor(type, p) : null;
      MF.sim.draw();
    }

    function up(ev) {
      var p = self.canvasPos(ev);
      if (chip) {
        if (p.inside) self.place(type, self.posFor(p.x, p.y));
        else MF.ui.message('Abgebrochen – zum Einfügen auf die Fläche ziehen.');
      } else if (self.canEdit()) {
        // Einfacher Klick: in die Mitte der Ansicht legen
        self.place(type, self.posFor(MF.sim.width / 2, MF.sim.height / 2));
      }
      end();
    }

    function end() {
      btn.removeEventListener('pointermove', move);
      btn.removeEventListener('pointerup', up);
      btn.removeEventListener('pointercancel', end);
      if (chip) chip.remove();
      chip = null;
      document.body.classList.remove('is-dragging');
      MF.sim.ghost = null;
      MF.sim.draw();
    }

    btn.addEventListener('pointermove', move);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', end);
  },

  ghostFor: function (type, p) {
    var c = this.posFor(p.x, p.y);
    return { template: type, x: c.x, y: c.y };
  },

  place: function (type, pos) {
    var b = MF.store.createBody(type, pos.x, pos.y, this.currentParent('plant'));
    MF.ui.message(b.name + ' (' + b.id + ') eingefügt.');
    return b;
  },

  // ---------- Griffe am gewählten Körper ----------

  // Zeigt der Körper Griffe? Nur mit Auswählen/Verschieben, nicht gesperrt und
  // nicht, während ein dynamischer Körper unterwegs ist (er liegt woanders als gezeichnet).
  handlesFor: function (b) {
    if (!b || b.look.locked || !b.look.visible || this.draft) return false;
    if (this.tool !== 'select' && this.tool !== 'move') return false;
    return !(b.kind === 'dynamic' && b.rt && b.rt.cur);
  },

  // Griff unter (px, py) oder null; der Drehgriff gewinnt, dann der nächste
  handleAt: function (b, p) {
    var best = null, bestD = this.HANDLE_PX;
    MF.sim.handles(b).forEach(function (h) {
      var d = Math.sqrt((h.x - p.x) * (h.x - p.x) + (h.y - p.y) * (h.y - p.y));
      if (h.kind === 'rotate' && d <= bestD + 2) { best = h; bestD = -1; }
      else if (d < bestD) { best = h; bestD = d; }
    });
    return best;
  },

  // Kante eines Polygons unter (px, py): { i, x, y } (Einfügen nach Punkt i) oder null
  edgeAt: function (b, p) {
    var pose = MF.sim.drawPose(b), best = null, bestD = this.HANDLE_PX;
    var pts = MF.geom.worldOutline(b.shape, pose).map(function (w) { return MF.sim.toScreen(w.x, w.y); });
    pts.forEach(function (a, i) {
      var q = MF.geom.nearestOnSegment(p, a, pts[(i + 1) % pts.length]);
      if (q.dist < bestD && q.t > 0.02 && q.t < 0.98) { best = { i: i }; bestD = q.dist; }
    });
    return best;
  },

  // Mauszeiger über einem Griff: Drehen bzw. Größe in Richtung des Griffs
  handleCursor: function (h) {
    if (h.kind === 'rotate') return this.ROTATE_CURSOR;
    if (h.kind === 'vertex') return 'crosshair';
    if (h.kind === 'axis') return h.part === 'origin' ? 'move' : 'grab';
    var b = MF.store.findBody(MF.store.selectedId);
    var c = b ? MF.sim.toScreen(MF.sim.drawPose(b).x, MF.sim.drawPose(b).y) : h;
    var a = (Math.atan2(h.y - c.y, h.x - c.x) * 180 / Math.PI + 360) % 180;
    return a < 22.5 || a >= 157.5 ? 'ew-resize' : a < 67.5 ? 'nwse-resize' : a < 112.5 ? 'ns-resize' : 'nesw-resize';
  },

  // Weltpunkt w -> Koordinaten, in denen b.pose gilt (Eltern-Körper bzw. Welt,
  // eigene Achse in Stellung 0). draw = gezeichnete Lage, pose = Modell-Lage beim
  // Anfassen: der Punkt behält seine Lage relativ zum Körper.
  modelPoint: function (draw, pose, w) {
    var l = MF.geom.toLocal(draw, w.x, w.y);
    return MF.geom.toWorld(pose, l.x, l.y);
  },

  // Achs-Griff ziehen (Ursprung, Grenzen, Richtung). Gerechnet wird im
  // Koordinatensystem des Körpers mit Achse in Stellung 0 (drag.rest0).
  applyAxisHandle: function (drag, w, e) {
    var b = drag.el, ax = drag.axis0, G = MF.geom, part = drag.h.part;
    var snap = MF.model.settings.snap, off = e.altKey, ch = {}, label;
    var l = G.toLocal(drag.rest0, w.x, w.y), o = ax.origin;
    var astep = !off && snap.on !== false ? snap.angle || 5 : 0.1;
    var unit = MF.axisUnit(ax).pos;
    if (part === 'origin') {
      var q = G.snapPoint(l.x, l.y, snap, off);
      ch.origin = [q.x, q.y, o[2]];
      label = 'Ursprung ' + this.fmtLen(q.x) + ' | ' + this.fmtLen(q.y) + ' m';
    } else if (part === 'dir') {
      var deg = G.snapAngle(Math.atan2(l.y - o[1], l.x - o[0]) * 180 / Math.PI, snap, off), d = G.dirVec(deg);
      ch.dir = [d.x, d.y, 0];
      label = 'Richtung ' + MF.props.formatNumber(deg) + '°';
    } else if (ax.type === 'rotary') {
      // Winkel ab der lokalen x-Achse, stetig fortgesetzt (Grenzen auch über ±180°)
      var sign = ax.dir[2] < 0 ? -1 : 1, prev = ax[part];
      var a = sign * Math.atan2(l.y - o[1], l.x - o[0]) * 180 / Math.PI;
      a += 360 * Math.round((prev - a) / 360);
      ch[part] = G.round6(Math.round(a / astep) * astep);
    } else {
      var d0 = ax.dir, len = Math.sqrt(d0[0] * d0[0] + d0[1] * d0[1] + d0[2] * d0[2]) || 1;
      var ux = d0[0] / len, uy = d0[1] / len;
      ch[part] = G.snapLen(((l.x - o[0]) * ux + (l.y - o[1]) * uy) / (ux * ux + uy * uy), snap, off);
    }
    if (part === 'min' || part === 'max') {
      // Grenzen tauschen nicht die Seite: min bleibt höchstens max
      if (part === 'min') ch.min = Math.min(ch.min, ax.max);
      else ch.max = Math.max(ch.max, ax.min);
      label = (part === 'min' ? 'min ' : 'max ') + MF.props.formatNumber(ch[part]) + ' ' + unit;
    }
    var err = MF.setAxis(b, ch);
    var sp = MF.sim.toScreen(w.x, w.y);
    MF.sim.editLabel = { text: err || label, x: sp.x, y: sp.y };
    drag.err = err;
    if (!err) MF.store.changed();
    else MF.sim.draw();
  },

  // Griff ziehen: neue Form bzw. Lage aus der Mausposition (Welt, m).
  // drag.pose0/shape0 = Stand beim Anfassen; Fehler (z. B. Selbstschnitt) lassen
  // die letzte gültige Form stehen und zeigen den Grund am Mauszeiger.
  applyHandle: function (drag, w, e) {
    if (drag.h.kind === 'axis') { this.applyAxisHandle(drag, w, e); return; }
    var b = drag.el, h = drag.h, pose = drag.pose0, sh = drag.shape0, G = MF.geom;
    var snap = MF.model.settings.snap, off = e.altKey;
    var step = G.snapStep(snap, off), ch = {}, label;
    var w0 = w;
    w = this.modelPoint(drag.draw0, pose, w);   // Achse, Kopplung: zurück ins Koordinatensystem der Lage
    if (h.kind === 'rotate') {
      ch.rot = G.snapAngle(Math.atan2(w.y - pose.y, w.x - pose.x) * 180 / Math.PI + 90, snap, off);
      label = MF.props.formatNumber(ch.rot) + '°';
    } else if (h.kind === 'size') {
      var l = G.toLocal(pose, w.x, w.y), cx = 0, cy = 0;
      ch.w = sh.w; ch.d = sh.d;
      if (h.sx) {
        var fx = -h.sx * sh.w / 2;
        ch.w = Math.max(step, G.snapLen(h.sx * (l.x - fx), snap, off));
        cx = fx + h.sx * ch.w / 2;
      }
      if (h.sy) {
        var fy = -h.sy * sh.d / 2;
        ch.d = Math.max(step, G.snapLen(h.sy * (l.y - fy), snap, off));
        cy = fy + h.sy * ch.d / 2;
      }
      var c = G.toWorld(pose, cx, cy);
      ch.x = G.round6(c.x); ch.y = G.round6(c.y);
      label = this.fmtLen(ch.w) + ' × ' + this.fmtLen(ch.d) + ' m';
    } else if (h.kind === 'radius') {
      ch.r = Math.max(step, G.snapLen(Math.sqrt((w.x - pose.x) * (w.x - pose.x) + (w.y - pose.y) * (w.y - pose.y)), snap, off));
      label = 'r ' + this.fmtLen(ch.r) + ' m';
    } else if (h.kind === 'vertex') {
      var q = G.snapPoint(w.x, w.y, snap, off), lq = G.toLocal(pose, q.x, q.y);
      ch.points = sh.points.map(function (p) { return [p[0], p[1]]; });
      ch.points[h.i] = [G.round6(lq.x), G.round6(lq.y)];
      var n = ch.points.length, lens = G.edgeLengths(ch.points);
      label = this.fmtLen(lens[(h.i + n - 1) % n]) + ' m | ' + this.fmtLen(lens[h.i]) + ' m';
    }
    var err = MF.setForm(b, ch);
    var s = MF.sim.toScreen(w0.x, w0.y);
    MF.sim.editLabel = { text: err || label, x: s.x, y: s.y };
    drag.err = err;
    if (!err) MF.store.changed();
    else MF.sim.draw();
  },

  // Doppelklick am gewählten Polygon: Punkt löschen bzw. auf der Kante einfügen
  editPolygonAt: function (b, p) {
    var h = this.handleAt(b, p);
    var pts = b.shape.points.map(function (q) { return [q[0], q[1]]; });
    var text;
    if (h && h.kind === 'vertex') {
      if (pts.length <= 3) { MF.ui.message('Ein Polygon braucht mindestens drei Punkte.'); return true; }
      pts.splice(h.i, 1);
      text = 'Punkt gelöscht';
    } else {
      var e = this.edgeAt(b, p);
      if (!e) return false;
      var w = MF.sim.toWorld(p.x, p.y), pose = MF.sim.drawPose(b);
      var a = MF.geom.worldOutline(b.shape, pose), q = MF.geom.nearestOnSegment(w, a[e.i], a[(e.i + 1) % a.length]);
      var l = MF.geom.toLocal(pose, q.x, q.y);
      var mm = function (v) { return Math.round(v * 1000) / 1000; };
      pts.splice(e.i + 1, 0, [mm(l.x), mm(l.y)]);
      text = 'Punkt eingefügt – zum Verschieben ziehen';
    }
    var err = MF.setForm(b, { points: pts });
    if (err) { MF.ui.message(err); return true; }
    MF.history.end();          // eigener Schritt im Verlauf
    MF.store.changed();
    MF.history.end();
    MF.ui.message(b.name + ': ' + text + ' (' + pts.length + ' Punkte).');
    return true;
  },

  createdAt: 0,   // Zeitpunkt der zuletzt gezeichneten Form

  // Laufende Bearbeitung mit einem Griff abbrechen (Esc); true, wenn es eine gab
  cancelDrag: function () { return false; },   // wird in initCanvas gesetzt

  // ---------- Formen zeichnen ----------

  // Gefangener Weltpunkt unter der Maus. Alt = ohne Fangen. Polygon mit Shift:
  // Kante mit gefangenem Winkel und gefangener Länge ab dem letzten Punkt.
  drawPoint: function (p, e) {
    var w = MF.sim.toWorld(p.x, p.y), snap = MF.model.settings.snap;
    var d = this.draft;
    if (d && d.type === 'polygon' && e.shiftKey && d.points.length) {
      return MF.geom.snapPolar(d.points[d.points.length - 1], w, snap, e.altKey);
    }
    return MF.geom.snapPoint(w.x, w.y, snap, e.altKey);
  },

  drawDown: function (p, e) {
    if (!this.canEdit()) return false;
    var w = this.drawPoint(p, e), d = this.draft;
    if (this.tool !== 'polygon') {
      this.draft = { type: this.tool, points: [w], cursor: w, label: '' };
      this.showDraft();
      return true;
    }
    if (!d) {
      this.draft = { type: 'polygon', points: [w], cursor: w, label: '' };
      this.showDraft();
      return false;
    }
    var last = d.points[d.points.length - 1];
    var same = Math.abs(last.x - w.x) < 1e-9 && Math.abs(last.y - w.y) < 1e-9;
    if (this.nearStart(p) || same) {
      // Klick auf den Startpunkt oder zweiter Klick eines Doppelklicks: schließen
      this.finishPolygon();
      return false;
    }
    d.points.push(w);
    this.updateDraft(p, e);
    return false;
  },

  nearStart: function (p) {
    var d = this.draft;
    if (!d || d.type !== 'polygon' || d.points.length < 3) return false;
    var s = MF.sim.toScreen(d.points[0].x, d.points[0].y);
    return Math.abs(s.x - p.x) + Math.abs(s.y - p.y) <= this.CLOSE_PX;
  },

  // Vorschau und Maße an die Mausposition anpassen
  updateDraft: function (p, e) {
    var d = this.draft;
    if (!d) return;
    var w = this.drawPoint(p, e), a = d.points[0], f = this.fmtLen;
    d.closing = this.nearStart(p);
    d.cursor = d.closing ? a : w;
    d.bad = false;
    if (d.type === 'rect') {
      d.label = f(Math.abs(w.x - a.x)) + ' × ' + f(Math.abs(w.y - a.y)) + ' m';
    } else if (d.type === 'circle') {
      d.label = 'r ' + f(Math.sqrt((w.x - a.x) * (w.x - a.x) + (w.y - a.y) * (w.y - a.y))) + ' m';
    } else {
      var last = d.points[d.points.length - 1], c = d.cursor;
      var len = Math.sqrt((c.x - last.x) * (c.x - last.x) + (c.y - last.y) * (c.y - last.y));
      var ang = MF.geom.normDeg(Math.round(Math.atan2(c.y - last.y, c.x - last.x) * 1800 / Math.PI) / 10);
      d.label = d.closing ? 'schließen (' + d.points.length + ' Punkte)'
        : f(len) + ' m  ' + MF.props.formatNumber(ang) + '°';
      if (d.closing) {
        d.bad = MF.geom.selfIntersects(d.points.map(function (q) { return [q.x, q.y]; }));
        if (d.bad) d.label = 'schneidet sich selbst';
      }
    }
    this.showDraft();
  },

  showDraft: function () {
    MF.sim.draft = this.draft;
    MF.sim.draw();
  },

  cancelDraft: function () {
    if (!this.draft) return;
    this.draft = null;
    this.showDraft();
  },

  // Polygon: letzten Punkt zurücknehmen; ohne Punkte ist das Zeichnen beendet
  undoPoint: function () {
    var d = this.draft;
    d.points.pop();
    if (!d.points.length) { this.cancelDraft(); MF.ui.message('Zeichnen abgebrochen.'); return; }
    d.cursor = d.cursor || d.points[d.points.length - 1];
    this.showDraft();
  },

  // Rechteck bzw. Kreis beim Loslassen anlegen
  finishDrag: function (p, e) {
    var d = this.draft;
    if (!d) return;
    var w = this.drawPoint(p, e), a = d.points[0], shape, pose;
    if (d.type === 'rect') {
      var r = MF.geom.rectFromCorners(a, w);
      shape = { type: 'rect', w: r.w, d: r.d };
      pose = { x: r.x, y: r.y };
    } else {
      shape = { type: 'circle', r: MF.geom.round6(Math.sqrt((w.x - a.x) * (w.x - a.x) + (w.y - a.y) * (w.y - a.y))) };
      pose = { x: a.x, y: a.y };
    }
    if ((shape.type === 'rect' && (shape.w < 1e-6 || shape.d < 1e-6)) || (shape.type === 'circle' && shape.r < 1e-6)) {
      this.cancelDraft();
      MF.ui.message('Zum Zeichnen ' + (d.type === 'rect' ? 'von Ecke zu Ecke' : 'vom Mittelpunkt aus') + ' ziehen.');
      return;
    }
    this.create(shape, pose);
  },

  finishPolygon: function () {
    var d = this.draft;
    if (!d) return;
    if (d.points.length < 3) { MF.ui.message('Ein Polygon braucht mindestens drei Punkte.'); return; }
    var poly = MF.geom.polygonFromWorld(d.points);
    if (MF.geom.selfIntersects(poly.points)) {
      MF.ui.message('Das Polygon schneidet sich selbst – mit der Rücktaste Punkte zurücknehmen.');
      return;
    }
    this.create({ type: 'polygon', points: poly.points }, { x: poly.x, y: poly.y });
  },

  // Neuen Körper aus der gezeichneten Form anlegen (ein Schritt im Verlauf)
  create: function (shape, pose) {
    shape.h = MF.BODY.H;
    this.draft = null;
    MF.sim.draft = null;
    MF.history.end();
    MF.history.begin();
    var b = MF.store.createShape(shape, { x: pose.x, y: pose.y, z: 0, rot: 0 }, this.currentParent('plant'));
    MF.history.end();
    this.createdAt = Date.now();
    if (!b) { MF.sim.draw(); return; }
    this.setTool('select');
    MF.ui.message(b.name + ' (' + b.id + ') gezeichnet – immateriell, ' + this.fmtLen(b.shape.h) +
      ' m hoch. Körperart und Funktionen im Eigenschaften-Panel.');
  },

  // ---------- Fläche: Werkzeuge und Ansicht ziehen ----------

  initCanvas: function () {
    var self = this;
    var canvas = this.canvas;
    var drag = null;

    canvas.addEventListener('pointerdown', function (e) {
      // Fokus aus Baum oder Eingabefeld nehmen: Pfeiltasten wirken danach auf die Fläche,
      // offene Eingaben werden dabei übernommen
      if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
      var p = self.canvasPos(e);

      // Zeichnen: Rechteck und Kreis entstehen beim Ziehen, Polygon Punkt für Punkt
      if (e.button === 0 && self.TOOLS[self.tool].draw) {
        if (self.drawDown(p, e)) drag = { mode: 'draw' };
        canvas.setPointerCapture(e.pointerId);
        return;
      }

      // Griff am gewählten Körper anfassen
      var sel = MF.store.findBody(MF.store.selectedId);
      var h = e.button === 0 && self.handlesFor(sel) ? self.handleAt(sel, p) : null;
      if (h) {
        drag = { mode: 'handle', el: sel, h: h, sx: p.x, sy: p.y, active: false,
          pose0: { x: sel.pose.x, y: sel.pose.y, z: sel.pose.z, rot: sel.pose.rot },
          shape0: JSON.parse(JSON.stringify(sel.shape)),
          draw0: MF.sim.drawPose(sel), rest0: MF.sim.restDrawPose(sel),
          axis0: sel.axis ? JSON.parse(JSON.stringify(sel.axis)) : null };
        canvas.setPointerCapture(e.pointerId);
        return;
      }

      var hit = e.button === 0 ? MF.sim.hitTest(p.x, p.y) : null;
      // Klick auf eine Kante des gewählten Polygons (Doppelklick fügt dort einen Punkt
      // ein) behält die Auswahl, auch wenn er knapp außerhalb liegt
      if (sel && sel.shape.type === 'polygon' && self.handlesFor(sel) && self.edgeAt(sel, p)) hit = sel;
      if (e.button === 0) MF.store.select(hit ? hit.id : null);

      if (hit && self.tool === 'move') {
        var dp = MF.sim.drawPose(hit), p0 = { x: hit.pose.x, y: hit.pose.y, rot: hit.pose.rot };
        var w = self.modelPoint(dp, p0, MF.sim.toWorld(p.x, p.y));
        drag = { mode: 'move', el: hit, wx: w.x, wy: w.y, ox: hit.pose.x, oy: hit.pose.y, sx: p.x, sy: p.y, active: false,
          draw0: dp, pose0: p0 };
      } else {
        // Ansicht ziehen – auch über Körpern, damit Auswählen/Drehen nichts verschiebt.
        // Ein Klick ohne Ziehen dreht beim Werkzeug "Drehen" den Körper.
        drag = { mode: 'pan', sx: p.x, sy: p.y, ox: MF.sim.offsetX, oy: MF.sim.offsetY, el: hit, active: false };
      }
      canvas.setPointerCapture(e.pointerId);
    });

    canvas.addEventListener('pointermove', function (e) {
      var p = self.canvasPos(e);
      MF.ui.setCursor(MF.sim.toWorld(p.x, p.y));

      if (self.draft) {
        self.updateDraft(p, e);
        return;
      }

      if (!drag) {
        var sel = MF.store.findBody(MF.store.selectedId);
        var h = self.handlesFor(sel) ? self.handleAt(sel, p) : null;
        var changed = (h && h.kind) !== (self.hotHandle && self.hotHandle.kind) ||
          (h && (h.sx !== self.hotHandle.sx || h.sy !== self.hotHandle.sy || h.i !== self.hotHandle.i || h.part !== self.hotHandle.part));
        self.hotHandle = h;
        if (changed) MF.sim.draw();
        self.updateCursor(h ? null : MF.sim.hitTest(p.x, p.y), h);
        return;
      }

      // Erst ab kleiner Mindestbewegung zählt es als Ziehen, damit ein Klick nur auswählt
      if (!drag.active) {
        if (drag.mode === 'draw') return;
        if (Math.abs(p.x - drag.sx) + Math.abs(p.y - drag.sy) < self.DRAG_START_PX) return;
        if (drag.mode === 'move' && drag.el.look.locked) { MF.ui.message(drag.el.name + ' ist gesperrt.'); drag = null; return; }
        drag.active = true;
        if (drag.mode === 'pan') canvas.style.cursor = 'grabbing';
        if (drag.mode === 'handle' || drag.mode === 'move') MF.history.begin();
      }

      if (drag.mode === 'pan') {
        MF.sim.offsetX = drag.ox + (p.x - drag.sx);
        MF.sim.offsetY = drag.oy + (p.y - drag.sy);
        MF.sim.draw();
        return;
      }

      var w = MF.sim.toWorld(p.x, p.y);
      if (drag.mode === 'handle') {
        self.applyHandle(drag, w, e);
        return;
      }
      w = self.modelPoint(drag.draw0, drag.pose0, w);   // gekoppelt oder gedreht: im Koordinatensystem der Lage

      var nx = self.snapValue(drag.ox + (w.x - drag.wx), e.altKey);
      var ny = self.snapValue(drag.oy + (w.y - drag.wy), e.altKey);
      if (nx !== drag.el.pose.x || ny !== drag.el.pose.y) {
        drag.el.pose.x = nx;
        drag.el.pose.y = ny;
        MF.store.changed();
      }
    });

    // Esc während des Ziehens: Form und Lage wie beim Anfassen
    this.cancelDrag = function () {
      if (!drag || !drag.active || (drag.mode !== 'handle' && drag.mode !== 'move')) return false;
      if (drag.mode === 'handle' && drag.h.kind === 'axis') {
        MF.setAxis(drag.el, drag.axis0);
      } else if (drag.mode === 'handle') {
        MF.setForm(drag.el, { x: drag.pose0.x, y: drag.pose0.y, rot: drag.pose0.rot });
        drag.el.shape = drag.shape0;
      } else {
        drag.el.pose.x = drag.ox;
        drag.el.pose.y = drag.oy;
      }
      MF.store.changed();
      MF.history.end();
      MF.sim.editLabel = null;
      drag = null;
      MF.ui.message('Bearbeitung abgebrochen.');
      return true;
    };

    function end(e) {
      var p = self.canvasPos(e);
      if (drag && drag.mode === 'draw') {
        drag = null;
        if (e.type === 'pointerup') self.finishDrag(p, e);
        else self.cancelDraft();
        return;
      }
      if (drag && drag.mode === 'move' && drag.active &&
          (drag.el.pose.x !== drag.ox || drag.el.pose.y !== drag.oy)) {
        MF.ui.message(drag.el.name + ' nach x ' + MF.props.formatNumber(drag.el.pose.x) +
          ' m, y ' + MF.props.formatNumber(drag.el.pose.y) + ' m verschoben.');
      }
      if (drag && drag.mode === 'handle' && drag.active) {
        var b = drag.el, sh = b.shape, ax = b.axis, u = ax ? ' ' + MF.axisUnit(ax).pos : '';
        var what = drag.h.kind === 'axis' ? (drag.h.part === 'origin' ? 'Achsursprung verschoben'
            : drag.h.part === 'dir' ? 'Achsrichtung geändert'
            : 'Achse ' + MF.props.formatNumber(ax.min) + ' … ' + MF.props.formatNumber(ax.max) + u)
          : drag.h.kind === 'rotate' ? 'auf ' + MF.props.formatNumber(b.pose.rot) + '° gedreht'
          : drag.h.kind === 'vertex' ? 'Punkt ' + (drag.h.i + 1) + ' verschoben'
          : sh.type === 'circle' ? 'Radius ' + self.fmtLen(sh.r) + ' m'
          : 'Größe ' + self.fmtLen(sh.w) + ' × ' + self.fmtLen(sh.d) + ' m';
        MF.ui.message(b.name + ': ' + what + (drag.err ? ' (' + drag.err + ')' : '') + '.');
      }
      if (drag && drag.active && (drag.mode === 'handle' || drag.mode === 'move')) MF.history.end();
      if (drag && drag.mode === 'pan' && !drag.active && drag.el && self.tool === 'rotate' && e.type === 'pointerup') {
        self.rotateBody(drag.el);
      }
      drag = null;
      if (MF.sim.editLabel) { MF.sim.editLabel = null; MF.sim.draw(); }
      self.updateCursor(p.inside ? MF.sim.hitTest(p.x, p.y) : null);
    }
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    // Doppelklick: Polygon fertig zeichnen bzw. Punkt am gewählten Polygon löschen/einfügen
    canvas.addEventListener('dblclick', function (e) {
      var p = self.canvasPos(e);
      if (self.draft && self.draft.type === 'polygon') { self.finishPolygon(); return; }
      if (Date.now() - self.createdAt < 600) return;   // Doppelklick hat gerade ein Polygon geschlossen
      var sel = MF.store.findBody(MF.store.selectedId);
      if (sel && sel.shape.type === 'polygon' && self.handlesFor(sel)) self.editPolygonAt(sel, p);
    });

    canvas.addEventListener('pointerleave', function () {
      if (!drag) MF.ui.setCursor(null);
    });

    // Mausrad / Trackpad: zoomen um den Mauszeiger
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      var p = self.canvasPos(e);
      MF.sim.setZoom(MF.sim.zoom * Math.exp(-e.deltaY * 0.0015), p.x, p.y);
      MF.ui.updateStatus();
    }, { passive: false });
  },

  // ---------- Befehle ----------

  deleteSelected: function () {
    var id = MF.store.selectedId;
    var el = MF.store.findBody(id);
    var rule = MF.store.findRule(id);
    // Mehrfachauswahl oder Ordner im Strukturbaum
    var sel = MF.tree.selection();
    if (sel.length > 1 || MF.store.findFolder(id)) {
      MF.tree.deleteNodes(sel.length ? sel : [id]);
      return;
    }
    if (el) {
      if (el.look.locked) { MF.ui.message(el.name + ' ist gesperrt.'); return; }
      if (!this.canEdit()) return;
      MF.store.deleteBody(id);
      MF.ui.message(el.name + ' (' + el.id + ') gelöscht.');
    } else if (rule) {
      if (!this.canEdit()) return;
      MF.store.deleteRule(id);
      MF.ui.message(rule.name + ' gelöscht.');
    } else {
      MF.ui.message('Zum Löschen einen Körper, eine Regel oder einen Ordner auswählen.');
    }
  },

  // Leere Regel anlegen und im Eigenschaften-Panel öffnen
  newRule: function (kind) {
    if (!this.canEdit()) return;
    MF.props.tab = 'props';
    var rule = MF.store.createRule(kind, this.currentParent('logic'));
    MF.tree.reveal(rule.id);   // Logik und Ordner aufklappen
    if (kind === 'scl') {
      MF.sclEditor.open(rule);
      MF.ui.message(rule.name + ' (' + rule.id + ') angelegt – Signale links in den Code ziehen.');
    } else {
      MF.ui.message(rule.name + ' (' + rule.id + ') angelegt – Wenn und Dann wählen.');
    }
  },

  // SCL-Editor für die gewählte Regel; Wenn-dann-Regeln werden dabei umgewandelt
  openSclEditor: function () {
    var rule = MF.store.findRule(MF.store.selectedId);
    if (!rule) { MF.ui.message('Zuerst einen SCL-Baustein im Strukturbaum auswählen – oder "SCL-Baustein" anlegen.'); return; }
    if (!MF.logic.isScl(rule)) {
      rule.kind = 'scl';
      rule.code = rule.code || MF.logic.toScl(rule);
      MF.store.changed();
    }
    MF.sclEditor.open(rule);
  },

  deleteSelectedRule: function () {
    if (MF.store.findRule(MF.store.selectedId)) this.deleteSelected();
    else MF.ui.message('Zuerst eine Regel im Strukturbaum auswählen.');
  },

  duplicateSelected: function () {
    var el = MF.store.findBody(MF.store.selectedId);
    var rule = MF.store.findRule(MF.store.selectedId);
    if (rule) {
      if (!this.canEdit()) return;
      var r = MF.store.duplicateRule(rule.id);
      MF.ui.message(r.name + ' (' + r.id + ') als Kopie angelegt.');
      return;
    }
    if (!el) { MF.ui.message('Zum Duplizieren einen Körper oder eine Regel auswählen.'); return; }
    if (!this.canEdit()) return;
    var copy = MF.store.duplicateBody(el.id);
    MF.ui.message(copy.name + ' (' + copy.id + ') als Kopie eingefügt.');
  },

  nudgeSelected: function (dx, dy) {
    var el = MF.store.findBody(MF.store.selectedId);
    if (!el) return false;
    if (el.look.locked) { MF.ui.message(el.name + ' ist gesperrt.'); return true; }
    // Gekoppelt oder gedreht: Pfeil nach rechts verschiebt auch auf der Fläche nach rechts
    var a = MF.geom.rad(MF.sim.drawPose(el).rot - el.pose.rot);
    if (a) {
      var c = Math.cos(a), s = Math.sin(a), lx = dx * c + dy * s;
      dy = -dx * s + dy * c;
      dx = lx;
    }
    el.pose.x = Math.round((el.pose.x + dx) * 1e6) / 1e6;
    el.pose.y = Math.round((el.pose.y + dy) * 1e6) / 1e6;
    MF.store.changed();
    return true;
  },

  // ---------- Tastatur ----------

  initKeys: function () {
    var self = this;
    document.addEventListener('keydown', function (e) {
      var t = e.target;
      if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return;
      var mod = e.metaKey || e.ctrlKey;

      // Zeichnen und Griffe: Esc bricht ab, beim Polygon nimmt die Rücktaste den
      // letzten Punkt zurück und Enter schließt. Esc hebt dabei nicht die Auswahl auf.
      if (e.key === 'Escape' && (self.draft || self.cancelDrag())) {
        if (self.draft) { self.cancelDraft(); MF.ui.message('Zeichnen abgebrochen.'); }
        e.stopImmediatePropagation();
        e.preventDefault();
        return;
      }
      if (e.key === 'Escape' && self.TOOLS[self.tool].draw) {
        self.setTool('select');
        e.stopImmediatePropagation();
        return;
      }
      if (self.draft && self.draft.type === 'polygon' && (e.key === 'Backspace' || e.key === 'Delete')) {
        self.undoPoint();
        e.preventDefault();
        return;
      }
      if (self.draft && self.draft.type === 'polygon' && e.key === 'Enter') {
        self.finishPolygon();
        e.preventDefault();
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        self.deleteSelected();
        e.preventDefault();
        return;
      }
      if (mod && (e.key === 'd' || e.key === 'D')) {
        self.duplicateSelected();
        e.preventDefault();
        return;
      }
      if (mod && !e.shiftKey && (e.key === 'g' || e.key === 'G')) {
        MF.tree.groupSelected();
        e.preventDefault();
        return;
      }

      // Werkzeuge: V = Auswählen, M = Verschieben, D = Drehen
      if (!mod && !e.altKey) {
        var key = e.key.toLowerCase();
        for (var tool in self.TOOLS) {
          if (self.TOOLS[tool].key === key) { self.setTool(tool); e.preventDefault(); return; }
        }
      }

      // Pfeiltasten im Strukturbaum navigieren dort; sonst verschieben sie den Körper
      var dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (dirs[e.key] && !mod && !(t.closest && t.closest('[role="tree"]'))) {
        var step = self.snapStep() * (e.shiftKey ? 10 : 1);
        if (self.nudgeSelected(dirs[e.key][0] * step, dirs[e.key][1] * step)) e.preventDefault();
      }
    });
  }
};
