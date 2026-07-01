const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync('../dist/index.html', 'utf8');

function wait(ms){ return new Promise(r => setTimeout(r, ms)); }
function daysAgoISO(days){ return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString(); }
function daysFromNowISO(days){ return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString(); }

function makeProject(id, overrides){
  return Object.assign({
    id, name: 'Test Project', key: 'TST', taskCounter: 10,
    columns: [
      { id: 'todo', name: 'To Do', done: false, order: [] },
      { id: 'inprog', name: 'In Progress', done: false, order: [] },
      { id: 'done', name: 'Done', done: true, order: [] }
    ],
    tasks: {},
    members: [],
    dateCreated: daysAgoISO(60), dateLastModified: daysAgoISO(1), dateLastExported: daysAgoISO(1) // recently exported, won't trigger backup reminder
  }, overrides);
}
function makeTask(id, key, title, columnId, endDate){
  return {
    id, key, title, description: '', priority: 'medium', columnId,
    dependencies: [], assigneeId: null,
    startDate: null, endDate: endDate,
    businessValue: 1, taskCost: 1,
    dateCreated: daysAgoISO(30), dateLastModified: daysAgoISO(5)
  };
}

async function loadWithDB(db){
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/', pretendToBeVisual: true,
    beforeParse(window){ window.localStorage.setItem('kanbanflow_v1_db', JSON.stringify(db)); }
  });
  await wait(350);
  return dom;
}

