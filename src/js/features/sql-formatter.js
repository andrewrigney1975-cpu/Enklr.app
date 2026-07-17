"use strict";
import { SQL_KEYWORDS } from './sql-intellisense.js';

/* =========================================================
   SQL FORMATTER
   Hand-rolled formatter for the Advanced Query tab's "Format SQL" button (modals/project-search.js)
   — same "no charting/formatting library" bias as the rest of this app (query-engine.js's AlaSQL
   dependency is the one deliberate, discussed exception; a formatter for this app's narrow single-
   statement SELECT-only grammar is well within hand-rolling range).

   Conventions applied (consistent with mainstream SQL formatters — pgFormatter, the sql-formatter npm
   package, DataGrip/DBeaver's defaults, Prettier's SQL plugin — all converge on the same handful of
   rules for a formatter at this scope):
     - Every major clause (SELECT, FROM, WHERE, GROUP BY, HAVING, ORDER BY, JOIN variants, ON, UNION,
       LIMIT) starts a new line.
     - Comma-separated lists (SELECT's column list, GROUP BY/ORDER BY) break one item per line,
       indented one level under their clause, trailing comma at end of line.
     - AND/OR chains inside WHERE/HAVING/ON break one condition per line, same indent rule.
     - ON is itself indented one level under its JOIN line (its own AND/OR breaks indent one further).
     - 2-space indentation, spaces only — never tabs.
     - Keywords are uppercased using the EXACT SAME `SQL_KEYWORDS` list features/sql-intellisense.js
       suggests from, so "what counts as a keyword" can never drift between the two features.
     - Content inside parentheses (function calls, grouped conditions) is deliberately left inline,
       never broken/re-indented — a reasonable, common simplification for a lightweight formatter; only
       heavier tools (pgFormatter) attempt full recursive reformatting of nested expressions.
   ========================================================= */

var COMPOUND_CLAUSES = {GROUP: 'BY', ORDER: 'BY'};
var JOIN_MODIFIERS = ['INNER', 'LEFT', 'RIGHT'];
// Whichever of these tokens most recently preceded a '(' gets a space before it — everything else
// (an aggregate function name, a plain identifier) is treated as a function call and gets none, e.g.
// "COUNT(*)" not "COUNT (*)", but "WHERE (a = 1 OR b = 2)" keeps its space.
var SPACE_BEFORE_PAREN_AFTER = {WHERE: 1, AND: 1, OR: 1, ON: 1, HAVING: 1, IN: 1, NOT: 1, FROM: 1, SELECT: 1};

function isFormatKeyword(upper){
  return SQL_KEYWORDS.indexOf(upper) !== -1;
}

/* Tokenizes into words/keywords (dots included, so "tasks.id" and "[tasks].[id]" both survive as
   sensible token groupings), string literals (single-quoted, kept verbatim including the quotes),
   bracket-quoted identifiers (kept verbatim including the brackets), parens, commas, and comparison
   operators. Deliberately simple — this textarea only ever holds one SELECT statement, not a program
   with comments or multiple statements to worry about (same scope assumption sql-intellisense.js's
   isInsideStringLiteral() makes). */
function tokenize(sql){
  var tokens = [];
  var i = 0;
  var n = sql.length;
  while(i < n){
    var ch = sql[i];
    if(/\s/.test(ch)){ i++; continue; }
    if(ch === '\''){
      var j = i + 1;
      while(j < n && !(sql[j] === '\'' && sql[j - 1] !== '\\')) j++;
      j = Math.min(j + 1, n);
      tokens.push(sql.slice(i, j));
      i = j;
      continue;
    }
    if(ch === '['){
      var close = sql.indexOf(']', i);
      var end = close === -1 ? n : close + 1;
      tokens.push(sql.slice(i, end));
      i = end;
      continue;
    }
    if('(),'.indexOf(ch) !== -1){
      tokens.push(ch);
      i++;
      continue;
    }
    var two = sql.slice(i, i + 2);
    if(['<=', '>=', '<>', '!='].indexOf(two) !== -1){
      tokens.push(two);
      i += 2;
      continue;
    }
    if('=<>*+-/%'.indexOf(ch) !== -1){
      tokens.push(ch);
      i++;
      continue;
    }
    var start = i;
    while(i < n && /[A-Za-z0-9_.]/.test(sql[i])) i++;
    if(i === start){ tokens.push(ch); i++; continue; } // unrecognized punctuation — pass through alone
    tokens.push(sql.slice(start, i));
  }
  return tokens;
}

