// Einstieg für lib/rapier.js: stellt Rapier 3D als window.RAPIER bereit.
// Das WASM steckt als Base64 im Bündel; vor der Benutzung einmal
// RAPIER.init() aufrufen (liefert ein Promise).
import * as RAPIER from '@dimforge/rapier3d-compat';

globalThis.RAPIER = RAPIER;
