/* ===================== drawing tools =====================
   The tool framework (Tools), the flyout toolbox (Toolbox) and every tool that draws something new: Freehand,
   2-point line, Bezier, Pen, B-spline, Polyline, 3-point curve, Artistic media, Smart drawing, Rectangle, 3-point
   rectangle, Ellipse, 3-point ellipse, Polygon, Star, Complex star, Graph paper, Spiral and the Perfect shapes.
   Behaviour follows TraceDraw's docs/behavior/{curve-tools,shape-tools,brush-strokes,toolbox}.md. */

const LINE_W = 1.5;      // scene units; a new line's outline when no default outline is set
const Tools = {
  defs: {}, opts: {}, sel: [], st: null,
  def(id, d){ this.defs[id] = d; this.opts[id] = Object.assign({}, d.opts || {}); return d; },
  active(){ return !!this.defs[tool]; },
  cur(){ return this.defs[tool]; },
  o(){ return this.opts[tool]; },
  ctrl: e => !!(e && (e.ctrlKey || e.metaKey)),

  enter(t, sel){ this.sel = sel || []; this.st = null; const d = this.defs[t]; if (d && d.start) d.start.call(d); this.bar(); },
  leave(t){ const d = this.defs[t]; if (d && d.stop) d.stop.call(d); this.st = null; },
  down(o){ const d = this.cur(); if (d.down) d.down.call(d, canvas.getPointer(o.e), o.e, o); },
  move(o){ const d = this.cur(); if (d.move) d.move.call(d, canvas.getPointer(o.e), o.e, o); },
  up(o){ const d = this.cur(); if (d && d.up) d.up.call(d, canvas.getPointer(o.e), o.e, o); },
  // after the other double-click handlers: finishing a curve here must not also count as a double-click for the Pick tool
  dbl(o){ const d = this.cur(); if (!d.dbl) return; const p = canvas.getPointer(o.e); setTimeout(() => { if (this.cur() === d) d.dbl.call(d, p, o.e, o); }, 0); },
  // what shows up on the current shirt, for lines and text that have no colour of their own yet
  ink(){ const c = new fabric.Color(SHIRTS[shirt] || '#000000').getSource(); return (c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11) < 128 ? '#ffffff' : '#111111'; },
  key(e){ const d = this.cur(); return !!(d && d.key && d.key.call(d, e)); },
  // a second finger came down: what the first one started is dropped
  cancelGesture(){ const d = this.cur(); if (d.cancelGesture) d.cancelGesture.call(d); else { this.st = null; drawing = null; canvas.requestRenderAll(); } },
  // Ctrl+Z while drawing steps back one node
  stepBack(e, list){
    if (!(this.ctrl(e) && e.key.toLowerCase() === 'z')) return false;
    list.pop(); if (!list.length) this.st = null; canvas.requestRenderAll(); this.bar(); return true;
  },
  // a selected table or dimension shows its own controls with the Pick tool too
  context(a, objs){
    const el = $('pbTools'); if (this.active()) return;
    const d = objs.length === 1 && a && this.contextBars[a.type];
    el.classList.toggle('on', !!d);
    if (!d){ if (el.firstChild) el.innerHTML = ''; el._for = null; return; }
    d(el, a);
  },
  contextBars: {},

  // a new object is finished: back to the Pick tool with it selected
  finish(obj){
    this.st = null; Pick.clearGuides(); Pick.targets = null;
    if (this.leaving){ canvas.requestRenderAll(); return snapshot(); }   // another tool was picked mid-curve
    setTool('pick');
    if (obj){ if (Array.isArray(obj)) selectObjs(obj); else { canvas.setActiveObject(obj); canvas.requestRenderAll(); } }
    snapshot(); refresh();
  },
  snap(p, e){ return Pick.snapPoint(p); },
  // Ctrl: steps of the constrain angle (15 degrees) from a point, keeping the reach
  constrain(from, p, e){
    if (!this.ctrl(e)) return p;
    const a = Math.round(Math.atan2(p.y - from.y, p.x - from.x) / (Math.PI / 12)) * Math.PI / 12, d = Math.hypot(p.x - from.x, p.y - from.y);
    return {x: from.x + d * Math.cos(a), y: from.y + d * Math.sin(a)};
  },
  joinDist(){ return (COARSE ? 16 : 6) / zoom; },
  near(a, b, r){ return Math.hypot(a.x - b.x, a.y - b.y) <= (r || this.joinDist()); },
  fill(){ return defFill || ''; },
  strokeColor(){ return defStroke || defFill || '#111111'; },
  lineStyle(extra){ return Object.assign({fill: '', stroke: this.strokeColor(), strokeWidth: LINE_W, strokeUniform: true, strokeLineCap: 'round', strokeLineJoin: 'round'}, extra || {}); },
  shapeStyle(extra){ return Object.assign({fill: this.fill(), stroke: defStroke, strokeWidth: defStroke ? DEF_STROKE : 0, strokeUniform: true, strokeLineJoin: 'round'}, extra || {}); },

  /* ---------- overlay ---------- */
  S(p){ const v = canvas.viewportTransform; return {x: p.x * v[0] + v[4], y: p.y * v[3] + v[5]}; },
  // a hairline on a white line twice as wide, so it shows over any colour
  hair(ctx, trace, colour){
    ctx.setLineDash([]); ctx.beginPath(); trace(ctx); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); trace(ctx); ctx.strokeStyle = colour || '#111'; ctx.lineWidth = 1; ctx.stroke();
  },
  blue(ctx, trace){ this.hair(ctx, trace, '#2563eb'); },
  square(ctx, p, on, z){ z = z || (COARSE ? 5 : 3.5); ctx.setLineDash([]); ctx.fillStyle = on ? '#2563eb' : '#fff'; ctx.strokeStyle = on ? '#fff' : '#2563eb'; ctx.lineWidth = 1; ctx.fillRect(p.x - z, p.y - z, 2 * z, 2 * z); ctx.strokeRect(p.x - z, p.y - z, 2 * z, 2 * z); },
  poly(ctx, pts){ pts.forEach((q, i) => { const s = this.S(q); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); }); },
  drawObject(ctx, o){ const v = canvas.viewportTransform; ctx.save(); ctx.transform(v[0], v[1], v[2], v[3], v[4], v[5]); o.objectCaching = false; o.render(ctx); ctx.restore(); },
  draw(ctx){
    const d = this.cur(); if (!d || !(d.draw || d.usesSel)) return;
    const r = canvas.getRetinaScaling();
    ctx.save(); ctx.setTransform(r, 0, 0, r, 0, 0);
    if (d.usesSel) this.sel.forEach(o => { if (!canvas.getObjects().includes(o)) return; const c = o.getCoords(true, true).map(q => this.S(q)); ctx.setLineDash([4, 3]); ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 1; ctx.beginPath(); c.forEach((q, i) => i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)); ctx.closePath(); ctx.stroke(); ctx.setLineDash([]); });
    if (d.draw) d.draw.call(d, ctx);
    ctx.restore();
  },

  /* ---------- property bar: controls described by each tool ---------- */
  bar(){
    const el = $('pbTools'), d = this.cur();
    el.classList.toggle('on', !!d); el._for = null;
    if (!d) return;
    el.innerHTML = '';
    const opts = this.o();
    (d.bar ? d.bar.call(d, opts) : []).forEach(c => el.appendChild(this.control(c, opts, d)));
    if (d.hint){ const h = document.createElement('span'); h.className = 'hint'; h.textContent = typeof d.hint === 'function' ? d.hint.call(d) : d.hint; el.appendChild(h); }
  },
  control(c, opts, d){
    const changed = v => { if (c.key) opts[c.key] = v; if (c.on) c.on(v); if (d.changed) d.changed.call(d, c.key, v); canvas.requestRenderAll(); };
    if (c.type === 'btn'){ const b = document.createElement('button'); b.className = 'btn ' + (c.primary ? 'primary' : 'ghost') + ' mini'; b.textContent = c.label; if (c.title) b.title = c.title; b.disabled = !!c.disabled; b.onclick = () => c.on(); return b; }
    if (c.type === 'seg'){ const s = document.createElement('div'); s.className = 'seg'; c.options.forEach(([v, l]) => { const b = document.createElement('button'); b.textContent = l; b.classList.toggle('on', opts[c.key] === v); b.onclick = () => { changed(v); this.bar(); }; s.appendChild(b); }); return s; }
    if (c.type === 'sel'){ const s = document.createElement('select'); s.className = 'sel'; if (c.title) s.title = c.title; c.options.forEach(([v, l]) => { const o = document.createElement('option'); o.value = v; o.textContent = l; s.appendChild(o); }); s.value = opts[c.key]; s.onchange = () => { changed(s.value); this.bar(); }; return this.wrap(c, s); }
    if (c.type === 'chk'){ const l = document.createElement('label'); l.className = 'fld'; const i = document.createElement('input'); i.type = 'checkbox'; i.checked = !!opts[c.key]; i.onchange = () => changed(i.checked); l.append(i, ' ' + c.label); return l; }
    if (c.type === 'color'){ const i = document.createElement('input'); i.type = 'color'; i.value = opts[c.key]; i.className = 'swatchin'; i.oninput = () => changed(i.value); return this.wrap(c, i); }
    if (c.type === 'text'){ const i = document.createElement('input'); i.value = opts[c.key] == null ? '' : opts[c.key]; i.onchange = () => changed(i.value); return this.wrap(c, i); }
    if (c.type === 'shapes') return this.shapePicker(c, opts);
    // numbers, shown as `scale` units per scene value (inches by default for lengths)
    const i = document.createElement('input'); i.type = 'number'; i.className = 's'; const k = c.scale || 1;
    i.value = +(opts[c.key] / k).toFixed(c.digits == null ? 2 : c.digits); if (c.min != null) i.min = c.min / k; if (c.max != null) i.max = c.max / k; if (c.step) i.step = c.step;
    i.onchange = () => { let v = parseFloat(i.value); if (!isFinite(v)) return; v *= k; if (c.min != null) v = Math.max(c.min, v); if (c.max != null) v = Math.min(c.max, v); changed(v); };
    return this.wrap(c, i);
  },
  wrap(c, input){ if (!c.label) return input; const s = document.createElement('span'); s.className = 'fld'; if (c.title) s.title = c.title; s.append(c.label + ' ', input); return s; },
  shapePicker(c, opts){
    const b = document.createElement('button'); b.className = 'btn ghost mini shapebtn';
    const set = PerfectShapes[c.set], name = opts[c.key];
    b.innerHTML = PerfectShapes.svg(set[name]) + `<span></span>`; b.querySelector('span').textContent = name; b.title = 'Pick a shape';
    b.onclick = e => { e.stopPropagation(); this.closePopup();
      const pop = document.createElement('div'); pop.className = 'shapegrid-pop';
      Object.keys(set).forEach(n => { const it = document.createElement('button'); it.title = n; it.innerHTML = PerfectShapes.svg(set[n]); it.onclick = () => { opts[c.key] = n; this.closePopup(); this.bar(); }; pop.appendChild(it); });
      document.body.appendChild(pop); this.popup = pop;
      const r = b.getBoundingClientRect(); pop.style.left = Math.min(r.left, innerWidth - pop.offsetWidth - 8) + 'px'; pop.style.top = r.bottom + 4 + 'px'; };
    return b;
  },
  closePopup(){ if (this.popup){ this.popup.remove(); this.popup = null; } },

  /* ---------- inline text editor (table cells, callouts, dimension labels) ---------- */
  inline(sceneBox, text, done, opt = {}){
    this.closeInline(true);
    const ta = document.createElement('textarea'); ta.className = 'inlineedit'; ta.value = text || '';
    const a = this.S({x: sceneBox.x, y: sceneBox.y});
    Object.assign(ta.style, {left: a.x + 'px', top: a.y + 'px', width: Math.max(60, sceneBox.w * zoom) + 'px', height: Math.max(26, sceneBox.h * zoom) + 'px', fontSize: Math.max(12, (opt.size || 12) * zoom) + 'px', fontFamily: opt.font || 'Inter'});
    $('stage').appendChild(ta);
    const inl = this.inl = {ta, done, finish: commit => { if (this.inl !== inl) return; this.inl = null; const v = ta.value; ta.remove(); if (commit !== false) done(v); }};
    ta.onkeydown = e => {
      e.stopPropagation();
      if (e.key === 'Escape'){ e.preventDefault(); inl.finish(false); }
      else if (e.key === 'Enter' && !e.shiftKey && !opt.multiline){ e.preventDefault(); inl.finish(); }
      else if (e.key === 'Tab' && opt.tab){ e.preventDefault(); const v = ta.value; inl.finish(false); done(v); opt.tab(e.shiftKey); }
    };
    ta.onblur = () => setTimeout(() => inl.finish(), 0);
    setTimeout(() => { ta.focus(); ta.select(); }, 0);
  },
  closeInline(commit){ if (this.inl) this.inl.finish(commit); },

  /* ---------- geometry shared with the editing tools ---------- */
  // Catmull-Rom through a stroke's points, as path data
  pathD(pts, closed){ return Effects.toD([Effects.smooth(pts, closed)]); },
  rdp(pts, tol){
    if (pts.length < 3) return pts.slice();
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length){
      const [a, b] = stack.pop(); let best = -1, bd = tol;
      const A = pts[a], B = pts[b], dx = B.x - A.x, dy = B.y - A.y, l = Math.hypot(dx, dy);
      // a closed stroke starts and ends on one point: measure from that point
      for (let i = a + 1; i < b; i++){ const d = l < 1e-6 ? Math.hypot(pts[i].x - A.x, pts[i].y - A.y) : Math.abs((pts[i].x - A.x) * dy - (pts[i].y - A.y) * dx) / l; if (d > bd){ bd = d; best = i; } }
      if (best > 0){ keep[best] = 1; stack.push([a, best], [best, b]); }
    }
    return pts.filter((_, i) => keep[i]);
  },
};

