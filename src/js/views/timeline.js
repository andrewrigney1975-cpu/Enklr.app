"use strict";
import { getTasksArray, getColumn, getMemberById, getTaskTypeById, getReleaseById, isTaskOverdue, escapeHTML, memberLabel, compareReleaseGroupKeys } from '../utils.js';
import { getCurrentProject } from '../store.js';
import { ui } from '../ui.js';
import { getPriority } from '../ui.js';
import { iconSvg } from '../icons.js';
import { utcISOToLocalDisplayDate, utcISOToLocalDateValue, localDateValueToUTCISO, localDateValueFromDate, memberInitials, clampProgress, contrastTextColor } from '../date-utils.js';
import { isTimeTrackingEnabled } from '../storage.js';
import { NO_RELEASE_GROUP_KEY, getReleaseStatusMeta, normalizeReleaseStatus } from './task-list.js';
import { updateTaskDates, updateReleaseDates, renameProject } from '../mutations.js';
import { isServerAuthoritative, updateTaskDatesOnServer, updateReleaseDatesOnServer, updateProjectOnServer } from '../features/migration.js';
import { renderBoard } from './board.js';

function iconHTML(name, size){ return '<span class="kf-icon">'+iconSvg(name,size)+'</span>'; }
function buildEl(tag, className, innerHTML){ var el = document.createElement(tag); if(className) el.className = className; if(innerHTML !== undefined) el.innerHTML = innerHTML; return el; }

var PRIORITY_ORDER = ['trivial','low','medium','high','critical'];

var _toast = function(msg){ console.error(msg); };
var _openTaskModal = function(){};
var _confirmDialog = function(title, msg, onConfirm){ if(window.confirm(title + '\n' + msg)) onConfirm(); };
var _openReleaseEditor = function(){};
export function setTimelineDeps(deps){
  if(deps.toast) _toast = deps.toast;
  if(deps.openTaskModal) _openTaskModal = deps.openTaskModal;
  if(deps.confirmDialog) _confirmDialog = deps.confirmDialog;
  if(deps.openReleaseEditor) _openReleaseEditor = deps.openReleaseEditor;
}

/* =========================================================
   TIMELINE
   A Gantt-style view: rows are tasks, columns are time buckets sized
   by the selected scale. The displayed range runs from the earlier
   of the project's start date or the earliest active task's start
   date, through to the project's end date.
   ========================================================= */
export function localCalDateFromISO(iso){
  var v = utcISOToLocalDateValue(iso);
  if(!v) return null;
  var parts = v.split('-');
  return new Date(parseInt(parts[0],10), parseInt(parts[1],10)-1, parseInt(parts[2],10));
}
export function tlAddDays(d, n){ var r = new Date(d); r.setDate(r.getDate()+n); return r; }
export function tlAddMonths(d, n){ return new Date(d.getFullYear(), d.getMonth()+n, 1); }
export function tlAddYears(d, n){ return new Date(d.getFullYear()+n, 0, 1); }
export function tlStartOfWeekMonday(d){
  var r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  var day = r.getDay();
  var diff = (day === 0) ? -6 : (1 - day);
  r.setDate(r.getDate() + diff);
  return r;
}
export function tlStartOfMonth(d){ return new Date(d.getFullYear(), d.getMonth(), 1); }
export function tlStartOfYear(d){ return new Date(d.getFullYear(), 0, 1); }

export var TIMESCALE_CONFIG = {
  day: {
    minWidth: 30, maxWidth: 60,
    startFn: function(d){ return new Date(d.getFullYear(), d.getMonth(), d.getDate()); },
    stepFn: function(d){ return tlAddDays(d, 1); },
    labelFn: function(d){ return d.toLocaleDateString(undefined, {weekday:'short', day:'numeric'}); }
  },
  week: {
    minWidth: 50, maxWidth: 100,
    startFn: tlStartOfWeekMonday,
    stepFn: function(d){ return tlAddDays(d, 7); },
    labelFn: function(d){ return d.toLocaleDateString(undefined, {month:'short', day:'numeric'}); }
  },
  fortnight: {
    minWidth: 70, maxWidth: 130,
    startFn: tlStartOfWeekMonday,
    stepFn: function(d){ return tlAddDays(d, 14); },
    labelFn: function(d){ return d.toLocaleDateString(undefined, {month:'short', day:'numeric'}); }
  },
  month: {
    minWidth: 90, maxWidth: 160,
    startFn: tlStartOfMonth,
    stepFn: function(d){ return tlAddMonths(d, 1); },
    labelFn: function(d){ return d.toLocaleDateString(undefined, {month:'short', year:'numeric'}); }
  },
  quarter: {
    minWidth: 120, maxWidth: 200,
    startFn: tlStartOfMonth,
    stepFn: function(d){ return tlAddMonths(d, 3); },
    labelFn: function(d){
      var endM = tlAddMonths(d, 2);
      return d.toLocaleDateString(undefined, {month:'short'}) + '–' + endM.toLocaleDateString(undefined, {month:'short', year:'numeric'});
    }
  },
  year: {
    minWidth: 150, maxWidth: 260,
    startFn: tlStartOfYear,
    stepFn: function(d){ return tlAddYears(d, 1); },
    labelFn: function(d){ return String(d.getFullYear()); }
  }
};

var TIMELINE_NAME_COL_WIDTH = 240;
var TIMELINE_SCALE_ORDER = ['day', 'week', 'fortnight', 'month', 'quarter', 'year'];

/* Picks the finest granularity whose full column count still fits the available track width at
   that scale's own minWidth — i.e. the most detailed view that doesn't need horizontal scrolling
   for the data being shown right now. Falls back to the coarsest scale (year) if even that doesn't
   fit (an overrun task or a very long project), same as the pre-existing manual "just pick year"
   workaround users had to do by hand. */
export function computeAutoTimelineScale(range, trackAvailable){
  if(!range.start || !range.end) return 'week';
  for(var i = 0; i < TIMELINE_SCALE_ORDER.length; i++){
    var scale = TIMELINE_SCALE_ORDER[i];
    var cfg = TIMESCALE_CONFIG[scale];
    var count = buildTimelineColumns(range.start, range.end, scale, 1).length;
    if(count * cfg.minWidth <= trackAvailable) return scale;
  }
  return 'year';
}

export function buildTimelineColumns(rangeStart, rangeEnd, granularity, colWidth){
  var cfg = TIMESCALE_CONFIG[granularity] || TIMESCALE_CONFIG.week;
  var columns = [];
  var cursor = cfg.startFn(rangeStart);
  var guard = 0;
  while(cursor.getTime() < rangeEnd.getTime() && guard < 3000){
    var next = cfg.stepFn(cursor);
    columns.push({start: cursor, end: next, label: cfg.labelFn(cursor), width: colWidth});
    cursor = next;
    guard++;
  }
  if(columns.length === 0){
    var next2 = cfg.stepFn(cursor);
    columns.push({start: cursor, end: next2, label: cfg.labelFn(cursor), width: colWidth});
  }
  return columns;
}

