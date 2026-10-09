# Konzept: MCP-Server – KI-Agents bauen Anlagen

Stand: 09.10.2026 (Stufe A gebaut, Branch `feat/mcp-server`). Wer am MCP-Server arbeitet, liest dieses Dokument zuerst.
Einrichtung für Nutzer: [mcp/README.md](../mcp/README.md). Was der Agent liest: [mcp/anleitung.md](../mcp/anleitung.md).

## 1. Ziel und Stufen

Ein Nutzer beschreibt eine Anlage oder gibt eine Skizze. Ein Agent (Claude Desktop, Claude Code) baut daraus über
MCP-Werkzeuge ein Modell, simuliert es, prüft es mit einem Bild und Zahlen, bessert nach und speichert eine `.mfab`-Datei.
Die Skizze liest der Agent selbst; der Server liefert Werkzeuge, Anleitung und Kontrollbild.

| Stufe | Inhalt | Stand |
|---|---|---|
| A | Server rechnet **ohne Browser** (App-Skripte in Node), speichert `.mfab`; der Nutzer öffnet die Datei | ✅ |
| B | **Live:** Server verbindet sich mit der offenen App (lokaler WebSocket); man sieht dem Agent beim Bauen zu | geplant |

## 2. Entscheidungen

| Thema | Entscheidung |
|---|---|
| Abhängigkeiten | **keine** – auch kein MCP-SDK. JSON-RPC über stdio (eine Nachricht je Zeile) ist klein genug. Node-Code in `mcp/` ist CommonJS und darf modernes JS nutzen (wie die Tests) |
| Protokoll | **beide Generationen:** neu (`2026-07-28`: kein Handshake, Version und Client-Fähigkeiten in `params._meta` jeder Anfrage, `server/discover`, Antworten mit `resultType` und `serverInfo` in `_meta`, Cache-Hinweise `ttlMs`/`cacheScope` an Listen und `resources/read`) und alt (`initialize` mit Aushandlung, `2025-11-25` bis `2024-11-05`). Falsche Version → Fehler `-32022` mit unterstützten Versionen. **Claude Code 2.1 spricht schon die neue Form und lehnt Listen ohne Cache-Hinweise ab** (beim Ausprobieren gefunden). Claude Desktop nutzt ggf. noch `initialize` |
| Zustand | Die Spezifikation ist zustandslos, der Server hat aber eine **offene Anlage** (wie ein Dokument im Editor). Bewusst so: In Stufe B ist der Zustand ohnehin die App im Browser. Anfragen werden der Reihe nach abgearbeitet |
| Laden | `tools/headless.js` – gemeinsam mit den Tests (`test/helpers/load.js` verweist nur noch darauf). Neue App-Skripte dort in `SKRIPTE` eintragen. Rapier einmal je Prozess, WASM nur mit Liftoff (Server-Start ≈ 0,1 s, 60 s Simulation ≈ 0,3 s) |
| Änderungen | **nur über App-Funktionen** (`MF.store.createBody/createShape/createRule/moveNodes`, `MF.setForm`, `MF.setKind`, `MF.addFunction`, `MF.setProp`, `MF.syncIo`, `MF.store.dropSignals`). Jede Änderung wird erst an einer **Kopie des Körpers** geprüft – ungültig heißt: nichts geändert. Jeder Werkzeug-Aufruf ist **ein** Schritt im Verlauf (`MF.history.begin/end`) |
| Allgemein | Vorlagen, Eigenschaften, Funktionen, Felder, Betriebsarten und Signale kommen aus `MF.templates`, `MF.propsOf`, `MF.FUNCTIONS` (`fields`, `MODES`), `MF.io`. **Keine Sonderfälle je Vorlage.** Phase 4 (Drehtisch, Hubtisch …) erscheint ohne Änderung; `parent` wird über `MF.store.moveError/moveNodes` gesetzt, Kopplung an Körper also so, wie Phase 4 es dort erlaubt |
| Fehler | Bedienfehler → Tool-Ergebnis mit `isError: true` und deutschem Text, der sagt, was zu tun ist (mögliche Werte, Werkzeug zum Nachsehen). Unbekanntes Werkzeug/Methode → JSON-RPC-Fehler. Interne Fehler werden geloggt, der Server läuft weiter |
| Eingaben | Tool-Schemas sind JSON Schema; der Server prüft Eingaben selbst gegen sein Schema (kleiner Prüfer in `werkzeuge.js`), bevor die Sitzung sie sieht |
| Bild | **eigener Rasterer** (`mcp/bild.js`): Vielecke füllen, Linien als Vierecke, 5×7-Schrift, 2-fach überabgetastet; PNG mit `node:zlib`. Zeigt Körper nach Körperart (wie die App), IDs mit Ausweichen, Laufrichtung, Gefälle, Achse, Kisten, Raster in Metern mit Beschriftung, Maßstab. Dazu ein Text mit Maßstab, Ausschnitt und Legende |
| Dateien | nur im **Anlagen-Ordner**: `MINI_FABRIK_DIR`, sonst `~/Mini-Fabrik`. Relative und absolute Pfade, `..` und symbolische Links nach außen werden abgelehnt (echter Pfad des nächsten vorhandenen Vorfahren muss innen liegen). `.mfab` wird ergänzt |
| Simulation | `simulate` setzt standardmäßig zurück (`reset: true`), läuft mit festem Zeitschritt bis 600 s und fasst zusammen: Kisten je Erzeuger/Senke, unter z = −2 m verloren, **auf dem Boden** (Unterseite < 5 cm ohne festen Körper darunter), **stillstehend** (< 1 cm/s, älter als 0,5 s; auf laufender Fläche = Stau), Rückstau am Erzeuger, Signalwerte, Flanken und Anteil „an“ je BOOL-Signal, SCL-Laufzeitfehler, `trace` für Signalwechsel |
| Bündel | `.mcpb` (Manifest 0.3) per `npm run mcp:pack` mit eigenem Zip-Bau; enthält `tools/headless.js:DATEIEN` + `mcp/` + `package.json` in derselben Ordnerlage. Einstellung `plant_dir` (Typ directory) → `MINI_FABRIK_DIR`. Geprüft mit `mcpb validate` (bestanden, nicht signiert). Nicht eingecheckt (`dist/`) |

