import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { markdownToDocHtml } from './src/js/features/markdown-doc.js';

/* Generates the static, multi-page "/help/<slug>" sites from USER-GUIDE.md and
   SYSTEMS-INTEGRATOR-GUIDE.md — genuinely separate sub-sites (own HTML files under
   dist/help/<slug>/, served by nginx's own /help/ location, see web/nginx.conf), not the in-app
   single-overlay Guide Viewer (features/reports.js's openGuideOverlay), which no longer has any
   caller now that both "About" modal buttons link straight to these sub-sites instead — the
   function itself is left in place rather than deleted, in case a future in-app viewing need wants
   it back.

   Run this manually (`node build-help-site.js`), not as part of build.js/the Docker image build —
   deliberately: it calls the Pexels API to resolve one hero image per section, and this codebase's
   own established convention (PortalQaImageResolver.cs's own doc comment) is "resolve an external
   image ONCE, at authoring time, never on every render/build" — re-running this on every Docker build
   would burn Pexels quota for no benefit, since either guide's content changes rarely. Resolved
   image URLs are cached in help-site-image-cache.json (committed — plain public Pexels URLs, nothing
   secret) keyed by "<guide slug>::<search query>" so the two guides' image sets never collide even if
   a section headline happens to repeat verbatim across them, and so a re-run after a genuine content
   change only fetches NEW queries. Generated HTML output (dist/help/<slug>/*.html) is committed too,
   same "build once, commit the artifact" precedent dist/index.html itself already sets —
   web/Dockerfile copies dist/help/ straight from the build context, no Node/Pexels access needed
   inside the Docker build at all. */

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = join(__dirname, 'help-site-image-cache.json');

function slugify(text){
  return text.toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '');
}

function escapeHTML(s){
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function loadPexelsApiKey(){
  if(process.env.PEXELS_API_KEY) return process.env.PEXELS_API_KEY;
  try {
    const envText = readFileSync(join(__dirname, '.env'), 'utf8');
    const match = envText.match(/^PEXELS_API_KEY=(.*)$/m);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

function loadImageCache(){
  try { return JSON.parse(readFileSync(CACHE_PATH, 'utf8')); } catch { return {}; }
}

function saveImageCache(cache){
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2) + '\n', 'utf8');
}

// Same bare-keyword-search shape as PortalQaImageResolver.cs's SearchPexelsAsync — Authorization
// header carries the raw key (no "Bearer " prefix, that's Pexels' own convention, not OAuth).
async function fetchPexelsPhoto(apiKey, query){
  const url = 'https://api.pexels.com/v1/search?query=' + encodeURIComponent(query) + '&per_page=1&orientation=landscape';
  const res = await fetch(url, {headers: {Authorization: apiKey}});
  if(!res.ok) return null;
  const body = await res.json();
  const photo = body.photos && body.photos[0];
  if(!photo) return null;
  return {
    large: photo.src.large2x || photo.src.large,
    medium: photo.src.medium,
    photographer: photo.photographer,
    photographerUrl: photo.photographer_url,
    pexelsUrl: photo.url
  };
}

async function resolveImage(apiKey, cache, cacheKey, query){
  if(cache[cacheKey]) return cache[cacheKey];
  if(!apiKey) return null;
  try {
    const photo = await fetchPexelsPhoto(apiKey, query);
    if(photo){ cache[cacheKey] = photo; return photo; }
  } catch(e){
    console.warn('Pexels lookup failed for "' + query + '": ' + e.message);
  }
  return null;
}

// --- Parse a guide's Markdown into { introMarkdown, sections: [{number, title, headline, subtitle,
// slug, bodyMarkdown}] } — generic across both guides: numbered "## N. Title" headings become
// sections (SYSTEMS-INTEGRATOR-GUIDE.md's own "## Table of contents" is skipped the same way
// USER-GUIDE.md's is, since neither matches the numbered-heading pattern); an optional "Before we
// start..." heading (USER-GUIDE.md only) becomes the landing page's intro blurb.
function parseGuide(markdown){
  const lines = markdown.split(/\r?\n/);
  const headingRe = /^##\s+(.+)$/; // exactly "## " — "### " has a 3rd '#' right after, so never matches
  const raw = [];
  let current = null;
  for(const line of lines){
    const m = headingRe.exec(line);
    if(m){
      current = {title: m[1].trim(), bodyLines: []};
      raw.push(current);
    } else if(current){
      current.bodyLines.push(line);
    }
  }

  const intro = raw.find(function(s){ return /^Before we start/i.test(s.title); });
  const sections = raw
    .filter(function(s){ return /^\d+\.\s/.test(s.title); })
    .map(function(s){
      const numMatch = /^(\d+)\.\s+(.+)$/.exec(s.title);
      const number = parseInt(numMatch[1], 10);
      const fullTitle = numMatch[2];
      const parts = fullTitle.split('—');
      const headline = parts[0].trim();
      const subtitle = parts.length > 1 ? parts.slice(1).join('—').trim() : null;
      return {
        number: number, title: fullTitle, headline: headline, subtitle: subtitle,
        slug: String(number).padStart(2, '0') + '-' + slugify(headline),
        bodyMarkdown: s.bodyLines.join('\n').trim()
      };
    });

  return {
    introMarkdown: intro ? intro.bodyLines.join('\n').trim() : '',
    sections: sections
  };
}

function addHeadingIds(html){
  const counts = {};
  return html.replace(/<(h[1-6])>(.*?)<\/\1>/g, function(m, tag, inner){
    const text = inner.replace(/<[^>]+>/g, '');
    let slug = slugify(text) || 'section';
    if(counts[slug]){ counts[slug]++; slug += '-' + counts[slug]; } else counts[slug] = 1;
    return '<' + tag + ' id="' + slug + '">' + inner + '</' + tag + '>';
  });
}

function extractMiniToc(html){
  const items = [];
  const re = /<h3 id="([^"]+)">(.*?)<\/h3>/g;
  let m;
  while((m = re.exec(html))){
    items.push({id: m[1], text: m[2].replace(/<[^>]+>/g, '')});
  }
  return items;
}

