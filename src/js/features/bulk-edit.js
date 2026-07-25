"use strict";
import { ui, toast, getPriority } from '../ui.js';
import { getCurrentProject } from '../store.js';
import { getTasksArray, getColumn, getMemberById, memberLabel } from '../utils.js';
import { PRIORITY_ORDER, TASK_SCORE_MIN, TASK_SCORE_MAX, TASK_PROGRESS_MIN, TASK_PROGRESS_MAX, PRIORITY_META } from '../config.js';
import { clampTaskScore, clampProgress, utcISOToLocalDateValue, localDateValueToUTCISO } from '../date-utils.js';
import { moveTaskToColumn, pushTaskAuditEntry } from '../mutations.js';
import { saveDB, isTimeTrackingEnabled } from "../storage.js";
import { escapeHTML, renderBoard } from '../views/board.js';
import { isServerAuthoritative, applyBulkEditsOnServer } from './migration.js';
import { sortRows, createRowFilter } from './sort-filter.js';

function buildEl(tag, className, innerHTML){ var el = document.createElement(tag); if(className) el.className = className; if(innerHTML !== undefined) el.innerHTML = innerHTML; return el; }

var _confirmDialog = function(title, msg, cb){ if(window.confirm(title + '\n' + msg)) cb(); };
var _exportProjectJSON = function(){};
export function setBulkEditDeps(deps){
  if(deps.confirmDialog) _confirmDialog = deps.confirmDialog;
  if(deps.exportProjectJSON) _exportProjectJSON = deps.exportProjectJSON;
}

/* Progress is an opt-in extra column, inserted right before the
   (always-present, read-only) Status column. `field` is the key both the sort-header click
   handler and the per-column filter input key off — also fed into bulkEditColumnValue below to
   resolve the actual sortable/filterable value for a given task. */
function getBulkEditColumns(project){
  var cols = [
    {label: 'Key', field: 'key'}, {label: 'Title', field: 'title'}, {label: 'Column', field: 'columnId'},
    {label: 'Release', field: 'releaseId'}, {label: 'Priority', field: 'priority'}, {label: 'Type', field: 'typeId'},
    {label: 'Assignee', field: 'assigneeId'}, {label: 'Start', field: 'startDate'}, {label: 'End', field: 'endDate'},
    {label: 'Bus. Value', field: 'businessValue'}, {label: 'Task Cost', field: 'taskCost'}
  ];
  if(isTimeTrackingEnabled(project)) cols.push({label: 'Progress', field: 'progress'});
  cols.push({label: 'Status', field: 'status'});
  return cols;
}

export function openBulkEditOverlay(){
  var project = getCurrentProject();
  if(!project){ toast('No project selected.'); return; }
  ui.bulkEdits = {};
  // Sort/filter state is session-only, reset every time the overlay opens — same convention as
  // Task List's own ui.taskListSearch/ui.taskListSort reset in openTaskListOverlay, so a leftover
  // filter from a previous visit never silently hides tasks the next time this is opened.
  ui.bulkEditSort = {field: 'key', dir: 'asc'};
  ui.bulkEditFilters = {};
  document.getElementById('bulkEditTitle').textContent = 'Bulk Edit — ' + project.name;
  renderBulkEditHeader();
  renderBulkEditBody();
  updateBulkEditPendingState();
  document.getElementById('bulkEditOverlay').classList.remove('hidden');
}
export function closeBulkEditOverlay(){
  document.getElementById('bulkEditOverlay').classList.add('hidden');
  ui.bulkEdits = {};
}
export function isBulkEditOverlayOpen(){
  return !document.getElementById('bulkEditOverlay').classList.contains('hidden');
}

