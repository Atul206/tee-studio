/* ===================== clip frames (PowerClip), Ctrl+click inside groups, Focus mode =====================
   Ported from TraceDraw's docs/behavior/clip-frame.md, focus-mode.md and pick-tool.md.
   • A clip frame is a group whose first object is the frame (any closed object, text too) and the rest its
     contents: the frame's fill is drawn, the contents are clipped to the frame's outline, then the frame's
     outline is drawn over them.
   • Fabric 5 cannot select an object inside a group, so going inside one (Ctrl+click, double-click, Edit
     Contents) lays its members out on the canvas and folds them back when you leave. Every save, undo step
     and export folds them back first, so files never hold a half-open group. */

const Clip = {
  hatch: null,
  // the frame's outline as a Path2D, in the frame's own space (cached by its geometry)
  path(f){
    const sig = Effects.sig(f) + (f.type === 'path' ? f.path.length : '');
    if (f.__clipPath && f.__clipPath.sig === sig) return f.__clipPath.p;
    if (f.text != null && !window.TEE_FONT_TTF){ TextCurves.ready().then(() => { f.__clipPath = null; canvas.requestRenderAll(); }); return null; }
    let d = null;
    try {
      if (Effects.warps(f)){ const fx = Effects.compute(f); d = fx && fx.geomD; }
      if (!d){ Shaping.init(); d = Effects.toD(Effects.baseOutline(f).map(sp => Object.assign(sp, {closed: true}))); }
    } catch (e){ console.warn('clip frame outline', e); }
    finally { paper.project.clear(); }
    const p = d ? new Path2D(d) : null;
    f.__clipPath = {sig, p};
    return p;
  },
  // is a page point inside frame f (which may sit inside a clip frame group)?
  inside(f, pt){
    const p = this.path(f); if (!p) return true;
    const l = Effects.pt(Effects.inv(f.calcTransformMatrix()), pt.x, pt.y);
    this._ctx = this._ctx || document.createElement('canvas').getContext('2d');
    return this._ctx.isPointInPath(p, l.x, l.y, 'nonzero');
  },
  // draws `f` once more without its fill or effects (the outline over the contents)
  strokeOnly(f, ctx){
    if (!f.stroke || !f.strokeWidth) return;
    // without the cache: a cached frame would bring its fill back over the contents
    const keep = {fill: f.fill, shadow: f.shadow, fx: f.fx, objectCaching: f.objectCaching};
    Object.assign(f, {fill: null, shadow: null, fx: null, objectCaching: false}); f.render(ctx); Object.assign(f, keep);
  },
  props(g){ const o = {}; ['name', 'opacity', 'globalCompositeOperation', 'fx', 'lockedObj', 'visible', 'contentsLocked', 'shadow'].forEach(k => { if (g[k] !== undefined) o[k] = g[k]; }); return o; },
  make(frame, contents, props){
    frame.objectCaching = false;
    const cf = new fabric.Clipframe([frame].concat(contents), Object.assign({name: nameOf(frame) + ' frame', contentsLocked: true}, props || {}));
    cf.objectCaching = false;
    return cf;
  },
  isFrame: o => o && o.type === 'clipframe',
  closed: o => o && !['line', 'polyline', 'image', 'group', 'activeSelection', 'clipframe'].includes(o.type) && !(o.type === 'path' && !o.fill && !/z\s*$/i.test(JSON.stringify(o.path))),

  /* ---------- commands ---------- */
  startPlace(){
    const objs = actives();
    if (!objs.length) return toast('Select the objects to put inside a frame first');
    this.pending = objs.slice(); canvas.discardActiveObject(); canvas.requestRenderAll();
    canvas.defaultCursor = canvas.hoverCursor = this.ARROW;
    $('stSel').innerHTML = '<b>Place inside frame:</b> click the shape to put the selection into (Esc cancels)';
  },
  cancelPlace(){ if (!this.pending) return; this.pending = null; canvas.defaultCursor = 'default'; canvas.hoverCursor = 'move'; refresh(); },
  placeInside(objs, target, replace){
    objs = objs.filter(o => o !== target && canvas.getObjects().includes(o));
    if (!objs.length) return;
    if (!this.isFrame(target) && !this.closed(target)) return toast('The frame must be a closed shape or text (not a line, picture or group)');
    canvas.discardActiveObject(); restoring = true;
    let cf;
    if (this.isFrame(target)){
      // a clip frame already: it takes them in over the contents it holds (or instead of them)
      const i = canvas.getObjects().indexOf(target), props = this.props(target), members = target._objects.slice();
      target._restoreObjectsState(); canvas.remove(target);
      let contents = members.slice(1);
      if (replace) contents = [];
      objs.forEach(o => canvas.remove(o));
      cf = this.make(members[0], contents.concat(objs), props);
      canvas.insertAt(cf, Math.min(i, canvas.getObjects().length));
    } else {
      const i = canvas.getObjects().indexOf(target);
      objs.forEach(o => canvas.remove(o)); canvas.remove(target);
      cf = this.make(target, objs);
      canvas.insertAt(cf, Math.min(i, canvas.getObjects().length));
    }
    restoring = false;
    canvas.setActiveObject(cf); canvas.requestRenderAll(); snapshot(); refresh();
    toast(replace ? 'Contents replaced' : 'Placed inside the frame');
    return cf;
  },
  extract(cf){
    cf = cf || canvas.getActiveObject(); if (!this.isFrame(cf)) return toast('Select a clip frame');
    const i = canvas.getObjects().indexOf(cf), props = this.props(cf), members = cf._objects.slice();
    if (members.length < 2) return toast('This frame is empty');
    restoring = true; canvas.discardActiveObject();
    cf._restoreObjectsState(); canvas.remove(cf);
    const empty = this.make(members[0], [], props); canvas.insertAt(empty, i);
    members.slice(1).forEach((o, k) => canvas.insertAt(o, i + 1 + k));
    restoring = false; selectObjs(members.slice(1)); snapshot(); refresh(); toast('Contents taken out — the empty frame stays');
  },
  emptyFrame(){
    const objs = actives().filter(o => this.closed(o)); if (!objs.length) return toast('Select a closed shape to turn into an empty frame');
    canvas.discardActiveObject(); restoring = true;
    const made = objs.map(o => { const i = canvas.getObjects().indexOf(o); canvas.remove(o); const cf = this.make(o, []); canvas.insertAt(cf, i); return cf; });
    restoring = false; selectObjs(made); snapshot(); refresh(); toast('Empty clip frame — drag a picture onto it holding W to fill it');
  },
  noFrame(){
    const objs = actives().filter(o => this.isFrame(o) && o._objects.length === 1); if (!objs.length) return toast('Select an empty clip frame');
    canvas.discardActiveObject(); restoring = true;
    const made = objs.map(cf => { const i = canvas.getObjects().indexOf(cf), f = cf._objects[0]; cf._restoreObjectsState(); canvas.remove(cf); canvas.insertAt(f, i); return f; });
    restoring = false; selectObjs(made); snapshot(); refresh();
  },
  toggleLock(cf){ cf = cf || canvas.getActiveObject(); if (!this.isFrame(cf)) return; cf.contentsLocked = !cf.contentsLocked; snapshot(); this.bar(); toast(cf.contentsLocked ? 'Contents follow the frame' : 'The frame moves alone — the contents stay put'); },
  // rebuilds a clip frame from its current members, so its box fits them again
  rebuild(cf){
    const i = canvas.getObjects().indexOf(cf), props = this.props(cf), members = cf._objects.slice(), wasActive = canvas.getActiveObject() === cf;
    restoring = true; if (wasActive) canvas.discardActiveObject();
    cf._restoreObjectsState(); canvas.remove(cf);
    const n = this.make(members[0], members.slice(1), props); canvas.insertAt(n, i);
    restoring = false; if (wasActive) canvas.setActiveObject(n);
    return n;
  },
  fit(cf, how){
    cf = cf || canvas.getActiveObject(); if (!this.isFrame(cf) || cf._objects.length < 2) return toast('Select a clip frame with contents');
    const Mg = cf.calcTransformMatrix(), inv = Effects.inv(Mg), f = cf._objects[0], contents = cf._objects.slice(1);
    const box = os => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; os.forEach(o => o.getCoords(true, true).forEach(p => { const q = Effects.pt(Mg, p.x, p.y); x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); })); return {x0, y0, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2}; };
    const fb = box([f]), cb = box(contents);
    let sx = 1, sy = 1;
    if (how === 'fit'){ sx = sy = Math.min(fb.w / cb.w, fb.h / cb.h); }
    if (how === 'fill'){ sx = sy = Math.max(fb.w / cb.w, fb.h / cb.h); }
    if (how === 'stretch'){ sx = fb.w / cb.w; sy = fb.h / cb.h; }
    const T = Effects.mul(Effects.mul([1, 0, 0, 1, fb.cx, fb.cy], [sx, 0, 0, sy, 0, 0]), [1, 0, 0, 1, -cb.cx, -cb.cy]);
    contents.forEach(o => { fabric.util.applyTransformToObject(o, Effects.mul(Effects.mul(inv, Effects.mul(T, Mg)), o.calcOwnMatrix())); o.setCoords(); });
    const n = this.rebuild(cf); canvas.requestRenderAll(); snapshot(); refresh(); this.bar();
    return n;
  },

  /* ---------- floating bar ---------- */
  bar(){
    const a = canvas.getActiveObject(), top = Focus.top(), editing = top && top.kind === 'clip' && top.edit;
    const on = (tool === 'pick' && this.isFrame(a)) || editing;
    $('clipBar').classList.toggle('on', !!on);
    if (!on) return;
    $('cbEdit').style.display = editing ? 'none' : ''; $('cbFinish').style.display = editing ? '' : 'none';
    ['cbSelect', 'cbExtract', 'cbLock', 'cbFit'].forEach(id => $(id).style.display = editing ? 'none' : '');
    if (!editing){ $('cbLock').classList.toggle('on', a.contentsLocked !== false); $('cbExtract').disabled = a._objects.length < 2; $('cbMask').classList.toggle('on', !!a.opacityMask); $('cbInvert').classList.toggle('on', !!a.invertMask); }
    ['cbMask', 'cbInvert'].forEach(id => $(id).style.display = editing ? 'none' : '');
  },
};

