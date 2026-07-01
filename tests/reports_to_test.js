const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync('../dist/index.html', 'utf8');
function wait(ms){ return new Promise(r => setTimeout(r, ms)); }

class FakeFile { constructor(text){ this._text = text; } }
function installFakeFileReader(window){
  window.FileReader = class {
    readAsText(f){ const s = this; setTimeout(() => { s.result = f._text; if (s.onload) s.onload(); }, 0); }
  };
}

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
  function log(label, ok, extra){ console.log((ok?'PASS':'FAIL') + ' - ' + label + (extra!==undefined?' :: '+extra:'')); }

  doc.getElementById('manageTeamBtn').click();
  await wait(10);
  function addMember(name){
    doc.getElementById('newMemberNameInput').value = name;
    doc.getElementById('addMemberBtn').click();
  }
  addMember('Alice Manager'); await wait(10);
  addMember('Bob Report'); await wait(10);
  addMember('Carol Solo'); await wait(10);

  let raw = JSON.parse(window.localStorage.getItem('kanbanflow_v1_db'));
  let proj = raw.projects[raw.currentProjectId];
  const alice = proj.members.find(m => m.name === 'Alice Manager');
  const bob = proj.members.find(m => m.name === 'Bob Report');
  const carol = proj.members.find(m => m.name === 'Carol Solo');

  // ── 1. Each member row has a "Reports to" select, defaulting to "No one" ──
  const bobSelect = doc.getElementById('reportsTo-' + bob.id);
  log('each member row has a "Reports to" select', !!bobSelect);
  log('it defaults to "No one"', bobSelect.value === '');

  // ── 2. A member cannot select themselves — option simply does not exist ──
  const bobOptionLabels = Array.from(bobSelect.options).map(o => o.textContent);
  log('a member\u2019s own name never appears as an option in their own "Reports to" select', !bobOptionLabels.includes('Bob Report'), bobOptionLabels.join(','));
  log('other members DO appear as options', bobOptionLabels.includes('Alice Manager') && bobOptionLabels.includes('Carol Solo'));

  // ── 3. Setting it persists, and is reflected when re-rendered ────────────
  bobSelect.value = alice.id;
  bobSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(10);

  raw = JSON.parse(window.localStorage.getItem('kanbanflow_v1_db'));
  proj = raw.projects[raw.currentProjectId];
  let bobNow = proj.members.find(m => m.id === bob.id);
  log('Bob\u2019s reportsToId is persisted as Alice\u2019s id', bobNow.reportsToId === alice.id);

  const bobSelectAgain = doc.getElementById('reportsTo-' + bob.id);
  log('re-rendering shows the select pre-set to Alice', bobSelectAgain.value === alice.id);

  // ── 4. Data-layer guard: setMemberReportsTo rejects a self-report directly ──
  // (defends against any future caller that bypasses the UI's option-exclusion)
  const beforeSelfAttempt = JSON.parse(JSON.stringify(proj.members.find(m => m.id === carol.id)));
  // Simulate a direct call the same way the UI's change handler does, but targeting self.
  const carolSelect = doc.getElementById('reportsTo-' + carol.id);
  // The UI can't even construct this (no self option), so we verify the underlying
  // guard via a project mutation + re-migration-style consistency check instead:
  // directly corrupt the field, then confirm migration/validation would reject it.
  proj.members.find(m => m.id === carol.id).reportsToId = carol.id;
  window.localStorage.setItem('kanbanflow_v1_db', JSON.stringify(raw));
  const dom2 = new JSDOM(html, {
    runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/', pretendToBeVisual: true,
    beforeParse(w){ w.localStorage.setItem('kanbanflow_v1_db', window.localStorage.getItem('kanbanflow_v1_db')); }
  });
  await wait(350);
  const raw2 = JSON.parse(dom2.window.localStorage.getItem('kanbanflow_v1_db'));
  const proj2 = raw2.projects[raw2.currentProjectId || Object.keys(raw2.projects)[0]];
  const carolAfterMigration = proj2.members.find(m => m.id === carol.id);
  log('a hand-corrupted self-report (reportsToId === own id) is cleared by migration\u2019s validation pass',
      carolAfterMigration.reportsToId === null, carolAfterMigration.reportsToId);

  // ── 5. Removing a member clears reportsToId for anyone who reported to them ──
  const aliceRow = Array.from(doc.querySelectorAll('.kf-member-row')).find(r => r.querySelector('.kf-member-name-input').value === 'Alice Manager');
  aliceRow.querySelector('[data-action="remove-member"]').click();
  await wait(10);
  doc.getElementById('confirmOkBtn').click();
  await wait(20);

  raw = JSON.parse(window.localStorage.getItem('kanbanflow_v1_db'));
  proj = raw.projects[raw.currentProjectId];
  bobNow = proj.members.find(m => m.id === bob.id);
  log('after Alice (Bob\u2019s manager) is removed, Bob\u2019s reportsToId is cleared back to null', bobNow.reportsToId === null);

  const bobSelectAfterRemoval = doc.getElementById('reportsTo-' + bob.id);
  log('Bob\u2019s select now shows "No one" again', bobSelectAfterRemoval.value === '');
  log('the removed Alice no longer appears as an option for anyone', !Array.from(bobSelectAfterRemoval.options).some(o => o.textContent === 'Alice Manager'));

  doc.getElementById('teamDoneBtn').click();
  await wait(10);

  // ── 6. Export/import round-trip ────────────────────────────────────────────
  doc.getElementById('manageTeamBtn').click();
  await wait(10);
  const carolSelectNow = doc.getElementById('reportsTo-' + carol.id);
  carolSelectNow.value = bob.id;
  carolSelectNow.dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(10);
  doc.getElementById('teamDoneBtn').click();
  await wait(10);

  doc.getElementById('exportBtn').click();
  await wait(20);
  const exported = JSON.parse(lastBlobText);
  const exportedCarol = exported.members.find(m => m.name === 'Carol Solo');
  log('export includes each member\u2019s reportsToId', exportedCarol.reportsToId === bob.id, exportedCarol.reportsToId);

  const fileInput = doc.getElementById('importFileInput');
  Object.defineProperty(fileInput, 'files', { value: [new FakeFile(lastBlobText)], configurable: true });
  fileInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(30);
  if(!doc.getElementById('importConflictOverlay').classList.contains('hidden')){
    doc.getElementById('importConflictCopyBtn').click();
    await wait(20);
  }
  raw = JSON.parse(window.localStorage.getItem('kanbanflow_v1_db'));
  const importedProj = raw.projects[raw.currentProjectId];
  const importedCarol = importedProj.members.find(m => m.name === 'Carol Solo');
  const importedBob = importedProj.members.find(m => m.name === 'Bob Report');
  log('imported Carol\u2019s reportsToId correctly re-mapped to the imported Bob\u2019s NEW id',
      importedCarol.reportsToId === importedBob.id, importedCarol.reportsToId);

  // ── 7. Migration backfill for legacy projects ────────────────────────────
  const legacyDB = {
    projects: {
      legacy_p1: {
        id: 'legacy_p1', name: 'Legacy Project', key: 'LEG', taskCounter: 1,
        columns: [{ id: 'col1', name: 'To Do', done: false, order: [] }],
        tasks: {},
        members: [{ id: 'm1', name: 'Old Member', color: '#000000' }],
        releases: [], taskTypes: [],
        documents: [], docCounter: 1, risks: [], riskCounter: 1, decisions: [], decCounter: 1,
        principles: [], prinCounter: 1, objectives: [], objCounter: 1,
        teamsCommittees: [], tcCounter: 1,
        approvers: [], roles: [],
        headerButtonVisibility: { documents: true, risks: true, decisions: true, health: true, principles: true, objectives: true, teamsCommittees: true },
        startDate: null, endDate: null,
        dateCreated: '2025-01-01T00:00:00.000Z', dateLastModified: '2025-01-01T00:00:00.000Z', dateLastExported: null
      }
    },
    projectOrder: ['legacy_p1'], currentProjectId: 'legacy_p1'
  };
  const dom3 = new JSDOM(html, {
    runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/', pretendToBeVisual: true,
    beforeParse(w){ w.localStorage.setItem('kanbanflow_v1_db', JSON.stringify(legacyDB)); }
  });
  await wait(350);
  const raw3 = JSON.parse(dom3.window.localStorage.getItem('kanbanflow_v1_db'));
  const legacyMember = raw3.projects.legacy_p1.members[0];
  log('migration backfills reportsToId:null for a legacy member missing the field', legacyMember.reportsToId === null);

  const doc3 = dom3.window.document;
  doc3.getElementById('manageTeamBtn').click();
  await wait(20);
  log('Team modal opens cleanly on a freshly-migrated legacy project, with a working Reports To select',
      !!doc3.getElementById('reportsTo-' + legacyMember.id));

  console.log('\nReports To test complete.');
  process.exit(0);
})().catch(e => { console.error('CRASHED', e); process.exit(1); });
