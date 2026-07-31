"use strict";
import { getBoardBackground, setBoardBackground, clearBoardBackground, getHeaderColor, setHeaderColor, clearHeaderColor, getOpeningExperience, getUserAvatar, setUserAvatar, clearUserAvatar } from '../storage.js';
import { toast } from '../ui.js';
import { contrastTextColor, shadeHexColor } from '../date-utils.js';
import { openOpeningExperienceModal } from './opening-experience.js';

var MAX_IMAGE_BYTES = 3 * 1024 * 1024; // localStorage is typically 5-10MB total; leave headroom for the rest of state.db.
var MAX_AVATAR_BYTES = 200 * 1024; // deliberately much tighter than the board-background cap above — an avatar is a small header thumbnail, not a full-viewport image.
var IMAGE_DISPLAY_SIZE = {fill: 'cover', stretch: '100% 100%', tile: 'auto'};
var IMAGE_DISPLAY_REPEAT = {fill: 'no-repeat', stretch: 'no-repeat', tile: 'repeat'};
var DEFAULT_HEADER_COLOR = '#0c2a52'; // matches --kf-navy, the un-customized default

/* Applies the persisted header colour preference. Exported for the same reasons as
   applyBoardBackground below (called once at init(), then live on every change in the modal).
   Everything under .kf-header reads its color/border/background through a --kf-header-* custom
   property (see styles.css) that falls back to the normal navy theme when unset, so re-theming the
   whole header — buttons, logo, divider — only needs a handful of properties set here, EXCEPT
   #projectSelect (.kf-select-dark), which reads as its own slightly-offset panel (like
   --kf-navy-light against --kf-navy today) rather than "header text/border on transparent" — its
   background/foreground/border are computed from the custom colour via shadeHexColor, not copied
   from the header's own values, so it keeps that same "distinct panel" relationship at any custom
   colour instead of blending flush into the header or losing contrast against it.
   Set on <html> (document.documentElement), not .kf-header itself or #app — custom properties only
   inherit to DESCENDANTS, and #app stops being a common-enough ancestor once a consumer needs to
   live OUTSIDE it entirely: the Chat/AI Assistant bubbles (styles.css's .kf-chat-bubble, which also
   reads --kf-header-bg/-fg) live under .kf-board-wrap, a sibling of .kf-header but still inside
   #app, while modal overlays like #appSettingsOverlay (its own .kf-setting-row-icon colouring, see
   styles.css) are siblings of #app itself, rendered directly under <body>. <html> is the one
   ancestor common to all of them, so setting the properties there once reaches everything that
   needs them without duplicating the values anywhere. */
export function applyHeaderColor(){
  var root = document.documentElement;
  ['--kf-header-bg', '--kf-header-fg', '--kf-header-divider', '--kf-header-btn-border', '--kf-header-btn-hover',
   '--kf-header-select-bg', '--kf-header-select-fg', '--kf-header-select-border'].forEach(function(p){
    root.style.removeProperty(p);
  });

  var hex = getHeaderColor();
  if(!hex) return;

  var fg = contrastTextColor(hex);
  var dark = fg === '#ffffff'; // true => header bg is dark enough that the existing translucent-white accents still read; false => they need to flip to translucent-black instead.
  root.style.setProperty('--kf-header-bg', hex);
  root.style.setProperty('--kf-header-fg', fg);
  root.style.setProperty('--kf-header-divider', dark ? 'rgba(255,255,255,.25)' : 'rgba(0,0,0,.2)');
  root.style.setProperty('--kf-header-btn-border', dark ? 'rgba(255,255,255,.35)' : 'rgba(0,0,0,.3)');
  root.style.setProperty('--kf-header-btn-hover', dark ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.08)');

  var selectBg = shadeHexColor(hex, dark ? 0.12 : -0.1);
  root.style.setProperty('--kf-header-select-bg', selectBg);
  root.style.setProperty('--kf-header-select-fg', contrastTextColor(selectBg));
  root.style.setProperty('--kf-header-select-border', dark ? 'rgba(255,255,255,.18)' : 'rgba(0,0,0,.18)');
}