/* Maps a calendar Date to a pixel x-offset within the generated
   columns. Dates beyond the last column extrapolate using its rate
   rather than clamping, so an overrunning task's bar visibly runs
   off the end of the grid instead of being silently clipped. */
export function tlDateToPixel(date, columns){
  var x = 0;
  for(var i = 0; i < columns.length; i++){
    var col = columns[i];
    if(date.getTime() < col.end.getTime()){
      var frac = (date.getTime() - col.start.getTime()) / (col.end.getTime() - col.start.getTime());
      return x + frac * col.width;
    }
    x += col.width;
  }
  var last = columns[columns.length - 1];
  var rate = last.width / (last.end.getTime() - last.start.getTime());
  return (x - last.width) + (date.getTime() - last.start.getTime()) * rate;
}

/* Exact inverse of tlDateToPixel above — walks the same variable-width columns array rather than
   assuming a uniform pixels-per-day rate (column width varies by granularity, e.g. a 28-31 day month
   column vs a fixed 7-day week column), so a pixel position maps back to the same date tlDateToPixel
   would have placed there. Built for the Portfolio Dashboard's draggable Timeline bars (see
   modals/portfolio-dashboard.js) but lives here, not there, since it's the natural sibling of
   tlDateToPixel and is meant to be reused by any future drag-to-schedule UI (e.g. a planning-tool
   Gantt view) built on this same column model. Extrapolates before the first / after the last column
   at that column's own rate, mirroring tlDateToPixel's own extrapolation past the last column. */
export function tlPixelToDate(pixelX, columns){
  var x = 0;
  for(var i = 0; i < columns.length; i++){
    var col = columns[i];
    if(pixelX < x + col.width){
      var frac = (pixelX - x) / col.width;
      return new Date(col.start.getTime() + frac * (col.end.getTime() - col.start.getTime()));
    }
    x += col.width;
  }
  var last = columns[columns.length - 1];
  var rate = (last.end.getTime() - last.start.getTime()) / last.width;
  return new Date(last.start.getTime() + (pixelX - (x - last.width)) * rate);
}

/* Start = earlier of the project's start date or the earliest ACTIVE
   task's start date. End = the project's end date. Archived tasks
   never influence this range, regardless of the show-archived toggle,
   so toggling archived visibility never reflows the timeline scale. */
export function computeTimelineRange(project){
  var projectStart = localCalDateFromISO(project.startDate);
  var projectEnd = localCalDateFromISO(project.endDate);
  var earliestTaskStart = null;
  getTasksArray(project).forEach(function(t){
    if(t.archived) return;
    var d = localCalDateFromISO(t.startDate);
    if(d && (!earliestTaskStart || d.getTime() < earliestTaskStart.getTime())) earliestTaskStart = d;
  });

  var start;
  if(projectStart && earliestTaskStart){
    start = (projectStart.getTime() < earliestTaskStart.getTime()) ? projectStart : earliestTaskStart;
  } else {
    start = projectStart || earliestTaskStart || null;
  }
  return {start: start, end: projectEnd};
}

/* The latest-ending, not-yet-complete ACTIVE task, if its end date
   falls after the project's end date — or null if nothing overruns. */
export function findTimelineOverrun(project, rangeEnd){
  if(!rangeEnd) return null;
  var latest = null;
  var latestEndD = null;
  getTasksArray(project).forEach(function(t){
    if(t.archived) return;
    var col = getColumn(project, t.columnId);
    if(col && col.done) return;
    var endD = localCalDateFromISO(t.endDate);
    if(!endD) return;
    if(!latestEndD || endD.getTime() > latestEndD.getTime()){
      latest = t;
      latestEndD = endD;
    }
  });
  if(!latest || !latestEndD) return null;
  return latestEndD.getTime() > rangeEnd.getTime() ? latest : null;
}

export function updateTimelineArchiveToggleButton(){
  var btn = document.getElementById('timelineArchiveToggle');
  var label = document.getElementById('timelineArchiveToggleLabel');
  if(!btn) return;
  btn.classList.toggle('active', ui.timelineShowArchived);
  label.textContent = ui.timelineShowArchived ? 'Hide archived' : 'Show archived';
  btn.title = ui.timelineShowArchived ? 'Hide archived tasks' : 'Show archived tasks';
}
export function toggleTimelineShowArchived(){
  ui.timelineShowArchived = !ui.timelineShowArchived;
  updateTimelineArchiveToggleButton();
  renderTimeline();
}

/* "Collapse all" only collapses groups that currently have at least one visible task (respecting
   the archived toggle) — same "don't affect a group that isn't even showing right now" rule as
   Task List's own collapseAllTaskListGroups. */
export function collapseAllTimelineGroups(){
  var project = getCurrentProject();
  if(!project) return;
  var visibleTasks = getTasksArray(project).filter(function(t){
    return !t.archived || ui.timelineShowArchived;
  });
  visibleTasks.forEach(function(t){
    ui.timelineCollapsedGroups.add(t.releaseId || NO_RELEASE_GROUP_KEY);
  });
  renderTimeline();
}
export function expandAllTimelineGroups(){
  ui.timelineCollapsedGroups = new Set();
  renderTimeline();
}

export function openTimelineOverlay(){
  var project = getCurrentProject();
  if(!project){ _toast('No project selected.'); return; }
  updateTimelineArchiveToggleButton();
  // Session-only, reset every time the overlay opens — same convention as Task List's own
  // ui.taskListCollapsedGroups reset in openTaskListOverlay, so a release left collapsed from a
  // previous visit doesn't silently stay hidden the next time this is opened.
  ui.timelineCollapsedGroups = new Set();
  // Any drag made in a previous visit that was never saved is discarded on reopen, same as the
  // collapsed-groups reset above — there's no "resume editing" concept for this overlay.
  resetTimelinePendingChanges();
  document.getElementById('timelineOverlay').classList.remove('hidden');
  // Auto-pick the scale that best fits what's actually being displayed at load time — the finest
  // granularity that still shows the whole range without horizontal scrolling — rather than always
  // reopening at whatever scale (or the 'week' default) was last left selected.
  var range = computeTimelineRange(project);
  var scrollEl = document.getElementById('timelineScroll');
  var availableWidth = scrollEl.clientWidth || 900;
  var trackAvailable = Math.max(availableWidth - TIMELINE_NAME_COL_WIDTH, 200);
  ui.timelineScale = computeAutoTimelineScale(range, trackAvailable);
  document.getElementById('timelineScaleSelect').value = ui.timelineScale;
  renderTimeline();
}
export function closeTimelineOverlay(){
  document.getElementById('timelineOverlay').classList.add('hidden');
  resetTimelinePendingChanges();
}

