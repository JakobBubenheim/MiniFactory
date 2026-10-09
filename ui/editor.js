// Editor: Bedienung der Fläche mit Maus und Tastatur.
// - Vorlagen aus dem Katalog (Ribbon "Komponenten") auf die Fläche ziehen; ein
//   einfacher Klick legt den Körper in die Mitte der Ansicht.
// - Werkzeuge im Ribbon "Modell" (Kürzel V / M / D):
//   Auswählen  – Klick wählt aus, Ziehen verschiebt die Ansicht
//   Verschieben – Körper ziehen
//   Drehen     – Klick dreht den Körper um 90° im Uhrzeigersinn (um seine Lage),
//                Ziehen dreht ihn frei um seine Lage (Winkel-Fangen, Alt = 0,1°) –
//                dieselbe Rechnung wie der Dreh-Griff (MF.snap.dragAngle)
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
//   settings.snap.angle (z. B. 5°); aus: 1 cm. Objektfang (Kürzel O): Ecken, Mitten,
//   Kanten, Bandenden und Flucht anderer Körper beim Verschieben, Einfügen, Zeichnen
//   und an den Griffen, mit Marker und Text in der Statusleiste. Alt hält beides beim
//   Ziehen und Zeichnen vorübergehend aus. Gefangen wird nur über MF.snap (sim/snap.js).
// - Löschen mit Entf/Rücktaste, Duplizieren mit Strg/Cmd+D, Strg/Cmd+G packt
//   die im Strukturbaum ausgewählten Einträge in einen neuen Ordner,
//   Pfeiltasten verschieben um einen Fangschritt (mit Shift um zehn).
// - Freie Fläche ziehen verschiebt die Ansicht, Mausrad zoomt.
// Einfügen, Löschen und Duplizieren sind gesperrt, solange die Simulation läuft.
window.MF = window.MF || {};

