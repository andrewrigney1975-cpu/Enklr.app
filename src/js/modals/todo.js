"use strict";
import { toast } from '../ui.js';
import { state } from '../storage.js';
import { escapeHTML } from '../views/board.js';
import { addTodoList, renameTodoList, deleteTodoList, addTodoItem, updateTodoItem, deleteTodoItem } from '../mutations.js';
import { isServerLoggedIn, fetchTodoListsFromServer, createTodoListOnServer, renameTodoListOnServer, deleteTodoListOnServer, createTodoItemOnServer, updateTodoItemOnServer, deleteTodoItemOnServer } from '../features/migration.js';
import { localDateTimeValueToISO, isoToLocalDateTimeValue } from '../date-utils.js';
import { downloadBlob } from '../features/svg-export.js';
import { confirmDialog } from './confirm.js';

/* To-Do Lists — the app's first per-USER (not per-project) feature, so unlike every other modal in
   this app it never needs getCurrentProject(): it's equally available whether or not a project is
   open, gated purely on isServerLoggedIn() (session-level, same rule Project Templates uses for
   "Save as Template"/"Manage Templates" — see modals/templates.js). */

export function openTodoOverlay(){
  renderTodoBoard();
  document.getElementById('todoOverlay').classList.remove('hidden');
}
export function closeTodoOverlay(){
  document.getElementById('todoOverlay').classList.add('hidden');
}
export function isTodoOverlayOpen(){
  return !document.getElementById('todoOverlay').classList.contains('hidden');
}

export function renderTodoBoard(){
  if(isServerLoggedIn()){
    fetchTodoListsFromServer().then(renderBoardFromLists, function(e){
      document.getElementById('todoBoard').innerHTML = '<div class="kf-member-empty">Could not load to-do lists.</div>';
      toast('Could not load to-do lists: ' + (e.message || 'unknown error'));
    });
    return;
  }
  renderBoardFromLists(state.db.todoLists);
}

export function addTodoListFromModal(){
  if(isServerLoggedIn()){
    createTodoListOnServer('Untitled List').then(renderTodoBoard, function(e){
      toast('Could not create list: ' + (e.message || 'unknown error'));
    });
    return;
  }
  addTodoList('Untitled List');
  renderTodoBoard();
}

/* Incomplete items sort by due date ascending (no-due-date items last), ties broken by creation
   order; completed items sink to the bottom, most-recently-completed first. Purely a render-time
   sort — there's no stored ordering column, this is recomputed on every render. */
function sortedItems(items){
  var incomplete = (items || []).filter(function(i){ return !i.completed; }).sort(function(a, b){
    if(!a.dueDate && !b.dueDate) return a.dateCreated < b.dateCreated ? -1 : (a.dateCreated > b.dateCreated ? 1 : 0);
    if(!a.dueDate) return 1;
    if(!b.dueDate) return -1;
    if(a.dueDate === b.dueDate) return a.dateCreated < b.dateCreated ? -1 : (a.dateCreated > b.dateCreated ? 1 : 0);
    return a.dueDate < b.dueDate ? -1 : 1;
  });
  var completed = (items || []).filter(function(i){ return i.completed; }).sort(function(a, b){
    return a.dateLastModified < b.dateLastModified ? 1 : (a.dateLastModified > b.dateLastModified ? -1 : 0);
  });
  return incomplete.concat(completed);
}

function renderBoardFromLists(lists){
  var boardEl = document.getElementById('todoBoard');
  boardEl.innerHTML = '';
  if(!lists || lists.length === 0){
    boardEl.innerHTML = '<div class="kf-member-empty">No to-do lists yet. Use "New List" above.</div>';
    return;
  }
  lists.slice().sort(function(a, b){
    return a.dateCreated < b.dateCreated ? 1 : (a.dateCreated > b.dateCreated ? -1 : 0);
  }).forEach(function(list){
    boardEl.appendChild(buildListCard(list));
  });
}

