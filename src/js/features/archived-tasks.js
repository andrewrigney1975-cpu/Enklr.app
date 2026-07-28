"use strict";
import { ui, toast, getPriority } from '../ui.js';
import { getCurrentProject } from '../store.js';
import { getTasksArray, getMemberById, getReleaseById, getTaskTypeById, columnNameById } from '../utils.js';
import { iconSvg } from '../icons.js';
import { escapeHTML, renderBoard } from '../views/board.js';
import { reactivateTasks, archiveTasks, deleteTasksLocally } from '../mutations.js';
import { isServerAuthoritative, setTasksArchivedOnServer, markTasksLocalDeleteOnServer } from './migration.js';
import { downloadBlob } from './svg-export.js';
import { confirmDialog } from '../modals/confirm.js';

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
  var ids = Array.from(ui.archivedSelected);

  if(isServerAuthoritative(project)){
    setTasksArchivedOnServer(project, ids, false).then(function(){
      ui.archivedSelected = new Set();
      renderArchivedTasksList();
      renderBoard();
      refreshArchivedCountBadge();
      toast('Reactivated ' + ids.length + ' task' + (ids.length === 1 ? '' : 's') + '.');
    }, function(err){
      toast('Could not reactivate on the server: ' + (err.message || 'unknown error'));
    });
    return;
  }

  var count = reactivateTasks(project, ids);
  ui.archivedSelected = new Set();
  renderArchivedTasksList();
  renderBoard();
  refreshArchivedCountBadge();
  toast('Reactivated ' + count + ' task' + (count === 1 ? '' : 's') + '.');
}

/* "Archive Done Tasks" button (Archived Tasks modal footer) — a bulk shortcut for the common
   end-of-sprint cleanup: every active (non-archived) task sitting in a "Done" column (Column.done,
   see utils.js's getColumn()/board.js's moveTaskToColumn() for the same flag) gets archived in one
   go, rather than archiving each task individually via its own modal's Archived checkbox. Not
   selection-driven (unlike reactivateSelectedArchivedTasks) — it always acts on every qualifying
   task, so there's nothing to select first. */
export function archiveDoneTasksFromModal(){
  var project = getCurrentProject();
  if(!project) return;
  var doneColumnIds = project.columns.filter(function(c){ return c.done; }).map(function(c){ return c.id; });
  var ids = getTasksArray(project)
    .filter(function(t){ return !t.archived && doneColumnIds.indexOf(t.columnId) !== -1; })
    .map(function(t){ return t.id; });

  if(ids.length === 0){ toast('No active tasks in a Done column to archive.'); return; }

  function afterArchive(count){
    renderBoard();
    openArchivedTasksOverlay();
    refreshArchivedCountBadge();
    toast('Archived ' + count + ' task' + (count === 1 ? '' : 's') + '.');
  }

  if(isServerAuthoritative(project)){
    setTasksArchivedOnServer(project, ids, true).then(function(){
      afterArchive(ids.length);
    }, function(err){
      toast('Could not archive on the server: ' + (err.message || 'unknown error'));
    });
    return;
  }

  var count = archiveTasks(project, ids);
  afterArchive(count);
}

function pad2(n){ return n < 10 ? '0' + n : String(n); }

/* YYYYMMDDhhmm, local (device) time, no separators — per the feature's own filename spec. Kept as
   its own small helper rather than reusing any of date-utils.js's ISO-8601 formatters, none of
   which produce this exact separator-free shape. */
function archivedTasksFilenameStamp(date){
  return '' + date.getFullYear() + pad2(date.getMonth() + 1) + pad2(date.getDate()) +
    pad2(date.getHours()) + pad2(date.getMinutes());
}

/* Same flat per-task shape features/import.js's "Import Tasks" reads back in — id AND name for
   column/assignee/release/type (id wins on a same-project round-trip, name is the fallback for a
   different project), no dependsOn/parentKey (those aren't restored on import either, since the
   tasks they'd point at may not survive the round-trip — see resolveImportedTaskFields's own note).
   Comments are carried through (their own content is part of "all task details"); auditLog is
   included too, read-only, for anyone who wants the full history in the exported file even though
   import itself doesn't restore it. */