/* ---------- curves being built node by node (Bezier, Pen, Polyline) ---------- */
function nodesToD(nodes, closed){
  const f = v => +v.toFixed(3); let d = `M${f(nodes[0].x)} ${f(nodes[0].y)}`;
  const seg = (a, b) => { if (a.out || b.in){ const c1 = a.out || a, c2 = b.in || b; d += `C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(b.x)} ${f(b.y)}`; } else d += `L${f(b.x)} ${f(b.y)}`; };
  for (let i = 1; i < nodes.length; i++) seg(nodes[i - 1], nodes[i]);
  if (closed){ seg(nodes[nodes.length - 1], nodes[0]); d += 'Z'; }
  return d;
}
function traceNodes(ctx, nodes, closed){
  if (!nodes.length) return;
  const S = p => Tools.S(p), a0 = S(nodes[0]); ctx.moveTo(a0.x, a0.y);
  const seg = (a, b) => { const e = S(b); if (a.out || b.in){ const c1 = S(a.out || a), c2 = S(b.in || b); ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, e.x, e.y); } else ctx.lineTo(e.x, e.y); };
  for (let i = 1; i < nodes.length; i++) seg(nodes[i - 1], nodes[i]);
  if (closed) seg(nodes[nodes.length - 1], nodes[0]);
}
function curveObject(nodes, closed, name){
  const style = closed ? Object.assign(Tools.shapeStyle(), defStroke ? {} : {stroke: '#111111', strokeWidth: LINE_W / 2}) : Tools.lineStyle();
  return new fabric.Path(nodesToD(nodes, closed), Object.assign(style, {name, fillRule: 'nonzero'}));
}
const finishBtns = d => [{type: 'btn', label: 'Finish', primary: true, title: 'Finish the curve (Enter or double-click)', on: () => d.end(false)}, {type: 'btn', label: 'Close', title: 'Close the curve to its first node', on: () => d.end(true)}];

// Bezier: click = corner node, drag = smooth node. Pen: the same with the next segment previewed.
const nodeCurveTool = (id, name, tip, opts) => Tools.def(id, {
  name, tip, opts, hint(){ return Tools.st && Tools.st.nodes ? 'Click for a corner · drag for a curve · hold C while pulling for a cusp · first node closes' : tip; },
  bar(){ return (id === 'pen' ? [{type: 'chk', key: 'preview', label: 'Preview'}] : []).concat(Tools.st && Tools.st.nodes ? finishBtns(this) : []); },
  end(closed){
    const st = Tools.st; if (!st || !st.nodes) return;
    const n = st.nodes; Tools.st = null;
    if (n.length < 2) return Tools.finish(null);
    canvas.requestRenderAll();
    const o = curveObject(n, closed, closed ? name + ' shape' : name + ' curve'); canvas.add(o); Tools.finish(o);
  },
  down(p, e){
    const st = Tools.st || (Tools.st = {nodes: []}), n = st.nodes, sp = Tools.snap(p);
    const q = n.length ? Tools.constrain(n[n.length - 1], sp, e) : sp;
    if (n.length >= 2 && Tools.near(p, n[0])){ st.pull = {node: n[0], closing: true, start: p}; st.closingAtUp = true; canvas.requestRenderAll(); return; }
    if (n.length && Tools.near(p, n[n.length - 1])){ n[n.length - 1].out = null; st.pull = null; this.touched = true; return; }   // again on the last node: a cusp
    const node = {x: q.x, y: q.y, in: null, out: null}; n.push(node); st.pull = {node, start: q, cusp: false};
    if (n.length === 1 || n.length === 2) Tools.bar();
  },
  move(p, e){
    const st = Tools.st; if (!st) return; st.cur = p;
    const pl = st.pull;
    if (pl && e.buttons !== 0 && Tools.near(p, pl.start, 2 / zoom) === false){
      const h = Tools.constrain(pl.node, p, e);
      if (pl.closing){ pl.node.in = {x: h.x, y: h.y}; pl.moved = true; }
      else {
        if (st.keyC) pl.cusp = true;
        pl.node.out = {x: h.x, y: h.y};
        if (!pl.cusp) pl.node.in = {x: 2 * pl.node.x - h.x, y: 2 * pl.node.y - h.y};
      }
    }
    canvas.requestRenderAll();
  },
  up(){ const st = Tools.st; if (!st) return; const pl = st.pull; st.pull = null; if (st.closingAtUp){ st.closingAtUp = false; this.end(true); return; } Pick.clearGuides(); canvas.requestRenderAll(); },
  dbl(){ this.end(false); },
  key(e){
    const st = Tools.st; if (!st) return false;
    if (e.key === 'Enter' || e.key === 'Escape'){ this.end(false); return true; }
    if (Tools.stepBack(e, st.nodes)) return true;
    if (e.key.toLowerCase() === 'c'){ st.keyC = true; const cl = () => { st.keyC = false; document.removeEventListener('keyup', cl); }; document.addEventListener('keyup', cl); return true; }
    return false;
  },
  stop(){ this.end(false); },
  cancelGesture(){ const st = Tools.st; if (st && st.pull && !st.pull.closing) st.nodes.pop(); if (st) st.pull = null; if (st && !st.nodes.length) Tools.st = null; canvas.requestRenderAll(); },
  draw(ctx){
    const st = Tools.st; if (!st || !st.nodes.length) return;
    const n = st.nodes, last = n[n.length - 1];
    Tools.hair(ctx, c => traceNodes(c, n));
    if (id === 'pen' && Tools.opts.pen.preview && st.cur && !st.pull){
      const tmp = [last, {x: st.cur.x, y: st.cur.y}]; Tools.blue(ctx, c => traceNodes(c, tmp));
    }
    [last.in, last.out].forEach(h => { if (!h) return; const a = Tools.S(last), b = Tools.S(h); ctx.setLineDash([3, 2]); ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]); ctx.beginPath(); ctx.arc(b.x, b.y, 3.5, 0, Math.PI * 2); ctx.fillStyle = '#2563eb'; ctx.fill(); });
    n.forEach((nd, i) => Tools.square(ctx, Tools.S(nd), i === n.length - 1));
  },
});
nodeCurveTool('bezier', 'Bezier', 'Draw curves one segment at a time: click for corners, drag for curves');
nodeCurveTool('pen', 'Pen', 'Draw curves in segments, previewing each segment as you draw', {preview: true});

// Polyline: clicks add straight segments, a drag adds a freehand stretch, all in one continuous curve
Tools.def('polyline', {
  name: 'Polyline', tip: 'Draw connected curves and straight lines in one continuous action',
  hint(){ return Tools.st ? 'Click for a straight segment · drag for a freehand stretch · Enter or double-click finishes' : this.tip; },
  bar(){ return Tools.st ? finishBtns(this) : []; },
  end(closed){
    const st = Tools.st; if (!st) return; const n = st.nodes; Tools.st = null;
    if (n.length < 2) return Tools.finish(null);
    const o = curveObject(n, closed, 'Polyline'); canvas.add(o); Tools.finish(o);
  },
  down(p, e){
    const fresh = !Tools.st, st = Tools.st || (Tools.st = {nodes: []}), n = st.nodes;
    if (n.length >= 2 && Tools.near(p, n[0])){ st.closeOnUp = true; return; }
    const q = n.length ? Tools.constrain(n[n.length - 1], Tools.snap(p), e) : Tools.snap(p);
    st.press = q; st.stroke = [q]; if (fresh) Tools.bar();
  },
  move(p, e){
    const st = Tools.st; if (!st) return; st.cur = p;
    if (st.stroke && e.buttons !== 0){ const l = st.stroke[st.stroke.length - 1]; if (Math.hypot(p.x - l.x, p.y - l.y) * zoom > 2) st.stroke.push({x: p.x, y: p.y}); }
    canvas.requestRenderAll();
  },
  up(p){
    const st = Tools.st; if (!st) return;
    if (st.closeOnUp){ st.closeOnUp = false; return this.end(true); }
    const s = st.stroke; st.stroke = null; if (!s) return;
    const dragged = s.length > 3;
    if (!dragged){ const last = st.nodes[st.nodes.length - 1]; if (!last || !Tools.near(st.press, last, 1 / zoom)) st.nodes.push({x: st.press.x, y: st.press.y, in: null, out: null}); return canvas.requestRenderAll(); }
    // a freehand stretch joins on as smooth cubic segments
    const pts = Tools.rdp(s, 1.3 / zoom); const sm = Effects.smooth(pts, false); const n = st.nodes;
    if (!n.length || !Tools.near(n[n.length - 1], sm.segs[0][0], 1 / zoom)) n.push({x: sm.segs[0][0].x, y: sm.segs[0][0].y, in: null, out: null});
    sm.segs.forEach(q => { n[n.length - 1].out = q[1]; n.push({x: q[3].x, y: q[3].y, in: q[2], out: null}); });
    canvas.requestRenderAll();
  },
  dbl(){ this.end(false); },
  key(e){ if (Tools.st && (e.key === 'Enter' || e.key === 'Escape')){ this.end(false); return true; } if (Tools.st && Tools.stepBack(e, Tools.st.nodes)) return true; return false; },
  stop(){ this.end(false); },
  draw(ctx){
    const st = Tools.st; if (!st) return; const n = st.nodes;
    Tools.hair(ctx, c => traceNodes(c, n));
    if (st.stroke && st.stroke.length > 1) Tools.hair(ctx, c => Tools.poly(c, st.stroke));
    else if (n.length && st.cur) Tools.blue(ctx, c => Tools.poly(c, [n[n.length - 1], st.cur]));
    n.forEach((nd, i) => { if (i === 0 || i === n.length - 1 || !nd.in) Tools.square(ctx, Tools.S(nd), i === n.length - 1); });
  },
});

