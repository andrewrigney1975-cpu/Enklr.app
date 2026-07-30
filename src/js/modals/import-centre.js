"use strict";
import { getCurrentProject } from '../store.js';
import { toast } from '../ui.js';
import { isOrgAdmin, importOrganisationUsersApi } from '../api.js';
import { normalizeHeaderButtonVisibility } from '../storage.js';
import { IMPORT_ENTITY_ORDER, IMPORT_ENTITY_LABELS, buildSchemaTableHtml, buildCsvTemplate, buildJsonSchema } from '../features/import-schemas.js';
import { parseImportFile } from '../features/csv-parser.js';
import { confirmDialog } from './confirm.js';

/* =========================================================
   IMPORT CENTRE MODAL (Org Admin only)
   Gated on isOrgAdmin() alone, same as modals/sso.js's openSsoConfigModal — a valid orgAdmin JWT
   claim already implies a real server session exists, so there's no separate "is THIS project
   server-authoritative" check needed here: Import Centre is an org-wide concern (every entity now
   resolves its own target project/portal per row, see root CLAUDE.md's Import Centre notes), not
   tied to whichever project happened to be open when App Settings was clicked.

   Phase 1: Org-Admin gating, the modal shell, and the "Schemas" tab (view + download a CSV template
   / JSON schema per entity, built from features/import-schemas.js's shared definitions).
   Phase 2: backend ImportService/ImportController for Organisation Users, all three tiers.
   Phase 3 (this pass): wires the Import Data tab up to that backend — file upload (CSV or JSON,
   format auto-detected by features/csv-parser.js), Test Run (dryRun:true — validates every row for
   real, through the exact same entity-creation path a commit would use, then always rolls back
   server-side) and Commit (dryRun:false), with a per-row results table (row number, outcome, the
   row's own submitted data, and any error message). Only Organisation Users is wired up so far —
   the other three entities still show the Schemas-tab-reference-only "coming soon" note, since their
   own backend endpoints don't exist yet; showing a real file-upload control that always 404s would
   be worse than an honest placeholder.

   Portal Q&A is only ever listed once Portals are actually enabled for the organisation
   (visibility.portals && visibility.forms — the same two-flag chain the Portals toggle itself in
   App Settings depends on, see views/board.js's own doc comment on that row) — matching this app's
   "don't offer what the server will reject anyway" convention used everywhere else.
   ========================================================= */

// Which entities have a real, wired-up backend endpoint so far — grows one at a time as later
// phases land. Checked both when populating the entity select's "coming soon" state AND again in
// runTestRun/runCommit themselves (defense-in-depth, same convention as every other gate here).
var WIRED_UP_ENTITIES = ['organisationUsers'];

// In-memory state for whatever file is currently loaded — reset by both a new file selection and a
// change of entity, so a Commit can never fire against rows parsed for a DIFFERENT entity/file than
// the one currently shown.
var _parsedRows = null;
var _parsedFilename = null;
var _testRunDone = false;

function currentEnabledEntities(){
  var project = getCurrentProject();
  var visibility = project ? normalizeHeaderButtonVisibility(project.headerButtonVisibility) : {};
  return IMPORT_ENTITY_ORDER.filter(function(key){
    if(key === 'portalQa') return !!(visibility.portals && visibility.forms);
    return true;
  });
}

export function openImportCentreModal(){
  if(!isOrgAdmin()){ toast('Only an organisation admin can use the Import Centre.'); return; }
  var enabled = currentEnabledEntities();
  document.getElementById('importCentrePortalQaOption').classList.toggle('kf-vis-hidden', enabled.indexOf('portalQa') === -1);
  document.getElementById('importCentreEntitySelect').value = 'organisationUsers';
  resetImportDataState();
  applyImportEntitySelection();
  showImportCentreTab('import');
  renderImportCentreSchemas();
  document.getElementById('importCentreOverlay').classList.remove('hidden');
}

export function closeImportCentreModal(){
  document.getElementById('importCentreOverlay').classList.add('hidden');
}