/* The Close button / Escape key both route through here rather than calling closeTimelineOverlay
   directly — if a drag was made but never Saved, closing would otherwise silently discard it with
   no warning. Confirm = save then close (waits for the save to actually settle before closing —
   saveTimelineChanges already toasts and clears pending state on a failed write, same as clicking
   the Save button directly would, so this just defers the close until that's happened rather than
   closing over a still-in-flight request); Cancel = discard and close immediately, same as the
   pre-existing behavior; Ignore (the dialog's own pure no-op third button) = stay open, keep
   editing. A backdrop click or navigating away by clicking a task row are deliberately NOT routed
   through this guard — only the two interactions the user actually asked to be guarded. */
export function closeTimelineOverlayGuarded(){
  if(!hasTimelinePendingChanges()){ closeTimelineOverlay(); return; }
  _confirmDialog(
    'Unsaved Timeline changes',
    'You have unsaved date changes on the Timeline. Save them before closing, or discard them?',
    function(){ saveTimelineChanges().then(closeTimelineOverlay); },
    closeTimelineOverlay,
    true
  );
}
export function isTimelineOverlayOpen(){
  return !document.getElementById('timelineOverlay').classList.contains('hidden');
}

export function renderTimeline(){
  var project = getCurrentProject();
  var inner = document.getElementById('timelineInner');
  var legend = document.getElementById('timelineLegend');
  var alertBanner = document.getElementById('timelineAlertBanner');

  inner.innerHTML = '';
  legend.innerHTML = '';
  alertBanner.classList.add('hidden');
  alertBanner.innerHTML = '';

  // Project start/end, not the computed timeline range (computeTimelineRange below can widen the
  // start earlier to fit an active task that starts before the project itself does) — the title
  // reflects the project's own configured dates, same as the header shown throughout the rest of
  // the app. Either side left unset shows as an em-dash rather than silently dropping the whole
  // suffix, since a range with only one end set is still worth surfacing.
  var titleDateRange = '';
  if(project && (project.startDate || project.endDate)){
    titleDateRange = ' (' +
      (project.startDate ? utcISOToLocalDisplayDate(project.startDate) : '—') + ' – ' +
      (project.endDate ? utcISOToLocalDisplayDate(project.endDate) : '—') + ')';
  }
  document.getElementById('timelineTitle').textContent = 'Timeline' + (project ? ' — ' + project.name + titleDateRange : '');
  if(!project) return;

  var range = computeTimelineRange(project);

  if(!range.start || !range.end){
    var msg = (!range.start && !range.end)
      ? 'Set a project start date (or a start date on at least one task) and a project end date to see a timeline.'
      : (!range.start
          ? 'Set a project start date, or a start date on at least one task, to see a timeline.'
          : 'Set a project end date to see a timeline.');
    inner.appendChild(buildEl('div', 'kf-timeline-empty', iconHTML('inbox', 36) + '<div>' + escapeHTML(msg) + '</div>'));
    return;
  }
  if(range.end.getTime() < range.start.getTime()){
    inner.appendChild(buildEl('div', 'kf-timeline-empty', iconHTML('inbox', 36) + '<div>The project\'s end date is before its start date. Fix the project dates to see a timeline.</div>'));
    return;
  }

  var overrunTask = findTimelineOverrun(project, range.end);
  if(overrunTask){
    alertBanner.classList.remove('hidden');
    alertBanner.innerHTML = iconHTML('warning', 16) +
      '<span>' + escapeHTML(overrunTask.key) + ' “' + escapeHTML(overrunTask.title) + '” is scheduled to finish ' +
      escapeHTML(utcISOToLocalDisplayDate(overrunTask.endDate)) + ' — after the project\'s end date of ' +
      escapeHTML(utcISOToLocalDisplayDate(project.endDate)) + '.</span>';
  }

  legend.innerHTML = PRIORITY_ORDER.map(function(key){
    var conf = getPriority(key);
    return '<span class="kf-legend-item"><span class="kf-legend-swatch" style="background:' + conf.accent + ';"></span>' + escapeHTML(conf.label) + '</span>';
  }).join('') +
  '<span class="kf-legend-item"><span class="kf-legend-dot" style="background:var(--kf-blue);"></span>Today</span>' +
  (ui.timelineShowArchived ? '<span class="kf-legend-item">' + iconSvg('archive', 12) + ' Archived task (ghosted)</span>' : '') +
  (isTimeTrackingEnabled(project) ? '<span class="kf-legend-item"><span class="kf-legend-dot" style="background:#fff;border:1.5px solid var(--kf-text-secondary);"></span>Marker position = progress</span>' : '');

  var activeTasks = getTasksArray(project).filter(function(t){ return !t.archived; });
  var archivedTasks = ui.timelineShowArchived ? getTasksArray(project).filter(function(t){ return t.archived; }) : [];
  var tasks = activeTasks.concat(archivedTasks);

  if(tasks.length === 0){
    inner.appendChild(buildEl('div', 'kf-timeline-empty', iconHTML('inbox', 36) + '<div>No tasks to show on the timeline yet.</div>'));
    return;
  }

  function effectiveStart(t){ return localCalDateFromISO(t.startDate) || localCalDateFromISO(t.endDate); }
  function byEffectiveStart(a, b){
    var ad = effectiveStart(a), bd = effectiveStart(b);
    if(ad && bd) return ad.getTime() - bd.getTime();
    if(ad && !bd) return -1;
    if(!ad && bd) return 1;
    return a.key.localeCompare(b.key, undefined, {numeric: true});
  }

  var scrollEl = document.getElementById('timelineScroll');
  var availableWidth = scrollEl.clientWidth || 900;
  var nameColWidth = TIMELINE_NAME_COL_WIDTH;
  var trackAvailable = Math.max(availableWidth - nameColWidth, 200);

  var cfg = TIMESCALE_CONFIG[ui.timelineScale] || TIMESCALE_CONFIG.week;
  var probeColumns = buildTimelineColumns(range.start, range.end, ui.timelineScale, 1);
  var colWidth = Math.max(cfg.minWidth, Math.min(cfg.maxWidth, trackAvailable / probeColumns.length));
  var columns = buildTimelineColumns(range.start, range.end, ui.timelineScale, colWidth);
  var totalTrackWidth = columns.reduce(function(sum, c){ return sum + c.width; }, 0);

  var headerRow = document.createElement('div');
  headerRow.className = 'kf-timeline-header-row';
  var headerName = buildEl('div', 'kf-timeline-name-cell', 'Task');
  headerName.style.width = nameColWidth + 'px';
  headerName.style.minWidth = nameColWidth + 'px';
  headerRow.appendChild(headerName);
  var headerTrack = document.createElement('div');
  headerTrack.className = 'kf-timeline-track';
  headerTrack.style.width = totalTrackWidth + 'px';
  columns.forEach(function(col){
    var cell = buildEl('div', 'kf-timeline-col-header', escapeHTML(col.label));
    cell.style.width = col.width + 'px';
    headerTrack.appendChild(cell);
  });
  headerRow.appendChild(headerTrack);
  inner.appendChild(headerRow);

  var today = new Date();
  today = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  var todayX = null;
  if(today.getTime() >= columns[0].start.getTime() && today.getTime() <= columns[columns.length - 1].end.getTime()){
    todayX = tlDateToPixel(today, columns);
  }
  if(todayX !== null){
    var todayLineHeader = document.createElement('div');
    todayLineHeader.className = 'kf-timeline-today-line';
    todayLineHeader.style.left = todayX + 'px';
    headerTrack.appendChild(todayLineHeader);
    var todayLabel = document.createElement('div');
    todayLabel.className = 'kf-timeline-today-label';
    todayLabel.style.left = (todayX + 4) + 'px';
    todayLabel.textContent = 'Today';
    headerTrack.appendChild(todayLabel);
  }

  function buildTimelineTaskRow(t){
    var row = document.createElement('div');
    row.className = 'kf-timeline-row' + (t.archived ? ' kf-timeline-row-archived' : '');
    row.setAttribute('data-task-id', t.id);

    var nameCell = document.createElement('div');
    nameCell.className = 'kf-timeline-name-cell';
    nameCell.style.width = nameColWidth + 'px';
    nameCell.style.minWidth = nameColWidth + 'px';
    var assignee = getMemberById(project, t.assigneeId);
    if(assignee){
      var avatar = buildEl('span', 'kf-avatar kf-avatar-sm', escapeHTML(memberInitials(assignee.name)));
      avatar.style.background = assignee.color;
      avatar.title = memberLabel(assignee);
      nameCell.appendChild(avatar);
    }
    var nameText = document.createElement('div');
    nameText.className = 'kf-timeline-name-text';
    nameText.innerHTML = '<span class="kf-timeline-name-key">' + escapeHTML(t.key) + '</span><span class="kf-timeline-name-title">' + escapeHTML(t.title) + '</span>';
    nameCell.appendChild(nameText);
    row.appendChild(nameCell);

    var track = document.createElement('div');
    track.className = 'kf-timeline-track';
    track.style.width = totalTrackWidth + 'px';
    columns.forEach(function(col){
      var cell = buildEl('div', 'kf-timeline-cell', '');
      cell.style.width = col.width + 'px';
      track.appendChild(cell);
    });

    // A drag made earlier this same visit but not yet saved (see the "Save changes" button) still
    // wins here over the task's own last-saved dates, so switching timescale/archived-filter/
    // collapsing a group mid-edit doesn't visually snap an unsaved bar back to where it used to be.
    var pendingTaskDates = _timelinePendingTaskDates[t.id];
    var startD = localCalDateFromISO(pendingTaskDates ? pendingTaskDates.startISO : t.startDate);
    var endD = localCalDateFromISO(pendingTaskDates ? pendingTaskDates.endISO : t.endDate);
    if(startD || endD){
      var effStartD = startD || endD;
      var effEndD = endD || startD;
      var left = tlDateToPixel(effStartD, columns);
      var right = tlDateToPixel(tlAddDays(effEndD, 1), columns);
      var barWidth = Math.max(right - left, 6);
      var prio = getPriority(t.priority);
      var bar = document.createElement('div');
      bar.className = 'kf-timeline-bar' + (t.archived ? ' kf-timeline-bar-archived' : '');
      bar.style.left = left + 'px';
      bar.style.width = barWidth + 'px';
      bar.style.background = prio.accent;
      // Drag-to-reschedule handles + the bar's own "move" role — inserted first, same reasoning
      // as the progress marker below: both are absolutely-positioned overlays outside the bar's
      // flex layout, so appending them before the avatar/key/type-icon flex children keeps the
      // type icon the last REAL flex child regardless (see that test's own assumption).
      bar.appendChild(buildEl('span', 'kf-timeline-handle kf-timeline-handle-start', ''));
      bar.lastChild.setAttribute('data-role', 'resize-start');
      bar.appendChild(buildEl('span', 'kf-timeline-handle kf-timeline-handle-end', ''));
      bar.lastChild.setAttribute('data-role', 'resize-end');
      bar.setAttribute('data-role', 'move');
      bar.addEventListener('mousedown', onTimelineBarPointerDown);
      if(assignee){
        var barAvatar = buildEl('span', 'kf-avatar kf-avatar-sm', escapeHTML(memberInitials(assignee.name)));
        barAvatar.style.background = assignee.color;
        barAvatar.title = assignee.name;
        bar.appendChild(barAvatar);
      }
      bar.appendChild(buildEl('span', 'kf-timeline-bar-key', escapeHTML(t.key)));
      var taskType = getTaskTypeById(project, t.typeId);
      if(taskType && taskType.iconName){
        var barTypeIcon = buildEl('span', 'kf-timeline-bar-type-icon', iconSvg(taskType.iconName, 13));
        barTypeIcon.title = taskType.name;
        bar.appendChild(barTypeIcon);
      }
      bar.title = t.key + ' — ' + t.title +
        (startD ? ' · Start ' + utcISOToLocalDisplayDate(pendingTaskDates ? pendingTaskDates.startISO : t.startDate) : '') +
        (endD ? ' · End ' + utcISOToLocalDisplayDate(pendingTaskDates ? pendingTaskDates.endISO : t.endDate) : '') +
        (pendingTaskDates ? ' (unsaved)' : '');
      if(isTimeTrackingEnabled(project)){
        var progress = clampProgress(t.progress);
        var marker = buildEl('span', 'kf-timeline-progress-marker' + (progress > 0 ? ' kf-timeline-progress-marker-filled' : ''), '');
        marker.style.left = (barWidth * progress / 100) + 'px';
        marker.title = 'Progress: ' + progress + '%';
        /* Inserted first, not appended — it's an absolutely-positioned
           overlay that plays no part in the bar's flex layout, so it
           must not disturb which flex child (the type icon) ends up
           last, since that's what other logic/tests key off of. */
        bar.insertBefore(marker, bar.firstChild);
      }
      track.appendChild(bar);
    } else {
      track.appendChild(buildEl('div', 'kf-timeline-no-dates-note', 'No dates set'));
    }

    if(todayX !== null){
      var todayLine = document.createElement('div');
      todayLine.className = 'kf-timeline-today-line';
      todayLine.style.left = todayX + 'px';
      track.appendChild(todayLine);
    }

    row.appendChild(track);
    return row;
  }

  /* Groups by release, sorted by release startDate ascending (undated releases after dated ones,
     by name) then a synthetic "No Release" bucket last — same grouping/ordering rule and same
     NO_RELEASE_GROUP_KEY sentinel as Task List's own release grouping (task-list.js), so a
     release's position in this view's group order always matches its position there. Only a
     release with at least one currently-visible task gets a group here, same as Task List — an
     empty release doesn't clutter the Gantt with an undated placeholder no one asked to schedule
     yet (use the Portfolio Planner for that). */
  var groups = {};
  tasks.forEach(function(t){
    var key = t.releaseId || NO_RELEASE_GROUP_KEY;
    (groups[key] = groups[key] || []).push(t);
  });
  var releaseGroupKeys = Object.keys(groups).filter(function(k){ return k !== NO_RELEASE_GROUP_KEY; });
  releaseGroupKeys.sort(function(a, b){ return compareReleaseGroupKeys(project, a, b); });
  var orderedGroupKeys = releaseGroupKeys.concat(groups.hasOwnProperty(NO_RELEASE_GROUP_KEY) ? [NO_RELEASE_GROUP_KEY] : []);

  orderedGroupKeys.forEach(function(groupKey){
    var groupTasks = groups[groupKey];
    groupTasks.sort(byEffectiveStart);
    var collapsed = ui.timelineCollapsedGroups.has(groupKey);
    inner.appendChild(buildTimelineReleaseGroupHeader(project, groupKey, groupTasks, collapsed, columns, totalTrackWidth, nameColWidth, todayX));
    if(collapsed) return;
    groupTasks.forEach(function(t){
      inner.appendChild(buildTimelineTaskRow(t));
    });
  });

  inner.querySelectorAll('[data-group-key]').forEach(function(header){
    header.addEventListener('click', function(){
      var key = header.getAttribute('data-group-key');
      if(ui.timelineCollapsedGroups.has(key)) ui.timelineCollapsedGroups.delete(key);
      else ui.timelineCollapsedGroups.add(key);
      renderTimeline();
    });
  });

  // Captured once per render for the drag handlers below (module-level, not closed over any
  // particular row) — same "_timelineLayout" convention modals/portfolio-dashboard.js's own
  // drag-to-reschedule chart uses, so a mousedown fired well after this render still has the
  // exact column model that produced the bar positions it's about to drag.
  _timelineLayout = {columns: columns, totalTrackWidth: totalTrackWidth, nameColWidth: nameColWidth};
}

