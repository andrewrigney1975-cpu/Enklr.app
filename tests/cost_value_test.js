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

  // ── 1. Seeded demo tasks have varied, in-range businessValue/taskCost ────
  let raw = JSON.parse(window.localStorage.getItem('kanbanflow_v1_db'));
  let proj = raw.projects[raw.currentProjectId];
  const seededTasks = Object.values(proj.tasks);
  log('all seeded tasks have a businessValue in [1,1000]', seededTasks.every(t => t.businessValue >= 1 && t.businessValue <= 1000), seededTasks.map(t=>t.businessValue).join(','));
  log('all seeded tasks have a taskCost in [1,1000]', seededTasks.every(t => t.taskCost >= 1 && t.taskCost <= 1000), seededTasks.map(t=>t.taskCost).join(','));
  log('seeded values are not all identical (illustrative variety for a cost/benefit report)',
      new Set(seededTasks.map(t => t.businessValue)).size > 1);

  // ── 2. New task modal defaults both fields to 1 ──────────────────────────
  const addBtn = doc.querySelector('.kf-add-task-btn');
  addBtn.click();
  await wait(10);
  log('new task modal defaults Business Value to 1', doc.getElementById('taskBusinessValueInput').value === '1');
  log('new task modal defaults Task Cost to 1', doc.getElementById('taskCostInput').value === '1');

  // ── 3. Saving a new task with custom values persists them ───────────────
  doc.getElementById('taskTitleInput').value = 'Cost benefit test task';
  doc.getElementById('taskBusinessValueInput').value = '650';
  doc.getElementById('taskCostInput').value = '120';
  doc.getElementById('taskSaveBtn').click();
  await wait(20);
  raw = JSON.parse(window.localStorage.getItem('kanbanflow_v1_db'));
  proj = raw.projects[raw.currentProjectId];
  let newTask = Object.values(proj.tasks).find(t => t.title === 'Cost benefit test task');
  log('saved businessValue matches input', newTask.businessValue === 650, newTask.businessValue);
  log('saved taskCost matches input', newTask.taskCost === 120, newTask.taskCost);

  // ── 4. Re-opening shows the same values ──────────────────────────────────
  const card = Array.from(doc.querySelectorAll('.kf-card')).find(c => c.textContent.indexOf('Cost benefit test task') !== -1);
  card.click();
  await wait(10);
  log('re-opened task shows the saved Business Value', doc.getElementById('taskBusinessValueInput').value === '650');
  log('re-opened task shows the saved Task Cost', doc.getElementById('taskCostInput').value === '120');

  // ── 5. Out-of-range / invalid values are clamped, not rejected ───────────
  doc.getElementById('taskBusinessValueInput').value = '5000'; // above max
  doc.getElementById('taskCostInput').value = '0'; // below min
  doc.getElementById('taskSaveBtn').click();
  await wait(20);
  raw = JSON.parse(window.localStorage.getItem('kanbanflow_v1_db'));
  proj = raw.projects[raw.currentProjectId];
  let clampedTask = Object.values(proj.tasks).find(t => t.title === 'Cost benefit test task');
  log('value above 1000 is clamped to 1000', clampedTask.businessValue === 1000, clampedTask.businessValue);
  log('value below 1 is clamped to 1', clampedTask.taskCost === 1, clampedTask.taskCost);

  doc.getElementById('taskCancelBtn') ? null : null;
  // re-open and test non-numeric / blank input falls back to 1
  const card2 = Array.from(doc.querySelectorAll('.kf-card')).find(c => c.textContent.indexOf('Cost benefit test task') !== -1);
  card2.click();
  await wait(10);
  doc.getElementById('taskBusinessValueInput').value = '';
  doc.getElementById('taskCostInput').value = 'abc';
  doc.getElementById('taskSaveBtn').click();
  await wait(20);
  raw = JSON.parse(window.localStorage.getItem('kanbanflow_v1_db'));
  proj = raw.projects[raw.currentProjectId];
  let fallbackTask = Object.values(proj.tasks).find(t => t.title === 'Cost benefit test task');
  log('blank Business Value falls back to 1', fallbackTask.businessValue === 1, fallbackTask.businessValue);
  log('non-numeric Task Cost falls back to 1', fallbackTask.taskCost === 1, fallbackTask.taskCost);

  // restore known values for export testing
  const card3 = Array.from(doc.querySelectorAll('.kf-card')).find(c => c.textContent.indexOf('Cost benefit test task') !== -1);
  card3.click();
  await wait(10);
  doc.getElementById('taskBusinessValueInput').value = '777';
  doc.getElementById('taskCostInput').value = '333';
  doc.getElementById('taskSaveBtn').click();
  await wait(20);

  // ── 6. Export includes businessValue/taskCost per task ──────────────────
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
  const exportedNode = findNode(exported.hierarchy, 'Cost benefit test task');
  log('exported node has businessValue', exportedNode.businessValue === 777, exportedNode.businessValue);
  log('exported node has taskCost', exportedNode.taskCost === 333, exportedNode.taskCost);

  // ── 7. Import restores businessValue/taskCost exactly ────────────────────
  const fileInput = doc.getElementById('importFileInput');
  Object.defineProperty(fileInput, 'files', { value: [new FakeFile(lastBlobText)], configurable: true });
  fileInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(30);
  if(!doc.getElementById('importConflictOverlay').classList.contains('hidden')){
    doc.getElementById('importConflictCopyBtn').click();
    await wait(20);
  }
  const importedCard = Array.from(doc.querySelectorAll('.kf-card')).find(c => c.textContent.indexOf('Cost benefit test task') !== -1);
  importedCard.click();
  await wait(10);
  log('imported task shows the exact same Business Value', doc.getElementById('taskBusinessValueInput').value === '777', doc.getElementById('taskBusinessValueInput').value);
  log('imported task shows the exact same Task Cost', doc.getElementById('taskCostInput').value === '333', doc.getElementById('taskCostInput').value);
  doc.getElementById('taskCancelBtn').click();
  await wait(10);

  // ── 8. A file with missing/garbage values imports cleanly, defaulting to 1 ──
  const badValuesDoc = JSON.parse(JSON.stringify(exported));
  badValuesDoc.project.key = 'BADV';
  badValuesDoc.project.name = 'Bad Values Project';
  function corruptScores(nodes){ (nodes||[]).forEach(n => { delete n.businessValue; n.taskCost = 'not-a-number'; corruptScores(n.subtasks); }); }
  corruptScores(badValuesDoc.hierarchy);
  Object.defineProperty(fileInput, 'files', { value: [new FakeFile(JSON.stringify(badValuesDoc))], configurable: true });
  fileInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(30);
  const anyCard = doc.querySelector('.kf-card');
  anyCard.click();
  await wait(10);
  log('task with missing businessValue imports defaulting to 1', doc.getElementById('taskBusinessValueInput').value === '1', doc.getElementById('taskBusinessValueInput').value);
  log('task with garbage taskCost imports defaulting to 1', doc.getElementById('taskCostInput').value === '1', doc.getElementById('taskCostInput').value);
  doc.getElementById('taskCancelBtn').click();
  await wait(10);

  // ── 9. Migration backfills businessValue/taskCost as 1 for legacy tasks ──
  const legacyDB = {
    projects: {
      legacy_p1: {
        id: 'legacy_p1', name: 'Legacy Project', key: 'LEG', taskCounter: 2,
        columns: [{ id: 'col1', name: 'To Do', done: false, order: ['t1'] }],
        tasks: {
          t1: {
            id: 't1', key: 'LEG-1', title: 'Old task, no score fields',
            description: '', priority: 'medium', columnId: 'col1', dependencies: [],
            assigneeId: null, startDate: null, endDate: null,
            dateCreated: '2025-01-01T00:00:00.000Z', dateLastModified: '2025-01-01T00:00:00.000Z'
            // deliberately no businessValue/taskCost keys
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
  log('migration backfills businessValue as 1 for legacy tasks', legacyTask.businessValue === 1, legacyTask.businessValue);
  log('migration backfills taskCost as 1 for legacy tasks', legacyTask.taskCost === 1, legacyTask.taskCost);
  const legacyDoc = dom2.window.document;
  const legacyCard = legacyDoc.querySelector('.kf-card');
  legacyCard.click();
  await wait(10);
  log('legacy task (migrated) opens cleanly showing 1/1 in the modal',
      legacyDoc.getElementById('taskBusinessValueInput').value === '1' && legacyDoc.getElementById('taskCostInput').value === '1');

  console.log('\nBusiness Value / Task Cost test complete.');
  process.exit(0);
})().catch(e => { console.error('CRASHED', e); process.exit(1); });
