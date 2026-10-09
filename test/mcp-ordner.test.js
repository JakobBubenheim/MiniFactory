// MCP-Server: Anlagen-Ordner aus MINI_FABRIK_DIR, auch mit Platzhaltern von Claude Desktop.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const dateien = require('../mcp/dateien');

function mitOrdner(wert, fn) {
  const alt = process.env.MINI_FABRIK_DIR;
  if (wert === undefined) delete process.env.MINI_FABRIK_DIR;
  else process.env.MINI_FABRIK_DIR = wert;
  try { return fn(); } finally {
    if (alt === undefined) delete process.env.MINI_FABRIK_DIR;
    else process.env.MINI_FABRIK_DIR = alt;
  }
}

const STANDARD = path.join(os.homedir(), 'Mini-Fabrik');

test('Anlagen-Ordner: ${HOME} im Standardwert des Bündels wird aufgelöst', function () {
  assert.equal(mitOrdner('${HOME}/Mini-Fabrik', dateien.basisOrdner), STANDARD);
  assert.equal(mitOrdner('${DOCUMENTS}${/}Anlagen', dateien.basisOrdner),
    path.join(os.homedir(), 'Documents', 'Anlagen'));
});

test('Anlagen-Ordner: leer oder unaufgelöste Einstellung ergibt ~/Mini-Fabrik', function () {
  assert.equal(mitOrdner(undefined, dateien.basisOrdner), STANDARD);
  assert.equal(mitOrdner('', dateien.basisOrdner), STANDARD);
  assert.equal(mitOrdner('${user_config.plant_dir}', dateien.basisOrdner), STANDARD);
  assert.equal(mitOrdner('${UNBEKANNT}/x', dateien.basisOrdner), STANDARD);
});

test('Anlagen-Ordner: ~ und absolute Pfade bleiben wie angegeben', function () {
  assert.equal(mitOrdner('~/Fabrik', dateien.basisOrdner), path.join(os.homedir(), 'Fabrik'));
  const abs = path.join(os.tmpdir(), 'mf-ordner');
  assert.equal(mitOrdner(abs, dateien.basisOrdner), abs);
});