// Freehand: a drag draws a curve; a click, then another click, draws a straight line
Tools.def('free', {
  name: 'Freehand', tip: 'Draw curves and straight line segments', opts: {smooth: 50},
  hint: 'Drag for a curve · click, then click again, for a straight line',
  bar(){ return [{type: 'num', key: 'smooth', label: 'Smoothing', min: 0, max: 100, digits: 0, title: 'Freehand smoothing'}]; },
  down(p, e){
    const st = Tools.st;
    if (st && st.first){ const q = Tools.constrain(st.first, Tools.snap(p), e); st.second = q; return; }
    Tools.st = {stroke: [Tools.snap(p)]};
  },
  move(p, e){
    const st = Tools.st; if (!st) return; st.cur = p;
    if (st.stroke && e.buttons !== 0){ const l = st.stroke[st.stroke.length - 1]; if (Math.hypot(p.x - l.x, p.y - l.y) * zoom > 1.5) st.stroke.push({x: p.x, y: p.y}); }
    canvas.requestRenderAll();
  },
  up(p, e){
    const st = Tools.st; if (!st) return;
    if (st.second){ const o = new fabric.Path(`M${st.first.x} ${st.first.y}L${st.second.x} ${st.second.y}`, Tools.lineStyle({name: 'Freehand line'})); canvas.add(o); return Tools.finish(o); }
    const s = st.stroke;
    if (s.length < 3){ Tools.st = {first: s[0]}; return; }
    const tol = (0.2 + Tools.opts.free.smooth / 100 * 2.2) / zoom, pts = Tools.rdp(s, tol);
    const closed = pts.length > 3 && Tools.near(pts[0], pts[pts.length - 1]);
    if (closed) pts.pop();
    const style = closed ? Object.assign(Tools.shapeStyle(), defStroke ? {} : {stroke: '#111111', strokeWidth: LINE_W / 2}) : Tools.lineStyle();
    const o = new fabric.Path(Tools.pathD(pts, closed), Object.assign(style, {name: 'Freehand', fillRule: 'nonzero'})); canvas.add(o); Tools.finish(o);
  },
  key(e){ if (e.key === 'Escape' && Tools.st){ Tools.st = null; canvas.requestRenderAll(); return true; } return false; },
  draw(ctx){
    const st = Tools.st; if (!st) return;
    if (st.stroke && st.stroke.length > 1) Tools.hair(ctx, c => Tools.poly(c, st.stroke));
    if (st.first){ Tools.square(ctx, Tools.S(st.first), true); if (st.cur) Tools.blue(ctx, c => Tools.poly(c, [st.first, st.cur])); }
  },
});

// 2-point line: drag from start to end, or click both
Tools.def('line', {
  name: '2-Point Line', tip: 'Draw a straight line from the starting point to the end point', hint: 'Drag, or click the two ends · Ctrl keeps it to 15° steps',
  make(a, b){ return new fabric.Line([a.x, a.y, b.x, b.y], Tools.lineStyle({fill: null, name: 'Line'})); },
  down(p){ const st = Tools.st; if (st && st.waiting){ st.waiting = false; st.b = st.b || Tools.snap(p); st.done = true; return; } Tools.st = {a: Tools.snap(p), b: null}; },
  move(p, e){ const st = Tools.st; if (st){ st.b = Tools.constrain(st.a, Tools.snap(p), e); canvas.requestRenderAll(); } },
  up(p, e){
    const st = Tools.st; if (!st) return;
    if (!st.done && (!st.b || Tools.near(st.a, st.b, 3 / zoom))){ st.waiting = true; return; }
    const o = this.make(st.a, st.b); canvas.add(o); Tools.finish(o);
  },
  key(e){ if (e.key === 'Escape' && Tools.st){ Tools.st = null; canvas.requestRenderAll(); return true; } return false; },
  draw(ctx){ const st = Tools.st; if (st && st.b) Tools.hair(ctx, c => Tools.poly(c, [st.a, st.b])); },
});

// 3-point curve: drag from start to end, then move and click the point it passes through
Tools.def('curve3', {
  name: '3-Point Curve', tip: 'Draw a curve by dragging from start to end, then positioning the centre point', hint(){ return Tools.st && Tools.st.step === 2 ? 'Move to shape the curve, then click' : this.tip; },
  segs(a, b, m){ const c = {x: 2 * m.x - (a.x + b.x) / 2, y: 2 * m.y - (a.y + b.y) / 2}; return [{x: a.x, y: a.y, in: null, out: Effects.lerp(a, c, 2 / 3)}, {x: b.x, y: b.y, in: Effects.lerp(b, c, 2 / 3), out: null}]; },
  down(p){ const st = Tools.st; if (st && st.step === 2){ st.place = true; st.m = Tools.snap(p); return; } Tools.st = {step: 1, a: Tools.snap(p), b: null, dragging: true}; },
  move(p, e){ const st = Tools.st; if (!st) return; if (st.step === 1){ st.b = Tools.constrain(st.a, Tools.snap(p), e); } else st.m = Tools.snap(p); canvas.requestRenderAll(); },
  up(p){
    const st = Tools.st; if (!st) return;
    if (st.step === 1){ st.dragging = false; if (st.b && !Tools.near(st.a, st.b, 3 / zoom)){ st.step = 2; st.m = p; Tools.bar(); } return; }
    if (st.place){ const o = new fabric.Path(nodesToD(this.segs(st.a, st.b, st.m), false), Tools.lineStyle({name: '3-point curve'})); canvas.add(o); Tools.finish(o); }
  },
  key(e){ if (e.key === 'Escape' && Tools.st){ Tools.st = null; canvas.requestRenderAll(); return true; } return false; },
  draw(ctx){
    const st = Tools.st; if (!st || !st.b) return;
    if (st.step === 1) Tools.hair(ctx, c => Tools.poly(c, [st.a, st.b]));
    else { const n = this.segs(st.a, st.b, st.m); Tools.hair(ctx, c => traceNodes(c, n)); Tools.square(ctx, Tools.S(st.m), true); }
  },
});

/* ---------- B-spline ---------- */
const BSpline = {
  // cubic B-spline as Bezier segments, starting and ending on its ends (or periodic when closed)
  segs(P, closed){
    const n = P.length; if (n < 2) return [];
    const Q = closed ? [P[n - 1]].concat(P, [P[0], P[1]]) : [P[0], P[0], P[0]].concat(P.slice(1, n - 1), [P[n - 1], P[n - 1], P[n - 1]]);
    const out = [], m = (a, b, c, ka, kb, kc) => ({x: (a.x * ka + b.x * kb + c.x * kc) / 6, y: (a.y * ka + b.y * kb + c.y * kc) / 6});
    for (let i = 0; i + 3 < Q.length; i++){
      const [a, b, c, d] = [Q[i], Q[i + 1], Q[i + 2], Q[i + 3]];
      const b0 = m(a, b, c, 1, 4, 1), b1 = m(b, c, c, 4, 2, 0), b2 = m(b, c, c, 2, 4, 0), b3 = m(b, c, d, 1, 4, 1);
      if (Math.hypot(b0.x - b3.x, b0.y - b3.y) > 1e-6) out.push([b0, b1, b2, b3]);
    }
    return out;
  },
  d(P, closed){ return Effects.toD([{closed, segs: this.segs(P, closed)}]); },
};
Tools.def('bspline', {
  name: 'B-Spline', tip: 'Draw curved lines by setting control points that shape the curve',
  hint(){ return Tools.st ? 'Click control points · Enter or double-click finishes · the first point closes it' : this.tip; },
  bar(){ return Tools.st ? finishBtns(this) : []; },
  end(closed){
    const st = Tools.st; if (!st) return; const P = st.pts; Tools.st = null;
    if (P.length < 2) return Tools.finish(null);
    const style = closed ? Object.assign(Tools.shapeStyle(), defStroke ? {} : {stroke: '#111111', strokeWidth: LINE_W / 2}) : Tools.lineStyle();
    const o = new fabric.Path(BSpline.d(P, closed), Object.assign(style, {name: 'B-spline', fillRule: 'nonzero'}));
    o.spline = {pts: P.map(q => ({x: q.x, y: q.y})), closed}; canvas.add(o); Tools.finish(o);
  },
  down(p){
    const fresh = !Tools.st, st = Tools.st || (Tools.st = {pts: []}), P = st.pts;
    if (P.length >= 3 && Tools.near(p, P[0])){ st.closeOnUp = true; return; }
    const q = Tools.snap(p), l = P[P.length - 1];
    if (!l || !Tools.near(q, l, 2 / zoom)) P.push({x: q.x, y: q.y});
    if (fresh) Tools.bar();
  },
  move(p){ const st = Tools.st; if (st){ st.cur = p; canvas.requestRenderAll(); } },
  up(){ const st = Tools.st; if (st && st.closeOnUp){ st.closeOnUp = false; this.end(true); } },
  dbl(){ this.end(false); },
  key(e){ if (Tools.st && (e.key === 'Enter' || e.key === 'Escape')){ this.end(false); return true; } return false; },
  stop(){ this.end(false); },
  draw(ctx){
    const st = Tools.st; if (!st) return;
    const l = st.pts[st.pts.length - 1], P = st.cur && !Tools.near(st.cur, l, 2 / zoom) ? st.pts.concat([st.cur]) : st.pts;
    ctx.setLineDash([4, 3]); ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 1; ctx.beginPath(); Tools.poly(ctx, P); ctx.stroke(); ctx.setLineDash([]);
    if (P.length > 1){ const n = BSpline.segs(P, false).flatMap((q, i) => i ? [q] : [q]); Tools.hair(ctx, c => { if (!n.length) return; const a = Tools.S(n[0][0]); c.moveTo(a.x, a.y); n.forEach(q => { const c1 = Tools.S(q[1]), c2 = Tools.S(q[2]), e = Tools.S(q[3]); c.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, e.x, e.y); }); }); }
    st.pts.forEach(q => Tools.square(ctx, Tools.S(q), true));
  },
});

