// Fangen (Zeichenhilfe): Raster und Objektfang an einer Stelle.
//
// Alle Werkzeuge fangen nur über MF.snap: Verschieben, Einfügen aus dem Katalog,
// Zeichnen, Griffe (Größe, Radius, Polygonpunkte, Drehung, Achse), Pfeiltasten und
// das Eigenschaften-Panel (über MF.editor.snapStep/snapValue). Reine Rechnung ohne
// DOM, headless getestet (test/objektfang.test.js).
//
// Einstellungen der Anlage: settings.snap = { on, obj, pos, angle }
//   on    Rasterfangen: Lage auf pos (m), Drehung auf angle (Grad)
//   obj   Objektfang: Ecken, Kantenmitten, Mittelpunkte, Kreis-Quadranten, Kanten
//         bündig, Bandenden und Flucht anderer Körper
// off (Alt gedrückt) hält beides aus; dann wird nur auf 1 mm bzw. 0,1° gerundet.
// Ohne Rasterfangen runden Lagen beim Verschieben auf 1 cm (free = FREE_MOVE),
// Zeichnen und Griffe auf 1 mm.
//
// Objektfang (Reichweite RANGE_PX Bildschirmpixel, unabhängig vom Zoom), Vorrang:
//   Punkt   – Ecke □, Kantenmitte △, Mittelpunkt ○, Kreis-Quadrant ◇ (der nächste gewinnt)
//   Kante ═ – Punkt auf einer Kante; beim Verschieben liegt eine Kante des Körpers
//             bündig an einer Kante des anderen (gegenüberliegend, parallel), danach
//             rasten Ecken bzw. Mitten entlang der Kante ein. Liegt eine Kante näher
//             als jeder Punkt, gewinnt sie.
//   Bandende – Stirnkante an Stirnkante zweier Transportflächen: der gezogene Körper
//             liegt danach bündig mit dem anderen (gleiche Oberkante, Konzept, Abschnitt 4)
//   Flucht  – Ecke, Mitte oder Mittelpunkt auf derselben x- bzw. y-Linie wie beim
//             anderen Körper, mit Hilfslinie
//   Raster  – was danach frei ist
// Keine Ziele: der gezogene Körper, seine gekoppelten Kinder, ausgeblendete Körper
// und Kisten (die gehören nicht zum Modell).
window.MF = window.MF || {};

