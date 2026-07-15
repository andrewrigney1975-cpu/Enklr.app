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
function isNavItemVisible(doc, btnId){
  var btn = doc.getElementById(btnId);
  if(!btn.classList.contains('hidden')) return true;
  var moreLink = doc.querySelector('#headerMorePanel [data-nav-target="' + btnId + '"]');
  return !!moreLink;
}

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

  log('App Settings gear button exists in the header', !!doc.getElementById('appSettingsBtn'));
  log('gear button\u2019s title/tooltip is "Project Settings"', doc.getElementById('appSettingsBtn').getAttribute('title') === 'Project Settings',
      doc.getElementById('appSettingsBtn').getAttribute('title'));
  log('gear button\u2019s aria-label is "Project Settings"', doc.getElementById('appSettingsBtn').getAttribute('aria-label') === 'Project Settings');

  const mobileLabel = doc.querySelector('#appSettingsBtn .kf-appsettings-label');
  log('gear button has a "Project Settings" text label for the mobile menu', !!mobileLabel && mobileLabel.textContent === 'Project Settings',
      mobileLabel && mobileLabel.textContent);

  const style = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1];
  const baseRule = (style.match(/\.kf-appsettings-label\{([^}]*)\}/) || [])[1] || '';
  log('the mobile label is hidden by default (desktop: icon-only)', /display:\s*none/.test(baseRule), baseRule);
  // build.js minifies the inlined CSS (strips spaces around ':' and before '('), so this can't be a
  // literal substring search — match tolerantly instead.
  const mediaStartMatch = style.match(/@media\s*\(\s*max-width:\s*1024px\s*\)/);
  const mediaStart = mediaStartMatch ? mediaStartMatch.index : -1;
  const mobileOverride = mediaStart !== -1 ? style.slice(mediaStart).match(/\.kf-appsettings-label\{([^}]*)\}/) : null;
  log('the mobile label has a visible override inside the mobile media query', !!mobileOverride && /display:\s*inline/.test(mobileOverride[1]),
      mobileOverride && mobileOverride[1]);
  // themeToggleBtn/appSettingsBtn are nested inside #headerUtilityGroup (a sub-wrapper added later),
  // not direct children of #headerControls — checking the wrong parent always reported "-1/-1".
  const headerUtilityGroup = doc.getElementById('headerUtilityGroup');
  const themeBtn = doc.getElementById('themeToggleBtn');
  const settingsBtn = doc.getElementById('appSettingsBtn');
  const siblings = Array.from(headerUtilityGroup.children);
  log('gear button comes immediately after the theme toggle', siblings.indexOf(settingsBtn) === siblings.indexOf(themeBtn) + 1,
      `theme=${siblings.indexOf(themeBtn)} settings=${siblings.indexOf(settingsBtn)}`);

  log('Documents is reachable by the user (directly, or via the More menu since 6/6 modules are enabled by default)', isNavItemVisible(doc, 'documentsBtn'));
  log('Risks is reachable by the user', isNavItemVisible(doc, 'risksBtn'));
  log('Decisions is reachable by the user', isNavItemVisible(doc, 'decisionsBtn'));
  log('with all 6 movable modules enabled, the desktop More menu is active', !doc.getElementById('headerMoreWrap').classList.contains('hidden'));

  log('modal starts hidden', doc.getElementById('appSettingsOverlay').classList.contains('hidden'));
  settingsBtn.click();
  await wait(20);
  log('clicking the gear button opens the modal', !doc.getElementById('appSettingsOverlay').classList.contains('hidden'));
  log('modal heading reads "App and Project Settings"', doc.getElementById('appSettingsOverlay').textContent.indexOf('App and Project Settings') !== -1);
  log('modal description reads "Choose which modules are switched on for this project."',
      doc.getElementById('appSettingsOverlay').textContent.indexOf('Choose which modules are switched on for this project.') !== -1);
  log('old "Header buttons" heading text is gone', doc.getElementById('appSettingsOverlay').textContent.indexOf('Header buttons') === -1);
  log('Documents checkbox starts checked', doc.getElementById('settingsShowDocumentsBtn').checked);
  log('Risks checkbox starts checked', doc.getElementById('settingsShowRisksBtn').checked);
  log('Decisions checkbox starts checked', doc.getElementById('settingsShowDecisionsBtn').checked);

  doc.getElementById('settingsShowRisksBtn').checked = false;
  doc.getElementById('settingsShowRisksBtn').dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(10);
  log('unchecking Risks immediately makes it unreachable everywhere (live, no separate save)',
      !isNavItemVisible(doc, 'risksBtn'));
  log('Documents and Decisions remain reachable (unaffected)',
      isNavItemVisible(doc, 'documentsBtn') && isNavItemVisible(doc, 'decisionsBtn'));

  doc.getElementById('settingsShowDocumentsBtn').checked = false;
  doc.getElementById('settingsShowDocumentsBtn').dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(10);
  log('unchecking Documents also makes it unreachable', !isNavItemVisible(doc, 'documentsBtn'));

  let raw = JSON.parse(window.localStorage.getItem('kanbanflow_v1_db'));
  let proj = raw.projects[raw.currentProjectId];
  log('the setting actually persisted to the project (documents:false, risks:false, decisions:true)',
      proj.headerButtonVisibility.documents === false && proj.headerButtonVisibility.risks === false && proj.headerButtonVisibility.decisions === true,
      JSON.stringify(proj.headerButtonVisibility));

  doc.getElementById('appSettingsClose').click();
  await wait(10);
  settingsBtn.click();
  await wait(10);
  log('reopening shows Documents unchecked', !doc.getElementById('settingsShowDocumentsBtn').checked);
  log('reopening shows Risks unchecked', !doc.getElementById('settingsShowRisksBtn').checked);
  log('reopening shows Decisions still checked', doc.getElementById('settingsShowDecisionsBtn').checked);

  doc.getElementById('settingsShowDocumentsBtn').checked = true;
  doc.getElementById('settingsShowDocumentsBtn').dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(10);
  log('re-checking Documents makes it reachable again', isNavItemVisible(doc, 'documentsBtn'));

  doc.getElementById('appSettingsDoneBtn').click();
  await wait(10);
  log('Done button closes the modal', doc.getElementById('appSettingsOverlay').classList.contains('hidden'));
  settingsBtn.click();
  await wait(10);
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await wait(10);
  log('Escape closes the modal', doc.getElementById('appSettingsOverlay').classList.contains('hidden'));

  doc.getElementById('exportBtn').click();
  await wait(20);
  const exported = JSON.parse(lastBlobText);
  log('export includes headerButtonVisibility', !!exported.headerButtonVisibility);
  log('exported headerButtonVisibility matches current state (risks:false)', exported.headerButtonVisibility.risks === false, JSON.stringify(exported.headerButtonVisibility));

  const fileInput = doc.getElementById('importFileInput');
  Object.defineProperty(fileInput, 'files', { value: [new FakeFile(lastBlobText)], configurable: true });
  fileInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(30);
  if(!doc.getElementById('importConflictOverlay').classList.contains('hidden')){
    doc.getElementById('importConflictCopyBtn').click();
    await wait(20);
  }
  raw = JSON.parse(window.localStorage.getItem('kanbanflow_v1_db'));
  const importedProj = raw.projects[raw.currentProjectId];
  log('imported project carries over the same headerButtonVisibility setting',
      importedProj.headerButtonVisibility.risks === false && importedProj.headerButtonVisibility.documents === true,
      JSON.stringify(importedProj.headerButtonVisibility));
  log('switching to the imported project reflects its setting in the actual header buttons',
      doc.getElementById('risksBtn').classList.contains('hidden'));

  const legacyDB = {
    projects: {
      legacy_p1: {
        id: 'legacy_p1', name: 'Legacy Project', key: 'LEG', taskCounter: 1,
        columns: [{ id: 'col1', name: 'To Do', done: false, order: [] }],
        tasks: {},
        members: [], releases: [], taskTypes: [], startDate: null, endDate: null,
        dateCreated: '2025-01-01T00:00:00.000Z', dateLastModified: '2025-01-01T00:00:00.000Z', dateLastExported: null,
        documents: [], docCounter: 1, risks: [], riskCounter: 1, decisions: [], decCounter: 1, approvers: []
      }
    },
    projectOrder: ['legacy_p1'], currentProjectId: 'legacy_p1'
  };
  const dom2 = new JSDOM(html, {
    runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/', pretendToBeVisual: true,
    beforeParse(w){ w.localStorage.setItem('kanbanflow_v1_db', JSON.stringify(legacyDB)); }
  });
  await wait(350);
  const raw2 = JSON.parse(dom2.window.localStorage.getItem('kanbanflow_v1_db'));
  const legacyProj = raw2.projects.legacy_p1;
  log('migration backfills headerButtonVisibility, defaulting all to visible', legacyProj.headerButtonVisibility &&
      legacyProj.headerButtonVisibility.documents === true && legacyProj.headerButtonVisibility.risks === true && legacyProj.headerButtonVisibility.decisions === true,
      JSON.stringify(legacyProj.headerButtonVisibility));

  const doc2 = dom2.window.document;
  log('on a freshly-migrated project, Documents/Risks/Decisions are all reachable by default',
      isNavItemVisible(doc2, 'documentsBtn') && isNavItemVisible(doc2, 'risksBtn') && isNavItemVisible(doc2, 'decisionsBtn'));

  console.log('\nApp Settings test complete.');
  process.exit(0);
})().catch(e => { console.error('CRASHED', e); process.exit(1); });
