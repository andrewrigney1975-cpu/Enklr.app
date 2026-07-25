"use strict";
import { getTasksArray, getColumn, getMemberById, getTaskTypeById, getReleaseById, isTaskOverdue, escapeHTML, memberLabel, compareReleaseGroupKeys } from '../utils.js';
import { getCurrentProject } from '../store.js';
import { ui } from '../ui.js';
import { getPriority } from '../ui.js';
import { iconSvg } from '../icons.js';
import { utcISOToLocalDisplayDate, utcISOToLocalDateValue, localDateValueToUTCISO, memberInitials, clampProgress } from '../date-utils.js';
import { isTimeTrackingEnabled } from '../storage.js';
import { NO_RELEASE_GROUP_KEY, getReleaseStatusMeta, normalizeReleaseStatus } from './task-list.js';

function iconHTML(name, size){ return '<span class="kf-icon">'+iconSvg(name,size)+'</span>'; }
function buildEl(tag, className, innerHTML){ var el = document.createElement(tag); if(className) el.className = className; if(innerHTML !== undefined) el.innerHTML = innerHTML; return el; }

var PRIORITY_ORDER = ['trivial','low','medium','high','critical'];

var _toast = function(msg){ console.error(msg); };
var _openTaskModal = function(){};
export function setTimelineDeps(deps){
  if(deps.toast) _toast = deps.toast;
  if(deps.openTaskModal) _openTaskModal = deps.openTaskModal;
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
  document.getElementById('timelineScaleSelect').value = ui.timelineScale;
  updateTimelineArchiveToggleButton();
  // Session-only, reset every time the overlay opens — same convention as Task List's own
  // ui.taskListCollapsedGroups reset in openTaskListOverlay, so a release left collapsed from a
  // previous visit doesn't silently stay hidden the next time this is opened.
  ui.timelineCollapsedGroups = new Set();
  document.getElementById('timelineOverlay').classList.remove('hidden');
  renderTimeline();
}
export function closeTimelineOverlay(){
  document.getElementById('timelineOverlay').classList.add('hidden');
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
  var nameColWidth = 240;
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

    var startD = localCalDateFromISO(t.startDate);
    var endD = localCalDateFromISO(t.endDate);
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
        (startD ? ' · Start ' + utcISOToLocalDisplayDate(t.startDate) : '') +
        (endD ? ' · End ' + utcISOToLocalDisplayDate(t.endDate) : '');
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
}

/* Release group header row — a hybrid of Task List's own group header (chevron + name + status
   pill + task count, toggling collapse on click) and a Timeline task row's own name-cell/track
   shape (so it lines up in the same two-column grid every other row uses). The release's own bar
   — only drawn when it has at least one of startDate/endDate set, exactly like a task's own "no
   dates set" fallback — reuses the Portfolio Planner's "inactive project, no styling to imply
   scheduling urgency" grey-hatched look (portfolio-bars.js's noDatesPatternDefsSVG pattern,
   reimplemented here as a CSS repeating-linear-gradient since Timeline's own bars are plain DOM
   elements, not SVG — see .kf-timeline-bar-release in styles.css) rather than a priority color,
   since a release has no priority of its own to color it by. */
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
    var startD = localCalDateFromISO(release.startDate);
    var endD = localCalDateFromISO(release.endDate);
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
      bar.appendChild(buildEl('span', 'kf-timeline-bar-key', count + ' task' + (count === 1 ? '' : 's')));
      bar.title = release.name +
        (startD ? ' · Start ' + utcISOToLocalDisplayDate(release.startDate) : '') +
        (endD ? ' · End ' + utcISOToLocalDisplayDate(release.endDate) : '');
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
