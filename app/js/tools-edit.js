/* ===================== editing tools =====================
   Smudge, Roughen, Free Transform, Crop, Knife, Eraser, Virtual Segment Delete, Smart Fill and the Text tool
   (click = artistic text, drag = paragraph frame). Behaviour follows TraceDraw's docs/behavior/{brushes,
   free-transform,crop-knife-eraser,area-fill}.md. Geometry is worked on in page coordinates with paper.js. */

const Edit = {
  flat: o => ['table', 'dimension'].includes(o.type),
  onCanvas: o => canvas.getObjects().includes(o),
  // selection when the tool was picked, else everything visible and unlocked
  pool(){ const s = Tools.sel.filter(this.onCanvas); return s.length ? s : canvas.getObjects().filter(o => o.visible && o.evented !== false && !o.lockedObj); },
  under(e){ return Pick.under(e).find(o => !o.lockedObj); },
  setSel(list){ Tools.sel = list; canvas.requestRenderAll(); },
  // text needs its outlines loaded first; true = come back later
  needFonts(objs, then){
    if (window.TEE_FONT_TTF || !leafs(objs).some(l => l.text != null)) return false;
    toast('Loading letter outlines…'); TextCurves.ready().then(then, e => toast(e.message)); return true;
  },
  // the outline in page coordinates: [{closed, segs}]
  subs(o){
    if (Effects.warps(o)){ const it = Shaping.toItem(o); return it ? Effects.fromPaper(it) : []; }
    const m = o.calcTransformMatrix();
    return Effects.baseOutline(o).map(sp => ({closed: sp.closed, segs: sp.segs.map(q => q.map(p => Effects.pt(m, p.x, p.y)))}));
  },
  item(subs, rule){ const it = new paper.CompoundPath({pathData: Effects.toD(subs), insert: false}); it.fillRule = rule || 'nonzero'; return it; },
  rule: o => o.fillRule === 'evenodd' ? 'evenodd' : 'nonzero',
  style(o){
    const s = Shaping.styleOf(o), leaf = o.type === 'group' ? leafs([o])[0] : o;
    if (!leaf.fill) s.fill = '';
    if (o.fx){ const fx = Object.assign({}, o.fx); delete fx.envelope; delete fx.distort; delete fx.blend; if (Object.keys(fx).length){ s.fx = fx; s.objectCaching = false; } }
    return s;
  },
  path(d, o, name){ return new fabric.Path(d, Object.assign(this.style(o), {name: name || nameOf(o)})); },
  // one undo step; `fn` runs with history off
  commit(fn){
    Shaping.init(); canvas.discardActiveObject(); restoring = true;
    let out;
    try { out = fn(); } catch (e){ console.error(e); toast('That did not work: ' + e.message); }
    finally { paper.project.clear(); restoring = false; }
    canvas.requestRenderAll(); snapshot(); refresh();
    return out;
  },
  swap(o, list){ let at = canvas.getObjects().indexOf(o); if (at < 0) return; canvas.remove(o); list.forEach(n => canvas.insertAt(n, at++)); },
  // paper result -> path data, or null when nothing is left
  dOf: it => (it && !it.isEmpty() && it.pathData) || null,
  // apply a boolean to closed outlines, and cut open ones without tracing around them
  bool(o, tool, op){
    const subs = this.subs(o), cl = subs.filter(s => s.closed), op2 = subs.filter(s => !s.closed), parts = [];
    if (cl.length) parts.push(this.item(cl, this.rule(o))[op](tool, {insert: false}));
    if (op2.length) parts.push(this.item(op2)[op](tool, {insert: false, trace: false}));
    return parts;
  },
  // outlines with their holes; each entry becomes one object
  separate(item){
    const kids = (item instanceof paper.CompoundPath ? item.children.slice() : [item]).filter(k => k.segments && k.segments.length > 1);
    const closed = kids.filter(k => k.closed).sort((a, b) => Math.abs(b.area) - Math.abs(a.area)), out = kids.filter(k => !k.closed).map(k => [k]);
    const outers = [];
    closed.forEach(k => {
      const pt = k.interiorPoint, inside = closed.filter(c => c !== k && Math.abs(c.area) > Math.abs(k.area) && c.contains(pt));
      if (inside.length % 2 === 0){ const g = [k]; outers.push(g); out.push(g); }
      else { const host = outers.filter(g => g[0].contains(pt)).sort((a, b) => Math.abs(a[0].area) - Math.abs(b[0].area))[0]; if (host) host.push(k); }
    });
    return out.map(g => new paper.CompoundPath({children: g.map(k => k.clone({insert: false})), insert: false}));
  },
  // a thick line around a stroke, as a closed paper shape (width in page units)
  band(pts, width, kind){
    const K = 10000, P = ClipperLib, co = new P.ClipperOffset(2, 0.02 * K), sol = new P.Paths();
    let d;
    const moved = pts.length > 1 && pts.some(q => Math.hypot(q.x - pts[0].x, q.y - pts[0].y) > 1e-3);
    if (!moved){
      const c = pts[0], r = width / 2;
      d = kind === 'square' ? `M${c.x - r} ${c.y - r}H${c.x + r}V${c.y + r}H${c.x - r}Z` : `M${c.x - r} ${c.y}A${r} ${r} 0 1 0 ${c.x + r} ${c.y}A${r} ${r} 0 1 0 ${c.x - r} ${c.y}Z`;
    } else {
      const path = pts.map(q => ({X: Math.round(q.x * K), Y: Math.round(q.y * K)}));
      co.AddPath(path, kind === 'round' ? P.JoinType.jtRound : P.JoinType.jtMiter, kind === 'round' ? P.EndType.etOpenRound : kind === 'square' ? P.EndType.etOpenSquare : P.EndType.etOpenButt);
      co.Execute(sol, width / 2 * K);
      d = sol.map(p => 'M' + p.map(q => `${q.X / K} ${q.Y / K}`).join('L') + 'Z').join('');
    }
    return new paper.CompoundPath({pathData: d, insert: false});
  },
  rectItem: (x0, y0, x1, y1) => new paper.Path.Rectangle({from: [x0, y0], to: [x1, y1], insert: false}),
  shapeOnly: o => !['group', 'image', 'clipframe', 'table', 'dimension'].includes(o.type),
};