function buildListCard(list){
  var isServer = isServerLoggedIn();
  var card = document.createElement('div');
  card.className = 'kf-todo-card';

  var header = document.createElement('div');
  header.className = 'kf-todo-card-header';
  header.innerHTML =
    '<input type="text" class="kf-todo-card-title" value="' + escapeHTML(list.title) + '" maxlength="200" aria-label="List title">' +
    '<button type="button" class="kf-btn kf-btn-ghost" data-action="export-ics" title="Export incomplete, upcoming items to .ics"><span class="kf-icon" data-icon="download" data-size="14"></span></button>' +
    '<button type="button" class="kf-btn kf-btn-ghost" data-action="delete-list" title="Delete list"><span class="kf-icon" data-icon="trash" data-size="14"></span></button>';
  card.appendChild(header);

  var titleInput = header.querySelector('.kf-todo-card-title');
  titleInput.addEventListener('change', function(){
    var newTitle = titleInput.value.trim();
    if(!newTitle){ titleInput.value = list.title; return; }
    if(isServer){
      renameTodoListOnServer(list.id, newTitle).then(renderTodoBoard, function(e){
        titleInput.value = list.title;
        toast('Could not rename list: ' + (e.message || 'unknown error'));
      });
      return;
    }
    renameTodoList(list.id, newTitle);
    renderTodoBoard();
  });

  header.querySelector('[data-action="delete-list"]').addEventListener('click', function(){
    confirmDialog('Delete "' + list.title + '"?', 'This will also delete all of its items. This cannot be undone.', function(){
      if(isServer){
        deleteTodoListOnServer(list.id).then(renderTodoBoard, function(e){
          toast('Could not delete list: ' + (e.message || 'unknown error'));
        });
        return;
      }
      deleteTodoList(list.id);
      renderTodoBoard();
    });
  });

  header.querySelector('[data-action="export-ics"]').addEventListener('click', function(){
    exportTodoListAsIcs(list);
  });

  var itemListEl = document.createElement('div');
  itemListEl.className = 'kf-todo-item-list';
  sortedItems(list.items).forEach(function(item){
    itemListEl.appendChild(buildItemRow(list, item, isServer));
  });
  card.appendChild(itemListEl);
  card.appendChild(buildAddItemRow(list, isServer));

  return card;
}

function buildItemRow(list, item, isServer){
  var wrapper = document.createElement('div');

  var row = document.createElement('div');
  row.className = 'kf-todo-item' + (item.completed ? ' kf-todo-item-completed' : '');

  var checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = item.completed;
  checkbox.setAttribute('aria-label', 'Mark complete');

  var textarea = document.createElement('textarea');
  textarea.rows = 2;
  textarea.value = item.note;

  var deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'kf-btn kf-btn-ghost';
  deleteBtn.title = 'Delete item';
  deleteBtn.innerHTML = '<span class="kf-icon" data-icon="trash" data-size="12"></span>';

  row.appendChild(checkbox);
  row.appendChild(textarea);
  row.appendChild(deleteBtn);
  wrapper.appendChild(row);

  var dueRow = document.createElement('div');
  dueRow.className = 'kf-todo-item-due';
  var dueInput = document.createElement('input');
  dueInput.type = 'datetime-local';
  dueInput.value = isoToLocalDateTimeValue(item.dueDate);
  dueInput.setAttribute('aria-label', 'Due date and time (optional)');
  dueRow.appendChild(dueInput);
  wrapper.appendChild(dueRow);

  function persist(overrides){
    var note = overrides.note !== undefined ? overrides.note : item.note;
    var completed = overrides.completed !== undefined ? overrides.completed : item.completed;
    var dueDate = overrides.dueDate !== undefined ? overrides.dueDate : item.dueDate;
    if(isServer){
      updateTodoItemOnServer(list.id, item.id, note, completed, dueDate).then(renderTodoBoard, function(e){
        toast('Could not update item: ' + (e.message || 'unknown error'));
      });
      return;
    }
    updateTodoItem(list.id, item.id, note, completed, dueDate);
    renderTodoBoard();
  }

  checkbox.addEventListener('change', function(){ persist({completed: checkbox.checked}); });
  // change (not input) — mirrors task-types.js's rename-on-change convention, so a re-render on every
  // keystroke never steals focus/cursor position mid-edit.
  textarea.addEventListener('change', function(){ persist({note: textarea.value}); });
  dueInput.addEventListener('change', function(){ persist({dueDate: localDateTimeValueToISO(dueInput.value)}); });

  deleteBtn.addEventListener('click', function(){
    if(isServer){
      deleteTodoItemOnServer(list.id, item.id).then(renderTodoBoard, function(e){
        toast('Could not delete item: ' + (e.message || 'unknown error'));
      });
      return;
    }
    deleteTodoItem(list.id, item.id);
    renderTodoBoard();
  });

  return wrapper;
}

