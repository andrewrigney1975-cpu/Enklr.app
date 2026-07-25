"use strict";

/* Generic, content-aware client-side sorting + filtering for any tabular UI — built for the Bulk
   Edit tool's own new sort/filter row, but deliberately free of any task/project knowledge (no
   imports from utils.js/storage.js/etc) so it's a drop-in for the next list view that wants the
   same "click a header to sort, type a condition to filter" behavior (Task List's own sort is a
   good future candidate — see its hand-rolled per-field switch in views/task-list.js's
   sortTaskListRows — but porting that over is a separate, deliberate call, not bundled into this
   change). Every function here takes plain values or a `getValue(row)`/`getValue(row, field)`
   accessor supplied by the caller — this module never reaches into a row itself. */

function isBlank(v){
  return v === null || v === undefined || v === '';
}

function asNumber(v){
  if(typeof v === 'number') return isNaN(v) ? null : v;
  if(typeof v !== 'string' || v.trim() === '') return null;
  var n = Number(v);
  return isNaN(n) ? null : n;
}

// Requires an unambiguous, ISO-ish `YYYY-MM-DD...` shape before trusting Date.parse — otherwise a
// plain number or short string (e.g. "80", "2026") gets silently accepted as a date by some
// engines' lenient parsing, which would misclassify a numeric column as date-like.
var DATE_LIKE_RE = /^\d{4}-\d{2}-\d{2}/;

