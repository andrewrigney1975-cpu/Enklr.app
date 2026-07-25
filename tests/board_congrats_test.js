const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync('../dist/index.html', 'utf8');
function wait(ms){ return new Promise(r => setTimeout(r, ms)); }

/* Covers the "You're All Caught Up" board congratulations banner (utils.js's boardIsFullyComplete
   + views/board.js's renderBoardCongratsBanner) — an overlay shown directly on the board (not a
   modal) once every non-archived task sits in a "done" column, cleared the moment that's no longer
   true. Boots once to read the seeded Sample Project's real column/task ids, then re-boots a second
   JSDOM instance with the fixture mutated into each scenario under test (same convention as
   task_connectors_toggle_test.js's own parentTaskId injection). */

(async () => {
  try {
  const bootDom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/', pretendToBeVisual: true });
  await wait(300);
  const raw = JSON.parse(bootDom.window.localStorage.getItem('kanbanflow_v1_db'));
  const project = raw.projects[raw.currentProjectId];
  const doneCol = project.columns.find(c => c.done);
  const otherCol = project.columns.find(c => !c.done);
  bootDom.window.close();

  function log(label, ok, extra){ console.log((ok?'PASS':'FAIL') + ' - ' + label + (extra !== undefined ? ' :: ' + extra : '')); }

  async function bootWith(mutateFn){
    const clone = JSON.parse(JSON.stringify(raw));
    mutateFn(clone.projects[clone.currentProjectId]);
    const dom = new JSDOM(html, {
      runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/', pretendToBeVisual: true,
      beforeParse(w){ w.localStorage.setItem('kanbanflow_v1_db', JSON.stringify(clone)); }
    });
    await wait(300);
    return dom;
  }

  // Scenario 1: default seed data (mixed columns) — banner must NOT show.
  {
    const dom = await bootWith(function(p){});
    const el = dom.window.document.getElementById('boardCongrats');
    log('default seed data (not all done) shows no banner', !el);
    dom.window.close();
  }

  // Scenario 2: every non-archived task moved into the Done column — banner MUST show.
  {
    const dom = await bootWith(function(p){
      Object.values(p.tasks).forEach(t => { t.columnId = doneCol.id; });
      p.columns.forEach(c => { c.order = c.id === doneCol.id ? Object.keys(p.tasks) : []; });
    });
    const doc = dom.window.document;
    const el = doc.getElementById('boardCongrats');
    log('all tasks done shows the congrats banner', !!el);
    log('banner title reads "You’re All Caught Up!"', el && el.querySelector('.kf-board-congrats-title').textContent === 'You’re All Caught Up!');
    log('banner has a check icon', el && !!el.querySelector('.kf-board-congrats-check svg'));
    log('banner is a sibling of #board, not a child', el && el.parentElement === doc.getElementById('board').parentElement);
    dom.window.close();
  }

  // Scenario 3: all tasks done, but one is archived-and-not-done — archived tasks are excluded from
  // the check, so this must still show the banner (archiving the one already-in-Done task, then
  // adding a fresh archived-but-incomplete task, must not suppress it).
  {
    const dom = await bootWith(function(p){
      Object.values(p.tasks).forEach(t => { t.columnId = doneCol.id; });
      const ids = Object.keys(p.tasks);
      const archivedId = ids[0];
      p.tasks[archivedId].archived = true;
      p.tasks[archivedId].columnId = otherCol.id;
      p.columns.forEach(c => {
        if(c.id === doneCol.id) c.order = ids.filter(id => id !== archivedId);
        else if(c.id === otherCol.id) c.order = [archivedId];
        else c.order = [];
      });
    });
    const el = dom.window.document.getElementById('boardCongrats');
    log('an archived incomplete task does not block the banner', !!el);
    dom.window.close();
  }

  // Scenario 4: every task archived (zero active tasks) — banner must NOT show, nothing to
  // congratulate.
  {
    const dom = await bootWith(function(p){
      Object.values(p.tasks).forEach(t => { t.archived = true; });
    });
    const el = dom.window.document.getElementById('boardCongrats');
    log('all tasks archived (zero active tasks) shows no banner', !el);
    dom.window.close();
  }

  console.log('Board congrats banner test complete.');
  } catch(e){
    console.error('FAIL - unexpected error', e);
    process.exit(1);
  }
})();