function buildArchivedTaskExportRecord(project, t){
  var assignee = getMemberById(project, t.assigneeId);
  var release = getReleaseById(project, t.releaseId);
  var taskType = getTaskTypeById(project, t.typeId);
  return {
    id: t.id, key: t.key, title: t.title, description: t.description || '', priority: t.priority,
    columnId: t.columnId, columnName: columnNameById(project, t.columnId),
    assigneeId: assignee ? assignee.id : null, assigneeName: assignee ? assignee.name : null,
    releaseId: release ? release.id : null, releaseName: release ? release.name : null,
    typeId: taskType ? taskType.id : null, typeName: taskType ? taskType.name : null,
    documentationUrl: t.documentationUrl || null,
    startDate: t.startDate || null, endDate: t.endDate || null,
    businessValue: t.businessValue, taskCost: t.taskCost, progress: t.progress,
    estimatedEffort: t.estimatedEffort, actualEffort: t.actualEffort,
    dateCreated: t.dateCreated || null, dateLastModified: t.dateLastModified || null, dateDone: t.dateDone || null,
    comments: (t.comments || []).map(function(c){
      return {text: c.text, dateCreated: c.dateCreated || null, authorName: c.authorName || ''};
    }),
    auditLog: (t.auditLog || []).map(function(a){
      return {timestamp: a.timestamp, field: a.field, oldValue: a.oldValue, newValue: a.newValue};
    })
  };
}

function downloadArchivedTasksJSON(project, archived){
  var exportedAt = new Date();
  var doc = {
    exportedAt: exportedAt.toISOString(),
    project: {id: project.id, key: project.key, name: project.name},
    totalTasks: archived.length,
    tasks: archived.map(function(t){ return buildArchivedTaskExportRecord(project, t); })
  };
  var blob = new Blob([JSON.stringify(doc, null, 2)], {type: 'application/json'});
  downloadBlob(blob, project.key + '-archivedTasks-' + archivedTasksFilenameStamp(exportedAt) + '.json');
}

/* "Export & Delete" button (Archived Tasks modal footer) — downloads every currently-archived task
   as a JSON file (see buildArchivedTaskExportRecord/downloadArchivedTasksJSON above), then removes
   them from THIS project to reclaim storage. Not selection-driven, same reasoning as
   archiveDoneTasksFromModal above — it always acts on every archived task, so there's nothing to
   select first (a partial export-then-delete of only SOME archived tasks was judged more likely to
   confuse than help, since the whole point is freeing up space).
   Server-authoritative projects mark LocalDelete on each task's server row first (see
   TaskItem.LocalDelete's own doc comment) so no browser — including this one, on its next sync —
   ever re-downloads them; the refreshProjectFromServer inside markTasksLocalDeleteOnServer is what
   actually clears them from THIS browser's local state too, since the server's next response simply
   omits them. A local-only project has no server row to mark, so it just removes them directly via
   mutations.js's deleteTasksLocally. */
export function exportAndDeleteArchivedTasks(){
  var project = getCurrentProject();
  if(!project) return;
  var archived = getArchivedTasks(project);
  if(archived.length === 0){ toast('No archived tasks to export.'); return; }

  var count = archived.length;
  confirmDialog(
    'Export & delete ' + count + ' archived task' + (count === 1 ? '' : 's') + '?',
    'A JSON file with every archived task\'s full details will be downloaded first. Afterwards, ' +
      'these tasks are removed from this project to free up space. This cannot be undone from within the app — keep the downloaded file if you may need them again.',
    function(){
      downloadArchivedTasksJSON(project, archived);
      var ids = archived.map(function(t){ return t.id; });

      function afterDelete(removedCount){
        ui.archivedSelected = new Set();
        renderArchivedTasksList();
        renderBoard();
        refreshArchivedCountBadge();
        toast('Exported and removed ' + removedCount + ' archived task' + (removedCount === 1 ? '' : 's') + '.');
      }

      if(isServerAuthoritative(project)){
        markTasksLocalDeleteOnServer(project, ids).then(function(){
          afterDelete(count);
        }, function(err){
          toast('Exported the file, but could not delete on the server: ' + (err.message || 'unknown error'));
        });
        return;
      }

      afterDelete(deleteTasksLocally(project, ids));
    }
  );
}
