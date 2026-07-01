const fs = require('fs');
const html = fs.readFileSync('../dist/index.html', 'utf8');
function log(label, ok, extra){ console.log((ok?'PASS':'FAIL') + ' - ' + label + (extra?' :: '+extra:'')); }

const style = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1];
if (!style) { console.error('CRASHED: could not find <style> block'); process.exit(1); }

function ruleFor(selector){
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('(^|[{};,])\\s*' + escaped + '\\{([^}]*)\\}', 'm');
  const m = style.match(re);
  return m ? m[2] : null;
}

const boardTitle = ruleFor('.kf-board-title');
log('.kf-board-title rule found', !!boardTitle);
log('.kf-board-title keeps font-weight:600 (explicit exception)', boardTitle && boardTitle.includes('font-weight:600'), boardTitle);

const all600 = style.match(/font-weight:600/g) || [];
log('exactly one font-weight:600 remains in the whole stylesheet (the .kf-board-title exception)', all600.length === 1, all600.length);

const shouldBe500 = [
  '.kf-select-dark', '.kf-chip-filter', '.kf-dropdown-filter-btn',
  '.kf-dropdown-filter-clear', '.kf-btn', '.kf-add-column',
  '.kf-modal-header h2', '.kf-zoom-label', '.kf-timeline-alert', '.kf-timeline-bar'
];
shouldBe500.forEach(function(sel){
  const rule = ruleFor(sel);
  log('"' + sel + '" is font-weight:500', rule && rule.includes('font-weight:500'), rule);
});

const priorityPill = ruleFor('.kf-priority-pill');
const avatar = ruleFor('.kf-avatar');
log('.kf-priority-pill is font-weight:500', priorityPill && priorityPill.includes('font-weight:500'), priorityPill);
log('.kf-avatar is font-weight:500', avatar && avatar.includes('font-weight:500'), avatar);
log('.kf-priority-pill no longer says font-weight:700', !(priorityPill && priorityPill.includes('font-weight:700')));
log('.kf-avatar no longer says font-weight:700', !(avatar && avatar.includes('font-weight:700')));

console.log('\nFont-weight styling test complete.');
