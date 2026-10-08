// Dateizugriff des MCP-Servers – nur im Anlagen-Ordner.
//
// Standard ist ~/Mini-Fabrik; die Umgebungsvariable MINI_FABRIK_DIR (im
// Claude-Desktop-Bündel die Einstellung "Anlagen-Ordner") ändert ihn. Pfade
// dürfen relativ zum Ordner oder absolut darin sein. Alles außerhalb – auch über
// "..", symbolische Links oder andere Laufwerke – wird abgelehnt.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ENDUNG = '.mfab';

class DateiFehler extends Error {}

function basisOrdner() {
  const v = (process.env.MINI_FABRIK_DIR || '').trim();
  // Unaufgelöste Platzhalter (Einstellung im Bündel leer gelassen) zählen als nicht gesetzt
  const roh = v && !/^\$\{.*\}$/.test(v) ? v : path.join(os.homedir(), 'Mini-Fabrik');
  return path.resolve(roh.replace(/^~(?=$|[\\/])/, os.homedir()));
}

// Ordner anlegen (falls nötig) und echten Pfad liefern (symbolische Links aufgelöst)
function basisEcht() {
  const b = basisOrdner();
  fs.mkdirSync(b, { recursive: true });
  return fs.realpathSync(b);
}

function innen(basis, p) {
  const rel = path.relative(basis, p);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Pfad prüfen und auflösen. Ohne Endung wird .mfab angehängt.
 * @param {string} eingabe relativ zum Anlagen-Ordner oder absolut darin
 * @param {object} [opt] { endung: true }
 * @returns {string} absoluter Pfad im Anlagen-Ordner
 */
function aufloesen(eingabe, opt) {
  opt = opt || {};
  if (typeof eingabe !== 'string' || !eingabe.trim()) throw new DateiFehler('Pfad fehlt, z. B. "strecke.mfab".');
  const basis = basisEcht();
  let p = eingabe.trim().replace(/^~(?=$|[\\/])/, os.homedir());
  p = path.resolve(basis, p);
  if (opt.endung !== false && path.extname(p).toLowerCase() !== ENDUNG) p += ENDUNG;
  const ablehnen = function () {
    return new DateiFehler('"' + eingabe + '" liegt außerhalb des Anlagen-Ordners ' + basis +
      '. Nur Dateien darin sind erlaubt – einen Pfad relativ zum Ordner angeben, z. B. "strecke.mfab" oder "projekte/strecke.mfab".');
  };
  if (!innen(basis, p)) throw ablehnen();
  // Symbolische Links: der nächste existierende Vorfahr muss ebenfalls innen liegen
  let vorhanden = p;
  while (!fs.existsSync(vorhanden)) vorhanden = path.dirname(vorhanden);
  if (!innen(basis, fs.realpathSync(vorhanden))) throw ablehnen();
  return p;
}

function lesen(eingabe) {
  const p = aufloesen(eingabe);
  if (!fs.existsSync(p)) throw new DateiFehler('Datei "' + path.relative(basisEcht(), p) + '" gibt es im Anlagen-Ordner nicht. list_plants zeigt, was da ist.');
  let obj;
  try { obj = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) {
    throw new DateiFehler('"' + eingabe + '" ist keine gültige JSON-Datei: ' + e.message);
  }
  return { pfad: p, inhalt: obj };
}

function schreiben(eingabe, obj, ueberschreiben) {
  const p = aufloesen(eingabe);
  if (fs.existsSync(p) && ueberschreiben === false) throw new DateiFehler('"' + eingabe + '" gibt es schon. overwrite: true setzen oder anderen Namen wählen.');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  return p;
}

// Alle .mfab-Dateien im Anlagen-Ordner (rekursiv, höchstens 500)
function auflisten() {
  const basis = basisEcht(), out = [];
  (function gehe(ordner, tiefe) {
    if (tiefe > 6 || out.length >= 500) return;
    fs.readdirSync(ordner, { withFileTypes: true }).forEach(function (e) {
      if (e.name.startsWith('.')) return;
      const p = path.join(ordner, e.name);
      if (e.isDirectory()) gehe(p, tiefe + 1);
      else if (e.isFile() && path.extname(e.name).toLowerCase() === ENDUNG) {
        const st = fs.statSync(p);
        out.push({ path: path.relative(basis, p), bytes: st.size, modified: st.mtime.toISOString() });
      }
    });
  })(basis, 0);
  return { folder: basis, files: out };
}

module.exports = { basisOrdner: basisOrdner, aufloesen: aufloesen, lesen: lesen, schreiben: schreiben, auflisten: auflisten, DateiFehler: DateiFehler };
