const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync('../dist/index.html', 'utf8');
function wait(ms){ return new Promise(r => setTimeout(r, ms)); }

/* Covers the filter-bar "Connectors" toggle (#depConnectorsToggleBtn, ui.showTaskConnectors) —
   showing every dependency and sub-task connector on the board at once, reusing the exact same
   routing/rendering (computeTaskDepConnectorPoints/roundedOrthogonalPathD) and marker styling as
   the single hover-triggered connector, plus the Dependency Graph's own purple/dashed sub-task
   edge style. Boots once to read the seeded Sample Project's real ids, then re-boots a second JSDOM
   instance (same convention as archived_test.js's legacy-migration fixture) with a parentTaskId
   relationship injected between two seed tasks, since the seed data has no sub-task pair of its own. */

(async () => {
  try {
  const bootDom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/', pretendToBeVisual: true });
  await wait(300);
  const raw = JSON.parse(bootDom.window.localStorage.getItem('kanbanflow_v1_db'));
  const project = raw.projects[raw.currentProjectId];
  const tasks = Object.values(project.tasks);
  const parentTask = tasks.find(t => t.key === project.key + '-1');
  const childTask = tasks.find(t => t.key === project.key + '-5');
  childTask.parentTaskId = parentTask.id;
  project.headerButtonVisibility = Object.assign({}, project.headerButtonVisibility, {subTasks: true});
  bootDom.window.close();

  const dom = new JSDOM(html, {
    runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/', pretendToBeVisual: true,
    beforeParse(w){ w.localStorage.setItem('kanbanflow_v1_db', JSON.stringify(raw)); }
  });
  const { window } = dom;
  await wait(300);
  const doc = window.document;
  function log(label, ok, extra){ console.log((ok?'PASS':'FAIL') + ' - ' + label + (extra !== undefined ? ' :: ' + extra : '')); }

  // Deterministic mock for getBoundingClientRect (see task_dep_popover_test.js for why jsdom needs
  // this — it has no real layout engine, every rect is all-zero by default).
  const realGetRect = window.Element.prototype.getBoundingClientRect;
  window.Element.prototype.getBoundingClientRect = function(){
    if(this.classList && this.classList.contains('kf-column')){
      var cols = Array.from(doc.querySelectorAll('#board > .kf-column'));
      var idx = cols.indexOf(this);
      var left = idx * 300;
      return {left: left, right: left + 280, top: 100, bottom: 700, width: 280, height: 600};
    }
    if(this.classList && this.classList.contains('kf-card')){
      var col = this.closest('.kf-column');
      var cols2 = Array.from(doc.querySelectorAll('#board > .kf-column'));
      var colIdx = cols2.indexOf(col);
      var cardsInCol = Array.from(col.querySelectorAll('.kf-card'));
      var rowIdx = cardsInCol.indexOf(this);
      var left2 = colIdx * 300 + 10;
      var top2 = 150 + rowIdx * 100;
      return {left: left2, right: left2 + 260, top: top2, bottom: top2 + 80, width: 260, height: 80};
    }
    return realGetRect.call(this);
  };

  const toggleBtn = doc.getElementById('depConnectorsToggleBtn');
  const layer = doc.getElementById('taskDepConnectorLayer');
  const group = doc.getElementById('taskDepConnectorAllGroup');

  log('toggle button exists in the filter bar', !!toggleBtn);
  log('toggle button is labeled "Relationships"', toggleBtn.textContent.trim() === 'Relationships', toggleBtn.textContent.trim());
  log('toggle sits right after the priority chips and before the Team filter', toggleBtn.previousElementSibling && toggleBtn.previousElementSibling.id === 'priorityFilterChips' && toggleBtn.nextElementSibling && toggleBtn.nextElementSibling.id === 'teamFilterWrap');
  log('toggle starts inactive', !toggleBtn.classList.contains('active'));
  log('connector layer starts hidden', layer.classList.contains('hidden'));
  log('the all-connectors group starts empty', group.childElementCount === 0);

  toggleBtn.click();
  await wait(20);

  log('toggle button becomes active', toggleBtn.classList.contains('active'));
  log('connector layer un-hides', !layer.classList.contains('hidden'));

  const paths = Array.from(group.querySelectorAll('path'));
  // 4 dependency edges in the seed data (SMPL-2->1, SMPL-3->2, SMPL-4->2, SMPL-4->3) + 1 injected
  // sub-task edge (SMPL-5 is now a child of SMPL-1) = 5 total.
  log('renders all 4 seed dependency edges + the 1 injected sub-task edge', paths.length === 5, paths.length);

  const depPaths = paths.filter(p => p.getAttribute('stroke') === '#de350b' || p.getAttribute('stroke') === '#8993a4');
  log('4 paths use the dependency red/grey coloring', depPaths.length === 4, depPaths.length);
  log('every dependency path here is red (none of the seed columns marked done)', depPaths.every(p => p.getAttribute('stroke') === '#de350b'));
  log('dependency paths use the dependency marker pair', depPaths.every(p => p.getAttribute('marker-start') === 'url(#kf-taskdep-dot-start-blocked)' && p.getAttribute('marker-end') === 'url(#kf-taskdep-arrow-blocked)'));

  const subtaskPaths = paths.filter(p => p.getAttribute('stroke') === '#6554c0');
  log('exactly 1 path uses the sub-task purple color', subtaskPaths.length === 1, subtaskPaths.length);
  log('the sub-task path is dashed', subtaskPaths[0] && subtaskPaths[0].getAttribute('stroke-dasharray') === '5 4');
  log('the sub-task path uses the sub-task marker pair', subtaskPaths[0] && subtaskPaths[0].getAttribute('marker-start') === 'url(#kf-taskdep-dot-start-subtask)' && subtaskPaths[0].getAttribute('marker-end') === 'url(#kf-taskdep-arrow-subtask)');

  // SMPL-1 (Backlog) -> SMPL-5 (Done) skips 2 columns, so this edge's "highway" crossing must sit
  // below every column's own bottom edge (mocked at y=700 above) — not just below the header row,
  // which two earlier, since-reverted designs both got wrong: one routed at column-top+20 (cut
  // straight through the header text/icon row), the other just below the header itself (still cut
  // through a skipped column's own first card whenever that column's header happened to be shorter
  // than another's). Routing below every column's bottom, in the empty board background, is clear
  // of both.
  const highwayY = 700 + 10;
  log('the sub-task edge’s highway crossing routes below the columns entirely, not through them',
      subtaskPaths[0] && subtaskPaths[0].getAttribute('d').indexOf(' ' + highwayY + ' ') !== -1,
      subtaskPaths[0] && subtaskPaths[0].getAttribute('d'));

  toggleBtn.click();
  await wait(20);
  log('toggling off deactivates the button', !toggleBtn.classList.contains('active'));
  log('toggling off clears the all-connectors group', group.childElementCount === 0);
  log('toggling off re-hides the layer', layer.classList.contains('hidden'));

  // Sub-task edges are gated on the Sub-Tasks project setting, same as the Dependency Graph itself
  // — flip it off through the real App Settings checkbox (state.db is in-memory; poking
  // localStorage directly wouldn't be seen by the already-running app). updateHeaderButtonVisibilitySetting
  // calls renderBoard() itself, which re-runs renderAllTaskConnectors() — so the toggle needs to be
  // back on FIRST, or that re-render has nothing to do (ui.showTaskConnectors still false).
  toggleBtn.click();
  await wait(20);
  doc.getElementById('appSettingsBtn').click();
  await wait(10);
  const subTasksCheckbox = doc.getElementById('settingsShowSubTasksBtn');
  subTasksCheckbox.checked = false;
  subTasksCheckbox.dispatchEvent(new window.Event('change', {bubbles: true}));
  await wait(20);
  const pathsAfterDisable = Array.from(group.querySelectorAll('path'));
  const subtaskPathsAfterDisable = pathsAfterDisable.filter(p => p.getAttribute('stroke') === '#6554c0');
  log('disabling Sub-Tasks removes the purple edge, keeping only the 4 dependency edges',
      pathsAfterDisable.length === 4 && subtaskPathsAfterDisable.length === 0, pathsAfterDisable.length);

  window.Element.prototype.getBoundingClientRect = realGetRect;

  console.log('Task connectors toggle test complete.');
  process.exit(0);
  } catch(e){
    console.error('TASK CONNECTORS TOGGLE TEST CRASHED:', e);
    process.exit(1);
  }
})();
