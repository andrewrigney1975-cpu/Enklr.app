"use strict";

export function toast(message){
  var wrap = document.getElementById('toastWrap');
  var el = document.createElement('div');
  el.className = 'kf-toast';
  el.textContent = message;
  wrap.appendChild(el);
  setTimeout(function(){
    el.style.transition = 'opacity .2s';
    el.style.opacity = '0';
    setTimeout(function(){ el.remove(); }, 200);
  }, 2600);
}
