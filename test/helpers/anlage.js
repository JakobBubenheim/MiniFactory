// Test-Fassade: die einzige Stelle, an der Tests die Anlage bedienen.
//
// Verhaltenstests rufen nur diese Funktionen auf, nie MF.engine & Co. direkt.
// Beim Umbau auf 3D-Physik (Idee/Konzept-3D.md) ändert sich nur diese Datei,
// die Tests selbst bleiben gleich. Deshalb:
// - Zeiten in Sekunden, Längen in Metern (nicht in Rasterzellen)
// - Signale mit ihrem Namen wie in der App, z. B. 'LS1.Belegt'
// - Rückgabewerte sind einfache Daten (Zahlen, Texte, JSON-Kopien)
//
// Seit dem Umbau (Phase 2) übersetzt die Fassade auf Körper mit Funktionen:
// eigenschaft('B1', 'speed') liest surface.speed (über die Eigenschaften der
// Vorlage), kisten() liefert die Mittelpunkte aus Rapier, anlegen() legt einen
// Körper aus dem Katalog mit Mitte (x, y) in Metern an.
'use strict';

const { before } = require('node:test');
const { laden: ladeKontext, vorbereiten } = require('./load');

// Rapier (WASM) einmal je Testprozess laden, bevor der erste Test läuft
before(vorbereiten);

