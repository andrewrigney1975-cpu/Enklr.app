const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync('../dist/index.html', 'utf8');
function wait(ms){ return new Promise(r => setTimeout(r, ms)); }

function makeFakeJwt(payload){
  var b64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return 'header.' + b64 + '.signature';
}

// Same fake File/FileReader pattern as app_settings_test.js's own import flow — jsdom's real
// FileReader doesn't actually read a File's content, so a minimal stand-in is needed.
class FakeFile { constructor(text, name){ this._text = text; this.name = name; } }
function installFakeFileReader(window){
  window.FileReader = class {
    readAsText(f){ const s = this; setTimeout(() => { s.result = f._text; if(s.onload) s.onload(); }, 0); }
  };
}

function seedDb(projectId, headerButtonVisibility){
  var proj = {
    id: projectId, serverProjectId: projectId, name: 'Server Project', key: 'SRV', taskCounter: 1,
    columns: [], tasks: {}, members: [], releases: [], taskTypes: [], savedQueries: [],
    startDate: null, endDate: null, description: '',
    headerButtonVisibility: headerButtonVisibility || {},
    dateCreated: '2025-01-01T00:00:00.000Z', dateLastModified: '2025-01-01T00:00:00.000Z', dateLastExported: null
  };
  return { projects: {}, projectOrder: [], currentProjectId: proj.id, _proj: proj };
}

function openAppSettings(doc){
  doc.getElementById('appSettingsBtn').click();
}