/* ---------- the clip frame object ---------- */
fabric.Clipframe = fabric.util.createClass(fabric.Group, {
  type: 'clipframe',
  contentsLocked: true,
  initialize(objects, options, isAlreadyGrouped){ this.callSuper('initialize', objects, options, isAlreadyGrouped); this.objectCaching = false; if (this._objects[0]) this._objects[0].objectCaching = false; },
  shouldCache(){ this.ownCaching = false; return false; },
  drawObject(ctx){
    const f = this._objects[0], contents = this._objects.slice(1);
    if (!f) return;
    f.render(ctx);
    const p = Clip.path(f);
    ctx.save();
    if (p){ ctx.transform(...f.calcOwnMatrix()); ctx.clip(p, 'nonzero'); ctx.transform(...Effects.inv(f.calcOwnMatrix())); }
    contents.forEach(o => o.render(ctx));
    // an empty frame shows a hatched preview on screen
    if (!contents.length && p && ctx === canvas.contextContainer){
      ctx.transform(...f.calcOwnMatrix()); ctx.strokeStyle = 'rgba(148,163,184,.55)'; ctx.lineWidth = 1 / zoom;
      const w = f.width + 40, h = f.height + 40; ctx.beginPath(); for (let x = -w; x < w; x += 6 / zoom){ ctx.moveTo(x, -h); ctx.lineTo(x + h, h); } ctx.stroke();
    }
    ctx.restore();
    Clip.strokeOnly(f, ctx);
  },
  toObject(props){ return Object.assign(this.callSuper('toObject', props), {contentsLocked: this.contentsLocked}); },
  _toSVG(reviver){
    const f = this._objects[0], id = 'clip' + fabric.Object.__uid++;
    Shaping.init();
    let d = '';
    try { const it = new paper.CompoundPath({pathData: Effects.toD(Effects.baseOutline(f).map(s => Object.assign(s, {closed: true}))), insert: false}); it.transform(new paper.Matrix(...f.calcOwnMatrix())); d = it.pathData; } finally { paper.project.clear(); }
    const out = ['<g ', 'COMMON_PARTS', ' >\n', `<clipPath id="${id}"><path d="${d}"/></clipPath>\n`, '\t\t', f.toSVG(reviver), `<g clip-path="url(#${id})">\n`];
    this._objects.slice(1).forEach(o => out.push('\t\t', o.toSVG(reviver)));
    out.push('</g>\n</g>\n');
    return out;
  },
});
fabric.Clipframe.fromObject = function(object, callback){
  const options = fabric.util.object.clone(object, true); delete options.objects;
  fabric.util.enlivenObjects(object.objects, objs => fabric.util.enlivenObjectEnlivables(object, options, () => callback && callback(new fabric.Clipframe(objs, options, true))));
};
Effects.wrapDraw(fabric.Clipframe.prototype);
Clip.ARROW = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="28" height="20"><path d="M2 10h18M14 4l8 6-8 6" fill="none" stroke="white" stroke-width="6"/><path d="M2 10h18M14 4l8 6-8 6" fill="none" stroke="black" stroke-width="3"/></svg>')}") 24 10, pointer`;

