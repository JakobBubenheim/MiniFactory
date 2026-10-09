// MCP-Server: startet node mcp/server.js als Kindprozess und spricht echtes MCP über stdio.
// Der Server läuft für alle Tests dieser Datei nur einmal (Tempo); die Tests laufen
// deshalb nacheinander und beginnen jeweils mit new_plant oder load_plant.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const zlib = require('node:zlib');
const { neueAnlage } = require('./helpers/anlage');
const { laden, vorbereiten } = require('./helpers/load');

const ORDNER = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-fabrik-mcp-'));

// ---------- kleiner MCP-Client ----------

let kind, naechsteId = 1;
const offen = new Map();

test.before(function () {
  kind = spawn(process.execPath, [path.join(__dirname, '..', 'mcp', 'server.js')], {
    env: Object.assign({}, process.env, { MINI_FABRIK_DIR: ORDNER }),
    stdio: ['pipe', 'pipe', 'pipe']
  });
  kind.stderr.resume();   // Logs nicht stauen lassen
  readline.createInterface({ input: kind.stdout }).on('line', function (z) {
    const msg = JSON.parse(z);   // stdout darf nur JSON-RPC enthalten
    const p = offen.get(msg.id);
    if (p) { offen.delete(msg.id); p(msg); }
  });
});

test.after(function () {
  kind.stdin.end();
  fs.rmSync(ORDNER, { recursive: true, force: true });
});

function anfrage(method, params) {
  const id = naechsteId++;
  return new Promise(function (ok) {
    offen.set(id, ok);
    kind.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: id, method: method, params: params }) + '\n');
  });
}

async function ergebnis(method, params) {
  const a = await anfrage(method, params);
  assert.equal(a.error, undefined, JSON.stringify(a.error));
  return a.result;
}

