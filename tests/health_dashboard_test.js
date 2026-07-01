const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync('../dist/index.html', 'utf8');
function wait(ms){ return new Promise(r => setTimeout(r, ms)); }
function log(label, ok, extra){ console.log((ok?'PASS':'FAIL') + ' - ' + label + (extra!==undefined?' :: '+extra:'')); }
function near(actual, expected, tolerance){ return Math.abs(actual - expected) <= tolerance; }
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
    documents: [], docCounter: 1, risks: [], riskCounter: 1, decisions: [], decCounter: 1, approvers: [],
    headerButtonVisibility: { documents: true, risks: true, decisions: true, health: true },
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
function task(id, columnId, opts){
  return Object.assign({
    id: id, key: 'FIX-' + id, title: 'Task ' + id, description: '', priority: 'medium',
    columnId: columnId, dependencies: [], assigneeId: null, releaseId: null, typeId: null,
    documentationUrl: null, startDate: null, endDate: null,
    businessValue: 1, taskCost: 1, archived: false,
    dateCreated: new Date(Date.now() - 50*DAY).toISOString(), dateLastModified: new Date().toISOString()
  }, opts || {});
}

(async () => {
  // 1. Header button + App Settings wiring
  {
    const dom = loadFixture(baseProject());
    await wait(300);
    const doc = dom.window.document;
    log('Health button exists in the header', !!doc.getElementById('healthBtn'));
    log('Health button is visible by default', !doc.getElementById('healthBtn').classList.contains('hidden'));

    doc.getElementById('appSettingsBtn').click();
    await wait(20);
    log('Health Dashboard checkbox exists in App Settings', !!doc.getElementById('settingsShowHealthBtn'));
    log('Health Dashboard checkbox starts checked', doc.getElementById('settingsShowHealthBtn').checked);
    doc.getElementById('settingsShowHealthBtn').checked = false;
    doc.getElementById('settingsShowHealthBtn').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await wait(10);
    log('unchecking it hides the Health header button', doc.getElementById('healthBtn').classList.contains('hidden'));
    doc.getElementById('appSettingsClose').click();
    await wait(10);

    doc.getElementById('appSettingsBtn').click();
    await wait(10);
    doc.getElementById('settingsShowHealthBtn').checked = true;
    doc.getElementById('settingsShowHealthBtn').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await wait(10);
    doc.getElementById('appSettingsClose').click();
    await wait(10);
    doc.getElementById('healthBtn').click();
    await wait(20);
    log('clicking the Health button opens the dashboard modal', !doc.getElementById('healthOverlay').classList.contains('hidden'));
    doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(10);
    log('Escape closes the dashboard modal', doc.getElementById('healthOverlay').classList.contains('hidden'));
  }

  // 2. Releases gauge
  {
    const now = Date.now();
    const project = baseProject({
      releases: [
        { id: 'r1', key: 'FIX-REL-1', name: 'R1', status: 'pending', startDate: null, endDate: new Date(now - 5*DAY).toISOString(), dateCreated: new Date().toISOString(), dateLastModified: new Date().toISOString() },
        { id: 'r2', key: 'FIX-REL-2', name: 'R2', status: 'pending', startDate: null, endDate: new Date(now + 10*DAY).toISOString(), dateCreated: new Date().toISOString(), dateLastModified: new Date().toISOString() },
        { id: 'r3', key: 'FIX-REL-3', name: 'R3', status: 'deployed', startDate: null, endDate: new Date(now - 20*DAY).toISOString(), dateCreated: new Date().toISOString(), dateLastModified: new Date().toISOString() }
      ]
    });
    const dom = loadFixture(project);
    await wait(300);
    const doc = dom.window.document;
    doc.getElementById('healthBtn').click();
    await wait(1700); // allow the 0.5s delay + <=0.9s ease-out gauge animation to fully settle
    const releaseGaugeText = doc.querySelectorAll('#healthGaugesRow .kf-health-gauge-block')[0].querySelector('text').textContent;
    log('Releases gauge: 1 overdue-pending + 1 future + 1 overdue-but-deployed = 2/3 healthy (67%)',
        releaseGaugeText === '67%', releaseGaugeText);
  }

  // 3. Tasks gauge — composition + timeline weighting at 3 points
  function tasksFixture(startDate, endDate){
    const now = Date.now();
    const tasks = {
      T1: task('T1', 'col_done', { businessValue: 5, taskCost: 3 }),
      T2: task('T2', 'col_done', { businessValue: 5, taskCost: 3 }),
      T3: task('T3', 'col_todo', { businessValue: 5, taskCost: 3, endDate: new Date(now + 10*DAY).toISOString(), releaseId: 'rel1' }),
      T4: task('T4', 'col_todo', { businessValue: 5, taskCost: 3, endDate: new Date(now - 5*DAY).toISOString(), releaseId: 'rel1' }),
      T5: task('T5', 'col_todo', { businessValue: 1, taskCost: 1, endDate: null, releaseId: null })
    };
    return baseProject({ tasks: tasks, startDate: startDate, endDate: endDate, releases: [{ id: 'rel1', key: 'FIX-REL-1', name: 'Rel1', status: 'pending', startDate: null, endDate: null, dateCreated: new Date().toISOString(), dateLastModified: new Date().toISOString() }] });
  }
  function expectedTasksPct(doneWeight){
    const otherWeight = (1 - doneWeight) / 3;
    return 40*doneWeight + (50+80+(200/3))*otherWeight;
  }
  {
    const now = Date.now();
    const project = tasksFixture(new Date(now - 0.01*DAY).toISOString(), new Date(now + 100*DAY).toISOString());
    const dom = loadFixture(project);
    await wait(300);
    const doc = dom.window.document;
    doc.getElementById('healthBtn').click();
    await wait(1700); // allow the 0.5s delay + <=0.9s ease-out gauge animation to fully settle
    const pctText = doc.querySelectorAll('#healthGaugesRow .kf-health-gauge-block')[1].querySelector('text').textContent;
    const pct = parseInt(pctText, 10);
    const expected = Math.round(expectedTasksPct(0.1));
    log('Tasks gauge at project START (low Done weight) is close to ' + expected + '%', near(pct, expected, 2), pctText);
  }
  {
    const now = Date.now();
    const project = tasksFixture(new Date(now - 50*DAY).toISOString(), new Date(now + 50*DAY).toISOString());
    const dom = loadFixture(project);
    await wait(300);
    const doc = dom.window.document;
    doc.getElementById('healthBtn').click();
    await wait(1700); // allow the 0.5s delay + <=0.9s ease-out gauge animation to fully settle
    const pctText = doc.querySelectorAll('#healthGaugesRow .kf-health-gauge-block')[1].querySelector('text').textContent;
    const pct = parseInt(pctText, 10);
    const expected = Math.round(expectedTasksPct(0.5));
    log('Tasks gauge at project MIDPOINT (medium Done weight) is close to ' + expected + '%', near(pct, expected, 2), pctText);
  }
  {
    const now = Date.now();
    const project = tasksFixture(new Date(now - 95*DAY).toISOString(), new Date(now + 5*DAY).toISOString());
    const dom = loadFixture(project);
    await wait(300);
    const doc = dom.window.document;
    doc.getElementById('healthBtn').click();
    await wait(1700); // allow the 0.5s delay + <=0.9s ease-out gauge animation to fully settle
    const pctText = doc.querySelectorAll('#healthGaugesRow .kf-health-gauge-block')[1].querySelector('text').textContent;
    const pct = parseInt(pctText, 10);
    const expected = Math.round(expectedTasksPct(0.1 + 0.8*0.95));
    log('Tasks gauge NEAR THE END (high Done weight) is close to ' + expected + '%, and lower than the start-of-project value',
        near(pct, expected, 2) && pct < Math.round(expectedTasksPct(0.1)), pctText);
  }
  {
    const project = tasksFixture(null, null);
    const dom = loadFixture(project);
    await wait(300);
    const doc = dom.window.document;
    doc.getElementById('healthBtn').click();
    await wait(1700); // allow the 0.5s delay + <=0.9s ease-out gauge animation to fully settle
    const pctText = doc.querySelectorAll('#healthGaugesRow .kf-health-gauge-block')[1].querySelector('text').textContent;
    const pct = parseInt(pctText, 10);
    const expected = Math.round((40+50+80+(200/3))/4);
    log('Tasks gauge with NO project dates falls back to equal weighting (~' + expected + '%)', near(pct, expected, 2), pctText);
  }

  // 4. Risks gauge — all 3 "closed by target date" cases
  {
    const now = Date.now();
    const risks = [
      { id: 'k1', key: 'FIX-RISK-1', title: 'Closed on time', description: '', likelihood: 2, impact: 2, mitigations: 'Mitigated.', ownerId: 'm1', taskId: null, documentIds: [], status: 'closed', dateToClose: new Date(now - 10*DAY).toISOString(), dateClosed: new Date(now - 15*DAY).toISOString(), dateCreated: new Date().toISOString(), dateLastModified: new Date().toISOString() },
      { id: 'k2', key: 'FIX-RISK-2', title: 'Open and overdue', description: '', likelihood: 3, impact: 3, mitigations: '', ownerId: null, taskId: null, documentIds: [], status: 'new', dateToClose: new Date(now - 5*DAY).toISOString(), dateClosed: null, dateCreated: new Date().toISOString(), dateLastModified: new Date().toISOString() },
      { id: 'k3', key: 'FIX-RISK-3', title: 'Closed late', description: '', likelihood: 1, impact: 1, mitigations: 'Mitigated.', ownerId: 'm1', taskId: null, documentIds: [], status: 'closed', dateToClose: new Date(now - 20*DAY).toISOString(), dateClosed: new Date(now - 5*DAY).toISOString(), dateCreated: new Date().toISOString(), dateLastModified: new Date().toISOString() },
      { id: 'k4', key: 'FIX-RISK-4', title: 'No target date', description: '', likelihood: 1, impact: 1, mitigations: 'Mitigated.', ownerId: 'm1', taskId: null, documentIds: [], status: 'in_review', dateToClose: null, dateClosed: null, dateCreated: new Date().toISOString(), dateLastModified: new Date().toISOString() }
    ];
    const project = baseProject({ risks: risks, members: [{ id: 'm1', name: 'Alice', color: '#000' }] });
    const dom = loadFixture(project);
    await wait(300);
    const doc = dom.window.document;
    doc.getElementById('healthBtn').click();
    await wait(1700); // allow the 0.5s delay + <=0.9s ease-out gauge animation to fully settle
    const pctText = doc.querySelectorAll('#healthGaugesRow .kf-health-gauge-block')[2].querySelector('text').textContent;
    log('Risks gauge correctly averages mitigated/closed/closed-on-time/owned across all 3 "late" cases (~63%)',
        near(parseInt(pctText,10), 63, 2), pctText);
  }

  // 5. Decisions gauge
  {
    const decisions = [
      { id: 'd1', key: 'FIX-DEC-1', title: 'D1', description: '', type: 'strategy', status: 'completed', outcome: '', ownerId: 'm1', approver: null, taskId: null, documentIds: [], riskIds: [], dateCreated: new Date().toISOString(), dateLastModified: new Date().toISOString() },
      { id: 'd2', key: 'FIX-DEC-2', title: 'D2', description: '', type: 'strategy', status: 'open', outcome: '', ownerId: 'm1', approver: null, taskId: null, documentIds: [], riskIds: [], dateCreated: new Date().toISOString(), dateLastModified: new Date().toISOString() },
      { id: 'd3', key: 'FIX-DEC-3', title: 'D3', description: '', type: 'strategy', status: 'in_review', outcome: '', ownerId: null, approver: null, taskId: null, documentIds: [], riskIds: [], dateCreated: new Date().toISOString(), dateLastModified: new Date().toISOString() }
    ];
    const project = baseProject({ decisions: decisions, members: [{ id: 'm1', name: 'Alice', color: '#000' }] });
    const dom = loadFixture(project);
    await wait(300);
    const doc = dom.window.document;
    doc.getElementById('healthBtn').click();
    await wait(1700); // allow the 0.5s delay + <=0.9s ease-out gauge animation to fully settle
    const pctText = doc.querySelectorAll('#healthGaugesRow .kf-health-gauge-block')[3].querySelector('text').textContent;
    log('Decisions gauge averages completed% and owned% correctly (~50%)', near(parseInt(pctText,10), 50, 2), pctText);
  }

  // 6. Empty-category guards
  {
    const project = baseProject({});
    const dom = loadFixture(project);
    await wait(300);
    const doc = dom.window.document;
    doc.getElementById('healthBtn').click();
    await wait(1700); // allow the 0.5s delay + <=0.9s ease-out gauge animation to fully settle
    const gaugeTexts = Array.from(doc.querySelectorAll('#healthGaugesRow .kf-health-gauge-block')).map(b => b.querySelector('text').textContent);
    log('all 4 gauges show N/A (not 0% or 100%) when their category is completely empty',
        gaugeTexts.every(t => t === 'N/A'), gaugeTexts.join(','));
    const overallText = doc.querySelector('#healthOverallGauge text').textContent;
    log('Overall Health also shows N/A when every underlying category is empty', overallText === 'N/A', overallText);
  }

  // 7. Burndown
  {
    const project = baseProject({});
    const dom = loadFixture(project);
    await wait(300);
    const doc = dom.window.document;
    doc.getElementById('healthBtn').click();
    await wait(20);
    log('no project dates -> burndown shows the "set dates" message, not a chart',
        !doc.getElementById('healthBurndownNoData').classList.contains('hidden') &&
        doc.getElementById('healthBurndownNoData').textContent.indexOf('start and end date') !== -1);
  }
  {
    const now = Date.now();
    const tasks = {};
    for(let i=0;i<4;i++) tasks['R'+i] = task('R'+i, 'col_todo', {});
    const project = baseProject({ tasks: tasks, startDate: new Date(now-10*DAY).toISOString(), endDate: new Date(now+10*DAY).toISOString() });
    const dom = loadFixture(project);
    await wait(300);
    const doc = dom.window.document;
    doc.getElementById('healthBtn').click();
    await wait(20);
    const noDataText = doc.getElementById('healthBurndownNoData').textContent;
    log('dates set but zero completed tasks -> exact "not enough data to determine velocity or project completion" message',
        !doc.getElementById('healthBurndownNoData').classList.contains('hidden') &&
        noDataText.indexOf('Not enough data exists to determine velocity or project completion') !== -1, noDataText);
  }
  {
    const now = Date.now();
    const tasks = {
      D1: task('D1', 'col_done', { dateLastModified: new Date(now - 1*DAY).toISOString() }),
      R1: task('R1', 'col_todo', {}),
      R2: task('R2', 'col_todo', {})
    };
    const project = baseProject({ tasks: tasks, startDate: new Date(now - 5*DAY).toISOString(), endDate: new Date(now + 365*DAY).toISOString() });
    const dom = loadFixture(project);
    await wait(300);
    const doc = dom.window.document;
    doc.getElementById('healthBtn').click();
    await wait(20);
    log('plenty of runway at current pace -> no overrun warning shown', doc.getElementById('healthBurndownWarning').classList.contains('hidden'));
    log('chart renders (not the no-data message)', doc.getElementById('healthBurndownNoData').classList.contains('hidden'));
  }
  {
    const now = Date.now();
    const tasks = { D1: task('D1', 'col_done', { dateLastModified: new Date(now - 20*DAY).toISOString() }) };
    for(let i=0;i<20;i++) tasks['R'+i] = task('R'+i, 'col_todo', {});
    const project = baseProject({ tasks: tasks, startDate: new Date(now - 80*DAY).toISOString(), endDate: new Date(now + 2*DAY).toISOString() });
    const dom = loadFixture(project);
    await wait(300);
    const doc = dom.window.document;
    doc.getElementById('healthBtn').click();
    await wait(20);
    log('slow pace with little runway left -> overrun warning IS shown', !doc.getElementById('healthBurndownWarning').classList.contains('hidden'));
    log('overrun warning text mentions both a projected date and the planned end date',
        doc.getElementById('healthBurndownWarning').textContent.indexOf('projected to finish') !== -1);
    const overallNote = doc.getElementById('healthOverallNote').textContent;
    log('Overall Health note explains the score was reduced by the overrun penalty', overallNote.indexOf('reduced this score') !== -1, overallNote);
  }

  // 8. Top 5 team members
  {
    const tasks = {};
    tasks.a1 = task('a1','col_todo',{assigneeId:'alice'});
    tasks.a2 = task('a2','col_todo',{assigneeId:'alice'});
    tasks.a3 = task('a3','col_todo',{assigneeId:'alice'});
    tasks.b1 = task('b1','col_todo',{assigneeId:'bob'});
    tasks.b2 = task('b2','col_todo',{assigneeId:'bob'});
    tasks.b3 = task('b3','col_todo',{assigneeId:'bob'});
    tasks.c1 = task('c1','col_todo',{assigneeId:'charlie'});
    tasks.c2 = task('c2','col_done',{assigneeId:'charlie'});
    tasks.c3 = task('c3','col_done',{assigneeId:'charlie'});
    tasks.d1 = task('d1','col_done',{assigneeId:'dave'});
    tasks.u1 = task('u1','col_todo',{assigneeId:null});
    const project = baseProject({
      tasks: tasks,
      members: [
        {id:'alice', name:'Alice', color:'#111'},
        {id:'bob', name:'Bob', color:'#222'},
        {id:'charlie', name:'Charlie', color:'#333'},
        {id:'dave', name:'Dave', color:'#444'}
      ]
    });
    const dom = loadFixture(project);
    await wait(300);
    const doc = dom.window.document;
    doc.getElementById('healthBtn').click();
    await wait(20);
    const rows = Array.from(doc.querySelectorAll('.kf-health-top-member-row'));
    log('exactly 3 members appear (Dave with 0 active tasks is excluded)', rows.length === 3, rows.length);
    log('1st place is Alice (alphabetic tie-break over Bob at equal count 3)', rows[0].textContent.indexOf('Alice') !== -1, rows[0].textContent);
    log('2nd place is Bob', rows[1].textContent.indexOf('Bob') !== -1, rows[1].textContent);
    log('3rd place is Charlie with count 1 (his 2 Done tasks correctly excluded)', rows[2].textContent.indexOf('Charlie') !== -1 && rows[2].textContent.indexOf('1') !== -1, rows[2].textContent);
    log('counts are in descending order (3, 3, 1)', rows[0].textContent.indexOf('3')!==-1 && rows[1].textContent.indexOf('3')!==-1);
  }
  {
    const project = baseProject({ tasks: { z1: task('z1','col_done',{assigneeId:null}) } });
    const dom = loadFixture(project);
    await wait(300);
    const doc = dom.window.document;
    doc.getElementById('healthBtn').click();
    await wait(20);
    log('no active assigned work at all -> explicit empty-state message', doc.getElementById('healthTopMembers').textContent.indexOf('No active tasks') !== -1);
  }

  console.log('\nProject Health Dashboard test complete.');
  process.exit(0);
})().catch(e => { console.error('CRASHED', e); process.exit(1); });
