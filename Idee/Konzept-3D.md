# Konzept: Umbau auf 3D-Physik („2,5D“)

Stand: 09.10.2026 (Phase 4 eingetragen – der Umbau ist fertig, siehe Abschnitt 5; danach Objektfang, Abschnitt 3, sowie Handbetrieb und Ventil in 3b). Dieses Dokument ist der gemeinsame Plan für alle Branches des Umbaus.
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
| `zweipunkt` | `Ausfahren` (BOOL); mit Ventil `bi` zusätzlich `Einfahren` (BOOL) | `Ausgefahren`, `Eingefahren` (BOOL), `Ist` (REAL) | fährt mit `vmax` nach `max` bzw. zurück nach `min`; Ventil `mono` (ein Eingang) mit `returnDelay`, `bi` (zwei Eingänge) bleibt geschaltet |
| `position` | `Soll` (REAL), `Freigabe` (BOOL) | `Ist` (REAL), `InPosition` (BOOL) | fährt mit höchstens `vmax` auf `Soll` |
| `geschwindigkeit` | `Soll` (REAL), `Freigabe` (BOOL) | `Ist` (REAL) | dreht/fährt mit `Soll` (m/s bzw. °/s) bis zu den Grenzen |

Linear: Werte in m. Rotatorisch: Werte in Grad.

**Kopplung:** Ein Körper kann einen anderen Körper als Eltern haben (im Strukturbaum darunter
gezogen). Seine Lage ist dann relativ zum Elternkörper, und er bewegt sich mit ihm mit. Beispiel:
Greifer (kinematisch, linear) auf Drehtisch (kinematisch, rotatorisch). Ordner haben keine Lage
und beeinflussen die Bewegung nicht. Einzelheiten (Datenmodell, Grenzen): Festlegungen Phase 4 in Abschnitt 3.

## 3. Datenmodell (Dateiformat Version 3)

Version 2 führt der Branch „Strukturbaum mit Ordnern“ ein (Ordner statt `group`).
Version 3 ist der Umbau. `MF.file.migrate()` rechnet 1 → 2 → 3 schrittweise um.

