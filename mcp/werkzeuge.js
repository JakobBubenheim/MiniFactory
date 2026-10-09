// Werkzeuge (MCP-Tools) der Mini-Fabrik.
//
// Namen englisch in snake_case, Beschreibungen deutsch mit Einheiten. Jedes
// Werkzeug arbeitet nur gegen die Sitzung (mcp/sitzung-headless.js bzw. später
// die Live-Sitzung) und den Dateizugriff (mcp/dateien.js). Fehler, die der Agent
// beheben kann, kommen als Tool-Ergebnis mit isError: true und deutschem Hinweis.
// Vorlagen, Funktionen und Signale kommen immer aus der App (MF.templates,
// MF.FUNCTIONS, MF.io) – hier gibt es keine Sonderfälle je Vorlage.
'use strict';

const bild = require('./bild');
const inhalte = require('./inhalte');

// ---------- Kleine JSON-Schema-Prüfung (nur was die Schemas hier benutzen) ----------

function typVon(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

function passtTyp(v, typ) {
  const t = typVon(v);
  if (typ === 'number') return t === 'number' || t === 'integer';
  return t === typ;
}

// Gibt einen Fehlertext zurück oder ''
function pruefeSchema(schema, v, wo) {
  if (!schema || schema === true) return '';
  if (schema.type) {
    const typen = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!typen.some(function (t) { return passtTyp(v, t); })) {
      return wo + ' muss vom Typ ' + typen.join(' oder ') + ' sein (ist ' + typVon(v) + ').';
    }
  }
  if (schema.enum && schema.enum.indexOf(v) < 0) return wo + ' muss einer dieser Werte sein: ' + schema.enum.join(', ') + '.';
  if (typeof v === 'number') {
    if (schema.minimum !== undefined && v < schema.minimum) return wo + ' muss ≥ ' + schema.minimum + ' sein.';
    if (schema.maximum !== undefined && v > schema.maximum) return wo + ' muss ≤ ' + schema.maximum + ' sein.';
    if (schema.exclusiveMinimum !== undefined && v <= schema.exclusiveMinimum) return wo + ' muss > ' + schema.exclusiveMinimum + ' sein.';
  }
  if (Array.isArray(v)) {
    if (schema.minItems !== undefined && v.length < schema.minItems) return wo + ' braucht mindestens ' + schema.minItems + ' Einträge.';
    if (schema.items) {
      for (let i = 0; i < v.length; i++) {
        const e = pruefeSchema(schema.items, v[i], wo + '[' + i + ']');
        if (e) return e;
      }
    }
  }
  if (typVon(v) === 'object') {
    const props = schema.properties || {};
    for (const k of schema.required || []) if (v[k] === undefined) return wo + ': Feld "' + k + '" fehlt.';
    for (const k of Object.keys(v)) {
      if (props[k]) {
        const e = pruefeSchema(props[k], v[k], wo === 'Eingabe' ? '"' + k + '"' : wo + '.' + k);
        if (e) return e;
      } else if (schema.additionalProperties === false) {
        return wo + ': unbekanntes Feld "' + k + '". Erlaubt: ' + Object.keys(props).join(', ') + '.';
      }
    }
  }
  return '';
}

// ---------- Bausteine für Schemas ----------

const Z = function (d, extra) { return Object.assign({ type: 'number', description: d }, extra || {}); };
const T = function (d, extra) { return Object.assign({ type: 'string', description: d }, extra || {}); };
const B = function (d) { return { type: 'boolean', description: d }; };
const PUNKTE = { type: 'array', minItems: 3, description: 'Polygonpunkte [[x, y], …] in m, lokal zur Lage (x, y)', items: { type: 'array', items: { type: 'number' }, minItems: 2 } };
const KIND = T('Körperart: ghost (immateriell: Sensor/Erzeuger/Senke), static (fest: Band, Wand, Rutsche), kinematic (bewegt über Achse), dynamic (fällt/rutscht)', { enum: ['ghost', 'static', 'kinematic', 'dynamic'] });
const MATERIAL = { type: 'object', description: 'Werkstoff: friction (Reibung 0–1), restitution (Stoßzahl 0–1), density (kg/m³)', properties: { friction: Z('Reibung'), restitution: Z('Stoßzahl'), density: Z('Dichte in kg/m³') }, additionalProperties: false };
const LEER = { type: 'object', properties: {}, additionalProperties: false };

function objekt(props, required) {
  const s = { type: 'object', properties: props, additionalProperties: false };
  if (required && required.length) s.required = required;
  return s;
}

