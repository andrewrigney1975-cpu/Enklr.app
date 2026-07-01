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

  // ── 1. "New Project" label capitalization ─────────────────────────────────
  const newProjectBtn = doc.getElementById('newProjectBtn');
  log('New Project button label has a capital P', newProjectBtn.textContent.trim() === 'New Project', newProjectBtn.textContent.trim());
  log('New Project button tooltip also has a capital P (consistent with the label)', newProjectBtn.getAttribute('title') === 'New Project', newProjectBtn.getAttribute('title'));
  newProjectBtn.click();
  await wait(10);
  log('clicking New Project still opens the project modal', !doc.getElementById('projectOverlay').classList.contains('hidden'));
  doc.getElementById('projectCancelBtn').click();
  await wait(10);

  // ── 2. New/Import/Export are grouped together, structurally inside the drawer ──
  const group = doc.getElementById('newProjectBtn').closest('.kf-drawer-action-group');
  log('New Project sits inside a dedicated action group', !!group);
  log('Import Project and Export Project are in the SAME group', !!group && group.contains(doc.getElementById('importProjectBtn')) && group.contains(doc.getElementById('exportBtn')));
  log('the action group is still inside the drawer container', doc.getElementById('headerControls').contains(group));

  // ── 3. CSS: the action group's mobile gap matches the project-picker's gap ──
  const style = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1];
  const mediaStart = style.indexOf('@media (max-width: 1024px)');
  const mediaBlock = style.slice(mediaStart);

  function ruleFor(text, selector){
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(^|[{};,])\\s*' + escaped + '\\{([^}]*)\\}', 'm');
    const m = text.match(re);
    return m ? m[2] : null;
  }

  const pickerMobileRule = ruleFor(mediaBlock, '.kf-header-controls .kf-project-picker');
  const actionGroupMobileRule = ruleFor(mediaBlock, '.kf-header-controls .kf-drawer-action-group');
  log('project-picker has a mobile gap rule (Edit/Team/Delete spacing)', pickerMobileRule && pickerMobileRule.includes('gap:8px'), pickerMobileRule);
  log('action group has a matching mobile gap rule (New/Import/Export spacing)', actionGroupMobileRule && actionGroupMobileRule.includes('gap:8px'), actionGroupMobileRule);
  log('both use the exact same gap value',
      pickerMobileRule && actionGroupMobileRule && pickerMobileRule.match(/gap:\s*([\d.]+px)/)[1] === actionGroupMobileRule.match(/gap:\s*([\d.]+px)/)[1]);
  log('action group switches to a vertical column on mobile',
      actionGroupMobileRule && (actionGroupMobileRule.includes('flex-direction:column') || actionGroupMobileRule.includes('flex-direction: column')), actionGroupMobileRule);

  // ── 4. Desktop: the action group still lays out as a horizontal row ──────
  const beforeMedia = style.slice(0, mediaStart);
  const desktopActionGroupRule = ruleFor(beforeMedia, '.kf-drawer-action-group');
  log('action group has a desktop (pre-media-query) row layout so the header isn\'t broken above 1024px',
      desktopActionGroupRule && desktopActionGroupRule.includes('display:flex') && !desktopActionGroupRule.includes('column'), desktopActionGroupRule);

  const desktopPickerRule = ruleFor(beforeMedia, '.kf-project-picker');
  log('action group has a desktop gap matching the project-picker\'s desktop gap (Edit/Team/Delete spacing)',
      desktopActionGroupRule && desktopPickerRule &&
      desktopActionGroupRule.match(/gap:\s*([\d.]+px)/)[1] === desktopPickerRule.match(/gap:\s*([\d.]+px)/)[1],
      'action group: ' + desktopActionGroupRule + ' | picker: ' + desktopPickerRule);

  // ── 5. Functional sanity: Import/Export still present and clickable ───────
  Object.defineProperty(window, 'innerWidth', { value: 1400, configurable: true });
  window.dispatchEvent(new window.Event('resize'));
  await wait(10);
  log('Import Project button still present at desktop width', !!doc.getElementById('importProjectBtn'));
  log('Export Project button still present at desktop width', !!doc.getElementById('exportBtn'));
  log('header row remains a single horizontal line at desktop width (group did not break layout)',
      doc.getElementById('headerControls').contains(doc.getElementById('newProjectBtn')) &&
      doc.getElementById('headerControls').contains(doc.getElementById('themeToggleBtn')));

  console.log('\nNew Project label + mobile drawer spacing test complete.');
  process.exit(0);
})().catch(e => { console.error('CRASHED', e); process.exit(1); });