## 3. Werkzeuge

| Werkzeug | Zweck |
|---|---|
| `get_overview` | Anlage als JSON: Körper (Form, `pose`, `bounds`, `top`, Funktionen, `props`, Signale), Ordner, Regeln/SCL mit Fehlern, Signalwerte |
| `list_templates` | Vorlagen, Funktionen (Felder, Körperarten, Signale, Betriebsarten), Körperarten, Werkstoffe – aus der App erzeugt |
| `new_plant`, `load_plant` (`path` oder `example`), `save_plant`, `list_plants` | Datei |
| `validate` | `MF.file.validate` + Bauregeln: Erzeuger über Fläche, was hinter jedem Bandende liegt, Folgeband höher als das liefernde (Nähte bündig, seit 09.10.2026), Sensor über Fläche, unvollständige Regeln, SCL-Fehler |
| `add_from_template`, `draw_shape`, `update_body`, `set_function`, `delete`, `create_folder`, `move_to_folder` | Bauen |
| `add_rule`, `add_scl`, `update_rule`, `delete_rule` | Logik; SCL wird vorher übersetzt, Fehler mit Zeile/Spalte, dann wird nichts angelegt |
| `simulate`, `set_signal`, `get_signals` | Prüfen und Bedienen wie im I/O-Tab |
| `render_topview` | PNG + Text; `simulate {render: true}` hängt es an |
| `undo`, `redo` | Verlauf |

Ressourcen: `mini-fabrik://anleitung` (Markdown), `mini-fabrik://beispiele/{strecke,ausschleusen,rutsche}` (Erklärung + Datei).
Prompt: `anlage_bauen(beschreibung)`. `instructions` beim Verbinden verweisen auf beides.
Die Beispiele baut `node mcp/beispiele/bauen.js` über die Sitzung neu.

## 4. Sitzung (Schnittstelle für Stufe B)

Alle Werkzeuge sprechen nur mit einem Objekt „Sitzung“ (`mcp/sitzung-headless.js`) und dem Dateizugriff (`mcp/dateien.js`).
Jede Methode gibt ein **Promise** mit einfachen Daten zurück; Bedienfehler sind `SitzungsFehler`.

```
bereit()                          uebersicht()              vorlagen()
neu({name, dtMs})                 ladenDatei(datei)         datei()                  pruefen()
vorlageEinfuegen({template, x, y, rot?, z?, name?, parent?, shape?, props?, color?})
formZeichnen({type, w, d | r | points, h, h2?, x, y, z?, rot?, kind?, name?, parent?, material?, color?})
koerperAendern(id, felder)        funktionSetzen(id, fn, felder | null)    loeschen(ids)
ordnerAnlegen({name, area, parent})                         verschieben(ids, ordner)
regelAnlegen({when, then, …})     sclAnlegen({code, …})     regelAendern(id, felder) regelLoeschen(id)
simulieren({seconds, reset?, set_signals?, trace?})          signalSetzen(name, wert | null)  signale()
szene()  -> Geometrie für das Bild   rueckgaengig()  wiederholen()
```