// Werkzeug aufrufen; erwartet Erfolg, gibt das JSON hinter der ersten Zeile zurück
async function werkzeug(name, args) {
  const r = await ergebnis('tools/call', { name: name, arguments: args || {} });
  assert.ok(!r.isError, name + ': ' + (r.content[0] && r.content[0].text));
  return r;
}
function jsonAus(r) {
  const t = r.content.find(function (c) { return c.type === 'text'; }).text;
  // Antwort = optionale Kopfzeile, dann JSON
  return JSON.parse(/^[[{]/.test(t) ? t : t.slice(t.indexOf('\n') + 1));
}
async function fehler(name, args) {
  const r = await ergebnis('tools/call', { name: name, arguments: args });
  assert.equal(r.isError, true, name + ' sollte abgelehnt werden: ' + JSON.stringify(r.content));
  return r.content[0].text;
}

// ---------- Protokoll ----------

test('initialize handelt die Version aus, danach tools/list, Ressourcen und Prompt', async function () {
  const init = await ergebnis('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(init.protocolVersion, '2025-06-18');
  assert.equal(init.serverInfo.name, 'mini-fabrik');
  assert.ok(init.capabilities.tools && init.capabilities.resources && init.capabilities.prompts);
  assert.match(init.instructions, /mini-fabrik:\/\/anleitung/);
  kind.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  // Unbekannte Version: der Server bietet die neueste ältere an
  const alt = await ergebnis('initialize', { protocolVersion: '1999-01-01', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(alt.protocolVersion, '2025-11-25');

  const { tools } = await ergebnis('tools/list', {});
  assert.ok(tools.length >= 20);
  const namen = new Set();
  tools.forEach(function (t) {
    assert.match(t.name, /^[a-z][a-z_]*$/, 'snake_case');
    assert.ok(!namen.has(t.name), 'doppelt: ' + t.name);
    namen.add(t.name);
    assert.ok(t.description.length > 20, t.name);
    assert.equal(t.inputSchema.type, 'object', t.name);
    Object.keys(t.inputSchema.properties || {}).forEach(function (k) {
      const p = t.inputSchema.properties[k];
      assert.ok(p.type, t.name + '.' + k + ' ohne Typ');
      assert.ok(p.description, t.name + '.' + k + ' ohne Beschreibung');
    });
    (t.inputSchema.required || []).forEach(function (k) { assert.ok(t.inputSchema.properties[k], t.name + ': ' + k); });
  });
  ['get_overview', 'list_templates', 'new_plant', 'load_plant', 'save_plant', 'validate', 'add_from_template', 'draw_shape',
    'update_body', 'set_function', 'delete', 'create_folder', 'move_to_folder', 'add_rule', 'add_scl', 'update_rule',
    'delete_rule', 'simulate', 'set_signal', 'get_signals', 'render_topview'].forEach(function (n) { assert.ok(namen.has(n), n); });

  const { resources } = await ergebnis('resources/list', {});
  const uris = resources.map(function (r) { return r.uri; });
  assert.ok(uris.indexOf('mini-fabrik://anleitung') >= 0);
  assert.ok(uris.filter(function (u) { return u.startsWith('mini-fabrik://beispiele/'); }).length >= 2);
  for (const uri of uris) {
    const { contents } = await ergebnis('resources/read', { uri: uri });
    assert.ok(contents[0].text.length > 200, uri);
  }
  const fehlt = await anfrage('resources/read', { uri: 'mini-fabrik://gibtsnicht' });
  assert.ok(fehlt.error);

  const { prompts } = await ergebnis('prompts/list', {});
  assert.equal(prompts[0].name, 'anlage_bauen');
  const p = await ergebnis('prompts/get', { name: 'anlage_bauen', arguments: { beschreibung: 'Quelle, Band, Senke' } });
  assert.match(p.messages[0].content.text, /Quelle, Band, Senke/);
  assert.match(p.messages[0].content.text, /render_topview/);
});

test('neue Protokollform: _meta je Anfrage, server/discover, falsche Version wird abgelehnt', async function () {
  const meta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} };
  const d = await ergebnis('server/discover', { _meta: meta });
  assert.ok(d.supportedVersions.indexOf('2026-07-28') >= 0);
  assert.equal(d.resultType, 'complete');
  assert.equal(d._meta['io.modelcontextprotocol/serverInfo'].name, 'mini-fabrik');
  const l = await ergebnis('tools/list', { _meta: meta });
  assert.equal(l.resultType, 'complete');
  assert.ok(l.tools.length >= 20);
  // Cache-Hinweise sind Pflicht für Listen und resources/read (Claude Code prüft das)
  for (const r of [d, l, await ergebnis('prompts/list', { _meta: meta }), await ergebnis('resources/list', { _meta: meta }),
    await ergebnis('resources/read', { _meta: meta, uri: 'mini-fabrik://anleitung' })]) {
    assert.ok(Number.isInteger(r.ttlMs) && r.ttlMs >= 0);
    assert.ok(r.cacheScope === 'public' || r.cacheScope === 'private');
  }
  const aufruf = await ergebnis('tools/call', { _meta: meta, name: 'list_plants', arguments: {} });
  assert.equal(aufruf.resultType, 'complete');
  assert.equal(aufruf.ttlMs, undefined);

  const falsch = await anfrage('tools/list', { _meta: { 'io.modelcontextprotocol/protocolVersion': '1999-01-01', 'io.modelcontextprotocol/clientCapabilities': {} } });
  assert.equal(falsch.error.code, -32022);
  assert.ok(falsch.error.data.supported.indexOf('2026-07-28') >= 0);
  const ohneCaps = await anfrage('tools/list', { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } });
  assert.equal(ohneCaps.error.code, -32602);
  const unbekannt = await anfrage('tools/call', { name: 'gibt_es_nicht', arguments: {} });
  assert.equal(unbekannt.error.code, -32602);
  const methode = await anfrage('gibt/es/nicht', {});
  assert.equal(methode.error.code, -32601);
});

// ---------- Werkzeuge ----------

test('list_templates enthält alle Vorlagen aus MF.templates', async function () {
  await vorbereiten();
  const MF = laden().MF;
  const v = jsonAus(await werkzeug('list_templates'));
  assert.deepEqual(v.templates.map(function (t) { return t.key; }).sort(), [...Object.keys(MF.templates)].sort());
  assert.deepEqual(v.functions.map(function (f) { return f.key; }).sort(), [...MF.FN_KEYS].sort());
  v.templates.forEach(function (t) {
    assert.equal(t.label, MF.templates[t.key].label);
    assert.ok(Array.isArray(t.signals) && Array.isArray(t.props), t.key);
  });
});

test('Ablauf wie ein Agent: bauen, simulieren, speichern – die Datei läuft in der App gleich', async function () {
  await werkzeug('new_plant', { name: 'Strecke vom Agent' });
  const b1 = jsonAus(await werkzeug('add_from_template', { template: 'conveyor', x: 2.5, y: 1, shape: { w: 4 } })).id;
  const q1 = jsonAus(await werkzeug('add_from_template', { template: 'source', x: 0.75, y: 1 })).id;
  const se1 = jsonAus(await werkzeug('add_from_template', { template: 'sink', x: 4.75, y: 1 })).id;
  assert.deepEqual([b1, q1, se1], ['B1', 'Q1', 'SE1']);
  // Band läuft nur, solange die Quelle freigegeben ist (Regel, damit auch Logik dabei ist)
  const r = jsonAus(await werkzeug('add_rule', { when: 'Q1.Freigabe', then: 'B1.Ein' }));
  assert.equal(r.id, 'R1');

  const pr = jsonAus(await werkzeug('validate'));
  assert.deepEqual(pr.fehler, []);
  assert.deepEqual(pr.hinweise, []);

  const sim = jsonAus(await werkzeug('simulate', { seconds: 30 }));
  assert.equal(sim.time.end, 30);
  assert.ok(sim.boxes.sunk.SE1 >= 10, 'Kisten in SE1: ' + sim.boxes.sunk.SE1);
  assert.equal(sim.boxes.onFloor.length, 0);
  assert.equal(sim.signalsEnd['SE1.Anzahl'], sim.boxes.sunk.SE1);

  const ov = jsonAus(await werkzeug('get_overview'));
  assert.equal(ov.bodies.find(function (b) { return b.id === 'B1'; }).top, 0.7);

  const gesp = jsonAus(await werkzeug('save_plant', { path: 'agent/strecke' }));
  assert.equal(gesp.path, path.join(fs.realpathSync(ORDNER), 'agent', 'strecke.mfab'));
  const datei = JSON.parse(fs.readFileSync(gesp.path, 'utf8'));

  // Dieselbe Datei in der App-Fassade: läuft gleich
  const a = neueAnlage(datei);
  a.laufen(30);
  assert.equal(a.signal('SE1.Anzahl'), sim.boxes.sunk.SE1);

  // Und zurück: load_plant liest sie wieder
  const ld = jsonAus(await werkzeug('load_plant', { path: 'agent/strecke.mfab' }));
  assert.equal(ld.bodies, 3);
  const plants = jsonAus(await werkzeug('list_plants'));
  assert.deepEqual(plants.files.map(function (f) { return f.path; }), [path.join('agent', 'strecke.mfab')]);
});

test('Beispiel "ausschleusen": mit R1 landen die Kisten in SE2, Rückgängig nimmt Änderungen zurück', async function () {
  await werkzeug('load_plant', { example: 'ausschleusen' });
  const sim = jsonAus(await werkzeug('simulate', { seconds: 20, trace: ['LS1.Belegt'] }));
  assert.ok(sim.boxes.sunk.SE2 >= 5);
  assert.equal(sim.boxes.sunk.SE1, 0);
  assert.ok(sim.edges['LS1.Belegt'].rising >= 5);
  assert.ok(sim.trace['LS1.Belegt'].length >= 10);

  await werkzeug('update_rule', { id: 'R1', fields: { enabled: false } });
  const ohne = jsonAus(await werkzeug('simulate', { seconds: 20 }));
  assert.equal(ohne.boxes.sunk.SE2, 0);
  assert.ok(ohne.boxes.sunk.SE1 >= 5);
  await werkzeug('undo');
  assert.equal(jsonAus(await werkzeug('get_overview')).rules[0].enabled, true);
});

test('render_topview liefert ein gültiges PNG, das etwas zeigt', async function () {
  await werkzeug('load_plant', { example: 'rutsche' });
  await werkzeug('simulate', { seconds: 5 });
  const r = await werkzeug('render_topview', { width: 600 });
  const img = r.content.find(function (c) { return c.type === 'image'; });
  assert.equal(img.mimeType, 'image/png');
  const png = Buffer.from(img.data, 'base64');
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.toString('ascii', 12, 16), 'IHDR');
  const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
  assert.ok(w >= 500 && w <= 600 && h > 50, w + ' × ' + h);
  // Pixel auspacken (alle IDAT-Blöcke) und zählen, wie viele vom Hintergrund abweichen
  const idat = [];
  for (let i = 8; i < png.length;) {
    const len = png.readUInt32BE(i), typ = png.toString('ascii', i + 4, i + 8);
    if (typ === 'IDAT') idat.push(png.subarray(i + 8, i + 8 + len));
    i += 12 + len;
  }
  const roh = zlib.inflateSync(Buffer.concat(idat));
  assert.equal(roh.length, (w * 3 + 1) * h);
  const hg = roh.subarray(1, 4).toString('hex');
  let anders = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * (w * 3 + 1) + 1 + x * 3;
    if (roh.subarray(i, i + 3).toString('hex') !== hg) anders++;
  }
  assert.ok(anders > w * h * 0.1, 'zu wenig gezeichnet: ' + anders);
  assert.match(r.content.find(function (c) { return c.type === 'text'; }).text, /px je m/);
});