/* ---------- Smudge and Roughen: brushes that change the selected curves ---------- */
const curveBrush = (id, def) => Tools.def(id, Object.assign({
  usesSel: true,
  hint: 'Select an object, then drag over its outline',
  start(){ if (Tools.sel.length) Edit.needFonts(Tools.sel, () => {}); },
  down(p, e){
    const sel = Tools.sel.filter(Edit.onCanvas).filter(Edit.shapeOnly);
    if (!sel.length){ const u = Edit.under(e); if (u && Edit.shapeOnly(u)){ Edit.setSel([u]); toast('Selected: now drag over its outline with the brush'); } else toast('Select an object first, then drag over it with the brush'); return; }
    if (Edit.needFonts(sel, () => {})) return;
    Shaping.init(); restoring = true;
    const items = sel.map(o => { const subs = Edit.subs(o), n = new fabric.Path(Effects.toD(subs), Edit.style(o)); n.set({name: nameOf(o), fillRule: o.fillRule || 'nonzero', objectCaching: false}); Edit.swap(o, [n]); return {o: n, subs}; });
    paper.project.clear(); restoring = false;
    Tools.sel = items.map(i => i.o);
    Tools.st = {items, last: p, cur: p};
    this.apply(p, p);
  },
  move(p){
    const st = Tools.st; if (!st){ this.hover = p; canvas.requestRenderAll(); return; }
    st.cur = p; this.apply(st.last, p); st.last = p;
  },
  apply(from, to){
    const st = Tools.st, r = Tools.o().radius;
    st.items.forEach(it => {
      let touched = false;
      it.subs.forEach(sp => { if (this.brush(sp, from, to, r)) touched = true; });
      if (touched){ it.o._setPath(Effects.toD(it.subs), {}); it.o.setCoords(); it.o.dirty = true; }
    });
    canvas.requestRenderAll();
  },
  up(){
    const st = Tools.st; if (!st) return; Tools.st = null;
    st.items.forEach(it => { it.o.objectCaching = true; it.o.dirty = true; });
    canvas.requestRenderAll(); snapshot(); refresh();
  },
  draw(ctx){
    const c = (Tools.st && Tools.st.cur) || this.hover; if (!c) return;
    const s = Tools.S(c), r = Tools.o().radius * zoom;
    ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 1; ctx.stroke();
  },
}, def));
const nibWeight = (p, c, r) => Math.max(0, 1 - Math.hypot(p.x - c.x, p.y - c.y) / r);
const segLen = q => Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y) + Math.hypot(q[2].x - q[1].x, q[2].y - q[1].y) + Math.hypot(q[3].x - q[2].x, q[3].y - q[2].y);
// does the nib reach this segment anywhere along it?
const segNear = (q, c, r) => { const n = Math.max(2, Math.ceil(segLen(q) / (r / 2))); for (let i = 0; i <= n; i++){ const p = Effects.bez(...q, i / n); if (Math.hypot(p.x - c.x, p.y - c.y) < r) return true; } return false; };
// shorter segments under the nib, the rest of the curve untouched; true when the nib touches the curve
const refineUnder = (sp, c, r, step) => {
  let hit = false;
  for (let i = 0; i < sp.segs.length; i++){
    const q = sp.segs[i];
    if (q.rough || !segNear(q, c, r)) continue;
    hit = true;
    if (segLen(q) > step){ const s = Nodes.split(...q, 0.5); sp.segs.splice(i, 1, s.left, s.right); i--; }
  }
  return hit;
};
curveBrush('smudge', {
  name: 'Smudge', tip: 'Distort an outline by dragging along it', opts: {radius: 10 * MM, pressure: 100},
  bar(){ return [{type: 'num', key: 'radius', label: 'Nib radius', scale: PX_PER_IN, min: MM, step: 0.05, title: 'Nib radius (in)'}, {type: 'num', key: 'pressure', label: 'Pressure', min: 1, max: 100, digits: 0}]; },
  brush(sp, from, to, r){
    const k = Tools.o().pressure / 100, dx = (to.x - from.x) * k, dy = (to.y - from.y) * k;
    if (!refineUnder(sp, from, r, r / 4)) return false;
    if (dx || dy) sp.segs.forEach(q => q.forEach((p, n) => {
      const w = nibWeight(p, from, r);
      if (w > 0) q[n] = {x: p.x + dx * w * w, y: p.y + dy * w * w};
    }));
    return true;
  },
});
curveBrush('roughen', {
  name: 'Roughen', tip: 'Distort an outline by dragging over it to add spikes', opts: {radius: 10 * MM, freq: 5, size: 2 * MM},
  bar(){ return [{type: 'num', key: 'radius', label: 'Nib radius', scale: PX_PER_IN, min: MM, step: 0.05}, {type: 'num', key: 'freq', label: 'Spikes', min: 1, max: 10, digits: 0, title: 'Spikes per 10 mm'}, {type: 'num', key: 'size', label: 'Size', scale: PX_PER_IN, min: 0.1, step: 0.02, title: 'Spike size (in)'}]; },
  spike: 0,
  brush(sp, from, to, r){
    const O = Tools.o(), step = 10 * MM / O.freq / 2;
    if (!refineUnder(sp, to, r, step)) return false;
    // each stretch under the nib becomes a straight line to a point pushed off the curve, to and fro
    sp.segs.forEach((q, i) => {
      if (q.rough || nibWeight(Effects.bez(...q, 0.5), to, r) <= 0) return;
      const d = Effects.bezD(...q, 1), l = Math.hypot(d.x, d.y) || 1, a = O.size * nibWeight(q[3], to, r) * (this.spike++ % 2 ? 1 : -1);
      const next = sp.segs[i + 1] || (sp.closed ? sp.segs[0] : null), e = next ? {x: q[3].x - d.y / l * a, y: q[3].y + d.x / l * a} : q[3];
      q[1] = Effects.lerp(q[0], e, 1 / 3); q[2] = Effects.lerp(q[0], e, 2 / 3); q[3] = e; q.rough = true;
      if (next) next[0] = e;
    });
    return true;
  },
});

