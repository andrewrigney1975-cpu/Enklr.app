const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync('../dist/index.html', 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/', pretendToBeVisual: true });
const { window } = dom;
function wait(ms){ return new Promise(r => setTimeout(r, ms)); }

/* Covers Timeline's drag-to-reschedule gesture (views/timeline.js's onTimelineBarPointerDown/
   onTimelineDragMove/onTimelineDragEnd) — dragging a whole task/release bar shifts both dates
   together; dragging an edge handle resizes just one date; a plain (non-moved) click still opens
   the Task modal / Release editor exactly as before. Also covers the two cross-entity conflict
   dialogs: a Task dragged outside its Release's dates, and a Release dragged outside the Project's
   dates, each offering "expand the container" (Confirm) or "fit back inside it" (Cancel).

   Dragging no longer writes immediately — it only stages a pending change and enables the
   "Save changes" button (#timelineSaveBtn, disabled otherwise); nothing is actually persisted, and
   the Timeline is not re-rendered, until that button is clicked. Every assertion below that reads
   dates back out therefore clicks Save first.

   At the 'day' timescale, jsdom's zero real layout (.clientWidth always 0) makes every render fall
   back to `availableWidth = 900`, and with that many day-columns in a year-long range, colWidth
   always clamps to TIMESCALE_CONFIG.day.minWidth (30px) — so every drag delta here is a clean,
   predictable multiple of 30px per day, not something guessed empirically. */

function setProjectDates(doc, startVal, endVal){
  doc.getElementById('editProjectBtn').click();
  doc.getElementById('projectStartDateInput').value = startVal || '';
  doc.getElementById('projectEndDateInput').value = endVal || '';
  doc.getElementById('projectSaveBtn').click();
}
function setTaskDates(doc, taskTitle, startVal, endVal){
  var card = Array.from(doc.querySelectorAll('.kf-card')).find(c => c.textContent.indexOf(taskTitle) !== -1);
  card.click();
  doc.getElementById('taskStartDateInput').value = startVal;
  doc.getElementById('taskEndDateInput').value = endVal;
  doc.getElementById('taskSaveBtn').click();
}
function readTaskDates(doc, taskTitle){
  var card = Array.from(doc.querySelectorAll('.kf-card')).find(c => c.textContent.indexOf(taskTitle) !== -1);
  card.click();
  var res = {start: doc.getElementById('taskStartDateInput').value, end: doc.getElementById('taskEndDateInput').value};
  doc.getElementById('taskCancelBtn').click();
  return res;
}
function createRelease(doc, name, startVal, endVal){
  doc.getElementById('releasesBtn').click();
  doc.getElementById('addReleaseBtn').click();
  doc.getElementById('releaseNameInput').value = name;
  doc.getElementById('releaseStartDateInput').value = startVal || '';
  doc.getElementById('releaseEndDateInput').value = endVal || '';
  doc.getElementById('releaseFormSaveBtn').click();
  doc.getElementById('releasesDoneBtn').click();
}
function readReleaseDates(doc, name){
  doc.getElementById('releasesBtn').click();
  var row = Array.from(doc.querySelectorAll('.kf-release-row')).find(r => r.textContent.indexOf(name) !== -1);
  row.click();
  var res = {start: doc.getElementById('releaseStartDateInput').value, end: doc.getElementById('releaseEndDateInput').value};
  doc.getElementById('releasesDoneBtn').click();
  return res;
}
function assignTaskToRelease(doc, taskTitle, releaseName){
  var card = Array.from(doc.querySelectorAll('.kf-card')).find(c => c.textContent.indexOf(taskTitle) !== -1);
  card.click();
  var select = doc.getElementById('taskReleaseSelect');
  var opt = Array.from(select.options).find(o => o.textContent === releaseName);
  select.value = opt.value;
  doc.getElementById('taskSaveBtn').click();
}
function fireMouse(el, type, clientX){
  el.dispatchEvent(new window.MouseEvent(type, {bubbles: true, cancelable: true, clientX: clientX}));
}
function taskBar(doc, taskTitle){
  var row = Array.from(doc.querySelectorAll('.kf-timeline-row[data-task-id]')).find(r => r.textContent.indexOf(taskTitle) !== -1);
  return row.querySelector('.kf-timeline-bar');
}
function releaseBar(doc, releaseName){
  var header = Array.from(doc.querySelectorAll('.kf-timeline-row.kf-timeline-group-header')).find(h => h.textContent.indexOf(releaseName) !== -1);
  return header.querySelector('.kf-timeline-bar-release');
}
// Drags `bar` by `days` * 30px via the given role ('move'/'resize-start'/'resize-end'), starting
// the mousedown on the bar itself for 'move' or on the matching handle for a resize.
function dragBarByDays(doc, bar, role, days){
  var target = role === 'move' ? bar : bar.querySelector('.kf-timeline-handle-' + role.replace('resize-', ''));
  var deltaX = days * 30;
  fireMouse(target, 'mousedown', 0);
  fireMouse(doc, 'mousemove', deltaX);
  fireMouse(doc, 'mouseup', deltaX);
}

(async () => {
  await wait(300);
  const doc = window.document;
  function log(label, ok, extra){ console.log((ok?'PASS':'FAIL') + ' - ' + label + (extra !== undefined ? ' :: ' + extra : '')); }

  setProjectDates(doc, '2026-01-01', '2026-12-31');
  await wait(20);
  setTaskDates(doc, 'Look at Project and App Settings', '2026-03-10', '2026-03-12');
  await wait(20);

  doc.getElementById('timelineBtn').click();
  await wait(20);
  doc.getElementById('timelineScaleSelect').value = 'day';
  doc.getElementById('timelineScaleSelect').dispatchEvent(new window.Event('change', {bubbles: true}));
  await wait(20);

  // ── Resize handles exist and start transparent, revealed on row hover via CSS only ───────────
  {
    var bar = taskBar(doc, 'Look at Project and App Settings');
    log('a dated task bar has a start resize handle', bar.querySelector('.kf-timeline-handle-start') !== null);
    log('a dated task bar has an end resize handle', bar.querySelector('.kf-timeline-handle-end') !== null);
    log('the bar itself is marked data-role="move"', bar.getAttribute('data-role') === 'move');
  }

  // ── Save changes starts disabled, and stays disabled by a plain (non-moved) click ─────────────
  log('Save changes starts disabled with nothing dragged yet', doc.getElementById('timelineSaveBtn').disabled === true);

  // ── Whole-bar drag ("move") shifts both dates by the same amount, but only once Saved ─────────
  dragBarByDays(doc, taskBar(doc, 'Look at Project and App Settings'), 'move', 5);
  await wait(20);
  log('dragging a bar enables the Save changes button', doc.getElementById('timelineSaveBtn').disabled === false);
  doc.getElementById('timelineSaveBtn').click();
  await wait(20);
  {
    var d = readTaskDates(doc, 'Look at Project and App Settings');
    log('moving the bar 5 days shifts the start date', d.start === '2026-03-15', d.start);
    log('moving the bar 5 days shifts the end date by the same amount (duration preserved)', d.end === '2026-03-17', d.end);
  }
  log('Save changes is disabled again right after saving', doc.getElementById('timelineSaveBtn').disabled === true);

  doc.getElementById('timelineBtn').click();
  await wait(20);

  // ── Resize-start handle only moves the start date ────────────────────────────────────────────
  dragBarByDays(doc, taskBar(doc, 'Look at Project and App Settings'), 'resize-start', 2);
  await wait(20);
  doc.getElementById('timelineSaveBtn').click();
  await wait(20);
  {
    var d = readTaskDates(doc, 'Look at Project and App Settings');
    log('resizing the start handle moves only the start date', d.start === '2026-03-17', d.start);
    log('resizing the start handle leaves the end date alone', d.end === '2026-03-17', d.end);
  }

  doc.getElementById('timelineBtn').click();
  await wait(20);

  // ── Resize-end handle only moves the end date ────────────────────────────────────────────────
  dragBarByDays(doc, taskBar(doc, 'Look at Project and App Settings'), 'resize-end', 4);
  await wait(20);
  doc.getElementById('timelineSaveBtn').click();
  await wait(20);
  {
    var d = readTaskDates(doc, 'Look at Project and App Settings');
    log('resizing the end handle leaves the start date alone', d.start === '2026-03-17', d.start);
    log('resizing the end handle moves only the end date', d.end === '2026-03-21', d.end);
  }

  // ── Dragging snaps to the nearest whole day, not a raw pixel offset ───────────────────────────
  // At the 'day' timescale colWidth clamps to 30px (see file header comment), so a 10px drag is
  // well under half a day-width and must round DOWN to a zero-day (no-op) move, while a 20px drag
  // is over half a day-width and must round UP to a full one-day move.
  doc.getElementById('timelineBtn').click();
  await wait(20);
  {
    var bar = taskBar(doc, 'Look at Project and App Settings');
    fireMouse(bar, 'mousedown', 0);
    fireMouse(doc, 'mousemove', 10);
    fireMouse(doc, 'mouseup', 10);
  }
  await wait(20);
  doc.getElementById('timelineSaveBtn').click();
  await wait(20);
  {
    var d = readTaskDates(doc, 'Look at Project and App Settings');
    log('a sub-half-day-width drag snaps back to zero days moved', d.start === '2026-03-17' && d.end === '2026-03-21', JSON.stringify(d));
  }

  doc.getElementById('timelineBtn').click();
  await wait(20);
  {
    var bar = taskBar(doc, 'Look at Project and App Settings');
    fireMouse(bar, 'mousedown', 0);
    fireMouse(doc, 'mousemove', 20);
    fireMouse(doc, 'mouseup', 20);
  }
  await wait(20);
  doc.getElementById('timelineSaveBtn').click();
  await wait(20);
  {
    var d = readTaskDates(doc, 'Look at Project and App Settings');
    log('a past-half-day-width drag snaps up to a full one-day move', d.start === '2026-03-18' && d.end === '2026-03-22', JSON.stringify(d));
  }

  // ── A non-moved click still opens the Task modal (unaffected by the new drag wiring) ─────────
  doc.getElementById('timelineBtn').click();
  await wait(20);
  {
    var bar = taskBar(doc, 'Look at Project and App Settings');
    fireMouse(bar, 'mousedown', 100);
    fireMouse(doc, 'mouseup', 100); // no intervening mousemove at all -> zero movement, a plain click
    bar.dispatchEvent(new window.MouseEvent('click', {bubbles: true, cancelable: true}));
    await wait(20);
    log('a plain click on a task bar still opens the Task modal', doc.getElementById('taskTitleInput').value === 'Look at Project and App Settings');
    doc.getElementById('taskCancelBtn').click();
    await wait(10);
  }

  // ── A real drag suppresses the trailing click (doesn't also open the Task modal) ─────────────
  doc.getElementById('timelineBtn').click();
  await wait(20);
  {
    var bar = taskBar(doc, 'Look at Project and App Settings');
    fireMouse(bar, 'mousedown', 0);
    fireMouse(doc, 'mousemove', 60);
    fireMouse(doc, 'mouseup', 60);
    bar.dispatchEvent(new window.MouseEvent('click', {bubbles: true, cancelable: true}));
    await wait(20);
    log('a real drag does not also open the Task modal via the trailing click', doc.getElementById('taskOverlay').classList.contains('hidden'));
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // Task <-> Release conflict: dragging a Task outside its Release's own dates
  // ══════════════════════════════════════════════════════════════════════════════════════════
  doc.getElementById('timelineClose').click();
  await wait(10);
  setTaskDates(doc, 'Draft project objectives', '2026-05-10', '2026-05-12');
  await wait(20);
  createRelease(doc, 'Conflict Release', '2026-05-01', '2026-05-20');
  await wait(20);
  assignTaskToRelease(doc, 'Draft project objectives', 'Conflict Release');
  await wait(20);

  doc.getElementById('timelineBtn').click();
  await wait(20);
  doc.getElementById('timelineScaleSelect').value = 'day';
  doc.getElementById('timelineScaleSelect').dispatchEvent(new window.Event('change', {bubbles: true}));
  await wait(20);

  // Drag the task 15 days later — well past the release's own May 20 end date.
  dragBarByDays(doc, taskBar(doc, 'Draft project objectives'), 'move', 15);
  await wait(20);
  log('dragging a Task outside its Release opens the conflict dialog', !doc.getElementById('confirmOverlay').classList.contains('hidden'));
  log('the conflict dialog names the Task', doc.getElementById('confirmMessage').textContent.indexOf('Draft project objectives') === -1 &&
      doc.getElementById('confirmTitle').textContent.indexOf('Release') !== -1, doc.getElementById('confirmTitle').textContent);
  log('the conflict message mentions the Release by name', doc.getElementById('confirmMessage').textContent.indexOf('Conflict Release') !== -1, doc.getElementById('confirmMessage').textContent);

  // Confirm only stages the change — nothing is written until Save is clicked.
  doc.getElementById('confirmOkBtn').click();
  await wait(20);
  log('confirming the conflict enables Save changes but does not write yet', doc.getElementById('timelineSaveBtn').disabled === false);
  doc.getElementById('timelineSaveBtn').click();
  await wait(20);
  {
    var taskD = readTaskDates(doc, 'Draft project objectives');
    var relD = readReleaseDates(doc, 'Conflict Release');
    log('Confirm keeps the Task at its dragged-to dates', taskD.start === '2026-05-25' && taskD.end === '2026-05-27', JSON.stringify(taskD));
    log('Confirm expands the Release end date to cover the Task', relD.end === '2026-05-27', JSON.stringify(relD));
    log('Confirm leaves the Release start date alone (Task never went before it)', relD.start === '2026-05-01', JSON.stringify(relD));
  }

  // Drag it back out the OTHER side (before the release start) and choose Cancel this time.
  doc.getElementById('timelineBtn').click();
  await wait(20);
  doc.getElementById('timelineScaleSelect').value = 'day';
  doc.getElementById('timelineScaleSelect').dispatchEvent(new window.Event('change', {bubbles: true}));
  await wait(20);
  dragBarByDays(doc, taskBar(doc, 'Draft project objectives'), 'move', -40); // well before May 1
  await wait(20);
  log('dragging the other direction also opens the conflict dialog', !doc.getElementById('confirmOverlay').classList.contains('hidden'));

  doc.getElementById('confirmCancelBtn').click();
  await wait(20);
  doc.getElementById('timelineSaveBtn').click();
  await wait(20);
  {
    var taskD = readTaskDates(doc, 'Draft project objectives');
    var relD = readReleaseDates(doc, 'Conflict Release');
    log('Cancel fits the Task back within the Release\'s own start date', taskD.start === '2026-05-01', JSON.stringify(taskD));
    log('Cancel leaves the Release\'s own dates untouched', relD.start === '2026-05-01' && relD.end === '2026-05-27', JSON.stringify(relD));
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // Release <-> Project conflict: dragging a Release outside the Project's own dates
  // ══════════════════════════════════════════════════════════════════════════════════════════
  doc.getElementById('timelineBtn').click();
  await wait(20);
  doc.getElementById('timelineScaleSelect').value = 'day';
  doc.getElementById('timelineScaleSelect').dispatchEvent(new window.Event('change', {bubbles: true}));
  await wait(20);

  // Drag the release forward well past the project's Dec 31 2026 end date.
  dragBarByDays(doc, releaseBar(doc, 'Conflict Release'), 'move', 250);
  await wait(20);
  log('dragging a Release outside the Project dates opens the conflict dialog', !doc.getElementById('confirmOverlay').classList.contains('hidden'));
  log('the conflict dialog title mentions the Project', doc.getElementById('confirmTitle').textContent.indexOf('Project') !== -1, doc.getElementById('confirmTitle').textContent);

  doc.getElementById('confirmOkBtn').click();
  await wait(20);
  doc.getElementById('timelineSaveBtn').click();
  await wait(20);
  {
    doc.getElementById('editProjectBtn').click();
    var projStart = doc.getElementById('projectStartDateInput').value;
    var projEnd = doc.getElementById('projectEndDateInput').value;
    doc.getElementById('projectCancelBtn').click();
    log('Confirm expands the Project end date to cover the dragged Release', projEnd > '2026-12-31', projEnd);
    log('Confirm leaves the Project start date alone', projStart === '2026-01-01', projStart);
  }

  // ── Plain click on a release bar opens the Release editor, not a collapse toggle ─────────────
  doc.getElementById('timelineBtn').click();
  await wait(20);
  {
    var bar = releaseBar(doc, 'Conflict Release');
    fireMouse(bar, 'mousedown', 0);
    fireMouse(doc, 'mouseup', 0);
    bar.dispatchEvent(new window.MouseEvent('click', {bubbles: true, cancelable: true}));
    await wait(20);
    log('a plain click on a release bar opens the Release editor', !doc.getElementById('releasesOverlay').classList.contains('hidden'));
    log('the Release editor shows the right release', doc.getElementById('releaseNameInput').value === 'Conflict Release');
    doc.getElementById('releasesDoneBtn').click();
    await wait(10);
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // Closing with unsaved changes (close icon + Escape) prompts to save/discard; a backdrop click
  // does not (deliberately out of scope for this guard).
  // ══════════════════════════════════════════════════════════════════════════════════════════

  // ── No pending changes: Close and Escape both close immediately, no confirm dialog ────────────
  doc.getElementById('timelineBtn').click();
  await wait(20);
  doc.getElementById('timelineClose').click();
  await wait(20);
  log('closing with nothing unsaved does not show a confirm dialog', doc.getElementById('confirmOverlay').classList.contains('hidden'));
  log('closing with nothing unsaved actually closes the Timeline', doc.getElementById('timelineOverlay').classList.contains('hidden'));

  doc.getElementById('timelineBtn').click();
  await wait(20);
  doc.dispatchEvent(new window.KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
  await wait(20);
  log('Escape with nothing unsaved does not show a confirm dialog', doc.getElementById('confirmOverlay').classList.contains('hidden'));
  log('Escape with nothing unsaved actually closes the Timeline', doc.getElementById('timelineOverlay').classList.contains('hidden'));

  // ── Pending changes: Close icon prompts; Ignore stays open, keeps the pending change ───────────
  doc.getElementById('timelineBtn').click();
  await wait(20);
  doc.getElementById('timelineScaleSelect').value = 'day';
  doc.getElementById('timelineScaleSelect').dispatchEvent(new window.Event('change', {bubbles: true}));
  await wait(20);
  dragBarByDays(doc, taskBar(doc, 'Look at Project and App Settings'), 'move', 3);
  await wait(20);

  doc.getElementById('timelineClose').click();
  await wait(20);
  log('closing with unsaved changes opens a confirm dialog', !doc.getElementById('confirmOverlay').classList.contains('hidden'));
  log('the dialog mentions unsaved Timeline changes', doc.getElementById('confirmTitle').textContent.indexOf('Unsaved') !== -1, doc.getElementById('confirmTitle').textContent);
  log('the Timeline itself is still open behind the dialog', !doc.getElementById('timelineOverlay').classList.contains('hidden'));

  doc.getElementById('confirmIgnoreBtn').click();
  await wait(20);
  log('Ignore closes the dialog but leaves the Timeline open', doc.getElementById('confirmOverlay').classList.contains('hidden') && !doc.getElementById('timelineOverlay').classList.contains('hidden'));
  log('Ignore leaves the pending change (and Save button) intact', doc.getElementById('timelineSaveBtn').disabled === false);

  // ── Cancel: discards the pending change and closes without saving ─────────────────────────────
  doc.getElementById('timelineClose').click();
  await wait(20);
  doc.getElementById('confirmCancelBtn').click();
  await wait(20);
  log('Cancel closes the Timeline', doc.getElementById('timelineOverlay').classList.contains('hidden'));
  {
    var d = readTaskDates(doc, 'Look at Project and App Settings');
    log('Cancel discarded the unsaved drag (dates unchanged)', d.start === '2026-03-18' && d.end === '2026-03-22', JSON.stringify(d));
  }

  // ── Confirm (via Escape this time): saves the pending change, then closes ─────────────────────
  doc.getElementById('timelineBtn').click();
  await wait(20);
  doc.getElementById('timelineScaleSelect').value = 'day';
  doc.getElementById('timelineScaleSelect').dispatchEvent(new window.Event('change', {bubbles: true}));
  await wait(20);
  dragBarByDays(doc, taskBar(doc, 'Look at Project and App Settings'), 'move', 2);
  await wait(20);

  doc.dispatchEvent(new window.KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
  await wait(20);
  log('Escape with unsaved changes opens the same confirm dialog', !doc.getElementById('confirmOverlay').classList.contains('hidden'));

  doc.getElementById('confirmOkBtn').click();
  await wait(30);
  log('Confirm closes the Timeline once the save settles', doc.getElementById('timelineOverlay').classList.contains('hidden'));
  {
    var d = readTaskDates(doc, 'Look at Project and App Settings');
    log('Confirm actually saved the dragged dates before closing', d.start === '2026-03-20' && d.end === '2026-03-24', JSON.stringify(d));
  }

  console.log('Timeline drag-to-reschedule test complete.');
  process.exit(0);
})().catch(e => { console.error('CRASHED', e); process.exit(1); });
