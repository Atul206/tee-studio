/* ===================== Blend, Transparency, opacity masks =====================
   Ported from TraceDraw's docs/behavior/blend.md, transparency.md and clip-frame.md (opacity mask).
   • Blend: the start object holds o.fx.blend naming the end object (by uid); the steps are drawn live from
     both, between them in the stacking order. Geometry is morphed node by node (resampled to the same count,
     wound alike, first nodes lined up); the transform is blended as move + turn + scale.
   • Transparency: uniform with Normal is the object's opacity, merge modes are its composite operation;
     a gradient (linear, radial, conical, square) is a mask over a scratch layer, also for fill or outline only.
   • Opacity mask: a clip frame's frame stops being drawn and its brightness sets how much of the contents shows. */

const MERGES = [['source-over', 'Normal'], ['lighter', 'Add'], ['difference', 'Difference'], ['multiply', 'Multiply'], ['color-dodge', 'Divide'],
  ['lighten', 'If lighter'], ['darken', 'If darker'], ['screen', 'Screen'], ['overlay', 'Overlay'], ['hue', 'Hue'], ['saturation', 'Saturation'],
  ['color', 'Colour'], ['luminosity', 'Luminosity'], ['exclusion', 'Exclusion'], ['hard-light', 'Hard light'], ['soft-light', 'Soft light'], ['color-burn', 'Colour burn']];

function uidOf(o){ if (!o.uid) o.uid = 'o' + Math.random().toString(36).slice(2, 10); return o.uid; }
function byUid(u){ return u ? canvas.getObjects().find(o => o.uid === u) : null; }