/* Release group header row — a hybrid of Task List's own group header (chevron + name + status
   pill + task count, toggling collapse on click) and a Timeline task row's own name-cell/track
   shape (so it lines up in the same two-column grid every other row uses). The release's own bar
   — only drawn when it has at least one of startDate/endDate set, exactly like a task's own "no
   dates set" fallback — is filled with the release's own Color (never a priority color, since a
   release has no priority of its own to color it by), with the label's text color picked via a
   real WCAG contrast check (date-utils.js's contrastTextColor) against that same Color so it
   stays legible whatever shade a user picks — see .kf-timeline-bar-release in styles.css. */
function buildTimelineReleaseGroupHeader(project, groupKey, groupTasks, collapsed, columns, totalTrackWidth, nameColWidth, todayX){
  var row = document.createElement('div');
  row.className = 'kf-timeline-row kf-timeline-group-header';
  row.setAttribute('data-group-key', groupKey);
  row.setAttribute('aria-expanded', collapsed ? 'false' : 'true');

  var nameCell = document.createElement('div');
  nameCell.className = 'kf-timeline-name-cell';
  nameCell.style.width = nameColWidth + 'px';
  nameCell.style.minWidth = nameColWidth + 'px';

  var chevronHTML = '<span class="kf-tasklist-chevron' + (collapsed ? '' : ' expanded') + '" aria-hidden="true">' + iconSvg('chevronDown', 14) + '</span>';
  var count = groupTasks.length;
  var release = (groupKey !== NO_RELEASE_GROUP_KEY) ? getReleaseById(project, groupKey) : null;

  if(release){
    var statusMeta = getReleaseStatusMeta(release.status);
    nameCell.innerHTML = chevronHTML +
      '<div class="kf-timeline-name-text">' +
        '<span class="kf-tasklist-group-name">' + escapeHTML(release.name) + '</span>' +
        '<span class="kf-release-status-pill ' + normalizeReleaseStatus(release.status) + '">' + escapeHTML(statusMeta.label) + '</span>' +
      '</div>';
  } else {
    nameCell.innerHTML = chevronHTML + '<span class="kf-tasklist-group-name kf-tasklist-group-name-none">No Release</span>';
  }
  row.appendChild(nameCell);

  var track = document.createElement('div');
  track.className = 'kf-timeline-track';
  track.style.width = totalTrackWidth + 'px';
  columns.forEach(function(col){
    var cell = buildEl('div', 'kf-timeline-cell', '');
    cell.style.width = col.width + 'px';
    track.appendChild(cell);
  });

  if(release){
    // Same "an unsaved drag still wins" override as the task-row bar above.
    var pendingReleaseDates = _timelinePendingReleaseDates[release.id];
    var startD = localCalDateFromISO(pendingReleaseDates ? pendingReleaseDates.startISO : release.startDate);
    var endD = localCalDateFromISO(pendingReleaseDates ? pendingReleaseDates.endISO : release.endDate);
    if(startD || endD){
      var effStartD = startD || endD;
      var effEndD = endD || startD;
      var left = tlDateToPixel(effStartD, columns);
      var right = tlDateToPixel(tlAddDays(effEndD, 1), columns);
      var barWidth = Math.max(right - left, 6);
      var bar = document.createElement('div');
      bar.className = 'kf-timeline-bar kf-timeline-bar-release';
      bar.style.left = left + 'px';
      bar.style.width = barWidth + 'px';
      var releaseBarColor = release.color || '#cccccc';
      bar.style.setProperty('--kf-release-bar-accent', releaseBarColor);
      bar.style.color = contrastTextColor(releaseBarColor);
      bar.appendChild(buildEl('span', 'kf-timeline-handle kf-timeline-handle-start', ''));
      bar.lastChild.setAttribute('data-role', 'resize-start');
      bar.appendChild(buildEl('span', 'kf-timeline-handle kf-timeline-handle-end', ''));
      bar.lastChild.setAttribute('data-role', 'resize-end');
      bar.setAttribute('data-role', 'move');
      bar.addEventListener('mousedown', onTimelineBarPointerDown);
      bar.appendChild(buildEl('span', 'kf-timeline-bar-key', count + ' task' + (count === 1 ? '' : 's')));
      bar.title = release.name +
        (startD ? ' · Start ' + utcISOToLocalDisplayDate(pendingReleaseDates ? pendingReleaseDates.startISO : release.startDate) : '') +
        (endD ? ' · End ' + utcISOToLocalDisplayDate(pendingReleaseDates ? pendingReleaseDates.endISO : release.endDate) : '') +
        (pendingReleaseDates ? ' (unsaved)' : '');
      track.appendChild(bar);
    } else {
      track.appendChild(buildEl('div', 'kf-timeline-no-dates-note', 'No dates set'));
    }
  }

  if(todayX !== null){
    var todayLine = document.createElement('div');
    todayLine.className = 'kf-timeline-today-line';
    todayLine.style.left = todayX + 'px';
    track.appendChild(todayLine);
  }

  row.appendChild(track);
  return row;
}

