"use strict";
import { ui, toast, getPriority } from '../ui.js';
import { getCurrentProject } from '../store.js';
import { getTasksArray } from '../utils.js';
import { iconSvg } from '../icons.js';
import { escapeHTML, renderBoard } from '../views/board.js';
import { reactivateTasks } from '../mutations.js';

export function getArchivedTasks(project){
  return getTasksArray(project).filter(function(t){ return t.archived; });
}

export function refreshArchivedCountBadge(){
  var badge = document.getElementById('archivedCountBadge');
  var navBadge = document.getElementById('navArchivedCountBadge');
  if(!badge) return;
  var project = getCurrentProject();
  var count = project ? getArchivedTasks(project).length : 0;
  if(count > 0){
    badge.textContent = count;
    badge.classList.remove('kf-vis-hidden');
    if(navBadge){
      navBadge.textContent = count;
      navBadge.classList.remove('kf-vis-hidden');
    }
  } else {
    badge.classList.add('kf-vis-hidden');
    if(navBadge) navBadge.classList.add('kf-vis-hidden');
  }
}

export function openArchivedTasksOverlay(){
  var project = getCurrentProject();
  if(!project){ toast('No project selected.'); return; }
  ui.archivedSelected = new Set();
  document.getElementById('archivedTasksTitle').textContent = 'Archived tasks — ' + project.name;
  document.getElementById('archivedSelectAllCheckbox').checked = false;
  renderArchivedTasksList();
  document.getElementById('archivedTasksOverlay').classList.remove('hidden');
}
export function closeArchivedTasksOverlay(){
  document.getElementById('archivedTasksOverlay').classList.add('hidden');
}
export function isArchivedTasksOverlayOpen(){
  return !document.getElementById('archivedTasksOverlay').classList.contains('hidden');
}

export function renderArchivedTasksList(){
  var project = getCurrentProject();
  var listEl = document.getElementById('archivedTasksList');
  listEl.innerHTML = '';
  if(!project) return;

  var archived = getArchivedTasks(project).sort(function(a, b){
    return a.key.localeCompare(b.key, undefined, {numeric: true});
  });

  document.getElementById('archivedSelectedCount').textContent =
    ui.archivedSelected.size + ' of ' + archived.length + ' selected';
  document.getElementById('reactivateSelectedBtn').disabled = ui.archivedSelected.size === 0;
  document.getElementById('archivedSelectAllCheckbox').checked =
    archived.length > 0 && ui.archivedSelected.size === archived.length;

  if(archived.length === 0){
    listEl.innerHTML = '<div class="kf-member-empty">No archived tasks in this project.</div>';
    return;
  }

  archived.forEach(function(t){
    var prio = getPriority(t.priority);
    var row = document.createElement('label');
    row.className = 'kf-archived-row';
    var checked = ui.archivedSelected.has(t.id);
    row.innerHTML =
      '<input type="checkbox" ' + (checked ? 'checked' : '') + '>' +
      '<span class="kf-dep-key">' + escapeHTML(t.key) + '</span>' +
      '<span class="kf-archived-row-title">' + escapeHTML(t.title) + '</span>' +
      '<span class="kf-priority-pill" style="color:' + prio.color + ';background:' + prio.bg + ';">' + iconSvg(prio.icon,12) + escapeHTML(prio.label) + '</span>';
    row.querySelector('input').addEventListener('change', function(e){
      if(e.target.checked) ui.archivedSelected.add(t.id);
      else ui.archivedSelected.delete(t.id);
      renderArchivedTasksList();
    });
    listEl.appendChild(row);
  });
}

export function reactivateSelectedArchivedTasks(){
  var project = getCurrentProject();
  if(!project || ui.archivedSelected.size === 0) return;
  var count = reactivateTasks(project, Array.from(ui.archivedSelected));
  ui.archivedSelected = new Set();
  renderArchivedTasksList();
  renderBoard();
  refreshArchivedCountBadge();
  toast('Reactivated ' + count + ' task' + (count === 1 ? '' : 's') + '.');
}