/* ---------- Free Transform: rotate, reflect, scale or skew about where you press ---------- */
Tools.def('freetransform', {
  name: 'Free Transform', tip: 'Rotate, reflect, scale or skew about the point you press', usesSel: true,
  opts: {mode: 'rotate', dup: false},
  hint: 'Drag from the point to transform about · Alt scales · Ctrl skews · Shift reflects',
  bar(){ return [{type: 'seg', key: 'mode', options: [['rotate', 'Rotate'], ['reflect', 'Reflect'], ['scale', 'Scale'], ['skew', 'Skew']]}, {type: 'chk', key: 'dup', label: 'Apply to duplicate'}]; },
  down(p, e){
    let sel = Tools.sel.filter(Edit.onCanvas);
    const u = Edit.under(e);
    if (u && !sel.includes(u)){ sel = [u]; Tools.sel = sel; }
    if (!sel.length) return toast('Select an object first, then drag to transform it');
    const st = Tools.st = {press: {x: p.x, y: p.y}, objs: null, base: 0};
    const ready = list => { st.objs = list.map(o => ({o, m: o.calcTransformMatrix().slice()})); };
    if (Tools.opts.freetransform.dup) Pick.cloneAbsolute(sel, null).then(cs => {
      restoring = true; cs.forEach((c, i) => canvas.insertAt(c, canvas.getObjects().indexOf(sel[i]) + 1)); restoring = false;
      Tools.sel = cs; ready(cs);
    });
    else ready(sel);
  },
  matrix(p, e){
    const st = Tools.st, P = st.press, dx = p.x - P.x, dy = p.y - P.y, dist = Math.hypot(dx, dy), O = Tools.opts.freetransform;
    const mode = e.altKey ? 'scale' : (e.ctrlKey || e.metaKey) ? 'skew' : e.shiftKey ? 'reflect' : O.mode;
    if (dist * zoom < 2) return null;
    const about = L => [L[0], L[1], L[2], L[3], P.x - L[0] * P.x - L[2] * P.y, P.y - L[1] * P.x - L[3] * P.y], a = Math.atan2(dy, dx);
    if (mode === 'rotate') return about([Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a)]);
    if (mode === 'reflect') return about([Math.cos(2 * a), Math.sin(2 * a), Math.sin(2 * a), -Math.cos(2 * a)]);
    if (mode === 'scale'){ if (!st.base) st.base = dist; const k = dist / st.base; return about([k, 0, 0, k]); }
    return about([1, dy / MM / 50, dx / MM / 50, 1]);
  },
  move(p, e){
    const st = Tools.st; if (!st || !st.objs) return; st.cur = p;
    const M = this.matrix(p, e); if (!M) return;
    st.objs.forEach(({o, m}) => { fabric.util.applyTransformToObject(o, Effects.mul(M, m)); o.setCoords(); o.dirty = true; });
    canvas.requestRenderAll();
  },
  up(){ const st = Tools.st; if (!st) return; Tools.st = null; canvas.requestRenderAll(); snapshot(); refresh(); },
  draw(ctx){
    const st = Tools.st; if (!st) return; const a = Tools.S(st.press);
    if (st.cur) Tools.blue(ctx, c => Tools.poly(c, [st.press, st.cur]));
    Tools.square(ctx, a, true, 3);
  },
});

