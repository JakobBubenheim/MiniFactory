// Baut die Beispielanlagen für den MCP-Server neu (mcp/beispiele/*.mfab).
// Aufruf: node mcp/beispiele/bauen.js – nur nötig, wenn sich die Beispiele ändern sollen.
// Gebaut wird über die Sitzung, also genau so, wie ein Agent es mit den Werkzeugen täte.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { SitzungHeadless } = require('../sitzung-headless');

const BAUPLAENE = {
  // Quelle -> 4-m-Band -> Senke
  strecke: async function (s) {
    await s.neu({ name: 'Einfache Strecke' });
    await s.vorlageEinfuegen({ template: 'conveyor', x: 2.5, y: 1, shape: { w: 4 } });          // B1: x 0,5 … 4,5
    await s.vorlageEinfuegen({ template: 'source', x: 0.75, y: 1 });                           // Q1 über dem Bandanfang
    await s.vorlageEinfuegen({ template: 'sink', x: 4.75, y: 1 });                             // SE1 hinter dem Bandende
  },
  // Wie die Beispielanlage der App: Lichtschranke + Schieber schleusen jede Kiste nach SE2 aus (Regel R1)
  ausschleusen: async function (s) {
    await s.neu({ name: 'Ausschleusen mit Schieber' });
    await s.vorlageEinfuegen({ template: 'conveyor', x: 2.75, y: 1.5, shape: { w: 4.5 } });      // B1: x 0,5 … 5
    await s.vorlageEinfuegen({ template: 'source', x: 0.75, y: 1.5 });                          // Q1
    await s.vorlageEinfuegen({ template: 'sensor', x: 3.75, y: 1.5 });                          // LS1 quer über dem Band
    await s.vorlageEinfuegen({ template: 'pusher', x: 3.75, y: 1, props: { stroke: 600, speed: 1, direction: 'unten' } });   // S1 neben dem Band, schiebt nach +y
    await s.vorlageEinfuegen({ template: 'sink', x: 5.25, y: 1.5 });                            // SE1 am Bandende
    await s.vorlageEinfuegen({ template: 'sink', x: 3.75, y: 2 });                              // SE2 gegenüber dem Schieber
    await s.regelAnlegen({ when: 'LS1.Belegt', then: 'S1.Ausfahren', description: 'Kiste an der Lichtschranke wird nach SE2 ausgeschleust.' });
  },
  // Band liefert auf eine selbst gezeichnete Rutsche, die Schwerkraft bringt die Kisten in die Senke
  rutsche: async function (s) {
    await s.neu({ name: 'Band und Rutsche' });
    await s.vorlageEinfuegen({ template: 'conveyor', x: 2.5, y: 1, shape: { w: 4 } });          // B1: x 0,5 … 4,5, Oberkante 0,7
    await s.vorlageEinfuegen({ template: 'source', x: 0.75, y: 1 });
    await s.formZeichnen({ type: 'rect', w: 1.5, d: 0.5, h: 0.68, h2: 0.1, x: 5.25, y: 1, kind: 'static',
      name: 'Rutsche', material: { friction: 0.1 } });                                          // K1: 2 cm unter dem Band, fällt nach +x
    await s.vorlageEinfuegen({ template: 'sink', x: 6.25, y: 1 });                             // SE1 am Fuß der Rutsche
  }
};

(async function () {
  const s = new SitzungHeadless();
  await s.bereit();
  for (const key of Object.keys(BAUPLAENE)) {
    await BAUPLAENE[key](s);
    const d = await s.datei();
    d.view = { zoom: 1, panX: 0, panY: 0, grid: true, tags: true, folded: [], camera3d: null };
    fs.writeFileSync(path.join(__dirname, key + '.mfab'), JSON.stringify(d, null, 2) + '\n');
    const sim = await s.simulieren({ seconds: 30 });
    console.log(key, JSON.stringify(sim.boxes.sunk), 'Boden:', sim.boxes.onFloor.length, sim.hints.join(' | '));
    console.log('  prüfen:', JSON.stringify(await s.pruefen()));
  }
})();
