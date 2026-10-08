# Konzept: Umbau auf 3D-Physik („2,5D“)

Stand: 08.10.2026 (Phase 3 eingetragen). Dieses Dokument ist der gemeinsame Plan für alle Branches des Umbaus.
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
| Koordinaten | x nach rechts, y in der Draufsicht nach unten, **z nach oben**, Boden bei z = 0. Das ist (von oben gesehen) linkshändig; Rapier rechnet damit ohne Umrechnung. Die 3D-Ansicht hängt alles in eine Gruppe mit `scale.y = −1` und setzt `camera.up = (0, 0, 1)` – sonst wäre sie spiegelverkehrt zur Draufsicht (Spike Phase 1) |
| Katalog | bleibt, wird aber zu **Vorlagen**: ein Förderband ist ein vorkonfigurierter Körper, den man danach frei ändern kann |
| Start per Doppelklick | **bleibt** (in Phase 1 geprüft). Rapier und Three.js werden mit esbuild zu zwei Skripten gebündelt und **ins Repo committet**: `lib/rapier.js` (setzt `window.RAPIER`, WASM eingebettet, `RAPIER.init()` nötig, 4,3 MB) und `lib/three.js` (setzt `window.THREE` und `window.THREE_ADDONS`, 0,8 MB). Getrennt, damit Tests nur die Physik laden. Bauen in `tools/vendor/` (eigene `package.json`). Node braucht man nur zum Aktualisieren der Bibliotheken und für Tests |
| Physik-Parameter | Physik-Schritt höchstens 20 ms (siehe Abschnitt 4: SPS-Zyklus `dtMs`, Physik in Unterschritten), Solver-Iterationen 4 (Standard), **Kontaktsteifigkeit 60 Hz** (`contact_natural_frequency`, Standard 30 Hz lässt gestaute Kisten 5 mm ineinander rutschen). Reibung: Kiste 0,6, Boden 0,6, Stahl 0,3, Rutsche 0,1, **Gleitbelag am Schieber 0,05** (Phase 2), Band 0,8 (nur für die Nachführung); Reibung und Stoßzahl werden immer mit `Min` kombiniert. Dichte Kiste 200 kg/m³. Ergebnisse: [Spike-3D-Ergebnis.md](Spike-3D-Ergebnis.md) |
| Rapier laden (Phase 2) | `RAPIER.init()` ist asynchron. **Browser:** `lib/rapier.js` ist ein klassisches Skript in `index.html`; `main.js` zeigt „Lade Physik …“ und startet die App erst nach `init()`. **Tests:** `test/helpers/load.js` lädt Rapier einmal je Testprozess in einen eigenen vm-Kontext (`vorbereiten()`, von der Fassade per `before()`-Hook aufgerufen) und reicht das fertige `RAPIER` in jeden neuen App-Kontext; jede Anlage hat ihre eigene Welt. Die Tests rechnen das WASM nur mit V8-Liftoff (`--liftoff-only` per `v8.setFlagsFromString`), sonst kostet das Nachoptimieren in sieben parallelen Prozessen mehr als der ganze Testlauf (15 s statt 5 s) |
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
- `shape.h2` (optional, Phase 3): **geneigte Oberseite (Keil)**. Die Höhe läuft entlang der **lokalen
  x-Achse** linear von `h` (am kleinsten lokalen x des Grundrisses, `x0`) nach `h2` (am größten, `x1`):
  `top(lx) = h + (h2 − h) · (lx − x0) / (x1 − x0)`. Die Unterseite bleibt waagrecht auf `pose.z`.
  Für Rechteck `x0 = −w/2`, Kreis `x0 = −r`, Polygon min/max der Punkte. Fehlt `h2` oder ist gleich `h`,
  ist die Oberseite eben. Nur bei `static` und **nicht mit Transportfläche** (siehe Festlegungen Phase 3).
  Die 3D-Ansicht baut den Körper als Prisma, dessen obere Punkte je Ecke die Höhe `top(lx)` haben
  (`MF.geom.topAt(shape, lx)`); bergab zeigt die Richtung lokal +x, wenn `h2 < h`.