/* ===================== going inside groups and clip frames ===================== */
const Focus = {
  stack: [], visibility: 0.2,
  top(){ return this.stack[this.stack.length - 1]; },
  members(e){ return canvas.getObjects().filter(o => !e.outside.has(o)); },
  // lays a group's (or clip frame's) members out on the canvas; auto = Ctrl+click (leaves by itself)
  enter(g, {auto = false, edit = false} = {}){
    const kind = g.type === 'clipframe' ? 'clip' : 'group';
    const i = canvas.getObjects().indexOf(g); if (i < 0) return;
    const prev = restoring; restoring = true;
    canvas.discardActiveObject();
    const members = g._objects.slice(), props = Clip.props(g);
    g._restoreObjectsState(); canvas.remove(g);
    members.forEach((o, k) => canvas.insertAt(o, i + k));
    const outside = new Set(canvas.getObjects().filter(o => !members.includes(o)));
    const e = {kind, props, outside, auto, edit, frame: kind === 'clip' ? members[0] : null, name: nameOf(g), locks: new Map()};
    if (!auto) outside.forEach(o => { e.locks.set(o, [o.selectable, o.evented]); o.selectable = false; o.evented = false; });
    members.forEach(o => { o.__focus = e; });
    this.stack.push(e);
    restoring = prev;
    canvas.requestRenderAll(); this.crumbs(); Clip.bar(); refresh();
    return e;
  },
  // folds the members back into their group or frame (objects made while inside go in too)
  build(e, members){
    if (e.kind === 'clip'){
      const f = members.includes(e.frame) ? e.frame : null;
      if (!f) return null;                                     // the frame was deleted: the contents stay loose
      return Clip.make(f, members.filter(o => o !== f), e.props);
    }
    if (!members.length) return null;
    const g = new fabric.Group(members, Object.assign({}, e.props)); return g;
  },
  exit(select = true){
    const e = this.stack.pop(); if (!e) return;
    const prev = restoring; restoring = true;
    const sel = actives(); canvas.discardActiveObject();
    const members = this.members(e), at = Math.min(...members.map(o => canvas.getObjects().indexOf(o)).filter(x => x >= 0), canvas.getObjects().length);
    members.forEach(o => { delete o.__focus; });
    e.locks.forEach(([s, ev], o) => { o.selectable = s; o.evented = ev; applyLock(o); });
    const g = this.build(e, members);
    if (g){ members.forEach(o => canvas.remove(o)); canvas.insertAt(g, at); }
    restoring = prev;
    if (g && (select || sel.some(o => members.includes(o)))) canvas.setActiveObject(g);
    else if (sel.length) selectObjs(sel.filter(o => canvas.getObjects().includes(o)));
    canvas.requestRenderAll(); this.crumbs(); Clip.bar(); snapshot(); refresh();
    return g;
  },
  exitAll(){ while (this.stack.length) this.exit(false); },
  // forget the focus without folding (the canvas is about to be replaced)
  drop(){ this.stack = []; this.crumbs(); Clip.bar(); },
  // run fn with every level folded back (saving, undo snapshots, exports), then open them again
  fold(e){
    const members = this.members(e), at = Math.min(...members.map(o => canvas.getObjects().indexOf(o)));
    members.forEach(o => { delete o.__focus; });
    const g = this.build(e, members);
    if (g){ members.forEach(o => canvas.remove(o)); canvas.insertAt(g, at); }
    return {e, g, members, at};
  },
  unfold({e, g, members, at}){
    if (g){ g._restoreObjectsState(); canvas.remove(g); members.forEach((o, k) => canvas.insertAt(o, at + k)); }
    members.forEach(o => { o.__focus = e; });
  },
  collapsed(fn){
    if (!this.stack.length) return fn();
    const prev = restoring, sel = actives().slice(), active = canvas.getActiveObject();
    const editingText = active && active.isEditing;
    restoring = true; if (!editingText) canvas.discardActiveObject();
    const folded = []; for (let i = this.stack.length - 1; i >= 0; i--) folded.push(this.fold(this.stack[i]));
    try { return fn(); }
    finally {
      for (let i = folded.length - 1; i >= 0; i--) this.unfold(folded[i]);
      restoring = prev;
      if (!editingText && sel.length) selectObjs(sel.filter(o => canvas.getObjects().includes(o)));
    }
  },
  async collapsedAsync(fn){
    if (!this.stack.length) return fn();
    const sel = actives().slice(), levels = [];
    // exports may load other pages: leave focus for the export and come back to the same place after
    const prev = restoring; restoring = true;
    while (this.stack.length){ const e = this.top(); levels.unshift([e, this.exitQuiet()]); }
    restoring = prev;
    try { return await fn(); }
    finally {
      levels.forEach(([e, g]) => { if (g && canvas.getObjects().includes(g)) this.enter(g, {auto: e.auto, edit: e.edit}); });
      if (sel.length) selectObjs(sel.filter(o => canvas.getObjects().includes(o)));
    }
  },
  // folds the top level back without selecting, snapshotting or redrawing
  exitQuiet(){
    const e = this.stack.pop(), members = this.members(e), at = Math.min(...members.map(o => canvas.getObjects().indexOf(o)));
    members.forEach(o => { delete o.__focus; });
    e.locks.forEach(([s, ev], o) => { o.selectable = s; o.evented = ev; applyLock(o); });
    canvas.discardActiveObject();
    const g = this.build(e, members); if (g){ members.forEach(o => canvas.remove(o)); canvas.insertAt(g, at); }
    return g;
  },
  faded(o){ const e = this.top(); return !!(e && !e.auto && e.outside.has(o)); },
  crumbs(){
    const bar = $('focusBar'); bar.classList.toggle('on', this.stack.some(e => !e.auto));
    if (!this.stack.some(e => !e.auto)) return;
    bar.innerHTML = '';
    const add = (label, n) => { const b = document.createElement('button'); b.textContent = label; b.onclick = () => { while (this.stack.length > n) this.exit(false); }; bar.appendChild(b); };
    add(page === 'front' ? 'Front' : 'Back', 0);
    this.stack.forEach((e, k) => { const s = document.createElement('span'); s.textContent = '›'; bar.appendChild(s); add((e.kind === 'clip' ? (e.edit ? 'Editing contents of ' : 'Frame ') : '') + e.name, k + 1); });
    const x = document.createElement('button'); x.className = 'x'; x.textContent = '✕'; x.title = 'Leave focus mode'; x.onclick = () => this.exitAll(); bar.appendChild(x);
  },
};

