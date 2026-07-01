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

  // ── 1. Tab title and header logo ──────────────────────────────────────────
  log('tab title is "Enkl"', doc.title === 'Enkl', doc.title);
  const logo = doc.querySelector('.kf-logo');
  log('header logo reads "Enkl"', logo.textContent.trim() === 'Enkl', logo.textContent.trim());

  // ── 2. No leftover references to either previous brand name ──────────────
  log('no "KanbanFlow" text remains anywhere in the file', html.indexOf('KanbanFlow') === -1);
  log('no "Kanba" text remains anywhere in the file (the previous rebrand)', !/Kanba[a-zA-Z]*/.test(html));

  // ── 3. User-facing brand mentions updated for consistency ────────────────
  log('Import Project tooltip references the new brand', doc.getElementById('importProjectBtn').getAttribute('title').indexOf('Enkl') !== -1,
      doc.getElementById('importProjectBtn').getAttribute('title'));

  // ── 4. Internal storage keys are UNCHANGED, for backward compatibility ───
  log('the localStorage data key is unchanged (kanbanflow_v1_db) so existing saved boards still load',
      html.indexOf("STORAGE_KEY = 'kanbanflow_v1_db'") !== -1);
  log('the localStorage theme key is unchanged (kanbanflow_theme) so existing theme preference still loads',
      html.indexOf("THEME_STORAGE_KEY = 'kanbanflow_theme'") !== -1);

  // ── 5. Inter is loaded from Google Fonts and set as the default font ─────
  log('a Google Fonts stylesheet link for Inter is present', /fonts\.googleapis\.com\/css2\?family=Inter/.test(html));
  log('preconnect hints to the Google Fonts domains are present', html.indexOf('fonts.googleapis.com') !== -1 && html.indexOf('fonts.gstatic.com') !== -1);
  const fontVarMatch = html.match(/--kf-font:\s*([^;]+);/);
  log('--kf-font lists Inter first', !!fontVarMatch && fontVarMatch[1].trim().toLowerCase().startsWith("'inter'"), fontVarMatch && fontVarMatch[1]);
  log('--kf-font keeps a system-font fallback chain after Inter (graceful degradation if the CDN is unreachable)',
      !!fontVarMatch && fontVarMatch[1].indexOf('sans-serif') !== -1 && fontVarMatch[1].indexOf('apple-system') !== -1);
  const style = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1];
  log('body\u2019s font-family rule references the --kf-font variable (so the Inter-first value above actually applies)',
      /\bbody\s*\{[^}]*font-family:\s*var\(--kf-font\)/.test(style) || /body\{[^}]*font-family:var\(--kf-font\)/.test(style));

  // ── 6. Sanity: the app still works after the rebrand + font change ───────
  log('board still renders normally', doc.querySelectorAll('.kf-card').length === 5, doc.querySelectorAll('.kf-card').length);
  log('localStorage still loads the seeded demo data under the unchanged key',
      JSON.parse(window.localStorage.getItem('kanbanflow_v1_db')) !== null);

  console.log('\nEnkl rebrand + Inter font test complete.');
  process.exit(0);
})().catch(e => { console.error('CRASHED', e); process.exit(1); });