// Kopie im Node-Kontext: Objekte aus dem vm-Kontext haben eigene Prototypen,
// assert.deepStrictEqual würde sie sonst als verschieden ansehen.
function kopie(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

/**
 * Neue Anlage in einem frischen Kontext.
 * @param {object|string} [datei] Inhalt einer .mfab-Datei oder 'beispiel' (Standard)
 */
function neueAnlage(datei) {
  const win = ladeKontext();
  const MF = win.MF;

  function el(id) {
    const e = MF.store.findBody(id);
    if (!e) throw new Error('Körper "' + id + '" gibt es nicht');
    return e;
  }
  function sig(name) {
    const s = MF.logic.parse(name);
    if (!s || !MF.engine.ioDef(s.el, s.name)) throw new Error('Signal "' + name + '" gibt es nicht');
    return s;
  }
  function regel(id) {
    const r = MF.store.findRule(id);
    if (!r) throw new Error('Regel "' + id + '" gibt es nicht');
    return r;
  }
  // Wie eine abgeschlossene Bedienung in der Oberfläche: Ansichten und Verlauf erfahren davon.
  // canMerge = false: jede Fassaden-Aktion ist ein eigener Schritt im Verlauf.
  function geaendert() {
    MF.store.changed();
    MF.history.canMerge = false;
  }
  function dtS() { return MF.engine.dt(); }

  const a = {
    // ---------- Laden und Speichern ----------

    /** Beispielanlage (Standard) oder Dateiinhalt laden. true, wenn geladen. */
    laden(objOderBeispiel) {
      if (objOderBeispiel === undefined || objOderBeispiel === 'beispiel') {
        // Das Beispiel ist der Startzustand des Kontexts; als Datei neu laden
        // setzt Engine, Logik und Verlauf sauber zurück.
        return MF.file.deserialize(beispielDatei);
      }
      return MF.file.deserialize(kopie(objOderBeispiel));
    },

    /** Anlage als Dateiinhalt (wie beim Speichern). */
    datei() { return kopie(MF.file.serialize()); },

    /** Fehlertexte für einen Dateiinhalt; leer = in Ordnung. */
    pruefen(obj) { return kopie(MF.file.validate(kopie(obj))); },

    /** Dateiinhalt auf die aktuelle Version gehoben. */
    migrieren(obj) { return kopie(MF.file.migrate(kopie(obj))); },

    /** Aktuelle Dateiversion. */
    get dateiVersion() { return MF.file.VERSION; },

    /** Texte, die in der Statusleiste erschienen wären. */
    meldungen() { return win.__meldungen.slice(); },

    // ---------- Zeit ----------

    /** Simulation um sekunden weiterlaufen lassen (in festen Schritten). */
    laufen(sekunden) {
      if (MF.engine.state === 'running') MF.engine.pause();
      const n = Math.round(sekunden / dtS());
      for (let i = 0; i < n; i++) MF.engine.stepOnce();
    },

    /** Laufen, bis bedingung() wahr ist; gibt die Zeit zurück oder null nach maxSekunden. */
    laufenBis(bedingung, maxSekunden) {
      if (MF.engine.state === 'running') MF.engine.pause();
      const n = Math.round((maxSekunden || 60) / dtS());
      for (let i = 0; i < n; i++) {
        MF.engine.stepOnce();
        if (bedingung()) return a.zeit();
      }
      return null;
    },

    start() { MF.engine.start(); },
    pause() { MF.engine.pause(); },
    schritt() { MF.engine.stepOnce(); },
    reset() { MF.engine.reset(); },
    /** Echte Zeit vergehen lassen, wie Bilder im Browser (60 je Sekunde). */
    echtzeit(sekunden) {
      const bilder = Math.round(sekunden * 60);
      for (let i = 0; i < bilder; i++) MF.engine.clock.advance(1 / 60);
    },
    /** Zeitfaktor, z. B. 2 = doppelt so schnell. */
    zeitfaktor(f) { MF.engine.setTimeScale(f); },
    /** 'stopped', 'running' oder 'paused' */
    zustand() { return MF.engine.state; },
    /** Simulationszeit in Sekunden */
    zeit() { return MF.engine.timeMs / 1000; },
    /** Zeitschritt in ms ändern; false, wenn abgelehnt (läuft gerade). */
    zeitschritt(ms) {
      if (ms === undefined) return MF.engine.clock.dtMs;
      const ok = MF.engine.setDtMs(ms);
      if (ok) geaendert();
      return ok;
    },

    // ---------- Signale ----------

    /** Aktueller Wert, z. B. signal('LS1.Belegt') -> 0 oder 1 */
    signal(name) { const s = sig(name); return MF.engine.signal(s.el, s.name); },
    /** Eingang von Hand setzen (wie im I/O-Tab) */
    setzen(name, wert) {
      const s = sig(name);
      if (MF.engine.ioDef(s.el, s.name).dir !== 'in') throw new Error(name + ' ist kein Eingang – forcen() benutzen');
      MF.engine.setSignal(s.el, s.name, wert);
    },
    /** Ausgang auf einen Wert festhalten (forcen) */
    forcen(name, wert) {
      const s = sig(name);
      if (MF.engine.ioDef(s.el, s.name).dir !== 'out') throw new Error(name + ' ist kein Ausgang – setzen() benutzen');
      MF.engine.setSignal(s.el, s.name, wert);
    },
    /** Forcen aufheben */
    freigeben(name) { const s = sig(name); MF.engine.releaseForce(s.el, s.name); },
    istGeforct(name) { const s = sig(name); return MF.engine.isForced(s.el, s.name); },

    // ---------- Kisten ----------

    kistenAnzahl() { return MF.engine.boxes.length; },
    /** Mittelpunkte der Kisten in Metern, [{ x, y }] (in der Reihenfolge des Erzeugens) */
    kisten() {
      return kopie(MF.engine.boxes.map(function (b) { return { x: b.cur.x, y: b.cur.y }; }));
    },
    /** Mittelpunkte mit Höhe, [{ x, y, z }] */
    kisten3d() {
      return kopie(MF.engine.boxes.map(function (b) { return { x: b.cur.x, y: b.cur.y, z: b.cur.z }; }));
    },
    /** Geschwindigkeiten der Kisten in m/s, [{ x, y, z }] */
    kistenTempo() {
      return kopie(MF.engine.boxes.map(function (b) { const v = b.rb.linvel(); return { x: v.x, y: v.y, z: v.z }; }));
    },
    /** Kantenlänge einer Kiste in Metern */
    kistenGroesse() { return MF.BOX_SIZE; },

    // ---------- Körper (früher "Elemente") ----------

    elemente() { return kopie(MF.model.bodies.map(function (e) { return e.id; })); },
    /** Eigenschaft der Vorlage lesen (wert weglassen) oder wie im Eigenschaften-Panel setzen */
    eigenschaft(id, key, wert) {
      const e = el(id);
      if (!MF.propDef(e, key)) throw new Error('Eigenschaft "' + key + '" gibt es bei ' + id + ' nicht');
      if (arguments.length < 3) return kopie(MF.getProp(e, key));
      MF.setProp(e, key, wert);
      geaendert();
    },
    /** Körper als Dateiinhalt (Form, Lage, Funktionen …) */
    koerper(id) { return kopie(MF.file.serializeBody(el(id))); },
    /** Neuer Körper aus dem Katalog (Vorlage), Mitte bei (x, y) in Metern; gibt die ID zurück */
    anlegen(typ, x, y) {
      const e = MF.store.createBody(typ, x, y, null);
      MF.history.canMerge = false;
      return e.id;
    },
    loeschen(id) {
      el(id);
      MF.store.deleteBody(id);
      MF.history.canMerge = false;
    },
    umbenennen(id, name) { el(id).name = name; geaendert(); },
    name(id) { return el(id).name; },

    // ---------- Regeln und SCL ----------

    regeln() { return kopie(MF.model.rules.map(function (r) { return r.id; })); },
    /** Regel lesen (felder weglassen) oder Felder ändern, z. B. { enabled: false } */
    regel(id, felder) {
      const r = regel(id);
      if (!felder) return kopie(r);
      Object.keys(felder).forEach(function (k) { r[k] = felder[k]; });
      geaendert();
    },
    /** Neue Wenn-dann-Regel; gibt die ID zurück */
    neueRegel(wenn, dann) {
      const r = MF.store.createRule('rule');
      r.when = wenn; r.then = dann;
      geaendert();
      return r.id;
    },
    /** Neuer SCL-Baustein mit Code; gibt die ID zurück */
    neuerScl(code) {
      const r = MF.store.createRule('scl');
      r.code = code;
      geaendert();
      return r.id;
    },
    regelLoeschen(id) { regel(id); MF.store.deleteRule(id); MF.history.canMerge = false; },
    /** Übersetzungsfehler { message, line, col } oder null */
    sclFehler(id) { return kopie(MF.logic.unit(regel(id)).error) || null; },
    /** Laufzeitfehler { message, line } oder null */
    sclLaufzeitfehler(id) { return kopie(MF.logic.unit(regel(id)).runError) || null; },
    /** Code nur übersetzen; Fehler oder null */
    sclPruefen(code) { return kopie(MF.scl.compile(code).error) || null; },
    /** Wert einer SCL-Variablen, z. B. 'x' oder Bausteinausgang 't1.Q' */
    sclVariable(id, name) {
      const u = MF.logic.unit(regel(id));
      if (!u.state) throw new Error('Baustein ' + id + ' ist nicht übersetzt');
      const teile = name.split('.');
      const zelle = u.state[teile[0].toUpperCase()];
      if (!zelle) throw new Error('Variable "' + name + '" gibt es nicht');
      return teile.length > 1 ? zelle.fb[teile[1].toUpperCase()] : zelle.value;
    },

    // ---------- Strukturbaum: Ordner ----------

    /** Neuer Ordner in bereich ('plant' | 'logic') unter eltern (Ordner-ID oder null); gibt die ID zurück */
    ordnerAnlegen(bereich, eltern, name) {
      const f = MF.store.createFolder(bereich, eltern || null, name);
      MF.history.canMerge = false;
      return f.id;
    },
    ordnerLoeschen(id) {
      if (!MF.store.findFolder(id)) throw new Error('Ordner "' + id + '" gibt es nicht');
      MF.store.deleteFolder(id);
      MF.history.canMerge = false;
    },
    /** Alle Ordner als [{ id, name, parent, area }] in Array-Reihenfolge */
    ordnerListe() { return kopie(MF.model.folders || []); },
    /** Eltern-Ordner eines Elements, einer Regel oder eines Ordners (null = oberste Ebene) */
    eltern(id) {
      const n = MF.store.findNode(id);
      if (!n) throw new Error('Knoten "' + id + '" gibt es nicht');
      return MF.store.parentOf(n.obj, n.area);
    },
    /** Knoten verschieben wie per Ziehen im Baum; gibt die Anzahl verschobener Knoten zurück */
    verschieben(ids, bereich, eltern, vorId) {
      const n = MF.store.moveNodes(ids, bereich, eltern || null, vorId || null);
      MF.history.canMerge = false;
      return n;
    },
    /** IDs der Elemente bzw. Regeln in Baum-Reihenfolge (Tiefensuche) */
    baumReihenfolge(bereich) {
      return kopie(MF.store.treeOrder(bereich).map(function (o) { return o.id; }));
    },

    // ---------- Rückgängig / Wiederholen ----------

    rueckgaengig() { MF.history.undo(); },
    wiederholen() { MF.history.redo(); },
    kannRueckgaengig() { return MF.history.canUndo(); },
    kannWiederholen() { return MF.history.canRedo(); }
  };

  // Die Beispielanlage als Datei, genommen bevor ein Test etwas ändert
  const beispielDatei = kopie(MF.file.serialize());

  if (datei !== undefined && datei !== 'beispiel') {
    if (!a.laden(datei)) throw new Error('Anlage nicht geladen: ' + a.meldungen().join(' / '));
  }
  return a;
}

module.exports = { neueAnlage: neueAnlage, kopie: kopie };