function resetImportDataState(){
  _parsedRows = null;
  _parsedFilename = null;
  _testRunDone = false;
  document.getElementById('importCentreFileInput').value = '';
  document.getElementById('importCentreFileStatus').textContent = '';
  document.getElementById('importCentreTestRunBtn').disabled = true;
  document.getElementById('importCentreCommitBtn').disabled = true;
  document.getElementById('importCentreResultsWrap').classList.add('kf-vis-hidden');
  document.getElementById('importCentreResultsList').innerHTML = '';
  document.getElementById('importCentreResultsSummary').textContent = '';
}

/* Shows the real upload area for a wired-up entity, or the "coming soon" note otherwise — see this
   file's own top-of-file comment on why a real-looking control that always 404s would be worse than
   an honest placeholder for the three entities without a backend endpoint yet. */
function applyImportEntitySelection(){
  var entity = document.getElementById('importCentreEntitySelect').value;
  var isWiredUp = WIRED_UP_ENTITIES.indexOf(entity) !== -1;
  document.getElementById('importCentreComingSoonHint').classList.toggle('kf-vis-hidden', isWiredUp);
  document.getElementById('importCentreUploadArea').classList.toggle('kf-vis-hidden', !isWiredUp);
}

export function handleImportEntityChange(){
  resetImportDataState();
  applyImportEntitySelection();
}

export function handleImportCentreFileChange(e){
  var file = e.target.files && e.target.files[0];
  resetImportDataState();
  if(!file) return;

  var reader = new FileReader();
  reader.onerror = function(){ toast('Could not read that file.'); };
  reader.onload = function(){
    var parsed;
    try {
      parsed = parseImportFile(file.name, reader.result);
    } catch(err){
      toast('Could not parse that file: ' + (err.message || 'unknown error'));
      return;
    }
    if(parsed.rows.length === 0){
      toast('That file has no rows to import.');
      return;
    }
    _parsedRows = parsed.rows;
    _parsedFilename = file.name;
    _testRunDone = false;
    document.getElementById('importCentreFileStatus').textContent =
      'Parsed ' + parsed.rows.length + ' row' + (parsed.rows.length === 1 ? '' : 's') + ' from "' + file.name + '" (' + parsed.format.toUpperCase() + ').';
    document.getElementById('importCentreTestRunBtn').disabled = false;
    document.getElementById('importCentreCommitBtn').disabled = true;
  };
  reader.readAsText(file);
}

function currentEntityImportApi(){
  var entity = document.getElementById('importCentreEntitySelect').value;
  if(entity === 'organisationUsers') return importOrganisationUsersApi;
  return null;
}

export async function runImportCentreTestRun(){
  if(!_parsedRows) return;
  var importApi = currentEntityImportApi();
  if(!importApi){ toast('This entity cannot be imported yet.'); return; }

  var btn = document.getElementById('importCentreTestRunBtn');
  btn.disabled = true;
  try {
    var result = await importApi(_parsedRows, true);
    _testRunDone = true;
    renderImportResults(result, true);
    document.getElementById('importCentreCommitBtn').disabled = result.succeeded === 0;
  } catch(e){
    toast('Test Run failed: ' + (e.message || 'unknown error'));
  } finally {
    btn.disabled = false;
  }
}

export function confirmImportCentreCommit(){
  if(!_parsedRows || !_testRunDone) return;
  var count = _parsedRows.length;
  confirmDialog(
    'Commit this import?',
    'This will actually create ' + count + ' row' + (count === 1 ? '' : 's') + ' from "' + _parsedFilename + '". Rows that fail are skipped individually — this cannot be undone.',
    function(){ runImportCentreCommit(); }
  );
}