/* ---------- Blend ---------- */
const Blend = {
  defaults: {steps: 20, rotation: 0, objAcc: 0, colAcc: 0, colorDir: 'direct', loop: false, sizing: false, path: null, full: false, rotateAll: false, useSpacing: false, spacing: 5 * MM},

  // an object's outline in its own space (warped by its envelope/distortion when it has one)
  localSubs(o){
    if (Effects.warps(o)){ const fx = Effects.compute(o); if (fx && fx.geomD) return Effects.fromPaper(new paper.CompoundPath({pathData: fx.geomD, insert: false})); }
    return Effects.baseOutline(o);
  },
  area(segs){ let a = 0; segs.forEach(([p0, , , p3]) => { a += p0.x * p3.y - p3.x * p0.y; }); return a / 2; },
  centre(segs){ let x = 0, y = 0; segs.forEach(s => { x += s[0].x; y += s[0].y; }); return {x: x / segs.length, y: y / segs.length}; },
  segLen(q){ return Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y) + Math.hypot(q[2].x - q[1].x, q[2].y - q[1].y) + Math.hypot(q[3].x - q[2].x, q[3].y - q[2].y); },
  splitLongest(segs){
    let k = 0, L = -1; segs.forEach((q, i) => { const l = this.segLen(q); if (l > L){ L = l; k = i; } });
    const [p0, p1, p2, p3] = segs[k], m = Effects.lerp, a = m(p0, p1, .5), b = m(p1, p2, .5), c = m(p2, p3, .5), d = m(a, b, .5), e = m(b, c, .5), f = m(d, e, .5);
    segs.splice(k, 1, [p0, a, d, f], [f, e, c, p3]);
  },
  // the end outline wound like the start one, starting at the node pointing the same way from its centre
  match(A, B){
    const a = A.segs.map(q => q.slice()), b0 = B.segs.map(q => q.slice());
    let b = b0;
    if (A.closed && B.closed && Math.sign(this.area(a)) !== Math.sign(this.area(b))) b = b.slice().reverse().map(([p0, c1, c2, p3]) => [p3, c2, c1, p0]);
    if (A.closed && B.closed){
      const ca = this.centre(a), cb = this.centre(b), dirA = Math.atan2(a[0][0].y - ca.y, a[0][0].x - ca.x);
      let best = 0, bd = Infinity;
      b.forEach((q, i) => { let d = Math.abs(Math.atan2(q[0].y - cb.y, q[0].x - cb.x) - dirA); if (d > Math.PI) d = 2 * Math.PI - d; if (d < bd){ bd = d; best = i; } });
      b = b.slice(best).concat(b.slice(0, best));
    }
    while (a.length < b.length) this.splitLongest(a);
    while (b.length < a.length) this.splitLongest(b);
    return [a, b];
  },
  point(segs){ const c = this.centre(segs); return segs.map(() => [c, c, c, c]); },
  decompose(o){ const d = fabric.util.qrDecompose(o.calcTransformMatrix()); return d; },
  // one-time path sampling for steps along a path (scene coordinates)
  pathSampler(p){
    // the path's own outline (open curves stay open), first subpath, in page space
    Shaping.init();
    let pts = [];
    try {
      const subs = this.localSubs(p), M = p.calcTransformMatrix();
      if (subs.length){ const f = Effects.flatten([subs[0]], 0.5)[0]; pts = f.pts.map(q => Effects.pt(M, q.x, q.y)); if (subs[0].closed) pts.push(pts[0]); }
    } finally { paper.project.clear(); }
    if (pts.length < 2) pts = [p.getCenterPoint(), p.getCenterPoint()];
    let acc = 0; const lens = pts.map((q, i) => i ? (acc += Math.hypot(q.x - pts[i - 1].x, q.y - pts[i - 1].y)) : 0);
    const ang = i => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, Math.max(1, i))]; return fabric.util.radiansToDegrees(Math.atan2(b.y - a.y, b.x - a.x)); };
    return {L: acc, at: t => {
      const s = Math.max(0, Math.min(1, t)) * acc; let i = lens.findIndex(v => v >= s - 1e-9);
      if (i < 0) i = lens.length - 1; if (i === 0) return Object.assign({a: ang(1)}, pts[0]);
      const f = (s - lens[i - 1]) / ((lens[i] - lens[i - 1]) || 1);
      return {x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f, a: ang(i)};
    }};
  },
  sig(o, end, path, b){ return JSON.stringify([Effects.sig(o), o.calcTransformMatrix().map(v => +v.toFixed(3)), Effects.sig(end), end.calcTransformMatrix().map(v => +v.toFixed(3)), path ? [Effects.sig(path), path.calcTransformMatrix().map(v => +v.toFixed(2))] : 0, b, o.opacity, end.opacity]); },
  colour(o, k){ const v = o[k]; return !v ? null : typeof v === 'string' ? v : v.colorStops ? v.colorStops[0].color : null; },
  steps(o){
    const b = o.fx && o.fx.blend; if (!b) return null;
    const end = byUid(b.end); if (!end || end === o) return null;
    if ((o.text != null || end.text != null) && !window.TEE_FONT_TTF){ TextCurves.ready().then(() => canvas.requestRenderAll()); return null; }
    const path = b.path ? byUid(b.path) : null;
    const sig = this.sig(o, end, path, b);
    if (o.__blend && o.__blend.sig === sig) return o.__blend;
    Shaping.init();
    let out = null;
    try {
      const SA = this.localSubs(o), SB = this.localSubs(end);
      const pairs = []; const n = Math.max(SA.length, SB.length);
      for (let i = 0; i < n; i++){
        const A = SA[i], B = SB[i];
        if (A && B) pairs.push(this.match(A, B).concat([A.closed]));
        else if (A) pairs.push([A.segs, this.point(A.segs), A.closed]);
        else pairs.push([this.point(B.segs), B.segs, B.closed]);
      }
      const dA = this.decompose(o), dB = this.decompose(end);
      const sampler = path ? this.pathSampler(path) : null;
      let count = Math.max(1, Math.min(999, Math.round(b.steps)));
      if (sampler && b.useSpacing) count = Math.max(1, Math.min(999, Math.floor(sampler.L / Math.max(0.5, b.spacing)) - 1));
      const fA = this.colour(o, 'fill'), fB = this.colour(end, 'fill'), sA = o.strokeWidth ? this.colour(o, 'stroke') : null, sB = end.strokeWidth ? this.colour(end, 'stroke') : null;
      let da = dB.angle - dA.angle; da = ((da % 360) + 540) % 360 - 180;     // the short way round
      const mid = {x: (dA.translateX + dB.translateX) / 2, y: (dA.translateY + dB.translateY) / 2};
      const list = [];
      for (let k = 1; k <= count; k++){
        const t = sampler && b.full ? (count === 1 ? 0.5 : (k - 1) / (count - 1)) : k / (count + 1);
        const tp = Effects.accel(t, b.objAcc || 0), tc = Effects.accel(t, b.colAcc || 0), ts = b.sizing ? tp : t;
        let x = dA.translateX + (dB.translateX - dA.translateX) * tp, y = dA.translateY + (dB.translateY - dA.translateY) * tp;
        let ang = dA.angle + da * tp + (b.rotation || 0) * tp;
        if (b.loop && b.rotation){ const r = fabric.util.degreesToRadians(b.rotation * tp), vx = x - mid.x, vy = y - mid.y; x = mid.x + vx * Math.cos(r) - vy * Math.sin(r); y = mid.y + vx * Math.sin(r) + vy * Math.cos(r); }
        if (sampler){ const q = sampler.at(tp); x = q.x; y = q.y; if (b.rotateAll) ang += q.a; }
        const m = fabric.util.composeMatrix({translateX: x, translateY: y, angle: ang, scaleX: dA.scaleX + (dB.scaleX - dA.scaleX) * ts, scaleY: dA.scaleY + (dB.scaleY - dA.scaleY) * ts, skewX: dA.skewX + (dB.skewX - dA.skewX) * tp});
        const subs = pairs.map(([a, bb, closed]) => ({closed, segs: a.map((q, i) => q.map((p, j) => Effects.lerp(p, bb[i][j], tp)))}));
        const d = Effects.toD(subs);
        list.push({d, p2: new Path2D(d), m, fill: fA && fB ? Effects.mix(fA, fB, tc, b.colorDir) : (fA || fB) && null, stroke: sA && sB ? Effects.mix(sA, sB, tc, b.colorDir) : null,
                   sw: (o.strokeWidth || 0) + ((end.strokeWidth || 0) - (o.strokeWidth || 0)) * ts, opacity: (o.opacity ?? 1) + ((end.opacity ?? 1) - (o.opacity ?? 1)) * tc,
                   rule: o.text != null || end.text != null ? 'nonzero' : 'evenodd'});
      }
      // the steps lie between the two objects: below the start when the end is below it
      const below = canvas.getObjects().indexOf(end) < canvas.getObjects().indexOf(o);
      out = {sig, list: below ? list.slice().reverse() : list, below};
    } catch (e){ console.warn('blend failed', e); out = null; }
    finally { paper.project.clear(); }
    o.__blend = out;
    return out;
  },
  draw(o, ctx, where){
    const S = this.steps(o); if (!S || (where === 'below') !== S.below) return;
    const scale = o.strokeUniform ? 1 : 1;
    ctx.save();
    ctx.transform(...Effects.inv(o.calcTransformMatrix()));          // back to page space
    const base = ctx.globalAlpha / (o.opacity || 1);
    S.list.forEach(s => {
      ctx.save(); ctx.globalAlpha = base * s.opacity; ctx.transform(...s.m);
      if (s.fill){ ctx.fillStyle = s.fill; ctx.fill(s.p2, s.rule); }
      if (s.stroke && s.sw){ const d = fabric.util.qrDecompose(s.m); ctx.lineWidth = s.sw / Math.max(1e-6, (Math.abs(d.scaleX) + Math.abs(d.scaleY)) / 2) * scale; ctx.strokeStyle = s.stroke; ctx.lineJoin = 'round'; ctx.stroke(s.p2); }
      ctx.restore();
    });
    ctx.restore();
  },
  bounds(o){
    const S = this.steps(o); if (!S || !S.list.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    S.list.forEach(s => s.d.replace(/[MCL]?([-\d.e]+) ([-\d.e]+)/g, (_, X, Y) => { const p = Effects.pt(s.m, +X, +Y); x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }));
    return {left: x0, top: y0, width: x1 - x0, height: y1 - y0};
  },
  bake(o){
    const S = this.steps(o); if (!S) return [];
    return S.list.map((s, i) => {
      Shaping.init(); const it = new paper.CompoundPath({pathData: s.d, insert: false}); it.transform(new paper.Matrix(...s.m)); const d = it.pathData; paper.project.clear();
      const d0 = fabric.util.qrDecompose(s.m);
      return new fabric.Path(d, {fill: s.fill || '', stroke: s.stroke, strokeWidth: s.stroke ? s.sw : 0, opacity: s.opacity, fillRule: s.rule, name: `Blend step ${i + 1}`, strokeUniform: true});
    });
  },
  make(start, end, values){
    Effects.set([start], 'blend', Object.assign({}, this.defaults, start.fx && start.fx.blend, values || {}, {end: uidOf(end)}));
    uidOf(start);
  },
  breakApart(o){
    const steps = this.bake(o); if (!steps.length) return toast('Nothing to break apart');
    const S = o.__blend, i = canvas.getObjects().indexOf(o);
    restoring = true;
    const g = steps.length > 1 ? new fabric.Group(S.below ? steps : steps, {name: 'Blend steps'}) : steps[0];
    canvas.insertAt(g, S.below ? i : i + 1);
    Effects.set([o], 'blend', null);
    restoring = false; selectObjs([g]); snapshot(); refresh(); toast('Blend steps are now objects');
  },
};
// the end object deleted: the blend goes with it
canvas.on('object:removed', e => {
  if (restoring || !e.target || !e.target.uid) return;
  const u = e.target.uid;
  canvas.getObjects().forEach(o => { if (o.fx && o.fx.blend && (o.fx.blend.end === u)) Effects.set([o], 'blend', null); if (o.fx && o.fx.blend && o.fx.blend.path === u){ o.fx.blend.path = null; o.__blend = null; } });
});

