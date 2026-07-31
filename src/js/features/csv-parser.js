"use strict";

/* Hand-rolled CSV parser (Import Centre) — no existing precedent/library in this codebase
   (features/import.js's own "Import Project" is JSON-only). RFC4180-ish: comma-separated,
   double-quote-quoted fields (a literal quote inside a quoted field is escaped by doubling it: ""),
   fields may contain commas/newlines when quoted, CRLF or LF line endings both accepted. First row
   is the header; every subsequent row becomes a plain object keyed by that header, so CSV and JSON
   input converge on the identical row shape once parsed (see parseImportFile below) — no downstream
   code (Test Run, Commit, results rendering) ever needs to know or care which format a file
   actually was. */
function parseCsvRows(text){
  var rows = [];
  var row = [];
  var field = '';
  var inQuotes = false;
  var i = 0;
  var len = text.length;

  function endField(){ row.push(field); field = ''; }
  function endRow(){ endField(); rows.push(row); row = []; }

  while(i < len){
    var ch = text[i];
    if(inQuotes){
      if(ch === '"'){
        if(text[i + 1] === '"'){ field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if(ch === '"'){ inQuotes = true; i++; continue; }
    if(ch === ','){ endField(); i++; continue; }
    if(ch === '\r'){ i++; continue; }
    if(ch === '\n'){ endRow(); i++; continue; }
    field += ch; i++;
  }
  // Last field/row, for a file that doesn't end with a trailing newline.
  if(field !== '' || row.length > 0) endRow();
  // A real trailing newline produces one wholly-empty final row ([""]) — drop it rather than
  // surfacing it as a phantom blank data row.
  if(rows.length > 0 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === ''){
    rows.pop();
  }
  return rows;
}

export function parseCsvToRows(text){
  var raw = parseCsvRows(text);
  if(raw.length === 0) return [];
  var header = raw[0].map(function(h){ return h.trim(); });
  return raw.slice(1).map(function(cells){
    var obj = {};
    header.forEach(function(key, idx){ obj[key] = (cells[idx] !== undefined ? cells[idx] : '').trim(); });
    return obj;
  });
}

/* Detects CSV vs JSON: file extension first (case-insensitive), falling back to content-sniffing
   (first non-whitespace character '{' or '[' -> JSON, anything else -> CSV) for a file with no, or
   an unrecognized, extension. */
export function detectImportFileFormat(filename, text){
  var lower = (filename || '').toLowerCase();
  if(lower.endsWith('.json')) return 'json';
  if(lower.endsWith('.csv')) return 'csv';
  var trimmed = (text || '').trim();
  return (trimmed[0] === '{' || trimmed[0] === '[') ? 'json' : 'csv';
}

/* Normalizes either source format down to the same shape: {format, rows: [{field: value}, ...]}.
   JSON input must be a top-level array of row objects — a single bare object is treated as a
   one-row array for convenience (matching how someone might re-upload just one exported row);
   anything else throws so the caller can surface a clear error instead of silently importing zero
   rows. */
export function parseImportFile(filename, text){
  var format = detectImportFileFormat(filename, text);
  if(format === 'csv') return {format: format, rows: parseCsvToRows(text)};

  var parsed = JSON.parse(text);
  if(Array.isArray(parsed)) return {format: format, rows: parsed};
  if(parsed && typeof parsed === 'object') return {format: format, rows: [parsed]};
  throw new Error('Expected a JSON array of rows.');
}
