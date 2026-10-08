// Einstiegspunkt: verbindet Modell, Fläche, Baum und Eigenschaften.
// Die Physik (Rapier, lib/rapier.js) muss erst ihr WASM laden – das ist
// asynchron. Bis dahin zeigt die Fläche "Lade Physik …", danach startet die App.
(function () {
  var loading = document.getElementById('loading');

  function fail(text) {
    loading.textContent = text;
    if (window.console) console.error('Mini-Fabrik: ' + text);
  }

  function start() {
    var canvas = document.getElementById('canvas');

    // Zuletzt bearbeitete Anlage aus dem Autosave (ältere Versionen werden
    // dabei umgerechnet), sonst bleibt die Beispielanlage
    var restored = MF.file.restoreAutosave();

    MF.sim.init(canvas);
    MF.engine.init();
    MF.logic.init();
    // 3D-Ansicht: legt den Renderer erst an, wenn sie sichtbar wird (MF.ui setzt das Layout)
    MF.view3d.init(document.getElementById('view3d'), document.getElementById('view3d-hint'));
    MF.ui.init();
    MF.sim.resize();   // Layout (nebeneinander/einzeln) steht jetzt – Breite fürs Einpassen
    MF.tree.init();
    MF.props.init();
    MF.signals.init();
    MF.sclEditor.init();
    MF.editor.init(canvas);
    MF.file.init();
    MF.history.init();

    // Jede Änderung oder Auswahl zeichnet Fläche und Statusleiste neu.
    MF.store.on(function () {
      MF.sim.draw();
      MF.ui.updateStatus();
    });

    // Esc hebt die Auswahl auf
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && e.target.tagName !== 'INPUT') MF.store.select(null);
    });

    // Start: gesicherte Ansicht übernehmen bzw. Beispielanlage einpassen und das Förderband auswählen
    if (restored) {
      MF.file.applyView(restored.view);
      MF.sim.draw();
      MF.ui.updateStatus();
    } else {
      MF.sim.fit();
      MF.store.select('B1');
    }
    loading.hidden = true;
  }

  if (!window.RAPIER) {
    fail('Physik-Bibliothek fehlt (lib/rapier.js).');
    return;
  }
  window.RAPIER.init().then(start, function (e) {
    fail('Physik konnte nicht geladen werden: ' + (e && e.message ? e.message : e));
  });
})();