(async () => {
  function log(label, ok, extra){ console.log((ok?'PASS':'FAIL') + ' - ' + label + (extra?' :: '+extra:'')); }

  // ── 1. Card shows Overdue chip for a past end date in a non-done column ──
  {
    const proj = makeProject('p1');
    proj.tasks.t1 = makeTask('t1', 'TST-1', 'Overdue task', 'todo', daysAgoISO(3));
    proj.columns[0].order = ['t1'];
    const db = { projects: { p1: proj }, projectOrder: ['p1'], currentProjectId: 'p1' };
    const dom = await loadWithDB(db);
    const doc = dom.window.document;
    const card = doc.querySelector('.kf-card');
    log('card shows Overdue chip for past end date', card.innerHTML.indexOf('kf-overdue-chip') !== -1, card.innerHTML);
  }

  // ── 2. No chip for a future end date ───────────────────────────────────────
  {
    const proj = makeProject('p1');
    proj.tasks.t1 = makeTask('t1', 'TST-1', 'Future task', 'todo', daysFromNowISO(5));
    proj.columns[0].order = ['t1'];
    const db = { projects: { p1: proj }, projectOrder: ['p1'], currentProjectId: 'p1' };
    const dom = await loadWithDB(db);
    const doc = dom.window.document;
    const card = doc.querySelector('.kf-card');
    log('no Overdue chip for a future end date', card.innerHTML.indexOf('kf-overdue-chip') === -1);
  }

  // ── 3. No chip for null end date ────────────────────────────────────────────
  {
    const proj = makeProject('p1');
    proj.tasks.t1 = makeTask('t1', 'TST-1', 'No date task', 'todo', null);
    proj.columns[0].order = ['t1'];
    const db = { projects: { p1: proj }, projectOrder: ['p1'], currentProjectId: 'p1' };
    const dom = await loadWithDB(db);
    const doc = dom.window.document;
    const card = doc.querySelector('.kf-card');
    log('no Overdue chip when endDate is null', card.innerHTML.indexOf('kf-overdue-chip') === -1);
  }

  // ── 4. No chip for a past end date in a DONE column (already completed) ───
  {
    const proj = makeProject('p1');
    proj.tasks.t1 = makeTask('t1', 'TST-1', 'Completed overdue-looking task', 'done', daysAgoISO(10));
    proj.columns[2].order = ['t1'];
    const db = { projects: { p1: proj }, projectOrder: ['p1'], currentProjectId: 'p1' };
    const dom = await loadWithDB(db);
    const doc = dom.window.document;
    const card = doc.querySelector('.kf-card');
    log('no Overdue chip for a task already in a Done column', card.innerHTML.indexOf('kf-overdue-chip') === -1, card.innerHTML);
  }

  // ── 5. Dependency map node also shows the overdue badge (title attr) ───────
  {
    const proj = makeProject('p1');
    proj.tasks.t1 = makeTask('t1', 'TST-1', 'Overdue task', 'todo', daysAgoISO(2));
    proj.columns[0].order = ['t1'];
    const db = { projects: { p1: proj }, projectOrder: ['p1'], currentProjectId: 'p1' };
    const dom = await loadWithDB(db);
    const doc = dom.window.document;
    doc.getElementById('depMapBtn').click();
    await wait(20);
    const svg = doc.querySelector('#depMapInner svg');
    log('dependency map node includes an overdue badge title', svg.innerHTML.indexOf('Overdue') !== -1, svg.innerHTML.indexOf('Overdue') !== -1 ? 'found' : 'missing');
    const legendText = doc.getElementById('depMapLegend').textContent;
    log('dependency map legend mentions "overdue"', legendText.toLowerCase().indexOf('overdue') !== -1, legendText);
  }

  // ── 6. Session-start alert appears when overdue tasks exist ───────────────
  {
    const proj = makeProject('p1');
    proj.tasks.t1 = makeTask('t1', 'TST-1', 'Overdue A', 'todo', daysAgoISO(5));
    proj.tasks.t2 = makeTask('t2', 'TST-2', 'Overdue B', 'inprog', daysAgoISO(1));
    proj.tasks.t3 = makeTask('t3', 'TST-3', 'Not overdue', 'todo', daysFromNowISO(5));
    proj.columns[0].order = ['t1', 't3'];
    proj.columns[1].order = ['t2'];
    const db = { projects: { p1: proj }, projectOrder: ['p1'], currentProjectId: 'p1' };
    const dom = await loadWithDB(db);
    const doc = dom.window.document;
    log('overdue alert modal shown on load', !doc.getElementById('overdueAlertOverlay').classList.contains('hidden'));
    const msg = doc.getElementById('overdueAlertMessage').textContent;
    log('alert message reports the correct count (2)', msg.indexOf('2 task') !== -1, msg);
    const rows = doc.querySelectorAll('#overdueAlertList .kf-overdue-alert-row');
    log('alert lists both overdue tasks', rows.length === 2, rows.length);
    // Sorted soonest/oldest-overdue first (TST-1, 5 days ago, before TST-2, 1 day ago)
    log('alert list is sorted oldest-end-date first', rows[0].textContent.indexOf('TST-1') !== -1, rows[0].textContent);

    // Dismiss via "Got it" and confirm it closes (and doesn't crash chaining into backup check)
    doc.getElementById('overdueAlertOkBtn').click();
    await wait(20);
    log('alert closes after clicking "Got it"', doc.getElementById('overdueAlertOverlay').classList.contains('hidden'));
  }

  // ── 7. No alert when there are no overdue tasks (falls through cleanly) ───
  {
    const proj = makeProject('p1');
    proj.tasks.t1 = makeTask('t1', 'TST-1', 'Future task', 'todo', daysFromNowISO(5));
    proj.columns[0].order = ['t1'];
    const db = { projects: { p1: proj }, projectOrder: ['p1'], currentProjectId: 'p1' };
    const dom = await loadWithDB(db);
    const doc = dom.window.document;
    log('no overdue alert when nothing is overdue', doc.getElementById('overdueAlertOverlay').classList.contains('hidden'));
  }

  // ── 8. Alert truncates to "+N more" beyond 6 items ─────────────────────────
  {
    const proj = makeProject('p1');
    for (let i = 1; i <= 9; i++) {
      proj.tasks['t' + i] = makeTask('t' + i, 'TST-' + i, 'Overdue ' + i, 'todo', daysAgoISO(i));
    }
    proj.columns[0].order = Object.keys(proj.tasks);
    const db = { projects: { p1: proj }, projectOrder: ['p1'], currentProjectId: 'p1' };
    const dom = await loadWithDB(db);
    const doc = dom.window.document;
    const rows = doc.querySelectorAll('#overdueAlertList .kf-overdue-alert-row');
    log('alert caps the visible list at 6 rows', rows.length === 6, rows.length);
    const more = doc.querySelector('#overdueAlertList .kf-overdue-alert-more');
    log('alert shows a "+3 more" summary for the rest', more && more.textContent.indexOf('3') !== -1, more ? more.textContent : 'missing');
  }

  // ── 9. Escape key and outside-click both dismiss the alert ─────────────────
  {
    const proj = makeProject('p1');
    proj.tasks.t1 = makeTask('t1', 'TST-1', 'Overdue task', 'todo', daysAgoISO(2));
    proj.columns[0].order = ['t1'];
    const db = { projects: { p1: proj }, projectOrder: ['p1'], currentProjectId: 'p1' };
    const dom = await loadWithDB(db);
    const doc = dom.window.document;
    log('alert visible before Escape', !doc.getElementById('overdueAlertOverlay').classList.contains('hidden'));
    doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(10);
    log('Escape dismisses the overdue alert', doc.getElementById('overdueAlertOverlay').classList.contains('hidden'));
  }
  {
    const proj = makeProject('p1');
    proj.tasks.t1 = makeTask('t1', 'TST-1', 'Overdue task', 'todo', daysAgoISO(2));
    proj.columns[0].order = ['t1'];
    const db = { projects: { p1: proj }, projectOrder: ['p1'], currentProjectId: 'p1' };
    const dom = await loadWithDB(db);
    const doc = dom.window.document;
    doc.getElementById('overdueAlertOverlay').dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true }));
    await wait(10);
    log('clicking the backdrop dismisses the overdue alert', doc.getElementById('overdueAlertOverlay').classList.contains('hidden'));
  }

  // ── 10. Overdue alert chains into the backup reminder afterward (no overlap) ──
  {
    const proj = makeProject('p1', { dateLastExported: daysAgoISO(30), dateCreated: daysAgoISO(60) }); // stale -> should trigger backup reminder
    proj.tasks.t1 = makeTask('t1', 'TST-1', 'Overdue task', 'todo', daysAgoISO(2));
    proj.tasks.t1.businessValue = 500; // scored, so it doesn't ALSO trip the separate unscored-tasks alert
    proj.tasks.t1.taskCost = 100;
    proj.columns[0].order = ['t1'];
    const db = { projects: { p1: proj }, projectOrder: ['p1'], currentProjectId: 'p1' };
    const dom = await loadWithDB(db);
    const doc = dom.window.document;
    log('overdue alert shown first', !doc.getElementById('overdueAlertOverlay').classList.contains('hidden'));
    log('backup reminder NOT shown simultaneously', doc.getElementById('backupReminderOverlay').classList.contains('hidden'));
    doc.getElementById('overdueAlertOkBtn').click();
    await wait(20);
    log('after dismissing overdue alert, backup reminder appears', !doc.getElementById('backupReminderOverlay').classList.contains('hidden'));
  }

  // ── 11. Alert is scoped to the OPEN project only, not other projects ──────
  {
    const proj1 = makeProject('p1');
    proj1.name = 'Active Project';
    proj1.tasks.t1 = makeTask('t1', 'TST-1', 'Fine task', 'todo', daysFromNowISO(5));
    proj1.columns[0].order = ['t1'];

    const proj2 = makeProject('p2');
    proj2.name = 'Other Project';
    proj2.key = 'OTH';
    proj2.tasks.t2 = makeTask('t2', 'OTH-1', 'Overdue elsewhere', 'todo', daysAgoISO(5));
    proj2.columns[0].order = ['t2'];

    const db = { projects: { p1: proj1, p2: proj2 }, projectOrder: ['p1', 'p2'], currentProjectId: 'p1' };
    const dom = await loadWithDB(db);
    const doc = dom.window.document;
    log('no alert when the OPEN project has no overdue tasks, even if another project does',
        doc.getElementById('overdueAlertOverlay').classList.contains('hidden'));
  }

  console.log('\nOverdue feature test complete.');
  process.exit(0);
})().catch(e => { console.error('CRASHED', e); process.exit(1); });
