const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync('../dist/index.html', 'utf8');

class FakeFile { constructor(text){ this._text = text; } }
function installFakeFileReader(window){
  window.FileReader = class {
    readAsText(f){ const s = this; setTimeout(() => { s.result = f._text; if (s.onload) s.onload(); }, 0); }
  };
}

function pad2(n){ return n < 10 ? '0'+n : ''+n; }
function localDateValue(d){ return d.getFullYear() + '-' + pad2(d.getMonth()+1) + '-' + pad2(d.getDate()); }

function wait(ms){ return new Promise(r => setTimeout(r, ms)); }

(async () => {
  let lastBlobText = null;
  const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;
  installFakeFileReader(window);
  window.URL.createObjectURL = () => 'blob://fake';
  window.URL.revokeObjectURL = () => {};
  const OrigBlob = window.Blob;
  window.Blob = function(parts, opts){ lastBlobText = parts[0]; return new OrigBlob(parts, opts); };

  await wait(300);
  const doc = window.document;
  function log(label, ok, extra){ console.log((ok?'PASS':'FAIL') + ' - ' + label + (extra?' :: '+extra:'')); }

  const today = new Date();
  const twoWeeksOut = new Date(); twoWeeksOut.setDate(twoWeeksOut.getDate() + 14);
  const expectedDefaultStart = localDateValue(today);
  const expectedDefaultEnd = localDateValue(twoWeeksOut);

  // ── 1. New task modal defaults to today / +14 days ───────────────────────
  const addTaskBtn = doc.querySelector('.kf-add-task-btn');
  addTaskBtn.click();
  await wait(10);
  const startVal = doc.getElementById('taskStartDateInput').value;
  const endVal = doc.getElementById('taskEndDateInput').value;
  log('new task modal defaults start date to today', startVal === expectedDefaultStart, startVal + ' vs ' + expectedDefaultStart);
  log('new task modal defaults end date to +14 days', endVal === expectedDefaultEnd, endVal + ' vs ' + expectedDefaultEnd);

  // ── 2. Saving a new task with default dates stores them as UTC ISO ───────
  doc.getElementById('taskTitleInput').value = 'Date field test task';
  doc.getElementById('taskSaveBtn').click();
  await wait(20);

  let raw = JSON.parse(window.localStorage.getItem('kanbanflow_v1_db'));
  let proj = raw.projects[raw.currentProjectId];
  let newTask = Object.values(proj.tasks).find(t => t.title === 'Date field test task');
  log('saved task has a startDate stored as an ISO string', typeof newTask.startDate === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(newTask.startDate), newTask.startDate);
  log('saved task has an endDate stored as an ISO string', typeof newTask.endDate === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(newTask.endDate), newTask.endDate);

  // ── 3. Re-opening the task shows the SAME local date back (round-trip) ───
  const card = Array.from(doc.querySelectorAll('.kf-card')).find(c => c.textContent.indexOf('Date field test task') !== -1);
  card.click();
  await wait(10);
  const reopenedStart = doc.getElementById('taskStartDateInput').value;
  const reopenedEnd = doc.getElementById('taskEndDateInput').value;
  log('re-opened task shows the original local start date (round-trip)', reopenedStart === expectedDefaultStart, reopenedStart);
  log('re-opened task shows the original local end date (round-trip)', reopenedEnd === expectedDefaultEnd, reopenedEnd);

  // ── 4. Editing dates and saving persists the new local dates correctly ───
  const customStart = '2026-03-10';
  const customEnd = '2026-03-24';
  doc.getElementById('taskStartDateInput').value = customStart;
  doc.getElementById('taskEndDateInput').value = customEnd;
  doc.getElementById('taskSaveBtn').click();
  await wait(20);

  raw = JSON.parse(window.localStorage.getItem('kanbanflow_v1_db'));
  proj = raw.projects[raw.currentProjectId];
  let editedTask = Object.values(proj.tasks).find(t => t.title === 'Date field test task');
  // Re-open to confirm round-trip of the custom dates
  const card2 = Array.from(doc.querySelectorAll('.kf-card')).find(c => c.textContent.indexOf('Date field test task') !== -1);
  card2.click();
  await wait(10);
  log('custom start date round-trips correctly through UTC storage', doc.getElementById('taskStartDateInput').value === customStart, doc.getElementById('taskStartDateInput').value);
  log('custom end date round-trips correctly through UTC storage', doc.getElementById('taskEndDateInput').value === customEnd, doc.getElementById('taskEndDateInput').value);
  doc.getElementById('taskCancelBtn').click();
  await wait(10);

  // ── 5. Validation: end date before start date is rejected ────────────────
  const card3 = Array.from(doc.querySelectorAll('.kf-card')).find(c => c.textContent.indexOf('Date field test task') !== -1);
  card3.click();
  await wait(10);
  doc.getElementById('taskStartDateInput').value = '2026-06-01';
  doc.getElementById('taskEndDateInput').value = '2026-05-01'; // before start
  doc.getElementById('taskSaveBtn').click();
  await wait(20);
  const stillOpen = !doc.getElementById('taskOverlay').classList.contains('hidden');
  log('save is blocked when end date is before start date', stillOpen);
  const toasts = doc.querySelectorAll('.kf-toast');
  log('toast explains the date validation error', toasts[toasts.length-1].textContent.indexOf('before the start date') !== -1, toasts[toasts.length-1].textContent);
  doc.getElementById('taskCancelBtn').click();
  await wait(10);

  // ── 6. Clearing both dates is allowed (dates are optional, not required) ──
  const card4 = Array.from(doc.querySelectorAll('.kf-card')).find(c => c.textContent.indexOf('Date field test task') !== -1);
  card4.click();
  await wait(10);
  doc.getElementById('taskStartDateInput').value = '';
  doc.getElementById('taskEndDateInput').value = '';
  doc.getElementById('taskSaveBtn').click();
  await wait(20);
  raw = JSON.parse(window.localStorage.getItem('kanbanflow_v1_db'));
  proj = raw.projects[raw.currentProjectId];
  let clearedTask = Object.values(proj.tasks).find(t => t.title === 'Date field test task');
  log('clearing both date fields stores null (not an error)', clearedTask.startDate === null && clearedTask.endDate === null,
      JSON.stringify({start: clearedTask.startDate, end: clearedTask.endDate}));

  // restore a known date range for export tests below
  const card5 = Array.from(doc.querySelectorAll('.kf-card')).find(c => c.textContent.indexOf('Date field test task') !== -1);
  card5.click();
  await wait(10);
  doc.getElementById('taskStartDateInput').value = '2026-01-15';
  doc.getElementById('taskEndDateInput').value = '2026-01-29';
  doc.getElementById('taskSaveBtn').click();
  await wait(20);

  // ── 7. Export includes startDate/endDate per task node ────────────────────
  doc.getElementById('exportBtn').click();
  await wait(20);
  const exported = JSON.parse(lastBlobText);
  function findNode(nodes, title){
    for (const n of nodes) {
      if (n.title === title) return n;
      const found = findNode(n.subtasks || [], title);
      if (found) return found;
    }
    return null;
  }
  const exportedNode = findNode(exported.hierarchy, 'Date field test task');
  log('exported node has startDate', typeof exportedNode.startDate === 'string', exportedNode.startDate);
  log('exported node has endDate', typeof exportedNode.endDate === 'string', exportedNode.endDate);
  // Confirm the UTC value decodes back to the local date we set (2026-01-15)
  const decodedStart = new Date(exportedNode.startDate);
  log('exported startDate decodes back to the correct local calendar date',
      decodedStart.getFullYear() === 2026 && decodedStart.getMonth() === 0 && decodedStart.getDate() === 15,
      decodedStart.toString());

  // A never-dated task (e.g. seeded "Write project README" has defaults though) — test a node with explicit nulls
  // by checking the cleared-then-redated task isn't accidentally null here
  log('previously-cleared task now has non-null dates again after re-setting them', exportedNode.startDate !== null);

  // ── 8. Import restores startDate/endDate exactly (no re-defaulting) ───────
  const fileInput = doc.getElementById('importFileInput');
  Object.defineProperty(fileInput, 'files', { value: [new FakeFile(lastBlobText)], configurable: true });
  fileInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(30);
  if(!doc.getElementById('importConflictOverlay').classList.contains('hidden')){
    doc.getElementById('importConflictCopyBtn').click();
    await wait(20);
  }
  const importedCard = Array.from(doc.querySelectorAll('.kf-card')).find(c => c.textContent.indexOf('Date field test task') !== -1);
  importedCard.click();
  await wait(10);
  log('imported task shows the exact same local start date', doc.getElementById('taskStartDateInput').value === '2026-01-15', doc.getElementById('taskStartDateInput').value);
  log('imported task shows the exact same local end date', doc.getElementById('taskEndDateInput').value === '2026-01-29', doc.getElementById('taskEndDateInput').value);
  doc.getElementById('taskCancelBtn').click();
  await wait(10);

  // ── 9. A task with no dates (null) imports cleanly with empty inputs ──────
  const noDatesDoc = JSON.parse(JSON.stringify(exported));
  noDatesDoc.project.key = 'NODT';
  noDatesDoc.project.name = 'No Dates Project';
  function clearDates(nodes){ (nodes||[]).forEach(n => { n.startDate = null; n.endDate = null; clearDates(n.subtasks); }); }
  clearDates(noDatesDoc.hierarchy);
  Object.defineProperty(fileInput, 'files', { value: [new FakeFile(JSON.stringify(noDatesDoc))], configurable: true });
  fileInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(30);
  const anyCard = doc.querySelector('.kf-card');
  anyCard.click();
  await wait(10);
  log('task imported with null dates shows empty date inputs (not defaulted)',
      doc.getElementById('taskStartDateInput').value === '' && doc.getElementById('taskEndDateInput').value === '',
      JSON.stringify({s: doc.getElementById('taskStartDateInput').value, e: doc.getElementById('taskEndDateInput').value}));
  doc.getElementById('taskCancelBtn').click();
  await wait(10);

  // ── 10. Migration backfills startDate/endDate as null for legacy data ─────
  const legacyDB = {
    projects: {
      legacy_p1: {
        id: 'legacy_p1', name: 'Legacy Project', key: 'LEG', taskCounter: 2,
        columns: [{ id: 'col1', name: 'To Do', done: false, order: ['t1'] }],
        tasks: {
          t1: {
            id: 't1', key: 'LEG-1', title: 'Old task, no date fields',
            description: '', priority: 'medium', columnId: 'col1', dependencies: [],
            assigneeId: null, dateCreated: '2025-01-01T00:00:00.000Z', dateLastModified: '2025-01-01T00:00:00.000Z'
            // deliberately no startDate/endDate keys
          }
        },
        members: [], dateCreated: '2025-01-01T00:00:00.000Z', dateLastModified: '2025-01-01T00:00:00.000Z', dateLastExported: null
      }
    },
    projectOrder: ['legacy_p1'], currentProjectId: 'legacy_p1'
  };
  const dom2 = new JSDOM(html, {
    runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/', pretendToBeVisual: true,
    beforeParse(w){ w.localStorage.setItem('kanbanflow_v1_db', JSON.stringify(legacyDB)); }
  });
  await wait(350);
  const raw2 = JSON.parse(dom2.window.localStorage.getItem('kanbanflow_v1_db'));
  const legacyTask = raw2.projects.legacy_p1.tasks.t1;
  log('migration backfills startDate as null for legacy tasks', legacyTask.startDate === null, legacyTask.startDate);
  log('migration backfills endDate as null for legacy tasks', legacyTask.endDate === null, legacyTask.endDate);
  // The legacy task's date inputs in the modal should now show blank, not crash
  const legacyDoc = dom2.window.document;
  const legacyCard = legacyDoc.querySelector('.kf-card');
  legacyCard.click();
  await wait(10);
  log('legacy task (migrated) opens cleanly with empty date inputs',
      legacyDoc.getElementById('taskStartDateInput').value === '' && legacyDoc.getElementById('taskEndDateInput').value === '');

  console.log('\nTask start/end date test complete.');
  process.exit(0);
})().catch(e => { console.error('CRASHED', e); process.exit(1); });
