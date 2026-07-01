const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync('../dist/index.html', 'utf8');
function wait(ms){ return new Promise(r => setTimeout(r, ms)); }
const DAY = 24*60*60*1000;

function baseProject(overrides){
  const now = Date.now();
  return Object.assign({
    id: 'p1', name: 'Fixture', key: 'FIX', taskCounter: 100,
    columns: [
      { id: 'col_todo', name: 'To Do', done: false, order: [] },
      { id: 'col_done', name: 'Done', done: true, order: [] }
    ],
    tasks: {}, members: [], releases: [], taskTypes: [],
    documents: [], docCounter: 1, risks: [], riskCounter: 1, decisions: [], decCounter: 1,
    principles: [], prinCounter: 1, objectives: [], objCounter: 1,
    approvers: [], roles: [],
    headerButtonVisibility: { documents: true, risks: true, decisions: true, health: true, principles: true, objectives: true },
    startDate: null, endDate: null,
    dateCreated: new Date(now - 100*DAY).toISOString(), dateLastModified: new Date().toISOString(), dateLastExported: null
  }, overrides || {});
}
function dbWith(project){
  return JSON.stringify({ projects: { p1: project }, projectOrder: ['p1'], currentProjectId: 'p1' });
}
function loadFixture(project){
  return new JSDOM(html, {
    runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/', pretendToBeVisual: true,
    beforeParse(w){ w.localStorage.setItem('kanbanflow_v1_db', dbWith(project)); }
  });
}

(async () => {
  function log(label, ok, extra){ console.log((ok?'PASS':'FAIL') + ' - ' + label + (extra!==undefined?' :: '+extra:'')); }

  const now = Date.now();
  const project = baseProject({
    releases: [
      { id: 'r1', key: 'FIX-REL-1', name: 'R1', status: 'pending', startDate: null, endDate: new Date(now + 10*DAY).toISOString(), dateCreated: new Date().toISOString(), dateLastModified: new Date().toISOString() },
      { id: 'r2', key: 'FIX-REL-2', name: 'R2', status: 'pending', startDate: null, endDate: new Date(now - 10*DAY).toISOString(), dateCreated: new Date().toISOString(), dateLastModified: new Date().toISOString() }
    ]
  });

  function readGauge(doc, index){
    const block = doc.querySelectorAll('#healthGaugesRow .kf-health-gauge-block')[index];
    const text = block.querySelector('text').textContent;
    const path = block.querySelector('.kf-gauge-value-path').getAttribute('d');
    return { text, hasArc: !!path && path.length > 0 };
  }

  {
    const dom = loadFixture(project);
    await wait(300);
    const doc = dom.window.document;
    doc.getElementById('healthBtn').click();
    await wait(30);
    const releasesGauge = readGauge(doc, 0);
    log('immediately on open, the Releases gauge shows 0% (not the final 50%)', releasesGauge.text === '0%', releasesGauge.text);
    log('immediately on open, the gauge has no visible arc yet', !releasesGauge.hasArc);
  }

  {
    const dom = loadFixture(project);
    await wait(300);
    const doc = dom.window.document;
    doc.getElementById('healthBtn').click();
    await wait(400);
    const releasesGauge = readGauge(doc, 0);
    log('just before the 0.5s delay elapses, the gauge is still at 0%', releasesGauge.text === '0%', releasesGauge.text);
  }

  {
    const dom = loadFixture(project);
    await wait(300);
    const doc = dom.window.document;
    doc.getElementById('healthBtn').click();
    await wait(900);
    const releasesGauge = readGauge(doc, 0);
    const pct = parseInt(releasesGauge.text, 10);
    log('partway through the animation, the value is strictly between 0% and the final 50% (genuinely interpolating)',
        pct > 0 && pct < 50, releasesGauge.text);
    log('partway through, the arc is already visible (mid-sweep)', releasesGauge.hasArc);
  }

  {
    const dom = loadFixture(project);
    await wait(300);
    const doc = dom.window.document;
    doc.getElementById('healthBtn').click();
    await wait(1600);
    const releasesGauge = readGauge(doc, 0);
    log('by 1.6s after opening, the Releases gauge has settled exactly at its final value (50%)', releasesGauge.text === '50%', releasesGauge.text);
  }

  {
    const richProject = baseProject({
      releases: project.releases,
      risks: [
        { id: 'k1', key: 'FIX-RISK-1', title: 'R1', description: '', likelihood: 1, impact: 1, mitigations: 'x', ownerId: null, taskId: null, documentIds: [], status: 'new', dateToClose: null, dateClosed: null, dateCreated: new Date().toISOString(), dateLastModified: new Date().toISOString() }
      ],
      decisions: [
        { id: 'd1', key: 'FIX-DEC-1', title: 'D1', description: '', type: 'strategy', status: 'completed', outcome: '', ownerId: null, approver: null, taskId: null, documentIds: [], riskIds: [], principleIds: [], objectiveIds: [], dateCreated: new Date().toISOString(), dateLastModified: new Date().toISOString() }
      ],
      tasks: { t1: { id:'t1', key:'FIX-t1', title:'T1', description:'', priority:'medium', columnId:'col_done', dependencies:[], assigneeId:null, releaseId:null, typeId:null, documentationUrl:null, startDate:null, endDate:null, businessValue:5, taskCost:3, archived:false, dateCreated:new Date().toISOString(), dateLastModified:new Date().toISOString() } }
    });
    const dom = loadFixture(richProject);
    await wait(300);
    const doc = dom.window.document;
    doc.getElementById('healthBtn').click();
    await wait(1600);
    const overallText = doc.querySelector('#healthOverallGauge text').textContent;
    const allTexts = Array.from(doc.querySelectorAll('#healthGaugesRow .kf-health-gauge-block text')).map(t => t.textContent);
    log('Overall Health gauge has settled to a real, non-zero percentage by 1.6s', overallText !== '0%' && overallText !== 'N/A', overallText);
    log('all 4 composite gauges (each with real underlying data) have settled to real, non-zero percentages by 1.6s, simultaneously',
        allTexts.every(t => t !== '0%' && t !== 'N/A'), allTexts.join(','));
  }

  {
    const emptyProject = baseProject({});
    const dom = loadFixture(emptyProject);
    await wait(300);
    const doc = dom.window.document;
    doc.getElementById('healthBtn').click();
    await wait(30);
    const releasesGauge = readGauge(doc, 0);
    log('an N/A gauge shows "N/A" immediately, not "0%" pretending to animate', releasesGauge.text === 'N/A', releasesGauge.text);
    await wait(1700);
    const releasesGaugeLater = readGauge(doc, 0);
    log('an N/A gauge is still "N/A" after the full animation window has elapsed (never had a target to animate to)',
        releasesGaugeLater.text === 'N/A', releasesGaugeLater.text);
  }

  {
    const dom = loadFixture(project);
    await wait(300);
    const doc = dom.window.document;
    doc.getElementById('healthBtn').click();
    await wait(100);
    doc.getElementById('healthClose').click();
    await wait(10);
    doc.getElementById('healthBtn').click();
    await wait(1600);
    const releasesGauge = readGauge(doc, 0);
    log('after a quick close+reopen, the gauge still settles correctly at its exact final value (no leftover competing animation)',
        releasesGauge.text === '50%', releasesGauge.text);
  }

  console.log('\nHealth Dashboard gauge animation test complete.');
  process.exit(0);
})().catch(e => { console.error('CRASHED', e); process.exit(1); });
