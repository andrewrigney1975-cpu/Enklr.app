"use strict";
import { toast } from '../../js/ui.js';
import { hydrateIcons } from '../../js/icons.js';
import { createRichTextEditor } from '../../js/rich-text/editor.js';
import { markdownToHtml } from '../../js/rich-text/markdown.js';
import { downloadBlob, closeAllExportAsPanels, toggleExportAsPanel } from '../../js/features/svg-export.js';

/* Standalone Notes tool (enklr.app/tools/notes) — see CLAUDE.md for how this differs from any
   future in-app notes feature. There is no server, no session, no project — this file wraps the
   shared rich-text editor factory (rich-text/editor.js, already pure — no api.js/storage.js
   dependency) directly, persisting the draft to this browser's own localStorage exactly like the
   standalone Whiteboard tool persists its elements. Nothing here ever performs a network request. */

var STORAGE_KEY = 'enklr_standalone_notes_v1';
var SAVE_DEBOUNCE_MS = 400;
var _saveTimer = null;
var _editor = null;

function loadDraft(){
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    var parsed = raw ? JSON.parse(raw) : null;
    if(parsed && typeof parsed === 'object'){
      return { title: typeof parsed.title === 'string' ? parsed.title : '', markdown: typeof parsed.markdown === 'string' ? parsed.markdown : '' };
    }
  } catch(e){ /* corrupted/missing — fall through to the empty default */ }
  return { title: '', markdown: '' };
}

function persistDraftNow(){
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      title: document.getElementById('notesTitleInput').value,
      markdown: _editor.getMarkdown()
    }));
  } catch(e){ toast('Could not save — your browser storage may be full.'); }
}

function schedulePersist(){
  if(_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(persistDraftNow, SAVE_DEBOUNCE_MS);
}

function slugifyTitle(title){
  var slug = (title || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'untitled-note';
}

function handleExportMarkdown(){
  var title = document.getElementById('notesTitleInput').value.trim();
  var body = _editor.getMarkdown();
  var markdown = (title ? '# ' + title + '\n\n' : '') + body;
  downloadBlob(new Blob([markdown], {type: 'text/markdown'}), slugifyTitle(title) + '.md');
}

function handleExportHtml(){
  var title = document.getElementById('notesTitleInput').value.trim();
  var bodyHtml = markdownToHtml(_editor.getMarkdown());
  var escapedTitle = (title || 'Untitled note').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // A genuinely standalone HTML document — no dependency on this app's own CSS/JS, so the exported
  // file renders correctly opened on its own, with no other Enkl asset alongside it.
  var html = '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
    '<title>' + escapedTitle + '</title>\n' +
    '<style>\n' +
    '  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;line-height:1.6;color:#172b4d;}\n' +
    '  h1,h2,h3{line-height:1.3;}\n' +
    '  blockquote{margin:0;padding-left:14px;border-left:3px solid #dfe1e6;color:#44546f;}\n' +
    '  a{color:#0c66e4;}\n' +
    '</style>\n</head>\n<body>\n' +
    (title ? '<h1>' + escapedTitle + '</h1>\n' : '') +
    bodyHtml + '\n</body>\n</html>\n';
  downloadBlob(new Blob([html], {type: 'text/html'}), slugifyTitle(title) + '.html');
}

function handleNewNote(){
  if(!window.confirm('Start a new note? This clears the current title and text and cannot be undone.')) return;
  document.getElementById('notesTitleInput').value = '';
  _editor.setMarkdown('');
  persistDraftNow();
  _editor.focus();
}

function wireEvents(){
  hydrateIcons(document);

  var draft = loadDraft();
  document.getElementById('notesTitleInput').value = draft.title;

  _editor = createRichTextEditor(document.getElementById('notesEditor'), document.getElementById('notesToolbar'), { maxLength: 20000 });
  _editor.setMarkdown(draft.markdown);

  document.getElementById('notesTitleInput').addEventListener('input', schedulePersist);
  document.getElementById('notesEditor').addEventListener('input', schedulePersist);

  document.getElementById('notesNewBtn').addEventListener('click', handleNewNote);

  document.getElementById('notesExportAsBtn').addEventListener('click', function(e){
    e.stopPropagation();
    toggleExportAsPanel('notesExportAsPanel');
  });
  document.addEventListener('click', function(e){
    if(!e.target.closest('.kf-export-as-wrap')) closeAllExportAsPanels();
  });
  document.querySelectorAll('#notesExportAsPanel .kf-export-as-option').forEach(function(btn){
    btn.addEventListener('click', function(){
      closeAllExportAsPanels();
      if(btn.getAttribute('data-export-type') === 'markdown') handleExportMarkdown();
      else handleExportHtml();
    });
  });

  // Flush any pending debounced save before the tab actually closes/navigates away.
  window.addEventListener('beforeunload', function(){
    if(_saveTimer) persistDraftNow();
  });
}

wireEvents();