function indentString(level){
  var s = '';
  for(var i = 0; i < level; i++) s += '  ';
  return s;
}

export function formatSql(sql){
  var tokens = tokenize((sql || '').trim());
  if(tokens.length === 0) return '';

  var lines = [];
  var current = '';
  var lastToken = null; // last significant token emitted, purely for the paren-spacing heuristic
  var breakMode = null; // 'commas' | 'andor' | null — what triggers a line break in the current clause
  var breakIndent = 1;
  var parenDepth = 0;

  function pushCurrentLine(){
    if(current.length > 0) lines.push(current);
  }

  function startClauseLine(text, indentLevel){
    pushCurrentLine();
    current = indentString(indentLevel) + text;
    lastToken = text.split(' ').pop(); // e.g. "GROUP BY" -> "BY", "LEFT JOIN" -> "JOIN"
  }

  function startContinuationLine(indentLevel){
    pushCurrentLine();
    current = indentString(indentLevel);
  }

  function emit(tok){
    if(current.length === 0 || /\s$/.test(current)){
      current += tok;
    } else {
      var noSpace = tok === ',' || tok === ')' || tok === '.' || lastToken === '(' || lastToken === '.';
      if(tok === '(' && !SPACE_BEFORE_PAREN_AFTER.hasOwnProperty(lastToken)) noSpace = true;
      current += (noSpace ? '' : ' ') + tok;
    }
    lastToken = tok;
  }

  var i = 0;
  while(i < tokens.length){
    var raw = tokens[i];
    var upper = raw.toUpperCase();
    var next = tokens[i + 1];
    var nextUpper = next ? next.toUpperCase() : null;

    if(COMPOUND_CLAUSES[upper] && nextUpper === COMPOUND_CLAUSES[upper]){
      startClauseLine(upper + ' ' + nextUpper, 0);
      breakMode = 'commas'; breakIndent = 1;
      i += 2; continue;
    }
    if(JOIN_MODIFIERS.indexOf(upper) !== -1 && nextUpper === 'JOIN'){
      startClauseLine(upper + ' JOIN', 0);
      breakMode = null;
      i += 2; continue;
    }
    if(upper === 'JOIN'){
      startClauseLine('JOIN', 0);
      breakMode = null;
      i += 1; continue;
    }
    if(upper === 'SELECT'){
      startClauseLine('SELECT', 0);
      breakMode = 'commas'; breakIndent = 1;
      i += 1; continue;
    }
    if(upper === 'FROM'){
      startClauseLine('FROM', 0);
      breakMode = 'commas'; breakIndent = 1; // rare, but FROM can list multiple comma-separated tables
      i += 1; continue;
    }
    if(upper === 'WHERE'){
      startClauseLine('WHERE', 0);
      breakMode = 'andor'; breakIndent = 1;
      i += 1; continue;
    }
    if(upper === 'HAVING'){
      startClauseLine('HAVING', 0);
      breakMode = 'andor'; breakIndent = 1;
      i += 1; continue;
    }
    if(upper === 'ON'){
      startClauseLine('ON', 1);
      breakMode = 'andor'; breakIndent = 2;
      i += 1; continue;
    }
    if(upper === 'UNION'){
      startClauseLine('UNION', 0);
      breakMode = null;
      i += 1; continue;
    }
    if(upper === 'LIMIT'){
      startClauseLine('LIMIT', 0);
      breakMode = null;
      i += 1; continue;
    }

    if(raw === ',' && parenDepth === 0 && breakMode === 'commas'){
      current += ',';
      startContinuationLine(breakIndent);
      i += 1; continue;
    }
    if((upper === 'AND' || upper === 'OR') && parenDepth === 0 && breakMode === 'andor'){
      startContinuationLine(breakIndent);
      emit(upper);
      i += 1; continue;
    }

    if(raw === '(') parenDepth++;
    if(raw === ')') parenDepth = Math.max(0, parenDepth - 1);

    emit(isFormatKeyword(upper) ? upper : raw);
    i += 1;
  }
  pushCurrentLine();

  return lines.join('\n');
}