/* ---------- Transparency (gradient masks; uniform lives in opacity + merge) ---------- */
const Transp = {
  needsLayer: o => !!(o.fx && o.fx.transp && (o.fx.transp.type === 'gradient' || o.fx.transp.target !== 'both')),
  // local line of the mask: from (x1,y1) to (x2,y2); stops: [{offset 0..1, t: transparency 0..100}]
  defaultGrad(o){ const w = o.width / 2, h = o.height / 2; return {type: 'gradient', kind: 'linear', x1: -w, y1: 0, x2: w, y2: 0, stops: [{offset: 0, t: 0}, {offset: 1, t: 100}], target: 'both'}; },
  draw(o, ctx, body){
    const T = o.fx.transp, Dm = ctx.getTransform(), DM = [Dm.a, Dm.b, Dm.c, Dm.d, Dm.e, Dm.f];
    const b = Effects.drawnBounds(o), pad = (o.strokeWidth || 0) + 2;
    const corners = [[b.x0 - pad, b.y0 - pad], [b.x1 + pad, b.y0 - pad], [b.x1 + pad, b.y1 + pad], [b.x0 - pad, b.y1 + pad]].map(([x, y]) => Effects.pt(DM, x, y));
    let x0 = Math.floor(Math.min(...corners.map(p => p.x))), y0 = Math.floor(Math.min(...corners.map(p => p.y)));
    let w = Math.ceil(Math.max(...corners.map(p => p.x))) - x0, h = Math.ceil(Math.max(...corners.map(p => p.y))) - y0;
    const cw = ctx.canvas.width, ch = ctx.canvas.height;
    const cx0 = Math.max(0, x0), cy0 = Math.max(0, y0), cx1 = Math.min(cw, x0 + w), cy1 = Math.min(ch, y0 + h);
    if (cx1 <= cx0 || cy1 <= cy0) return;
    x0 = cx0; y0 = cy0; w = cx1 - cx0; h = cy1 - cy0;
    const layer = (part) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
      x.setTransform(Dm.a, Dm.b, Dm.c, Dm.d, Dm.e - x0, Dm.f - y0);
      const keep = {fill: o.fill, stroke: o.stroke, strokeWidth: o.strokeWidth};
      if (part === 'fill'){ o.stroke = null; o.strokeWidth = 0; } if (part === 'outline'){ o.fill = null; }
      const op = o.opacity; o.opacity = 1; body(x); o.opacity = op; Object.assign(o, keep);
      return {c, x};
    };
    const masked = T.target === 'fill' ? 'fill' : T.target === 'outline' ? 'outline' : 'both';
    const L = layer(masked);
    // the mask: alpha 1 - transparency, white = opaque in TraceDraw's terms
    L.x.setTransform(1, 0, 0, 1, 0, 0); L.x.globalCompositeOperation = 'destination-in';
    if (T.type === 'uniform'){ L.x.fillStyle = `rgba(0,0,0,${1 - (T.amount != null ? T.amount : 50) / 100})`; L.x.fillRect(0, 0, w, h); }
    else {
      const P = (X, Y) => { const p = Effects.pt(DM, X, Y); return {x: p.x - x0, y: p.y - y0}; };
      const a = P(T.x1, T.y1), e = P(T.x2, T.y2), r = Math.hypot(e.x - a.x, e.y - a.y) || 1;
      const stops = (T.stops || []).slice().sort((p, q) => p.offset - q.offset);
      const add = g => stops.forEach(s => g.addColorStop(Math.max(0, Math.min(1, s.offset)), `rgba(0,0,0,${1 - s.t / 100})`));
      if (T.kind === 'square'){
        // square: the value runs from the centre outwards as max(|dx|, |dy|) along the line's frame
        const img = L.x.getImageData(0, 0, w, h), px = img.data, ang = Math.atan2(e.y - a.y, e.x - a.x), co = Math.cos(-ang), si = Math.sin(-ang);
        const val = u => { if (u <= stops[0].offset) return 1 - stops[0].t / 100; for (let i = 1; i < stops.length; i++) if (u <= stops[i].offset){ const s0 = stops[i - 1], s1 = stops[i], f = (u - s0.offset) / ((s1.offset - s0.offset) || 1); return 1 - (s0.t + (s1.t - s0.t) * f) / 100; } return 1 - stops[stops.length - 1].t / 100; };
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){ const i = (y * w + x) * 4 + 3; if (!px[i]) continue; const dx = x - a.x, dy = y - a.y, u = Math.max(Math.abs(dx * co - dy * si), Math.abs(dx * si + dy * co)) / r; px[i] = Math.round(px[i] * val(u)); }
        L.x.putImageData(img, 0, 0);
      } else {
        const g = T.kind === 'radial' ? L.x.createRadialGradient(a.x, a.y, 0, a.x, a.y, r) : T.kind === 'conical' ? L.x.createConicGradient(Math.atan2(e.y - a.y, e.x - a.x), a.x, a.y) : L.x.createLinearGradient(a.x, a.y, e.x, e.y);
        add(g); L.x.fillStyle = g; L.x.fillRect(0, 0, w, h);
      }
    }
    // the other part (fill or outline) stays solid, drawn in its paint order
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (masked !== 'both'){ const O = layer(masked === 'fill' ? 'outline' : 'fill'); const first = (o.paintFirst === 'stroke') === (masked === 'fill') ? O.c : null;
      if (first) ctx.drawImage(first, x0, y0); ctx.drawImage(L.c, x0, y0); if (!first) ctx.drawImage(O.c, x0, y0); }
    else ctx.drawImage(L.c, x0, y0);
    ctx.restore();
  },
};