- `pose`: Mittelpunkt der Unterseite des Grundrisses, `rot` = Drehung um z in Grad, relativ zum Eltern.
  Bei Polygonen ist `pose` der Ursprung der lokalen Punkte (muss nicht in der Mitte liegen).
- `surface.dir`: Laufrichtung in Grad, lokal zum Körper. In der Draufsicht zeigt y nach unten,
  positive Winkel drehen im Uhrzeigersinn: **rechts 0°, unten 90°, links 180°, oben 270°**
  (geprüft gegen den Spike: dort läuft Band B mit `{ x: 0, y: 1 }` „nach unten“).
- `settings.snap.on` (Fangen an/aus) gehört zur Anlage, `snap.pos` ist das Fangraster in m.
- Die Signale (I/O) hängen an den **Funktionen**, nicht an der Vorlage (`MF.io(body)`):
  Erzeuger `Freigabe`/`Erzeugt`, Transportfläche `Ein`/`Läuft`/`Tempo`, Sensor `Belegt`,
  Achse (zweipunkt) `Ausfahren`/`Ausgefahren`/`Eingefahren`/`Ist` (neu), Senke `Reset`/`Anzahl`.
- Die Eigenschaften der Vorlagen (Tempo, Richtung, Takt, Hub …) lesen und schreiben die Funktionen
  (`MF.getProp`/`MF.setProp`); „Richtung“ dreht den Körper (`pose.rot`), der lokale `dir` bleibt.
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

Festgelegt in Phase 2 (Umsetzung `sim/migrate.js`, Zelle × `cellM`, alle Körper achsparallel):

| Alt | Neu im Detail |
|---|---|
| Förderband | Rechteck = belegte Zellen, Unterseite z = 0,6 m. `direction` → `surface.dir` (Grad, siehe oben), Lage-Drehung 0. **Liefert ein Band auf ein anderes** (das andere berührt seine Stirnkante), liegt das abnehmende **2 mm tiefer**; Ketten werden weitergereicht |
| Lichtschranke | 5 cm schmaler Streifen durch die Zellmitte (wie der alte Strahl), quer über das Band, 0,3 m hoch, Unterseite 1 cm über der Bandoberkante (ohne Band: über dem Boden) |
| Schieber | `direction: 'auto'` einmal fest aufgelöst (wie die alte Engine). Grundform schiebt nach +y, gedreht in die Schubrichtung (`pose.rot`). Form: **Stößel mit Platte und Fangwinkel** (siehe Abschnitt 4), Platte an der Zellkante, Unterseite 2 cm über dem Band, `stroke` (mm) → `axis.max` (m), `speed` → `vmax`, `returnDelay` bleibt |
| Quelle | liegt dort, wo die alte Engine die Kisten ablegte (Mitte der angrenzenden Bandzelle), Unterseite 2 cm über dem Band; der Erzeuger legt die Kiste mit ihrer Unterseite auf die Lage des Erzeugers |
| Senke | Zelle als Grundriss, vom Boden (z = 0) bis 0,6 m – also 10 cm unter der Bandoberkante |
| `settings` | `dtMs` bleibt (alte Dateien: meist 50 ms, siehe Abschnitt 4), `cellM` entfällt, dazu `gravity: −9,81` und `snap` |
| unbekannter Typ | wird als Körper mit unbekannter Vorlage übernommen; `validate()` meldet ihn, die Datei wird nicht geladen |

`validate()` prüft Version 3 und hebt ältere Dateien vorher selbst an. Ein alter Autosave
(Version 1 oder 2) wird beim Start genauso umgerechnet.

Festgelegt in Phase 3 (frei gestaltete Körper; `sim/model.js`, `sim/geom.js`, `ui/editor.js`, `ui/properties.js`):

