# Konzept: Umbau auf 3D-Physik („2,5D“)

Stand: 08.10.2026. Dieses Dokument ist der gemeinsame Plan für alle Branches des Umbaus.
Wer an einer Phase arbeitet, liest es zuerst und hält sich an die Entscheidungen hier.
Ändert sich eine Entscheidung, wird zuerst dieses Dokument angepasst.

---

## 1. Entscheidungen

| Thema | Entscheidung |
|---|---|
| Physik | **Rapier 3D** (`@dimforge/rapier3d-compat`, WASM eingebettet) |
| Darstellung 3D | **Three.js** |
| Bearbeiten | in der **Draufsicht** (der 2D-Editor bleibt). Ein Körper = Grundriss (Skizze) + Höhe, wie Skizze + Extrusion im CAD |
| Simulieren | echtes **3D mit Schwerkraft** |
| Raum | **kein Raster mehr in der Simulation.** Einheiten: Meter, Grad, Sekunden. Das Raster ist nur noch Zeichenhilfe („Fangen“, z. B. 0,05 m / 5°) |
| Koordinaten | x nach rechts, y in der Draufsicht nach unten, **z nach oben**, Boden bei z = 0. Die Umrechnung ins y-oben-System von Three.js passiert nur in der 3D-Ansicht |
| Katalog | bleibt, wird aber zu **Vorlagen**: ein Förderband ist ein vorkonfigurierter Körper, den man danach frei ändern kann |
| Start per Doppelklick | **bleibt.** Three.js und Rapier werden einmal mit esbuild zu `lib/vendor.js` (IIFE, setzt `window.THREE` und `window.RAPIER`) gebündelt und **ins Repo committet**. Node braucht man nur zum Aktualisieren der Bibliotheken und für Tests |
| Code-Stil | bleibt: ES5, Namensraum `MF`, deutsche Kommentare, klassische `<script>`-Tags |

Was **unverändert** bleibt: Signale und I/O-Tab, Wenn-dann-Regeln, SCL-Interpreter und -Editor,
Signalliste, Undo/Redo, Speichern/Laden (mit Migration), Strukturbaum mit Ordnern,
SPS-Zyklus mit festem Zeitschritt.

## 2. Begriffe

**Körper** – alles, was in der Anlage liegt. Jeder Körper hat eine **Form**, eine **Lage**
und eine **Körperart**. Dazu kommen optionale **Funktionen**.

### Körperarten

| Art | Verhalten | Typische Verwendung |
|---|---|---|
| `ghost` (immateriell) | nur sichtbar, keine Kollision. Kann Sensorfläche, Erzeuger oder Senke sein | Lichtschranke, Markierung, Quelle, Senke |
| `static` | bewegt sich nie, andere Körper stoßen dagegen | Bandgestell, Wand, Rutsche |
| `kinematic` | bewegt sich **nur über eine Achse**, die die Steuerung vorgibt; lässt sich nicht wegschieben | Schieber, Drehtisch, Hubtisch |
| `dynamic` | wird von Schwerkraft, Stößen und Transportflächen bewegt | Kisten, Bauteile |

Neu eingefügte Formen sind zuerst `ghost`.

### Funktionen (optional, kombinierbar wo sinnvoll)

| Funktion | Erlaubt bei | Wirkung | Signale |
|---|---|---|---|
| **Transportfläche** | static, kinematic | Oberseite bewegt sich mit `speed` (m/s) in Richtung `dir` (Grad, lokal) und nimmt aufliegende dynamische Körper mit | EIN `Ein` (BOOL), EIN `Tempo` (REAL, gekoppelt an `speed`), AUS `Läuft` |
| **Achse** | kinematic | linear oder rotatorisch, mit Grenzen, Höchstgeschwindigkeit und Betriebsart | siehe unten |
| **Sensor** | ghost | meldet, ob ein dynamischer Körper die Form schneidet | AUS `Belegt`, Eigenschaften `invert`, `debounce` |
| **Erzeuger** | ghost | erzeugt im Takt dynamische Körper nach einer Vorlage | EIN `Freigabe`, AUS `Erzeugt` |
| **Senke** | ghost | entfernt dynamische Körper, deren Mittelpunkt in der Form liegt, und zählt sie | EIN `Reset`, AUS `Anzahl` |

