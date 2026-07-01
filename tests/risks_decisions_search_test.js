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
  log('search input exists in the Risks modal', !!doc.getElementById('risksSearchInput'));

  doc.getElementById('addRiskBtn').click();
  await wait(10);
  doc.getElementById('riskTitleInput').value = 'Vendor delay';
  doc.getElementById('riskMitigationsInput').value = 'Use a backup supplier as contingency.';
  doc.getElementById('riskFormSaveBtn').click();
  await wait(20);

  doc.getElementById('addRiskBtn').click();
  await wait(10);
  doc.getElementById('riskTitleInput').value = 'Security breach';
  doc.getElementById('riskFormSaveBtn').click();
  await wait(20);

  log('both risks appear with no search applied', doc.querySelectorAll('#risksList .kf-release-row').length === 2);

  doc.getElementById('risksSearchInput').value = 'security';
  doc.getElementById('risksSearchInput').dispatchEvent(new window.Event('input', { bubbles: true }));
  await wait(10);
  let rows = doc.querySelectorAll('#risksList .kf-release-row');
  log('searching by title filters to the matching risk', rows.length === 1 && rows[0].textContent.indexOf('Security breach') !== -1, rows.length);

  doc.getElementById('risksSearchInput').value = 'backup supplier';
  doc.getElementById('risksSearchInput').dispatchEvent(new window.Event('input', { bubbles: true }));
  await wait(10);
  rows = doc.querySelectorAll('#risksList .kf-release-row');
  log('searching matches against the mitigations field too', rows.length === 1 && rows[0].textContent.indexOf('Vendor delay') !== -1, rows.length);

  doc.getElementById('risksSearchInput').value = 'no such risk';
  doc.getElementById('risksSearchInput').dispatchEvent(new window.Event('input', { bubbles: true }));
  await wait(10);
  log('a non-matching search shows the "no risks match" message', doc.getElementById('risksList').textContent.indexOf('No risks match') !== -1);

  doc.getElementById('risksModalClose').click();
  await wait(10);
  doc.getElementById('risksBtn').click();
  await wait(20);
  log('reopening the Risks modal resets the search term', doc.getElementById('risksSearchInput').value === '');
  doc.getElementById('risksModalClose').click();
  await wait(10);

  doc.getElementById('decisionsBtn').click();
  await wait(20);
  log('search input exists in the Decisions modal', !!doc.getElementById('decisionsSearchInput'));

  doc.getElementById('addDecisionBtn').click();
  await wait(10);
  doc.getElementById('decisionTitleInput').value = 'Adopt new framework';
  doc.getElementById('decisionOutcomeInput').value = 'Switched to a leaner toolchain.';
  doc.getElementById('decisionApproverInput').value = 'Morgan Avery';
  doc.getElementById('decisionFormSaveBtn').click();
  await wait(20);

  doc.getElementById('addDecisionBtn').click();
  await wait(10);
  doc.getElementById('decisionTitleInput').value = 'Pause the migration';
  doc.getElementById('decisionFormSaveBtn').click();
  await wait(20);

  log('both decisions appear with no search applied', doc.querySelectorAll('#decisionsList .kf-release-row').length === 2);

  doc.getElementById('decisionsSearchInput').value = 'pause';
  doc.getElementById('decisionsSearchInput').dispatchEvent(new window.Event('input', { bubbles: true }));
  await wait(10);
  rows = doc.querySelectorAll('#decisionsList .kf-release-row');
  log('searching by title filters to the matching decision', rows.length === 1 && rows[0].textContent.indexOf('Pause the migration') !== -1, rows.length);

  doc.getElementById('decisionsSearchInput').value = 'leaner toolchain';
  doc.getElementById('decisionsSearchInput').dispatchEvent(new window.Event('input', { bubbles: true }));
  await wait(10);
  rows = doc.querySelectorAll('#decisionsList .kf-release-row');
  log('searching matches against the outcome field', rows.length === 1 && rows[0].textContent.indexOf('Adopt new framework') !== -1, rows.length);

  doc.getElementById('decisionsSearchInput').value = 'morgan';
  doc.getElementById('decisionsSearchInput').dispatchEvent(new window.Event('input', { bubbles: true }));
  await wait(10);
  rows = doc.querySelectorAll('#decisionsList .kf-release-row');
  log('searching matches against the approver field (case-insensitive)', rows.length === 1 && rows[0].textContent.indexOf('Adopt new framework') !== -1, rows.length);

  doc.getElementById('decisionsSearchInput').value = 'nothing here';
  doc.getElementById('decisionsSearchInput').dispatchEvent(new window.Event('input', { bubbles: true }));
  await wait(10);
  log('a non-matching search shows the "no decisions match" message', doc.getElementById('decisionsList').textContent.indexOf('No decisions match') !== -1);

  doc.getElementById('decisionsModalClose').click();
  await wait(10);
  doc.getElementById('decisionsBtn').click();
  await wait(20);
  log('reopening the Decisions modal resets the search term', doc.getElementById('decisionsSearchInput').value === '');
  log('reopening shows the full unfiltered list', doc.querySelectorAll('#decisionsList .kf-release-row').length === 2);

  console.log('\nRisks/Decisions search test complete.');
  process.exit(0);
})().catch(e => { console.error('CRASHED', e); process.exit(1); });
