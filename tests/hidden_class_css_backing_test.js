const fs = require('fs');
const html = fs.readFileSync('../dist/index.html', 'utf8');
function log(label, ok, extra){ console.log((ok?'PASS':'FAIL') + ' - ' + label + (extra?' :: '+extra:'')); }

const style = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1];

const idToClasses = {};
const idClassRe = /<[a-zA-Z][^>]*\bid="([^"]+)"[^>]*\bclass="([^"]+)"[^>]*>|<[a-zA-Z][^>]*\bclass="([^"]+)"[^>]*\bid="([^"]+)"[^>]*>/g;
let m;
while ((m = idClassRe.exec(html))) {
  const id = m[1] || m[4];
  const classes = (m[2] || m[3]).split(/\s+/).filter(Boolean);
  idToClasses[id] = classes;
}

const staticClassRe = /<[a-zA-Z][^>]*\bclass="([^"]+)"[^>]*>/g;
const staticElements = [];
while ((m = staticClassRe.exec(html))) {
  const classes = m[1].split(/\s+/).filter(Boolean);
  if (!classes.includes('hidden')) continue; // exact-token match — skips compound names like "kf-vis-hidden"
  const tag = html.slice(m.index, m.index + 400);
  const idMatch = tag.match(/\bid="([^"]+)"/);
  staticElements.push({ classes, id: idMatch ? idMatch[1] : null, source: 'static markup' });
}

const jsHiddenRe = /getElementById\('([^']+)'\)\.classList\.(?:add|remove|toggle)\('hidden'/g;
const seenIds = new Set();
const dynamicElements = [];
while ((m = jsHiddenRe.exec(html))) {
  const id = m[1];
  if (seenIds.has(id)) continue;
  seenIds.add(id);
  dynamicElements.push({ classes: idToClasses[id] || [], id, source: 'JS classList toggle' });
}

const allElements = staticElements.concat(dynamicElements);

/* A selector's end is either '{' (last selector before the rule body) or ',' (more selectors follow
   in the same comma-separated list) — esbuild's CSS minifier merges separate source rules that share
   an identical body into one such list (e.g. "#a.hidden,#b.hidden{display:none}"), so matching only
   '\s*\{' produces false negatives for every selector except the last one in a merged group. Both
   terminators are valid CSS and must be accepted. */
function hasMatchingRule(classes, id){
  const others = classes.filter(c => c !== 'hidden');
  if (/(^|[^.\w-])\.hidden\s*[,{]/.test(style)) return true;
  if (id && new RegExp('#' + id + '\\.hidden\\s*[,{]').test(style)) return true;
  if (id && new RegExp('\\.hidden#' + id + '\\s*[,{]').test(style)) return true;
  return others.some(cls => {
    const escaped = cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re1 = new RegExp('\\.' + escaped + '\\.hidden\\s*[,{]');
    const re2 = new RegExp('\\.hidden\\.' + escaped + '\\s*[,{]');
    return re1.test(style) || re2.test(style);
  });
}

let allBacked = true;
allElements.forEach(el => {
  const ok = hasMatchingRule(el.classes, el.id);
  if (!ok) allBacked = false;
  log('"' + (el.id || el.classes.join('.')) + '" (' + el.source + ', classes: ' + el.classes.join(',') + ') has a CSS rule backing its "hidden" class',
      ok, ok ? '' : 'NO MATCHING .hidden RULE FOUND — this class will be permanently visible/invisible regardless of toggling');
});

log('every element found (' + allElements.length + ' total, static + dynamic) is properly backed by a CSS rule', allBacked);
log('scan found a non-trivial number of elements (sanity check that the scan itself is working)', allElements.length >= 10, allElements.length);

console.log('\nGeneric "hidden class has a backing CSS rule" regression test complete.');
process.exit(allBacked ? 0 : 1);
