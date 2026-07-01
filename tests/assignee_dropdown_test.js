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

  // Seeded Demo Project has 2 members (Riley Chen, Sam Okafor) and 5 tasks.
  const wrap = doc.getElementById('assigneeFilterWrap');
  log('dropdown filter is visible when the project has members', !wrap.classList.contains('kf-vis-hidden'));

  // ── 1. Opening / closing ───────────────────────────────────────────────
  log('panel starts closed', doc.getElementById('assigneeFilterPanel').classList.contains('hidden'));
  doc.getElementById('assigneeFilterBtn').click();
  await wait(10);
  log('panel opens on button click', !doc.getElementById('assigneeFilterPanel').classList.contains('hidden'));
  doc.getElementById('assigneeFilterBtn').click();
  await wait(10);
  log('panel closes on a second button click (toggle)', doc.getElementById('assigneeFilterPanel').classList.contains('hidden'));

  // ── 2. Multi-select: checking two members narrows to the union of their tasks ──
  doc.getElementById('assigneeFilterBtn').click();
  await wait(10);
  let rows = doc.querySelectorAll('#assigneeFilterPanel .kf-dropdown-filter-row');
  log('panel lists 2 members + Unassigned (3 rows)', rows.length === 3, rows.length);

  const rileyRow = Array.from(rows).find(r => r.textContent.indexOf('Riley Chen') !== -1);
  const samRow = Array.from(rows).find(r => r.textContent.indexOf('Sam Okafor') !== -1);
  rileyRow.querySelector('input').checked = true;
  rileyRow.querySelector('input').dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(10);
  // panel was rebuilt — re-query Sam's row
  rows = doc.querySelectorAll('#assigneeFilterPanel .kf-dropdown-filter-row');
  const samRow2 = Array.from(rows).find(r => r.textContent.indexOf('Sam Okafor') !== -1);
  samRow2.querySelector('input').checked = true;
  samRow2.querySelector('input').dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(20);

  // Riley is assigned to 2 tasks, Sam to 1 -> union = 3 tasks visible
  const visibleCards = doc.querySelectorAll('.kf-board .kf-card');
  log('selecting two members shows the union of their tasks (3)', visibleCards.length === 3, visibleCards.length);
  log('dropdown label shows "2 assignees" for multi-select', doc.getElementById('assigneeFilterLabel').textContent === '2 assignees', doc.getElementById('assigneeFilterLabel').textContent);
  log('dropdown button gets the active style', doc.getElementById('assigneeFilterWrap').classList.contains('active'));

  // ── 3. "Unassigned" can be combined with member selections too ──────────
  rows = doc.querySelectorAll('#assigneeFilterPanel .kf-dropdown-filter-row');
  const unassignedRow = Array.from(rows).find(r => r.textContent.indexOf('Unassigned') !== -1);
  unassignedRow.querySelector('input').checked = true;
  unassignedRow.querySelector('input').dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(20);
  // Riley(2) + Sam(1) + Unassigned(2: Research + README) = 5 (the whole seeded board)
  const visibleAfterUnassigned = doc.querySelectorAll('.kf-board .kf-card');
  log('adding "Unassigned" to the selection includes unassigned tasks too', visibleAfterUnassigned.length === 5, visibleAfterUnassigned.length);
  log('dropdown label shows "3 assignees" with all three checked', doc.getElementById('assigneeFilterLabel').textContent === '3 assignees', doc.getElementById('assigneeFilterLabel').textContent);

  // ── 4. "Clear selection" resets everything in one click ─────────────────
  const clearBtn = doc.querySelector('#assigneeFilterPanel .kf-dropdown-filter-clear');
  log('a "Clear selection" control appears once something is selected', !!clearBtn);
  clearBtn.click();
  await wait(20);
  log('clear selection restores the full board', doc.querySelectorAll('.kf-board .kf-card').length === 5);
  log('label resets to "Assignee" after clearing', doc.getElementById('assigneeFilterLabel').textContent === 'Assignee');
  log('"Clear selection" disappears once nothing is selected', !doc.querySelector('#assigneeFilterPanel .kf-dropdown-filter-clear'));

  // ── 5. Escape key closes the open panel ──────────────────────────────────
  doc.getElementById('assigneeFilterBtn').click();
  await wait(10);
  log('panel open before Escape', !doc.getElementById('assigneeFilterPanel').classList.contains('hidden'));
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await wait(10);
  log('Escape closes the assignee filter panel', doc.getElementById('assigneeFilterPanel').classList.contains('hidden'));

  // ── 6. Switching to a project with no members hides the whole control ────
  doc.getElementById('newProjectBtn').click();
  await wait(10);
  doc.getElementById('projectNameInput').value = 'No Members Project';
  doc.getElementById('projectKeyInput').value = 'NMP';
  doc.getElementById('projectSaveBtn').click();
  await wait(20);
  log('dropdown filter is hidden for a project with zero members',
      doc.getElementById('assigneeFilterWrap').classList.contains('kf-vis-hidden'));

  console.log('\nAssignee dropdown filter test complete.');
  process.exit(0);
})().catch(e => { console.error('CRASHED', e); process.exit(1); });