function renderBulkEditHeader(){
  var project = getCurrentProject();
  var header = document.getElementById('bulkEditHeader');
  var filterRow = document.getElementById('bulkEditFilterRow');
  var hasProgress = isTimeTrackingEnabled(project);
  header.classList.toggle('kf-bulkedit-has-progress', hasProgress);
  filterRow.classList.toggle('kf-bulkedit-has-progress', hasProgress);
  var cols = getBulkEditColumns(project);

  header.innerHTML = cols.map(function(col){
    var sorted = ui.bulkEditSort.field === col.field;
    var arrow = sorted ? (ui.bulkEditSort.dir === 'asc' ? ' ↑' : ' ↓') : '';
    return '<div class="kf-bulkedit-header-cell' + (sorted ? ' sorted' : '') + '" data-sort-field="' +
      col.field + '" title="Click to sort">' + escapeHTML(col.label) + arrow + '</div>';
  }).join('');
  header.querySelectorAll('[data-sort-field]').forEach(function(cell){
    cell.addEventListener('click', function(){
      var field = cell.getAttribute('data-sort-field');
      if(ui.bulkEditSort.field === field){
        ui.bulkEditSort.dir = ui.bulkEditSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        ui.bulkEditSort = {field: field, dir: 'asc'};
      }
      renderBulkEditHeader();
      renderBulkEditBody();
    });
  });

  // Per-column filter box — supports a plain substring term, a `>=`/`<=`/`>`/`<`/`=`/`!=`
  // comparator, or an `A..B` range against that column's own content (see features/sort-filter.js
  // for exactly what each column's raw value looks like and how each syntax is interpreted).
  filterRow.innerHTML = cols.map(function(col){
    return '<input type="text" class="kf-bulkedit-filter-input" data-filter-field="' + col.field +
      '" placeholder="Filter…" value="' + escapeHTML(ui.bulkEditFilters[col.field] || '') + '">';
  }).join('');
  filterRow.querySelectorAll('[data-filter-field]').forEach(function(input){
    input.addEventListener('input', function(){
      var field = input.getAttribute('data-filter-field');
      if(input.value.trim() === '') delete ui.bulkEditFilters[field];
      else ui.bulkEditFilters[field] = input.value;
      renderBulkEditBody();
    });
  });
}

function updateBulkEditPendingState(){
  var count = Object.keys(ui.bulkEdits).length;
  document.getElementById('bulkEditPendingCount').textContent =
    count > 0 ? count + ' task' + (count === 1 ? '' : 's') + ' with unsaved changes' : '';
  document.getElementById('bulkEditSaveBtn').disabled = count === 0;
}

function renderBulkEditBody(){
  var project = getCurrentProject();
  var body = document.getElementById('bulkEditBody');
  body.innerHTML = '';
  if(!project) return;

  var allTasks = getTasksArray(project);
  // Key-ascending first so sortRows' own stable Array#sort keeps ties (equal priority, equal
  // column, etc.) in a deterministic order rather than whatever Object.keys() insertion order
  // getTasksArray happened to produce — same tiebreak convention as Task List's own sort.
  allTasks.sort(function(a, b){ return a.key.localeCompare(b.key, undefined, {numeric: true}); });

  var filterPredicate = createRowFilter(ui.bulkEditFilters, function(t, field){
    return bulkEditColumnValue(project, t, field);
  });
  var tasks = allTasks.filter(filterPredicate);
  sortRows(tasks, function(t){ return bulkEditColumnValue(project, t, ui.bulkEditSort.field); },
    ui.bulkEditSort.dir === 'asc' ? 1 : -1);

  document.getElementById('bulkEditCount').textContent =
    (tasks.length === allTasks.length
      ? tasks.length + ' task' + (tasks.length === 1 ? '' : 's')
      : tasks.length + ' of ' + allTasks.length + ' tasks') +
    ' (including archived)';

  if(allTasks.length === 0){
    body.innerHTML = '<div class="kf-tasklist-empty">No tasks in this project yet.</div>';
    return;
  }
  if(tasks.length === 0){
    body.innerHTML = '<div class="kf-tasklist-empty">No tasks match the current filters.</div>';
    return;
  }

  tasks.forEach(function(t){
    body.appendChild(renderBulkEditRow(project, t));
  });
}

function bulkEditFieldValue(taskId, field, fallback){
  var edits = ui.bulkEdits[taskId];
  return (edits && edits.hasOwnProperty(field)) ? edits[field] : fallback;
}

/* Resolves column `field` (see getBulkEditColumns) to the raw value sort-filter.js's
   content-aware sort/filter should operate on for task `t` — reference-data ids (column, release,
   type, assignee) resolve to their current display name/label (reflecting any not-yet-saved
   pending edit in ui.bulkEdits, same as the row's own inputs do) so both sorting and filtering
   work against what's actually on screen, not an opaque id. */