/* ---------- Crop ---------- */
const Crop8 = [[0, 0], [.5, 0], [1, 0], [1, .5], [1, 1], [.5, 1], [0, 1], [0, .5]];
Tools.def('crop', {
  name: 'Crop', tip: 'Remove everything outside a drawn area', usesSel: true, opts: {x: 0, y: 0, w: 0, h: 0},
  hint(){ return Tools.st ? 'Enter or double-click inside crops · Esc clears' : 'Drag the area to keep'; },
  bar(){
    const st = Tools.st, on = st && !st.drag;
    if (!on) return [];
    const set = () => { const o = Tools.opts.crop; Object.assign(st, {x0: o.x, y0: o.y, x1: o.x + o.w, y1: o.y + o.h}); };
    return [{type: 'num', key: 'x', label: 'X', scale: PX_PER_IN, step: 0.1, on: set}, {type: 'num', key: 'y', label: 'Y', scale: PX_PER_IN, step: 0.1, on: set}, {type: 'num', key: 'w', label: 'W', scale: PX_PER_IN, min: 0.5, step: 0.1, on: set}, {type: 'num', key: 'h', label: 'H', scale: PX_PER_IN, min: 0.5, step: 0.1, on: set},
            {type: 'btn', label: 'Crop', primary: true, on: () => this.apply()}, {type: 'btn', label: 'Clear', on: () => { Tools.st = null; canvas.requestRenderAll(); Tools.bar(); }}];
  },
  sync(){ const st = Tools.st; if (st) Object.assign(Tools.opts.crop, {x: st.x0, y: st.y0, w: st.x1 - st.x0, h: st.y1 - st.y0}); Tools.bar(); },
  corner(st, i){ const [u, v] = Crop8[i]; return {x: st.x0 + (st.x1 - st.x0) * u, y: st.y0 + (st.y1 - st.y0) * v}; },
  inside: (st, p) => p.x > st.x0 && p.x < st.x1 && p.y > st.y0 && p.y < st.y1,
  down(p){
    const st = Tools.st, tol = (COARSE ? 16 : 7) / zoom;
    if (st){
      for (let i = 0; i < 8; i++) if (Math.hypot(this.corner(st, i).x - p.x, this.corner(st, i).y - p.y) < tol){ st.drag = {handle: i}; return; }
      if (this.inside(st, p)){ st.drag = {from: p, box: [st.x0, st.y0, st.x1, st.y1]}; return; }
    }
    const a = Tools.snap(p); Tools.st = {x0: a.x, y0: a.y, x1: a.x, y1: a.y, drag: {fresh: a}};
  },
  move(p){
    const st = Tools.st; if (!st || !st.drag) return; const d = st.drag, q = Tools.snap(p);
    if (d.fresh){ st.x0 = Math.min(d.fresh.x, q.x); st.x1 = Math.max(d.fresh.x, q.x); st.y0 = Math.min(d.fresh.y, q.y); st.y1 = Math.max(d.fresh.y, q.y); }
    else if (d.from){ const dx = p.x - d.from.x, dy = p.y - d.from.y; st.x0 = d.box[0] + dx; st.y0 = d.box[1] + dy; st.x1 = d.box[2] + dx; st.y1 = d.box[3] + dy; }
    else {
      const [u, v] = Crop8[d.handle];
      if (u === 0) st.x0 = Math.min(q.x, st.x1 - 0.5); if (u === 1) st.x1 = Math.max(q.x, st.x0 + 0.5);
      if (v === 0) st.y0 = Math.min(q.y, st.y1 - 0.5); if (v === 1) st.y1 = Math.max(q.y, st.y0 + 0.5);
    }
    canvas.requestRenderAll();
  },
  up(){
    const st = Tools.st; if (!st) return; Pick.clearGuides();
    if (st.drag && st.drag.fresh && (st.x1 - st.x0) * zoom < 3 && (st.y1 - st.y0) * zoom < 3) Tools.st = null;
    if (Tools.st) Tools.st.drag = null;
    this.sync(); canvas.requestRenderAll();
  },
  dbl(p){ const st = Tools.st; if (st && this.inside(st, p)) this.apply(); },
  key(e){
    if (!Tools.st) return false;
    if (e.key === 'Enter'){ this.apply(); return true; }
    if (e.key === 'Escape'){ Tools.st = null; canvas.requestRenderAll(); Tools.bar(); return true; }
    return false;
  },
  // one object: what stays of it (it is not yet on or off the canvas here)
  cropObject(o, area, st){
    o.setCoords();
    const b = o.getBoundingRect(true, true);
    if (b.left > st.x1 || b.left + b.width < st.x0 || b.top > st.y1 || b.top + b.height < st.y0) return [];
    if (b.left >= st.x0 && b.left + b.width <= st.x1 && b.top >= st.y0 && b.top + b.height <= st.y1) return [o];
    if (o.type === 'group'){
      const m = o._objects.slice(), props = {name: o.name, opacity: o.opacity}; o._restoreObjectsState();
      const rest = m.flatMap(k => { k.group = undefined; return this.cropObject(k, area, st); });
      return rest.length ? [new fabric.Group(rest, props)] : [];
    }
    if (o.type === 'clipframe'){
      const m = o._objects.slice(), props = Clip.props(o); o._restoreObjectsState(); m.forEach(k => { k.group = undefined; });
      const d = Edit.bool(m[0], area, 'intersect').map(Edit.dOf).filter(Boolean).join('');
      return d ? [Clip.make(Edit.path(d, m[0]), m.slice(1), props)] : [];
    }
    if (o.type === 'image' || Edit.flat(o)) return [Clip.make(new fabric.Path(`M${st.x0} ${st.y0}H${st.x1}V${st.y1}H${st.x0}Z`, {fill: '', strokeWidth: 0, name: 'Crop'}), [o], {name: nameOf(o)})];
    const d = Edit.bool(o, area, 'intersect').map(Edit.dOf).filter(Boolean).join('');
    return d ? [Edit.path(d, o)] : [];
  },
  apply(){
    const st = Tools.st; if (!st) return;
    const objs = Edit.pool();
    if (Edit.needFonts(objs, () => this.apply())) return;
    const kept = Edit.commit(() => {
      const area = Edit.rectItem(st.x0, st.y0, st.x1, st.y1), out = [];
      objs.forEach(o => {
        const at = canvas.getObjects().indexOf(o), r = this.cropObject(o, area, st);
        if (r.length === 1 && r[0] === o){ out.push(o); return; }
        canvas.remove(o); r.forEach((n, i) => { canvas.insertAt(n, at + i); out.push(n); });
      });
      return out;
    }) || [];
    Tools.st = null; Tools.sel = []; Tools.finish(kept);
    toast('Cropped');
  },
  draw(ctx){
    const st = Tools.st; if (!st) return;
    const a = Tools.S({x: st.x0, y: st.y0}), b = Tools.S({x: st.x1, y: st.y1}), W = canvas.getWidth(), H = canvas.getHeight();
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.fillRect(0, 0, W, a.y); ctx.fillRect(0, b.y, W, H - b.y); ctx.fillRect(0, a.y, a.x, b.y - a.y); ctx.fillRect(b.x, a.y, W - b.x, b.y - a.y);
    ctx.setLineDash([5, 4]); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y); ctx.setLineDash([]);
    if (!(st.drag && st.drag.fresh)) for (let i = 0; i < 8; i++) Tools.square(ctx, Tools.S(this.corner(st, i)), false, COARSE ? 6 : 3.5);
  },
});

