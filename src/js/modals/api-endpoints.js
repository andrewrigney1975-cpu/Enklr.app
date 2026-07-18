"use strict";
import { getCurrentProject } from '../store.js';
import { escapeHTML, canCurrentUserManageProject, applyHeaderButtonVisibility } from '../views/board.js';
import { iconSvg } from '../icons.js';
import { toast } from '../ui.js';
import { isServerAuthoritative, refreshProjectFromServer } from '../features/migration.js';
import { savedQueryApi, testSavedQueryApi } from '../api.js';
import { confirmDialog } from './confirm.js';
import { projectQueryApiUrl } from './project-search.js';

/* =========================================================
   API ENDPOINTS MODAL
   Lists every saved query in the current project with ExposeViaApi=true (§20's Public Query API) —
   the toolbar/nav button that opens this is itself only shown once at least one such query exists
   (applyHeaderButtonVisibility() in views/board.js), so an empty list here shouldn't normally be
   reachable, but renderApiEndpointsList() still handles it defensively.
   ========================================================= */

// Which rows have their test-results panel expanded — a Set of saved query ids, same convention as
// views/task-list.js's ui.taskListExpanded. Starts empty (every row collapsed) each time the modal
// is (re)opened — see openApiEndpointsModal().
var expandedTestPanels = new Set();

export function openApiEndpointsModal(){
  if(!canCurrentUserManageProject()){ toast('Only a Project Administrator or Org Admin can manage API endpoints.'); return; }
  expandedTestPanels = new Set();
  renderApiEndpointsList();
  document.getElementById('apiEndpointsOverlay').classList.remove('hidden');
}

export function closeApiEndpointsModal(){
  document.getElementById('apiEndpointsOverlay').classList.add('hidden');
}

function exposedQueries(project){
  return ((project && project.savedQueries) || []).filter(function(q){ return q.exposeViaApi; });
}

function renderApiEndpointsList(){
  var project = getCurrentProject();
  var listEl = document.getElementById('apiEndpointsList');
  var queries = exposedQueries(project);
  if(queries.length === 0){
    listEl.innerHTML = '<div class="kf-query-saved-empty">No saved queries are currently exposed via the API.</div>';
    return;
  }
  listEl.innerHTML = queries.map(function(q){
    var expanded = expandedTestPanels.has(q.id);
    var panelHtml = !expanded ? '' :
      '<div class="kf-query-api-test-panel" data-test-panel-id="' + q.id + '">' +
        '<div class="kf-query-api-test-header"><span class="kf-query-api-test-status" data-test-status-id="' + q.id + '"></span></div>' +
        '<pre class="kf-query-api-test-result" data-test-result-id="' + q.id + '"></pre>' +
      '</div>';
    return '<div class="kf-api-endpoint-row">' +
      '<div class="kf-api-endpoint-row-header">' +
        '<button type="button" class="kf-tasklist-chevron' + (expanded ? ' expanded' : '') + '" data-toggle-id="' + q.id + '" aria-label="Toggle test results">' + iconSvg('chevronDown', 14) + '</button>' +
        '<span class="kf-api-endpoint-name">' + escapeHTML(q.name) + '</span>' +
      '</div>' +
      '<div class="kf-query-api-url-row">' +
        '<button type="button" class="kf-btn kf-btn-success kf-btn-sm" data-test-id="' + q.id + '">Test API (GET)</button>' +
        '<span class="kf-query-api-url-text">' + escapeHTML(projectQueryApiUrl(q.id)) + '</span>' +
        '<button type="button" class="kf-btn kf-btn-ghost kf-btn-sm" data-copy-id="' + q.id + '">Copy URL</button>' +
        '<button type="button" class="kf-btn kf-btn-danger kf-btn-sm" data-delete-id="' + q.id + '">Delete</button>' +
      '</div>' +
      panelHtml +
    '</div>';
  }).join('');
}

