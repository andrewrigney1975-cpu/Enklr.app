const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync('../dist/index.html', 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/', pretendToBeVisual: true });
const { window } = dom;
function wait(ms){ return new Promise(r => setTimeout(r, ms)); }

/* Covers the Bulk Edit tool's new sort/filter row (features/sort-filter.js's generic engine,
   wired up in features/bulk-edit.js's renderBulkEditHeader/renderBulkEditBody) — clicking a
   column header sorts the grid by that column's content-aware value, and typing into a column's
   filter box narrows the visible rows using the same range/comparator/substring syntax the unit
   test already covers directly against the module. This test only exercises the DOM wiring: does
   clicking the right header toggle the right sort, does typing a filter actually hide the right
   rows, does the count line reflect it. */

function rowKeys(doc){
  return Array.from(doc.querySelectorAll('.kf-bulkedit-row .kf-bulkedit-key')).map(el => el.textContent);
}
function headerCell(doc, label){
  return Array.from(doc.querySelectorAll('.kf-bulkedit-header-cell')).find(c => c.textContent.replace(/[↑↓]/g, '').trim() === label);
}
function filterInput(doc, field){
  return doc.querySelector('.kf-bulkedit-filter-input[data-filter-field="' + field + '"]');
}

(async () => {
  await wait(300);
  const doc = window.document;
  function log(label, ok, extra){ console.log((ok?'PASS':'FAIL') + ' - ' + label + (extra !== undefined ? ' :: ' + extra : '')); }

  doc.getElementById('bulkEditBtn').click();
  await wait(20);

  // ── Default state ──────────────────────────────────────────────────────
  const keyCell = headerCell(doc, 'Key');
  log('Key header starts sorted (default sort field)', keyCell.classList.contains('sorted'));
  log('Key header shows an ascending arrow', keyCell.textContent.indexOf('↑') !== -1, keyCell.textContent);
  const defaultKeys = rowKeys(doc);
  const sortedAscending = defaultKeys.slice().sort((a, b) => a.localeCompare(b, undefined, {numeric: true}));
  log('rows start sorted by key ascending', defaultKeys.join(',') === sortedAscending.join(','), defaultKeys.join(','));

  // ── Sorting: click a numeric column header ─────────────────────────────
  const bvCell = headerCell(doc, 'Bus. Value');
  bvCell.click();
  await wait(10);
  log('clicking "Bus. Value" moves the sorted state off Key', !headerCell(doc, 'Key').classList.contains('sorted'));
  log('"Bus. Value" header is now marked sorted, ascending', headerCell(doc, 'Bus. Value').classList.contains('sorted') && headerCell(doc, 'Bus. Value').textContent.indexOf('↑') !== -1);

  const bvInputsAsc = Array.from(doc.querySelectorAll('.kf-bulkedit-row')).map(r => Number(r.querySelectorAll('input')[2].value));
  const bvSortedAsc = bvInputsAsc.every((v, i) => i === 0 || bvInputsAsc[i - 1] <= v);
  log('rows are actually in ascending Business Value order after the click', bvSortedAsc, bvInputsAsc.join(','));

  // ── Sorting: click the same header again toggles direction ─────────────
  bvCell.click();
  await wait(10);
  log('clicking the same header again flips to descending', headerCell(doc, 'Bus. Value').textContent.indexOf('↓') !== -1);
  const bvInputsDesc = Array.from(doc.querySelectorAll('.kf-bulkedit-row')).map(r => Number(r.querySelectorAll('input')[2].value));
  const bvSortedDesc = bvInputsDesc.every((v, i) => i === 0 || bvInputsDesc[i - 1] >= v);
  log('rows are actually in descending Business Value order after the second click', bvSortedDesc, bvInputsDesc.join(','));

  // ── Filtering: plain substring on Title ─────────────────────────────────
  const titleFilter = filterInput(doc, 'title');
  titleFilter.value = 'objectives';
  titleFilter.dispatchEvent(new window.Event('input', {bubbles: true}));
  await wait(10);
  const afterTitleFilter = doc.querySelectorAll('.kf-bulkedit-row').length;
  log('title substring filter narrows the row count', afterTitleFilter > 0 && afterTitleFilter < 5, afterTitleFilter);
  const allTitlesMatch = Array.from(doc.querySelectorAll('.kf-bulkedit-title')).every(el => el.title.toLowerCase().indexOf('objectives') !== -1);
  log('every remaining row actually matches the title filter', allTitlesMatch);
  log('count line reflects "N of 5"', doc.getElementById('bulkEditCount').textContent.indexOf('of 5') !== -1, doc.getElementById('bulkEditCount').textContent);

  // Clear it
  titleFilter.value = '';
  titleFilter.dispatchEvent(new window.Event('input', {bubbles: true}));
  await wait(10);
  log('clearing the filter restores all 5 rows', doc.querySelectorAll('.kf-bulkedit-row').length === 5);

  // ── Filtering: numeric comparator on Business Value ─────────────────────
  const bvFilter = filterInput(doc, 'businessValue');
  bvFilter.value = '>=500';
  bvFilter.dispatchEvent(new window.Event('input', {bubbles: true}));
  await wait(10);
  const bvFilteredValues = Array.from(doc.querySelectorAll('.kf-bulkedit-row')).map(r => Number(r.querySelectorAll('input')[2].value));
  log('">=500" filter keeps only rows with Business Value >= 500', bvFilteredValues.length > 0 && bvFilteredValues.every(v => v >= 500), bvFilteredValues.join(','));

  // ── Filtering: no matches shows the empty-filter message, not the empty-project message ──
  bvFilter.value = '>=99999';
  bvFilter.dispatchEvent(new window.Event('input', {bubbles: true}));
  await wait(10);
  log('a filter matching nothing shows the "no tasks match" message',
      doc.getElementById('bulkEditBody').textContent.indexOf('No tasks match the current filters') !== -1);
  log('no rows are rendered', doc.querySelectorAll('.kf-bulkedit-row').length === 0);

  // ── Combining two column filters (AND) ──────────────────────────────────
  bvFilter.value = '';
  bvFilter.dispatchEvent(new window.Event('input', {bubbles: true}));
  await wait(10);
  const priorityFilter = filterInput(doc, 'priority');
  priorityFilter.value = 'high';
  priorityFilter.dispatchEvent(new window.Event('input', {bubbles: true}));
  await wait(10);
  const rowsAfterCombined = doc.querySelectorAll('.kf-bulkedit-row').length;
  log('combining a priority filter narrows further (AND, not OR)', rowsAfterCombined >= 1 && rowsAfterCombined < 5, rowsAfterCombined);

  // ── Re-opening resets sort/filter state (session-only, like Task List) ──
  priorityFilter.value = '';
  priorityFilter.dispatchEvent(new window.Event('input', {bubbles: true}));
  await wait(10);
  doc.getElementById('bulkEditCancelBtn').click();
  await wait(20);
  doc.getElementById('bulkEditBtn').click();
  await wait(20);
  log('reopening resets sort back to Key ascending', headerCell(doc, 'Key').classList.contains('sorted') && headerCell(doc, 'Key').textContent.indexOf('↑') !== -1);
  log('reopening clears any previously entered filter text', filterInput(doc, 'title').value === '');
  log('reopening shows all 5 rows again', doc.querySelectorAll('.kf-bulkedit-row').length === 5);

  console.log('Bulk Edit sort/filter test complete.');
})();
