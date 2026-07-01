const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync('../dist/index.html', 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/', pretendToBeVisual: true });
const { window } = dom;
function wait(ms){ return new Promise(r => setTimeout(r, ms)); }

function rowForType(doc, typeName){
  return Array.from(doc.querySelectorAll('#taskTypeList .kf-member-row')).find(r => r.querySelector('.kf-member-name-input').value === typeName);
}

(async () => {
  await wait(300);
  const doc = window.document;
  function log(label, ok, extra){ console.log((ok?'PASS':'FAIL') + ' - ' + label + (extra?' :: '+extra:'')); }

  const style = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1];
  const panelRule = (style.match(/\.kf-tasktype-icon-panel\{([^}]*)\}/) || [])[1] || '';
  log('icon panel uses position:fixed (escapes the scrollable list\u2019s clipping)', /position:\s*fixed/.test(panelRule), panelRule);
  log('icon panel no longer relies on a static top/left offset from its absolute-positioned parent', !/top:\s*calc/.test(panelRule), panelRule);

  doc.getElementById('taskTypesBtn').click();
  await wait(20);
  const featureRow = rowForType(doc, 'Feature');
  const trigger = featureRow.querySelector('.kf-tasktype-icon-trigger');
  const panel = featureRow.querySelector('.kf-tasktype-icon-panel');

  log('panel starts hidden', panel.classList.contains('hidden'));
  trigger.click();
  await wait(10);
  log('clicking the trigger opens the panel', !panel.classList.contains('hidden'));
  log('opening the panel sets explicit inline left/top coordinates (computed position, not CSS-default)',
      panel.style.left !== '' && panel.style.top !== '', `left=${panel.style.left} top=${panel.style.top}`);

  trigger.click();
  await wait(10);
  log('clicking the trigger again closes it', panel.classList.contains('hidden'));

  trigger.click();
  await wait(10);
  doc.getElementById('taskTypeList').dispatchEvent(new window.Event('scroll', { bubbles: false }));
  await wait(10);
  log('scrolling the type list while open closes the picker (it would otherwise float in the wrong place)',
      panel.classList.contains('hidden'));

  trigger.click();
  await wait(10);
  doc.getElementById('newTaskTypeNameInput').click();
  await wait(10);
  log('clicking outside still closes the picker as before', panel.classList.contains('hidden'));

  trigger.click();
  await wait(10);
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await wait(10);
  log('Escape still closes the picker as before', panel.classList.contains('hidden'));

  console.log('\nTask Type icon picker floating-position test complete.');
  process.exit(0);
})().catch(e => { console.error('CRASHED', e); process.exit(1); });