/* ---------- Artistic media: Preset, Brush, Sprayer, Calligraphic, Expression ---------- */
const MM2 = PX_PER_IN / 25.4;
const Artistic = {
  profile(kind, t){
    return kind === 'start' ? t : kind === 'end' ? 1 - t : kind === 'bulge' ? Math.pow(Math.sin(Math.PI * t), 2) * 0.8 + 0.2 : kind === 'wave' ? 0.55 + 0.45 * Math.sin(t * Math.PI * 6) : kind === 'flat' ? 1 : Math.pow(Math.sin(Math.PI * t), 0.7);
  },
  lens(pts){ let acc = 0; return pts.map((q, i) => i ? (acc += Math.hypot(q.x - pts[i - 1].x, q.y - pts[i - 1].y)) : 0); },
  // a filled outline around the stroke, half-width w(i) on each side
  ribbon(pts, w){
    const L = [], R = [];
    pts.forEach((q, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1, h = w(i);
      L.push({x: q.x - dy / l * h, y: q.y + dx / l * h}); R.push({x: q.x + dy / l * h, y: q.y - dx / l * h});
    });
    return L.concat(R.reverse());
  },
  resample(pts, step){ const out = [pts[0]]; for (let i = 1; i < pts.length; i++){ const a = pts[i - 1], b = pts[i], d = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.ceil(d / step)); for (let k = 1; k <= n; k++) out.push(Effects.lerp(a, b, k / n)); } return out; },
  build(raw, times){
    const O = Tools.opts.brush, W = O.width, tol = (0.1 + O.smooth / 100 * 1.5) * MM2, S = Math.max(0.8, W / 6);
    const pts = this.resample(Tools.rdp(raw, tol), S), fill = Tools.fill() || '#111111';
    if (pts.length < 2) return null;
    const L = this.lens(pts), tot = L[L.length - 1] || 1, base = {fill, stroke: null, strokeWidth: 0, fillRule: 'nonzero'};
    if (O.mode === 'sprayer'){
      const items = []; let k = 0;
      for (let s = 0; s <= tot + O.spacing * 0.05; s += Math.max(1, O.spacing)){
        let i = L.findIndex(v => v >= s); if (i < 0) i = pts.length - 1;
        const size = W * (0.7 + 0.3 * Effects.rnd(k++)), q = pts[i];
        items.push(new fabric.Path(PerfectShapes.fit(this.SPRAY[O.object], q.x - size / 2, q.y - size / 2, q.x + size / 2, q.y + size / 2), Object.assign({}, base, {fillRule: 'evenodd'})));
      }
      return items.length > 1 ? new fabric.Group(items, {name: 'Sprayed stroke'}) : Object.assign(items[0], {name: 'Sprayed stroke'});
    }
    if (O.mode === 'calligraphic'){
      // the outline swept by a flat nib of `width` at `angle`
      const a = fabric.util.degreesToRadians(O.angle), n = {x: Math.cos(a) * W / 2, y: -Math.sin(a) * W / 2}, K = 100;
      const quads = []; for (let i = 1; i < pts.length; i++){ const p = pts[i - 1], q = pts[i]; quads.push([{X: Math.round((p.x + n.x) * K), Y: Math.round((p.y + n.y) * K)}, {X: Math.round((q.x + n.x) * K), Y: Math.round((q.y + n.y) * K)}, {X: Math.round((q.x - n.x) * K), Y: Math.round((q.y - n.y) * K)}, {X: Math.round((p.x - n.x) * K), Y: Math.round((p.y - n.y) * K)}]); }
      quads.forEach(q => { if (!ClipperLib.Clipper.Orientation(q)) q.reverse(); });
      const cl = new ClipperLib.Clipper(), sol = new ClipperLib.Paths(); cl.AddPaths(quads, ClipperLib.PolyType.ptSubject, true); cl.Execute(ClipperLib.ClipType.ctUnion, sol, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
      const d = sol.map(p => 'M' + p.map(q => `${q.X / K} ${q.Y / K}`).join('L') + 'Z').join('');
      return new fabric.Path(d, Object.assign({}, base, {name: 'Calligraphic stroke'}));
    }
    let w;
    if (O.mode === 'expression'){
      // slow strokes are wide: the speed between samples stands in for pen pressure
      const speed = pts.map((_, i) => { const r = i / (pts.length - 1) * (raw.length - 1), j = Math.round(r), a = Math.max(0, j - 2), b = Math.min(raw.length - 1, j + 2), dt = (times[b] - times[a]) || 1, dd = Math.hypot(raw[b].x - raw[a].x, raw[b].y - raw[a].y); return dd / dt; });
      const mx = Math.max(...speed) || 1; w = i => (W / 2) * (1 - (1 - O.pressure) * speed[i] / mx) * Math.min(1, 0.2 + 2 * Math.min(L[i], tot - L[i]) / (W * 2));
    } else {
      const jit = O.mode === 'brush'; w = i => (W / 2) * Math.max(0.03, this.profile(O.profile, L[i] / tot)) * (jit ? 0.72 + 0.28 * Effects.rnd(i * 3.1) : 1);
    }
    const outline = this.ribbon(pts, w);
    const d = O.mode === 'brush' ? 'M' + outline.map(q => `${q.x.toFixed(2)} ${q.y.toFixed(2)}`).join('L') + 'Z' : Effects.toD([Effects.smooth(Tools.rdp(outline.concat([outline[0]]), 0.05 * MM2).slice(0, -1), true)]);
    return new fabric.Path(d, Object.assign({}, base, {name: O.mode === 'brush' ? 'Brush stroke' : O.mode === 'expression' ? 'Expression stroke' : 'Preset stroke'}));
  },
  SPRAY: {circle: 'M50 0A50 50 0 1 1 49.99 0Z', square: 'M0 0H100V100H0Z', star: 'M50 0L62 35H98L68 57L79 92L50 70L21 92L32 57L2 35H38Z', heart: 'M50 95C20 70 0 50 0 28C0 12 12 2 26 2C36 2 45 8 50 18C55 8 64 2 74 2C88 2 100 12 100 28C100 50 80 70 50 95Z', leaf: 'M50 0C90 30 90 70 50 100C10 70 10 30 50 0Z'},
};
Tools.def('brush', {
  name: 'Artistic Media', tip: 'Add artistic brush, spray and calligraphic effects with freehand strokes',
  opts: {mode: 'calligraphic', width: 3 * MM2, angle: 45, smooth: 25, profile: 'both', object: 'circle', spacing: 8 * MM2, pressure: 0.5},
  bar(o){
    const c = [{type: 'sel', key: 'mode', title: 'Mode', options: [['preset', 'Preset'], ['brush', 'Brush'], ['sprayer', 'Sprayer'], ['calligraphic', 'Calligraphic'], ['expression', 'Expression']]},
               {type: 'num', key: 'width', label: 'Width', scale: PX_PER_IN, min: 0.5, step: 0.05, title: 'Width (in)'}];
    if (o.mode === 'preset' || o.mode === 'brush') c.push({type: 'sel', key: 'profile', title: 'Shape', options: [['both', 'Taper both ends'], ['start', 'Taper start'], ['end', 'Taper end'], ['bulge', 'Bulge'], ['wave', 'Wave'], ['flat', 'Flat']]});
    if (o.mode === 'sprayer') c.push({type: 'sel', key: 'object', title: 'Sprayed object', options: [['circle', 'Circles'], ['square', 'Squares'], ['star', 'Stars'], ['heart', 'Hearts'], ['leaf', 'Leaves']]}, {type: 'num', key: 'spacing', label: 'Spacing', scale: PX_PER_IN, min: 1, step: 0.05});
    if (o.mode === 'calligraphic') c.push({type: 'num', key: 'angle', label: 'Nib ∠', digits: 0});
    if (o.mode === 'expression') c.push({type: 'num', key: 'pressure', label: 'Pressure', min: 0, max: 1, step: 0.05});
    return c.concat([{type: 'num', key: 'smooth', label: 'Smoothing', min: 0, max: 100, digits: 0}]);
  },
  hint: 'Drag to paint',
  down(p){ Tools.st = {pts: [{x: p.x, y: p.y}], times: [performance.now()]}; },
  move(p, e){ const st = Tools.st; if (!st) return; const l = st.pts[st.pts.length - 1]; if (Math.hypot(p.x - l.x, p.y - l.y) * zoom > 1.5){ st.pts.push({x: p.x, y: p.y}); st.times.push(performance.now()); } canvas.requestRenderAll(); },
  up(){
    const st = Tools.st; if (!st) return; Tools.st = null;
    if (st.pts.length < 2){ canvas.requestRenderAll(); return; }
    const o = Artistic.build(st.pts, st.times); if (!o) return;
    canvas.add(o); Tools.finish(o);
  },
  draw(ctx){ const st = Tools.st; if (!st) return; const r = Tools.opts.brush; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.globalAlpha = 0.5; ctx.strokeStyle = Tools.fill() || '#111'; ctx.lineWidth = r.width * zoom; ctx.beginPath(); Tools.poly(ctx, st.pts); ctx.stroke(); ctx.globalAlpha = 1; },
});

