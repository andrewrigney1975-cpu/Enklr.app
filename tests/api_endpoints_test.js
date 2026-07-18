const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync('../dist/index.html', 'utf8');
function wait(ms){ return new Promise(r => setTimeout(r, ms)); }

function makeFakeJwt(payload){
  var b64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return 'header.' + b64 + '.signature';
}

/* No prior test in this suite exercises a server-authoritative project's Saved Query flows over a
   real network call (see change_auditing_confirm_test.js's own note on why: no live backend in this
   harness). This one needs several real endpoints (project pull-on-login, saved-query update, test,
   and the post-mutation refresh) to actually round-trip consistently, so window.fetch is a small
   dispatcher keyed on method+path — `queries` is a shared, mutable array the PUT handler mutates and
   every GET-project-detail response reflects afterward, so a Delete's effect is visible on the very
   next refreshProjectFromServer() the same way it would be against a real API. */
function makeMockFetch(projectId, queries){
  function projectDetail(){
    return {
      id: projectId, name: 'Server Project', key: 'SRV',
      startDate: null, endDate: null, description: '',
      columns: [], tasks: [], members: [], releases: [], taskTypes: [],
      documents: [], risks: [], decisions: [], principles: [], objectives: [],
      teamsCommittees: [], retrospectives: [],
      savedQueries: queries.map(function(q){ return {id: q.id, name: q.name, sql: q.sql, dateCreated: '2026-01-01T00:00:00Z', exposeViaApi: q.exposeViaApi}; })
    };
  }
  return async function(url, options){
    var method = (options && options.method) || 'GET';
    if(url === '/health') return {ok: true, status: 200, json: async () => ({status: 'ok'})};
    if(url === '/api/projects' && method === 'GET'){
      return {ok: true, status: 200, json: async () => ([{id: projectId, name: 'Server Project', key: 'SRV'}])};
    }
    if(url === '/api/projects/' + projectId && method === 'GET'){
      return {ok: true, status: 200, json: async () => projectDetail()};
    }
    var testMatch = url.match(/^\/api\/projects\/[^/]+\/saved-queries\/([^/]+)\/test$/);
    if(testMatch && method === 'GET'){
      var q = queries.find(function(x){ return x.id === testMatch[1]; });
      if(!q || !q.exposeViaApi) return {ok: false, status: 404, json: async () => ({message: 'Not found.'})};
      return {ok: true, status: 200, json: async () => ({rows: [{one: 1}], truncated: false})};
    }
    var updateMatch = url.match(/^\/api\/projects\/[^/]+\/saved-queries\/([^/]+)$/);
    if(updateMatch && method === 'PUT'){
      var target = queries.find(function(x){ return x.id === updateMatch[1]; });
      if(!target) return {ok: false, status: 404, json: async () => ({message: 'Not found.'})};
      var body = JSON.parse(options.body);
      target.name = body.name; target.sql = body.sql; target.exposeViaApi = !!body.exposeViaApi;
      return {ok: true, status: 200, json: async () => ({id: target.id, name: target.name, sql: target.sql, dateCreated: '2026-01-01T00:00:00Z', exposeViaApi: target.exposeViaApi})};
    }
    return {ok: false, status: 404, json: async () => ({message: 'not found (unhandled mock url in test): ' + method + ' ' + url})};
  };
}

function seedDb(projectId){
  var proj = {
    id: projectId, serverProjectId: projectId, name: 'Server Project', key: 'SRV', taskCounter: 1,
    columns: [], tasks: {}, members: [], releases: [], taskTypes: [], savedQueries: [],
    startDate: null, endDate: null, description: '',
    dateCreated: '2025-01-01T00:00:00.000Z', dateLastModified: '2025-01-01T00:00:00.000Z', dateLastExported: null
  };
  return { projects: {}, projectOrder: [], currentProjectId: proj.id, _proj: proj };
}

