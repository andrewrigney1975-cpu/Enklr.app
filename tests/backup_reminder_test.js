const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync('../dist/index.html', 'utf8');

function wait(ms){ return new Promise(r => setTimeout(r, ms)); }

function makeDB(projects){
  // projects is array of {name, key, dateCreated, dateLastExported (or null)}
  const db = { projects: {}, projectOrder: [], currentProjectId: null };
  projects.forEach((spec, i) => {
    const id = 'proj_test_' + i;
    db.projects[id] = {
      id, name: spec.name, key: spec.key, taskCounter: 1,
      columns: [{ id: 'col1', name: 'To Do', done: false, order: [] }],
      tasks: {}, members: [],
      dateCreated: spec.dateCreated,
      dateLastModified: spec.dateCreated,
      dateLastExported: spec.dateLastExported || null
    };
    db.projectOrder.push(id);
    if(i === 0) db.currentProjectId = id;
  });
  return db;
}

function makeStaleDate(daysAgo){
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
}
function makeFreshDate(daysAgo){ return makeStaleDate(daysAgo); }  // alias for clarity

async function runTest(spec){
  let lastBlobText = null;
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', resources: 'usable',
    url: 'http://localhost/', pretendToBeVisual: true,
    beforeParse(window){
      window.localStorage.setItem('kanbanflow_v1_db', JSON.stringify(spec.db));
    }
  });
  const { window } = dom;
  window.FileReader = class {
    readAsText(f){ const s=this; setTimeout(() => { s.result=f._text; if(s.onload)s.onload(); }, 0); }
  };
  window.URL.createObjectURL = () => 'blob://fake';
  window.URL.revokeObjectURL = () => {};
  const OrigBlob = window.Blob;
  window.Blob = function(parts, opts){ lastBlobText = parts[0]; return new OrigBlob(parts, opts); };

  await wait(350);
  return { doc: window.document, getBlobText: () => lastBlobText };
}

