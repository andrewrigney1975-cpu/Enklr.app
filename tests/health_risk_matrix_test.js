const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync('../dist/index.html', 'utf8');
function wait(ms){ return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;

  window.HTMLCanvasElement.prototype.getContext = function(){ return { drawImage: function(){} }; };
  window.HTMLCanvasElement.prototype.toBlob = function(callback){
    callback(new window.Blob(['fake-png'], { type: 'image/png' }));
  };
  class FakeImage {
    set src(v){ this._src = v; setTimeout(() => { if (this.onload) this.onload(); }, 0); }
    get src(){ return this._src; }
  }
  window.Image = FakeImage;
  window.URL.createObjectURL = () => 'blob://fake';
  window.URL.revokeObjectURL = () => {};
  let lastBlob = null, lastFilename = null;
  const OrigBlob = window.Blob;
  window.Blob = function(parts, opts){ lastBlob = { parts, opts }; return new OrigBlob(parts, opts); };
  const origCreateElement = window.document.createElement.bind(window.document);
  window.document.createElement = function(tag){
    const el = origCreateElement(tag);
    if (tag === 'a') { el.click = function(){ lastFilename = el.download; }; }
    return el;
  };

  await wait(300);
  const doc = window.document;
  function log(label, ok, extra){ console.log((ok?'PASS':'FAIL') + ' - ' + label + (extra!==undefined?' :: '+extra:'')); }

  doc.getElementById('healthBtn').click();
  await wait(20);
  const body = doc.getElementById('healthBody');
  const burndownIdx = Array.from(body.children).findIndex(el => el.textContent.indexOf('Task Burndown') !== -1);
  const riskMatrixIdx = Array.from(body.children).findIndex(el => el.id === 'healthRiskMatrixSection');
  const topMembersIdx = Array.from(body.children).findIndex(el => el.textContent.indexOf('Top 5 Team Members') !== -1);
  log('Risk Matrix section exists', !!doc.getElementById('healthRiskMatrixSection'));
  log('section title is "Project Risks"', doc.getElementById('healthRiskMatrixSection').textContent.indexOf('Project Risks') !== -1);
  log('section appears below the burndown section and above team members', burndownIdx < riskMatrixIdx && riskMatrixIdx < topMembersIdx,
      `burndown=${burndownIdx} matrix=${riskMatrixIdx} members=${topMembersIdx}`);

  log('Risk Matrix section is visible by default (Risks enabled by default)', !doc.getElementById('healthRiskMatrixSection').classList.contains('hidden'));
  doc.getElementById('healthClose').click();
  await wait(10);
  doc.getElementById('appSettingsBtn').click();
  await wait(20);
  doc.getElementById('settingsShowRisksBtn').checked = false;
  doc.getElementById('settingsShowRisksBtn').dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(10);
  doc.getElementById('appSettingsClose').click();
  await wait(10);
  doc.getElementById('healthBtn').click();
  await wait(20);
  log('Risk Matrix section is hidden when the Risk feature is disabled', doc.getElementById('healthRiskMatrixSection').classList.contains('hidden'));
  doc.getElementById('healthClose').click();
  await wait(10);

  doc.getElementById('appSettingsBtn').click();
  await wait(10);
  doc.getElementById('settingsShowRisksBtn').checked = true;
  doc.getElementById('settingsShowRisksBtn').dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(10);
  doc.getElementById('appSettingsClose').click();
  await wait(10);

  doc.getElementById('healthBtn').click();
  await wait(20);
  log('empty-state message shown when there are no risks', doc.getElementById('healthRiskMatrixNoData').textContent.indexOf('No risks logged yet') !== -1 &&
      !doc.getElementById('healthRiskMatrixNoData').classList.contains('hidden'));
  doc.getElementById('healthClose').click();
  await wait(10);

  doc.getElementById('risksBtn').click();
  await wait(20);

  async function addRisk(title, likelihood, impact, status){
    doc.getElementById('addRiskBtn').click();
    await wait(10);
    doc.getElementById('riskTitleInput').value = title;
    doc.getElementById('riskLikelihoodSelect').value = String(likelihood);
    doc.getElementById('riskImpactSelect').value = String(impact);
    if(status) doc.getElementById('riskStatusSelect').value = status;
    doc.getElementById('riskFormSaveBtn').click();
    await wait(20);
  }

  await addRisk('Verylow risk', 1, 1, 'new');
  await addRisk('Low-from-impact risk', 1, 3, 'new');
  await addRisk('Medium-tied risk', 1, 4, 'new');
  await addRisk('Low-from-likelihood risk', 2, 2, 'new');
  await addRisk('Extreme risk', 5, 5, 'in_review');
  await addRisk('Closed risk', 3, 3, 'closed');

  doc.getElementById('risksModalClose').click();
  await wait(10);

  let raw = JSON.parse(window.localStorage.getItem('kanbanflow_v1_db'));
  let proj = raw.projects[raw.currentProjectId];

  doc.getElementById('healthBtn').click();
  await wait(20);
  const matrixSvg = doc.querySelector('#healthRiskMatrixChart svg');
  log('Risk Matrix SVG renders once risks exist', !!matrixSvg);

  const cellRects = matrixSvg.querySelectorAll('rect');
  log('exactly 25 cells are rendered (5x5 grid)', cellRects.length === 25, cellRects.length);

  const points = matrixSvg.querySelectorAll('.kf-risk-matrix-point');
  log('exactly 6 risk markers are plotted', points.length === 6, points.length);

  const closedPoint = Array.from(points).find(p => p.querySelector('title').textContent.indexOf('Closed risk') !== -1);
  log('the closed risk\u2019s marker has the faded class', closedPoint.classList.contains('kf-risk-matrix-point-faded'));
  const openPoints = Array.from(points).filter(p => p !== closedPoint);
  log('all non-closed risks\u2019 markers do NOT have the faded class', openPoints.every(p => !p.classList.contains('kf-risk-matrix-point-faded')));

  const extremePoint = Array.from(points).find(p => p.querySelector('title').textContent.indexOf('Extreme risk') !== -1);
  const extremeKey = proj.risks.find(r => r.title === 'Extreme risk').key;
  log('marker has an adjacent text label showing the risk\u2019s key', extremePoint.querySelector('text').textContent === extremeKey, extremePoint.querySelector('text').textContent);
  const circle = extremePoint.querySelector('circle');
  const text = extremePoint.querySelector('text');
  log('label is positioned to the right of its marker (adjacent, like the cost/benefit chart)',
      parseFloat(text.getAttribute('x')) > parseFloat(circle.getAttribute('cx')));

  doc.getElementById('healthClose').click();
  await wait(10);
  doc.getElementById('risksBtn').click();
  await wait(20);
  await addRisk('Same cell A', 4, 4, 'new');
  await addRisk('Same cell B', 4, 4, 'new');
  doc.getElementById('risksModalClose').click();
  await wait(10);
  doc.getElementById('healthBtn').click();
  await wait(20);
  const matrixSvg2 = doc.querySelector('#healthRiskMatrixChart svg');
  const pointsNow = matrixSvg2.querySelectorAll('.kf-risk-matrix-point');
  const sameCellA = Array.from(pointsNow).find(p => p.querySelector('title').textContent.indexOf('Same cell A') !== -1);
  const sameCellB = Array.from(pointsNow).find(p => p.querySelector('title').textContent.indexOf('Same cell B') !== -1);
  const cA = sameCellA.querySelector('circle'), cB = sameCellB.querySelector('circle');
  log('two risks in the identical (likelihood, impact) cell get DIFFERENT marker positions (no full overlap)',
      cA.getAttribute('cx') !== cB.getAttribute('cx') || cA.getAttribute('cy') !== cB.getAttribute('cy'),
      `A=(${cA.getAttribute('cx')},${cA.getAttribute('cy')}) B=(${cB.getAttribute('cx')},${cB.getAttribute('cy')})`);

  const legendText = doc.getElementById('healthRiskMatrixLegend').textContent;
  log('legend explains solid = open/in review', legendText.indexOf('Solid marker') !== -1 && legendText.toLowerCase().indexOf('open') !== -1);
  log('legend explains faded = closed', legendText.indexOf('Faded marker') !== -1 && legendText.toLowerCase().indexOf('closed') !== -1);

  log('Export As button exists for the Risk Matrix', !!doc.getElementById('healthRiskMatrixExportAsBtn'));
  doc.getElementById('healthRiskMatrixExportAsBtn').click();
  await wait(10);
  log('clicking it opens the export panel', !doc.getElementById('healthRiskMatrixExportAsPanel').classList.contains('hidden'));

  const svgOption = doc.querySelector('#healthRiskMatrixExportAsPanel [data-export-type="svg"]');
  lastBlob = null; lastFilename = null;
  svgOption.click();
  await wait(10);
  log('SVG export produces a Blob of type image/svg+xml', lastBlob && lastBlob.opts.type === 'image/svg+xml');
  log('SVG export filename includes "project-risks-matrix"', lastFilename && lastFilename.indexOf('project-risks-matrix') !== -1, lastFilename);
  log('exported SVG has no leftover var(...) references (colors baked)', lastBlob.parts[0].indexOf('var(--') === -1);

  doc.getElementById('healthRiskMatrixExportAsBtn').click();
  await wait(10);
  const pngOption = doc.querySelector('#healthRiskMatrixExportAsPanel [data-export-type="png"]');
  lastBlob = null; lastFilename = null;
  pngOption.click();
  await wait(30);
  log('PNG export produces a Blob of type image/png', lastBlob && lastBlob.opts.type === 'image/png');
  log('PNG export filename ends in .png', lastFilename && lastFilename.endsWith('.png'), lastFilename);

  const firstCellRect = matrixSvg.querySelector('rect');
  const cellW = parseFloat(firstCellRect.getAttribute('width'));
  const cellH = parseFloat(firstCellRect.getAttribute('height'));
  log('each risk matrix cell is a rectangle, not a square', Math.abs(cellW - cellH) > 1, `${cellW} x ${cellH}`);
  log('cell width:height ratio is exactly 1.7778', Math.abs((cellW / cellH) - 1.7778) < 0.001, (cellW / cellH).toFixed(4));

  const style = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1];
  log('#healthBurndownChart is horizontally centered', /#healthBurndownChart[^{]*\{[^}]*text-align:\s*center/.test(style));
  log('#healthRiskMatrixChart is horizontally centered', /#healthRiskMatrixChart[^{]*\{[^}]*text-align:\s*center/.test(style));

  console.log('\nProject Risks Matrix test complete.');
  process.exit(0);
})().catch(e => { console.error('CRASHED', e); process.exit(1); });