Die Dateien liest und schreibt der Server, nicht die Sitzung – auch in Stufe B (die App bekommt nur den Inhalt).

### Plan für Stufe B (Live)

1. **Sitzung live** (`mcp/sitzung-live.js`) mit denselben Methoden: jede Methode wird als Nachricht
   `{ id, methode, argumente }` an die App geschickt, die Antwort `{ id, ergebnis | fehler }` erfüllt das Promise.
   Die Werkzeuge bleiben unverändert.
2. **In der App** ein kleines Skript (`ui/ki-verbindung.js`, ES5), das dieselbe Logik wie `sitzung-headless.js` gegen das
   echte `MF` ausführt. Damit sie nicht doppelt existiert: den Kern der Sitzung (alles außer Laden und Simulieren) in ein
   ES5-Skript ziehen, das sowohl im vm-Kontext als auch im Browser läuft (z. B. `sim/ki-befehle.js`, Namensraum `MF.ki`).
3. **Verbindung:** Der MCP-Server öffnet `ws://127.0.0.1:<port>` (nur Loopback) mit einem zufälligen Token; die App verbindet
   sich über einen Dialog „KI verbinden“ (Port + Token, Kopierknöpfe, Anleitungen für Claude Desktop/Code). Ein WebSocket-Server
   ohne Abhängigkeiten braucht nur den Handshake (SHA-1/Base64 aus `node:crypto`) und einfache Frames.
   Prüfen: Safari und `file://`-Seiten zu `ws://localhost` (Mixed Content ist bei `file://` kein Thema, aber testen).
4. **Simulieren live:** Entweder die App rechnet im Hintergrund schnell (wie headless) oder der Agent startet/pausiert die
   sichtbare Simulation. Vorschlag: `simulate` rechnet schnell in einer Kopie (headless im Server, Datei aus der App) und lässt die
   sichtbare Anlage in Ruhe; dazu neue Werkzeuge `start`/`pause` für die sichtbare Simulation.
5. **Vorrang:** Während ein Werkzeug läuft, sperrt die App kurz die Bearbeitung (Hinweis „KI baut …“). Jeder Werkzeug-Aufruf bleibt
   ein Rückgängig-Schritt, der Nutzer kann ihn in der App zurücknehmen. Ohne verbundene App fällt der Server auf die Headless-Sitzung zurück.
6. **Bild:** `szene()` liefert die App genauso; optional ein echtes Bild aus Canvas/Three.js (`toDataURL`) als zweites Bild.

## 5. Ausprobiert (Stufe A)

Claude Code 2.1.292, Server mit `claude mcp add` eingebunden, Aufrufe mit `claude -p`:

- „Bau mir eine Strecke mit Quelle, 4-m-Band und Senke …“: Anleitung gelesen, 3 Körper gebaut, Bild, `validate`, `simulate` (12 Kisten
  in der Senke, nichts heruntergefallen), gespeichert – fehlerfrei in 12 Schritten.
- „Quelle → 3 m nach rechts → 90° auf 3 m nach unten, Lichtschranke zählt, jede zweite Kiste per Schieber in eine eigene Senke
  (SCL mit Zähler)“: in 25 Schritten gelöst. Ein SCL-Fehler (`SR` mit falschem Eingang) kam mit Zeile/Spalte zurück und wurde sofort
  behoben. `simulate` zeigte 4 heruntergefallene Kisten an der Ecke und Stau; der Agent ergänzte eine Führungswand, kürzte Band 1
  und legte Band 2 1 cm tiefer – danach 20 Kisten ausgeschleust, 20 am Bandende, nichts heruntergefallen. Die gespeicherte Datei
  liefert in der App-Fassade dieselben Zähler (20/20). Die Ecken-Regel der Anleitung wurde daraufhin ergänzt.
- Beobachtung: Der Agent nutzte Bild, `validate` und `simulate` (mit `trace` und `render`) wie vorgesehen; die Zusammenfassung von
  `simulate` (onFloor, standingStill) war der entscheidende Hinweis zum Nachbessern.

## 6. Offen / später

- Claude Desktop: Installation des `.mcpb` nur geprüft (Manifest-Validierung, Bündel läuft entpackt), nicht in der Oberfläche installiert.
- Dialog „KI verbinden“ in der App (kommt mit Stufe B).
- Weitere Clients (Cursor, VS Code): Konfigurationsblock wie Claude Code (`node mcp/server.js`), nicht geprüft.
