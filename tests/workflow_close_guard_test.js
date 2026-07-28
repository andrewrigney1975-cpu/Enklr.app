const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync('../dist/index.html', 'utf8');
function wait(ms){ return new Promise(r => setTimeout(r, ms)); }

/* Covers views/workflow-editor.js's closeWorkflowOverlayGuarded — the Close button and Escape key
   (only those two, same scope as the Timeline's own equivalent guard) now prompt to save/discard
   an unsaved ("dirty") Workflow edit before closing, instead of silently discarding it. The guard
   is only meaningful for a server-authoritative project (a local-only project's edits already land
   in local storage immediately — see workflowEditorState.dirty's own comment in that file), so this
   test seeds a server-authoritative project the same way change_auditing_confirm_test.js does:
   boot a local instance first to get a real materialized workflow (real column ids/node positions),
   then boot a second instance with that same project (serverProjectId set) pre-seeded into
   localStorage, with window.fetch stubbed to behave like a minimal real backend for the two calls
   this guard actually exercises — GET /projects/{id} (pullWorkflowFromServer, used both by a normal
   open and by the guard's own Cancel/discard path) and PUT /projects/{id}/workflow
   (saveWorkflowToServer, used by the guard's Confirm/save path). */

(async () => {
  function log(label, ok, extra){ console.log((ok?'PASS':'FAIL') + ' - ' + label + (extra !== undefined ? ' :: ' + extra : '')); }

  // ── Materialize a real workflow (real column ids + default node/edge shape) locally first ──────
  const domSeed = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/', pretendToBeVisual: true });
  await wait(300);
  const docSeed = domSeed.window.document;
  docSeed.getElementById('workflowBtn').click();
  await wait(20);
  docSeed.getElementById('workflowClose').click();
  await wait(10);
  const seedRaw = JSON.parse(domSeed.window.localStorage.getItem('kanbanflow_v1_db'));
  const seedProj = seedRaw.projects[seedRaw.currentProjectId];
  const backlogCol = seedProj.columns.find(c => c.name === 'Backlog');
  const todoCol = seedProj.columns.find(c => c.name === 'To Do');

  // "Server" state this test's fetch mock reads from / writes to — starts as a deep copy of the
  // materialized workflow, independent of whatever the client-side project object goes on to do.
  var serverWorkflow = JSON.parse(JSON.stringify(seedProj.workflow));
  var putCallCount = 0;
  var failNextPut = false;

  seedProj.serverProjectId = seedProj.id;
  const cloudRaw = JSON.parse(JSON.stringify(seedRaw));

  const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/', pretendToBeVisual: true });
  dom.window.localStorage.setItem('kanbanflow_v1_db', JSON.stringify(cloudRaw));
  dom.window.fetch = async function(url, options){
    var method = (options && options.method) || 'GET';
    if(method === 'GET' && /\/projects\/[^/]+$/.test(url)){
      // Deep-cloned, same as a real fetch response would be (JSON serialized over the wire) — without
      // this, the client's project.workflow object and this mock's own serverWorkflow would alias to
      // the SAME object, so a later client-side drag would silently mutate "the server" too, making
      // every discard/revert assertion below pass vacuously regardless of whether the guard actually
      // discarded anything.
      return {ok: true, status: 200, json: async () => ({workflow: JSON.parse(JSON.stringify(serverWorkflow))})};
    }
    if(method === 'PUT' && /\/workflow$/.test(url)){
      putCallCount++;
      if(failNextPut){ failNextPut = false; return {ok: false, status: 500, json: async () => ({message: 'mock failure'})}; }
      serverWorkflow = JSON.parse(options.body);
      return {ok: true, status: 200, json: async () => (serverWorkflow)};
    }
    return {ok: true, status: 200, json: async () => ({})};
  };
  await wait(300);
  const doc = dom.window.document;

  const rawAfterBoot = JSON.parse(dom.window.localStorage.getItem('kanbanflow_v1_db'));
  const cloudProj = rawAfterBoot.projects[rawAfterBoot.currentProjectId];
  log('the seeded project booted as server-authoritative', cloudProj.serverProjectId === cloudProj.id, cloudProj.serverProjectId);

  function dragNode(colId, dx, dy){
    const node = doc.querySelector('#workflowInner .kf-wfnode[data-column-id="' + colId + '"]');
    node.dispatchEvent(new dom.window.MouseEvent('mousedown', {bubbles: true, clientX: 200, clientY: 200, button: 0}));
    doc.dispatchEvent(new dom.window.MouseEvent('mousemove', {bubbles: true, clientX: 200 + dx, clientY: 200 + dy}));
    doc.dispatchEvent(new dom.window.MouseEvent('mouseup', {bubbles: true, clientX: 200 + dx, clientY: 200 + dy}));
  }
  function currentProject(){
    var raw = JSON.parse(dom.window.localStorage.getItem('kanbanflow_v1_db'));
    return raw.projects[raw.currentProjectId];
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // Nothing dirty: Close and Escape both close immediately, no confirm dialog
  // ══════════════════════════════════════════════════════════════════════════════════════════
  doc.getElementById('workflowBtn').click();
  await wait(30);
  log('opening shows the Workflow overlay', !doc.getElementById('workflowOverlay').classList.contains('hidden'));
  log('Save Workflow starts disabled (nothing dirty)', doc.getElementById('workflowSaveBtn').disabled === true);

  doc.getElementById('workflowClose').click();
  await wait(20);
  log('closing with nothing dirty does not show a confirm dialog', doc.getElementById('confirmOverlay').classList.contains('hidden'));
  log('closing with nothing dirty actually closes the Workflow overlay', doc.getElementById('workflowOverlay').classList.contains('hidden'));

  doc.getElementById('workflowBtn').click();
  await wait(30);
  doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
  await wait(20);
  log('Escape with nothing dirty does not show a confirm dialog', doc.getElementById('confirmOverlay').classList.contains('hidden'));
  log('Escape with nothing dirty actually closes the Workflow overlay', doc.getElementById('workflowOverlay').classList.contains('hidden'));

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // Dirty: Close icon prompts; Ignore keeps it open with the edit intact
  // ══════════════════════════════════════════════════════════════════════════════════════════
  doc.getElementById('workflowBtn').click();
  await wait(30);
  dragNode(backlogCol.id, 60, 40);
  await wait(20);
  log('dragging a node marks the Workflow dirty (Save button enabled)', doc.getElementById('workflowSaveBtn').disabled === false);

  doc.getElementById('workflowClose').click();
  await wait(20);
  log('closing with a dirty edit opens a confirm dialog', !doc.getElementById('confirmOverlay').classList.contains('hidden'));
  log('the dialog names the Workflow specifically', doc.getElementById('confirmTitle').textContent.indexOf('Workflow') !== -1, doc.getElementById('confirmTitle').textContent);
  log('the Workflow overlay itself is still open behind the dialog', !doc.getElementById('workflowOverlay').classList.contains('hidden'));

  doc.getElementById('confirmIgnoreBtn').click();
  await wait(20);
  log('Ignore closes the dialog but leaves the Workflow overlay open', doc.getElementById('confirmOverlay').classList.contains('hidden') && !doc.getElementById('workflowOverlay').classList.contains('hidden'));
  log('Ignore leaves the dirty edit (and Save button) intact', doc.getElementById('workflowSaveBtn').disabled === false);
  log('Ignore made no network call', putCallCount === 0, putCallCount);

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // Cancel: discards the dirty edit (re-pulls the server's own copy) and closes without saving
  // ══════════════════════════════════════════════════════════════════════════════════════════
  const draggedPos = JSON.parse(JSON.stringify(currentProject().workflow.nodes[backlogCol.id]));
  const originalPos = serverWorkflow.nodes[backlogCol.id];
  log('sanity: the drag actually moved the node locally before Cancel', draggedPos.x !== originalPos.x || draggedPos.y !== originalPos.y, JSON.stringify({draggedPos, originalPos}));

  doc.getElementById('workflowClose').click();
  await wait(20);
  doc.getElementById('confirmCancelBtn').click();
  await wait(30);
  log('Cancel closes the Workflow overlay', doc.getElementById('workflowOverlay').classList.contains('hidden'));
  log('Cancel discarded the dragged position (reverted to the server\'s own copy)',
      currentProject().workflow.nodes[backlogCol.id].x === originalPos.x && currentProject().workflow.nodes[backlogCol.id].y === originalPos.y,
      JSON.stringify(currentProject().workflow.nodes[backlogCol.id]));
  log('Cancel made no PUT (write) call — only the discard GET', putCallCount === 0, putCallCount);

  doc.getElementById('workflowBtn').click();
  await wait(30);
  log('reopening after Cancel shows Save Workflow disabled again (no longer dirty)', doc.getElementById('workflowSaveBtn').disabled === true);
  doc.getElementById('workflowClose').click();
  await wait(20);

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // Confirm (via Escape this time): saves the dirty edit, then closes
  // ══════════════════════════════════════════════════════════════════════════════════════════
  doc.getElementById('workflowBtn').click();
  await wait(30);
  dragNode(todoCol.id, -30, 25);
  await wait(20);
  const draggedTodoPos = JSON.parse(JSON.stringify(currentProject().workflow.nodes[todoCol.id]));

  doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
  await wait(20);
  log('Escape with a dirty edit opens the same confirm dialog', !doc.getElementById('confirmOverlay').classList.contains('hidden'));

  doc.getElementById('confirmOkBtn').click();
  await wait(40);
  log('Confirm made exactly one PUT (save) call', putCallCount === 1, putCallCount);
  log('Confirm closes the Workflow overlay once the save settles', doc.getElementById('workflowOverlay').classList.contains('hidden'));
  log('Confirm actually persisted the dragged position to the "server"',
      serverWorkflow.nodes[todoCol.id].x === draggedTodoPos.x && serverWorkflow.nodes[todoCol.id].y === draggedTodoPos.y,
      JSON.stringify(serverWorkflow.nodes[todoCol.id]));

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // A failed save leaves the edit intact and the overlay open, rather than closing over data loss
  // ══════════════════════════════════════════════════════════════════════════════════════════
  doc.getElementById('workflowBtn').click();
  await wait(30);
  dragNode(backlogCol.id, 15, 90);
  await wait(20);
  failNextPut = true;
  const putCountBeforeFailure = putCallCount;

  doc.getElementById('workflowClose').click();
  await wait(20);
  doc.getElementById('confirmOkBtn').click();
  await wait(40);
  log('a failed save attempt is made (PUT call count increments)', putCallCount === putCountBeforeFailure + 1, putCallCount);
  log('a failed save leaves the Workflow overlay open, not closed over the unsaved edit', !doc.getElementById('workflowOverlay').classList.contains('hidden'));
  log('a failed save leaves the edit marked dirty (Save button still enabled) so it can be retried', doc.getElementById('workflowSaveBtn').disabled === false);
  doc.getElementById('workflowClose').click();
  await wait(20);
  doc.getElementById('confirmCancelBtn').click();
  await wait(30);

  console.log('\nWorkflow close-guard test complete.');
  process.exit(0);
})().catch(e => { console.error('CRASHED', e); process.exit(1); });