test('Fehler kommen als isError mit Hinweis, der Server läuft weiter', async function () {
  await werkzeug('new_plant', {});
  assert.match(await fehler('add_from_template', { template: 'drehbank', x: 0, y: 0 }), /Vorlage "drehbank" gibt es nicht.*conveyor/);
  assert.match(await fehler('add_from_template', { template: 'conveyor', x: 'links', y: 0 }), /"x" muss vom Typ number/);
  assert.match(await fehler('draw_shape', { type: 'polygon', points: [[0, 0], [1, 1], [1, 0], [0, 1]], x: 1, y: 1 }), /schneidet sich/);
  await werkzeug('add_from_template', { template: 'conveyor', x: 1, y: 1 });
  assert.match(await fehler('update_body', { id: 'B1', fields: { props: { speed: 99 } } }), /zwischen 0 und 5/);
  assert.match(await fehler('update_body', { id: 'B1', fields: { h2: 0.05 } }), /Transportfläche/);
  assert.match(await fehler('add_scl', { code: 'IF "B1".Ein THEN\n  "B9".Ein := TRUE;\nEND_IF;' }), /Zeile 2, Spalte \d+/);
  assert.match(await fehler('add_rule', { when: 'B1.Ein', then: 'B1.Läuft' }), /Eingang/);
  assert.match(await fehler('save_plant', { path: '../ausserhalb.mfab' }), /außerhalb des Anlagen-Ordners/);
  assert.match(await fehler('load_plant', { path: '/etc/passwd' }), /außerhalb des Anlagen-Ordners/);
  assert.match(await fehler('simulate', { seconds: 0 }), /seconds/);
  // Nichts davon hat die Anlage verändert, der Server antwortet weiter
  const ov = jsonAus(await werkzeug('get_overview'));
  assert.deepEqual(ov.bodies.map(function (b) { return b.id; }), ['B1']);
  assert.equal(ov.bodies[0].props.speed, 0.5);
  assert.equal(ov.rules.length, 0);
});

