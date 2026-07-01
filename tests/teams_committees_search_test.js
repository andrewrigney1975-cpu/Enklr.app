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
function tc(id, key, name, type, parentId, memberIds, description){
  return {id,key,name:name||'TC '+id,description:description||'',type:type||'team',parentId:parentId||null,memberIds:memberIds||[],
    dateCreated:new Date().toISOString(),dateLastModified:new Date().toISOString()};
}

(async () => {
  function log(label, ok, extra){ console.log((ok?'PASS':'FAIL') + ' - ' + label + (extra!==undefined?' :: '+extra:'')); }

  const alice = member('m1','Alice Allen');
  const bob   = member('m2','Bob Baker');
  const carol = member('m3','Carol Clark');

  const parentTeam = tc('tc1','FIX-TEAM-001','Engineering','team',null,['m1','m2']);
  const childTeam  = tc('tc2','FIX-TEAM-002','Backend','team','tc1',['m2','m3'],'Works on the API');
  const committee  = tc('tc3','FIX-COMM-001','Steering Committee','committee',null,['m1'],'High level governance');
  const emptyTeam  = tc('tc4','FIX-TEAM-003','Empty Team','team',null,[]);

  const project = makeProject({
    members:[alice,bob,carol],
    teamsCommittees:[parentTeam,childTeam,committee,emptyTeam]
  });

  const dom = new JSDOM(html, {
    runScripts:'dangerously', resources:'usable', url:'http://localhost/', pretendToBeVisual:true,
    beforeParse(w){ w.localStorage.setItem('kanbanflow_v1_db', JSON.stringify({
      projects:{p1:project}, projectOrder:['p1'], currentProjectId:'p1'
    })); }
  });
  await wait(300);
  const doc = dom.window.document;

  async function search(term){
    doc.getElementById('projectSearchBtn').click();
    await wait(20);
    const input = doc.getElementById('projectSearchInput');
    input.value = term;
    input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
    await wait(250);
  }

  // ── 1. Group appears last ────────────────────────────────────────────────
  await search('Engineering');
  const groupTitles = Array.from(doc.querySelectorAll('.kf-search-group-title')).map(el => el.textContent.trim().replace(/\(\d+\).*$/,'').trim().replace(/^[^\w]*/,'').trim());
  const tcGroupIdx = groupTitles.findIndex(t => t === 'Teams & Committees');
  log('Teams & Committees group appears in results', tcGroupIdx !== -1, groupTitles.join(','));
  log('group appears last', tcGroupIdx === groupTitles.length - 1, tcGroupIdx+' of '+groupTitles.length);
  doc.getElementById('projectSearchClose').click(); await wait(10);

  // ── 2. Title link, type pill, parent, members ────────────────────────────
  await search('Backend');
  const rows = doc.querySelectorAll('.kf-search-result-row[data-result-type="teamsCommittees"]');
  log('searching "Backend" returns exactly one TC result', rows.length === 1, rows.length);
  const backendRow = rows[0];
  log('title link shows team name', backendRow.querySelector('.kf-search-result-link').textContent === 'Backend');
  log('type pill shows "Team"', backendRow.querySelector('.kf-decision-type-pill').textContent === 'Team');
  log('parent "Engineering" is shown', backendRow.textContent.indexOf('Engineering') !== -1);
  log('member Bob Baker is listed', backendRow.textContent.indexOf('Bob Baker') !== -1);
  log('member Carol Clark is listed', backendRow.textContent.indexOf('Carol Clark') !== -1);
  doc.getElementById('projectSearchClose').click(); await wait(10);

  // ── 3. Members sorted alphabetically ────────────────────────────────────
  await search('Backend');
  const backendRow2 = doc.querySelector('.kf-search-result-row[data-result-type="teamsCommittees"]');
  const membersSnippet = Array.from(backendRow2.querySelectorAll('.kf-search-result-snippet')).find(d => d.textContent.indexOf('Members:') !== -1);
  log('members are listed alphabetically (Bob Baker before Carol Clark)',
      membersSnippet.textContent.indexOf('Bob Baker') < membersSnippet.textContent.indexOf('Carol Clark'), membersSnippet.textContent);
  doc.getElementById('projectSearchClose').click(); await wait(10);

  // ── 4. Root-level team shows no parent line ──────────────────────────────
  await search('Engineering');
  const engRow = Array.from(doc.querySelectorAll('.kf-search-result-row[data-result-type="teamsCommittees"]'))
    .find(r => r.querySelector('.kf-search-result-link').textContent === 'Engineering');
  log('Engineering (root-level) shows no "Parent:" line', !engRow.textContent.includes('Parent:'), engRow.textContent.slice(0,120));
  doc.getElementById('projectSearchClose').click(); await wait(10);

  // ── 5. Committee shows "Committee" pill ──────────────────────────────────
  await search('Steering');
  const committeeRow = doc.querySelector('.kf-search-result-row[data-result-type="teamsCommittees"]');
  log('type pill shows "Committee" for a committee', committeeRow.querySelector('.kf-decision-type-pill').textContent === 'Committee');
  doc.getElementById('projectSearchClose').click(); await wait(10);

  // ── 6. Team with no members shows explicit "No members" ─────────────────
  await search('Empty Team');
  const emptyRow = doc.querySelector('.kf-search-result-row[data-result-type="teamsCommittees"]');
  log('a team with no members shows an explicit "No members" note', emptyRow.textContent.indexOf('No members') !== -1);
  doc.getElementById('projectSearchClose').click(); await wait(10);

  // ── 7. Description match shows highlighted snippet ───────────────────────
  await search('governance');
  const govRow = doc.querySelector('.kf-search-result-row[data-result-type="teamsCommittees"]');
  log('a term matching in the description surfaces the TC', !!govRow, govRow && govRow.querySelector('.kf-search-result-link').textContent);
  log('description match includes a highlighted <mark> snippet', govRow && !!govRow.querySelector('mark.kf-search-highlight'));
  doc.getElementById('projectSearchClose').click(); await wait(10);

  // ── 8. Parent name does NOT count as a hit on the child ──────────────────
  await search('Engineering');
  const engNames = Array.from(doc.querySelectorAll('.kf-search-result-row[data-result-type="teamsCommittees"]'))
    .map(r => r.querySelector('.kf-search-result-link').textContent);
  log('searching "Engineering" finds Engineering itself', engNames.includes('Engineering'), engNames.join(','));
  log('searching "Engineering" does NOT return Backend (parent named Engineering, not the team itself)', !engNames.includes('Backend'), engNames.join(','));
  doc.getElementById('projectSearchClose').click(); await wait(10);

  // ── 9. App Settings gating ───────────────────────────────────────────────
  doc.getElementById('appSettingsBtn').click(); await wait(20);
  doc.getElementById('settingsShowTeamsCommitteesBtn').checked = false;
  doc.getElementById('settingsShowTeamsCommitteesBtn').dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  await wait(10);
  doc.getElementById('appSettingsClose').click(); await wait(10);
  await search('Backend');
  log('with TC disabled in App Settings, no TC results appear',
      doc.querySelectorAll('.kf-search-result-row[data-result-type="teamsCommittees"]').length === 0);
  log('the TC group heading is absent',
      !Array.from(doc.querySelectorAll('.kf-search-group-title')).some(el => el.textContent.indexOf('Teams & Committees') !== -1));
  doc.getElementById('projectSearchClose').click(); await wait(10);

  // ── 10. Click-through opens modal directly to edit form ──────────────────
  doc.getElementById('appSettingsBtn').click(); await wait(20);
  doc.getElementById('settingsShowTeamsCommitteesBtn').checked = true;
  doc.getElementById('settingsShowTeamsCommitteesBtn').dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  await wait(10);
  doc.getElementById('appSettingsClose').click(); await wait(10);
  await search('Steering');
  doc.querySelector('.kf-search-result-link[data-result-type="teamsCommittees"]').click();
  await wait(20);
  log('clicking a TC result opens the Teams & Committees modal', !doc.getElementById('teamsCommitteesOverlay').classList.contains('hidden'));
  log('the modal opens directly to the edit form (not the list view)',
      !doc.getElementById('teamsCommitteesFormView').classList.contains('hidden') &&
      doc.getElementById('teamsCommitteesListView').classList.contains('hidden'));
  log('the edit form has the correct team pre-populated', doc.getElementById('tcNameInput').value === 'Steering Committee');

  console.log('\nTeams & Committees in Project Search test complete.');
  process.exit(0);
})().catch(e => { console.error('CRASHED', e); process.exit(1); });
