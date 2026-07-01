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

  doc.getElementById('documentsBtn').click();
  await wait(20);

  doc.getElementById('addDocumentBtn').click();
  await wait(10);
  doc.getElementById('documentTitleInput').value = 'Doc A';
  doc.getElementById('documentFormSaveBtn').click();
  await wait(20);

  doc.getElementById('addDocumentBtn').click();
  await wait(10);
  doc.getElementById('documentTitleInput').value = 'Doc B';
  doc.getElementById('documentFormSaveBtn').click();
  await wait(20);

  doc.getElementById('addDocumentBtn').click();
  await wait(10);
  doc.getElementById('documentTitleInput').value = 'Doc C';
  doc.getElementById('documentFormSaveBtn').click();
  await wait(20);

  doc.getElementById('addDocumentBtn').click();
  await wait(10);
  let pickerCheckboxes = doc.querySelectorAll('#documentRelatedPicker input[type=checkbox]');
  log('related-document picker lists all 3 existing documents for a brand-new one', pickerCheckboxes.length === 3, pickerCheckboxes.length);
  doc.getElementById('documentFormCancelBtn').click();
  await wait(10);

  const docARow = Array.from(doc.querySelectorAll('.kf-release-row')).find(r => r.textContent.indexOf('Doc A') !== -1);
  docARow.click();
  await wait(10);
  pickerCheckboxes = doc.querySelectorAll('#documentRelatedPicker input[type=checkbox]');
  log('editing Doc A: picker excludes Doc A itself (only 2 other documents shown)', pickerCheckboxes.length === 2, pickerCheckboxes.length);
  log('picker does not include Doc A as an option', doc.getElementById('documentRelatedPicker').textContent.indexOf('Doc A') === -1);
  log('picker includes Doc B and Doc C', doc.getElementById('documentRelatedPicker').textContent.indexOf('Doc B') !== -1 &&
      doc.getElementById('documentRelatedPicker').textContent.indexOf('Doc C') !== -1);

  pickerCheckboxes.forEach(cb => { cb.checked = true; });
  doc.getElementById('documentFormSaveBtn').click();
  await wait(20);

  let raw = JSON.parse(window.localStorage.getItem('kanbanflow_v1_db'));
  let proj = raw.projects[raw.currentProjectId];
  let docA = proj.documents.find(d => d.title === 'Doc A');
  const docB = proj.documents.find(d => d.title === 'Doc B');
  const docC = proj.documents.find(d => d.title === 'Doc C');
  log('Doc A\u2019s relatedDocumentIds persisted with both selections', docA.relatedDocumentIds.length === 2, JSON.stringify(docA.relatedDocumentIds));
  log('relatedDocumentIds correctly reference Doc B and Doc C',
      docA.relatedDocumentIds.includes(docB.id) && docA.relatedDocumentIds.includes(docC.id));

  log('the relationship is one-directional (Doc B has no relatedDocumentIds back to Doc A)', docB.relatedDocumentIds.length === 0, JSON.stringify(docB.relatedDocumentIds));

  const docARowAgain = Array.from(doc.querySelectorAll('.kf-release-row')).find(r => r.textContent.indexOf('Doc A') !== -1);
  log('list view shows "2 related" for Doc A', docARowAgain.textContent.indexOf('2 related') !== -1, docARowAgain.textContent);

  docARowAgain.click();
  await wait(10);
  const reopenedCheckboxes = Array.from(doc.querySelectorAll('#documentRelatedPicker input[type=checkbox]'));
  log('reopening Doc A shows both related documents still checked', reopenedCheckboxes.every(cb => cb.checked));
  doc.getElementById('documentFormCancelBtn').click();
  await wait(10);

  const docBRow = Array.from(doc.querySelectorAll('.kf-release-row')).find(r => r.textContent.indexOf('Doc B') !== -1);
  docBRow.click();
  await wait(10);
  doc.getElementById('deleteDocumentBtn').click();
  await wait(10);
  doc.getElementById('confirmOkBtn').click();
  await wait(20);

  raw = JSON.parse(window.localStorage.getItem('kanbanflow_v1_db'));
  proj = raw.projects[raw.currentProjectId];
  docA = proj.documents.find(d => d.title === 'Doc A');
  log('Doc A survives Doc B\u2019s deletion', !!docA);
  log('Doc A\u2019s relatedDocumentIds no longer references the deleted Doc B', !docA.relatedDocumentIds.includes(docB.id) && docA.relatedDocumentIds.length === 1, JSON.stringify(docA.relatedDocumentIds));
  log('Doc A\u2019s relatedDocumentIds still references Doc C', docA.relatedDocumentIds.includes(docC.id));

  const legacyDB = {
    projects: {
      legacy_p1: {
        id: 'legacy_p1', name: 'Legacy Project', key: 'LEG', taskCounter: 1,
        columns: [{ id: 'col1', name: 'To Do', done: false, order: [] }],
        tasks: {},
        members: [], releases: [], taskTypes: [], startDate: null, endDate: null,
        dateCreated: '2025-01-01T00:00:00.000Z', dateLastModified: '2025-01-01T00:00:00.000Z', dateLastExported: null,
        documents: [
          { id: 'd1', key: 'LEG-DOC-001', title: 'Old doc', dateCreated: '2025-01-01T00:00:00.000Z', dateLastModified: '2025-01-01T00:00:00.000Z' }
        ],
        docCounter: 2, risks: [], riskCounter: 1, decisions: [], decCounter: 1, approvers: []
      }
    },
    projectOrder: ['legacy_p1'], currentProjectId: 'legacy_p1'
  };
  const dom2 = new JSDOM(html, {
    runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/', pretendToBeVisual: true,
    beforeParse(w){ w.localStorage.setItem('kanbanflow_v1_db', JSON.stringify(legacyDB)); }
  });
  await wait(350);
  const raw2 = JSON.parse(dom2.window.localStorage.getItem('kanbanflow_v1_db'));
  const legacyDoc = raw2.projects.legacy_p1.documents[0];
  log('migration backfills relatedDocumentIds as an empty array for a legacy document missing it',
      Array.isArray(legacyDoc.relatedDocumentIds) && legacyDoc.relatedDocumentIds.length === 0, JSON.stringify(legacyDoc.relatedDocumentIds));

  console.log('\nDocument-to-Document related picker test complete.');
  process.exit(0);
})().catch(e => { console.error('CRASHED', e); process.exit(1); });
