"use strict";
import { ui, toast, getPriority } from '../ui.js';
import { getCurrentProject } from '../store.js';
import { getTasksArray, getDescendants, wouldCreateCycle } from '../utils.js';
import { clampTaskScore, utcISOToLocalDateValue, localDateValueToUTCISO, defaultStartDateValue, defaultEndDateValue } from '../date-utils.js';
import { iconSvg } from '../icons.js';
import { PRIORITY_ORDER } from '../config.js';
import { escapeHTML, renderBoard } from '../views/board.js';
import { addTask, updateTask, deleteTask, normalizeDocumentationUrl } from '../mutations.js';
import { confirmDialog } from './confirm.js';
import { getReachableColumnIds } from '../features/workflow-engine.js';

export function openTaskModal(taskId, defaultColumnId){
  var project = getCurrentProject();
  if(!project) return;
  ui.editingTaskId = taskId;
  ui.taskModalColumnId = defaultColumnId || (project.columns[0] && project.columns[0].id);
  ui.depSearchTerm = '';

  var task = taskId ? project.tasks[taskId] : null;
  ui.taskModalDeps = task ? (task.dependencies || []).slice() : [];

  document.getElementById('taskModalTitle').textContent = task ? 'Edit ' + task.key : 'New task';
  var typeSelect = document.getElementById('taskTypeSelect');
  typeSelect.innerHTML = '';
  var noTypeOpt = document.createElement('option');
  noTypeOpt.value = '';
  noTypeOpt.textContent = 'No type';
  typeSelect.appendChild(noTypeOpt);
  (project.taskTypes || []).forEach(function(tt){
    var opt = document.createElement('option');
    opt.value = tt.id;
    opt.textContent = tt.name;
    if(task && task.typeId === tt.id) opt.selected = true;
    typeSelect.appendChild(opt);
  });

  document.getElementById('taskTitleInput').value = task ? task.title : '';
  document.getElementById('taskDescInput').value = task ? task.description : '';
  document.getElementById('taskDocUrlInput').value = task && task.documentationUrl ? task.documentationUrl : '';
  updateDocUrlOpenButtonVisibility();
  document.getElementById('taskPrioritySelect').value = task ? task.priority : 'medium';
  updatePriorityIcon();

  var colSelect = document.getElementById('taskColumnSelect');
  colSelect.innerHTML = '';
  var currentColumnId = task ? task.columnId : ui.taskModalColumnId;
  /* A Conditional edge needs real task properties to evaluate against.
     An existing task has them; a brand-new one doesn't yet, so a
     synthetic task shaped like what addTask() would create is used
     instead — the same defaults the form itself starts with. */
  var taskForReachability = task || {
    columnId: ui.taskModalColumnId,
    assigneeId: null, releaseId: null, typeId: null, documentationUrl: null,
    priority: 'medium', businessValue: 1, taskCost: 1, archived: false, dependencies: []
  };
  var reachableColumnIds = getReachableColumnIds(project, taskForReachability);
  project.columns.forEach(function(c){
    if(!reachableColumnIds.has(c.id)) return;
    var opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    if(currentColumnId === c.id) opt.selected = true;
    colSelect.appendChild(opt);
  });

  var releaseSelect = document.getElementById('taskReleaseSelect');
  releaseSelect.innerHTML = '';
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
    if(task && task.releaseId === r.id) opt.selected = true;
    releaseSelect.appendChild(opt);
  });

  var assigneeSelect = document.getElementById('taskAssigneeSelect');
  assigneeSelect.innerHTML = '';
  var unassignedOpt = document.createElement('option');
  unassignedOpt.value = '';
  unassignedOpt.textContent = 'Unassigned';
  assigneeSelect.appendChild(unassignedOpt);
  (project.members || []).forEach(function(m){
    var opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name;
    if(task && task.assigneeId === m.id) opt.selected = true;
    assigneeSelect.appendChild(opt);
  });
  if(!task || !task.assigneeId) unassignedOpt.selected = true;

  document.getElementById('taskStartDateInput').value = task ? utcISOToLocalDateValue(task.startDate) : defaultStartDateValue();
  document.getElementById('taskEndDateInput').value = task ? utcISOToLocalDateValue(task.endDate) : defaultEndDateValue();
  document.getElementById('taskBusinessValueInput').value = task ? clampTaskScore(task.businessValue) : 1;
  document.getElementById('taskCostInput').value = task ? clampTaskScore(task.taskCost) : 1;
  document.getElementById('taskArchivedCheckbox').checked = !!(task && task.archived);

  document.getElementById('taskDeleteBtn').classList.toggle('kf-vis-hidden', !task);
  document.getElementById('depSearchInput').value = '';

  renderDependencyPicker();
  document.getElementById('taskOverlay').classList.remove('hidden');
  document.getElementById('taskTitleInput').focus();
}

export function updatePriorityIcon(){
  var val = document.getElementById('taskPrioritySelect').value;
  var conf = getPriority(val);
  var iconEl = document.getElementById('taskPriorityIcon');
  iconEl.style.color = conf.color;
  iconEl.innerHTML = iconSvg(conf.icon, 18);
}