/* ---------- drawing: fade what is outside the focus; clip contents while Ctrl+clicked inside a frame ---------- */
(function(){
  const P = fabric.Object.prototype, base = P.render;
  P.render = function(ctx){
    if (!Focus.stack.length || this.group || ctx !== canvas.contextContainer) return base.call(this, ctx);
    const e = this.__focus;
    if (Focus.faded(this)){ ctx.save(); ctx.globalAlpha *= Focus.visibility; base.call(this, ctx); ctx.restore(); return; }
    if (e && e.kind === 'clip' && !e.edit && this !== e.frame && e.frame && canvas.getObjects().includes(e.frame)){
      const p = Clip.path(e.frame);
      if (p){ ctx.save(); const m = e.frame.calcTransformMatrix(); ctx.transform(...m); ctx.clip(p, 'nonzero'); ctx.transform(...Effects.inv(m)); base.call(this, ctx); ctx.restore(); return; }
    }
    base.call(this, ctx);
  };
})();

/* ---------- picking ---------- */
// Ctrl+click: the object inside a group or clip frame under the pointer, one level further in at each click
canvas.on('mouse:down', o => {
  if (tool !== 'pick' || o.button === 3) return;
  const e = o.e, p = canvas.getPointer(e);
  if (Clip.pending){
    const target = Pick.under(e).find(x => !Clip.pending.includes(x));
    canvas._currentTransform = null;
    const objs = Clip.pending; Clip.cancelPlace();
    if (target) Clip.placeInside(objs, target); else toast('Click a shape to use as the frame');
    return;
  }
  if (!(e.ctrlKey || e.metaKey) || o.transform && o.transform.corner) return;
  const hit = Pick.under(e)[0];
  if (!hit || (hit.type !== 'group' && hit.type !== 'clipframe')) return;
  if (hit.type === 'clipframe' && hit._objects.length > 1){
    // the contents count only inside the frame, where they show
    if (!Clip.inside(hit._objects[0], p)) return;
  }
  canvas._currentTransform = null;
  Focus.enter(hit, {auto: true});
  const inner = Pick.under(e).find(x => x.__focus && (hit.type !== 'clipframe' || x !== x.__focus.frame)) || Pick.under(e).find(x => x.__focus);
  if (inner) canvas.setActiveObject(inner);
  canvas.requestRenderAll();
});
// a Ctrl+clicked group folds back as soon as the selection leaves it
['selection:created', 'selection:updated', 'selection:cleared'].forEach(ev => canvas.on(ev, () => {
  if (restoring) return;
  setTimeout(() => {
    let e = Focus.top();
    while (e && e.auto){
      const sel = actives();
      if (sel.length && sel.every(o => o.__focus === e || !e.outside.has(o))) break;
      Focus.exit(false); e = Focus.top();
    }
    Clip.bar();
  });
}));
// round handles on an object chosen inside a group
(function(){
  const sq = Pick.SCALE.tl.render;
  const round = (ctx, left, top, s, o) => {
    const target = o.type === 'activeSelection' ? o.getObjects()[0] : o;
    if (!(target && target.__focus && target.__focus.auto)) return sq(ctx, left, top, s, o);
    ctx.save(); ctx.beginPath(); ctx.arc(left, top, COARSE ? 7 : 4.5, 0, Math.PI * 2); ctx.fillStyle = '#111'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke(); ctx.restore();
  };
  ['tl', 'tr', 'bl', 'br', 'ml', 'mr', 'mt', 'mb'].forEach(k => { Pick.SCALE[k].render = round; });
})();