/* ---------- Smart Drawing: freehand strokes become basic shapes or smooth curves ---------- */
const SmartShape = {
  recognise(raw, level){
    // level 0..100: how readily a stroke is taken for a shape
    const k = 0.5 + level / 100;
    const xs = raw.map(p => p.x), ys = raw.map(p => p.y), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), diag = Math.hypot(x1 - x0, y1 - y0) || 1;
    const a = raw[0], b = raw[raw.length - 1], closed = Math.hypot(a.x - b.x, a.y - b.y) < 0.15 * diag;
    if (!closed){
      const l = Math.hypot(b.x - a.x, b.y - a.y) || 1, dev = Math.max(...raw.map(p => Math.abs((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) / l));
      if (dev < 0.05 * k * l) return {kind: 'line', a, b};
      return {kind: 'curve'};
    }
    // corners of the closed stroke
    const c = Tools.rdp(raw.concat([a]), 0.09 / k * diag); c.pop();
    let pts = c.slice(); if (pts.length > 2 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 0.12 * diag) pts.pop();
    // merge corners that sit close together
    pts = pts.filter((q, i) => { const n = pts[(i + 1) % pts.length]; return Math.hypot(q.x - n.x, q.y - n.y) > 0.12 * diag; });
    const fit = this.ellipse(raw);
    if (pts.length === 3) { if (fit.rms > 0.075 * k) return {kind: 'triangle', pts}; }
    if (pts.length === 4 && fit.rms > 0.05 * k){
      const ang = i => { const p = pts[(i + 3) % 4], q = pts[i], r = pts[(i + 1) % 4], u = Math.atan2(p.y - q.y, p.x - q.x), v = Math.atan2(r.y - q.y, r.x - q.x); let d = Math.abs(u - v) * 180 / Math.PI; return d > 180 ? 360 - d : d; };
      if ([0, 1, 2, 3].every(i => Math.abs(ang(i) - 90) < 22)) return {kind: 'rect', pts};
      return {kind: 'quad', pts};
    }
    if (fit.rms < 0.16 * k) return Object.assign({kind: 'ellipse'}, fit);
    return {kind: 'curve', closed: true};
  },
  // principal axes of the stroke; rms is how far it strays from that ellipse
  ellipse(pts){
    const n = pts.length; let mx = 0, my = 0; pts.forEach(p => { mx += p.x; my += p.y; }); mx /= n; my /= n;
    let a = 0, b = 0, c = 0; pts.forEach(p => { const x = p.x - mx, y = p.y - my; a += x * x; b += x * y; c += y * y; });
    const th = 0.5 * Math.atan2(2 * b, a - c), co = Math.cos(th), si = Math.sin(th);
    let rx = 0, ry = 0; pts.forEach(p => { const x = p.x - mx, y = p.y - my; rx = Math.max(rx, Math.abs(x * co + y * si)); ry = Math.max(ry, Math.abs(-x * si + y * co)); });
    rx = rx || 1; ry = ry || 1;
    let e = 0; pts.forEach(p => { const x = p.x - mx, y = p.y - my, u = (x * co + y * si) / rx, v = (-x * si + y * co) / ry; e += (Math.hypot(u, v) - 1) ** 2; });
    return {cx: mx, cy: my, rx, ry, angle: th * 180 / Math.PI, rms: Math.sqrt(e / n)};
  },
};
Tools.def('smartdraw', {
  name: 'Smart Drawing', tip: 'Convert freehand strokes to basic shapes or smoothed curves', opts: {level: 50, smooth: 50},
  hint: 'Draw a rough line, rectangle, triangle or ellipse: it is tidied up when you let go',
  bar(){ return [{type: 'num', key: 'level', label: 'Recognition', min: 0, max: 100, digits: 0}, {type: 'num', key: 'smooth', label: 'Smoothing', min: 0, max: 100, digits: 0}]; },
  down(p){ Tools.st = {pts: [{x: p.x, y: p.y}]}; },
  move(p){ const st = Tools.st; if (!st) return; const l = st.pts[st.pts.length - 1]; if (Math.hypot(p.x - l.x, p.y - l.y) * zoom > 1.5) st.pts.push({x: p.x, y: p.y}); canvas.requestRenderAll(); },
  up(){
    const st = Tools.st; if (!st) return; Tools.st = null;
    if (st.pts.length < 4){ canvas.requestRenderAll(); return; }
    const O = Tools.opts.smartdraw, r = SmartShape.recognise(st.pts, O.level), styled = Tools.shapeStyle(defStroke ? {} : {stroke: '#111111', strokeWidth: LINE_W / 2});
    let o;
    if (r.kind === 'line') o = new fabric.Path(`M${r.a.x} ${r.a.y}L${r.b.x} ${r.b.y}`, Tools.lineStyle({name: 'Line'}));
    else if (r.kind === 'triangle' || r.kind === 'quad') o = new fabric.Path('M' + r.pts.map(q => `${q.x} ${q.y}`).join('L') + 'Z', Object.assign(styled, {name: r.kind === 'triangle' ? 'Triangle' : 'Four-sided shape', fillRule: 'nonzero'}));
    else if (r.kind === 'rect'){
      const [a, b, c, d] = r.pts, w = (Math.hypot(b.x - a.x, b.y - a.y) + Math.hypot(c.x - d.x, c.y - d.y)) / 2, h = (Math.hypot(d.x - a.x, d.y - a.y) + Math.hypot(c.x - b.x, c.y - b.y)) / 2;
      o = new fabric.Rect(Object.assign(styled, {width: w, height: h, angle: Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI, name: 'Rectangle'}));
      placeCenter(o, (a.x + b.x + c.x + d.x) / 4, (a.y + b.y + c.y + d.y) / 4);
    }
    else if (r.kind === 'ellipse'){ o = new fabric.Ellipse(Object.assign(styled, {rx: r.rx, ry: r.ry, angle: r.angle, name: 'Ellipse'})); placeCenter(o, r.cx, r.cy); }
    else {
      const tol = (0.2 + O.smooth / 100 * 2.2) / zoom, pts = Tools.rdp(st.pts, tol), cl = !!r.closed; if (cl) pts.pop();
      o = new fabric.Path(Tools.pathD(pts, cl), Object.assign(cl ? styled : Tools.lineStyle(), {name: 'Smoothed curve', fillRule: 'nonzero'}));
    }
    canvas.add(o); Tools.finish(o);
  },
  draw(ctx){ const st = Tools.st; if (st && st.pts.length > 1) Tools.hair(ctx, c => Tools.poly(c, st.pts)); },
});

/* ---------- shape tools: drag a box ---------- */
const Geo = {
  // regular polygon vertices (first at the top), fitted so their bounds fill the box
  vertices(n, inner){
    const v = [], m = inner != null ? n * 2 : n;
    for (let i = 0; i < m; i++){ const a = -Math.PI / 2 + i * 2 * Math.PI / m, r = inner != null && i % 2 ? inner : 1; v.push({x: r * Math.cos(a), y: r * Math.sin(a)}); }
    return v;
  },
  fitPts(v, b){
    const xs = v.map(p => p.x), ys = v.map(p => p.y), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    return v.map(p => ({x: b.x0 + (p.x - x0) / (x1 - x0 || 1) * (b.x1 - b.x0), y: b.y0 + (p.y - y0) / (y1 - y0 || 1) * (b.y1 - b.y0)}));
  },
  polyD: pts => 'M' + pts.map(q => `${q.x.toFixed(3)} ${q.y.toFixed(3)}`).join('L') + 'Z',
  polygon(n, b){ return this.polyD(this.fitPts(this.vertices(n), b)); },
  star(n, sharp, b){ return this.polyD(this.fitPts(this.vertices(n, 1 - sharp), b)); },
  gcd: (a, b) => b ? Geo.gcd(b, a % b) : a,
  // joins each vertex to the one sharpness + 1 further on; several subpaths when they share a factor
  complexStar(n, sharp, b){
    const step = sharp + 1, v = this.fitPts(this.vertices(n), b), g = this.gcd(n, step); let d = '';
    for (let s = 0; s < g; s++){ let i = s; const run = []; do { run.push(v[i]); i = (i + step) % n; } while (i !== s); d += this.polyD(run); }
    return d;
  },
  spiral(rev, kind, b){
    const N = Math.max(8, Math.round(48 * rev)), pts = [];
    for (let i = 0; i <= N; i++){ const t = i / N, r = kind === 'log' ? (Math.exp(4 * t) - 1) / (Math.exp(4) - 1) : t, a = t * rev * 2 * Math.PI; pts.push({x: r * Math.cos(a), y: r * Math.sin(a)}); }
    return Tools.pathD(this.fitPts(pts, b).filter((_, i) => i % 2 === 0 || i === N), false);
  },
};
const boxTool = (id, def) => Tools.def(id, Object.assign({
  hint: 'Drag to draw · Ctrl keeps it regular · Shift draws from the centre',
  box(st, e){
    let dx = st.b.x - st.a.x, dy = st.b.y - st.a.y;
    if (Tools.ctrl(e)){ const m = Math.max(Math.abs(dx), Math.abs(dy)); dx = Math.sign(dx || 1) * m; dy = Math.sign(dy || 1) * m; }
    const x0 = e && e.shiftKey ? st.a.x - dx : st.a.x, y0 = e && e.shiftKey ? st.a.y - dy : st.a.y, x1 = st.a.x + dx, y1 = st.a.y + dy;
    return {x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1)};
  },
  down(p){ const a = Tools.snap(p); Tools.st = {a, b: a}; drawing = {}; },
  move(p, e){ const st = Tools.st; if (!st) return; st.b = Tools.snap(p); st.e = {ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey}; canvas.requestRenderAll(); },
  up(){
    const st = Tools.st; if (!st) return; Tools.st = null; drawing = null;
    let b = this.box(st, st.e);
    // a click makes one of a default size
    if (b.x1 - b.x0 < 0.5 && b.y1 - b.y0 < 0.5) b = {x0: st.a.x, y0: st.a.y, x1: st.a.x + 80, y1: st.a.y + 80};
    else { if (b.x1 - b.x0 < 0.5) b.x1 = b.x0 + 0.5; if (b.y1 - b.y0 < 0.5) b.y1 = b.y0 + 0.5; }
    const o = this.build(b); canvas.add(o); Tools.finish(o);
  },
  draw(ctx){
    const st = Tools.st; if (!st) return; const b = this.box(st, st.e);
    if (b.x1 - b.x0 < 0.5 || b.y1 - b.y0 < 0.5) return;
    ctx.save(); Tools.drawObject(ctx, this.build(b)); ctx.restore();
    Tools.blue(ctx, c => Tools.poly(c, [{x: b.x0, y: b.y0}, {x: b.x1, y: b.y0}, {x: b.x1, y: b.y1}, {x: b.x0, y: b.y1}, {x: b.x0, y: b.y0}]));
  },
}, def));
boxTool('rect', {name: 'Rectangle', tip: 'Draw squares and rectangles by dragging', opts: {radius: 0},
  bar(){ return [{type: 'num', key: 'radius', label: 'Corners', scale: PX_PER_IN, min: 0, step: 0.05, title: 'Corner radius (in)'}]; },
  build(b){ const r = Tools.opts.rect.radius; return new fabric.Rect(Object.assign(Tools.shapeStyle(), {left: b.x0, top: b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0, rx: r, ry: r, name: 'Rectangle'})); }});
boxTool('ellipse', {name: 'Ellipse', tip: 'Draw circles and ellipses by dragging',
  build(b){ return new fabric.Ellipse(Object.assign(Tools.shapeStyle(), {left: b.x0, top: b.y0, rx: (b.x1 - b.x0) / 2, ry: (b.y1 - b.y0) / 2, name: 'Ellipse'})); }});
const pathShape = (d, name, extra) => new fabric.Path(d, Object.assign(Tools.shapeStyle(), {name, fillRule: 'evenodd'}, extra || {}));
boxTool('polygon', {name: 'Polygon', tip: 'Draw polygons by dragging', opts: {points: 5},
  bar(){ return [{type: 'num', key: 'points', label: 'Points', min: 3, max: 500, digits: 0}]; },
  build(b){ return pathShape(Geo.polygon(Math.round(Tools.opts.polygon.points), b), 'Polygon'); }});
boxTool('star', {name: 'Star', tip: 'Draw uniform, outlined stars', opts: {points: 5, sharp: 50},
  bar(){ return [{type: 'num', key: 'points', label: 'Points', min: 3, max: 500, digits: 0}, {type: 'num', key: 'sharp', label: 'Sharpness', min: 1, max: 99, digits: 0, title: 'Sharpness %'}]; },
  build(b){ const o = Tools.opts.star; return pathShape(Geo.star(Math.round(o.points), o.sharp / 100, b), 'Star'); }});