export function updateDocUrlOpenButtonVisibility(){
  var hasValue = document.getElementById('taskDocUrlInput').value.trim().length > 0;
  document.getElementById('taskDocUrlOpenBtn').classList.toggle('hidden', !hasValue);
}
export function openDocUrlInNewTab(){
  var raw = document.getElementById('taskDocUrlInput').value;
  var url = normalizeDocumentationUrl(raw);
  if(!url) return;
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function renderDependencyPicker(){
  var project = getCurrentProject();
  var chipsWrap = document.getElementById('depChipsSelected');
  var listWrap = document.getElementById('depList');
  chipsWrap.innerHTML = '';
  listWrap.innerHTML = '';

  if(ui.taskModalDeps.length === 0){
    chipsWrap.innerHTML = '<span style="font-size:12px;color:var(--kf-text-faint);">No dependencies selected</span>';
  }
  ui.taskModalDeps.forEach(function(depId){
    var t = project.tasks[depId];
    if(!t) return;
    var chip = document.createElement('span');
    chip.className = 'kf-dep-chip-removable';
    chip.innerHTML = '<span>' + escapeHTML(t.key) + '</span><button type="button" aria-label="Remove dependency">' + iconSvg('close',12) + '</button>';
    chip.querySelector('button').addEventListener('click', function(){
      ui.taskModalDeps = ui.taskModalDeps.filter(function(id){ return id !== depId; });
      renderDependencyPicker();
    });
    chipsWrap.appendChild(chip);
  });

  var disallowed = new Set();
  disallowed.add(ui.editingTaskId);
  if(ui.editingTaskId){
    getDescendants(project, ui.editingTaskId).forEach(function(id){ disallowed.add(id); });
  }

  var candidates = getTasksArray(project).filter(function(t){
    if(t.id === ui.editingTaskId) return false;
    if(t.archived) return false;
    if(ui.depSearchTerm){
      var hay = (t.key + ' ' + t.title).toLowerCase();
      if(hay.indexOf(ui.depSearchTerm.toLowerCase()) === -1) return false;
    }
    return true;
  }).sort(function(a,b){ return a.key.localeCompare(b.key, undefined, {numeric:true}); });

  if(candidates.length === 0){
    listWrap.innerHTML = '<div class="kf-empty-note">No matching tasks.</div>';
    return;
  }

  candidates.forEach(function(t){
    var row = document.createElement('label');
    var isDisallowed = disallowed.has(t.id);
    row.className = 'kf-dep-row' + (isDisallowed ? ' disabled' : '');
    var checked = ui.taskModalDeps.indexOf(t.id) !== -1;
    row.innerHTML =
      '<input type="checkbox" ' + (checked?'checked':'') + (isDisallowed?'disabled':'') + '>' +
      '<span class="kf-dep-key">' + escapeHTML(t.key) + '</span>' +
      '<span class="kf-dep-title">' + escapeHTML(t.title) + '</span>';
    if(isDisallowed){
      row.title = 'Selecting this would create a circular dependency';
    }
    var cb = row.querySelector('input');
    cb.addEventListener('change', function(){
      if(cb.checked){
        if(ui.taskModalDeps.indexOf(t.id) === -1) ui.taskModalDeps.push(t.id);
      } else {
        ui.taskModalDeps = ui.taskModalDeps.filter(function(id){ return id !== t.id; });
      }
      renderDependencyPicker();
    });
    listWrap.appendChild(row);
  });
}

export function closeTaskModal(){
  document.getElementById('taskOverlay').classList.add('hidden');
  ui.editingTaskId = null;
}

export function saveTaskFromModal(){
  var project = getCurrentProject();
  var title = document.getElementById('taskTitleInput').value.trim();
  if(!title){
    toast('Please enter a task title.');
    document.getElementById('taskTitleInput').focus();
    return;
  }

  var startDateValue = document.getElementById('taskStartDateInput').value;
  var endDateValue = document.getElementById('taskEndDateInput').value;
  var startISO = localDateValueToUTCISO(startDateValue);
  var endISO = localDateValueToUTCISO(endDateValue);
  if(startISO && endISO && new Date(endISO).getTime() < new Date(startISO).getTime()){
    toast('End date cannot be before the start date.');
    document.getElementById('taskEndDateInput').focus();
    return;
  }

  var data = {
    title: title,
    description: document.getElementById('taskDescInput').value.trim(),
    priority: document.getElementById('taskPrioritySelect').value,
    columnId: document.getElementById('taskColumnSelect').value,
    assigneeId: document.getElementById('taskAssigneeSelect').value || null,
    releaseId: document.getElementById('taskReleaseSelect').value || null,
    typeId: document.getElementById('taskTypeSelect').value || null,
    documentationUrl: document.getElementById('taskDocUrlInput').value,
    startDate: startISO,
    endDate: endISO,
    businessValue: clampTaskScore(document.getElementById('taskBusinessValueInput').value),
    taskCost: clampTaskScore(document.getElementById('taskCostInput').value),
    archived: document.getElementById('taskArchivedCheckbox').checked,
    dependencies: ui.taskModalDeps.slice()
  };

  var checkId = ui.editingTaskId || '__new__';
  if(wouldCreateCycle(project, checkId, data.dependencies)){
    toast('That would create a circular dependency. Please review your selections.');
    return;
  }

  if(ui.editingTaskId){
    var blocked = updateTask(project, ui.editingTaskId, data);
    if(blocked){ toast(blocked.message); return; }
    toast('Task updated.');
  } else {
    addTask(project, data);
    toast('Task created.');
  }
  closeTaskModal();
  renderBoard();
}

export function deleteTaskFromModal(){
  var project = getCurrentProject();
  var task = project.tasks[ui.editingTaskId];
  if(!task) return;
  confirmDialog(
    'Delete ' + task.key + '?',
    'This will permanently remove "' + task.title + '" and unlink it from any dependent tasks.',
    function(){
      deleteTask(project, ui.editingTaskId);
      closeTaskModal();
      renderBoard();
      toast('Task deleted.');
    }
  );
}
