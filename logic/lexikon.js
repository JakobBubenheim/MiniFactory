// SCL-Lexikon: alles, was der Interpreter in logic/scl.js versteht.
// Jeder Eintrag: name, cat (Kategorie), syntax, text (Erklärung), example,
// insert (Vorlage zum Einfügen; | markiert die Cursor-Position).
window.MF = window.MF || {};

MF.lexikon = [
  // ---------- Grundlagen ----------
  { name: 'Zuweisung :=', cat: 'Grundlagen', syntax: 'Ziel := Ausdruck;',
    text: 'Schreibt einen Wert in eine Variable oder einen Eingang der Anlage. Jede Anweisung endet mit ";". ' +
      'Achtung: = vergleicht nur, := weist zu. Ausgänge (AUS) der Anlage kann man nur lesen.',
    example: '"S1".Ausfahren := "LS1".Belegt;', insert: '| := ;' },
  { name: 'Signal der Anlage', cat: 'Grundlagen', syntax: '"Element".Signal',
    text: 'Liest oder schreibt ein Signal. Am einfachsten zieht man das Signal aus der Variablenliste links in den Code. ' +
      'Eingänge (EIN) sind les- und schreibbar, Ausgänge (AUS) nur lesbar. Die Anführungszeichen sind wie in TIA, ' +
      'LS1.Belegt ohne Anführungszeichen geht auch.',
    example: 'IF "LS1".Belegt THEN\n  "B1".Ein := FALSE;\nEND_IF;', insert: '"|".' },
  { name: 'Kommentar', cat: 'Grundlagen', syntax: '// bis Zeilenende\n(* über mehrere Zeilen *)',
    text: 'Kommentare werden nicht ausgeführt. Gut, um zu beschreiben, was ein Abschnitt tut.',
    example: '// Schieber ausfahren, sobald eine Kiste da ist', insert: '// |' },
  { name: 'Zyklus', cat: 'Grundlagen', syntax: '',
    text: 'Wie in einer SPS läuft der Code in jedem Zeitschritt (Takt, z. B. 50 ms) einmal von oben nach unten. ' +
      'Reihenfolge pro Zyklus: Sensoren lesen → einfache Regeln → SCL-Bausteine → Aktoren und Bewegung. ' +
      'Die SCL-Bausteine laufen in der Reihenfolge, in der sie im Strukturbaum unter "Logik" von oben nach unten stehen, ' +
      'Ordner werden dabei der Reihe nach ganz durchlaufen (innerhalb einer Ebene erst die Ordner mit ihrem Inhalt, ' +
      'dann die Bausteine). Umsortieren im Baum (Ziehen) ändert also die Ausführungsreihenfolge; ' +
      'das Eigenschaften-Panel von "Logik" und jedes Bausteins zeigt die Nummer. Ein geschriebener Eingang behält seinen Wert, bis er wieder geschrieben wird. ' +
      'Wird der Baustein abgeschaltet oder gelöscht, fallen seine Ziele auf den Startwert zurück.',
    example: '', insert: '' },

  // ---------- Variablen ----------
  { name: 'VAR … END_VAR', cat: 'Variablen', syntax: 'VAR\n  Name : Typ;\n  Name : Typ := Startwert;\nEND_VAR',
    text: 'Deklariert eigene Variablen und Bausteine (Timer, Zähler …) am Anfang des Codes. ' +
      'Sie behalten ihren Wert von Zyklus zu Zyklus (statisch) und werden bei Reset auf den Startwert gesetzt.',
    example: 'VAR\n  zaehler : INT := 0;\n  verzoegerung : TON;\nEND_VAR', insert: 'VAR\n  |\nEND_VAR\n' },
  { name: 'BOOL', cat: 'Variablen', syntax: 'Name : BOOL;',
    text: 'Wahrheitswert: TRUE (1) oder FALSE (0). Jede Zahl ungleich 0 zählt in Bedingungen als TRUE.',
    example: 'merker : BOOL := FALSE;', insert: '| : BOOL;' },
  { name: 'INT / DINT', cat: 'Variablen', syntax: 'Name : INT;',
    text: 'Ganze Zahl. Beim Zuweisen werden Nachkommastellen abgeschnitten.',
    example: 'anzahl : INT := 0;', insert: '| : INT;' },
  { name: 'REAL', cat: 'Variablen', syntax: 'Name : REAL;',
    text: 'Kommazahl, z. B. für Geschwindigkeiten. Im Code mit Punkt schreiben: 0.5',
    example: 'tempo : REAL := 0.5;', insert: '| : REAL;' },
  { name: 'TIME', cat: 'Variablen', syntax: 'Name : TIME := T#2s;',
    text: 'Zeitdauer, intern in Millisekunden. Zeitkonstanten: T#500ms, T#2s, T#1m30s, T#1h.',
    example: 'wartezeit : TIME := T#1s500ms;', insert: '| : TIME := T#1s;' },
  { name: 'TRUE / FALSE', cat: 'Variablen', syntax: 'TRUE, FALSE',
    text: 'Die beiden Wahrheitswerte, entsprechen 1 und 0.', example: '"B1".Ein := TRUE;', insert: 'TRUE' },

  // ---------- Anweisungen ----------
  { name: 'IF … THEN … END_IF', cat: 'Anweisungen', syntax: 'IF Bedingung THEN\n  …\nELSIF Bedingung THEN\n  …\nELSE\n  …\nEND_IF;',
    text: 'Führt Anweisungen nur aus, wenn die Bedingung erfüllt ist. ELSIF und ELSE sind optional. ' +
      'Wichtig: Ohne ELSE bleibt ein Eingang auf seinem letzten Wert stehen.',
    example: 'IF "LS1".Belegt THEN\n  "S1".Ausfahren := TRUE;\nELSE\n  "S1".Ausfahren := FALSE;\nEND_IF;',
    insert: 'IF | THEN\n  \nELSE\n  \nEND_IF;\n' },
  { name: 'CASE … OF', cat: 'Anweisungen', syntax: 'CASE Wert OF\n  1: …\n  2, 3: …\n  4..9: …\nELSE\n  …\nEND_CASE;',
    text: 'Wählt je nach (ganzzahligem) Wert einen Zweig – ideal für Schrittketten. ' +
      'Marken: einzelne Zahl, Liste mit Komma oder Bereich mit "..".',
    example: 'CASE schritt OF\n  0: IF "LS1".Belegt THEN schritt := 1; END_IF;\n  1: "S1".Ausfahren := TRUE;\n     schritt := 0;\nEND_CASE;',
    insert: 'CASE | OF\n  0: ;\n  1: ;\nELSE\n  ;\nEND_CASE;\n' },
  { name: 'RETURN', cat: 'Anweisungen', syntax: 'RETURN;',
    text: 'Beendet den Baustein für diesen Zyklus sofort. Der Rest des Codes wird übersprungen.',
    example: 'IF NOT "B1".Läuft THEN\n  RETURN;\nEND_IF;', insert: 'RETURN;' },

  // ---------- Operatoren ----------
  { name: 'AND, OR, XOR, NOT', cat: 'Operatoren', syntax: 'a AND b, a OR b, a XOR b, NOT a',
    text: 'Logische Verknüpfungen. AND (auch &) = beide, OR = mindestens einer, XOR = genau einer, NOT = Umkehrung. ' +
      'Vorrang: NOT vor AND vor XOR vor OR – im Zweifel Klammern setzen.',
    example: '"S1".Ausfahren := "LS1".Belegt AND NOT "SE2".Reset;', insert: ' AND |' },
  { name: '= <> < > <= >=', cat: 'Operatoren', syntax: 'a = b, a <> b, a < b …',
    text: 'Vergleiche, Ergebnis TRUE oder FALSE. <> heißt "ungleich".',
    example: 'IF "SE1".Anzahl >= 10 THEN\n  "Q1".Freigabe := FALSE;\nEND_IF;', insert: ' >= |' },
  { name: '+ - * / MOD **', cat: 'Operatoren', syntax: 'a + b, a MOD b, a ** b',
    text: 'Rechnen. MOD = Rest einer Division, ** = Potenz. Division durch 0 stoppt den Baustein mit Fehlermeldung.',
    example: 'gerade := ("SE1".Anzahl MOD 2) = 0;', insert: ' + |' },

  // ---------- Funktionen ----------
  { name: 'MIN / MAX', cat: 'Funktionen', syntax: 'MIN(a, b), MAX(a, b)',
    text: 'Kleinerer bzw. größerer von zwei Werten.', example: '"B1".Tempo := MAX(0.2, tempo);', insert: 'MIN(|, )' },
  { name: 'LIMIT', cat: 'Funktionen', syntax: 'LIMIT(MN, IN, MX)',
    text: 'Begrenzt IN auf den Bereich MN … MX.', example: '"B1".Tempo := LIMIT(0.1, tempo, 2.0);', insert: 'LIMIT(0, |, 1)' },
  { name: 'SEL', cat: 'Funktionen', syntax: 'SEL(G, IN0, IN1)',
    text: 'Auswahl: liefert IN0, wenn G FALSE ist, sonst IN1.', example: '"B1".Tempo := SEL("LS1".Belegt, 0.5, 0.2);', insert: 'SEL(|, , )' },
  { name: 'ABS', cat: 'Funktionen', syntax: 'ABS(x)', text: 'Betrag (ohne Vorzeichen).', example: 'abstand := ABS(a - b);', insert: 'ABS(|)' },
  { name: 'SQRT', cat: 'Funktionen', syntax: 'SQRT(x)', text: 'Quadratwurzel.', example: 'w := SQRT(16.0);  // 4', insert: 'SQRT(|)' },
  { name: 'ROUND / TRUNC', cat: 'Funktionen', syntax: 'ROUND(x), TRUNC(x)',
    text: 'ROUND rundet kaufmännisch, TRUNC schneidet die Nachkommastellen ab.', example: 'n := ROUND(2.6);  // 3', insert: 'ROUND(|)' },

  // ---------- Zeitglieder ----------
  { name: 'TON – Einschaltverzögerung', cat: 'Zeitglieder', syntax: 'VAR t : TON; END_VAR\nt(IN := Bedingung, PT := T#…);\nt.Q, t.ET',
    text: 'Q wird TRUE, wenn IN mindestens die Zeit PT lang TRUE ist. Fällt IN ab, sind Q und ET sofort wieder 0. ' +
      'ET = bisher verstrichene Zeit. Den Baustein genau einmal pro Zyklus aufrufen.',
    example: 'VAR warten : TON; END_VAR\nwarten(IN := "LS1".Belegt, PT := T#300ms);\n"S1".Ausfahren := warten.Q;',
    insert: '|(IN := , PT := T#1s);' },
  { name: 'TOF – Ausschaltverzögerung', cat: 'Zeitglieder', syntax: 't(IN := …, PT := T#…);',
    text: 'Q wird sofort TRUE mit IN und bleibt nach dem Abfallen von IN noch PT lang TRUE.',
    example: 'VAR nachlauf : TOF; END_VAR\nnachlauf(IN := "LS1".Belegt, PT := T#2s);\n"B1".Ein := nachlauf.Q;',
    insert: '|(IN := , PT := T#1s);' },
  { name: 'TP – Impuls', cat: 'Zeitglieder', syntax: 't(IN := …, PT := T#…);',
    text: 'Bei steigender Flanke an IN wird Q für genau PT TRUE – egal, wie lange IN anliegt.',
    example: 'VAR stoss : TP; END_VAR\nstoss(IN := "LS1".Belegt, PT := T#500ms);\n"S1".Ausfahren := stoss.Q;',
    insert: '|(IN := , PT := T#500ms);' },

  // ---------- Flanken ----------
  { name: 'R_TRIG – steigende Flanke', cat: 'Flanken', syntax: 'f(CLK := Signal);  f.Q',
    text: 'Q ist genau einen Zyklus lang TRUE, wenn CLK von FALSE auf TRUE wechselt. Gut zum Zählen von Ereignissen.',
    example: 'VAR neu : R_TRIG; anzahl : INT; END_VAR\nneu(CLK := "LS1".Belegt);\nIF neu.Q THEN\n  anzahl := anzahl + 1;\nEND_IF;',
    insert: '|(CLK := );' },
  { name: 'F_TRIG – fallende Flanke', cat: 'Flanken', syntax: 'f(CLK := Signal);  f.Q',
    text: 'Q ist einen Zyklus lang TRUE, wenn CLK von TRUE auf FALSE wechselt, z. B. wenn eine Kiste die Lichtschranke verlässt.',
    example: 'VAR weg : F_TRIG; END_VAR\nweg(CLK := "LS1".Belegt);', insert: '|(CLK := );' },

  // ---------- Zähler ----------
  { name: 'CTU – Vorwärtszähler', cat: 'Zähler', syntax: 'c(CU := …, R := …, PV := n);  c.Q, c.CV',
    text: 'Zählt CV bei jeder steigenden Flanke an CU um 1 hoch. R setzt auf 0 zurück. Q ist TRUE, sobald CV ≥ PV.',
    example: 'VAR zaehler : CTU; END_VAR\nzaehler(CU := "LS1".Belegt, R := FALSE, PV := 5);\n// jede 5. Kiste ausschleusen\n"S1".Ausfahren := zaehler.Q AND "LS1".Belegt;',
    insert: '|(CU := , R := FALSE, PV := 5);' },
  { name: 'CTD – Rückwärtszähler', cat: 'Zähler', syntax: 'c(CD := …, LD := …, PV := n);  c.Q, c.CV',
    text: 'LD lädt CV mit PV. Jede steigende Flanke an CD zählt 1 herunter (nicht unter 0). Q ist TRUE bei CV ≤ 0.',
    example: 'VAR rest : CTD; END_VAR\nrest(CD := "LS1".Belegt, LD := "SE1".Reset, PV := 10);', insert: '|(CD := , LD := , PV := 10);' },

  // ---------- Speicher ----------
  { name: 'SR – Setzen dominant', cat: 'Speicher', syntax: 's(S1 := …, R := …);  s.Q1',
    text: 'Flipflop: S1 setzt Q1, R setzt zurück. Sind beide TRUE, gewinnt Setzen.',
    example: 'VAR halten : SR; END_VAR\nhalten(S1 := "LS1".Belegt, R := "S1".Ausgefahren);', insert: '|(S1 := , R := );' },
  { name: 'RS – Rücksetzen dominant', cat: 'Speicher', syntax: 's(S := …, R1 := …);  s.Q1',
    text: 'Flipflop: S setzt Q1, R1 setzt zurück. Sind beide TRUE, gewinnt Rücksetzen.',
    example: 'VAR an : RS; END_VAR\nan(S := "LS1".Belegt, R1 := "SE2".Reset);', insert: '|(S := , R1 := );' }
];