boxTool('cstar', {name: 'Complex Star', tip: 'Draw stars that have intersecting sides', opts: {points: 9, sharp: 2},
  bar(){ return [{type: 'num', key: 'points', label: 'Points', min: 5, max: 500, digits: 0}, {type: 'num', key: 'sharp', label: 'Sharpness', min: 1, digits: 0, title: 'How many vertices each side skips'}]; },
  build(b){ const o = Tools.opts.cstar, n = Math.round(o.points), s = Math.max(1, Math.min(Math.round(o.sharp), Math.max(1, Math.floor((n - 1) / 2) - 1))); return pathShape(Geo.complexStar(n, s, b), 'Complex star'); }});
boxTool('graph', {name: 'Graph Paper', tip: 'Draw a grid', opts: {rows: 4, cols: 3},
  bar(){ return [{type: 'num', key: 'rows', label: 'Rows', min: 1, max: 200, digits: 0}, {type: 'num', key: 'cols', label: 'Columns', min: 1, max: 200, digits: 0}]; },
  build(b){
    const o = Tools.opts.graph, R = Math.round(o.rows), C = Math.round(o.cols), w = (b.x1 - b.x0) / C, h = (b.y1 - b.y0) / R, cells = [], st = {fill: defFill || '', stroke: defStroke || '#111111', strokeWidth: 0.5, strokeUniform: true};
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) cells.push(new fabric.Rect(Object.assign({}, st, {left: b.x0 + c * w, top: b.y0 + r * h, width: w, height: h, objectCaching: false})));
    return new fabric.Group(cells, {name: 'Graph paper'});
  }});
boxTool('spiral', {name: 'Spiral', tip: 'Draw symmetrical and logarithmic spirals', opts: {rev: 4, kind: 'sym'},
  bar(){ return [{type: 'seg', key: 'kind', options: [['sym', 'Symmetric'], ['log', 'Logarithmic']]}, {type: 'num', key: 'rev', label: 'Revolutions', min: 1, max: 100, digits: 0}]; },
  build(b){ const o = Tools.opts.spiral; return new fabric.Path(Geo.spiral(Math.round(o.rev), o.kind, b), Tools.lineStyle({name: 'Spiral'})); }});

/* ---------- 3-point rectangle and ellipse: a base, then the third point ---------- */
const threePoint = (id, name, tip, make) => Tools.def(id, {
  name, tip, hint(){ return Tools.st && Tools.st.step === 2 ? 'Move to set the size, then click' : 'Drag the base line · Ctrl keeps it to 15° steps'; },
  make,
  down(p){ const st = Tools.st; if (st && st.step === 2){ st.place = true; st.c = Tools.snap(p); return; } Tools.st = {step: 1, a: Tools.snap(p), b: null, dragging: true}; drawing = {}; },
  move(p, e){ const st = Tools.st; if (!st) return; if (st.step === 1) st.b = Tools.constrain(st.a, Tools.snap(p), e); else st.c = Tools.snap(p); canvas.requestRenderAll(); },
  up(p){
    const st = Tools.st; if (!st) return;
    if (st.step === 1){ st.dragging = false; if (st.b && !Tools.near(st.a, st.b, 3 / zoom)){ st.step = 2; st.c = p; Tools.bar(); } return; }
    if (st.place){ Tools.st = null; drawing = null; const o = this.make(st.a, st.b, st.c); canvas.add(o); Tools.finish(o); }
  },
  key(e){ if (e.key === 'Escape' && Tools.st){ Tools.st = null; drawing = null; canvas.requestRenderAll(); return true; } return false; },
  draw(ctx){
    const st = Tools.st; if (!st || !st.b) return;
    Tools.hair(ctx, c => Tools.poly(c, [st.a, st.b]));
    if (st.step === 2){ Tools.drawObject(ctx, this.make(st.a, st.b, st.c)); }
  },
});
threePoint('rect3', '3-Point Rectangle', 'Draw rectangles at an angle', (a, b, c) => {
  const L = Math.hypot(b.x - a.x, b.y - a.y) || 1, u = {x: (b.x - a.x) / L, y: (b.y - a.y) / L}, n = {x: -u.y, y: u.x}, h = (c.x - a.x) * n.x + (c.y - a.y) * n.y;
  const o = new fabric.Rect(Object.assign(Tools.shapeStyle(), {width: L, height: Math.max(0.5, Math.abs(h)), angle: Math.atan2(u.y, u.x) * 180 / Math.PI, name: '3-point rectangle'}));
  return placeCenter(o, (a.x + b.x) / 2 + n.x * h / 2, (a.y + b.y) / 2 + n.y * h / 2);
});
threePoint('ellipse3', '3-Point Ellipse', 'Draw ellipses at an angle', (a, b, c) => {
  const L = Math.hypot(b.x - a.x, b.y - a.y) || 1, u = {x: (b.x - a.x) / L, y: (b.y - a.y) / L}, n = {x: -u.y, y: u.x}, h = Math.abs((c.x - a.x) * n.x + (c.y - a.y) * n.y);
  const o = new fabric.Ellipse(Object.assign(Tools.shapeStyle(), {rx: L / 2, ry: Math.max(0.5, h), angle: Math.atan2(u.y, u.x) * 180 / Math.PI, name: '3-point ellipse'}));
  return placeCenter(o, (a.x + b.x) / 2, (a.y + b.y) / 2);
});

/* ---------- Perfect (common) shapes: 71 shapes in five sets, in a 100 × 100 box ---------- */
const circ = (cx, cy, rx, ry, rev) => `M${cx} ${cy - ry}A${rx} ${ry} 0 1 ${rev ? 0 : 1} ${cx - 0.01} ${cy - ry}Z`;
const PerfectShapes = {
  basic: {
    Parallelogram: 'M25 15H100L75 85H0Z', Trapezoid: 'M25 15H75L100 85H0Z', Diamond: 'M50 0L100 50L50 100L0 50Z', Triangle: 'M50 5L100 95H0Z', 'Right triangle': 'M0 5L100 95H0Z',
    Hexagon: 'M25 5H75L100 50L75 95H25L0 50Z', Octagon: 'M30 0H70L100 30V70L70 100H30L0 70V30Z', Plus: 'M35 0H65V35H100V65H65V100H35V65H0V35H35Z',
    Heart: Artistic.SPRAY.heart, Lightning: 'M58 0L18 55H45L30 100L82 38H54L72 0Z', Crescent: 'M70 2A48 48 0 1 0 70 98A38 38 0 1 1 70 2Z', Ring: circ(50, 50, 50, 50) + circ(50, 50, 26, 26, true),
    Cylinder: 'M0 15A50 15 0 0 1 100 15A50 15 0 0 1 0 15ZM0 15A50 15 0 0 0 100 15V85A50 15 0 0 1 0 85Z', Cube: 'M0 25H75V100H0ZM0 25L25 0H100L75 25ZM75 25L100 0V75L75 100Z', Frame: 'M0 0H100V100H0ZM15 15V85H85V15Z',
    Teardrop: 'M50 0C55 25 85 40 85 65A35 35 0 0 1 15 65C15 40 45 25 50 0Z', 'Smiley face': circ(50, 50, 50, 50) + circ(34, 36, 6, 8, true) + circ(66, 36, 6, 8, true) + 'M26 60C34 82 66 82 74 60C60 68 40 68 26 60Z',
    'No symbol': circ(50, 50, 50, 50) + 'M50 16A34 34 0 0 0 26 74L74 26A34 34 0 0 0 50 16ZM50 84A34 34 0 0 0 74 26L26 74A34 34 0 0 0 50 84Z',
  },
  arrow: {
    Right: 'M0 30H60V5L100 50L60 95V70H0Z', Left: 'M100 30H40V5L0 50L40 95V70H100Z', Up: 'M30 100V40H5L50 0L95 40H70V100Z', Down: 'M30 0V60H5L50 100L95 60H70V0Z',
    'Left and right': 'M0 50L25 15V35H75V15L100 50L75 85V65H25V85Z', 'Up and down': 'M50 0L85 25H65V75H85L50 100L15 75H35V25H15Z',
    'Four-way': 'M50 0L70 20H58V42H80V30L100 50L80 70V58H58V80H70L50 100L30 80H42V58H20V70L0 50L20 30V42H42V20H30Z', Chevron: 'M0 5H70L100 50L70 95H0L30 50Z', 'Pentagon arrow': 'M0 10H70L100 50L70 90H0Z',
    Notched: 'M0 30H60V5L100 50L60 95V70H0L15 50Z', Striped: 'M0 30H8V70H0ZM14 30H22V70H14ZM28 30H60V5L100 50L60 95V70H28Z', Bent: 'M0 100V45A25 25 0 0 1 25 20H70V0L100 30L70 60V40H25A5 5 0 0 0 20 45V100Z',
  },
  flow: {
    Process: 'M0 0H100V100H0Z', 'Alternate process': 'M10 0H90A10 10 0 0 1 100 10V90A10 10 0 0 1 90 100H10A10 10 0 0 1 0 90V10A10 10 0 0 1 10 0Z', Decision: 'M50 0L100 50L50 100L0 50Z', Data: 'M20 0H100L80 100H0Z',
    'Predefined process': 'M0 0H100V100H0ZM12 0V100M88 0V100', 'Internal storage': 'M0 0H100V100H0ZM12 0V100M0 12H100', Document: 'M0 0H100V80C75 65 50 100 25 90C15 86 8 82 0 80Z',
    'Multiple documents': 'M16 0H100V70L92 66V8H16ZM8 8H92V78L84 74V16H8ZM0 16H84V84C64 72 42 100 20 92C12 88 6 86 0 84Z', Terminator: 'M20 20H80A20 30 0 0 1 80 80H20A20 30 0 0 1 20 20Z', Preparation: 'M20 10H80L100 50L80 90H20L0 50Z',
    'Manual input': 'M0 25L100 5V95H0Z', 'Manual operation': 'M0 5H100L80 95H20Z', Connector: circ(50, 50, 50, 50), 'Off-page connector': 'M0 0H100V70L50 100L0 70Z', Card: 'M20 0H100V100H0V20Z',
    'Punched tape': 'M0 15C15 0 35 0 50 15C65 30 85 30 100 15V85C85 70 65 70 50 85C35 100 15 100 0 85Z', 'Summing junction': circ(50, 50, 50, 50) + 'M15 15L85 85M85 15L15 85', Or: circ(50, 50, 50, 50) + 'M50 0V100M0 50H100',
    Collate: 'M0 0H100L50 50ZM50 50L100 100H0Z', Sort: 'M50 0L100 50L50 100L0 50ZM0 50H100', Extract: 'M50 5L100 95H0Z', Merge: 'M0 5H100L50 95Z', 'Stored data': 'M15 5H100C85 25 85 75 100 95H15C0 75 0 25 15 5Z', Delay: 'M0 5H55A45 45 0 0 1 55 95H0Z',
    'Magnetic disk': 'M0 15A50 15 0 0 1 100 15A50 15 0 0 1 0 15ZM0 15A50 15 0 0 0 100 15V85A50 15 0 0 1 0 85Z', 'Direct access storage': 'M15 10H85A15 40 0 0 1 85 90H15A15 40 0 0 1 15 10ZM85 10A15 40 0 0 0 85 90', Display: 'M20 10H85A15 40 0 0 1 85 90H20L0 50Z',
  },
  banner: {
    Ribbon: 'M20 15H80V70H20ZM20 30H0L10 55L0 85H35V70H20ZM80 30H100L90 55L100 85H65V70H80Z', 'Folded ribbon': 'M15 10H85V65H15ZM15 65L30 80V65ZM85 65L70 80V65ZM15 30H0L8 52L0 80H30V65H15ZM85 30H100L92 52L100 80H70V65H85Z',
    Wave: 'M0 20C25 0 25 40 50 20C75 0 75 40 100 20V80C75 100 75 60 50 80C25 100 25 60 0 80Z', 'Double wave': 'M0 25C12 8 25 8 37 25C50 42 62 42 75 25C83 15 92 12 100 15V75C92 72 83 75 75 85C62 102 50 102 37 85C25 68 12 68 0 85Z',
    Scroll: 'M15 15H85A10 10 0 0 1 95 25V85A10 10 0 0 1 85 95H15A10 10 0 0 1 5 85V25A10 10 0 0 1 15 15ZM15 15A10 10 0 0 0 15 35H25V25A10 10 0 0 0 15 15Z',
    Explosion: 'M50 0L60 22L82 8L76 32L100 34L82 50L100 70L74 68L78 94L58 78L46 100L38 76L14 88L22 64L0 58L20 44L4 22L28 28L30 6Z', Burst: Geo.polyD(Geo.fitPts(Geo.vertices(16, 0.72), {x0: 0, y0: 0, x1: 100, y1: 100})), Pennant: 'M0 10L100 50L0 90Z',
  },
  callout: {
    Rectangle: 'M0 0H100V70H45L25 100L30 70H0Z', Rounded: 'M12 0H88A12 12 0 0 1 100 12V58A12 12 0 0 1 88 70H45L25 100L30 70H12A12 12 0 0 1 0 58V12A12 12 0 0 1 12 0Z',
    Oval: 'M50 0A50 35 0 1 1 42 69L22 100L25 64A50 35 0 0 1 50 0Z', Cloud: 'M25 15A16 16 0 0 1 52 8A18 18 0 0 1 82 16A16 16 0 0 1 92 46A15 15 0 0 1 72 62A18 18 0 0 1 42 64A16 16 0 0 1 14 56A16 16 0 0 1 8 28A14 14 0 0 1 25 15Z' + circ(22, 78, 7, 6) + circ(10, 92, 4, 4),
    'Line callout': 'M0 0H100V70H0ZM30 70L10 100', 'Bent line callout': 'M0 0H100V70H0ZM30 70V85L10 100',
  },
  _bbox: {},
  // d (in its own 100-box units) fitted so its bounds fill the box
  fit(d, x0, y0, x1, y1){
    let c = this._bbox[d];
    if (!c){ const t = new fabric.Path(d, {strokeWidth: 0}); c = this._bbox[d] = {cmds: t.path, w: t.width || 1, h: t.height || 1, x: t.pathOffset.x - t.width / 2, y: t.pathOffset.y - t.height / 2}; }
    const sx = (x1 - x0) / c.w, sy = (y1 - y0) / c.h;
    return c.cmds.map(k => { const o = [k[0]]; for (let i = 1; i + 1 < k.length; i += 2) o.push(+(x0 + (k[i] - c.x) * sx).toFixed(3), +(y0 + (k[i + 1] - c.y) * sy).toFixed(3)); return o; });
  },
  svg: d => `<svg viewBox="-6 -6 112 112" width="22" height="22"><path d="${d}" fill="currentColor" fill-opacity=".35" fill-rule="evenodd" stroke="currentColor" stroke-width="5"/></svg>`,
};
[['basic', 'Basic Shapes', 'Draw triangles, circles, cylinders, hearts and other shapes', 'Heart'], ['arrow', 'Arrow Shapes', 'Draw arrows of various shape and direction', 'Right'], ['flow', 'Flowchart Shapes', 'Draw flowchart symbols', 'Process'], ['banner', 'Banner Shapes', 'Draw ribbon objects and explosion shapes', 'Ribbon'], ['callout', 'Callout Shapes', 'Draw labels and speech bubbles', 'Rounded']].forEach(([id, name, tip, first]) => boxTool(id, {
  name, tip, opts: {shape: first},
  bar(){ return [{type: 'shapes', set: id, key: 'shape'}]; },
  build(b){
    const n = Tools.opts[id].shape;
    return new fabric.Path(PerfectShapes.fit(PerfectShapes[id][n], b.x0, b.y0, b.x1, b.y1), Object.assign(Tools.shapeStyle({stroke: defStroke || '#111111', strokeWidth: defStroke ? DEF_STROKE : LINE_W / 2}), {name: n + (id === 'arrow' ? ' arrow' : ''), fillRule: 'evenodd'}));
  },
}));

