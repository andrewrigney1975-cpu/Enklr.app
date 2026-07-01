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

  doc.getElementById('documentsBtn').click();
  await wait(20);
  doc.getElementById('addDocumentBtn').click();
  await wait(10);
  doc.getElementById('documentTitleInput').value = 'With URL';
  doc.getElementById('documentUrlInput').value = 'docs.example.com/page';
  doc.getElementById('documentFormSaveBtn').click();
  await wait(20);

  doc.getElementById('addDocumentBtn').click();
  await wait(10);
  doc.getElementById('documentTitleInput').value = 'Without URL';
  doc.getElementById('documentFormSaveBtn').click();
  await wait(20);

  const withUrlRow = Array.from(doc.querySelectorAll('.kf-release-row')).find(r => r.textContent.indexOf('With URL') !== -1);
  const withoutUrlRow = Array.from(doc.querySelectorAll('.kf-release-row')).find(r => r.textContent.indexOf('Without URL') !== -1);
  const link = withUrlRow.querySelector('.kf-doc-row-link');
  log('a document with a URL shows a link in the list', !!link);
  log('link points to the normalized (https-prefixed) URL', link.getAttribute('href') === 'https://docs.example.com/page', link.getAttribute('href'));
  log('link opens in a new tab', link.getAttribute('target') === '_blank');
  log('link uses noopener/noreferrer for safety', (link.getAttribute('rel') || '').indexOf('noopener') !== -1 && (link.getAttribute('rel') || '').indexOf('noreferrer') !== -1);
  log('a document with no URL shows no link in the list', !withoutUrlRow.querySelector('.kf-doc-row-link'));

  link.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await wait(10);
  log('clicking the link does not open the document edit form',
      !doc.getElementById('documentsListView').classList.contains('hidden') && doc.getElementById('documentsFormView').classList.contains('hidden'));

  log('search input exists in the Documents modal', !!doc.getElementById('documentsSearchInput'));
  doc.getElementById('documentsSearchInput').value = 'with url';
  doc.getElementById('documentsSearchInput').dispatchEvent(new window.Event('input', { bubbles: true }));
  await wait(10);
  let visibleRows = doc.querySelectorAll('#documentsList .kf-release-row');
  log('searching "with url" (case-insensitive) shows only the matching document', visibleRows.length === 1 && visibleRows[0].textContent.indexOf('With URL') !== -1, visibleRows.length);

  doc.getElementById('documentsSearchInput').value = 'nonexistent xyz';
  doc.getElementById('documentsSearchInput').dispatchEvent(new window.Event('input', { bubbles: true }));
  await wait(10);
  log('a search with no matches shows a "no documents match" message, not the generic empty state',
      doc.getElementById('documentsList').textContent.indexOf('No documents match') !== -1, doc.getElementById('documentsList').textContent);

  doc.getElementById('documentsSearchInput').value = '';
  doc.getElementById('documentsSearchInput').dispatchEvent(new window.Event('input', { bubbles: true }));
  await wait(10);
  log('clearing the search restores the full list', doc.querySelectorAll('#documentsList .kf-release-row').length === 2);

  doc.getElementById('documentsSearchInput').value = 'with url';
  doc.getElementById('documentsSearchInput').dispatchEvent(new window.Event('input', { bubbles: true }));
  await wait(10);
  const stillFilteredRow = Array.from(doc.querySelectorAll('.kf-release-row')).find(r => r.textContent.indexOf('With URL') !== -1);
  stillFilteredRow.click();
  await wait(10);
  doc.getElementById('documentFormCancelBtn').click();
  await wait(10);
  log('search term persists after canceling out of the edit form back to the list', doc.getElementById('documentsSearchInput').value === 'with url');
  log('the filtered list is still showing just the one match after returning', doc.querySelectorAll('#documentsList .kf-release-row').length === 1);

  doc.getElementById('documentsModalClose').click();
  await wait(10);
  doc.getElementById('documentsBtn').click();
  await wait(20);
  log('reopening the modal resets the search term', doc.getElementById('documentsSearchInput').value === '');
  log('reopening the modal shows the full unfiltered list', doc.querySelectorAll('#documentsList .kf-release-row').length === 2);
  doc.getElementById('documentsModalClose').click();
  await wait(10);

  console.log('\nDocuments list link and search test complete.');
  process.exit(0);
})().catch(e => { console.error('CRASHED', e); process.exit(1); });
