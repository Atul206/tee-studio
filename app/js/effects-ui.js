/* ===================== effect tools: Drop Shadow, Contour, Envelope, Distort =====================
   Each tool works on one object at a time (the target), with its controls on the property bar and its
   handles drawn over the canvas. Values are TraceDraw's; distances show in inches like the rest of the app. */

const FX_TOOLS = {fxshadow: 'shadow', fxcontour: 'contour', fxenvelope: 'envelope', fxdistort: 'distort', fxblend: 'blend', fxtransp: 'transp'};
const FxTool = {
  target: null, idx: -1, drag: null, envMode: 'unconstrained', envSel: -1,
  kind(){ return FX_TOOLS[tool]; },
  active(){ return !!FX_TOOLS[tool]; },
  M(o){ return o.calcTransformMatrix(); },
  toScene(o, p){ return Effects.pt(this.M(o), p.x, p.y); },
  toLocal(o, p){ return Effects.pt(Effects.inv(this.M(o)), p.x, p.y); },
  px: d => d * zoom,

  start(){
    const a = canvas.getActiveObject(); this.lastSel = actives().slice(); this.tSel = -1;
    this.target = a && a.type !== 'activeSelection' ? a : null; this.idx = this.target ? canvas.getObjects().indexOf(this.target) : -1;
    this.envSel = -1; canvas.discardActiveObject(); this.bar(); canvas.requestRenderAll();
  },
  stop(){ const t = this.target; this.target = null; this.drag = null; if (t && canvas.getObjects().includes(t)) canvas.setActiveObject(t); canvas.requestRenderAll(); this.bar(); },
  reattach(){ if (!this.active()) return; const o = canvas.getObjects()[this.idx]; this.target = o || null; this.bar(); },
  setTarget(o){ this.target = o; this.idx = o ? canvas.getObjects().indexOf(o) : -1; this.envSel = -1; this.bar(); canvas.requestRenderAll(); },
  commit(){ if (this.target){ this.target.__fx = null; } canvas.requestRenderAll(); snapshot(); refresh(); this.bar(); },
  set(values, replace){ if (!this.target) return toast('Click an object first'); Effects.set([this.target], this.kind(), values, replace); },

  /* ---------- handles ---------- */
  shadowHandles(o){
    const s = o.fx && o.fx.shadow; if (!s) return null;
    const b = Effects.drawnBounds(o);
    let A, E;
    if (!s.kind || s.kind === 'flat'){ A = this.toScene(o, {x: b.cx, y: b.cy}); E = {x: A.x + s.dx, y: A.y + s.dy}; }
    else { const e = Effects.edge(b, s); A = this.toScene(o, e.A); E = this.toScene(o, e.E); }
    const t = (s.opacity != null ? s.opacity : 50) / 100;
    return {A, E, bar: {x: A.x + (E.x - A.x) * t, y: A.y + (E.y - A.y) * t}};
  },
  envNodes(o){ const e = o.fx && o.fx.envelope; return e ? e.nodes.map(n => this.toScene(o, n)) : []; },
  distortCentre(o){ const d = o.fx && o.fx.distort; if (!d) return null; const fx = Effects.compute(o), box = (fx && fx.box0) || Effects.drawnBounds(o); return this.toScene(o, {x: d.cx != null ? d.cx : box.cx, y: d.cy != null ? d.cy : box.cy}); },
  near(p, q, r = 7){ return q && Math.hypot(p.x - q.x, p.y - q.y) * zoom <= r; },

  /* ---------- pointer ---------- */
  down(o){
    const e = o.e, p = canvas.getPointer(e), k = this.kind(), t = this.target;
    if (o.button === 3) return;
    // handles of the current target first
    if (t){
      if (k === 'shadow'){ const h = this.shadowHandles(t); if (h){ if (this.near(p, h.E)) return this.drag = {kind: 'sEnd'}; if (this.near(p, h.bar)) return this.drag = {kind: 'sBar', h}; if (this.near(p, h.A)) return this.drag = {kind: 'sStart', h}; } }
      if (k === 'distort'){ const c = this.distortCentre(t); if (this.near(p, c)) return this.drag = {kind: 'dCentre'}; }
      if (k === 'envelope' && t.fx && t.fx.envelope){
        const nodes = this.envNodes(t), env = t.fx.envelope;
        if (this.envMode === 'unconstrained' && this.envSel >= 0){
          const n = env.nodes[this.envSel];
          for (const w of ['in', 'out']) if (n[w] && this.near(p, this.toScene(t, n[w]))) return this.drag = {kind: 'eHandle', i: this.envSel, w};
        }
        const i = nodes.findIndex(q => this.near(p, q));
        if (i >= 0){ this.envSel = i; this.drag = {kind: 'eNode', i, start: p, orig: JSON.parse(JSON.stringify(env.nodes))}; canvas.requestRenderAll(); return; }
      }
    }
    if (k === 'transp' && t && t.fx && t.fx.transp && t.fx.transp.type === 'gradient'){
      const T = t.fx.transp, a = this.toScene(t, {x: T.x1, y: T.y1}), b = this.toScene(t, {x: T.x2, y: T.y2});
      if (this.near(p, a)) return this.drag = {kind: 'tA'};
      if (this.near(p, b)) return this.drag = {kind: 'tB'};
      const i = T.stops.findIndex(s => this.near(p, Effects.lerp(a, b, s.offset)));
      if (i >= 0){ this.tSel = i; this.bar(); canvas.requestRenderAll(); return this.drag = {kind: 'tStop', i}; }
    }
    if (this.pickPath){
      const pth = Pick.under(e).find(x => x !== t);
      this.pickPath = false; canvas.defaultCursor = 'crosshair';
      if (pth && t && t.fx && t.fx.blend){ this.set({path: uidOf(pth)}); this.commit(); toast('The blend follows that path'); }
      return;
    }
    const under = Pick.under(e)[0];
    if (!under){ this.setTarget(null); return; }
    if (under !== t) this.setTarget(under);
    if (k === 'envelope'){
      if (!Effects.canShape(under)) return toast('Envelopes work on shapes, curves and text — not on groups or images');
      if (!under.fx || !under.fx.envelope){ this.addEnvelope(under); this.commit(); toast('Envelope added — drag its nodes'); }
      return;
    }
    if (k === 'blend'){ this.drag = {kind: 'bMake', start: p, cur: p, from: under}; return; }
    if ((k === 'contour' || k === 'distort') && !Effects.canShape(under)) return toast(`${k === 'contour' ? 'Contour' : 'Distort'} works on shapes, curves and text — not on groups or images`);
    // a drag on the object makes the effect
    const local = this.toLocal(under, p), b = Effects.drawnBounds(under);
    this.drag = {kind: 'make', start: p, local, b, centre: this.toScene(under, {x: b.cx, y: b.cy}), turns: 0, lastA: null, moved: false};
  },
  move(o){
    const d = this.drag, t = this.target; if (!d || !t) return;
    const e = o.e, p = canvas.getPointer(e), k = this.kind();
    if (d.kind === 'bMake'){ d.cur = p; d.moved = true; canvas.requestRenderAll(); return; }
    if (d.kind === 'tA' || d.kind === 'tB'){ const l = this.toLocal(t, p); if (d.kind === 'tA') this.set({x1: l.x, y1: l.y}); else this.set({x2: l.x, y2: l.y}); return; }
    if (d.kind === 'tStop'){
      const T = t.fx.transp, a = this.toScene(t, {x: T.x1, y: T.y1}), b = this.toScene(t, {x: T.x2, y: T.y2}), vx = b.x - a.x, vy = b.y - a.y;
      const off = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / (vx * vx + vy * vy || 1)));
      const stops = T.stops.map(s => Object.assign({}, s)); stops[d.i].offset = off; this.set({stops}); return;
    }
    if (d.kind === 'make'){
      if (Math.hypot(p.x - d.start.x, p.y - d.start.y) * zoom < 3 && !d.moved) return;
      d.moved = true;
      const dx = p.x - d.start.x, dy = p.y - d.start.y;
      if (k === 'transp'){
        const a = this.toLocal(t, d.start), b = this.toLocal(t, p), cur = t.fx && t.fx.transp && t.fx.transp.type === 'gradient' ? t.fx.transp : Transp.defaultGrad(t);
        this.set(Object.assign({}, cur, {type: 'gradient', x1: a.x, y1: a.y, x2: b.x, y2: b.y}), true);
      } else if (k === 'shadow'){
        const {b, local} = d, f = 0.2;
        const kind = Math.abs(local.y - b.y1) < b.h * f ? 'bottom' : Math.abs(local.y - b.y0) < b.h * f ? 'top' : Math.abs(local.x - b.x0) < b.w * f ? 'left' : Math.abs(local.x - b.x1) < b.w * f ? 'right' : 'flat';
        if (kind === 'flat') this.set({kind, dx, dy});
        else { this.set({kind}); this.endTo(t, p); }
      } else if (k === 'contour'){
        const c = t.fx && t.fx.contour || Effects.defaults.contour, dist = Math.hypot(dx, dy);
        const away = Math.hypot(p.x - d.centre.x, p.y - d.centre.y) > Math.hypot(d.start.x - d.centre.x, d.start.y - d.centre.y);
        const mode = c.mode === 'center' ? 'center' : away ? 'outside' : 'inside';
        this.set({mode, offset: Math.max(0.05, dist / (mode === 'center' ? 1 : c.steps))});
      } else if (k === 'distort'){
        const base = Object.assign({}, Effects.defaults.distort, t.fx && t.fx.distort, {cx: d.local.x, cy: d.local.y});
        const r = Math.max(t.getScaledWidth(), t.getScaledHeight()) / 2 || 1;   // half the object's own larger side
        if (base.kind === 'push') base.amount = Math.max(-200, Math.min(200, Math.round(100 * dx / r)));
        if (base.kind === 'zipper') base.amp = Math.hypot(dx, dy) / 4;
        if (base.kind === 'twister'){
          const a = Math.atan2(p.y - d.start.y, p.x - d.start.x);
          if (d.lastA != null){ let da = a - d.lastA; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI; d.turns += da; }
          d.lastA = a; base.angle = Math.round(fabric.util.radiansToDegrees(d.turns));
        }
        this.set(base, true);
      }
      this.bar();
    } else if (d.kind === 'sEnd') this.endTo(t, p);
    else if (d.kind === 'sBar'){
      const h = this.shadowHandles(t), vx = h.E.x - h.A.x, vy = h.E.y - h.A.y, l2 = vx * vx + vy * vy || 1;
      this.set({opacity: Math.max(0, Math.min(100, Math.round(((p.x - h.A.x) * vx + (p.y - h.A.y) * vy) / l2 * 100)))}); this.bar();
    } else if (d.kind === 'sStart'){
      // drag the start to another edge (perspective) or the middle (flat); the end stays where it was
      const b = Effects.drawnBounds(t), endScene = d.h.E;
      const cands = {flat: {x: b.cx, y: b.cy}, bottom: {x: b.cx, y: b.y1}, top: {x: b.cx, y: b.y0}, left: {x: b.x0, y: b.cy}, right: {x: b.x1, y: b.cy}};
      let best = 'flat', bd = Infinity;
      Object.entries(cands).forEach(([kk, q]) => { const s = this.toScene(t, q), dd = Math.hypot(s.x - p.x, s.y - p.y); if (dd < bd){ bd = dd; best = kk; } });
      if (best === 'flat'){ const A = this.toScene(t, cands.flat); this.set({kind: 'flat', dx: endScene.x - A.x, dy: endScene.y - A.y}); }
      else { this.set({kind: best}); this.endTo(t, endScene); }
    } else if (d.kind === 'dCentre'){
      const l = this.toLocal(t, p); this.set({cx: l.x, cy: l.y});
    } else if (d.kind === 'eNode' || d.kind === 'eHandle'){
      const env = t.fx.envelope, il = Effects.inv(Effects.linear(this.M(t)));
      if (d.kind === 'eHandle'){ env.nodes[d.i][d.w] = this.toLocal(t, p); }
      else {
        const dv = Effects.pt(il, p.x - d.start.x, p.y - d.start.y), o0 = d.orig[d.i], n = env.nodes[d.i];
        n.x = o0.x + dv.x; n.y = o0.y + dv.y;
        if (o0.in) n.in = {x: o0.in.x + dv.x, y: o0.in.y + dv.y};
        if (o0.out) n.out = {x: o0.out.x + dv.x, y: o0.out.y + dv.y};
        this.reshapeSides(env, d.i);
      }
      t.__fx = null; canvas.requestRenderAll();
    }
  },
  up(o){
    const d = this.drag; this.drag = null;
    if (d && d.kind === 'bMake'){
      canvas.requestRenderAll();
      const end = o && Pick.under(o.e).find(x => x !== d.from);
      if (!end || !d.moved) return toast('Drag from one object to another to blend them');
      this.setTarget(d.from); Blend.make(d.from, end, this.blendDefaults()); this.commit(); toast(`Blended ${nameOf(d.from)} → ${nameOf(end)}`); return;
    }
    if (d && (d.moved || d.kind !== 'make')) this.commit();
  },
  blendDefaults(){ const v = {}; ['steps', 'rotation', 'objAcc', 'colAcc', 'colorDir'].forEach(k => v[k] = Blend.defaults[k]); return v; },
  dbl(o){
    const t = this.target, p = canvas.getPointer(o.e);
    if (this.kind() === 'transp' && t && t.fx && t.fx.transp && t.fx.transp.type === 'gradient'){
      const T = t.fx.transp, a = this.toScene(t, {x: T.x1, y: T.y1}), b = this.toScene(t, {x: T.x2, y: T.y2});
      const i = T.stops.findIndex(s => this.near(p, Effects.lerp(a, b, s.offset)));
      if (i > 0 && i < T.stops.length - 1){ const stops = T.stops.filter((_, k) => k !== i); this.set({stops}); this.tSel = -1; return this.commit(); }
      const vx = b.x - a.x, vy = b.y - a.y, off = ((p.x - a.x) * vx + (p.y - a.y) * vy) / (vx * vx + vy * vy || 1);
      const dist = Math.abs((p.x - a.x) * vy - (p.y - a.y) * vx) / (Math.hypot(vx, vy) || 1) * zoom;
      if (off > 0 && off < 1 && dist < 8){
        const st = T.stops.slice().sort((x, y) => x.offset - y.offset), j = st.findIndex(s => s.offset > off), s0 = st[j - 1], s1 = st[j];
        const tt = s0 && s1 ? s0.t + (s1.t - s0.t) * (off - s0.offset) / ((s1.offset - s0.offset) || 1) : 50;
        this.set({stops: st.concat([{offset: off, t: Math.round(tt)}])}); this.tSel = st.length; this.commit();
      }
      return;
    }
    if (this.kind() !== 'envelope' || !t || !t.fx || !t.fx.envelope) return;
    const env = t.fx.envelope, nodes = this.envNodes(t), i = nodes.findIndex(q => this.near(p, q));
    if (i >= 0){
      if (env.nodes[i].corner) return toast('Corners stay — other nodes can be removed, down to four');
      if (env.nodes.length <= 4) return;
      env.nodes.splice(i, 1); this.envSel = -1; Effects.straightHandles(env.nodes, new Set([(i - 1 + env.nodes.length) % env.nodes.length])); return this.commit();
    }
    // on the frame: add a node there (the curve keeps its shape)
    let best = null;
    env.nodes.forEach((a, k) => { const b = env.nodes[(k + 1) % env.nodes.length], q = [a, a.out, b.in, b].map(v => this.toScene(t, v));
      for (let s = 0; s <= 40; s++){ const pt = Effects.bez(...q, s / 40), dd = Math.hypot(pt.x - p.x, pt.y - p.y) * zoom; if (dd < 8 && (!best || dd < best.d)) best = {k, t: s / 40, d: dd}; } });
    if (!best) return;
    const a = env.nodes[best.k], b = env.nodes[(best.k + 1) % env.nodes.length], L = Effects.lerp, tt = best.t;
    const ab = L(a, a.out, tt), bc = L(a.out, b.in, tt), cd = L(b.in, b, tt), abc = L(ab, bc, tt), bcd = L(bc, cd, tt), m = L(abc, bcd, tt);
    a.out = ab; b.in = cd; env.nodes.splice(best.k + 1, 0, {x: m.x, y: m.y, corner: false, in: abc, out: bcd});
    this.commit();
  },
  // perspective: the far end of the shadow follows the pointer
  endTo(t, p){
    const s = t.fx.shadow, b = Effects.drawnBounds(t), e = Effects.edge(b, s), E = this.toLocal(t, p);
    const v = {x: E.x - e.A.x, y: E.y - e.A.y}, edge = {bottom: {t: {x: 1, y: 0}}, top: {t: {x: 1, y: 0}}, left: {t: {x: 0, y: -1}}, right: {t: {x: 0, y: -1}}}[s.kind];
    const along = v.x * edge.t.x + v.y * edge.t.y, across = v.x * e.n.x + v.y * e.n.y;
    this.set({angle: Math.round(fabric.util.radiansToDegrees(Math.atan2(across, along))), stretch: Math.max(0, Math.min(1000, Math.round(Math.hypot(v.x, v.y) / e.L * 100)))});
    this.bar();
  },
  addEnvelope(o, preset){
    Shaping.init();
    let box; try { box = Effects.boundsOf(Effects.baseOutline(o)); } finally { paper.project.clear(); }
    const env = Object.assign({}, Effects.defaults.envelope, o.fx && o.fx.envelope ? {mapping: o.fx.envelope.mapping, keepLines: o.fx.envelope.keepLines} : {});
    env.box = box; env.nodes = preset ? Effects.envelopePreset(preset, box) : Effects.frame(box);
    o.fx = Object.assign({}, o.fx, {envelope: env}); o.__fx = null; o.objectCaching = false;
  },
  reshapeSides(env, i){
    if (this.envMode === 'unconstrained') return;
    const S = Effects.sides(env.nodes);
    Object.entries(S).forEach(([name, idx]) => {
      if (!idx.includes(i)) return;
      if (this.envMode === 'straight') Effects.straightHandles(env.nodes, new Set(idx.slice(0, -1)));
      if (this.envMode === 'single') Effects.singleArc(env.nodes, idx);
      if (this.envMode === 'double') Effects.doubleArc(env.nodes, idx, name === 'bottom' || name === 'top');
    });
  },

  /* ---------- drawing the handles ---------- */
  draw(ctx){
    if (this.drag && this.drag.kind === 'bMake' && this.drag.moved){
      const r0 = canvas.getRetinaScaling(), v0 = canvas.viewportTransform, S0 = p => ({x: p.x * v0[0] + v0[4], y: p.y * v0[3] + v0[5]}), a = S0(this.drag.start), b = S0(this.drag.cur);
      ctx.save(); ctx.setTransform(r0, 0, 0, r0, 0, 0); ctx.setLineDash([5, 4]); ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.restore();
    }
    const t = this.target; if (!t || !this.active()) return;
    const r = canvas.getRetinaScaling(), v = canvas.viewportTransform, S = p => ({x: p.x * v[0] + v[4], y: p.y * v[3] + v[5]});
    ctx.save(); ctx.setTransform(r, 0, 0, r, 0, 0);
    // the object's box, dashed
    const c = t.getCoords(true, true).map(S);
    ctx.setLineDash([4, 3]); ctx.strokeStyle = 'rgba(59,130,246,.8)'; ctx.lineWidth = 1; ctx.beginPath(); c.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
    const sq = (p, fill, z = 5) => { ctx.fillStyle = fill; ctx.strokeStyle = '#111'; ctx.lineWidth = 1; ctx.fillRect(p.x - z, p.y - z, 2 * z, 2 * z); ctx.strokeRect(p.x - z + .5, p.y - z + .5, 2 * z - 1, 2 * z - 1); };
    const k = this.kind();
    if (k === 'shadow'){
      const h = this.shadowHandles(t);
      if (h){
        const A = S(h.A), E = S(h.E), B = S(h.bar);
        ctx.setLineDash([4, 3]); ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(E.x, E.y); ctx.stroke(); ctx.setLineDash([]);
        sq(A, '#fff'); sq(E, t.fx.shadow.color || '#000');
        ctx.save(); ctx.translate(B.x, B.y); ctx.rotate(Math.atan2(E.y - A.y, E.x - A.x)); ctx.fillStyle = '#fff'; ctx.strokeStyle = '#111'; ctx.fillRect(-2, -7, 4, 14); ctx.strokeRect(-2, -7, 4, 14); ctx.restore();
      }
    }
    if (k === 'transp' && t.fx && t.fx.transp && t.fx.transp.type === 'gradient'){
      const T = t.fx.transp, A = S(this.toScene(t, {x: T.x1, y: T.y1})), B = S(this.toScene(t, {x: T.x2, y: T.y2}));
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke(); ctx.strokeStyle = '#111'; ctx.lineWidth = 1; ctx.stroke();
      T.stops.forEach((s, i) => { const p = {x: A.x + (B.x - A.x) * s.offset, y: A.y + (B.y - A.y) * s.offset}, g = Math.round(255 * (1 - s.t / 100)); sq(p, `rgb(${g},${g},${g})`, i === this.tSel ? 6 : 5); });
    }
    if (k === 'blend'){
      const b = t.fx && t.fx.blend, end = b && byUid(b.end);
      const line = (a, c) => { ctx.setLineDash([5, 4]); ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.stroke(); ctx.setLineDash([]); };
      if (end){ const a = S(t.getCenterPoint()), c = S(end.getCenterPoint()); line(a, c); sq(a, '#fff'); sq(c, '#3b82f6'); }
    }
    if (k === 'distort'){
      const cc = this.distortCentre(t);
      if (cc){ const p = S(cc); ctx.beginPath(); ctx.moveTo(p.x, p.y - 7); ctx.lineTo(p.x + 7, p.y); ctx.lineTo(p.x, p.y + 7); ctx.lineTo(p.x - 7, p.y); ctx.closePath(); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#111'; ctx.stroke(); }
    }
    if (k === 'envelope' && t.fx && t.fx.envelope){
      const env = t.fx.envelope, n = env.nodes.length, L = p => S(this.toScene(t, p));
      ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 1.2; ctx.beginPath();
      env.nodes.forEach((a, i) => { const b = env.nodes[(i + 1) % n], p0 = L(a), c1 = L(a.out), c2 = L(b.in), p3 = L(b); if (!i) ctx.moveTo(p0.x, p0.y); ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, p3.x, p3.y); });
      ctx.closePath(); ctx.stroke();
      if (this.envMode === 'unconstrained' && this.envSel >= 0 && env.nodes[this.envSel]){
        const nd = env.nodes[this.envSel], p = L(nd);
        ['in', 'out'].forEach(w => { if (!nd[w]) return; const h = L(nd[w]); ctx.setLineDash([3, 2]); ctx.strokeStyle = '#2563eb'; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(h.x, h.y); ctx.stroke(); ctx.setLineDash([]); ctx.beginPath(); ctx.arc(h.x, h.y, 4, 0, Math.PI * 2); ctx.fillStyle = '#2563eb'; ctx.fill(); });
      }
      env.nodes.forEach((nd, i) => { const p = L(nd), z = nd.corner ? 4.5 : 3.5; ctx.fillStyle = i === this.envSel ? '#2563eb' : '#fff'; ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 1.2; ctx.fillRect(p.x - z, p.y - z, 2 * z, 2 * z); ctx.strokeRect(p.x - z, p.y - z, 2 * z, 2 * z); });
    }
    ctx.restore();
  },

  /* ---------- property bar ---------- */
  bar(){
    ['shadow', 'contour', 'envelope', 'distort', 'blend', 'transp'].forEach(k => $('pbFx' + k[0].toUpperCase() + k.slice(1)).classList.toggle('on', this.kind() === k));
    if (!this.active()) return;
    const t = this.target, k = this.kind(), cur = t && t.fx && t.fx[k];
    const defs = k === 'blend' ? Blend.defaults : k === 'transp' ? {} : Effects.defaults[k];
    $('fxInfo').textContent = t ? `${nameOf(t)}${cur ? '' : ' — drag on it to add'}` : 'Click an object';
    const v = Object.assign({}, defs, cur || {});
    const set = (id, val) => { const el = $(id); if (!el || document.activeElement === el) return; if (el.type === 'checkbox') el.checked = !!val; else el.value = val; };
    const IN = x => +(x / PX_PER_IN).toFixed(3);
    if (k === 'shadow'){
      set('sxKind', v.kind); set('sxX', IN(v.dx)); set('sxY', IN(v.dy)); set('sxAngle', v.angle); set('sxStretch', v.stretch); set('sxFade', v.fade);
      set('sxOpacity', v.opacity); set('sxFeather', IN(v.feather)); set('sxDir', v.dir); set('sxEdges', v.edges); set('sxMerge', v.merge); set('sxColor', v.color);
      document.querySelectorAll('.sx-flat').forEach(e => e.style.display = v.kind === 'flat' ? '' : 'none');
      document.querySelectorAll('.sx-persp').forEach(e => e.style.display = v.kind === 'flat' ? 'none' : '');
    }
    if (k === 'contour'){
      document.querySelectorAll('#cxMode button').forEach(b => b.classList.toggle('on', b.dataset.v === v.mode));
      set('cxSteps', v.steps); set('cxOffset', IN(v.offset)); set('cxCorners', v.corners); set('cxDir', v.colorDir); set('cxFill', v.endFill); set('cxStroke', v.endStroke); set('cxObjAcc', v.objAcc); set('cxColAcc', v.colAcc);
      $('cxSteps').disabled = v.mode === 'center';
    }
    if (k === 'envelope'){
      document.querySelectorAll('#exMode button').forEach(b => b.classList.toggle('on', b.dataset.v === this.envMode));
      set('exMapping', v.mapping); set('exKeep', v.keepLines);
    }
    if (k === 'distort'){
      document.querySelectorAll('#dxKind button').forEach(b => b.classList.toggle('on', b.dataset.v === v.kind));
      set('dxAmount', v.amount); set('dxAmp', IN(v.amp)); set('dxFreq', v.freq); set('dxRandom', v.random); set('dxSmooth', v.smooth); set('dxLocal', v.local);
      const turns = Math.trunc(Math.abs(v.angle) / 360); set('dxTurns', turns); set('dxDeg', Math.abs(v.angle) - turns * 360); set('dxCw', v.angle >= 0 ? 'cw' : 'ccw');
      document.querySelectorAll('.dx-push').forEach(e => e.style.display = v.kind === 'push' ? '' : 'none');
      document.querySelectorAll('.dx-zip').forEach(e => e.style.display = v.kind === 'zipper' ? '' : 'none');
      document.querySelectorAll('.dx-tw').forEach(e => e.style.display = v.kind === 'twister' ? '' : 'none');
    }
    if (k === 'blend'){
      set('bxSteps', v.steps); set('bxRot', v.rotation); set('bxObjAcc', v.objAcc); set('bxColAcc', v.colAcc); set('bxDir', v.colorDir); set('bxLoop', v.loop); set('bxSizing', v.sizing);
      set('bxFull', v.full); set('bxRotAll', v.rotateAll); set('bxUseSp', v.useSpacing); set('bxSpacing', IN(v.spacing));
      const hasPath = !!(cur && cur.path); document.querySelectorAll('.bx-path').forEach(e => e.style.display = hasPath ? '' : 'none');
      $('fxInfo').textContent = t ? (cur ? `${nameOf(t)} → ${nameOf(byUid(cur.end) || {name: '?'})}` : `${nameOf(t)} — drag from one object to another`) : 'Drag from one object to another';
    }
    if (k === 'transp'){
      const T = t && t.fx && t.fx.transp, type = T && T.type === 'gradient' ? T.kind : (t && ((t.opacity ?? 1) < 1 || (T && T.type === 'uniform')) ? 'uniform' : 'none');
      set('txType', type); set('txMerge', t ? t.globalCompositeOperation || 'source-over' : 'source-over'); set('txTarget', T ? T.target || 'both' : 'both');
      const amt = T && T.type === 'gradient' ? (T.stops[this.tSel] || T.stops[0]).t : T && T.type === 'uniform' ? T.amount : t ? Math.round((1 - (t.opacity ?? 1)) * 100) : 50;
      set('txAmount', amt); $('fxInfo').textContent = t ? `${nameOf(t)}${type === 'none' ? ' — drag across it for a gradient' : ''}` : 'Click an object';
    }
    document.querySelectorAll('[data-fxneeds]').forEach(b => b.disabled = !cur);
  },

  /* ---------- break apart / clear ---------- */
  breakApart(o){
    o = o || this.target || canvas.getActiveObject(); if (!o || !Effects.hasAny(o)) return toast('Select an object with an effect');
    if (o.fx.blend && (this.kind() === 'blend' || !this.active())) return Blend.breakApart(o);
    const i = canvas.getObjects().indexOf(o), made = [];
    restoring = true;
    if (o.fx.shadow){
      // the shadow becomes a 150 dpi bitmap just behind the object
      const sb = Effects.sceneBounds(o), dpi = 150, k = dpi / PX_PER_IN;
      const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(sb.width * k)); c.height = Math.max(1, Math.ceil(sb.height * k));
      const x = c.getContext('2d'); x.setTransform(k, 0, 0, k, -sb.left * k, -sb.top * k); x.transform(...o.calcTransformMatrix());
      const merge = o.fx.shadow.merge;
      Effects.drawShadow(o, x, c2 => Effects.baseDraw.call(o, c2));
      const img = new fabric.Image(c, {left: sb.left, top: sb.top, scaleX: 1 / k, scaleY: 1 / k, name: 'Shadow', globalCompositeOperation: merge === 'multiply' ? 'multiply' : 'source-over'});
      canvas.insertAt(img, i); made.push(img);
      const fx = Object.assign({}, o.fx); delete fx.shadow; o.fx = Object.keys(fx).length ? fx : null;
    }
    if (o.fx && (o.fx.contour || o.fx.envelope || o.fx.distort)){
      const {main, steps} = Effects.bake(o);
      const behind = steps.filter(s => s.order < 0).map(s => s.obj), front = steps.filter(s => s.order > 0).map(s => s.obj);
      const at = canvas.getObjects().indexOf(o);
      behind.forEach((s, k) => canvas.insertAt(s, at + k));
      let after = canvas.getObjects().indexOf(o);
      if (main){ canvas.remove(o); canvas.insertAt(main, after); made.push(main); }
      else { const fx = Object.assign({}, o.fx); delete fx.contour; o.fx = Object.keys(fx).length ? fx : null; o.__fx = null; o.objectCaching = !Effects.hasAny(o); made.push(o); }
      after = canvas.getObjects().indexOf(main || o);
      front.forEach((s, k) => canvas.insertAt(s, after + 1 + k));
      made.push(...behind, ...front);
    }
    restoring = false;
    if (canvas.getObjects().includes(o)) { o.__fx = null; o.dirty = true; }
    if (this.active()) this.setTarget(made.find(m => m.type !== 'image') || null); else selectObjs(made);
    canvas.requestRenderAll(); snapshot(); refresh(); toast('Effect broken apart into separate objects');
  },
};

