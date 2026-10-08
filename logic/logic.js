// Logik: Signale, Wenn-dann-Regeln und SCL-Bausteine.
//
// Zwei Arten von Regeln (rule.kind):
// - 'rule' (Standard): { when: "LS1.Belegt", then: "S1.Ausfahren" } wirkt wie
//   eine SPS-Spule: In jedem Zyklus gilt then := (when != 0). Mehrere Regeln
//   auf dasselbe Ziel sind ODER-verknüpft.
// - 'scl': rule.code ist Structured Text (siehe logic/scl.js) und läuft in
//   jedem Zyklus einmal von oben nach unten – nach den einfachen Regeln, in
//   der Reihenfolge des Strukturbaums (Tiefensuche, siehe order()).
//
// Ziele, die keine aktive Regel mehr schreibt (abgeschaltet, gelöscht,
// umgestellt), fallen auf ihren Startwert zurück, statt hängen zu bleiben.
window.MF = window.MF || {};

MF.logic = {
  owned: {},      // Signale, die im letzten Zyklus von Regeln geschrieben wurden
  units: {},      // Regel-ID -> übersetzter SCL-Code { code, prog, error, state, runError }

  init: function () {
    var self = this;
    // Nach jeder Änderung (z. B. Regel abgeschaltet) Ziele sofort freigeben
    MF.store.on(function (reason) { if (reason === 'change') self.release(); });
  },

  isScl: function (rule) { return rule.kind === 'scl'; },

  // "LS1.Belegt" -> { el, name }; null, wenn es das Element nicht (mehr) gibt
  parse: function (sig) {
    if (!sig) return null;
    var i = sig.indexOf('.');
    if (i < 0) return null;
    var el = MF.store.findElement(sig.slice(0, i));
    return el ? { el: el, name: sig.slice(i + 1) } : null;
  },

  // SCL-Code der Regel, übersetzt und zwischengespeichert.
  // Bei Fehlern läuft die letzte fehlerfreie Fassung weiter.
  unit: function (rule) {
    var u = this.units[rule.id];
    var sig = MF.store.signals().join(',');   // neue/gelöschte Elemente -> neu übersetzen
    if (u && u.code === rule.code && u.sig === sig) return u;
    if (!u) u = this.units[rule.id] = { prog: null, state: null };
    var res = MF.scl.compile(rule.code);
    // Gleicher Code, aber ein benutztes Element fehlt jetzt: nicht weiterlaufen lassen
    if (res.error && u.code === rule.code) u.prog = null;
    u.code = rule.code;
    u.sig = sig;
    u.error = res.error || null;
    if (res.prog) {
      u.state = MF.scl.initState(res.prog, u.state);   // Werte gleichnamiger Variablen bleiben
      u.prog = res.prog;
      u.runError = null;
    }
    return u;
  },

  // Regel wird ausgewertet: eingeschaltet und vollständig bzw. übersetzbar.
  // Fehlt "enabled" (ältere Dateien), gilt die Regel als aktiv.
  isActive: function (rule) {
    if (rule.enabled === false) return false;
    if (this.isScl(rule)) return !!this.unit(rule).prog;
    return !!rule.when && !!rule.then;
  },

  // Signale, die eine Regel schreibt bzw. liest
  writes: function (rule) {
    if (!this.isScl(rule)) return rule.then ? [rule.then] : [];
    var u = this.unit(rule);
    return u.prog ? u.prog.writes : [];
  },

  reads: function (rule) {
    if (!this.isScl(rule)) return rule.when ? [rule.when] : [];
    var u = this.unit(rule);
    return u.prog ? u.prog.reads : [];
  },

  // Regeln in Ausführungsreihenfolge = Reihenfolge im Strukturbaum von oben nach
  // unten (Tiefensuche): Ordner einer Ebene samt Inhalt zuerst, dann die Regeln
  // dieser Ebene, jeweils in der Reihenfolge, in der sie im Baum stehen.
  order: function () {
    return MF.store.treeOrder('logic');
  },

  // Aktive SCL-Bausteine in Ausführungsreihenfolge
  sclOrder: function () {
    var self = this;
    return this.order().filter(function (r) { return self.isScl(r) && self.isActive(r); });
  },

  // Ein Logik-Zyklus. dt in Sekunden (für Zeitglieder in SCL).
  run: function (dt) {
    var self = this;
    var rules = this.order();

    // 1. Einfache Regeln: erst alle lesen, dann schreiben (gleiches Prozessabbild)
    var targets = {};
    rules.forEach(function (r) {
      if (self.isScl(r) || !self.isActive(r)) return;
      var src = self.parse(r.when);
      if (!src || !self.parse(r.then)) return;
      var v = MF.engine.signal(src.el, src.name) !== 0 ? 1 : 0;
      targets[r.then] = (targets[r.then] || 0) | v;
    });
    Object.keys(targets).forEach(function (sig) {
      var t = self.parse(sig);
      MF.engine.setSignal(t.el, t.name, targets[sig]);
    });

    // 2. SCL-Bausteine nacheinander
    rules.forEach(function (r) {
      if (!self.isScl(r) || !self.isActive(r)) return;
      var u = self.unit(r);
      u.runError = MF.scl.run(u.prog, u.state, (dt || 0) * 1000);
    });

    this.release();
  },

  // Ziele, die keine aktive Regel mehr schreibt, auf den Startwert zurücksetzen
  release: function () {
    var self = this;
    var now = {};
    MF.model.rules.forEach(function (r) {
      if (!self.isActive(r)) return;
      self.writes(r).forEach(function (sig) { now[sig] = true; });
    });
    Object.keys(this.owned).forEach(function (sig) {
      if (now[sig]) return;
      var t = self.parse(sig);
      var def = t && MF.engine.ioDef(t.el, t.name);
      if (def && def.dir === 'in' && !def.prop) t.el.inputs[t.name] = def.init || 0;
    });
    this.owned = now;
  },

  // Reset der Simulation: Variablen und Zeitglieder auf Anfang, Ziele auf Startwert
  reset: function () {
    var self = this;
    Object.keys(this.units).forEach(function (id) {
      var u = self.units[id];
      if (u.prog) u.state = MF.scl.initState(u.prog);
      u.runError = null;
    });
    Object.keys(this.owned).forEach(function (sig) {
      var t = self.parse(sig);
      var def = t && MF.engine.ioDef(t.el, t.name);
      if (def && def.dir === 'in' && !def.prop) t.el.inputs[t.name] = def.init || 0;
    });
  },

  // Regel als lesbarer Satz, z. B. "WENN LS1.Belegt DANN S1.Ausfahren"
  describe: function (rule) {
    return { when: rule.when || '–', then: rule.then || '–' };
  },

  // Welche Regeln ein Signal setzen bzw. lesen (Spalte "Funktion" der I/O-Tabelle)
  rulesSetting: function (signal) {
    var self = this;
    return MF.model.rules.filter(function (r) { return self.writes(r).indexOf(signal) >= 0; });
  },

  rulesReading: function (signal) {
    var self = this;
    return MF.model.rules.filter(function (r) { return self.reads(r).indexOf(signal) >= 0; });
  },

  // Aktive Regeln, die dieses Signal schreiben – dann ist es nicht von Hand änderbar
  activeSetting: function (signal) {
    var self = this;
    return this.rulesSetting(signal).filter(function (r) { return self.isActive(r); });
  },

  // SCL-Vorlage aus einer einfachen Regel, z. B. beim Umstellen der Art
  toScl: function (rule) {
    var q = function (sig) {
      var i = sig.indexOf('.');
      return '"' + sig.slice(0, i) + '".' + sig.slice(i + 1);
    };
    var head = '// ' + rule.name + (rule.description ? ': ' + rule.description.split('\n')[0] : '') + '\n';
    if (!rule.when || !rule.then) {
      return head + '// Signale links aus der Liste in den Code ziehen.\n\n' +
        'IF "LS1".Belegt THEN\n  "S1".Ausfahren := TRUE;\nELSE\n  "S1".Ausfahren := FALSE;\nEND_IF;\n';
    }
    return head + q(rule.then) + ' := ' + q(rule.when) + ';\n';
  }
};
