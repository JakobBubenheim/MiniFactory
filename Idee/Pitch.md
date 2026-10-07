# Mini-Fabrik – Projekt-Pitch

Ein 2D-Simulator für Fördertechnik und Steuerlogik – direkt im Browser, ohne Installation.

Pitchdeck (Folien): https://claude.ai/artifact/BmSQyNq7wBjPsVjTZYjdJf

---

## 1. Ausgangslage

Virtuelle Inbetriebnahme ist stark – aber schwer zugänglich.

| Heute | Die Idee |
|---|---|
| Profi-Software mit Installation und Lizenz | Browser öffnen und sofort loslegen |
| Lange Einarbeitung, bevor etwas läuft | Reduziert auf das Wesentliche: Material, Sensoren, Logik |
| Gebaut für echte Anlagen, nicht zum Ausprobieren | Zum Lernen, Testen und Zeigen |

## 2. Konzept: Bauen, steuern, simulieren

1. **Bauen** – Elemente aus der Bibliothek auf die Fläche ziehen und zu einer Anlage verbinden.
2. **Steuern** – Regeln festlegen: Wenn die Lichtschranke belegt ist, fährt der Schieber aus.
3. **Simulieren** – Start drücken und zusehen, ob die Anlage tut, was sie soll.

## 3. Oberfläche: drei Bereiche

```
┌──────────────────────────────────────────────────────────┐
│ ▶ Start · Pause · Reset                   Werkzeugleiste │
├─────────────┬──────────────────────────┬─────────────────┤
│ Bibliothek  │                          │ Eigenschaften   │
│  Quelle     │                          │  Tempo: 0,5 m/s │
│  Förderband │   2D-Simulationsfläche   │  Takt: 2 s      │
│  Lichtschr. │   Canvas · Raster ·      │                 │
│  Schieber   │   Drag & Drop            │ Logik           │
│  Senke      │                          │  WENN LS1 belegt│
│             │                          │  DANN S1 aus    │
├─────────────┴──────────────────────────┴─────────────────┤
│ Zeit 00:42 · Kisten 17 · LS1 frei            Statusleiste│
└──────────────────────────────────────────────────────────┘
```

Design: eckig und schlicht, keine abgerundeten Ecken. Farben: Dunkelblau `#1B2430`, Hell `#F4F2EC`, Akzent Industrie-Orange `#D9701A`.

## 4. Elemente im Prototyp

| Element | Aufgabe | Signal |
|---|---|---|
| Quelle | erzeugt Kisten in einem festen Takt | keins |
| Förderband | bewegt Kisten mit einstellbarem Tempo | Ein / Aus |
| Lichtschranke | erkennt Kisten an einer Position | belegt / frei |
| Schieber | stößt Kisten seitlich vom Band | ausfahren / einfahren |
| Senke | nimmt Kisten auf und zählt sie | Zählerstand |

## 5. Technik: bewusst einfach, komplett lokal

- **HTML & CSS** – Oberfläche, Seitenleisten und Werkzeugleiste
- **JavaScript** – Simulation, Steuerlogik und Bedienung
- **Canvas 2D** – zeichnet die Anlage rund 60-mal pro Sekunde
- **Git, kein Server** – läuft per Doppelklick; Branches für jede Etappe

Später möglich: Matter.js für echte 2D-Physik, Three.js für eine 3D-Ansicht.

## 6. Arbeitsteilung: ein Lead-Agent, drei Spezialisten

| Agent | Ordner | Aufgabe | Modell |
|---|---|---|---|
| Lead-Agent | – | plant, verteilt Aufgaben, prüft Ergebnisse | Opus |
| UI-Agent | `ui/` | Seitenleisten, Werkzeugleiste, Statusleiste | Sonnet |
| Sim-Agent | `sim/` | Simulationsschleife, Elemente, Zeichnen | Sonnet |
| Logik-Agent | `logic/` | Signale und Wenn-dann-Regeln | Sonnet |
| Prüf-Agent | liest alles | testet und meldet Fehler, ändert nichts | Haiku |

## 7. Roadmap: in vier Etappen zum Prototyp

1. **Grundgerüst** – Seite mit drei Bereichen und leerer Fläche mit Raster
2. **Bewegung** – Förderband und Kisten; Start, Pause, Reset
3. **Sensoren & Aktoren** – Lichtschranke, Schieber und Zähler
4. **Logik** – Regeln in der rechten Leiste; Anlage als Datei speichern

Jede Etappe bekommt einen eigenen Git-Branch und endet mit etwas, das man sehen und ausprobieren kann.

## 8. Umfang

**Dabei**
- Startet lokal per Doppelklick
- Fünf Elemente aus der Bibliothek
- Einfache Wenn-dann-Regeln
- Anlage als Datei speichern und laden

**Bewusst nicht dabei**
- 3D-Ansicht und echte Physik (später)
- Anbindung an echte Steuerungen
- Code, Wissen oder Designs des Arbeitgebers

## 9. Nächster Schritt

**Etappe 1 starten:** Projektordner anlegen, Git-Repository einrichten und das Grundgerüst mit drei Bereichen bauen.