/* ---------- wiring ---------- */
canvas.on('after:render', e => { if (e && e.ctx === canvas.contextContainer && FxTool.active()) FxTool.draw(e.ctx); });
(function(){
  const IN = v => (parseFloat(v) || 0) * PX_PER_IN;
  const live = (id, fn, ev = 'change') => { const el = $(id); if (el) el.addEventListener(ev, () => { fn(el.type === 'checkbox' ? el.checked : el.value); FxTool.bar(); }); };
  const commitAfter = id => { const el = $(id); el && el.addEventListener('change', () => FxTool.commit()); };
  // shadow
  live('sxPreset', v => { if (!v) return; FxTool.set(Object.assign({}, Effects.defaults.shadow, Effects.SHADOW_PRESETS[v]), true); FxTool.commit(); $('sxPreset').value = ''; });
  live('sxKind', v => FxTool.set({kind: v})); live('sxX', v => FxTool.set({dx: IN(v)})); live('sxY', v => FxTool.set({dy: IN(v)}));
  live('sxAngle', v => FxTool.set({angle: +v})); live('sxStretch', v => FxTool.set({stretch: Math.max(0, Math.min(1000, +v))})); live('sxFade', v => FxTool.set({fade: Math.max(0, Math.min(100, +v))}));
  live('sxOpacity', v => FxTool.set({opacity: Math.max(0, Math.min(100, +v))})); live('sxFeather', v => FxTool.set({feather: Math.max(0, IN(v))}));
  live('sxDir', v => FxTool.set({dir: v})); live('sxEdges', v => FxTool.set({edges: v})); live('sxMerge', v => FxTool.set({merge: v})); live('sxColor', v => FxTool.set({color: v}), 'input');
  ['sxKind', 'sxX', 'sxY', 'sxAngle', 'sxStretch', 'sxFade', 'sxOpacity', 'sxFeather', 'sxDir', 'sxEdges', 'sxMerge', 'sxColor'].forEach(commitAfter);
  // contour
  document.querySelectorAll('#cxMode button').forEach(b => b.onclick = () => { FxTool.set({mode: b.dataset.v}); FxTool.commit(); });
  live('cxSteps', v => FxTool.set({steps: Math.max(1, Math.min(999, Math.round(+v)))})); live('cxOffset', v => FxTool.set({offset: Math.max(0.02, IN(v))}));
  live('cxCorners', v => FxTool.set({corners: v})); live('cxDir', v => FxTool.set({colorDir: v})); live('cxFill', v => FxTool.set({endFill: v}), 'input'); live('cxStroke', v => FxTool.set({endStroke: v}), 'input');
  live('cxObjAcc', v => FxTool.set({objAcc: Math.max(-100, Math.min(100, +v))})); live('cxColAcc', v => FxTool.set({colAcc: Math.max(-100, Math.min(100, +v))}));
  ['cxSteps', 'cxOffset', 'cxCorners', 'cxDir', 'cxFill', 'cxStroke', 'cxObjAcc', 'cxColAcc'].forEach(commitAfter);
  // envelope
  document.querySelectorAll('#exMode button').forEach(b => b.onclick = () => { FxTool.envMode = b.dataset.v; FxTool.bar(); canvas.requestRenderAll(); });
  live('exPreset', v => { if (!v) return; const t = FxTool.target; if (!t || !Effects.canShape(t)) return toast('Click a shape or text first'); FxTool.addEnvelope(t, v); FxTool.commit(); $('exPreset').value = ''; });
  live('exMapping', v => { const t = FxTool.target; if (t && t.fx && t.fx.envelope){ t.fx.envelope.mapping = v; FxTool.commit(); } Effects.defaults.envelope.mapping = v; });
  live('exKeep', v => { const t = FxTool.target; if (t && t.fx && t.fx.envelope){ t.fx.envelope.keepLines = v; FxTool.commit(); } Effects.defaults.envelope.keepLines = v; });
  // distort
  document.querySelectorAll('#dxKind button').forEach(b => b.onclick = () => { const t = FxTool.target; Effects.defaults.distort.kind = b.dataset.v; if (t && t.fx && t.fx.distort){ FxTool.set({kind: b.dataset.v}); FxTool.commit(); } else FxTool.bar(); });
  live('dxAmount', v => FxTool.set({amount: Math.max(-200, Math.min(200, +v))})); live('dxAmp', v => FxTool.set({amp: Math.max(0, IN(v))})); live('dxFreq', v => FxTool.set({freq: Math.max(0, Math.min(100, Math.round(+v)))}));
  live('dxRandom', v => FxTool.set({random: v})); live('dxSmooth', v => FxTool.set({smooth: v})); live('dxLocal', v => FxTool.set({local: v}));
  const tw = () => { const a = (+$('dxTurns').value || 0) * 360 + (+$('dxDeg').value || 0); FxTool.set({angle: $('dxCw').value === 'ccw' ? -a : a}); };
  ['dxTurns', 'dxDeg', 'dxCw'].forEach(id => live(id, tw));
  ['dxAmount', 'dxAmp', 'dxFreq', 'dxRandom', 'dxSmooth', 'dxLocal', 'dxTurns', 'dxDeg', 'dxCw'].forEach(commitAfter);
  // blend
  // with a blend selected the bar edits it; with none, it sets what the next blend takes
  const bset = (v) => { const t = FxTool.target; if (t && t.fx && t.fx.blend) FxTool.set(v); else Object.assign(Blend.defaults, v); };
  live('bxSteps', v => bset({steps: Math.max(1, Math.min(999, Math.round(+v)))})); live('bxRot', v => bset({rotation: Math.max(-3600, Math.min(3600, +v))}));
  live('bxObjAcc', v => bset({objAcc: Math.max(-100, Math.min(100, +v))})); live('bxColAcc', v => bset({colAcc: Math.max(-100, Math.min(100, +v))}));
  live('bxDir', v => bset({colorDir: v})); live('bxLoop', v => bset({loop: v})); live('bxSizing', v => bset({sizing: v}));
  live('bxFull', v => bset({full: v})); live('bxRotAll', v => bset({rotateAll: v})); live('bxUseSp', v => bset({useSpacing: v})); live('bxSpacing', v => bset({spacing: Math.max(0.5, IN(v))}));
  ['bxSteps', 'bxRot', 'bxObjAcc', 'bxColAcc', 'bxDir', 'bxLoop', 'bxSizing', 'bxFull', 'bxRotAll', 'bxUseSp', 'bxSpacing'].forEach(commitAfter);
  $('bxPath').onclick = () => { const t = FxTool.target; if (!t || !t.fx || !t.fx.blend) return toast('Make a blend first'); FxTool.pickPath = true; canvas.defaultCursor = Clip.ARROW; toast('Click the path for the blend to follow'); };
  $('bxDetach').onclick = () => { if (FxTool.target && FxTool.target.fx && FxTool.target.fx.blend){ FxTool.set({path: null}); FxTool.commit(); } };
  // transparency
  const tApply = () => {
    const t = FxTool.target; if (!t) return toast('Click an object first');
    const type = $('txType').value, amt = Math.max(0, Math.min(100, +$('txAmount').value || 0)), target = $('txTarget').value;
    t.set('globalCompositeOperation', $('txMerge').value);
    if (type === 'none'){ t.set('opacity', 1); Effects.set([t], 'transp', null); }
    else if (type === 'uniform'){
      if (target === 'both'){ t.set('opacity', 1 - amt / 100); Effects.set([t], 'transp', null); }
      else { t.set('opacity', 1); Effects.set([t], 'transp', {type: 'uniform', amount: amt, target}, true); }
    } else {
      const cur = t.fx && t.fx.transp && t.fx.transp.type === 'gradient' ? t.fx.transp : Transp.defaultGrad(t);
      const stops = cur.stops.map(s => Object.assign({}, s)); if (FxTool.tSel >= 0 && stops[FxTool.tSel] && document.activeElement === $('txAmount')) stops[FxTool.tSel].t = amt;
      t.set('opacity', 1); Effects.set([t], 'transp', Object.assign({}, cur, {type: 'gradient', kind: type, stops, target}), true);
    }
    canvas.requestRenderAll(); FxTool.bar();
  };
  ['txType', 'txMerge', 'txTarget'].forEach(id => $(id).addEventListener('change', () => { tApply(); FxTool.commit(); }));
  $('txAmount').addEventListener('input', tApply); $('txAmount').addEventListener('change', () => FxTool.commit());
  // shared buttons
  document.querySelectorAll('[data-fx]').forEach(b => b.onclick = () => {
    const t = FxTool.target, k = FxTool.kind(), a = b.dataset.fx;
    if (!t) return toast('Click an object first');
    if (a === 'apply' && k === 'blend'){
      const sel = FxTool.lastSel || []; if (sel.length !== 2) return toast('Select two objects with the Pick tool first (or drag from one to the other)');
      Blend.make(sel[0], sel[1], FxTool.blendDefaults()); FxTool.setTarget(sel[0]); FxTool.commit(); return;
    }
    if (a === 'apply' && k === 'transp'){ $('txType').value = $('txType').value === 'none' ? 'uniform' : $('txType').value; tApply(); FxTool.commit(); return; }
    if (a === 'clear' && k === 'transp'){ t.set({opacity: 1, globalCompositeOperation: 'source-over'}); Effects.set([t], 'transp', null); FxTool.commit(); return; }
    if (a === 'apply'){
      if (k === 'envelope') FxTool.addEnvelope(t); else if (k === 'distort') FxTool.set(Object.assign({}, Effects.defaults.distort, {cx: null, cy: null}), true); else FxTool.set({});
      FxTool.commit();
    }
    if (a === 'clear'){ Effects.set([t], k, null); FxTool.commit(); }
    if (a === 'centre' && t.fx && t.fx.distort){ FxTool.set({cx: null, cy: null}); FxTool.commit(); }
    if (a === 'break') FxTool.breakApart(t);
    if (a === 'curves'){ setTool('pick'); canvas.setActiveObject(t); run('shape:curves'); }
  });
})();