/* ---------- unlocked contents stay put while the frame moves ---------- */
canvas.on('before:transform', e => {
  const t = e.transform && e.transform.target;
  if (Clip.isFrame(t) && t.contentsLocked === false) e.transform.cf0 = {Mg: t.calcTransformMatrix(), own: t._objects.slice(1).map(o => o.calcOwnMatrix())};
});
['object:moving', 'object:scaling', 'object:rotating', 'object:skewing'].forEach(ev => canvas.on(ev, e => {
  const tr = e.transform, t = e.target; if (!tr || !tr.cf0 || !Clip.isFrame(t)) return;
  const k = Effects.mul(Effects.inv(t.calcTransformMatrix()), tr.cf0.Mg);
  t._objects.slice(1).forEach((o, i) => { fabric.util.applyTransformToObject(o, Effects.mul(k, tr.cf0.own[i])); o.setCoords(); });
  t.dirty = true;
}));
canvas.on('object:modified', e => { const t = e.target; if (e.transform && e.transform.cf0 && Clip.isFrame(t)) Clip.rebuild(t); });

/* ---------- drop onto a frame: hold W to add, K to replace ---------- */
const dropKeys = {w: false, k: false};
document.addEventListener('keydown', e => { if (!canvas._currentTransform) return; const k = e.key.toLowerCase(); if (k === 'w' || k === 'k'){ dropKeys[k] = true; e.preventDefault(); e.stopImmediatePropagation(); } }, true);
document.addEventListener('keyup', e => { const k = e.key.toLowerCase(); if (k in dropKeys) dropKeys[k] = false; });
let dropFrame = null;
canvas.on('object:moving', e => {
  const t = e.target, moving = new Set(Pick.movingObjs(t));
  const under = e.e ? Pick.under(e.e).find(o => Clip.isFrame(o) && !moving.has(o)) : null;
  if (under !== dropFrame){ dropFrame = under || null; canvas.requestRenderAll(); }
  if (dropFrame) $('stSel').innerHTML = `Over <b>${nameOf(dropFrame)}</b>: release to drop outside · hold <b>W</b> to put inside · hold <b>K</b> to replace its contents`;
});
canvas.on('mouse:up', o => {
  const f = dropFrame; dropFrame = null;
  if (!f) return;
  const t = canvas.getActiveObject();
  if (t && (dropKeys.w || dropKeys.k)){ const objs = Pick.movingObjs(t).slice(); Clip.placeInside(objs, f, dropKeys.k); }
  dropKeys.w = dropKeys.k = false; canvas.requestRenderAll(); refresh();
});
canvas.on('after:render', e => {
  if (!dropFrame || !e || e.ctx !== canvas.contextContainer) return;
  const ctx = e.ctx, r = canvas.getRetinaScaling(), v = canvas.viewportTransform, p = Clip.path(dropFrame._objects[0]);
  if (!p) return;
  ctx.save(); ctx.setTransform(r * v[0], 0, 0, r * v[3], r * v[4], r * v[5]); ctx.transform(...dropFrame._objects[0].calcTransformMatrix());
  ctx.fillStyle = 'rgba(59,130,246,.28)'; ctx.fill(p); ctx.restore();
});