test('SCL aus der Anleitung übersetzt in der Beispielanlage', async function () {
  await werkzeug('load_plant', { example: 'ausschleusen' });
  await werkzeug('delete_rule', { id: 'R1' });
  const anl = (await ergebnis('resources/read', { uri: 'mini-fabrik://anleitung' })).contents[0].text;
  const code = /```\n(VAR[\s\S]*?)```/.exec(anl)[1];
  const r = jsonAus(await werkzeug('add_scl', { code: code }));
  assert.equal(r.regel.error, undefined);
  const sim = jsonAus(await werkzeug('simulate', { seconds: 10 }));
  assert.equal(sim.sclRuntimeErrors, undefined);
});

test('Achsen über MCP: Drehtisch per SCL auf 90°, Betriebsart umstellen passt die Signale an', async function () {
  await werkzeug('new_plant', { name: 'Drehtisch vom Agent' });
  const dt = jsonAus(await werkzeug('add_from_template', { template: 'turntable', x: 1, y: 1 })).id;
  // Betriebsarten stehen in list_templates als Liste (in der App eine Funktion)
  const achse = jsonAus(await werkzeug('list_templates')).functions.find(function (f) { return f.key === 'axis'; });
  const mode = achse.fields.find(function (f) { return f.key === 'mode'; });
  assert.ok(mode.options.indexOf('position') >= 0 && mode.options.indexOf('geschwindigkeit') >= 0, JSON.stringify(mode));

  // Neue Drehtische kommen in zweipunkt 0 … 90°; für einen Sollwinkel auf position stellen
  await werkzeug('set_function', { id: dt, function: 'axis', fields: { mode: 'position' } });
  await werkzeug('add_scl', { code: dt + '.Soll := 90.0;\n' + dt + '.Freigabe := TRUE;' });
  await werkzeug('simulate', { seconds: 3 });
  const sig = JSON.stringify(jsonAus(await werkzeug('get_signals')));
  const ist = jsonAus(await werkzeug('get_signals'));
  const wert = function (name) {
    const s = (Array.isArray(ist) ? ist : ist.signals).find(function (x) { return x.name === name; });
    assert.ok(s, name + ' fehlt: ' + sig);
    return s.value;
  };
  assert.ok(Math.abs(wert(dt + '.Ist') - 90) < 0.5, 'Ist = ' + wert(dt + '.Ist'));
  assert.equal(Number(wert(dt + '.InPosition')), 1);

  await werkzeug('set_function', { id: dt, function: 'axis', fields: { mode: 'geschwindigkeit' } });
  const namen = JSON.stringify(jsonAus(await werkzeug('get_signals')));
  assert.ok(namen.indexOf(dt + '.InPosition') < 0, 'InPosition gibt es bei Geschwindigkeit nicht');
  assert.ok(namen.indexOf(dt + '.Soll') >= 0);
  assert.match(await fehler('set_function', { id: dt, function: 'axis', fields: { mode: 'fliegen' } }), /position|zweipunkt/);
});

