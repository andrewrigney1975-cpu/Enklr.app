const fs = require('fs');
const html = fs.readFileSync('../dist/index.html', 'utf8');
function log(label, ok, extra){ console.log((ok?'PASS':'FAIL') + ' - ' + label + (extra?' :: '+extra:'')); }

const style = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1];
if (!style) {
  console.error('CRASHED: could not find <style> block');
  process.exit(1);
}

// build.js has minified the bundled CSS (esbuild, no whitespace) since 2026-07-04 — this must match
// "@media(max-width:1024px)", not the spaced source form, or this test fails on every minified build.
const mediaQueryMatch = /@media\s*\(\s*max-width\s*:\s*1024px\s*\)/.exec(style);
const mediaStart = mediaQueryMatch ? mediaQueryMatch.index : -1;
if (mediaStart === -1) {
  console.error('CRASHED: could not find the mobile/tablet media query');
  process.exit(1);
}
const mediaOpenBrace = style.indexOf('{', mediaStart);
let depth = 0, mediaEnd = -1;
for (let i = mediaOpenBrace; i < style.length; i++) {
  if (style[i] === '{') depth++;
  else if (style[i] === '}') {
    depth--;
    if (depth === 0) { mediaEnd = i; break; }
  }
}
if (mediaEnd === -1) {
  console.error('CRASHED: could not find the end of the media query block');
  process.exit(1);
}

const beforeMedia = style.slice(0, mediaStart);
const mediaBlock = style.slice(mediaStart, mediaEnd + 1);
const afterMedia = style.slice(mediaEnd + 1);

const drawerOnlySelectors = [
  '.kf-header-hamburger',
  '.kf-drawer-header',
  '.kf-drawer-backdrop',
  '.kf-drawer-views-section',
  '.kf-drawer-section-label',
  '.kf-drawer-view-slot',
  '#toolbarViewButtons,#toolbarRow2Buttons',
  '#toolbarRow2'
];

drawerOnlySelectors.forEach(function(selector){
  const hasBaseline = beforeMedia.includes(selector);
  log('"' + selector + '" has a baseline declaration before the media query', hasBaseline);

  const reappearsAfter = afterMedia.includes(selector);
  log('"' + selector + '" is NOT re-declared after the media query (which would silently override it)', !reappearsAfter,
      reappearsAfter ? 'found again after media query — this would win over the override inside it' : 'clean');
});

['.kf-drawer-views-section', '.kf-drawer-section-label', '.kf-drawer-view-slot', '#toolbarViewButtons,#toolbarRow2Buttons', '#toolbarRow2'].forEach(function(selector){
  const insideMedia = mediaBlock.includes(selector);
  log('"' + selector + '" has an override rule inside the media query (to show it on mobile/tablet)', insideMedia);
});

console.log('\nCSS source-order regression test complete.');