(async () => {
  function log(label, ok, extra){ console.log((ok?'PASS':'FAIL') + ' - ' + label + (extra !== undefined ? ' :: ' + extra : '')); }
  var projectId = 'p1';

  // ── 1. Local-only project: Enterprise category (and Import Centre row inside it) hidden ──
  {
    const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/', pretendToBeVisual: true });
    await wait(300);
    const doc = dom.window.document;
    openAppSettings(doc);
    await wait(20);
    log('local-only project: Enterprise category hidden', doc.getElementById('appSettingsEnterpriseCategory').classList.contains('hidden'));
  }

  // ── 2. Server-authoritative, plain member (not Org Admin): Enterprise category still hidden ──
  {
    const seed = seedDb(projectId);
    seed.projects[projectId] = seed._proj;
    seed.projectOrder = [projectId];
    delete seed._proj;

    const dom = new JSDOM(html, {
      runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/', pretendToBeVisual: true,
      beforeParse(w){
        w.localStorage.setItem('kanbanflow_v1_db', JSON.stringify(seed));
        w.localStorage.setItem('kanbanflow_server_jwt', makeFakeJwt({orgAdmin: 'false', projects: JSON.stringify([{ProjectId: projectId, Role: 'member', IsProjectAdmin: false}])}));
      }
    });
    await wait(300);
    const doc = dom.window.document;
    openAppSettings(doc);
    await wait(20);
    log('plain member: Enterprise category still hidden (not Org Admin)', doc.getElementById('appSettingsEnterpriseCategory').classList.contains('hidden'));
  }

  // ── 3. Server-authoritative, Org Admin, Portals NOT enabled: Import Centre visible, only 3 schema blocks ──
  {
    const seed = seedDb(projectId, {forms: false, portals: false});
    seed.projects[projectId] = seed._proj;
    seed.projectOrder = [projectId];
    delete seed._proj;

    let mockImportResult = {
      total: 2, succeeded: 1, failed: 1,
      results: [
        {row: 1, success: true, message: null, data: {username: 'jdoe', displayName: 'J Doe', password: 'Secret123!', email: 'jdoe@example.com'}},
        {row: 2, success: false, message: '"password" is required.', data: {username: 'asmith', displayName: 'A Smith', email: 'asmith@example.com'}}
      ]
    };
    let lastImportRequestBody = null;
    let lastImportUrl = null;
    let mockTeamMembersResult = {
      total: 1, succeeded: 1, failed: 0,
      results: [{row: 1, success: true, message: null, data: {projectKey: 'DEMO', name: 'New Member'}}]
    };

    const dom = new JSDOM(html, {
      runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/', pretendToBeVisual: true,
      beforeParse(w){
        w.localStorage.setItem('kanbanflow_v1_db', JSON.stringify(seed));
        w.localStorage.setItem('kanbanflow_server_jwt', makeFakeJwt({orgAdmin: 'true', projects: JSON.stringify([{ProjectId: projectId, Role: 'member', IsProjectAdmin: false}])}));
        installFakeFileReader(w);
        w.fetch = async function(url, options){
          lastImportUrl = url;
          if(url === '/api/organisations/me/import/organisation-users' && options && options.method === 'POST'){
            lastImportRequestBody = JSON.parse(options.body);
            return {ok: true, status: 200, json: async () => mockImportResult};
          }
          if(url === '/api/organisations/me/import/team-members' && options && options.method === 'POST'){
            lastImportRequestBody = JSON.parse(options.body);
            return {ok: true, status: 200, json: async () => mockTeamMembersResult};
          }
          throw new Error('unhandled fetch in test: ' + url);
        };
      }
    });
    await wait(300);
    const doc = dom.window.document;

    openAppSettings(doc);
    await wait(20);
    log('Org Admin: Enterprise category visible', !doc.getElementById('appSettingsEnterpriseCategory').classList.contains('hidden'));
    log('Import Centre row is present', !!doc.getElementById('appSettingsImportCentreBtn'));

    // Enterprise category's 2-column layout is two explicit .kf-settings-category-col containers
    // (uneven lengths: left has 2 rows, right has 3), not a single grid over a flat row list — so
    // column membership is read directly from which wrapper div each row actually lives in.
    const cols = doc.querySelectorAll('#appSettingsEnterpriseCategory .kf-settings-category-col');
    const leftColRows = Array.from(cols[0].querySelectorAll('.kf-setting-row')).map(function(r){ return r.querySelector('.kf-setting-row-title').textContent; });
    const rightColRows = Array.from(cols[1].querySelectorAll('.kf-setting-row')).map(function(r){ return r.querySelector('.kf-setting-row-title').textContent; });
    log('left column: SSO, Import Centre', JSON.stringify(leftColRows) === JSON.stringify(['Authentication and Provisioning', 'Import Centre']), leftColRows.join(' | '));
    log('right column: Portfolio Planner, Forms & Workflow, Portals', JSON.stringify(rightColRows) === JSON.stringify(['Portfolio Planner', 'Forms & Workflow', 'Portals']), rightColRows.join(' | '));

    // Real regression: .kf-settings-category-body's base rule sets flex-direction:column, and CSS
    // cascades per-PROPERTY, not per-rule — .kf-settings-category-body-2col "winning" on the
    // properties it DOES set doesn't un-set flex-direction unless it's set explicitly too. Without
    // it, both .kf-settings-category-col wrappers stacked vertically into one visual column instead
    // of sitting side by side (caught from a live screenshot, not by this suite — worth asserting
    // the actual computed value so it can't silently regress again).
    const twoColDisplay = dom.window.getComputedStyle(doc.querySelector('#appSettingsEnterpriseCategory .kf-settings-category-body-2col'));
    log('Enterprise 2-col container is a row-direction flex container (columns sit side by side)', twoColDisplay.display === 'flex' && twoColDisplay.flexDirection === 'row',
        `display=${twoColDisplay.display} flexDirection=${twoColDisplay.flexDirection}`);

    doc.getElementById('appSettingsImportCentreBtn').click();
    await wait(20);
    log('clicking Open Import Centre closes App Settings and opens the Import Centre modal',
        doc.getElementById('appSettingsOverlay').classList.contains('hidden') && !doc.getElementById('importCentreOverlay').classList.contains('hidden'));
    // Checks ACTUAL computed visibility, not just classList state — a bare `.hidden` class does
    // nothing anywhere in this app's CSS unless a compound selector like `.kf-import-centre-view.
    // hidden` exists for it (root CLAUDE.md's own documented gotcha); this is exactly the kind of
    // regression a classList-only assertion would miss, since toggling the class "succeeds" either way.
    const importDisplay = dom.window.getComputedStyle(doc.getElementById('importCentreImportView')).display;
    const schemasDisplay = dom.window.getComputedStyle(doc.getElementById('importCentreSchemasView')).display;
    log('modal opens on the Import Data tab by default', doc.getElementById('importCentreTabImportBtn').classList.contains('active') &&
        importDisplay !== 'none' && schemasDisplay === 'none', `import=${importDisplay} schemas=${schemasDisplay}`);
    log('Import Data tab defaults to Organisation Users, with the real upload area visible (not "coming soon")',
        doc.getElementById('importCentreEntitySelect').value === 'organisationUsers' &&
        doc.getElementById('importCentreComingSoonHint').classList.contains('kf-vis-hidden') &&
        !doc.getElementById('importCentreUploadArea').classList.contains('kf-vis-hidden'));

    // Switching to an entity with no backend yet shows the "coming soon" note instead of the upload area.
    doc.getElementById('importCentreEntitySelect').value = 'teamsCommittees';
    doc.getElementById('importCentreEntitySelect').dispatchEvent(new dom.window.Event('change', {bubbles: true}));
    await wait(10);
    log('Teams & Committees (not wired up yet) shows the "coming soon" note, hides the upload area',
        !doc.getElementById('importCentreComingSoonHint').classList.contains('kf-vis-hidden') &&
        doc.getElementById('importCentreUploadArea').classList.contains('kf-vis-hidden'));
    log('"coming soon" note mentions the Schemas tab', doc.getElementById('importCentreComingSoonHint').textContent.indexOf('Schemas') !== -1);

    // Team Members (Phase 4) is wired up too — same generic upload area, no "coming soon" note.
    doc.getElementById('importCentreEntitySelect').value = 'teamMembers';
    doc.getElementById('importCentreEntitySelect').dispatchEvent(new dom.window.Event('change', {bubbles: true}));
    await wait(10);
    log('Team Members (wired up in Phase 4) shows the real upload area, not "coming soon"',
        doc.getElementById('importCentreComingSoonHint').classList.contains('kf-vis-hidden') &&
        !doc.getElementById('importCentreUploadArea').classList.contains('kf-vis-hidden'));

    // Team Members Test Run posts to its OWN endpoint, not Organisation Users' — a real thing to
    // get wrong when a new entity is wired up via the same generic upload/Test Run/Commit UI.
    const teamMembersFileInput = doc.getElementById('importCentreFileInput');
    Object.defineProperty(teamMembersFileInput, 'files', {value: [new FakeFile('projectKey,name,email\r\nDEMO,New Member,new.member@example.com\r\n', 'members.csv')], configurable: true});
    teamMembersFileInput.dispatchEvent(new dom.window.Event('change', {bubbles: true}));
    await wait(30);
    doc.getElementById('importCentreTestRunBtn').click();
    await wait(30);
    log('Team Members Test Run posts to the team-members endpoint, not organisation-users', lastImportUrl === '/api/organisations/me/import/team-members', lastImportUrl);
    log('Team Members Test Run sends the parsed projectKey/name/email row', lastImportRequestBody && lastImportRequestBody.rows[0].projectKey === 'DEMO' && lastImportRequestBody.rows[0].name === 'New Member', JSON.stringify(lastImportRequestBody));
    log('Team Members results render using the same generic results table', doc.querySelectorAll('#importCentreResultsList tbody tr').length === 1);

    // Switch back to Organisation Users for the real upload flow below.
    doc.getElementById('importCentreEntitySelect').value = 'organisationUsers';
    doc.getElementById('importCentreEntitySelect').dispatchEvent(new dom.window.Event('change', {bubbles: true}));
    await wait(10);

    // ── File upload -> Test Run -> Commit, Organisation Users ─────────────────────────────────
    log('Test Run button starts disabled with nothing uploaded yet', doc.getElementById('importCentreTestRunBtn').disabled);
    log('Commit button starts disabled', doc.getElementById('importCentreCommitBtn').disabled);

    const csvText = 'username,displayName,password,email\r\njdoe,J Doe,Secret123!,jdoe@example.com\r\nasmith,A Smith,,asmith@example.com\r\n';
    const fileInput = doc.getElementById('importCentreFileInput');
    Object.defineProperty(fileInput, 'files', {value: [new FakeFile(csvText, 'users.csv')], configurable: true});
    fileInput.dispatchEvent(new dom.window.Event('change', {bubbles: true}));
    await wait(30);

    log('parsing a CSV file reports the row count and detected format', doc.getElementById('importCentreFileStatus').textContent.indexOf('Parsed 2 rows') !== -1 &&
        doc.getElementById('importCentreFileStatus').textContent.indexOf('CSV') !== -1, doc.getElementById('importCentreFileStatus').textContent);
    log('Test Run becomes enabled once a file is parsed', !doc.getElementById('importCentreTestRunBtn').disabled);
    log('Commit stays disabled until a Test Run has actually been run', doc.getElementById('importCentreCommitBtn').disabled);

    doc.getElementById('importCentreTestRunBtn').click();
    await wait(30);

    log('Test Run sends dryRun:true', lastImportRequestBody && lastImportRequestBody.dryRun === true, JSON.stringify(lastImportRequestBody));
    log('Test Run sends the 2 parsed rows, matching the CSV content', lastImportRequestBody && lastImportRequestBody.rows.length === 2 &&
        lastImportRequestBody.rows[0].username === 'jdoe' && lastImportRequestBody.rows[1].username === 'asmith', JSON.stringify(lastImportRequestBody && lastImportRequestBody.rows));
    log('results panel becomes visible after a Test Run', !doc.getElementById('importCentreResultsWrap').classList.contains('kf-vis-hidden'));
    log('results summary says "Test Run" and reflects 1 succeeded / 1 failed', doc.getElementById('importCentreResultsSummary').textContent.indexOf('Test Run') !== -1 &&
        doc.getElementById('importCentreResultsSummary').textContent.indexOf('1 of 2') !== -1 &&
        doc.getElementById('importCentreResultsSummary').textContent.indexOf('1 failed') !== -1, doc.getElementById('importCentreResultsSummary').textContent);

    const resultRows = doc.querySelectorAll('#importCentreResultsList tbody tr');
    log('results table has one row per submitted row', resultRows.length === 2, resultRows.length);
    log('row 1 shows OK', resultRows[0].textContent.indexOf('OK') !== -1);
    log('row 2 shows Failed with its error message', resultRows[1].textContent.indexOf('Failed') !== -1 && resultRows[1].textContent.indexOf('"password" is required') !== -1, resultRows[1].textContent);
    log('Commit becomes enabled after a Test Run with at least one succeeding row', !doc.getElementById('importCentreCommitBtn').disabled);

    doc.getElementById('importCentreCommitBtn').click();
    await wait(20);
    log('clicking Commit opens a confirm dialog rather than committing immediately', !doc.getElementById('confirmOverlay').classList.contains('hidden'));
    log('the confirm dialog mentions the row count and the filename', doc.getElementById('confirmMessage').textContent.indexOf('2 rows') !== -1 &&
        doc.getElementById('confirmMessage').textContent.indexOf('users.csv') !== -1, doc.getElementById('confirmMessage').textContent);

    doc.getElementById('confirmOkBtn').click();
    await wait(30);
    log('confirming sends dryRun:false to the same endpoint', lastImportRequestBody && lastImportRequestBody.dryRun === false, JSON.stringify(lastImportRequestBody));
    log('results summary now says "Committed"', doc.getElementById('importCentreResultsSummary').textContent.indexOf('Committed') !== -1, doc.getElementById('importCentreResultsSummary').textContent);

    // A new file selection resets Test Run/Commit state (can't Commit a row set that was never re-validated).
    Object.defineProperty(fileInput, 'files', {value: [new FakeFile('username,displayName,password,email\r\nnewrow,New Row,Secret123!,newrow@example.com\r\n', 'more.csv')], configurable: true});
    fileInput.dispatchEvent(new dom.window.Event('change', {bubbles: true}));
    await wait(30);
    log('selecting a new file resets Commit back to disabled until a fresh Test Run', doc.getElementById('importCentreCommitBtn').disabled);
    log('selecting a new file clears the previous results panel', doc.getElementById('importCentreResultsWrap').classList.contains('kf-vis-hidden'));

    // A .json file (array of row objects) is detected and parsed just as well as CSV.
    const jsonText = JSON.stringify([
      {username: 'jsmith', displayName: 'J Smith', password: 'Secret123!', email: 'jsmith@example.com'},
      {username: 'bwong', displayName: 'B Wong', password: 'Secret123!', email: 'bwong@example.com'},
      {username: 'ktan', displayName: 'K Tan', password: 'Secret123!', email: 'ktan@example.com'}
    ]);
    Object.defineProperty(fileInput, 'files', {value: [new FakeFile(jsonText, 'users.json')], configurable: true});
    fileInput.dispatchEvent(new dom.window.Event('change', {bubbles: true}));
    await wait(30);
    log('a .json file is detected and parsed as JSON, not CSV', doc.getElementById('importCentreFileStatus').textContent.indexOf('Parsed 3 rows') !== -1 &&
        doc.getElementById('importCentreFileStatus').textContent.indexOf('JSON') !== -1, doc.getElementById('importCentreFileStatus').textContent);

    doc.getElementById('importCentreTestRunBtn').click();
    await wait(30);
    log('the JSON rows are sent through exactly like CSV rows', lastImportRequestBody && lastImportRequestBody.rows.length === 3 &&
        lastImportRequestBody.rows[1].username === 'bwong', JSON.stringify(lastImportRequestBody && lastImportRequestBody.rows));

    doc.getElementById('importCentreTabSchemasBtn').click();
    await wait(20);
    const importDisplay2 = dom.window.getComputedStyle(doc.getElementById('importCentreImportView')).display;
    const schemasDisplay2 = dom.window.getComputedStyle(doc.getElementById('importCentreSchemasView')).display;
    log('Schemas tab becomes active and actually visible (Import Data actually hidden)', doc.getElementById('importCentreTabSchemasBtn').classList.contains('active') &&
        schemasDisplay2 !== 'none' && importDisplay2 === 'none', `import=${importDisplay2} schemas=${schemasDisplay2}`);

    const blocks = doc.querySelectorAll('#importCentreSchemasList .kf-import-schema-block');
    log('3 schema blocks shown when Portals is not enabled (Organisation Users, Team Members, Teams & Committees)', blocks.length === 3, blocks.length);
    log('Portal Q&A is NOT among them', doc.getElementById('importCentreSchemasList').textContent.indexOf('Portal Q&A') === -1);
    log('Organisation Users schema block is present', doc.getElementById('importCentreSchemasList').textContent.indexOf('Organisation Users') !== -1);

    // Required/optional/conditional badges render distinctly.
    const requiredBadges = doc.querySelectorAll('.kf-import-required-yes');
    const conditionalBadges = doc.querySelectorAll('.kf-import-required-conditional');
    const optionalBadges = doc.querySelectorAll('.kf-import-required-no');
    log('at least one Required badge rendered', requiredBadges.length > 0, requiredBadges.length);
    log('at least one Conditional badge rendered (Organisation Users\' email)', conditionalBadges.length > 0, conditionalBadges.length);
    log('at least one Optional badge rendered', optionalBadges.length > 0, optionalBadges.length);

    // Downloads: stub Blob/createObjectURL/anchor-click the same way this suite's other download
    // tests do (jsdom doesn't implement real Blob-to-URL/anchor-download behavior).
    let lastBlobText = null;
    let downloadedFilename = null;
    dom.window.URL.createObjectURL = () => 'blob://fake';
    dom.window.URL.revokeObjectURL = () => {};
    const OrigBlob = dom.window.Blob;
    dom.window.Blob = function(parts, opts){ lastBlobText = parts[0]; return new OrigBlob(parts, opts); };
    const origCreateElement = doc.createElement.bind(doc);
    doc.createElement = function(tag){
      const el = origCreateElement(tag);
      if(tag === 'a'){ el.click = function(){ downloadedFilename = el.download; }; }
      return el;
    };

    doc.querySelector('[data-csv-id="organisationUsers"]').click();
    await wait(20);
    log('Download CSV template triggers a .csv download', !!downloadedFilename && /^organisationUsers-import-template\.csv$/.test(downloadedFilename), downloadedFilename);
    log('CSV template content is a header row of the schema\'s field names', lastBlobText === 'username,displayName,password,email\r\n', lastBlobText);

    downloadedFilename = null;
    doc.querySelector('[data-json-id="organisationUsers"]').click();
    await wait(20);
    log('Download JSON schema triggers a .json download', !!downloadedFilename && /^organisationUsers-import-schema\.json$/.test(downloadedFilename), downloadedFilename);
    const parsedSchema = JSON.parse(lastBlobText);
    log('JSON schema is a real parsed array with 4 fields', Array.isArray(parsedSchema) && parsedSchema.length === 4, JSON.stringify(parsedSchema.map(f => f.field)));
    log('JSON schema marks "email" as conditional', parsedSchema.find(f => f.field === 'email').required === 'conditional');
    log('JSON schema marks "username" as required:true', parsedSchema.find(f => f.field === 'username').required === true);

    // Close paths.
    doc.getElementById('importCentreClose').click();
    await wait(20);
    log('close button closes the modal', doc.getElementById('importCentreOverlay').classList.contains('hidden'));

    doc.getElementById('appSettingsImportCentreBtn').click();
    await wait(20);
    dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
    await wait(20);
    log('Escape closes the modal', doc.getElementById('importCentreOverlay').classList.contains('hidden'));
  }

  // ── 4. Server-authoritative, Org Admin, Portals enabled: Portal Q&A schema block appears too ──
  {
    const seed = seedDb(projectId, {forms: true, portals: true});
    seed.projects[projectId] = seed._proj;
    seed.projectOrder = [projectId];
    delete seed._proj;

    const dom = new JSDOM(html, {
      runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/', pretendToBeVisual: true,
      beforeParse(w){
        w.localStorage.setItem('kanbanflow_v1_db', JSON.stringify(seed));
        w.localStorage.setItem('kanbanflow_server_jwt', makeFakeJwt({orgAdmin: 'true', projects: JSON.stringify([{ProjectId: projectId, Role: 'member', IsProjectAdmin: false}])}));
      }
    });
    await wait(300);
    const doc = dom.window.document;

    openAppSettings(doc);
    await wait(20);
    doc.getElementById('appSettingsImportCentreBtn').click();
    await wait(20);
    doc.getElementById('importCentreTabSchemasBtn').click();
    await wait(20);

    const blocks = doc.querySelectorAll('#importCentreSchemasList .kf-import-schema-block');
    log('4 schema blocks shown once Portals is enabled', blocks.length === 4, blocks.length);
    log('Portal Q&A schema block is now present', doc.getElementById('importCentreSchemasList').textContent.indexOf('Portal Q&A') !== -1);
  }

  console.log('\nImport Centre test complete.');
  process.exit(0);
})();
