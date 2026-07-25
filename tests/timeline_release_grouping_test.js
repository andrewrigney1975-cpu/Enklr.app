const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync('../dist/index.html', 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/', pretendToBeVisual: true });
const { window } = dom;
function wait(ms){ return new Promise(r => setTimeout(r, ms)); }

/* Covers Releases-as-a-grouping-element on the Timeline (views/timeline.js's
   buildTimelineReleaseGroupHeader + the grouping/ordering logic added to renderTimeline) — the
   same release-group header/expand-collapse convention as the List view (task-list.js), plus each
   release's own Gantt bar plotted by its start/end dates using the Portfolio Planner's
   grey-hatched "no priority to color it by" look, since a release (unlike a task) has no
   priority. */

function setProjectDates(doc, startVal, endVal){
  doc.getElementById('editProjectBtn').click();
  doc.getElementById('projectStartDateInput').value = startVal || '';
  doc.getElementById('projectEndDateInput').value = endVal || '';
  doc.getElementById('projectSaveBtn').click();
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
function assignTaskToRelease(doc, taskTitle, releaseName){
  var card = Array.from(doc.querySelectorAll('.kf-card')).find(c => c.textContent.indexOf(taskTitle) !== -1);
  card.click();
  var select = doc.getElementById('taskReleaseSelect');
  var opt = Array.from(select.options).find(o => o.textContent === releaseName);
  select.value = opt.value;
  doc.getElementById('taskSaveBtn').click();
}
function groupHeaders(doc){
  return Array.from(doc.querySelectorAll('.kf-timeline-row.kf-timeline-group-header'));
}
function headerNameText(header){
  return header.querySelector('.kf-tasklist-group-name').textContent;
}
function taskRowsUnder(doc){
  return Array.from(doc.querySelectorAll('.kf-timeline-row[data-task-id]'));
}

(async () => {
  await wait(300);
  const doc = window.document;
  function log(label, ok, extra){ console.log((ok?'PASS':'FAIL') + ' - ' + label + (extra !== undefined ? ' :: ' + extra : '')); }

  setProjectDates(doc, '2026-01-01', '2026-12-31');
  await wait(20);

  // Two dated releases (deliberately created out of chronological order) + one undated release.
  createRelease(doc, 'v2.0 Later Release', '2026-06-01', '2026-07-01');
  await wait(20);
  createRelease(doc, 'v1.0 Earlier Release', '2026-02-01', '2026-03-01');
  await wait(20);
  createRelease(doc, 'v3.0 Unscheduled', '', '');
  await wait(20);

  assignTaskToRelease(doc, 'Look at Project and App Settings', 'v1.0 Earlier Release');
  await wait(20);
  assignTaskToRelease(doc, 'Draft project objectives', 'v1.0 Earlier Release');
  await wait(20);
  assignTaskToRelease(doc, 'Set up Team members for this project', 'v2.0 Later Release');
  await wait(20);
  assignTaskToRelease(doc, 'Create project board', 'v3.0 Unscheduled');
  await wait(20);

  doc.getElementById('timelineBtn').click();
  await wait(20);

  // ── Grouping + ordering ─────────────────────────────────────────────────
  const headers = groupHeaders(doc);
  const names = headers.map(headerNameText);
  log('shows one group header per release-in-use plus "No Release"', names.length === 4, names.join(' | '));
  log('dated releases are ordered by start date ascending, undated releases after them, "No Release" last',
      names.join(' | ') === 'v1.0 Earlier Release | v2.0 Later Release | v3.0 Unscheduled | No Release', names.join(' | '));

  const earlierHeader = headers.find(h => headerNameText(h) === 'v1.0 Earlier Release');
  const laterHeader = headers.find(h => headerNameText(h) === 'v2.0 Later Release');
  const unscheduledHeader = headers.find(h => headerNameText(h) === 'v3.0 Unscheduled');
  const noReleaseHeader = headers.find(h => h.querySelector('.kf-tasklist-group-name-none'));

  log('a release group header shows a status pill', earlierHeader.querySelector('.kf-release-status-pill') !== null);
  log('default release status pill reads "Pending"', earlierHeader.querySelector('.kf-release-status-pill').textContent === 'Pending');
  log('"No Release" group has no status pill', noReleaseHeader.querySelector('.kf-release-status-pill') === null);

  // ── Release bar plotted by start/end dates, grey-hatched styling ────────
  const earlierBar = earlierHeader.querySelector('.kf-timeline-bar-release');
  log('a dated release gets its own Gantt bar', earlierBar !== null);
  log('the release bar is positioned (has a left offset)', earlierBar && earlierBar.style.left !== '');
  log('the release bar shows its task count', earlierBar && earlierBar.textContent.trim() === '2 tasks', earlierBar && earlierBar.textContent);
  log('the release bar is NOT colored by priority (uses the hatched-release class only)',
      earlierBar.className.indexOf('kf-timeline-bar-release') !== -1 && earlierBar.style.background === '');

  const laterBar = laterHeader.querySelector('.kf-timeline-bar-release');
  log('the later release\'s bar sits further right than the earlier release\'s bar (real date positions)',
      parseFloat(laterBar.style.left) > parseFloat(earlierBar.style.left),
      `${earlierBar.style.left} vs ${laterBar.style.left}`);

  // ── Undated release: no bar, "No dates set" note instead ─────────────────
  log('an undated release shows "No dates set" instead of a bar', unscheduledHeader.querySelector('.kf-timeline-bar-release') === null);
  log('an undated release\'s note text is present', unscheduledHeader.textContent.indexOf('No dates set') !== -1);

  // ── "No Release" bucket has no bar/note of its own (nothing to schedule) ─
  log('the "No Release" bucket draws no bar', noReleaseHeader.querySelector('.kf-timeline-bar-release') === null);
  log('the "No Release" bucket shows no "No dates set" note either (nothing to schedule)',
      noReleaseHeader.querySelector('.kf-timeline-no-dates-note') === null);

  // ── Expand/collapse: single group ────────────────────────────────────────
  log('groups start expanded (chevron marked expanded)', earlierHeader.querySelector('.kf-tasklist-chevron').classList.contains('expanded'));
  log('starts with all 5 task rows visible', taskRowsUnder(doc).length === 5, taskRowsUnder(doc).length);

  earlierHeader.click();
  await wait(20);
  const collapsedHeaders = groupHeaders(doc);
  const earlierAfterCollapse = collapsedHeaders.find(h => headerNameText(h) === 'v1.0 Earlier Release');
  log('clicking a group header collapses it (chevron un-marked)', !earlierAfterCollapse.querySelector('.kf-tasklist-chevron').classList.contains('expanded'));
  log('aria-expanded reflects the collapsed state', earlierAfterCollapse.getAttribute('aria-expanded') === 'false');
  log('collapsing one release hides its 2 tasks (5 -> 3 visible)', taskRowsUnder(doc).length === 3, taskRowsUnder(doc).length);
  log('the OTHER release\'s tasks stay visible (not a global collapse)',
      taskRowsUnder(doc).some(r => r.textContent.indexOf('Set up Team members') !== -1));

  earlierHeader.click();
  await wait(20);
  log('clicking the same header again re-expands it', taskRowsUnder(doc).length === 5, taskRowsUnder(doc).length);

  // ── Collapse all / Expand all ────────────────────────────────────────────
  doc.getElementById('timelineCollapseAllBtn').click();
  await wait(20);
  log('"Collapse all" hides every group\'s tasks', taskRowsUnder(doc).length === 0, taskRowsUnder(doc).length);
  log('"Collapse all" still shows every group header itself', groupHeaders(doc).length === 4, groupHeaders(doc).length);

  doc.getElementById('timelineExpandAllBtn').click();
  await wait(20);
  log('"Expand all" restores every task row', taskRowsUnder(doc).length === 5, taskRowsUnder(doc).length);

  // ── Reopening resets collapse state (session-only, like Task List) ───────
  const someHeaderToCollapse = groupHeaders(doc).find(h => headerNameText(h) === 'v2.0 Later Release');
  someHeaderToCollapse.click();
  await wait(20);
  log('sanity: v2.0 group is collapsed before closing', taskRowsUnder(doc).length === 4, taskRowsUnder(doc).length);
  doc.getElementById('timelineClose').click();
  await wait(10);
  doc.getElementById('timelineBtn').click();
  await wait(20);
  log('reopening the Timeline resets every group back to expanded', taskRowsUnder(doc).length === 5, taskRowsUnder(doc).length);

  console.log('Timeline release grouping test complete.');
})().catch(e => { console.error('CRASHED', e); process.exit(1); });
