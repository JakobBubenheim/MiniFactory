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
  // Bei geneigter Oberseite (shape.h2) zählt die Höhe an dieser Stelle.
  containsPoint: function (shape, pose, p) {
    var l = this.toLocal(pose, p.x, p.y);
    if (p.z < pose.z - 1e-9 || p.z > pose.z + this.topAt(shape, l.x) + 1e-9) return false;
    return this.inOutline(shape, l.x, l.y);
  },

  // ---------- Neigung (Keil) ----------
  //
  // Ein Körper kann eine geneigte Oberseite haben (Konzept, Abschnitt 3): die Höhe
  // läuft entlang der lokalen x-Achse linear von shape.h (am kleinsten x des
  // Grundrisses) nach shape.h2 (am größten x). Unterseite bleibt waagrecht auf pose.z.
  // Fehlt h2 (oder ist gleich h), ist die Oberseite eben.

  isSloped: function (shape) {
    return typeof shape.h2 === 'number' && Math.abs(shape.h2 - shape.h) > 1e-9;
  },

  // Kleinstes und größtes lokales x des Grundrisses
  xRange: function (shape) {
    if (shape.type === 'rect') return { x0: -shape.w / 2, x1: shape.w / 2 };
    if (shape.type === 'circle') return { x0: -shape.r, x1: shape.r };
    var x0 = Infinity, x1 = -Infinity;
    (shape.points || []).forEach(function (p) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); });
    return { x0: x0, x1: x1 };
  },

  // Höhe der Oberseite über der Unterseite an der lokalen Stelle lx
  topAt: function (shape, lx) {
    if (!this.isSloped(shape)) return shape.h;
    var r = this.xRange(shape);
    var t = r.x1 - r.x0 > 1e-12 ? (lx - r.x0) / (r.x1 - r.x0) : 0;
    t = Math.max(0, Math.min(1, t));
    return shape.h + (shape.h2 - shape.h) * t;
  },

  // Größte Höhe des Körpers (für Hüllquader, Zeichnen)
  maxHeight: function (shape) {
    return this.isSloped(shape) ? Math.max(shape.h, shape.h2) : shape.h;
  },

  // Neigungswinkel der Oberseite in Grad (0 = eben)
  slopeDeg: function (shape) {
    if (!this.isSloped(shape)) return 0;
    var r = this.xRange(shape);
    return Math.atan2(Math.abs(shape.h2 - shape.h), r.x1 - r.x0) * 180 / Math.PI;
  },

  // ---------- Umlenkrolle (Stirnenden einer Transportfläche) ----------
  //
  // Bänder liegen bündig (Konzept, Abschnitt 4). Damit eine Kiste an der Naht nicht
  // an der Stirnkante des nächsten Bands hängen bleibt, ist ein Rechteck mit
  // Transportfläche an beiden Stirnenden (quer zur Laufrichtung) gerundet wie eine
  // Umlenkrolle: oben ein Viertelkreis mit ROLL_R, unten ebenso, soweit die Höhe
  // reicht (Band 0,1 m: Halbkreis, Rollendurchmesser = Bandhöhe). Seitenkanten bleiben
  // scharf. Gemessen (Spike-3D-Ergebnis 4a): erst ab 5 cm Radius hängt nichts mehr –
  // an einer kleinen Rundung oder einer Schräge rechnet Rapier vorausschauend mit der
  // Ecke darunter und bremst die Kiste wie an einer Wand.
  ROLL_R: 0.05,
  ROLL_SEGMENTS: 8,      // je Viertelkreis

  // Läuft die Transportfläche entlang der lokalen x- oder y-Achse? (nächste Achse;
  // null: keine Rundung – nur ebene Rechtecke haben Stirnenden)
  rollAxis: function (shape, dir) {
    if (shape.type !== 'rect' || this.isSloped(shape)) return null;
    var v = this.dirVec(dir || 0);
    return Math.abs(v.x) >= Math.abs(v.y) ? 'x' : 'y';
  },

  // Rundung eines Körpers: 'x' / 'y' beim ebenen Rechteck mit Transportfläche,
  // 'rim' beim Kreis mit Transportfläche (Drehtisch: Rand rundum gerundet), sonst null.
  // Engine und 3D-Ansicht fragen beide hier.
  rollOf: function (b) {
    if (!b.surface || !b.shape || this.isSloped(b.shape)) return null;
    if (b.shape.type === 'circle') return 'rim';
    return this.rollAxis(b.shape, b.surface.dir);
  },

  // Radius am Rand eines Drehtischs: oben und unten gleich (Rapier: RoundCylinder)
  rimRadius: function (shape) {
    return Math.min(this.ROLL_R, shape.h / 2, shape.r);
  },

  // Schnitt durch ein Stirnende: Punkte [a, z] von unten nach oben, a = Abstand
  // von der Stirn nach innen, z = Höhe über der Unterseite. len = Länge in Laufrichtung.
  // r: fester Radius oben und unten (Drehtisch, rimRadius), sonst ROLL_R so weit die Höhe reicht.
  rollProfile: function (h, len, r) {
    var ro = r !== undefined ? r : Math.min(this.ROLL_R, h, len / 2);
    var ru = r !== undefined ? r : Math.min(ro, h - ro), n = this.ROLL_SEGMENTS;
    var out = [], i, a;
    if (ru > 1e-9) {
      for (i = 0; i <= n; i++) {   // unten: von (ru, 0) nach (0, ru)
        a = Math.PI / 2 * i / n;
        out.push([ru - ru * Math.sin(a), ru - ru * Math.cos(a)]);
      }
    } else {
      out.push([0, 0]);
    }
    for (i = 0; i <= n; i++) {     // oben: von (0, h − ro) nach (ro, h)
      a = Math.PI / 2 * i / n;
      out.push([ro - ro * Math.cos(a), h - ro + ro * Math.sin(a)]);
    }
    return out.filter(function (p, k) {   // doppelte Punkte (Übergang der Bögen) weg
      return k === 0 || Math.abs(p[0] - out[k - 1][0]) + Math.abs(p[1] - out[k - 1][1]) > 1e-9;
    });
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

  // Polygon in konvexe Teile zerlegen: konvex bleibt es ganz, sonst erst Dreiecke
  // (Ohrenschneiden), die danach zu möglichst großen konvexen Teilen verschmolzen
  // werden (Hertel-Mehlhorn). Rapier braucht konvexe Formen; wenige große Teile
  // haben weniger innere Kanten, an denen eine rutschende Kiste hängen bleiben kann.
  // Punkte auf einer geraden Kante (z. B. frisch eingefügt) stören dabei nicht.
  convexParts: function (pts) {
    pts = this.withoutCollinear(pts);
    if (pts.length < 3) return [];
    if (this.isConvex(pts)) return [pts.slice()];
    return this.mergeConvex(this.triangulate(pts));
  },

  // Punkte entfernen, die doppelt sind oder auf der Geraden ihrer Nachbarn liegen
  withoutCollinear: function (pts) {
    var out = pts.slice(), changed = true;
    while (changed && out.length >= 3) {
      changed = false;
      for (var i = 0; i < out.length; i++) {
        var a = out[(i + out.length - 1) % out.length], b = out[i], c = out[(i + 1) % out.length];
        var cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
        var len = Math.abs(c[0] - a[0]) + Math.abs(c[1] - a[1]) + 1e-12;
        if (Math.abs(cross) / len < 1e-9) { out.splice(i, 1); changed = true; break; }
      }
    }
    return out;
  },

  // Dreiecke zu konvexen Teilen verschmelzen: zwei Teile mit gemeinsamer Kante
  // werden eins, solange das Ergebnis konvex bleibt.
  mergeConvex: function (polys) {
    var self = this;
    function key(p) { return p[0] + ',' + p[1]; }
    var merged = true;
    polys = polys.map(function (p) { return p.slice(); });
    while (merged) {
      merged = false;
      for (var i = 0; i < polys.length && !merged; i++) {
        for (var j = i + 1; j < polys.length && !merged; j++) {
          var m = joinAt(polys[i], polys[j]);
          if (m && self.isConvex(m)) {
            polys[i] = m;
            polys.splice(j, 1);
            merged = true;
          }
        }
      }
    }
    return polys;

    // Gemeinsame Kante a->b in P (b->a in Q): Q ohne die Kante in P einsetzen
    function joinAt(P, Q) {
      for (var i = 0; i < P.length; i++) {
        var a = key(P[i]), b = key(P[(i + 1) % P.length]);
        for (var k = 0; k < Q.length; k++) {
          if (key(Q[k]) === b && key(Q[(k + 1) % Q.length]) === a) {
            var out = P.slice(0, i + 1);
            for (var n = 2; n < Q.length; n++) out.push(Q[(k + n) % Q.length]);
            return out.concat(P.slice(i + 1));
          }
        }
      }
      return null;
    }
  },

  // Ohrenschneiden: Polygon (ohne Selbstschnitt) in Dreiecke, gegen den Uhrzeigersinn
  triangulate: function (pts) {
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
  },

  // Schneiden sich zwei Kanten des Polygons (außer an gemeinsamen Ecken)?
  // Auch doppelte Punkte und Kanten, die auf einer anderen liegen, zählen.
  selfIntersects: function (pts) {
    var n = pts.length;
    if (n < 3) return false;
    for (var i = 0; i < n; i++) {
      var a = pts[i], b = pts[(i + 1) % n];
      if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) return true;
      for (var j = i + 1; j < n; j++) {
        if (j === i + 1 || (i === 0 && j === n - 1)) continue;   // Nachbarkanten
        if (this.segmentsTouch(a, b, pts[j], pts[(j + 1) % n])) return true;
      }
    }
    // Nachbarkanten, die zurücklaufen (Spitze mit Winkel 0)
    for (var k = 0; k < n; k++) {
      var p = pts[(k + n - 1) % n], q = pts[k], r = pts[(k + 1) % n];
      var cross = (q[0] - p[0]) * (r[1] - q[1]) - (q[1] - p[1]) * (r[0] - q[0]);
      var dot = (q[0] - p[0]) * (r[0] - q[0]) + (q[1] - p[1]) * (r[1] - q[1]);
      if (Math.abs(cross) < 1e-12 && dot < 0) return true;
    }
    return false;
  },

  // Berühren oder schneiden sich die Strecken ab und cd?
  segmentsTouch: function (a, b, c, d) {
    function orient(p, q, r) {
      var v = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
      return Math.abs(v) < 1e-12 ? 0 : v > 0 ? 1 : -1;
    }
    function onSeg(p, q, r) {
      return Math.min(p[0], r[0]) - 1e-12 <= q[0] && q[0] <= Math.max(p[0], r[0]) + 1e-12 &&
        Math.min(p[1], r[1]) - 1e-12 <= q[1] && q[1] <= Math.max(p[1], r[1]) + 1e-12;
    }
    var o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
    if (o1 !== o2 && o3 !== o4) return true;
    return (o1 === 0 && onSeg(a, c, b)) || (o2 === 0 && onSeg(a, d, b)) ||
      (o3 === 0 && onSeg(c, a, d)) || (o4 === 0 && onSeg(c, b, d));
  },

  round6: function (v) { return Math.round(v * 1e6) / 1e6; },

  // Fangen (Raster und Objektfang): sim/snap.js (MF.snap)

  // ---------- Formen aus gezeichneten Punkten ----------

  // Rechteck aus zwei gegenüberliegenden Ecken (Welt): { shape: { w, d }, x, y }
  rectFromCorners: function (a, b) {
    return {
      w: this.round6(Math.abs(b.x - a.x)), d: this.round6(Math.abs(b.y - a.y)),
      x: this.round6((a.x + b.x) / 2), y: this.round6((a.y + b.y) / 2)
    };
  },

  // Polygon aus Weltpunkten: Lage = Mitte des Hüllrechtecks, Punkte lokal dazu
  polygonFromWorld: function (pts) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, self = this;
    pts.forEach(function (p) {
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
    });
    var cx = this.round6((x0 + x1) / 2), cy = this.round6((y0 + y1) / 2);
    return {
      x: cx, y: cy,
      points: pts.map(function (p) { return [self.round6(p.x - cx), self.round6(p.y - cy)]; })
    };
  },

  // Längen der Kanten eines Polygons [[x, y], …] (geschlossen)
  edgeLengths: function (pts) {
    return pts.map(function (p, i) {
      var q = pts[(i + 1) % pts.length];
      return Math.sqrt((q[0] - p[0]) * (q[0] - p[0]) + (q[1] - p[1]) * (q[1] - p[1]));
    });
  },

  // Abstand des Punkts p zur Strecke ab und der nächste Punkt darauf
  nearestOnSegment: function (p, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    var t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
    var q = { x: a.x + t * dx, y: a.y + t * dy };
    return { x: q.x, y: q.y, t: t, dist: Math.sqrt((p.x - q.x) * (p.x - q.x) + (p.y - q.y) * (p.y - q.y)) };
  }
};
