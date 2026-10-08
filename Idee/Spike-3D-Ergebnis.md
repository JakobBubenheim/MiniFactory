# Ergebnis Phase 1: 3D-Spike (Rapier 3D + Three.js)

Stand: 08.10.2026, Branch `feat/3d-spike`. Gehört zu [Konzept-3D.md](Konzept-3D.md).

**Kurz:** Rapier 3D und Three.js laufen per Doppelklick (file://) ohne Server. Die Physik ist
schnell genug (200 Kisten: < 1,5 ms pro Schritt, 60 FPS) und **bitgenau deterministisch – auch
zwischen Node, Chromium und Firefox**. Gewählte Transportflächen-Methode: **a) Geschwindigkeit
nachführen**, gewichtet nach Normalkraft. Drei Dinge muss Phase 2 beachten: Kontaktsteifigkeit
60 Hz, 2 mm Absatz zwischen Bändern, und das Konzept-Koordinatensystem ist linkshändig.

## 1. Was gebaut wurde

| Datei | Inhalt |
|---|---|
| `tools/vendor/` | eigene `package.json` (esbuild 0.28.2, three 0.186.1, @dimforge/rapier3d-compat 0.21.0, feste Versionen), `npm run build`, README |
| `lib/rapier.js` | IIFE, setzt `window.RAPIER`, WASM eingebettet, `RAPIER.init()` nötig |
| `lib/three.js` | IIFE, setzt `window.THREE` und `window.THREE_ADDONS = { OrbitControls }` |
| `lib/LICENSES.md` | Versionen und Lizenztexte (MIT, Apache-2.0) |
| `spike-3d.html` | Demo per Doppelklick |
| `spike/scene.js` | Physik-Szene ohne Darstellung (Browser und Node gleich) |
| `spike/spike.js` | Three.js-Darstellung, Anzeige, Tasten; Uhr = `sim/clock.js` unverändert (20 ms, Akkumulator, interpoliert) |
| `spike/measure.js` | alle Messungen (im Browser Taste X, in Node über `node-measure.js`) |
| `spike/node-load.js`, `node-check.js`, `node-measure.js` | Rapier im node:vm-Kontext, Kiste fallen lassen, alle Messungen + Determinismus |

Die App selbst (index.html, sim/, ui/, logic/, main.js) ist unverändert. Im Wurzelverzeichnis
gibt es keine `package.json` (gehört `feature/tests`).

**Demo-Anlage** (Meter, z oben): Band A (5,7 m, 0,5 m/s, +x) → 90°-Ecke → Band B (4,3 m,
1,0 m/s, +y, mit Seitenführungen) → Rutsche 25° → Senke 1. Erzeuger legt jede Sekunde eine
Kiste (0,3 m, 5,4 kg) auf Band A. Sensor quer über Band A (Abfrage `intersectionsWithShape`,
nur dynamische Körper), kinematischer Schieber mit linearer Achse (1 m/s, 0,82 m Hub) stößt
Kisten in Senke 2, Stopper (statischer Block, Collider an/aus).

Tasten: A Schieber, T Stopper, M Methode, B Bänder, E Erzeuger, S schräge Kiste, P +200 Kisten,
Leertaste Pause, R Reset, D Determinismus-Lauf, X alle Messungen. Adresse `#messen` bzw.
`#fps200` startet die Messungen automatisch.

## 2. Läuft per Doppelklick?

| Browser | Ergebnis | geprüft wie |
|---|---|---|
| Chromium 156 | ✅ läuft, 60 FPS, Bedienung (Stopper, Schieber, Methodenwechsel) ohne Fehler | Playwright, file:// |
| Firefox 157 | ✅ läuft, 60 FPS, Bedienung ohne Fehler | Playwright, file:// |
| Safari 17.4 (macOS 14.4) | ⚠️ **von mir nicht geprüft** – Safari-Fernsteuerung ist aus („Entfernte Automation erlauben“) und Bildschirmfotos sind nicht freigegeben. Playwright-WebKit hängt auf macOS 14 schon beim Öffnen einer leeren Seite (Werkzeugproblem, nicht der Seite) | – |

WASM über file:// ist in Chromium und Firefox kein Problem: Das WASM steckt als Base64 im Skript
und wird mit `WebAssembly.instantiate(bytes)` geladen, ohne `fetch`. Für Safari gibt es keinen
technischen Grund, dass es anders ist – geprüft ist es aber nicht. **Bitte einmal von Hand:**
`spike-3d.html` in Safari doppelklicken, Taste X drücken, Ergebnis notieren.

## 3. Messwerte