```json
{
  "format": "mini-fabrik",
  "version": 3,
  "name": "Beispielanlage",
  "settings": { "dtMs": 20, "gravity": -9.81, "snap": { "on": true, "obj": true, "pos": 0.05, "angle": 5 } },
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
- `settings.snap.on` (Fangen an/aus) und `settings.snap.obj` (Objektfang an/aus, fehlt = an) gehören zur
  Anlage, `snap.pos` ist das Fangraster in m. Die beiden Schalter sind kein Schritt im Verlauf.
- Die Signale (I/O) hängen an den **Funktionen**, nicht an der Vorlage (`MF.io(body)`):
  Erzeuger `Freigabe`/`Erzeugt`, Transportfläche `Ein`/`Läuft`/`Tempo`, Sensor `Belegt`,
  Achse (zweipunkt) `Ausfahren`/`Ausgefahren`/`Eingefahren`/`Ist` (neu), Senke `Reset`/`Anzahl`.
- Die Eigenschaften der Vorlagen (Tempo, Richtung, Takt, Hub …) lesen und schreiben die Funktionen
  (`MF.getProp`/`MF.setProp`); „Richtung“ dreht den Körper (`pose.rot`), der lokale `dir` bleibt.
- `axis`: `{ "type": "linear"|"rotary", "origin": [x,y,z], "dir": [x,y,z], "min", "max", "vmax", "mode", "returnDelay" }`, lokal zum Körper.
  `mode`: `zweipunkt` | `position` | `geschwindigkeit`. Rotatorisch nur mit `dir = [0, 0, ±1]` (Phase 4).
- `parent` (Phase 4): Ordner-ID, `null` oder **Körper-ID** (Kopplung, nur bei Körpern).
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
| Förderband | Rechteck = belegte Zellen, Unterseite z = 0,6 m. `direction` → `surface.dir` (Grad, siehe oben), Lage-Drehung 0. Alle Bänder liegen **bündig** (Oberkante 0,7 m; bis 09.10.2026 lag ein abnehmendes Band 2 mm bzw. 1 cm tiefer) |
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
| Vorlagen-Körper | lassen sich genauso ändern. Jede Vorlagen-Eigenschaft gehört zu einer Funktion (`fn`) und verschwindet mit ihr; im Panel stehen sie im Abschnitt ihrer Funktion, frei gezeichnete Körper zeigen dort die allgemeinen Felder (`MF.FUNCTIONS[fn].fields`). „Richtung“ ist seit `feature/drehung` ein Gradfeld (siehe unten, „Gradgenau drehen“) |
| `dynamic` aus dem Modell | Rapier-Körper ab Start, Lage aus der Physik (Draufsicht zeigt Lage und Drehung um z, Kippen nicht). Das Modell behält die gezeichnete Lage; Reset und jede Änderung am Körper setzen ihn dorthin zurück. Senken entfernen nur erzeugte Kisten, keine Modell-Körper; Sensoren und Erzeuger sehen dynamische Körper wie Kisten. Keine Funktionen. Während er unterwegs ist, zeigt die Draufsicht keine Griffe |
| Wann was geht | Form, Lage, Höhe, Körperart, Werkstoff und Funktionen ändern wirkt sofort, auch im Lauf (die Engine gleicht die Welt bei jeder Änderung an). Neue Formen zeichnen geht nur, wenn die Simulation nicht läuft – wie Einfügen aus dem Katalog |
| Fangen | Punkte und Maße auf `snap.pos`, Drehung (Griff, Werkzeug Drehen beim Ziehen, Panel-Schritt) auf `snap.angle`; **Alt** hält Fangen beim Zeichnen und Ziehen aus (dann 1 mm), beim Polygon fängt **Shift** Kantenwinkel und -länge ab dem letzten Punkt. Reine Funktionen, seit dem Objektfang in `MF.snap` (`sim/snap.js`: `gridPoint`, `angle`, `polar` …), siehe unten |
| Bedienung | Werkzeuge Rechteck **E**, Kreis **K**, Polygon **P** (R ist Reset). Griffe in Auswählen/Verschieben: Drehgriff über der lokalen Oberkante, Rechteck Ecken/Kanten (Gegenseite bleibt stehen), Kreis Radius, Polygonpunkte; Doppelklick auf eine Kante fügt einen Punkt ein, auf einen Punkt löscht ihn. Jede Mausbearbeitung ist **ein** Schritt im Verlauf (`MF.history.begin()/end()`) |

Festgelegt in Phase 4 (Achsen, Kopplung, neue Vorlagen; `sim/model.js`, `sim/engine.js`, `sim/sim.js`, `ui/editor.js`):

| Thema | Festlegung |
|---|---|
| Achse linear | verschiebt den Körper um Stellung · `dir` (normiert), auch senkrecht (`dir = [0, 0, 1]`, Hubtisch). `origin` verschiebt **nicht** mehr (bisher immer `[0, 0, 0]`), er ist nur Anzeige- und Griffpunkt |
| Achse rotatorisch | dreht den Körper um `origin` (lokal) um die Hochachse; `dir = [0, 0, 1]`: positive Stellung dreht in der Draufsicht im Uhrzeigersinn (wie `pose.rot`), `[0, 0, −1]` dagegen. Rapier: `setNextKinematicRotation` zusätzlich zur Translation (nur bei Drehachse oder Kopplung, Schieber unverändert) |
| Betriebsarten | `zweipunkt` wie Phase 2. `position`: mit `Freigabe` = 1 auf `Soll`, höchstens `vmax`. `geschwindigkeit`: mit `Freigabe` = 1 mit `Soll`, begrenzt auf ±`vmax`. Ohne `Freigabe` steht die Achse. Grenzen `min`/`max` gelten immer: ein Sollwert außerhalb wird an der Grenze gestoppt; liegt die Achse nach einer Änderung außerhalb, fährt sie mit `vmax` zurück |
| Grundstellung | nach Reset: `zweipunkt` bei `min` (wie bisher), sonst 0 (in die Grenzen geklemmt) |
| `InPosition` | \|Ist − Soll\| ≤ **1 mm** (linear) bzw. **0,1°** (rotatorisch) (`MF.AXIS.TOL`), unabhängig von `Freigabe`. Ein Soll außerhalb der Grenzen wird nie „in Position“ |
| Signale | `Soll` und `Ist` sind `FLOAT32` (m bzw. Grad; `Soll` in `geschwindigkeit` m/s bzw. °/s), `Freigabe` und `InPosition` `BOOL`. Startwert von `Soll` und `Freigabe` 0 |
| Panel | Typ und Betriebsart wählbar; Felder hängen von der Achse ab (Einheit, Schritt, Grenzen, `when`) und kommen aus `MF.fieldsOf(body, fn)`; ändern über `MF.setField` bzw. `MF.setAxis` (prüft mit `MF.axisError`). Ändern sich dabei die Signale, werden sie angeglichen (`MF.syncIo`), Regeln auf weggefallene Signale verlieren den Bezug. Vorlagen mit eigenen Eigenschaften (Schieber) zeigen Typ und Betriebsart zusätzlich (`core`) |
| Typ wechseln | setzt Richtung, Grenzen und Tempo auf Standardwerte des Typs (linear `[0,1,0]`, 0 … 0,4 m, 0,3 m/s; rotatorisch `[0,0,1]`, 0 … 90°, 45 °/s) |
| Kopplung im Modell | `parent` eines Körpers darf eine Körper-ID sein. `pose` gilt dann relativ zur **aktuellen** Lage des Elternkörpers (mit dessen Achse); `MF.poseInWorld` rechnet die Kette (Engine, Draufsicht, 3D, Hüllquader). Im Baum hängt der Körper unter dem Elternkörper, sein Ordner ist der des Elternkörpers (`MF.store.folderOf`). Neue Körper neben einem gekoppelten Körper werden nicht gekoppelt |
| Kopplung bedienen | im Baum einen Körper auf die Mitte eines Körpers ziehen oder im Panel „Gekoppelt an“. Koppeln, Lösen und Löschen des Elternkörpers lassen den Körper **dort, wo er gerade ist** (Lage wird umgerechnet, Achsen in ihrer aktuellen Stellung); Kinder eines gelöschten Körpers hängen eine Ebene höher. Ein Schritt im Verlauf |
| Grenzen der Kopplung | höchstens **zwei Ebenen** (ein gekoppelter Körper trägt keine Körper), keine Kreise, keine dynamischen Körper (weder als Kind noch als Eltern). Wird ein beteiligter Körper dynamisch, löst sich die Kopplung nach Rückfrage. `validate()` prüft alles; Dateien ohne Kopplung bleiben unverändert gültig, **Version bleibt 3** |
| Kopplung in Rapier | ein fester Körper an einem Körper wird in Rapier kinematisch (er bewegt sich mit und trägt Kisten); bewegte Körper fahren je Physik-Unterschritt mit `setNextKinematic*`. Ändert sich das Modell in der Pause (Elternkörper verschoben), setzt `sync()` den Rapier-Körper an seine neue Lage |
| Transportfläche auf bewegtem Körper | Die Bandoberfläche hat Reibung 0, daher rechnet die Nachführung die Bewegung des Körpers ein: Ziel = Geschwindigkeit des Oberflächenpunkts unter der Kiste (Lage vor/nach dem Unterschritt, also v + ω × r) + Bandgeschwindigkeit; die Laufrichtung dreht mit dem Körper, die Drehung der Kiste wird zu ω des Körpers gezogen (gleiche Coulomb-Grenze). Unbewegte Bänder rechnen wie bisher |
| Kontakte nach Anhalten | Gleitet ein kinematischer Körper an einer Kiste entlang (Stopper fährt ein, die gestaute Kiste drückt seitlich), schreibt parry die Kontaktpunkte nur fort – auch über die Kante hinaus –, und die Kiste hing an einem Kontakt, den es nicht mehr gab. Darum: kommt ein bewegter Körper zum Stehen, werden seine Kontakte neu berechnet (`refreshContacts`) |
| Achse in der Draufsicht | für den gewählten Körper in Blau: linear Linie von min bis max mit Pfeil und Marke der Stellung, senkrecht ein Kreis mit Punkt (hoch) bzw. Kreuz (runter) und Text, rotatorisch Bogen von min bis max mit Zeiger. Griffe: Ursprung, min, max, Richtung (nur linear in der Ebene); Fangen wie bei Formen (Lage `snap.pos`, Winkel `snap.angle`, Alt aus). Jede Geste ein Schritt im Verlauf, Esc bricht ab. Bearbeiten (Griffe, Verschieben, Pfeiltasten) rechnet bei gekoppelten und gedrehten Körpern ins Koordinatensystem der Lage zurück |
| Katalog | entsteht aus `MF.templates` (`MF.templateGroups()`); jede Vorlage hat `label`, `icon`, `prefix`, `color`, `group`, `hint`, `make()`, `props`. Keine Sonderfälle je Vorlage in Oberfläche oder Engine |
| Neue Vorlagen | **Drehtisch** `DT` (Gruppe Tische): Kreis r 0,4 m, kinematisch, Band 0,5 m/s, Drehachse 90 °/s (bis Handbetrieb `position` −180 … 180°, seitdem `zweipunkt` 0 … 90°, siehe 3b). **Hubtisch** `HT` (Tische): 0,6 × 0,5 m mit Band, linear z, `zweipunkt`, Hub 0,3 m, 0,2 m/s. Beide Oberkante 0,7 m, bündig mit den Bändern (bis 09.10.2026: 0,698 m bzw. 0,69 m). **Stopper** `ST` (Aktoren): Leiste 0,05 × 0,4 m, eingefahren 2 cm unter der Bandoberkante, linear z, `zweipunkt`, 0,14 m, 0,5 m/s, Gleitbelag. **Weiche** `W` (Aktoren): Arm 0,8 × 0,05 m, 2 cm über dem Band, Drehachse am linken Ende, `zweipunkt` 0 … 45°, 90 °/s, Gleitbelag; an die obere Bandkante gelegt lenkt sie ausgefahren auf ein nach unten abgehendes Band. Portal/Greifer: nicht in diesem Umbau (Greifen fehlt) |

### 3b. Festlegungen Handbetrieb (`feature/handbetrieb`)

| Thema | Festlegung |
|---|---|
| Ventil | Feld `axis.valve` (nur Betriebsart `zweipunkt`): `'mono'` (Standard; fehlt das Feld wie in alten Dateien, gilt `mono`, die Datei bleibt beim Speichern ohne Feld) – `Ausfahren` = 1 fährt aus, 0 nach `returnDelay` ein, wie bisher. `'bi'` (zwei Spulen) – Eingänge `Ausfahren` und `Einfahren`; ist genau einer 1, schaltet das Ventil (Laufzeit `rt.out`), sind beide 0, bleibt es. **Beide 1: das Ventil bleibt, wie es zuletzt geschaltet wurde** (wie ein bistabiles Ventil; eine Fahrt läuft zu Ende). Nach Reset ist es auf Einfahren. Kein `returnDelay` (im Panel per `when` ausgeblendet, auch die Schieber-Eigenschaft). Signale passen sich an (`MF.syncIo`), Reihenfolge `Ausfahren`, `Einfahren`, `Ausgefahren`, `Eingefahren`, `Ist`. `MF.axisError` und `validate()` prüfen den Wert |
| Handbetrieb | Abschnitt „Handbetrieb“ im Eigenschaften-Panel für jeden Körper mit Achse, je Betriebsart (nicht je Vorlage). `MF.axisManual(body, cmd, value)` – dieselbe Funktion für Knöpfe und Tests – schreibt dieselben Eingänge wie der I/O-Tab (`MF.engine.setSignal`), **kein Schritt im Verlauf**. `zweipunkt`: `out`/`in` (Beschriftung `MF.axisManualLabels`: Ausfahren/Einfahren, rotatorisch Drehen/Zurück, senkrecht Heben/Senken); bei `mono` `Ausfahren` = 1 bzw. 0, Einfahren per Knopf **ohne Rückfahrverzug** (die Wartezeit gilt als abgelaufen, `rt.wait`), danach gilt `returnDelay` wieder fürs Signal; bei `bi` ein **Impuls** (`MF.engine.pulse`: 1 für den nächsten Zyklus, danach 0; Reset nimmt ihn zurück) und der Gegen-Eingang wird 0. `position`: `goto` Ziel → `Soll` (in die Grenzen geklemmt) und `Freigabe` = 1; Zielfeld und Schnellknöpfe (linear min/max, rotatorisch 0°/90°/180°/−90° in den Grenzen). `geschwindigkeit`: `jog` −1/0/1 → `Soll` = ±`vmax` mit `Freigabe` = 1, 0 hält an (`Freigabe` = 0) |
| Handbetrieb anzeigen | Stellung als Balken (min … max) und Zahl, Zustand (fährt/steht, ausgefahren/eingefahren bzw. InPosition), Satz mit den Signalen für Regeln und SCL (`MF.axisManualHint`). Läuft die Simulation nicht, wirken die Knöpfe trotzdem (die Eingänge merken sich den Befehl), der Hinweis lautet „Simulation starten, damit sich etwas bewegt“. Schreibt eine aktive Regel einen der Eingänge, sind die Knöpfe gesperrt und der Hinweis nennt die Regel |
| Standards der Vorlagen | **Drehtisch** neu `zweipunkt` 0 … 90°, Ventil `mono`, `returnDelay` 0: `Ausfahren` = 1 dreht auf 90°, 0 zurück auf 0°. Bestehende Dateien behalten ihre Betriebsart. Hubtisch, Stopper, Weiche: `zweipunkt`, `mono`, `returnDelay` 0 (unverändert). Schieber: `mono` mit `returnDelay` 0,5 s (unverändert – mit einer Regel `LS1.Belegt → S1.Ausfahren` braucht er die Wartezeit, sonst fährt er zurück, bevor die Kiste vom Band ist) |

Festgelegt beim Objektfang (Branch `feature/objektfang`; `sim/snap.js`, `ui/editor.js`, `sim/sim.js`):

| Thema | Festlegung |
|---|---|
| Eine Fang-Stelle | **Alles Fangen läuft über `MF.snap`** (reine Rechnung, ohne DOM): `point()` für Zeichnen und Griffe, `moveBody()` für Verschieben und Einfügen aus dem Katalog, `len`/`gridPoint`/`angle`/`angleValue`/`polar` fürs Raster (Achs-Griffe, Drehen, Pfeiltasten, Panel über `MF.editor.snapStep`/`snapValue`), `dragAngle`/`angleStepped` fürs Drehen (siehe „Gradgenau drehen“). Der Editor rundet nicht selbst. Objektfang aus → genau das Raster wie zuvor (Verschieben ohne Raster 1 cm, Zeichnen/Griffe 1 mm) |
| Fangziele | Ecken □ und Kantenmitten △ (Rechteck, Polygon), Mittelpunkte ○ (alle Formen; Polygon: Mitte des Hüllrechtecks), Kreis-Quadranten ◇ (Weltachsen), Kanten ═, Bandenden, Flucht (x- oder y-Linie durch einen Zielpunkt, dünne gestrichelte Hilfslinie). Keine Ziele: der gezogene Körper, seine gekoppelten Kinder, ausgeblendete Körper, Kisten |
| Reichweite | **8 Bildschirmpixel** (`MF.snap.RANGE_PX`), unabhängig vom Zoom |
| Vorrang | Punkt → Kante → Flucht → Raster. Beim **Verschieben** zählt der Körper als Ganzes: liegt eine seiner Kanten parallel (± 1,8°) und gegenüber einer Zielkante näher als jeder Punkt an einem Zielpunkt, legt sie sich bündig an; danach rasten entlang der Kante Ecken bzw. Mitten aufeinander, sonst fängt dort das Raster. Liegen nach einem Punktfang die Mittelpunkte aufeinander, heißt es „an Mitte“. Achsparallele Kanten und Flucht legen nur eine Achse fest, die andere fängt weiter (bei gekoppelten Körpern auf gedrehtem Eltern nur ganze Punkte) |
| Gilt für | Verschieben (Maus) und Einfügen aus dem Katalog (Ziehen und Klick), Zeichnen (Punkte von Rechteck/Kreis/Polygon, Marker schon vor dem ersten Punkt), Griffe für Größe, Radius und Polygonpunkte (Maße folgen dann genau dem gefangenen Punkt). Drehen und Achs-Griffe fangen nur am Raster, Pfeiltasten gehen Rasterschritte, Polygon mit Shift fängt Winkel und Länge |
| Alt | hält Raster **und** Objektfang aus, auch beim Ziehen aus dem Katalog (dort hatte Alt vorher keine Wirkung) |
| Höhenregel Bandenden | Neue Bänder und Tische aus dem Katalog liegen alle auf 0,7 m, **bündig**; nichts wird automatisch abgesenkt (siehe Abschnitt 4, Umlenkrolle). Rastet eine **Stirnkante** (Kante quer zur Laufrichtung) einer Transportfläche an die Stirnkante einer anderen, bekommt der **gezogene** Körper dieselbe Oberkante wie der andere, egal ob er abnimmt oder liefert. Der andere Körper bleibt unverändert. Ohne Bandende behält er die Höhe vom Anfassen. Meldung „an Bandende von B1 (nimmt ab, bündig)“ bzw. „(liefert, bündig)“ (bis 09.10.2026: 2 mm bzw. 1 cm tiefer/höher) |
| Anzeige | Marker am Fangpunkt in Grün (`MF.sim.snapMark`), Text in der Statusleiste („Objektfang: an Kante von B1.“) und in der Meldung nach dem Ziehen bzw. Einfügen |
| Schalter | Knopf **„Objektfang“** neben „Fangen“ in den Reitern Modell und Design (`MF.ui.syncToggles`), Kürzel **O**. `settings.snap.obj`, Standard an; alte Dateien ohne `obj` = an, `validate()` verlangt `true`/`false`. Kein Schritt im Verlauf: Rückgängig lässt `snap.on` und `snap.obj`, wie sie sind (`MF.history.snapshot` lässt sie weg) |
| Behoben | `MF.sim.drawPose()`/`restDrawPose()` gaben ohne Achse und Kopplung `b.pose` selbst zurück; der Editor merkte sich das beim Anfassen, und ein gezogener Körper lief seit Phase 4 nur halb so schnell wie die Maus. Beide liefern jetzt eine Kopie |

Festgelegt beim gradgenauen Drehen (Branch `feature/drehung`; `sim/model.js`, `sim/snap.js`, `ui/properties.js`, `ui/editor.js`):

| Thema | Festlegung |
|---|---|
| Datenmodell | unverändert: die Drehung steckt in `pose.rot` (Grad, 0 … 360), die Laufrichtung lokal in `surface.dir` bzw. die Schubrichtung in `axis.dir`. Dateien, Signale und Regeln bleiben gleich |
| Genauigkeit | Eingaben (Feld „Drehung“, Feld „Richtung“) gelten auf **0,1°** genau, auch ohne Fangen (`MF.setRotation`, `MF.dirValue` runden über `MF.snap.angle(…, off)`). MCP (`rot`) und Dateien dürfen genauer sein, nichts wird beim Laden gerundet |
| Eigenschaft `direction` | Vorlagen-Eigenschaft vom Typ `'direction'`: Lauf- bzw. Schubrichtung **in Grad** in der Welt (`MF.dirValue(pose.rot + dir)`); setzen dreht den Körper (`MF.turnDir`). Angenommen werden Zahlen, Zahlen als Text („37,5“) und die alten Namen `rechts`/`unten`/`links`/`oben` (`MF.DIRS`); Unbekanntes ändert nichts. Gilt für alle Vorlagen mit `direction` (Förderband, Schieber) |
| MCP | `props.direction` nimmt Zahl oder Namen an (anderes wird mit Hinweis abgelehnt), `get_overview` liefert die Zahl; `list_templates` beschreibt die Eigenschaft mit `type: "direction"`, `unit: "°"` und `names` |
| Panel | „Drehung“ steht in „Form & Lage“ direkt unter „Form“. Feld „Richtung“ ist ein Gradfeld mit Schnellknöpfen **0° rechts, 90° unten, 180° links, 270° oben**. Bei beiden gehen − / + und Pfeiltasten **Schritte des Fangwinkels** (`MF.snap.angleStepped`: zuerst auf die nächste Rasterlinie, 37,3° + → 40°; Fangen aus: 1°; Shift zehn Schritte). Drehung und Richtung zeigen sich gegenseitig sofort an, ohne Neuaufbau des Panels (der Fokus bleibt beim Tippen). Gesperrte Körper: beide nur lesbar |
| Werkzeug Drehen (D) | Klick dreht wie bisher um +90°. **Ziehen** dreht frei um die Lage (`pose`), angefasst am Klickpunkt: Drehung = Drehung beim Anfassen + Winkel, um den die Maus um die Lage gewandert ist, gefangen auf `snap.angle`, **Alt** 0,1°. Winkel am Mauszeiger, Esc bricht ab, eine Geste = ein Schritt im Verlauf |
| Eine Rechnung | Werkzeug und Dreh-Griff nutzen dieselbe Geste (Griff-Ziehen im Editor) und dieselbe Rechnung `MF.snap.dragAngle(rot0, mitte, von, nach, snap, off)`; der Griff gilt als angefasst über der lokalen Oberkante (−y), damit bleibt sein Verhalten wie vorher |
| Schräge Winkel geprüft | Engine, Sensor, Erzeuger und Schieber rechnen in der Lage des Körpers (Quaternion um z), die Umlenkrollen-Rundung liegt lokal im Collider – alles dreht mit. Geprüft mit Tests: die ganze Beispielanlage um 30° und 37,5° gedreht schleust genau wie gerade aus; ein 30°-Band fördert mit Bandtempo ±5 % in Laufrichtung; zwei 30°-Bänder per Objektfang Bandende und der Übergang 30°-Band → gerades Band (Kantenmitte an Kantenmitte) lassen keine Kiste hängen; Kante bündig an der Seite eines 30°-Bands. Kein Fehler gefunden |

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
  und rotatorische Achsen: Phase 4 (Abschnitt 3) in `MF.engine.stepAxis` und `MF.FUNCTIONS.axis.MODES`.
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

- **Nähte bündig, Stirnenden als Umlenkrolle** (09.10.2026; vorher abnehmendes Band 2 mm, dann
  1 cm tiefer, zentral per `MF.fixBeltSeams` – entfernt, weil nicht realitätsnah): Alle Bänder
  und Tische liegen auf einer Ebene. In der Physik ist ein ebenes Rechteck mit Transportfläche
  an beiden Stirnenden (quer zur Laufrichtung, nächste lokale Achse, auch bei gedrehten Bändern
  und `dir` ≠ 0) gerundet: oben und unten ein Viertelkreis mit **r 5 cm** (`MF.geom.ROLL_R`),
  soweit die Höhe reicht – beim Katalog-Band ein Halbkreis, Rollendurchmesser = Bandhöhe.
  Seitenkanten bleiben scharf. Ein Kreis mit Transportfläche (Drehtisch) hat einen rundum
  gerundeten Rand. Welcher Körper wie gerundet ist, sagt `MF.geom.rollOf` (Engine und 3D-Ansicht).
  Grund: An einer scharfen Kante oder einer flachen Schräge rechnet Rapier den vorausschauenden
  Kontakt mit der Ecke darunter und bremst die Kiste wie an einer Wand (bis 6 von 10 Kisten
  hingen); ab 5 cm Radius hängt in der Messmatrix keine mehr (Spike-3D-Ergebnis 4a). Alte
  Dateien mit Absatz laden unverändert und laufen weiter. Die Nachführung lässt Änderungen
  unter 1 µm/s aus, damit ruhende Kisten auf der Rolle schlafen dürfen.
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
| 1 | `feature/3d-spike` | ✅ `lib/rapier.js` + `lib/three.js` bauen, Rapier + Three per Doppelklick laden, Demo `spike-3d.html` (Code am 09.10.2026 entfernt, siehe Spike-3D-Ergebnis.md); Transportflächen-Methode festgelegt (siehe Abschnitt 4, Spike-3D-Ergebnis.md) | 0a |
| 2 | `feature/physik-kern` | ✅ Datenmodell v3 + Migration (`sim/migrate.js`), neue Engine auf Rapier (`sim/engine.js`), alle Katalog-Elemente als Vorlagen mit Funktionen, Draufsicht zeichnet Körper (`sim/geom.js`, `sim/sim.js`); alte Raster-Engine entfernt. Festlegungen siehe Abschnitte 1, 3 und 4 | 0a, 0b, 1 |
| 3 | `feature/formen` | ✅ Rechteck/Kreis/Polygon zeichnen, Höhe, freie Lage und Drehung, Körperart und Funktionen im Eigenschaften-Panel, Fangen; geneigte Oberseite `shape.h2` für Rutschen. Festlegungen siehe Abschnitt 3 | 2 |
| 4 | `feature/achsen` | ✅ Achsen linear/rotatorisch mit allen Betriebsarten, Kopplung über den Baum (Körper unter Körper), Achse in der Draufsicht anzeigen und ziehen, neue Vorlagen Drehtisch, Hubtisch, Stopper, Weiche; Katalog aus `MF.templates`. Festlegungen siehe Abschnitt 3 | 2 (besser nach 3) |
| 5 | `feature/3d-ansicht` | ✅ Three.js-Ansicht zum Zuschauen (`ui/view3d-core.js`, `ui/view3d.js`): Orbit-Kamera, Licht, Schatten, Auswahl per Klick, Draufsicht und 3D nebeneinander. Festlegungen siehe Abschnitt 5a | 2 |

Phasen 3 und 5 können parallel laufen.

### 5a. Festlegungen aus Phase 5 (3D-Ansicht)

- **Zwei Dateien:** `ui/view3d-core.js` (`MF.view3dCore`) rechnet ohne Three.js und DOM – Prisma aus dem
  Grundriss, Interpolation, Spiegelung, Kamera prüfen/einpassen – und wird headless getestet.
  `ui/view3d.js` (`MF.view3d`) baut daraus Three.js-Objekte; sie lädt auch ohne Three.js, der Renderer
  entsteht erst, wenn die Ansicht zum ersten Mal sichtbar ist.
- **Prisma allgemein, nicht je Vorlage:** jede Form (`rect`, `circle`, `polygon`, auch konkav) wird ein
  eigenes Prisma (Ober-/Unterseite über `MF.geom.convexParts` in Dreiecke zerlegt, Seiten je Kante,
  Kreis glatt mit 48 Teilen). **Die schräge Oberseite (Rutsche, `shape.h2`) steckt nur in
  `MF.view3dCore.topZ()`** (ruft `MF.geom.topAt` wie Engine und Draufsicht); `bodyKey()` enthält die
  ganze Form, ändert sich `h2`, wird das Mesh neu gebaut. Einpassen nutzt `MF.geom.maxHeight`.
- **Darstellung der Körperarten:** `ghost` halbtransparent, ohne Schatten, mit Kanten in der Körperfarbe
  (Sensor in Strahlfarbe Orange, belegt Rot; Erzeuger kräftiger; Senke dunkel mit Kreuz); `static` fest
  in der Körperfarbe; `kinematic` fest in Stahlgrau mit Kanten in der Körperfarbe (wie Draufsicht);
  Kisten in ihrer Farbe. Transportflächen: Streifen alle 25 cm wandern mit `rt.travel`, Pfeil am Ende
  in Laufrichtung (orange läuft, grau steht).
- **Neu gebaut wird ein Mesh nur, wenn sich sein Aufbau ändert** (`bodyKey`: Art, Form, Farbe,
  Sichtbarkeit, Laufrichtung, Funktionen). Lage, Achsstellung (interpoliert über `MF.sim.drawPose`),
  Bandstreifen und Sensorfarbe liest jedes Bild. Angebunden an `MF.store.on` wie die Draufsicht.
- **Kisten:** Lage linear, Drehung `slerp`; Meshes aus einem Vorrat, Geometrie je Form und Werkstoff je
  Farbe geteilt und freigegeben, wenn keine Kiste sie mehr nutzt (geprüft: 12 000 Kisten, Speicher konstant).
- **Kamera:** Orbit (drehen, rechts schieben, Rad zoomen), nicht unter den Boden. `view.camera3d =
  { pos: [x, y, z], target: [x, y, z] }` in **Mini-Fabrik-Koordinaten** (nicht gespiegelt), auf mm
  gerundet; gespeichert 0,4 s nach der letzten Bewegung über den Autosave, **kein Undo-Schritt, macht die
  Anlage nicht „ungespeichert“**. Fehlt der Stand oder ist er ungültig, wird eingepasst (alle Ecken des
  Hüllquaders im Bild, Blick vom unteren Rand der Draufsicht schräg von oben).
- **Layout:** Draufsicht und 3D nebeneinander (Teiler verschiebbar, Doppelklick = Hälfte), umschaltbar
  auf nur Draufsicht / nur 3D (Umschalter „2D / 3D / nebeneinander (Symbol)“ in der Titelleiste, immer sichtbar; dazu Ribbon „Ansicht“ und Knöpfe in beiden Ansichtsleisten). Wahl und Teilung
  merkt sich der **Browser** (localStorage `mf.view.mode`, `mf.view.split`), nicht die Anlage.
- **Rendern:** nur wenn die 3D-Ansicht sichtbar ist; läuft die Simulation, jedes Bild; sonst nur bei
  Modelländerung, Auswahl, Kamerabewegung (auch Nachlauf), Einzelschritt/Reset oder geänderten
  Signalen (Sensor, Band). Im Stillstand 0 Bilder je Sekunde.
- **Ohne WebGL oder ohne `lib/three.js`:** Hinweis in der 3D-Fläche, Draufsicht voll nutzbar.
- Auswahl per Klick (ohne Ziehen): Raycast auf sichtbare Körper, Kisten nicht; Klick ins Leere hebt die
  Auswahl auf. Hervorhebung: orangefarbene Kanten (auch durch andere Körper) und leichtes Leuchten.
- Firefox meldet bei `PCFShadowMap` einmal die WebGL-**Warnung** „Depth texture comparison … LINEAR“ –
  kein Fehler, kommt aus Three.js.

**Für Phase 3/4:** Neue Formfelder in `MF.view3dCore.prism()`/`topZ()` und `bodyKey()` nachtragen.
Kinematische Körper erscheinen an `MF.sim.drawPose(b)` – rotatorische Achsen und Kopplung (Phase 4)
müssen dort bzw. in `MF.engine.worldPose()` die Drehung liefern, dann folgt die 3D-Ansicht von selbst.
Phase 4: erledigt über `MF.poseInWorld` (interpoliert alle Achsen der Kette); der Hüllquader nutzt die Weltlage.

**Fertig ist der Umbau, wenn:** die Beispielanlage aus einer alten `.mfab`-Datei lädt, mit der
Regel R1 Kisten über den Schieber in SE2 landen, eine selbst gezeichnete schräge Rutsche Kisten
per Schwerkraft weiterleitet und ein Drehtisch per SCL auf 90° fährt.

**Stand nach Phase 4 (09.10.2026): alle vier erfüllt**, jeweils mit Test:

| Kriterium | Test | Ergebnis |
|---|---|---|
| alte Beispielanlage (Version 1) lädt | `migration.test.js` „Migration 1 → 3 …“ | ✅ |
| R1: Kisten über den Schieber in SE2 | `physik.test.js` „Beispielanlage: mit R1 …“ (eingebaute Beispielanlage mit 1-m/s-Schieber; die alte Datei behält 0,3 m/s und staut bei Überlast, siehe Abschnitt 4) | ✅ |
| gezeichnete schräge Rutsche | `formen.test.js` „Selbst gezeichnete schräge Rutsche …“ | ✅ |
| Drehtisch per SCL auf 90° | `achsen.test.js` „Drehtisch per SCL auf 90° …“ (`DT1.Soll := 90.0; DT1.Freigabe := TRUE;`, 90° ± 0,1°, `InPosition`, nie über `vmax`) | ✅ |

## 6. Später (bewusst nicht im Umbau)

Körper im Raum kippen (Drehung um x/y), Gelenkketten mit mehr als zwei Ebenen bearbeiten,
Import von CAD-Dateien, Anbindung echter Steuerungen.