/* Applies the persisted board background preference to #app (the whole-viewport-sized, never-
   scrolling app shell — see styles.css's own note on why it lives there and not on .kf-board-wrap,
   the original home for this). Exported so app.js's init() can call it once at startup (alongside
   applyOpeningExperience()) and so this modal can re-apply live as the user changes settings,
   without waiting for a separate "Save" step. The image layer is a ::before pseudo-element (see
   styles.css) rather than a background-image directly on #app, so the "faded" CSS filter can be
   scoped to just the image — a filter on #app itself would wash out the whole app, not just the
   board. The gradient/solid-color cases need no such isolation (no filter involved) so they're
   just a plain background-color/background-image linear-gradient on #app itself. */
export function applyBoardBackground(){
  var app = document.getElementById('app');
  if(!app) return;
  app.classList.remove('kf-board-bg-image', 'kf-board-bg-faded');
  app.style.backgroundColor = '';
  app.style.backgroundImage = '';
  app.style.removeProperty('--kf-board-bg-image-url');
  app.style.removeProperty('--kf-board-bg-image-size');
  app.style.removeProperty('--kf-board-bg-image-repeat');

  var pref = getBoardBackground();
  if(!pref) return;
  if(pref.type === 'color'){
    app.style.backgroundColor = pref.color;
  } else if(pref.type === 'gradient'){
    var dir = pref.gradientDirection === 'horizontal' ? 'to right' : 'to bottom';
    app.style.backgroundImage = 'linear-gradient(' + dir + ', ' + pref.gradientStart + ', ' + pref.gradientEnd + ')';
  } else if(pref.type === 'image'){
    app.classList.add('kf-board-bg-image');
    app.style.setProperty('--kf-board-bg-image-url', 'url("' + pref.imageData + '")');
    app.style.setProperty('--kf-board-bg-image-size', IMAGE_DISPLAY_SIZE[pref.display]);
    app.style.setProperty('--kf-board-bg-image-repeat', IMAGE_DISPLAY_REPEAT[pref.display]);
    if(pref.faded) app.classList.add('kf-board-bg-faded');
  }
}

/* Applies the persisted avatar to the header — exported so app.js's init() can call it once at
   startup (alongside applyBoardBackground/applyHeaderColor) and so this modal can update it live
   the moment a photo is uploaded/removed, without a separate "Save" step. The header element itself
   (#headerAvatar) sits permanently in the DOM between the Account menu and the Refresh button (see
   index.html) and is just hidden via kf-vis-hidden when no avatar is set, rather than being
   created/destroyed — matching every other "optional header element" in this app. */
export function applyUserAvatar(){
  var avatar = getUserAvatar();
  var img = document.getElementById('headerAvatar');
  if(!img) return;
  if(avatar){
    img.src = avatar;
    img.classList.remove('kf-vis-hidden');
  } else {
    img.src = '';
    img.classList.add('kf-vis-hidden');
  }
}

export function openMyPreferencesModal(){
  populateMyPreferencesModal();
  document.getElementById('myPreferencesOverlay').classList.remove('hidden');
}
export function closeMyPreferencesModal(){
  document.getElementById('myPreferencesOverlay').classList.add('hidden');
}
export function isMyPreferencesModalOpen(){
  return !document.getElementById('myPreferencesOverlay').classList.contains('hidden');
}

function updateBoardBackgroundFieldVisibility(type){
  document.getElementById('boardBackgroundColorField').classList.toggle('kf-vis-hidden', type !== 'color');
  document.getElementById('boardBackgroundGradientField').classList.toggle('kf-vis-hidden', type !== 'gradient');
  document.getElementById('boardBackgroundImageField').classList.toggle('kf-vis-hidden', type !== 'image');
}

