# Mini-Fabrik – Anleitung für Agents

Die Mini-Fabrik ist eine Lern-Simulation einer Förderanlage mit echter 3D-Physik (Rapier). Du baust eine Anlage
aus **Körpern**, steuerst sie mit **Wenn-dann-Regeln** oder **SCL** und prüfst sie mit `simulate`.
Gespeichert wird eine `.mfab`-Datei, die der Nutzer in der App über **Datei → Öffnen** lädt.

## 1. Koordinaten und Einheiten

Meter, Grad, Sekunden. Draufsicht wie in der App: **x nach rechts, y nach unten**, z nach oben, Boden bei z = 0.

```
        y = 0 ───────────────► x
        │      0° = rechts
        │  270° = oben    90° = unten     Drehung rot: im Uhrzeigersinn (Draufsicht)
        │      180° = links
        ▼ y
```

- `pose = {x, y, z, rot}`: x/y = **Mitte des Grundrisses** (bei Polygonen der Ursprung der Punkte), z = **Unterseite**.
- Rechteck: `w` entlang der lokalen x-Achse, `d` entlang lokal y. Ein Band mit `rot: 90` läuft nach unten.
- Jeder Winkel geht, nicht nur 0/90/180/270: `rot: 30` legt ein Band schräg (läuft nach rechts unten).
- `top` (in `get_overview`) = Oberkante = z + Höhe. `bounds` = Hüllrechteck in der Draufsicht.

## 2. Körper, Körperarten, Funktionen

| Körperart | Verhalten | Beispiele |
|---|---|---|
| `ghost` | keine Kollision, nur Fläche/Raum | Lichtschranke, Quelle, Senke |
| `static` | fest, Kisten stoßen dagegen | Band, Wand, Tisch, Rutsche |
| `kinematic` | bewegt sich nur über eine Achse | Schieber, Drehtisch, Hubtisch, Stopper, Weiche |
| `dynamic` | fällt und rutscht (Physik) | lose Teile |

Funktionen (optional, `set_function`): `surface` Transportfläche (static/kinematic: `speed` m/s, `dir` Grad lokal),
`axis` Achse (kinematic), `sensor` (ghost: `invert`, `debounce` ms), `spawner` Erzeuger (ghost: `interval` s,
`maxCount`, `enabled`), `sink` Senke (ghost: entfernt Kisten, deren **Mittelpunkt** im Raum der Senke liegt, und zählt sie).

## 3. Vorlagen (Standardwerte, Details mit `list_templates`)

| Vorlage | ID | Form | z / top | Signale |
|---|---|---|---|---|
| `conveyor` Förderband | B1 … | 2 × 0,5 m, h 0,1 | 0,6 / **0,7** | `Ein` (EIN, Start 1), `Tempo` (EIN, m/s), `Läuft` (AUS) |
| `source` Quelle | Q1 … | 0,5 × 0,5 m | 0,72 (2 cm über Band) | `Freigabe` (EIN, Start 1), `Erzeugt` (AUS, Zähler) |
| `sensor` Lichtschranke | LS1 … | 0,05 × 0,5 m, h 0,3 | 0,71 | `Belegt` (AUS) |
| `pusher` Schieber | S1 … | 0,5 × 0,5 m, schiebt lokal +y | 0,72 | `Ausfahren` (EIN), `Ausgefahren`, `Eingefahren`, `Ist` (AUS) |
| `sink` Senke | SE1 … | 0,5 × 0,5 m, h 0,6 | 0 / 0,6 | `Reset` (EIN), `Anzahl` (AUS) |
| `turntable` Drehtisch | DT1 … | Kreis r 0,4 m mit Band, Rand gerundet | top 0,7 | Band-Signale + `Ausfahren` (EIN): 1 dreht auf 90°, 0 zurück auf 0° |
| `lift` Hubtisch | HT1 … | 0,6 × 0,5 m mit Band | top 0,7 | Band-Signale + `Ausfahren`: 1 hebt um 0,3 m |
| `stopper` Stopper | ST1 … | Leiste 0,05 × 0,4 m quer im Band | eingefahren 2 cm unter dem Band | `Ausfahren`: 1 hält Kisten an |
| `diverter` Weiche | W1 … | Arm 0,8 × 0,05 m, dreht ums linke Ende | 2 cm über dem Band | `Ausfahren`: 1 schwenkt 45° über das Band |