/* =========================================================
   DRAG-TO-RESCHEDULE — the whole bar body (task or release) grabs to reshuffle both dates at once
   (duration preserved); the two edge handles resize just one date. Built on the same
   tlDateToPixel/tlPixelToDate pixel<->date pair modals/portfolio-dashboard.js's own Timeline chart
   drag already uses, translated from that chart's SVG x/width attributes to this view's plain DOM
   left/width styles — same math, different rendering model. `_timelineLayout` is captured once per
   renderTimeline() call (see its own comment above) so a drag started well after the last render
   still has the exact column model that produced the bar it's dragging.

   Dragging works in whole-day increments, not continuous pixels: a live day-width is measured once
   at drag start (the pixel span of exactly one day at the bar's own starting position — column
   width varies by granularity, so this is a local rate, not a fixed constant), and every mousemove
   snaps the pointer's raw pixel delta to the nearest multiple of that day-width before converting
   back to a date and re-deriving the pixel position from THAT date via tlDateToPixel — so the bar's
   live visual position always matches a real, snapped calendar day, never a fractional one.

   Nothing is persisted to the server/local DB as each individual drag ends, and the Timeline is
   deliberately NOT re-rendered after one — the bar is simply left at its own snapped drop position
   (already exactly where a re-render would have put it) and the change is recorded into the pending-
   changes maps below, which the "Save changes" button (see saveTimelineChanges) later flushes all at
   once. A second drag on the same (or a different) bar before Save reads its starting position from
   any already-pending change for that entity first — never straight from the possibly-stale
   task/release object — so consecutive un-saved drags stay consistent with what's actually on screen.

   A plain click (no real pointer movement) is left alone here: a task bar's own click already
   bubbles to app.js's existing delegated `#timelineInner` click listener (which opens the Task
   modal) since dragging never calls stopPropagation/preventDefault on that path; a release bar's
   click has no such existing listener, so onTimelineDragEnd opens the Release editor directly for
   that one case. A REAL drag, on the other hand, must NOT also let that ghost "click" fire
   afterward (browsers still dispatch one, since mousedown and mouseup landed on the same element) —
   suppressed via a capturing, run-once `click` listener registered the instant a drag actually
   moves, exactly the standard "swallow the trailing click after a drag" pattern.
   ========================================================= */