### Dateigröße und Ladezeit

| Datei | Größe | Laden im Browser (Skript-Tag bis fertig) | `RAPIER.init()` |
|---|---|---|---|
| `lib/rapier.js` | 4,34 MB (davon ~4,1 MB Base64-WASM) | Chromium 60–170 ms, Firefox 115–440 ms | Chromium 35–100 ms, Firefox 190–430 ms |
| `lib/three.js` | 0,76 MB | 10–45 ms | – |

Node (vm-Kontext): Laden 35–45 ms, `init()` 45–100 ms. Startzeit insgesamt also unter einer
halben Sekunde – unkritisch.

### Leistung (ms pro Simulationsschritt, dt = 20 ms, Budget also 20 ms)

200 Kisten fallen gleichzeitig auf den Boden, dazu läuft die Anlage (gesamt ~210 Kisten).
„erste 2 s“ = alle Kisten fallen und stoßen, „letzte 2 s“ = liegen ruhig.

| Umgebung | Methode | schlafen erlaubt: erste 2 s / max / letzte 2 s | nie schlafen: erste 2 s / letzte 2 s |
|---|---|---|---|
| Node 22 (3 Läufe) | a | 0,66–0,77 / ≤ 2,3 / 0,33–0,36 | 0,97–1,10 / 1,07 |
| Node 22 | b | 0,57 / ≤ 1,9 / 0,33 | 0,95 / 1,07 |
| Chromium | a | 0,58 / 1,5 / 0,23 | 0,87 / 0,95 |
| Chromium | b | 0,47 / 1,3 / 0,25 | 0,84 / 0,96 |
| Firefox | a | 0,64 / 2 / 0,25 | 1,18 / 1,19 |
| Firefox | b | 0,65 / 2 / 0,28 | 1,14 / 1,37 |

**FPS mit 200 Kisten** (#fps200, inkl. Schatten): Chromium **60 FPS** (Physik Ø 0,74 ms,
max 3,8 ms), Firefox **60 FPS** (Ø 0,62 ms, max 6 ms; Firefox misst nur auf 1 ms genau).
Hinweis: Der alte Playwright-Headless-Chromium rendert in Software (7 FPS) – das ist ein
Messartefakt, im normalen Chromium sind es 60 FPS.

Fazit: Selbst wenn nichts schläft, braucht Rapier für 200 Kisten ~1 ms von 20 ms. Luft für
deutlich größere Anlagen und auch für kleinere Zeitschritte.

### Determinismus

Szenario 30 s: Erzeuger läuft, Stopper 6–14 s zu, Schieber bei 9, 17 und 24 s, schräge Kiste
bei 4 s. Hash (FNV-1a) über alle Kistenlagen und -drehungen als Float64:

| Methode | Node (3 × 2 Läufe) | Chromium | Firefox |
|---|---|---|---|
| a) velocity | `7c2524b5` | `7c2524b5` | `7c2524b5` |
| b) kinematic | `a0350cfb` | `a0350cfb` | `a0350cfb` |

Zwei Läufe sind **bitgenau gleich** (maximale Abweichung 0), und zwar über Node, Chromium und
Firefox hinweg. Grund: dasselbe WASM rechnet überall gleich, und der JS-Teil nutzt nur
Grundrechenarten (die einzigen `sin`/`cos` stehen beim Aufbau und waren hier unkritisch).

**Folge für die Tests:** Tests dürfen Positionen prüfen – am robustesten über einen Hash oder
mit kleiner Toleranz. Achtung: Jede Änderung an Physik, Reihenfolge der Körper oder Parametern
ändert den Hash. Deshalb Empfehlung: Tests prüfen in erster Linie **Verhalten** (Zähler,
Signale, „Kiste liegt in Senke 2“), Positions-Hashes nur als gezielte Regressionstests, die
man bei bewussten Physik-Änderungen neu einträgt.

### Transportfläche: Kriterien

Gemessen mit `spike/measure.js`, identisch in Node und Browser. Beide Methoden mit
Kontaktsteifigkeit 60 Hz (siehe 4.).