Eigenschaften setzt du mit `props`, z. B. Band `{"speed": 0.5, "direction": 90}`, Quelle `{"interval": 2}`,
Schieber `{"stroke": 600, "speed": 1, "direction": 90}` (Hub in **mm**). `direction` ist die Lauf- bzw. Schubrichtung
in **Grad** (0 = rechts, 90 = unten, 180 = links, 270 = oben, auch schräg wie 37.5) und dreht den ganzen Körper.
Die Namen `"rechts"`, `"unten"`, `"links"`, `"oben"` gelten weiter; gelesen (`get_overview`) wird immer die Zahl.
Kisten: 0,3 m Würfel, 5,4 kg. Weitere Vorlagen und alle Standardwerte stehen in `list_templates`.

**Achsen** (`set_function` mit `function: "axis"`): Alle Vorlagen mit Achse starten in Betriebsart `zweipunkt`
(Ausgänge `Ausgefahren`, `Eingefahren`, `Ist`). Ventil `valve`:
- `"mono"` (Standard): ein Eingang `Ausfahren`; 1 = ausfahren, 0 = nach `returnDelay` (Schieber 0,5 s, sonst 0) einfahren.
- `"bi"`: zwei Eingänge `Ausfahren` und `Einfahren`; ein kurzer Impuls reicht, die Achse **bleibt** dann, bis der Gegenbefehl kommt
  (beide 0 oder beide 1: keine Änderung). Gut für SCL mit Flanken, z. B. `"S1".Einfahren := "LS2".Belegt;`.

Für einen beliebigen Winkel bzw. Weg `mode: "position"` (Eingänge `Soll` in m bzw. Grad und `Freigabe`, Ausgang `InPosition`);
Grenzen `min`/`max` gelten immer, z. B. Drehtisch `{"mode": "position", "min": -180, "max": 180}`, dann
`"DT1".Soll := 180.0; "DT1".Freigabe := TRUE;`. `mode: "geschwindigkeit"`: `Soll` in m/s bzw. °/s.

## 4. Bauregeln (wichtig)

1. **Band**: Oberkante 0,7 m. Länge über `shape: {"w": 4}`. Laufrichtung über `rot` oder `props.direction` (Grad, auch schräg).
2. **Quelle** über den **Anfang** des Bands legen, ganz auf dem Band (z bleibt 0,72 = 2 cm über der Oberkante).
3. **Senke** direkt **hinter das Bandende** (Kante an Kante), Höhe 0–0,6 m: die Kiste fällt hinein. Am Fuß einer Rutsche genauso.
4. **Bänder hintereinander bündig**: alle Bänder und Tische mit Oberkante 0,7 m (`z: 0.6`), Stirnkante an Stirnkante. Die Bandenden sind in der Physik gerundet wie eine Umlenkrolle (r 5 cm), Kisten laufen darüber. Ein Folgeband **höher** als das liefernde hakt – `validate` meldet das.
5. **Ecke (90°)**: das zuliefernde Band endet in der **Mitte** des abnehmenden, beide bündig.
   Endet es erst am Rand, fallen die Kisten herunter. Rutschen Kisten mit Schwung über die Außenkante: eine glatte
   **Führungswand** außen neben das abnehmende Band (`draw_shape`, static, 0,1 m breit, 1 m hoch, Reibung 0,05) und das
   zuliefernde Band etwas kürzer (endet ~10 cm vor der Wand). Eine Wand **quer** am Bandende stoppt Kisten (Stau).
6. **Lichtschranke quer** über das Band (gleiches `rot` wie das Band: in x-Richtung `rot: 0`, in y-Richtung `rot: 90`, schräg z. B. `rot: 30`), mitten auf der Bandachse.
7. **Schieber** neben das Band: seine Vorderkante (lokal y = +0,25) liegt an der Bandkante, Schubrichtung quer zum Band.
   Hub ≈ Bandbreite + 0,1 m (`stroke: 600` bei 0,5 m), Tempo **1 m/s** (bei 0,3 m/s staut es sich, wenn alle 2 s eine Kiste kommt).
   Gegenüber eine Senke. Der Fangwinkel des Schiebers sitzt auf lokal +x: Schiebt er nach `unten`, muss das Band nach `rechts`
   laufen (allgemein: Bandrichtung = Schubrichtung − 90°, gleiches `rot` wie das Band). Für die andere Seite die ganze Anordnung drehen.
   Schräge Anordnungen: alle Lagen um denselben Punkt drehen und überall denselben Winkel zu `rot` addieren – sie laufen wie gerade.
