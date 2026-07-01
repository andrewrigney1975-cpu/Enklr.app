const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync('../dist/index.html', 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/', pretendToBeVisual: true });
const { window } = dom;
function wait(ms){ return new Promise(r => setTimeout(r, ms)); }

(async () => {
  await wait(300);
  const doc = window.document;
  function log(label, ok, extra){ console.log((ok?'PASS':'FAIL') + ' - ' + label + (extra?' :: '+extra:'')); }

  doc.getElementById('risksBtn').click();
  await wait(20);
  doc.getElementById('addRiskBtn').click();
  await wait(10);
  doc.getElementById('riskTitleInput').value = 'Vendor delay risk';
  doc.getElementById('riskFormSaveBtn').click();
  await wait(20);
  doc.getElementById('risksModalClose').click();
  await wait(10);

  doc.getElementById('decisionsBtn').click();
  await wait(20);
  doc.getElementById('addDecisionBtn').click();
  await wait(10);

  const statusOptions = Array.from(doc.getElementById('decisionStatusSelect').options).map(o => o.value);
  log('status select offers exactly 3 options', statusOptions.length === 3, statusOptions.length);
  log('status options match the spec exactly, in order', statusOptions.join(',') === 'open,in_review,completed', statusOptions.join(','));
  log('defaults to Open for a new decision', doc.getElementById('decisionStatusSelect').value === 'open');

  log('approver input starts empty for a new decision', doc.getElementById('decisionApproverInput').value === '');
  log('approver datalist exists and is linked via the list attribute', doc.getElementById('decisionApproverInput').getAttribute('list') === 'decisionApproverOptions');
  log('approver datalist starts with no options (no approvers used yet)', doc.getElementById('decisionApproverOptions').options.length === 0);

  const riskCheckboxes = doc.querySelectorAll('#decisionRiskPicker input[type=checkbox]');
  log('risk picker lists the one existing risk', riskCheckboxes.length === 1, riskCheckboxes.length);
  log('risk picker shows the risk\u2019s key and title', doc.getElementById('decisionRiskPicker').textContent.indexOf('Vendor delay risk') !== -1);

  doc.getElementById('decisionTitleInput').value = 'Go with vendor A';
  doc.getElementById('decisionStatusSelect').value = 'in_review';
  doc.getElementById('decisionOutcomeInput').value = 'Vendor A selected pending final sign-off.';
  doc.getElementById('decisionApproverInput').value = 'Jordan Lee';
  riskCheckboxes[0].checked = true;
  doc.getElementById('decisionFormSaveBtn').click();
  await wait(20);

  let raw = JSON.parse(window.localStorage.getItem('kanbanflow_v1_db'));
  let proj = raw.projects[raw.currentProjectId];
  let decision = proj.decisions.find(d => d.title === 'Go with vendor A');
  log('status persisted correctly', decision.status === 'in_review', decision.status);
  log('outcome persisted correctly', decision.outcome === 'Vendor A selected pending final sign-off.', decision.outcome);
  log('approver persisted as free text', decision.approver === 'Jordan Lee', decision.approver);
  log('associated risk persisted in riskIds', decision.riskIds.length === 1, JSON.stringify(decision.riskIds));
  log('a new approver value is registered in the project\u2019s approver vocabulary', proj.approvers.includes('Jordan Lee'), JSON.stringify(proj.approvers));

  doc.getElementById('addDecisionBtn').click();
  await wait(10);
  const datalistOptions = Array.from(doc.getElementById('decisionApproverOptions').options).map(o => o.value);
  log('datalist now offers "Jordan Lee" as a selectable existing value', datalistOptions.includes('Jordan Lee'), datalistOptions.join(','));

  doc.getElementById('decisionTitleInput').value = 'Second decision';
  doc.getElementById('decisionApproverInput').value = 'jordan lee';
  doc.getElementById('decisionFormSaveBtn').click();
  await wait(20);
  raw = JSON.parse(window.localStorage.getItem('kanbanflow_v1_db'));
  proj = raw.projects[raw.currentProjectId];
  const jordanCount = proj.approvers.filter(a => a.toLowerCase() === 'jordan lee').length;
  log('typing the same name with different casing does not create a duplicate vocabulary entry', jordanCount === 1, JSON.stringify(proj.approvers));
  const secondDecision = proj.decisions.find(d => d.title === 'Second decision');
  log('the decision reuses the EXISTING canonical casing rather than storing a near-duplicate variant',
      secondDecision.approver === 'Jordan Lee', secondDecision.approver);

  doc.getElementById('addDecisionBtn').click();
  await wait(10);
  doc.getElementById('decisionTitleInput').value = 'No approver yet';
  doc.getElementById('decisionFormSaveBtn').click();
  await wait(20);
  raw = JSON.parse(window.localStorage.getItem('kanbanflow_v1_db'));
  proj = raw.projects[raw.currentProjectId];
  const noApproverDecision = proj.decisions.find(d => d.title === 'No approver yet');
  log('leaving approver blank stores null', noApproverDecision.approver === null, noApproverDecision.approver);

  const rowText = doc.getElementById('decisionsList').textContent;
  log('list shows the status label for the in-review decision', rowText.indexOf('In Review') !== -1, rowText);
  log('list shows the approver name', rowText.indexOf('Jordan Lee') !== -1, rowText);
  log('list shows the associated risk count', rowText.indexOf('1 risk') !== -1, rowText);

  const decisionRow = Array.from(doc.querySelectorAll('.kf-release-row')).find(r => r.textContent.indexOf('Go with vendor A') !== -1);
  decisionRow.click();
  await wait(10);
  log('reopening shows the previously saved status', doc.getElementById('decisionStatusSelect').value === 'in_review');
  log('reopening shows the previously saved outcome', doc.getElementById('decisionOutcomeInput').value === 'Vendor A selected pending final sign-off.');
  log('reopening shows the previously saved approver', doc.getElementById('decisionApproverInput').value === 'Jordan Lee');
  log('reopening shows the previously saved risk link checked', doc.getElementById('decisionRiskPicker').querySelector('input[type=checkbox]').checked);
  doc.getElementById('decisionFormCancelBtn').click();
  await wait(10);

  doc.getElementById('decisionsModalClose').click();
  await wait(10);
  doc.getElementById('risksBtn').click();
  await wait(20);
  const riskRowToDelete = Array.from(doc.querySelectorAll('.kf-release-row')).find(r => r.textContent.indexOf('Vendor delay risk') !== -1);
  riskRowToDelete.click();
  await wait(10);
  doc.getElementById('deleteRiskBtn').click();
  await wait(10);
  doc.getElementById('confirmOkBtn').click();
  await wait(20);

  raw = JSON.parse(window.localStorage.getItem('kanbanflow_v1_db'));
  proj = raw.projects[raw.currentProjectId];
  decision = proj.decisions.find(d => d.title === 'Go with vendor A');
  log('decision survives the linked risk\u2019s deletion', !!decision);
  log('decision\u2019s riskIds no longer references the deleted risk', decision.riskIds.length === 0, JSON.stringify(decision.riskIds));

  console.log('\nDecisions new-fields test complete.');
  process.exit(0);
})().catch(e => { console.error('CRASHED', e); process.exit(1); });