function populateMyPreferencesModal(){
  var avatar = getUserAvatar();
  var avatarPreview = document.getElementById('userAvatarPreviewImg');
  avatarPreview.src = avatar || '';
  avatarPreview.classList.toggle('kf-vis-hidden', !avatar);
  document.getElementById('userAvatarRemoveBtn').classList.toggle('kf-vis-hidden', !avatar);

  var headerColor = getHeaderColor();
  document.getElementById('headerColorInput').value = headerColor || DEFAULT_HEADER_COLOR;
  document.getElementById('headerColorResetBtn').classList.toggle('kf-vis-hidden', !headerColor);

  var pref = getBoardBackground();
  var type = pref ? pref.type : 'none';
  document.getElementById('boardBackgroundTypeSelect').value = type;
  document.getElementById('boardBackgroundColorInput').value = (pref && pref.type === 'color') ? pref.color : '#f4f5f7';

  document.getElementById('boardBackgroundGradientStartInput').value = (pref && pref.type === 'gradient') ? pref.gradientStart : '#4f46e5';
  document.getElementById('boardBackgroundGradientEndInput').value = (pref && pref.type === 'gradient') ? pref.gradientEnd : '#f4f5f7';
  document.getElementById('boardBackgroundGradientDirectionSelect').value = (pref && pref.type === 'gradient') ? pref.gradientDirection : 'vertical';

  var hasImage = !!(pref && pref.type === 'image');
  var previewImg = document.getElementById('boardBackgroundPreviewImg');
  previewImg.src = hasImage ? pref.imageData : '';
  previewImg.classList.toggle('kf-vis-hidden', !hasImage);
  document.getElementById('boardBackgroundRemoveImageBtn').classList.toggle('kf-vis-hidden', !hasImage);
  document.getElementById('boardBackgroundDisplaySelect').value = hasImage ? pref.display : 'fill';
  document.getElementById('boardBackgroundDisplaySelect').disabled = !hasImage;
  document.getElementById('boardBackgroundFadedCheckbox').checked = hasImage && !!pref.faded;
  document.getElementById('boardBackgroundFadedCheckbox').disabled = !hasImage;

  updateBoardBackgroundFieldVisibility(type);

  // Only meaningful for the same anonymous-mobile-first-run audience the Opening Experience
  // picker itself targets (see modals/opening-experience.js/board.js's prior myPreferencesBtn
  // gating) — a browser with nothing stored yet has no "default view" to revisit here.
  document.getElementById('myPreferencesOpeningExperienceSection').classList.toggle('kf-vis-hidden', !getOpeningExperience());
}

export function onBoardBackgroundTypeChange(){
  var type = document.getElementById('boardBackgroundTypeSelect').value;
  updateBoardBackgroundFieldVisibility(type);
  if(type === 'none'){
    clearBoardBackground();
  } else if(type === 'color'){
    setBoardBackground({type: 'color', color: document.getElementById('boardBackgroundColorInput').value});
  } else if(type === 'gradient'){
    setBoardBackground({
      type: 'gradient',
      gradientStart: document.getElementById('boardBackgroundGradientStartInput').value,
      gradientEnd: document.getElementById('boardBackgroundGradientEndInput').value,
      gradientDirection: document.getElementById('boardBackgroundGradientDirectionSelect').value
    });
  } else if(type === 'image'){
    var pref = getBoardBackground();
    if(!pref || pref.type !== 'image'){
      // Switching to "Image" with nothing uploaded yet — nothing to persist until a file is chosen.
      applyBoardBackground();
      return;
    }
  }
  applyBoardBackground();
}

export function onBoardBackgroundColorChange(){
  setBoardBackground({type: 'color', color: document.getElementById('boardBackgroundColorInput').value});
  applyBoardBackground();
}

export function onBoardBackgroundGradientChange(){
  setBoardBackground({
    type: 'gradient',
    gradientStart: document.getElementById('boardBackgroundGradientStartInput').value,
    gradientEnd: document.getElementById('boardBackgroundGradientEndInput').value,
    gradientDirection: document.getElementById('boardBackgroundGradientDirectionSelect').value
  });
  applyBoardBackground();
}

export function onBoardBackgroundDisplayChange(){
  var pref = getBoardBackground();
  if(!pref || pref.type !== 'image') return;
  setBoardBackground({type: 'image', imageData: pref.imageData, faded: pref.faded, display: document.getElementById('boardBackgroundDisplaySelect').value});
  applyBoardBackground();
}

export function onBoardBackgroundFadedChange(){
  var pref = getBoardBackground();
  if(!pref || pref.type !== 'image') return;
  setBoardBackground({type: 'image', imageData: pref.imageData, faded: document.getElementById('boardBackgroundFadedCheckbox').checked, display: pref.display});
  applyBoardBackground();
}

