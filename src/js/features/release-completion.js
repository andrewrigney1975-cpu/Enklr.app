"use strict";
import { getColumn, getReleaseById, getTasksArray } from '../utils.js';
import { computeReleaseNotesMarkdown, updateRelease } from '../mutations.js';
import { isServerAuthoritative, refreshProjectFromServer } from './migration.js';
import { releaseApi, isProjectAdmin, isOrgAdmin } from '../api.js';
import { isoToServerDateOnly } from '../date-utils.js';
import { confirmDialog } from '../modals/confirm.js';
import { toast } from '../ui.js';

var _renderBoard = function(){};
export function setReleaseCompletionDeps(deps){
  if(deps.renderBoard) _renderBoard = deps.renderBoard;
}

function isColumnDone(project, columnId){
  var col = getColumn(project, columnId);
  return !!(col && col.done);
}

/* Every task block computeReleaseNotesMarkdown produces starts with
   "**[KEY](#!/..." (see that function's own doc comment) — matching just the
   key out of that anchor lets a block be attributed to its task without
   needing the caller to hand over the same task ordering used to build the
   markdown in the first place. */
var TASK_BLOCK_KEY_RE = /^\s*\*\*\[([^\]]+)\]\(#!\//;

/* Task-by-task merge: a freshly generated block is only appended if that
   task's key doesn't already appear anywhere in the existing (possibly
   hand-edited) notes — existing text is never reordered or rewritten. Used
   so completing a release doesn't clobber notes someone already wrote by
   hand for tasks finished earlier in the release. */
export function mergeReleaseNotesMarkdown(existingMarkdown, freshMarkdown){
  var existing = (existingMarkdown || '').trim();
  if(!existing) return freshMarkdown;
  var missingBlocks = freshMarkdown.split('\n\n').filter(function(block){
    var m = block.match(TASK_BLOCK_KEY_RE);
    return !m || existing.indexOf('[' + m[1] + ']') === -1;
  });
  if(missingBlocks.length === 0) return existing;
  return existing + '\n\n' + missingBlocks.join('\n\n');
}

async function completeRelease(project, release){
  var freshNotes = computeReleaseNotesMarkdown(project, release);

  if(isServerAuthoritative(project)){
    try {
      await releaseApi.update(project.serverProjectId, release.id, {
        name: release.name,
        status: 'deployed',
        ownerId: release.ownerId,
        startDate: isoToServerDateOnly(release.startDate),
        endDate: isoToServerDateOnly(release.endDate)
      });
      // ReleaseNotes is Project-Admin/Org-Admin-gated server-side (see api.js's own note on
      // releaseApi.updateNotes) — a regular member completing a release still gets it marked
      // deployed, just without the notes write they're not permitted to make.
      if(isProjectAdmin(project.serverProjectId) || isOrgAdmin()){
        var merged = mergeReleaseNotesMarkdown(release.releaseNotes, freshNotes);
        await releaseApi.updateNotes(project.serverProjectId, release.id, merged);
      }
      await refreshProjectFromServer(project.id);
      _renderBoard();
      toast('Release ' + release.name + ' marked as deployed.');
    } catch(e){
      toast('Could not mark release as deployed: ' + (e.message || 'unknown error'));
    }
    return;
  }

  // Local-only projects have no releaseNotes field at all (root CLAUDE.md's own note on the
  // Release Notes Packager being a server-authoritative-only feature) — just flip the status.
  updateRelease(project, release.id, {
    name: release.name,
    status: 'deployed',
    ownerId: release.ownerId,
    startDate: release.startDate,
    endDate: release.endDate
  });
  _renderBoard();
  toast('Release ' + release.name + ' marked as deployed.');
}

/* Call after any move that could have just finished off a release — cheap to call unconditionally
   (bails out fast on the very first check for the overwhelming majority of moves, which aren't a
   release's very last remaining task landing in a Done column). Archived tasks don't count as
   "remaining" (they're already excluded from the board and from active work), matching
   computeReleaseNotesMarkdown's own "active or archived, task is task" stance for what to describe,
   vs. this check's narrower "is there still active work outstanding" question. */
export function checkReleaseCompletionOnTaskMove(project, taskId){
  var task = project.tasks[taskId];
  if(!task || !task.releaseId) return;
  if(!isColumnDone(project, task.columnId)) return;

  var release = getReleaseById(project, task.releaseId);
  if(!release || release.status === 'deployed') return;

  var remaining = getTasksArray(project).filter(function(t){
    return t.releaseId === release.id && !t.archived && !isColumnDone(project, t.columnId);
  });
  if(remaining.length > 0) return;

  confirmDialog(
    'Mark release as deployed?',
    'Release ' + release.name + ' has had all of its Tasks closed out. Do you want to mark this release as deployed and generate release notes?',
    function(){ completeRelease(project, release); }
  );
}
