const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync('../dist/index.html', 'utf8');
function wait(ms){ return new Promise(r => setTimeout(r, ms)); }

/* Covers app.js's "Enable Change Auditing?" confirmation: local-only projects still see it
   (the warning is about localStorage growth, which is real for them), but a cloud (server-
   authoritative) project skips it entirely — the audit log lives in the server's own database, not
   this browser's localStorage, so the growth concern doesn't apply.

   There's no prior test in this suite that simulates a server-authoritative project (every existing
   server-path test exercises it through a real login/migrate flow this harness can't do without a
   live backend), so this one seeds a SECOND jsdom instance's localStorage directly with
   serverProjectId === id before boot (loadDB() reads whatever's already in localStorage at init()
   time rather than reseeding, and there's a real gap between `new JSDOM()` returning and init()
   actually running on DOMContentLoaded — see this session's own diagnostic notes on that timing —
   so writing to localStorage in that gap works). window.fetch is stubbed to fail closed (ok:false)
   since faking a full, correctly-shaped project-detail server response just to prove a confirmation
   dialog doesn't appear would be a lot of fragile mock for no extra signal; the resulting "could not
   save settings" toast is an artifact of that shortcut, not something to assert on. */

(async () => {
  const domLocal = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/', pretendToBeVisual: true });
  await wait(300);
  const docLocal = domLocal.window.document;
  function log(label, ok, extra){ console.log((ok?'PASS':'FAIL') + ' - ' + label + (extra !== undefined ? ' :: ' + extra : '')); }

  /* ---- Local-only project: the confirmation still appears (localStorage growth is real here) ---- */
  docLocal.getElementById('appSettingsBtn').click();
  await wait(10);
  log('local project: Change Auditing starts unchecked', !docLocal.getElementById('settingsShowChangeAuditingBtn').checked);
  docLocal.getElementById('settingsShowChangeAuditingBtn').checked = true;
  docLocal.getElementById('settingsShowChangeAuditingBtn').dispatchEvent(new domLocal.window.Event('change', { bubbles: true }));
  await wait(10);
  log('local project: checking the box shows the confirmation dialog', !docLocal.getElementById('confirmOverlay').classList.contains('hidden'));
  log('local project: the checkbox reverts to unchecked until confirmed', !docLocal.getElementById('settingsShowChangeAuditingBtn').checked);
  docLocal.getElementById('confirmOkBtn').click();
  await wait(10);
  log('local project: confirming re-checks the box and persists the setting', docLocal.getElementById('settingsShowChangeAuditingBtn').checked);
  const localRaw = JSON.parse(domLocal.window.localStorage.getItem('kanbanflow_v1_db'));
  const localProj = localRaw.projects[localRaw.currentProjectId];
  log('local project: setting actually persisted to storage', localProj.headerButtonVisibility.changeAuditing === true);

  /* ---- Seed a second instance as a cloud (server-authoritative) project ---- */
  localProj.serverProjectId = localProj.id;
  localProj.headerButtonVisibility.changeAuditing = false; // reset so this instance starts from "off" too
  const cloudRaw = JSON.parse(JSON.stringify(localRaw));

  const domCloud = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/', pretendToBeVisual: true });
  domCloud.window.localStorage.setItem('kanbanflow_v1_db', JSON.stringify(cloudRaw));
  let fetchCalled = false;
  domCloud.window.fetch = async function(){ fetchCalled = true; return { ok: false, status: 500, json: async () => ({ message: 'mock failure (no real backend in this test)' }) }; };
  await wait(300);
  const docCloud = domCloud.window.document;

  const cloudRawAfterBoot = JSON.parse(domCloud.window.localStorage.getItem('kanbanflow_v1_db'));
  const cloudProj = cloudRawAfterBoot.projects[cloudRawAfterBoot.currentProjectId];
  log('the seeded project booted as server-authoritative', cloudProj.serverProjectId === cloudProj.id, cloudProj.serverProjectId);

  docCloud.getElementById('appSettingsBtn').click();
  await wait(10);
  log('cloud project: Change Auditing starts unchecked', !docCloud.getElementById('settingsShowChangeAuditingBtn').checked);
  docCloud.getElementById('settingsShowChangeAuditingBtn').checked = true;
  docCloud.getElementById('settingsShowChangeAuditingBtn').dispatchEvent(new domCloud.window.Event('change', { bubbles: true }));
  await wait(10);
  log('cloud project: checking the box does NOT show the confirmation dialog', docCloud.getElementById('confirmOverlay').classList.contains('hidden'));
  log('cloud project: the checkbox stays checked (never reverted for a confirm round-trip)', docCloud.getElementById('settingsShowChangeAuditingBtn').checked);
  log('cloud project: the setting is applied directly (an API save was attempted, not gated behind a confirm)', fetchCalled);

  console.log('\nChange Auditing confirmation test complete.');
  process.exit(0);
})().catch(e => {
  console.error('CHANGE AUDITING CONFIRM TEST CRASHED:', e);
  process.exit(1);
});