test('Handbetrieb-Standards über MCP: Ventil in list_templates, set_function schaltet zwei Eingänge, Drehtisch dreht mit Ausfahren', async function () {
  await werkzeug('new_plant', { name: 'Ventil vom Agent' });
  const liste = jsonAus(await werkzeug('list_templates'));
  const achse = liste.functions.find(function (f) { return f.key === 'axis'; });
  const ventil = achse.fields.find(function (f) { return f.key === 'valve'; });
  assert.ok(ventil, 'Feld valve fehlt: ' + JSON.stringify(achse.fields.map(function (f) { return f.key; })));
  assert.deepEqual(ventil.options, ['mono', 'bi']);
  assert.match(ventil.hint, /Einfahren/);
  assert.equal(achse.defaults.valve, 'mono');
  const dtVorlage = liste.templates.find(function (t) { return t.key === 'turntable'; });
  assert.ok(dtVorlage.signals.some(function (s) { return s.name === 'Ausfahren'; }), 'Drehtisch: Ausfahren');

  const s = jsonAus(await werkzeug('add_from_template', { template: 'pusher', x: 1, y: 1 })).id;
  await werkzeug('set_function', { id: s, function: 'axis', fields: { valve: 'bi' } });
  const wert = async function (name) {
    const sig = jsonAus(await werkzeug('get_signals'));
    const x = (Array.isArray(sig) ? sig : sig.signals).find(function (y) { return y.name === name; });
    assert.ok(x, name + ' fehlt');
    return Number(x.value);
  };
  assert.equal(await wert(s + '.Einfahren'), 0);
  // simulate setzt sonst vorher zurück (reset: false läuft weiter)
  await werkzeug('simulate', { seconds: 0.1, set_signals: { [s + '.Ausfahren']: 1 } });
  await werkzeug('set_signal', { signal: s + '.Ausfahren', value: 0 });
  await werkzeug('simulate', { seconds: 2, reset: false });
  assert.equal(await wert(s + '.Ausgefahren'), 1, 'bleibt draußen');
  await werkzeug('set_signal', { signal: s + '.Einfahren', value: true });
  await werkzeug('simulate', { seconds: 2, reset: false });
  assert.equal(await wert(s + '.Eingefahren'), 1);
  assert.match(await fehler('set_function', { id: s, function: 'axis', fields: { valve: 'drei' } }), /mono|bi/);

  const dt = jsonAus(await werkzeug('add_from_template', { template: 'turntable', x: 3, y: 1 })).id;
  await werkzeug('set_signal', { signal: dt + '.Ausfahren', value: 1 });
  await werkzeug('simulate', { seconds: 1.5 });
  assert.equal(await wert(dt + '.Ausgefahren'), 1);
  assert.ok(Math.abs(await wert(dt + '.Ist') - 90) < 0.01);
  const v = jsonAus(await werkzeug('validate'));
  assert.deepEqual(v.errors || v.fehler || [], [], JSON.stringify(v));
});

