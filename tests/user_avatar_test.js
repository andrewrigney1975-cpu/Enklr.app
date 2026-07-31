const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync('../dist/index.html', 'utf8');
function wait(ms){ return new Promise(r => setTimeout(r, ms)); }

// A fake File with a controllable size/type, and a fake FileReader that resolves readAsDataURL
// with a caller-supplied data URL — jsdom's real FileReader doesn't actually read file content.
class FakeFile { constructor(dataUrl, size, type){ this._dataUrl = dataUrl; this.size = size; this.type = type || 'image/png'; } }
function installFakeFileReader(window){
  window.FileReader = class {
    readAsDataURL(f){ const s = this; setTimeout(() => { s.result = f._dataUrl; if(s.onload) s.onload(); }, 0); }
  };
}

(async () => {
  const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;
  installFakeFileReader(window);
  await wait(300);
  const doc = window.document;
  function log(label, ok, extra){ console.log((ok?'PASS':'FAIL') + ' - ' + label + (extra !== undefined ? ' :: ' + extra : '')); }

  // ---- Header element exists, positioned between Account menu and Refresh, starts hidden ----
  const utilityChildren = Array.from(doc.getElementById('headerUtilityGroup').children).map(el => el.id);
  const accountIdx = utilityChildren.indexOf('accountMenuWrap');
  const avatarIdx = utilityChildren.indexOf('headerAvatar');
  const refreshIdx = utilityChildren.indexOf('refreshBtn');
  log('headerAvatar sits between accountMenuWrap and refreshBtn', accountIdx !== -1 && avatarIdx === accountIdx + 1 && refreshIdx === avatarIdx + 1, utilityChildren.join(','));
  log('headerAvatar starts hidden (no avatar uploaded yet)', doc.getElementById('headerAvatar').classList.contains('kf-vis-hidden'));
  const avatarHiddenDisplay = window.getComputedStyle(doc.getElementById('headerAvatar')).display;
  log('headerAvatar is actually not rendered while hidden (real .hidden CSS backing, not just a bare class)', avatarHiddenDisplay === 'none', avatarHiddenDisplay);

  // ---- Open My Preferences, upload area starts with no preview / no Remove button ----
  doc.getElementById('accountMenuBtn').click();
  await wait(10);
  doc.getElementById('myPreferencesBtn').click();
  await wait(20);
  log('My Preferences modal opens', !doc.getElementById('myPreferencesOverlay').classList.contains('hidden'));
  log('Avatar preview image starts hidden', doc.getElementById('userAvatarPreviewImg').classList.contains('kf-vis-hidden'));
  log('Avatar Remove button starts hidden', doc.getElementById('userAvatarRemoveBtn').classList.contains('kf-vis-hidden'));

  // ---- Oversized file (>200KB) is rejected ----
  const bigFile = new FakeFile('data:image/png;base64,AAA', 200 * 1024 + 1);
  const fileInput = doc.getElementById('userAvatarFileInput');
  Object.defineProperty(fileInput, 'files', {value: [bigFile], configurable: true});
  fileInput.dispatchEvent(new window.Event('change', {bubbles: true}));
  await wait(20);
  log('an oversized file is rejected — no avatar saved', !window.localStorage.getItem('kanbanflow_user_avatar'));
  log('header avatar still hidden after a rejected upload', doc.getElementById('headerAvatar').classList.contains('kf-vis-hidden'));

  // ---- Non-image file is rejected ----
  const notAnImage = new FakeFile('data:text/plain;base64,AAA', 100, 'text/plain');
  Object.defineProperty(fileInput, 'files', {value: [notAnImage], configurable: true});
  fileInput.dispatchEvent(new window.Event('change', {bubbles: true}));
  await wait(20);
  log('a non-image file is rejected — no avatar saved', !window.localStorage.getItem('kanbanflow_user_avatar'));

  // ---- Valid, small image is accepted ----
  const goodDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const goodFile = new FakeFile(goodDataUrl, 1234);
  Object.defineProperty(fileInput, 'files', {value: [goodFile], configurable: true});
  fileInput.dispatchEvent(new window.Event('change', {bubbles: true}));
  await wait(20);
  log('a valid small image is saved to localStorage', window.localStorage.getItem('kanbanflow_user_avatar') === goodDataUrl);
  log('the modal preview shows the uploaded image', doc.getElementById('userAvatarPreviewImg').src === goodDataUrl && !doc.getElementById('userAvatarPreviewImg').classList.contains('kf-vis-hidden'));
  log('the Remove button becomes visible', !doc.getElementById('userAvatarRemoveBtn').classList.contains('kf-vis-hidden'));
  log('the header avatar becomes visible with the uploaded image', !doc.getElementById('headerAvatar').classList.contains('kf-vis-hidden') && doc.getElementById('headerAvatar').src === goodDataUrl);
  const avatarShownDisplay = window.getComputedStyle(doc.getElementById('headerAvatar')).display;
  log('header avatar is actually rendered once shown', avatarShownDisplay !== 'none', avatarShownDisplay);

  // ---- Reopening the modal shows the persisted avatar ----
  doc.getElementById('myPreferencesModalClose').click();
  await wait(10);
  doc.getElementById('myPreferencesBtn').click();
  await wait(20);
  log('reopening the modal re-shows the persisted preview', doc.getElementById('userAvatarPreviewImg').src === goodDataUrl && !doc.getElementById('userAvatarPreviewImg').classList.contains('kf-vis-hidden'));

  // ---- Not part of any project data (per-machine only) ----
  const exported = JSON.parse(window.localStorage.getItem('kanbanflow_v1_db') || '{}');
  log('avatar is not stored inside the project DB blob (per-machine localStorage key only)', JSON.stringify(exported).indexOf(goodDataUrl) === -1);

  // ---- Remove clears everything ----
  doc.getElementById('userAvatarRemoveBtn').click();
  await wait(10);
  log('Remove clears localStorage', !window.localStorage.getItem('kanbanflow_user_avatar'));
  log('Remove hides the modal preview again', doc.getElementById('userAvatarPreviewImg').classList.contains('kf-vis-hidden'));
  log('Remove hides the Remove button again', doc.getElementById('userAvatarRemoveBtn').classList.contains('kf-vis-hidden'));
  log('Remove hides the header avatar again', doc.getElementById('headerAvatar').classList.contains('kf-vis-hidden'));

  // ---- Clicking the header avatar opens My Preferences ----
  Object.defineProperty(fileInput, 'files', {value: [goodFile], configurable: true});
  fileInput.dispatchEvent(new window.Event('change', {bubbles: true}));
  await wait(20);
  doc.getElementById('myPreferencesModalClose').click();
  await wait(10);
  log('modal is closed before testing the header avatar click shortcut', doc.getElementById('myPreferencesOverlay').classList.contains('hidden'));
  doc.getElementById('headerAvatar').click();
  await wait(20);
  log('clicking the header avatar opens My Preferences', !doc.getElementById('myPreferencesOverlay').classList.contains('hidden'));

  console.log('\nUser avatar test complete.');
  process.exit(0);
})();