**Achse – Betriebsarten**

| Betriebsart | Eingänge | Ausgänge | Verhalten |
|---|---|---|---|
| `zweipunkt` | `Ausfahren` (BOOL) | `Ausgefahren`, `Eingefahren` (BOOL), `Ist` (REAL) | fährt mit `vmax` nach `max` bzw. zurück nach `min`, mit `returnDelay` |
| `position` | `Soll` (REAL), `Freigabe` (BOOL) | `Ist` (REAL), `InPosition` (BOOL) | fährt mit höchstens `vmax` auf `Soll` |
| `geschwindigkeit` | `Soll` (REAL), `Freigabe` (BOOL) | `Ist` (REAL) | dreht/fährt mit `Soll` (m/s bzw. °/s) bis zu den Grenzen |

Linear: Werte in m. Rotatorisch: Werte in Grad.

**Kopplung:** Ein Körper kann einen anderen Körper als Eltern haben (im Strukturbaum darunter
gezogen). Seine Lage ist dann relativ zum Elternkörper, und er bewegt sich mit ihm mit. Beispiel:
Greifer (kinematisch, linear) auf Drehtisch (kinematisch, rotatorisch). Ordner haben keine Lage
und beeinflussen die Bewegung nicht.

## 3. Datenmodell (Dateiformat Version 3)

Version 2 führt der Branch „Strukturbaum mit Ordnern“ ein (Ordner statt `group`).
Version 3 ist der Umbau. `MF.file.migrate()` rechnet 1 → 2 → 3 schrittweise um.

```json
{
  "format": "mini-fabrik",
  "version": 3,
  "name": "Beispielanlage",
  "settings": { "dtMs": 20, "gravity": -9.81, "snap": { "on": true, "pos": 0.05, "angle": 5 } },
  "folders": [ { "id": "F1", "name": "Förderstrecke 1", "parent": null } ],
  "bodies": [
    {
      "id": "B1", "name": "Förderband 1", "parent": "F1", "template": "conveyor",
      "kind": "static",
      "shape": { "type": "rect", "w": 4.5, "d": 0.5, "h": 0.1 },
      "pose": { "x": 1.5, "y": 2.0, "z": 0.7, "rot": 0 },
      "material": { "friction": 0.8, "restitution": 0.0, "density": 1.0 },
      "surface": { "speed": 0.5, "dir": 0, "running": true },
      "axis": null, "sensor": null, "spawner": null, "sink": null,
      "inputs": { "Ein": 1 },
      "look": { "color": "#1B2430", "visible": true, "locked": false }
    }
  ],
  "rules": [ "… wie bisher …" ],
  "view": { "zoom": 1, "panX": 0, "panY": 0, "grid": true, "tags": true, "camera3d": null }
}
```

- `shape.type`: `rect` (w × d), `circle` (r), `polygon` (`points: [[x, y], …]` lokal). Immer mit Höhe `h`.
- `pose`: Mittelpunkt der Unterseite des Grundrisses, `rot` = Drehung um z in Grad, relativ zum Eltern.
- `axis`: `{ "type": "linear"|"rotary", "origin": [x,y,z], "dir": [x,y,z], "min", "max", "vmax", "mode", "returnDelay" }`, lokal zum Körper.
- `spawner`: `{ "interval", "maxCount", "enabled", "template": { shape, material, look } }`.
- Laufzeitdaten (Rapier-Handles, erzeugte Kisten, Zähler, `force`) werden **nie** gespeichert.

**Migration 2 → 3** (Katalog-Elemente werden zu Körpern mit `template`):

