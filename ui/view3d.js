// 3D-Ansicht zum Zuschauen (Three.js, lib/three.js). Bearbeitet wird in der Draufsicht.
//
// Die Ansicht liest Modell und Engine nur. Sie ändert nichts an Simulation oder
// Modell – außer der Auswahl (MF.store.select) und dem Kamera-Stand (view.camera3d,
// gespeichert mit Datei und Autosave, nicht im Verlauf).
//
// Aufbau (Konzept, Abschnitt 1): Alle Körper und Kisten hängen in einer Gruppe mit
// scale.y = −1, darin gelten die Mini-Fabrik-Koordinaten (y in der Draufsicht nach
// unten). Die Kamera steht außerhalb der Gruppe mit camera.up = (0, 0, 1). So zeigt
// die 3D-Ansicht dieselbe Seite wie die Draufsicht (nicht spiegelverkehrt).
//
// Rechnung ohne Three.js (Prisma, Interpolation, Spiegelung, Kamera) steht in
// ui/view3d-core.js. Diese Datei lädt auch ohne Three.js und DOM (Tests): Three.js
// wird erst in start() benutzt, wenn die Ansicht zum ersten Mal sichtbar wird.
window.MF = window.MF || {};

MF.view3d = {
  camera3d: null,     // Kamera-Stand { pos, target } in Mini-Fabrik-Koordinaten, für die Datei
  needFit: true,      // beim nächsten Bild einpassen (kein gespeicherter Stand)
  visible: false,
  ready: false,       // Renderer läuft
  failed: '',         // Grund, warum es keine 3D-Ansicht gibt
  dirty: true,        // neu zeichnen
  needSync: true,     // Modell geändert: Meshes abgleichen
  SAVE_MS: 400,       // Kamera erst speichern, wenn sie so lange ruht

  // ---------- Kamera-Stand (auch ohne Three.js, für Datei und Tests) ----------

  // Für view.camera3d: Kopie oder null
  cameraData: function () {
    return this.camera3d ? JSON.parse(JSON.stringify(this.camera3d)) : null;
  },

  // Aus Datei oder Autosave: Stand übernehmen; null/ungültig = einpassen
  setCamera: function (data) {
    this.camera3d = MF.view3dCore.normCamera(data);
    this.needFit = !this.camera3d;
    if (this.ready && this.camera3d) this.applyCamera(this.camera3d);
    this.dirty = true;
  },

  // Bedienung hat die Kamera bewegt: merken und gedrosselt sichern.
  // Kein MF.store.changed() – die Kamera ist kein Schritt im Verlauf und macht
  // die Anlage nicht "ungespeichert".
  cameraChanged: function (data) {
    var c = MF.view3dCore.normCamera(data);
    if (!c) return;
    this.camera3d = c;
    this.needFit = false;
    if (MF.file && MF.file.scheduleAutosave) MF.file.scheduleAutosave();
  },

  // ---------- Start ----------

  // host: Element, in das der Renderer kommt; hint: Element für den Hinweis ohne WebGL.
  // Legt noch keinen Renderer an – das passiert erst, wenn die Ansicht sichtbar wird.
  init: function (host, hint) {
    var self = this;
    this.host = host;
    this.hint = hint;
    MF.store.on(function (reason) {
      if (reason === 'change') self.needSync = true;
      self.dirty = true;
    });
    MF.engine.on(function () { self.dirty = true; });
  },

  // Sichtbar (nebeneinander oder nur 3D) bzw. verborgen (nur Draufsicht)
  setVisible: function (v) {
    this.visible = !!v;
    if (this.visible && !this.ready && !this.failed) this.start();
    this.dirty = true;
  },

  start: function () {
    var T = window.THREE;
    if (!T || !window.THREE_ADDONS || !window.THREE_ADDONS.OrbitControls) {
      return this.fail('lib/three.js fehlt.');
    }
    var renderer;
    try {
      renderer = new T.WebGLRenderer({ antialias: true });
    } catch (e) {
      return this.fail('Dieser Browser kann kein WebGL.');
    }
    if (!renderer.getContext()) return this.fail('Dieser Browser kann kein WebGL.');
    this.T = T;
    this.renderer = renderer;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFShadowMap;   // PCFSoftShadowMap gibt es in r186 nicht mehr
    this.host.appendChild(renderer.domElement);

    this.initScene();
    this.initControls();
    this.initPicking();

    var self = this;
    var canvas = renderer.domElement;
    canvas.addEventListener('webglcontextlost', function (e) {
      e.preventDefault();
      self.showHint('3D-Ansicht unterbrochen (WebGL-Kontext verloren). Die Draufsicht funktioniert weiter.');
    });
    canvas.addEventListener('webglcontextrestored', function () {
      self.showHint('');
      self.dirty = true;
    });
    if (window.ResizeObserver) new ResizeObserver(function () { self.resize(); }).observe(this.host);

    this.ready = true;
    this.resize();
    if (this.camera3d) this.applyCamera(this.camera3d);
    this.lastKey = '';
    (function loop() {
      self.frame();
      window.requestAnimationFrame(loop);
    })();
  },

  fail: function (why) {
    this.failed = why;
    this.showHint('Keine 3D-Ansicht: ' + why + ' Die Draufsicht funktioniert wie gewohnt.');
    if (window.console) console.warn('Mini-Fabrik: ' + why);
  },

  showHint: function (text) {
    if (!this.hint) return;
    this.hint.textContent = text;
    this.hint.hidden = !text;
  },

  // ---------- Szene ----------

  initScene: function () {
    var T = this.T;
    var scene = new T.Scene();
    scene.background = new T.Color('#E9ECF0');

    // Gespiegelte Gruppe: darin gelten die Koordinaten der Mini-Fabrik
    var world = new T.Group();
    world.scale.y = -1;
    scene.add(world);

    var camera = new T.PerspectiveCamera(MF.view3dCore.FOV, 1, 0.05, 500);
    camera.up.set(0, 0, 1);
    camera.position.set(0, -8, 6);

    var hemi = new T.HemisphereLight(0xffffff, 0x8899aa, 1.2);
    hemi.position.set(0, 0, 1);
    scene.add(hemi);

    // Sonne von vorn links oben (Mini-Fabrik-Koordinaten, in der Gruppe)
    var sun = new T.DirectionalLight(0xffffff, 2.2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0005;
    world.add(sun);
    world.add(sun.target);

    // Boden bei z = 0, knapp darunter, damit Unterseiten auf dem Boden nicht flimmern
    var floor = new T.Mesh(new T.PlaneGeometry(400, 400),
      new T.MeshStandardMaterial({ color: '#DADFE5', roughness: 1 }));
    floor.position.z = -0.002;
    floor.receiveShadow = true;
    world.add(floor);

    var bodies = new T.Group(), boxes = new T.Group();
    world.add(bodies);
    world.add(boxes);

    this.scene = scene;
    this.world = world;
    this.camera = camera;
    this.sun = sun;
    this.bodyGroup = bodies;
    this.boxGroup = boxes;
    this.items = {};        // Körper-ID -> Darstellung (siehe buildItem)
    this.boxMeshes = {};    // Kisten-ID -> Mesh
    this.boxPool = [];      // freie Kisten-Meshes zum Wiederverwenden
    this.boxGeos = {};      // Form -> { geo, used } (alle Kisten einer Form teilen sie)
    this.boxMats = {};      // Farbe -> { mat, used }
    this.grid = null;
    this.gridKey = '';
    this.selection = null;  // Hervorhebung { id, lines }
    this.tmpQ = { x: 0, y: 0, z: 0, w: 1 };
  },

  initControls: function () {
    var self = this;
    var controls = new window.THREE_ADDONS.OrbitControls(this.camera, this.renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.maxPolarAngle = Math.PI * 0.495;   // nicht unter den Boden
    controls.minDistance = 0.5;
    controls.maxDistance = 200;
    controls.screenSpacePanning = true;
    controls.addEventListener('change', function () {
      self.dirty = true;
      // Speichern erst, wenn die Kamera (samt Nachlauf) ruht
      clearTimeout(self.saveTimer);
      self.saveTimer = setTimeout(function () { self.cameraChanged(self.viewCamera()); }, self.SAVE_MS);
    });
    this.controls = controls;
  },

  // Kamera-Stand in Mini-Fabrik-Koordinaten
  viewCamera: function () {
    var C = MF.view3dCore;
    var p = C.fromScene(this.camera.position), t = C.fromScene(this.controls.target);
    return { pos: [p.x, p.y, p.z], target: [t.x, t.y, t.z] };
  },

  applyCamera: function (c) {
    var C = MF.view3dCore;
    var p = C.toScene({ x: c.pos[0], y: c.pos[1], z: c.pos[2] });
    var t = C.toScene({ x: c.target[0], y: c.target[1], z: c.target[2] });
    this.camera.position.set(p.x, p.y, p.z);
    this.controls.target.set(t.x, t.y, t.z);
    this.controls.update();
    this.dirty = true;
  },

  // Alle sichtbaren Körper ins Bild ("Ansicht einpassen")
  fit: function () {
    var c = MF.view3dCore.fitCamera(MF.view3dCore.bounds(MF.model.bodies), this.aspect || 1.5);
    this.needFit = false;
    if (this.ready) this.applyCamera(c);
    this.cameraChanged(c);
  },

  resize: function () {
    if (!this.ready) return;
    var w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.aspect = w / h;
    this.camera.aspect = this.aspect;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.dirty = true;
  },

  // ---------- Körper ----------

  // Modell und Meshes abgleichen: neue, geänderte und gelöschte Körper.
  // Nur wer sich im Aufbau geändert hat (MF.view3dCore.bodyKey), wird neu gebaut;
  // Lage, Achse, Band und Sensor liest frame() in jedem Bild.
  syncBodies: function () {
    var self = this, seen = {};
    MF.model.bodies.forEach(function (b) {
      seen[b.id] = true;
      var key = MF.view3dCore.bodyKey(b);
      var it = self.items[b.id];
      if (it && it.key !== key) { self.disposeItem(it); it = null; }
      if (!it) it = self.items[b.id] = self.buildItem(b, key);
      it.body = b;   // nach Laden/Undo kann es ein neues Objekt sein
    });
    Object.keys(this.items).forEach(function (id) {
      if (!seen[id]) { self.disposeItem(self.items[id]); delete self.items[id]; }
    });
    this.updateGround();
    this.updateSelection();
    this.pruneBoxCache();
    this.needSync = false;
  },

  // Three-Geometrie aus dem Prisma (MF.view3dCore.prism). Werkstoffe: 0 oben, 1 Seite, 2 unten.
  geometry: function (data, dz) {
    var T = this.T, geo = new T.BufferGeometry();
    var pos = data.position;
    if (dz) pos = pos.map(function (v, i) { return i % 3 === 2 ? v + dz : v; });
    geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new T.Float32BufferAttribute(data.normal, 3));
    geo.setAttribute('uv', new T.Float32BufferAttribute(data.uv, 2));
    geo.setIndex(data.index);
    var slot = { top: 0, side: 1, bottom: 2 };
    data.groups.forEach(function (g) { geo.addGroup(g.start, g.count, slot[g.role]); });
    return geo;
  },

  // Darstellung eines Körpers: { key, body, group, mesh, geo, mats, lines, tex, arrow, look }
  buildItem: function (b, key) {
    var T = this.T, C = MF.view3dCore;
    var it = { key: key, body: b, mats: [], geos: [], tex: null, arrow: null, busy: null };
    var group = new T.Group();
    var data = C.prism(b.shape, { uvDir: b.surface ? b.surface.dir : 0, roll: MF.geom.rollOf(b) });
    var geo = this.geometry(data);
    it.geo = geo;
    it.geos.push(geo);
    var lk = C.look(b, false);
    var mesh;

    if (lk.solid) {
      var side = new T.MeshStandardMaterial({ color: lk.color, roughness: 0.7,
        metalness: b.kind === 'kinematic' ? 0.35 : 0.05 });
      var top = side;
      if (b.surface) {
        it.tex = this.stripeTexture(lk.color);
        top = new T.MeshStandardMaterial({ map: it.tex, roughness: 0.9 });
      }
      it.mats.push(side);
      if (top !== side) it.mats.push(top);
      mesh = new T.Mesh(geo, [top, side, side]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    } else {
      var mat = new T.MeshStandardMaterial({ color: lk.color, transparent: true, opacity: lk.opacity,
        depthWrite: false, side: T.DoubleSide, roughness: 1 });
      it.mats.push(mat);
      it.ghostMat = mat;
      mesh = new T.Mesh(geo, mat);
      mesh.renderOrder = 2;   // durchscheinend nach den festen Körpern
    }
    mesh.userData.bodyId = b.id;
    group.add(mesh);
    it.mesh = mesh;

    // Kanten: bei ghost und kinematic in der Körperfarbe
    if (lk.edge) {
      var eg = new T.EdgesGeometry(geo, 30);
      var em = new T.LineBasicMaterial({ color: lk.edge, transparent: true, opacity: lk.solid ? 0.6 : 0.85 });
      it.geos.push(eg);
      it.mats.push(em);
      it.edgeMat = em;
      group.add(new T.LineSegments(eg, em));
    }
    if (b.sink) this.addSinkCross(it, group, b.shape);
    if (b.surface) this.addArrow(it, group, b);

    group.visible = b.look.visible !== false;
    this.bodyGroup.add(group);
    it.group = group;
    return it;
  },

  // Senke: Kreuz auf der Oberseite (wie in der Draufsicht)
  addSinkCross: function (it, group, shape) {
    var T = this.T;
    var e = MF.view3dCore.surfaceExtent(shape, 0), x = e.ex * 0.6, y = e.ey * 0.6, z = shape.h;
    var geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute([-x, -y, z, x, y, z, x, -y, z, -x, y, z], 3));
    var mat = new T.LineBasicMaterial({ color: '#1B2430' });
    it.geos.push(geo);
    it.mats.push(mat);
    group.add(new T.LineSegments(geo, mat));
  },

  // Transportfläche: Pfeil am Ende in Laufrichtung, orange wenn sie läuft, sonst grau
  addArrow: function (it, group, b) {
    var T = this.T, C = MF.view3dCore;
    var e = C.surfaceExtent(b.shape, b.surface.dir);
    var a = Math.min(0.15, e.ey * 0.6), tip = e.ex - 0.1;
    var z = C.topZ(b.shape, 0, 0) + 0.003;
    var geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute([
      tip - a * 1.6, -a, z, tip, 0, z, tip - a * 1.6, a, z], 3));
    geo.setAttribute('normal', new T.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    var mat = new T.MeshBasicMaterial({ color: C.COLORS.arrowOff, side: T.DoubleSide });
    var mesh = new T.Mesh(geo, mat);
    mesh.rotation.z = MF.geom.rad(b.surface.dir);
    it.geos.push(geo);
    it.mats.push(mat);
    it.arrow = mat;
    it.arrowOn = null;
    group.add(mesh);
  },

  // Streifen quer zur Laufrichtung in der Bandfarbe; je Band eine eigene Textur,
  // damit jedes Band seine Streifen selbst verschiebt
  stripeTexture: function (color) {
    var T = this.T;
    var c = document.createElement('canvas');
    c.width = 64; c.height = 8;
    var g = c.getContext('2d');
    g.fillStyle = color;
    g.fillRect(0, 0, 64, 8);
    g.fillStyle = 'rgba(244, 242, 236, 0.22)';
    g.fillRect(0, 0, 6, 8);
    var tex = new T.CanvasTexture(c);
    tex.wrapS = tex.wrapT = T.RepeatWrapping;
    tex.repeat.set(1 / MF.view3dCore.STRIPE_M, 1);   // u in Metern: ein Streifen je 25 cm
    if (T.SRGBColorSpace) tex.colorSpace = T.SRGBColorSpace;
    return tex;
  },

  disposeItem: function (it) {
    if (this.selection && this.selection.id === it.body.id) this.clearSelection();
    this.bodyGroup.remove(it.group);
    it.geos.forEach(function (g) { g.dispose(); });
    it.mats.forEach(function (m) { m.dispose(); });
    if (it.tex) it.tex.dispose();
  },

  // Boden-Raster (1 m, kräftiger alle 5 m) und Schatten an die Anlage anpassen
  updateGround: function () {
    var T = this.T;
    var b = MF.view3dCore.bounds(MF.model.bodies) || { x0: -2, y0: -2, z0: 0, x1: 2, y1: 2, z1: 1 };
    var cx = Math.round((b.x0 + b.x1) / 2 / 5) * 5, cy = Math.round((b.y0 + b.y1) / 2 / 5) * 5;
    var size = Math.ceil((Math.max(b.x1 - b.x0, b.y1 - b.y0) + 20) / 10) * 10;
    var key = [cx, cy, size].join(',');
    if (key !== this.gridKey) {
      if (this.grid) {
        this.world.remove(this.grid);
        this.grid.children.forEach(function (g) { g.geometry.dispose(); g.material.dispose(); });
      }
      var grid = new T.Group();
      [[size, 0xB4BCC6, 0.55], [size / 5, 0x8E98A4, 0.7]].forEach(function (d) {
        var h = new T.GridHelper(size, d[0], d[1], d[1]);
        h.material.transparent = true;
        h.material.opacity = d[2];
        h.material.depthWrite = false;
        h.rotation.x = Math.PI / 2;   // GridHelper liegt in x-z, hier in x-y
        grid.add(h);
      });
      grid.position.set(cx, cy, 0.001);
      this.world.add(grid);
      this.grid = grid;
      this.gridKey = key;
    }
    // Schattenkamera über die ganze Anlage
    var mx = (b.x0 + b.x1) / 2, my = (b.y0 + b.y1) / 2;
    var r = Math.max(b.x1 - b.x0, b.y1 - b.y0) / 2 + 2;
    this.sun.position.set(mx - 3, my + 5, 10);
    this.sun.target.position.set(mx, my, 0);
    var sh = this.sun.shadow.camera;
    sh.left = -r * 1.3; sh.right = r * 1.3; sh.top = r * 1.3; sh.bottom = -r * 1.3;
    sh.near = 1; sh.far = 30 + r;
    sh.updateProjectionMatrix();
  },

  // ---------- Auswahl ----------

  // Hervorhebung des gewählten Körpers: orangefarbene Kanten (auch durch andere hindurch)
  // und ein leichtes Leuchten bei festen Körpern
  updateSelection: function () {
    var id = MF.store.selectedId;
    if (this.selection && this.selection.id === id && this.items[id] && this.selection.item === this.items[id]) return;
    this.clearSelection();
    var it = this.items[id];
    if (!it) return;
    var T = this.T;
    var eg = new T.EdgesGeometry(it.geo, 30);
    var em = new T.LineBasicMaterial({ color: MF.view3dCore.COLORS.select, depthTest: false, transparent: true });
    var lines = new T.LineSegments(eg, em);
    lines.renderOrder = 10;
    it.group.add(lines);
    it.mats.forEach(function (m) { if (m.emissive) m.emissive.set('#3A1C00'); });
    this.selection = { id: id, item: it, lines: lines };
  },

  clearSelection: function () {
    var s = this.selection;
    if (!s) return;
    s.item.group.remove(s.lines);
    s.lines.geometry.dispose();
    s.lines.material.dispose();
    s.item.mats.forEach(function (m) { if (m.emissive) m.emissive.set('#000000'); });
    this.selection = null;
  },

  // Klick ohne Ziehen wählt den Körper darunter (Kisten nicht); Ziehen dreht die Kamera
  initPicking: function () {
    var self = this, T = this.T, canvas = this.renderer.domElement;
    var down = null;
    this.raycaster = new T.Raycaster();
    canvas.addEventListener('pointerdown', function (e) {
      down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
      // Fokus aus Baum oder Eingabefeld nehmen (wie in der Draufsicht)
      if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    });
    canvas.addEventListener('pointerup', function (e) {
      if (!down || e.button !== 0) return;
      var moved = Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y);
      down = null;
      if (moved > 4) return;
      var hit = self.pick(e.clientX, e.clientY);
      MF.store.select(hit);
    });
  },

  // ID des sichtbaren Körpers unter dem Bildschirmpunkt, sonst null
  pick: function (clientX, clientY) {
    var r = this.renderer.domElement.getBoundingClientRect();
    var ndc = new this.T.Vector2((clientX - r.left) / r.width * 2 - 1, -(clientY - r.top) / r.height * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    var meshes = [], self = this;
    Object.keys(this.items).forEach(function (id) {
      var it = self.items[id];
      if (it.group.visible) meshes.push(it.mesh);
    });
    var hits = this.raycaster.intersectObjects(meshes, false);
    return hits.length ? hits[0].object.userData.bodyId : null;
  },

  // ---------- Kisten ----------

  // Gemeinsame Geometrie je Form: Prisma um den Mittelpunkt (Lage der Kiste = Mitte)
  boxGeometry: function (shape) {
    var key = JSON.stringify(shape), e = this.boxGeos[key];
    if (!e) e = this.boxGeos[key] = { geo: this.geometry(MF.view3dCore.prism(shape), -shape.h / 2), used: 0 };
    return e;
  },

  boxMaterial: function (color) {
    var e = this.boxMats[color];
    if (!e) e = this.boxMats[color] = { mat: new this.T.MeshStandardMaterial({ color: color, roughness: 0.85 }), used: 0 };
    return e;
  },

  // Geometrien und Werkstoffe, die keine Kiste mehr benutzt, freigeben
  pruneBoxCache: function () {
    var self = this;
    Object.keys(this.boxGeos).forEach(function (k) {
      if (!self.boxGeos[k].used) { self.boxGeos[k].geo.dispose(); delete self.boxGeos[k]; }
    });
    Object.keys(this.boxMats).forEach(function (k) {
      if (!self.boxMats[k].used) { self.boxMats[k].mat.dispose(); delete self.boxMats[k]; }
    });
  },

  // Kisten der Engine zeigen: neue bekommen ein Mesh (aus dem Vorrat), entfernte geben
  // ihres zurück. Meshes besitzen nichts selbst, Geometrie und Werkstoff sind geteilt.
  updateBoxes: function (alpha) {
    var C = MF.view3dCore, boxes = MF.engine.boxes, seen = {}, i, m;
    for (i = 0; i < boxes.length; i++) {
      var bx = boxes[i];
      m = this.boxMeshes[bx.id];
      if (!m) {
        m = this.boxPool.pop() || this.newBoxMesh();
        var g = this.boxGeometry(bx.shape), mt = this.boxMaterial(bx.color);
        g.used++; mt.used++;
        m.geometry = g.geo; m.material = mt.mat;
        m.userData.geo = g; m.userData.mat = mt;
        m.visible = true;
        this.boxMeshes[bx.id] = m;
      }
      seen[bx.id] = true;
      var p = bx.prev || bx.cur, c = bx.cur;
      m.position.set(C.lerp(p.x, c.x, alpha), C.lerp(p.y, c.y, alpha), C.lerp(p.z, c.z, alpha));
      var q = C.slerp(p.q, c.q, alpha, this.tmpQ);
      m.quaternion.set(q.x, q.y, q.z, q.w);
    }
    for (var id in this.boxMeshes) {
      if (seen[id]) continue;
      m = this.boxMeshes[id];
      m.userData.geo.used--; m.userData.mat.used--;
      m.visible = false;
      this.boxPool.push(m);
      delete this.boxMeshes[id];
    }
    // Vorrat nicht endlos halten (z. B. nach 200 Kisten auf einmal)
    while (this.boxPool.length > 64) this.boxGroup.remove(this.boxPool.pop());
  },

  newBoxMesh: function () {
    var m = new this.T.Mesh();
    m.castShadow = true;
    m.receiveShadow = true;
    this.boxGroup.add(m);
    return m;
  },

  // ---------- Zeichnen ----------

  // Woran man im Stillstand erkennt, dass sich das Bild geändert hat:
  // Schritt (Einzelschritt, Reset), Zustand, Sensoren und Bänder (von Hand gesetzt)
  stateKey: function () {
    var e = MF.engine, parts = [e.ticks, e.state];
    MF.model.bodies.forEach(function (b) {
      if (b.sensor) parts.push(e.signal(b, 'Belegt'));
      if (b.surface) parts.push(e.surfaceSpeed(b));
    });
    return parts.join(',');
  },

  // Ein Bild: läuft die Simulation, immer; sonst nur bei Änderung oder Kamerabewegung
  frame: function () {
    if (!this.visible || !this.ready) return;
    var moving = this.controls.update();   // Nachlauf der Kamera
    var running = MF.engine.state === 'running';
    if (!running) {
      var key = this.stateKey();
      if (key !== this.lastKey) { this.lastKey = key; this.dirty = true; }
    }
    if (!running && !moving && !this.dirty && !this.needSync) return;
    if (this.needSync) this.syncBodies();
    if (this.needFit) this.fit();
    this.updateSelection();
    this.draw(MF.engine.alpha());
    this.dirty = false;
  },

  draw: function (alpha) {
    var C = MF.view3dCore, self = this;
    Object.keys(this.items).forEach(function (id) {
      var it = self.items[id], b = it.body;
      var pose = MF.sim.drawPose(b);   // kinematisch: Achse zwischen zwei Schritten
      it.group.position.set(pose.x, pose.y, pose.z);
      it.group.rotation.z = MF.geom.rad(pose.rot || 0);
      if (it.tex) {
        var s = C.travel(b.rt, alpha) / C.STRIPE_M;
        it.tex.offset.x = -(s - Math.floor(s));
      }
      if (it.arrow) {
        var on = MF.engine.surfaceSpeed(b) > 0;
        if (on !== it.arrowOn) { it.arrow.color.set(on ? C.COLORS.arrowOn : C.COLORS.arrowOff); it.arrowOn = on; }
      }
      if (b.sensor && it.ghostMat) {
        var busy = !!MF.engine.signal(b, 'Belegt');
        if (busy !== it.busy) {
          var lk = C.look(b, busy);
          it.ghostMat.color.set(lk.color);
          it.ghostMat.opacity = lk.opacity;
          if (it.edgeMat) it.edgeMat.color.set(lk.edge);
          it.busy = busy;
        }
      }
    });
    this.updateBoxes(alpha);
    this.renderer.render(this.scene, this.camera);
  },

  // Für die Prüfung auf Speicherlecks (Konsole: MF.view3d.stats())
  stats: function () {
    if (!this.ready) return null;
    var mem = this.renderer.info.memory;
    return { geometries: mem.geometries, textures: mem.textures, boxes: Object.keys(this.boxMeshes).length,
      pool: this.boxPool.length, boxGeometries: Object.keys(this.boxGeos).length,
      boxMaterials: Object.keys(this.boxMats).length, bodies: Object.keys(this.items).length };
  }
};