(async () => {
  function log(label, ok, extra){ console.log((ok?'PASS':'FAIL') + ' - ' + label + (extra !== undefined ? ' :: ' + extra : '')); }
  var projectId = 'p1';

  // ── 1. Local-only project: button hidden regardless of anything else (never has exposed queries) ──
  {
    const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/', pretendToBeVisual: true });
    await wait(800);
    const doc = dom.window.document;
    log('local-only project: API Endpoints toolbar button hidden', doc.getElementById('apiEndpointsBtn').classList.contains('kf-vis-hidden'));
    log('local-only project: API Endpoints nav button hidden', doc.getElementById('navApiEndpointsBtn').classList.contains('kf-vis-hidden'));
  }

  // ── 2. Server-authoritative, PLAIN member (not admin), one exposed query exists: still hidden ──
  {
    const seed = seedDb(projectId);
    seed._proj.savedQueries = [{id: 'q1', name: 'Exposed Query', sql: 'SELECT 1 AS one', dateCreated: '2026-01-01T00:00:00Z', exposeViaApi: true}];
    seed.projects[projectId] = seed._proj;
    seed.projectOrder = [projectId];
    delete seed._proj;
    var queries = [{id: 'q1', name: 'Exposed Query', sql: 'SELECT 1 AS one', exposeViaApi: true}];

    const dom = new JSDOM(html, {
      runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/', pretendToBeVisual: true,
      beforeParse(w){
        w.localStorage.setItem('kanbanflow_v1_db', JSON.stringify(seed));
        w.localStorage.setItem('kanbanflow_server_jwt', makeFakeJwt({orgAdmin: 'false', projects: JSON.stringify([{ProjectId: projectId, Role: 'member', IsProjectAdmin: false}])}));
        w.fetch = makeMockFetch(projectId, queries);
      }
    });
    await wait(800);
    const doc = dom.window.document;
    log('plain member, exposed query exists: toolbar button STILL hidden (not Project Admin/Org Admin)', doc.getElementById('apiEndpointsBtn').classList.contains('kf-vis-hidden'));
  }

  // ── 3. Server-authoritative, Project Admin, but ZERO exposed queries: hidden ──
  {
    const seed = seedDb(projectId);
    seed._proj.savedQueries = [{id: 'q1', name: 'Hidden Query', sql: 'SELECT 1 AS one', dateCreated: '2026-01-01T00:00:00Z', exposeViaApi: false}];
    seed.projects[projectId] = seed._proj;
    seed.projectOrder = [projectId];
    delete seed._proj;
    var queries = [{id: 'q1', name: 'Hidden Query', sql: 'SELECT 1 AS one', exposeViaApi: false}];

    const dom = new JSDOM(html, {
      runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/', pretendToBeVisual: true,
      beforeParse(w){
        w.localStorage.setItem('kanbanflow_v1_db', JSON.stringify(seed));
        w.localStorage.setItem('kanbanflow_server_jwt', makeFakeJwt({orgAdmin: 'false', projects: JSON.stringify([{ProjectId: projectId, Role: 'member', IsProjectAdmin: true}])}));
        w.fetch = makeMockFetch(projectId, queries);
      }
    });
    await wait(800);
    const doc = dom.window.document;
    log('Project Admin, zero exposed queries: toolbar button hidden', doc.getElementById('apiEndpointsBtn').classList.contains('kf-vis-hidden'));
  }

  // ── 4. Server-authoritative, Project Admin, one exposed + one non-exposed query: full flow ──
  {
    const seed = seedDb(projectId);
    seed._proj.savedQueries = [
      {id: 'q1', name: 'Exposed Query', sql: 'SELECT 1 AS one', dateCreated: '2026-01-01T00:00:00Z', exposeViaApi: true},
      {id: 'q2', name: 'Hidden Query', sql: 'SELECT 2 AS two', dateCreated: '2026-01-01T00:00:00Z', exposeViaApi: false}
    ];
    seed.projects[projectId] = seed._proj;
    seed.projectOrder = [projectId];
    delete seed._proj;
    var queries = [
      {id: 'q1', name: 'Exposed Query', sql: 'SELECT 1 AS one', exposeViaApi: true},
      {id: 'q2', name: 'Hidden Query', sql: 'SELECT 2 AS two', exposeViaApi: false}
    ];

    const dom = new JSDOM(html, {
      runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/', pretendToBeVisual: true,
      beforeParse(w){
        w.localStorage.setItem('kanbanflow_v1_db', JSON.stringify(seed));
        w.localStorage.setItem('kanbanflow_server_jwt', makeFakeJwt({orgAdmin: 'false', projects: JSON.stringify([{ProjectId: projectId, Role: 'member', IsProjectAdmin: true}])}));
        w.fetch = makeMockFetch(projectId, queries);
        w.navigator.clipboard = { writeText: function(text){ w.__copiedText = text; return Promise.resolve(); } };
      }
    });
    await wait(800);
    const doc = dom.window.document;

    log('Project Admin, one exposed query: toolbar button visible', !doc.getElementById('apiEndpointsBtn').classList.contains('kf-vis-hidden'));
    log('Project Admin, one exposed query: nav button visible', !doc.getElementById('navApiEndpointsBtn').classList.contains('kf-vis-hidden'));

    doc.getElementById('apiEndpointsBtn').click();
    await wait(50);
    log('modal opens', !doc.getElementById('apiEndpointsOverlay').classList.contains('hidden'));

    const rows = doc.querySelectorAll('#apiEndpointsList .kf-api-endpoint-row');
    log('list shows exactly one row (only the exposed query)', rows.length === 1, rows.length);
    log('the listed row is the exposed query, not the hidden one', doc.getElementById('apiEndpointsList').textContent.indexOf('Exposed Query') !== -1 &&
        doc.getElementById('apiEndpointsList').textContent.indexOf('Hidden Query') === -1);

    log('test-results panel starts collapsed (not in the DOM at all)', doc.querySelector('[data-test-panel-id="q1"]') === null);

    // Re-queried fresh before each click (not cached across renders) — renderApiEndpointsList()
    // replaces #apiEndpointsList's innerHTML wholesale on every toggle, so a chevron reference
    // captured before the first click is a detached node by the time of the second: clicking it
    // would fire an event with nowhere to bubble to, never reaching the delegated container listener.
    doc.querySelector('[data-toggle-id="q1"]').click();
    await wait(20);
    log('chevron expands the (empty, not-yet-run) test panel', doc.querySelector('[data-test-panel-id="q1"]') !== null);
    doc.querySelector('[data-toggle-id="q1"]').click();
    await wait(20);
    log('chevron collapses it again', doc.querySelector('[data-test-panel-id="q1"]') === null);

    doc.querySelector('[data-test-id="q1"]').click();
    await wait(10);
    log('clicking Test auto-expands the panel', doc.querySelector('[data-test-panel-id="q1"]') !== null);
    await wait(60);
    const statusEl = doc.querySelector('[data-test-status-id="q1"]');
    log('Test succeeds and shows a 200 OK status', statusEl.textContent.indexOf('200 OK') !== -1, statusEl.textContent);
    log('Test result pane contains the mocked row JSON', doc.querySelector('[data-test-result-id="q1"]').textContent.indexOf('"one": 1') !== -1);

    doc.querySelector('[data-copy-id="q1"]').click();
    await wait(20);
    log('Copy URL writes the query\'s public URL to the clipboard', dom.window.__copiedText === (dom.window.location.origin + '/api/public/v1/queries/q1/results'), dom.window.__copiedText);

    doc.querySelector('[data-delete-id="q1"]').click();
    await wait(20);
    log('Delete opens a confirm dialog rather than acting immediately', !doc.getElementById('confirmOverlay').classList.contains('hidden'));
    log('the query is still listed until the delete is confirmed', doc.querySelectorAll('#apiEndpointsList .kf-api-endpoint-row').length === 1);

    doc.getElementById('confirmOkBtn').click();
    await wait(80);
    log('confirming removes the row from the list immediately', doc.querySelectorAll('#apiEndpointsList .kf-api-endpoint-row').length === 0);
    log('the saved query itself still exists (only ExposeViaApi was unset)', queries.find(function(q){ return q.id === 'q1'; }) !== undefined);
    log('ExposeViaApi was actually unset on the server (mock)', queries.find(function(q){ return q.id === 'q1'; }).exposeViaApi === false);
    log('the toolbar button hides itself once no queries remain exposed', doc.getElementById('apiEndpointsBtn').classList.contains('kf-vis-hidden'));
  }

  console.log('\nAPI Endpoints test complete.');
  process.exit(0);
})();
