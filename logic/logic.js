// Logik: Signale und Wenn-dann-Regeln.
// Ausgewertet werden die Regeln erst in Etappe 4 – hier nur die Beschreibung.
window.MF = window.MF || {};

MF.logic = {
  init: function () {},

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
  }
};