// ---------- Ergebnisse ----------

function json(v) { return JSON.stringify(v); }
function text(t) { return { content: [{ type: 'text', text: t }] }; }
function daten(v, vorspann) { return text((vorspann ? vorspann + '\n' : '') + json(v)); }

// ---------- Werkzeuge ----------

const WERKZEUGE = [
  {
    name: 'get_overview',
    title: 'Anlage ansehen',
    description: 'Die aktuelle Anlage kompakt als JSON: Körper (ID, Name, Vorlage, Körperart, Form in m, Lage pose {x, y, z, rot}, ' +
      'Hüllrechteck bounds, Oberkante top in m, Funktionen mit Werten, Eigenschaften der Vorlage, Signale), Ordner, Regeln/SCL ' +
      '(mit Übersetzungsfehlern) und alle Signalwerte. Vor jeder Änderung und nach dem Bauen aufrufen.',
    inputSchema: LEER,
    annotations: { readOnlyHint: true },
    run: async function (a, k) { return daten(await k.sitzung.uebersicht()); }
  },
  {
    name: 'list_templates',
    title: 'Vorlagen und Funktionen',
    description: 'Alle Vorlagen (Katalog) mit Standardform, Höhe z/top, Funktionen, Signalen und Eigenschaften (props mit Einheit und ' +
      'Grenzen) sowie alle Funktionen (surface, axis, sensor, spawner, sink) mit Feldern, erlaubten Körperarten und Signalen. ' +
      'Kommt direkt aus der App – neue Vorlagen erscheinen hier von selbst.',
    inputSchema: LEER,
    annotations: { readOnlyHint: true },
    run: async function (a, k) { return daten(await k.sitzung.vorlagen()); }
  },
  {
    name: 'new_plant',
    title: 'Neue Anlage',
    description: 'Leere Anlage anlegen (ersetzt die aktuelle im Speicher, Dateien bleiben unberührt). dtMs = SPS-Zyklus in ms (Standard 20).',
    inputSchema: objekt({ name: T('Name der Anlage'), dtMs: { type: 'integer', minimum: 1, maximum: 1000, description: 'SPS-Zyklus in ms (Standard 20)' } }),
    annotations: { destructiveHint: true },
    run: async function (a, k) { return daten(await k.sitzung.neu(a), 'Neue, leere Anlage angelegt.'); }
  },
  {
    name: 'load_plant',
    title: 'Anlage laden',
    description: 'Anlage aus einer .mfab-Datei im Anlagen-Ordner laden (path relativ zum Ordner) oder eine Beispielanlage ' +
      '(example: ' + inhalte.BEISPIELE.map(function (b) { return b.key; }).join(', ') + '). Ältere Dateien werden umgerechnet.',
    inputSchema: objekt({ path: T('Datei relativ zum Anlagen-Ordner, z. B. "strecke.mfab"'), example: T('Name einer Beispielanlage', { enum: inhalte.BEISPIELE.map(function (b) { return b.key; }) }) }),
    annotations: { destructiveHint: true },
    run: async function (a, k) {
      if (!!a.path === !!a.example) throw new k.Fehler('Entweder "path" oder "example" angeben.');
      if (a.example) {
        const res = await k.sitzung.ladenDatei(inhalte.beispielDatei(a.example));
        return daten(res, 'Beispiel "' + a.example + '" geladen. Erklärung: Ressource mini-fabrik://beispiele/' + a.example + '.');
      }
      const d = k.dateien.lesen(a.path);
      const res = await k.sitzung.ladenDatei(d.inhalt);
      res.path = d.pfad;
      return daten(res, 'Geladen.');
    }
  },
  {
    name: 'save_plant',
    title: 'Anlage speichern',
    description: 'Anlage als .mfab-Datei in den Anlagen-Ordner schreiben (path relativ dazu; .mfab wird ergänzt). Der Nutzer öffnet ' +
      'sie in der App mit Datei → Öffnen. Vorher validate aufrufen.',
    inputSchema: objekt({ path: T('Dateiname bzw. Pfad relativ zum Anlagen-Ordner, z. B. "strecke.mfab"'), overwrite: B('Vorhandene Datei überschreiben (Standard true)') }, ['path']),
    run: async function (a, k) {
      const p = k.dateien.schreiben(a.path, await k.sitzung.datei(), a.overwrite);
      return daten({ path: p, folder: k.dateien.basisOrdner() }, 'Gespeichert. Der Nutzer öffnet die Datei in der Mini-Fabrik über Datei → Öffnen: ' + p);
    }
  },
  {
    name: 'list_plants',
    title: 'Gespeicherte Anlagen',
    description: 'Alle .mfab-Dateien im Anlagen-Ordner (Pfad, Größe, Änderungszeit).',
    inputSchema: LEER,
    annotations: { readOnlyHint: true },
    run: async function (a, k) { return daten(k.dateien.auflisten()); }
  },
  {
    name: 'validate',
    title: 'Anlage prüfen',
    description: 'Prüft die Anlage wie beim Öffnen einer Datei (fehler) und gegen die Bauregeln (hinweise): Erzeuger über einer Fläche, ' +
      'was hinter jedem Bandende kommt, Bänder an Nähten 1 cm versetzt, Sensoren über einer Fläche, unvollständige Regeln, SCL-Fehler.',
    inputSchema: LEER,
    annotations: { readOnlyHint: true },
    run: async function (a, k) {
      const res = await k.sitzung.pruefen();
      const kopf = res.fehler.length ? res.fehler.length + ' Fehler – die App würde die Datei nicht laden.' : 'Keine Fehler.';
      return daten(res, kopf + (res.hinweise.length ? ' ' + res.hinweise.length + ' Hinweis(e) zu den Bauregeln.' : ''));
    }
  },
  {
    name: 'add_from_template',
    title: 'Körper aus Vorlage',
    description: 'Neuer Körper aus einer Vorlage (list_templates), Mitte bei (x, y) in m. rot = Drehung in Grad im Uhrzeigersinn ' +
      '(0 = Standardrichtung der Vorlage). Optional z (Unterseite, m), shape (z. B. {"w": 4} für ein 4 m langes Band), props ' +
      '(Eigenschaften der Vorlage, z. B. {"speed": 0.5, "direction": "unten"}), name, parent (Ordner-ID). Gibt die neue ID zurück.',
    inputSchema: objekt({
      template: T('Schlüssel der Vorlage, z. B. "conveyor", "source", "sink", "sensor", "pusher" (siehe list_templates)'),
      x: Z('Mitte x in m (nach rechts)'), y: Z('Mitte y in m (in der Draufsicht nach unten)'),
      rot: Z('Drehung in Grad, im Uhrzeigersinn'), z: Z('Unterseite in m über dem Boden (Standard aus der Vorlage)'),
      shape: { type: 'object', description: 'Maße ändern: w, d (Rechteck), r (Kreis), h (Höhe), h2, points – in m' },
      props: { type: 'object', description: 'Eigenschaften der Vorlage { key: Wert } (keys aus list_templates)' },
      name: T('Anzeigename'), parent: T('Ordner-ID (create_folder)'), color: T('Farbe "#RRGGBB"')
    }, ['template', 'x', 'y']),
    run: async function (a, k) { return daten(await k.sitzung.vorlageEinfuegen(a), 'Angelegt.'); }
  },
  {
    name: 'draw_shape',
    title: 'Form zeichnen',
    description: 'Frei gestalteten Körper zeichnen: Rechteck (w × d), Kreis (r) oder Polygon (points, lokal zu x/y), Höhe h, Unterseite z, ' +
      'Drehung rot. Neue Formen sind "ghost"; kind setzen für feste Körper (static), z. B. Wände, Tische, Rutschen. ' +
      'Rutsche: kind "static" und h2 = Höhe am Ende der lokalen x-Achse (h am Anfang), bergab zeigt lokal +x, wenn h2 < h.',
    inputSchema: objekt({
      type: T('Form', { enum: ['rect', 'circle', 'polygon'] }),
      w: Z('Breite in m (lokal x, nur rect)', { exclusiveMinimum: 0 }), d: Z('Tiefe in m (lokal y, nur rect)', { exclusiveMinimum: 0 }),
      r: Z('Radius in m (nur circle)', { exclusiveMinimum: 0 }), points: PUNKTE,
      h: Z('Höhe in m (Standard 0,1)', { exclusiveMinimum: 0 }), h2: Z('Höhe am Ende der lokalen x-Achse in m (Neigung, nur static)', { minimum: 0 }),
      x: Z('Lage x in m'), y: Z('Lage y in m'), z: Z('Unterseite in m (Standard 0)'), rot: Z('Drehung in Grad, im Uhrzeigersinn'),
      kind: KIND, name: T('Anzeigename'), parent: T('Ordner-ID'), material: MATERIAL, color: T('Farbe "#RRGGBB"')
    }, ['type', 'x', 'y']),
    run: async function (a, k) { return daten(await k.sitzung.formZeichnen(a), 'Gezeichnet.'); }
  },
  {
    name: 'update_body',
    title: 'Körper ändern',
    description: 'Körper ändern wie im Eigenschaften-Panel. fields: Lage x, y, z, rot; Form w, d, r, h, h2 (null = Neigung weg), points; ' +
      'kind (entfernt nicht erlaubte Funktionen); name; material {friction, restitution, density}; color; visible; ' +
      'props {Eigenschaft der Vorlage: Wert}. Ungültiges wird ganz abgelehnt, nichts halb geändert.',
    inputSchema: objekt({
      id: T('Körper-ID, z. B. "B1"'),
      fields: { type: 'object', description: 'Zu ändernde Felder, z. B. {"x": 3, "w": 4.5, "props": {"speed": 0.8}}' }
    }, ['id', 'fields']),
    run: async function (a, k) { return daten(await k.sitzung.koerperAendern(a.id, a.fields), 'Geändert.'); }
  },
  {
    name: 'set_function',
    title: 'Funktion setzen',
    description: 'Funktion eines Körpers anlegen/ändern (fields = Objekt, {} = Standardwerte) oder entfernen (fields = null). ' +
      'Funktionen: surface (Transportfläche: speed m/s, dir Grad lokal, running), axis (Achse), sensor (invert, debounce ms), ' +
      'spawner (Erzeuger: interval s, maxCount, enabled), sink (Senke). Erlaubte Körperarten und Felder: list_templates.',
    inputSchema: objekt({
      id: T('Körper-ID'),
      function: T('surface, axis, sensor, spawner, sink (oder der deutsche Name)'),
      fields: { type: ['object', 'null'], description: 'Felder der Funktion oder null zum Entfernen' }
    }, ['id', 'function', 'fields']),
    run: async function (a, k) { return daten(await k.sitzung.funktionSetzen(a.id, a.function, a.fields), a.fields === null ? 'Entfernt.' : 'Gesetzt.'); }
  },
  {
    name: 'delete',
    title: 'Löschen',
    description: 'Körper, Regeln oder Ordner löschen (IDs). Regeln auf Signale gelöschter Körper verlieren den Bezug; ' +
      'beim Ordner wandert der Inhalt eine Ebene nach oben.',
    inputSchema: objekt({ ids: { type: 'array', minItems: 1, items: { type: 'string' }, description: 'IDs, z. B. ["B2", "R3"]' } }, ['ids']),
    annotations: { destructiveHint: true },
    run: async function (a, k) { return daten(await k.sitzung.loeschen(a.ids), 'Gelöscht.'); }
  },
  {
    name: 'create_folder',
    title: 'Ordner anlegen',
    description: 'Ordner im Strukturbaum anlegen: area "plant" (Körper, Standard) oder "logic" (Regeln), optional unter parent.',
    inputSchema: objekt({ name: T('Name des Ordners'), area: T('Bereich', { enum: ['plant', 'logic'] }), parent: T('Eltern-Ordner-ID') }, ['name']),
    run: async function (a, k) { return daten(await k.sitzung.ordnerAnlegen(a), 'Ordner angelegt.'); }
  },
  {
    name: 'move_to_folder',
    title: 'In Ordner verschieben',
    description: 'Körper, Regeln oder Ordner in einen Ordner verschieben (folder = null: oberste Ebene).',
    inputSchema: objekt({ ids: { type: 'array', minItems: 1, items: { type: 'string' }, description: 'IDs' }, folder: { type: ['string', 'null'], description: 'Ziel-Ordner-ID oder null' } }, ['ids', 'folder']),
    run: async function (a, k) { return daten(await k.sitzung.verschieben(a.ids, a.folder), 'Verschoben.'); }
  },
  {
    name: 'add_rule',
    title: 'Wenn-dann-Regel',
    description: 'Einfache Regel: in jedem SPS-Zyklus gilt then := (when ≠ 0), sonst 0 – wie eine Spule. when = beliebiges Signal ' +
      '(z. B. "LS1.Belegt"), then = Eingang (z. B. "S1.Ausfahren", "B1.Ein"). Mehrere Regeln auf dasselbe Ziel sind ODER-verknüpft. ' +
      'Für Zeiten, Zähler, UND/NICHT: add_scl.',
    inputSchema: objekt({ when: T('Signal, das gelesen wird'), then: T('Eingang, der gesetzt wird'), name: T('Name'), description: T('Beschreibung'), enabled: B('aktiv (Standard true)'), folder: T('Ordner-ID im Bereich logic') }, ['when', 'then']),
    run: async function (a, k) { return daten(await k.sitzung.regelAnlegen(a), 'Regel angelegt.'); }
  },
  {
    name: 'add_scl',
    title: 'SCL-Baustein',
    description: 'SCL-Baustein (Structured Text, IEC 61131-3) anlegen; läuft jeden Zyklus nach den einfachen Regeln. Signale: "LS1".Belegt ' +
      'oder LS1.Belegt. VAR … END_VAR, IF/ELSIF/ELSE, CASE, TON/TOF/TP/R_TRIG/F_TRIG/CTU/CTD/SR/RS, Zeiten T#2s. Bei einem ' +
      'Übersetzungsfehler wird nichts angelegt; die Antwort nennt Zeile und Spalte.',
    inputSchema: objekt({ code: T('SCL-Code'), name: T('Name'), description: T('Beschreibung'), enabled: B('aktiv (Standard true)'), folder: T('Ordner-ID im Bereich logic') }, ['code']),
    run: async function (a, k) { return daten(await k.sitzung.sclAnlegen(a), 'SCL-Baustein angelegt (fehlerfrei übersetzt).'); }
  },
  {
    name: 'update_rule',
    title: 'Regel ändern',
    description: 'Regel oder SCL-Baustein ändern: fields when, then (Regel) bzw. code (SCL), name, description, enabled. Neuer SCL-Code wird vorher übersetzt.',
    inputSchema: objekt({ id: T('Regel-ID, z. B. "R1"'), fields: { type: 'object', description: 'Zu ändernde Felder' } }, ['id', 'fields']),
    run: async function (a, k) { return daten(await k.sitzung.regelAendern(a.id, a.fields), 'Geändert.'); }
  },
  {
    name: 'delete_rule',
    title: 'Regel löschen',
    description: 'Regel oder SCL-Baustein löschen.',
    inputSchema: objekt({ id: T('Regel-ID') }, ['id']),
    annotations: { destructiveHint: true },
    run: async function (a, k) { return daten(await k.sitzung.regelLoeschen(a.id), 'Gelöscht.'); }
  },
  {
    name: 'simulate',
    title: 'Simulieren',
    description: 'Simulation headless laufen lassen (fester Zeitschritt, echte Physik) und Zusammenfassung liefern: Kisten erzeugt je ' +
      'Erzeuger, aufgenommen je Senke, auf dem Boden (heruntergefallen), stillstehend (Stau), Rückstau an Erzeugern, Signalwerte am Ende, ' +
      'Flanken und Anteil "an" je BOOL-Signal, SCL-Laufzeitfehler, Hinweise. reset (Standard true) startet bei 0 s ohne Kisten. ' +
      'set_signals setzt Eingänge bzw. forct Ausgänge vor dem Lauf, trace zeichnet Wechsel einzelner Signale mit Zeit auf. render: Bild am Ende mitliefern.',
    inputSchema: objekt({
      seconds: Z('Dauer in s (bis 600)', { exclusiveMinimum: 0, maximum: 600 }),
      reset: B('vorher zurücksetzen (Standard true); false = weiterlaufen lassen'),
      set_signals: { type: 'object', description: 'Signale vor dem Lauf setzen, z. B. {"B1.Ein": 0}' },
      trace: { type: 'array', items: { type: 'string' }, description: 'Signale, deren Wechsel mit Zeit aufgezeichnet werden' },
      render: B('Draufsicht am Ende als Bild anhängen')
    }, ['seconds']),
    run: async function (a, k) {
      const res = await k.sitzung.simulieren(a);
      const out = daten(res, 'Simuliert ' + res.time.start + ' → ' + res.time.end + ' s.');
      if (a.render) {
        const b = bild.draufsicht(await k.sitzung.szene(), {});
        out.content.push({ type: 'image', data: b.png.toString('base64'), mimeType: 'image/png' });
      }
      return out;
    }
  },
  {
    name: 'set_signal',
    title: 'Signal setzen',
    description: 'Signal von Hand setzen wie im I/O-Tab: Eingänge (EIN) werden geschrieben, Ausgänge (AUS) geforct (festgehalten). ' +
      'value = Zahl oder true/false; null hebt das Forcen auf.',
    inputSchema: objekt({ signal: T('Signal, z. B. "B1.Ein" oder "LS1.Belegt"'), value: { type: ['number', 'boolean', 'null'], description: 'Wert (BOOL: 0/1), null = Forcen aufheben' } }, ['signal', 'value']),
    run: async function (a, k) { return daten(await k.sitzung.signalSetzen(a.signal, a.value)); }
  },
  {
    name: 'get_signals',
    title: 'Signale',
    description: 'Alle Signale mit Richtung (in/out), Typ, aktuellem Wert, geforct, und welche Regeln sie schreiben/lesen.',
    inputSchema: LEER,
    annotations: { readOnlyHint: true },
    run: async function (a, k) { return daten(await k.sitzung.signale()); }
  },
  {
    name: 'render_topview',
    title: 'Draufsicht als Bild',
    description: 'PNG der Draufsicht: Körper mit IDs, Laufrichtungen (Pfeile), Gefälle, Achsen, Raster mit Metern (x nach rechts, ' +
      'y nach unten) und aktuelle Kisten. Zum Vergleich mit der Skizze des Nutzers nach dem Bauen aufrufen.',
    inputSchema: objekt({
      width: { type: 'integer', minimum: 200, maximum: 2000, description: 'Breite in Pixeln (Standard 1000)' },
      boxes: B('Kisten zeigen (Standard true)'),
      labels: T('Beschriftung', { enum: ['id', 'name', 'none'] }),
      region: { type: 'object', description: 'Ausschnitt in m {x0, y0, x1, y1} (Standard: ganze Anlage)', properties: { x0: Z('m'), y0: Z('m'), x1: Z('m'), y1: Z('m') }, required: ['x0', 'y0', 'x1', 'y1'], additionalProperties: false }
    }),
    annotations: { readOnlyHint: true },
    run: async function (a, k) {
      if (a.region && !(a.region.x1 > a.region.x0 && a.region.y1 > a.region.y0)) throw new k.Fehler('region: x1 > x0 und y1 > y0 nötig.');
      const b = bild.draufsicht(await k.sitzung.szene(), a);
      return { content: [{ type: 'image', data: b.png.toString('base64'), mimeType: 'image/png' }, { type: 'text', text: b.text }] };
    }
  },
  {
    name: 'undo',
    title: 'Rückgängig',
    description: 'Letzte Änderung rückgängig machen (jeder Werkzeug-Aufruf ist ein Schritt).',
    inputSchema: LEER,
    run: async function (a, k) { return daten(await k.sitzung.rueckgaengig(), 'Rückgängig gemacht.'); }
  },
  {
    name: 'redo',
    title: 'Wiederholen',
    description: 'Rückgängig gemachte Änderung wiederholen.',
    inputSchema: LEER,
    run: async function (a, k) { return daten(await k.sitzung.wiederholen(), 'Wiederholt.'); }
  }
];

