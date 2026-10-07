// Sim: Zeichenfläche. Zeichnet Raster und Elemente, findet Elemente unter der Maus.
// Noch keine Bewegung – die Simulationsschleife kommt in Etappe 2.
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

  // Oberstes sichtbares Element unter dem Mauszeiger, sonst null.
  hitTest: function (px, py) {
    var w = this.toWorld(px, py);
    var els = MF.model.elements;
    for (var i = els.length - 1; i >= 0; i--) {
      var el = els[i];
      if (!el.visible) continue;
      if (w.x >= el.x && w.x < el.x + el.w && w.y >= el.y && w.y < el.y + el.h) return el;
    }
    return null;
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
  drawElement: function (el) {
    var ctx = this.ctx;
    var x = el.x, y = el.y, w = el.w, h = el.h;
    var lw = 1.5 / this.cellSize(); // Linienstärke ~1,5 px

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
        // Querstreifen wandern mit der Bandgeschwindigkeit (nur bei Laufrichtung rechts/links)
        var shift = 0;
        var dirSign = el.props.direction === 'links' ? -1 : el.props.direction === 'rechts' ? 1 : 0;
        if (dirSign) {
          var meters = this.simTime() * el.props.speed / MF.model.settings.cellM;
          shift = ((meters * dirSign) % 0.5 + 0.5) % 0.5;
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
        // Laufrichtung
        ctx.fillStyle = '#D9701A';
        var mid = y + h / 2;
        ctx.beginPath();
        ctx.moveTo(x + w - 0.45, mid - 0.15);
        ctx.lineTo(x + w - 0.2, mid);
        ctx.lineTo(x + w - 0.45, mid + 0.15);
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
        ctx.fillStyle = '#9AA3AE';
        ctx.fillRect(x + 0.15, y + 0.05, w - 0.3, h - 0.45);
        ctx.strokeRect(x + 0.15, y + 0.05, w - 0.3, h - 0.45);
        ctx.fillStyle = el.color;
        ctx.fillRect(x + 0.45, y + h - 0.4, 0.1, 0.2);
        ctx.fillRect(x + 0.1, y + h - 0.2, w - 0.2, 0.08);
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
  },

  // Angezeigte Simulationszeit, passend zu den interpolierten Kisten:
  // Kisten werden zwischen vorletztem (alpha 0) und letztem Schritt (alpha 1)
  // gezeichnet, also liegt die Anzeige bis zu einen Schritt hinter e.time.
  // In der Pause ist alpha 1 – Anzeige = Zustand des letzten Schritts.
  simTime: function () {
    var e = MF.engine;
    if (!e.clock) return 0;
    return e.time - (1 - e.alpha()) * e.dt();
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
      var ty = self.offsetY + (el.y + el.h) * c + (el.type === 'sensor' ? 0.25 * c + 3 : 3);
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