| Kriterium | a) Geschwindigkeit nachführen | b) Laufband-Trick |
|---|---|---|
| Tempo auf geradem Band (Soll 0,5 m/s, ±5 %) | 0,500 m/s, Abweichung 0 % | 0,500 m/s, Abweichung 0,0002 % |
| Zittern / Springen (max. \|v_z\|, Höhenschwankung) | 3·10⁻⁷ m/s, 0 mm | 5·10⁻⁷ m/s, 0,00006 mm |
| Stau am Stopper, 13 Kisten | Überlappung max. 1,2 mm, stehende Kisten bewegen sich < 0,001 mm/Schritt | 1,2 mm, < 0,001 mm/Schritt |
| Stau löst sich (Stopper auf) | ✅ 21 Kisten in 23 s in Senke 1 | ✅ 21 Kisten |
| Schräge Kiste (30°) | bleibt 30,0° (Drift < 10⁻⁹°) | bleibt 30,0° |
| Ecke Band A → B (90°) | sauber: max. 0,9 mm angehoben, dreht 3,8°, danach exakt Tempo von B | sauber: 1,4 mm, dreht 4,4° |
| Band B → Rutsche → Senke 1 | ✅ in 1,7 s gezählt | ✅ in 1,6 s |
| Schieber → Senke 2 | ✅ gezählt | ✅ gezählt |
| JS-Zusatzkosten pro Schritt | ~7 µs je aufliegende Kiste (13 Kisten: 0,1 ms) | ~0,02 ms |

Beide Methoden erfüllen alle Kriterien.

## 4. Probleme, die beim Spike aufgefallen sind

1. **Kisten rutschen im Stau ineinander (5 mm).** Rapier-Standard ist eine weiche
   Kontaktsteifigkeit von 30 Hz. Unter dem Druck von 13 gestauten Kisten (≈ 550 N) ergibt das
   5 mm Überlappung. Mehr Solver-Iterationen, kleineres `allowedLinearError` oder 10 ms helfen
   **nicht**. Lösung: `integrationParameters.contact_natural_frequency = 60` → 1,2 mm, ohne
   Zittern. 120 Hz → 0,7 mm, aber der Stau fängt an zu zittern.
2. **Kante zwischen zwei Bändern gleicher Höhe:** Die Kiste hakt an der Kante des nächsten
   Bands ein und springt bis 3 cm hoch (bekanntes Problem „interne Kanten“ aneinanderstoßender
   Quader). Lösung: das abnehmende Band **2 mm tiefer** legen (wie in echten Anlagen). 1–2 mm
   reichen, 5 mm sind schon wieder unruhiger.
3. **Methode a, erste Fassung:** Bei Mittelung über alle berührten Bänder wurde die Kiste an der
   Ecke schon voll auf Band B gezogen, sobald sie es nur berührte (40° Drehung). Lösung:
   Zielgeschwindigkeit **mit der Normalkraft gewichten** (Kontaktimpuls des letzten Schritts)
   und die Änderung auf **μ·J/m** begrenzen – das ist Coulomb-Reibung. Danach verhält sich a
   wie b.
4. **90°-Ecke mit gleichem Tempo verklemmt nach einem Stau** (bei beiden Methoden): Eine dicht
   gestaute Schlange drückt die erste Kiste gegen die Führung, die Reibung dort ist größer als
   der Zug von Band B → Dauerstau. Im freien Fluss (Lücken zwischen den Kisten) geht es. Das
   ist echte Physik, kein Fehler der Methode. In der Demo läuft Band B deshalb mit 1,0 m/s
   (Beschleunigungsband). Für Nutzer der Mini-Fabrik ein realistischer Effekt – vielleicht
   sogar eine schöne Lernaufgabe.
5. **Koordinatensystem ist linkshändig.** Konzept: x rechts, y in der Draufsicht nach unten,
   z oben. Von oben gesehen ist das linkshändig; Three.js ist rechtshändig, die 3D-Ansicht wäre
   also spiegelverkehrt zur Draufsicht. Für die Physik ist das egal (gespiegelte Welt, gleiche
   Physik; positive Drehung um z erscheint in der Draufsicht im Uhrzeigersinn – wie beim
   Canvas). Lösung in der 3D-Ansicht: alles in eine Gruppe mit `scale.y = -1` hängen, Three.js
   kehrt die Flächenreihenfolge selbst um, Licht und Schatten stimmen (in der Demo so gebaut).
6. **Rapier im node:vm-Kontext** braucht die Globals `TextDecoder` und `performance` (sonst
   `ReferenceError` beim Laden bzw. `RuntimeError: unreachable` in `world.step()`). Die
   Test-Hilfe von `feature/tests` (`test/helpers/load.js`) muss beide in den Kontext legen.
7. Three r186 kennt `PCFSoftShadowMap` nicht mehr → `PCFShadowMap`.
8. Firefox misst `performance.now()` nur auf 1 ms genau – Physik-ms dort als Mittelwert lesen.

## 5. Gewählte Transportflächen-Methode: a) Geschwindigkeit nachführen