MF.snap = {
  FREE_POS: 0.001,     // ohne Fangen (Alt, Zeichnen, Griffe): 1 mm
  FREE_MOVE: 0.01,     // Lage ohne Rasterfangen beim Verschieben: 1 cm
  FREE_ANGLE: 0.1,     // Winkel ohne Fangen
  RANGE_PX: 8,         // Reichweite des Objektfangs in Bildschirmpixeln
  PARALLEL: 0.9995,    // Kanten gelten als parallel bis etwa 1,8°

  // ---------- Raster ----------

  gridOn: function (snap, off) { return !off && !!snap && snap.on !== false; },
  objOn: function (snap, off) { return !off && !!snap && snap.obj !== false; },

  // Schrittweite für Lagen; free = Schritt ohne Rasterfangen (Standard 1 mm)
  step: function (snap, off, free) {
    if (this.gridOn(snap, off)) return snap.pos || 0.05;
    return off ? this.FREE_POS : free || this.FREE_POS;
  },

  // Länge bzw. Koordinate auf das Raster
  len: function (v, snap, off, free) {
    var s = this.step(snap, off, free);
    return MF.geom.round6(Math.round(v / s) * s);
  },

  gridPoint: function (x, y, snap, off, free) {
    return { x: this.len(x, snap, off, free), y: this.len(y, snap, off, free) };
  },

  angleStep: function (snap, off) { return this.gridOn(snap, off) ? snap.angle || 5 : this.FREE_ANGLE; },

  // Winkel auf den Fangwinkel, auf 0 … 360 gebracht
  angle: function (deg, snap, off) {
    var s = this.angleStep(snap, off);
    return MF.geom.normDeg(Math.round(deg / s) * s) + 0;   // + 0: nie −0
  },

  // Winkel auf den Fangwinkel, ohne ihn auf 0 … 360 zu bringen (Grenzen einer Drehachse)
  angleValue: function (deg, snap, off) {
    var s = this.angleStep(snap, off);
    return MF.geom.round6(Math.round(deg / s) * s);
  },

  // Winkel n Fangschritte weiter (Stepper und Pfeiltasten im Panel): zuerst auf die
  // nächste Rasterlinie in Schrittrichtung (37,3° + 5° -> 40°), ohne Rasterfangen 1°-Schritte
  angleStepped: function (deg, n, snap) {
    var s = this.gridOn(snap, false) ? snap.angle || 5 : 1, k = deg / s;
    k = n > 0 ? Math.floor(k + 1e-6) + n : Math.ceil(k - 1e-6) + n;
    return MF.geom.normDeg(MF.geom.round6(k * s)) + 0;
  },

  // Drehen durch Ziehen (Werkzeug Drehen und Dreh-Griff): Drehung rot0 beim Anfassen,
  // Maus beim Anfassen (from) und jetzt (to), gedreht um c. Gibt die gefangene Drehung zurück.
  dragAngle: function (rot0, c, from, to, snap, off) {
    var a0 = Math.atan2(from.y - c.y, from.x - c.x), a1 = Math.atan2(to.y - c.y, to.x - c.x);
    return this.angle(rot0 + (a1 - a0) * 180 / Math.PI, snap, off);
  },

  // Punkt b so legen, dass die Strecke von a einen gefangenen Winkel und eine
  // gefangene Länge hat (Polygon zeichnen mit Shift)
  polar: function (a, b, snap, off) {
    var dx = b.x - a.x, dy = b.y - a.y, G = MF.geom;
    var len = this.len(Math.sqrt(dx * dx + dy * dy), snap, off);
    var ang = G.rad(this.angle(Math.atan2(dy, dx) * 180 / Math.PI, snap, off));
    return { x: G.round6(a.x + len * Math.cos(ang)), y: G.round6(a.y + len * Math.sin(ang)) };
  },

  // ---------- Fangziele ----------

  // Kontext für eine Bedienung. opts:
  //   snap   settings.snap
  //   bodies Körper der Anlage
  //   poseOf Lage eines Körpers in der Welt (Standard MF.poseInWorld)
  //   skip   ID des gezogenen Körpers (er und seine Kinder sind keine Ziele)
  //   scale  Pixel je Meter (Reichweite RANGE_PX in m umrechnen)
  context: function (opts) {
    var self = this, bodies = opts.bodies || [], skip = {};
    var poseOf = opts.poseOf || function (b) { return MF.poseInWorld(b); };
    if (opts.skip) {
      skip[opts.skip] = true;
      // Kinder (Kopplung), auch mehrere Ebenen
      for (var more = true; more;) {
        more = false;
        bodies.forEach(function (b) {
          if (!skip[b.id] && b.parent && skip[b.parent]) { skip[b.id] = true; more = true; }
        });
      }
    }
    var targets = [];
    bodies.forEach(function (b) {
      if (skip[b.id] || (b.look && b.look.visible === false)) return;
      targets.push(self.features(b, poseOf(b)));
    });
    return { snap: opts.snap, tol: this.RANGE_PX / (opts.scale || 80), targets: targets };
  },

  // Fangmerkmale eines Körpers in der Lage pose (Welt):
  //   pts   [{ x, y, kind }] mit kind 'corner' | 'mid' | 'center' | 'quad'; der erste ist der Mittelpunkt
  //   edges [{ a, b, mid, t (Richtung), n (nach außen), len, end }]; end bei
  //         Transportflächen: 'front' (Stirnkante in Laufrichtung) | 'back' | null
  //   top   Oberkante (z) der Transportfläche, belt = hat eine Transportfläche
  features: function (b, pose) {
    var G = MF.geom, sh = b.shape, f = { id: b.id, pts: [], edges: [], belt: !!b.surface, top: (pose.z || 0) + sh.h };
    if (sh.type === 'circle') {
      f.pts.push({ x: pose.x, y: pose.y, kind: 'center' });
      [[1, 0], [0, 1], [-1, 0], [0, -1]].forEach(function (q) {
        f.pts.push({ x: pose.x + q[0] * sh.r, y: pose.y + q[1] * sh.r, kind: 'quad' });
      });
      return f;
    }
    var w = G.worldOutline(sh, pose), run = b.surface ? G.dirVec((pose.rot || 0) + (b.surface.dir || 0)) : null;
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    G.outline(sh).forEach(function (p) {
      x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]);
    });
    var c = G.toWorld(pose, (x0 + x1) / 2, (y0 + y1) / 2);
    f.pts.push({ x: c.x, y: c.y, kind: 'center' });
    w.forEach(function (a, i) {
      var e = w[(i + 1) % w.length], dx = e.x - a.x, dy = e.y - a.y, len = Math.sqrt(dx * dx + dy * dy);
      f.pts.push({ x: a.x, y: a.y, kind: 'corner' });
      if (len < 1e-9) return;
      var t = { x: dx / len, y: dy / len }, n = { x: t.y, y: -t.x };
      var mid = { x: (a.x + e.x) / 2, y: (a.y + e.y) / 2 };
      // Nach außen: knapp neben der Kantenmitte liegt kein Grundriss
      if (G.containsXY(sh, pose, mid.x + n.x * 1e-5, mid.y + n.y * 1e-5)) n = { x: -n.x, y: -n.y };
      var end = null;
      if (run) {
        var d = n.x * run.x + n.y * run.y;
        end = d > MF.snap.PARALLEL ? 'front' : d < -MF.snap.PARALLEL ? 'back' : null;
      }
      f.pts.push({ x: mid.x, y: mid.y, kind: 'mid' });
      f.edges.push({ a: a, b: e, mid: mid, t: t, n: n, len: len, end: end });
    });
    return f;
  },

  // ---------- Koordinaten ----------

  // frame = { draw, pose }: Lage eines Körpers in der Welt (gezeichnet) und im
  // Koordinatensystem seiner Lage (Eltern-Körper, Achse in Stellung 0) beim Anfassen,
  // jeweils { x, y, z, rot }.
  // Ohne frame sind beide gleich (Zeichnen, Einfügen).
  toModel: function (frame, w) {
    if (!frame) return { x: w.x, y: w.y };
    var l = MF.geom.toLocal(frame.draw, w.x, w.y);
    return MF.geom.toWorld(frame.pose, l.x, l.y);
  },

  // Umkehrung von toModel
  toWorld: function (frame, m) {
    if (!frame) return { x: m.x, y: m.y };
    var l = MF.geom.toLocal(frame.pose, m.x, m.y);
    return MF.geom.toWorld(frame.draw, l.x, l.y);
  },

  // Sind die Achsen von Welt und Lage gleich (nur verschoben)? Dann lässt sich je
  // Achse einzeln fangen, sonst nur der ganze Punkt.
  sameAxes: function (frame) {
    if (!frame) return true;
    var d = MF.geom.normDeg((frame.draw.rot || 0) - (frame.pose.rot || 0));
    return d < 1e-6 || d > 360 - 1e-6;
  },

  // Gefundene Festlegungen (Welt) und Raster für den Rest -> Lage im Modell.
  // lock = { x, y } (fehlt eine Achse, ist sie frei); raw = Modellpunkt ohne Fangen.
  compose: function (w, lock, raw, frame, snap, off, free) {
    var G = MF.geom, hasX = lock.x !== undefined, hasY = lock.y !== undefined;
    if ((hasX !== hasY) && !this.sameAxes(frame)) { hasX = hasY = false; lock = {}; }
    if (!hasX && !hasY) return { x: this.len(raw.x, snap, off, free), y: this.len(raw.y, snap, off, free), locked: false };
    var m = this.toModel(frame, { x: hasX ? lock.x : w.x, y: hasY ? lock.y : w.y });
    return {
      x: hasX ? G.round6(m.x) : this.len(raw.x, snap, off, free),
      y: hasY ? G.round6(m.y) : this.len(raw.y, snap, off, free),
      locked: true
    };
  },

  // ---------- Punkt fangen (Zeichnen, Griffe) ----------

  // Weltpunkt w fangen. Gibt { x, y } im Koordinatensystem von frame zurück (ohne
  // frame: Welt), dazu hit (Marker und Text) oder null, locked = Objektfang hat
  // mindestens eine Achse festgelegt.
  point: function (ctx, w, off, frame, free) {
    var snap = ctx.snap, lock = {}, hit = null, raw = this.toModel(frame, w);
    if (this.objOn(snap, off)) {
      var best = this.nearestPoint(ctx, [{ x: w.x, y: w.y }]);
      if (best) {
        lock = { x: best.q.x, y: best.q.y };
        hit = this.hit(best.q.kind, best.q.x, best.q.y, best.f);
      } else {
        var e = this.nearestEdge(ctx, w);
        if (e) {
          // Achsparallele Kante legt nur eine Achse fest, die andere fängt weiter
          if (Math.abs(e.edge.t.x) < 1e-9) lock.x = e.q.x;
          else if (Math.abs(e.edge.t.y) < 1e-9) lock.y = e.q.y;
          else lock = { x: e.q.x, y: e.q.y };
          hit = this.hit('edge', e.q.x, e.q.y, e.f);
        }
        hit = this.align(ctx, [{ x: w.x, y: w.y }], lock, hit, false);
      }
    }
    var r = this.compose(w, lock, raw, frame, snap, off, free);
    r.hit = r.locked ? hit : null;
    if (r.hit && r.hit.kind !== 'align') {
      var g = this.toWorld(frame, r);   // Marker dort, wo der Punkt wirklich liegt
      r.hit.x = g.x; r.hit.y = g.y;
    }
    return r;
  },

  // ---------- Körper verschieben (Verschieben, Einfügen aus dem Katalog) ----------

  // b in neuer Lage fangen. raw = { model: {x, y}, world: {x, y} }: Lage ohne Fangen,
  // im Koordinatensystem von frame bzw. in der Welt. Gibt { x, y, z?, hit } zurück;
  // z nur, wenn ein Bandende die Höhe festlegt (sonst bleibt sie).
  moveBody: function (ctx, b, frame, raw, off, free) {
    var snap = ctx.snap;
    if (!this.objOn(snap, off)) {
      return { x: this.len(raw.model.x, snap, off, free), y: this.len(raw.model.y, snap, off, free), hit: null };
    }
    var draw = frame ? frame.draw : { z: b.pose.z || 0, rot: b.pose.rot || 0 };
    var F = this.features(b, { x: raw.world.x, y: raw.world.y, z: draw.z || 0, rot: draw.rot || 0 });
    var tol = ctx.tol, dx = 0, dy = 0, lock = {}, hit = null, z;

    var A = this.edgeContact(ctx, F);
    var B = this.nearestPoint(ctx, F.pts);
    if (A && (!B || Math.abs(A.dn) <= B.d)) {
      dx = A.e.n.x * A.dn; dy = A.e.n.y * A.dn;
      // Entlang der Kante: Ecken bzw. Mitten aufeinander
      var bt = null;
      [A.e.a, A.e.b, A.e.mid].forEach(function (p) {
        [A.g.a, A.g.b, A.g.mid].forEach(function (q) {
          var dt = (q.x - p.x - dx) * A.e.t.x + (q.y - p.y - dy) * A.e.t.y;
          if (Math.abs(dt) < tol && (!bt || Math.abs(dt) < Math.abs(bt))) bt = dt;
        });
      });
      if (bt !== null) { dx += A.e.t.x * bt; dy += A.e.t.y * bt; }
      if (bt !== null || (Math.abs(A.e.n.x) < 1 - 1e-9 && Math.abs(A.e.n.y) < 1 - 1e-9)) {
        lock = { x: raw.world.x + dx, y: raw.world.y + dy };
      } else if (Math.abs(A.e.n.x) > 1 - 1e-9) lock.x = raw.world.x + dx;
      else lock.y = raw.world.y + dy;
      var m = this.overlapMid(A.e, A.g, dx, dy);
      var isEnd = F.belt && A.f.belt && A.e.end && A.g.end;
      hit = this.hit(isEnd ? 'end' : 'edge', m.x, m.y, A.f);
      if (isEnd) {
        // Bündig: gleiche Oberkante wie die andere Fläche; vordere Stirnkante = er liefert
        var zw = MF.geom.round6(A.f.top - b.shape.h);
        z = MF.geom.round6(zw - ((draw.z || 0) - ((frame ? frame.pose.z : b.pose.z) || 0)));
        hit.text += A.e.end === 'front' ? ' (liefert, bündig)' : ' (nimmt ab, bündig)';
      }
    } else if (B) {
      dx = B.q.x - B.p.x; dy = B.q.y - B.p.y;
      lock = { x: raw.world.x + dx, y: raw.world.y + dy };
      // Liegen danach die Mittelpunkte aufeinander, ist das die bessere Meldung
      var c = F.pts[0], fc = B.f.pts[0];
      var centered = Math.abs(c.x + dx - fc.x) < 1e-9 && Math.abs(c.y + dy - fc.y) < 1e-9;
      hit = centered ? this.hit('center', fc.x, fc.y, B.f) : this.hit(B.q.kind, B.q.x, B.q.y, B.f);
    }
    if (lock.x === undefined || lock.y === undefined) {
      var moved = F.pts.map(function (p) { return { x: p.x + dx, y: p.y + dy }; });
      var al = {};   // schon festgelegte Achsen nicht noch einmal ausrichten
      if (lock.x !== undefined) al.x = 0;
      if (lock.y !== undefined) al.y = 0;
      hit = this.align(ctx, moved, al, hit, true);
      if (lock.x === undefined && al.x !== undefined) lock.x = raw.world.x + dx + al.x;
      if (lock.y === undefined && al.y !== undefined) lock.y = raw.world.y + dy + al.y;
    }
    var r = this.compose(raw.world, lock, raw.model, frame, snap, off, free);
    r.hit = r.locked ? hit : null;
    if (r.hit && z !== undefined) r.z = z;
    return r;
  },

  // ---------- Suche ----------

  // Nächstes Paar (eigener Punkt p, Zielpunkt q) in Reichweite: { p, q, f, d } oder null.
  // Bei gleichem Abstand gewinnt die Ecke vor der Mitte vor dem Mittelpunkt.
  nearestPoint: function (ctx, own) {
    var best = null, rank = { corner: 0, mid: 1, quad: 1, center: 2 };
    ctx.targets.forEach(function (f) {
      f.pts.forEach(function (q) {
        own.forEach(function (p) {
          var d = Math.sqrt((q.x - p.x) * (q.x - p.x) + (q.y - p.y) * (q.y - p.y));
          if (d >= ctx.tol) return;
          if (!best || d < best.d - 1e-9 || (Math.abs(d - best.d) <= 1e-9 && rank[q.kind] < rank[best.q.kind])) {
            best = { p: p, q: q, f: f, d: d };
          }
        });
      });
    });
    return best;
  },

  // Nächste Kante unter dem Weltpunkt w: { q, edge, f, d } oder null
  nearestEdge: function (ctx, w) {
    var best = null;
    ctx.targets.forEach(function (f) {
      f.edges.forEach(function (e) {
        var q = MF.geom.nearestOnSegment(w, e.a, e.b);
        if (q.dist < ctx.tol && (!best || q.dist < best.d)) best = { q: { x: q.x, y: q.y }, edge: e, f: f, d: q.dist };
      });
    });
    return best;
  },

  // Kante des Körpers F, die bündig an einer gegenüberliegenden, parallelen Kante
  // eines Ziels liegen kann: { e, g, f, dn } (dn = Weg entlang e.n) oder null.
  // Bei gleichem Abstand gewinnen Bandenden.
  edgeContact: function (ctx, F) {
    var best = null, tol = ctx.tol, par = this.PARALLEL;
    F.edges.forEach(function (e) {
      ctx.targets.forEach(function (f) {
        f.edges.forEach(function (g) {
          if (e.n.x * g.n.x + e.n.y * g.n.y > -par) return;
          var dn = (g.a.x - e.a.x) * e.n.x + (g.a.y - e.a.y) * e.n.y;
          if (Math.abs(dn) >= tol) return;
          var s1 = (g.a.x - e.a.x) * e.t.x + (g.a.y - e.a.y) * e.t.y;
          var s2 = (g.b.x - e.a.x) * e.t.x + (g.b.y - e.a.y) * e.t.y;
          if (Math.min(e.len, Math.max(s1, s2)) - Math.max(0, Math.min(s1, s2)) <= -tol) return;
          var end = F.belt && f.belt && e.end && g.end;
          if (!best || Math.abs(dn) < Math.abs(best.dn) - 1e-9 ||
              (Math.abs(Math.abs(dn) - Math.abs(best.dn)) <= 1e-9 && end && !best.end)) {
            best = { e: e, g: g, f: f, dn: dn, end: end };
          }
        });
      });
    });
    return best;
  },

  // Mitte des gemeinsamen Stücks zweier anliegender Kanten (e um dx, dy verschoben)
  overlapMid: function (e, g, dx, dy) {
    var a = { x: e.a.x + dx, y: e.a.y + dy };
    var s1 = (g.a.x - a.x) * e.t.x + (g.a.y - a.y) * e.t.y, s2 = (g.b.x - a.x) * e.t.x + (g.b.y - a.y) * e.t.y;
    var s = (Math.max(0, Math.min(s1, s2)) + Math.min(e.len, Math.max(s1, s2))) / 2;
    return { x: a.x + e.t.x * s, y: a.y + e.t.y * s };
  },

  // Flucht: freie Achsen von lock festlegen, wenn ein eigener Punkt auf derselben
  // x- bzw. y-Linie liegt wie ein Punkt eines Ziels. Schreibt in lock die Welt-
  // koordinate bzw. mit offset = true den Versatz (Körper verschieben).
  align: function (ctx, own, lock, hit, offset) {
    var bx = null, by = null, tol = ctx.tol;
    ctx.targets.forEach(function (f) {
      f.pts.forEach(function (q) {
        own.forEach(function (p) {
          var ddx = q.x - p.x, ddy = q.y - p.y;
          if (lock.x === undefined && Math.abs(ddx) < tol && (!bx || Math.abs(ddx) < Math.abs(bx.d))) bx = { d: ddx, p: p, q: q, f: f };
          if (lock.y === undefined && Math.abs(ddy) < tol && (!by || Math.abs(ddy) < Math.abs(by.d))) by = { d: ddy, p: p, q: q, f: f };
        });
      });
    });
    if (!bx && !by) return hit;
    if (bx) lock.x = offset ? bx.d : bx.q.x;
    if (by) lock.y = offset ? by.d : by.q.y;
    if (!hit) {
      var first = bx || by, names = [first.f.id];
      if (bx && by && by.f.id !== bx.f.id) names.push(by.f.id);
      hit = this.hit('align', null, null, null);
      hit.text = 'in Flucht mit ' + names.join(' und ');
    }
    hit.guides = hit.guides || [];
    // Hilfslinien vom Ziel bis zum eigenen Punkt (nach dem Fangen)
    if (bx) hit.guides.push({ x1: bx.q.x, y1: bx.q.y, x2: bx.q.x, y2: bx.p.y + (by ? by.d : 0) });
    if (by) hit.guides.push({ x1: by.q.x, y1: by.q.y, x2: by.p.x + (bx ? bx.d : 0), y2: by.q.y });
    return hit;
  },

  WHAT: {
    corner: 'an Ecke von ', mid: 'an Kantenmitte von ', center: 'an Mitte von ', quad: 'an Quadrant von ',
    edge: 'an Kante von ', end: 'an Bandende von '
  },

  // Marker und Text der Statusleiste: { kind, x, y (Welt), id, text, guides }
  hit: function (kind, x, y, f) {
    return { kind: kind, x: x, y: y, id: f ? f.id : null, text: f ? this.WHAT[kind] + f.id : '', guides: null };
  }
};
