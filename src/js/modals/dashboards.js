"use strict";
import { getCurrentProject } from '../store.js';
import { toast } from '../ui.js';
import { escapeHTML, canCurrentUserManageProject } from '../views/board.js';
import { isServerAuthoritative } from '../features/migration.js';
import { isOrgAdmin, dashboardApi, orgDashboardApi } from '../api.js';
import { utcISOToLocalDisplayDate } from '../date-utils.js';
import { confirmDialog } from './confirm.js';
import { renderDashboardWidget, resetDashboardTableWidgetState, exportTableWidgetCsv, WIDGET_TYPE_LABELS } from '../features/dashboard-widgets.js';
import { createRichTextEditor } from '../rich-text/editor.js';
import { iconSvg } from '../icons.js';

/* Print reuses features/reports.js's own #reportOverlay/print-CSS machinery (root CLAUDE.md's own
   "any new long, printable, read-only content is another consumer, not a reason to stand up a
   second overlay" precedent) — every widget is re-rendered once more in its read-only shape (no
   sort/filter headers, no CSV button, no edit controls) and concatenated into one document. */
export function printDashboardFromViewer(){
  var project = getCurrentProject();
  var d = viewerDashboard;
  if(!d) return;
  var widgets = (d.widgets || []).slice().sort(function(a, b){ return a.sortOrder - b.sortOrder; });
  document.getElementById('reportTitle').textContent = project.name + ' - ' + d.name;
  document.getElementById('reportBody').innerHTML = widgets.length
    ? widgets.map(function(w){
        var rendered = renderDashboardWidget(w, project, {readOnly: true, canExport: false});
        return '<div class="kf-dashboard-print-widget">' +
          '<h3 class="kf-report-item-title">' + escapeHTML(w.title) + '</h3>' +
          rendered.html +
        '</div>';
      }).join('')
    : '<div class="kf-health-empty">No widgets yet.</div>';
  document.getElementById('reportOverlay').classList.remove('hidden');
}

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

// Session-only, per-widget — never persisted, reset every time the viewer closes (same convention
// as tableWidgetState's own sort/filter/pagination). Collapsing is a screen-only display preference;
// printDashboardFromViewer always prints every widget's full content regardless of this state.
var collapsedWidgetIds = {};

