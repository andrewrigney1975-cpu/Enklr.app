const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync('../dist/index.html', 'utf8');
function wait(ms){ return new Promise(r => setTimeout(r, ms)); }
const DAY = 24*60*60*1000;

function makeProject(overrides){
  const now = Date.now();
  return Object.assign({
    id:'p1', name:'Fixture', key:'FIX', taskCounter:1,
    columns:[{id:'col1',name:'To Do',done:false,order:[]}],
    tasks:{}, members:[], releases:[], taskTypes:[],
    documents:[], docCounter:1, risks:[], riskCounter:1, decisions:[], decCounter:1,
    principles:[], prinCounter:1, objectives:[], objCounter:1,
    teamsCommittees:[], tcCounter:1, approvers:[], roles:[],
    headerButtonVisibility:{documents:true,risks:true,decisions:true,health:true,principles:true,objectives:true,teamsCommittees:true},
    startDate:null, endDate:null,
    dateCreated:new Date(now-100*DAY).toISOString(), dateLastModified:new Date().toISOString(), dateLastExported:null
  }, overrides || {});
}
function member(id, name){ return {id,name,color:'#111',role:null,reportsToId:null}; }
function tc(id, key, name, type, parentId, memberIds){
  return {id,key,name,description:'',type:type||'team',parentId:parentId||null,memberIds:memberIds||[],
    dateCreated:new Date().toISOString(),dateLastModified:new Date().toISOString()};
}
function task(id, columnId, opts){
  return Object.assign({
    id, key:'FIX-'+id, title:'Task '+id, description:'', priority:'medium',
    columnId, dependencies:[], assigneeId:null, releaseId:null, typeId:null,
    documentationUrl:null, startDate:null, endDate:null,
    businessValue:1, taskCost:1, archived:false,
    dateCreated:new Date().toISOString(), dateLastModified:new Date().toISOString()
  }, opts || {});
}

