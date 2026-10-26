/* ===================== tablets, phones and touch =====================
   The layout itself is CSS (styles.css: tablet ≤ 1099 px, phone ≤ 767 px). Here: the ☰ menu and the panels
   drawer/sheet, two-finger pinch-zoom and pan, long-press for the right-click menus, double-tap for
   double-click, and long-press on a palette swatch for the outline colour. */

const Touch = {
  suppressClick: false,
  openDock(on){ document.querySelector('.dock').classList.toggle('open', on); $('scrim').classList.toggle('on', on); },
  small: () => matchMedia('(max-width: 1099px)').matches,
};

/* ---------- menu and panels ---------- */
$('bMenu').onclick = e => { e.stopPropagation(); $('menu').classList.toggle('open'); };
$('menu').addEventListener('click', e => { if (e.target.closest('[data-cmd]') && $('menu').classList.contains('open')) $('menu').classList.remove('open'); });
$('bPanels').onclick = () => Touch.openDock(!document.querySelector('.dock').classList.contains('open'));
$('bDockClose').onclick = () => Touch.openDock(false);
$('scrim').onclick = () => Touch.openDock(false);
// a swipe down on the sheet's grip closes it
(function(){
  let y0 = null;
  document.querySelector('.dgrip').addEventListener('touchstart', e => { y0 = e.touches[0].clientY; }, {passive: true});
  document.addEventListener('touchmove', e => { if (y0 != null && e.touches[0].clientY - y0 > 60){ Touch.openDock(false); y0 = null; } }, {passive: true});
  document.addEventListener('touchend', () => { y0 = null; });
})();
// opening a panel from a command (fill, opacity…) also opens the drawer on small screens
(function(){ const base = showDock; window.showDock = d => { base(d); if (Touch.small()) Touch.openDock(true); }; })();
window.addEventListener('resize', () => { if (!Touch.small()){ Touch.openDock(false); $('menu').classList.remove('open'); } });

/* ---------- two fingers: pinch to zoom, drag to pan ---------- */
(function(){
  const stage = $('stage');
  let pinch = null;
  const mid = t => ({x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2});
  const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY) || 1;
  const toScene = m => { const r = canvas.upperCanvasEl.getBoundingClientRect(), v = canvas.viewportTransform; return {x: (m.x - r.left - v[4]) / v[0], y: (m.y - r.top - v[5]) / v[3]}; };
  stage.addEventListener('touchstart', e => {
    if (e.touches.length !== 2) return;
    e.preventDefault(); e.stopPropagation();
    // the first finger may have started a move or a marquee: undo it
    const tr = canvas._currentTransform;
    if (tr){ Pick.restore(tr.target, tr.original); canvas._currentTransform = null; }
    canvas._groupSelector = null; canvas.clearContext(canvas.contextTop);
    const m = mid(e.touches);
    pinch = {d: dist(e.touches), z: zoom, p: toScene(m), last: m};
    clearTimeout(lp && lp.t); lp = null;
  }, {capture: true, passive: false});
  stage.addEventListener('touchmove', e => {
    if (!pinch) return;
    e.preventDefault(); e.stopPropagation();
    if (e.touches.length < 2) return;
    const m = mid(e.touches);
    setZoom(pinch.z * dist(e.touches) / pinch.d);
    // keep the point between the fingers under them
    const r = canvas.upperCanvasEl.getBoundingClientRect(), v = canvas.viewportTransform;
    stage.scrollLeft += r.left + v[4] + pinch.p.x * v[0] - m.x;
    stage.scrollTop += r.top + v[5] + pinch.p.y * v[3] - m.y;
    drawRulers(); canvas.calcOffset();
  }, {capture: true, passive: false});
  ['touchend', 'touchcancel'].forEach(t => stage.addEventListener(t, e => {
    if (!pinch) return;
    e.stopPropagation();
    if (e.touches.length === 0){ pinch = null; canvas.calcOffset(); canvas.requestRenderAll(); }
  }, {capture: true}));
})();

/* ---------- long-press = right-click; double-tap = double-click ---------- */
let lp = null;
(function(){
  const el = canvas.upperCanvasEl;
  const fire = () => {
    const at = lp; lp = null; if (!at) return;
    const tr = canvas._currentTransform;
    if (tr){ Pick.restore(tr.target, tr.original); canvas._currentTransform = null; canvas.requestRenderAll(); }
    canvas._groupSelector = null;
    Touch.suppressClick = true;
    if (navigator.vibrate) navigator.vibrate(12);
    const opt = {bubbles: true, cancelable: true, view: window, clientX: at.x, clientY: at.y, button: 2, buttons: 2};
    el.dispatchEvent(new MouseEvent('mousedown', opt));
    document.dispatchEvent(new MouseEvent('mouseup', Object.assign({}, opt, {buttons: 0})));
  };
  el.addEventListener('touchstart', e => {
    clearTimeout(lp && lp.t); lp = null;
    if (e.touches.length !== 1) return;
    const t = e.touches[0]; lp = {x: t.clientX, y: t.clientY, t: setTimeout(fire, 550)};
  }, {passive: true});
  el.addEventListener('touchmove', e => { if (lp && Math.hypot(e.touches[0].clientX - lp.x, e.touches[0].clientY - lp.y) > 10){ clearTimeout(lp.t); lp = null; } }, {passive: true});
  el.addEventListener('touchend', () => { if (lp){ clearTimeout(lp.t); lp = null; } }, {passive: true});
  let lastTap = null;
  canvas.on('mouse:up', o => {
    if (!o.e || !o.e.type || !o.e.type.startsWith('touch')) return;
    if (Touch.suppressClick){ Touch.suppressClick = false; lastTap = null; return; }
    const p = fabric.util.getPointer(o.e), now = Date.now();
    if (lastTap && now - lastTap.t < 320 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 24){
      lastTap = null;
      canvas.fire('mouse:dblclick', {e: o.e, target: o.target, pointer: canvas.getPointer(o.e)});
      if (o.target && o.target.fire) o.target.fire('mousedblclick', {e: o.e});
    } else lastTap = {t: now, x: p.x, y: p.y};
  });
})();

/* ---------- palette: tap = fill, hold = outline ---------- */
(function(){
  const pal = $('pal'); let hold = null, held = false;
  pal.addEventListener('touchstart', e => {
    const sw = e.target.closest('[data-c], #palNone'); if (!sw) return;
    held = false;
    hold = setTimeout(() => { held = true; paletteApply(sw.id === 'palNone' ? null : sw.dataset.c, true); if (navigator.vibrate) navigator.vibrate(12); }, 450);
  }, {passive: true});
  ['touchend', 'touchmove', 'touchcancel'].forEach(t => pal.addEventListener(t, () => clearTimeout(hold), {passive: true}));
  pal.addEventListener('click', e => { if (held){ e.stopImmediatePropagation(); e.preventDefault(); held = false; } }, true);
  if (matchMedia('(pointer: coarse)').matches){ const l = pal.querySelector('.lbl'); if (l) l.textContent = 'Tap = fill · hold = outline'; }
})();
