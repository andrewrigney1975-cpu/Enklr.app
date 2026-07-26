"use strict";
import { getCurrentProject } from '../store.js';
import { toast } from '../ui.js';
import { escapeHTML, canCurrentUserManageProject } from '../views/board.js';
import { isServerAuthoritative } from '../features/migration.js';
import { isOrgAdmin, dashboardApi, orgDashboardApi } from '../api.js';
import { utcISOToLocalDisplayDate } from '../date-utils.js';
import { confirmDialog } from './confirm.js';

var _toast = toast;

/* =========================================================
   DASHBOARDS PICKER — tiles for the current project's own Dashboards (any Project Member), or,
   for an Org Admin only, every Dashboard across the whole organisation (Portfolio pattern —
   root CLAUDE.md §4). Session-only state, reset every time the overlay opens, same convention as
   every other picker/list overlay in this app.
   ========================================================= */
var pickerScope = 'project'; // 'project' | 'org'
var pickerItems = [];
var pickerEditingId = null; // non-null while the inline create/rename form is open, for that id (null = creating new)

export function openDashboardsPickerOverlay(){
  var project = getCurrentProject();
  if(!project){ _toast('No project selected.'); return; }
  if(!isServerAuthoritative(project)){ _toast('Dashboards need a server-authoritative project.'); return; }

  pickerScope = 'project';
  pickerEditingId = null;
  document.getElementById('dashboardsPickerFormRow').classList.add('hidden');
  document.getElementById('dashboardsScopeProjectBtn').classList.add('active');
  document.getElementById('dashboardsScopeOrgBtn').classList.remove('active');
  document.getElementById('dashboardsPickerScopeTabs').classList.toggle('hidden', !isOrgAdmin());
  document.getElementById('dashboardsPickerNewBtn').classList.toggle('hidden', !canCurrentUserManageProject());
  document.getElementById('dashboardsPickerTitle').textContent = 'Dashboards — ' + project.name;
  document.getElementById('dashboardsPickerOverlay').classList.remove('hidden');
  loadAndRenderPicker();
}
export function closeDashboardsPickerOverlay(){
  document.getElementById('dashboardsPickerOverlay').classList.add('hidden');
}
export function isDashboardsPickerOverlayOpen(){
  return !document.getElementById('dashboardsPickerOverlay').classList.contains('hidden');
}

export function setDashboardsPickerScope(scope){
  if(scope === pickerScope) return;
  pickerScope = scope;
  document.getElementById('dashboardsScopeProjectBtn').classList.toggle('active', scope === 'project');
  document.getElementById('dashboardsScopeOrgBtn').classList.toggle('active', scope === 'org');
  // "New Dashboard" only ever creates in the CURRENT project — browsing another project's
  // Dashboards read-only doesn't imply being able to add to it.
  document.getElementById('dashboardsPickerNewBtn').classList.toggle('hidden', scope !== 'project' || !canCurrentUserManageProject());
  loadAndRenderPicker();
}

function loadAndRenderPicker(){
  var project = getCurrentProject();
  var grid = document.getElementById('dashboardsPickerGrid');
  grid.innerHTML = '<div class="kf-dashboard-tile-empty">Loading…</div>';

  var request = pickerScope === 'org' ? orgDashboardApi.list() : dashboardApi.list(project.serverProjectId);
  request.then(function(items){
    pickerItems = items || [];
    renderDashboardsPickerGrid();
  }, function(e){
    grid.innerHTML = '';
    _toast('Could not load dashboards: ' + (e.message || 'unknown error'));
  });
}

function renderDashboardsPickerGrid(){
  var grid = document.getElementById('dashboardsPickerGrid');
  if(pickerItems.length === 0){
    grid.innerHTML = '<div class="kf-dashboard-tile-empty">No dashboards yet' +
      (pickerScope === 'project' && canCurrentUserManageProject() ? ' — click "New Dashboard" to build one.' : '.') + '</div>';
    return;
  }
  grid.innerHTML = pickerItems.map(function(d){
    var projectLineHTML = pickerScope === 'org' ? '<div class="kf-dashboard-tile-project">' + escapeHTML(d.projectKey) + ' — ' + escapeHTML(d.projectName) + '</div>' : '';
    return '<button type="button" class="kf-dashboard-tile" data-dashboard-id="' + d.id + '"' +
      (pickerScope === 'org' ? ' data-project-id="' + d.projectId + '"' : '') + '>' +
      projectLineHTML +
      '<div class="kf-dashboard-tile-name">' + escapeHTML(d.name) + '</div>' +
      (d.description ? '<div class="kf-dashboard-tile-desc">' + escapeHTML(d.description) + '</div>' : '') +
      '<div class="kf-dashboard-tile-meta">' + d.widgetCount + ' widget' + (d.widgetCount === 1 ? '' : 's') +
        ' · updated ' + escapeHTML(utcISOToLocalDisplayDate(d.dateLastModified)) + '</div>' +
      '</button>';
  }).join('');

  grid.querySelectorAll('[data-dashboard-id]').forEach(function(tile){
    tile.addEventListener('click', function(){
      var dashboardId = tile.getAttribute('data-dashboard-id');
      var projectId = tile.getAttribute('data-project-id') || getCurrentProject().serverProjectId;
      openDashboardViewer(projectId, dashboardId);
    });
  });
}