var _timelineLayout = null;
var _timelineDrag = null;
var TIMELINE_DRAG_CLICK_THRESHOLD = 4; // px of real pointer movement before a mousedown counts as a drag, not a click
var TIMELINE_DRAG_MIN_BAR_WIDTH = 8; // px — purely a live-drag visual floor, not a date constraint

// ---- unsaved (pending) drag state — flushed only by saveTimelineChanges() ----------------------
var _timelinePendingTaskDates = {};    // taskId -> {startISO, endISO}
var _timelinePendingReleaseDates = {}; // releaseId -> {startISO, endISO}
var _timelinePendingProjectDates = null; // {startISO, endISO} | null

function hasTimelinePendingChanges(){
  return Object.keys(_timelinePendingTaskDates).length > 0 ||
    Object.keys(_timelinePendingReleaseDates).length > 0 ||
    !!_timelinePendingProjectDates;
}
function updateTimelineSaveButtonState(){
  var btn = document.getElementById('timelineSaveBtn');
  if(btn) btn.disabled = !hasTimelinePendingChanges();
}
function resetTimelinePendingChanges(){
  _timelinePendingTaskDates = {};
  _timelinePendingReleaseDates = {};
  _timelinePendingProjectDates = null;
  updateTimelineSaveButtonState();
}
function setPendingTaskDates(taskId, startISO, endISO){
  _timelinePendingTaskDates[taskId] = {startISO: startISO, endISO: endISO};
  updateTimelineSaveButtonState();
}
function setPendingReleaseDates(releaseId, startISO, endISO){
  _timelinePendingReleaseDates[releaseId] = {startISO: startISO, endISO: endISO};
  updateTimelineSaveButtonState();
}
function setPendingProjectDates(startISO, endISO){
  _timelinePendingProjectDates = {startISO: startISO, endISO: endISO};
  updateTimelineSaveButtonState();
}
function getEffectiveReleaseDates(release, releaseId){
  return _timelinePendingReleaseDates[releaseId] || {startISO: release.startDate, endISO: release.endDate};
}
function getEffectiveProjectDates(project){
  return _timelinePendingProjectDates || {startISO: project.startDate, endISO: project.endDate};
}

// Repositions an already-rendered bar's left/width from a pair of ISO dates without a full
// re-render — used only when a conflict dialog's Cancel path clamps the just-dragged entity back
// to dates other than the ones it was visually dropped at (the Confirm path never needs this, since
// the dragged entity keeps its dropped dates exactly as dropped).
function repositionTimelineBar(barEl, startISO, endISO){
  if(!barEl || !_timelineLayout) return;
  var startD = localCalDateFromISO(startISO);
  var endD = localCalDateFromISO(endISO);
  var left = tlDateToPixel(startD, _timelineLayout.columns);
  var right = tlDateToPixel(tlAddDays(endD, 1), _timelineLayout.columns);
  barEl.style.left = left + 'px';
  barEl.style.width = Math.max(TIMELINE_DRAG_MIN_BAR_WIDTH, right - left) + 'px';
}

