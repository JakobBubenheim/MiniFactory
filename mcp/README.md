# Mini-Fabrik mit Claude verbinden (MCP)

Mit diesem Server baut Claude Anlagen für die Mini-Fabrik: Du beschreibst eine Anlage (oder gibst eine Skizze),
Claude baut sie, simuliert sie, schaut sich ein Bild davon an, bessert nach und speichert eine `.mfab`-Datei.
Die Datei öffnest du in der Mini-Fabrik über **Datei → Öffnen**.

Der Server rechnet ohne Browser. Er liest und schreibt Dateien nur im **Anlagen-Ordner**
(Standard: `Mini-Fabrik` in deinem Benutzerordner, also `~/Mini-Fabrik`). Andere Ordner sind gesperrt.

## Voraussetzungen

- **Claude Desktop:** nichts weiter, Node.js ist in Claude Desktop eingebaut.
- **Claude Code:** Node.js ab Version 18 (`node --version`). Für die Tests des Projekts braucht man Node 22.
- Diesen Projektordner (Mini-Fabrik) auf deinem Rechner.

## Claude Desktop

1. Im Projektordner das Paket bauen:
   ```
   npm run mcp:pack
   ```
   Es entsteht `dist/mini-fabrik.mcpb`.
2. Die Datei doppelklicken (oder in Claude Desktop unter **Einstellungen → Erweiterungen** hineinziehen) und auf
   **Installieren** klicken. Der Hinweis „nicht signiert“ ist normal, das Paket hast du selbst gebaut.
3. Optional in den Einstellungen der Erweiterung einen anderen **Anlagen-Ordner** wählen.

## Claude Code

Im Projektordner einmal ausführen:

```
claude mcp add mini-fabrik -- node "$PWD/mcp/server.js"
```

Das gilt dann für diesen Ordner. Für alle Ordner: `-s user` ergänzen. Einen anderen Anlagen-Ordner setzt du so:

```
claude mcp add mini-fabrik -e MINI_FABRIK_DIR="$HOME/Dokumente/Anlagen" -- node "$PWD/mcp/server.js"
```

Prüfen: `claude mcp get mini-fabrik` sollte **Connected** zeigen. Entfernen: `claude mcp remove mini-fabrik`.

## Erster Test

Schreib Claude:

> Bau mir eine Strecke mit Quelle, 4-m-Band und Senke und speichere sie als strecke.mfab.

Claude liest die Anleitung, baut die Anlage, zeigt dir das Bild und meldet z. B. „16 Kisten erzeugt, 12 in der
Senke“. Danach liegt `strecke.mfab` im Anlagen-Ordner. Öffne sie in der Mini-Fabrik und drück **Start**.

Für größere Anlagen gibt es den Prompt **anlage_bauen** (in Claude Desktop über das **+**-Menü, in Claude Code
als `/mcp__mini-fabrik__anlage_bauen`). Eine Skizze kannst du einfach mitschicken, Claude liest sie selbst.

## Was der Server kann

- **Bauen:** Körper aus Vorlagen (Band, Quelle, Senke, Lichtschranke, Schieber …), frei gezeichnete Formen (auch Rutschen),
  Ordner, Wenn-dann-Regeln und SCL.
- **Prüfen:** `validate` (Datei und Bauregeln), `simulate` (Kisten je Senke, heruntergefallene Kisten, Stau, Signale),
  `render_topview` (Bild der Draufsicht).
- **Dateien:** `save_plant`, `load_plant`, `list_plants`, dazu drei Beispielanlagen.

Die Liste aller Werkzeuge steht in `Idee/Konzept-MCP.md`.

## Wenn etwas nicht klappt

| Problem | Lösung |
|---|---|
| Claude Code: `node: command not found` | Node.js installieren (nodejs.org) oder den vollen Pfad nehmen: `which node` zeigt ihn, dann `claude mcp add mini-fabrik -- /voller/pfad/node "$PWD/mcp/server.js"` |
| Status **Failed** oder Server startet nicht | Von Hand starten: `node mcp/server.js`. Erwartet ist die Zeile `[mini-fabrik] bereit nach … ms`, danach wartet er (mit Strg+C beenden). Steht dort ein Fehler, fehlt meist eine Datei (z. B. `lib/rapier.js`) |
| Claude Code: Logs ansehen | `claude --debug` starten, oder `claude mcp get mini-fabrik` für den Status |
| Claude Desktop: Logs ansehen | macOS: Ordner `~/Library/Logs/Claude/`, Windows: `%APPDATA%\Claude\logs\` – die Datei `mcp-server-…` mit dem Namen der Erweiterung |
| „liegt außerhalb des Anlagen-Ordners“ | Dateinamen relativ angeben (`strecke.mfab`, `projekte/strecke.mfab`) oder den Anlagen-Ordner ändern |
| Die Datei ist nach dem Ändern veraltet | Der Server hält die Anlage im Speicher. Erst `save_plant` schreibt die Datei; danach in der App neu öffnen |

Alle Logs gehen nach stderr. stdout gehört allein dem Protokoll.
