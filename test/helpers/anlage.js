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
//
// Phase 3 (Formen): formAnlegen() zeichnet einen Körper wie die Werkzeuge
// Rechteck/Kreis/Polygon, form(), koerperart(), funktion() und material() ändern
// ihn wie das Eigenschaften-Panel. Funktionen heißen wie in der Oberfläche
// ('Transportfläche', 'Achse', 'Sensor', 'Erzeuger', 'Senke').
//
// Phase 4 (Achsen): achse() liest und ändert die Achse (Typ, Betriebsart,
// Grenzen in m bzw. Grad), feld() ein Feld einer Funktion wie im Panel,
// koppeln() hängt einen Körper an einen anderen (wie Ziehen im Baum),
// lage() liefert die Lage in der Welt mit Achse und Kopplung.
//
// Objektfang: fangPunkt() fängt einen Punkt wie beim Zeichnen bzw. an einem Griff,
// ziehen() verschiebt einen Körper wie das Werkzeug Verschieben (beides über MF.snap,
// dieselbe Rechnung wie im Editor), fangenEinstellen() legt die Schalter um.
// Handbetrieb: handbetrieb() ruft dieselbe Funktion wie die Knöpfe im Panel
// (MF.axisManual), handbetriebHinweis() liefert den Satz zu Regeln und SCL.
//
// Produkt (Quelle mit frei gestaltbarem Produkt): Erzeuger machen "Teile" in der Form
// ihres Produkt-Körpers. produkt() nennt ihn, teile() beschreibt die erzeugten Teile
// (Form, Masse, Produkt); kisten() & Co. gelten weiter für alle Teile. form() kann mit
// typ den Formtyp wechseln. elemente() zählt Produkte nicht mit (sie sind Vorlagen).
//
// Gradgenau drehen: Die Eigenschaft "direction" ist seit feature/drehung ein Winkel
// in Grad. eigenschaft(id, 'direction') liest weiter den Namen wie vorher ('rechts' …,
// '' bei schrägen Winkeln) und nimmt Namen und Zahlen an; richtung() liest und setzt
// Grad wie das Feld im Panel. drehung() und drehungSchritt() wie das Feld "Drehung"
// (Eingabe bzw. − / +), drehenZiehen() wie das Werkzeug Drehen beim Ziehen.
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
  // Fangziele wie im Editor: alle sichtbaren Körper außer skip und seinen Kindern;
  // Reichweite in Pixeln beim Zoom (Standard 100 %)
  function fangKontext(skip, zoom) {
    return MF.snap.context({ snap: MF.model.settings.snap, bodies: MF.model.bodies, skip: skip,
      scale: MF.sim.SCALE * (zoom || 1), poseOf: function (b) { return MF.sim.drawPose(b); } });
  }

  // Funktionen mit deutschem Namen wie in der Oberfläche (oder dem Feldnamen)
  const FUNKTIONEN = { 'Transportfläche': 'surface', 'Achse': 'axis', 'Sensor': 'sensor', 'Erzeuger': 'spawner', 'Senke': 'sink' };
  function fnKey(name) {
    const fn = FUNKTIONEN[name] || name;
    if (MF.FN_KEYS.indexOf(fn) < 0) throw new Error('Funktion "' + name + '" gibt es nicht');
    return fn;
  }
  function fnName(fn) {
    for (const k in FUNKTIONEN) if (FUNKTIONEN[k] === fn) return k;
    return fn;
  }
  // Form und Lage als einfache Daten: { typ, w, d | r | punkte, h, h2?, x, y, z, rot }
  function formDaten(e) {
    const sh = e.shape, out = { typ: sh.type };
    if (sh.type === 'rect') { out.w = sh.w; out.d = sh.d; }
    else if (sh.type === 'circle') out.r = sh.r;
    else out.punkte = kopie(sh.points);
    out.h = sh.h;
    if (sh.h2 !== undefined) out.h2 = sh.h2;
    out.x = e.pose.x; out.y = e.pose.y; out.z = e.pose.z; out.rot = e.pose.rot;
    return out;
  }

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

    // ---------- Teile (früher nur Kisten) ----------

    kistenAnzahl() { return MF.engine.boxes.length; },
    /** Mittelpunkte der Kisten in Metern, [{ x, y }] (in der Reihenfolge des Erzeugens) */
    kisten() {
      return kopie(MF.engine.boxes.map(function (b) { return { x: b.cur.x, y: b.cur.y }; }));
    },
    /** Mittelpunkte mit Höhe, [{ x, y, z }] */
    kisten3d() {
      return kopie(MF.engine.boxes.map(function (b) { return { x: b.cur.x, y: b.cur.y, z: b.cur.z }; }));
    },
    /** Drehung der Kisten um die Hochachse in Grad (0 … 360) */
    kistenDrehung() {
      return kopie(MF.engine.boxes.map(function (b) { return MF.geom.normDeg(MF.sim.yawOf(b.cur.q) * 180 / Math.PI); }));
    },
    /** Geschwindigkeiten der Kisten in m/s, [{ x, y, z }] */
    kistenTempo() {
      return kopie(MF.engine.boxes.map(function (b) { const v = b.rb.linvel(); return { x: v.x, y: v.y, z: v.z }; }));
    },
    /** Kantenlänge einer Kiste in Metern */
    kistenGroesse() { return MF.BOX_SIZE; },
    /**
     * Erzeugte Teile: [{ x, y, z, rot, form ('rect'|'circle'|'polygon'), h, masse (kg, aus der Physik),
     * produkt, quelle }] in der Reihenfolge des Erzeugens
     */
    teile() {
      return kopie(MF.engine.boxes.map(function (b) {
        return { x: b.cur.x, y: b.cur.y, z: b.cur.z, rot: MF.geom.normDeg(MF.sim.yawOf(b.cur.q) * 180 / Math.PI),
          form: b.shape.type, h: b.shape.h, masse: b.rb.mass(), produkt: b.product, quelle: b.source };
      }));
    },

    // ---------- Körper (früher "Elemente") ----------

    elemente() {
      return kopie(MF.model.bodies.filter(function (e) { return !MF.isProduct(e); }).map(function (e) { return e.id; }));
    },
    /** Produkt-Körper eines Erzeugers (ID) oder null */
    produkt(id) { const p = MF.productOf(el(id)); return p ? p.id : null; },
    /** Ist id das Produkt eines Erzeugers? */
    istProdukt(id) { return MF.isProduct(el(id)); },
    /** Masse eines Teils dieses Produkts in kg (wie im Panel) */
    produktMasse(id) { return MF.productMass(el(id)); },
    /** Körper duplizieren wie Strg+D; gibt die ID der Kopie zurück oder null, wenn abgelehnt */
    duplizieren(id) {
      el(id);
      const b = MF.store.duplicateBody(id);
      MF.history.canMerge = false;
      return b ? b.id : null;
    },
    /** Eigenschaft der Vorlage lesen (wert weglassen) oder wie im Eigenschaften-Panel setzen */
    eigenschaft(id, key, wert) {
      const e = el(id);
      if (!MF.propDef(e, key)) throw new Error('Eigenschaft "' + key + '" gibt es bei ' + id + ' nicht');
      if (arguments.length < 3) {
        const v = MF.getProp(e, key);
        return key === 'direction' ? MF.dirName(v) : kopie(v);   // Name wie vor feature/drehung
      }
      MF.setProp(e, key, wert);
      geaendert();
    },
    /** Richtung einer Vorlage in Grad lesen (wert weglassen) oder setzen wie im Panel (Zahl oder Name) */
    richtung(id, wert) {
      const e = el(id);
      if (!MF.propDef(e, 'direction')) throw new Error(id + ' hat keine Richtung');
      if (arguments.length < 2) return MF.getProp(e, 'direction');
      MF.setProp(e, 'direction', wert);
      geaendert();
    },
    /** Feld "Drehung" im Panel: lesen oder Zahl eingeben (0,1° genau, unabhängig vom Fangen) */
    drehung(id, grad) {
      const e = el(id);
      if (arguments.length < 2) return e.pose.rot;
      if (MF.setRotation(e, grad)) geaendert();
    },
    /** − / + am Feld "Drehung" (n = ±1, mit Shift ±10): Schritte des Fangwinkels */
    drehungSchritt(id, n) {
      const e = el(id);
      if (MF.setRotation(e, MF.snap.angleStepped(e.pose.rot, n, MF.model.settings.snap))) geaendert();
      return e.pose.rot;
    },
    /**
     * Werkzeug Drehen: Körper am Punkt von (Welt, m) anfassen und über die Punkte bis ziehen –
     * dreht um seine Lage, Winkel-Fangen wie im Editor (MF.snap.dragAngle), eine Geste im Verlauf.
     * opt: { ohneFangen (Alt) }. Gibt die Drehung danach zurück.
     */
    drehenZiehen(id, von, bis, opt) {
      opt = opt || {};
      const e = el(id), pose0 = { x: e.pose.x, y: e.pose.y, rot: e.pose.rot };
      MF.history.begin();
      bis.forEach(function (w) {
        const rot = MF.snap.dragAngle(pose0.rot, pose0, kopie(von), kopie(w), MF.model.settings.snap, !!opt.ohneFangen);
        if (!MF.setForm(e, { rot: rot })) MF.store.changed();
        MF.history.lastTime -= 10000;   // wie eine lange Pause beim Ziehen
      });
      MF.history.end();
      return e.pose.rot;
    },
    /** Körper als Dateiinhalt (Form, Lage, Funktionen …) */
    koerper(id) { return kopie(MF.file.serializeBody(el(id))); },
    /** Neuer Körper aus dem Katalog (Vorlage), Mitte bei (x, y) in Metern; gibt die ID zurück */
    anlegen(typ, x, y) {
      const e = MF.store.createBody(typ, x, y, null);
      MF.history.canMerge = false;
      return e.id;
    },
    /** Körper löschen; false, wenn abgelehnt (z. B. Produkt einer Quelle, Grund in meldungen()) */
    loeschen(id) {
      el(id);
      const ok = MF.store.deleteBody(id);
      MF.history.canMerge = false;
      return ok;
    },
    umbenennen(id, name) { el(id).name = name; geaendert(); },
    name(id) { return el(id).name; },
    /** Signalnamen eines Körpers, z. B. ['Ein', 'Läuft', 'Tempo'] */
    signale(id) { return kopie(MF.io(el(id)).map(function (s) { return s.name; })); },

    // ---------- Formen (Phase 3) ----------

    /**
     * Neuen Körper zeichnen wie mit den Werkzeugen Rechteck, Kreis, Polygon.
     * typ 'rect' | 'circle' | 'polygon'; masse { w, d } | { r } | { punkte: [[x, y], …] } (lokal zur Lage),
     * optional h; lage { x, y, z?, rot? } in m bzw. Grad. Gibt die ID zurück oder null, wenn abgelehnt.
     */
    formAnlegen(typ, masse, lage) {
      const shape = { type: typ };
      if (typ === 'rect') { shape.w = masse.w; shape.d = masse.d; }
      else if (typ === 'circle') shape.r = masse.r;
      else shape.points = kopie(masse.punkte);
      if (masse.h !== undefined) shape.h = masse.h;
      const e = MF.store.createShape(shape, { x: lage.x, y: lage.y, z: lage.z || 0, rot: lage.rot || 0 }, null);
      MF.history.canMerge = false;
      return e ? e.id : null;
    },
    /**
     * Form und Lage lesen (felder weglassen) oder ändern, z. B. { w: 2, h: 0.5, h2: 0.1, z: 0.3, rot: 90 }.
     * h2: null entfernt die Neigung; typ wechselt den Formtyp ('rect', 'circle', 'polygon').
     * Gibt true zurück oder false, wenn abgelehnt (Meldung in meldungen()).
     */
    form(id, felder) {
      const e = el(id);
      if (!felder) return formDaten(e);
      const aenderung = kopie(felder);
      if (aenderung.punkte) { aenderung.points = aenderung.punkte; delete aenderung.punkte; }
      if (aenderung.typ) { aenderung.type = aenderung.typ; delete aenderung.typ; }
      const err = MF.setForm(e, aenderung);
      if (err) { MF.ui.message(err); return false; }
      geaendert();
      return true;
    },
    /** Körperart lesen oder wechseln; gibt beim Wechsel die entfernten Funktionen zurück */
    koerperart(id, art) {
      const e = el(id);
      if (art === undefined) return e.kind;
      if (MF.file.KINDS.indexOf(art) < 0) throw new Error('Körperart "' + art + '" gibt es nicht');
      const res = MF.setKind(e, art);
      if (res.error) MF.ui.message(res.error);
      MF.store.dropSignals(e.id, res.signals);
      geaendert();
      return kopie(res.fns.map(fnName));
    },
    /**
     * Funktion lesen (felder weglassen; null, wenn nicht vorhanden), anlegen bzw. Felder
     * ändern (felder = Objekt, {} = Standardwerte) oder entfernen (felder = null).
     * Gibt beim Ändern true zurück oder false, wenn die Funktion hier nicht erlaubt ist.
     */
    funktion(id, name, felder) {
      const e = el(id), fn = fnKey(name);
      if (arguments.length < 3) return e[fn] ? kopie(e[fn]) : null;
      if (felder === null) {
        MF.store.dropSignals(e.id, MF.removeFunction(e, fn));
        geaendert();
        return true;
      }
      const err = MF.addFunction(e, fn);
      if (err) { MF.ui.message(err); return false; }
      const f = kopie(felder);
      const vorher = MF.io(e).map(function (s) { return s.name; });
      Object.keys(f).forEach(function (k) { e[fn][k] = f[k]; });
      MF.store.dropSignals(e.id, MF.syncIo(e, vorher));   // z. B. andere Betriebsart
      geaendert();
      return true;
    },
    /**
     * Feld einer Funktion lesen (wert weglassen) oder setzen wie im Eigenschaften-Panel,
     * z. B. feld('DT1', 'Achse', 'mode', 'geschwindigkeit'). Gibt beim Setzen true/false zurück.
     */
    feld(id, name, key, wert) {
      const e = el(id), fn = fnKey(name);
      if (!e[fn]) throw new Error(id + ' hat keine Funktion "' + name + '"');
      if (arguments.length < 4) return kopie(MF.getField(e, fn, key));
      const ok = MF.setField(e, fn, key, wert);
      if (ok) geaendert();
      return ok;
    },
    /** Sichtbare Felder einer Funktion (Schlüssel), wie im Panel */
    felder(id, name) {
      const e = el(id), fn = fnKey(name);
      return kopie(MF.fieldsOf(e, fn).map(function (d) { return d.key; }));
    },
    /**
     * Achse lesen (felder weglassen) oder ändern, z. B. { type: 'rotary', mode: 'position', min: 0, max: 90 }.
     * Gibt true zurück oder false, wenn abgelehnt (Meldung in meldungen()).
     */
    achse(id, felder) {
      const e = el(id);
      if (!felder) return e.axis ? kopie(e.axis) : null;
      const err = MF.setAxis(e, kopie(felder));
      if (err) { MF.ui.message(err); return false; }
      geaendert();
      return true;
    },
    /**
     * Knopf im Abschnitt Handbetrieb drücken: 'out' / 'in' (zweipunkt), 'goto' mit Ziel
     * in m bzw. Grad (position), 'jog' mit −1 / 0 / 1 (geschwindigkeit). Kein Schritt im Verlauf.
     * Gibt true zurück oder false, wenn abgelehnt (Meldung in meldungen()).
     */
    handbetrieb(id, befehl, wert) {
      const err = MF.axisManual(el(id), befehl, wert);
      if (err) { MF.ui.message(err); return false; }
      return true;
    },
    /** Beschriftung der Knöpfe { out, in } und Hinweis auf Regeln/SCL (Zeilen) */
    handbetriebHinweis(id) {
      const e = el(id);
      return kopie({ knoepfe: MF.axisManualLabels(e.axis), zeilen: MF.axisManualHint(e) });
    },
    /** Achse wie in der Draufsicht am Griff ziehen: eine Geste mit Zwischenständen, ein Schritt im Verlauf */
    achseZiehen(id, staende) {
      const e = el(id);
      let abgelehnt = 0;
      MF.history.begin();
      staende.forEach(function (st) {
        if (MF.setAxis(e, kopie(st))) abgelehnt++;
        else MF.store.changed();
        MF.history.lastTime -= 10000;
      });
      MF.history.end();
      return abgelehnt;
    },
    /**
     * Körper an den Körper eltern hängen (Kopplung, wie Ziehen im Baum auf den Körper);
     * eltern = null löst die Kopplung (Körper bleibt im Ordner). Er bleibt dabei, wo er ist.
     * Gibt true zurück oder false, wenn abgelehnt (Grund in meldungen()).
     */
    koppeln(id, eltern) {
      const e = el(id);
      const ziel = eltern || MF.store.folderOf(e, 'plant');
      const n = MF.store.moveNodes([id], 'plant', ziel, null);
      MF.history.canMerge = false;
      return n > 0;
    },
    /** Körper, an dem id hängt, oder null */
    gekoppeltAn(id) { const p = MF.parentBody(el(id)); return p ? p.id : null; },
    /** Ordner eines Körpers (bei Kopplung der des Elternkörpers) */
    ordnerVon(id) { return MF.store.folderOf(el(id), 'plant'); },
    /** Vorlagen im Katalog: [{ key, label, group, prefix, hint }] */
    vorlagen() {
      return kopie(Object.keys(MF.templates).map(function (k) {
        const t = MF.templates[k];
        return { key: k, label: t.label, group: t.group, prefix: t.prefix, hint: t.hint, icon: t.icon };
      }));
    },
    /**
     * Griff ziehen wie im Editor: eine Geste mit mehreren Zwischenständen
     * (z. B. [{ w: 1.2 }, { w: 1.5 }, { w: 1.8 }]), dazwischen vergeht echte Zeit.
     * Gibt die Anzahl abgelehnter Zwischenstände zurück.
     */
    griffZiehen(id, staende) {
      const e = el(id);
      let abgelehnt = 0;
      MF.history.begin();
      staende.forEach(function (st) {
        const f = kopie(st);
        if (f.punkte) { f.points = f.punkte; delete f.punkte; }
        if (MF.setForm(e, f)) abgelehnt++;
        else MF.store.changed();
        MF.history.lastTime -= 10000;   // wie eine lange Pause beim Ziehen
      });
      MF.history.end();
      return abgelehnt;
    },
    /** Werkstoff lesen oder ändern, z. B. { friction: 0.1 } */
    material(id, felder) {
      const e = el(id);
      if (!felder) return kopie(e.material);
      const f = kopie(felder);
      Object.keys(f).forEach(function (k) { e.material[k] = f[k]; });
      geaendert();
    },
    /**
     * Aktuelle Lage in der Welt { x, y, z, rot } – mit Achsstellung und Kopplung,
     * dynamisch: wo die Physik ihn hat. rot auf 0 … 360 Grad.
     */
    lage(id) {
      const p = MF.engine.worldPose(el(id));
      return kopie({ x: p.x, y: p.y, z: p.z, rot: MF.geom.normDeg(p.rot) });
    },
    /** Lage, wie Draufsicht und 3D-Ansicht sie zeichnen (zwischen zwei Schritten interpoliert) */
    zeichenLage(id) {
      const p = MF.sim.drawPose(el(id));
      return kopie({ x: p.x, y: p.y, z: p.z, rot: MF.geom.normDeg(p.rot) });
    },
    /** Punkt fangen wie beim Zeichnen (Raster, ohne Körper in der Nähe); ohneFangen = Alt gedrückt */
    fangen(x, y, ohneFangen) {
      const q = MF.snap.point(fangKontext(null), { x: x, y: y }, !!ohneFangen);
      return kopie({ x: q.x, y: q.y });
    },
    /**
     * Punkt fangen wie beim Zeichnen bzw. an einem Griff, mit Objektfang:
     * { x, y, art, text } – art 'corner' | 'mid' | 'center' | 'quad' | 'edge' | 'align' oder null (Raster).
     * opt: { ohneFangen (Alt), griffVon: ID (dieser Körper und seine Kinder sind keine Ziele), zoom (Standard 1) }
     */
    fangPunkt(x, y, opt) {
      opt = opt || {};
      const q = MF.snap.point(fangKontext(opt.griffVon || null, opt.zoom), { x: x, y: y }, !!opt.ohneFangen);
      return kopie({ x: q.x, y: q.y, art: q.hit ? q.hit.kind : null, text: q.hit ? q.hit.text : null });
    },
    /**
     * Körper wie mit dem Werkzeug Verschieben ziehen: seine Lage (Welt) soll ohne Fangen bei
     * (x, y) liegen, Fangen und Objektfang legen sie fest (Höhe bei Bandenden). Ein Schritt im
     * Verlauf. Gibt den Text des Objektfangs zurück (null = nur Raster).
     * opt: { ohneFangen (Alt), zoom (Standard 1) }
     */
    ziehen(id, x, y, opt) {
      opt = opt || {};
      const e = el(id), draw = MF.sim.drawPose(e), pose = { x: e.pose.x, y: e.pose.y, z: e.pose.z, rot: e.pose.rot };
      const frame = { draw: draw, pose: pose };
      const raw = { world: { x: x, y: y }, model: MF.snap.toModel(frame, { x: x, y: y }) };
      const r = MF.snap.moveBody(fangKontext(id, opt.zoom), e, frame, raw, !!opt.ohneFangen, MF.snap.FREE_MOVE);
      e.pose.x = r.x;
      e.pose.y = r.y;
      if (r.z !== undefined) e.pose.z = r.z;
      geaendert();
      return r.hit ? r.hit.text : null;
    },
    /** Winkel fangen wie beim Drehen */
    fangWinkel(grad, ohneFangen) { return MF.snap.angle(grad, MF.model.settings.snap, !!ohneFangen); },
    /** Fangen einstellen, z. B. { on: false }, { obj: false } oder { pos: 0.1, angle: 15 } – wie die Schalter, kein Schritt im Verlauf */
    fangenEinstellen(felder) {
      Object.keys(felder).forEach(function (k) { MF.model.settings.snap[k] = felder[k]; });
    },
    /** Einstellungen des Fangens { on, obj, pos, angle } */
    fangenEinstellungen() { return kopie(MF.model.settings.snap); },

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

    // ---------- 3D-Ansicht ----------

    /** Kamera der 3D-Ansicht bewegen wie mit der Maus; pos/ziel [x, y, z] in Metern */
    kameraBewegen(pos, ziel) { MF.view3d.cameraChanged({ pos: kopie(pos), target: kopie(ziel) }); },
    /** Kamera-Stand der 3D-Ansicht { pos, target } oder null (= einpassen) */
    kamera3d() { return kopie(MF.view3d.cameraData()); },

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