| Thema | Festlegung |
|---|---|
| Neu gezeichnete Form | `ghost`, `template: null`, Höhe **0,1 m**, Unterseite z = 0, Drehung 0, Werkstoff `body` (Reibung 0,5, Stoßzahl 0, Dichte 500 kg/m³), Farbe `#3A7CA5`. IDs `K1`, `K2` … (eigene Reihe), Name „Körper n“. Polygon: `pose` = Mitte des Hüllrechtecks |
| Polygone | mindestens 3 Punkte, **ohne Selbstschnitt** (Zeichnen, Bearbeiten und `validate()` lehnen ab). Konkav ist erlaubt: `MF.geom.convexParts` entfernt Punkte auf geraden Kanten, schneidet Ohren und **verschmilzt** die Dreiecke wieder zu möglichst großen konvexen Teilen (Hertel-Mehlhorn) – weniger innere Kanten, an denen Kisten hängen könnten |
| Neigung (Rutsche) | `shape.h2` statt Kippen im Raum (Abschnitt 6 bleibt „später“). Nur `static`, nicht zusammen mit einer Transportfläche (die Nachführung kennt nur waagrechte Flächen, Spike-Ergebnis 5) – das Panel sperrt beides gegenseitig, `validate()` prüft es. Rapier: je konvexem Teil ein `ConvexPolyhedron` mit schräger Oberseite (Kreis als 32-Eck). Bestehende Dateien haben kein `h2` und bleiben unverändert |
| Körperart wechseln | erlaubt, auch während die Simulation läuft. Nicht mehr erlaubte Funktionen und eine Neigung werden **nach Rückfrage entfernt** (nicht verhindert – so kommt man z. B. vom Sensor zur festen Wand, ohne erst alles abzubauen). Wechsel zu `dynamic` setzt eine Dichte unter 10 kg/m³ (Vorlagen haben 1) auf 500 |
| Funktion entfernen | ihre Signale verschwinden; einfache Regeln, die genau so ein Signal benutzen, verlieren den Bezug (`when`/`then` leer) – wie beim Löschen eines Körpers. SCL-Code meldet das fehlende Signal selbst. Bestehende Eingangswerte anderer Funktionen bleiben |
| Vorlagen-Körper | lassen sich genauso ändern. Jede Vorlagen-Eigenschaft gehört zu einer Funktion (`fn`) und verschwindet mit ihr; im Panel stehen sie im Abschnitt ihrer Funktion, frei gezeichnete Körper zeigen dort die allgemeinen Felder (`MF.FUNCTIONS[fn].fields`). „Richtung“ zeigt „–“, wenn der Körper schräg gedreht ist |
| `dynamic` aus dem Modell | Rapier-Körper ab Start, Lage aus der Physik (Draufsicht zeigt Lage und Drehung um z, Kippen nicht). Das Modell behält die gezeichnete Lage; Reset und jede Änderung am Körper setzen ihn dorthin zurück. Senken entfernen nur erzeugte Kisten, keine Modell-Körper; Sensoren und Erzeuger sehen dynamische Körper wie Kisten. Keine Funktionen. Während er unterwegs ist, zeigt die Draufsicht keine Griffe |
| Wann was geht | Form, Lage, Höhe, Körperart, Werkstoff und Funktionen ändern wirkt sofort, auch im Lauf (die Engine gleicht die Welt bei jeder Änderung an). Neue Formen zeichnen geht nur, wenn die Simulation nicht läuft – wie Einfügen aus dem Katalog |
| Fangen | Punkte und Maße auf `snap.pos`, Drehung (Griff, Panel-Schritt) auf `snap.angle`; **Alt** hält Fangen beim Zeichnen und Ziehen aus (dann 1 mm), beim Polygon fängt **Shift** Kantenwinkel und -länge ab dem letzten Punkt. Reine Funktionen in `MF.geom` (`snapPoint`, `snapAngle`, `snapPolar`) |
| Bedienung | Werkzeuge Rechteck **E**, Kreis **K**, Polygon **P** (R ist Reset). Griffe in Auswählen/Verschieben: Drehgriff über der lokalen Oberkante, Rechteck Ecken/Kanten (Gegenseite bleibt stehen), Kreis Radius, Polygonpunkte; Doppelklick auf eine Kante fügt einen Punkt ein, auf einen Punkt löscht ihn. Jede Mausbearbeitung ist **ein** Schritt im Verlauf (`MF.history.begin()/end()`) |

## 4. Simulationszyklus