export function openDashboardViewer(projectId, dashboardId){
  viewerProjectId = projectId;
  dashboardApi.get(projectId, dashboardId).then(function(dashboard){
    viewerDashboard = dashboard;
    viewerEditMode = false;
    collapsedWidgetIds = {};
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
  collapsedWidgetIds = {};
  resetDashboardTableWidgetState();
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

function sortedWidgets(){
  return (viewerDashboard.widgets || []).slice().sort(function(a, b){ return a.sortOrder - b.sortOrder; });
}

function renderDashboardViewerGrid(){
  var grid = document.getElementById('dashboardViewerGrid');
  var widgets = sortedWidgets();
  var editMode = viewerEditMode && canEditThisDashboard();
  var project = getCurrentProject();

  if(widgets.length === 0){
    grid.innerHTML = '<div class="kf-dashboard-tile-empty">No widgets yet' +
      (editMode ? ' — click "Add Widget" to build this dashboard out.' : '.') + '</div>';
    return;
  }

  var canExport = canCurrentUserManageProject();

  // `readOnly` here means "static, non-interactive print output" (see printDashboardFromViewer) —
  // it is NOT the same thing as `editMode` above. A table widget's own sort/filter/CSV-export stay
  // fully interactive whether or not the dashboard's structural layout editor (add/remove/reorder
  // widgets) happens to be open, per the plan's "Any Project Member can sort/filter/print" row.
  //
  // Collapsed widgets skip rendering their body content entirely (not just hiding it via CSS) — a
  // collapsed widget's Saved Query never even runs, so collapsing a slow/large table also saves the
  // work, not just the screen space.
  grid.innerHTML = widgets.map(function(w, i){
    var widthClass = w.width === 'third' ? ' kf-dashboard-widget-third'
      : w.width === 'half' ? ' kf-dashboard-widget-half'
      : w.width === 'twoThird' ? ' kf-dashboard-widget-two-third'
      : '';
    var collapsed = !!collapsedWidgetIds[w.id];
    var rendered = collapsed ? {html: '', wire: null} : renderDashboardWidget(w, project, {readOnly: false, canExport: canExport});
    var showHeaderExport = w.widgetType === 'table' && canExport;
    return '<div class="kf-dashboard-widget' + widthClass + (collapsed ? ' kf-dashboard-widget-collapsed' : '') + '" data-widget-id="' + w.id + '">' +
      '<div class="kf-dashboard-widget-header">' +
        '<button type="button" class="kf-dashboard-widget-collapse-btn" data-widget-collapse="' + w.id + '" aria-expanded="' + (collapsed ? 'false' : 'true') + '" title="' + (collapsed ? 'Expand' : 'Collapse') + '"><span class="kf-dashboard-widget-chevron' + (collapsed ? '' : ' expanded') + '">' + iconSvg('chevronDown', 14) + '</span></button>' +
        '<span class="kf-dashboard-widget-title">' + escapeHTML(w.title) + '</span>' +
        '<div class="kf-dashboard-widget-actions">' +
          (showHeaderExport ? '<button type="button" class="kf-btn kf-btn-ghost kf-btn-sm" data-widget-export-header="' + w.id + '" title="Export as CSV"><span class="kf-icon">' + iconSvg('download', 14) + '</span>Export as CSV</button>' : '') +
          (editMode ?
            (i > 0 ? '<button type="button" class="kf-btn kf-btn-ghost kf-btn-sm" data-move-widget-up="' + w.id + '" title="Move up"><span class="kf-icon" style="transform:rotate(90deg);">' + iconSvg('chevronLeft', 14) + '</span></button>' : '') +
            (i < widgets.length - 1 ? '<button type="button" class="kf-btn kf-btn-ghost kf-btn-sm" data-move-widget-down="' + w.id + '" title="Move down"><span class="kf-icon" style="transform:rotate(-90deg);">' + iconSvg('chevronLeft', 14) + '</span></button>' : '') +
            '<button type="button" class="kf-btn kf-btn-ghost kf-btn-sm" data-edit-widget="' + w.id + '" title="Configure widget"><span class="kf-icon">' + iconSvg('edit', 14) + '</span></button>' +
            '<button type="button" class="kf-btn kf-btn-ghost kf-btn-sm" data-remove-widget="' + w.id + '" title="Remove widget"><span class="kf-icon">' +
            '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>' +
            '</span></button>' : '') +
        '</div>' +
      '</div>' +
      '<div class="kf-dashboard-widget-body">' + rendered.html + '</div>' +
      '</div>';
  }).join('');

  widgets.forEach(function(w){
    if(collapsedWidgetIds[w.id]) return;
    var rendered = renderDashboardWidget(w, project, {readOnly: false, canExport: canExport});
    if(rendered.wire) rendered.wire(grid, renderDashboardViewerGrid);
  });

  grid.querySelectorAll('[data-widget-collapse]').forEach(function(btn){
    btn.addEventListener('click', function(e){
      e.stopPropagation();
      var id = btn.getAttribute('data-widget-collapse');
      collapsedWidgetIds[id] = !collapsedWidgetIds[id];
      renderDashboardViewerGrid();
    });
  });

  grid.querySelectorAll('[data-widget-export-header]').forEach(function(btn){
    btn.addEventListener('click', function(e){
      e.stopPropagation();
      var w = widgets.find(function(x){ return x.id === btn.getAttribute('data-widget-export-header'); });
      if(w) exportTableWidgetCsv(w, project);
    });
  });

  if(editMode){
    grid.querySelectorAll('[data-remove-widget]').forEach(function(btn){
      btn.addEventListener('click', function(e){
        e.stopPropagation();
        removeDashboardWidget(btn.getAttribute('data-remove-widget'));
      });
    });
    grid.querySelectorAll('[data-edit-widget]').forEach(function(btn){
      btn.addEventListener('click', function(e){
        e.stopPropagation();
        openWidgetForm(btn.getAttribute('data-edit-widget'));
      });
    });
    grid.querySelectorAll('[data-move-widget-up]').forEach(function(btn){
      btn.addEventListener('click', function(e){
        e.stopPropagation();
        moveWidget(btn.getAttribute('data-move-widget-up'), -1);
      });
    });
    grid.querySelectorAll('[data-move-widget-down]').forEach(function(btn){
      btn.addEventListener('click', function(e){
        e.stopPropagation();
        moveWidget(btn.getAttribute('data-move-widget-down'), 1);
      });
    });
  }

  renderDashboardWidgetOrderList(widgets, editMode);
}

/* Widget-order list — a compact, always-legible alternative to hunting for a specific widget's own
   up/down arrows on a potentially tall/scrolled-past card (especially once a dashboard has several
   full-width widgets stacked). Only shown while the layout editor is open; reuses the exact same
   moveWidget() the per-card arrows already call, so both controls stay in lockstep. */
function renderDashboardWidgetOrderList(widgets, editMode){
  var section = document.getElementById('dashboardWidgetOrderSection');
  var list = document.getElementById('dashboardWidgetOrderList');
  section.classList.toggle('hidden', !editMode);
  if(!editMode) return;

  list.innerHTML = widgets.map(function(w, i){
    return '<div class="kf-dashboard-order-row" data-widget-id="' + w.id + '">' +
      '<span class="kf-dashboard-order-row-title">' + escapeHTML(w.title) + '</span>' +
      '<span class="kf-dashboard-order-row-type">' + escapeHTML(WIDGET_TYPE_LABELS[w.widgetType] || w.widgetType) + '</span>' +
      '<button type="button" class="kf-btn kf-btn-ghost kf-btn-sm" data-order-move-up="' + w.id + '" title="Move up"' + (i === 0 ? ' disabled' : '') + '><span class="kf-icon" style="transform:rotate(90deg);">' + iconSvg('chevronLeft', 14) + '</span></button>' +
      '<button type="button" class="kf-btn kf-btn-ghost kf-btn-sm" data-order-move-down="' + w.id + '" title="Move down"' + (i === widgets.length - 1 ? ' disabled' : '') + '><span class="kf-icon" style="transform:rotate(-90deg);">' + iconSvg('chevronLeft', 14) + '</span></button>' +
    '</div>';
  }).join('');

  list.querySelectorAll('[data-order-move-up]').forEach(function(btn){
    btn.addEventListener('click', function(){ moveWidget(btn.getAttribute('data-order-move-up'), -1); });
  });
  list.querySelectorAll('[data-order-move-down]').forEach(function(btn){
    btn.addEventListener('click', function(){ moveWidget(btn.getAttribute('data-order-move-down'), 1); });
  });
}

/* Swaps the moved widget's sortOrder with its neighbor's and persists both — simplest possible
   reorder for this feature's deliberately-structured (not drag-to-any-position) layout editor. */
function moveWidget(widgetId, direction){
  var widgets = sortedWidgets();
  var idx = widgets.findIndex(function(w){ return w.id === widgetId; });
  var otherIdx = idx + direction;
  if(idx < 0 || otherIdx < 0 || otherIdx >= widgets.length) return;
  var a = widgets[idx], b = widgets[otherIdx];
  var aSortOrder = a.sortOrder, bSortOrder = b.sortOrder; // captured before either request fires, so neither body ever reads a value the other request already overwrote
  var project = getCurrentProject();
  Promise.all([
    dashboardApi.updateWidget(project.serverProjectId, viewerDashboard.id, a.id, widgetToBody(a, bSortOrder)),
    dashboardApi.updateWidget(project.serverProjectId, viewerDashboard.id, b.id, widgetToBody(b, aSortOrder))
  ]).then(function(){
    return dashboardApi.get(viewerProjectId, viewerDashboard.id);
  }).then(function(dashboard){
    viewerDashboard = dashboard;
    renderDashboardViewerGrid();
  }, function(e){
    _toast('Could not reorder widgets: ' + (e.message || 'unknown error'));
  });
}

function widgetToBody(w, sortOrder){
  return {
    widgetType: w.widgetType, title: w.title, savedQueryId: w.savedQueryId || null,
    width: w.width, sortOrder: sortOrder, configJson: w.configJson || null
  };
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

/* =========================================================
   WIDGET ADD/EDIT FORM — structured, not free-form: Title/Type/Width/Saved Query, plus a small set
   of type-specific config fields (column-name text inputs, no live query preview — matches the
   plan's own "server-unvalidated blob, frontend owns interpreting it" design). Text widgets skip the
   Saved Query field entirely and get a rich-text editor instead of ConfigJson fields.
   ========================================================= */

// Widget being edited, or null when the form is creating a brand-new widget.
var widgetFormEditingId = null;
var widgetTextEditor = null;

function getWidgetTextEditor(){
  if(!widgetTextEditor){
    widgetTextEditor = createRichTextEditor(document.getElementById('dashboardWidgetTextEditor'), document.getElementById('dashboardWidgetTextToolbar'), {maxLength: 8000});
  }
  return widgetTextEditor;
}

// type -> array of {key, label, type: 'text'|'number'|'select', options, placeholder, defaultValue}
var CONFIG_FIELD_DEFS = {
  table: [],
  text: [],
  costBenefit: [],
  gauge: [
    {key: 'valueColumn', label: 'Value column (0-100, from the first result row)', type: 'text', placeholder: 'e.g. pct'},
    {key: 'maxValue', label: 'Max value', type: 'number', defaultValue: 100}
  ],
  barGauge: [
    {key: 'valueColumn', label: 'Value column (from the first result row)', type: 'text', placeholder: 'e.g. count'},
    {key: 'maxValue', label: 'Max value', type: 'number', defaultValue: 100},
    {key: 'orientation', label: 'Orientation', type: 'select', options: [{value: 'horizontal', label: 'Horizontal'}, {value: 'vertical', label: 'Vertical'}], defaultValue: 'horizontal'}
  ],
  chart: [
    {key: 'chartType', label: 'Chart type', type: 'select', options: [{value: 'bar', label: 'Bar'}, {value: 'line', label: 'Line'}, {value: 'pie', label: 'Pie'}, {value: 'donut', label: 'Donut'}], defaultValue: 'bar'},
    {key: 'categoryColumn', label: 'Category column', type: 'text', placeholder: 'e.g. priority'},
    {key: 'valueColumn', label: 'Value column', type: 'text', placeholder: 'e.g. count'}
  ],
  timeline: [
    {key: 'labelColumn', label: 'Label column', type: 'text', placeholder: 'e.g. title'},
    {key: 'startColumn', label: 'Start date column', type: 'text', placeholder: 'e.g. startDate'},
    {key: 'endColumn', label: 'End date column', type: 'text', placeholder: 'e.g. endDate'}
  ]
};

function renderConfigFields(type, config){
  var defs = CONFIG_FIELD_DEFS[type] || [];
  var container = document.getElementById('dashboardWidgetConfigFields');
  if(defs.length === 0){
    container.innerHTML = type === 'costBenefit'
      ? '<div class="kf-dashboard-tile-empty">Expects the query to return businessValue, taskCost, priority, key, and title columns.</div>'
      : '';
    return;
  }
  container.innerHTML = defs.map(function(def){
    var value = config[def.key] != null ? config[def.key] : (def.defaultValue != null ? def.defaultValue : '');
    if(def.type === 'select'){
      return '<div class="kf-field"><label>' + escapeHTML(def.label) + '</label><select data-config-key="' + def.key + '">' +
        def.options.map(function(o){ return '<option value="' + o.value + '"' + (o.value === value ? ' selected' : '') + '>' + escapeHTML(o.label) + '</option>'; }).join('') +
        '</select></div>';
    }
    return '<div class="kf-field"><label>' + escapeHTML(def.label) + '</label><input type="' + (def.type === 'number' ? 'number' : 'text') + '" data-config-key="' + def.key + '"' +
      (def.placeholder ? ' placeholder="' + escapeHTML(def.placeholder) + '"' : '') + ' value="' + escapeHTML(String(value)) + '"></div>';
  }).join('');
}

function readConfigFieldsIntoObject(type){
  var defs = CONFIG_FIELD_DEFS[type] || [];
  var config = {};
  defs.forEach(function(def){
    var el = document.querySelector('#dashboardWidgetConfigFields [data-config-key="' + def.key + '"]');
    if(!el) return;
    config[def.key] = def.type === 'number' ? Number(el.value) : el.value;
  });
  return config;
}

function updateWidgetFormFieldsForType(type, config){
  document.getElementById('dashboardWidgetSavedQueryField').classList.toggle('hidden', type === 'text');
  document.getElementById('dashboardWidgetTextField').classList.toggle('hidden', type !== 'text');
  document.getElementById('dashboardWidgetConfigFields').classList.toggle('hidden', type === 'text');
  renderConfigFields(type, config || {});
  if(type === 'text') getWidgetTextEditor().setMarkdown((config && config.markdown) || '');
}

function populateSavedQuerySelect(selectedId){
  var project = getCurrentProject();
  var select = document.getElementById('dashboardWidgetSavedQuerySelect');
  var queries = (project && project.savedQueries) || [];
  if(queries.length === 0){
    select.innerHTML = '<option value="">No saved queries yet — create one in Advanced Query first</option>';
    return;
  }
  select.innerHTML = queries.map(function(q){
    return '<option value="' + q.id + '"' + (q.id === selectedId ? ' selected' : '') + '>' + escapeHTML(q.name) + '</option>';
  }).join('');
}

export function openWidgetForm(widgetId){
  widgetFormEditingId = widgetId || null;
  var widget = widgetId ? (viewerDashboard.widgets || []).find(function(w){ return w.id === widgetId; }) : null;
  var config = widget ? parseWidgetConfigJson(widget.configJson) : {};

  document.getElementById('dashboardWidgetFormTitle').textContent = widget ? 'Edit Widget' : 'Add Widget';
  document.getElementById('dashboardWidgetTitleInput').value = widget ? widget.title : '';
  document.getElementById('dashboardWidgetTypeSelect').value = widget ? widget.widgetType : 'table';
  document.getElementById('dashboardWidgetTypeSelect').disabled = !!widget; // changing type on an existing widget would orphan its config shape — delete + re-add instead
  document.getElementById('dashboardWidgetWidthSelect').value = widget ? widget.width : 'full';

  populateSavedQuerySelect(widget ? widget.savedQueryId : null);
  updateWidgetFormFieldsForType(widget ? widget.widgetType : 'table', config);

  document.getElementById('dashboardWidgetFormOverlay').classList.remove('hidden');
}
export function closeWidgetForm(){
  document.getElementById('dashboardWidgetFormOverlay').classList.add('hidden');
  widgetFormEditingId = null;
}
export function onDashboardWidgetTypeChanged(){
  updateWidgetFormFieldsForType(document.getElementById('dashboardWidgetTypeSelect').value, {});
}

function parseWidgetConfigJson(configJson){
  if(!configJson) return {};
  try { var c = JSON.parse(configJson); return (c && typeof c === 'object') ? c : {}; }
  catch(e){ return {}; }
}

export function saveWidgetForm(){
  var title = document.getElementById('dashboardWidgetTitleInput').value.trim();
  if(!title){ _toast('Please enter a title.'); return; }
  var type = document.getElementById('dashboardWidgetTypeSelect').value;
  var width = document.getElementById('dashboardWidgetWidthSelect').value;
  var savedQueryId = type === 'text' ? null : (document.getElementById('dashboardWidgetSavedQuerySelect').value || null);
  if(type !== 'text' && !savedQueryId){ _toast('Please choose a Saved Query.'); return; }

  var config = type === 'text' ? {markdown: getWidgetTextEditor().getMarkdown()} : readConfigFieldsIntoObject(type);
  var project = getCurrentProject();
  var existingWidgets = viewerDashboard.widgets || [];
  var body = {
    widgetType: type, title: title, savedQueryId: savedQueryId, width: width,
    sortOrder: widgetFormEditingId ? existingWidgets.find(function(w){ return w.id === widgetFormEditingId; }).sortOrder : existingWidgets.length,
    configJson: JSON.stringify(config)
  };

  var request = widgetFormEditingId
    ? dashboardApi.updateWidget(project.serverProjectId, viewerDashboard.id, widgetFormEditingId, body)
    : dashboardApi.createWidget(project.serverProjectId, viewerDashboard.id, body);

  request.then(function(){
    closeWidgetForm();
    return dashboardApi.get(viewerProjectId, viewerDashboard.id);
  }).then(function(dashboard){
    viewerDashboard = dashboard;
    renderDashboardViewerGrid();
    _toast(widgetFormEditingId ? 'Widget updated.' : 'Widget added.');
  }, function(e){
    _toast('Could not save widget: ' + (e.message || 'unknown error'));
  });
}
