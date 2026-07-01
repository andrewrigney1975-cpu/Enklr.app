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
  function log(label, ok, extra){ console.log((ok?'PASS':'FAIL') + ' - ' + label + (extra!==undefined?' :: '+extra:'')); }

  // ── 1. Header button positioning ──────────────────────────────────────────
  {
    const dom = loadFixture(baseProject());
    await wait(300);
    const doc = dom.window.document;
    const btn = doc.getElementById('projectSearchBtn');
    log('Project Search button exists', !!btn);
    const picker = btn.parentElement;
    const order = Array.from(picker.children).map(el => el.id);
    log('button is immediately to the right of the project picker <select>', order.indexOf('projectSearchBtn') === order.indexOf('projectSelect') + 1, order.join(','));

    btn.click();
    await wait(20);
    log('clicking it opens the Project Search modal', !doc.getElementById('projectSearchOverlay').classList.contains('hidden'));
    log('modal is titled "Project Search"', doc.querySelector('#projectSearchOverlay h2').textContent === 'Project Search');
    log('modal uses the large modal size', doc.querySelector('#projectSearchOverlay .kf-modal').classList.contains('kf-modal-lg'));

    doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(10);
    log('Escape closes the modal', doc.getElementById('projectSearchOverlay').classList.contains('hidden'));
  }

  // ── 2. Minimum 2 characters before results show ───────────────────────────
  {
    const project = baseProject({ tasks: { t1: task('t1', 'col_todo', { title: 'Deploy to production' }) } });
    const dom = loadFixture(project);
    await wait(300);
    const doc = dom.window.document;
    doc.getElementById('projectSearchBtn').click();
    await wait(20);
    const input = doc.getElementById('projectSearchInput');

    input.value = 'd';
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await wait(250);
    log('a single character shows the "type at least 2" message, not results', doc.getElementById('projectSearchResults').textContent.indexOf('at least 2 characters') !== -1);

    input.value = 'de';
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await wait(250);
    log('2 characters is enough to show real results', doc.getElementById('projectSearchResults').textContent.indexOf('Deploy to production') !== -1);
  }

  // ── 3. Field-by-field search coverage for every entity type ───────────────
  {
    const now = Date.now();
    const project = baseProject({
      tasks: {
        t1: task('t1', 'col_todo', { title: 'Normal task' }),
        t2: task('t2', 'col_todo', { title: 'Other', description: 'mentions zzkeyword here' }),
        t3: task('t3', 'col_done', { title: 'Archived match zzkeyword', archived: true })
      },
      members: [
        { id: 'm1', name: 'Alice zzkeyword', color: '#111', role: null },
        { id: 'm2', name: 'Bob', color: '#222', role: 'zzkeyword Engineer' }
      ],
      principles: [
        { id: 'p1', key: 'FIX-PRIN-001', title: 'Has zzkeyword in title', description: '', documentUrl: null, dateCreated: new Date().toISOString(), dateLastModified: new Date().toISOString() },
        { id: 'p2', key: 'FIX-PRIN-002', title: 'Link match', description: '', documentUrl: 'https://example.com/zzkeyword', dateCreated: new Date().toISOString(), dateLastModified: new Date().toISOString() }
      ],
      objectives: [
        { id: 'o1', key: 'FIX-OBJ-001', title: 'Objective zzkeyword', description: '', principleIds: [], dateCreated: new Date().toISOString(), dateLastModified: new Date().toISOString() }
      ],
      documents: [
        { id: 'd1', key: 'FIX-DOC-001', title: 'Doc title', url: 'https://zzkeyword.example.com', description: '', ownerId: null, taskId: null, relatedDocumentIds: [], dateCreated: new Date().toISOString(), dateLastModified: new Date().toISOString() }
      ],
      risks: [
        { id: 'k1', key: 'FIX-RISK-001', title: 'Risk title', description: '', likelihood: 1, impact: 1, mitigations: 'mitigation mentions zzkeyword', ownerId: null, taskId: null, documentIds: [], principleIds: [], objectiveIds: [], status: 'new', dateToClose: null, dateClosed: null, dateCreated: new Date().toISOString(), dateLastModified: new Date().toISOString() }
      ],
      decisions: [
        { id: 'dec1', key: 'FIX-DEC-001', title: 'Decision title', description: '', type: 'strategy', status: 'open', outcome: 'outcome has zzkeyword', ownerId: null, approver: null, taskId: null, documentIds: [], riskIds: [], principleIds: [], objectiveIds: [], dateCreated: new Date().toISOString(), dateLastModified: new Date().toISOString() }
      ]
    });
    const dom = loadFixture(project);
    await wait(300);
    const doc = dom.window.document;
    doc.getElementById('projectSearchBtn').click();
    await wait(20);
    const input = doc.getElementById('projectSearchInput');
    input.value = 'zzkeyword';
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await wait(250);
    const resultsText = doc.getElementById('projectSearchResults').textContent;

    log('finds a task matching via Description field', resultsText.indexOf('Other') !== -1);
    log('finds a task matching via Title field, even when archived', resultsText.indexOf('Archived match zzkeyword') !== -1);
    log('finds a member matching via Name', resultsText.indexOf('Alice zzkeyword') !== -1);
    log('finds a member matching via Role', resultsText.indexOf('Bob') !== -1);
    log('finds a principle matching via title', resultsText.indexOf('Has zzkeyword in title') !== -1);
    log('finds a principle matching via its document link', resultsText.indexOf('Link match') !== -1);
    log('finds an objective matching via title', resultsText.indexOf('Objective zzkeyword') !== -1);
    log('finds a document matching via URL', resultsText.indexOf('Doc title') !== -1);
    log('finds a risk matching via Mitigations', resultsText.indexOf('Risk title') !== -1);
    log('finds a decision matching via Outcome', resultsText.indexOf('Decision title') !== -1);

    // Archived task visual marking
    const archivedRow = Array.from(doc.querySelectorAll('.kf-search-result-row')).find(r => r.textContent.indexOf('Archived match zzkeyword') !== -1);
    log('the archived task\u2019s result row shows an "Archived" badge', archivedRow.querySelector('.kf-search-archived-badge') !== null);
    const normalRow = Array.from(doc.querySelectorAll('.kf-search-result-row')).find(r => r.textContent.indexOf('Other') !== -1 && r.getAttribute('data-result-type') === 'tasks');
    log('a non-archived task\u2019s row has no "Archived" badge', normalRow.querySelector('.kf-search-archived-badge') === null);
  }

  // ── 4. One row per item, even with multiple matching fields ──────────────
  {
    const project = baseProject({
      tasks: { t1: task('t1', 'col_todo', { title: 'duplicate duplicate', description: 'duplicate again' }) }
    });
    const dom = loadFixture(project);
    await wait(300);
    const doc = dom.window.document;
    doc.getElementById('projectSearchBtn').click();
    await wait(20);
    const input = doc.getElementById('projectSearchInput');
    input.value = 'duplicate';
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await wait(250);
    const rows = doc.querySelectorAll('.kf-search-result-row[data-result-type="tasks"]');
    log('a task matching in BOTH title and description produces exactly ONE result row, not two', rows.length === 1, rows.length);
    log('the snippet uses the TITLE field (higher priority), not the description', !rows[0].querySelector('.kf-search-result-field-label'));
  }

  // ── 5. Snippet highlighting, escaping, and short-field-shows-in-full ─────
  {
    const longDesc = 'a'.repeat(80) + 'NEEDLE' + 'b'.repeat(80);
    const project = baseProject({
      tasks: {
        t1: task('t1', 'col_todo', { title: 'short title NEEDLE', description: '' }),
        t2: task('t2', 'col_todo', { title: 'Long desc task', description: longDesc }),
        t3: task('t3', 'col_todo', { title: '<script>alert(1)</script> NEEDLE', description: '' })
      }
    });
    const dom = loadFixture(project);
    await wait(300);
    const doc = dom.window.document;
    doc.getElementById('projectSearchBtn').click();
    await wait(20);
    const input = doc.getElementById('projectSearchInput');
    input.value = 'NEEDLE';
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await wait(250);

    const shortRow = Array.from(doc.querySelectorAll('.kf-search-result-row')).find(r => r.textContent.indexOf('short title') !== -1);
    log('a short field renders its snippet in full (no leading ellipsis)', shortRow.querySelector('.kf-search-result-snippet').textContent.indexOf('\u2026') === -1);
    log('the matched term is wrapped in a <mark class="kf-search-highlight">', !!shortRow.querySelector('mark.kf-search-highlight'));
    log('the highlighted text is exactly the matched term', shortRow.querySelector('mark.kf-search-highlight').textContent === 'NEEDLE');

    const longRow = Array.from(doc.querySelectorAll('.kf-search-result-row')).find(r => r.textContent.indexOf('Long desc task') !== -1);
    const longSnippetText = longRow.querySelector('.kf-search-result-snippet').textContent;
    log('a long field\u2019s snippet is windowed with an ellipsis (not the full 166-char string)', longSnippetText.indexOf('\u2026') !== -1 && longSnippetText.length < longDesc.length);

    const xssRow = Array.from(doc.querySelectorAll('.kf-search-result-row')).find(r => r.getAttribute('data-result-id') === 't3');
    log('a title containing literal <script> tags is escaped, not rendered as markup', xssRow.querySelectorAll('script').length === 0 && xssRow.innerHTML.indexOf('&lt;script&gt;') !== -1);
  }

  // ── 6. App Settings gating ────────────────────────────────────────────────
  {
    const project = baseProject({
      principles: [{ id: 'p1', key: 'FIX-PRIN-001', title: 'Gateable principle ZQX', description: '', documentUrl: null, dateCreated: new Date().toISOString(), dateLastModified: new Date().toISOString() }],
      risks: [{ id: 'k1', key: 'FIX-RISK-001', title: 'Gateable risk ZQX', description: '', likelihood: 1, impact: 1, mitigations: '', ownerId: null, taskId: null, documentIds: [], principleIds: [], objectiveIds: [], status: 'new', dateToClose: null, dateClosed: null, dateCreated: new Date().toISOString(), dateLastModified: new Date().toISOString() }],
      tasks: { t1: task('t1', 'col_todo', { title: 'Always visible ZQX' }) }
    });
    const dom = loadFixture(project);
    await wait(300);
    const doc = dom.window.document;

    doc.getElementById('appSettingsBtn').click();
    await wait(20);
    doc.getElementById('settingsShowPrinciplesBtn').checked = false;
    doc.getElementById('settingsShowPrinciplesBtn').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await wait(10);
    doc.getElementById('appSettingsClose').click();
    await wait(10);

    doc.getElementById('projectSearchBtn').click();
    await wait(20);
    const input = doc.getElementById('projectSearchInput');
    input.value = 'ZQX';
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await wait(250);
    let resultsText = doc.getElementById('projectSearchResults').textContent;
    log('with Principles disabled in App Settings, the matching Principle does NOT appear', resultsText.indexOf('Gateable principle ZQX') === -1);
    log('Risks (still enabled) still appears', resultsText.indexOf('Gateable risk ZQX') !== -1);
    log('Tasks (always on) still appears regardless of App Settings', resultsText.indexOf('Always visible ZQX') !== -1);
  }

  // ── 7. Top 8 per group + "+N more" note ───────────────────────────────────
  {
    const tasks = {};
    for(let i = 0; i < 12; i++){
      tasks['t' + i] = task('t' + i, 'col_todo', { title: 'Capped item ' + i, key: 'FIX-' + String(i).padStart(3, '0') });
    }
    const project = baseProject({ tasks });
    const dom = loadFixture(project);
    await wait(300);
    const doc = dom.window.document;
    doc.getElementById('projectSearchBtn').click();
    await wait(20);
    const input = doc.getElementById('projectSearchInput');
    input.value = 'Capped item';
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await wait(250);
    const rows = doc.querySelectorAll('.kf-search-result-row[data-result-type="tasks"]');
    log('exactly 8 rows are shown even though 12 tasks match', rows.length === 8, rows.length);
    log('a "+4 more" note appears for the remaining tasks', doc.getElementById('projectSearchResults').textContent.indexOf('+4 more') !== -1);
    log('the group heading shows the TRUE total count (12), not just the capped 8', doc.querySelector('.kf-search-group-title').textContent.indexOf('12') !== -1);
  }

  // ── 8. Click-through navigation opens the correct modal/form per type ────
  {
    const project = baseProject({
      tasks: { t1: task('t1', 'col_todo', { title: 'Navigable task XQZ' }) },
      risks: [{ id: 'k1', key: 'FIX-RISK-001', title: 'Navigable risk XQZ', description: '', likelihood: 1, impact: 1, mitigations: '', ownerId: null, taskId: null, documentIds: [], principleIds: [], objectiveIds: [], status: 'new', dateToClose: null, dateClosed: null, dateCreated: new Date().toISOString(), dateLastModified: new Date().toISOString() }]
    });
    const dom = loadFixture(project);
    await wait(300);
    const doc = dom.window.document;
    doc.getElementById('projectSearchBtn').click();
    await wait(20);
    let input = doc.getElementById('projectSearchInput');
    input.value = 'Navigable task';
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await wait(250);
    doc.querySelector('.kf-search-result-link[data-result-type="tasks"]').click();
    await wait(20);
    log('clicking a Task result closes Project Search and opens the Task modal', doc.getElementById('projectSearchOverlay').classList.contains('hidden') && !doc.getElementById('taskOverlay').classList.contains('hidden'));
    log('the correct task\u2019s title is loaded into the task form', doc.getElementById('taskTitleInput').value === 'Navigable task XQZ');
    doc.getElementById('taskCancelBtn').click();
    await wait(10);

    doc.getElementById('projectSearchBtn').click();
    await wait(20);
    input = doc.getElementById('projectSearchInput');
    input.value = 'Navigable risk';
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await wait(250);
    doc.querySelector('.kf-search-result-link[data-result-type="risks"]').click();
    await wait(20);
    log('clicking a Risk result opens the Risks modal directly to that risk\u2019s edit form', !doc.getElementById('risksOverlay').classList.contains('hidden') && doc.getElementById('riskTitleInput').value === 'Navigable risk XQZ');
  }

  // ── 9. Empty states ───────────────────────────────────────────────────────
  {
    const project = baseProject({ tasks: { t1: task('t1', 'col_todo', { title: 'Something' }) } });
    const dom = loadFixture(project);
    await wait(300);
    const doc = dom.window.document;
    doc.getElementById('projectSearchBtn').click();
    await wait(20);
    log('with no query typed yet, the prompt to type 2+ characters is shown', doc.getElementById('projectSearchResults').textContent.indexOf('at least 2 characters') !== -1);

    const input = doc.getElementById('projectSearchInput');
    input.value = 'nonexistentqueryxyz';
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await wait(250);
    log('a real query matching nothing anywhere shows an explicit "No results" message', doc.getElementById('projectSearchResults').textContent.indexOf('No results') !== -1);
  }

  console.log('\nProject Search test complete.');
  process.exit(0);
})().catch(e => { console.error('CRASHED', e); process.exit(1); });
