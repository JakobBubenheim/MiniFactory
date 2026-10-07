// Sim: Zeichenfläche. Zeichnet Raster und Elemente, findet Elemente unter der Maus.
window.MF = window.MF || {};

MF.sim = {
  GRID: 40,            // Kantenlänge einer Rasterzelle in Pixeln bei 100 %
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

  cellSize: function () { return this.GRID * this.zoom; },

  // Bildschirmpixel -> Rasterkoordinaten (Kommazahl)
  toWorld: function (px, py) {
    var c = this.cellSize();
    return { x: (px - this.offsetX) / c, y: (py - this.offsetY) / c };
  },

  cellAt: function (px, py) {
    var w = this.toWorld(px, py);
    return { x: Math.floor(w.x), y: Math.floor(w.y) };
  },

  // Sichtbares Element unter dem Mauszeiger, sonst null. Liegen mehrere
  // übereinander (z. B. Lichtschranke auf Band), gewinnt das kleinste.
  hitTest: function (px, py) {
    var w = this.toWorld(px, py);
    var best = null;
    MF.model.elements.forEach(function (el) {
      if (!el.visible) return;
      if (w.x >= el.x && w.x < el.x + el.w && w.y >= el.y && w.y < el.y + el.h) {
        if (!best || el.w * el.h <= best.w * best.h) best = el;
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
    var c = this.cellSize();
    this.offsetX = cx - before.x * c;
    this.offsetY = cy - before.y * c;
    this.draw();
  },

  // Alle Elemente mit etwas Rand in die Fläche einpassen.
  fit: function () {
    var els = MF.model.elements;
    if (!els.length) { this.zoom = 1; this.offsetX = this.offsetY = 0; this.draw(); return; }
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    els.forEach(function (el) {
      minX = Math.min(minX, el.x); minY = Math.min(minY, el.y);
      maxX = Math.max(maxX, el.x + el.w); maxY = Math.max(maxY, el.y + el.h);
    });
    var pad = 2;
    var zx = this.width / ((maxX - minX + pad * 2) * this.GRID);
    var zy = this.height / ((maxY - minY + pad * 2) * this.GRID);
    this.zoom = Math.max(0.25, Math.min(2, Math.min(zx, zy)));
    var c = this.cellSize();
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

    var c = this.cellSize();
    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(c, c);
    var self = this;
    MF.model.elements.forEach(function (el) {
      if (el.visible) self.drawElement(el);
    });
    this.drawBoxes();
    this.drawGhost();
    ctx.restore();

    if (this.showTags) this.drawTags();
    this.drawSelection();
  },

  drawGrid: function () {
    var ctx = this.ctx;
    var c = this.cellSize();
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

  // Zeichnet ein Element in Rasterkoordinaten (1 Einheit = 1 Zelle).
  // Gedrehte Elemente werden um ihre Mitte gedreht und dann in Grundstellung
  // gezeichnet: Band nach rechts, Strahl senkrecht, Schieber drückt nach unten.
  drawElement: function (el) {
    var ctx = this.ctx;
    var rot = el.type === 'pusher' ? 0 : el.rot || 0;   // Schieber dreht sich selbst nach Schubrichtung
    var turned = rot % 180 !== 0;
    var w = turned ? el.h : el.w, h = turned ? el.w : el.h;   // Maße ohne Drehung
    var x = -w / 2, y = -h / 2;
    var lw = 1.5 / this.cellSize(); // Linienstärke ~1,5 px

    ctx.save();
    ctx.translate(el.x + el.w / 2, el.y + el.h / 2);
    if (rot) ctx.rotate(rot * Math.PI / 180);

    ctx.lineWidth = lw;
    ctx.strokeStyle = '#1B2430';

    switch (el.type) {
      case 'source':
        ctx.fillStyle = el.color;
        ctx.fillRect(x + 0.1, y + 0.1, w - 0.2, h - 0.2);
        ctx.fillStyle = '#F4F2EC';
        ctx.beginPath();
        ctx.moveTo(x + 0.35, y + 0.3);
        ctx.lineTo(x + 0.7, y + 0.5);
        ctx.lineTo(x + 0.35, y + 0.7);
        ctx.closePath();
        ctx.fill();
        break;

      case 'conveyor':
        ctx.fillStyle = el.color;
        ctx.fillRect(x, y + 0.15, w, h - 0.3);
        // Querstreifen wandern mit dem Band. Richtung relativ zur Drehung:
        // normalerweise 0° (vorwärts); 180°, falls Richtung und Drehung abweichen
        var shift = 0;
        var rel = (MF.rotForDir('conveyor', el.props.direction) - rot + 360) % 360;
        var dirSign = rel === 180 ? -1 : rel === 0 ? 1 : 0;
        if (dirSign) {
          var rt = el.rt || {};
          var travel = rt.travel || 0;
          var prev = rt.prevTravel !== undefined ? rt.prevTravel : travel;
          var cells = prev + (travel - prev) * MF.engine.alpha();
          shift = ((cells * dirSign) % 0.5 + 0.5) % 0.5;
        }
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y + 0.15, w, h - 0.3);
        ctx.clip();
        ctx.strokeStyle = 'rgba(244, 242, 236, 0.35)';
        ctx.beginPath();
        for (var i = shift; i < w; i += 0.5) {
          ctx.moveTo(x + i, y + 0.2);
          ctx.lineTo(x + i, y + h - 0.2);
        }
        ctx.stroke();
        ctx.restore();
        // Laufrichtung; grau, wenn der Antrieb aus ist
        ctx.fillStyle = MF.engine.beltOn(el) ? '#D9701A' : '#8A93A0';
        var mid = y + h / 2;
        ctx.beginPath();
        if (dirSign < 0) {
          ctx.moveTo(x + 0.45, mid - 0.15);
          ctx.lineTo(x + 0.2, mid);
          ctx.lineTo(x + 0.45, mid + 0.15);
        } else {
          ctx.moveTo(x + w - 0.45, mid - 0.15);
          ctx.lineTo(x + w - 0.2, mid);
          ctx.lineTo(x + w - 0.45, mid + 0.15);
        }
        ctx.closePath();
        ctx.fill();
        break;

      case 'sensor':
        // Sender oben, Empfänger unten, Strahl quer über das Band
        ctx.fillStyle = el.color;
        ctx.fillRect(x + 0.35, y - 0.25, 0.3, 0.25);
        ctx.fillRect(x + 0.35, y + h, 0.3, 0.25);
        ctx.strokeStyle = '#D9701A';
        ctx.setLineDash([0.08, 0.06]);
        ctx.beginPath();
        ctx.moveTo(x + 0.5, y);
        ctx.lineTo(x + 0.5, y + h);
        ctx.stroke();
        ctx.setLineDash([]);
        break;

      case 'pusher':
        // Gezeichnet für Schubrichtung "unten" und passend gedreht.
        // Platte an der Zellkante, ausgefahren um rt.pos (interpoliert wie die Kisten).
        var eng = MF.engine;
        var dir = eng.pusherDir(el);
        var prt = el.rt || {};
        var pos = prt.pos || 0;
        var prevPos = prt.prevPos !== undefined ? prt.prevPos : pos;
        var ext = (prevPos + (pos - prevPos) * eng.alpha()) / MF.model.settings.cellM;
        var half = (dir[0] !== 0 ? w : h) / 2;
        var pw = eng.PLATE_W, pt = eng.PLATE;
        ctx.save();
        ctx.translate(x + w / 2, y + h / 2);
        ctx.rotate(Math.atan2(-dir[0], dir[1]));
        ctx.fillStyle = '#9AA3AE';
        ctx.fillRect(-0.35, -0.45, 0.7, 0.55);
        ctx.strokeRect(-0.35, -0.45, 0.7, 0.55);
        // Stange und Platte hell mit Rand, damit sie auch über dem Band sichtbar sind
        ctx.fillStyle = '#9AA3AE';
        ctx.fillRect(-0.05, 0.1, 0.1, half - pt - 0.1 + ext);   // Stange
        ctx.strokeRect(-0.05, 0.1, 0.1, half - pt - 0.1 + ext);
        ctx.fillStyle = el.color;
        ctx.fillRect(-pw / 2, half - pt + ext, pw, pt);         // Platte
        ctx.strokeStyle = '#F4F2EC';
        ctx.strokeRect(-pw / 2, half - pt + ext, pw, pt);
        ctx.restore();
        break;

      case 'sink':
        ctx.fillStyle = 'rgba(27, 36, 48, 0.08)';
        ctx.fillRect(x + 0.1, y + 0.1, w - 0.2, h - 0.2);
        ctx.lineWidth = lw * 2;
        ctx.strokeStyle = el.color;
        ctx.strokeRect(x + 0.1, y + 0.1, w - 0.2, h - 0.2);
        ctx.beginPath();
        ctx.moveTo(x + 0.25, y + 0.25); ctx.lineTo(x + w - 0.25, y + h - 0.25);
        ctx.moveTo(x + w - 0.25, y + 0.25); ctx.lineTo(x + 0.25, y + h - 0.25);
        ctx.lineWidth = lw;
        ctx.stroke();
        break;
    }
    ctx.restore();
  },

  // Vorschau beim Ziehen aus der Bibliothek: halbtransparent mit Rahmen
  ghost: null,   // { type, x, y, w, h } in Rasterzellen

  drawGhost: function () {
    var g = this.ghost;
    if (!g) return;
    var ctx = this.ctx;
    var t = MF.types[g.type];
    ctx.save();
    ctx.globalAlpha = 0.5;
    this.drawElement({ type: g.type, x: g.x, y: g.y, w: g.w, h: g.h, color: t.color, props: t.defaults });
    ctx.restore();
    ctx.strokeStyle = '#D9701A';
    ctx.lineWidth = 2 / this.cellSize();
    ctx.setLineDash([0.12, 0.08]);
    ctx.strokeRect(g.x, g.y, g.w, g.h);
    ctx.setLineDash([]);
  },

  // Kisten: zwischen alter und neuer Position interpoliert
  drawBoxes: function () {
    var ctx = this.ctx;
    var a = MF.engine.alpha();
    var s = MF.engine.BOX;
    var lw = 1.5 / this.cellSize();
    MF.engine.boxes.forEach(function (b) {
      var x = b.px + (b.x - b.px) * a - s / 2;
      var y = b.py + (b.y - b.py) * a - s / 2;
      ctx.fillStyle = '#C79A5B';
      ctx.fillRect(x, y, s, s);
      ctx.lineWidth = lw;
      ctx.strokeStyle = '#1B2430';
      ctx.strokeRect(x, y, s, s);
      // Klebeband
      ctx.fillStyle = 'rgba(27, 36, 48, 0.25)';
      ctx.fillRect(x + s / 2 - 0.04, y, 0.08, s);
    });
  },

  // Namen (IDs) der Elemente als kleine Schilder
  drawTags: function () {
    var ctx = this.ctx;
    var c = this.cellSize();
    var self = this;
    ctx.font = '600 10px ui-monospace, Menlo, monospace';
    ctx.textBaseline = 'middle';
    MF.model.elements.forEach(function (el) {
      if (!el.visible || el.type === 'conveyor' && el.w < 2) return;
      var tx = self.offsetX + el.x * c;
      var below = el.type === 'sensor' && (el.rot || 0) % 180 === 0;  // Empfänger ragt unten heraus
      var ty = self.offsetY + (el.y + el.h) * c + (below ? 0.25 * c + 3 : 3);
      var text = el.id;
      var tw = ctx.measureText(text).width + 8;
      ctx.fillStyle = 'rgba(27, 36, 48, 0.85)';
      ctx.fillRect(Math.round(tx), Math.round(ty), tw, 14);
      ctx.fillStyle = '#F4F2EC';
      ctx.fillText(text, Math.round(tx) + 4, Math.round(ty) + 7);
    });
  },

  // Orangefarbener Rahmen um das gewählte Element
  drawSelection: function () {
    var el = MF.store.findElement(MF.store.selectedId);
    if (!el || !el.visible) return;
    var ctx = this.ctx;
    var c = this.cellSize();
    var x = Math.round(this.offsetX + el.x * c) - 3.5;
    var y = Math.round(this.offsetY + el.y * c) - 3.5;
    var w = Math.round(el.w * c) + 7;
    var h = Math.round(el.h * c) + 7;
    ctx.strokeStyle = '#D9701A';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    // Griffe an den Ecken
    ctx.fillStyle = '#D9701A';
    [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].forEach(function (p) {
      ctx.fillRect(p[0] - 3, p[1] - 3, 6, 6);
    });
  }
};
