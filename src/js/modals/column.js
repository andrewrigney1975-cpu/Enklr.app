"use strict";
import { ui, toast } from '../ui.js';
import { getCurrentProject } from '../store.js';
import { getColumn } from '../utils.js';
import { addColumn, updateColumn, deleteColumn } from '../mutations.js';
import { renderBoard } from '../views/board.js';
import { confirmDialog } from './confirm.js';

export function openColumnModal(columnId){
  var project = getCurrentProject();
  ui.editingColumnId = columnId;
  var col = columnId ? getColumn(project, columnId) : null;
  document.getElementById('columnModalTitle').textContent = col ? 'Edit column' : 'New column';
  document.getElementById('columnNameInput').value = col ? col.name : '';
  document.getElementById('columnDoneCheckbox').checked = col ? col.done : false;
  document.getElementById('columnDeleteBtn').classList.toggle('kf-vis-hidden', !col);
  document.getElementById('columnOverlay').classList.remove('hidden');
  document.getElementById('columnNameInput').focus();
}
export function closeColumnModal(){
  document.getElementById('columnOverlay').classList.add('hidden');
  ui.editingColumnId = null;
}
export function saveColumnFromModal(){
  var project = getCurrentProject();
  var name = document.getElementById('columnNameInput').value.trim();
  if(!name){ toast('Please enter a column name.'); return; }
  var done = document.getElementById('columnDoneCheckbox').checked;
  if(ui.editingColumnId){
    updateColumn(project, ui.editingColumnId, name, done);
    toast('Column updated.');
  } else {
    addColumn(project, name, done);
    toast('Column added.');
  }
  closeColumnModal();
  renderBoard();
}
export function deleteColumnFromModal(){
  var project = getCurrentProject();
  var col = getColumn(project, ui.editingColumnId);
  if(!col) return;
  confirmDialog(
    'Delete column "' + col.name + '"?',
    col.order.length > 0 ? 'Its ' + col.order.length + ' task(s) will be moved to another column.' : 'This column has no tasks.',
    function(){
      if(deleteColumn(project, ui.editingColumnId)){
        closeColumnModal();
        renderBoard();
        toast('Column deleted.');
      }
    }
  );
}