8. **Rutsche**: `draw_shape` Rechteck, `kind: "static"`, `h` am Anfang (z. B. 0,68 = 2 cm unter dem Band), `h2` am Ende
   (z. B. 0,1), Reibung 0,1 (`material: {"friction": 0.1}`). Bergab zeigt lokal +x, wenn `h2 < h`. Keine Transportfläche darauf.
9. Abstände: Kisten brauchen Platz; Quelle `interval` ≥ 1,5 s bei 0,5 m/s.

## 5. Logik

**Wenn-dann-Regel** (`add_rule`): `then := (when ≠ 0)` in jedem Zyklus, sonst 0. `when` ein beliebiges Signal, `then` ein
Eingang. Beispiel: `when "LS1.Belegt"`, `then "S1.Ausfahren"`. Mehrere Regeln auf dasselbe Ziel: ODER.

**SCL** (`add_scl`), läuft jeden Zyklus nach den Regeln:

```
VAR
  t1 : TON;
  zaehler : CTU;
END_VAR
t1(IN := "LS1".Belegt, PT := T#500ms);
"B1".Ein := NOT t1.Q;
zaehler(CU := "LS1".Belegt, R := FALSE, PV := 3);
IF zaehler.Q THEN "S1".Ausfahren := TRUE; ELSE "S1".Ausfahren := FALSE; END_IF;
```

Typen BOOL, INT, DINT, REAL, TIME; Bausteine TON, TOF, TP, R_TRIG, F_TRIG, CTU, CTD, SR (Eingänge S1, R), RS (S, R1); Funktionen ABS, SQRT,
ROUND, TRUNC, MIN, MAX, LIMIT, SEL; IF/ELSIF/ELSE, CASE, AND/OR/XOR/NOT, `:=`. Ein Ausgang, den keine Regel mehr schreibt,
fällt auf seinen Startwert zurück. Ein SCL-Fehler kommt mit Zeile und Spalte zurück – korrigieren und erneut senden.

## 6. Prüfen

- `render_topview`: Bild mit IDs, Laufrichtungen (oranger Pfeil), Gefälle, Raster in Metern. Mit der Skizze vergleichen.
- `validate`: Dateifehler und Hinweise zu den Bauregeln (was hinter jedem Bandende liegt, Quelle über einer Fläche …).
- `simulate {"seconds": 30}`: Kisten erzeugt/aufgenommen je Senke, **auf dem Boden** (heruntergefallen), **Stau**,
  Flanken je Signal (z. B. wie oft LS1 belegt war), SCL-Laufzeitfehler. Mit `trace` siehst du Signalwechsel mit Zeit,
  mit `set_signals` testest du Eingänge (z. B. `{"B1.Ein": 0}`).
- Erwartung grob: bei `interval` 2 s kommen in 30 s etwa 12–13 Kisten an (die ersten brauchen Laufzeit).

## 7. Empfohlener Ablauf

1. Beschreibung/Skizze verstehen, Maße schätzen (Band 0,5 m breit, Kiste 0,3 m), Plan mit Koordinaten machen.
2. `new_plant` → Körper mit `add_from_template` / `draw_shape` → Regeln/SCL.
3. `render_topview` und `get_overview`: stimmt die Lage? Laufrichtungen?
4. `validate`, dann `simulate` (30–60 s). Fallen Kisten herunter oder staut es sich: nachbessern (`update_body`) und erneut simulieren.
5. `save_plant` und dem Nutzer sagen, welche Datei er öffnen soll (Pfad steht in der Antwort).

Beispiele zum Abschauen: Ressourcen `mini-fabrik://beispiele/strecke`, `…/ausschleusen`, `…/rutsche`
(laden mit `load_plant {"example": "strecke"}`).
