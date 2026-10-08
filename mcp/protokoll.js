// MCP-Protokoll (JSON-RPC 2.0) ohne SDK.
//
// Unterstützt beide Generationen der Spezifikation (modelcontextprotocol.io):
// - neu ("modern", 2026-07-28): kein Handshake; jede Anfrage trägt in params._meta
//   die Protokollversion und die Fähigkeiten des Clients, Antworten tragen
//   resultType "complete" und serverInfo in _meta. server/discover liefert Versionen,
//   Fähigkeiten und instructions.
// - alt ("legacy", 2025-11-25 bis 2024-11-05): initialize mit Versionsaushandlung,
//   danach notifications/initialized. Für ältere Clients (z. B. Claude Desktop).
// Claude Code 2.1 spricht bereits die neue Form und prüft dabei die Cache-Hinweise
// (ttlMs, cacheScope), die Listen und resources/read tragen müssen.
// Die Anfragen werden der Reihe nach abgearbeitet – die Sitzung ist ein Zustand
// (die offene Anlage), zwei Werkzeuge dürfen nicht gleichzeitig daran ändern.
'use strict';

const MODERN = ['2026-07-28'];
const LEGACY = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const ALLE = MODERN.concat(LEGACY);

const META = {
  version: 'io.modelcontextprotocol/protocolVersion',
  caps: 'io.modelcontextprotocol/clientCapabilities',
  serverInfo: 'io.modelcontextprotocol/serverInfo'
};

// Cache-Hinweise (neue Form): Werkzeuge, Prompts und Ressourcen ändern sich nur mit
// einer neuen Server-Version und sind für alle Nutzer gleich.
const CACHEBAR = ['server/discover', 'tools/list', 'prompts/list', 'resources/list', 'resources/templates/list', 'resources/read'];
const CACHE_MS = 3600000;

const FEHLER = {
  parse: -32700, ungueltig: -32600, methode: -32601, params: -32602, intern: -32603,
  version: -32022, ressourceAlt: -32002
};

class RpcFehler extends Error {
  constructor(code, message, data) { super(message); this.code = code; this.data = data; }
}

/**
 * @param {object} o
 * @param {object} o.info         { name, title, version }
 * @param {string} o.instructions Hinweise für das Modell
 * @param {object} o.werkzeuge    { liste(), aufrufen(name, args) -> Ergebnis | null }
 * @param {object} o.inhalte      { ressourcen(), lesen(uri), PROMPTS, prompt(name, args) }
 * @param {function} o.senden     schreibt eine Nachricht (Objekt) an den Client
 * @param {function} [o.log]      Protokoll nach stderr
 */
