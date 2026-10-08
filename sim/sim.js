// Sim: Zeichenfläche (Draufsicht). Zeichnet Körper aus ihrem Grundriss (Rechteck,
// Kreis, Polygon) mit Lage und Drehung, dazu die Kisten aus der Physik, und findet
// Körper unter der Maus. Alle Längen in Metern; das Raster ist nur Zeichenhilfe.
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

  // Aktuelle Lage eines Körpers fürs Zeichnen (kinematisch: Achse interpoliert)
  drawPose: function (b) {
    if (!b.axis || b.kind !== 'kinematic' || !MF.engine.world) return b.pose;
    var rt = b.rt || {};
    var pos = MF.engine.axisPos(b);
    var prev = rt.prevPos !== undefined ? rt.prevPos : pos;
    return MF.engine.worldPose(b, prev + (pos - prev) * MF.engine.alpha());
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
      var r = MF.geom.bounds(b.shape, b.pose);
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
  },

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
      ctx.strokeStyle = b.kind === 'kinematic' ? b.look.color : 'rgba(244, 242, 236, 0.5)';
      ctx.stroke();
    }

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

  // Orangefarbener Rahmen um den gewählten Körper (Grundriss) mit Griffen am Hüllrechteck
  drawSelection: function () {
    var b = MF.store.findBody(MF.store.selectedId);
    if (!b || !b.look.visible) return;
    var ctx = this.ctx, self = this;
    var c = this.pxPerM();
    var pose = this.drawPose(b);
    var pts = MF.geom.worldOutline(b.shape, pose).map(function (p) {
      return { x: self.offsetX + p.x * c, y: self.offsetY + p.y * c };
    });
    ctx.strokeStyle = '#D9701A';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);
    ctx.beginPath();
    pts.forEach(function (p, i) { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
    var r = MF.geom.bounds(b.shape, pose);
    var x0 = Math.round(this.offsetX + r.x0 * c) - 3.5, y0 = Math.round(this.offsetY + r.y0 * c) - 3.5;
    var x1 = Math.round(this.offsetX + r.x1 * c) + 3.5, y1 = Math.round(this.offsetY + r.y1 * c) + 3.5;
    ctx.fillStyle = '#D9701A';
    [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].forEach(function (p) {
      ctx.fillRect(p[0] - 3, p[1] - 3, 6, 6);
    });
  }
};
