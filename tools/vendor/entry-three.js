// Einstieg für lib/three.js: stellt Three.js als window.THREE und die
// benötigten Zusätze als window.THREE_ADDONS bereit.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

globalThis.THREE = THREE;
globalThis.THREE_ADDONS = { OrbitControls: OrbitControls };
