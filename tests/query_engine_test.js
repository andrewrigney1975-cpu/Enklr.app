const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync('../dist/index.html', 'utf8');
function wait(ms){ return new Promise(r => setTimeout(r, ms)); }

/* Black-box, driving the BUILT dist/index.html — same convention as every other test in this
   suite (see CLAUDE.md §10). query-engine.js has no standalone unit-test harness of its own; its
   behavior is exercised entirely through the Advanced Query tab's UI, same as any other src/js
   module in this codebase. */

function makeFakeJwt(payload){
  var b64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return 'header.' + b64 + '.signature';
}

function makeTask(id, key, title, overrides){
  return Object.assign({
    id: id, key: key, title: title,
    description: '', priority: 'medium', columnId: 'col1', dependencies: [],
    assigneeId: null, releaseId: null, typeId: null,
    startDate: null, endDate: null,
    businessValue: 1, taskCost: 1, archived: false,
    dateCreated: '2025-01-01T00:00:00.000Z', dateLastModified: '2025-01-01T00:00:00.000Z'
  }, overrides || {});
}
function makeDB(tasks, members){
  var taskMap = {}; var order = [];
  tasks.forEach(function(t){ taskMap[t.id] = t; order.push(t.id); });
  var proj = {
    id: 'p1', name: 'Test Project', key: 'TST', taskCounter: tasks.length + 1,
    columns: [{ id: 'col1', name: 'To Do', done: false, order: order }],
    tasks: taskMap, members: members || [], releases: [], taskTypes: [],
    risks: [], decisions: [], principles: [], objectives: [], documents: [], teamsCommittees: [],
    startDate: null, endDate: null,
    dateCreated: '2025-01-01T00:00:00.000Z', dateLastModified: '2025-01-01T00:00:00.000Z', dateLastExported: null
  };
  var projects = {}; projects[proj.id] = proj;
  return { projects: projects, projectOrder: [proj.id], currentProjectId: proj.id };
}

var TASKS = [
  makeTask('t1', 'TST-1', 'Alpha', { priority: 'high', taskCost: 10, assigneeId: 'm1' }),
  makeTask('t2', 'TST-2', 'Beta', { priority: 'low', taskCost: 5, assigneeId: 'm2' }),
  makeTask('t3', 'TST-3', 'Gamma', { priority: 'high', taskCost: 20, assigneeId: 'm1' }),
  makeTask('t4', 'TST-4', 'Delta', { priority: 'high', taskCost: 8, assigneeId: null })
];
var MEMBERS = [
  { id: 'm1', name: 'Alice', email: null, color: '#fff', role: null, allocatedFraction: null, reportsToId: null },
  { id: 'm2', name: 'Bob', email: null, color: '#fff', role: null, allocatedFraction: null, reportsToId: null }
];

async function runQuery(sql){
  const db = makeDB(TASKS, MEMBERS);
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/', pretendToBeVisual: true,
    beforeParse(w){
      w.localStorage.setItem('kanbanflow_v1_db', JSON.stringify(db));
      w.localStorage.setItem('kanbanflow_server_jwt', makeFakeJwt({orgAdmin: 'true'}));
    }
  });
  await wait(800);
  const doc = dom.window.document;
  doc.getElementById('projectSearchBtn').click();
  await wait(50);
  doc.getElementById('projectSearchTabQueryBtn').click();
  await wait(50);
  doc.getElementById('projectQuerySql').value = sql;
  doc.getElementById('projectQueryRunBtn').click();
  await wait(100);
  return {
    errorShown: !doc.getElementById('projectQueryError').classList.contains('hidden'),
    errorText: doc.getElementById('projectQueryError').textContent,
    rowCountText: doc.getElementById('projectQueryRowCount').textContent,
    tableHTML: doc.getElementById('projectQueryResultsWrap').innerHTML,
    rows: Array.from(doc.querySelectorAll('#projectQueryResultsWrap tbody tr')).map(function(tr){
      return Array.from(tr.querySelectorAll('td')).map(function(td){ return td.textContent; });
    })
  };
}

