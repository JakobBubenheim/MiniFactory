# Mini-Fabrik

Ein Simulator für Fördertechnik und Steuerlogik – direkt im Browser, ohne Installation.
Anlage aus Quelle, Förderband, Lichtschranke, Schieber und Senke bauen, mit Wenn-dann-Regeln
oder SCL steuern und zusehen, ob sie tut, was sie soll. Mehr in `Idee/Pitch.md`.

## Starten

`index.html` doppelklicken. Kein Server, kein Build, keine Installation nötig.
Die Physik (Rapier 3D, `lib/rapier.js`) lädt beim Start kurz („Lade Physik …“).
Ältere Anlagen (`.mfab` aus dem Raster-Editor) werden beim Öffnen automatisch umgerechnet.

## Testen

Voraussetzung: Node 22 oder neuer (ohne weitere Pakete).

```sh
npm test
```

Die Tests laufen ohne Browser: `test/helpers/load.js` lädt Rapier und die Skripte in einen
vm-Kontext, `test/helpers/anlage.js` ist die Fassade, über die alle Verhaltenstests
die Anlage bedienen. Auf GitHub laufen sie bei jedem Push und Pull Request.

## Weiter

Der Umbau auf 3D-Physik ist in `Idee/Konzept-3D.md` geplant; Phase 2 (Physik-Kern) ist umgesetzt.