// ---- Inline create form (no window.prompt anywhere in this app — see modals/project-search.js's
// own "Save Query" inline-reveal precedent for why this is a small form row, not a browser prompt) --

export function showDashboardCreateForm(){
  pickerEditingId = null;
  document.getElementById('dashboardFormNameInput').value = '';
  document.getElementById('dashboardFormDescInput').value = '';
  document.getElementById('dashboardsPickerFormRow').classList.remove('hidden');
  document.getElementById('dashboardFormNameInput').focus();
}
export function hideDashboardForm(){
  document.getElementById('dashboardsPickerFormRow').classList.add('hidden');
  pickerEditingId = null;
}

export function saveDashboardFromForm(){
  var project = getCurrentProject();
  var name = document.getElementById('dashboardFormNameInput').value.trim();
  if(!name){ _toast('Please enter a name.'); return; }
  var description = document.getElementById('dashboardFormDescInput').value.trim();
  var body = {name: name, description: description || null};

  var request = pickerEditingId
    ? dashboardApi.update(project.serverProjectId, pickerEditingId, body)
    : dashboardApi.create(project.serverProjectId, body);

  request.then(function(){
    hideDashboardForm();
    _toast(pickerEditingId ? 'Dashboard updated.' : 'Dashboard created.');
    loadAndRenderPicker();
  }, function(e){
    _toast('Could not save dashboard: ' + (e.message || 'unknown error'));
  });
}

export function deleteDashboardFromPicker(dashboardId, name){
  var project = getCurrentProject();
  confirmDialog(
    'Delete "' + name + '"?',
    'This deletes the dashboard and all of its widgets. This cannot be undone.',
    function(){
      dashboardApi.remove(project.serverProjectId, dashboardId).then(function(){
        _toast('Dashboard deleted.');
        loadAndRenderPicker();
      }, function(e){
        _toast('Could not delete dashboard: ' + (e.message || 'unknown error'));
      });
    }
  );
}

/* =========================================================
   DASHBOARD VIEWER — read-only render for any Project Member; Project Admin/Org Admin additionally
   get Edit Layout / Rename / Delete / Add Widget. Per-widget-type rendering (table/gauge/barGauge/
   chart/costBenefit/timeline/text) is built out across the rest of this feature's phases — for now
   every widget renders as a plain placeholder naming its own type, so the shell is fully usable
   (create/view/edit-layout/delete a Dashboard, add/remove/reorder widgets) ahead of the real
   per-type visualizations landing on top of it.
   ========================================================= */
var viewerProjectId = null;
var viewerDashboard = null;
var viewerEditMode = false;

export function openDashboardViewer(projectId, dashboardId){
  viewerProjectId = projectId;
  dashboardApi.get(projectId, dashboardId).then(function(dashboard){
    viewerDashboard = dashboard;
    viewerEditMode = false;
    closeDashboardsPickerOverlay();
    renderDashboardViewer();
    document.getElementById('dashboardViewerOverlay').classList.remove('hidden');
  }, function(e){
    _toast('Could not open dashboard: ' + (e.message || 'unknown error'));
  });
}
export function closeDashboardViewerOverlay(){
  document.getElementById('dashboardViewerOverlay').classList.add('hidden');
  viewerDashboard = null;
  viewerEditMode = false;
}
export function isDashboardViewerOverlayOpen(){
  return !document.getElementById('dashboardViewerOverlay').classList.contains('hidden');
}
export function backToDashboardsPickerFromViewer(){
  closeDashboardViewerOverlay();
  openDashboardsPickerOverlay();
}

function canEditThisDashboard(){
  // Only ever offered for the CURRENT project's own Dashboards — an Org Admin browsing another
  // project's Dashboard via the cross-org picker gets the same read-only view a member would,
  // same "view, don't manage, someone else's project" caution the Portfolio pattern's own
  // cross-project surfaces already take (jumping into another project's admin actions from a
  // cross-org list is a bigger, separate feature, not silently implied by being able to see it).
  var project = getCurrentProject();
  return !!project && project.serverProjectId === viewerProjectId && canCurrentUserManageProject();
}

export function toggleDashboardEditMode(){
  viewerEditMode = !viewerEditMode;
  renderDashboardViewer();
}

