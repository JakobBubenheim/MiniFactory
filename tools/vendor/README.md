# tools/vendor – Bibliotheken bündeln

Die Mini-Fabrik startet per Doppelklick auf eine HTML-Datei (file://, kein Server, keine
ES-Module). Fremdbibliotheken liegen deshalb fertig gebündelt als klassische Skripte in
`lib/` und sind ins Repo committet. Node braucht man nur, um sie zu aktualisieren.

Dieser Ordner hat eine **eigene** `package.json`, damit er nicht mit der `package.json`
im Wurzelverzeichnis (Tests) kollidiert.

| Ergebnis | setzt | Inhalt |
|---|---|---|
| `lib/rapier.js` | `window.RAPIER` | Rapier 3D, WASM als Base64 eingebettet. Vor der Benutzung einmal `RAPIER.init()` aufrufen (Promise) |
| `lib/three.js` | `window.THREE`, `window.THREE_ADDONS = { OrbitControls }` | Three.js und die benötigten Addons |

Zwei getrennte Bündel, damit Tests in Node nur die Physik laden müssen.

## Bauen

```sh
cd tools/vendor
npm ci          # installiert genau die Versionen aus package-lock.json
npm run build   # schreibt ../../lib/rapier.js und ../../lib/three.js
```

`build.js` ruft esbuild auf (IIFE, minifiziert, Ziel ES2020) und gibt die Dateigrößen aus.
Die Einstiege sind `entry-rapier.js` und `entry-three.js`.

## Aktualisieren

1. In `package.json` die Versionen ändern – **immer fest, ohne `^`**.
2. `npm install`, dann `npm run build`.
3. Versionen in `lib/LICENSES.md` nachtragen (Lizenztexte prüfen, falls sich etwas geändert hat).
4. Prüfen:
   - `npm test` im Wurzelverzeichnis – lädt Rapier im node:vm-Kontext (`tools/headless.js`) und rechnet
     alle Physik-Tests inkl. Determinismus
   - `index.html` per Doppelklick in Chrome, Safari und Firefox öffnen (Draufsicht und 3D-Ansicht)
5. `lib/`, `package.json`, `package-lock.json` und `LICENSES.md` zusammen committen.

Ein weiteres Three.js-Addon (z. B. `TransformControls`) kommt in `entry-three.js` dazu und
wird an `THREE_ADDONS` gehängt.

## Hinweise

- Rapier im node:vm-Kontext braucht zusätzlich die Globals `TextDecoder` und `performance`
  (siehe `tools/headless.js`). Ohne `TextDecoder` scheitert schon das Laden, ohne
  `performance` bricht `world.step()` mit „RuntimeError: unreachable“ ab.
- `node_modules/` wird nicht committet (`.gitignore` in diesem Ordner).