function firstParagraphText(html){
  const m = /<p>(.*?)<\/p>/.exec(html);
  if(!m) return '';
  const text = m[1].replace(/<[^>]+>/g, '');
  return text.length > 150 ? text.slice(0, 147).trimEnd() + '…' : text;
}

// --- Shared page shell (identical across both guide sites — only the content differs) ---

const SITE_CSS = `
:root{
  --bg:#f7f8fa; --surface:#ffffff; --border:#dfe1e6; --text:#172b4d; --text-faint:#5e6c84;
  --accent:#0052cc; --accent-fg:#ffffff; --shadow:0 1px 3px rgba(9,30,66,0.15), 0 0 1px rgba(9,30,66,0.2);
  --radius:8px;
}
@media (prefers-color-scheme: dark){
  :root{
    --bg:#0d1117; --surface:#161b22; --border:#30363d; --text:#e6edf3; --text-faint:#8b949e;
    --accent:#4c9aff; --accent-fg:#0d1117; --shadow:0 1px 3px rgba(0,0,0,0.4);
  }
}
*{box-sizing:border-box;}
body{
  margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  background:var(--bg); color:var(--text); line-height:1.6;
}
a{color:var(--accent);}
.help-topbar{
  display:flex; align-items:center; justify-content:space-between; gap:16px;
  padding:14px 28px; background:var(--surface); border-bottom:1px solid var(--border);
  position:sticky; top:0; z-index:10;
}
.help-topbar-brand{font-weight:800; font-size:15px; text-decoration:none; color:var(--text);}
.help-topbar-brand span{font-weight:200;}
.help-topbar-back{font-size:13px; text-decoration:none; color:var(--text-faint);}
.help-shell{
  max-width:1180px; margin:0 auto; padding:28px 24px 64px;
  display:grid; grid-template-columns:250px 1fr; gap:36px; align-items:start;
}
.help-nav{
  position:sticky; top:70px; background:var(--surface); border:1px solid var(--border);
  border-radius:var(--radius); padding:10px; box-shadow:var(--shadow);
}
.help-nav-title{font-size:11px; text-transform:uppercase; letter-spacing:0.06em; color:var(--text-faint); padding:6px 10px;}
.help-nav a{
  display:block; padding:7px 10px; border-radius:6px; font-size:13.5px; color:var(--text);
  text-decoration:none;
}
.help-nav a:hover{background:var(--bg);}
.help-nav a.active{background:var(--accent); color:var(--accent-fg); font-weight:600;}
.help-content{min-width:0;}
.help-hero{
  width:100%; aspect-ratio:16/6; border-radius:var(--radius); background-size:cover; background-position:center;
  margin-bottom:16px; box-shadow:var(--shadow);
}
.help-hero-credit{font-size:11px; color:var(--text-faint); margin:-10px 0 18px;}
.help-hero-credit a{color:inherit;}
h1.help-title{font-size:26px; margin:0 0 4px;}
.help-subtitle{color:var(--text-faint); font-size:15px; margin:0 0 20px;}
.help-mini-toc{
  background:var(--surface); border:1px solid var(--border); border-radius:var(--radius);
  padding:12px 16px; margin-bottom:22px; font-size:13px;
}
.help-mini-toc-title{font-weight:700; margin-bottom:6px;}
.help-mini-toc ul{margin:0; padding-left:18px;}
.help-doc h2{font-size:20px; margin-top:32px;}
.help-doc h3{font-size:16.5px; margin-top:24px;}
.help-doc p, .help-doc li{font-size:14.5px;}
.help-doc table{border-collapse:collapse; width:100%; margin:14px 0; font-size:13.5px;}
.help-doc th, .help-doc td{border:1px solid var(--border); padding:7px 10px; text-align:left;}
.help-doc th{background:var(--bg);}
.help-doc pre{background:var(--bg); padding:12px; border-radius:6px; overflow-x:auto;}
.help-doc code{background:var(--bg); padding:1px 5px; border-radius:4px;}
.help-doc blockquote{border-left:3px solid var(--border); margin:0; padding:2px 16px; color:var(--text-faint);}
.help-pager{display:flex; justify-content:space-between; margin-top:40px; gap:12px;}
.help-pager a{
  flex:1; border:1px solid var(--border); border-radius:var(--radius); padding:12px 16px;
  text-decoration:none; color:var(--text); background:var(--surface); font-size:13.5px;
}
.help-pager a:last-child{text-align:right;}
.help-pager-label{display:block; font-size:11px; color:var(--text-faint); text-transform:uppercase; letter-spacing:0.04em;}
.help-card-grid{display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-top:8px;}
.help-card{
  display:flex; flex-direction:column; background:var(--surface); border:1px solid var(--border);
  border-radius:var(--radius); overflow:hidden; text-decoration:none; color:var(--text); box-shadow:var(--shadow);
}
.help-card-image{height:120px; background-size:cover; background-position:center;}
.help-card-body{padding:14px 16px;}
.help-card-title{font-weight:700; font-size:14.5px; margin-bottom:4px;}
.help-card-desc{font-size:12.5px; color:var(--text-faint); line-height:1.45;}
.help-intro{font-size:15px; color:var(--text-faint); max-width:760px; margin-bottom:24px;}
@media (max-width:860px){
  .help-shell{grid-template-columns:1fr;}
  .help-nav{position:static;}
  .help-card-grid{grid-template-columns:1fr;}
}
`;

