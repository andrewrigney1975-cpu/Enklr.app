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

  // ── 1. Toolbar: Releases is part of the "Tools" group, now in row 1 ──────
  Object.defineProperty(window, 'innerWidth', { value: 1400, configurable: true });
  window.dispatchEvent(new window.Event('resize'));
  await wait(10);
  const row1 = doc.getElementById('toolbarRow1');
  const row2 = doc.getElementById('toolbarRow2');
  log('a second toolbar row exists', !!row2);
  log('Releases button lives in row 1 at desktop width (Tools group)', row1.contains(doc.getElementById('releasesBtn')));
  log('Releases button is NOT in row 2', !row2.contains(doc.getElementById('releasesBtn')));

  // ── 2. Mobile: Releases button relocates into the Tools drawer section, under Archived ──
  Object.defineProperty(window, 'innerWidth', { value: 600, configurable: true });
  window.dispatchEvent(new window.Event('resize'));
  await wait(10);
  const drawerSlot = doc.getElementById('drawerToolsButtonsSlot');
  log('Releases button relocates into the Tools drawer section at mobile width', drawerSlot.contains(doc.getElementById('releasesBtn')));
  const drawerButtons = Array.from(drawerSlot.querySelectorAll('button')).map(b => b.id).filter(Boolean);
  const archivedIdx = drawerButtons.indexOf('archivedTasksBtn');
  const taskTypesIdx = drawerButtons.indexOf('taskTypesBtn');
  const releasesIdx = drawerButtons.indexOf('releasesBtn');
  log('Releases still appears after Archived in the Tools section (Task Types now sits between them)', releasesIdx > archivedIdx, drawerButtons.join(','));
  log('Task Types sits directly after Archived, and Releases directly after Task Types', taskTypesIdx === archivedIdx + 1 && releasesIdx === taskTypesIdx + 1, drawerButtons.join(','));

  Object.defineProperty(window, 'innerWidth', { value: 1400, configurable: true });
  window.dispatchEvent(new window.Event('resize'));
  await wait(10);
  log('Releases button returns to row 1 at desktop width', row1.contains(doc.getElementById('releasesBtn')));

  // ── 3. Opening the modal: empty state ─────────────────────────────────────
  log('modal starts hidden', doc.getElementById('releasesOverlay').classList.contains('hidden'));
  doc.getElementById('releasesBtn').click();
  await wait(20);
  log('modal opens to the list view', !doc.getElementById('releasesOverlay').classList.contains('hidden'));
  log('list view is visible, form view is hidden', !doc.getElementById('releasesListView').classList.contains('hidden') && doc.getElementById('releasesFormView').classList.contains('hidden'));
  log('shows an empty state when there are no releases yet', doc.querySelector('.kf-releases-empty') !== null);

  // ── 4. Creating a release ──────────────────────────────────────────────────
  doc.getElementById('addReleaseBtn').click();
  await wait(10);
  log('clicking New Release switches to the form view', !doc.getElementById('releasesFormView').classList.contains('hidden') && doc.getElementById('releasesListView').classList.contains('hidden'));
  log('modal title updates to "New Release"', doc.getElementById('releasesModalTitle').textContent === 'New Release');
  log('Delete button is hidden when creating a new release', doc.getElementById('deleteReleaseBtn').classList.contains('hidden'));
  log('status defaults to Pending for a new release', doc.getElementById('releaseStatusSelect').value === 'pending');
  log('owner select offers "Unassigned" plus the project members', doc.getElementById('releaseOwnerSelect').options.length >= 3, doc.getElementById('releaseOwnerSelect').options.length);

  doc.getElementById('releaseNameInput').value = 'v1.0 Launch';
  doc.getElementById('releaseStatusSelect').value = 'in_progress';
  const ownerOption = Array.from(doc.getElementById('releaseOwnerSelect').options).find(o => o.value !== '');
  doc.getElementById('releaseOwnerSelect').value = ownerOption.value;
  doc.getElementById('releaseStartDateInput').value = '2026-03-01';
  doc.getElementById('releaseEndDateInput').value = '2026-03-15';
  doc.getElementById('releaseFormSaveBtn').click();
  await wait(20);

  log('saving returns to the list view', !doc.getElementById('releasesListView').classList.contains('hidden'));
  let raw = JSON.parse(window.localStorage.getItem('kanbanflow_v1_db'));
  let proj = raw.projects[raw.currentProjectId];
  log('release persisted with correct fields', proj.releases.length === 1 &&
      proj.releases[0].name === 'v1.0 Launch' &&
      proj.releases[0].status === 'in_progress' &&
      proj.releases[0].ownerId === ownerOption.value &&
      !!proj.releases[0].dateCreated && !!proj.releases[0].dateLastModified,
      JSON.stringify(proj.releases[0]));

  const releaseRow = doc.querySelector('.kf-release-row');
  log('the new release appears as a row in the list', !!releaseRow);
  log('row shows the status pill with correct label/class', releaseRow.querySelector('.kf-release-status-pill.in_progress') !== null &&
      releaseRow.querySelector('.kf-release-status-pill').textContent === 'In Progress');
  log('row shows the owner avatar/name', releaseRow.textContent.indexOf(ownerOption.textContent) !== -1);
  log('row shows the date range', releaseRow.textContent.indexOf('2026') !== -1);
  log('row shows a task count of 0 tasks initially', releaseRow.textContent.indexOf('0 task') !== -1, releaseRow.textContent);

  // ── 5. Editing an existing release ─────────────────────────────────────────
  releaseRow.click();
  await wait(10);
  log('clicking a row opens it for editing', doc.getElementById('releasesModalTitle').textContent === 'Edit Release');
  log('Delete button is visible when editing', !doc.getElementById('deleteReleaseBtn').classList.contains('hidden'));
  log('form is pre-filled with the existing values', doc.getElementById('releaseNameInput').value === 'v1.0 Launch' &&
      doc.getElementById('releaseStatusSelect').value === 'in_progress' &&
      doc.getElementById('releaseStartDateInput').value === '2026-03-01');

  doc.getElementById('releaseStatusSelect').value = 'deployed';
  doc.getElementById('releaseFormSaveBtn').click();
  await wait(20);
  raw = JSON.parse(window.localStorage.getItem('kanbanflow_v1_db'));
  proj = raw.projects[raw.currentProjectId];
  log('edited status persisted', proj.releases[0].status === 'deployed', proj.releases[0].status);
  const releaseId = proj.releases[0].id;

  // ── 6. Validation: end before start ───────────────────────────────────────
  doc.querySelector('.kf-release-row').click();
  await wait(10);
  doc.getElementById('releaseStartDateInput').value = '2026-06-01';
  doc.getElementById('releaseEndDateInput').value = '2026-01-01';
  doc.getElementById('releaseFormSaveBtn').click();
  await wait(20);
  log('save blocked when end date is before start date', !doc.getElementById('releasesFormView').classList.contains('hidden'));
  const toasts1 = doc.querySelectorAll('.kf-toast');
  log('toast explains the date validation error', toasts1[toasts1.length-1].textContent.indexOf('before the start date') !== -1, toasts1[toasts1.length-1].textContent);
  doc.getElementById('releaseFormCancelBtn').click();
  await wait(10);
  log('Cancel returns to the list without saving the bad edit', !doc.getElementById('releasesListView').classList.contains('hidden'));
  raw = JSON.parse(window.localStorage.getItem('kanbanflow_v1_db'));
  proj = raw.projects[raw.currentProjectId];
  const persistedStart = new Date(proj.releases[0].startDate);
  const persistedStartLocal = persistedStart.getFullYear() + '-' + String(persistedStart.getMonth()+1).padStart(2,'0') + '-' + String(persistedStart.getDate()).padStart(2,'0');
  log('Cancel did not persist the invalid date change (still the original 2026-03-01)', persistedStartLocal === '2026-03-01', persistedStartLocal);

  doc.getElementById('releasesDoneBtn').click();
  await wait(10);

  // ── 7. Assigning a task to a release via the Task modal ──────────────────
  const card = doc.querySelector('.kf-card');
  card.click();
  await wait(10);
  log('task modal has a Release select', doc.getElementById('taskReleaseSelect') !== null);
  log('task starts with "No release" selected', doc.getElementById('taskReleaseSelect').value === '');
  const releaseOpt = Array.from(doc.getElementById('taskReleaseSelect').options).find(o => o.value === releaseId);
  log('the created release appears as an option', !!releaseOpt, Array.from(doc.getElementById('taskReleaseSelect').options).map(o=>o.textContent));
  doc.getElementById('taskReleaseSelect').value = releaseId;
  doc.getElementById('taskSaveBtn').click();
  await wait(20);

  raw = JSON.parse(window.localStorage.getItem('kanbanflow_v1_db'));
  proj = raw.projects[raw.currentProjectId];
  const taskId = Object.keys(proj.tasks)[0];
  log('task releaseId persisted', proj.tasks[taskId].releaseId === releaseId);

  doc.getElementById('releasesBtn').click();
  await wait(20);
  log('release row now shows 1 task assigned', doc.querySelector('.kf-release-row').textContent.indexOf('1 task') !== -1, doc.querySelector('.kf-release-row').textContent);
  doc.getElementById('releasesDoneBtn').click();
  await wait(10);

  // ── 8. Unassigning via "No release" ───────────────────────────────────────
  const cardAgain = doc.querySelector('.kf-card');
  cardAgain.click();
  await wait(10);
  log('reopening shows the previously assigned release selected', doc.getElementById('taskReleaseSelect').value === releaseId);
  doc.getElementById('taskReleaseSelect').value = '';
  doc.getElementById('taskSaveBtn').click();
  await wait(20);
  raw = JSON.parse(window.localStorage.getItem('kanbanflow_v1_db'));
  proj = raw.projects[raw.currentProjectId];
  log('task releaseId cleared back to null', proj.tasks[taskId].releaseId === null);

  const cardOnceMore = doc.querySelector('.kf-card');
  cardOnceMore.click();
  await wait(10);
  doc.getElementById('taskReleaseSelect').value = releaseId;
  doc.getElementById('taskSaveBtn').click();
  await wait(20);

  // ── 9. Deleting a release unassigns tasks (with confirm, can be cancelled) ──
  doc.getElementById('releasesBtn').click();
  await wait(20);
  doc.querySelector('.kf-release-row').click();
  await wait(10);
  doc.getElementById('deleteReleaseBtn').click();
  await wait(10);
  log('delete shows a confirm dialog', !doc.getElementById('confirmOverlay').classList.contains('hidden'));
  log('confirm message mentions tasks will be unassigned', doc.getElementById('confirmMessage').textContent.indexOf('unassigned') !== -1);

  doc.getElementById('confirmCancelBtn').click();
  await wait(10);
  raw = JSON.parse(window.localStorage.getItem('kanbanflow_v1_db'));
  proj = raw.projects[raw.currentProjectId];
  log('cancelling the confirm dialog does NOT delete the release', proj.releases.length === 1);

  doc.getElementById('deleteReleaseBtn').click();
  await wait(10);
  doc.getElementById('confirmOkBtn').click();
  await wait(20);
  raw = JSON.parse(window.localStorage.getItem('kanbanflow_v1_db'));
  proj = raw.projects[raw.currentProjectId];
  log('confirming deletes the release', proj.releases.length === 0);
  log('the previously assigned task is unassigned (releaseId null)', proj.tasks[taskId].releaseId === null);
  log('deleting returns to the list view, now empty again', !doc.getElementById('releasesListView').classList.contains('hidden') && doc.querySelector('.kf-releases-empty') !== null);

  doc.getElementById('releasesModalClose').click();
  await wait(10);

  // ── 10. Close behaviors ────────────────────────────────────────────────────
  doc.getElementById('releasesBtn').click();
  await wait(10);
  doc.getElementById('releasesOverlay').dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
  await wait(10);
  log('clicking the backdrop closes the modal', doc.getElementById('releasesOverlay').classList.contains('hidden'));

  doc.getElementById('releasesBtn').click();
  await wait(10);
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await wait(10);
  log('Escape closes the modal', doc.getElementById('releasesOverlay').classList.contains('hidden'));

  // ── 11. Export/import round-trip ───────────────────────────────────────────
  doc.getElementById('releasesBtn').click();
  await wait(10);
  doc.getElementById('addReleaseBtn').click();
  await wait(10);
  doc.getElementById('releaseNameInput').value = 'v2.0 Big Release';
  doc.getElementById('releaseStatusSelect').value = 'pending';
  const ownerOpt2 = Array.from(doc.getElementById('releaseOwnerSelect').options).find(o => o.value !== '');
  doc.getElementById('releaseOwnerSelect').value = ownerOpt2.value;
  doc.getElementById('releaseStartDateInput').value = '2026-09-01';
  doc.getElementById('releaseEndDateInput').value = '2026-09-30';
  doc.getElementById('releaseFormSaveBtn').click();
  await wait(20);

  raw = JSON.parse(window.localStorage.getItem('kanbanflow_v1_db'));
  proj = raw.projects[raw.currentProjectId];
  const newReleaseId = proj.releases[0].id;
  const card2 = doc.querySelector('.kf-card');
  card2.click();
  await wait(10);
  doc.getElementById('taskReleaseSelect').value = newReleaseId;
  doc.getElementById('taskSaveBtn').click();
  await wait(20);

  doc.getElementById('exportBtn').click();
  await wait(20);
  const exported = JSON.parse(lastBlobText);
  log('export includes a releases array', Array.isArray(exported.releases) && exported.releases.length === 1, JSON.stringify(exported.releases));
  log('exported release has name/status/owner/dates', exported.releases[0].name === 'v2.0 Big Release' &&
      exported.releases[0].status === 'pending' && exported.releases[0].ownerName === ownerOpt2.textContent);

  function flattenNodes(nodes, acc){ nodes.forEach(n => { acc.push(n); flattenNodes(n.subtasks || [], acc); }); return acc; }
  const allExportedTasks = flattenNodes(exported.hierarchy, []);
  const exportedTaskWithRelease = allExportedTasks.find(n => n.release === 'v2.0 Big Release');
  log('the task assigned to the release exports a release name+id reference', !!exportedTaskWithRelease && exportedTaskWithRelease.releaseId === newReleaseId,
      JSON.stringify(exportedTaskWithRelease && {release: exportedTaskWithRelease.release, releaseId: exportedTaskWithRelease.releaseId}));

  const fileInput = doc.getElementById('importFileInput');
  Object.defineProperty(fileInput, 'files', { value: [new FakeFile(lastBlobText)], configurable: true });
  fileInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(30);
  if(!doc.getElementById('importConflictOverlay').classList.contains('hidden')){
    doc.getElementById('importConflictCopyBtn').click();
    await wait(20);
  }
  raw = JSON.parse(window.localStorage.getItem('kanbanflow_v1_db'));
  proj = raw.projects[raw.currentProjectId];
  log('imported project has the release reconstructed', proj.releases.length === 1 && proj.releases[0].name === 'v2.0 Big Release', JSON.stringify(proj.releases));
  const importedTask = Object.values(proj.tasks).find(t => t.releaseId === proj.releases[0].id);
  log('imported task correctly re-links to the NEW release id (not the stale old one)', !!importedTask, JSON.stringify(Object.values(proj.tasks).map(t=>t.releaseId)));
  log('imported release owner resolved by name', !!proj.releases[0].ownerId);

  // ── 12. Migration backfill ────────────────────────────────────────────────
  const legacyDB = {
    projects: {
      legacy_p1: {
        id: 'legacy_p1', name: 'Legacy Project', key: 'LEG', taskCounter: 2,
        columns: [{ id: 'col1', name: 'To Do', done: false, order: ['t1'] }],
        tasks: {
          t1: {
            id: 't1', key: 'LEG-1', title: 'Old task, no releaseId field',
            description: '', priority: 'medium', columnId: 'col1', dependencies: [],
            assigneeId: null, startDate: null, endDate: null, businessValue: 1, taskCost: 1, archived: false,
            dateCreated: '2025-01-01T00:00:00.000Z', dateLastModified: '2025-01-01T00:00:00.000Z'
          }
        },
        members: [], startDate: null, endDate: null,
        dateCreated: '2025-01-01T00:00:00.000Z', dateLastModified: '2025-01-01T00:00:00.000Z', dateLastExported: null
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
  log('migration backfills releases:[] for legacy projects', Array.isArray(raw2.projects.legacy_p1.releases) && raw2.projects.legacy_p1.releases.length === 0, JSON.stringify(raw2.projects.legacy_p1.releases));
  log('migration backfills task.releaseId as null for legacy tasks', raw2.projects.legacy_p1.tasks.t1.releaseId === null, raw2.projects.legacy_p1.tasks.t1.releaseId);

  // ── 13. Migration clears orphaned releaseId references ────────────────────
  const orphanDB = {
    projects: {
      orphan_p1: {
        id: 'orphan_p1', name: 'Orphan Project', key: 'ORP', taskCounter: 2,
        columns: [{ id: 'col1', name: 'To Do', done: false, order: ['t1'] }],
        tasks: {
          t1: {
            id: 't1', key: 'ORP-1', title: 'Task pointing at a deleted release',
            description: '', priority: 'medium', columnId: 'col1', dependencies: [],
            assigneeId: null, releaseId: 'release_doesnotexist', startDate: null, endDate: null,
            businessValue: 1, taskCost: 1, archived: false,
            dateCreated: '2025-01-01T00:00:00.000Z', dateLastModified: '2025-01-01T00:00:00.000Z'
          }
        },
        members: [], releases: [], startDate: null, endDate: null,
        dateCreated: '2025-01-01T00:00:00.000Z', dateLastModified: '2025-01-01T00:00:00.000Z', dateLastExported: null
      }
    },
    projectOrder: ['orphan_p1'], currentProjectId: 'orphan_p1'
  };
  const dom3 = new JSDOM(html, {
    runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/', pretendToBeVisual: true,
    beforeParse(w){ w.localStorage.setItem('kanbanflow_v1_db', JSON.stringify(orphanDB)); }
  });
  await wait(350);
  const raw3 = JSON.parse(dom3.window.localStorage.getItem('kanbanflow_v1_db'));
  log('migration clears a task releaseId that points at a non-existent release', raw3.projects.orphan_p1.tasks.t1.releaseId === null, raw3.projects.orphan_p1.tasks.t1.releaseId);

  console.log('\nReleases test complete.');
  process.exit(0);
})().catch(e => { console.error('CRASHED', e); process.exit(1); });
