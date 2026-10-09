// Simulationsuhr der Mini-Fabrik.
//
// Die Simulation läuft in festen Zeitschritten (Standard 50 ms), unabhängig
// davon, wie oft der Browser ein Bild zeichnet. Die echte Zeit wird in einem
// Accumulator gesammelt; sobald ein ganzer Schritt zusammen ist, wird genau
// ein Tick ausgeführt. Die Geschwindigkeit (0,25x … 10x) ändert nur, wie viele
// Ticks pro echter Sekunde laufen – nicht die Schrittweite selbst.
//
// Als klassisches Skript geschrieben (kein ES-Modul), damit die Seite auch per
// Doppelklick über file:// läuft. Zugriff über MF.createClock.

(function (global) {
  'use strict';

  var SPEEDS = [0.25, 0.5, 1, 2, 5, 10];
  var DT_OPTIONS_MS = [10, 20, 50, 100];
  var DEFAULT_DT_MS = 50;

  var MAX_FRAME_S = 0.25; // längere Pausen (z. B. Tab im Hintergrund) werden gekappt
  var MAX_STEPS_PER_FRAME = 10; // schützt vor Aufholschleifen bei hoher Geschwindigkeit

  /**
   * @param {object} options
   * @param {(dt: number) => void} options.onTick    ein Simulationsschritt, dt in Sekunden
   * @param {(alpha: number) => void} [options.onRender] Zeichnen, alpha = Anteil bis zum nächsten Tick (0..1)
   * @param {() => void} [options.onReset]          Anlage in den Ausgangszustand versetzen
   * @param {(clock: object) => void} [options.onChange] Zustand der Uhr hat sich geändert (für die UI)
   * @param {number} [options.dtMs]                  Schrittweite in ms (Standard 50)
   */
  function createClock(options) {
    var onTick = options.onTick;
    var onRender = options.onRender || function () {};
    var onReset = options.onReset || function () {};
    var onChange = options.onChange || function () {};

    var dtMs = options.dtMs || DEFAULT_DT_MS;
    var speed = 1;
    var running = false;
    var tickCount = 0;
    var timeMs = 0; // Simulationszeit als ganze Millisekunden, damit nichts driftet
    var accS = 0;
    var lastFrame = null;
    var frameHandle = null;

    function doTick() {
      onTick(dtMs / 1000);
      tickCount++;
      timeMs += dtMs;
    }

    // Echte Zeit einspeisen und so viele feste Schritte ausführen, wie zusammengekommen sind.
    // Gibt die Anzahl der ausgeführten Ticks zurück.
    function advance(realSeconds) {
      if (!running) return 0;
      accS += Math.min(realSeconds, MAX_FRAME_S) * speed;
      var dtS = dtMs / 1000;
      var steps = 0;
      while (accS >= dtS && steps < MAX_STEPS_PER_FRAME) {
        doTick();
        accS -= dtS;
        steps++;
      }
      // Rückstand verwerfen statt ihn ewig mitzuschleppen
      if (steps === MAX_STEPS_PER_FRAME && accS >= dtS) accS = 0;
      if (steps > 0) onChange(api);
      return steps;
    }

    function frame(now) {
      if (lastFrame !== null) advance((now - lastFrame) / 1000);
      lastFrame = now;
      onRender(running ? Math.min(accS / (dtMs / 1000), 1) : 1);
      frameHandle = global.requestAnimationFrame(frame);
    }

    var api = {
      SPEEDS: SPEEDS,
      DT_OPTIONS_MS: DT_OPTIONS_MS,

      get running() { return running; },
      get speed() { return speed; },
      get dtMs() { return dtMs; },
      get tick() { return tickCount; },
      get timeMs() { return timeMs; },

      // Startet die Zeichenschleife (requestAnimationFrame). Einmal beim Laden aufrufen.
      start() {
        if (frameHandle === null) frameHandle = global.requestAnimationFrame(frame);
      },
      stop() {
        if (frameHandle !== null) global.cancelAnimationFrame(frameHandle);
        frameHandle = null;
        lastFrame = null;
      },

      play() {
        if (running) return;
        running = true;
        // Ersten Tick sofort fällig machen: so geht die interpolierte Anzeige
        // nahtlos vom pausierten Zustand aus weiter, ohne Rücksprung.
        accS = dtMs / 1000;
        onChange(api);
      },
      pause() {
        if (!running) return;
        running = false;
        accS = 0;
        onChange(api);
      },
      toggle() {
        running ? api.pause() : api.play();
      },
      // Genau ein Schritt – nur im Pause-Zustand.
      step() {
        if (running) return;
        doTick();
        onChange(api);
      },
      reset() {
        running = false;
        accS = 0;
        tickCount = 0;
        timeMs = 0;
        onReset();
        onChange(api);
      },
      setSpeed(factor) {
        if (!(factor > 0)) throw new Error('Geschwindigkeit muss > 0 sein');
        speed = factor;
        onChange(api);
      },
      // Schrittweite ändern – nur im Pause-Zustand, weil sie das Modellverhalten beeinflusst.
      setDtMs(ms) {
        if (running) throw new Error('Schrittweite nur im Pause-Zustand änderbar');
        if (!(ms > 0) || ms !== Math.round(ms)) throw new Error('Schrittweite muss eine ganze Zahl ms > 0 sein');
        dtMs = ms;
        accS = 0;
        onChange(api);
      },

      advance: advance, // für Tests ohne Browser
    };

    return api;
  }

  // Zeit als "mm:ss" bzw. "mm:ss.t" für die Statusleiste
  function formatTime(ms, withTenths) {
    var totalS = Math.floor(ms / 1000);
    var m = Math.floor(totalS / 60), sec = totalS % 60;
    var mm = (m < 10 ? '0' : '') + m;
    var ss = (sec < 10 ? '0' : '') + sec;
    return withTenths ? mm + ':' + ss + '.' + Math.floor((ms % 1000) / 100) : mm + ':' + ss;
  }

  global.MF = global.MF || {};
  global.MF.createClock = createClock;
  global.MF.formatTime = formatTime;
})(typeof window !== 'undefined' ? window : globalThis);