function pageShell(guideConfig, opts){
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>' + escapeHTML(opts.title) + ' — ' + escapeHTML(guideConfig.siteTitle) + '</title>' +
    '<style>' + SITE_CSS + '</style>' +
    '</head><body>' +
    '<div class="help-topbar">' +
      '<a class="help-topbar-brand" href="index.html">' + guideConfig.brandHtml + '</a>' +
      '<a class="help-topbar-back" href="/">‹ Back to the app</a>' +
    '</div>' +
    '<div class="help-shell">' +
      navHtml(opts.activeSlug, opts.sections) +
      '<div class="help-content">' + opts.bodyHtml + '</div>' +
    '</div>' +
    '</body></html>';
}

function navHtml(activeSlug, sections){
  const items = sections.map(function(s){
    const cls = s.slug === activeSlug ? ' class="active"' : '';
    return '<a href="' + s.slug + '.html"' + cls + '>' + escapeHTML(s.number + '. ' + s.headline) + '</a>';
  }).join('');
  const homeCls = activeSlug === null ? ' class="active"' : '';
  return '<nav class="help-nav">' +
    '<a href="index.html"' + homeCls + '>Overview</a>' +
    '<div class="help-nav-title">Sections</div>' +
    items +
    '</nav>';
}

function heroHtml(image, altText){
  if(!image) return '';
  return '<div class="help-hero" style="background-image:url(\'' + image.large + '\');" role="img" aria-label="' + escapeHTML(altText) + '"></div>' +
    '<p class="help-hero-credit">Photo by <a href="' + escapeHTML(image.photographerUrl) + '" target="_blank" rel="noopener">' + escapeHTML(image.photographer) + '</a> on <a href="' + escapeHTML(image.pexelsUrl) + '" target="_blank" rel="noopener">Pexels</a></p>';
}

const FALLBACK_COLORS = ['#0052CC', '#00875A', '#DE350B', '#5243AA', '#FF8B00', '#0065FF', '#008DA6', '#6B778C'];