/* ---------- double-click: focus; Esc goes up ---------- */
canvas.on('mouse:dblclick', o => {
  if (tool !== 'pick') return;
  const t = o.target || Pick.under(o.e)[0];
  if (t && (t.type === 'group' || t.type === 'clipframe') && !(t.rotateMode && t.__corner === 'pivot')){
    Focus.enter(t);
    const inner = Pick.under(o.e).find(x => x.__focus); if (inner) canvas.setActiveObject(inner);
    toast(`Inside ${nameOf(t)} — the rest is faded. Esc with nothing selected goes back up`);
  }
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || isTyping(e)) return;
  if (Clip.pending){ e.preventDefault(); e.stopImmediatePropagation(); Clip.cancelPlace(); return; }
  if (Focus.stack.length && !canvas.getActiveObject() && !canvas._currentTransform){ e.preventDefault(); e.stopImmediatePropagation(); Focus.exit(true); }
}, true);
['selection:created', 'selection:updated', 'selection:cleared'].forEach(ev => canvas.on(ev, () => Clip.bar()));

/* ---------- bar buttons ---------- */
$('cbEdit').onclick = () => { const cf = canvas.getActiveObject(); if (Clip.isFrame(cf)){ Focus.enter(cf, {edit: true}); toast('Editing contents — they show whole; Finish puts them back in the frame'); } };
$('cbFinish').onclick = () => { const t = Focus.top(); if (t && t.kind === 'clip') { while (Focus.top() !== t) Focus.exit(false); Focus.exit(true); } };
$('cbSelect').onclick = () => { const cf = canvas.getActiveObject(); if (!Clip.isFrame(cf) || cf._objects.length < 2) return toast('This frame is empty'); const e = Focus.enter(cf, {auto: true}); selectObjs(Focus.members(e).filter(o => o !== e.frame)); };
$('cbExtract').onclick = () => Clip.extract();
$('cbLock').onclick = () => Clip.toggleLock();
$('cbMask').onclick = () => run('clip:mask');
$('cbInvert').onclick = () => run('clip:invert');
$('cbFit').onchange = () => { const v = $('cbFit').value; $('cbFit').value = ''; if (v) Clip.fit(null, v); };
