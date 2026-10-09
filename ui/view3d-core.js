// 3D-Ansicht, reiner Teil: alles, was ohne Three.js, WebGL und DOM auskommt.
//
// Hier steht die Rechnung, ui/view3d.js macht daraus Three.js-Objekte:
//   - Körper -> Prisma (Eckpunkte, Normalen, Flächen, Texturkoordinaten)
//   - Interpolation zwischen zwei Physik-Schritten (Lage linear, Drehung slerp)
//   - Spiegelung Mini-Fabrik <-> Three.js-Szene (Konzept, Abschnitt 1)
//   - Kamera-Stand (view.camera3d) prüfen, runden und einpassen
// So lässt sich alles headless testen (test/view3d.test.js).
//
// Koordinaten: Die Mini-Fabrik rechnet mit x rechts, y in der Draufsicht nach
// unten, z oben (von oben gesehen linkshändig). Die Ansicht hängt alle Körper in
// eine Gruppe mit scale.y = −1; darin gelten die Mini-Fabrik-Koordinaten
// unverändert. Nur was außerhalb der Gruppe liegt (Kamera), wird gespiegelt.
window.MF = window.MF || {};

MF.view3dCore = {
  CIRCLE_SEGMENTS: 48,   // Kreis im Bild runder als in der Physik (24)
  STRIPE_M: 0.25,        // Streifenabstand auf Transportflächen (wie Draufsicht)
  FOV: 45,               // Öffnungswinkel der Kamera (Grad, senkrecht)

  // ---------- Körper -> Prisma ----------

  // Grundriss fürs Bild: wie MF.geom.outline, Kreise feiner unterteilt.
  // Immer gegen den Uhrzeigersinn im mathematischen Sinn (Fläche > 0).
  outline: function (shape) {
    var pts;
    if (shape.type === 'circle') {
      pts = [];
      for (var i = 0; i < this.CIRCLE_SEGMENTS; i++) {
        var a = 2 * Math.PI * i / this.CIRCLE_SEGMENTS;
        pts.push([shape.r * Math.cos(a), shape.r * Math.sin(a)]);
      }
    } else {
      pts = MF.geom.outline(shape);
    }
    if (MF.geom.signedArea(pts) < 0) pts = pts.slice().reverse();
    return pts;
  },

  // Höhe der Oberseite über der Unterseite an der lokalen Stelle (x, y).
  // Bei geneigter Oberseite (shape.h2, Rutsche) läuft sie entlang x von h nach h2
  // (MF.geom.topAt, wie Engine und Draufsicht) – Prisma, Normalen und Bänder rechnen alle damit.
  topZ: function (shape, x, y) {
    return MF.geom.topAt(shape, x);
  },

  // Dreiecke der Grundfläche (auch konkav) als Indizes in pts, alle gegen den
  // Uhrzeigersinn. Zerlegt mit MF.geom.convexParts (konvexe Teile bzw. Ohren).
  triangulate: function (pts) {
    var tris = [];
    MF.geom.convexParts(pts).forEach(function (part) {
      for (var k = 1; k + 1 < part.length; k++) {
        // convexParts liefert dieselben Punkt-Objekte, also findet indexOf sie wieder
        var t = [pts.indexOf(part[0]), pts.indexOf(part[k]), pts.indexOf(part[k + 1])];
        if (t.some(function (i) { return i < 0; })) continue;
        var a = pts[t[0]], b = pts[t[1]], c = pts[t[2]];
        var cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        if (Math.abs(cross) < 1e-14) continue;
        if (cross < 0) t = [t[0], t[2], t[1]];
        tris.push(t);
      }
    });
    return tris;
  },

  // Prisma eines Körpers in seinen lokalen Koordinaten (Unterseite bei z = 0).
  // opt.uvDir: Laufrichtung (Grad, lokal) – die Oberseite bekommt Texturkoordinaten
  //            in Metern: u entlang der Laufrichtung, v quer dazu.
  // Rückgabe (einfache Zahlenlisten, fertig für BufferGeometry):
  //   { position, normal, uv, index, groups: [{ start, count, role }] }
  //   role 'top' | 'side' | 'bottom' – die Ansicht gibt jeder Rolle einen Werkstoff.
  // Seiten haben eigene Eckpunkte je Kante (kantig); beim Kreis glatt.
  // opt.roll: Rundung der Umlenkrolle (MF.geom.rollOf) – dann baut rollSolid den Körper.
  prism: function (shape, opt) {
    opt = opt || {};
    if (opt.roll) return this.rollSolid(shape, opt);
    var self = this;
    var pts = this.outline(shape);
    var n = pts.length;
    var position = [], normal = [], uv = [], index = [], groups = [];
    var dir = MF.geom.rad(opt.uvDir || 0), cd = Math.cos(dir), sd = Math.sin(dir);
    var smooth = shape.type === 'circle';

    function vertex(x, y, z, nx, ny, nz, u, v) {
      position.push(x, y, z);
      normal.push(nx, ny, nz);
      uv.push(u, v);
      return position.length / 3 - 1;
    }
    function group(role, start) {
      if (index.length > start) groups.push({ start: start, count: index.length - start, role: role });
    }

    var tris = this.triangulate(pts);

    // Oberseite (Normale nach oben; bei schräger Oberseite aus der Ebene)
    var start = index.length, base = position.length / 3;
    pts.forEach(function (p) {
      vertex(p[0], p[1], self.topZ(shape, p[0], p[1]), 0, 0, 1,
        p[0] * cd + p[1] * sd, -p[0] * sd + p[1] * cd);
    });
    tris.forEach(function (t) { index.push(base + t[0], base + t[1], base + t[2]); });
    this.fixTopNormals(position, normal, index, start);
    group('top', start);

    // Unterseite (Normale nach unten, Dreiecke umgedreht)
    start = index.length; base = position.length / 3;
    pts.forEach(function (p) { vertex(p[0], p[1], 0, 0, 0, -1, p[0], p[1]); });
    tris.forEach(function (t) { index.push(base + t[0], base + t[2], base + t[1]); });
    group('bottom', start);

    // Seiten: je Kante ein Viereck, Normale nach außen
    start = index.length;
    var len = 0;
    for (var i = 0; i < n; i++) {
      var a = pts[i], b = pts[(i + 1) % n];
      var dx = b[0] - a[0], dy = b[1] - a[1], l = Math.sqrt(dx * dx + dy * dy);
      if (l < 1e-12) continue;
      var nx = dy / l, ny = -dx / l, na = [nx, ny], nb = [nx, ny];
      if (smooth) {   // Kreis: Normale zeigt vom Mittelpunkt weg
        var ra = Math.sqrt(a[0] * a[0] + a[1] * a[1]) || 1, rb = Math.sqrt(b[0] * b[0] + b[1] * b[1]) || 1;
        na = [a[0] / ra, a[1] / ra];
        nb = [b[0] / rb, b[1] / rb];
      }
      var ha = this.topZ(shape, a[0], a[1]), hb = this.topZ(shape, b[0], b[1]);
      var a0 = vertex(a[0], a[1], 0, na[0], na[1], 0, len, 0);
      var b0 = vertex(b[0], b[1], 0, nb[0], nb[1], 0, len + l, 0);
      var b1 = vertex(b[0], b[1], hb, nb[0], nb[1], 0, len + l, hb);
      var a1 = vertex(a[0], a[1], ha, na[0], na[1], 0, len, ha);
      index.push(a0, b0, b1, a0, b1, a1);
      len += l;
    }
    group('side', start);

    return { position: position, normal: normal, uv: uv, index: index, groups: groups };
  },

  // Körper mit gerundeten Stirnenden bzw. Rand, genau wie in der Physik (MF.geom.rollProfile):
  // Rechteck ('x'/'y') = Querschnitt in Laufrichtung, quer extrudiert; Kreis ('rim') =
  // Profil um die Hochachse gedreht. Was zur Oberseite gehört (ebene Fläche und obere
  // Rundung, der Gurt läuft darum herum), bekommt die Rolle 'top'. Rückgabe wie prism.
  rollSolid: function (shape, opt) {
    var G = MF.geom, h = shape.h, rim = opt.roll === 'rim';
    var position = [], normal = [], uv = [], index = [], groups = [];
    var dir = G.rad(opt.uvDir || 0), cd = Math.cos(dir), sd = Math.sin(dir);
    var tris = { top: [], side: [], bottom: [] };
    function vertex(p, n) {
      position.push(p[0], p[1], p[2]);
      normal.push(n[0], n[1], n[2]);
      uv.push(p[0] * cd + p[1] * sd, -p[0] * sd + p[1] * cd);
      return position.length / 3 - 1;
    }
    // Dreieck mit Umlaufsinn passend zur Normale; entartete (an der Achse) entfallen
    function tri(role, a, b, c, na, nb, nc) {
      var u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      var x = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      if (Math.abs(x[0]) + Math.abs(x[1]) + Math.abs(x[2]) < 1e-14) return;
      var m = [na[0] + nb[0] + nc[0], na[1] + nb[1] + nc[1], na[2] + nb[2] + nc[2]];
      var t = [vertex(a, na), vertex(b, nb), vertex(c, nc)];
      tris[role].push(x[0] * m[0] + x[1] * m[1] + x[2] * m[2] >= 0 ? t : [t[0], t[2], t[1]]);
    }

    // Querschnitt [c, z] gegen den Uhrzeigersinn (c nach rechts, z nach oben)
    var len = rim ? 2 * shape.r : opt.roll === 'x' ? shape.w : shape.d, half = len / 2;
    var prof = rim ? G.rollProfile(h, len, G.rimRadius(shape)) : G.rollProfile(h, len);
    var ro = prof[prof.length - 1][0], sec = [];
    if (rim) {
      sec.push([0, 0]);
      prof.forEach(function (p) { sec.push([half - p[0], p[1]]); });
      sec.push([0, h]);
    } else {
      prof.forEach(function (p) { sec.push([half - p[0], p[1]]); });
      for (var k = prof.length - 1; k >= 0; k--) sec.push([prof[k][0] - half, prof[k][1]]);
    }
    var n = sec.length, closed = !rim;
    var edges = [];   // je Kante: Normale [nc, nz] und Rolle
    for (var i = 0; i < n - (closed ? 0 : 1); i++) {
      var a = sec[i], b = sec[(i + 1) % n], dc = b[0] - a[0], dz = b[1] - a[1], l = Math.sqrt(dc * dc + dz * dz);
      var role = a[1] < 1e-9 && b[1] < 1e-9 ? 'bottom' : Math.min(a[1], b[1]) >= h - ro - 1e-9 ? 'top' : 'side';
      edges.push({ a: a, b: b, n: [dz / l, -dc / l], role: role });
    }
    // Glatt über die Rundung: Normale am Punkt gemittelt, wenn der Knick unter 30° liegt
    function smooth(e, f) {
      if (!f || e.n[0] * f.n[0] + e.n[1] * f.n[1] < Math.cos(Math.PI / 6)) return e.n;
      var c = e.n[0] + f.n[0], z = e.n[1] + f.n[1], l = Math.sqrt(c * c + z * z);
      return [c / l, z / l];
    }
    var m = edges.length;
    edges.forEach(function (e, j) {
      e.na = smooth(e, closed || j > 0 ? edges[(j - 1 + m) % m] : null);
      e.nb = smooth(e, closed || j < m - 1 ? edges[(j + 1) % m] : null);
    });

    if (rim) {
      var segs = this.CIRCLE_SEGMENTS;
      edges.forEach(function (e) {
        for (var j = 0; j < segs; j++) {
          var t0 = 2 * Math.PI * j / segs, t1 = 2 * Math.PI * (j + 1) / segs;
          var c0 = Math.cos(t0), s0 = Math.sin(t0), c1 = Math.cos(t1), s1 = Math.sin(t1);
          var p00 = [e.a[0] * c0, e.a[0] * s0, e.a[1]], p01 = [e.a[0] * c1, e.a[0] * s1, e.a[1]];
          var p10 = [e.b[0] * c0, e.b[0] * s0, e.b[1]], p11 = [e.b[0] * c1, e.b[0] * s1, e.b[1]];
          var n00 = [e.na[0] * c0, e.na[0] * s0, e.na[1]], n01 = [e.na[0] * c1, e.na[0] * s1, e.na[1]];
          var n10 = [e.nb[0] * c0, e.nb[0] * s0, e.nb[1]], n11 = [e.nb[0] * c1, e.nb[0] * s1, e.nb[1]];
          tri(e.role, p00, p10, p11, n00, n10, n11);
          tri(e.role, p00, p11, p01, n00, n11, n01);
        }
      });
    } else {
      // Laufrichtung c entlang lokal x bzw. y, quer dazu q
      var side = (opt.roll === 'x' ? shape.d : shape.w) / 2;
      var at = opt.roll === 'x' ? function (c, q, z) { return [c, q, z]; } : function (c, q, z) { return [q, c, z]; };
      edges.forEach(function (e) {
        var na = at(e.na[0], 0, e.na[1]), nb = at(e.nb[0], 0, e.nb[1]);
        var a0 = at(e.a[0], -side, e.a[1]), a1 = at(e.a[0], side, e.a[1]);
        var b0 = at(e.b[0], -side, e.b[1]), b1 = at(e.b[0], side, e.b[1]);
        tri(e.role, a0, b0, b1, na, nb, nb);
        tri(e.role, a0, b1, a1, na, nb, na);
      });
      [-side, side].forEach(function (q) {   // Seitenflächen: Querschnitt als Fächer (konvex)
        var nq = at(0, q > 0 ? 1 : -1, 0);
        for (var j = 1; j + 1 < n; j++) {
          tri('side', at(sec[0][0], q, sec[0][1]), at(sec[j][0], q, sec[j][1]), at(sec[j + 1][0], q, sec[j + 1][1]), nq, nq, nq);
        }
      });
    }

    ['top', 'bottom', 'side'].forEach(function (role) {
      var start = index.length;
      tris[role].forEach(function (t) { index.push(t[0], t[1], t[2]); });
      if (index.length > start) groups.push({ start: start, count: index.length - start, role: role });
    });
    return { position: position, normal: normal, uv: uv, index: index, groups: groups };
  },

  // Normalen der Oberseite aus ihren Dreiecken (bei waagerechter Oberseite (0, 0, 1))
  fixTopNormals: function (position, normal, index, start) {
    if (index.length <= start) return;
    var i = index[start], j = index[start + 1], k = index[start + 2];
    function p(v) { return [position[3 * v], position[3 * v + 1], position[3 * v + 2]]; }
    var a = p(i), b = p(j), c = p(k);
    var u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    var nx = u[1] * w[2] - u[2] * w[1], ny = u[2] * w[0] - u[0] * w[2], nz = u[0] * w[1] - u[1] * w[0];
    var l = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (!(l > 0)) return;
    for (var m = start; m < index.length; m++) {
      var v = index[m];
      normal[3 * v] = nx / l; normal[3 * v + 1] = ny / l; normal[3 * v + 2] = nz / l;
    }
  },

  // Halbe Ausdehnung des Grundrisses entlang der Laufrichtung dir (Grad, lokal)
  // und quer dazu: { ex, ey } – für den Richtungspfeil auf der Transportfläche.
  surfaceExtent: function (shape, dir) {
    var v = MF.geom.dirVec(dir), ex = 0, ey = 0;
    this.outline(shape).forEach(function (p) {
      ex = Math.max(ex, Math.abs(p[0] * v.x + p[1] * v.y));
      ey = Math.max(ey, Math.abs(-p[0] * v.y + p[1] * v.x));
    });
    return { ex: ex, ey: ey };
  },

  // Was die Ansicht von einem Körper zum Bauen braucht. Ändert es sich, wird
  // sein Mesh neu gebaut; Lage und Laufzeitwerte (Achse, Band, Sensor) nicht.
  bodyKey: function (b) {
    return JSON.stringify([b.kind, b.shape, b.look && b.look.color, b.look && b.look.visible !== false,
      b.surface ? b.surface.dir : null, MF.geom.rollOf(b), !!b.sensor, !!b.spawner, !!b.sink, !!b.axis]);
  },

  // Darstellung einer Körperart (Werte für die Werkstoffe in ui/view3d.js)
  //   ghost:     halbtransparent, kein Schatten, Kanten in der Körperfarbe
  //   static:    fest in der Körperfarbe, wirft und empfängt Schatten
  //   kinematic: fest in Stahlgrau (wie Draufsicht), Kanten in der Körperfarbe
  //   dynamic:   fest in der Körperfarbe
  // Sensor: Fläche in Strahlfarbe, belegt rot; Erzeuger kräftiger, Senke dunkel.
  COLORS: { beam: '#D9701A', busy: '#C0392B', steel: '#9AA3AE', sink: '#1B2430', select: '#D9701A',
    arrowOn: '#D9701A', arrowOff: '#8A93A0' },

  look: function (b, busy) {
    var c = this.COLORS;
    var color = (b.look && b.look.color) || '#8A93A0';
    if (b.kind === 'ghost') {
      if (b.sensor) return { solid: false, color: busy ? c.busy : c.beam, edge: busy ? c.busy : color, opacity: busy ? 0.5 : 0.22 };
      if (b.spawner) return { solid: false, color: color, edge: color, opacity: 0.35 };
      if (b.sink) return { solid: false, color: c.sink, edge: color, opacity: 0.18 };
      return { solid: false, color: color, edge: color, opacity: 0.15 };
    }
    if (b.kind === 'kinematic') return { solid: true, color: c.steel, edge: color, shadow: true };
    return { solid: true, color: color, edge: null, shadow: true };
  },

  // ---------- Interpolation ----------

  lerp: function (a, b, t) { return a + (b - a) * t; },

  // Lage zwischen zwei Schritten: { x, y, z } linear
  lerpPos: function (a, b, t) {
    return { x: this.lerp(a.x, b.x, t), y: this.lerp(a.y, b.y, t), z: this.lerp(a.z, b.z, t) };
  },

  // Drehung zwischen zwei Schritten: Quaternion { x, y, z, w } per slerp, kürzester Weg.
  // out (optional) wird beschrieben, damit beim Zeichnen nichts angelegt wird.
  slerp: function (a, b, t, out) {
    out = out || {};
    var bx = b.x, by = b.y, bz = b.z, bw = b.w;
    var cos = a.x * bx + a.y * by + a.z * bz + a.w * bw;
    if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }
    var k0, k1;
    if (cos > 0.9995) {   // fast gleich: linear und normieren
      k0 = 1 - t; k1 = t;
    } else {
      var th = Math.acos(cos), s = Math.sin(th);
      k0 = Math.sin((1 - t) * th) / s;
      k1 = Math.sin(t * th) / s;
    }
    out.x = k0 * a.x + k1 * bx; out.y = k0 * a.y + k1 * by;
    out.z = k0 * a.z + k1 * bz; out.w = k0 * a.w + k1 * bw;
    var l = Math.sqrt(out.x * out.x + out.y * out.y + out.z * out.z + out.w * out.w) || 1;
    out.x /= l; out.y /= l; out.z /= l; out.w /= l;
    return out;
  },

  // Kiste aus der Engine ({ prev, cur } mit x, y, z, q) zum Anteil alpha
  boxPose: function (bx, alpha) {
    var p = bx.prev || bx.cur, c = bx.cur;
    return { x: this.lerp(p.x, c.x, alpha), y: this.lerp(p.y, c.y, alpha), z: this.lerp(p.z, c.z, alpha),
      q: this.slerp(p.q, c.q, alpha) };
  },

  // Strecke, die ein Band seit dem Reset gelaufen ist, zum Anteil alpha
  travel: function (rt, alpha) {
    rt = rt || {};
    var t = rt.travel || 0;
    var p = rt.prevTravel !== undefined ? rt.prevTravel : t;
    return this.lerp(p, t, alpha);
  },

  // ---------- Spiegelung ----------

  // Mini-Fabrik -> Three.js-Szene (und zurück; die Spiegelung ist ihr eigenes Gegenteil)
  toScene: function (p) { return { x: p.x, y: -p.y, z: p.z }; },
  fromScene: function (p) { return { x: p.x, y: -p.y, z: p.z }; },

  // ---------- Kamera (view.camera3d) ----------
  //
  // Gespeichert in Mini-Fabrik-Koordinaten (Meter), unabhängig von der Spiegelung:
  //   { pos: [x, y, z], target: [x, y, z] }
  // Nicht Teil des Verlaufs (Undo); landet über view in Datei und Autosave.

  // Prüfen und auf Millimeter runden; ungültig -> null
  normCamera: function (c) {
    function vec(v) {
      if (!Array.isArray(v) || v.length !== 3) return null;
      for (var i = 0; i < 3; i++) if (typeof v[i] !== 'number' || !isFinite(v[i])) return null;
      return v.map(function (x) { return Math.round(x * 1000) / 1000; });
    }
    if (!c || typeof c !== 'object') return null;
    var pos = vec(c.pos), target = vec(c.target);
    if (!pos || !target) return null;
    var d = Math.abs(pos[0] - target[0]) + Math.abs(pos[1] - target[1]) + Math.abs(pos[2] - target[2]);
    if (d < 1e-3) return null;
    return { pos: pos, target: target };
  },

  // Hüllquader aller sichtbaren Körper { x0, y0, z0, x1, y1, z1 }, null ohne Körper
  bounds: function (bodies) {
    var r = null;
    bodies.forEach(function (b) {
      if (b.look && b.look.visible === false) return;
      var pose = MF.poseInWorld(b);   // gekoppelt: Lage am Elternkörper
      var q = MF.geom.bounds(b.shape, pose);
      var top = pose.z + MF.geom.maxHeight(b.shape);
      if (!r) r = { x0: q.x0, y0: q.y0, z0: pose.z, x1: q.x1, y1: q.y1, z1: top };
      r.x0 = Math.min(r.x0, q.x0); r.y0 = Math.min(r.y0, q.y0); r.z0 = Math.min(r.z0, pose.z);
      r.x1 = Math.max(r.x1, q.x1); r.y1 = Math.max(r.y1, q.y1); r.z1 = Math.max(r.z1, top);
    });
    return r;
  },

  // Kamera so, dass der Hüllquader ganz im Bild ist. Blick vom unteren Rand der
  // Draufsicht (große y) schräg von oben, leicht von links – so liegt "rechts" in
  // 3D rechts wie in der Draufsicht. aspect = Breite / Höhe.
  fitCamera: function (bounds, aspect) {
    var b = bounds || { x0: -2, y0: -2, z0: 0, x1: 2, y1: 2, z1: 1 };
    var c = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2];
    // Blickrichtung (vom Ziel zur Kamera) und Bildachsen
    var v = [-0.2, 0.8, 0.56], l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    v = [v[0] / l, v[1] / l, v[2] / l];
    var right = [v[1], -v[0], 0], rl = Math.sqrt(right[0] * right[0] + right[1] * right[1]);
    right = [right[0] / rl, right[1] / rl, 0];
    var up = [v[1] * right[2] - v[2] * right[1], v[2] * right[0] - v[0] * right[2], v[0] * right[1] - v[1] * right[0]];
    var tanV = Math.tan(MF.geom.rad(this.FOV / 2)), tanH = tanV * (aspect > 0 ? aspect : 1);
    // Abstand so, dass jede Ecke des Hüllquaders im Bild liegt:
    // Tiefe einer Ecke = dist − d·v, seitlich |d·right| ≤ tanH · Tiefe, senkrecht ebenso
    var dist = 1;
    [b.x0, b.x1].forEach(function (x) {
      [b.y0, b.y1].forEach(function (y) {
        [b.z0, b.z1].forEach(function (z) {
          var d = [x - c[0], y - c[1], z - c[2]];
          var dv = d[0] * v[0] + d[1] * v[1] + d[2] * v[2];
          var dr = Math.abs(d[0] * right[0] + d[1] * right[1] + d[2] * right[2]);
          var du = Math.abs(d[0] * up[0] + d[1] * up[1] + d[2] * up[2]);
          dist = Math.max(dist, dv + dr / tanH, dv + du / tanV);
        });
      });
    });
    dist *= 1.1;   // etwas Rand
    return this.normCamera({
      pos: [c[0] + v[0] * dist, c[1] + v[1] * dist, c[2] + v[2] * dist],
      target: c
    });
  },

  // ---------- Layout ----------

  MODES: ['split', '2d', '3d'],   // nebeneinander, nur Draufsicht, nur 3D

  normMode: function (m) { return this.MODES.indexOf(m) >= 0 ? m : 'split'; },

  // Anteil der Draufsicht an der Breite beim Nebeneinander
  normSplit: function (f) {
    f = typeof f === 'number' && isFinite(f) ? f : 0.5;
    return Math.max(0.15, Math.min(0.85, f));
  }
};
