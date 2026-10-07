// Einstiegspunkt: verbindet Modell, Fläche, Baum und Eigenschaften.
(function () {
  var canvas = document.getElementById('canvas');

  MF.sim.init(canvas);
  MF.engine.init();
  MF.logic.init();
  MF.ui.init();
  MF.tree.init();
  MF.props.init();

  // Jede Änderung oder Auswahl zeichnet Fläche und Statusleiste neu.
  MF.store.on(function () {
    MF.sim.draw();
    MF.ui.updateStatus();
  });

  // ---------- Maus auf der Fläche ----------

  function pos(e) {
    var r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  var drag = null; // Verschieben der Ansicht mit gedrückter Maus auf freier Fläche

  canvas.addEventListener('pointerdown', function (e) {
    var p = pos(e);
    var hit = MF.sim.hitTest(p.x, p.y);
    MF.store.select(hit ? hit.id : null);
    if (!hit) {
      drag = { x: p.x, y: p.y, ox: MF.sim.offsetX, oy: MF.sim.offsetY };
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
    }
  });

  canvas.addEventListener('pointermove', function (e) {
    var p = pos(e);
    MF.ui.setCursor(MF.sim.cellAt(p.x, p.y));
    if (drag) {
      MF.sim.offsetX = drag.ox + (p.x - drag.x);
      MF.sim.offsetY = drag.oy + (p.y - drag.y);
      MF.sim.draw();
    } else {
      canvas.style.cursor = MF.sim.hitTest(p.x, p.y) ? 'pointer' : 'default';
    }
  });

  canvas.addEventListener('pointerup', function () {
    drag = null;
    canvas.style.cursor = 'default';
  });

  canvas.addEventListener('pointerleave', function () {
    if (!drag) MF.ui.setCursor(null);
  });

  // Mausrad / Trackpad: zoomen um den Mauszeiger
  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    var p = pos(e);
    MF.sim.setZoom(MF.sim.zoom * Math.exp(-e.deltaY * 0.0015), p.x, p.y);
    MF.ui.updateStatus();
  }, { passive: false });

  // Esc hebt die Auswahl auf
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && e.target.tagName !== 'INPUT') MF.store.select(null);
  });

  // Start: Anlage einpassen und das Förderband auswählen
  MF.sim.fit();
  MF.store.select('B1');
})();
