// Sim: Zeichenfläche (Draufsicht). Zeichnet Körper aus ihrem Grundriss (Rechteck,
// Kreis, Polygon) mit Lage und Drehung, dazu die Kisten aus der Physik, und findet
// Körper unter der Maus. Alle Längen in Metern; das Raster ist nur Zeichenhilfe.
// Dazu die Griffe des gewählten Körpers (drehen, Größe, Polygonpunkte) und die
// Vorschau beim Zeichnen neuer Formen mit Maßen (Werkzeuge in ui/editor.js).
window.MF = window.MF || {};

MF.sim = {
  SCALE: 80,           // Pixel je Meter bei 100 % (wie früher 40 px je 0,5-m-Zelle)
  GRID_M: 0.5,         // Abstand der feinen Rasterlinien; jede fünfte ist kräftiger
  zoom: 1,
  offsetX: 0,          // Verschiebung der Ansicht in Bildschirmpixeln
  offsetY: 0,
  showGrid: true,
  showTags: true,

  init: function (canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    var self = this;
    new ResizeObserver(function () { self.resize(); }).observe(canvas.parentElement);
    this.resize();
  },

  // Passt die Canvas-Größe an den Container an (scharf auf Retina-Displays).
  resize: function () {
    var rect = this.canvas.parentElement.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    this.width = rect.width;
    this.height = rect.height;
    this.dpr = dpr;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';
    this.draw();
  },

  // Pixel je Meter beim aktuellen Zoom
  pxPerM: function () { return this.SCALE * this.zoom; },

  // Bildschirmpixel -> Meter
  toWorld: function (px, py) {
    var c = this.pxPerM();
    return { x: (px - this.offsetX) / c, y: (py - this.offsetY) / c };
  },

  // Aktuelle Lage eines Körpers fürs Zeichnen: Achsen (auch die des Elternkörpers
  // bei Kopplung) zwischen zwei Schritten interpoliert, dynamisch aus der Physik.
  // Die 3D-Ansicht benutzt dieselbe Lage.
  drawPose: function (b) {
    if (!MF.engine.world) return MF.poseInWorld(b);
    if (b.kind === 'dynamic') return MF.engine.dynamicPose(b, MF.engine.alpha());
    var a = MF.engine.alpha();
    return MF.poseInWorld(b, function (x) {
      var rt = x.rt || {}, pos = MF.axisPos(x);
      var prev = rt.prevPos !== undefined && rt.axisType === x.axis.type ? rt.prevPos : pos;
      return prev + (pos - prev) * a;
    });
  },

  // Koordinatensystem der Achse beim Zeichnen: Lage des Körpers mit Achse in
  // Stellung 0 (Elternkörper in seiner gezeichneten Lage)
  restDrawPose: function (b) {
    var p = MF.parentBody(b);
    return p ? MF.composePose(this.drawPose(p), b.pose) : b.pose;
  },

  // Sichtbarer Körper unter dem Mauszeiger, sonst null. Liegen mehrere
  // übereinander (z. B. Lichtschranke auf Band), gewinnt der kleinste.
  hitTest: function (px, py) {
    var w = this.toWorld(px, py);
    var best = null, bestArea = Infinity, self = this;
    MF.model.bodies.forEach(function (b) {
      if (!b.look.visible) return;
      if (MF.geom.containsXY(b.shape, self.drawPose(b), w.x, w.y)) {
        var a = MF.geom.area(b.shape);
        if (a <= bestArea) { best = b; bestArea = a; }
      }
    });
    return best;
  },

  setZoom: function (z, cx, cy) {
    z = Math.max(0.25, Math.min(4, z));
    // Um den Punkt (cx, cy) herum zoomen, standardmäßig Mitte der Fläche
    if (cx === undefined) { cx = this.width / 2; cy = this.height / 2; }
    var before = this.toWorld(cx, cy);
    this.zoom = z;
    var c = this.pxPerM();
    this.offsetX = cx - before.x * c;
    this.offsetY = cy - before.y * c;
    this.draw();
  },

  // Alle Körper mit etwas Rand in die Fläche einpassen.
  fit: function () {
    if (!this.width) return;   // noch keine Zeichenfläche (z. B. in den Tests)
    var bs = MF.model.bodies;
    if (!bs.length) { this.zoom = 1; this.offsetX = this.offsetY = 0; this.draw(); return; }
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    bs.forEach(function (b) {
      var r = MF.geom.bounds(b.shape, MF.poseInWorld(b));
      minX = Math.min(minX, r.x0); minY = Math.min(minY, r.y0);
      maxX = Math.max(maxX, r.x1); maxY = Math.max(maxY, r.y1);
    });
    var pad = 1;
    var zx = this.width / ((maxX - minX + pad * 2) * this.SCALE);
    var zy = this.height / ((maxY - minY + pad * 2) * this.SCALE);
    this.zoom = Math.max(0.25, Math.min(2, Math.min(zx, zy)));
    var c = this.pxPerM();
    this.offsetX = this.width / 2 - ((minX + maxX) / 2) * c;
    this.offsetY = this.height / 2 - ((minY + maxY) / 2) * c;
    this.draw();
  },

  draw: function () {
    var ctx = this.ctx;
    if (!ctx) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    ctx.fillStyle = '#F4F2EC';
    ctx.fillRect(0, 0, this.width, this.height);

    if (this.showGrid) this.drawGrid();

    var c = this.pxPerM();
    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(c, c);
    var self = this;
    // Tiefer liegende Körper zuerst, Kisten darüber, Sensorstrahlen zuletzt
    var order = MF.model.bodies.filter(function (b) { return b.look.visible; });
    order = order.map(function (b, i) { return { b: b, i: i }; }).sort(function (a, b) {
      return a.b.pose.z - b.b.pose.z || a.i - b.i;
    });
    order.forEach(function (o) { self.drawBody(o.b, self.drawPose(o.b)); });
    this.drawBoxes();
    order.forEach(function (o) { if (o.b.sensor) self.drawBeam(o.b); });
    this.drawGhost();
    ctx.restore();

    if (this.showTags) this.drawTags();
    this.drawSelection();
    this.drawDraft();
    if (this.editLabel) this.drawLabel(this.editLabel.text, this.editLabel.x + 12, this.editLabel.y + 14);
  },

  editLabel: null,   // Maße beim Ziehen eines Griffs: { text, x, y } in Pixeln

  drawGrid: function () {
    var ctx = this.ctx;
    var c = this.pxPerM() * this.GRID_M;
    var self = this;

    function lines(step, color) {
      if (step < 6) return; // zu dicht, nicht zeichnen
      var startX = ((self.offsetX % step) + step) % step;
      var startY = ((self.offsetY % step) + step) % step;
      ctx.beginPath();
      for (var x = startX; x <= self.width; x += step) {
        ctx.moveTo(Math.round(x) + 0.5, 0);
        ctx.lineTo(Math.round(x) + 0.5, self.height);
      }
      for (var y = startY; y <= self.height; y += step) {
        ctx.moveTo(0, Math.round(y) + 0.5);
        ctx.lineTo(self.width, Math.round(y) + 0.5);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    lines(c, 'rgba(27, 36, 48, 0.08)');
    lines(c * 5, 'rgba(27, 36, 48, 0.20)');
  },

  // Grundriss als Pfad (lokale Koordinaten, Kontext schon auf die Lage gedreht)
  outlinePath: function (shape) {
    var ctx = this.ctx;
    ctx.beginPath();
    if (shape.type === 'circle') {
      ctx.arc(0, 0, shape.r, 0, 2 * Math.PI);
      return;
    }
    MF.geom.outline(shape).forEach(function (p, i) {
      if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
    });
    ctx.closePath();
  },

  // Halbe Ausdehnung des Grundrisses in lokaler x- bzw. y-Richtung
  halfExtent: function (shape) {
    if (shape.type === 'rect') return { x: shape.w / 2, y: shape.d / 2 };
    if (shape.type === 'circle') return { x: shape.r, y: shape.r };
    var ex = 0, ey = 0;
    shape.points.forEach(function (p) { ex = Math.max(ex, Math.abs(p[0])); ey = Math.max(ey, Math.abs(p[1])); });
    return { x: ex, y: ey };
  },

  // Ein Körper: Grundriss je nach Körperart, darauf Zeichen seiner Funktionen.
  // ghost = durchscheinend mit gestricheltem Rand, static = voll, kinematic = voll mit hellem Rand.
  drawBody: function (b, pose) {
    var ctx = this.ctx, sh = b.shape;
    var lw = 1.5 / this.pxPerM();   // Linienstärke ~1,5 px
    ctx.save();
    ctx.translate(pose.x, pose.y);
    if (pose.rot) ctx.rotate(pose.rot * Math.PI / 180);
    ctx.lineWidth = lw;

    this.outlinePath(sh);
    if (b.kind === 'ghost') {
      ctx.globalAlpha = b.spawner ? 0.55 : 0.12;
      ctx.fillStyle = b.sink ? '#1B2430' : b.look.color;
      if (b.spawner || b.sink) ctx.fill();
      ctx.globalAlpha = 1;
      if (b.sink || !b.sensor) {
        ctx.setLineDash(b.sink ? [] : [6 * lw, 4 * lw]);
        ctx.lineWidth = b.sink ? lw * 2 : lw;
        ctx.strokeStyle = b.look.color;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineWidth = lw;
      }
    } else {
      ctx.fillStyle = b.kind === 'kinematic' ? '#9AA3AE' : b.look.color;
      ctx.fill();
      ctx.strokeStyle = b.kind === 'kinematic' ? b.look.color : b.kind === 'dynamic' ? '#1B2430' : 'rgba(244, 242, 236, 0.5)';
      ctx.stroke();
    }

    if (MF.geom.isSloped(sh)) this.drawSlope(sh, lw);
    if (b.surface) this.drawSurface(b, sh, lw);
    if (b.spawner) this.drawSpawner(sh);
    if (b.sink) this.drawSink(sh, lw);
    ctx.restore();
  },

  // Transportfläche: Querstreifen wandern mit dem Band, Pfeil zeigt die Laufrichtung
  drawSurface: function (b, sh, lw) {
    var ctx = this.ctx;
    var e = this.halfExtent(sh);
    ctx.save();
    this.outlinePath(sh);
    ctx.clip();
    ctx.rotate(b.surface.dir * Math.PI / 180);   // ab hier läuft die Fläche nach +x
    var ex = Math.abs(Math.cos(b.surface.dir * Math.PI / 180)) > 0.5 ? e.x : e.y;
    var ey = ex === e.x ? e.y : e.x;
    var rt = b.rt || {};
    var travel = rt.travel || 0;
    var prev = rt.prevTravel !== undefined ? rt.prevTravel : travel;
    var shift = ((prev + (travel - prev) * MF.engine.alpha()) % 0.25 + 0.25) % 0.25;
    ctx.strokeStyle = 'rgba(244, 242, 236, 0.35)';
    ctx.lineWidth = lw;
    ctx.beginPath();
    for (var x = -ex + shift; x < ex; x += 0.25) {
      ctx.moveTo(x, -ey + 0.05);
      ctx.lineTo(x, ey - 0.05);
    }
    ctx.stroke();
    // Laufrichtung; grau, wenn die Fläche steht
    ctx.fillStyle = MF.engine.surfaceSpeed(b) > 0 ? '#D9701A' : '#8A93A0';
    var a = Math.min(0.15, ey * 0.6);
    ctx.beginPath();
    ctx.moveTo(ex - 0.1 - a * 1.6, -a);
    ctx.lineTo(ex - 0.1, 0);
    ctx.lineTo(ex - 0.1 - a * 1.6, a);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  },

  // Geneigte Oberseite: hoch = hell, tief = dunkel, Pfeil zeigt bergab
  drawSlope: function (sh, lw) {
    var ctx = this.ctx;
    var r = MF.geom.xRange(sh), down = sh.h2 < sh.h ? 1 : -1;
    var e = this.halfExtent(sh);
    ctx.save();
    this.outlinePath(sh);
    ctx.clip();
    var g = ctx.createLinearGradient(r.x0, 0, r.x1, 0);
    g.addColorStop(0, down > 0 ? 'rgba(255, 255, 255, 0.35)' : 'rgba(27, 36, 48, 0.35)');
    g.addColorStop(1, down > 0 ? 'rgba(27, 36, 48, 0.35)' : 'rgba(255, 255, 255, 0.35)');
    ctx.fillStyle = g;
    ctx.fillRect(r.x0, -e.y, r.x1 - r.x0, 2 * e.y);
    // Pfeil bergab durch die Mitte
    var len = (r.x1 - r.x0) * 0.3, a = Math.min(0.12, e.y * 0.5);
    var cx = (r.x0 + r.x1) / 2;
    ctx.strokeStyle = '#F4F2EC';
    ctx.fillStyle = '#F4F2EC';
    ctx.lineWidth = lw * 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - down * len, 0);
    ctx.lineTo(cx + down * (len - a), 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + down * len, 0);
    ctx.lineTo(cx + down * (len - a * 1.6), -a);
    ctx.lineTo(cx + down * (len - a * 1.6), a);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  },

  // Erzeuger: Dreieck "Abspielen" in der Mitte
  drawSpawner: function (sh) {
    var ctx = this.ctx;
    var e = this.halfExtent(sh), s = Math.min(e.x, e.y) * 0.5;
    ctx.fillStyle = '#F4F2EC';
    ctx.beginPath();
    ctx.moveTo(-s * 0.6, -s);
    ctx.lineTo(s, 0);
    ctx.lineTo(-s * 0.6, s);
    ctx.closePath();
    ctx.fill();
  },

  // Senke: Kreuz
  drawSink: function (sh, lw) {
    var ctx = this.ctx;
    var e = this.halfExtent(sh), x = e.x * 0.6, y = e.y * 0.6;
    ctx.strokeStyle = '#1B2430';
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(-x, -y); ctx.lineTo(x, y);
    ctx.moveTo(x, -y); ctx.lineTo(-x, y);
    ctx.stroke();
  },

  // Sensor: Sender und Empfänger an den Enden, Strahl gestrichelt durch die Länge
  drawBeam: function (b) {
    var ctx = this.ctx, pose = this.drawPose(b);
    var e = this.halfExtent(b.shape);
    var lw = 1.5 / this.pxPerM();
    ctx.save();
    ctx.translate(pose.x, pose.y);
    if (pose.rot) ctx.rotate(pose.rot * Math.PI / 180);
    if (e.x > e.y) ctx.rotate(Math.PI / 2);   // Strahl entlang der längeren Seite (jetzt y)
    var len = Math.max(e.x, e.y);
    ctx.fillStyle = b.look.color;
    ctx.fillRect(-0.075, -len - 0.125, 0.15, 0.125);
    ctx.fillRect(-0.075, len, 0.15, 0.125);
    var on = MF.engine.world && MF.engine.signal(b, 'Belegt');
    ctx.strokeStyle = on ? '#C0392B' : '#D9701A';
    ctx.lineWidth = lw * (on ? 2 : 1);
    ctx.setLineDash([0.04, 0.03]);
    ctx.beginPath();
    ctx.moveTo(0, -len);
    ctx.lineTo(0, len);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  },

  // Vorschau beim Ziehen aus dem Katalog: halbtransparent mit Rahmen
  ghost: null,   // { template, x, y } in Metern (Mitte)

  drawGhost: function () {
    var g = this.ghost;
    if (!g) return;
    var ctx = this.ctx;
    var b = MF.bodyFromTemplate(g.template, g.x, g.y);
    ctx.save();
    ctx.globalAlpha = 0.5;
    this.drawBody(b, b.pose);
    ctx.restore();
    var r = MF.geom.bounds(b.shape, b.pose);
    ctx.strokeStyle = '#D9701A';
    ctx.lineWidth = 2 / this.pxPerM();
    ctx.setLineDash([0.06, 0.04]);
    ctx.strokeRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
    ctx.setLineDash([]);
  },

  // Drehung um z aus einem Quaternion
  yawOf: function (q) {
    return Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));
  },

  // Kisten: zwischen den letzten beiden Physik-Schritten interpoliert, gedreht um z.
  // Höher liegende Kisten werfen einen Schatten und sind etwas heller.
  drawBoxes: function () {
    var ctx = this.ctx, self = this;
    var a = MF.engine.alpha();
    var lw = 1.5 / this.pxPerM();
    var list = MF.engine.boxes.map(function (bx) {
      var p = bx.prev, c = bx.cur;
      var y0 = self.yawOf(p.q), y1 = self.yawOf(c.q);
      var dy = Math.atan2(Math.sin(y1 - y0), Math.cos(y1 - y0));
      return { bx: bx, x: p.x + (c.x - p.x) * a, y: p.y + (c.y - p.y) * a, z: p.z + (c.z - p.z) * a, yaw: y0 + dy * a };
    }).sort(function (u, v) { return u.z - v.z; });
    list.forEach(function (k) {
      var w = k.bx.size[0], d = k.bx.size[1];
      var lift = Math.max(0, k.z - k.bx.size[2] / 2);
      ctx.save();
      // Schatten auf dem Boden, je höher, desto weiter versetzt
      if (lift > 0.005) {
        ctx.save();
        ctx.translate(k.x + lift * 0.08, k.y + lift * 0.12);
        ctx.rotate(k.yaw);
        ctx.fillStyle = 'rgba(27, 36, 48, 0.18)';
        ctx.fillRect(-w / 2, -d / 2, w, d);
        ctx.restore();
      }
      ctx.translate(k.x, k.y);
      ctx.rotate(k.yaw);
      ctx.fillStyle = k.bx.color;
      ctx.fillRect(-w / 2, -d / 2, w, d);
      if (lift > 0.005) {
        ctx.fillStyle = 'rgba(255, 255, 255, ' + Math.min(0.3, lift * 0.3).toFixed(3) + ')';
        ctx.fillRect(-w / 2, -d / 2, w, d);
      }
      ctx.lineWidth = lw;
      ctx.strokeStyle = '#1B2430';
      ctx.strokeRect(-w / 2, -d / 2, w, d);
      // Klebeband
      ctx.fillStyle = 'rgba(27, 36, 48, 0.25)';
      ctx.fillRect(-0.02, -d / 2, 0.04, d);
      ctx.restore();
    });
  },

  // Namen (IDs) der Körper als kleine Schilder unter der linken unteren Ecke
  drawTags: function () {
    var ctx = this.ctx;
    var c = this.pxPerM();
    var self = this;
    ctx.font = '600 10px ui-monospace, Menlo, monospace';
    ctx.textBaseline = 'middle';
    MF.model.bodies.forEach(function (b) {
      if (!b.look.visible) return;
      var r = MF.geom.bounds(b.shape, self.drawPose(b));
      if (b.surface && r.x1 - r.x0 < 1 && r.y1 - r.y0 < 1) return;
      var below = b.sensor ? 0.125 * c : 0;   // Empfänger ragt heraus
      var tx = self.offsetX + r.x0 * c;
      var ty = self.offsetY + r.y1 * c + below + 3;
      var text = b.id;
      var tw = ctx.measureText(text).width + 8;
      ctx.fillStyle = 'rgba(27, 36, 48, 0.85)';
      ctx.fillRect(Math.round(tx), Math.round(ty), tw, 14);
      ctx.fillStyle = '#F4F2EC';
      ctx.fillText(text, Math.round(tx) + 4, Math.round(ty) + 7);
    });
  },

  // Meter -> Bildschirmpixel
  toScreen: function (x, y) {
    var c = this.pxPerM();
    return { x: this.offsetX + x * c, y: this.offsetY + y * c };
  },

  // ---------- Griffe des gewählten Körpers ----------
  //
  // Liste in Bildschirmpixeln: { kind, x, y, … }
  //   rotate              – Drehgriff über der lokalen Oberkante (−y)
  //   size  (sx, sy)      – Rechteck: Ecken (sx, sy = ±1) und Kantenmitten (eins davon 0)
  //   radius              – Kreis: Radius auf der lokalen +x-Achse
  //   vertex (i)          – Polygonpunkt i
  ROTATE_PX: 26,     // Abstand des Drehgriffs vom Körper

  handles: function (b) {
    var self = this, pose = this.drawPose(b), sh = b.shape, out = [];
    function at(kind, lx, ly, extra) {
      var w = MF.geom.toWorld(pose, lx, ly), p = self.toScreen(w.x, w.y);
      var h = { kind: kind, x: p.x, y: p.y, lx: lx, ly: ly };
      for (var k in extra) h[k] = extra[k];
      out.push(h);
    }
    if (sh.type === 'rect') {
      [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]].forEach(function (s) {
        at('size', s[0] * sh.w / 2, s[1] * sh.d / 2, { sx: s[0], sy: s[1] });
      });
    } else if (sh.type === 'circle') {
      at('radius', sh.r, 0, {});
    } else {
      sh.points.forEach(function (p, i) { at('vertex', p[0], p[1], { i: i }); });
    }
    // Drehgriff: über der lokalen Oberkante, mit festem Abstand in Pixeln
    var top = -this.halfExtent(sh).y, up = MF.geom.toWorld({ x: 0, y: 0, rot: pose.rot }, 0, -1);
    var base = MF.geom.toWorld(pose, 0, top), bp = this.toScreen(base.x, base.y);
    out.push({ kind: 'rotate', x: bp.x + up.x * this.ROTATE_PX, y: bp.y + up.y * this.ROTATE_PX, bx: bp.x, by: bp.y });
    var g = this.axisGeom(b);
    if (g) g.handles.forEach(function (h) { out.push(h); });
    return out;
  },

  // ---------- Achse in der Draufsicht ----------
  //
  // Für den gewählten Körper mit Achse (Bildschirmpixel):
  //   linear in der Ebene: Linie vom Ursprung + min · Richtung bis + max · Richtung,
  //     Pfeil am Ende, Marke bei der aktuellen Stellung
  //   linear senkrecht (z): Kreis mit Punkt (hoch) bzw. Kreuz (runter) am Ursprung
  //   rotatorisch: Bogen um den Ursprung von min bis max, Zeiger auf der Stellung
  // Griffe { kind: 'axis', part: 'origin'|'min'|'max'|'dir' } zum Ziehen (ui/editor.js).
  AXIS_DIR_PX: 22,    // Richtungsgriff hinter dem Pfeil

  axisGeom: function (b) {
    if (!b || !MF.hasAxis(b)) return null;
    var self = this, ax = b.axis, rest = this.restDrawPose(b), pos = MF.axisPos(b);
    var rt = b.rt || {};
    if (MF.engine.world && rt.prevPos !== undefined && rt.axisType === ax.type) pos = rt.prevPos + (pos - rt.prevPos) * MF.engine.alpha();
    function scr(lx, ly) { var w = MF.geom.toWorld(rest, lx, ly); return self.toScreen(w.x, w.y); }
    var o = ax.origin, g = { type: ax.type, origin: scr(o[0], o[1]), handles: [] };
    g.handles.push({ kind: 'axis', part: 'origin', x: g.origin.x, y: g.origin.y });
    if (ax.type === 'rotary') {
      var sign = ax.dir[2] < 0 ? -1 : 1, r = 0;
      MF.geom.outline(b.shape).forEach(function (p) {
        r = Math.max(r, Math.sqrt((p[0] - o[0]) * (p[0] - o[0]) + (p[1] - o[1]) * (p[1] - o[1])));
      });
      g.r = r * this.pxPerM() + 14;
      g.sign = sign;
      // Winkel auf dem Bildschirm (y nach unten, wie die Welt): Drehung der Ruhelage + Stellung
      g.ang = function (s) { return MF.geom.rad(rest.rot + sign * s); };
      g.a0 = g.ang(ax.min); g.a1 = g.ang(ax.max); g.apos = g.ang(pos);
      [['min', ax.min], ['max', ax.max]].forEach(function (m) {
        var a = g.ang(m[1]);
        g.handles.push({ kind: 'axis', part: m[0], x: g.origin.x + g.r * Math.cos(a), y: g.origin.y + g.r * Math.sin(a) });
      });
      return g;
    }
    var d = ax.dir, len = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]) || 1;
    var ux = d[0] / len, uy = d[1] / len;
    g.vertical = Math.sqrt(ux * ux + uy * uy) < 0.01;
    g.up = d[2] > 0;
    if (g.vertical) return g;
    g.p0 = scr(o[0] + ux * ax.min, o[1] + uy * ax.min);
    g.p1 = scr(o[0] + ux * ax.max, o[1] + uy * ax.max);
    g.pp = scr(o[0] + ux * pos, o[1] + uy * pos);
    var e = scr(o[0] + ux, o[1] + uy), ex = e.x - g.origin.x, ey = e.y - g.origin.y, el = Math.sqrt(ex * ex + ey * ey) || 1;
    g.u = { x: ex / el, y: ey / el };   // Richtung auf dem Bildschirm
    g.handles.push({ kind: 'axis', part: 'min', x: g.p0.x, y: g.p0.y });
    g.handles.push({ kind: 'axis', part: 'max', x: g.p1.x, y: g.p1.y });
    g.handles.push({ kind: 'axis', part: 'dir', x: g.p1.x + g.u.x * this.AXIS_DIR_PX, y: g.p1.y + g.u.y * this.AXIS_DIR_PX });
    return g;
  },

  AXIS_COLOR: '#2F6FB0',

  drawAxis: function (b, withHandles) {
    var g = this.axisGeom(b);
    if (!g) return;
    var ctx = this.ctx, c = this.AXIS_COLOR, o = g.origin;
    ctx.save();
    ctx.strokeStyle = c;
    ctx.fillStyle = c;
    ctx.lineWidth = 1.5;
    if (g.type === 'rotary') {
      // Bogen von min nach max (in Richtung wachsender Stellung), Zeiger auf der Stellung
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(o.x, o.y, g.r, g.a0, g.a1, g.sign < 0);
      ctx.stroke();
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(o.x, o.y);
      ctx.lineTo(o.x + g.r * Math.cos(g.apos), o.y + g.r * Math.sin(g.apos));
      ctx.stroke();
      ctx.setLineDash([]);
      // Pfeilspitze am Ende max: zeigt, in welche Richtung die Stellung wächst
      var t = g.a1 + g.sign * Math.PI / 2, ex = o.x + g.r * Math.cos(g.a1), ey = o.y + g.r * Math.sin(g.a1);
      this.arrowHead(ex, ey, Math.cos(t), Math.sin(t), 7);
    } else if (g.vertical) {
      ctx.beginPath();
      ctx.arc(o.x, o.y, 9, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.beginPath();
      if (g.up) ctx.arc(o.x, o.y, 2.5, 0, 2 * Math.PI);
      else { ctx.moveTo(o.x - 5, o.y - 5); ctx.lineTo(o.x + 5, o.y + 5); ctx.moveTo(o.x + 5, o.y - 5); ctx.lineTo(o.x - 5, o.y + 5); }
      if (g.up) ctx.fill(); else ctx.stroke();
      var ax = b.axis, u = MF.axisUnit(ax).pos;
      this.drawLabel((g.up ? 'z ↑ ' : 'z ↓ ') + this.fmt(ax.min) + ' … ' + this.fmt(ax.max) + ' ' + u, o.x + 14, o.y - 9);
    } else {
      ctx.beginPath();
      ctx.moveTo(g.p0.x, g.p0.y);
      ctx.lineTo(g.p1.x, g.p1.y);
      ctx.stroke();
      // Querstriche an den Grenzen, Pfeil am Ende max
      [g.p0, g.p1].forEach(function (p) {
        ctx.beginPath();
        ctx.moveTo(p.x - g.u.y * 6, p.y + g.u.x * 6);
        ctx.lineTo(p.x + g.u.y * 6, p.y - g.u.x * 6);
        ctx.stroke();
      });
      this.arrowHead(g.p1.x + g.u.x * 10, g.p1.y + g.u.y * 10, g.u.x, g.u.y, 7);
      ctx.beginPath();
      ctx.arc(g.pp.x, g.pp.y, 3, 0, 2 * Math.PI);
      ctx.fill();
    }
    if (withHandles) {
      var hot = MF.editor && MF.editor.hotHandle;
      g.handles.forEach(function (h) {
        var on = hot && hot.kind === 'axis' && hot.part === h.part;
        ctx.fillStyle = on ? '#1B2430' : c;
        ctx.strokeStyle = '#F4F2EC';
        ctx.beginPath();
        if (h.part === 'origin') ctx.arc(h.x, h.y, 5, 0, 2 * Math.PI);
        else if (h.part === 'dir') { ctx.moveTo(h.x, h.y - 5); ctx.lineTo(h.x + 5, h.y); ctx.lineTo(h.x, h.y + 5); ctx.lineTo(h.x - 5, h.y); ctx.closePath(); }
        else ctx.rect(Math.round(h.x) - 4, Math.round(h.y) - 4, 8, 8);
        ctx.fill();
        ctx.stroke();
      });
    }
    ctx.restore();
  },

  // Zahl mit deutschem Komma, höchstens drei Nachkommastellen
  fmt: function (v) { return String(Math.round(v * 1000) / 1000).replace('.', ','); },

  // Gefüllte Pfeilspitze bei (x, y), zeigt in Richtung (ux, uy)
  arrowHead: function (x, y, ux, uy, size) {
    var ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + ux * size, y + uy * size);
    ctx.lineTo(x - ux * size * 0.6 - uy * size * 0.6, y - uy * size * 0.6 + ux * size * 0.6);
    ctx.lineTo(x - ux * size * 0.6 + uy * size * 0.6, y - uy * size * 0.6 - ux * size * 0.6);
    ctx.closePath();
    ctx.fill();
  },

  // Orangefarbener Rahmen um den gewählten Körper (Grundriss); mit Griffen, wenn
  // das Werkzeug sie anbietet und der Körper nicht gesperrt ist
  drawSelection: function () {
    var b = MF.store.findBody(MF.store.selectedId);
    if (!b || !b.look.visible) return;
    var ctx = this.ctx, self = this;
    var pose = this.drawPose(b);
    var pts = MF.geom.worldOutline(b.shape, pose).map(function (p) { return self.toScreen(p.x, p.y); });
    ctx.strokeStyle = '#D9701A';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);
    ctx.beginPath();
    pts.forEach(function (p, i) { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
    var withHandles = !!MF.editor && MF.editor.handlesFor(b);
    this.drawAxis(b, withHandles);
    if (!withHandles) return;
    var hot = MF.editor.hotHandle;
    this.handles(b).forEach(function (h) {
      if (h.kind === 'axis') return;   // schon mit der Achse gezeichnet
      var on = hot && hot.kind === h.kind && hot.sx === h.sx && hot.sy === h.sy && hot.i === h.i;
      ctx.fillStyle = on ? '#1B2430' : '#D9701A';
      ctx.strokeStyle = '#F4F2EC';
      ctx.lineWidth = 1.5;
      if (h.kind === 'rotate') {
        ctx.strokeStyle = '#D9701A';
        ctx.beginPath();
        ctx.moveTo(h.bx, h.by);
        ctx.lineTo(h.x, h.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(h.x, h.y, 5.5, 0, 2 * Math.PI);
        ctx.fill();
        ctx.strokeStyle = '#F4F2EC';
        ctx.stroke();
      } else if (h.kind === 'vertex') {
        ctx.beginPath();
        ctx.arc(h.x, h.y, 4.5, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillRect(Math.round(h.x) - 4, Math.round(h.y) - 4, 8, 8);
        ctx.strokeRect(Math.round(h.x) - 4, Math.round(h.y) - 4, 8, 8);
      }
    });
  },

  // ---------- Vorschau beim Zeichnen ----------
  //
  // draft (vom Editor gesetzt): { type: 'rect'|'circle'|'polygon', points: [{x, y}, …] in m,
  // cursor: {x, y} oder null, closing: Cursor auf dem Startpunkt, label: Maßtext, bad: ungültig }
  draft: null,

  drawDraft: function () {
    var d = this.draft;
    if (!d) return;
    var ctx = this.ctx, self = this;
    var pts = d.points.map(function (p) { return self.toScreen(p.x, p.y); });
    var cur = d.cursor ? this.toScreen(d.cursor.x, d.cursor.y) : null;
    var color = d.bad ? '#C0392B' : '#D9701A';
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = d.bad ? 'rgba(192, 57, 43, 0.12)' : 'rgba(217, 112, 26, 0.15)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (d.type === 'rect' && pts.length && cur) {
      ctx.rect(Math.min(pts[0].x, cur.x), Math.min(pts[0].y, cur.y), Math.abs(cur.x - pts[0].x), Math.abs(cur.y - pts[0].y));
      ctx.fill();
      ctx.stroke();
    } else if (d.type === 'circle' && pts.length && cur) {
      var r = Math.sqrt((cur.x - pts[0].x) * (cur.x - pts[0].x) + (cur.y - pts[0].y) * (cur.y - pts[0].y));
      ctx.arc(pts[0].x, pts[0].y, r, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      ctx.lineTo(cur.x, cur.y);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (d.type === 'polygon' && pts.length) {
      pts.forEach(function (p, i) { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
      if (cur) ctx.lineTo(cur.x, cur.y);
      if (pts.length > 1) { ctx.save(); ctx.closePath(); ctx.fill(); ctx.restore(); }
      ctx.stroke();
      pts.forEach(function (p, i) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, i === 0 && d.closing ? 7 : 3.5, 0, 2 * Math.PI);
        ctx.fillStyle = i === 0 && d.closing ? '#1B2430' : color;
        ctx.fill();
      });
    }
    // Fadenkreuz am (gefangenen) Mauspunkt
    if (cur) {
      ctx.strokeStyle = 'rgba(27, 36, 48, 0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cur.x - 6, cur.y); ctx.lineTo(cur.x + 6, cur.y);
      ctx.moveTo(cur.x, cur.y - 6); ctx.lineTo(cur.x, cur.y + 6);
      ctx.stroke();
    }
    if (d.label && cur) this.drawLabel(d.label, cur.x + 12, cur.y + 14, d.bad);
    ctx.restore();
  },

  // Kleines Schild mit Text (Maße beim Zeichnen und Bearbeiten), in Bildschirmpixeln
  drawLabel: function (text, x, y, bad) {
    var ctx = this.ctx;
    ctx.font = '600 11px ui-monospace, Menlo, monospace';
    ctx.textBaseline = 'middle';
    var w = ctx.measureText(text).width + 10;
    x = Math.min(x, this.width - w - 4);
    y = Math.min(y, this.height - 20);
    ctx.fillStyle = bad ? 'rgba(192, 57, 43, 0.92)' : 'rgba(27, 36, 48, 0.88)';
    ctx.fillRect(Math.round(x), Math.round(y), w, 18);
    ctx.fillStyle = '#F4F2EC';
    ctx.fillText(text, Math.round(x) + 5, Math.round(y) + 9);
  }
};
