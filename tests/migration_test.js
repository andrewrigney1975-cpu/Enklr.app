const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync('../dist/index.html', 'utf8');

// Build a "legacy" db shape (as if saved by a version of the app before
// the team-members feature existed) and pre-seed localStorage with it
// BEFORE the page's own script runs, so loadDB() has to migrate it.
const legacyDB = {
  projects: {
    legacy_p1: {
      id: 'legacy_p1',
      name: 'Legacy Project',
      key: 'LEG',
      taskCounter: 2,
      columns: [
        { id: 'col1', name: 'To Do', done: false, order: ['t1'] },
        { id: 'col2', name: 'Done', done: true, order: [] }
      ],
      tasks: {
        t1: {
          id: 't1', key: 'LEG-1', title: 'Old task with no assigneeId field',
          description: '', priority: 'medium', columnId: 'col1',
          dependencies: [], createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z'
          // note: deliberately no `assigneeId` key at all
        }
      }
      // note: deliberately no `members` array at all
    }
  },
  projectOrder: ['legacy_p1'],
  currentProjectId: 'legacy_p1'
};

const dom = new JSDOM(html, {
  runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/', pretendToBeVisual: true,
  beforeParse(window){
    // Seed localStorage before any inline script executes
    window.localStorage.setItem('kanbanflow_v1_db', JSON.stringify(legacyDB));
  }
});
const { window } = dom;
function wait(ms){ return new Promise(r => setTimeout(r, ms)); }

(async () => {
  await wait(300);
  const doc = window.document;
  function log(label, ok, extra){ console.log((ok?'PASS':'FAIL') + ' - ' + label + (extra?' :: '+extra:'')); }

  log('legacy project loaded without crashing', doc.getElementById('toolbarTitle').textContent === 'Legacy Project', doc.getElementById('toolbarTitle').textContent);

  const raw = JSON.parse(window.localStorage.getItem('kanbanflow_v1_db'));
  const proj = raw.projects.legacy_p1;
  log('migration backfilled members: []', Array.isArray(proj.members) && proj.members.length === 0);
  log('migration backfilled assigneeId: null on existing task', proj.tasks.t1.assigneeId === null, proj.tasks.t1.assigneeId);

  // The app should be fully usable: open Manage Team, add a member, assign it
  doc.getElementById('manageTeamBtn').click();
  await wait(20);
  doc.getElementById('newMemberNameInput').value = 'New Hire';
  doc.getElementById('addMemberBtn').click();
  await wait(20);
  doc.getElementById('teamDoneBtn').click();
  await wait(10);

  const card = doc.querySelector('.kf-card');
  card.click();
  await wait(20);
  const opts = Array.from(doc.getElementById('taskAssigneeSelect').options).map(o => o.textContent);
  log('newly added member usable on a legacy task', opts.indexOf('New Hire') !== -1, opts.join(','));

  console.log('\nMigration test complete.');
  process.exit(0);
})().catch(e => { console.error('CRASHED', e); process.exit(1); });