async function runApiEndpointTest(queryId){
  var project = getCurrentProject();
  if(!project) return;

  if(!expandedTestPanels.has(queryId)){
    expandedTestPanels.add(queryId);
    renderApiEndpointsList();
  }
  var statusEl = document.querySelector('[data-test-status-id="' + queryId + '"]');
  var resultEl = document.querySelector('[data-test-result-id="' + queryId + '"]');
  if(!statusEl || !resultEl) return;
  statusEl.className = 'kf-query-api-test-status';
  statusEl.textContent = 'Running...';
  resultEl.textContent = '';

  try {
    var result = await testSavedQueryApi(project.serverProjectId, queryId);
    statusEl.className = 'kf-query-api-test-status kf-query-api-test-status-ok';
    statusEl.textContent = '200 OK — ' + result.rows.length + ' row' + (result.rows.length === 1 ? '' : 's') +
      (result.truncated ? ' (truncated)' : '');
    resultEl.textContent = JSON.stringify(result, null, 2);
  } catch(e){
    statusEl.className = 'kf-query-api-test-status kf-query-api-test-status-error';
    statusEl.textContent = 'Request failed';
    resultEl.textContent = e.message || 'Unknown error';
  }
}

function copyApiEndpointUrl(queryId){
  if(!navigator.clipboard || !navigator.clipboard.writeText){
    toast('Clipboard access is not available in this browser.');
    return;
  }
  navigator.clipboard.writeText(projectQueryApiUrl(queryId)).then(function(){
    toast('Copied API URL to clipboard.');
  }, function(){
    toast('Could not copy to clipboard.');
  });
}

// "Delete" here unsets ExposeViaApi via the standard saved-query Update call — it never touches
// savedQueryApi.remove(), so the saved query itself (and its SQL) is untouched, only its public
// reachability. Row disappears immediately because renderApiEndpointsList() re-filters the
// just-refreshed project.savedQueries, and applyHeaderButtonVisibility() re-hides the toolbar/nav
// button too if this was the last exposed query in the project.
function confirmRemoveApiEndpoint(queryId){
  var project = getCurrentProject();
  if(!project || !isServerAuthoritative(project)) return;
  var query = (project.savedQueries || []).find(function(q){ return q.id === queryId; });
  if(!query) return;

  confirmDialog(
    'Remove "' + query.name + '" from the API?',
    'This unsets "Expose via API" for this saved query — the query itself is not deleted, and its public URL will stop working immediately.',
    async function(){
      try {
        await savedQueryApi.update(project.serverProjectId, queryId, {name: query.name, sql: query.sql, exposeViaApi: false});
        await refreshProjectFromServer(project.id);
        expandedTestPanels.delete(queryId);
        toast('Removed "' + query.name + '" from the API.');
        renderApiEndpointsList();
        applyHeaderButtonVisibility();
      } catch(e){
        toast('Could not update the query on the server: ' + (e.message || 'unknown error'));
      }
    }
  );
}

export function handleApiEndpointsListClick(e){
  var deleteBtn = e.target.closest('[data-delete-id]');
  if(deleteBtn){
    e.stopPropagation();
    confirmRemoveApiEndpoint(deleteBtn.getAttribute('data-delete-id'));
    return;
  }
  var copyBtn = e.target.closest('[data-copy-id]');
  if(copyBtn){
    e.stopPropagation();
    copyApiEndpointUrl(copyBtn.getAttribute('data-copy-id'));
    return;
  }
  var testBtn = e.target.closest('[data-test-id]');
  if(testBtn){
    e.stopPropagation();
    runApiEndpointTest(testBtn.getAttribute('data-test-id'));
    return;
  }
  var toggleBtn = e.target.closest('[data-toggle-id]');
  if(toggleBtn){
    e.stopPropagation();
    var id = toggleBtn.getAttribute('data-toggle-id');
    if(expandedTestPanels.has(id)) expandedTestPanels.delete(id);
    else expandedTestPanels.add(id);
    renderApiEndpointsList();
  }
}
