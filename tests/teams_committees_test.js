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

  const group = doc.getElementById('teamsCommitteesBtn').parentElement;
  const order = Array.from(group.children).map(el => el.id);
  log('Teams & Committees button exists', !!doc.getElementById('teamsCommitteesBtn'));
  log('it comes immediately after Decisions', order.indexOf('teamsCommitteesBtn') === order.indexOf('decisionsBtn') + 1, order.join(','));

  doc.getElementById('teamsCommitteesBtn').click();
  await wait(20);
  log('clicking it opens the Teams & Committees modal', !doc.getElementById('teamsCommitteesOverlay').classList.contains('hidden'));
  log('modal is titled "Teams & Committees"', doc.getElementById('teamsCommitteesModalTitle').textContent === 'Teams & Committees');
  log('modal uses the large modal size', doc.querySelector('#teamsCommitteesOverlay .kf-modal').classList.contains('kf-modal-lg'));
  log('empty state shown initially', doc.getElementById('teamsCommitteesList').textContent.indexOf('No teams or committees yet') !== -1);

  doc.getElementById('manageTeamBtn').click();
  await wait(10);
  function addMember(name){
    doc.getElementById('newMemberNameInput').value = name;
    doc.getElementById('addMemberBtn').click();
  }
  addMember('Zoe Adams'); await wait(10);
  addMember('Amir Khan'); await wait(10);
  addMember('Priya Shah'); await wait(10);
  doc.getElementById('teamDoneBtn').click();
  await wait(10);

  let raw = JSON.parse(window.localStorage.getItem('kanbanflow_v1_db'));
  let proj = raw.projects[raw.currentProjectId];
  const zoe = proj.members.find(m => m.name === 'Zoe Adams');
  const amir = proj.members.find(m => m.name === 'Amir Khan');
  const priya = proj.members.find(m => m.name === 'Priya Shah');

  doc.getElementById('teamsCommitteesBtn').click();
  await wait(20);
  doc.getElementById('addTeamCommitteeBtn').click();
  await wait(10);
  doc.getElementById('tcNameInput').value = 'Engineering';
  doc.getElementById('tcTypeSelect').value = 'team';
  let engMemberRows = Array.from(doc.querySelectorAll('#tcMemberPicker .kf-risk-doc-picker-row'));
  engMemberRows.find(r => r.textContent.indexOf('Zoe Adams') !== -1).querySelector('input').checked = true;
  engMemberRows.find(r => r.textContent.indexOf('Amir Khan') !== -1).querySelector('input').checked = true;
  doc.getElementById('tcFormSaveBtn').click();
  await wait(20);

  raw = JSON.parse(window.localStorage.getItem('kanbanflow_v1_db'));
  proj = raw.projects[raw.currentProjectId];
  const engineering = proj.teamsCommittees.find(t => t.name === 'Engineering');
  log('Engineering team created with key format <PROJECT>-TEAM-NNN', /-TEAM-\d{3}$/.test(engineering.key), engineering.key);
  log('Engineering has 2 members', engineering.memberIds.length === 2);

  doc.getElementById('addTeamCommitteeBtn').click();
  await wait(10);
  doc.getElementById('tcNameInput').value = 'Backend';
  doc.getElementById('tcTypeSelect').value = 'team';
  doc.getElementById('tcParentSelect').value = engineering.id;
  let backendMemberRows = Array.from(doc.querySelectorAll('#tcMemberPicker .kf-risk-doc-picker-row'));
  backendMemberRows.find(r => r.textContent.indexOf('Amir Khan') !== -1).querySelector('input').checked = true;
  doc.getElementById('tcFormSaveBtn').click();
  await wait(20);

  doc.getElementById('addTeamCommitteeBtn').click();
  await wait(10);
  doc.getElementById('tcNameInput').value = 'Steering Committee';
  doc.getElementById('tcTypeSelect').value = 'committee';
  let scMemberRows = Array.from(doc.querySelectorAll('#tcMemberPicker .kf-risk-doc-picker-row'));
  scMemberRows.find(r => r.textContent.indexOf('Priya Shah') !== -1).querySelector('input').checked = true;
  doc.getElementById('tcFormSaveBtn').click();
  await wait(20);

  raw = JSON.parse(window.localStorage.getItem('kanbanflow_v1_db'));
  proj = raw.projects[raw.currentProjectId];
  const backend = proj.teamsCommittees.find(t => t.name === 'Backend');
  const steering = proj.teamsCommittees.find(t => t.name === 'Steering Committee');
  log('Backend created as a child of Engineering', backend.parentId === engineering.id);
  log('Steering Committee created as a root-level Committee', steering.parentId === null && steering.type === 'committee');
  log('Committee gets a -COMM- key, distinct from Team\u2019s -TEAM- key', /-COMM-\d{3}$/.test(steering.key), steering.key);

  let rows = Array.from(doc.querySelectorAll('.kf-tc-node-row'));
  let names = rows.map(r => r.querySelector('.kf-tc-name').textContent);
  log('roots appear alphabetically (Engineering before Steering Committee)', names.indexOf('Engineering') < names.indexOf('Steering Committee'));
  log('Backend (child) appears immediately after its parent Engineering, before the next root', names[names.indexOf('Engineering') + 1] === 'Backend', names.join(','));

  let backendRow = rows.find(r => r.querySelector('.kf-tc-name').textContent === 'Backend');
  let engineeringRow = rows.find(r => r.querySelector('.kf-tc-name').textContent === 'Engineering');
  log('Backend is visually indented further right than Engineering (deeper in the hierarchy)',
      parseFloat(backendRow.style.paddingLeft) > parseFloat(engineeringRow.style.paddingLeft));

  const engMemberItems = engineeringRow.nextElementSibling;
  log('Engineering\u2019s members are listed alphabetically (Amir before Zoe)',
      engMemberItems.textContent.indexOf('Amir Khan') < engMemberItems.textContent.indexOf('Zoe Adams'), engMemberItems.textContent);

  log('Backend is visible by default (modal opens fully expanded)', !!backendRow);
  const engToggle = engineeringRow.querySelector('[data-tc-toggle-id]');
  engToggle.click();
  await wait(10);
  log('clicking Engineering\u2019s toggle collapses it, hiding Backend', !Array.from(doc.querySelectorAll('.kf-tc-name')).some(el => el.textContent === 'Backend'));

  doc.getElementById('tcExpandAllLink').click();
  await wait(10);
  log('"Expand all" brings Backend back into view', Array.from(doc.querySelectorAll('.kf-tc-name')).some(el => el.textContent === 'Backend'));

  doc.getElementById('tcCollapseAllLink').click();
  await wait(10);
  log('"Collapse all" hides every child node (Backend no longer visible)', !Array.from(doc.querySelectorAll('.kf-tc-name')).some(el => el.textContent === 'Backend'));
  log('"Collapse all" still shows root-level nodes themselves', Array.from(doc.querySelectorAll('.kf-tc-name')).some(el => el.textContent === 'Engineering'));

  doc.getElementById('tcExpandAllLink').click();
  await wait(10);

  const searchInput = doc.getElementById('teamsCommitteesSearchInput');
  searchInput.value = 'Backend';
  searchInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  await wait(10);
  let visibleNames = Array.from(doc.querySelectorAll('.kf-tc-name')).map(el => el.textContent);
  log('searching "Backend" shows Backend itself', visibleNames.includes('Backend'));
  log('searching "Backend" also shows its ancestor Engineering for context', visibleNames.includes('Engineering'));
  log('searching "Backend" hides the unrelated Steering Committee', !visibleNames.includes('Steering Committee'), visibleNames.join(','));

  searchInput.value = 'nonexistentxyz';
  searchInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  await wait(10);
  log('a query matching nothing shows an explicit no-match message', doc.getElementById('teamsCommitteesList').textContent.indexOf('No teams or committees match') !== -1);

  searchInput.value = '';
  searchInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  await wait(10);

  rows = Array.from(doc.querySelectorAll('.kf-tc-node-row'));
  backendRow = rows.find(r => r.querySelector('.kf-tc-name').textContent === 'Backend');
  backendRow.click();
  await wait(10);
  const backendParentOptions = Array.from(doc.getElementById('tcParentSelect').options).map(o => o.textContent.trim());
  log('Backend\u2019s own parent dropdown does not offer itself as a parent', !backendParentOptions.includes('Backend'));
  doc.getElementById('tcFormCancelBtn').click();
  await wait(10);

  rows = Array.from(doc.querySelectorAll('.kf-tc-node-row'));
  engineeringRow = rows.find(r => r.querySelector('.kf-tc-name').textContent === 'Engineering');
  engineeringRow.click();
  await wait(10);
  const engParentOptions = Array.from(doc.getElementById('tcParentSelect').options).map(o => o.textContent.trim());
  log('Engineering\u2019s parent dropdown excludes its own descendant Backend (would create a cycle)', !engParentOptions.includes('Backend'), engParentOptions.join(','));
  doc.getElementById('tcFormCancelBtn').click();
  await wait(10);

  rows = Array.from(doc.querySelectorAll('.kf-tc-node-row'));
  const engRowAgain = rows.find(r => r.querySelector('.kf-tc-name').textContent === 'Engineering');
  engRowAgain.click();
  await wait(10);
  doc.getElementById('deleteTeamCommitteeBtn').click();
  await wait(10);
  doc.getElementById('confirmOkBtn').click();
  await wait(20);

  raw = JSON.parse(window.localStorage.getItem('kanbanflow_v1_db'));
  proj = raw.projects[raw.currentProjectId];
  const engGone = !proj.teamsCommittees.find(t => t.name === 'Engineering');
  const backendNow = proj.teamsCommittees.find(t => t.name === 'Backend');
  log('Engineering is actually deleted', engGone);
  log('Backend (its former child) still exists, NOT cascade-deleted', !!backendNow);
  log('Backend is promoted to root level (parentId is now null)', backendNow.parentId === null);

  doc.getElementById('teamsCommitteesModalClose').click();
  await wait(10);
  doc.getElementById('manageTeamBtn').click();
  await wait(10);
  const amirRow = Array.from(doc.querySelectorAll('.kf-member-row')).find(r => r.querySelector('.kf-member-name-input').value === 'Amir Khan');
  amirRow.querySelector('[data-action="remove-member"]').click();
  await wait(10);
  doc.getElementById('confirmOkBtn').click();
  await wait(20);

  raw = JSON.parse(window.localStorage.getItem('kanbanflow_v1_db'));
  proj = raw.projects[raw.currentProjectId];
  const backendAfterRemoval = proj.teamsCommittees.find(t => t.name === 'Backend');
  log('deleting a Team Member removes them from every team\u2019s memberIds', backendAfterRemoval.memberIds.indexOf(amir.id) === -1);

  doc.getElementById('teamDoneBtn').click();
  await wait(10);
  doc.getElementById('manageTeamBtn').click();
  await wait(10);
  const zoeRow = Array.from(doc.querySelectorAll('.kf-member-row')).find(r => r.querySelector('.kf-member-name-input').value === 'Zoe Adams');
  const priyaRow = Array.from(doc.querySelectorAll('.kf-member-row')).find(r => r.querySelector('.kf-member-name-input').value === 'Priya Shah');
  const priyaTeamsLine = priyaRow.nextElementSibling && priyaRow.nextElementSibling.nextElementSibling;
  log('Priya\u2019s row is followed by a read-only "Member of" line naming Steering Committee',
      priyaTeamsLine && priyaTeamsLine.classList.contains('kf-member-teams-line') && priyaTeamsLine.textContent.indexOf('Steering Committee') !== -1,
      priyaTeamsLine && priyaTeamsLine.textContent);
  const zoeRowCheck = Array.from(doc.querySelectorAll('.kf-member-row')).find(r => r.querySelector('.kf-member-name-input').value === 'Zoe Adams');
  const zoeFollower = zoeRowCheck.nextElementSibling && zoeRowCheck.nextElementSibling.nextElementSibling;
  log('Zoe (whose only team, Engineering, was deleted earlier) correctly shows NO "Member of" line now',
      !zoeFollower || !zoeFollower.classList.contains('kf-member-teams-line'));
  log('there is no editable team-picker control on the member row itself (Team/Committee side is the sole source of truth)',
      zoeRow.querySelectorAll('select, input[type=checkbox]').length === 0);
  doc.getElementById('teamDoneBtn').click();
  await wait(10);

  doc.getElementById('appSettingsBtn').click();
  await wait(20);
  log('App Settings has a Teams & Committees checkbox', !!doc.getElementById('settingsShowTeamsCommitteesBtn'));
  doc.getElementById('settingsShowTeamsCommitteesBtn').checked = false;
  doc.getElementById('settingsShowTeamsCommitteesBtn').dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(10);
  log('unchecking it hides the header button', doc.getElementById('teamsCommitteesBtn').classList.contains('hidden'));
  doc.getElementById('settingsShowTeamsCommitteesBtn').checked = true;
  doc.getElementById('settingsShowTeamsCommitteesBtn').dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(10);
  doc.getElementById('appSettingsClose').click();
  await wait(10);

  doc.getElementById('decisionsBtn').click();
  await wait(20);
  doc.getElementById('addDecisionBtn').click();
  await wait(10);
  const approverOptions = Array.from(doc.getElementById('decisionApproverOptions').options).map(o => o.value);
  log('Approver combobox includes the Steering Committee (type=Committee)', approverOptions.includes('Steering Committee'), approverOptions.join(','));
  log('Approver combobox does NOT include Backend (type=Team)', !approverOptions.includes('Backend'), approverOptions.join(','));
  doc.getElementById('decisionsModalClose').click();
  await wait(10);

  doc.getElementById('exportBtn').click();
  await wait(20);
  const exported = JSON.parse(lastBlobText);
  log('export includes a teamsCommittees array', Array.isArray(exported.teamsCommittees) && exported.teamsCommittees.length > 0);
  const exportedSteering = exported.teamsCommittees.find(t => t.name === 'Steering Committee');
  log('exported Steering Committee carries its memberIds (Priya)', exportedSteering.memberIds.length === 1);

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
  const importedSteering = importedProj.teamsCommittees.find(t => t.name === 'Steering Committee');
  log('imported project carries over Teams & Committees', importedProj.teamsCommittees.length === exported.teamsCommittees.length);
  const importedPriya = importedProj.members.find(m => m.name === 'Priya Shah');
  log('imported Steering Committee\u2019s memberIds correctly re-mapped to the imported Priya\u2019s NEW id',
      importedSteering.memberIds.length === 1 && importedSteering.memberIds[0] === importedPriya.id);

  const legacyDB = {
    projects: {
      legacy_p1: {
        id: 'legacy_p1', name: 'Legacy Project', key: 'LEG', taskCounter: 1,
        columns: [{ id: 'col1', name: 'To Do', done: false, order: [] }],
        tasks: {},
        members: [{ id: 'm1', name: 'Old Member', color: '#000000', role: null }],
        releases: [], taskTypes: [],
        documents: [], docCounter: 1, risks: [], riskCounter: 1, decisions: [], decCounter: 1,
        principles: [], prinCounter: 1, objectives: [], objCounter: 1,
        approvers: [], roles: [],
        headerButtonVisibility: { documents: true, risks: true, decisions: true, health: true, principles: true, objectives: true },
        startDate: null, endDate: null,
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
  const legacyProj = raw2.projects.legacy_p1;
  log('migration backfills an empty teamsCommittees array', Array.isArray(legacyProj.teamsCommittees) && legacyProj.teamsCommittees.length === 0);
  log('migration backfills tcCounter starting at 1', legacyProj.tcCounter === 1);

  const doc2 = dom2.window.document;
  doc2.getElementById('teamsCommitteesBtn').click();
  await wait(20);
  log('Teams & Committees modal opens cleanly on a freshly-migrated legacy project', !doc2.getElementById('teamsCommitteesOverlay').classList.contains('hidden'));

  console.log('\nTeams & Committees test complete.');
  process.exit(0);
})().catch(e => { console.error('CRASHED', e); process.exit(1); });