(async () => {
  function log(label, ok, extra){ console.log((ok?'PASS':'FAIL') + ' - ' + label + (extra !== undefined ? ' :: ' + extra : '')); }

  {
    const r = await runQuery("SELECT * FROM tasks");
    log('SELECT * returns all 4 tasks', r.rows.length === 4, r.rows.length);
  }

  {
    const r = await runQuery("SELECT title, priority FROM tasks WHERE priority = 'high'");
    log('WHERE filters to the 3 high-priority tasks', r.rows.length === 3, r.rows.length);
  }

  {
    const r = await runQuery("SELECT title FROM tasks WHERE priority = 'high' AND taskCost > 5 OR title = 'Beta'");
    log('WHERE with AND/OR combination', r.rows.length === 4, JSON.stringify(r.rows));
  }

  {
    const r = await runQuery("SELECT title FROM tasks ORDER BY taskCost DESC");
    log('ORDER BY DESC sorts correctly', r.rows.map(function(row){ return row[0]; }).join(',') === 'Gamma,Alpha,Delta,Beta', JSON.stringify(r.rows));
  }

  {
    const r = await runQuery("SELECT TOP 2 title FROM tasks ORDER BY taskCost DESC");
    log('TOP(n) limits results', r.rows.length === 2, r.rows.length);
  }

  {
    const r = await runQuery("SELECT DISTINCT priority FROM tasks");
    log('DISTINCT dedupes priority values (2 distinct: high, low)', r.rows.length === 2, JSON.stringify(r.rows));
  }

  {
    // NB: "total" is an AlaSQL-reserved word and can't be used as a column alias (confirmed while
    // building this feature) — a real gotcha worth remembering for anyone extending this test file.
    const r = await runQuery("SELECT priority, COUNT(*) AS cnt, SUM(taskCost) AS totalCost, AVG(taskCost) AS avgCost FROM tasks GROUP BY priority ORDER BY priority");
    const highRow = r.rows.find(function(row){ return row[0] === 'high'; });
    log('COUNT/SUM/AVG with GROUP BY', highRow && highRow[1] === '3' && highRow[2] === '38', JSON.stringify(r.rows));
  }

  {
    const r = await runQuery("SELECT tasks.title, members.name FROM tasks INNER JOIN members ON tasks.assigneeId = members.id");
    log('INNER JOIN excludes unassigned Delta (3 rows)', r.rows.length === 3, JSON.stringify(r.rows));
  }

  {
    const r = await runQuery("SELECT tasks.title, members.name FROM tasks LEFT JOIN members ON tasks.assigneeId = members.id");
    log('LEFT JOIN keeps unassigned Delta with a null member (4 rows)', r.rows.length === 4, JSON.stringify(r.rows));
  }

  {
    const r = await runQuery("SELECT members.name, tasks.title FROM tasks RIGHT JOIN members ON tasks.assigneeId = members.id");
    log('RIGHT JOIN runs without error', !r.errorShown, r.errorText);
  }

  {
    const r = await runQuery("DROP TABLE tasks");
    log('DROP is rejected with a clear error', r.errorShown && /not permitted/.test(r.errorText), r.errorText);
  }
  {
    const r = await runQuery("DELETE FROM tasks WHERE id = 't1'");
    log('DELETE is rejected', r.errorShown && /not permitted/.test(r.errorText), r.errorText);
  }
  {
    const r = await runQuery("CREATE TABLE evil (id INT)");
    log('CREATE is rejected', r.errorShown && /not permitted/.test(r.errorText), r.errorText);
  }
  {
    const r = await runQuery("INSERT INTO tasks VALUES (1)");
    log('INSERT is rejected', r.errorShown && /not permitted/.test(r.errorText), r.errorText);
  }

  {
    const r = await runQuery("SELECT * FROM nope_not_a_table");
    log('unknown table produces an inline error, not a crash', r.errorShown, r.errorText);
  }

  console.log('\nQuery engine test complete.');
  process.exit(0);
})().catch(e => { console.error('CRASHED', e); process.exit(1); });