function bulkEditColumnValue(project, t, field){
  switch(field){
    case 'key': return t.key;
    case 'title': return t.title;
    case 'columnId': {
      var col = getColumn(project, bulkEditFieldValue(t.id, 'columnId', t.columnId));
      return col ? col.name : '';
    }
    case 'releaseId': {
      var rid = bulkEditFieldValue(t.id, 'releaseId', t.releaseId);
      if(!rid) return '';
      var rel = (project.releases || []).find(function(r){ return r.id === rid; });
      return rel ? rel.name : '';
    }
    case 'priority':
      return getPriority(bulkEditFieldValue(t.id, 'priority', t.priority)).label;
    case 'typeId': {
      var tid = bulkEditFieldValue(t.id, 'typeId', t.typeId);
      if(!tid) return '';
      var tt = (project.taskTypes || []).find(function(x){ return x.id === tid; });
      return tt ? tt.name : '';
    }
    case 'assigneeId': {
      var aid = bulkEditFieldValue(t.id, 'assigneeId', t.assigneeId);
      if(!aid) return '';
      var m = getMemberById(project, aid);
      return m ? memberLabel(m) : '';
    }
    case 'startDate': return bulkEditFieldValue(t.id, 'startDate', t.startDate) || '';
    case 'endDate': return bulkEditFieldValue(t.id, 'endDate', t.endDate) || '';
    case 'businessValue': return bulkEditFieldValue(t.id, 'businessValue', t.businessValue);
    case 'taskCost': return bulkEditFieldValue(t.id, 'taskCost', t.taskCost);
    case 'progress': return bulkEditFieldValue(t.id, 'progress', clampProgress(t.progress));
    case 'status': return t.archived ? 'Archived' : 'Active';
    default: return '';
  }
}

function setBulkEditField(project, taskId, field, newValue, originalValue, inputEl){
  var isUnchanged = newValue === originalValue;
  if(isUnchanged){
    if(ui.bulkEdits[taskId]){
      delete ui.bulkEdits[taskId][field];
      if(Object.keys(ui.bulkEdits[taskId]).length === 0) delete ui.bulkEdits[taskId];
    }
    inputEl.classList.remove('kf-bulkedit-dirty');
  } else {
    if(!ui.bulkEdits[taskId]) ui.bulkEdits[taskId] = {};
    ui.bulkEdits[taskId][field] = newValue;
    inputEl.classList.add('kf-bulkedit-dirty');
  }
  updateBulkEditPendingState();
}

