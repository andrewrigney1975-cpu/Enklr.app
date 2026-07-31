const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync('../dist/index.html', 'utf8');
function wait(ms){ return new Promise(r => setTimeout(r, ms)); }

(async () => {
  function log(label, ok, extra){ console.log((ok?'PASS':'FAIL') + ' - ' + label + (extra !== undefined ? ' :: ' + extra : '')); }

  var portal = {id: 'portal1', name: 'Support Portal', slug: 'support', description: 'Ask us anything', iconName: null};
  var forms = [
    {formGroupId: 'fg1', formName: 'Expense Claim'},
    {formGroupId: 'fg2', formName: 'IT Access Request'},
    {formGroupId: 'fg3', formName: 'Holiday Request'}
  ];

  function ok(body){ return {ok: true, status: 200, json: async () => body}; }

  const dom = new JSDOM(html, {
    runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/', pretendToBeVisual: true,
    beforeParse(w){
      w.fetch = async function(url, options){
        var method = (options && options.method) || 'GET';
        if(url === '/api/portals/support' && method === 'GET') return ok(portal);
        if(url === '/api/portals/portal1/forms' && method === 'GET') return ok(forms);
        if(url === '/api/portals/portal1/qa' && method === 'GET') return ok({topics: [], entries: []});
        // Submissions/awaiting lists — not under test here, both real array shapes.
        return ok([]);
      };
    }
  });
  await wait(300);
  const doc = dom.window.document;

  // Open the Portal directly via its exported hash-router entry point (same path a real
  // #!/portal/<slug> deep link takes).
  dom.window.location.hash = '#!/portal/support';
  dom.window.dispatchEvent(new dom.window.Event('hashchange'));
  await wait(30);

  log('Portal home overlay opens', !doc.getElementById('portalHomeOverlay').classList.contains('hidden'));
  log('all 3 forms render with no search applied', doc.querySelectorAll('#portalHomeFormsList [data-form-group-id]').length === 3);

  const searchInput = doc.getElementById('portalHomeFormsSearchInput');
  const clearBtn = doc.getElementById('portalHomeFormsSearchClearBtn');
  log('forms search box uses the same styling class as the Q&A search box', doc.querySelector('.kf-portal-forms-search') && doc.querySelector('.kf-portal-forms-search').classList.contains('kf-search'));
  log('clear button starts hidden', clearBtn.classList.contains('kf-vis-hidden'));

  searchInput.value = 'request';
  searchInput.dispatchEvent(new dom.window.Event('input', {bubbles: true}));
  await wait(10);

  const visibleTiles = () => Array.from(doc.querySelectorAll('#portalHomeFormsList [data-form-group-id]')).map(t => t.textContent.trim());
  log('searching "request" filters to the 2 matching forms (case-insensitive)', visibleTiles().length === 2, visibleTiles().join(','));
  log('"IT Access Request" matches', visibleTiles().indexOf('IT Access Request') !== -1);
  log('"Holiday Request" matches', visibleTiles().indexOf('Holiday Request') !== -1);
  log('"Expense Claim" is filtered out', visibleTiles().indexOf('Expense Claim') === -1);
  log('clear button becomes visible while a search term is present', !clearBtn.classList.contains('kf-vis-hidden'));
  log('"no forms available" empty state stays hidden while filtering (there ARE forms, just filtered)', doc.getElementById('portalHomeFormsEmpty').classList.contains('hidden'));

  searchInput.value = 'zzz-no-such-form';
  searchInput.dispatchEvent(new dom.window.Event('input', {bubbles: true}));
  await wait(10);
  log('a search with no matches shows the "no matches" empty state, not the "no forms" one', !doc.getElementById('portalHomeFormsNoMatches').classList.contains('hidden') && doc.getElementById('portalHomeFormsEmpty').classList.contains('hidden'));
  // Checks ACTUAL computed visibility, not just classList state — a bare `.hidden` class does
  // nothing anywhere in this app's CSS unless a matching compound selector (e.g.
  // `#portalHomeFormsNoMatches.hidden`) exists for it (root CLAUDE.md's own documented gotcha).
  // This is exactly the regression a classList-only assertion would miss.
  const noMatchesDisplay = dom.window.getComputedStyle(doc.getElementById('portalHomeFormsNoMatches')).display;
  log('the "no matches" message is actually rendered (real .hidden CSS backing, not just class state)', noMatchesDisplay !== 'none', noMatchesDisplay);
  log('zero tiles render for a non-matching search', doc.querySelectorAll('#portalHomeFormsList [data-form-group-id]').length === 0);

  clearBtn.click();
  await wait(10);
  log('clicking Clear restores all 3 forms', doc.querySelectorAll('#portalHomeFormsList [data-form-group-id]').length === 3);
  log('clicking Clear empties the input', searchInput.value === '');
  log('clicking Clear hides the clear button again', clearBtn.classList.contains('kf-vis-hidden'));
  log('clicking Clear hides the "no matches" state again', doc.getElementById('portalHomeFormsNoMatches').classList.contains('hidden'));

  console.log('\nPortal home forms search test complete.');
  process.exit(0);
})();