/* ---------- Zoom and Pan ---------- */
Tools.def('zoom', {
  name: 'Zoom', tip: 'Change the magnification level of the document window', hint: 'Click to zoom in · Alt-click out · drag a box to zoom to it',
  bar(){ return [{type: 'btn', label: 'In', on: () => run('zin')}, {type: 'btn', label: 'Out', on: () => run('zout')}, {type: 'btn', label: '100%', on: () => setZoom(1)}, {type: 'btn', label: 'Fit', on: () => run('fit')}]; },
  start(){ canvas.defaultCursor = 'zoom-in'; },
  down(p, e){ Tools.st = {a: canvas.getPointer(e, true), b: canvas.getPointer(e, true), alt: e.altKey}; },
  move(p, e){ const st = Tools.st; if (st){ st.b = canvas.getPointer(e, true); canvas.requestRenderAll(); } },
  up(){
    const st = Tools.st; if (!st) return; Tools.st = null;
    const w = Math.abs(st.b.x - st.a.x), h = Math.abs(st.b.y - st.a.y), s = $('stage');
    if (w < 6 && h < 6){ setZoom(zoom * (st.alt ? 0.8 : 1.25), st.a.x, st.a.y); return; }
    const k = Math.min(s.clientWidth / w, s.clientHeight / h), cx = (st.a.x + st.b.x) / 2, cy = (st.a.y + st.b.y) / 2;
    const qx = (cx - paL) / zoom, qy = (cy - paT) / zoom;
    autoFit = false; zoom = Math.max(0.3, Math.min(6, zoom * k)); paL = s.clientWidth / 2 - qx * zoom; paT = s.clientHeight / 2 - qy * zoom; layout();
  },
  draw(ctx){ const st = Tools.st; if (!st) return; ctx.setLineDash([4, 3]); ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 1; ctx.strokeRect(st.a.x, st.a.y, st.b.x - st.a.x, st.b.y - st.a.y); ctx.setLineDash([]); },
});
Tools.def('pan', {
  name: 'Pan', tip: 'Drag hidden areas of a drawing into view without changing the zoom level', hint: 'Drag to move the view',
  start(){ canvas.defaultCursor = 'grab'; },
  bar(){ return [{type: 'btn', label: 'Fit', on: () => run('fit')}]; },
  down(p, e){ Tools.st = canvas.getPointer(e, true); canvas.setCursor('grabbing'); },
  move(p, e){ const st = Tools.st; if (!st) return; const c = canvas.getPointer(e, true); autoFit = false; panBy(c.x - st.x, c.y - st.y); Tools.st = c; },
  up(){ Tools.st = null; canvas.setCursor('grab'); },
});