function renderBulkEditRow(project, t){
  var row = document.createElement('div');
  row.className = 'kf-bulkedit-row' + (t.archived ? ' kf-bulkedit-archived-row' : '') + (isTimeTrackingEnabled(project) ? ' kf-bulkedit-has-progress' : '');
  row.setAttribute('data-task-id', t.id);

  var keyEl = buildEl('span', 'kf-bulkedit-key', escapeHTML(t.key));
  var titleEl = buildEl('span', 'kf-bulkedit-title', escapeHTML(t.title));
  titleEl.title = t.title;
  row.appendChild(keyEl);
  row.appendChild(titleEl);

  // Column
  var columnSelect = document.createElement('select');
  project.columns.forEach(function(c){
    var opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    if(bulkEditFieldValue(t.id, 'columnId', t.columnId) === c.id) opt.selected = true;
    columnSelect.appendChild(opt);
  });
  columnSelect.addEventListener('change', function(){
    setBulkEditField(project, t.id, 'columnId', columnSelect.value, t.columnId, columnSelect);
  });
  row.appendChild(columnSelect);

  // Release
  var releaseSelect = document.createElement('select');
  var noReleaseOpt = document.createElement('option');
  noReleaseOpt.value = '';
  noReleaseOpt.textContent = 'No release';
  releaseSelect.appendChild(noReleaseOpt);
  (project.releases || []).slice().sort(function(a, b){
    return a.name.localeCompare(b.name, undefined, {numeric: true, sensitivity: 'base'});
  }).forEach(function(r){
    var opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = r.name;
    releaseSelect.appendChild(opt);
  });
  releaseSelect.value = bulkEditFieldValue(t.id, 'releaseId', t.releaseId) || '';
  releaseSelect.addEventListener('change', function(){
    setBulkEditField(project, t.id, 'releaseId', releaseSelect.value || null, t.releaseId || null, releaseSelect);
  });
  row.appendChild(releaseSelect);

  // Priority
  var prioritySelect = document.createElement('select');
  PRIORITY_ORDER.forEach(function(key){
    var opt = document.createElement('option');
    opt.value = key;
    opt.textContent = getPriority(key).label;
    if(bulkEditFieldValue(t.id, 'priority', t.priority) === key) opt.selected = true;
    prioritySelect.appendChild(opt);
  });
  prioritySelect.addEventListener('change', function(){
    setBulkEditField(project, t.id, 'priority', prioritySelect.value, t.priority, prioritySelect);
  });
  row.appendChild(prioritySelect);

  // Type
  var typeSelect = document.createElement('select');
  var noTypeOpt = document.createElement('option');
  noTypeOpt.value = '';
  noTypeOpt.textContent = 'No type';
  typeSelect.appendChild(noTypeOpt);
  (project.taskTypes || []).forEach(function(tt){
    var opt = document.createElement('option');
    opt.value = tt.id;
    opt.textContent = tt.name;
    typeSelect.appendChild(opt);
  });
  typeSelect.value = bulkEditFieldValue(t.id, 'typeId', t.typeId) || '';
  typeSelect.addEventListener('change', function(){
    setBulkEditField(project, t.id, 'typeId', typeSelect.value || null, t.typeId || null, typeSelect);
  });
  row.appendChild(typeSelect);

  // Assignee
  var assigneeSelect = document.createElement('select');
  var unassignedOpt = document.createElement('option');
  unassignedOpt.value = '';
  unassignedOpt.textContent = 'Unassigned';
  assigneeSelect.appendChild(unassignedOpt);
  (project.members || []).forEach(function(m){
    var opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = memberLabel(m);
    assigneeSelect.appendChild(opt);
  });
  var currentAssignee = bulkEditFieldValue(t.id, 'assigneeId', t.assigneeId) || '';
  assigneeSelect.value = currentAssignee;
  assigneeSelect.addEventListener('change', function(){
    setBulkEditField(project, t.id, 'assigneeId', assigneeSelect.value || null, t.assigneeId || null, assigneeSelect);
  });
  row.appendChild(assigneeSelect);

  // Start date
  var startInput = document.createElement('input');
  startInput.type = 'date';
  startInput.value = utcISOToLocalDateValue(bulkEditFieldValue(t.id, 'startDate', t.startDate));
  startInput.addEventListener('change', function(){
    var iso = localDateValueToUTCISO(startInput.value);
    setBulkEditField(project, t.id, 'startDate', iso, t.startDate || null, startInput);
  });
  row.appendChild(startInput);

  // End date
  var endInput = document.createElement('input');
  endInput.type = 'date';
  endInput.value = utcISOToLocalDateValue(bulkEditFieldValue(t.id, 'endDate', t.endDate));
  endInput.addEventListener('change', function(){
    var iso = localDateValueToUTCISO(endInput.value);
    setBulkEditField(project, t.id, 'endDate', iso, t.endDate || null, endInput);
  });
  row.appendChild(endInput);

  // Business Value
  var bvInput = document.createElement('input');
  bvInput.type = 'number';
  bvInput.min = TASK_SCORE_MIN; bvInput.max = TASK_SCORE_MAX;
  bvInput.value = bulkEditFieldValue(t.id, 'businessValue', t.businessValue);
  bvInput.addEventListener('change', function(){
    setBulkEditField(project, t.id, 'businessValue', clampTaskScore(bvInput.value), t.businessValue, bvInput);
  });
  row.appendChild(bvInput);

  // Task Cost
  var costInput = document.createElement('input');
  costInput.type = 'number';
  costInput.min = TASK_SCORE_MIN; costInput.max = TASK_SCORE_MAX;
  costInput.value = bulkEditFieldValue(t.id, 'taskCost', t.taskCost);
  costInput.addEventListener('change', function(){
    setBulkEditField(project, t.id, 'taskCost', clampTaskScore(costInput.value), t.taskCost, costInput);
  });
  row.appendChild(costInput);

  // Progress (opt-in, only when Time Tracking is enabled)
  if(isTimeTrackingEnabled(project)){
    var progressInput = document.createElement('input');
    progressInput.type = 'number';
    progressInput.min = TASK_PROGRESS_MIN; progressInput.max = TASK_PROGRESS_MAX;
    progressInput.value = bulkEditFieldValue(t.id, 'progress', clampProgress(t.progress));
    progressInput.addEventListener('change', function(){
      setBulkEditField(project, t.id, 'progress', clampProgress(progressInput.value), clampProgress(t.progress), progressInput);
    });
    row.appendChild(progressInput);
  }

  // Status (read-only)
  var statusEl = buildEl('span', 'kf-bulkedit-status-badge', t.archived ? 'Archived' : 'Active');
  row.appendChild(statusEl);

  return row;
}

function findInvalidBulkEditDateRow(project){
  var taskIds = Object.keys(ui.bulkEdits);
  for(var i = 0; i < taskIds.length; i++){
    var t = project.tasks[taskIds[i]];
    if(!t) continue;
    var effectiveStart = bulkEditFieldValue(t.id, 'startDate', t.startDate || null);
    var effectiveEnd = bulkEditFieldValue(t.id, 'endDate', t.endDate || null);
    if(effectiveStart && effectiveEnd && new Date(effectiveEnd).getTime() < new Date(effectiveStart).getTime()){
      return t;
    }
  }
  return null;
}

