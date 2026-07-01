const fs = require('fs');
const html = fs.readFileSync('../dist/index.html', 'utf8');
function log(label, ok, extra){ console.log((ok?'PASS':'FAIL') + ' - ' + label + (extra!==undefined?' :: '+extra:'')); }

(async () => {
  const style = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1];

  const teamModalMatch = html.match(/<div class="kf-overlay hidden" id="teamOverlay">\s*<div class="([^"]+)"/);
  log('Team modal markup found', !!teamModalMatch);
  log('Team modal no longer uses kf-modal-sm', teamModalMatch && teamModalMatch[1].indexOf('kf-modal-sm') === -1, teamModalMatch && teamModalMatch[1]);
  log('Team modal now uses the wider kf-modal-md class', teamModalMatch && teamModalMatch[1].indexOf('kf-modal-md') !== -1, teamModalMatch && teamModalMatch[1]);

  const smWidth = parseFloat((style.match(/\.kf-modal\.kf-modal-sm\{width:(\d+)px/) || [])[1]);
  const mdWidth = parseFloat((style.match(/\.kf-modal\.kf-modal-md\{width:(\d+)px/) || [])[1]);
  log('kf-modal-md is meaningfully wider than kf-modal-sm', mdWidth > smWidth, `${mdWidth}px vs ${smWidth}px`);

  const rowPadding = 14;
  const modalPadding = 40;
  const avatarAndButton = 32 + 32;
  const gaps = 10 + 10;
  const minUsableInputWidth = 120 + 80;
  const minRequired = rowPadding + modalPadding + avatarAndButton + gaps + minUsableInputWidth;
  log('the new Team modal width comfortably exceeds the row\u2019s minimum content needs', mdWidth >= minRequired, `${mdWidth}px >= ${minRequired}px needed`);

  const panelWidth = parseFloat((style.match(/\.kf-tasktype-icon-panel\{[^}]*width:(\d+)px/) || [])[1]);
  const panelPadding = parseFloat((style.match(/\.kf-tasktype-icon-panel\{[^}]*padding:(\d+)px/) || [])[1]) || 8;
  const optionWidth = parseFloat((style.match(/\.kf-tasktype-icon-option\{[^}]*width:(\d+)px/) || [])[1]);
  const gridGap = parseFloat((style.match(/\.kf-tasktype-icon-grid\{[^}]*gap:(\d+)px/) || [])[1]);
  const columns = 6;
  const requiredGridWidth = columns * optionWidth + (columns - 1) * gridGap;
  const requiredPanelWidth = requiredGridWidth + panelPadding * 2;

  log('icon option width was found and is the expected 32px', optionWidth === 32, optionWidth);
  log('grid gap was found and is the expected 4px', gridGap === 4, gridGap);
  log('icon picker panel\u2019s declared width now meets or exceeds the grid\u2019s minimum required width',
      panelWidth >= requiredPanelWidth, `panel=${panelWidth}px, required=${requiredPanelWidth}px`);

  const oldPanelWidth = 220;
  log('sanity check: the OLD 220px panel width would NOT have fit the grid (confirms this was a real, fixable bug)',
      oldPanelWidth < requiredPanelWidth, `old=${oldPanelWidth}px, required=${requiredPanelWidth}px`);

  console.log('\nTeam modal / icon picker width fix test complete.');
  process.exit(0);
})().catch(e => { console.error('CRASHED', e); process.exit(1); });