MF.editor = {
  DRAG_START_PX: 4,   // erst ab dieser Mausbewegung zählt es als Ziehen
  tool: 'select',     // 'select' | 'move' | 'rotate' | 'rect' | 'circle' | 'polygon'
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

  // Fangen und Objektfang gehören zur Anlage (settings.snap.on/obj), werden aber nicht
  // als Änderung gezählt und sind kein Schritt im Verlauf
  get snap() { return MF.model.settings.snap.on !== false; },
  get objSnap() { return MF.model.settings.snap.obj !== false; },

  toggleSnap: function () {
    MF.model.settings.snap.on = !this.snap;
    this.switched();
    MF.props.render();   // Schrittweite der X/Y-Felder
    MF.ui.message(this.snap ? 'Fangen an: Schritte von ' + MF.props.formatNumber(this.snapStep() * 100) + ' cm.'
      : 'Fangen aus: Schritte von 1 cm.');
  },

  toggleObjSnap: function () {
    MF.model.settings.snap.obj = !this.objSnap;
    this.switched();
    MF.ui.message(this.objSnap ? 'Objektfang an: Ecken, Mitten, Kanten und Bandenden anderer Körper rasten ein (Alt hält aus).'
      : 'Objektfang aus.');
  },

  // Schalter umgelegt: Ribbon anzeigen, beim nächsten Autosave mitspeichern
  switched: function () {
    MF.ui.syncToggles();
    if (MF.file.scheduleAutosave) MF.file.scheduleAutosave();
  },

  // Schrittweite für Lagen in Metern (Verschieben, Pfeiltasten, Panel)
  snapStep: function () { return MF.snap.step(MF.model.settings.snap, false, MF.snap.FREE_MOVE); },

  // Lage auf das Fangraster bzw. auf 1 cm; off (Alt gedrückt): auf 1 mm
  snapValue: function (v, off) { return MF.snap.len(v, MF.model.settings.snap, off, MF.snap.FREE_MOVE); },

  // Fangziele für eine Bedienung; skip = gezogener Körper (er und seine Kinder sind keine Ziele)
  snapContext: function (skip) {
    return MF.snap.context({
      snap: MF.model.settings.snap, bodies: MF.model.bodies, skip: skip || null, scale: MF.sim.pxPerM(),
      poseOf: function (b) { return b.kind === 'dynamic' ? MF.poseInWorld(b) : MF.sim.drawPose(b); }
    });
  },

  // Marker am Fangpunkt zeigen (hit von MF.snap oder null), Text in die Statusleiste
  showSnap: function (hit) {
    MF.sim.snapMark = hit;
    var text = hit ? hit.text : '';
    if (text && text !== this.snapText) MF.ui.message('Objektfang: ' + text + '.');
    this.snapText = text;
  },
  snapText: '',

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
  // Auf 0,1° genau (MF.setRotation), unabhängig vom Fangen.
  setRotation: function (b, rot) {
    if (MF.snap.angle(rot, null, true) === b.pose.rot) return false;
    if (b.look.locked) { MF.ui.message(b.name + ' ist gesperrt.'); return false; }
    MF.setRotation(b, rot);
    MF.store.changed();
    return true;
  },

  rotateBody: function (b) {
    if (this.setRotation(b, b.pose.rot + 90)) {
      MF.ui.message(b.name + ' auf ' + MF.props.formatNumber(b.pose.rot) + '° gedreht' + this.dirText(b) + '.');
    }
  },

  // ", läuft nach unten (90°)" bzw. ", schiebt nach 37,5°" – leer ohne Eigenschaft Richtung
  dirText: function (b) {
    if (!MF.propDef(b, 'direction')) return '';
    var d = MF.getProp(b, 'direction'), n = MF.dirName(d);
    return (b.surface ? ', läuft nach ' : ', schiebt nach ') +
      (n ? n + ' (' + MF.props.formatNumber(d) + '°)' : MF.props.formatNumber(d) + '°');
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

  // Lage (in Metern, gefangen) für einen neuen Körper aus der Vorlage type mit Mitte
  // unter (px, py): { x, y, z?, hit }. off = Alt gedrückt.
  posFor: function (type, px, py, off) {
    var w = MF.sim.toWorld(px, py), b = MF.bodyFromTemplate(type, w.x, w.y);
    return MF.snap.moveBody(this.snapContext(null), b, null, { model: w, world: w }, off, MF.snap.FREE_MOVE);
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
      MF.sim.ghost = p.inside ? self.ghostFor(type, p, ev.altKey) : null;
      self.showSnap(MF.sim.ghost && MF.sim.ghost.hit);
      MF.sim.draw();
    }

    function up(ev) {
      var p = self.canvasPos(ev);
      if (chip) {
        if (p.inside) self.place(type, self.posFor(type, p.x, p.y, ev.altKey));
        else MF.ui.message('Abgebrochen – zum Einfügen auf die Fläche ziehen.');
      } else if (self.canEdit()) {
        // Einfacher Klick: in die Mitte der Ansicht legen
        self.place(type, self.posFor(type, MF.sim.width / 2, MF.sim.height / 2, false));
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
      self.showSnap(null);
      MF.sim.draw();
    }

    btn.addEventListener('pointermove', move);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', end);
  },

  ghostFor: function (type, p, off) {
    var c = this.posFor(type, p.x, p.y, off);
    return { template: type, x: c.x, y: c.y, z: c.z, hit: c.hit };
  },

  // Einfügen ist ein Schritt im Verlauf, auch wenn der Objektfang die Höhe setzt
  place: function (type, pos) {
    MF.history.end();
    MF.history.begin();
    var b = MF.store.createBody(type, pos.x, pos.y, this.currentParent('plant'));
    if (pos.z !== undefined) { b.pose.z = pos.z; MF.store.changed(); }
    MF.history.end();
    MF.ui.message(b.name + ' (' + b.id + ') eingefügt' + (pos.hit ? ', ' + pos.hit.text : '') + '.');
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
    var snap = MF.model.settings.snap, off = e.altKey, ch = {}, label, S = MF.snap;
    var l = G.toLocal(drag.rest0, w.x, w.y), o = ax.origin;
    var unit = MF.axisUnit(ax).pos;
    if (part === 'origin') {
      var q = S.gridPoint(l.x, l.y, snap, off);
      ch.origin = [q.x, q.y, o[2]];
      label = 'Ursprung ' + this.fmtLen(q.x) + ' | ' + this.fmtLen(q.y) + ' m';
    } else if (part === 'dir') {
      var deg = S.angle(Math.atan2(l.y - o[1], l.x - o[0]) * 180 / Math.PI, snap, off), d = G.dirVec(deg);
      ch.dir = [d.x, d.y, 0];
      label = 'Richtung ' + MF.props.formatNumber(deg) + '°';
    } else if (ax.type === 'rotary') {
      // Winkel ab der lokalen x-Achse, stetig fortgesetzt (Grenzen auch über ±180°)
      var sign = ax.dir[2] < 0 ? -1 : 1, prev = ax[part];
      var a = sign * Math.atan2(l.y - o[1], l.x - o[0]) * 180 / Math.PI;
      a += 360 * Math.round((prev - a) / 360);
      ch[part] = S.angleValue(a, snap, off);
    } else {
      var d0 = ax.dir, len = Math.sqrt(d0[0] * d0[0] + d0[1] * d0[1] + d0[2] * d0[2]) || 1;
      var ux = d0[0] / len, uy = d0[1] / len;
      ch[part] = S.len(((l.x - o[0]) * ux + (l.y - o[1]) * uy) / (ux * ux + uy * uy), snap, off);
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
    var b = drag.el, h = drag.h, pose = drag.pose0, sh = drag.shape0, G = MF.geom, S = MF.snap;
    var snap = MF.model.settings.snap, off = e.altKey;
    var step = S.step(snap, off), ch = {}, label, hit = null;
    var w0 = w;
    w = this.modelPoint(drag.draw0, pose, w);   // Achse, Kopplung: zurück ins Koordinatensystem der Lage
    // Objektfang an Größe, Radius und Punkten: Maße folgen dem gefangenen Punkt genau,
    // sonst fängt das Raster die Maße (wie ohne Objektfang)
    var q = h.kind === 'rotate' ? null : S.point(drag.snapCtx, w0, off, { draw: drag.draw0, pose: pose });
    var exact = q && q.locked;
    function len(v) { return exact ? G.round6(v) : S.len(v, snap, off); }
    if (exact) { w = q; hit = q.hit; }
    if (h.kind === 'rotate') {
      // Griff: angefasst über der lokalen Oberkante (−y); Werkzeug Drehen: dort, wo geklickt wurde
      var from = h.from || G.toWorld(pose, 0, -1);
      ch.rot = S.dragAngle(pose.rot, pose, from, w, snap, off);
      label = MF.props.formatNumber(ch.rot) + '°';
    } else if (h.kind === 'size') {
      var l = G.toLocal(pose, w.x, w.y), cx = 0, cy = 0;
      ch.w = sh.w; ch.d = sh.d;
      if (h.sx) {
        var fx = -h.sx * sh.w / 2;
        ch.w = Math.max(step, len(h.sx * (l.x - fx)));
        cx = fx + h.sx * ch.w / 2;
      }
      if (h.sy) {
        var fy = -h.sy * sh.d / 2;
        ch.d = Math.max(step, len(h.sy * (l.y - fy)));
        cy = fy + h.sy * ch.d / 2;
      }
      var c = G.toWorld(pose, cx, cy);
      ch.x = G.round6(c.x); ch.y = G.round6(c.y);
      label = this.fmtLen(ch.w) + ' × ' + this.fmtLen(ch.d) + ' m';
    } else if (h.kind === 'radius') {
      ch.r = Math.max(step, len(Math.sqrt((w.x - pose.x) * (w.x - pose.x) + (w.y - pose.y) * (w.y - pose.y))));
      label = 'r ' + this.fmtLen(ch.r) + ' m';
    } else if (h.kind === 'vertex') {
      var lq = G.toLocal(pose, q.x, q.y);
      ch.points = sh.points.map(function (p) { return [p[0], p[1]]; });
      ch.points[h.i] = [G.round6(lq.x), G.round6(lq.y)];
      var n = ch.points.length, lens = G.edgeLengths(ch.points);
      label = this.fmtLen(lens[(h.i + n - 1) % n]) + ' m | ' + this.fmtLen(lens[h.i]) + ' m';
    }
    var err = MF.setForm(b, ch);
    var s = MF.sim.toScreen(w0.x, w0.y);
    this.showSnap(err ? null : hit);
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
      var mm = MF.snap.gridPoint(l.x, l.y, null, true);   // ohne Fangen: 1 mm
      pts.splice(e.i + 1, 0, [mm.x, mm.y]);
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

  // Gefangener Weltpunkt unter der Maus (Objektfang, sonst Raster). Alt = ohne Fangen.
  // Polygon mit Shift: Kante mit gefangenem Winkel und gefangener Länge ab dem letzten Punkt.
  drawPoint: function (p, e) {
    var w = MF.sim.toWorld(p.x, p.y), snap = MF.model.settings.snap;
    var d = this.draft;
    if (d && d.type === 'polygon' && e.shiftKey && d.points.length) {
      this.showSnap(null);
      return MF.snap.polar(d.points[d.points.length - 1], w, snap, e.altKey);
    }
    var q = MF.snap.point(this.snapContext(null), w, e.altKey);
    this.showSnap(q.hit);
    return { x: q.x, y: q.y };
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
    this.showSnap(null);
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
    this.showSnap(null);
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
      function handleDrag(b, hh) {
        return { mode: 'handle', el: b, h: hh, sx: p.x, sy: p.y, active: false,
          pose0: { x: b.pose.x, y: b.pose.y, z: b.pose.z, rot: b.pose.rot },
          shape0: JSON.parse(JSON.stringify(b.shape)),
          draw0: MF.sim.drawPose(b), rest0: MF.sim.restDrawPose(b),
          axis0: b.axis ? JSON.parse(JSON.stringify(b.axis)) : null, snapCtx: self.snapContext(b.id) };
      }
      if (h) {
        drag = handleDrag(sel, h);
        canvas.setPointerCapture(e.pointerId);
        return;
      }

      var hit = e.button === 0 ? MF.sim.hitTest(p.x, p.y) : null;
      // Klick auf eine Kante des gewählten Polygons (Doppelklick fügt dort einen Punkt
      // ein) behält die Auswahl, auch wenn er knapp außerhalb liegt
      if (sel && sel.shape.type === 'polygon' && self.handlesFor(sel) && self.edgeAt(sel, p)) hit = sel;
      if (e.button === 0) MF.store.select(hit ? hit.id : null);

      if (hit && self.tool === 'rotate') {
        // Werkzeug Drehen: Klick dreht um 90°, Ziehen frei – wie der Dreh-Griff, angefasst am Klickpunkt
        drag = handleDrag(hit, { kind: 'rotate' });
        drag.h.from = self.modelPoint(drag.draw0, drag.pose0, MF.sim.toWorld(p.x, p.y));
        drag.rotateTool = true;
      } else if (hit && self.tool === 'move') {
        var dp = MF.sim.drawPose(hit), p0 = { x: hit.pose.x, y: hit.pose.y, z: hit.pose.z, rot: hit.pose.rot };
        var w = self.modelPoint(dp, p0, MF.sim.toWorld(p.x, p.y));
        drag = { mode: 'move', el: hit, wx: w.x, wy: w.y, ox: hit.pose.x, oy: hit.pose.y, oz: hit.pose.z, sx: p.x, sy: p.y, active: false,
          draw0: dp, pose0: p0, mx: MF.sim.toWorld(p.x, p.y), snapCtx: self.snapContext(hit.id) };
      } else {
        // Ansicht ziehen – auch über Körpern, damit Auswählen nichts verschiebt.
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

      // Zeichenwerkzeug vor dem ersten Punkt: zeigen, wo er einrasten würde
      if (!drag && self.TOOLS[self.tool].draw) {
        var had = !!MF.sim.snapMark;
        self.drawPoint(p, e);
        if (had || MF.sim.snapMark) MF.sim.draw();
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
        if ((drag.mode === 'move' || drag.rotateTool) && drag.el.look.locked) { MF.ui.message(drag.el.name + ' ist gesperrt.'); drag = null; return; }
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
      var mw = w;
      w = self.modelPoint(drag.draw0, drag.pose0, w);   // gekoppelt oder gedreht: im Koordinatensystem der Lage

      // Lage ohne Fangen – im Koordinatensystem der Lage und in der Welt –, dann fangen
      var raw = { model: { x: drag.ox + (w.x - drag.wx), y: drag.oy + (w.y - drag.wy) },
        world: { x: drag.draw0.x + (mw.x - drag.mx.x), y: drag.draw0.y + (mw.y - drag.mx.y) } };
      var r = MF.snap.moveBody(drag.snapCtx, drag.el, { draw: drag.draw0, pose: drag.pose0 }, raw, e.altKey, MF.snap.FREE_MOVE);
      var nz = r.z !== undefined ? r.z : drag.oz;
      drag.hit = r.hit;
      self.showSnap(r.hit);
      if (r.x !== drag.el.pose.x || r.y !== drag.el.pose.y || nz !== drag.el.pose.z) {
        drag.el.pose.x = r.x;
        drag.el.pose.y = r.y;
        drag.el.pose.z = nz;
        MF.store.changed();
      } else MF.sim.draw();
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
        drag.el.pose.z = drag.oz;
      }
      MF.store.changed();
      MF.history.end();
      MF.sim.editLabel = null;
      self.showSnap(null);
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
          (drag.el.pose.x !== drag.ox || drag.el.pose.y !== drag.oy || drag.el.pose.z !== drag.oz)) {
        MF.ui.message(drag.el.name + ' nach x ' + MF.props.formatNumber(drag.el.pose.x) +
          ' m, y ' + MF.props.formatNumber(drag.el.pose.y) + ' m verschoben' +
          (drag.hit ? ', ' + drag.hit.text : '') + '.');
      }
      if (drag && drag.mode === 'handle' && drag.active) {
        var b = drag.el, sh = b.shape, ax = b.axis, u = ax ? ' ' + MF.axisUnit(ax).pos : '';
        var what = drag.h.kind === 'axis' ? (drag.h.part === 'origin' ? 'Achsursprung verschoben'
            : drag.h.part === 'dir' ? 'Achsrichtung geändert'
            : 'Achse ' + MF.props.formatNumber(ax.min) + ' … ' + MF.props.formatNumber(ax.max) + u)
          : drag.h.kind === 'rotate' ? 'auf ' + MF.props.formatNumber(b.pose.rot) + '° gedreht' + self.dirText(b)
          : drag.h.kind === 'vertex' ? 'Punkt ' + (drag.h.i + 1) + ' verschoben'
          : sh.type === 'circle' ? 'Radius ' + self.fmtLen(sh.r) + ' m'
          : 'Größe ' + self.fmtLen(sh.w) + ' × ' + self.fmtLen(sh.d) + ' m';
        MF.ui.message(b.name + ': ' + what + (drag.err ? ' (' + drag.err + ')' : '') + '.');
      }
      if (drag && drag.active && (drag.mode === 'handle' || drag.mode === 'move')) MF.history.end();
      if (drag && drag.rotateTool && !drag.active && e.type === 'pointerup') {
        self.rotateBody(drag.el);
      }
      drag = null;
      var marked = !!MF.sim.snapMark && !self.TOOLS[self.tool].draw;
      if (marked) self.showSnap(null);
      if (MF.sim.editLabel || marked) { MF.sim.editLabel = null; MF.sim.draw(); }
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
      if (drag) return;
      MF.ui.setCursor(null);
      if (MF.sim.snapMark && !self.draft) { self.showSnap(null); MF.sim.draw(); }
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
    el.pose.x = MF.geom.round6(el.pose.x + dx);
    el.pose.y = MF.geom.round6(el.pose.y + dy);
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

      // Werkzeuge: V = Auswählen, M = Verschieben, D = Drehen; O = Objektfang an/aus
      if (!mod && !e.altKey) {
        var key = e.key.toLowerCase();
        if (key === 'o') { self.toggleObjSnap(); e.preventDefault(); return; }
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