/* ---------- Knife ---------- */
Tools.def('knife', {
  name: 'Knife', tip: 'Slice objects to split them', usesSel: true, opts: {mode: 'two', gap: 0, keep: false},
  hint(){ return Tools.opts.knife.mode === 'two' ? 'Drag a straight cut: it runs on past both ends' : 'Drag a cut right across the object'; },
  bar(){ return [{type: 'seg', key: 'mode', options: [['two', '2-point'], ['free', 'Freehand']]}, {type: 'num', key: 'gap', label: 'Gap', scale: MM, min: 0, step: 0.5, title: 'Gap between the pieces (mm)'}, {type: 'chk', key: 'keep', label: 'Keep as one'}]; },
  down(p){ Tools.st = {pts: [{x: p.x, y: p.y}]}; },
  move(p, e){
    const st = Tools.st; if (!st) return; const O = Tools.opts.knife;
    if (O.mode === 'two') st.pts[1] = Tools.constrain(st.pts[0], p, e);
    else { const l = st.pts[st.pts.length - 1]; if (Math.hypot(p.x - l.x, p.y - l.y) * zoom > 2) st.pts.push({x: p.x, y: p.y}); }
    canvas.requestRenderAll();
  },
  up(){
    const st = Tools.st; if (!st) return; Tools.st = null; canvas.requestRenderAll();
    if (st.pts.length < 2) return;
    let pts = st.pts;
    if (Tools.opts.knife.mode === 'two'){
      const [a, b] = pts, L = Math.hypot(b.x - a.x, b.y - a.y) || 1, ux = (b.x - a.x) / L, uy = (b.y - a.y) / L, R = 4000;
      pts = [{x: a.x - ux * R, y: a.y - uy * R}, {x: b.x + ux * R, y: b.y + uy * R}];
    }
    this.cut(pts);
  },
  // the pieces of a picture or clip frame keep the contents, each in a frame of its own
  async cut(pts){
    const O = Tools.opts.knife, objs = Edit.pool();
    if (Edit.needFonts(objs.filter(o => o.type !== 'group' && o.text == null), () => this.cut(pts))) return;
    Shaping.init();
    const band = Edit.band(pts, O.gap > 0 ? O.gap : 0.01 * MM, 'butt'), plan = [];
    for (const o of objs){
      if (o.type === 'group' || o.text != null || Edit.flat(o)) continue;
      if (o.type === 'image' || o.type === 'clipframe'){
        const frame = o.type === 'clipframe' ? o._objects[0] : null;
        const outline = frame ? Edit.item(Edit.subs(frame), Edit.rule(frame)) : (c => new paper.Path({segments: c.map(q => [q.x, q.y]), closed: true, insert: false}))(o.getCoords(true, true));
        const parts = Edit.separate(outline.subtract(band, {insert: false}));
        if (parts.length < 2) continue;
        const list = [];
        for (const part of parts){
          const d = part.pathData, [copy] = await Pick.cloneAbsolute([o], null);
          if (frame){ const m = copy._objects.slice(), props = Clip.props(copy); copy._restoreObjectsState(); m.forEach(k => { k.group = undefined; }); list.push(Clip.make(Edit.path(d, m[0]), m.slice(1), props)); }
          else list.push(Clip.make(new fabric.Path(d, {fill: '', strokeWidth: 0, name: 'Piece'}), [copy], {name: nameOf(o)}));
        }
        plan.push([o, list]); continue;
      }
      const res = Edit.bool(o, band, 'subtract');
      if (O.keep){ const whole = res.map(Edit.dOf).filter(Boolean).join(''); const total = res.reduce((n, r) => n + Edit.separate(r).length, 0); if (whole && total > 1) plan.push([o, [Edit.path(whole, o)]]); continue; }
      const parts = res.flatMap(r => Edit.separate(r));
      if (parts.length > 1) plan.push([o, parts.map((p, i) => Edit.path(p.pathData, o, `${nameOf(o)} ${i + 1}`))]);
    }
    if (!plan.length){ paper.project.clear(); return toast('Nothing to cut there: groups and text are not cut'); }
    const pieces = Edit.commit(() => { const all = []; plan.forEach(([o, list]) => { Edit.swap(o, list); all.push(...list); }); return all; }) || [];
    Edit.setSel(pieces);
    toast(`Cut into ${pieces.length} piece${pieces.length === 1 ? '' : 's'}`);
  },
  draw(ctx){ const st = Tools.st; if (st && st.pts.length > 1) Tools.hair(ctx, c => Tools.poly(c, st.pts), '#ef4444'); },
});