/** guideConfig: {sourceFile, outSlug, siteTitle, brandHtml, landingSubtitle, heroQuery} */
async function buildGuideSite(guideConfig, apiKey, cache){
  const outDir = join(__dirname, 'dist', 'help', guideConfig.outSlug);
  const guideMd = readFileSync(join(__dirname, guideConfig.sourceFile), 'utf8');
  const {introMarkdown, sections} = parseGuide(guideMd);

  // Rendered bodies + resolved images first, so the landing-page card grid and the pager links can
  // reference every section's already-known headline/description/image regardless of build order.
  for(const section of sections){
    section.bodyHtml = addHeadingIds(markdownToDocHtml(section.bodyMarkdown));
    section.description = firstParagraphText(section.bodyHtml);
    section.miniToc = extractMiniToc(section.bodyHtml);
    section.image = await resolveImage(apiKey, cache, guideConfig.outSlug + '::' + section.headline, section.headline);
  }
  const heroImage = await resolveImage(apiKey, cache, guideConfig.outSlug + '::hero', guideConfig.heroQuery);

  mkdirSync(outDir, {recursive: true});

  // --- Landing page ---
  const cardsHtml = sections.map(function(s){
    const bg = s.image ? 'background-image:url(\'' + s.image.medium + '\');' : 'background:' + FALLBACK_COLORS[(s.number - 1) % FALLBACK_COLORS.length] + ';';
    return '<a class="help-card" href="' + s.slug + '.html">' +
      '<div class="help-card-image" style="' + bg + '"></div>' +
      '<div class="help-card-body">' +
        '<div class="help-card-title">' + escapeHTML(s.number + '. ' + s.headline) + '</div>' +
        '<div class="help-card-desc">' + escapeHTML(s.description) + '</div>' +
      '</div>' +
    '</a>';
  }).join('');

  const landingBody =
    heroHtml(heroImage, guideConfig.siteTitle) +
    '<h1 class="help-title">' + escapeHTML(guideConfig.siteTitle) + '</h1>' +
    '<p class="help-subtitle">' + escapeHTML(guideConfig.landingSubtitle) + '</p>' +
    (introMarkdown ? '<div class="help-intro help-doc">' + markdownToDocHtml(introMarkdown) + '</div>' : '') +
    '<div class="help-card-grid">' + cardsHtml + '</div>';

  writeFileSync(join(outDir, 'index.html'), pageShell(guideConfig, {title: 'Overview', activeSlug: null, sections: sections, bodyHtml: landingBody}), 'utf8');

  // --- Section pages ---
  sections.forEach(function(s, idx){
    const prev = sections[idx - 1];
    const next = sections[idx + 1];
    const miniTocHtml = s.miniToc.length >= 2
      ? '<div class="help-mini-toc"><div class="help-mini-toc-title">In this section</div><ul>' +
          s.miniToc.map(function(item){ return '<li><a href="#' + item.id + '">' + escapeHTML(item.text) + '</a></li>'; }).join('') +
        '</ul></div>'
      : '';

    const pagerHtml = '<div class="help-pager">' +
      (prev ? '<a href="' + prev.slug + '.html"><span class="help-pager-label">‹ Previous</span>' + escapeHTML(prev.headline) + '</a>' : '<span></span>') +
      (next ? '<a href="' + next.slug + '.html"><span class="help-pager-label">Next ›</span>' + escapeHTML(next.headline) + '</a>' : '<span></span>') +
      '</div>';

    const bodyHtml =
      heroHtml(s.image, s.headline) +
      '<h1 class="help-title">' + escapeHTML(s.number + '. ' + s.headline) + '</h1>' +
      (s.subtitle ? '<p class="help-subtitle">' + escapeHTML(s.subtitle) + '</p>' : '') +
      miniTocHtml +
      '<div class="help-doc">' + s.bodyHtml + '</div>' +
      pagerHtml;

    writeFileSync(join(outDir, s.slug + '.html'), pageShell(guideConfig, {title: s.number + '. ' + s.headline, activeSlug: s.slug, sections: sections, bodyHtml: bodyHtml}), 'utf8');
  });

  console.log('Built ' + (sections.length + 1) + ' pages into ' + outDir);
}

async function build(){
  const apiKey = loadPexelsApiKey();
  if(!apiKey) console.warn('No PEXELS_API_KEY found (env or .env) — hero images will fall back to a plain colour block.');
  const cache = loadImageCache();

  await buildGuideSite({
    sourceFile: 'USER-GUIDE.md',
    outSlug: 'user-guide',
    siteTitle: 'Enklr Task User Guide',
    brandHtml: 'Enkl<span>r</span> Task — User Guide',
    landingSubtitle: 'Everything you need to get productive with Enklr Task — pick a section below or use the nav on the left.',
    heroQuery: 'team collaboration kanban planning'
  }, apiKey, cache);

  await buildGuideSite({
    sourceFile: 'SYSTEMS-INTEGRATOR-GUIDE.md',
    outSlug: 'system-integrator-guide',
    siteTitle: 'Enklr Task Systems Integrator Guide',
    brandHtml: 'Enkl<span>r</span> Task — Systems Integrator Guide',
    landingSubtitle: 'Deployment models, identity/SSO/SCIM, network and data security, and everything else an integrator needs before go-live.',
    heroQuery: 'server room network security'
  }, apiKey, cache);

  saveImageCache(cache);
}

build();