function asDate(v){
  if(v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if(typeof v !== 'string' || v.trim() === '') return null;
  if(!DATE_LIKE_RE.test(v.trim())) return null;
  var d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

/* 'date' | 'number' | 'string' | 'empty' — used both to pick a comparator and to decide how a
   plain (operator-less) filter term should be interpreted against a given value. Date is checked
   before number since a numeric-looking value is never also a valid ISO date shape (and vice
   versa), so the order here doesn't actually create ambiguity either way. */
export function inferValueType(v){
  if(isBlank(v)) return 'empty';
  if(asDate(v) !== null) return 'date';
  if(asNumber(v) !== null) return 'number';
  return 'string';
}

// ---- sorting ---------------------------------------------------------------

/* Content-aware comparator: two dates compare chronologically, two numbers compare numerically,
   anything else falls back to a locale/numeric-aware string compare (so "Task 9" sorts before
   "Task 10", matching every other list already in this app — see the various key.localeCompare
   usages elsewhere). Blank values sort last. Exported standalone (not just used internally by
   sortRows) since a caller building its own multi-key comparator may want the same content-aware
   single-value logic as a building block. */
export function compareValues(a, b){
  var aBlank = isBlank(a), bBlank = isBlank(b);
  if(aBlank && bBlank) return 0;
  if(aBlank) return 1;
  if(bBlank) return -1;

  var aDate = asDate(a), bDate = asDate(b);
  if(aDate !== null && bDate !== null) return aDate.getTime() - bDate.getTime();

  var aNum = asNumber(a), bNum = asNumber(b);
  if(aNum !== null && bNum !== null) return aNum - bNum;

  return String(a).localeCompare(String(b), undefined, {numeric: true, sensitivity: 'base'});
}

/* Sorts `rows` in place (and returns them) by whatever `getValue(row)` produces for each one.
   `dir` is 1 (ascending) or -1 (descending) — blanks always sort last regardless of direction, so
   toggling desc never buries every real value under a wall of blanks first. */
export function sortRows(rows, getValue, dir){
  var d = dir < 0 ? -1 : 1;
  rows.sort(function(ra, rb){
    var a = getValue(ra), b = getValue(rb);
    var aBlank = isBlank(a), bBlank = isBlank(b);
    if(aBlank && bBlank) return 0;
    if(aBlank) return 1;
    if(bBlank) return -1;
    return compareValues(a, b) * d;
  });
  return rows;
}

// ---- filtering ---------------------------------------------------------------

var COMPARATOR_RE = /^(>=|<=|!=|==|=|>|<)\s*(.+)$/;
// A range is written `A..B` (inclusive both ends) rather than a bare hyphen — `10-50` would be
// indistinguishable from the number -50, and every ISO date already contains hyphens of its own.
var RANGE_RE = /^(.+?)\.\.(.+)$/;

// -1 / 0 / 1 (value vs. operand), or null if the operand can't be read as the same kind of thing
// (number or date) as the value itself — the caller falls back to a literal substring match in
// that case rather than silently matching nothing.
function compareNumOrDate(value, operand){
  var vDate = asDate(value), oDate = asDate(operand);
  if(vDate !== null && oDate !== null){
    var dt = vDate.getTime() - oDate.getTime();
    return dt < 0 ? -1 : (dt > 0 ? 1 : 0);
  }
  var vNum = asNumber(value), oNum = asNumber(operand);
  if(vNum !== null && oNum !== null) return vNum < oNum ? -1 : (vNum > oNum ? 1 : 0);
  return null;
}

function substringMatch(value, term){
  if(isBlank(value)) return false;
  return String(value).toLowerCase().indexOf(term.toLowerCase()) !== -1;
}

/* Parses one column's filter-box text into a predicate over that column's raw values. Supports:
     - blank expression            -> matches everything
     - a range,      `10..50`      -> inclusive both ends, numeric or date
     - a comparator, `>=10`/`!=3`  -> >, >=, <, <=, =, ==, != against a number or date
     - anything else               -> a plain, case-insensitive substring match against the
                                       value's own string form, OR (if the term itself reads as a
                                       number/date) an exact match — so filtering a "Business
                                       Value" column by "80" doesn't also pull in a row worth 180.
   A comparator/range whose operand can't be read as a number OR a date for a given row's value
   falls through to a literal substring match instead of silently excluding everything — a typo or
   an unexpected value type never makes a whole column of rows quietly vanish. */
export function parseFilterExpression(expr){
  var raw = String(expr == null ? '' : expr).trim();
  if(raw === '') return function(){ return true; };

  var rangeMatch = raw.match(RANGE_RE);
  if(rangeMatch){
    var lo = rangeMatch[1].trim(), hi = rangeMatch[2].trim();
    return function(value){
      var cLo = compareNumOrDate(value, lo);
      var cHi = compareNumOrDate(value, hi);
      if(cLo === null || cHi === null) return substringMatch(value, raw);
      return cLo >= 0 && cHi <= 0;
    };
  }

  var cmpMatch = raw.match(COMPARATOR_RE);
  if(cmpMatch){
    var op = cmpMatch[1] === '==' ? '=' : cmpMatch[1];
    var operand = cmpMatch[2].trim();
    return function(value){
      var c = compareNumOrDate(value, operand);
      // Fall back to the bare operand text ("foo", not ">foo") — the operator character itself
      // was never part of what the user meant to search for, just a hint at comparison intent
      // that doesn't apply to this value.
      if(c === null) return substringMatch(value, operand);
      switch(op){
        case '>': return c > 0;
        case '>=': return c >= 0;
        case '<': return c < 0;
        case '<=': return c <= 0;
        case '=': return c === 0;
        case '!=': return c !== 0;
        default: return true;
      }
    };
  }

  return function(value){
    var c = compareNumOrDate(value, raw);
    if(c !== null) return c === 0;
    return substringMatch(value, raw);
  };
}

/* Convenience: builds one combined AND predicate over a whole row from a map of
   {field: filterExpressionString} — skips blank entries up front rather than re-parsing an empty
   expression per row. `getValue(row, field)` is the caller's own per-field value accessor. */
export function createRowFilter(filtersByField, getValue){
  var active = Object.keys(filtersByField || {})
    .filter(function(f){ return String(filtersByField[f] || '').trim() !== ''; })
    .map(function(f){ return {field: f, test: parseFilterExpression(filtersByField[f])}; });
  if(active.length === 0) return function(){ return true; };
  return function(row){
    return active.every(function(entry){ return entry.test(getValue(row, entry.field)); });
  };
}