function buildAddItemRow(list, isServer){
  var wrap = document.createElement('div');
  wrap.className = 'kf-todo-add-row';

  var textarea = document.createElement('textarea');
  textarea.rows = 2;
  textarea.placeholder = 'Add an item...';

  var controls = document.createElement('div');
  controls.className = 'kf-todo-add-row-controls';

  var dueInput = document.createElement('input');
  dueInput.type = 'datetime-local';
  dueInput.setAttribute('aria-label', 'Due date and time (optional)');

  var addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'kf-btn kf-btn-secondary';
  addBtn.innerHTML = '<span class="kf-icon" data-icon="plus" data-size="14"></span>Add';

  controls.appendChild(dueInput);
  controls.appendChild(addBtn);
  wrap.appendChild(textarea);
  wrap.appendChild(controls);

  function submit(){
    var note = textarea.value.trim();
    if(!note) return;
    var dueDate = localDateTimeValueToISO(dueInput.value);
    if(isServer){
      createTodoItemOnServer(list.id, note, dueDate).then(renderTodoBoard, function(e){
        toast('Could not add item: ' + (e.message || 'unknown error'));
      });
      return;
    }
    addTodoItem(list.id, note, dueDate);
    renderTodoBoard();
  }
  addBtn.addEventListener('click', submit);

  return wrap;
}

function pad2(n){ return n < 10 ? '0' + n : '' + n; }

function toIcsUtcStamp(iso){
  var d = new Date(iso);
  return d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) + 'T' +
    pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + pad2(d.getUTCSeconds()) + 'Z';
}

function escapeIcsText(text){
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/* RFC 5545 §3.1: any content line longer than 75 octets must be folded, continuation lines starting
   with a single leading space. Byte-length-accurate folding (vs. this simplified char-count version)
   would need to account for multi-byte UTF-8 characters, but a slightly-early fold is harmless — it
   only affects exactly where the line wraps, never the calendar data's meaning. */
function foldIcsLine(line){
  if(line.length <= 75) return line;
  var result = '';
  var remaining = line;
  var first = true;
  while(remaining.length > 0){
    var chunkLen = first ? 75 : 74;
    result += (first ? '' : '\r\n ') + remaining.slice(0, chunkLen);
    remaining = remaining.slice(chunkLen);
    first = false;
  }
  return result;
}

/* Per-list .ics export: only incomplete items with a future due date qualify (per spec). Each becomes
   one VEVENT, a flat 30-minute duration from its due date/time (there's no "real" event length to
   derive this from — a due date is a point in time, not a scheduled block). */
export function exportTodoListAsIcs(list){
  var upcoming = (list.items || []).filter(function(i){
    return !i.completed && i.dueDate && new Date(i.dueDate).getTime() > Date.now();
  });
  if(upcoming.length === 0){
    toast('No incomplete items with a future due date to export.');
    return;
  }

  var nowStamp = toIcsUtcStamp(new Date().toISOString());
  var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Enkl.app//To-Do//EN'];
  upcoming.forEach(function(item){
    var start = new Date(item.dueDate);
    var end = new Date(start.getTime() + 30 * 60 * 1000);
    lines.push('BEGIN:VEVENT');
    lines.push(foldIcsLine('UID:' + item.id + '@enkl.app'));
    lines.push(foldIcsLine('DTSTAMP:' + nowStamp));
    lines.push(foldIcsLine('DTSTART:' + toIcsUtcStamp(start.toISOString())));
    lines.push(foldIcsLine('DTEND:' + toIcsUtcStamp(end.toISOString())));
    lines.push(foldIcsLine('SUMMARY:' + escapeIcsText(item.note)));
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');

  var blob = new Blob([lines.join('\r\n') + '\r\n'], {type: 'text/calendar'});
  downloadBlob(blob, (list.title || 'todo-list') + '.ics');
}