(async () => {
  function log(label, ok, extra){ console.log((ok?'PASS':'FAIL') + ' - ' + label + (extra?' :: '+extra:'')); }

  // ── 1. No reminder when project is freshly backed up ─────────────────────
  {
    const { doc } = await runTest({ db: makeDB([
      { name: 'Fresh', key: 'FRS', dateCreated: makeStaleDate(30), dateLastExported: makeStaleDate(2) }
    ])});
    log('no backup modal when last exported 2 days ago',
        doc.getElementById('backupReminderOverlay').classList.contains('hidden'));
  }

  // ── 2. No reminder when project was created recently (< 7 days, never exported) ─
  {
    const { doc } = await runTest({ db: makeDB([
      { name: 'New Project', key: 'NEW', dateCreated: makeStaleDate(3), dateLastExported: null }
    ])});
    log('no backup modal for a brand-new project (created 3 days ago, never exported)',
        doc.getElementById('backupReminderOverlay').classList.contains('hidden'));
  }

  // ── 3. Reminder when last exported > 7 days ago ───────────────────────────
  {
    const { doc } = await runTest({ db: makeDB([
      { name: 'Old Export', key: 'OLD', dateCreated: makeStaleDate(60), dateLastExported: makeStaleDate(10) }
    ])});
    log('backup modal shown when last exported 10 days ago',
        !doc.getElementById('backupReminderOverlay').classList.contains('hidden'));
    const msg = doc.getElementById('backupReminderMessage').textContent;
    log('message mentions the project name', msg.indexOf('Old Export') !== -1, msg);
    log('message mentions days since backup', /10 day/.test(msg), msg);
    log('message says "last backed up" (not "created")', msg.indexOf('last backed up') !== -1, msg);
  }

  // ── 4. Reminder when never exported and created > 7 days ago ─────────────
  {
    const { doc } = await runTest({ db: makeDB([
      { name: 'Never Exported', key: 'NEV', dateCreated: makeStaleDate(14), dateLastExported: null }
    ])});
    log('backup modal shown for project never exported, created 14 days ago',
        !doc.getElementById('backupReminderOverlay').classList.contains('hidden'));
    const msg = doc.getElementById('backupReminderMessage').textContent;
    log('message says "created" (not "last backed up") for never-exported project',
        msg.indexOf('created') !== -1 && msg.indexOf('last backed up') === -1, msg);
  }

  // ── 5. "Back up now" runs the export and closes the modal ─────────────────
  {
    const { doc, getBlobText } = await runTest({ db: makeDB([
      { name: 'Needs Backup', key: 'NBK', dateCreated: makeStaleDate(20), dateLastExported: makeStaleDate(8) }
    ])});
    log('backup modal visible before clicking "Back up now"',
        !doc.getElementById('backupReminderOverlay').classList.contains('hidden'));
    doc.getElementById('backupNowBtn').click();
    await wait(30);
    log('"Back up now" closes the modal',
        doc.getElementById('backupReminderOverlay').classList.contains('hidden'));
    log('"Back up now" triggered an export (blob produced)', getBlobText() !== null);
    const exported = JSON.parse(getBlobText());
    log('exported file is the correct project', exported.project.name === 'Needs Backup', exported.project.name);
    log('exported file has the expected key', exported.project.key === 'NBK', exported.project.key);
    log('export stamps dateLastExported on the live project',
        exported.project.dateLastExported !== null);
  }

  // ── 6. "Remind me later" closes the modal without exporting ───────────────
  {
    const { doc, getBlobText } = await runTest({ db: makeDB([
      { name: 'Snooze Me', key: 'SNZ', dateCreated: makeStaleDate(30), dateLastExported: makeStaleDate(9) }
    ])});
    log('"Remind me later" — modal visible initially',
        !doc.getElementById('backupReminderOverlay').classList.contains('hidden'));
    doc.getElementById('backupLaterBtn').click();
    await wait(20);
    log('"Remind me later" closes the modal',
        doc.getElementById('backupReminderOverlay').classList.contains('hidden'));
    log('"Remind me later" does NOT trigger an export', getBlobText() === null);
  }

  // ── 7. Close button (×) also dismisses without exporting ──────────────────
  {
    const { doc, getBlobText } = await runTest({ db: makeDB([
      { name: 'Close Test', key: 'CLX', dateCreated: makeStaleDate(30), dateLastExported: makeStaleDate(9) }
    ])});
    doc.getElementById('backupReminderClose').click();
    await wait(20);
    log('× button closes backup modal', doc.getElementById('backupReminderOverlay').classList.contains('hidden'));
    log('× button does not trigger export', getBlobText() === null);
  }

  // ── 8. Escape key dismisses backup modal ─────────────────────────────────
  {
    const { doc, getBlobText } = await runTest({ db: makeDB([
      { name: 'Escape Test', key: 'ESC', dateCreated: makeStaleDate(30), dateLastExported: makeStaleDate(9) }
    ])});
    log('modal visible before Escape', !doc.getElementById('backupReminderOverlay').classList.contains('hidden'));
    doc.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(20);
    log('Escape dismisses backup modal', doc.getElementById('backupReminderOverlay').classList.contains('hidden'));
    log('Escape does not trigger export', getBlobText() === null);
  }

  // ── 9. Multiple stale projects are queued and shown one at a time ──────────
  {
    const { doc, getBlobText } = await runTest({ db: makeDB([
      { name: 'Stale One',   key: 'ST1', dateCreated: makeStaleDate(60), dateLastExported: makeStaleDate(14) },
      { name: 'Fresh One',   key: 'FO1', dateCreated: makeStaleDate(5),  dateLastExported: makeStaleDate(2)  },
      { name: 'Stale Two',   key: 'ST2', dateCreated: makeStaleDate(60), dateLastExported: makeStaleDate(20) },
    ])});

    // First reminder should be for Stale One (first in projectOrder)
    log('first stale project (Stale One) shown first',
        !doc.getElementById('backupReminderOverlay').classList.contains('hidden') &&
        doc.getElementById('backupReminderMessage').textContent.indexOf('Stale One') !== -1,
        doc.getElementById('backupReminderMessage').textContent.slice(0,40));

    // Dismiss first, second should follow (Fresh One skipped, Stale Two next)
    doc.getElementById('backupLaterBtn').click();
    await wait(500);  // queue has a 300ms delay between prompts
    log('after dismissing first, second stale project (Stale Two) shown',
        !doc.getElementById('backupReminderOverlay').classList.contains('hidden') &&
        doc.getElementById('backupReminderMessage').textContent.indexOf('Stale Two') !== -1,
        doc.getElementById('backupReminderMessage').textContent.slice(0,40));

    // Back up the second stale project and confirm no third prompt appears
    doc.getElementById('backupNowBtn').click();
    await wait(500);
    log('after backing up last queued project, no further modal appears',
        doc.getElementById('backupReminderOverlay').classList.contains('hidden'));
    log('export produced for Stale Two', getBlobText() !== null && JSON.parse(getBlobText()).project.name === 'Stale Two',
        getBlobText() ? JSON.parse(getBlobText()).project.name : 'null');
  }

  console.log('\nBackup reminder test complete.');
  process.exit(0);
})().catch(e => { console.error('CRASHED', e); process.exit(1); });
