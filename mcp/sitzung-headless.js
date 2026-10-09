// Sitzung ohne Browser: eine Anlage im Speicher, gerechnet mit den App-Skripten.
//
// Die Werkzeuge des MCP-Servers (mcp/werkzeuge.js) sprechen nur mit einer
// "Sitzung". Diese Variante lädt sim/, logic/ und Rapier in einen vm-Kontext
// (tools/headless.js, wie die Tests). Stufe B ersetzt sie durch eine Live-Sitzung,
// die dieselben Aufrufe an die offene App im Browser weiterreicht
// (Idee/Konzept-MCP.md, Abschnitt "Sitzung").
//
// Schnittstelle – alle Methoden geben ein Promise zurück und liefern einfache
// Daten (JSON); Bedienfehler kommen als SitzungsFehler mit deutschem Text:
//   bereit()                         Physik geladen, Sitzung benutzbar
//   uebersicht()                     Anlage kompakt: Körper, Ordner, Regeln, Signale
//   vorlagen()                       Vorlagen, Funktionen, Körperarten, Werkstoffe (aus MF.templates/MF.FUNCTIONS)
//   neu({ name, dtMs })              leere Anlage
//   ladenDatei(datei)                .mfab-Inhalt laden (wird geprüft und ggf. migriert)
//   datei()                          aktuelle Anlage als .mfab-Inhalt
//   pruefen()                        { fehler, hinweise } – Datei-Prüfung und Bauregeln
//   vorlageEinfuegen(a)              { template, x, y, rot?, z?, name?, parent?, shape?, props? }
//   formZeichnen(a)                  { type, w, d | r | points, h, h2?, x, y, z?, rot?, kind?, name?, parent? }
//   koerperAendern(id, felder)       Lage, Form, Körperart, Werkstoff, Farbe, Eigenschaften der Vorlage
//   funktionSetzen(id, fn, felder)   Funktion anlegen/ändern (Objekt) oder entfernen (null)
//   loeschen(ids)                    Körper, Regeln oder Ordner
//   ordnerAnlegen(a), verschieben(ids, ordner)
//   regelAnlegen(a), sclAnlegen(a), regelAendern(id, felder), regelLoeschen(id)
//   simulieren(a)                    { seconds, reset?, set_signals?, trace? } -> Zusammenfassung
//   signalSetzen(name, wert|null), signale()
//   szene()                          Geometrie für das Bild der Draufsicht (mcp/bild.js)
//   rueckgaengig(), wiederholen()
//
// Jede Änderung läuft über die Funktionen der App (MF.store, MF.setForm, MF.setKind,
// MF.addFunction, MF.setProp …) – es gelten dieselben Prüfungen wie in der Oberfläche,
// und jeder Aufruf ist genau ein Schritt im Verlauf (Rückgängig).
'use strict';

const headless = require('../tools/headless');

class SitzungsFehler extends Error {}

function fehler(text) { return new SitzungsFehler(text); }