Beide Methoden erfüllen alle Kriterien gleich gut. Entschieden haben die Folgen für Phase 2–4:

- **Funktioniert auf jeder Körperart ohne Umbau.** Das Konzept erlaubt Transportflächen auf
  `static` *und* `kinematic` Körpern (z. B. Drehtisch oder Hubtisch mit Band). Bei b müsste ein
  statisches Band intern kinematisch werden, und bei einem Körper mit Achse müsste man
  Achsbewegung und Bandgeschwindigkeit verrechnen und die Lage jedes Mal zurücksetzen – fehleranfällig.
- **Nur die Oberseite wirkt.** a filtert über die Kontaktnormale; bei b zieht der ganze Körper,
  auch an Seitenflächen.
- **Richtung frei pro Fläche** (`dir` in Grad, lokal) – einfach mitdrehen, wenn der Körper sich dreht.
- Kein Teleportieren von Körpern in jedem Schritt.
- Kosten: ~7 µs je aufliegende Kiste – bei 200 Kisten auf Bändern ~1,5 ms, gut im Budget.

Nachteile von a, die Phase 2 kennen muss: Es nutzt den Kontaktimpuls des **vorigen** Schritts
(ein Schritt Verzögerung, unsichtbar); die Bandoberfläche selbst hat in Rapier Reibung 0
(Kombination `Min`), die Haftung kommt allein aus der Nachführung; für geneigte Bänder muss die
Zielgeschwindigkeit entlang der geneigten Fläche (3D-Tangente) berechnet werden, im Spike sind
alle Bänder waagerecht.

**Formel (pro Schritt, vor `world.step()`):**

```
für jede dynamische Kiste mit Auflagekontakt (|n_z| > 0,7) auf Transportflächen:
  J      = Summe der Kontaktimpulse je Fläche
  v_ziel = Σ (v_band · J) / Σ J              (gewichtet nach Normalkraft)
  Δv     = k · (v_ziel − v)  in der Flächenebene, k = 1
  |Δv|  ≤ μ · ΣJ / m                          (Coulomb-Grenze, μ = 0,8)
  ω_z   → 0 mit derselben Grenze / (Kante/4)  (Reibung bremst Drehen um die Hochachse)
```

Die Umsetzung steht in `spike/scene.js` (`applySurfaceVelocity`).

## 6. Empfehlungen für Phase 2 (`feature/physik-kern`)

1. Zeitschritt **20 ms** beibehalten (Standard im Konzept), Rapier-Solver-Iterationen 4 (Standard).
2. `contact_natural_frequency = 60`; `normalizedAllowedLinearError` bleibt Standard (0,005).
3. Reibungswerte als Startwerte: Band 0,8 (nur für die Nachführung), Kiste 0,6, Boden 0,6,
   Stahl/Führungen 0,3, Rutsche 0,1 (Kombination `Min`); Dichte Kiste 200 kg/m³.
4. Migration: Förderbänder, die aneinanderstoßen, beim Umrechnen um 2 mm absenken – oder
   allgemein: Transportflächen 1–2 mm unterschiedlich hoch, nie exakt bündig.
5. Sensoren über `world.intersectionsWithShape(…, EXCLUDE_FIXED | EXCLUDE_KINEMATIC)` statt
   Sensor-Collidern – einfach, deterministisch, passt zu „Sensoren lesen“ am Anfang des Zyklus.
6. Kinematische Achsen: `kinematicPositionBased` + `setNextKinematicTranslation` – funktioniert.
7. Senke: Mittelpunkt in der Form → `removeRigidBody` und zählen; Kisten unter z = −2 entfernen.
8. Tests: `spike/node-load.js` zeigt, was der vm-Kontext braucht. Physik-Tests auf Verhalten,
   Positions-Hashes nur gezielt (siehe Determinismus).
9. 3D-Ansicht (Phase 5): Spiegelgruppe `scale.y = -1`, `camera.up = (0, 0, 1)`; Kisten zwischen
   zwei Schritten interpolieren (Lage linear, Drehung per `slerp`) – in der Demo flüssig.
10. Erzeuger: nur auflegen, wenn der Platz frei ist (Schnittabfrage), sonst überlappen Kisten
    beim Stau am Erzeuger und springen auseinander.

## 7. Wie man nachmisst

```sh
node spike/node-check.js            # Rapier im vm-Kontext, Kiste fällt
node spike/node-measure.js          # alle Messungen + Determinismus (Ausgabe kompakt)
node spike/node-measure.js --json   # dasselbe als JSON
```

Im Browser: `spike-3d.html` öffnen, Taste X (alle Messungen) oder D (Determinismus).