/* ---------- Eraser ---------- */
Tools.def('eraser', {
  name: 'Eraser', tip: 'Remove the parts of objects you drag over', usesSel: true, opts: {size: 6.35 * MM, nib: 'round'},
  hint: 'Drag over the selected object, or over any object · double-click an object to delete it',
  bar(){ return [{type: 'num', key: 'size', label: 'Thickness', scale: PX_PER_IN, min: 0.2, step: 0.05, title: 'Thickness (in)'}, {type: 'seg', key: 'nib', options: [['round', 'Round'], ['square', 'Square']]}]; },
  targets(e){
    const sel = Tools.sel.filter(Edit.onCanvas); if (sel.length) return sel;
    const u = Edit.under(e); return u ? [u] : [];
  },
  down(p, e){ clearTimeout(this.pending); Tools.st = {pts: [{x: p.x, y: p.y}], objs: this.targets(e), cur: p}; },
  move(p){
    const st = Tools.st; if (!st){ this.hover = p; canvas.requestRenderAll(); return; }
    st.cur = p; const l = st.pts[st.pts.length - 1];
    if (Math.hypot(p.x - l.x, p.y - l.y) * zoom > 1.5) st.pts.push({x: p.x, y: p.y});
    canvas.requestRenderAll();
  },
  up(){
    const st = Tools.st; if (!st) return; Tools.st = null;
    if (!st.objs.length) return canvas.requestRenderAll();
    // a plain click waits a moment: it may be the first half of a double-click
    if (st.pts.length < 2) this.pending = setTimeout(() => this.erase(st), 300);
    else this.erase(st);
  },
  dbl(p, e){
    clearTimeout(this.pending);
    const o = Edit.under(e); if (!o) return;
    canvas.remove(o); Tools.sel = Tools.sel.filter(x => x !== o); snapshot(); refresh(); canvas.requestRenderAll();
  },
  erase(st){
    if (Edit.needFonts(st.objs, () => this.erase(st))) return;
    const O = Tools.opts.eraser, skipped = [];
    const res = Edit.commit(() => {
      const band = Edit.band(st.pts, O.size, O.nib), out = [];
      st.objs.forEach(o => {
        if (o.type === 'group' || o.type === 'image' || Edit.flat(o)){ skipped.push(o); out.push(o); return; }
        if (o.type === 'clipframe'){
          const m = o._objects.slice(), props = Clip.props(o), d = Edit.bool(m[0], band, 'subtract').map(Edit.dOf).filter(Boolean).join('');
          if (!d){ canvas.remove(o); return; }
          const at = canvas.getObjects().indexOf(o); o._restoreObjectsState(); m.forEach(k => { k.group = undefined; }); canvas.remove(o);
          const n = Clip.make(Edit.path(d, m[0]), m.slice(1), props); canvas.insertAt(n, at); out.push(n); return;
        }
        const d = Edit.bool(o, band, 'subtract').map(Edit.dOf).filter(Boolean).join('');
        if (!d){ canvas.remove(o); return; }
        const n = Edit.path(d, o); Edit.swap(o, [n]); out.push(n);
      });
      return out;
    }) || [];
    if (Tools.sel.length) Tools.sel = res;
    if (skipped.length) toast('Pictures and groups are not erased');
  },
  draw(ctx){
    const O = Tools.opts.eraser, st = Tools.st, c = (st && st.cur) || this.hover;
    if (st && st.pts.length > 1){ ctx.globalAlpha = 0.45; ctx.strokeStyle = '#fff'; ctx.lineWidth = O.size * zoom; ctx.lineCap = O.nib === 'round' ? 'round' : 'square'; ctx.lineJoin = O.nib === 'round' ? 'round' : 'miter'; ctx.beginPath(); Tools.poly(ctx, st.pts); ctx.stroke(); ctx.globalAlpha = 1; }
    if (!c) return;
    const s = Tools.S(c), r = O.size * zoom / 2;
    ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 1; ctx.beginPath();
    if (O.nib === 'round') ctx.arc(s.x, s.y, r, 0, Math.PI * 2); else ctx.rect(s.x - r, s.y - r, 2 * r, 2 * r);
    ctx.stroke();
  },
});