Gleiche Reihenfolge wie bisher, fester Zeitschritt. Der **SPS-Zyklus** dauert `settings.dtMs`
(wählbar 10/20/50/100 ms wie bisher, neue Anlagen 20 ms). Die **Physik** (Schritte 3 und 4) rechnet
darin in gleich langen Unterschritten von **höchstens 20 ms** (50 ms → 3 × 16,7 ms, 100 ms → 5 × 20 ms).
Entscheidung Phase 2: Alte Dateien und die Testpläne haben 50 ms. Die Migration hebt `dtMs` nicht an,
denn der Zyklus ist für Regeln und SCL sichtbar (Zeitglieder, Flanken, Zyklenzählen) und alte Programme
sollen gleich weiterlaufen. Die Unterschritte halten die Physik trotzdem stabil.

1. **Sensoren lesen** – Rapier-Schnittabfragen der Sensorflächen (+ Entprellung)
2. **Logik** – Wenn-dann-Regeln, dann SCL-Bausteine (Reihenfolge wie im Strukturbaum)
3. **Aktoren** – Achsen-Sollwerte → nächste Lage der kinematischen Körper; Transportflächen an/aus/Tempo
4. **Physik-Schritt** – `world.step()`; Transportflächen wirken auf aufliegende dynamische Körper
5. **Erzeuger und Senken**

Transportfläche (festgelegt in Phase 1): Rapier kennt in JS keine Oberflächengeschwindigkeit.
Methode **„Geschwindigkeit nachführen“**: vor `world.step()` für jeden dynamischen Körper mit
Auflagekontakt (|Normale z| > 0,7) auf Transportflächen

- Zielgeschwindigkeit = Mittel der Bandgeschwindigkeiten, **gewichtet mit dem Kontaktimpuls J**
  des letzten Schritts (trägt ein Band mehr Gewicht, zieht es stärker),
- `v += k · (v_ziel − v)` in der Flächenebene, k = 1, **begrenzt auf μ · ΣJ / m** (Coulomb, μ = 0,8),
- Drehung um die Hochachse mit derselben Grenze abbremsen.

Die Bandoberfläche hat in Rapier Reibung 0 (Kombination `Min`), damit nichts doppelt bremst.
Funktioniert auf `static` und `kinematic` Körpern gleich. Phase 2: μ der Begrenzung ist der Reibwert
der Transportfläche (`material.friction`, Vorlage Band 0,8); die Nachführung läuft vor jedem
Physik-Unterschritt, eine Kiste ohne Änderung darf schlafen. Verglichen wurde der „Laufband-Trick“
(kinematischer Körper mit Geschwindigkeit, Lage jeden Schritt zurückgesetzt) – gleich gut, aber
schlecht kombinierbar mit Achsen und wirkt auf alle Seiten. Messwerte: Spike-3D-Ergebnis.md.

Weitere Festlegungen aus Phase 2:

- **Boden** bei z = 0 ist immer da (fester Quader, Reibung 0,6). Kisten unter z = −2 m werden entfernt.
- **Kisten** sind dynamische Rapier-Körper mit Lage im Mittelpunkt; die Senke prüft diesen Punkt.
- **Achse zweipunkt**: `Ausfahren` = 1 → mit `vmax` nach `max`; = 0 → `returnDelay` warten, dann
  nach `min`. Stellung je Physik-Unterschritt, `setNextKinematicTranslation`. Weitere Betriebsarten
  und rotatorische Achsen ergänzt Phase 4 in `MF.engine.stepAxis` und `MF.FUNCTIONS.axis.MODES`.
- **Schieber-Vorlage: Stößel mit Fangwinkel.** In echter Physik zieht ein laufendes Band (0,5 m/s)
  eine Kiste seitlich an einem langsamen Schieber (0,3 m/s) vorbei – die alte Raster-Engine hatte den
  ausgefahrenen Schieber stillschweigend als Sperre behandelt. Darum: Platte über die ganze Zellbreite,
  auf der Abströmseite ein 5 cm langer Fangwinkel, der die Kiste vor der Platte festhält; dahinter ein
  Stößel so lang wie der Hub, der ausgefahren das Band für nachfolgende Kisten sperrt (wie früher).
  Werkstoff Gleitbelag μ = 0,05 – mit Stahl (0,3) zieht der einfahrende Stößel eine gestaute Kiste
  quer vom Band. Geprüft mit Prototypen über 120 s (Platte schmal/breit, Arm 5–12 cm, μ 0–0,3).
