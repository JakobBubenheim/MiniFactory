#!/usr/bin/env node
// MCP-Server der Mini-Fabrik (Stufe A: ohne Browser).
//
// Start: node mcp/server.js – spricht MCP über stdio (eine JSON-RPC-Nachricht je
// Zeile). stdout gehört allein dem Protokoll; alle Logs gehen nach stderr.
// Rapier und die App-Skripte werden einmal beim Start geladen (tools/headless.js).
// Anlagen-Ordner: MINI_FABRIK_DIR, sonst ~/Mini-Fabrik (mcp/dateien.js).
'use strict';

// Zuerst: nichts darf versehentlich auf stdout landen (auch nicht aus den App-Skripten)
console.log = console.error;
console.info = console.error;
console.debug = console.error;

const readline = require('node:readline');
const path = require('node:path');
const fs = require('node:fs');

const { erzeugeServer } = require('./protokoll');
const werkzeuge = require('./werkzeuge');
const inhalte = require('./inhalte');
const dateien = require('./dateien');
const { SitzungHeadless, SitzungsFehler } = require('./sitzung-headless');

function log(text) { process.stderr.write('[mini-fabrik] ' + text + '\n'); }

let version = '0.0.0';
try { version = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version; } catch (e) { /* Bündel ohne package.json */ }
try { version = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8')).version || version; } catch (e) { /* kein Bündel */ }

class Fehler extends Error {}

const sitzung = new SitzungHeadless();
const kontext = {
  sitzung: sitzung,
  dateien: dateien,
  log: log,
  Fehler: Fehler,
  SitzungsFehler: SitzungsFehler,
  DateiFehler: dateien.DateiFehler
};

const server = erzeugeServer({
  info: { name: 'mini-fabrik', title: 'Mini-Fabrik', version: version },
  instructions: inhalte.INSTRUCTIONS,
  werkzeuge: {
    liste: werkzeuge.liste,
    aufrufen: async function (name, args) {
      await sitzung.bereit();
      return werkzeuge.aufrufen(name, args, kontext);
    }
  },
  inhalte: inhalte,
  senden: function (msg) { process.stdout.write(JSON.stringify(msg) + '\n'); },
  log: log
});

const t0 = Date.now();
sitzung.bereit().then(function () {
  log('bereit nach ' + (Date.now() - t0) + ' ms (Node ' + process.version + ', Anlagen-Ordner ' + dateien.basisOrdner() + ')');
}, function (e) {
  log('Physik konnte nicht geladen werden: ' + (e && e.stack || e));
  process.exit(1);
});

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', server.zeile);
// stdin zu = der Client beendet uns; offene Antworten noch schicken
rl.on('close', function () { server.fertig().then(function () { process.exit(0); }); });
process.on('uncaughtException', function (e) { log('Unerwarteter Fehler: ' + (e && e.stack || e)); });