(async () => {
  function log(label, ok, extra){ console.log((ok?'PASS':'FAIL') + ' - ' + label + (extra!==undefined?' :: '+extra:'')); }

  const alice = member('m1','Alice Allen');
  const bob   = member('m2','Bob Baker');
  const carol = member('m3','Carol Clark');

  const engineering = tc('tc1','FIX-TEAM-001','Engineering','team',null,['m1']);
  const design      = tc('tc2','FIX-TEAM-002','Design','team',null,['m2']);
  const emptyTeam   = tc('tc3','FIX-TEAM-003','Marketing','team',null,['m3']); // member exists but gets no tasks
  const steering    = tc('tc4','FIX-COMM-001','Steering Committee','committee',null,['m1','m2']);

  const project = makeProject({
    members:[alice,bob,carol],
    teamsCommittees:[engineering,design,emptyTeam,steering],
    columns:[{id:'col1',name:'To Do',done:false,order:['t1','t2','t3']}],
    tasks:{
      t1: task('t1','col1',{assigneeId:'m1'}), // Alice -> Engineering
      t2: task('t2','col1',{assigneeId:'m2'}), // Bob -> Design
      t3: task('t3','col1',{assigneeId:null})  // unassigned
    }
  });

  const dom = new JSDOM(html, {
    runScripts:'dangerously', resources:'usable', url:'http://localhost/', pretendToBeVisual:true,
    beforeParse(w){ w.localStorage.setItem('kanbanflow_v1_db', JSON.stringify({
      projects:{p1:project}, projectOrder:['p1'], currentProjectId:'p1'
    })); }
  });
  await wait(300);
  const doc = dom.window.document;

  // ── 1. Filter exists, positioned to the left of Assignee ─────────────────
  const teamWrap = doc.getElementById('teamFilterWrap');
  const assigneeWrap = doc.getElementById('assigneeFilterWrap');
  log('Team filter exists', !!teamWrap);
  log('Team filter is positioned immediately before Assignee in the DOM', teamWrap.nextElementSibling === assigneeWrap);
  log('Team filter is visible (Teams & Committees enabled, teams exist)', !teamWrap.classList.contains('kf-vis-hidden'));

  // ── 2. Only teams, never committees, appear in the picker ─────────────────
  doc.getElementById('teamFilterBtn').click();
  await wait(10);
  const rowNames = Array.from(doc.querySelectorAll('#teamFilterPanel .kf-dropdown-filter-name')).map(el => el.textContent);
  log('Engineering (a team) appears in the picker', rowNames.includes('Engineering'), rowNames.join(','));
  log('Design (a team) appears in the picker', rowNames.includes('Design'));
  log('Steering Committee (a committee) does NOT appear in the picker', !rowNames.includes('Steering Committee'), rowNames.join(','));

  // ── 3. Teams with tasks are normal; teams without any are greyed out ──────
  const rows = Array.from(doc.querySelectorAll('#teamFilterPanel .kf-dropdown-filter-row'));
  const engRow = rows.find(r => r.textContent.indexOf('Engineering') !== -1);
  const designRow = rows.find(r => r.textContent.indexOf('Design') !== -1);
  const marketingRow = rows.find(r => r.textContent.indexOf('Marketing') !== -1);
  log('Engineering (has a task via Alice) is NOT greyed out', !engRow.classList.contains('kf-team-filter-empty'));
  log('Design (has a task via Bob) is NOT greyed out', !designRow.classList.contains('kf-team-filter-empty'));
  log('Marketing (Carol has no tasks) IS greyed out', marketingRow.classList.contains('kf-team-filter-empty'));

  // ── 4. Selecting a team actually filters the board via Task->Member->Team ─
  doc.getElementById('teamFilterPanel').querySelector('input[type=checkbox]'); // no-op, just confirming presence
  const engCheckbox = engRow.querySelector('input[type=checkbox]');
  engCheckbox.checked = true;
  engCheckbox.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  await wait(10);

  let raw = JSON.parse(dom.window.localStorage.getItem('kanbanflow_v1_db'));
  // taskMatchesFilters is internal; verify via the board's rendered cards instead.
  function visibleTaskKeys(){
    return Array.from(doc.querySelectorAll('.kf-card')).map(c => c.querySelector('.kf-card-key') ? c.querySelector('.kf-card-key').textContent : c.textContent);
  }
  const cardsHtml = doc.getElementById('board').innerHTML;
  log('with Engineering selected, Alice\u2019s task (t1) is shown', cardsHtml.indexOf('FIX-t1') !== -1, cardsHtml.match(/FIX-t\d/g));
  log('with Engineering selected, Bob\u2019s task (t2) is filtered out', cardsHtml.indexOf('FIX-t2') === -1);
  log('with Engineering selected, the unassigned task (t3) is filtered out', cardsHtml.indexOf('FIX-t3') === -1);

  // ── 5. Clear selection restores all tasks ─────────────────────────────────
  doc.getElementById('teamFilterBtn').click();
  await wait(10);
  doc.querySelector('#teamFilterPanel .kf-dropdown-filter-clear').click();
  await wait(10);
  const cardsHtmlAfterClear = doc.getElementById('board').innerHTML;
  log('clearing the selection restores all 3 tasks', ['t1','t2','t3'].every(id => cardsHtmlAfterClear.indexOf('FIX-'+id) !== -1));

  // ── 6. App Settings gating: disabling Teams & Committees hides the filter ─
  doc.getElementById('teamFilterBtn').click();
  await wait(10);
  const engCheckbox2 = Array.from(doc.querySelectorAll('#teamFilterPanel .kf-dropdown-filter-row'))
    .find(r => r.textContent.indexOf('Engineering') !== -1).querySelector('input[type=checkbox]');
  engCheckbox2.checked = true;
  engCheckbox2.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  await wait(10);

  doc.getElementById('appSettingsBtn').click();
  await wait(20);
  doc.getElementById('settingsShowTeamsCommitteesBtn').checked = false;
  doc.getElementById('settingsShowTeamsCommitteesBtn').dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  await wait(10);
  doc.getElementById('appSettingsClose').click();
  await wait(10);

  log('disabling Teams & Committees hides the Team filter entirely', doc.getElementById('teamFilterWrap').classList.contains('kf-vis-hidden'));
  const cardsAfterDisable = doc.getElementById('board').innerHTML;
  log('disabling it also force-clears the active selection, restoring all tasks to view',
      ['t1','t2','t3'].every(id => cardsAfterDisable.indexOf('FIX-'+id) !== -1));

  doc.getElementById('appSettingsBtn').click();
  await wait(20);
  doc.getElementById('settingsShowTeamsCommitteesBtn').checked = true;
  doc.getElementById('settingsShowTeamsCommitteesBtn').dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  await wait(10);
  doc.getElementById('appSettingsClose').click();
  await wait(10);
  log('re-enabling it restores the Team filter', !doc.getElementById('teamFilterWrap').classList.contains('kf-vis-hidden'));

  // ── 7. With no teams in the project at all, the filter stays hidden ──────
  const noTeamsProject = makeProject({ members:[alice], teamsCommittees:[] });
  const dom2 = new JSDOM(html, {
    runScripts:'dangerously', resources:'usable', url:'http://localhost/', pretendToBeVisual:true,
    beforeParse(w){ w.localStorage.setItem('kanbanflow_v1_db', JSON.stringify({
      projects:{p1:noTeamsProject}, projectOrder:['p1'], currentProjectId:'p1'
    })); }
  });
  await wait(300);
  const doc2 = dom2.window.document;
  log('with zero teams in the project, the filter stays hidden even though Teams & Committees is enabled',
      doc2.getElementById('teamFilterWrap').classList.contains('kf-vis-hidden'));

  console.log('\nTeam filter test complete.');
  process.exit(0);
})().catch(e => { console.error('CRASHED', e); process.exit(1); });
