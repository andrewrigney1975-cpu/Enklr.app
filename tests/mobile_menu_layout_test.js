const fs = require('fs');
const html = fs.readFileSync('../dist/index.html', 'utf8');
function log(label, ok, extra){ console.log((ok?'PASS':'FAIL') + ' - ' + label + (extra!==undefined?' :: '+extra:'')); }

(async () => {
  const style = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1];
  const mediaStart = style.indexOf('@media (max-width: 1024px)');
  const mobileBlock = style.slice(mediaStart);

  log('mobile CSS forces the movable nav group into a column layout (one item per row)',
      /\.kf-header-movable-group\{display:\s*flex;flex-direction:\s*column/.test(mobileBlock),
      (mobileBlock.match(/\.kf-header-movable-group\{[^}]*\}/) || [])[0]);
  log('the column override applies align-items:stretch, so each link spans the full row width like its siblings',
      /\.kf-header-movable-group\{[^}]*align-items:\s*stretch/.test(mobileBlock));

  const secondaryRule = (mobileBlock.match(/\.kf-header-controls \.kf-btn-secondary\{[^}]*\}/) || [])[0] || '';
  log('the mobile override for .kf-btn-secondary (the class used by all 8 relocated view/tools buttons) sets border:none',
      /border:\s*none/.test(secondaryRule), secondaryRule);
  log('the mobile override no longer adds the old visible white-ish border', !/border:\s*1px solid/.test(secondaryRule), secondaryRule);

  const namedButtons = {
    taskListBtn: 'List View', timelineBtn: 'Timeline', depMapBtn: 'Dependency Map', costBenefitBtn: 'Cost/Benefit Chart',
    bulkEditBtn: 'Bulk Edit', archivedTasksBtn: 'Archived', taskTypesBtn: 'Task Types', releasesBtn: 'Releases'
  };
  Object.keys(namedButtons).forEach(id => {
    const re = new RegExp('class="kf-btn kf-btn-secondary" id="' + id + '"');
    log(`"${namedButtons[id]}" (#${id}) is a .kf-btn-secondary button, so it\u2019s covered by the mobile border-removal rule above`, re.test(html));
  });

  const { JSDOM } = require('jsdom');
  function wait(ms){ return new Promise(r => setTimeout(r, ms)); }
  const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/', pretendToBeVisual: true });
  await wait(300);
  const doc = dom.window.document;

  const movableGroup = doc.getElementById('headerMovableGroup');
  log('the movable nav group element exists in the drawer markup', !!movableGroup);
  const movableChildren = Array.from(movableGroup.children).map(el => el.id);
  log('it contains exactly the 6 expected items, each a direct child (so a column layout puts each on its own row)',
      movableChildren.join(',') === 'principlesBtn,objectivesBtn,documentsBtn,risksBtn,decisionsBtn,teamsCommitteesBtn', movableChildren.join(','));

  const viewsSlot = doc.getElementById('drawerViewButtonsSlot');
  const toolsSlot = doc.getElementById('drawerToolsButtonsSlot');
  log('the relocated view buttons (List View, Timeline, etc.) end up inside the drawer\u2019s view slot',
      !!viewsSlot.querySelector('#taskListBtn') && !!viewsSlot.querySelector('#timelineBtn') &&
      !!viewsSlot.querySelector('#depMapBtn') && !!viewsSlot.querySelector('#costBenefitBtn'));
  log('the relocated tools buttons (Bulk Edit, Archived, Task Types, Releases) end up inside the drawer\u2019s tools slot',
      !!toolsSlot.querySelector('#bulkEditBtn') && !!toolsSlot.querySelector('#archivedTasksBtn') &&
      !!toolsSlot.querySelector('#taskTypesBtn') && !!toolsSlot.querySelector('#releasesBtn'));

  log('mobile CSS forces the relocated view/tools button wrapper into a column layout too (previously it stayed a wrapping row, causing inconsistent left edges when items wrapped)',
      /\.kf-toolbar-view-buttons\{flex-direction:\s*column/.test(mobileBlock), (mobileBlock.match(/\.kf-toolbar-view-buttons\{[^}]*\}/) || [])[0]);
  log('that override also sets flex-wrap:nowrap, so items can never wrap mid-row again', /\.kf-toolbar-view-buttons\{[^}]*flex-wrap:\s*nowrap/.test(mobileBlock));

  const movableGroupRule = (mobileBlock.match(/\.kf-header-movable-group\{[^}]*\}/) || [])[0] || '';
  log('the App Settings movable group has its own margin/padding explicitly zeroed (defends against left indentation)',
      /margin:\s*0/.test(movableGroupRule) && /padding:\s*0/.test(movableGroupRule), movableGroupRule);
  const movableBtnRule = (mobileBlock.match(/\.kf-header-movable-group \.kf-header-btn\{[^}]*\}/) || [])[0] || '';
  log('each App Settings button inside that group uses the exact same padding as every other mobile menu button (6px 10px)',
      /padding:\s*6px 10px/.test(movableBtnRule), movableBtnRule);

  const btnSecondaryRule = (mobileBlock.match(/\.kf-header-controls \.kf-btn-secondary\{[^}]*\}/) || [])[0] || '';
  log('the relocated view/tools buttons (a different CSS class, .kf-btn-secondary) now use the identical 6px 10px padding too, so every link type shares the same left edge',
      /padding:\s*6px 10px/.test(btnSecondaryRule), btnSecondaryRule);

  console.log('\nMobile menu layout fix test complete.');
  process.exit(0);
})().catch(e => { console.error('CRASHED', e); process.exit(1); });
