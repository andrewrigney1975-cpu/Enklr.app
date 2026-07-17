const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync('../dist/index.html', 'utf8');
function wait(ms){ return new Promise(r => setTimeout(r, ms)); }

function makeFakeJwt(payload){
  var b64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return 'header.' + b64 + '.signature';
}

(async () => {
  function log(label, ok, extra){ console.log((ok?'PASS':'FAIL') + ' - ' + label + (extra !== undefined ? ' :: ' + extra : '')); }

  // ── 1. Local-only project (never logged in): tab visible, defaults to Search view ──────
  {
    const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/', pretendToBeVisual: true });
    await wait(800);
    const doc = dom.window.document;
    doc.getElementById('projectSearchBtn').click();
    await wait(50);
    log('opens on the Search tab by default', doc.getElementById('projectSearchTabSearchBtn').classList.contains('active'));
    log('Advanced Query tab visible for a local-only session', !doc.getElementById('projectSearchTabQueryBtn').classList.contains('kf-vis-hidden'));
  }

  // ── 2. A SERVER-AUTHORITATIVE project, logged in but NOT an admin: tab hidden, switch
  //      blocked. (A local-only project is unrestricted for everyone regardless of login state —
  //      canCurrentUserManageProject()'s documented exemption, same as every other permission gate
  //      in this app — so this scenario needs a project that's actually server-linked to be
  //      meaningful; the seeded default Sample Project is local-only.) ─────────────────────────
  {
    const proj = {
      id: 'p1', serverProjectId: 'p1', name: 'Server Project', key: 'SRV', taskCounter: 1,
      columns: [{ id: 'col1', name: 'To Do', done: false, order: [] }],
      tasks: {}, members: [], releases: [], taskTypes: [],
      startDate: null, endDate: null, description: '',
      dateCreated: '2025-01-01T00:00:00.000Z', dateLastModified: '2025-01-01T00:00:00.000Z', dateLastExported: null
    };
    const db = { projects: { p1: proj }, projectOrder: ['p1'], currentProjectId: 'p1' };
    const dom = new JSDOM(html, {
      runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/', pretendToBeVisual: true,
      beforeParse(w){
        w.localStorage.setItem('kanbanflow_v1_db', JSON.stringify(db));
        w.localStorage.setItem('kanbanflow_server_jwt', makeFakeJwt({orgAdmin: 'false', projects: '[]'}));
      }
    });
    await wait(800);
    const doc = dom.window.document;
    doc.getElementById('projectSearchBtn').click();
    await wait(50);
    log('Advanced Query tab hidden for a logged-in non-admin on a server project', doc.getElementById('projectSearchTabQueryBtn').classList.contains('kf-vis-hidden'));

    doc.getElementById('projectSearchTabQueryBtn').click();
    await wait(50);
    log('switching to Query view is blocked (defense in depth, not just a hidden button)',
        doc.getElementById('projectSearchQueryView').classList.contains('hidden'));
  }

  // ── 3. Logged in AND an org admin: full flow, including tab switching back ──────────────
  {
    const dom = new JSDOM(html, {
      runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/', pretendToBeVisual: true,
      beforeParse(w){ w.localStorage.setItem('kanbanflow_server_jwt', makeFakeJwt({orgAdmin: 'true'})); }
    });
    await wait(800);
    const doc = dom.window.document;
    doc.getElementById('projectSearchBtn').click();
    await wait(50);
    log('Advanced Query tab visible for a logged-in org admin', !doc.getElementById('projectSearchTabQueryBtn').classList.contains('kf-vis-hidden'));

    doc.getElementById('projectSearchTabQueryBtn').click();
    await wait(50);
    log('Query view shown', !doc.getElementById('projectSearchQueryView').classList.contains('hidden'));
    log('Simple view hidden', doc.getElementById('projectSearchSimpleView').classList.contains('hidden'));
    log('Query footer shown (Export CSV / Print / Done)', !doc.getElementById('projectSearchQueryFooter').classList.contains('hidden'));
    log('Simple footer hidden', doc.getElementById('projectSearchSimpleFooter').classList.contains('hidden'));

    log('Export CSV button exists and is wired', doc.getElementById('projectQueryExportCsvBtn') !== null);
    log('Print button exists and is wired', doc.getElementById('projectQueryPrintBtn') !== null);

    // Schema reference panel
    log('schema panel starts hidden', doc.getElementById('projectQuerySchemaPanel').classList.contains('hidden'));
    doc.getElementById('projectQuerySchemaToggleBtn').click();
    await wait(50);
    log('schema panel toggles open and lists the tasks table', !doc.getElementById('projectQuerySchemaPanel').classList.contains('hidden') &&
        doc.getElementById('projectQuerySchemaPanel').textContent.indexOf('tasks') !== -1);

    // Run a real query against the seeded sample project and export it
    doc.getElementById('projectQuerySql').value = 'SELECT * FROM tasks';
    doc.getElementById('projectQueryRunBtn').click();
    await wait(100);
    const rowCount = doc.querySelectorAll('#projectQueryResultsWrap tbody tr').length;
    log('running a real query against the seeded project returns rows', rowCount > 0, rowCount);

    // CSV export uses Blob/createObjectURL/anchor-click, none of which jsdom implements fully —
    // stub them the same way this suite already handles browser APIs jsdom lacks, and just confirm
    // the export path runs without throwing and produces a download attempt.
    let downloadedFilename = null;
    dom.window.URL.createObjectURL = () => 'blob://fake';
    dom.window.URL.revokeObjectURL = () => {};
    const origCreateElement = doc.createElement.bind(doc);
    doc.createElement = function(tag){
      const el = origCreateElement(tag);
      if(tag === 'a'){
        const origClick = el.click.bind(el);
        el.click = function(){ downloadedFilename = el.download; };
      }
      return el;
    };
    doc.getElementById('projectQueryExportCsvBtn').click();
    await wait(50);
    log('Export CSV triggers a download with a .csv filename', !!downloadedFilename && /\.csv$/.test(downloadedFilename), downloadedFilename);

    // window.print isn't implemented in jsdom — stub it and confirm the button calls it.
    let printCalled = false;
    dom.window.print = function(){ printCalled = true; };
    doc.getElementById('projectQueryPrintBtn').click();
    log('Print button calls window.print()', printCalled);

    // Switching back to Search restores the original view
    doc.getElementById('projectSearchTabSearchBtn').click();
    await wait(50);
    log('switching back to Search tab restores the simple view', !doc.getElementById('projectSearchSimpleView').classList.contains('hidden'));
  }

  console.log('\nProject Search Advanced Query test complete.');
  process.exit(0);
})().catch(e => { console.error('CRASHED', e); process.exit(1); });