| Alt | Neu |
|---|---|
| Zelle (x, y, w, h) | Meter: Wert × `settings.cellM` |
| Förderband | `static`, Rechteck, Höhe 0,1 m auf z = 0,7 m, `surface` mit `speed`/`direction` → `dir` |
| Lichtschranke | `ghost`, schmales Rechteck quer über dem Band, `sensor` |
| Schieber | `kinematic`, `axis` linear, Betriebsart `zweipunkt`, `stroke` → `max` |
| Quelle | `ghost` mit `spawner`, Kiste 0,3 × 0,3 × 0,3 m |
| Senke | `ghost` mit `sink`, etwas tiefer als das Band, damit Kisten hineinfallen |

**Signalnamen bleiben gleich** (`B1.Ein`, `LS1.Belegt`, `S1.Ausfahren`, `SE1.Anzahl` …), damit
bestehende Regeln und SCL-Code unverändert weiterlaufen.

## 4. Simulationszyklus

Gleiche Reihenfolge wie bisher, fester Zeitschritt (Standard 20 ms, damit die Physik stabil bleibt):

1. **Sensoren lesen** – Rapier-Schnittabfragen der Sensorflächen (+ Entprellung)
2. **Logik** – Wenn-dann-Regeln, dann SCL-Bausteine (Reihenfolge wie im Strukturbaum)
3. **Aktoren** – Achsen-Sollwerte → nächste Lage der kinematischen Körper; Transportflächen an/aus/Tempo
4. **Physik-Schritt** – `world.step()`; Transportflächen wirken auf aufliegende dynamische Körper
5. **Erzeuger und Senken**

Transportfläche: Rapier kennt in JS keine Oberflächengeschwindigkeit. Ansatz: Für jeden dynamischen
Körper, der eine Transportfläche berührt, die Geschwindigkeit entlang der Fläche reibungsähnlich zur
Bandgeschwindigkeit hinziehen (`v += k · (v_band − v)`, begrenzt). Phase 1 prüft, ob das sauber
läuft, und legt die Methode fest.

## 5. Phasen

Jede Phase ist ein eigener Branch und endet mit etwas Lauffähigem. Die Tests (`npm test`) müssen
nach jeder Phase grün sein – angepasst werden dürfen nur Tests, die interne Details prüfen, nicht
das Verhalten der Anlage.

| Phase | Branch | Inhalt | Hängt ab von |
|---|---|---|---|
| 0a | `feature/tests` | Headless-Tests, Prüf-Agent, CI | – |
| 0b | `feature/baum-ordner` | freie Ordner im Strukturbaum, Dateiformat v2 | – |
| 1 | `feature/3d-spike` | `lib/vendor.js` bauen, Rapier + Three per Doppelklick laden, Kiste fällt auf ein Band und wird transportiert; Transportflächen-Methode festlegen | 0a |
| 2 | `feature/physik-kern` | Datenmodell v3 + Migration, neue Engine auf Rapier, alle Katalog-Elemente als Vorlagen, Draufsicht zeichnet Körper; alte Raster-Engine entfällt | 0a, 0b, 1 |
| 3 | `feature/formen` | Rechteck/Kreis/Polygon zeichnen, Höhe, freie Lage und Drehung, Körperart und Funktionen im Eigenschaften-Panel, Fangen | 2 |
| 4 | `feature/achsen` | Achsen linear/rotatorisch mit allen Betriebsarten, Kopplung über den Baum, Achse in der Draufsicht anzeigen und ziehen | 2 (besser nach 3) |
| 5 | `feature/3d-ansicht` | Three.js-Ansicht zum Zuschauen: Orbit-Kamera, Licht, Schatten, Auswahl per Klick, Draufsicht und 3D nebeneinander | 2 |

Phasen 3 und 5 können parallel laufen.

**Fertig ist der Umbau, wenn:** die Beispielanlage aus einer alten `.mfab`-Datei lädt, mit der
Regel R1 Kisten über den Schieber in SE2 landen, eine selbst gezeichnete schräge Rutsche Kisten
per Schwerkraft weiterleitet und ein Drehtisch per SCL auf 90° fährt.

## 6. Später (bewusst nicht im Umbau)

Körper im Raum kippen (Drehung um x/y), Gelenkketten mit mehr als zwei Ebenen bearbeiten,
Import von CAD-Dateien, Anbindung echter Steuerungen.