- **Überlast ist echte Physik.** Kommt alle 2 s eine Kiste, braucht ein 0,3-m/s-Schieber mit 0,6 m Hub
  aber 4,5 s je Takt, staut sich eine Schlange am Stößel; dann fallen einzelne Kisten daneben. Die
  eingebaute Beispielanlage hat deshalb einen Schieber mit **1 m/s** (sonst identisch mit der
  migrierten alten Beispielanlage); alte Dateien behalten ihr Tempo.

Aus Phase 1 außerdem:

- Aneinanderstoßende Transportflächen **nie exakt bündig**: das abnehmende Band 1–2 mm tiefer,
  sonst hakt die Kiste an der Kante ein und springt.
- Sensoren über Rapier-Schnittabfragen (`intersectionsWithShape`, nur dynamische Körper), keine
  Sensor-Collider. Erzeuger legen nur auf, wenn der Platz frei ist.
- Simulation ist bitgenau deterministisch (Node, Chromium, Firefox gleich). Tests prüfen trotzdem
  vor allem Verhalten (Zähler, Signale); Positions-Hashes nur gezielt.
- Rapier im node:vm-Kontext braucht die Globals `TextDecoder` und `performance`.

## 5. Phasen

Jede Phase ist ein eigener Branch und endet mit etwas Lauffähigem. Die Tests (`npm test`) müssen
nach jeder Phase grün sein – angepasst werden dürfen nur Tests, die interne Details prüfen, nicht
das Verhalten der Anlage.

| Phase | Branch | Inhalt | Hängt ab von |
|---|---|---|---|
| 0a | `feature/tests` | Headless-Tests, Prüf-Agent, CI | – |
| 0b | `feature/baum-ordner` | freie Ordner im Strukturbaum, Dateiformat v2 | – |
| 1 | `feature/3d-spike` | ✅ `lib/rapier.js` + `lib/three.js` bauen, Rapier + Three per Doppelklick laden, Demo `spike-3d.html`; Transportflächen-Methode festgelegt (siehe Abschnitt 4, Spike-3D-Ergebnis.md) | 0a |
| 2 | `feature/physik-kern` | ✅ Datenmodell v3 + Migration (`sim/migrate.js`), neue Engine auf Rapier (`sim/engine.js`), alle Katalog-Elemente als Vorlagen mit Funktionen, Draufsicht zeichnet Körper (`sim/geom.js`, `sim/sim.js`); alte Raster-Engine entfernt. Festlegungen siehe Abschnitte 1, 3 und 4 | 0a, 0b, 1 |
| 3 | `feature/formen` | ✅ Rechteck/Kreis/Polygon zeichnen, Höhe, freie Lage und Drehung, Körperart und Funktionen im Eigenschaften-Panel, Fangen; geneigte Oberseite `shape.h2` für Rutschen. Festlegungen siehe Abschnitt 3 | 2 |
| 4 | `feature/achsen` | Achsen linear/rotatorisch mit allen Betriebsarten, Kopplung über den Baum, Achse in der Draufsicht anzeigen und ziehen. Vorbereitet in Phase 3: Achse lässt sich an jeden kinematischen Körper hängen (`MF.addFunction`), Felder im Panel aus `MF.FUNCTIONS.axis.fields` (bisher Richtung, min, max, vmax, returnDelay) – dort ergänzen | 2 (besser nach 3) |
| 5 | `feature/3d-ansicht` | Three.js-Ansicht zum Zuschauen: Orbit-Kamera, Licht, Schatten, Auswahl per Klick, Draufsicht und 3D nebeneinander | 2 |

Phasen 3 und 5 können parallel laufen.

**Fertig ist der Umbau, wenn:** die Beispielanlage aus einer alten `.mfab`-Datei lädt, mit der
Regel R1 Kisten über den Schieber in SE2 landen, eine selbst gezeichnete schräge Rutsche Kisten
per Schwerkraft weiterleitet und ein Drehtisch per SCL auf 90° fährt.

## 6. Später (bewusst nicht im Umbau)

Körper im Raum kippen (Drehung um x/y), Gelenkketten mit mehr als zwei Ebenen bearbeiten,
Import von CAD-Dateien, Anbindung echter Steuerungen.
