// Logik: Signale und Wenn-dann-Regeln.
// Eine Regel { when: "LS1.Belegt", then: "S1.Ausfahren" } wirkt wie eine
// SPS-Spule: In jedem Zyklus gilt then := (when != 0). Mehrere Regeln auf
// dasselbe Ziel sind ODER-verknüpft.
window.MF = window.MF || {};

MF.logic = {
  init: function () {},

  // "LS1.Belegt" -> { el, name }; null, wenn es das Element nicht (mehr) gibt
  parse: function (sig) {
    if (!sig) return null;
    var i = sig.indexOf('.');
    if (i < 0) return null;
    var el = MF.store.findElement(sig.slice(0, i));
    return el ? { el: el, name: sig.slice(i + 1) } : null;
  },

  // Regel wird ausgewertet: eingeschaltet und beide Felder gesetzt.
  // Fehlt "enabled" (ältere Dateien), gilt die Regel als aktiv.
  isActive: function (rule) {
    return rule.enabled !== false && !!rule.when && !!rule.then;
  },

  // Ein Logik-Zyklus: alle aktiven Regeln lesen, dann die Ziele schreiben.
  // Erst sammeln, dann schreiben – so sieht jede Regel dasselbe Prozessabbild.
  run: function () {
    var self = this;
    var targets = {};   // "S1.Ausfahren" -> 0/1
    MF.model.rules.forEach(function (r) {
      if (!self.isActive(r)) return;
      var src = self.parse(r.when);
      if (!src || !self.parse(r.then)) return;
      var v = MF.engine.signal(src.el, src.name) !== 0 ? 1 : 0;
      targets[r.then] = (targets[r.then] || 0) | v;
    });
    Object.keys(targets).forEach(function (sig) {
      var t = self.parse(sig);
      MF.engine.setSignal(t.el, t.name, targets[sig]);
    });
  },

  // Regel als lesbarer Satz, z. B. "WENN LS1.Belegt DANN S1.Ausfahren"
  describe: function (rule) {
    return { when: rule.when || '–', then: rule.then || '–' };
  },

  // Welche Regeln ein Signal setzen (für die Spalte "Funktion" der I/O-Tabelle)
  rulesSetting: function (signal) {
    return MF.model.rules.filter(function (r) { return r.then === signal; });
  },

  rulesReading: function (signal) {
    return MF.model.rules.filter(function (r) { return r.when === signal; });
  },

  // Aktive Regeln, die dieses Signal schreiben – dann ist es nicht von Hand änderbar
  activeSetting: function (signal) {
    var self = this;
    return this.rulesSetting(signal).filter(function (r) { return self.isActive(r); });
  }
};
