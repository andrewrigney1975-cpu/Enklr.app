const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync('../dist/index.html', 'utf8');
function wait(ms){ return new Promise(r => setTimeout(r, ms)); }

class FakeFile { constructor(text){ this._text = text; } }
function installFakeFileReader(window){
  window.FileReader = class {
    readAsText(f){ const s = this; setTimeout(() => { s.result = f._text; if (s.onload) s.onload(); }, 0); }
  };
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
  function log(label, ok, extra){ console.log((ok?'PASS':'FAIL') + ' - ' + label + (extra!==undefined?' :: '+extra:'')); }

  // ── 1. The three original buttons are hidden by default (desktop), Projects... shows instead ──
  log('New Project button exists in the DOM (still real, just hidden on desktop)', !!doc.getElementById('newProjectBtn'));
  log('Import Project button exists in the DOM', !!doc.getElementById('importProjectBtn'));
  log('Export Project button exists in the DOM', !!doc.getElementById('exportBtn'));
  log('"Projects..." button exists', !!doc.getElementById('projectsMenuBtn'));
  log('"Projects..." button reads exactly "Projects..."', doc.getElementById('projectsMenuBtn').textContent.trim() === 'Projects...');

  // ── 2. Panel starts closed, opens on click, lists exactly the 3 as text links ──
  log('Projects dropdown panel starts closed', doc.getElementById('projectsMenuPanel').classList.contains('hidden'));
  doc.getElementById('projectsMenuBtn').click();
  await wait(10);
  log('clicking "Projects..." opens the panel', !doc.getElementById('projectsMenuPanel').classList.contains('hidden'));

  const links = Array.from(doc.querySelectorAll('#projectsMenuPanel a'));
  const linkTexts = links.map(a => a.textContent);
  log('panel contains exactly 3 links', links.length === 3, linkTexts.join(','));
  log('links are New Project, Import Project, Export Project, as plain <a> text links (not buttons)',
      linkTexts.join(',') === 'New Project,Import Project,Export Project' && links.every(a => a.tagName === 'A'),
      linkTexts.join(','));
  log('links use the same text-link styling class as the other More-menu links (consistent visual language)',
      links.every(a => a.classList.contains('kf-header-more-link')));

  // ── 3. Clicking "New Project" actually triggers the real button and closes the panel ──
  const newProjLink = links.find(a => a.textContent === 'New Project');
  newProjLink.click();
  await wait(20);
  log('clicking "New Project" in the dropdown opens the real New Project modal', !doc.getElementById('projectOverlay').classList.contains('hidden'));
  log('the dropdown panel closes after the click', doc.getElementById('projectsMenuPanel').classList.contains('hidden'));
  doc.getElementById('projectModalClose').click();
  await wait(10);

  // ── 4. Clicking "Export Project" triggers a real export ──
  doc.getElementById('projectsMenuBtn').click();
  await wait(10);
  const exportLink = Array.from(doc.querySelectorAll('#projectsMenuPanel a')).find(a => a.textContent === 'Export Project');
  lastBlobText = null;
  exportLink.click();
  await wait(20);
  log('clicking "Export Project" in the dropdown produces a real export', !!lastBlobText && JSON.parse(lastBlobText).project && JSON.parse(lastBlobText).project.key !== undefined,
      lastBlobText && lastBlobText.slice(0, 60));

  // ── 5. Clicking "Import Project" triggers the real file input flow ──
  doc.getElementById('projectsMenuBtn').click();
  await wait(10);
  const importLink = Array.from(doc.querySelectorAll('#projectsMenuPanel a')).find(a => a.textContent === 'Import Project');
  const fileInput = doc.getElementById('importFileInput');
  Object.defineProperty(fileInput, 'files', { value: [new FakeFile(lastBlobText)], configurable: true });
  importLink.click();
  await wait(10);
  fileInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(30);
  if(!doc.getElementById('importConflictOverlay').classList.contains('hidden')){
    doc.getElementById('importConflictCopyBtn').click();
    await wait(20);
  }
  let raw = JSON.parse(window.localStorage.getItem('kanbanflow_v1_db'));
  log('clicking "Import Project" in the dropdown actually imports a project (project count increased)',
      Object.keys(raw.projects).length >= 2, Object.keys(raw.projects).length);

  // ── 6. CSS: the 3 originals are hidden on desktop by default, restored on mobile; the dropdown is the reverse ──
  const style = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1];
  const mediaStart = style.indexOf('@media (max-width: 1024px)');
  const mobileBlock = style.slice(mediaStart);
  log('the 3 project-action buttons are hidden by default (desktop), BEFORE the media query (correct source order)',
      style.indexOf('.kf-header-nav-projectaction{display:none;}') !== -1 && style.indexOf('.kf-header-nav-projectaction{display:none;}') < mediaStart);
  log('mobile CSS restores the 3 original buttons to visible', /\.kf-header-nav-projectaction\{display:\s*flex/.test(mobileBlock));
  log('mobile CSS hides the desktop Projects dropdown', /\.kf-projects-menu-wrap\{display:\s*none/.test(mobileBlock));

  console.log('\nDesktop Projects dropdown test complete.');
  process.exit(0);
})().catch(e => { console.error('CRASHED', e); process.exit(1); });