test('validate: bündige Bänder sind in Ordnung, ein höheres Folgeband wird gemeldet', async function () {
  await werkzeug('new_plant', { name: 'Naht' });
  await werkzeug('add_from_template', { template: 'conveyor', x: 1, y: 1 });
  await werkzeug('add_from_template', { template: 'conveyor', x: 3, y: 1 });
  await werkzeug('add_from_template', { template: 'sink', x: 4.25, y: 1 });
  function naht(pr) { return pr.hinweise.filter(function (h) { return h.indexOf('schließt an') >= 0; }); }
  assert.deepEqual(naht(jsonAus(await werkzeug('validate'))), [], 'bündig: kein Hinweis');
  await werkzeug('update_body', { id: 'B2', fields: { z: 0.61 } });
  const h = naht(jsonAus(await werkzeug('validate')));
  assert.equal(h.length, 1);
  assert.match(h[0], /^B2 schließt an B1 an, liegt aber 10 mm höher/);
  // Ein Absatz nach unten (alte Dateien) hakt nicht und wird nicht gemeldet
  await werkzeug('update_body', { id: 'B2', fields: { z: 0.59 } });
  assert.deepEqual(naht(jsonAus(await werkzeug('validate'))), []);
});

test('Richtung über MCP in Grad, auch schräg; alte Namen gelten weiter', async function () {
  await werkzeug('new_plant', { name: 'Schräg' });
  await werkzeug('add_from_template', { template: 'conveyor', x: 1, y: 1, props: { direction: 37.5 } });
  await werkzeug('add_from_template', { template: 'pusher', x: 1, y: 2, props: { direction: 'unten' } });
  function koerper(ov, id) { return ov.bodies.find(function (b) { return b.id === id; }); }
  let ov = jsonAus(await werkzeug('get_overview'));
  assert.equal(koerper(ov, 'B1').props.direction, 37.5);
  assert.equal(koerper(ov, 'B1').pose.rot, 37.5);
  assert.equal(koerper(ov, 'B1').functions.surface.worldDir, 37.5);
  assert.equal(koerper(ov, 'S1').props.direction, 90);
  assert.equal(koerper(ov, 'S1').pose.rot, 0);

  await werkzeug('update_body', { id: 'B1', fields: { props: { direction: 'links' } } });
  await werkzeug('update_body', { id: 'S1', fields: { props: { direction: 120 } } });
  ov = jsonAus(await werkzeug('get_overview'));
  assert.equal(koerper(ov, 'B1').props.direction, 180);
  assert.equal(koerper(ov, 'B1').functions.surface.worldDirName, 'links');
  assert.equal(koerper(ov, 'S1').pose.rot, 30);

  assert.match(await fehler('update_body', { id: 'B1', fields: { props: { direction: 'quer' } } }), /Zahl in Grad.*rechts, unten, links, oben/);
  const vl = jsonAus(await werkzeug('list_templates'));
  const p = vl.templates.find(function (t) { return t.key === 'conveyor'; }).props.find(function (x) { return x.key === 'direction'; });
  assert.equal(p.type, 'direction');
  assert.equal(p.unit, '°');
  assert.deepEqual(p.names, { rechts: 0, unten: 90, links: 180, oben: 270 });
});
