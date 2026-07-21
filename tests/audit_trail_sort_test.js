const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync('../dist/index.html', 'utf8');
function wait(ms){ return new Promise(r => setTimeout(r, ms)); }

/* Covers the Audit Trail's sort order (reported bug: entries appeared in a "random" order) and its
   new sort-toggle control, mirroring Task Comments' own default-ASC/toggle convention exactly. Local
   mode's mutations.js unshifts new audit entries onto the front of the array (newest-first storage
   order), so a correct default render (oldest first) only happens if the render function actually
   sorts by timestamp rather than trusting array order — this test would have caught the bug. */

(async () => {
  const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;
  await wait(300);
  const doc = window.document;
  function log(label, ok, extra){ console.log((ok?'PASS':'FAIL') + ' - ' + label + (extra !== undefined ? ' :: ' + extra : '')); }

  // ── Enable Change Auditing (local project still shows the confirm dialog) ──
  doc.getElementById('appSettingsBtn').click();
  await wait(10);
  doc.getElementById('settingsShowChangeAuditingBtn').checked = true;
  doc.getElementById('settingsShowChangeAuditingBtn').dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(10);
  doc.getElementById('confirmOkBtn').click();
  await wait(10);
  doc.getElementById('appSettingsClose').click();
  await wait(10);

  // ── Create a task, then make three separate edits so three audit entries accumulate ──
  const addTaskBtn = doc.querySelector('.kf-add-task-btn');
  addTaskBtn.click();
  await wait(10);
  doc.getElementById('taskTitleInput').value = 'Audit order test';
  doc.getElementById('taskSaveBtn').click();
  await wait(20);

  function openCard(){
    const card = Array.from(doc.querySelectorAll('.kf-card')).find(c => c.textContent.indexOf('Audit order test') !== -1);
    card.click();
  }

  openCard();
  await wait(10);
  doc.getElementById('taskPrioritySelect').value = 'high';
  doc.getElementById('taskSaveBtn').click();
  await wait(20);

  openCard();
  await wait(10);
  doc.getElementById('taskProgressInput').value = '50';
  doc.getElementById('taskSaveBtn').click();
  await wait(20);

  openCard();
  await wait(10);
  doc.getElementById('taskEstEffortInput').value = '5';
  doc.getElementById('taskSaveBtn').click();
  await wait(20);

  // ── Reopen and inspect the Audit Trail ──
  openCard();
  await wait(10);

  log('Audit Trail section is visible', !doc.getElementById('taskAuditSection').classList.contains('kf-vis-hidden'));
  log('Audit count shows 3 entries', doc.getElementById('taskAuditCount').textContent === '(3)');
  log('sort defaults to "Oldest first" (ASC), same default as Comments', doc.getElementById('taskAuditSortLabel').textContent === 'Oldest first');

  const fieldsAsc = Array.from(doc.querySelectorAll('#taskAuditBody .kf-audit-entry-field')).map(el => el.textContent);
  log('default order is chronological (oldest edit first): priority, progress, estimated effort',
      fieldsAsc.length === 3 && fieldsAsc[0].toLowerCase().indexOf('priority') !== -1 && fieldsAsc[2].toLowerCase().indexOf('effort') !== -1,
      JSON.stringify(fieldsAsc));

  // ── Expand the trail, then toggle sort — expansion must survive the sort click ──
  doc.getElementById('taskAuditToggleBtn').click();
  await wait(10);
  log('Audit Trail expands on click', !doc.getElementById('taskAuditBody').classList.contains('kf-vis-hidden'));

  doc.getElementById('taskAuditSortBtn').click();
  await wait(10);
  log('sort button flips the label to "Newest first"', doc.getElementById('taskAuditSortLabel').textContent === 'Newest first');
  log('toggling sort does NOT re-collapse the Audit Trail', !doc.getElementById('taskAuditBody').classList.contains('kf-vis-hidden'));

  const fieldsDesc = Array.from(doc.querySelectorAll('#taskAuditBody .kf-audit-entry-field')).map(el => el.textContent);
  log('order is now reversed (newest edit first)', JSON.stringify(fieldsDesc) === JSON.stringify(fieldsAsc.slice().reverse()), JSON.stringify(fieldsDesc));

  // ── Sort preference resets to default the next time the modal opens (matches Comments' own reset-on-open convention) ──
  doc.getElementById('taskModalClose').click();
  await wait(10);
  openCard();
  await wait(10);
  log('reopening the task resets sort back to "Oldest first"', doc.getElementById('taskAuditSortLabel').textContent === 'Oldest first');

  console.log('\nAudit Trail sort order test complete.');
})();