function onTimelineBarPointerDown(e){
  if(!_timelineLayout) return;
  var bar = e.currentTarget;
  var roleEl = e.target.closest ? e.target.closest('[data-role]') : null;
  var role = roleEl ? roleEl.getAttribute('data-role') : 'move';
  var project = getCurrentProject();
  if(!project) return;

  var isRelease = bar.classList.contains('kf-timeline-bar-release');
  var id, origStartD, origEndD;
  if(isRelease){
    var headerRow = bar.closest('.kf-timeline-row.kf-timeline-group-header');
    if(!headerRow) return;
    id = headerRow.getAttribute('data-group-key');
    var release = getReleaseById(project, id);
    if(!release) return;
    var effRelease = getEffectiveReleaseDates(release, id);
    origStartD = localCalDateFromISO(effRelease.startISO);
    origEndD = localCalDateFromISO(effRelease.endISO);
  } else {
    var row = bar.closest('.kf-timeline-row[data-task-id]');
    if(!row) return;
    id = row.getAttribute('data-task-id');
    var task = project.tasks[id];
    if(!task) return;
    var pendingTask = _timelinePendingTaskDates[id];
    origStartD = localCalDateFromISO(pendingTask ? pendingTask.startISO : task.startDate);
    origEndD = localCalDateFromISO(pendingTask ? pendingTask.endISO : task.endDate);
  }
  if(!origStartD && !origEndD) return; // nothing dated to drag from (bar wouldn't exist anyway)

  e.preventDefault();
  var effStartD = origStartD || origEndD;
  var effEndD = origEndD || origStartD;
  var columns = _timelineLayout.columns;

  // Local day-width measured at the bar's own current position — the pixel span of exactly one
  // calendar day right there, used to snap every subsequent mousemove to whole-day increments.
  var dayWidthPx = tlDateToPixel(tlAddDays(effStartD, 1), columns) - tlDateToPixel(effStartD, columns);
  if(!(dayWidthPx > 0)) dayWidthPx = 1;

  _timelineDrag = {
    kind: isRelease ? 'release' : 'task', id: id, role: role,
    pointerStartClientX: e.clientX, moved: false,
    origStartD: effStartD, origEndD: effEndD, liveStartD: effStartD, liveEndD: effEndD,
    dayWidthPx: dayWidthPx, columns: columns, barEl: bar
  };
  document.addEventListener('mousemove', onTimelineDragMove);
  document.addEventListener('mouseup', onTimelineDragEnd);
}

function onTimelineDragMove(e){
  var d = _timelineDrag;
  if(!d) return;
  var deltaX = e.clientX - d.pointerStartClientX;
  if(Math.abs(deltaX) >= TIMELINE_DRAG_CLICK_THRESHOLD) d.moved = true;

  // Snap the raw pixel delta to the nearest whole day BEFORE touching any date — every subsequent
  // pixel position is then re-derived from that snapped date via tlDateToPixel, so the bar's live
  // position always lands exactly on a day marker, never a fractional-day pixel offset.
  var dayDelta = Math.round(deltaX / d.dayWidthPx);

  // Deliberately NOT clamped to the visible chart's own [0, totalTrackWidth] pixel bounds — unlike
  // Portfolio Dashboard's own drag (which has no reason to leave its chart's rendered area), this
  // gesture's whole conflict-resolution feature (Task past its Release, Release past the Project)
  // depends on being draggable past whatever's currently rendered. tlPixelToDate/tlDateToPixel
  // both already extrapolate past the first/last column at that column's own rate (see their own
  // doc comments), so a bar dragged off the visible grid still converts back to a real, correctly-
  // extrapolated date on drop — it just temporarily renders outside `.kf-timeline-track`'s own box
  // (still visible, since neither that element nor its scrolling ancestor clips overflow).
  var newStartD = d.origStartD, newEndD = d.origEndD;

  if(d.role === 'move'){
    newStartD = tlAddDays(d.origStartD, dayDelta);
    newEndD = tlAddDays(d.origEndD, dayDelta);
  } else if(d.role === 'resize-start'){
    newStartD = tlAddDays(d.origStartD, dayDelta);
    if(newStartD.getTime() > d.origEndD.getTime()) newStartD = new Date(d.origEndD);
  } else if(d.role === 'resize-end'){
    newEndD = tlAddDays(d.origEndD, dayDelta);
    if(newEndD.getTime() < d.origStartD.getTime()) newEndD = new Date(d.origStartD);
  }

  d.liveStartD = newStartD;
  d.liveEndD = newEndD;
  var left = tlDateToPixel(newStartD, d.columns);
  var right = tlDateToPixel(tlAddDays(newEndD, 1), d.columns);
  d.barEl.style.left = left + 'px';
  d.barEl.style.width = Math.max(TIMELINE_DRAG_MIN_BAR_WIDTH, right - left) + 'px';
}

function suppressTrailingClick(e){
  e.stopPropagation();
  document.removeEventListener('click', suppressTrailingClick, true);
}

function onTimelineDragEnd(){
  var d = _timelineDrag;
  if(!d) return;
  document.removeEventListener('mousemove', onTimelineDragMove);
  document.removeEventListener('mouseup', onTimelineDragEnd);
  _timelineDrag = null;

  if(!d.moved){
    if(d.kind === 'release') _openReleaseEditor(d.id);
    // A task bar's own click already opens the Task modal via app.js's existing delegated
    // #timelineInner click listener — nothing to do here for that case.
    return;
  }

  // Registered NOW (only once a real drag is confirmed) so the very next native "click" this
  // gesture produces never reaches app.js's own click-to-open listener. A real browser dispatches
  // that trailing click synchronously, in this same tick — but as a safety net against whatever
  // gesture DOESN'T produce one (the mouse leaving the window, focus changing mid-drag, or simply
  // this codebase's own tests, which drive mouse events individually rather than through a real
  // browser's click-synthesis), a macrotask fallback clears it shortly after either way, so a
  // once-armed suppressor can never leak into swallowing some later, unrelated click.
  document.addEventListener('click', suppressTrailingClick, true);
  setTimeout(function(){ document.removeEventListener('click', suppressTrailingClick, true); }, 0);

  // d.liveStartD/liveEndD are already whole local-midnight Date objects (every step above only ever
  // adds a whole number of days to an already-local-midnight origin) — no further rounding needed.
  var startISO = localDateValueToUTCISO(localDateValueFromDate(d.liveStartD));
  var endISO = localDateValueToUTCISO(localDateValueFromDate(d.liveEndD));
  if(d.kind === 'task') applyTaskDragResult(d.id, startISO, endISO, d.barEl);
  else applyReleaseDragResult(d.id, startISO, endISO, d.barEl);
}

// ---- persistence (local vs. server-authoritative) --------------------------------------------

function saveTaskDatesAnywhere(project, taskId, startISO, endISO){
  if(isServerAuthoritative(project)) return updateTaskDatesOnServer(project, taskId, startISO, endISO);
  updateTaskDates(project, taskId, startISO, endISO);
  return Promise.resolve();
}
function saveReleaseDatesAnywhere(project, releaseId, startISO, endISO){
  if(isServerAuthoritative(project)) return updateReleaseDatesOnServer(project, releaseId, startISO, endISO);
  updateReleaseDates(project, releaseId, startISO, endISO);
  return Promise.resolve();
}
function saveProjectDatesAnywhere(project, startISO, endISO){
  if(isServerAuthoritative(project)) return updateProjectOnServer(project, project.name, project.key, startISO, endISO, project.description);
  renameProject(project.id, project.name, project.key, startISO, endISO, project.description);
  return Promise.resolve();
}

