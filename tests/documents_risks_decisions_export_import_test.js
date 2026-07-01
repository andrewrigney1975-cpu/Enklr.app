const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync('../dist/index.html', 'utf8');

class FakeFile { constructor(text){ this._text = text; } }
function installFakeFileReader(window){
  window.FileReader = class {
    readAsText(f){ const s = this; setTimeout(() => { s.result = f._text; if (s.onload) s.onload(); }, 0); }
  };
}
function wait(ms){ return new Promise(r => setTimeout(r, ms)); }

(async () => {
  let lastBlobText = null;
  const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;
  installFakeFileReader(window);
  window.URL.createObjectURL = () => 'blob://fake';
  window.URL.revokeObjectURL = () => {};
  const OrigBlob = window.Blob;
  window.Blob = function(parts, opts){ lastBlobText = parts[0]; return new OrigBlob(parts, opts); };

  await wait(300);
  const doc = window.document;
  function log(label, ok, extra){ console.log((ok?'PASS':'FAIL') + ' - ' + label + (extra?' :: '+extra:'')); }

  doc.getElementById('documentsBtn').click();
  await wait(20);
  doc.getElementById('addDocumentBtn').click();
  await wait(10);
  doc.getElementById('documentTitleInput').value = 'Round Trip Doc';
  const docTaskOpt = doc.getElementById('documentTaskSelect').options[1];
  doc.getElementById('documentTaskSelect').value = docTaskOpt.value;
  doc.getElementById('documentFormSaveBtn').click();
  await wait(20);

  doc.getElementById('addDocumentBtn').click();
  await wait(10);
  doc.getElementById('documentTitleInput').value = 'Related Doc';
  const relatedPickerCb = doc.querySelector('#documentRelatedPicker input[type=checkbox]');
  relatedPickerCb.checked = true;
  doc.getElementById('documentFormSaveBtn').click();
  await wait(20);
  doc.getElementById('documentsModalClose').click();
  await wait(10);

  doc.getElementById('risksBtn').click();
  await wait(20);
  doc.getElementById('addRiskBtn').click();
  await wait(10);
  doc.getElementById('riskTitleInput').value = 'Round Trip Risk';
  doc.getElementById('riskLikelihoodSelect').value = '4';
  doc.getElementById('riskImpactSelect').value = '5';
  const riskTaskOpt = doc.getElementById('riskTaskSelect').options[1];
  doc.getElementById('riskTaskSelect').value = riskTaskOpt.value;
  doc.querySelector('#riskDocumentPicker input[type=checkbox]').checked = true;
  doc.getElementById('riskFormSaveBtn').click();
  await wait(20);
  doc.getElementById('risksModalClose').click();
  await wait(10);

  doc.getElementById('risksBtn').click();
  await wait(20);
  doc.getElementById('addRiskBtn').click();
  await wait(10);
  doc.getElementById('riskTitleInput').value = 'Round Trip Risk For Decision';
  doc.getElementById('riskFormSaveBtn').click();
  await wait(20);
  doc.getElementById('risksModalClose').click();
  await wait(10);

  doc.getElementById('decisionsBtn').click();
  await wait(20);
  doc.getElementById('addDecisionBtn').click();
  await wait(10);
  doc.getElementById('decisionTitleInput').value = 'Round Trip Decision';
  doc.getElementById('decisionTypeSelect').value = 'technical';
  doc.getElementById('decisionStatusSelect').value = 'in_review';
  doc.getElementById('decisionOutcomeInput').value = 'Pending final review.';
  doc.getElementById('decisionApproverInput').value = 'Pat Approver';
  const decisionTaskOpt = doc.getElementById('decisionTaskSelect').options[1];
  doc.getElementById('decisionTaskSelect').value = decisionTaskOpt.value;
  doc.querySelector('#decisionDocumentPicker input[type=checkbox]').checked = true;
  const decisionRiskCheckboxes = doc.querySelectorAll('#decisionRiskPicker input[type=checkbox]');
  decisionRiskCheckboxes[decisionRiskCheckboxes.length - 1].checked = true;
  doc.getElementById('decisionFormSaveBtn').click();
  await wait(20);
  doc.getElementById('decisionsModalClose').click();
  await wait(10);

  let raw = JSON.parse(window.localStorage.getItem('kanbanflow_v1_db'));
  let proj = raw.projects[raw.currentProjectId];
  const originalDocTaskKey = proj.tasks[docTaskOpt.value].key;

  doc.getElementById('exportBtn').click();
  await wait(20);
  const exported = JSON.parse(lastBlobText);
  log('export includes a documents array', Array.isArray(exported.documents) && exported.documents.length === 2, exported.documents && exported.documents.length);
  const exportedRelatedDoc = exported.documents.find(d => d.title === 'Related Doc');
  log('exported "Related Doc" carries relatedDocumentIds pointing at the other document', exportedRelatedDoc && exportedRelatedDoc.relatedDocumentIds.length === 1, exportedRelatedDoc && exportedRelatedDoc.relatedDocumentIds);
  log('export includes a risks array', Array.isArray(exported.risks) && exported.risks.length === 2, exported.risks && exported.risks.length);
  log('export includes a decisions array', Array.isArray(exported.decisions) && exported.decisions.length === 1, exported.decisions && exported.decisions.length);
  log('export includes the project\u2019s approvers vocabulary', Array.isArray(exported.approvers) && exported.approvers.includes('Pat Approver'), exported.approvers);
  log('exported document carries its taskId', !!exported.documents[0].taskId);
  log('exported risk carries its taskId and documentIds', !!exported.risks[0].taskId && exported.risks[0].documentIds.length === 1);
  log('exported decision carries its type, taskId, and documentIds', exported.decisions[0].type === 'technical' && !!exported.decisions[0].taskId && exported.decisions[0].documentIds.length === 1);
  log('exported decision carries status, outcome, approver, and riskIds',
      exported.decisions[0].status === 'in_review' && exported.decisions[0].outcome === 'Pending final review.' &&
      exported.decisions[0].approver === 'Pat Approver' && exported.decisions[0].riskIds.length === 1);

  const fileInput = doc.getElementById('importFileInput');
  Object.defineProperty(fileInput, 'files', { value: [new FakeFile(lastBlobText)], configurable: true });
  fileInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(30);
  if(!doc.getElementById('importConflictOverlay').classList.contains('hidden')){
    doc.getElementById('importConflictCopyBtn').click();
    await wait(20);
  }

  raw = JSON.parse(window.localStorage.getItem('kanbanflow_v1_db'));
  const importedProj = raw.projects[raw.currentProjectId];
  log('import-as-copy actually created a SEPARATE project (not just leaving the original selected)',
      importedProj.id !== proj.id && raw.projectOrder.length === 2, `orig=${proj.id} current=${importedProj.id} count=${raw.projectOrder.length}`);
  log('imported project has exactly two documents', importedProj.documents.length === 2, importedProj.documents.length);
  log('imported project has exactly two risks', importedProj.risks.length === 2, importedProj.risks.length);
  log('imported project has exactly one decision', importedProj.decisions.length === 1, importedProj.decisions.length);

  const importedDoc = importedProj.documents[0];
  const importedRelatedDoc = importedProj.documents.find(d => d.title === 'Related Doc');
  log('imported "Related Doc"\u2019s relatedDocumentIds correctly re-mapped to the imported "Round Trip Doc"\u2019s NEW id',
      importedRelatedDoc.relatedDocumentIds.length === 1 && importedRelatedDoc.relatedDocumentIds[0] === importedDoc.id,
      JSON.stringify(importedRelatedDoc.relatedDocumentIds) + ' vs ' + importedDoc.id);
  const importedRisk = importedProj.risks[0];
  const importedDecision = importedProj.decisions[0];
  log('imported decision key uses the new project\u2019s own key prefix', importedDecision.key.indexOf(importedProj.key + '-DEC-') === 0, importedDecision.key);
  log('imported decision retains its type', importedDecision.type === 'technical', importedDecision.type);
  log('imported decision\u2019s taskId is correctly re-mapped', !!importedProj.tasks[importedDecision.taskId], importedDecision.taskId);
  log('imported decision\u2019s documentIds correctly re-mapped to the imported document\u2019s NEW id',
      importedDecision.documentIds.length === 1 && importedDecision.documentIds[0] === importedDoc.id);
  log('imported decision\u2019s riskIds correctly re-mapped to a real risk in the new project',
      importedDecision.riskIds.length === 1 && !!importedProj.risks.find(r => r.id === importedDecision.riskIds[0]),
      JSON.stringify(importedDecision.riskIds));
  log('imported decision retains status, outcome, and approver',
      importedDecision.status === 'in_review' && importedDecision.outcome === 'Pending final review.' && importedDecision.approver === 'Pat Approver');
  log('imported project\u2019s approver vocabulary includes the carried-over value',
      importedProj.approvers.includes('Pat Approver'), JSON.stringify(importedProj.approvers));

  // ── Overwrite-import: re-keying must also work on THIS separate code path ──
  doc.getElementById('exportBtn').click();
  await wait(20);
  const exportedAgain = JSON.parse(lastBlobText);

  const fileInput2 = doc.getElementById('importFileInput');
  Object.defineProperty(fileInput2, 'files', { value: [new FakeFile(lastBlobText)], configurable: true });
  fileInput2.dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(30);
  log('re-importing the same project triggers the conflict modal', !doc.getElementById('importConflictOverlay').classList.contains('hidden'));
  doc.getElementById('importConflictOverwriteBtn').click();
  await wait(20);

  raw = JSON.parse(window.localStorage.getItem('kanbanflow_v1_db'));
  const overwrittenProj = raw.projects[proj.id];
  log('overwrite keeps the same project id', !!overwrittenProj);
  log('overwrite preserves the original project key (not a freshly-deduped one)', overwrittenProj.key === proj.key, overwrittenProj.key);
  log('overwritten document key is re-prefixed to match the real project key', overwrittenProj.documents[0].key.indexOf(proj.key + '-DOC-') === 0, overwrittenProj.documents[0].key);
  log('overwritten risk key is re-prefixed to match the real project key', overwrittenProj.risks[0].key.indexOf(proj.key + '-RISK-') === 0, overwrittenProj.risks[0].key);
  log('overwritten decision key is re-prefixed to match the real project key', overwrittenProj.decisions[0].key.indexOf(proj.key + '-DEC-') === 0, overwrittenProj.decisions[0].key);
  log('imported document key uses the new project\u2019s own key prefix', importedDoc.key.indexOf(importedProj.key + '-DOC-') === 0, importedDoc.key);
  log('imported risk key uses the new project\u2019s own key prefix', importedRisk.key.indexOf(importedProj.key + '-RISK-') === 0, importedRisk.key);

  log('imported document\u2019s taskId resolves to a real task in the new project (re-mapped, not stale)',
      !!importedProj.tasks[importedDoc.taskId], importedDoc.taskId);
  log('that re-mapped task has the SAME numeric suffix as the original (proving correct task identity)',
      importedProj.tasks[importedDoc.taskId].key.split('-').pop() === originalDocTaskKey.split('-').pop());

  log('imported risk\u2019s taskId is correctly re-mapped too', !!importedProj.tasks[importedRisk.taskId], importedRisk.taskId);
  log('imported risk\u2019s documentIds correctly re-mapped to the imported document\u2019s NEW id',
      importedRisk.documentIds.length === 1 && importedRisk.documentIds[0] === importedDoc.id,
      JSON.stringify(importedRisk.documentIds) + ' vs ' + importedDoc.id);

  log('imported risk retains its likelihood/impact values', importedRisk.likelihood === 4 && importedRisk.impact === 5);

  const legacyDB = {
    projects: {
      legacy_p1: {
        id: 'legacy_p1', name: 'Legacy Project', key: 'LEG', taskCounter: 2,
        columns: [{ id: 'col1', name: 'To Do', done: false, order: ['t1'] }],
        tasks: {
          t1: {
            id: 't1', key: 'LEG-1', title: 'Old task',
            description: '', priority: 'medium', columnId: 'col1', dependencies: [],
            assigneeId: null, releaseId: null, typeId: null, startDate: null, endDate: null,
            businessValue: 1, taskCost: 1, archived: false,
            dateCreated: '2025-01-01T00:00:00.000Z', dateLastModified: '2025-01-01T00:00:00.000Z'
          }
        },
        members: [], releases: [], taskTypes: [], startDate: null, endDate: null,
        dateCreated: '2025-01-01T00:00:00.000Z', dateLastModified: '2025-01-01T00:00:00.000Z', dateLastExported: null
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
  const legacyProj = raw2.projects.legacy_p1;
  log('migration backfills an empty documents array', Array.isArray(legacyProj.documents) && legacyProj.documents.length === 0);
  log('migration backfills docCounter starting at 1', legacyProj.docCounter === 1, legacyProj.docCounter);
  log('migration backfills an empty risks array', Array.isArray(legacyProj.risks) && legacyProj.risks.length === 0);
  log('migration backfills riskCounter starting at 1', legacyProj.riskCounter === 1, legacyProj.riskCounter);
  log('migration backfills an empty decisions array', Array.isArray(legacyProj.decisions) && legacyProj.decisions.length === 0);
  log('migration backfills decCounter starting at 1', legacyProj.decCounter === 1, legacyProj.decCounter);

  const doc2 = dom2.window.document;
  doc2.getElementById('documentsBtn').click();
  await wait(20);
  log('Documents modal opens cleanly on a freshly-migrated legacy project', !doc2.getElementById('documentsOverlay').classList.contains('hidden'));
  doc2.getElementById('documentsModalClose').click();
  await wait(10);
  doc2.getElementById('risksBtn').click();
  await wait(20);
  log('Risks modal opens cleanly on a freshly-migrated legacy project', !doc2.getElementById('risksOverlay').classList.contains('hidden'));
  doc2.getElementById('risksModalClose').click();
  await wait(10);
  doc2.getElementById('decisionsBtn').click();
  await wait(20);
  log('Decisions modal opens cleanly on a freshly-migrated legacy project', !doc2.getElementById('decisionsOverlay').classList.contains('hidden'));

  console.log('\nDocuments/Risks export-import and migration test complete.');
  process.exit(0);
})().catch(e => { console.error('CRASHED', e); process.exit(1); });
