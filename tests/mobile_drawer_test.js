const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync('../dist/index.html', 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/', pretendToBeVisual: true });
const { window } = dom;
function wait(ms){ return new Promise(r => setTimeout(r, ms)); }

(async () => {
  await wait(300);
  const doc = window.document;
  function log(label, ok, extra){ console.log((ok?'PASS':'FAIL') + ' - ' + label + (extra?' :: '+extra:'')); }

  // ── 1. Structure: hamburger sits before the logo, at the start of the header ──
  const header = doc.querySelector('.kf-header');
  const firstChild = header.firstElementChild;
  log('hamburger button is the first element in the header (top-left)', firstChild.id === 'mobileMenuBtn', firstChild.id);
  const hamburgerIndex = Array.from(header.children).findIndex(c => c.id === 'mobileMenuBtn');
  const logoIndex = Array.from(header.children).findIndex(c => c.classList.contains('kf-logo'));
  log('hamburger comes before the logo', hamburgerIndex < logoIndex, hamburgerIndex + ' vs ' + logoIndex);

  // ── 2. All the original header controls still exist, exactly once each ───
  const idsExpected = ['projectSelect','editProjectBtn','manageTeamBtn','deleteProjectBtn','newProjectBtn','importProjectBtn','exportBtn','themeToggleBtn'];
  idsExpected.forEach(id => {
    const matches = doc.querySelectorAll('#' + id);
    log('exactly one element with id="' + id + '" (no duplicated markup)', matches.length === 1, matches.length);
  });
  log('all header controls live inside a single #headerControls container',
      idsExpected.every(id => doc.getElementById('headerControls').contains(doc.getElementById(id))));

  // ── 3. Drawer starts closed ────────────────────────────────────────────────
  log('drawer starts closed (no "open" class)', !doc.getElementById('headerControls').classList.contains('open'));
  log('backdrop starts closed', !doc.getElementById('drawerBackdrop').classList.contains('open'));

  // ── 4. Hamburger opens the drawer; tapping it again closes it ────────────
  doc.getElementById('mobileMenuBtn').click();
  await wait(10);
  log('clicking the hamburger opens the drawer', doc.getElementById('headerControls').classList.contains('open'));
  log('clicking the hamburger also reveals the backdrop', doc.getElementById('drawerBackdrop').classList.contains('open'));

  doc.getElementById('mobileMenuBtn').click();
  await wait(10);
  log('clicking the hamburger again closes the drawer (toggle)', !doc.getElementById('headerControls').classList.contains('open'));
  log('backdrop closes too', !doc.getElementById('drawerBackdrop').classList.contains('open'));

  // ── 5. In-drawer close (×) button closes it ───────────────────────────────
  doc.getElementById('mobileMenuBtn').click();
  await wait(10);
  doc.getElementById('drawerCloseBtn').click();
  await wait(10);
  log('the in-drawer × button closes the drawer', !doc.getElementById('headerControls').classList.contains('open'));

  // ── 6. Clicking the backdrop closes the drawer ────────────────────────────
  doc.getElementById('mobileMenuBtn').click();
  await wait(10);
  doc.getElementById('drawerBackdrop').click();
  await wait(10);
  log('clicking the backdrop closes the drawer', !doc.getElementById('headerControls').classList.contains('open'));

  // ── 7. Escape key closes the drawer ───────────────────────────────────────
  doc.getElementById('mobileMenuBtn').click();
  await wait(10);
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await wait(10);
  log('Escape closes the drawer', !doc.getElementById('headerControls').classList.contains('open'));

  // ── 8. Clicking an action button inside the drawer auto-closes it ────────
  doc.getElementById('mobileMenuBtn').click();
  await wait(10);
  doc.getElementById('newProjectBtn').click();
  await wait(20);
  log('clicking "New project" inside the drawer auto-closes the drawer', !doc.getElementById('headerControls').classList.contains('open'));
  log('the underlying action still ran (project modal opened)', !doc.getElementById('projectOverlay').classList.contains('hidden'));
  doc.getElementById('projectCancelBtn').click();
  await wait(10);

  // ── 9. Changing the project select also closes the drawer ────────────────
  doc.getElementById('mobileMenuBtn').click();
  await wait(10);
  const sel = doc.getElementById('projectSelect');
  if (sel.options.length > 0) {
    sel.value = sel.options[0].value;
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));
    await wait(10);
    log('changing the project select closes the drawer', !doc.getElementById('headerControls').classList.contains('open'));
  } else {
    log('changing the project select closes the drawer (skipped)', true, 'skipped');
  }

  // ── 10. Clicking the select itself (not changing it) does NOT prematurely close ──
  doc.getElementById('mobileMenuBtn').click();
  await wait(10);
  doc.getElementById('projectSelect').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(10);
  log('merely clicking the select (opening its native picker) does not close the drawer', doc.getElementById('headerControls').classList.contains('open'));
  doc.getElementById('drawerCloseBtn').click();
  await wait(10);

  // ── 11. Resizing back to desktop width closes the drawer ─────────────────
  doc.getElementById('mobileMenuBtn').click();
  await wait(10);
  log('drawer open before resize', doc.getElementById('headerControls').classList.contains('open'));
  Object.defineProperty(window, 'innerWidth', { value: 1400, configurable: true });
  window.dispatchEvent(new window.Event('resize'));
  await wait(10);
  log('resizing back to a desktop width closes the drawer', !doc.getElementById('headerControls').classList.contains('open'));

  // ── 12. Theme toggle still works from inside the drawer ──────────────────
  doc.getElementById('mobileMenuBtn').click();
  await wait(10);
  const themeBefore = doc.documentElement.getAttribute('data-theme');
  doc.getElementById('themeToggleBtn').click();
  await wait(10);
  const themeAfter = doc.documentElement.getAttribute('data-theme');
  log('theme toggle inside the drawer still works', themeBefore !== themeAfter, themeBefore + ' -> ' + themeAfter);
  log('theme toggle has a mobile-only label set for the drawer view', doc.getElementById('themeToggleBtn').hasAttribute('data-mobile-label'));
  log('drawer auto-closes after toggling the theme too', !doc.getElementById('headerControls').classList.contains('open'));

  console.log('\nMobile drawer test complete.');
  process.exit(0);
})().catch(e => { console.error('CRASHED', e); process.exit(1); });