/* ---------- Virtual Segment Delete: the stretches between crossings ---------- */
Tools.def('vsegdel', {
  name: 'Virtual Segment Delete', tip: 'Delete the parts of curves between crossings', opts: {mode: 'box'},
  hint: 'Click a stretch of outline to remove it · drag to remove every stretch touched',
  bar(){ return [{type: 'seg', key: 'mode', options: [['box', 'Rectangle'], ['free', 'Freehand']]}]; },
  down(p){ Tools.st = {a: p, b: p, pts: [p]}; },
  move(p){ const st = Tools.st; if (!st) return; st.b = p; const l = st.pts[st.pts.length - 1]; if (Math.hypot(p.x - l.x, p.y - l.y) * zoom > 2) st.pts.push(p); canvas.requestRenderAll(); },
  up(){
    const st = Tools.st; if (!st) return; Tools.st = null;
    const moved = Math.hypot(st.b.x - st.a.x, st.b.y - st.a.y) * zoom > 4;
    this.remove(st, moved);
    canvas.requestRenderAll();
  },
  // the object's subpaths cut at every crossing with any other outline or itself
  pieces(path, others){
    const L = path.length, off = [];
    const add = loc => { const v = loc.offset; if (path.closed || (v > 1e-3 && v < L - 1e-3)) off.push(v); };
    others.forEach(p => { if (p !== path) path.getIntersections(p).forEach(add); });
    path.getIntersections(null).forEach(add);
    off.sort((a, b) => a - b);
    const at = off.filter((v, i) => !i || v - off[i - 1] > 1e-3);
    if (!at.length) return [path.clone({insert: false})];
    const c = path.clone({insert: false}), out = [];
    let shift = 0;
    if (c.closed){ c.splitAt(at[0]); shift = at.shift(); }
    for (let i = at.length - 1; i >= 0; i--){ const tail = c.splitAt(at[i] - shift); if (tail) out.unshift(tail); }
    out.unshift(c);
    return out.filter(p => p.segments.length > 1 && p.length > 1e-3);
  },
  remove(st, moved){
    const objs = canvas.getObjects().filter(o => o.visible && o.evented !== false && !o.lockedObj && Edit.shapeOnly(o) && o.text == null);
    Shaping.init();
    const data = objs.map(o => ({o, subs: Edit.subs(o), paths: null}));
    data.forEach(r => { r.paths = r.subs.map(s => { const it = Edit.item([s]); return it.children[0]; }); });
    const all = data.flatMap(r => r.paths), O = Tools.opts.vsegdel, tol = (COARSE ? 14 : 5) / zoom;
    let hitTest;
    if (!moved){
      // the nearest stretch only
      let best = null, bd = tol; const pt = new paper.Point(st.a.x, st.a.y);
      data.forEach(r => r.paths.forEach(p => { const d = p.getNearestPoint(pt).getDistance(pt); if (d <= bd + 1e-9){ bd = d; best = p; } }));
      if (!best){ paper.project.clear(); return toast('Click right on an outline'); }
      hitTest = (piece, path) => { if (path !== best) return false; return piece.getNearestPoint(pt).getDistance(pt) <= bd + 1e-3; };
    } else if (O.mode === 'free'){
      const line = new paper.Path({segments: st.pts.map(q => [q.x, q.y]), insert: false});
      hitTest = piece => piece.getIntersections(line).length > 0;
    } else {
      const rect = new paper.Rectangle(new paper.Point(st.a.x, st.a.y), new paper.Point(st.b.x, st.b.y)), box = new paper.Path.Rectangle({rectangle: rect, insert: false});
      hitTest = piece => rect.contains(piece.bounds) || piece.getIntersections(box).length > 0;
    }
    const plan = [];
    data.forEach(r => {
      let changed = false; const keep = [];
      r.paths.forEach((p, i) => {
        const parts = this.pieces(p, all), left = parts.filter(q => !hitTest(q, p));
        if (left.length === parts.length){ keep.push(r.subs[i]); return; }
        changed = true; left.forEach(q => keep.push(...Effects.fromPaper(q)));
      });
      if (changed) plan.push([r.o, keep]);
    });
    if (!plan.length){ paper.project.clear(); return toast('No stretch of outline there'); }
    Edit.commit(() => plan.forEach(([o, keep]) => {
      if (!keep.length) return canvas.remove(o);
      const n = Edit.path(Effects.toD(keep), o); if (!keep.some(s => s.closed)) n.set('fill', '');
      Edit.swap(o, [n]);
    }));
    Tools.sel = Tools.sel.filter(Edit.onCanvas);
  },
  draw(ctx){
    const st = Tools.st; if (!st) return;
    if (Tools.opts.vsegdel.mode === 'free') return Tools.hair(ctx, c => Tools.poly(c, st.pts), '#ef4444');
    const a = Tools.S(st.a), b = Tools.S(st.b); ctx.setLineDash([4, 3]); ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 1; ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y); ctx.setLineDash([]);
  },
});

