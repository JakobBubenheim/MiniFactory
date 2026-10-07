// Einstiegspunkt: verbindet Modell, Fläche, Baum und Eigenschaften.
(function () {
  var canvas = document.getElementById('canvas');

  MF.sim.init(canvas);
  MF.engine.init();
  MF.logic.init();
  MF.ui.init();
  MF.tree.init();
  MF.props.init();
  MF.signals.init();
  MF.sclEditor.init();
  MF.editor.init(canvas);

  // Jede Änderung oder Auswahl zeichnet Fläche und Statusleiste neu.
  MF.store.on(function () {
    MF.sim.draw();
    MF.ui.updateStatus();
  });

  // Esc hebt die Auswahl auf
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && e.target.tagName !== 'INPUT') MF.store.select(null);
  });

  // Start: Anlage einpassen und das Förderband auswählen
  MF.sim.fit();
  MF.store.select('B1');
})();
