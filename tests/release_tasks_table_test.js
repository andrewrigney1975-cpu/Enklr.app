const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync('../dist/index.html', 'utf8');
function wait(ms){ return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;
  await wait(300);
  const doc = window.document;
  function log(label, ok, extra){ console.log((ok?'PASS':'FAIL') + ' - ' + label + (extra !== undefined ? ' :: ' + extra : '')); }

  function currentProject(){
    var raw = JSON.parse(window.localStorage.getItem('kanbanflow_v1_db'));
    return raw.projects[raw.currentProjectId];
  }

  // ── Setup: a member + a release ─────────────────────────────────────────
  doc.getElementById('manageTeamBtn').click();
  await wait(20);
  doc.getElementById('newMemberNameInput').value = 'Alex Tester';
  doc.getElementById('addMemberBtn').click();
  await wait(20);
  doc.getElementById('teamDoneBtn').click();
  await wait(20);

  doc.getElementById('releasesBtn').click();
  await wait(20);
  doc.getElementById('addReleaseBtn').click();
  await wait(10);
  doc.getElementById('releaseNameInput').value = 'v3.0 Big Batch';
  doc.getElementById('releaseFormSaveBtn').click();
  await wait(20);
  var releaseId = currentProject().releases[0].id;

  // ── No tasks assigned yet — empty state ─────────────────────────────────
  doc.querySelector('.kf-release-row').click();
  await wait(10);
  log('Tasks section visible when editing an existing release',
      !doc.getElementById('releaseTasksSection').classList.contains('hidden'));
  log('empty state shown before any task is assigned',
      doc.getElementById('releaseTasksBody').textContent.indexOf('No tasks assigned') !== -1);
  doc.getElementById('releaseFormCancelBtn').click();
  await wait(10);

  // ── Assign the release + fields to two seeded tasks ─────────────────────
  var cards = Array.from(doc.querySelectorAll('.kf-card'));
  var memberId = currentProject().members[0].id;

  // Task A: dated later, has a description, assignee, no progress set explicitly
  cards[0].click();
  await wait(10);
  doc.getElementById('taskReleaseSelect').value = releaseId;
  doc.getElementById('taskAssigneeSelect').value = memberId;
  doc.getElementById('taskStartDateInput').value = '2026-09-15';
  doc.getElementById('taskEndDateInput').value = '2026-09-20';
  doc.getElementById('taskDescEditor').innerHTML = '<p>' + 'This is a fairly long description that should get truncated in the summary column because it goes on and on. '.repeat(2) + '</p>';
  doc.getElementById('taskSaveBtn').click();
  await wait(20);
  var taskAId = cards[0].getAttribute('data-task-id');
  var taskAKey = currentProject().tasks[taskAId].key;

  // Task B: earlier start date, no assignee, no description
  cards[1].click();
  await wait(10);
  doc.getElementById('taskReleaseSelect').value = releaseId;
  doc.getElementById('taskStartDateInput').value = '2026-09-01';
  doc.getElementById('taskEndDateInput').value = '';
  doc.getElementById('taskSaveBtn').click();
  await wait(20);
  var taskBId = cards[1].getAttribute('data-task-id');
  var taskBKey = currentProject().tasks[taskBId].key;

  // Task C: no start date at all — should sink to the bottom regardless of key
  cards[2].click();
  await wait(10);
  doc.getElementById('taskReleaseSelect').value = releaseId;
  doc.getElementById('taskStartDateInput').value = '';
  doc.getElementById('taskEndDateInput').value = '';
  doc.getElementById('taskSaveBtn').click();
  await wait(20);
  var taskCId = cards[2].getAttribute('data-task-id');
  var taskCKey = currentProject().tasks[taskCId].key;

  // ── Reopen the release and inspect the table ────────────────────────────
  doc.getElementById('releasesBtn').click();
  await wait(20);
  doc.querySelector('.kf-release-row').click();
  await wait(10);

  // Time Tracking defaults ON for a fresh project (storage.js's own `v.timeTracking !== false`
  // convention, unlike most other opt-in header buttons) — so the Progress column is present from
  // the very start here, not something this test needs to turn on first.
  var headerCells = Array.from(doc.getElementById('releaseTasksHeader').children).map(c => c.textContent);
  log('header lists Column/Key/Title/Summary/Assignee/Start/End/% Complete',
      headerCells.join(',') === 'Column,Key,Title,Summary,Assignee,Start,End,% Complete', headerCells.join(','));

  var rows = Array.from(doc.querySelectorAll('.kf-release-tasks-row'));
  log('table lists all 3 tasks assigned to the release', rows.length === 3, rows.length);

  var keysInOrder = rows.map(r => r.children[1].textContent);
  log('sorted by start date ascending (Sep 1 before Sep 15), undated task last',
      keysInOrder[0] === taskBKey && keysInOrder[1] === taskAKey && keysInOrder[2] === taskCKey,
      keysInOrder.join(','));

  var rowA = rows[1];
  log('row shows the assigned member\'s name', rowA.children[4].textContent === 'Alex Tester', rowA.children[4].textContent);
  log('row shows formatted start/end dates', rowA.children[5].textContent.indexOf('2026') !== -1 && rowA.children[6].textContent.indexOf('2026') !== -1,
      rowA.children[5].textContent + ' / ' + rowA.children[6].textContent);
  log('long description got truncated with an ellipsis in the summary cell',
      rowA.children[3].textContent.length < 100 && rowA.children[3].textContent.indexOf('…') !== -1,
      rowA.children[3].textContent);

  var rowB = rows[0];
  log('unassigned task shows "Unassigned"', rowB.children[4].textContent === 'Unassigned', rowB.children[4].textContent);

  var rowC = rows[2];
  log('undated task shows an em-dash for start and end', rowC.children[5].textContent === '—' && rowC.children[6].textContent === '—');

  // ── Progress column disappears once Time Tracking is turned off ────────
  doc.getElementById('releaseFormCancelBtn').click();
  await wait(10);

  doc.getElementById('appSettingsBtn').click();
  await wait(10);
  doc.getElementById('settingsShowTimeTrackingBtn').checked = false;
  doc.getElementById('settingsShowTimeTrackingBtn').dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(10);
  doc.getElementById('appSettingsClose').click();
  await wait(10);

  doc.getElementById('releasesBtn').click();
  await wait(20);
  doc.querySelector('.kf-release-row').click();
  await wait(10);
  var headerCells2 = Array.from(doc.getElementById('releaseTasksHeader').children).map(c => c.textContent);
  log('Progress column disappears once Time Tracking is disabled',
      headerCells2.join(',') === 'Column,Key,Title,Summary,Assignee,Start,End', headerCells2.join(','));

  console.log('\nRelease tasks table test complete.');
  process.exit(0);
})().catch(e => { console.error('CRASHED', e); process.exit(1); });
