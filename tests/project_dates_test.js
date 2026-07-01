const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync('../dist/index.html', 'utf8');

class FakeFile { constructor(text){ this._text = text; } }
function installFakeFileReader(window){
  window.FileReader = class {
    readAsText(f){ const s = this; setTimeout(() => { s.result = f._text; if (s.onload) s.onload(); }, 0); }
  };
}
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

  // ── 1. Seeded demo project's dates default to 1 week before/after today ──
  let raw = JSON.parse(window.localStorage.getItem('kanbanflow_v1_db'));
  let proj = raw.projects[raw.currentProjectId];
  function daysFromTodayLocal(n){
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }
  const expectedStart = daysFromTodayLocal(-7);
  const expectedEnd = daysFromTodayLocal(7);
  const projStartLocal = new Date(proj.startDate);
  const projEndLocal = new Date(proj.endDate);
  const projStartLocalStr = projStartLocal.getFullYear() + '-' + String(projStartLocal.getMonth()+1).padStart(2,'0') + '-' + String(projStartLocal.getDate()).padStart(2,'0');
  const projEndLocalStr = projEndLocal.getFullYear() + '-' + String(projEndLocal.getMonth()+1).padStart(2,'0') + '-' + String(projEndLocal.getDate()).padStart(2,'0');
  log('seeded project startDate is 1 week before today', projStartLocalStr === expectedStart, projStartLocalStr + ' vs expected ' + expectedStart);
  log('seeded project endDate is 1 week from today', projEndLocalStr === expectedEnd, projEndLocalStr + ' vs expected ' + expectedEnd);

  // ── 2. New Project modal: fields exist and start blank ───────────────────
  doc.getElementById('newProjectBtn').click();
  await wait(10);
  log('new project modal has a Start date field', doc.getElementById('projectStartDateInput') !== null);
  log('new project modal has an End date field', doc.getElementById('projectEndDateInput') !== null);
  log('new project Start date is blank by default (no auto-default, unlike tasks)', doc.getElementById('projectStartDateInput').value === '');
  log('new project End date is blank by default', doc.getElementById('projectEndDateInput').value === '');

  // ── 3. Creating a project with dates persists them ────────────────────────
  doc.getElementById('projectNameInput').value = 'Dated Project';
  doc.getElementById('projectKeyInput').value = 'DTP';
  doc.getElementById('projectStartDateInput').value = '2026-03-01';
  doc.getElementById('projectEndDateInput').value = '2026-06-30';
  doc.getElementById('projectSaveBtn').click();
  await wait(20);

  raw = JSON.parse(window.localStorage.getItem('kanbanflow_v1_db'));
  proj = raw.projects[raw.currentProjectId];
  log('new project name is correct', proj.name === 'Dated Project', proj.name);
  log('new project startDate stored as ISO string', typeof proj.startDate === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(proj.startDate), proj.startDate);
  log('new project endDate stored as ISO string', typeof proj.endDate === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(proj.endDate), proj.endDate);

  // ── 4. Re-opening Edit shows the same local dates (round-trip) ───────────
  doc.getElementById('editProjectBtn').click();
  await wait(10);
  log('edit modal shows the saved local start date', doc.getElementById('projectStartDateInput').value === '2026-03-01', doc.getElementById('projectStartDateInput').value);
  log('edit modal shows the saved local end date', doc.getElementById('projectEndDateInput').value === '2026-06-30', doc.getElementById('projectEndDateInput').value);

  // ── 5. Validation: end before start is rejected ──────────────────────────
  doc.getElementById('projectStartDateInput').value = '2026-06-01';
  doc.getElementById('projectEndDateInput').value = '2026-01-01';
  doc.getElementById('projectSaveBtn').click();
  await wait(20);
  log('save is blocked when project end date is before start date', !doc.getElementById('projectOverlay').classList.contains('hidden'));
  const toasts = doc.querySelectorAll('.kf-toast');
  log('toast explains the date validation error', toasts[toasts.length-1].textContent.indexOf('before the start date') !== -1, toasts[toasts.length-1].textContent);

  // ── 6. Editing to clear dates stores null, not an error ───────────────────
  doc.getElementById('projectStartDateInput').value = '';
  doc.getElementById('projectEndDateInput').value = '';
  doc.getElementById('projectSaveBtn').click();
  await wait(20);
  raw = JSON.parse(window.localStorage.getItem('kanbanflow_v1_db'));
  proj = raw.projects[raw.currentProjectId];
  log('clearing both date fields stores null for both', proj.startDate === null && proj.endDate === null, JSON.stringify({s:proj.startDate, e:proj.endDate}));

  // restore known dates for export test
  doc.getElementById('editProjectBtn').click();
  await wait(10);
  doc.getElementById('projectStartDateInput').value = '2026-02-15';
  doc.getElementById('projectEndDateInput').value = '2026-08-15';
  doc.getElementById('projectSaveBtn').click();
  await wait(20);

  // exportProjectJSON refuses to run on a project with zero tasks — add one
  const addBtn = doc.querySelector('.kf-add-task-btn');
  addBtn.click();
  await wait(10);
  doc.getElementById('taskTitleInput').value = 'Placeholder task';
  doc.getElementById('taskSaveBtn').click();
  await wait(20);

  // ── 7. Export includes project startDate/endDate ──────────────────────────
  doc.getElementById('exportBtn').click();
  await wait(20);
  const exported = JSON.parse(lastBlobText);
  log('export project block has startDate', typeof exported.project.startDate === 'string', exported.project.startDate);
  log('export project block has endDate', typeof exported.project.endDate === 'string', exported.project.endDate);
  const decodedStart = new Date(exported.project.startDate);
  log('exported startDate decodes back to the correct local calendar date (2026-02-15)',
      decodedStart.getFullYear() === 2026 && decodedStart.getMonth() === 1 && decodedStart.getDate() === 15,
      decodedStart.toString());

  // ── 8. Import restores project startDate/endDate exactly ─────────────────
  const fileInput = doc.getElementById('importFileInput');
  Object.defineProperty(fileInput, 'files', { value: [new FakeFile(lastBlobText)], configurable: true });
  fileInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(30);
  if(!doc.getElementById('importConflictOverlay').classList.contains('hidden')){
    doc.getElementById('importConflictCopyBtn').click();
    await wait(20);
  }
  doc.getElementById('editProjectBtn').click();
  await wait(10);
  log('imported project shows the exact same local start date', doc.getElementById('projectStartDateInput').value === '2026-02-15', doc.getElementById('projectStartDateInput').value);
  log('imported project shows the exact same local end date', doc.getElementById('projectEndDateInput').value === '2026-08-15', doc.getElementById('projectEndDateInput').value);
  doc.getElementById('projectCancelBtn').click();
  await wait(10);

  // ── 9. A file with missing/garbage project dates imports cleanly as null ──
  const badDoc = JSON.parse(JSON.stringify(exported));
  badDoc.project.key = 'BADP';
  badDoc.project.name = 'Bad Dates Project';
  badDoc.project.startDate = 'not-a-date';
  delete badDoc.project.endDate;
  Object.defineProperty(fileInput, 'files', { value: [new FakeFile(JSON.stringify(badDoc))], configurable: true });
  fileInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(30);
  doc.getElementById('editProjectBtn').click();
  await wait(10);
  log('garbage startDate imports as blank, not a crash', doc.getElementById('projectStartDateInput').value === '', doc.getElementById('projectStartDateInput').value);
  log('missing endDate imports as blank', doc.getElementById('projectEndDateInput').value === '', doc.getElementById('projectEndDateInput').value);
  doc.getElementById('projectCancelBtn').click();
  await wait(10);

  // ── 10. Migration backfills startDate/endDate as null for legacy projects ──
  const legacyDB = {
    projects: {
      legacy_p1: {
        id: 'legacy_p1', name: 'Legacy Project', key: 'LEG', taskCounter: 1,
        columns: [{ id: 'col1', name: 'To Do', done: false, order: [] }],
        tasks: {}, members: [],
        dateCreated: '2025-01-01T00:00:00.000Z', dateLastModified: '2025-01-01T00:00:00.000Z', dateLastExported: null
        // deliberately no startDate/endDate keys at all
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
  const legacyProj = raw2.projects.legacy_p1;
  log('migration backfills project startDate as null for legacy projects', legacyProj.startDate === null, legacyProj.startDate);
  log('migration backfills project endDate as null for legacy projects', legacyProj.endDate === null, legacyProj.endDate);
  const legacyDoc = dom2.window.document;
  legacyDoc.getElementById('editProjectBtn').click();
  await wait(10);
  log('legacy project (migrated) opens cleanly with blank date fields',
      legacyDoc.getElementById('projectStartDateInput').value === '' && legacyDoc.getElementById('projectEndDateInput').value === '');

  console.log('\nProject start/end date test complete.');
  process.exit(0);
})().catch(e => { console.error('CRASHED', e); process.exit(1); });