function renderDashboardViewer(){
  var d = viewerDashboard;
  var canEdit = canEditThisDashboard();

  document.getElementById('dashboardViewerTitle').textContent = d.name;
  var descEl = document.getElementById('dashboardViewerDescription');
  descEl.textContent = d.description || '';
  descEl.classList.toggle('hidden', !d.description);

  document.getElementById('dashboardViewerEditBtn').classList.toggle('hidden', !canEdit || viewerEditMode);
  document.getElementById('dashboardViewerDoneEditingBtn').classList.toggle('hidden', !canEdit || !viewerEditMode);
  document.getElementById('dashboardViewerRenameBtn').classList.toggle('hidden', !canEdit || !viewerEditMode);
  document.getElementById('dashboardViewerDeleteBtn').classList.toggle('hidden', !canEdit || !viewerEditMode);
  document.getElementById('dashboardViewerAddWidgetBtn').classList.toggle('hidden', !canEdit || !viewerEditMode);
  // Print is always available in the read-only render — wired properly in a later phase
  // (features/reports.js's #reportOverlay recipe); the button exists now so its slot in the
  // header doesn't visually jump once that lands.
  document.getElementById('dashboardViewerPrintBtn').classList.remove('hidden');

  renderDashboardViewerGrid();
}

function renderDashboardViewerGrid(){
  var grid = document.getElementById('dashboardViewerGrid');
  var widgets = (viewerDashboard.widgets || []).slice().sort(function(a, b){ return a.sortOrder - b.sortOrder; });

  if(widgets.length === 0){
    grid.innerHTML = '<div class="kf-dashboard-tile-empty">No widgets yet' +
      (viewerEditMode ? ' — click "Add Widget" to build this dashboard out.' : '.') + '</div>';
    return;
  }

  grid.innerHTML = widgets.map(function(w){
    var widthClass = w.width === 'third' ? ' kf-dashboard-widget-third' : (w.width === 'half' ? ' kf-dashboard-widget-half' : '');
    return '<div class="kf-dashboard-widget' + widthClass + '" data-widget-id="' + w.id + '">' +
      '<div class="kf-dashboard-widget-header">' +
        '<span class="kf-dashboard-widget-title">' + escapeHTML(w.title) + '</span>' +
        (viewerEditMode ? '<button type="button" class="kf-btn kf-btn-ghost kf-btn-sm" data-remove-widget="' + w.id + '" title="Remove widget"><span class="kf-icon">' +
          '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>' +
          '</span></button>' : '') +
      '</div>' +
      '<div class="kf-dashboard-widget-body">' + renderWidgetPlaceholder(w) + '</div>' +
      '</div>';
  }).join('');

  if(viewerEditMode){
    grid.querySelectorAll('[data-remove-widget]').forEach(function(btn){
      btn.addEventListener('click', function(e){
        e.stopPropagation();
        removeDashboardWidget(btn.getAttribute('data-remove-widget'));
      });
    });
  }
}

/* Placeholder body for every widget type until Phases 4-7 add the real per-type renderers
   (table/text first, then gauge/barGauge, then costBenefit/timeline, then chart). Deliberately
   honest about what it is rather than pretending to be a finished visualization. */
function renderWidgetPlaceholder(widget){
  var typeLabel = {
    table: 'Data Table', gauge: 'Gauge', barGauge: 'Bar Gauge', chart: 'Chart',
    costBenefit: 'Cost/Benefit Chart', timeline: 'Timeline', text: 'Text'
  }[widget.widgetType] || widget.widgetType;
  return '<div class="kf-dashboard-tile-empty">' + escapeHTML(typeLabel) + ' — rendering coming soon</div>';
}

function removeDashboardWidget(widgetId){
  dashboardApi.removeWidget(getCurrentProject().serverProjectId, viewerDashboard.id, widgetId).then(function(){
    return dashboardApi.get(viewerProjectId, viewerDashboard.id);
  }).then(function(dashboard){
    viewerDashboard = dashboard;
    renderDashboardViewerGrid();
  }, function(e){
    _toast('Could not remove widget: ' + (e.message || 'unknown error'));
  });
}

export function renameDashboardFromViewer(){
  // Reuses the picker's own inline form — simplest place for it to live is the picker overlay it
  // was already built for, so renaming from the viewer briefly hops back there rather than a
  // third, near-identical form. Captured BEFORE closing the viewer, since closing it clears
  // viewerDashboard.
  var id = viewerDashboard.id, name = viewerDashboard.name, description = viewerDashboard.description || '';
  closeDashboardViewerOverlay();
  openDashboardsPickerOverlay();
  showDashboardCreateForm();
  pickerEditingId = id;
  document.getElementById('dashboardFormNameInput').value = name;
  document.getElementById('dashboardFormDescInput').value = description;
}

export function deleteDashboardFromViewer(){
  var d = viewerDashboard;
  confirmDialog(
    'Delete "' + d.name + '"?',
    'This deletes the dashboard and all of its widgets. This cannot be undone.',
    function(){
      dashboardApi.remove(getCurrentProject().serverProjectId, d.id).then(function(){
        _toast('Dashboard deleted.');
        closeDashboardViewerOverlay();
      }, function(e){
        _toast('Could not delete dashboard: ' + (e.message || 'unknown error'));
      });
    }
  );
}