/* ===================== the toolbox: one button per flyout ===================== */
const I = (d, extra) => `<svg viewBox="0 0 24 24"><path d="${d}"${extra || ''}/></svg>`;
const TOOL_ICONS = {
  pick: I('M5 3l14 8-6 2-2 6z'), shape: I('M5 3l14 8-6 2-2 6z', ' fill="currentColor" stroke="none"'), smudge: I('M4 18c4 0 5-3 8-3s4 3 8 3M9 12c0-4 2-8 3-9 1 1 3 5 3 9a3 3 0 0 1-6 0z'), roughen: I('M3 15l2-4 2 5 2-6 2 6 2-5 2 5 2-6 2 4M3 20h18'),
  freetransform: I('M12 3v3M12 18v3M3 12h3M18 12h3M7 7a7 7 0 0 1 10 0M17 17a7 7 0 0 1-10 0M17 4v3h-3M7 20v-3h3'), crop: I('M6 2v16h16M2 6h16v16'), knife: I('M3 21L14 10l3 3L8 21zM14 10l6-7 1 1-4 9'), eraser: I('M8 20l-5-5L14 4l7 7-9 9zM3 20h18M9 9l6 6'), vsegdel: I('M3 18L21 6M9 4v16M5 5l4 4M9 5L5 9', ' stroke-dasharray="none"'),
  zoom: I('M10 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM20 20l-5.5-5.5'), pan: I('M8 12V6a1.5 1.5 0 0 1 3 0v5-7a1.5 1.5 0 0 1 3 0v7-5a1.5 1.5 0 0 1 3 0v8c0 4-2 7-6 7-3 0-4-1-6-4l-2-4c-.5-1 1-2 2-1z'),
  free: I('M3 17c3-6 5-10 8-10s2 8 5 8 3-4 5-6'), line: I('M4 20L20 4M2.5 20h3M20 2.5v3'), bezier: I('M4 18C8 6 16 6 20 18M4 18l4-10M20 18l-4-10'), brush: I('M4 20c4-1 6-4 8-8s5-7 8-8c-1 3-4 6-8 8s-7 4-8 8z'), pen: I('M12 3L5 10l3 9h8l3-9zM12 12v-9'), bspline: I('M3 18C8 3 16 21 21 6M3 18l5-13 8 16 5-15', ' stroke-width="1.2"'), polyline: I('M3 18l5-9 5 6 3-9 5 8'), curve3: I('M4 18C8 5 16 5 20 18M12 8v-3'),
  smartfill: I('M6 11l6-6 7 7-6 6zM19 15s2 2.5 2 4a2 2 0 0 1-4 0c0-1.5 2-4 2-4z'), smartdraw: I('M4 17c2-5 6-3 8-7 1-2 3-5 7-5M15 14h6v6h-6z'),
  rect: I('M4 6h16v12H4z'), rect3: I('M3 13L13 3l8 8-10 10z'), ellipse: I('M12 6a8 6 0 1 0 0 12 8 6 0 0 0 0-12z'), ellipse3: I('M5 19c-3-3 0-9 5-12s10-3 11-1-1 8-6 11-9 4-10 2z'),
  polygon: I('M12 3l9 7-3 11H6L3 10z'), star: I('M12 3l2.6 5.6 6.1.6-4.6 4.1 1.3 6L12 16.4l-5.4 2.9 1.3-6-4.6-4.1 6.1-.6z'), cstar: I('M12 2L18 21 3 9h18L6 21z'), graph: I('M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18'), spiral: I('M12 12a2 2 0 0 1 3 2 4 4 0 0 1-6 1 6 6 0 0 1 1-9 8 8 0 0 1 11 5'),
  basic: I('M4 20l8-15 8 15z'), arrow: I('M3 9h11V4l7 8-7 8v-5H3z'), flow: I('M12 3l7 7-7 7-7-7zM12 17v4'), banner: I('M6 7h12v9H6zM6 10H2l2 3-2 3h7M18 10h4l-2 3 2 3h-7'), callout: I('M3 4h18v12H10l-5 5 1-5H3z'),
  text: I('M5 5h14M12 5v14M9 19h6'), table: I('M3 5h18v14H3zM3 10h18M3 15h18M9 5v14M15 5v14'),
  dimpar: I('M4 16L16 4M3 12l9 9M12 3l9 9M7 19L19 7'), dimhv: I('M4 6v12M20 6v12M4 12h16M7 9l-3 3 3 3M17 9l3 3-3 3'), dimang: I('M4 20L20 20M4 20L14 6M16 20a12 12 0 0 0-5-9'), dimseg: I('M3 16C8 7 14 7 19 16M3 6h16M3 3v6M19 3v6'), callout3: I('M3 20l6-6h4M13 8h8v6h-8z'),
  fxshadow: `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="12" height="12"/><path d="M15 7h5v13H7v-5" fill="currentColor" opacity=".35" stroke="none"/></svg>`, fxcontour: `<svg viewBox="0 0 24 24"><rect x="9" y="9" width="6" height="6"/><rect x="6" y="6" width="12" height="12" opacity=".7"/><rect x="3" y="3" width="18" height="18" opacity=".45"/></svg>`,
  fxenvelope: I('M4 7c5-4 11-4 16 0v10c-5 4-11 4-16 0z'), fxdistort: I('M12 3L14 9l6-2-4 5 4 5-6-2-2 6-2-6-6 2 4-5-4-5 6 2z'), fxblend: `<svg viewBox="0 0 24 24"><circle cx="5" cy="17" r="3"/><circle cx="10" cy="13" r="3" opacity=".75"/><circle cx="15" cy="9" r="3" opacity=".55"/><rect x="16" y="2" width="6" height="6" fill="currentColor"/></svg>`, fxtransp: `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18"/><path d="M3 3h18v18z" fill="currentColor" opacity=".4" stroke="none"/></svg>`,
  eyedrop: I('M14 4l6 6-2 2-6-6zM12 8l-8 8v4h4l8-8'), 'cmd:fill': I('M6 11l6-6 7 7-6 6zM19 15s2 2.5 2 4a2 2 0 0 1-4 0c0-1.5 2-4 2-4z'),
};
const Toolbox = {
  // the groups, top to bottom; adv: behind ⋯ on phones
  groups: [
    {tools: ['pick']},
    {tools: ['shape', 'smudge', 'roughen', 'freetransform']},
    {tools: ['crop', 'knife', 'eraser', 'vsegdel'], adv: true},
    {tools: ['zoom', 'pan'], adv: true, sep: true},
    {tools: ['free', 'line', 'bezier', 'pen', 'brush', 'bspline', 'polyline', 'curve3']},
    {tools: ['smartfill', 'smartdraw'], adv: true, sep: true},
    {tools: ['rect', 'rect3']}, {tools: ['ellipse', 'ellipse3']},
    {tools: ['polygon', 'star', 'cstar', 'graph', 'spiral']},
    {tools: ['basic', 'arrow', 'flow', 'banner', 'callout'], sep: true},
    {tools: ['text']}, {tools: ['table'], adv: true},
    {tools: ['dimpar', 'dimhv', 'dimang', 'dimseg', 'callout3'], adv: true, sep: true},
    {tools: ['fxshadow', 'fxcontour', 'fxenvelope', 'fxdistort', 'fxblend', 'fxtransp'], sep: true},
    {tools: ['eyedrop'], adv: true}, {tools: ['cmd:fill'], adv: true},
  ],
  fxNames: {fxshadow: 'Drop Shadow', fxcontour: 'Contour', fxenvelope: 'Envelope', fxdistort: 'Distort', fxblend: 'Blend', fxtransp: 'Transparency', eyedrop: 'Eyedropper', 'cmd:fill': 'Fill & gradient', pick: 'Pick', shape: 'Shape'},
  fxTips: {pick: 'Select, position and transform objects', shape: 'Edit a curve or text by manipulating nodes', fxshadow: 'Drag from an object for a shadow (from an edge: perspective)', fxcontour: 'Drag away from an object (outside) or into it (inside)', fxenvelope: 'Click an object, drag its frame nodes', fxdistort: 'Push & pull, zipper, twister: drag on an object', fxblend: 'Drag from one object to another', fxtransp: 'Uniform, or drag across an object for a gradient', eyedrop: 'Click an object to copy its colours onto the selection', 'cmd:fill': 'Fill and gradient settings'},
  keys: {pick: 'V', shape: 'F10', zoom: 'Z', pan: 'H', free: 'F5', line: 'L', pen: 'P', brush: 'B', rect: 'F6', ellipse: 'F7', polygon: 'Y', star: 'S', graph: 'D', spiral: 'A', text: 'F8', eraser: 'X', knife: 'K', crop: 'C', eyedrop: 'I'},
  name(t){ return this.fxNames[t] || (Tools.defs[t] && Tools.defs[t].name) || t; },
  tip(t){ return this.fxTips[t] || (Tools.defs[t] && Tools.defs[t].tip) || ''; },
  last: {},
  build(){
    const box = $('tools'), end = box.querySelector('.tool.more');
    box.querySelectorAll('.tool:not(.more), hr').forEach(n => n.remove());
    let saved = {}; try { saved = JSON.parse(localStorage.getItem('teestudio.toolbox')) || {}; } catch (e){}
    this.groups.forEach((g, i) => {
      const t = g.tools.includes(saved[i]) ? saved[i] : g.tools[0]; this.last[i] = t;
      const b = document.createElement('button'); b.className = 'tool' + (g.adv ? ' adv' : '') + (g.tools.length > 1 ? ' fly' : ''); b.dataset.group = i;
      this.show(b, t);
      this.wire(b, g, i);
      box.insertBefore(b, end);
      if (g.sep && i < this.groups.length - 1) box.insertBefore(document.createElement('hr'), end);
    });
  },
  show(b, t){ b.dataset.tool = t; b.innerHTML = TOOL_ICONS[t] + (b.classList.contains('fly') ? '<i class="flyarrow"></i>' : '') + `<span class="tip"><b>${this.name(t)}${this.keys[t] ? ' (' + this.keys[t] + ')' : ''}</b><br>${this.tip(t)}</span>`; },
  wire(b, g, i){
    let hold = null, opened = false;
    const startHold = e => { opened = false; if (g.tools.length > 1 && e.pointerType !== 'touch') hold = setTimeout(() => { opened = true; this.open(b, g, i); }, 400); };
    const stopHold = () => clearTimeout(hold);
    b.addEventListener('pointerdown', startHold);
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => b.addEventListener(ev, stopHold));
    b.onclick = e => {
      if (opened){ opened = false; return; }
      e.stopPropagation();
      const r = b.getBoundingClientRect(), z = COARSE ? 18 : 11, onArrow = g.tools.length > 1 && e.clientX > r.right - z && e.clientY > r.bottom - z;
      // the arrow, or a tap on the tool already in use, opens the flyout
      if (onArrow || (g.tools.length > 1 && g.tools.includes(tool) && b.dataset.tool === tool)){ this.flyEl ? this.close() : this.open(b, g, i); return; }
      this.close(); setTool(b.dataset.tool);
    };
    b.addEventListener('mouseenter', () => { const t = b.querySelector('.tip'), r = b.getBoundingClientRect(); if (t){ t.style.left = r.right + 8 + 'px'; t.style.top = r.top + r.height / 2 + 'px'; } });
    b.addEventListener('mouseenter', () => { if (this.flyEl && this.flyGroup !== i && g.tools.length > 1) this.open(b, g, i); });
  },
  open(b, g, i){
    this.close();
    const f = document.createElement('div'); f.className = 'flyout';
    g.tools.forEach(t => {
      const it = document.createElement('button'); it.className = 'flyitem' + (t === tool ? ' on' : '');
      it.innerHTML = TOOL_ICONS[t] + `<span class="fn"></span><kbd>${this.keys[t] || ''}</kbd>`; it.querySelector('.fn').textContent = this.name(t); it.title = this.tip(t);
      it.onclick = e => { e.stopPropagation(); this.close(); setTool(t); };
      f.appendChild(it);
    });
    document.body.appendChild(f); this.flyEl = f; this.flyGroup = i;
    const r = b.getBoundingClientRect(), fr = f.getBoundingClientRect(), bottom = matchMedia('(max-width: 767px)').matches;
    if (bottom){ f.style.left = Math.max(6, Math.min(r.left, innerWidth - fr.width - 6)) + 'px'; f.style.top = Math.max(6, r.top - fr.height - 6) + 'px'; }
    else { f.style.left = r.right + 6 + 'px'; f.style.top = Math.max(6, Math.min(r.top, innerHeight - fr.height - 6)) + 'px'; }
  },
  close(){ if (this.flyEl){ this.flyEl.remove(); this.flyEl = null; this.flyGroup = null; } },
  sync(t){
    this.groups.forEach((g, i) => {
      const b = document.querySelector(`.tool[data-group="${i}"]`); if (!b) return;
      if (g.tools.includes(t)){ this.last[i] = t; if (b.dataset.tool !== t) this.show(b, t); }
      b.classList.toggle('on', g.tools.includes(t));
    });
    try { const m = {}; Object.keys(this.last).forEach(k => m[k] = this.last[k]); localStorage.setItem('teestudio.toolbox', JSON.stringify(m)); } catch (e){}
    if (matchMedia('(max-width: 767px)').matches && t.indexOf(':') < 0){ const a = document.querySelector('.tool.on'); if (a && a.scrollIntoView) a.scrollIntoView({inline: 'center', block: 'nearest'}); }
  },
  // the Tools menu lists every tool by name, grouped as in the toolbox
  menu(){
    const dd = $('toolsMenu');
    this.groups.forEach((g, i) => {
      g.tools.forEach(t => { const b = document.createElement('button'); b.dataset.cmd = t.startsWith('cmd:') ? t.slice(4) : 'tool:' + t; b.title = this.tip(t); b.innerHTML = `<span></span><kbd>${this.keys[t] || ''}</kbd>`; b.querySelector('span').textContent = this.name(t) + ' tool'; dd.appendChild(b); });
      if (g.sep && i < this.groups.length - 1) dd.appendChild(document.createElement('hr'));
    });
  },
};
document.addEventListener('pointerdown', e => {
  if (Toolbox.flyEl && !e.target.closest('.flyout') && !e.target.closest('.tool.fly')) Toolbox.close();
  if (Tools.popup && !e.target.closest('.shapegrid-pop')) Tools.closePopup();
});
canvas.on('after:render', e => { if (e && e.ctx === canvas.contextContainer && Tools.active()) Tools.draw(e.ctx); });
