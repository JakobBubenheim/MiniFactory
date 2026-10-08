// Geometrie der Körper: Grundriss, Lage, Punkt-in-Form, Zerlegen von Polygonen.
//
// Koordinaten wie im Konzept (Idee/Konzept-3D.md): x nach rechts, y in der
// Draufsicht nach unten, z nach oben, Meter und Grad. Eine positive Drehung um z
// erscheint in der Draufsicht im Uhrzeigersinn – wie beim Canvas.
//
// pose = Mittelpunkt der Unterseite des Grundrisses (bei Polygonen der Ursprung
// der lokalen Punkte), rot = Drehung um z in Grad.
// Wird von Engine, Zeichenfläche und Editor benutzt; kennt Rapier nicht.
window.MF = window.MF || {};

MF.geom = {
  CIRCLE_SEGMENTS: 24,   // Kreis als Vieleck (Zeichnen, Hüllrechteck)

  rad: function (deg) { return deg * Math.PI / 180; },

  // Winkel auf 0 … 360 (ohne 360)
  normDeg: function (deg) {
    var d = deg % 360;
    if (d < 0) d += 360;
    return Math.round(d * 1e6) / 1e6 % 360;
  },

  // Lokaler Punkt (Grundriss) -> Welt
  toWorld: function (pose, lx, ly) {
    var a = this.rad(pose.rot || 0), c = Math.cos(a), s = Math.sin(a);
    return { x: pose.x + lx * c - ly * s, y: pose.y + lx * s + ly * c };
  },

  // Welt -> lokaler Punkt
  toLocal: function (pose, wx, wy) {
    var a = this.rad(pose.rot || 0), c = Math.cos(a), s = Math.sin(a);
    var dx = wx - pose.x, dy = wy - pose.y;
    return { x: dx * c + dy * s, y: -dx * s + dy * c };
  },

  // Richtung (Grad) als Einheitsvektor
  dirVec: function (deg) {
    var a = this.rad(deg);
    return { x: Math.round(Math.cos(a) * 1e12) / 1e12, y: Math.round(Math.sin(a) * 1e12) / 1e12 };
  },

  // Grundriss als Vieleck in lokalen Koordinaten [[x, y], …]
  outline: function (shape) {
    if (shape.type === 'rect') {
      var w = shape.w / 2, d = shape.d / 2;
      return [[-w, -d], [w, -d], [w, d], [-w, d]];
    }
    if (shape.type === 'circle') {
      var out = [];
      for (var i = 0; i < this.CIRCLE_SEGMENTS; i++) {
        var a = 2 * Math.PI * i / this.CIRCLE_SEGMENTS;
        out.push([shape.r * Math.cos(a), shape.r * Math.sin(a)]);
      }
      return out;
    }
    return (shape.points || []).map(function (p) { return [p[0], p[1]]; });
  },

  // Liegt der lokale Punkt im Grundriss?
  inOutline: function (shape, lx, ly) {
    var eps = 1e-9;
    if (shape.type === 'rect') return Math.abs(lx) <= shape.w / 2 + eps && Math.abs(ly) <= shape.d / 2 + eps;
    if (shape.type === 'circle') return lx * lx + ly * ly <= shape.r * shape.r + eps;
    return this.inPolygon(shape.points || [], lx, ly);
  },

  // Strahlverfahren (gerade/ungerade Anzahl Schnitte)
  inPolygon: function (pts, x, y) {
    var inside = false;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      var xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  },

  // Liegt der Weltpunkt p {x, y, z} im Körper mit Lage pose (Grundriss × Höhe)?
  containsPoint: function (shape, pose, p) {
    if (p.z < pose.z - 1e-9 || p.z > pose.z + shape.h + 1e-9) return false;
    var l = this.toLocal(pose, p.x, p.y);
    return this.inOutline(shape, l.x, l.y);
  },

  // Nur der Grundriss (Draufsicht), z. B. für die Maus
  containsXY: function (shape, pose, x, y) {
    var l = this.toLocal(pose, x, y);
    return this.inOutline(shape, l.x, l.y);
  },

  // Grundriss in Weltkoordinaten
  worldOutline: function (shape, pose) {
    var self = this;
    return this.outline(shape).map(function (p) { return self.toWorld(pose, p[0], p[1]); });
  },

  // Achsparalleles Hüllrechteck { x0, y0, x1, y1 } in der Welt
  bounds: function (shape, pose) {
    var b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    this.worldOutline(shape, pose).forEach(function (p) {
      b.x0 = Math.min(b.x0, p.x); b.y0 = Math.min(b.y0, p.y);
      b.x1 = Math.max(b.x1, p.x); b.y1 = Math.max(b.y1, p.y);
    });
    return b;
  },

  // Fläche des Grundrisses (für "der kleinste gewinnt" bei der Maus)
  area: function (shape) {
    if (shape.type === 'rect') return shape.w * shape.d;
    if (shape.type === 'circle') return Math.PI * shape.r * shape.r;
    return Math.abs(this.signedArea(shape.points || []));
  },

  signedArea: function (pts) {
    var a = 0;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
    return a / 2;
  },

  isConvex: function (pts) {
    var sign = 0;
    for (var i = 0; i < pts.length; i++) {
      var a = pts[i], b = pts[(i + 1) % pts.length], c = pts[(i + 2) % pts.length];
      var cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (Math.abs(cross) < 1e-12) continue;
      if (sign === 0) sign = cross > 0 ? 1 : -1;
      else if ((cross > 0 ? 1 : -1) !== sign) return false;
    }
    return true;
  },

  // Polygon in konvexe Teile zerlegen: konvex bleibt es ganz, sonst Dreiecke
  // (Ohrenschneiden). Rapier braucht konvexe Formen; Phase 3 kann das verfeinern.
  convexParts: function (pts) {
    if (pts.length < 3) return [];
    if (this.isConvex(pts)) return [pts.slice()];
    var idx = pts.map(function (p, i) { return i; });
    if (this.signedArea(pts) < 0) idx.reverse();   // gegen den Uhrzeigersinn (mathematisch)
    var tris = [], guard = 0;
    while (idx.length > 3 && guard++ < 1000) {
      var cut = false;
      for (var i = 0; i < idx.length; i++) {
        var a = pts[idx[(i + idx.length - 1) % idx.length]], b = pts[idx[i]], c = pts[idx[(i + 1) % idx.length]];
        var cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
        if (cross <= 1e-12) continue;   // einspringende Ecke
        var inside = false;
        for (var k = 0; k < idx.length && !inside; k++) {
          var p = pts[idx[k]];
          if (p === a || p === b || p === c) continue;
          inside = this.inTriangle(p, a, b, c);
        }
        if (inside) continue;
        tris.push([a, b, c]);
        idx.splice(i, 1);
        cut = true;
        break;
      }
      if (!cut) break;   // entartetes Polygon
    }
    if (idx.length === 3) tris.push([pts[idx[0]], pts[idx[1]], pts[idx[2]]]);
    return tris;
  },

  inTriangle: function (p, a, b, c) {
    function side(p1, p2, p3) { return (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]); }
    var d1 = side(p, a, b), d2 = side(p, b, c), d3 = side(p, c, a);
    var neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(neg && pos);
  }
};