function erzeugeServer(o) {
  const log = o.log || function () {};
  let legacyVersion = null;   // ausgehandelte Version, wenn der Client initialize geschickt hat
  let kette = Promise.resolve();

  const faehigkeiten = { tools: {}, resources: {}, prompts: {} };

  function istModern(params) {
    return !!(params && params._meta && params._meta[META.version] !== undefined);
  }

  // Anfrage der neuen Generation prüfen; wirft RpcFehler
  function modernPruefen(params) {
    const v = params._meta[META.version];
    if (MODERN.indexOf(v) < 0) {
      throw new RpcFehler(FEHLER.version, 'Unsupported protocol version', { supported: ALLE, requested: v });
    }
    if (!params._meta[META.caps] || typeof params._meta[META.caps] !== 'object') {
      throw new RpcFehler(FEHLER.params, 'Missing required _meta field ' + META.caps);
    }
  }

  const methoden = {
    'initialize': function (p) {
      const gewuenscht = p && p.protocolVersion;
      legacyVersion = LEGACY.indexOf(gewuenscht) >= 0 ? gewuenscht : LEGACY[0];
      log('initialize: Client ' + JSON.stringify((p && p.clientInfo) || {}) + ' möchte ' + gewuenscht + ', vereinbart ' + legacyVersion);
      return { protocolVersion: legacyVersion, capabilities: faehigkeiten, serverInfo: o.info, instructions: o.instructions };
    },
    'server/discover': function () {
      return { supportedVersions: ALLE, capabilities: faehigkeiten, instructions: o.instructions };
    },
    'ping': function () { return {}; },
    'logging/setLevel': function () { return {}; },
    'tools/list': function () { return { tools: o.werkzeuge.liste() }; },
    'tools/call': async function (p) {
      if (!p || typeof p.name !== 'string') throw new RpcFehler(FEHLER.params, 'tools/call braucht "name".');
      if (p.arguments !== undefined && (typeof p.arguments !== 'object' || Array.isArray(p.arguments))) {
        throw new RpcFehler(FEHLER.params, '"arguments" muss ein Objekt sein.');
      }
      const res = await o.werkzeuge.aufrufen(p.name, p.arguments);
      if (!res) throw new RpcFehler(FEHLER.params, 'Unknown tool: ' + p.name);
      return res;
    },
    'resources/list': function () { return { resources: o.inhalte.ressourcen() }; },
    'resources/templates/list': function () { return { resourceTemplates: [] }; },
    'resources/read': function (p, modern) {
      const inhalt = p && o.inhalte.lesen(p.uri);
      if (!inhalt) {
        throw new RpcFehler(modern ? FEHLER.params : FEHLER.ressourceAlt, 'Resource not found', { uri: p && p.uri });
      }
      return { contents: [inhalt] };
    },
    'prompts/list': function () { return { prompts: o.inhalte.PROMPTS }; },
    'prompts/get': function (p) {
      const name = p && p.name;
      const def = o.inhalte.PROMPTS.find(function (x) { return x.name === name; });
      if (!def) throw new RpcFehler(FEHLER.params, 'Unknown prompt: ' + name);
      const fehlt = def.arguments.filter(function (a) { return a.required && !(p.arguments && p.arguments[a.name]); });
      if (fehlt.length) throw new RpcFehler(FEHLER.params, 'Missing required argument: ' + fehlt.map(function (a) { return a.name; }).join(', '));
      return o.inhalte.prompt(name, p.arguments || {});
    }
  };

  async function bearbeite(msg) {
    if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      if (msg && typeof msg === 'object' && (msg.result !== undefined || msg.error !== undefined)) return null;   // Antwort an uns: ignorieren
      return { jsonrpc: '2.0', id: msg && msg.id !== undefined ? msg.id : null, error: { code: FEHLER.ungueltig, message: 'Invalid Request' } };
    }
    const istAnfrage = msg.id !== undefined && msg.id !== null;
    if (!istAnfrage) {
      // Benachrichtigungen (initialized, cancelled …) brauchen keine Antwort
      if (msg.method === 'notifications/initialized') log('Client ist bereit (' + legacyVersion + ').');
      return null;
    }
    const params = msg.params;
    const modern = istModern(params) && msg.method !== 'initialize';
    try {
      if (modern) modernPruefen(params);
      else if (msg.method === 'server/discover') {
        throw new RpcFehler(FEHLER.params, 'Missing required _meta field ' + META.version);
      }
      const m = methoden[msg.method];
      if (!m) throw new RpcFehler(FEHLER.methode, 'Method not found: ' + msg.method);
      const result = await m(params || {}, modern);
      if (modern) {
        result.resultType = 'complete';
        if (CACHEBAR.indexOf(msg.method) >= 0) { result.ttlMs = CACHE_MS; result.cacheScope = 'public'; }
        result._meta = Object.assign({}, result._meta, { [META.serverInfo]: o.info });
      }
      return { jsonrpc: '2.0', id: msg.id, result: result };
    } catch (e) {
      if (e instanceof RpcFehler) {
        const err = { code: e.code, message: e.message };
        if (e.data !== undefined) err.data = e.data;
        return { jsonrpc: '2.0', id: msg.id, error: err };
      }
      log('Interner Fehler bei ' + msg.method + ': ' + (e && e.stack || e));
      return { jsonrpc: '2.0', id: msg.id, error: { code: FEHLER.intern, message: 'Interner Fehler: ' + (e && e.message) } };
    }
  }

  // Eine Zeile vom Client: JSON-RPC-Nachricht (oder ältere Stapel-Form)
  function zeile(text) {
    if (!text.trim()) return;
    let msg;
    try { msg = JSON.parse(text); } catch (e) {
      o.senden({ jsonrpc: '2.0', id: null, error: { code: FEHLER.parse, message: 'Parse error' } });
      return;
    }
    kette = kette.then(async function () {
      if (Array.isArray(msg)) {
        const antworten = (await Promise.all(msg.map(bearbeite))).filter(Boolean);
        if (antworten.length) o.senden(antworten);
      } else {
        const a = await bearbeite(msg);
        if (a) o.senden(a);
      }
    }).catch(function (e) { log('Fehler: ' + (e && e.stack || e)); });
  }

  return { zeile: zeile, bearbeite: bearbeite, fertig: function () { return kette; } };
}

module.exports = { erzeugeServer: erzeugeServer, MODERN: MODERN, LEGACY: LEGACY, FEHLER: FEHLER };