/* ---------- Smart Fill: a new object from any enclosed area ---------- */
Tools.def('smartfill', {
  name: 'Smart Fill', tip: 'Create an object from an enclosed area and fill it', usesSel: true,
  opts: {fillMode: 'default', fill: '#f97316', outMode: 'default', stroke: '#000000'},
  hint: 'Click inside any enclosed area',
  bar(o){
    const c = [{type: 'sel', key: 'fillMode', title: 'Fill', options: [['default', 'Fill: default'], ['specify', 'Fill: specify'], ['none', 'Fill: none']]}];
    if (o.fillMode === 'specify') c.push({type: 'color', key: 'fill'});
    c.push({type: 'sel', key: 'outMode', title: 'Outline', options: [['default', 'Outline: default'], ['specify', 'Outline: specify'], ['none', 'Outline: none']]});
    if (o.outMode === 'specify') c.push({type: 'color', key: 'stroke'});
    return c;
  },
  style(){
    const O = Tools.opts.smartfill, fill = O.fillMode === 'none' ? '' : O.fillMode === 'specify' ? O.fill : (defFill || '');
    const stroke = O.outMode === 'none' ? null : O.outMode === 'specify' ? O.stroke : defStroke;
    return {fill, stroke, strokeWidth: stroke ? DEF_STROKE : 0, strokeUniform: true, fillRule: 'evenodd', name: 'Smart fill'};
  },
  down(p, e){
    const objs = leafs(canvas.getObjects().filter(o => o.visible && o.evented !== false)).filter(o => Edit.shapeOnly(o));
    if (Edit.needFonts(objs, () => this.down(p, e))) return;
    Shaping.init();
    let d = null;
    try { d = this.vector(p, objs) || this.raster(p, objs); } catch (err){ console.error(err); }
    paper.project.clear();
    if (!d) return toast('That point is not in an enclosed area');
    const n = new fabric.Path(d, this.style()); canvas.add(n); Edit.setSel([n]); snapshot(); refresh();
  },
  // every closed outline around the point, less every one that is not
  vector(p, objs){
    const pt = new paper.Point(p.x, p.y), inside = [], outside = [];
    objs.forEach(o => {
      const cl = Edit.subs(o).filter(s => s.closed); if (!cl.length) return;
      const it = Edit.item(cl, Edit.rule(o));
      (it.contains(pt) ? inside : outside).push(it);
    });
    if (!inside.length) return null;
    let r = inside.reduce((a, b) => a.intersect(b, {insert: false}));
    outside.forEach(it => { if (it.bounds.intersects(r.bounds)) r = r.subtract(it, {insert: false}); });
    const part = Edit.separate(r).find(k => k.contains(pt));
    return part ? part.pathData : null;
  },
  // areas closed in by open curves: flood the drawing as a picture and trace what it reaches
  raster(p, objs){
    const subs = objs.flatMap(o => Edit.subs(o)); if (!subs.length) return null;
    const b = Effects.boundsOf(subs), pad = 4, S = Math.min(6, 1400 / Math.max(b.w, b.h, 1)), W = Math.ceil(b.w * S) + pad * 2, H = Math.ceil(b.h * S) + pad * 2;
    const X = v => (v - b.x0) * S + pad, Y = v => (v - b.y0) * S + pad, sx = Math.round(X(p.x)), sy = Math.round(Y(p.y));
    if (sx < 1 || sy < 1 || sx >= W - 1 || sy >= H - 1) return null;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d', {willReadFrequently: true}); c.lineWidth = 1.5; c.strokeStyle = '#000'; c.lineJoin = c.lineCap = 'round';
    subs.forEach(s => { c.beginPath(); c.moveTo(X(s.segs[0][0].x), Y(s.segs[0][0].y)); s.segs.forEach(q => c.bezierCurveTo(X(q[1].x), Y(q[1].y), X(q[2].x), Y(q[2].y), X(q[3].x), Y(q[3].y))); if (s.closed) c.closePath(); c.stroke(); });
    const px = c.getImageData(0, 0, W, H).data, wall = i => px[i * 4 + 3] > 64, seen = new Uint8Array(W * H), stack = [sy * W + sx];
    if (wall(stack[0])) return null;
    seen[stack[0]] = 1;
    while (stack.length){
      const i = stack.pop(), x = i % W, y = (i - x) / W;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) return null;   // it leaks out
      for (const n of [i - 1, i + 1, i - W, i + W]) if (!seen[n] && !wall(n)){ seen[n] = 1; stack.push(n); }
    }
    // Moore tracing round the outside of what was flooded
    let start = seen.indexOf(1);
    const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]], out = [];
    let cur = start, dir = 0, guard = 0;
    do {
      const x = cur % W, y = (cur - x) / W; out.push({x, y});
      let found = false;
      for (let k = 0; k < 8; k++){
        const nd = (dir + 6 + k) % 8, nx = x + dirs[nd][0], ny = y + dirs[nd][1];
        if (seen[ny * W + nx]){ cur = ny * W + nx; dir = nd; found = true; break; }
      }
      if (!found) break;
    } while (cur !== start && ++guard < 400000);
    if (out.length < 8) return null;
    const pts = Tools.rdp(out.concat([out[0]]), 0.6).slice(0, -1).map(q => ({x: b.x0 + (q.x - pad) / S, y: b.y0 + (q.y - pad) / S}));
    // grow by half the traced line so the area meets the curves around it
    const K = 1000, co = new ClipperLib.ClipperOffset(2, 0.2 * K), sol = new ClipperLib.Paths();
    co.AddPath(pts.map(q => ({X: Math.round(q.x * K), Y: Math.round(q.y * K)})), ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
    co.Execute(sol, 1.2 / S * K);
    return sol.map(l => 'M' + l.map(q => `${q.X / K} ${q.Y / K}`).join('L') + 'Z').join('');
  },
});

/* ---------- Text: click for artistic text, drag for a paragraph frame ---------- */
Tools.def('text', {
  name: 'Text', tip: 'Click for artistic text, drag a frame for paragraph text', hint: 'Click to type a heading · drag a frame for a paragraph that wraps',
  down(p){ Tools.st = {a: p, b: p}; },
  move(p){ const st = Tools.st; if (st){ st.b = p; canvas.requestRenderAll(); } },
  up(){
    const st = Tools.st; if (!st) return; Tools.st = null;
    const x0 = Math.min(st.a.x, st.b.x), y0 = Math.min(st.a.y, st.b.y), w = Math.abs(st.b.x - st.a.x), h = Math.abs(st.b.y - st.a.y);
    let t;
    if (w * zoom > 12 && h * zoom > 8){
      t = new fabric.Textbox('Your paragraph text', {left: x0, top: y0, width: w, fontFamily: 'Inter', fontSize: 14, fill: defFill || '#111111', lineHeight: 1.2, name: 'Paragraph text', splitByGrapheme: false});
    } else { t = makeText('Your text', {fontSize: 40}); t.set({left: st.a.x, top: st.a.y - 20}); }
    canvas.add(t); setTool('pick'); canvas.setActiveObject(t); t.enterEditing(); t.selectAll(); canvas.requestRenderAll();
  },
  draw(ctx){ const st = Tools.st; if (!st) return; const a = Tools.S(st.a), b = Tools.S(st.b); ctx.setLineDash([4, 3]); ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 1; ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y); ctx.setLineDash([]); },
});
// resizing a paragraph frame changes the frame, not the size of the letters
canvas.on('object:modified', e => {
  const t = e.target; if (!t || t.type !== 'textbox' || (t.scaleX === 1 && t.scaleY === 1)) return;
  t.set({width: t.width * t.scaleX, scaleX: 1, scaleY: 1}); t.initDimensions(); t.setCoords(); canvas.requestRenderAll();
});
canvas.on('after:render', e => {
  if (!e || e.ctx !== canvas.contextContainer) return;
  const a = canvas.getActiveObject(); if (!a || a.type !== 'textbox') return;
  const c = a.getCoords(true, true).map(q => Tools.S(q)), r = canvas.getRetinaScaling(), ctx = e.ctx;
  ctx.save(); ctx.setTransform(r, 0, 0, r, 0, 0); ctx.setLineDash([4, 3]); ctx.strokeStyle = '#9ca3af'; ctx.lineWidth = 1; ctx.beginPath(); c.forEach((q, i) => i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)); ctx.closePath(); ctx.stroke(); ctx.restore();
});