function normalizeOrFallback(value, fallback){
  return PRIORITY_META.hasOwnProperty(value) ? value : fallback;
}

function applyBulkEdits(project){
  var changedCount = 0;
  Object.keys(ui.bulkEdits).forEach(function(taskId){
    var t = project.tasks[taskId];
    if(!t) return;
    var edits = ui.bulkEdits[taskId];
    var touched = false;

    if(edits.hasOwnProperty('columnId') && edits.columnId && edits.columnId !== t.columnId){
      moveTaskToColumn(project, taskId, edits.columnId, -1);
      touched = true;
    }
    if(edits.hasOwnProperty('releaseId') && edits.releaseId !== t.releaseId){
      pushTaskAuditEntry(project, t, 'releaseId', t.releaseId, edits.releaseId || null);
      t.releaseId = edits.releaseId || null;
      touched = true;
    }
    if(edits.hasOwnProperty('priority') && edits.priority !== t.priority){
      var newPriority = normalizeOrFallback(edits.priority, t.priority);
      pushTaskAuditEntry(project, t, 'priority', t.priority, newPriority);
      t.priority = newPriority;
      touched = true;
    }
    if(edits.hasOwnProperty('typeId') && edits.typeId !== t.typeId){
      pushTaskAuditEntry(project, t, 'typeId', t.typeId, edits.typeId || null);
      t.typeId = edits.typeId || null;
      touched = true;
    }
    if(edits.hasOwnProperty('assigneeId') && edits.assigneeId !== t.assigneeId){
      pushTaskAuditEntry(project, t, 'assigneeId', t.assigneeId, edits.assigneeId || null);
      t.assigneeId = edits.assigneeId || null;
      touched = true;
    }
    if(edits.hasOwnProperty('startDate') && edits.startDate !== t.startDate){
      pushTaskAuditEntry(project, t, 'startDate', t.startDate, edits.startDate || null);
      t.startDate = edits.startDate || null;
      touched = true;
    }
    if(edits.hasOwnProperty('endDate') && edits.endDate !== t.endDate){
      pushTaskAuditEntry(project, t, 'endDate', t.endDate, edits.endDate || null);
      t.endDate = edits.endDate || null;
      touched = true;
    }
    if(edits.hasOwnProperty('businessValue')){
      var bv = clampTaskScore(edits.businessValue);
      if(bv !== t.businessValue){ pushTaskAuditEntry(project, t, 'businessValue', t.businessValue, bv); t.businessValue = bv; touched = true; }
    }
    if(edits.hasOwnProperty('taskCost')){
      var tc = clampTaskScore(edits.taskCost);
      if(tc !== t.taskCost){ pushTaskAuditEntry(project, t, 'taskCost', t.taskCost, tc); t.taskCost = tc; touched = true; }
    }
    if(edits.hasOwnProperty('progress')){
      var pr = clampProgress(edits.progress);
      if(pr !== clampProgress(t.progress)){ pushTaskAuditEntry(project, t, 'progress', t.progress, pr); t.progress = pr; touched = true; }
    }
    if(touched){
      t.dateLastModified = new Date().toISOString();
      changedCount++;
    }
  });
  if(changedCount > 0) saveDB();
  return changedCount;
}

export async function saveBulkEditChanges(){
  var project = getCurrentProject();
  if(!project) return;
  if(Object.keys(ui.bulkEdits).length === 0){ toast('No changes to save.'); return; }

  var invalidTask = findInvalidBulkEditDateRow(project);
  if(invalidTask){
    toast(invalidTask.key + ': end date cannot be before the start date. Fix it before saving.');
    return;
  }

  if(isServerAuthoritative(project)){
    try {
      var serverChangedCount = await applyBulkEditsOnServer(project, ui.bulkEdits);
      closeBulkEditOverlay();
      renderBoard();
      toast('Updated ' + serverChangedCount + ' task' + (serverChangedCount === 1 ? '' : 's') + '.');
    } catch(e){
      toast('Could not save bulk edits on the server: ' + (e.message || 'unknown error'));
    }
    return;
  }

  var changedCount = applyBulkEdits(project);
  closeBulkEditOverlay();
  renderBoard();
  toast('Updated ' + changedCount + ' task' + (changedCount === 1 ? '' : 's') + '.');

  if(changedCount > 0){
    _confirmDialog(
      'Back up this project?',
      'You just made a bulk change to ' + changedCount + ' task' + (changedCount === 1 ? '' : 's') + '. Would you like to export a backup now?',
      function(){ _exportProjectJSON(project); }
    );
  }
}
