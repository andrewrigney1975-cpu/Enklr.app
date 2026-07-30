const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync('../dist/index.html', 'utf8');
function wait(ms){ return new Promise(r => setTimeout(r, ms)); }

function makeFakeJwt(payload){
  var b64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return 'header.' + b64 + '.signature';
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
    log('Import Data tab shows the "coming soon" placeholder text', doc.getElementById('importCentreImportView').textContent.indexOf('later phase') !== -1);

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
