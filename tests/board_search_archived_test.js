const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync('../dist/index.html', 'utf8');
function wait(ms){ return new Promise(r => setTimeout(r, ms)); }

/* Covers the board toolbar's "Search tasks..." box surfacing archived tasks it can never actually
   filter onto the board itself (archived tasks are always excluded from rendering, board.js's
   renderColumn) — the "Matching Archived Tasks" panel (board-filters.js's
   updateArchivedSearchMatchesPanel) lists any archived task whose key/title/description matches
   the current search term, key ASC, key/title/priority like the Archived Tasks modal's own list,
   with the key as a real "#!/KEY" hashbang link that opens the task via features/hash-router.js. */

(async () => {
  const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;
  await wait(300);
  const doc = window.document;
  function log(label, ok, extra){ console.log((ok?'PASS':'FAIL') + ' - ' + label + (extra !== undefined ? ' :: ' + extra : '')); }

  async function addTask(title){
    doc.querySelectorAll('.kf-add-task-btn')[0].click();
    await wait(20);
    doc.getElementById('taskTitleInput').value = title;
    doc.getElementById('taskSaveBtn').click();
    await wait(20);
  }
  function findCardByTitle(title){
    return Array.from(doc.querySelectorAll('.kf-card')).find(c => c.textContent.indexOf(title) !== -1);
  }
  async function archiveTaskByTitle(title){
    const card = findCardByTitle(title);
    card.click();
    await wait(10);
    doc.getElementById('taskArchivedCheckbox').checked = true;
    doc.getElementById('taskSaveBtn').click();
    await wait(20);
  }

  await addTask('Findable widget refactor');
  await addTask('Another findable widget task');
  await addTask('Unrelated task');
  await archiveTaskByTitle('Findable widget refactor');
  await archiveTaskByTitle('Another findable widget task');

  const raw = JSON.parse(window.localStorage.getItem('kanbanflow_v1_db'));
  const proj = raw.projects[raw.currentProjectId];
  const t1Id = Object.keys(proj.tasks).find(id => proj.tasks[id].title === 'Findable widget refactor');
  const t2Id = Object.keys(proj.tasks).find(id => proj.tasks[id].title === 'Another findable widget task');
  const t1Key = proj.tasks[t1Id].key, t2Key = proj.tasks[t2Id].key;
  const expectedFirstKey = [t1Key, t2Key].sort((a, b) => a.localeCompare(b, undefined, {numeric: true}))[0];

  const searchInput = doc.getElementById('searchInput');
  const panel = doc.getElementById('archivedSearchMatchesPanel');

  // ── 1. Panel starts hidden with no search term ──
  log('archived-matches panel starts hidden', panel.classList.contains('hidden'));

  // ── 2. Typing a term matching only NON-archived tasks: panel stays hidden ──
  searchInput.value = 'Unrelated';
  searchInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  await wait(10);
  log('no archived matches -> panel stays hidden', panel.classList.contains('hidden'));

  // ── 3. Typing a term matching BOTH archived tasks shows the panel ──
  searchInput.value = 'widget';
  searchInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  await wait(10);
  log('panel opens with a "Matching Archived Tasks" title', !panel.classList.contains('hidden') && panel.textContent.indexOf('Matching Archived Tasks') !== -1, panel.textContent);
  log('panel lists both matching archived tasks', panel.textContent.indexOf('Findable widget refactor') !== -1 && panel.textContent.indexOf('Another findable widget task') !== -1);

  const rows = panel.querySelectorAll('.kf-archived-row');
  log('exactly 2 rows rendered', rows.length === 2, rows.length);

  const links = panel.querySelectorAll('.kf-archived-row a');
  log('each row\'s key is a real anchor with an "#!/KEY" href', links.length === 2 && Array.from(links).every(a => a.getAttribute('href').indexOf('#!/') === 0));

  const rowKeys = Array.from(rows).map(r => r.querySelector('a').textContent);
  log('rows are sorted by key ascending', rowKeys[0] === expectedFirstKey, JSON.stringify(rowKeys));

  log('each row shows a priority pill', panel.querySelectorAll('.kf-priority-pill').length === 2);

  // ── 4. Archived tasks matching the search term still never appear on the board itself ──
  log('the archived tasks are NOT rendered as board cards even though they match the search', !findCardByTitle('Findable widget refactor') && !findCardByTitle('Another findable widget task'));

  // ── 5. Clicking a key link opens the task via the hashbang route ──
  const firstLink = links[0];
  firstLink.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await wait(30);
  log('clicking the key link opens the task modal', !doc.getElementById('taskOverlay').classList.contains('hidden'));
  log('the opened task is the one whose key was clicked', doc.getElementById('taskTitleInput').value.indexOf('widget') !== -1, doc.getElementById('taskTitleInput').value);
  doc.getElementById('taskCancelBtn').click();
  await wait(10);

  // ── 6. Clearing the search hides the panel again ──
  doc.getElementById('searchClearBtn').click();
  await wait(10);
  log('clearing the search hides the panel', panel.classList.contains('hidden'));

  console.log('\nBoard search archived-matches test complete.');
  process.exit(0);
})().catch(e => {
  console.error('BOARD SEARCH ARCHIVED TEST CRASHED:', e);
  process.exit(1);
});
