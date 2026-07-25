const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync('../dist/index.html', 'utf8');
function wait(ms){ return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;
  await wait(300);
  const doc = window.document;
  function log(label, ok, extra){ console.log((ok?'PASS':'FAIL') + ' - ' + label + (extra !== undefined ? ' :: ' + extra : '')); }

  function currentProject(){
    var raw = JSON.parse(window.localStorage.getItem('kanbanflow_v1_db'));
    return raw.projects[raw.currentProjectId];
  }

  // ── Setup: create a release ─────────────────────────────────────────────
  doc.getElementById('releasesBtn').click();
  await wait(20);
  doc.getElementById('addReleaseBtn').click();
  await wait(10);
  doc.getElementById('releaseNameInput').value = 'v1.0 Launch';
  doc.getElementById('releaseFormSaveBtn').click();
  await wait(20);
  var releaseId = currentProject().releases[0].id;
  doc.getElementById('releasesDoneBtn').click();
  await wait(10);

  var cards = Array.from(doc.querySelectorAll('.kf-card'));
  log('at least 2 seeded tasks available for this test', cards.length >= 2, cards.length);
  var taskAId = cards[0].getAttribute('data-task-id');
  var taskBId = cards[1].getAttribute('data-task-id');

  function openTaskById(id){
    doc.querySelector('.kf-card[data-task-id="' + id + '"]').click();
  }
  function doneColumnOption(){
    return Array.from(doc.getElementById('taskColumnSelect').options).find(function(o){
      return o.textContent.trim() === 'Done';
    });
  }

  // ── Assign the release to both tasks first, neither in Done yet ────────
  openTaskById(taskAId);
  await wait(10);
  doc.getElementById('taskReleaseSelect').value = releaseId;
  doc.getElementById('taskSaveBtn').click();
  await wait(20);

  openTaskById(taskBId);
  await wait(10);
  doc.getElementById('taskReleaseSelect').value = releaseId;
  doc.getElementById('taskSaveBtn').click();
  await wait(20);

  // ── Move task A to Done — task B still isn't, so no prompt yet ─────────
  openTaskById(taskAId);
  await wait(10);
  doc.getElementById('taskColumnSelect').value = doneColumnOption().value;
  doc.getElementById('taskSaveBtn').click();
  await wait(20);
  log('no completion prompt yet — a sibling task in the release is still open',
      doc.getElementById('confirmOverlay').classList.contains('hidden'));
  log('release still Pending', currentProject().releases[0].status === 'pending', currentProject().releases[0].status);

  // ── Move task B to Done too — now every task in the release is done ────
  openTaskById(taskBId);
  await wait(10);
  doc.getElementById('taskColumnSelect').value = doneColumnOption().value;
  doc.getElementById('taskSaveBtn').click();
  await wait(20);

  log('completion prompt appears once the release\'s last task is done',
      !doc.getElementById('confirmOverlay').classList.contains('hidden'));
  var msg = doc.getElementById('confirmMessage').textContent;
  log('prompt message names the release and asks to deploy + generate notes',
      msg.indexOf('v1.0 Launch') !== -1 && msg.indexOf('closed out') !== -1 && msg.indexOf('release notes') !== -1,
      msg);

  doc.getElementById('confirmOkBtn').click();
  await wait(20);
  log('confirming marks the release as Deployed', currentProject().releases[0].status === 'deployed', currentProject().releases[0].status);

  // ── Re-verify: an already-deployed release doesn't re-prompt ────────────
  var taskCId = cards.length >= 3 ? cards[2].getAttribute('data-task-id') : null;
  if(taskCId){
    openTaskById(taskCId);
    await wait(10);
    doc.getElementById('taskReleaseSelect').value = releaseId;
    doc.getElementById('taskColumnSelect').value = doneColumnOption().value;
    doc.getElementById('taskSaveBtn').click();
    await wait(20);
    log('moving another task into an already-deployed release\'s Done column does not re-prompt',
        doc.getElementById('confirmOverlay').classList.contains('hidden'));
  }

  console.log('\nRelease completion test complete.');
  process.exit(0);
})().catch(e => { console.error('CRASHED', e); process.exit(1); });
