// SCL: kleiner Interpreter für Structured Text nach IEC 61131-3 (wie SCL in TIA).
// Ein SCL-Baustein wird einmal übersetzt (compile) und dann in jedem Zyklus
// ausgeführt (exec). Unterstützt:
//   VAR … END_VAR mit BOOL, INT, DINT, REAL, TIME und den Bausteinen
//   TON, TOF, TP, R_TRIG, F_TRIG, CTU, CTD, SR, RS
//   :=, IF/ELSIF/ELSE/END_IF, CASE … OF … END_CASE, RETURN
//   AND OR XOR NOT, = <> < > <= >=, + - * / MOD **, Funktionen wie MIN/MAX
// Signale der Anlage: "LS1".Belegt (wie aus der Variablenliste gezogen) oder LS1.Belegt.
// Werte sind intern Zahlen: TRUE = 1, FALSE = 0, Zeiten in Millisekunden.
window.MF = window.MF || {};

MF.scl = (function () {

  var KEYWORDS = ['IF', 'THEN', 'ELSIF', 'ELSE', 'END_IF', 'CASE', 'OF', 'END_CASE',
    'VAR', 'END_VAR', 'AND', 'OR', 'XOR', 'NOT', 'MOD', 'TRUE', 'FALSE', 'RETURN'];

  var TYPES = {
    BOOL: 'var', INT: 'var', DINT: 'var', REAL: 'var', TIME: 'var',
    TON: 'fb', TOF: 'fb', TP: 'fb', R_TRIG: 'fb', F_TRIG: 'fb', CTU: 'fb', CTD: 'fb', SR: 'fb', RS: 'fb'
  };

  // Ein- und Ausgänge der Bausteine (Instanz-Aufruf bzw. Lesen mit inst.Q)
  var FBS = {
    TON:    { inputs: ['IN', 'PT'], outputs: ['Q', 'ET'] },
    TOF:    { inputs: ['IN', 'PT'], outputs: ['Q', 'ET'] },
    TP:     { inputs: ['IN', 'PT'], outputs: ['Q', 'ET'] },
    R_TRIG: { inputs: ['CLK'], outputs: ['Q'] },
    F_TRIG: { inputs: ['CLK'], outputs: ['Q'] },
    CTU:    { inputs: ['CU', 'R', 'PV'], outputs: ['Q', 'CV'] },
    CTD:    { inputs: ['CD', 'LD', 'PV'], outputs: ['Q', 'CV'] },
    SR:     { inputs: ['S1', 'R'], outputs: ['Q1'] },
    RS:     { inputs: ['S', 'R1'], outputs: ['Q1'] }
  };

  // Funktionen: Anzahl Argumente und Berechnung
  var FUNCS = {
    ABS:   { n: 1, f: function (a) { return Math.abs(a[0]); } },
    SQRT:  { n: 1, f: function (a) { return Math.sqrt(a[0]); } },
    ROUND: { n: 1, f: function (a) { return Math.round(a[0]); } },
    TRUNC: { n: 1, f: function (a) { return a[0] < 0 ? Math.ceil(a[0]) : Math.floor(a[0]); } },
    MIN:   { n: 2, f: function (a) { return Math.min(a[0], a[1]); } },
    MAX:   { n: 2, f: function (a) { return Math.max(a[0], a[1]); } },
    LIMIT: { n: 3, f: function (a) { return Math.min(Math.max(a[1], a[0]), a[2]); } },
    SEL:   { n: 3, f: function (a) { return a[0] ? a[2] : a[1]; } }
  };

  function SclError(msg, tok) {
    this.message = msg;
    this.line = tok ? tok.line : 0;
    this.col = tok ? tok.col : 0;
  }

  // ---------- Zerlegen in Wörter (Lexer) ----------

  var ID_START = /[A-Za-z_ÄÖÜäöüß]/;
  var ID_PART = /[A-Za-z0-9_ÄÖÜäöüß]/;
  var TIME_RE = /^(?:T|TIME)#(-?)((?:\d+(?:\.\d+)?(?:ms|d|h|m|s)_?)+)/i;
  var TIME_UNITS = { d: 86400000, h: 3600000, m: 60000, s: 1000, ms: 1 };

  function lex(src) {
    var toks = [];
    var i = 0, line = 1, col = 1;

    function adv(n) {
      for (var k = 0; k < n; k++) {
        if (src[i] === '\n') { line++; col = 1; } else col++;
        i++;
      }
    }
    function push(t, v, len) {
      toks.push({ t: t, v: v, line: line, col: col });
      adv(len);
    }

    while (i < src.length) {
      var c = src[i], rest = src.slice(i, i + 2);
      if (/\s/.test(c)) { adv(1); continue; }
      if (rest === '//') { while (i < src.length && src[i] !== '\n') adv(1); continue; }
      if (rest === '(*' || rest === '/*') {
        var end = rest === '(*' ? '*)' : '*/';
        var startTok = { line: line, col: col };
        var j = src.indexOf(end, i + 2);
        if (j < 0) throw new SclError('Kommentar wird nicht geschlossen (' + end + ' fehlt)', startTok);
        adv(j + 2 - i);
        continue;
      }
      var m = TIME_RE.exec(src.slice(i));
      if (m) {
        var ms = 0, re = /(\d+(?:\.\d+)?)(ms|d|h|m|s)/gi, p;
        while ((p = re.exec(m[2]))) ms += parseFloat(p[1]) * TIME_UNITS[p[2].toLowerCase()];
        push('num', m[1] ? -ms : ms, m[0].length);
        continue;
      }
      if (/\d/.test(c)) {
        m = /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(src.slice(i));
        push('num', parseFloat(m[0]), m[0].length);
        continue;
      }
      if (c === '"') {
        var q = src.indexOf('"', i + 1);
        var nl = src.indexOf('\n', i + 1);
        if (q < 0 || (nl >= 0 && nl < q)) throw new SclError('Anführungszeichen " wird nicht geschlossen', { line: line, col: col });
        push('qid', src.slice(i + 1, q), q + 1 - i);
        continue;
      }
      if (ID_START.test(c)) {
        var k2 = i + 1;
        while (k2 < src.length && ID_PART.test(src[k2])) k2++;
        var word = src.slice(i, k2);
        var up = word.toUpperCase();
        if (KEYWORDS.indexOf(up) >= 0) push('kw', up, word.length);
        else push('id', word, word.length);
        continue;
      }
      var ops = [':=', '<=', '>=', '<>', '**', '..', '=', '<', '>', '+', '-', '*', '/', '(', ')', ';', ':', ',', '.', '&'];
      var op = null;
      for (var o = 0; o < ops.length; o++) {
        if (src.substr(i, ops[o].length) === ops[o]) { op = ops[o]; break; }
      }
      if (!op) throw new SclError('Unbekanntes Zeichen "' + c + '"', { line: line, col: col });
      push('op', op === '&' ? 'AND' : op, op.length);
      if (op === '&') toks[toks.length - 1].t = 'kw';
    }
    toks.push({ t: 'eof', v: '', line: line, col: col });
    return toks;
  }

  // ---------- Übersetzen (Parser) ----------

  // Vorrang der Operatoren, von schwach nach stark
  var LEVELS = [
    ['OR'], ['XOR'], ['AND'],
    ['=', '<>'], ['<', '>', '<=', '>='],
    ['+', '-'], ['*', '/', 'MOD']
  ];

  function parse(src, env) {
    var toks = lex(src);
    var pos = 0;
    var vars = {};        // Name (groß) -> { name, type, init, line }
    var varList = [];
    var writes = {}, reads = {};

    function peek() { return toks[pos]; }
    function next() { return toks[pos++]; }
    function is(t, v) { var k = toks[pos]; return k.t === t && (v === undefined || k.v === v); }
    function accept(t, v) { if (is(t, v)) return next(); return null; }
    function show(tok) {
      if (tok.t === 'eof') return 'Ende des Codes';
      if (tok.t === 'qid') return '"' + tok.v + '"';
      return '"' + tok.v + '"';
    }
    function expect(t, v, what) {
      if (is(t, v)) return next();
      throw new SclError((what || '"' + v + '"') + ' erwartet, gefunden: ' + show(peek()), peek());
    }

    // VAR-Blöcke am Anfang
    while (accept('kw', 'VAR')) {
      while (!is('kw', 'END_VAR')) {
        if (is('eof')) throw new SclError('END_VAR fehlt', peek());
        var names = [expect('id', undefined, 'Variablenname')];
        while (accept('op', ',')) names.push(expect('id', undefined, 'Variablenname'));
        expect('op', ':');
        var tt = expect('id', undefined, 'Datentyp');
        var type = tt.v.toUpperCase();
        if (!TYPES[type]) throw new SclError('Unbekannter Datentyp "' + tt.v + '"', tt);
        var init = null;
        if (accept('op', ':=')) {
          if (TYPES[type] === 'fb') throw new SclError(type + ' hat keinen Startwert', tt);
          init = parseExpr();
        }
        expect('op', ';');
        names.forEach(function (n) {
          var key = n.v.toUpperCase();
          if (vars[key]) throw new SclError('Variable "' + n.v + '" ist schon deklariert', n);
          if (env.elementIds.indexOf(n.v) >= 0) throw new SclError('"' + n.v + '" ist schon der Name eines Elements', n);
          vars[key] = { name: n.v, type: type, init: init, line: n.line };
          varList.push(vars[key]);
        });
      }
      next();
      accept('op', ';');
    }

    var body = parseStatements(['eof']);
    expect('eof', undefined, 'Ende des Codes');
    return { vars: varList, body: body, writes: Object.keys(writes), reads: Object.keys(reads) };

    // Anweisungen bis zu einem der Schlüsselwörter in stop
    function parseStatements(stop) {
      var list = [];
      while (true) {
        var tk = peek();
        if (tk.t === 'eof' || (tk.t === 'kw' && stop.indexOf(tk.v) >= 0)) break;
        // nächste CASE-Marke, auch negativ (keine Anweisung beginnt mit Zahl oder "-")
        if (stop.indexOf('#label') >= 0 && (tk.t === 'num' || (tk.t === 'op' && tk.v === '-'))) break;
        if (tk.t === 'eof') break;
        var s = parseStatement();
        if (s) list.push(s);
      }
      return list;
    }

    function parseStatement() {
      var tk = peek();
      if (accept('op', ';')) return null;
      if (accept('kw', 'IF')) {
        var branches = [];
        var cond = parseExpr();
        expect('kw', 'THEN', 'THEN');
        branches.push({ cond: cond, body: parseStatements(['ELSIF', 'ELSE', 'END_IF']) });
        while (accept('kw', 'ELSIF')) {
          cond = parseExpr();
          expect('kw', 'THEN', 'THEN');
          branches.push({ cond: cond, body: parseStatements(['ELSIF', 'ELSE', 'END_IF']) });
        }
        var els = accept('kw', 'ELSE') ? parseStatements(['END_IF']) : [];
        if (!is('kw', 'END_IF')) throw new SclError('END_IF fehlt zu IF in Zeile ' + tk.line, peek());
        next();
        expect('op', ';', '";" nach END_IF');
        return { k: 'if', branches: branches, els: els, line: tk.line };
      }
      if (accept('kw', 'CASE')) {
        var sel = parseExpr();
        expect('kw', 'OF', 'OF');
        var cases = [];
        while (is('num') || is('op', '-')) {
          var labels = [];
          do {
            var lo = parseSignedInt();
            var hi = accept('op', '..') ? parseSignedInt() : lo;
            labels.push([lo, hi]);
          } while (accept('op', ','));
          expect('op', ':');
          cases.push({ labels: labels, body: parseStatements(['ELSE', 'END_CASE', '#label']) });
        }
        var cElse = accept('kw', 'ELSE') ? parseStatements(['END_CASE']) : [];
        if (!is('kw', 'END_CASE')) throw new SclError('END_CASE fehlt zu CASE in Zeile ' + tk.line, peek());
        next();
        expect('op', ';', '";" nach END_CASE');
        return { k: 'case', sel: sel, cases: cases, els: cElse, line: tk.line };
      }
      if (accept('kw', 'RETURN')) {
        expect('op', ';', '";"');
        return { k: 'return', line: tk.line };
      }
      if (tk.t === 'id' || tk.t === 'qid') {
        // Baustein-Aufruf: t1(IN := …, PT := …);
        if (tk.t === 'id' && toks[pos + 1].v === '(' && toks[pos + 1].t === 'op') {
          var v = vars[tk.v.toUpperCase()];
          if (!v) throw new SclError('Unbekannter Baustein "' + tk.v + '" – erst unter VAR deklarieren, z. B. ' + tk.v + ' : TON;', tk);
          if (TYPES[v.type] !== 'fb') throw new SclError('"' + tk.v + '" ist kein Baustein und kann nicht aufgerufen werden', tk);
          next(); next();
          var args = {};
          if (!is('op', ')')) {
            do {
              var an = expect('id', undefined, 'Parametername');
              var key = an.v.toUpperCase();
              if (FBS[v.type].inputs.indexOf(key) < 0) {
                throw new SclError(v.type + ' hat keinen Eingang "' + an.v + '" (Eingänge: ' + FBS[v.type].inputs.join(', ') + ')', an);
              }
              expect('op', ':=');
              args[key] = parseExpr();
            } while (accept('op', ','));
          }
          expect('op', ')');
          expect('op', ';', '";" nach dem Aufruf');
          return { k: 'call', v: v, args: args, line: tk.line };
        }
        var target = parseRef(true);
        if (!is('op', ':=')) {
          throw new SclError(is('op', '=') ? 'Zuweisung mit := statt =' : '":=" erwartet, gefunden: ' + show(peek()), peek());
        }
        next();
        var val = parseExpr();
        expect('op', ';', '";" am Ende der Zuweisung');
        return { k: 'assign', target: target, val: val, line: tk.line };
      }
      throw new SclError('Anweisung erwartet, gefunden: ' + show(tk), tk);
    }

    function parseSignedInt() {
      var neg = !!accept('op', '-');
      var t = expect('num', undefined, 'Zahl');
      return neg ? -t.v : t.v;
    }

    // Variable, Bausteinausgang oder Signal
    function parseRef(forWrite) {
      var tk = next();
      if (tk.t === 'qid') {
        expect('op', '.', '"." nach "' + tk.v + '"');
        return signalRef(tk, tk.v, expect('id', undefined, 'Signalname'), forWrite);
      }
      var v = vars[tk.v.toUpperCase()];
      if (v) {
        if (TYPES[v.type] === 'fb') {
          expect('op', '.', '"." und Ausgang nach "' + tk.v + '" (z. B. ' + tk.v + '.Q)');
          var m = expect('id', undefined, 'Ausgang');
          var mk = m.v.toUpperCase();
          if (FBS[v.type].outputs.indexOf(mk) < 0) {
            throw new SclError(v.type + ' hat keinen Ausgang "' + m.v + '" (Ausgänge: ' + FBS[v.type].outputs.join(', ') + ')', m);
          }
          if (forWrite) throw new SclError('Ausgang ' + tk.v + '.' + m.v + ' kann nur gelesen werden', m);
          return { k: 'fbout', v: v, m: mk };
        }
        return { k: 'var', v: v };
      }
      if (is('op', '.') && env.elementIds.indexOf(tk.v) >= 0) {
        next();
        return signalRef(tk, tk.v, expect('id', undefined, 'Signalname'), forWrite);
      }
      if (env.elementIds.indexOf(tk.v) >= 0) {
        throw new SclError('"' + tk.v + '" ist ein Element – Signal mit Punkt angeben, z. B. "' + tk.v + '".' + env.firstSignal(tk.v), tk);
      }
      throw new SclError('Unbekannte Variable "' + tk.v + '" – unter VAR deklarieren oder Signal aus der Liste ziehen', tk);
    }

    function signalRef(tk, elId, nameTok, forWrite) {
      if (env.elementIds.indexOf(elId) < 0) throw new SclError('Element "' + elId + '" gibt es nicht', tk);
      var def = env.ioDef(elId, nameTok.v);
      if (!def) throw new SclError(elId + ' hat kein Signal "' + nameTok.v + '"', nameTok);
      var sig = elId + '.' + def.name;
      if (forWrite) {
        if (def.dir !== 'in') throw new SclError(sig + ' ist ein Ausgang und kann nur gelesen werden', nameTok);
        writes[sig] = true;
      } else {
        reads[sig] = true;
      }
      return { k: 'sig', el: elId, name: def.name, def: def, sig: sig };
    }

    // ---------- Ausdrücke, nach Vorrang ----------

    function parseExpr() { return parseBin(0); }

    function parseBin(level) {
      if (level >= LEVELS.length) return parsePow();
      var left = parseBin(level + 1);
      while (true) {
        var tk = peek();
        if ((tk.t === 'op' || tk.t === 'kw') && LEVELS[level].indexOf(tk.v) >= 0) {
          next();
          left = { k: 'bin', op: tk.v, a: left, b: parseBin(level + 1), tok: tk };
        } else return left;
      }
    }

    function parsePow() {
      var left = parseUnary();
      if (accept('op', '**')) return { k: 'bin', op: '**', a: left, b: parsePow() };
      return left;
    }

    function parseUnary() {
      if (accept('kw', 'NOT')) return { k: 'not', a: parseUnary() };
      if (accept('op', '-')) return { k: 'neg', a: parseUnary() };
      if (accept('op', '+')) return parseUnary();
      return parsePrimary();
    }

    function parsePrimary() {
      var tk = peek();
      if (tk.t === 'num') { next(); return { k: 'num', v: tk.v }; }
      if (accept('kw', 'TRUE')) return { k: 'num', v: 1 };
      if (accept('kw', 'FALSE')) return { k: 'num', v: 0 };
      if (accept('op', '(')) {
        var e = parseExpr();
        expect('op', ')', '")"');
        return e;
      }
      if (tk.t === 'id' && toks[pos + 1].t === 'op' && toks[pos + 1].v === '(') {
        var fn = FUNCS[tk.v.toUpperCase()];
        if (!fn) {
          var v = vars[tk.v.toUpperCase()];
          if (v && TYPES[v.type] === 'fb') throw new SclError('Bausteine als eigene Anweisung aufrufen, Ausgang dann mit ' + tk.v + '.Q lesen', tk);
          throw new SclError('Unbekannte Funktion "' + tk.v + '"', tk);
        }
        next(); next();
        var args = [];
        if (!is('op', ')')) {
          do {
            // Benannte Parameter wie LIMIT(MN := 0, IN := x, MX := 5) erlauben
            if (is('id') && toks[pos + 1].v === ':=') { next(); next(); }
            args.push(parseExpr());
          } while (accept('op', ','));
        }
        expect('op', ')', '")"');
        if (args.length !== fn.n) throw new SclError(tk.v.toUpperCase() + ' braucht ' + fn.n + ' Argument' + (fn.n > 1 ? 'e' : ''), tk);
        return { k: 'fn', fn: fn, args: args };
      }
      if (tk.t === 'id' || tk.t === 'qid') return parseRef(false);
      throw new SclError('Wert erwartet, gefunden: ' + show(tk), tk);
    }
  }

  // ---------- Ausführen ----------

  function RuntimeError(msg, line) { this.message = msg; this.line = line; }
  function Return() {}

  // Wert passend zum Datentyp speichern
  function coerce(type, v) {
    if (type === 'BOOL') return v ? 1 : 0;
    if (type === 'INT' || type === 'DINT') return v < 0 ? Math.ceil(v) : Math.floor(v);
    return v;
  }

  // Startzustand aller Variablen und Bausteine
  function initState(prog, old) {
    var st = {};
    prog.vars.forEach(function (v) {
      var key = v.name.toUpperCase();
      if (old && old[key] && old[key].type === v.type) { st[key] = old[key]; return; }
      if (TYPES[v.type] === 'fb') {
        st[key] = { type: v.type, fb: { Q: 0, Q1: 0, ET: 0, CV: 0, M: 0, run: 0 } };
      } else {
        var value = 0;
        try { if (v.init) value = coerce(v.type, evalStatic(v.init)); } catch (e) { value = 0; }
        st[key] = { type: v.type, value: value };
      }
    });
    return st;
  }

  // Startwerte dürfen nur aus Konstanten bestehen
  function evalStatic(e) {
    return evalExpr(e, { state: {}, line: 0 });
  }

  function evalExpr(e, ctx) {
    switch (e.k) {
      case 'num': return e.v;
      case 'var':
        if (!ctx.state[e.v.name.toUpperCase()]) throw new RuntimeError('Startwert darf keine Variable enthalten', e.v.line);
        return ctx.state[e.v.name.toUpperCase()].value;
      case 'fbout': return ctx.state[e.v.name.toUpperCase()].fb[e.m];
      case 'sig': {
        var el = MF.store.findElement(e.el);
        if (!el) throw new RuntimeError('Element ' + e.el + ' gibt es nicht mehr', ctx.line);
        return MF.engine.signal(el, e.name);
      }
      case 'not': return evalExpr(e.a, ctx) ? 0 : 1;
      case 'neg': return -evalExpr(e.a, ctx);
      case 'fn': return e.fn.f(e.args.map(function (a) { return evalExpr(a, ctx); }));
      case 'bin': {
        var a = evalExpr(e.a, ctx);
        // AND/OR kurzschließen
        if (e.op === 'AND' && !a) return 0;
        if (e.op === 'OR' && a) return 1;
        var b = evalExpr(e.b, ctx);
        switch (e.op) {
          case 'AND': return b ? 1 : 0;
          case 'OR': return b ? 1 : 0;
          case 'XOR': return (!a !== !b) ? 1 : 0;
          case '=': return a === b ? 1 : 0;
          case '<>': return a !== b ? 1 : 0;
          case '<': return a < b ? 1 : 0;
          case '>': return a > b ? 1 : 0;
          case '<=': return a <= b ? 1 : 0;
          case '>=': return a >= b ? 1 : 0;
          case '+': return a + b;
          case '-': return a - b;
          case '*': return a * b;
          case '/':
            if (b === 0) throw new RuntimeError('Division durch 0', ctx.line);
            return a / b;
          case 'MOD':
            if (b === 0) throw new RuntimeError('MOD durch 0', ctx.line);
            return a % b;
          case '**': return Math.pow(a, b);
        }
      }
    }
    return 0;
  }

  // Bausteine: ein Aufruf pro Zyklus; dtMs = Zykluszeit
  function callFb(type, f, args, dtMs) {
    var IN = args.IN ? 1 : 0, PT = args.PT || 0;
    switch (type) {
      case 'TON':
        if (IN) { f.ET = Math.min(f.ET + (f.M ? dtMs : 0), PT); f.Q = f.ET >= PT ? 1 : 0; }
        else { f.ET = 0; f.Q = 0; }
        f.M = IN;
        break;
      case 'TOF':
        if (IN) { f.Q = 1; f.ET = 0; f.run = 0; }
        else {
          // Fallende Flanke startet die Zeit bei 0 (wie TON), danach zählt jeder Zyklus
          if (f.M) { f.run = 1; f.ET = 0; }
          else if (f.run) f.ET = Math.min(f.ET + dtMs, PT);
          if (f.run && f.ET >= PT) { f.Q = 0; f.run = 0; }
        }
        f.M = IN;
        break;
      case 'TP':
        if (f.run) {
          f.ET = Math.min(f.ET + dtMs, PT);
          if (f.ET >= PT) f.run = 0;
        } else if (IN && !f.M) { f.run = 1; f.ET = 0; }
        else if (!IN) f.ET = 0;
        f.Q = f.run;
        f.M = IN;
        break;
      case 'R_TRIG':
        f.Q = args.CLK && !f.M ? 1 : 0;
        f.M = args.CLK ? 1 : 0;
        break;
      case 'F_TRIG':
        f.Q = !args.CLK && f.M ? 1 : 0;
        f.M = args.CLK ? 1 : 0;
        break;
      case 'CTU':
        if (args.R) f.CV = 0;
        else if (args.CU && !f.M) f.CV++;
        f.M = args.CU ? 1 : 0;
        f.Q = f.CV >= (args.PV || 0) ? 1 : 0;
        break;
      case 'CTD':
        if (args.LD) f.CV = args.PV || 0;
        else if (args.CD && !f.M && f.CV > 0) f.CV--;
        f.M = args.CD ? 1 : 0;
        f.Q = f.CV <= 0 ? 1 : 0;
        break;
      case 'SR': f.Q1 = args.S1 || (!args.R && f.Q1) ? 1 : 0; break;
      case 'RS': f.Q1 = !args.R1 && (args.S || f.Q1) ? 1 : 0; break;
    }
  }

  function execList(list, ctx) {
    for (var i = 0; i < list.length; i++) execStmt(list[i], ctx);
  }

  function execStmt(s, ctx) {
    ctx.line = s.line;
    switch (s.k) {
      case 'assign': {
        var v = evalExpr(s.val, ctx);
        if (typeof v !== 'number' || isNaN(v)) throw new RuntimeError('Ergebnis ist keine Zahl', s.line);
        var t = s.target;
        if (t.k === 'var') {
          var cell = ctx.state[t.v.name.toUpperCase()];
          cell.value = coerce(cell.type, v);
        } else if (t.k === 'sig') {
          var el = MF.store.findElement(t.el);
          if (!el) throw new RuntimeError('Element ' + t.el + ' gibt es nicht mehr', s.line);
          MF.engine.setSignal(el, t.name, v);
        }
        break;
      }
      case 'if':
        for (var i = 0; i < s.branches.length; i++) {
          if (evalExpr(s.branches[i].cond, ctx)) { execList(s.branches[i].body, ctx); return; }
        }
        execList(s.els, ctx);
        break;
      case 'case': {
        var x = evalExpr(s.sel, ctx);
        for (var c = 0; c < s.cases.length; c++) {
          var hit = s.cases[c].labels.some(function (l) { return x >= l[0] && x <= l[1]; });
          if (hit) { execList(s.cases[c].body, ctx); return; }
        }
        execList(s.els, ctx);
        break;
      }
      case 'call': {
        var args = {};
        Object.keys(s.args).forEach(function (k) { args[k] = evalExpr(s.args[k], ctx); });
        callFb(s.v.type, ctx.state[s.v.name.toUpperCase()].fb, args, ctx.dtMs);
        break;
      }
      case 'return':
        throw new Return();
    }
  }

  // Umgebung für den Parser: welche Elemente und Signale es gibt
  function env() {
    return {
      elementIds: MF.model.elements.map(function (el) { return el.id; }),
      ioDef: function (id, name) {
        var el = MF.store.findElement(id);
        if (!el) return null;
        // Groß-/Kleinschreibung beim Signalnamen egal
        return MF.types[el.type].io.filter(function (s) { return s.name.toUpperCase() === name.toUpperCase(); })[0] || null;
      },
      firstSignal: function (id) {
        var el = MF.store.findElement(id);
        return el ? MF.types[el.type].io[0].name : 'Signal';
      }
    };
  }

  return {
    TYPES: TYPES,
    FBS: FBS,
    FUNCS: FUNCS,
    KEYWORDS: KEYWORDS,

    // Code übersetzen -> { prog } oder { error: { message, line, col } }
    compile: function (code) {
      try {
        return { prog: parse(code || '', env()) };
      } catch (e) {
        if (e instanceof SclError) return { error: { message: e.message, line: e.line, col: e.col } };
        throw e;
      }
    },

    initState: initState,

    // Einen Zyklus ausführen. Gibt null zurück oder einen Laufzeitfehler { message, line }.
    run: function (prog, state, dtMs) {
      var ctx = { state: state, dtMs: dtMs, line: 0 };
      try {
        execList(prog.body, ctx);
      } catch (e) {
        if (e instanceof Return) return null;
        if (e instanceof RuntimeError) return { message: e.message, line: e.line };
        throw e;
      }
      return null;
    },

    lex: lex
  };
})();