const NACH_NAME = {};
WERKZEUGE.forEach(function (w) { NACH_NAME[w.name] = w; });

// Liste für tools/list (ohne die Funktion)
function liste() {
  return WERKZEUGE.map(function (w) {
    const o = { name: w.name, title: w.title, description: w.description, inputSchema: w.inputSchema };
    if (w.annotations) o.annotations = Object.assign({ title: w.title }, w.annotations);
    return o;
  });
}

/**
 * Werkzeug ausführen. Unbekannter Name -> null (Protokollfehler beim Aufrufer).
 * Bedienfehler (falsche Eingabe, Sitzung, Datei) -> isError mit Hinweis.
 */
async function aufrufen(name, args, kontext) {
  const w = NACH_NAME[name];
  if (!w) return null;
  args = args === undefined || args === null ? {} : args;
  const err = pruefeSchema(w.inputSchema, args, 'Eingabe');
  if (err) return { content: [{ type: 'text', text: 'Ungültige Eingabe für ' + name + ': ' + err }], isError: true };
  try {
    return await w.run(args, kontext);
  } catch (e) {
    const bekannt = e instanceof kontext.Fehler || e instanceof kontext.SitzungsFehler || e instanceof kontext.DateiFehler;
    const t = bekannt ? e.message : 'Interner Fehler in ' + name + ': ' + (e && e.message) + ' – bitte melden; die Anlage ist unverändert oder nur teilweise geändert (get_overview zeigt den Stand).';
    if (!bekannt) kontext.log('Fehler in ' + name + ': ' + (e && e.stack || e));
    return { content: [{ type: 'text', text: t }], isError: true };
  }
}

module.exports = { liste: liste, aufrufen: aufrufen, pruefeSchema: pruefeSchema, WERKZEUGE: WERKZEUGE };