export function onBoardBackgroundFileChange(e){
  var file = e.target.files && e.target.files[0];
  e.target.value = '';
  if(!file) return;
  if(file.type.indexOf('image/') !== 0){
    toast('Please choose an image file.');
    return;
  }
  if(file.size > MAX_IMAGE_BYTES){
    toast('That image is too large (max 3MB) — try a smaller file.');
    return;
  }
  var reader = new FileReader();
  reader.onerror = function(){
    toast('Could not read that image file.');
  };
  reader.onload = function(){
    var faded = document.getElementById('boardBackgroundFadedCheckbox').checked;
    var display = document.getElementById('boardBackgroundDisplaySelect').value || 'fill';
    if(!setBoardBackground({type: 'image', imageData: reader.result, faded: faded, display: display})){
      toast('Could not save that image — it may be too large for local storage.');
      return;
    }
    document.getElementById('boardBackgroundTypeSelect').value = 'image';
    updateBoardBackgroundFieldVisibility('image');
    var previewImg = document.getElementById('boardBackgroundPreviewImg');
    previewImg.src = reader.result;
    previewImg.classList.remove('kf-vis-hidden');
    document.getElementById('boardBackgroundRemoveImageBtn').classList.remove('kf-vis-hidden');
    document.getElementById('boardBackgroundDisplaySelect').value = display;
    document.getElementById('boardBackgroundDisplaySelect').disabled = false;
    document.getElementById('boardBackgroundFadedCheckbox').disabled = false;
    applyBoardBackground();
  };
  reader.readAsDataURL(file);
}

export function removeBoardBackgroundImage(){
  clearBoardBackground();
  document.getElementById('boardBackgroundTypeSelect').value = 'none';
  updateBoardBackgroundFieldVisibility('none');
  var previewImg = document.getElementById('boardBackgroundPreviewImg');
  previewImg.src = '';
  previewImg.classList.add('kf-vis-hidden');
  document.getElementById('boardBackgroundRemoveImageBtn').classList.add('kf-vis-hidden');
  document.getElementById('boardBackgroundDisplaySelect').value = 'fill';
  document.getElementById('boardBackgroundDisplaySelect').disabled = true;
  document.getElementById('boardBackgroundFadedCheckbox').checked = false;
  document.getElementById('boardBackgroundFadedCheckbox').disabled = true;
  applyBoardBackground();
}

export function onUserAvatarFileChange(e){
  var file = e.target.files && e.target.files[0];
  e.target.value = '';
  if(!file) return;
  if(file.type.indexOf('image/') !== 0){
    toast('Please choose an image file.');
    return;
  }
  if(file.size > MAX_AVATAR_BYTES){
    toast('That image is too large (max 200KB) — try a smaller file.');
    return;
  }
  var reader = new FileReader();
  reader.onerror = function(){
    toast('Could not read that image file.');
  };
  reader.onload = function(){
    if(!setUserAvatar(reader.result)){
      toast('Could not save that image — it may be too large for local storage.');
      return;
    }
    var avatarPreview = document.getElementById('userAvatarPreviewImg');
    avatarPreview.src = reader.result;
    avatarPreview.classList.remove('kf-vis-hidden');
    document.getElementById('userAvatarRemoveBtn').classList.remove('kf-vis-hidden');
    applyUserAvatar();
  };
  reader.readAsDataURL(file);
}

export function removeUserAvatar(){
  clearUserAvatar();
  var avatarPreview = document.getElementById('userAvatarPreviewImg');
  avatarPreview.src = '';
  avatarPreview.classList.add('kf-vis-hidden');
  document.getElementById('userAvatarRemoveBtn').classList.add('kf-vis-hidden');
  applyUserAvatar();
}

export function onHeaderColorChange(){
  setHeaderColor(document.getElementById('headerColorInput').value);
  document.getElementById('headerColorResetBtn').classList.remove('kf-vis-hidden');
  applyHeaderColor();
}

export function resetHeaderColor(){
  clearHeaderColor();
  document.getElementById('headerColorInput').value = DEFAULT_HEADER_COLOR;
  document.getElementById('headerColorResetBtn').classList.add('kf-vis-hidden');
  applyHeaderColor();
}

export function changeDefaultViewFromPreferences(){
  closeMyPreferencesModal();
  openOpeningExperienceModal();
}
