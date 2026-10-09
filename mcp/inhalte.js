// Ressourcen und Prompt des MCP-Servers: Anleitung, Beispielanlagen, "anlage_bauen".
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ANLEITUNG_URI = 'mini-fabrik://anleitung';

const BEISPIELE = [
  {
    key: 'strecke', title: 'Einfache Strecke',
    text: 'Quelle Q1 über dem Anfang eines 4-m-Bands B1 (x 0,5 … 4,5 m, Oberkante 0,7 m, läuft nach rechts), ' +
      'Senke SE1 direkt hinter dem Bandende. Alle 2 s eine Kiste, in 30 s kommen etwa 12 in SE1 an. Keine Logik nötig.'
  },
  {
    key: 'ausschleusen', title: 'Ausschleusen mit Schieber',
    text: 'Band B1 (4,5 m) nach rechts, Lichtschranke LS1 quer bei x 3,75 m, Schieber S1 oberhalb des Bands (schiebt nach unten, ' +
      'Hub 600 mm, 1 m/s), Senke SE2 gegenüber unterhalb des Bands, SE1 am Bandende. Regel R1: WENN LS1.Belegt DANN S1.Ausfahren – ' +
      'jede Kiste landet in SE2. Ohne R1 laufen alle nach SE1.'
  },
  {
    key: 'rutsche', title: 'Band und Rutsche',
    text: 'Band B1 liefert auf eine gezeichnete Rutsche K1 (static, Rechteck 1,5 × 0,5 m, h 0,68 m am Anfang = 2 cm unter dem Band, ' +
      'h2 0,1 m am Ende, Reibung 0,1). Die Schwerkraft bringt die Kisten in die Senke SE1 am Fuß der Rutsche.'
  }
];

function anleitung() {
  return fs.readFileSync(path.join(__dirname, 'anleitung.md'), 'utf8');
}

function beispielDatei(key) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'beispiele', key + '.mfab'), 'utf8'));
}

function ressourcen() {
  return [{
    uri: ANLEITUNG_URI, name: 'anleitung', title: 'Mini-Fabrik: Anleitung für Agents', mimeType: 'text/markdown',
    description: 'Koordinaten, Körperarten, Vorlagen, Signale, Bauregeln, Regeln/SCL und Ablauf – vor dem Bauen lesen.'
  }].concat(BEISPIELE.map(function (b) {
    return {
      uri: 'mini-fabrik://beispiele/' + b.key, name: 'beispiel-' + b.key, title: 'Beispiel: ' + b.title, mimeType: 'text/markdown',
      description: b.text
    };
  }));
}

// Inhalt einer Ressource oder null
function lesen(uri) {
  if (uri === ANLEITUNG_URI) return { uri: uri, mimeType: 'text/markdown', text: anleitung() };
  const m = /^mini-fabrik:\/\/beispiele\/([a-z]+)$/.exec(uri || '');
  const b = m && BEISPIELE.find(function (x) { return x.key === m[1]; });
  if (!b) return null;
  const text = '# Beispiel: ' + b.title + '\n\n' + b.text + '\n\nLaden: `load_plant {"example": "' + b.key + '"}`.\n\n' +
    'Datei (.mfab):\n\n```json\n' + JSON.stringify(beispielDatei(b.key)) + '\n```\n';
  return { uri: uri, mimeType: 'text/markdown', text: text };
}

// ---------- Prompt ----------

const PROMPTS = [{
  name: 'anlage_bauen',
  title: 'Anlage bauen',
  description: 'Führt durch den Bau einer Anlage aus einer Beschreibung oder Skizze: Anleitung lesen, planen, bauen, ansehen, simulieren, nachbessern, speichern.',
  arguments: [{ name: 'beschreibung', description: 'Was die Anlage tun soll (oder Hinweis auf die beigefügte Skizze)', required: true }]
}];

function prompt(name, args) {
  if (name !== 'anlage_bauen') return null;
  const beschreibung = (args && args.beschreibung) || '(keine Beschreibung – frag den Nutzer)';
  const text =
    'Baue in der Mini-Fabrik diese Anlage:\n\n' + beschreibung + '\n\n' +
    'So gehst du vor:\n' +
    '1. Lies die Ressource ' + ANLEITUNG_URI + ' (Koordinaten: x rechts, y unten, Meter; Bauregeln). Bei Bedarf list_templates.\n' +
    '2. Mach einen kurzen Plan mit Koordinaten (Bandbreite 0,5 m, Oberkante 0,7 m, Kiste 0,3 m). Liegt eine Skizze bei, übernimm ' +
    'Anordnung, Laufrichtungen und ungefähre Längen daraus.\n' +
    '3. new_plant, dann bauen mit add_from_template und draw_shape; Logik mit add_rule oder add_scl.\n' +
    '4. render_topview und get_overview: Vergleiche Lage und Laufrichtungen mit Beschreibung bzw. Skizze.\n' +
    '5. validate, dann simulate (30–60 s). Prüfe: Kommen die Kisten dort an, wo sie hin sollen? Fällt etwas herunter (onFloor), ' +
    'staut es sich (standingStill, Rückstau), gibt es SCL-Fehler?\n' +
    '6. Nachbessern (update_body, set_function, update_rule) und erneut simulieren, bis es passt.\n' +
    '7. save_plant mit einem passenden Namen und sag dem Nutzer, welche Datei er in der Mini-Fabrik über Datei → Öffnen laden soll, ' +
    'und was die Simulation ergeben hat.';
  return {
    description: 'Anlage bauen: ' + beschreibung.slice(0, 80),
    messages: [{ role: 'user', content: { type: 'text', text: text } }]
  };
}

const INSTRUCTIONS =
  'Mini-Fabrik: Förderanlagen bauen, steuern (Regeln/SCL) und simulieren. Vor dem Bauen die Ressource ' + ANLEITUNG_URI +
  ' lesen (Koordinaten in Metern, x rechts, y unten; Bauregeln). Ablauf wie im Prompt "anlage_bauen": planen → bauen → ' +
  'render_topview → validate → simulate → nachbessern → save_plant. Dateien liegen nur im Anlagen-Ordner; der Nutzer öffnet sie ' +
  'in der App über Datei → Öffnen.';

module.exports = {
  ANLEITUNG_URI: ANLEITUNG_URI, BEISPIELE: BEISPIELE, ressourcen: ressourcen, lesen: lesen, beispielDatei: beispielDatei,
  PROMPTS: PROMPTS, prompt: prompt, INSTRUCTIONS: INSTRUCTIONS
};
