"use strict";
import { ui, toast } from '../ui.js';
import { getCurrentProject } from '../store.js';
import { iconSvg } from '../icons.js';
import { escapeHTML, renderBoard, renderTaskTypeFilterChips } from '../views/board.js';
import { addTaskType, renameTaskType, removeTaskType, setTaskTypeIcon, buildTaskTypeIconGridHTML, closeAllTaskTypeIconPanels, positionTaskTypeIconPanel, getTaskTypeIconLabel } from '../mutations.js';
import { confirmDialog } from './confirm.js';

export function openTaskTypesModal(){
  var project = getCurrentProject();
  if(!project){ toast('No project selected.'); return; }
  renderTaskTypeList();
  document.getElementById('newTaskTypeNameInput').value = '';
  document.getElementById('taskTypesOverlay').classList.remove('hidden');
  document.getElementById('newTaskTypeNameInput').focus();
}
export function closeTaskTypesModal(){
  document.getElementById('taskTypesOverlay').classList.add('hidden');
  closeAllTaskTypeIconPanels();
}

export function renderTaskTypeList(){
  var project = getCurrentProject();
  var listEl = document.getElementById('taskTypeList');
  listEl.innerHTML = '';
  if(!project || !project.taskTypes || project.taskTypes.length === 0){
    listEl.innerHTML = '<div class="kf-member-empty">No task types yet. Add one above.</div>';
    return;
  }
  project.taskTypes.forEach(function(tt){
    var row = document.createElement('div');
    row.className = 'kf-member-row';
    row.setAttribute('data-tasktype-id', tt.id);
    var triggerIconHTML = tt.iconName ? iconSvg(tt.iconName, 16) : iconSvg('tag', 16);
    row.innerHTML =
      '<div class="kf-tasktype-icon-wrap">' +
        '<button type="button" class="kf-tasktype-icon-trigger' + (tt.iconName ? '' : ' kf-tasktype-icon-unset') + '" title="' + (tt.iconName ? 'Change icon (' + escapeHTML(getTaskTypeIconLabel(tt.iconName)) + ')' : 'Choose an icon') + '" aria-label="Choose an icon for this task type">' + triggerIconHTML + '</button>' +
        '<div class="kf-tasktype-icon-panel hidden">' +
          '<div class="kf-tasktype-icon-grid">' + buildTaskTypeIconGridHTML(tt.iconName) + '</div>' +
          '<div class="kf-dropdown-filter-divider"></div>' +
          '<button type="button" class="kf-dropdown-filter-clear kf-tasktype-icon-clear">No icon</button>' +
        '</div>' +
      '</div>' +
      '<input type="text" class="kf-member-name-input" value="' + escapeHTML(tt.name) + '" maxlength="40" aria-label="Task type name">' +
      '<button class="kf-btn kf-btn-ghost" data-action="remove-tasktype" title="Remove from project">' + iconSvg('trash',14) + '</button>';

    var triggerBtn = row.querySelector('.kf-tasktype-icon-trigger');
    var iconPanel = row.querySelector('.kf-tasktype-icon-panel');
    triggerBtn.addEventListener('click', function(e){
      e.stopPropagation();
      var wasHidden = iconPanel.classList.contains('hidden');
      closeAllTaskTypeIconPanels();
      if(wasHidden){
        iconPanel.classList.remove('hidden');
        positionTaskTypeIconPanel(triggerBtn, iconPanel);
      }
    });
    iconPanel.querySelectorAll('.kf-tasktype-icon-option').forEach(function(optBtn){
      optBtn.addEventListener('click', function(e){
        e.stopPropagation();
        setTaskTypeIcon(project, tt.id, optBtn.getAttribute('data-icon-name'));
        renderTaskTypeList();
        renderBoard();
      });
    });
    iconPanel.querySelector('.kf-tasktype-icon-clear').addEventListener('click', function(e){
      e.stopPropagation();
      setTaskTypeIcon(project, tt.id, null);
      renderTaskTypeList();
      renderBoard();
    });

    var nameInput = row.querySelector('.kf-member-name-input');
    nameInput.addEventListener('change', function(){
      renameTaskType(project, tt.id, nameInput.value);
      renderTaskTypeList();
      renderTaskTypeFilterChips();
      renderBoard();
    });
    row.querySelector('[data-action="remove-tasktype"]').addEventListener('click', function(){
      confirmDialog(
        'Remove ' + tt.name + '?',
        'Any tasks currently set to this type will have their type cleared.',
        function(){
          var unassigned = removeTaskType(project, tt.id);
          renderTaskTypeList();
          renderTaskTypeFilterChips();
          renderBoard();
          toast('Removed ' + tt.name + (unassigned > 0 ? ' — cleared from ' + unassigned + ' task(s).' : '.'));
        }
      );
    });
    listEl.appendChild(row);
  });
}

export function addTaskTypeFromModal(){
  var project = getCurrentProject();
  if(!project) return;
  var input = document.getElementById('newTaskTypeNameInput');
  var name = input.value.trim();
  if(!name){ toast('Please enter a name.'); return; }
  addTaskType(project, name);
  input.value = '';
  renderTaskTypeList();
  renderTaskTypeFilterChips();
  input.focus();
}
