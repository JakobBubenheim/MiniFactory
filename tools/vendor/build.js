// Bündelt Three.js und Rapier 3D zu zwei klassischen Skripten (IIFE) in ../../lib.
// Aufruf: npm run build (in tools/vendor). Die Ergebnisse werden ins Repo committet,
// damit die Mini-Fabrik ohne Node und ohne Server per Doppelklick startet.
'use strict';

const path = require('path');
const fs = require('fs');
const esbuild = require('esbuild');

const LIB = path.join(__dirname, '..', '..', 'lib');

function version(pkg) {
  return require(path.join(__dirname, 'node_modules', pkg, 'package.json')).version;
}

const BUNDLES = [
  { entry: 'entry-rapier.js', out: 'rapier.js', pkg: '@dimforge/rapier3d-compat', global: 'window.RAPIER' },
  { entry: 'entry-three.js', out: 'three.js', pkg: 'three', global: 'window.THREE, window.THREE_ADDONS' },
];

fs.mkdirSync(LIB, { recursive: true });

for (const b of BUNDLES) {
  const banner = '/* ' + b.pkg + ' ' + version(b.pkg) + ' – gebündelt für die Mini-Fabrik, setzt ' +
    b.global + '. Lizenz: lib/LICENSES.md. Nicht von Hand ändern, siehe tools/vendor/README.md */';
  esbuild.buildSync({
    entryPoints: [path.join(__dirname, b.entry)],
    outfile: path.join(LIB, b.out),
    bundle: true,
    format: 'iife',
    minify: true,
    target: ['es2020'],
    platform: 'browser',
    legalComments: 'none',
    banner: { js: banner },
    logLevel: 'warning',
  });
  const size = fs.statSync(path.join(LIB, b.out)).size;
  console.log('lib/' + b.out + '  ' + (size / 1024 / 1024).toFixed(2) + ' MB  (' + b.pkg + ' ' + version(b.pkg) + ')');
}
