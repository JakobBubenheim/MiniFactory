# Mini-Fabrik

Lern-Simulation einer kleinen Förderanlage im Browser: Anlage zeichnen, mit
Wenn-dann-Regeln oder SCL (Structured Text) steuern, zuschauen. Idee: `Idee/Pitch.md`.

**Geplant ist der Umbau auf 3D-Physik – vor jeder Arbeit `Idee/Konzept-3D.md` lesen**
und sich an die Entscheidungen und Phasen dort halten.

## Code-Stil

- Reines HTML/CSS/JS, keine Build-Schritte; startet per Doppelklick auf `index.html` (file://)
- ES5, klassische `<script>`-Tags (keine ES-Module), alles im Namensraum `MF`
- Kommentare, Texte in der Oberfläche, Testnamen und Commit-Messages auf Deutsch
- Keine Laufzeit-Abhängigkeiten; Node nur für Tests (und später zum Bündeln von `lib/vendor.js`)

## Ordner

| Ordner | Inhalt |
|---|---|
| `sim/` | Modell mit Körpern, Funktionen und Vorlagen (`model.js`), Geometrie (`geom.js`), Uhr (`clock.js`), Engine auf Rapier (`engine.js`), Draufsicht (`sim.js`), Datei/Autosave (`file.js`), Migration 2 → 3 (`migrate.js`) |
| `lib/` | gebündelte Bibliotheken: `rapier.js` (Physik), `three.js` (3D-Ansicht, ab Phase 5); Bau in `tools/vendor/` |
| `logic/` | Wenn-dann-Regeln (`logic.js`), SCL-Interpreter (`scl.js`), Lexikon |
| `ui/` | Oberfläche: Ribbon, Baum, Eigenschaften, Editor, Signalliste, SCL-Editor, Verlauf (Undo/Redo) |
| `test/` | Headless-Tests mit `node:test`; `helpers/load.js` lädt die Skripte in einen vm-Kontext |
| `Idee/` | Pitch und Konzepte |

## Tests

- **Vor jedem Commit `npm test`** – alle Tests müssen grün sein (läuft in unter 10 s, auch in der CI).
- Verhaltenstests laufen nur über die Fassade `test/helpers/anlage.js`, nie direkt über
  Interna der Engine. Beim 3D-Umbau wird nur die Fassade angepasst, die Tests bleiben.
- Neue Funktion oder behobener Fehler → Test dazu. Ein Test prüft den richtigen Soll-Zustand,
  nicht das, was der Code gerade tut.
- Braucht ein Test eine Änderung an der App (z. B. DOM-Zugriff absichern), dann minimal und
  ohne Verhaltensänderung im Browser.

## Prüf-Agent

`.claude/agents/pruef-agent.md` prüft einen Branch (nur lesend) gegen seine „Fertig, wenn“-Kriterien
und gegen `Idee/Konzept-3D.md`.