// Kopie im Node-Kontext (Objekte aus dem vm-Kontext haben eigene Prototypen)
function kopie(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

// Auf 0,1 mm runden – genug für Meter, hält die Antworten kurz
function r(v) { return typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v; }

function istZahl(v) { return typeof v === 'number' && isFinite(v); }
function istObjekt(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

const FORM_FELDER = ['x', 'y', 'z', 'rot', 'w', 'd', 'r', 'h', 'h2', 'points'];
const KOERPER_FELDER = FORM_FELDER.concat(['name', 'kind', 'material', 'color', 'visible', 'props']);
const MAX_SEKUNDEN = 600;

class SitzungHeadless {
  constructor() {
    this._bereit = headless.vorbereiten().then(() => {
      this.win = headless.laden();
      this.MF = this.win.MF;
      this._neu({});
    });
  }

  bereit() { return this._bereit; }

  // ---------- Hilfen ----------

  // Meldungen der Statusleiste seit dem letzten Aufruf
  _meldungen() { return this.win.__meldungen.splice(0); }

  // Eine Änderung = ein Schritt im Verlauf, egal wie viele Einzeländerungen sie hat
  _aenderung(fn) {
    const MF = this.MF;
    this._meldungen();
    MF.history.begin();
    try { return fn(); } finally { MF.history.end(); }
  }

  _koerper(id) {
    const b = this.MF.store.findBody(id);
    if (!b) throw fehler('Körper "' + id + '" gibt es nicht. IDs stehen in get_overview.');
    return b;
  }

  _regel(id) {
    const rr = this.MF.store.findRule(id);
    if (!rr) throw fehler('Regel "' + id + '" gibt es nicht. IDs stehen in get_overview.');
    return rr;
  }

  // Signal "B1.Ein" -> { el, name, def }
  _signal(name) {
    const MF = this.MF;
    const s = typeof name === 'string' ? MF.logic.parse(name) : null;
    const def = s && MF.ioDef(s.el, s.name);
    if (!def) {
      throw fehler('Signal "' + name + '" gibt es nicht. Vorhanden: ' + (MF.store.signals().join(', ') || 'keine') + '.');
    }
    return { el: s.el, name: s.name, def: def };
  }

  // Funktion über ihren Schlüssel (surface …) oder deutschen Namen (Transportfläche …)
  _fnKey(name) {
    const MF = this.MF;
    if (MF.FN_KEYS.indexOf(name) >= 0) return name;
    const k = MF.FN_KEYS.find(function (fn) { return String(MF.FUNCTIONS[fn].label).toLowerCase() === String(name).toLowerCase(); });
    if (k) return k;
    throw fehler('Funktion "' + name + '" gibt es nicht. Möglich: ' +
      MF.FN_KEYS.map(function (fn) { return fn + ' (' + MF.FUNCTIONS[fn].label + ')'; }).join(', ') + '.');
  }

  // Körper als Kopie zum Ausprobieren: Änderungen erst daran prüfen, dann am echten
  _probe(b) {
    const p = kopie(this.MF.file.serializeBody(b));
    p.rt = {};
    p.force = kopie(b.force || {});
    p.inputs = kopie(b.inputs || {});
    return p;
  }

  // Wert gegen ein Feld (Eigenschaft der Vorlage oder Feld einer Funktion) prüfen
  _wertPruefen(def, v, wo) {
    const name = wo + ' "' + def.key + '"';
    if (def.readonly) throw fehler(name + ' lässt sich nur lesen.');
    if (def.type === 'number') {
      if (!istZahl(v)) throw fehler(name + ' muss eine Zahl sein' + (def.unit ? ' (' + def.unit + ')' : '') + '.');
      if (def.min !== undefined && v < def.min - 1e-9 || def.max !== undefined && v > def.max + 1e-9) {
        throw fehler(name + ' muss zwischen ' + def.min + ' und ' + def.max + (def.unit ? ' ' + def.unit : '') + ' liegen.');
      }
      return v;
    }
    if (def.type === 'bool') {
      if (v === 0 || v === 1) return !!v;
      if (typeof v !== 'boolean') throw fehler(name + ' muss true oder false sein.');
      return v;
    }
    if (def.type === 'select') {
      const opts = (def.options || []).map(function (o) { return typeof o === 'object' ? o.value : o; });
      if (opts.indexOf(v) < 0) throw fehler(name + ' muss einer dieser Werte sein: ' + opts.join(', ') + '.');
      return v;
    }
    if (def.type === 'color') {
      if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) throw fehler(name + ' muss eine Farbe wie "#C79A5B" sein.');
      return v;
    }
    return v;
  }

  // Felder auf einen Körper anwenden (echt oder Probe). echt = Signale in Regeln nachziehen.
  // Gibt Hinweise zurück (z. B. entfernte Funktionen).
  _koerperFelder(b, felder, echt) {
    const MF = this.MF, self = this, hinweise = [];
    Object.keys(felder).forEach(function (k) {
      if (KOERPER_FELDER.indexOf(k) < 0) {
        throw fehler('Unbekanntes Feld "' + k + '". Möglich: ' + KOERPER_FELDER.join(', ') + '.');
      }
    });
    if (felder.name !== undefined) {
      if (typeof felder.name !== 'string' || !felder.name.trim()) throw fehler('"name" muss ein nicht leerer Text sein.');
      b.name = felder.name.trim();
    }
    if (felder.kind !== undefined && felder.kind !== b.kind) {
      if (MF.file.KINDS.indexOf(felder.kind) < 0) throw fehler('Körperart "' + felder.kind + '" gibt es nicht. Möglich: ' + MF.file.KINDS.join(', ') + '.');
      const res = MF.setKind(b, felder.kind);
      if (echt) MF.store.dropSignals(b.id, res.signals);
      if (res.fns.length) hinweise.push('Als ' + felder.kind + ' entfernt: ' + res.fns.map(function (fn) { return MF.FUNCTIONS[fn].label; }).join(', ') + '.');
      if (res.slope) hinweise.push('Neigung (h2) entfernt – gibt es nur bei static.');
      if (res.density) hinweise.push('Dichte auf ' + res.density + ' kg/m³ gesetzt.');
    }
    const form = {};
    FORM_FELDER.forEach(function (k) { if (felder[k] !== undefined) form[k] = felder[k]; });
    if (form.points !== undefined) {
      if (!Array.isArray(form.points) || !form.points.every(function (p) { return Array.isArray(p) && p.length === 2 && istZahl(p[0]) && istZahl(p[1]); })) {
        throw fehler('"points" muss eine Liste von Punkten [x, y] in Metern sein (lokal zur Lage).');
      }
    }
    ['x', 'y'].forEach(function (k) {
      if (istZahl(form[k]) && Math.abs(form[k]) > 1000) throw fehler('Lage "' + k + '" muss zwischen −1000 und 1000 m liegen.');
    });
    if (Object.keys(form).length) {
      const err = MF.setForm(b, form);
      if (err) throw fehler(err);
    }
    if (felder.material !== undefined) {
      if (!istObjekt(felder.material)) throw fehler('"material" muss ein Objekt { friction, restitution, density } sein.');
      if (!b.material) b.material = kopie(MF.MATERIALS.body);
      Object.keys(felder.material).forEach(function (k) {
        if (['friction', 'restitution', 'density'].indexOf(k) < 0) throw fehler('Werkstoff hat kein Feld "' + k + '". Möglich: friction, restitution, density.');
        const v = felder.material[k];
        if (!(istZahl(v) && v >= 0)) throw fehler('Werkstoff "' + k + '" muss eine Zahl ≥ 0 sein.');
        b.material[k] = v;
      });
    }
    if (felder.color !== undefined) b.look.color = self._wertPruefen({ key: 'color', type: 'color' }, felder.color, 'Feld');
    if (felder.visible !== undefined) b.look.visible = self._wertPruefen({ key: 'visible', type: 'bool' }, felder.visible, 'Feld');
    if (felder.props !== undefined) {
      if (!istObjekt(felder.props)) throw fehler('"props" muss ein Objekt { Eigenschaft: Wert } sein.');
      Object.keys(felder.props).forEach(function (key) {
        const def = MF.propDef(b, key);
        if (!def) {
          const da = MF.propsOf(b).map(function (p) { return p.key; });
          throw fehler('Eigenschaft "' + key + '" gibt es bei ' + (b.id || 'diesem Körper') + ' nicht. ' +
            (da.length ? 'Möglich: ' + da.join(', ') + '.' : 'Er hat keine Eigenschaften einer Vorlage – Funktionen mit set_function ändern.'));
        }
        MF.setProp(b, key, self._wertPruefen(def, felder.props[key], 'Eigenschaft'));
      });
    }
    return hinweise;
  }

  // Felder einer Funktion setzen: allgemeine Felder (MF.FUNCTIONS[fn].fields) oder
  // die Rohwerte der Funktion (z. B. surface.dir, axis.mode). Signale werden angeglichen.
  _funktionFelder(b, fn, felder, echt) {
    const MF = this.MF, self = this, F = MF.FUNCTIONS[fn];
    const vorher = MF.io(b).map(function (s) { return s.name; });
    const f = b[fn];
    // MF.fieldsOf löst Felder wie das Panel auf: Auswahllisten als Funktion
    // (z. B. Betriebsarten) und Felder, die nur je nach Typ gelten (when).
    const defs = (MF.fieldsOf ? MF.fieldsOf(b, fn) : (F.fields || [])).filter(function (d) { return !d.body; });
    Object.keys(felder).forEach(function (k) {
      const v = felder[k];
      const def = defs.find(function (d) { return d.key === k; });
      if (def) {
        const w = self._wertPruefen(def, v, F.label);
        if (def.set) def.set(f, w);
        else f[def.field] = w;
        return;
      }
      if (!(k in f)) {
        const moeglich = defs.filter(function (d) { return !d.readonly; }).map(function (d) { return d.key; })
          .concat(Object.keys(f)).filter(function (x, i, a) { return a.indexOf(x) === i; });
        throw fehler(F.label + ' hat kein Feld "' + k + '". Möglich: ' + moeglich.join(', ') + '.');
      }
      if (k === 'mode' && F.MODES && !Object.prototype.hasOwnProperty.call(F.MODES, v)) {
        throw fehler('Betriebsart "' + v + '" gibt es nicht. Möglich: ' + Object.keys(F.MODES).join(', ') + '.');
      }
      const alt = f[k];
      if (Array.isArray(alt)) {
        if (!Array.isArray(v) || v.length !== alt.length || !v.every(istZahl)) throw fehler(F.label + ' "' + k + '" muss eine Liste aus ' + alt.length + ' Zahlen sein.');
      } else if (istObjekt(alt)) {
        if (!istObjekt(v)) throw fehler(F.label + ' "' + k + '" muss ein Objekt sein.');
      } else if (alt !== null && alt !== undefined && typeof v !== typeof alt) {
        throw fehler(F.label + ' "' + k + '" muss vom Typ ' + typeof alt + ' sein.');
      } else if (typeof v === 'number' && !isFinite(v)) {
        throw fehler(F.label + ' "' + k + '" muss eine endliche Zahl sein.');
      }
      f[k] = kopie(v);
    });
    const weg = MF.syncIo(b, vorher);
    if (echt) MF.store.dropSignals(b.id, weg);
    return weg;
  }

  // Eltern setzen wie per Ziehen im Baum (Ordner; nach Phase 4 evtl. auch Körper)
  _eltern(id, parent) {
    const MF = this.MF;
    const area = MF.store.areaOf(id);
    const err = MF.store.moveError(id, area, parent || null);
    if (err) throw fehler('Verschieben nach "' + parent + '" nicht möglich: ' + err);
    MF.store.moveNodes([id], area, parent || null, null);
  }

  // ---------- Lesen ----------

  _koerperInfo(b) {
    const MF = this.MF, sh = b.shape;
    const shape = { type: sh.type };
    if (sh.type === 'rect') { shape.w = r(sh.w); shape.d = r(sh.d); }
    else if (sh.type === 'circle') shape.r = r(sh.r);
    else shape.points = sh.points.map(function (p) { return [r(p[0]), r(p[1])]; });
    shape.h = r(sh.h);
    if (sh.h2 !== undefined) shape.h2 = r(sh.h2);
    const bb = MF.geom.bounds(sh, b.pose);
    const out = {
      id: b.id, name: b.name, template: b.template || null, kind: b.kind,
      parent: b.parent || null,
      shape: shape,
      pose: { x: r(b.pose.x), y: r(b.pose.y), z: r(b.pose.z), rot: r(b.pose.rot) },
      // Hilfswerte: Hüllrechteck in der Draufsicht und Oberkante (z + Höhe)
      bounds: { x0: r(bb.x0), y0: r(bb.y0), x1: r(bb.x1), y1: r(bb.y1) },
      top: r(b.pose.z + MF.geom.maxHeight(sh))
    };
    if (MF.geom.isSloped(sh)) {
      out.slope = { deg: r(MF.geom.slopeDeg(sh)), downhill: MF.geom.normDeg(b.pose.rot + (sh.h2 < sh.h ? 0 : 180)) };
    }
    if (b.kind !== 'ghost' && b.material) out.material = kopie(b.material);
    const fns = {};
    MF.FN_KEYS.forEach(function (fn) {
      if (!b[fn]) return;
      const f = kopie(b[fn]);
      if (fn === 'spawner' && f.template) {
        // Kistenvorlage knapp: nur die Form
        f.template = { shape: f.template.shape, color: f.template.look && f.template.look.color };
      }
      if (fn === 'surface') {
        f.worldDir = MF.geom.normDeg(b.pose.rot + b.surface.dir);
        const n = MF.dirName(f.worldDir);
        if (n) f.worldDirName = n;
      }
      fns[fn] = f;
    });
    out.functions = fns;
    const props = {};
    MF.propsOf(b).forEach(function (p) { props[p.key] = kopie(MF.getProp(b, p.key)); });
    if (Object.keys(props).length) out.props = props;
    out.signals = MF.io(b).map(function (s) { return b.id + '.' + s.name; });
    if (b.look && b.look.visible === false) out.visible = false;
    if (b.look && b.look.color) out.color = b.look.color;
    return out;
  }

  _regelInfo(rule) {
    const MF = this.MF;
    const out = { id: rule.id, name: rule.name, kind: rule.kind, parent: rule.parent || null, enabled: rule.enabled !== false };
    if (rule.description) out.description = rule.description;
    if (rule.kind === 'scl') {
      out.code = rule.code || '';
      const u = MF.logic.unit(rule);
      if (u.error) out.error = kopie(u.error);
      if (u.runError) out.runError = kopie(u.runError);
      if (u.prog) { out.reads = kopie(u.prog.reads); out.writes = kopie(u.prog.writes); }
    } else {
      out.when = rule.when || '';
      out.then = rule.then || '';
      if (!rule.when || !rule.then) out.hinweis = 'unvollständig – wird nicht ausgewertet';
    }
    return out;
  }

  _signalWerte() {
    const MF = this.MF, out = {};
    MF.store.signals().forEach(function (name) {
      const s = MF.logic.parse(name);
      out[name] = r(MF.engine.signal(s.el, s.name));
    });
    return out;
  }

  _simInfo() {
    const MF = this.MF;
    return { state: MF.engine.state, time: r(MF.engine.timeMs / 1000), boxes: MF.engine.boxes.length };
  }

  async uebersicht() {
    await this._bereit;
    const MF = this.MF, self = this;
    const s = MF.model.settings;
    return {
      name: MF.model.name,
      settings: { dtMs: s.dtMs, gravity: s.gravity },
      sim: this._simInfo(),
      folders: kopie(MF.model.folders || []),
      bodies: MF.model.bodies.map(function (b) { return self._koerperInfo(b); }),
      rules: MF.store.treeOrder('logic').map(function (rr) { return self._regelInfo(rr); }),
      signals: this._signalWerte()
    };
  }

  async vorlagen() {
    await this._bereit;
    const MF = this.MF;
    // ctx: Funktionswerte, mit denen Felder als Funktion (z. B. options) aufgelöst werden
    function feld(d, ctx) {
      const o = { key: d.key, label: d.label, type: d.type };
      ['unit', 'min', 'max', 'step', 'readonly', 'hint'].forEach(function (k) {
        const v = typeof d[k] === 'function' ? d[k](ctx) : d[k];
        if (v !== undefined) o[k] = v;
      });
      const opts = typeof d.options === 'function' ? d.options(ctx) : d.options;
      if (opts) o.options = opts.map(function (x) { return typeof x === 'object' ? x.value : x; });
      return o;
    }
    const templates = Object.keys(MF.templates).map(function (key) {
      const t = MF.templates[key];
      const out = { key: key, label: t.label, idPrefix: t.prefix };
      try {
        const b = MF.bodyFromTemplate(key, 0, 0);
        const sh = kopie(b.shape);
        out.kind = b.kind;
        out.shape = sh;
        out.z = r(b.pose.z);
        out.top = r(b.pose.z + MF.geom.maxHeight(b.shape));
        out.functions = MF.FN_KEYS.filter(function (fn) { return b[fn]; });
        out.signals = MF.io(b).map(function (s) { return { name: s.name, dir: s.dir, type: s.type }; });
        out.props = MF.propsOf(b).map(function (p) {
          const o = feld(p, p.fn ? b[p.fn] : b);
          o.default = kopie(MF.getProp(b, p.key));
          return o;
        });
      } catch (e) {
        out.hinweis = 'Vorlage lässt sich nicht beschreiben: ' + e.message;
      }
      return out;
    });
    const functions = MF.FN_KEYS.map(function (fn) {
      const F = MF.FUNCTIONS[fn];
      const f = F.make();
      const out = {
        key: fn, label: F.label, kinds: kopie(F.kinds),
        defaults: kopie(f),
        fields: (F.fields || []).filter(function (d) { return !d.body; }).map(function (d) { return feld(d, f); }),
        signals: F.io(f).map(function (s) { return { name: s.name, dir: s.dir, type: s.type }; })
      };
      if (F.MODES) {
        out.modes = {};
        Object.keys(F.MODES).forEach(function (m) {
          out.modes[m] = F.MODES[m].map(function (s) { return { name: s.name, dir: s.dir, type: s.type }; });
        });
      }
      return out;
    });
    return {
      templates: templates,
      functions: functions,
      kinds: MF.file.KINDS.map(function (k) { return { key: k, label: MF.KIND_LABELS[k], functions: MF.allowedFns(k) }; }),
      materials: kopie(MF.MATERIALS),
      constants: { beltTop: MF.BELT_TOP, boxSize: MF.BOX_SIZE, directions: kopie(MF.DIRS) }
    };
  }

  // ---------- Datei ----------

  _neu(a) {
    const MF = this.MF;
    const dtMs = a.dtMs === undefined ? 20 : a.dtMs;
    if (!(Number.isInteger(dtMs) && dtMs > 0 && dtMs <= 1000)) throw fehler('"dtMs" muss eine ganze Zahl zwischen 1 und 1000 sein (üblich 20).');
    const ok = MF.file.deserialize({
      format: MF.file.FORMAT, version: MF.file.VERSION, name: a.name || 'Neue Anlage',
      settings: { dtMs: dtMs, gravity: -9.81, snap: { on: true, pos: 0.05, angle: 5 } },
      folders: [], bodies: [], rules: []
    });
    if (!ok) throw fehler('Neue Anlage ließ sich nicht anlegen: ' + this._meldungen().join(' / '));
    MF.file.setDirty(false);
    this._meldungen();
  }

  async neu(a) {
    await this._bereit;
    this._neu(a || {});
    return { name: this.MF.model.name, dtMs: this.MF.model.settings.dtMs };
  }

  async ladenDatei(obj) {
    await this._bereit;
    const MF = this.MF;
    const res = MF.file.build(kopie(obj));
    if (res.errors.length) throw fehler('Datei ungültig:\n- ' + res.errors.join('\n- '));
    this._meldungen();
    if (!MF.file.deserialize(kopie(obj))) throw fehler('Datei nicht geladen: ' + this._meldungen().join(' / '));
    MF.file.setDirty(false);
    this._meldungen();
    return { name: MF.model.name, bodies: MF.model.bodies.length, rules: MF.model.rules.length };
  }

  async datei() {
    await this._bereit;
    return kopie(this.MF.file.serialize());
  }

  // Datei-Prüfung (wie beim Öffnen) und Bauregeln (Hinweise, keine Fehler)
  async pruefen() {
    await this._bereit;
    const MF = this.MF, self = this;
    const fehlerListe = kopie(MF.file.validate(kopie(MF.file.serialize())));
    const hinweise = [];
    const bodies = MF.model.bodies;

    MF.model.rules.forEach(function (rule) {
      if (rule.enabled === false) return;
      if (rule.kind === 'scl') {
        const u = MF.logic.unit(rule);
        if (u.error) fehlerListe.push(rule.id + ': SCL-Übersetzungsfehler Zeile ' + u.error.line + ', Spalte ' + u.error.col + ': ' + u.error.message);
      } else if (!rule.when || !rule.then) {
        hinweise.push(rule.id + ' ist unvollständig (when/then leer) und wird nicht ausgewertet.');
      }
    });

    function oben(b) { return b.pose.z + MF.geom.maxHeight(b.shape); }
    // Fester Körper unter dem Punkt, dessen Oberkante zwischen zmin und zmax liegt
    function traeger(x, y, zmin, zmax, ohne) {
      return bodies.find(function (b) {
        if (b === ohne || b.kind === 'ghost' || b.kind === 'dynamic') return false;
        if (!MF.geom.containsXY(b.shape, b.pose, x, y)) return false;
        const t = b.pose.z + MF.geom.topAt(b.shape, MF.geom.toLocal(b.pose, x, y).x);
        return t >= zmin - 1e-6 && t <= zmax + 1e-6;
      });
    }

    bodies.forEach(function (b) {
      // Erzeuger: Kiste landet auf einer Fläche knapp darunter?
      if (b.spawner) {
        const t = traeger(b.pose.x, b.pose.y, b.pose.z - 0.05, b.pose.z + 0.001, b);
        if (!t) hinweise.push(b.id + ' (Erzeuger) liegt über keiner Fläche, deren Oberkante 0–5 cm darunter ist – Kisten fallen auf den Boden. Üblich: Unterseite 2 cm über der Bandoberkante (z = ' + (MF.BELT_TOP + 0.02) + ').');
      }
      // Transportfläche: was kommt hinter dem Ende?
      if (b.surface && b.shape.type === 'rect') {
        const dirW = MF.geom.normDeg(b.pose.rot + b.surface.dir);
        const v = MF.geom.dirVec(dirW);
        // halbe Länge in Laufrichtung (lokal)
        const dl = MF.geom.dirVec(b.surface.dir);
        const halb = Math.abs(dl.x) * b.shape.w / 2 + Math.abs(dl.y) * b.shape.d / 2;
        const ex = b.pose.x + v.x * (halb + 0.15), ey = b.pose.y + v.y * (halb + 0.15);
        const top = oben(b);
        const weiter = bodies.find(function (o) {
          return o !== b && (o.sink || o.kind !== 'ghost') && MF.geom.containsXY(o.shape, o.pose, ex, ey) &&
            (o.sink || oben(o) <= top + 0.005);
        });
        if (!weiter) hinweise.push(b.id + ': hinter dem Ende (Laufrichtung ' + dirW + '°, bei x ' + r(ex) + ', y ' + r(ey) + ') liegt weder Senke noch Fläche – Kisten fallen dort herunter.');
        // Anschließende Transportfläche: MF.BELT_SEAM (1 cm) tiefer (stellt MF.fixBeltSeams sonst selbst ein)
        bodies.forEach(function (o) {
          if (o === b || !o.surface || o.kind === 'ghost') return;
          if (!MF.geom.containsXY(o.shape, o.pose, b.pose.x + v.x * (halb + 0.01), b.pose.y + v.y * (halb + 0.01))) return;
          const d = top - oben(o);
          if (d < MF.BELT_SEAM - 1e-6) hinweise.push(o.id + ' schließt an ' + b.id + ' an, liegt aber nicht ' + r(MF.BELT_SEAM * 100) + ' cm tiefer (Unterschied ' + r(d * 1000) + ' mm) – Kisten haken an der Kante.');
        });
      }
      // Sensor: liegt er über einer Fläche, auf der Kisten laufen?
      if (b.sensor && !traeger(b.pose.x, b.pose.y, b.pose.z - 0.3, b.pose.z + 0.001, b)) {
        hinweise.push(b.id + ' (Sensor) liegt über keiner festen Fläche – prüfen, ob dort Kisten vorbeikommen (z ' + r(b.pose.z) + ' bis ' + r(oben(b)) + ').');
      }
    });

    const nichtGesehen = MF.model.rules.filter(function (rule) { return rule.kind !== 'scl' && rule.then && !MF.logic.parse(rule.then); });
    nichtGesehen.forEach(function (rule) { fehlerListe.push(rule.id + ': Ziel "' + rule.then + '" gibt es nicht.'); });
    return { fehler: fehlerListe, hinweise: hinweise };
  }

  // ---------- Körper ----------

  async vorlageEinfuegen(a) {
    await this._bereit;
    const MF = this.MF, self = this;
    if (!Object.prototype.hasOwnProperty.call(MF.templates, a.template)) {
      throw fehler('Vorlage "' + a.template + '" gibt es nicht. Möglich: ' + Object.keys(MF.templates).join(', ') + ' (Details: list_templates).');
    }
    if (!istZahl(a.x) || !istZahl(a.y)) throw fehler('x und y (Mitte in Metern) müssen Zahlen sein.');
    const felder = {};
    ['rot', 'z', 'name', 'props', 'color'].forEach(function (k) { if (a[k] !== undefined) felder[k] = a[k]; });
    if (a.shape !== undefined) {
      if (!istObjekt(a.shape)) throw fehler('"shape" muss ein Objekt sein, z. B. { "w": 4 }.');
      Object.keys(a.shape).forEach(function (k) {
        if (['w', 'd', 'r', 'h', 'h2', 'points'].indexOf(k) < 0) throw fehler('"shape" kennt kein Feld "' + k + '". Möglich: w, d, r, h, h2, points.');
        felder[k] = a.shape[k];
      });
    }
    // Erst an einer Probe prüfen, damit bei einem Fehler nichts angelegt wird
    const probe = MF.bodyFromTemplate(a.template, a.x, a.y);
    probe.id = MF.templates[a.template].prefix + '?';
    this._koerperFelder(probe, felder, false);
    if (a.parent) this._elternPruefen(a.parent);

    return this._aenderung(function () {
      const b = MF.store.createBody(a.template, a.x, a.y, null);
      const hinweise = self._koerperFelder(b, felder, true);
      MF.store.changed();
      if (a.parent) self._eltern(b.id, a.parent);
      MF.store.selectedId = null;
      return { id: b.id, hinweise: hinweise, koerper: self._koerperInfo(b) };
    });
  }

  _elternPruefen(parent) {
    const MF = this.MF;
    const f = MF.store.findFolder(parent);
    if (f && f.area === 'plant') return;
    if (MF.store.findBody(parent)) return;   // Phase 4: Kopplung an einen Körper; moveError entscheidet
    throw fehler('Ordner "' + parent + '" gibt es nicht (Bereich Anlage). Mit create_folder anlegen.');
  }

  async formZeichnen(a) {
    await this._bereit;
    const MF = this.MF, self = this;
    const shape = { type: a.type };
    if (a.type === 'rect') { shape.w = a.w; shape.d = a.d; }
    else if (a.type === 'circle') shape.r = a.r;
    else if (a.type === 'polygon') {
      if (!Array.isArray(a.points) || !a.points.every(function (p) { return Array.isArray(p) && p.length === 2 && istZahl(p[0]) && istZahl(p[1]); })) {
        throw fehler('"points" muss eine Liste von Punkten [x, y] in Metern sein (lokal zur Lage x/y).');
      }
      shape.points = kopie(a.points);
    } else throw fehler('Form "' + a.type + '" gibt es nicht. Möglich: rect, circle, polygon.');
    shape.h = a.h === undefined ? MF.BODY.H : a.h;
    if (!istZahl(a.x) || !istZahl(a.y)) throw fehler('x und y (Lage in Metern) müssen Zahlen sein.');
    const pose = { x: a.x, y: a.y, z: a.z === undefined ? 0 : a.z, rot: a.rot === undefined ? 0 : a.rot };
    if (!istZahl(pose.z) || !istZahl(pose.rot)) throw fehler('z und rot müssen Zahlen sein.');
    const err = MF.shapeError(shape);
    if (err) throw fehler('Form abgelehnt: ' + err);
    const felder = {};
    ['kind', 'name', 'material', 'color'].forEach(function (k) { if (a[k] !== undefined) felder[k] = a[k]; });
    if (a.h2 !== undefined) felder.h2 = a.h2;
    const probe = MF.bodyFromShape(shape, pose);
    probe.id = 'K?';
    this._koerperFelder(probe, felder, false);
    if (a.parent) this._elternPruefen(a.parent);

    return this._aenderung(function () {
      const b = MF.store.createShape(shape, pose, null);
      if (!b) throw fehler(self._meldungen().join(' / ') || 'Form abgelehnt.');
      const hinweise = self._koerperFelder(b, felder, true);
      MF.store.changed();
      if (a.parent) self._eltern(b.id, a.parent);
      MF.store.selectedId = null;
      return { id: b.id, hinweise: hinweise, koerper: self._koerperInfo(b) };
    });
  }

  async koerperAendern(id, felder) {
    await this._bereit;
    const MF = this.MF, self = this;
    const b = this._koerper(id);
    if (!istObjekt(felder) || !Object.keys(felder).length) throw fehler('"fields" muss ein Objekt mit mindestens einem Feld sein.');
    this._koerperFelder(this._probe(b), felder, false);
    return this._aenderung(function () {
      const hinweise = self._koerperFelder(b, felder, true);
      MF.store.changed();
      return { id: b.id, hinweise: hinweise, koerper: self._koerperInfo(b) };
    });
  }

  async funktionSetzen(id, name, felder) {
    await this._bereit;
    const MF = this.MF, self = this;
    const b = this._koerper(id);
    const fn = this._fnKey(name);
    if (felder === null) {
      if (!b[fn]) throw fehler(b.id + ' hat keine Funktion ' + MF.FUNCTIONS[fn].label + '.');
      return this._aenderung(function () {
        const weg = MF.removeFunction(b, fn);
        MF.store.dropSignals(b.id, weg);
        MF.store.changed();
        return { id: b.id, entfernteSignale: weg, koerper: self._koerperInfo(b) };
      });
    }
    if (!istObjekt(felder)) throw fehler('"fields" muss ein Objekt sein ({} = Standardwerte) oder null zum Entfernen.');
    function anwenden(k, echt) {
      if (!k[fn]) {
        const err = MF.addFunction(k, fn);
        if (err) throw fehler(err + ' Körperart ändern mit update_body { kind }.');
      }
      return self._funktionFelder(k, fn, felder, echt);
    }
    anwenden(this._probe(b), false);
    return this._aenderung(function () {
      const weg = anwenden(b, true);
      MF.store.changed();
      return { id: b.id, entfernteSignale: weg, koerper: self._koerperInfo(b) };
    });
  }

  async loeschen(ids) {
    await this._bereit;
    const MF = this.MF;
    if (!Array.isArray(ids) || !ids.length) throw fehler('"ids" muss eine nicht leere Liste sein.');
    const unbekannt = ids.filter(function (id) { return !MF.store.findNode(id); });
    if (unbekannt.length) throw fehler('Unbekannt: ' + unbekannt.join(', ') + '. Nichts gelöscht.');
    return this._aenderung(function () {
      ids.forEach(function (id) {
        const n = MF.store.findNode(id);
        if (!n) return;   // mit einem Ordner schon weg? Ordner löschen nur den Ordner selbst
        if (n.kind === 'body') MF.store.deleteBody(id);
        else if (n.kind === 'rule') MF.store.deleteRule(id);
        else MF.store.deleteFolder(id);
      });
      return { geloescht: ids };
    });
  }

  async ordnerAnlegen(a) {
    await this._bereit;
    const MF = this.MF;
    const area = a.area || 'plant';
    if (area !== 'plant' && area !== 'logic') throw fehler('"area" muss "plant" (Anlage) oder "logic" (Logik) sein.');
    if (a.parent) {
      const p = MF.store.findFolder(a.parent);
      if (!p || p.area !== area) throw fehler('Ordner "' + a.parent + '" gibt es im Bereich ' + area + ' nicht.');
    }
    return this._aenderung(function () {
      const f = MF.store.createFolder(area, a.parent || null, a.name || 'Neuer Ordner');
      MF.store.selectedId = null;
      return { id: f.id, folder: kopie(f) };
    });
  }

  async verschieben(ids, ordner) {
    await this._bereit;
    const MF = this.MF, self = this;
    if (!Array.isArray(ids) || !ids.length) throw fehler('"ids" muss eine nicht leere Liste sein.');
    const areas = ids.map(function (id) {
      const a = MF.store.areaOf(id);
      if (!a) throw fehler('"' + id + '" gibt es nicht.');
      return a;
    });
    if (areas.some(function (a) { return a !== areas[0]; })) throw fehler('Körper (Anlage) und Regeln (Logik) getrennt verschieben.');
    ids.forEach(function (id) {
      const err = MF.store.moveError(id, areas[0], ordner || null);
      if (err) throw fehler(id + ': ' + err);
    });
    return this._aenderung(function () {
      // Baum-Reihenfolge erhalten
      const order = MF.store.treeOrder(areas[0]).map(function (o) { return o.id; });
      const sortiert = ids.slice().sort(function (x, y) { return order.indexOf(x) - order.indexOf(y); });
      const n = MF.store.moveNodes(sortiert, areas[0], ordner || null, null);
      if (!n) throw fehler(self._meldungen().join(' / ') || 'Verschieben abgelehnt.');
      return { verschoben: n, ordner: ordner || null };
    });
  }

  // ---------- Regeln und SCL ----------

  _regelFelderPruefen(felder, kind) {
    const self = this;
    if (felder.when !== undefined && felder.when !== '') this._signal(felder.when);
    if (felder.then !== undefined && felder.then !== '') {
      const s = this._signal(felder.then);
      if (s.def.dir !== 'in') {
        throw fehler('"then" muss ein Eingang (EIN) sein, z. B. S1.Ausfahren oder B1.Ein. ' + felder.then + ' ist ein Ausgang. Eingänge: ' +
          self.MF.store.signals('in').join(', ') + '.');
      }
    }
    if (felder.code !== undefined) {
      if (kind !== 'scl') throw fehler('"code" gibt es nur bei SCL-Bausteinen.');
      if (typeof felder.code !== 'string') throw fehler('"code" muss ein Text sein.');
      const res = this.MF.scl.compile(felder.code);
      if (res.error) {
        throw fehler('SCL-Übersetzungsfehler in Zeile ' + res.error.line + ', Spalte ' + res.error.col + ': ' + res.error.message +
          '. Signale schreibt man "B1".Ein oder B1.Ein; vorhanden: ' + (this.MF.store.signals().join(', ') || 'keine') + '. Nichts geändert.');
      }
    }
    ['name', 'description'].forEach(function (k) {
      if (felder[k] !== undefined && typeof felder[k] !== 'string') throw fehler('"' + k + '" muss ein Text sein.');
    });
    if (felder.enabled !== undefined && typeof felder.enabled !== 'boolean') throw fehler('"enabled" muss true oder false sein.');
  }

  _regelOrdnerPruefen(folder) {
    if (!folder) return;
    const f = this.MF.store.findFolder(folder);
    if (!f || f.area !== 'logic') throw fehler('Ordner "' + folder + '" gibt es im Bereich Logik nicht (create_folder mit area "logic").');
  }

  async regelAnlegen(a) {
    await this._bereit;
    const MF = this.MF, self = this;
    if (!a.when || !a.then) throw fehler('"when" (Signal, das gelesen wird) und "then" (Eingang, der gesetzt wird) sind nötig.');
    this._regelFelderPruefen(a, 'rule');
    this._regelOrdnerPruefen(a.folder);
    return this._aenderung(function () {
      const rule = MF.store.createRule('rule', a.folder || null);
      rule.when = a.when; rule.then = a.then;
      if (a.name) rule.name = a.name;
      if (a.description) rule.description = a.description;
      if (a.enabled === false) rule.enabled = false;
      MF.store.selectedId = null;
      MF.store.changed();
      return { id: rule.id, regel: self._regelInfo(rule) };
    });
  }

  async sclAnlegen(a) {
    await this._bereit;
    const MF = this.MF, self = this;
    if (typeof a.code !== 'string' || !a.code.trim()) throw fehler('"code" (SCL-Text) fehlt.');
    this._regelFelderPruefen(a, 'scl');
    this._regelOrdnerPruefen(a.folder);
    return this._aenderung(function () {
      const rule = MF.store.createRule('scl', a.folder || null);
      rule.code = a.code;
      if (a.name) rule.name = a.name;
      if (a.description) rule.description = a.description;
      if (a.enabled === false) rule.enabled = false;
      MF.store.selectedId = null;
      MF.store.changed();
      return { id: rule.id, regel: self._regelInfo(rule) };
    });
  }

  async regelAendern(id, felder) {
    await this._bereit;
    const MF = this.MF, self = this;
    const rule = this._regel(id);
    if (!istObjekt(felder) || !Object.keys(felder).length) throw fehler('"fields" muss ein Objekt mit mindestens einem Feld sein.');
    const erlaubt = rule.kind === 'scl' ? ['code', 'name', 'description', 'enabled'] : ['when', 'then', 'name', 'description', 'enabled'];
    Object.keys(felder).forEach(function (k) {
      if (erlaubt.indexOf(k) < 0) throw fehler((rule.kind === 'scl' ? 'SCL-Baustein' : 'Regel') + ' hat kein Feld "' + k + '". Möglich: ' + erlaubt.join(', ') + '.');
    });
    this._regelFelderPruefen(felder, rule.kind);
    return this._aenderung(function () {
      Object.keys(felder).forEach(function (k) { rule[k] = felder[k]; });
      MF.store.changed();
      return { id: rule.id, regel: self._regelInfo(rule) };
    });
  }

  async regelLoeschen(id) {
    await this._bereit;
    const MF = this.MF;
    this._regel(id);
    return this._aenderung(function () {
      MF.store.deleteRule(id);
      return { geloescht: [id] };
    });
  }

  // ---------- Signale ----------

  async signalSetzen(name, wert) {
    await this._bereit;
    const MF = this.MF;
    const s = this._signal(name);
    if (wert === null) {
      MF.engine.releaseForce(s.el, s.name);
      return { signal: name, forced: false, value: r(MF.engine.signal(s.el, s.name)) };
    }
    if (typeof wert === 'boolean') wert = wert ? 1 : 0;
    if (!istZahl(wert)) throw fehler('Wert muss eine Zahl oder true/false sein (null = Forcen aufheben).');
    MF.engine.setSignal(s.el, s.name, wert);
    const out = { signal: name, dir: s.def.dir, value: r(MF.engine.signal(s.el, s.name)), forced: MF.engine.isForced(s.el, s.name) };
    const regeln = MF.logic.activeSetting(name).map(function (rr) { return rr.id; });
    if (regeln.length) out.hinweis = 'Wird von ' + regeln.join(', ') + ' geschrieben – die Regel überschreibt den Wert im nächsten Zyklus.';
    // Eingang mit Kopplung an eine Eigenschaft (z. B. Tempo) ändert die Anlage
    if (s.def.prop) MF.store.changed();
    return out;
  }

  async signale() {
    await this._bereit;
    const MF = this.MF;
    const out = [];
    MF.model.bodies.forEach(function (b) {
      MF.io(b).forEach(function (s) {
        const name = b.id + '.' + s.name;
        const o = { name: name, dir: s.dir, type: s.type, value: r(MF.engine.signal(b, s.name)) };
        if (MF.engine.isForced(b, s.name)) o.forced = true;
        const schreibt = MF.logic.rulesSetting(name).map(function (rr) { return rr.id; });
        const liest = MF.logic.rulesReading(name).map(function (rr) { return rr.id; });
        if (schreibt.length) o.writtenBy = schreibt;
        if (liest.length) o.readBy = liest;
        out.push(o);
      });
    });
    return out;
  }

  // ---------- Simulieren ----------

  async simulieren(a) {
    await this._bereit;
    const MF = this.MF, self = this;
    const sekunden = a.seconds;
    if (!istZahl(sekunden) || sekunden <= 0 || sekunden > MAX_SEKUNDEN) throw fehler('"seconds" muss zwischen 0 und ' + MAX_SEKUNDEN + ' liegen.');
    const setzen = a.set_signals || {};
    if (!istObjekt(setzen)) throw fehler('"set_signals" muss ein Objekt { "B1.Ein": 1 } sein.');
    Object.keys(setzen).forEach(function (n) { self._signal(n); });
    const trace = a.trace || [];
    if (!Array.isArray(trace)) throw fehler('"trace" muss eine Liste von Signalnamen sein.');
    trace.forEach(function (n) { self._signal(n); });

    if (MF.engine.state === 'running') MF.engine.pause();
    if (a.reset !== false) MF.engine.reset();
    Object.keys(setzen).forEach(function (n) {
      const s = self._signal(n);
      let v = setzen[n];
      if (typeof v === 'boolean') v = v ? 1 : 0;
      if (!istZahl(v)) throw fehler('set_signals: Wert für ' + n + ' muss eine Zahl oder true/false sein.');
      MF.engine.setSignal(s.el, s.name, v);
      if (s.def.prop) MF.store.changed();
    });

    const dt = MF.engine.dt();
    const schritte = Math.max(1, Math.round(sekunden / dt));
    const t0 = MF.engine.timeMs / 1000;

    // Zähler vorher
    const quellen = MF.model.bodies.filter(function (b) { return b.spawner; });
    const senken = MF.model.bodies.filter(function (b) { return b.sink; });
    const erzeugt0 = {}, erzeugt = {}, aufgenommen = {}, senkeVorher = {}, blockiert = {};
    quellen.forEach(function (b) { erzeugt0[b.id] = (b.rt && b.rt.made) || 0; blockiert[b.id] = 0; });
    senken.forEach(function (b) { senkeVorher[b.id] = (b.rt && b.rt.count) || 0; aufgenommen[b.id] = 0; });
    let verloren = 0;

    // Signale: Flanken und Anteil "an" (nur BOOL)
    const signalNamen = MF.store.signals();
    const bools = [];
    signalNamen.forEach(function (n) {
      const s = MF.logic.parse(n), def = MF.ioDef(s.el, s.name);
      if (def.type === 'BOOL') bools.push({ name: n, el: s.el, sig: s.name, dir: def.dir, wert: MF.engine.signal(s.el, s.name), steigend: 0, fallend: 0, an: 0 });
    });
    const spuren = {};
    trace.forEach(function (n) {
      const s = MF.logic.parse(n);
      spuren[n] = { el: s.el, sig: s.name, wert: MF.engine.signal(s.el, s.name), wechsel: [] };
      spuren[n].wechsel.push({ t: r(t0), v: r(spuren[n].wert) });
    });
    const sclFehler = {};
    const geboren = {};   // Kiste -> Zeit, zu der sie zuerst da war
    MF.engine.boxes.forEach(function (bx) { geboren[bx.id] = -Infinity; });

    for (let i = 0; i < schritte; i++) {
      const vorher = MF.engine.boxes.length;
      const erzeugtVorher = {};
      quellen.forEach(function (b) { erzeugtVorher[b.id] = (b.rt && b.rt.made) || 0; });
      MF.engine.stepOnce();
      const t = MF.engine.timeMs / 1000;
      let neu = 0, inSenken = 0;
      quellen.forEach(function (b) {
        const m = (b.rt && b.rt.made) || 0;
        neu += Math.max(0, m - erzeugtVorher[b.id]);
        const rt = b.rt || {};
        if (b.spawner.enabled && MF.engine.input(b, 'Freigabe') && rt.timer !== undefined && rt.timer <= 1e-9 &&
            !(b.spawner.maxCount > 0 && rt.made >= b.spawner.maxCount)) blockiert[b.id] += dt;
      });
      senken.forEach(function (b) {
        const c = (b.rt && b.rt.count) || 0;
        if (c > senkeVorher[b.id]) { aufgenommen[b.id] += c - senkeVorher[b.id]; inSenken += c - senkeVorher[b.id]; }
        senkeVorher[b.id] = c;
      });
      MF.engine.boxes.forEach(function (bx) { if (!(bx.id in geboren)) geboren[bx.id] = t; });
      const weg = vorher + neu - MF.engine.boxes.length;
      if (weg > inSenken) verloren += weg - inSenken;
      bools.forEach(function (s) {
        const v = MF.engine.signal(s.el, s.sig) ? 1 : 0;
        if (v && !s.wert) s.steigend++;
        if (!v && s.wert) s.fallend++;
        if (v) s.an++;
        s.wert = v;
      });
      Object.keys(spuren).forEach(function (n) {
        const sp = spuren[n], v = MF.engine.signal(sp.el, sp.sig);
        if (v !== sp.wert && sp.wechsel.length < 200) sp.wechsel.push({ t: r(t), v: r(v) });
        sp.wert = v;
      });
      MF.model.rules.forEach(function (rule) {
        if (rule.kind !== 'scl' || sclFehler[rule.id]) return;
        const u = MF.logic.units[rule.id];
        if (u && u.runError) sclFehler[rule.id] = { message: u.runError.message, line: u.runError.line, t: r(t) };
      });
    }

    quellen.forEach(function (b) { erzeugt[b.id] = ((b.rt && b.rt.made) || 0) - (a.reset !== false ? 0 : erzeugt0[b.id]); });
    const t1 = MF.engine.timeMs / 1000;

    // Kisten am Ende: wo liegen sie, stehen sie?
    function traegerUnter(bx) {
      const unten = bx.cur.z - bx.size[2] / 2;
      return MF.model.bodies.find(function (b) {
        if (b.kind === 'ghost') return false;
        const pose = MF.engine.worldPose(b);
        if (!MF.geom.containsXY(b.shape, pose, bx.cur.x, bx.cur.y)) return false;
        const top = pose.z + MF.geom.topAt(b.shape, MF.geom.toLocal(pose, bx.cur.x, bx.cur.y).x);
        return Math.abs(top - unten) < 0.05;
      });
    }
    const amBoden = [], stehen = [];
    MF.engine.boxes.forEach(function (bx) {
      const v = bx.rb.linvel();
      const tempo = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
      const unten = bx.cur.z - bx.size[2] / 2;
      const t = traegerUnter(bx);
      const lage = { x: r(bx.cur.x), y: r(bx.cur.y), z: r(bx.cur.z) };
      if (!t && unten < 0.05) amBoden.push(lage);
      else if (tempo < 0.01 && t1 - geboren[bx.id] > 0.5) {   // gerade erst abgelegte Kisten stehen noch
        lage.auf = t ? t.id : null;
        if (t && t.surface && MF.engine.surfaceOn(t)) lage.hinweis = 'Stau: steht auf laufender Fläche';
        stehen.push(lage);
      }
    });

    const hinweise = [];
    const summeErzeugt = Object.keys(erzeugt).reduce(function (s, k) { return s + erzeugt[k]; }, 0);
    const summeAuf = Object.keys(aufgenommen).reduce(function (s, k) { return s + aufgenommen[k]; }, 0);
    if (!quellen.length) hinweise.push('Die Anlage hat keinen Erzeuger (Vorlage "source").');
    else if (!summeErzeugt) hinweise.push('Es wurde keine Kiste erzeugt – Erzeuger aktiv (enabled), Freigabe = 1, Platz frei?');
    if (summeErzeugt && !senken.length) hinweise.push('Die Anlage hat keine Senke – Kisten werden nicht gezählt.');
    else if (summeErzeugt && !summeAuf && sekunden >= 10) hinweise.push('Kisten wurden erzeugt, aber keine kam in einer Senke an.');
    if (amBoden.length) hinweise.push(amBoden.length + ' Kiste(n) liegen auf dem Boden (heruntergefallen) – Lage der Bänder, Senken und Schieber prüfen.');
    if (verloren) hinweise.push(verloren + ' Kiste(n) fielen unter z = −2 m und wurden entfernt.');
    const stau = stehen.filter(function (s) { return s.hinweis; });
    if (stau.length) hinweise.push(stau.length + ' Kiste(n) stehen auf laufenden Flächen still (Stau, z. B. an einem Schieber oder einer Kante).');
    Object.keys(blockiert).forEach(function (id) {
      if (blockiert[id] >= 1) hinweise.push(id + ' war ' + r(blockiert[id]) + ' s blockiert (Platz für die nächste Kiste belegt – Rückstau).');
    });
    Object.keys(sclFehler).forEach(function (id) { hinweise.push(id + ': SCL-Laufzeitfehler bei t = ' + sclFehler[id].t + ' s: ' + sclFehler[id].message); });

    const flanken = {};
    bools.forEach(function (s) {
      if (!s.steigend && !s.fallend && s.dir !== 'out') return;   // Ausgänge immer, Eingänge nur mit Wechsel
      flanken[s.name] = { dir: s.dir, rising: s.steigend, falling: s.fallend, onShare: r(s.an / schritte) };
    });
    const out = {
      time: { start: r(t0), end: r(t1), steps: schritte, dtMs: MF.engine.clock.dtMs },
      boxes: {
        created: erzeugt,
        sunk: aufgenommen,
        lostBelowFloor: verloren,
        inPlant: MF.engine.boxes.length,
        onFloor: amBoden,
        standingStill: stehen
      },
      hints: hinweise,
      signalsEnd: this._signalWerte(),
      edges: flanken
    };
    if (Object.keys(sclFehler).length) out.sclRuntimeErrors = sclFehler;
    if (trace.length) {
      out.trace = {};
      Object.keys(spuren).forEach(function (n) { out.trace[n] = spuren[n].wechsel; });
    }
    return out;
  }

  // ---------- Bild ----------

  async szene() {
    await this._bereit;
    const MF = this.MF;
    const koerper = MF.model.bodies.map(function (b) {
      const pose = MF.engine.worldPose(b);
      const o = {
        id: b.id, name: b.name, kind: b.kind, template: b.template || null,
        color: (b.look && b.look.color) || '#8A93A0', visible: !b.look || b.look.visible !== false,
        outline: MF.geom.worldOutline(b.shape, pose).map(function (p) { return [p.x, p.y]; }),
        center: [pose.x, pose.y], rot: pose.rot,
        z: pose.z, top: pose.z + MF.geom.maxHeight(b.shape)
      };
      if (b.shape.type === 'circle') o.circle = { r: b.shape.r };
      if (b.surface) o.surface = { dir: MF.geom.normDeg(pose.rot + b.surface.dir), on: MF.engine.surfaceSpeed(b) > 0 };
      if (b.sensor) o.sensor = { occupied: !!MF.engine.signal(b, 'Belegt') };
      if (b.spawner) o.spawner = true;
      if (b.sink) o.sink = { count: (b.rt && b.rt.count) || 0 };
      if (MF.geom.isSloped(b.shape)) o.downhill = MF.geom.normDeg(pose.rot + (b.shape.h2 < b.shape.h ? 0 : 180));
      if (b.axis) {
        const ax = b.axis;
        o.axis = { type: ax.type, min: ax.min, max: ax.max };
        if (ax.type === 'linear' && Array.isArray(ax.dir)) o.axis.dir = MF.geom.normDeg(b.pose.rot + MF.vecDeg(ax.dir));
      }
      return o;
    });
    const kisten = MF.engine.boxes.map(function (bx) {
      return { x: bx.cur.x, y: bx.cur.y, z: bx.cur.z, rot: MF.sim.yawOf(bx.cur.q) * 180 / Math.PI, w: bx.size[0], d: bx.size[1], color: bx.color };
    });
    return { name: MF.model.name, bodies: kopie(koerper), boxes: kopie(kisten), sim: this._simInfo() };
  }

  // ---------- Verlauf ----------

  async rueckgaengig() {
    await this._bereit;
    const MF = this.MF;
    if (!MF.history.canUndo()) throw fehler('Nichts zum Rückgängigmachen.');
    MF.history.undo();
    return { ok: true, canUndo: MF.history.canUndo(), canRedo: MF.history.canRedo() };
  }

  async wiederholen() {
    await this._bereit;
    const MF = this.MF;
    if (!MF.history.canRedo()) throw fehler('Nichts zum Wiederholen.');
    MF.history.redo();
    return { ok: true, canUndo: MF.history.canUndo(), canRedo: MF.history.canRedo() };
  }
}

module.exports = { SitzungHeadless: SitzungHeadless, SitzungsFehler: SitzungsFehler };
