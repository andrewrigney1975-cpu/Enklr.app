const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync('../dist/index.html', 'utf8');

function wait(ms){ return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;
  await wait(300);
  const doc = window.document;
  function log(label, ok, extra){ console.log((ok?'PASS':'FAIL') + ' - ' + label + (extra !== undefined ? ' :: ' + extra : '')); }

  // ── 1. Report overlay starts hidden, opens from the Risks modal with the right title ──
  log('report overlay starts hidden', doc.getElementById('reportOverlay').classList.contains('hidden'));
  doc.getElementById('risksBtn').click();
  await wait(20);
  doc.getElementById('addRiskBtn').click();
  await wait(10);
  doc.getElementById('riskTitleInput').value = 'Report content risk';
  doc.getElementById('riskDescEditor').textContent = 'A risk used to test report rendering.';
  doc.getElementById('riskFormSaveBtn').click();
  await wait(20);

  doc.getElementById('risksReportBtn').click();
  await wait(20);
  log('Risks report opens', !doc.getElementById('reportOverlay').classList.contains('hidden'));
  log('report title is "<project name> - Risks"', doc.getElementById('reportTitle').textContent === 'Sample Project - Risks', doc.getElementById('reportTitle').textContent);

  // ── 2. Report body lists the new risk with key, title, ratings, and related entities ──
  const riskItems = Array.from(doc.querySelectorAll('#reportBody .kf-report-item'));
  const firstRisk = riskItems.find(el => el.textContent.indexOf('Report content risk') !== -1);
  log('report lists the new risk item', !!firstRisk, riskItems.length);
  log('risk item shows a key', !!firstRisk && firstRisk.querySelector('.kf-report-item-key') !== null);
  log('risk item shows a rendered (non-empty) description block', !!firstRisk && firstRisk.querySelector('.kf-richtext-content, .kf-report-no-desc') !== null);
  log('risk item shows a ratings block with a risk score badge', !!firstRisk && firstRisk.querySelector('.kf-report-ratings .kf-risk-score-badge') !== null);
  log('risk item shows a related-entities block', !!firstRisk && firstRisk.querySelector('.kf-report-related') !== null);

  doc.getElementById('reportClose').click();
  await wait(20);
  log('report overlay closes via its own close button', doc.getElementById('reportOverlay').classList.contains('hidden'));
  log('closing the report leaves the Risks modal open underneath', !doc.getElementById('risksOverlay').classList.contains('hidden'));
  doc.getElementById('risksModalClose').click();
  await wait(20);

  // ── 3. Decisions report has no ratings block (Decision has no rating fields) ──
  doc.getElementById('decisionsBtn').click();
  await wait(20);
  doc.getElementById('decisionsReportBtn').click();
  await wait(20);
  log('report title is "<project name> - Decisions"', doc.getElementById('reportTitle').textContent === 'Sample Project - Decisions', doc.getElementById('reportTitle').textContent);
  const decisionItems = doc.querySelectorAll('#reportBody .kf-report-item');
  if(decisionItems.length > 0){
    log('decision item has no ratings block', decisionItems[0].querySelector('.kf-report-ratings') === null);
  } else {
    log('no seeded decisions - empty state shown instead', doc.getElementById('reportBody').textContent.indexOf('No decisions yet') !== -1);
  }
  doc.getElementById('reportClose').click();
  await wait(20);
  doc.getElementById('decisionsModalClose').click();
  await wait(20);

  // ── 4. Principles: create one with nothing linked, confirm the "no related entities" empty state ──
  doc.getElementById('principlesBtn').click();
  await wait(20);
  doc.getElementById('addPrincipleBtn').click();
  await wait(10);
  doc.getElementById('principleTitleInput').value = 'Report empty-state principle';
  doc.getElementById('principleDescEditor').textContent = 'No links on this one.';
  doc.getElementById('principleFormSaveBtn').click();
  await wait(20);

  doc.getElementById('principlesReportBtn').click();
  await wait(20);
  const principleItems = Array.from(doc.querySelectorAll('#reportBody .kf-report-item'));
  const target = principleItems.find(el => el.textContent.indexOf('Report empty-state principle') !== -1);
  log('new principle appears in its report', !!target);
  log('principle item has no ratings block', target && target.querySelector('.kf-report-ratings') === null);
  log('principle with nothing linked shows the "no related entities" empty state', target && target.querySelector('.kf-report-related-empty') !== null, target ? target.querySelector('.kf-report-related').textContent : '');

  console.log('\nEntity reports test complete.');
  process.exit(0);
})().catch(e => { console.error('CRASHED', e); process.exit(1); });
