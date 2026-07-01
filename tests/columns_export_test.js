const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync('../dist/index.html', 'utf8');

class FakeFile { constructor(text){ this._text = text; } }
const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/', pretendToBeVisual: true });
const { window } = dom;
window.FileReader = class {
  readAsText(f){ const s = this; setTimeout(() => { s.result = f._text; if (s.onload) s.onload(); }, 0); }
};
let lastBlobText = null;
window.URL.createObjectURL = () => 'blob://fake';
window.URL.revokeObjectURL = () => {};
const OrigBlob = window.Blob;
window.Blob = function(parts, opts){ lastBlobText = parts[0]; return new OrigBlob(parts, opts); };

function wait(ms){ return new Promise(r => setTimeout(r, ms)); }
async function triggerImport(doc, text){
  const fileInput = doc.getElementById('importFileInput');
  Object.defineProperty(fileInput, 'files', { value: [new FakeFile(text)], configurable: true });
  fileInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(30);
  if(!doc.getElementById('importConflictOverlay').classList.contains('hidden')){
    doc.getElementById('importConflictCopyBtn').click();
    await wait(20);
  }
}
function columnNames(doc){
  return Array.from(doc.querySelectorAll('.kf-column-name')).map(el => el.textContent.trim());
}

(async () => {
  await wait(300);
  const doc = window.document;
  function log(label, ok, extra){ console.log((ok?'PASS':'FAIL') + ' - ' + label + (extra?' :: '+extra:'')); }

  // ── 1. Export includes a top-level `columns` element with order/name/done ──
  doc.getElementById('exportBtn').click();
  await wait(20);
  const exported = JSON.parse(lastBlobText);
  log('export has a top-level columns array', Array.isArray(exported.columns), JSON.stringify(exported.columns));
  log('export columns match seeded board (4)', exported.columns.length === 4, exported.columns.map(c=>c.name).join(','));
  log('exported columns are in board order', exported.columns.map(c=>c.name).join('|') === 'Backlog|To Do|In Progress|Done');
  log('each exported column has an order index', exported.columns.every((c,i) => c.order === i));
  log('"Done" column correctly flagged done:true', exported.columns.find(c=>c.name==='Done').done === true);
  log('non-done columns flagged done:false', exported.columns.filter(c=>c.name!=='Done').every(c => c.done === false));

  // ── 2. Add an EMPTY column, export, confirm it survives ────────────────────
  doc.getElementById('addColumnTopBtn').click(); await wait(10);
  doc.getElementById('columnNameInput').value = 'Icebox';
  doc.getElementById('columnSaveBtn').click(); await wait(20);

  doc.getElementById('exportBtn').click();
  await wait(20);
  const exportedWithEmpty = JSON.parse(lastBlobText);
  log('export now has 5 columns including the empty one', exportedWithEmpty.columns.length === 5, exportedWithEmpty.columns.map(c=>c.name).join(','));
  log('empty column "Icebox" appears in the columns list', exportedWithEmpty.columns.some(c => c.name === 'Icebox'));
  // Confirm no task references it (proving the old task-derived approach would have lost it)
  function collectColumnsFromHierarchy(nodes, set){ (nodes||[]).forEach(n => { set.add(n.column); collectColumnsFromHierarchy(n.subtasks, set); }); }
  const colsReferencedByTasks = new Set();
  collectColumnsFromHierarchy(exportedWithEmpty.hierarchy, colsReferencedByTasks);
  log('Icebox is NOT referenced by any task (proves it would be lost without the columns element)', !colsReferencedByTasks.has('Icebox'), Array.from(colsReferencedByTasks).join(','));

  // ── 3. Import that file and confirm the empty column + order survive ───────
  await triggerImport(doc, lastBlobText);
  const namesAfterImport = columnNames(doc);
  log('imported board has all 5 columns in original order',
      namesAfterImport.join('|') === 'Backlog|To Do|In Progress|Done|Icebox', namesAfterImport.join('|'));
  const iceboxCol = Array.from(doc.querySelectorAll('.kf-column')).find(c => c.textContent.indexOf('Icebox') !== -1);
  const iceboxCount = iceboxCol.querySelector('.kf-count-badge').textContent;
  log('imported Icebox column is empty (0 tasks)', iceboxCount === '0', iceboxCount);

  // ── 4. Reorder columns locally, re-export, confirm new order persists ──────
  // Drag-and-drop is hard to simulate in jsdom; instead verify via direct column reorder through the column modal isn't exposed,
  // so we test the export ordering function directly by building a doc with deliberately shuffled `order` values.
  const shuffledDoc = JSON.parse(JSON.stringify(exportedWithEmpty));
  shuffledDoc.project.key = 'SHUF';
  shuffledDoc.project.name = 'Shuffled Columns Project';
  // Reassign order fields to reverse the column order, independent of array position
  const n = shuffledDoc.columns.length;
  shuffledDoc.columns.forEach((c, i) => { c.order = (n - 1 - i); });
  await triggerImport(doc, JSON.stringify(shuffledDoc));
  const namesAfterShuffle = columnNames(doc);
  log('column UI order follows the `order` field, not array position',
      namesAfterShuffle.join('|') === 'Icebox|Done|In Progress|To Do|Backlog', namesAfterShuffle.join('|'));

  // ── 5. Backward compatibility: file with NO top-level columns element ──────
  const legacyDoc = JSON.parse(JSON.stringify(exported)); // the original 4-column export (no Icebox)
  delete legacyDoc.columns;
  legacyDoc.project.key = 'LEGC';
  legacyDoc.project.name = 'Legacy No Columns Element';
  await triggerImport(doc, JSON.stringify(legacyDoc));
  const namesLegacy = columnNames(doc);
  log('file without a columns element still imports via task-derived fallback',
      namesLegacy.length === 4 && namesLegacy.includes('Backlog') && namesLegacy.includes('Done'), namesLegacy.join('|'));

  // ── 6. Safety net: a task references a column missing from the columns list ─
  const mismatchDoc = JSON.parse(JSON.stringify(exported));
  mismatchDoc.project.key = 'MISM';
  mismatchDoc.project.name = 'Mismatched Columns';
  mismatchDoc.columns = [{ name: 'Backlog', done: false, order: 0 }]; // deliberately incomplete
  // hierarchy still references "To Do", "In Progress", "Done" on various tasks
  await triggerImport(doc, JSON.stringify(mismatchDoc));
  const namesMismatch = columnNames(doc);
  log('columns referenced by tasks but missing from the columns list are still created (no task lost)',
      namesMismatch.includes('To Do') && namesMismatch.includes('In Progress') && namesMismatch.includes('Done'), namesMismatch.join('|'));
  const cardsMismatch = doc.querySelectorAll('.kf-card');
  log('all 5 tasks present despite the incomplete columns list', cardsMismatch.length === 5, cardsMismatch.length);

  console.log('\nColumns export/import test complete.');
  process.exit(0);
})().catch(e => { console.error('CRASHED', e); process.exit(1); });