// The one place every actual write happens — called only by the "Save changes" button, never by an
// individual drag. Runs every pending task/release/project write sequentially (not in parallel), so
// the project-dates write — which reads the *current* project object's other fields back through
// renameProject/updateProjectOnServer — never races a release write that hasn't landed in local
// state yet on a local-only project. Re-renders the Timeline + Board exactly once at the end,
// regardless of how many bars were dragged since the last save.
export function saveTimelineChanges(){
  var project = getCurrentProject();
  if(!project || !hasTimelinePendingChanges()) return Promise.resolve();

  var btn = document.getElementById('timelineSaveBtn');
  if(btn) btn.disabled = true;

  var ops = [];
  Object.keys(_timelinePendingTaskDates).forEach(function(taskId){
    var c = _timelinePendingTaskDates[taskId];
    ops.push(function(){ return saveTaskDatesAnywhere(getCurrentProject(), taskId, c.startISO, c.endISO); });
  });
  Object.keys(_timelinePendingReleaseDates).forEach(function(releaseId){
    var c = _timelinePendingReleaseDates[releaseId];
    ops.push(function(){ return saveReleaseDatesAnywhere(getCurrentProject(), releaseId, c.startISO, c.endISO); });
  });
  if(_timelinePendingProjectDates){
    var pc = _timelinePendingProjectDates;
    ops.push(function(){ return saveProjectDatesAnywhere(getCurrentProject(), pc.startISO, pc.endISO); });
  }

  var chain = Promise.resolve();
  ops.forEach(function(op){ chain = chain.then(op); });

  return chain.then(function(){
    resetTimelinePendingChanges();
    renderTimeline();
    renderBoard();
  }, function(err){
    _toast('Could not save Timeline changes' + (err && err.message ? ': ' + err.message : '.'));
    resetTimelinePendingChanges();
    renderTimeline();
    renderBoard();
  });
}

// ---- cross-entity date-range helpers -----------------------------------------------------------

function rangeIsOutside(startISO, endISO, boundStartISO, boundEndISO){
  if(!boundStartISO && !boundEndISO) return false;
  if(boundStartISO && new Date(startISO).getTime() < new Date(boundStartISO).getTime()) return true;
  if(boundEndISO && new Date(endISO).getTime() > new Date(boundEndISO).getTime()) return true;
  return false;
}
function earlierISO(a, b){
  if(!a) return b; if(!b) return a;
  return new Date(a).getTime() <= new Date(b).getTime() ? a : b;
}
function laterISO(a, b){
  if(!a) return b; if(!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}
function clampISOToRange(startISO, endISO, boundStartISO, boundEndISO){
  var s = startISO, e = endISO;
  if(boundStartISO && new Date(s).getTime() < new Date(boundStartISO).getTime()) s = boundStartISO;
  if(boundEndISO && new Date(e).getTime() > new Date(boundEndISO).getTime()) e = boundEndISO;
  if(new Date(e).getTime() < new Date(s).getTime()) e = s;
  return {startISO: s, endISO: e};
}
function timelineRangeText(startISO, endISO){
  return (startISO ? utcISOToLocalDisplayDate(startISO) : '—') + ' – ' + (endISO ? utcISOToLocalDisplayDate(endISO) : '—');
}

// ---- drop handlers: record the new dates as pending, resolving a Task<->Release or
// Release<->Project conflict against whatever's already pending for the other entity (not
// necessarily its last-saved dates, if it was itself already dragged earlier this same session).
// Nothing here writes to the server/local DB or re-renders — see saveTimelineChanges for that.

function applyTaskDragResult(taskId, startISO, endISO, barEl){
  var project = getCurrentProject();
  if(!project) return;
  var t = project.tasks[taskId];
  if(!t) return;
  var release = t.releaseId ? getReleaseById(project, t.releaseId) : null;
  var effRelease = release ? getEffectiveReleaseDates(release, release.id) : null;

  if(release && rangeIsOutside(startISO, endISO, effRelease.startISO, effRelease.endISO)){
    var expandedStart = earlierISO(effRelease.startISO, startISO);
    var expandedEnd = laterISO(effRelease.endISO, endISO);
    _confirmDialog(
      'Task now falls outside its Release',
      '"' + t.key + '" is now scheduled ' + timelineRangeText(startISO, endISO) + ', outside Release "' +
        release.name + '"\'s own dates (' + timelineRangeText(effRelease.startISO, effRelease.endISO) + '). ' +
        'Click Confirm to expand the Release to cover the Task\'s new dates, Cancel to fit the Task back within the Release\'s dates, or Ignore to leave the drag unsaved.',
      function(){
        setPendingTaskDates(taskId, startISO, endISO);
        setPendingReleaseDates(release.id, expandedStart, expandedEnd);
      },
      function(){
        var clamped = clampISOToRange(startISO, endISO, effRelease.startISO, effRelease.endISO);
        setPendingTaskDates(taskId, clamped.startISO, clamped.endISO);
        repositionTimelineBar(barEl, clamped.startISO, clamped.endISO);
      },
      true
    );
    return;
  }

  setPendingTaskDates(taskId, startISO, endISO);
}

function applyReleaseDragResult(releaseId, startISO, endISO, barEl){
  var project = getCurrentProject();
  if(!project) return;
  var release = getReleaseById(project, releaseId);
  if(!release) return;
  var effProject = getEffectiveProjectDates(project);

  if(rangeIsOutside(startISO, endISO, effProject.startISO, effProject.endISO)){
    var expandedStart = earlierISO(effProject.startISO, startISO);
    var expandedEnd = laterISO(effProject.endISO, endISO);
    _confirmDialog(
      'Release now falls outside the Project dates',
      '"' + release.name + '" is now scheduled ' + timelineRangeText(startISO, endISO) + ', outside the Project\'s own dates (' +
        timelineRangeText(effProject.startISO, effProject.endISO) + '). ' +
        'Click Confirm to expand the Project\'s dates to cover the Release, Cancel to fit the Release back within the Project\'s dates, or Ignore to leave the drag unsaved.',
      function(){
        setPendingReleaseDates(releaseId, startISO, endISO);
        setPendingProjectDates(expandedStart, expandedEnd);
      },
      function(){
        var clamped = clampISOToRange(startISO, endISO, effProject.startISO, effProject.endISO);
        setPendingReleaseDates(releaseId, clamped.startISO, clamped.endISO);
        repositionTimelineBar(barEl, clamped.startISO, clamped.endISO);
      },
      true
    );
    return;
  }

  setPendingReleaseDates(releaseId, startISO, endISO);
}
