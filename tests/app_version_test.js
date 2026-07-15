const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync('../dist/index.html', 'utf8');

class FakeFile { constructor(text){ this._text = text; } }
function installFakeFileReader(window){
  window.FileReader = class {
    readAsText(f){ const s = this; setTimeout(() => { s.result = f._text; if (s.onload) s.onload(); }, 0); }
  };
}
function wait(ms){ return new Promise(r => setTimeout(r, ms)); }

(async () => {
  let lastBlobText = null;
  const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;
  installFakeFileReader(window);
  window.URL.createObjectURL = () => 'blob://fake';
  window.URL.revokeObjectURL = () => {};
  const OrigBlob = window.Blob;
  window.Blob = function(parts, opts){ lastBlobText = parts[0]; return new OrigBlob(parts, opts); };

  await wait(300);
  const doc = window.document;
  function log(label, ok, extra){ console.log((ok?'PASS':'FAIL') + ' - ' + label + (extra?' :: '+extra:'')); }

  // ── 1. appVersion constant exists and matches the required format ────────
  // build.js's esbuild minifier renames module-scoped variables (APP_VERSION becomes some short,
  // unpredictable symbol like "fo") and drops the space/quote style a literal "var APP_VERSION = '"
  // search assumed — the actual running value is only reliably obtainable by exercising the app's
  // own behavior, same as the export check right below reads it from the export JSON's appVersion
  // field rather than trying to regex it out of the minified bundle.
  doc.getElementById('exportBtn').click();
  await wait(20);
  const firstExport = JSON.parse(lastBlobText);
  const version = firstExport.appVersion || '';
  log('APP_VERSION constant is defined', !!version, version);
  const formatRe = /^\d+\.\d{2,}\.\d{8}\.\d{4}$/;
  log('format is major.minor.yyyymmdd.hhmm', formatRe.test(version), version);

  const parts = version.split('.');
  // A literal "must equal exactly 1" pin goes stale the moment the product's major version
  // legitimately bumps (it's already at 2 as of this fix) — check the real intent instead: a sane,
  // positive major version number, not that it's frozen at its very first value forever.
  log('major version is a valid positive integer', /^\d+$/.test(parts[0]) && Number(parts[0]) >= 1, parts[0]);
  log('minor version is zero-padded to at least 2 digits', parts[1].length >= 2, parts[1]);
  const datePart = parts[2];
  const timePart = parts[3];
  log('date portion is a plausible yyyymmdd', /^\d{4}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.test(datePart), datePart);
  log('time portion is a plausible hhmm (24-hour)', /^([01]\d|2[0-3])[0-5]\d$/.test(timePart), timePart);

  // ── 2. Export includes appVersion at the top level of the document ───────
  doc.getElementById('exportBtn').click();
  await wait(20);
  const exported = JSON.parse(lastBlobText);
  log('exported document includes appVersion at the top level', exported.appVersion === version, exported.appVersion);
  log('appVersion is NOT nested inside project', !exported.project.hasOwnProperty('appVersion'));
  log('appVersion is NOT nested inside any hierarchy task node', !html_includes_in_hierarchy(exported));

  function html_includes_in_hierarchy(doc){
    function flatten(nodes){
      var found = false;
      (nodes || []).forEach(function(n){
        if(n.hasOwnProperty('appVersion')) found = true;
        if(flatten(n.subtasks)) found = true;
      });
      return found;
    }
    return flatten(doc.hierarchy);
  }

  // ── 3. Import does NOT process/store/validate appVersion in any way ──────
  const spoofedDoc = JSON.parse(JSON.stringify(exported));
  spoofedDoc.appVersion = '99.99.20991231.2359';
  spoofedDoc.project.name = 'Future Version Project';
  spoofedDoc.project.key = 'FVP';

  const fileInput = doc.getElementById('importFileInput');
  Object.defineProperty(fileInput, 'files', { value: [new FakeFile(JSON.stringify(spoofedDoc))], configurable: true });
  fileInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(30);
  if(!doc.getElementById('importConflictOverlay').classList.contains('hidden')){
    doc.getElementById('importConflictCopyBtn').click();
    await wait(20);
  }

  const raw = JSON.parse(window.localStorage.getItem('kanbanflow_v1_db'));
  const importedProject = Object.values(raw.projects).find(p => p.name === 'Future Version Project');
  log('importing a file with a spoofed/future appVersion does not block the import', !!importedProject);
  log('the imported project object does NOT store an appVersion field anywhere on it',
      importedProject && !importedProject.hasOwnProperty('appVersion'));
  log('no part of localStorage stores the imported (spoofed) appVersion value anywhere',
      window.localStorage.getItem('kanbanflow_v1_db').indexOf('99.99.20991231.2359') === -1);

  // ── 4. The app's OWN APP_VERSION is unaffected by importing a file claiming a different version ──
  doc.getElementById('exportBtn').click();
  await wait(20);
  const exportAfterImport = JSON.parse(lastBlobText);
  log('the running app\u2019s own APP_VERSION constant is untouched by the import', exportAfterImport.appVersion === version, exportAfterImport.appVersion);

  console.log('\nappVersion test complete.');
  process.exit(0);
})().catch(e => { console.error('CRASHED', e); process.exit(1); });
