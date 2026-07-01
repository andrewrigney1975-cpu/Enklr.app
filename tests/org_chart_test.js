const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync('../dist/index.html', 'utf8');
function wait(ms){ return new Promise(r => setTimeout(r, ms)); }

(async () => {
  let lastBlobText = null;
  const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;
  window.URL.createObjectURL = () => 'blob://fake';
  window.URL.revokeObjectURL = () => {};
  const OrigBlob = window.Blob;
  window.Blob = function(parts, opts){ lastBlobText = parts[0]; return new OrigBlob(parts, opts); };

  await wait(300);
  const doc = window.document;
  function log(label, ok, extra){ console.log((ok?'PASS':'FAIL') + ' - ' + label + (extra!==undefined?' :: '+extra:'')); }

  /* --- Toolbar/side-nav icon exists in the "views group" --- */
  const viewsGroup = doc.getElementById('orgChartBtn').parentElement;
  log('Org Chart toolbar button lives in the Views group, after Cost/Benefit Chart',
      viewsGroup.id === 'toolbarViewButtons' && Array.from(viewsGroup.children).map(el => el.id).indexOf('orgChartBtn') ===
      Array.from(viewsGroup.children).map(el => el.id).indexOf('costBenefitBtn') + 1);
  log('Org Chart side-nav item exists', !!doc.getElementById('navOrgChartBtn'));

  /* --- Set up members --- */
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

  /* --- Build a mixed committee/team hierarchy:
     Exec Committee (committee, root)
       -> Engineering (team, member: Zoe, Amir)
            -> Backend (team, member: Amir)
     Marketing (team, root, no members)
  --- */
  function checkMember(name){
    Array.from(doc.querySelectorAll('#tcMemberPicker .kf-risk-doc-picker-row'))
      .find(r => r.textContent.indexOf(name) !== -1).querySelector('input').checked = true;
  }
  doc.getElementById('teamsCommitteesBtn').click();
  await wait(20);

  doc.getElementById('addTeamCommitteeBtn').click();
  await wait(10);
  doc.getElementById('tcNameInput').value = 'Exec Committee';
  doc.getElementById('tcTypeSelect').value = 'committee';
  checkMember('Priya Shah');
  doc.getElementById('tcFormSaveBtn').click();
  await wait(20);

  let raw = JSON.parse(window.localStorage.getItem('kanbanflow_v1_db'));
  let proj = raw.projects[raw.currentProjectId];
  const execCommittee = proj.teamsCommittees.find(t => t.name === 'Exec Committee');

  doc.getElementById('addTeamCommitteeBtn').click();
  await wait(10);
  doc.getElementById('tcNameInput').value = 'Engineering';
  doc.getElementById('tcTypeSelect').value = 'team';
  doc.getElementById('tcParentSelect').value = execCommittee.id;
  checkMember('Zoe Adams');
  checkMember('Amir Khan');
  doc.getElementById('tcFormSaveBtn').click();
  await wait(20);

  raw = JSON.parse(window.localStorage.getItem('kanbanflow_v1_db'));
  proj = raw.projects[raw.currentProjectId];
  const engineering = proj.teamsCommittees.find(t => t.name === 'Engineering');

  doc.getElementById('addTeamCommitteeBtn').click();
  await wait(10);
  doc.getElementById('tcNameInput').value = 'Backend';
  doc.getElementById('tcTypeSelect').value = 'team';
  doc.getElementById('tcParentSelect').value = engineering.id;
  checkMember('Amir Khan');
  doc.getElementById('tcFormSaveBtn').click();
  await wait(20);

  doc.getElementById('addTeamCommitteeBtn').click();
  await wait(10);
  doc.getElementById('tcNameInput').value = 'Marketing';
  doc.getElementById('tcTypeSelect').value = 'team';
  doc.getElementById('tcFormSaveBtn').click();
  await wait(20);

  doc.getElementById('teamsCommitteesModalClose').click();
  await wait(10);

  /* --- Open the Org Chart --- */
  doc.getElementById('orgChartBtn').click();
  await wait(20);
  log('clicking it opens the Org Chart modal', !doc.getElementById('orgChartOverlay').classList.contains('hidden'));
  log('modal uses the large modal size', doc.querySelector('#orgChartOverlay .kf-modal').classList.contains('kf-modal-lg'));
  log('defaults to showing Teams', doc.getElementById('orgChartFilterToggleLabel').textContent === 'Showing: Teams');

  let nodes = Array.from(doc.querySelectorAll('#orgChartInner .kf-orgnode'));
  let names = nodes.map(n => n.getAttribute('data-tc-id'));
  log('Teams view shows exactly the 3 teams (Engineering, Backend, Marketing)', nodes.length === 3, nodes.length);
  log('Teams view excludes the committee (Exec Committee)', names.indexOf(execCommittee.id) === -1);

  let edges = doc.querySelectorAll('#orgChartInner path.kf-org-edge');
  log('Engineering (whose real parent is a filtered-out committee) is reattached as a root — only 1 edge exists (Engineering -> Backend)',
      edges.length === 1, edges.length);

  /* --- Toggle to Committees --- */
  doc.getElementById('orgChartFilterToggle').click();
  await wait(10);
  log('toggle switches label to Showing: Committees', doc.getElementById('orgChartFilterToggleLabel').textContent === 'Showing: Committees');
  nodes = Array.from(doc.querySelectorAll('#orgChartInner .kf-orgnode'));
  log('Committees view shows exactly the 1 committee (Exec Committee)', nodes.length === 1 && nodes[0].getAttribute('data-tc-id') === execCommittee.id);

  doc.getElementById('orgChartFilterToggle').click();
  await wait(10);
  log('toggle switches back to Showing: Teams', doc.getElementById('orgChartFilterToggleLabel').textContent === 'Showing: Teams');

  /* --- Click-to-view-members popover --- */
  const engNode = doc.querySelector('#orgChartInner .kf-orgnode[data-tc-id="' + engineering.id + '"]');
  engNode.dispatchEvent(new window.Event('click', { bubbles: true }));
  await wait(10);
  let popover = doc.getElementById('orgChartMemberPopover');
  log('clicking Engineering opens the member popover', !popover.classList.contains('hidden'));
  log('popover lists Engineering’s direct members, alphabetically (Amir before Zoe)',
      popover.textContent.indexOf('Amir Khan') !== -1 && popover.textContent.indexOf('Zoe Adams') !== -1 &&
      popover.textContent.indexOf('Amir Khan') < popover.textContent.indexOf('Zoe Adams'), popover.textContent);

  raw = JSON.parse(window.localStorage.getItem('kanbanflow_v1_db'));
  proj = raw.projects[raw.currentProjectId];
  const marketingId = proj.teamsCommittees.find(t => t.name === 'Marketing').id;
  const marketingNode = doc.querySelector('#orgChartInner .kf-orgnode[data-tc-id="' + marketingId + '"]');
  marketingNode.dispatchEvent(new window.Event('click', { bubbles: true }));
  await wait(10);
  log('clicking a team with no direct members shows a "No direct members" message',
      popover.textContent.indexOf('No direct members') !== -1, popover.textContent);

  doc.getElementById('orgChartOverlay').dispatchEvent(new window.Event('click', { bubbles: true }));
  await wait(10);
  log('clicking outside the popover closes it', doc.getElementById('orgChartMemberPopover').classList.contains('hidden'));

  /* --- Export As SVG / PNG --- */
  log('Export As... button exists', !!doc.getElementById('orgChartExportAsBtn'));
  const svgOption = doc.querySelector('#orgChartExportAsPanel [data-export-type="svg"]');
  const pngOption = doc.querySelector('#orgChartExportAsPanel [data-export-type="png"]');
  log('Export as SVG option exists', !!svgOption);
  log('Export as PNG (4x resolution) option exists', !!pngOption && pngOption.textContent.indexOf('4x') !== -1, pngOption && pngOption.textContent);

  svgOption.click();
  await wait(10);
  log('exporting as SVG produces markup containing a node name', !!lastBlobText && lastBlobText.indexOf('Engineering') !== -1);

  doc.getElementById('orgChartClose').click();
  await wait(10);
  log('closing the modal hides it', doc.getElementById('orgChartOverlay').classList.contains('hidden'));

  /* --- App Settings visibility gate --- */
  doc.getElementById('appSettingsBtn').click();
  await wait(10);
  doc.getElementById('settingsShowTeamsCommitteesBtn').checked = false;
  doc.getElementById('settingsShowTeamsCommitteesBtn').dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(10);
  log('disabling the Teams & Committees app setting hides the toolbar Org Chart icon',
      doc.getElementById('orgChartBtn').classList.contains('kf-vis-hidden'));
  log('disabling the Teams & Committees app setting hides the side-nav Org Chart icon',
      doc.getElementById('navOrgChartBtn').classList.contains('kf-vis-hidden'));

  doc.getElementById('settingsShowTeamsCommitteesBtn').checked = true;
  doc.getElementById('settingsShowTeamsCommitteesBtn').dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(10);
  log('re-enabling the Teams & Committees app setting shows the toolbar Org Chart icon again',
      !doc.getElementById('orgChartBtn').classList.contains('kf-vis-hidden'));
  log('re-enabling the Teams & Committees app setting shows the side-nav Org Chart icon again',
      !doc.getElementById('navOrgChartBtn').classList.contains('kf-vis-hidden'));
  doc.getElementById('appSettingsClose').click();

  console.log('\nOrg chart test complete.');
  process.exit(0);
})().catch(e => { console.error('CRASHED', e); process.exit(1); });