async function runImportCentreCommit(){
  var importApi = currentEntityImportApi();
  if(!importApi || !_parsedRows) return;

  var btn = document.getElementById('importCentreCommitBtn');
  btn.disabled = true;
  try {
    var result = await importApi(_parsedRows, false);
    renderImportResults(result, false);
    toast('Import complete: ' + result.succeeded + ' of ' + result.total + ' row' + (result.total === 1 ? '' : 's') + ' committed.');
  } catch(e){
    toast('Commit failed: ' + (e.message || 'unknown error'));
    btn.disabled = false;
  }
}

function renderImportResults(result, isDryRun){
  var wrap = document.getElementById('importCentreResultsWrap');
  var summary = document.getElementById('importCentreResultsSummary');
  var list = document.getElementById('importCentreResultsList');

  wrap.classList.remove('kf-vis-hidden');
  var verb = isDryRun ? 'would succeed' : 'succeeded';
  summary.innerHTML = (isDryRun ? '<strong>Test Run</strong> — ' : '<strong>Committed</strong> — ') +
    result.succeeded + ' of ' + result.total + ' row' + (result.total === 1 ? '' : 's') + ' ' + verb +
    (result.failed > 0 ? ', ' + result.failed + ' failed' : '') + '.';

  list.innerHTML = '<table class="kf-import-results-table">' +
    '<thead><tr><th>Row</th><th>Status</th><th>Data</th><th>Message</th></tr></thead>' +
    '<tbody>' + result.results.map(function(r){
      var dataText = Object.keys(r.data || {}).map(function(k){ return k + '=' + r.data[k]; }).join(', ');
      return '<tr>' +
        '<td>' + r.row + '</td>' +
        '<td><span class="' + (r.success ? 'kf-import-result-ok' : 'kf-import-result-fail') + '">' + (r.success ? 'OK' : 'Failed') + '</span></td>' +
        '<td class="kf-import-result-data">' + escapeHtml(dataText) + '</td>' +
        '<td>' + escapeHtml(r.message || '') + '</td>' +
      '</tr>';
    }).join('') + '</tbody></table>';
}

function escapeHtml(text){
  return String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function showImportCentreTab(tab){
  var isImport = tab === 'import';
  document.getElementById('importCentreTabImportBtn').classList.toggle('active', isImport);
  document.getElementById('importCentreTabSchemasBtn').classList.toggle('active', !isImport);
  document.getElementById('importCentreImportView').classList.toggle('hidden', !isImport);
  document.getElementById('importCentreSchemasView').classList.toggle('hidden', isImport);
}

function renderImportCentreSchemas(){
  var listEl = document.getElementById('importCentreSchemasList');
  var entities = currentEnabledEntities();
  listEl.innerHTML = entities.map(function(key){
    return '<div class="kf-import-schema-block">' +
      '<div class="kf-import-schema-header">' +
        '<span class="kf-import-schema-title">' + IMPORT_ENTITY_LABELS[key] + '</span>' +
        '<span class="kf-import-schema-actions">' +
          '<button type="button" class="kf-btn kf-btn-ghost kf-btn-sm" data-csv-id="' + key + '">Download CSV template</button>' +
          '<button type="button" class="kf-btn kf-btn-ghost kf-btn-sm" data-json-id="' + key + '">Download JSON schema</button>' +
        '</span>' +
      '</div>' +
      buildSchemaTableHtml(key) +
    '</div>';
  }).join('');
}

function downloadBlob(blob, filename){
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function handleImportCentreSchemasClick(e){
  var csvBtn = e.target.closest('[data-csv-id]');
  if(csvBtn){
    var csvKey = csvBtn.getAttribute('data-csv-id');
    var blob = new Blob([buildCsvTemplate(csvKey)], {type: 'text/csv;charset=utf-8;'});
    downloadBlob(blob, csvKey + '-import-template.csv');
    return;
  }
  var jsonBtn = e.target.closest('[data-json-id]');
  if(jsonBtn){
    var jsonKey = jsonBtn.getAttribute('data-json-id');
    var jsonBlob = new Blob([buildJsonSchema(jsonKey)], {type: 'application/json'});
    downloadBlob(jsonBlob, jsonKey + '-import-schema.json');
    return;
  }
}