/* ---------- opacity masks for clip frames ---------- */
const Mask = {
  draw(cf, ctx){
    const f = cf._objects[0], contents = cf._objects.slice(1), Dm = ctx.getTransform(), DM = [Dm.a, Dm.b, Dm.c, Dm.d, Dm.e, Dm.f];
    const w0 = cf.width / 2 + 2, h0 = cf.height / 2 + 2;
    const pts = [[-w0, -h0], [w0, -h0], [w0, h0], [-w0, h0]].map(([x, y]) => Effects.pt(DM, x, y));
    let x0 = Math.max(0, Math.floor(Math.min(...pts.map(p => p.x)))), y0 = Math.max(0, Math.floor(Math.min(...pts.map(p => p.y))));
    const x1 = Math.min(ctx.canvas.width, Math.ceil(Math.max(...pts.map(p => p.x)))), y1 = Math.min(ctx.canvas.height, Math.ceil(Math.max(...pts.map(p => p.y))));
    const w = x1 - x0, h = y1 - y0; if (w < 1 || h < 1) return;
    const mk = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.setTransform(Dm.a, Dm.b, Dm.c, Dm.d, Dm.e - x0, Dm.f - y0); return {c, x}; };
    const C = mk(), M = mk();
    contents.forEach(o => o.render(C.x));
    const keepStroke = [f.stroke, f.strokeWidth]; f.stroke = null; f.render(M.x); [f.stroke, f.strokeWidth] = keepStroke;
    const ci = C.x.getImageData(0, 0, w, h), mi = M.x.getImageData(0, 0, w, h), cp = ci.data, mp = mi.data, inv = !!cf.invertMask;
    for (let i = 0; i < cp.length; i += 4){
      const ma = mp[i + 3] / 255;
      if (!ma){ cp[i + 3] = 0; continue; }                                   // nothing outside the frame
      const lum = (0.2126 * mp[i] + 0.7152 * mp[i + 1] + 0.0722 * mp[i + 2]) / 255;
      cp[i + 3] = Math.round(cp[i + 3] * (inv ? 1 - lum : lum) * ma);
    }
    C.x.putImageData(ci, 0, 0);
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(C.c, x0, y0); ctx.restore();
  },
};
(function(){
  const CF = fabric.Clipframe.prototype, baseDraw = CF.drawObject, baseSvg = CF._toSVG, baseObj = CF.toObject;
  CF.drawObject = function(ctx, forClipping){ if (this.opacityMask && !forClipping) return Mask.draw(this, ctx); return baseDraw.call(this, ctx, forClipping); };
  CF.toObject = function(props){ return Object.assign(baseObj.call(this, props), {opacityMask: !!this.opacityMask, invertMask: !!this.invertMask}); };
  CF._toSVG = function(reviver){
    if (!this.opacityMask) return baseSvg.call(this, reviver);
    const f = this._objects[0], id = 'mask' + fabric.Object.__uid++, fid = id + 'inv';
    const inv = this.invertMask ? `<filter id="${fid}"><feColorMatrix type="matrix" values="-1 0 0 0 1  0 -1 0 0 1  0 0 -1 0 1  0 0 0 1 0"/></filter>` : '';
    const out = ['<g ', 'COMMON_PARTS', ' >\n', inv, `<mask id="${id}"><g${this.invertMask ? ` filter="url(#${fid})"` : ''}>`, f.toSVG(reviver), '</g></mask>\n', `<g mask="url(#${id})">\n`];
    this._objects.slice(1).forEach(o => out.push('\t\t', o.toSVG(reviver)));
    out.push('</g>\n</g>\n');
    return out;
  };
})();

/* the merge-mode lists (Properties panel and the Transparency bar) */
['oBlend', 'txMerge', 'sxMerge'].forEach(id => { const el = $(id); if (!el) return; const keep = el.value; el.innerHTML = MERGES.map(([v, n]) => `<option value="${v}">${n}</option>`).join(''); el.value = keep || 'source-over'; });
