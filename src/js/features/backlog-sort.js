"use strict";
import { getColumn } from '../utils.js';
import { PRIORITY_ORDER } from '../config.js';

/* Partial, best-effort name match — catches "Backlog"/"Backlogs" and any "To Do"/"To-Do"/"Todo"
   spelling variant, case-insensitive. Intentionally loose: this feature has no per-project
   configuration, so it has to work off whatever a project happens to have named its columns. */
var BACKLOG_TODO_NAME_PATTERN = /backlog|to\s*-?\s*do/i;

export function isBacklogOrTodoColumnName(name){
  return BACKLOG_TODO_NAME_PATTERN.test(name || '');
}

function priorityRank(priority){
  var idx = PRIORITY_ORDER.indexOf(priority);
  return idx === -1 ? PRIORITY_ORDER.indexOf('medium') : idx;
}

function startDateTime(task){
  var t = task.startDate ? new Date(task.startDate).getTime() : NaN;
  return isNaN(t) ? Infinity : t; // no/invalid start date sorts to the end, never crashes the compare
}

/* Weighted dependency "cost" for a task: a dependency already in a Done column no longer blocks
   anything and doesn't count at all. A dependency still sitting in a Backlog/To Do column costs
   more (x1.5) than one already in flight (x1.0), since it's further from being resolved — this is
   what makes "no dependencies" sort to the top and "most (and least-resolved) dependencies" sort to
   the bottom of a Backlog/To Do column. */
export function taskDependencyScore(project, task){
  var deps = task.dependencies || [];
  var score = 0;
  deps.forEach(function(depId){
    var dep = project.tasks[depId];
    if(!dep) return;
    var col = getColumn(project, dep.columnId);
    if(!col || col.done) return;
    score += isBacklogOrTodoColumnName(col.name) ? 1.5 : 1;
  });
  return score;
}

/* Comparator for Backlog/To Do columns' display order: start date ascending (undated last), then
   priority (Critical..Trivial), then taskDependencyScore ascending (fewest/cheapest-to-resolve
   dependencies first — so a task with no dependencies sorts to the top of its date/priority band,
   and one with the most/costliest dependencies sorts to the bottom). */
export function compareTasksForBacklogSort(project, a, b){
  var ad = startDateTime(a), bd = startDateTime(b);
  if(ad !== bd) return ad - bd;
  var ap = priorityRank(a.priority), bp = priorityRank(b.priority);
  if(ap !== bp) return bp - ap;
  var as = taskDependencyScore(project, a), bs = taskDependencyScore(project, b);
  if(as !== bs) return as - bs;
  return 0;
}
