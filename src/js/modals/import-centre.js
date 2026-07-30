"use strict";
import { getCurrentProject } from '../store.js';
import { toast } from '../ui.js';
import { isOrgAdmin } from '../api.js';
import { normalizeHeaderButtonVisibility } from '../storage.js';
import { IMPORT_ENTITY_ORDER, IMPORT_ENTITY_LABELS, buildSchemaTableHtml, buildCsvTemplate, buildJsonSchema } from '../features/import-schemas.js';

/* =========================================================
   IMPORT CENTRE MODAL (Org Admin only)
   Gated on isOrgAdmin() alone, same as modals/sso.js's openSsoConfigModal — a valid orgAdmin JWT
   claim already implies a real server session exists, so there's no separate "is THIS project
   server-authoritative" check needed here: Import Centre is an org-wide concern (every entity now
   resolves its own target project/portal per row, see root CLAUDE.md's Import Centre notes), not
   tied to whichever project happened to be open when App Settings was clicked.
   Phase 1 scaffolding: Org-Admin gating, the modal shell, and a fully functional "Schemas" tab
   (view + download a CSV template / JSON schema per entity, built from features/import-schemas.js's
   shared definitions so the on-screen table and the downloadable files can never disagree with each
   other). The "Import Data" tab is a placeholder — file upload, Test Run, and Commit land in later
   phases once the backend ImportService exists on all three tiers; showing a real but inert entity
   picker here (with nothing behind it) would be more misleading than a plain "coming soon" note.

   Portal Q&A is only ever listed once Portals are actually enabled for the organisation
   (visibility.portals && visibility.forms — the same two-flag chain the Portals toggle itself in
   App Settings depends on, see views/board.js's own doc comment on that row) — matching this app's
   "don't offer what the server will reject anyway" convention used everywhere else.
   ========================================================= */

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
  showImportCentreTab('import');
  renderImportCentreSchemas();
  document.getElementById('importCentreOverlay').classList.remove('hidden');
}

export function closeImportCentreModal(){
  document.getElementById('importCentreOverlay').classList.add('hidden');
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
