// Kleine Testanlagen als Dateiinhalt (Format wie .mfab, Version 1).
// Als Datei beschrieben, weil das Dateiformat beim 3D-Umbau per Migration
// weiter gelesen wird – die Tests laden dieselben Anlagen auch danach.
'use strict';

function element(id, type, x, y, w, h, props) {
  return { id: id, type: type, name: id, group: 'Test', x: x, y: y, w: w, h: h, props: props || {} };
}

function datei(elements, rules) {
  return { format: 'mini-fabrik', version: 1, name: 'Testanlage', settings: { dtMs: 50, cellM: 0.5 },
    elements: elements, rules: rules || [] };
}

// Quelle Q1 links, Band B1 (8 Zellen = 4 m) nach rechts, optional Senke SE1 am Ende.
function strecke(opt) {
  opt = opt || {};
  const els = [
    element('Q1', 'source', 0, 0, 1, 1, Object.assign({ interval: 2, maxCount: 0, enabled: true }, opt.quelle)),
    element('B1', 'conveyor', 1, 0, 8, 1, Object.assign({ running: true, speed: 0.5, direction: 'rechts' }, opt.band))
  ];
  if (opt.senke !== false) els.push(element('SE1', 'sink', 9, 0, 1, 1));
  if (opt.schranke) els.push(element('LS1', 'sensor', 5, 0, 1, 1, Object.assign({ invert: false, debounce: 0 }, opt.schranke)));
  return datei(els, opt.regeln);
}

// Zwei Lichtschranken (ohne Kisten, nur zum Forcen) und ein Schieber S1
function zweiSchranken(regeln) {
  return datei([
    element('LS1', 'sensor', 0, 0, 1, 1),
    element('LS2', 'sensor', 2, 0, 1, 1),
    element('S1', 'pusher', 4, 0, 1, 1, { stroke: 600, speed: 0.3, returnDelay: 0.5, direction: 'unten' })
  ], regeln);
}

// Leere Fläche mit einer Lichtschranke LS1 (Reiz für SCL, per forcen) und Schieber S1
function sclPlatz() { return zweiSchranken([]); }

module.exports = { element: element, datei: datei, strecke: strecke, zweiSchranken: zweiSchranken, sclPlatz: sclPlatz };
