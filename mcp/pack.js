// Baut das Claude-Desktop-Bündel dist/mini-fabrik.mcpb (npm run mcp:pack).
//
// Ein .mcpb ist ein Zip mit manifest.json an der Wurzel. Hinein kommt nur, was der
// Server ohne Browser braucht (tools/headless.js: DATEIEN) plus mcp/. Die Ordner
// behalten ihre Lage, damit der Server dieselben relativen Pfade findet wie im Repo.
// Gepackt wird ohne Abhängigkeiten: Zip-Einträge mit Deflate aus node:zlib.
// Das Bündel selbst wird nicht eingecheckt (dist/ steht in .gitignore).
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { crc32 } = require('./bild');
const { DATEIEN } = require('../tools/headless');

const ROOT = path.join(__dirname, '..');

function mcpDateien() {
  const out = [];
  (function gehe(rel) {
    fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true }).forEach(function (e) {
      const r = rel + '/' + e.name;
      if (e.isDirectory()) gehe(r);
      else if (e.name !== 'manifest.json' && e.name !== 'pack.js' && !e.name.startsWith('.')) out.push(r);
    });
  })('mcp');
  return out;
}

// DOS-Zeit für den Zip-Eintrag
function dosZeit(d) {
  return {
    zeit: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    datum: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  };
}

function zip(eintraege) {
  const teile = [], verzeichnis = [];
  let offset = 0;
  const t = dosZeit(new Date());
  eintraege.forEach(function (e) {
    const name = Buffer.from(e.name, 'utf8');
    const gepackt = zlib.deflateRawSync(e.daten, { level: 9 });
    const crc = crc32(e.daten);
    const kopf = Buffer.alloc(30);
    kopf.writeUInt32LE(0x04034b50, 0); kopf.writeUInt16LE(20, 4); kopf.writeUInt16LE(0x0800, 6);   // UTF-8-Namen
    kopf.writeUInt16LE(8, 8); kopf.writeUInt16LE(t.zeit, 10); kopf.writeUInt16LE(t.datum, 12);
    kopf.writeUInt32LE(crc, 14); kopf.writeUInt32LE(gepackt.length, 18); kopf.writeUInt32LE(e.daten.length, 22);
    kopf.writeUInt16LE(name.length, 26); kopf.writeUInt16LE(0, 28);
    teile.push(kopf, name, gepackt);
    const z = Buffer.alloc(46);
    z.writeUInt32LE(0x02014b50, 0); z.writeUInt16LE(0x0314, 4); z.writeUInt16LE(20, 6); z.writeUInt16LE(0x0800, 8);
    z.writeUInt16LE(8, 10); z.writeUInt16LE(t.zeit, 12); z.writeUInt16LE(t.datum, 14);
    z.writeUInt32LE(crc, 16); z.writeUInt32LE(gepackt.length, 20); z.writeUInt32LE(e.daten.length, 24);
    z.writeUInt16LE(name.length, 28); z.writeUInt32LE((0o100644 << 16) >>> 0, 38); z.writeUInt32LE(offset, 42);
    verzeichnis.push(z, name);
    offset += kopf.length + name.length + gepackt.length;
  });
  const vz = Buffer.concat(verzeichnis);
  const ende = Buffer.alloc(22);
  ende.writeUInt32LE(0x06054b50, 0);
  ende.writeUInt16LE(eintraege.length, 8); ende.writeUInt16LE(eintraege.length, 10);
  ende.writeUInt32LE(vz.length, 12); ende.writeUInt32LE(offset, 16);
  return Buffer.concat(teile.concat([vz, ende]));
}

function bauen(ziel) {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'));
  manifest.version = pkg.version;
  const namen = DATEIEN.concat(mcpDateien(), ['package.json']);
  const eintraege = [{ name: 'manifest.json', daten: Buffer.from(JSON.stringify(manifest, null, 2) + '\n') }]
    .concat(namen.map(function (n) { return { name: n, daten: fs.readFileSync(path.join(ROOT, n)) }; }));
  fs.mkdirSync(path.dirname(ziel), { recursive: true });
  const daten = zip(eintraege);
  fs.writeFileSync(ziel, daten);
  return { pfad: ziel, dateien: eintraege.length, bytes: daten.length };
}

if (require.main === module) {
  const r = bauen(process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'dist', 'mini-fabrik.mcpb'));
  console.log('Gebaut: ' + r.pfad + ' (' + r.dateien + ' Dateien, ' + (r.bytes / 1e6).toFixed(1) + ' MB)');
  console.log('Installieren: Datei in Claude Desktop öffnen (Doppelklick) – siehe mcp/README.md.');
}

module.exports = { bauen: bauen, zip: zip };
