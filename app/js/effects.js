/* ===================== live effects: drop shadow, contour, envelope, distort =====================
   Ported from TraceDraw's docs/behavior/{drop-shadow,contour,envelope,distort}.md.
   An effect lives in o.fx and is drawn from the object every frame (cached by geometry), so the object
   keeps its own outline and the effect can be changed or cleared at any time.
   Order: the outline → distort → envelope → contour steps → drop shadow of everything. */

const MM = PX_PER_IN / 25.4;    // scene units per millimetre

const Effects = {
  hasAny: o => !!(o && o.fx && (o.fx.shadow || o.fx.contour || o.fx.envelope || o.fx.distort || o.fx.blend || o.fx.transp)),
  warps: o => !!(o && o.fx && (o.fx.envelope || o.fx.distort)),
  canShape: o => o && !['group', 'image', 'activeSelection', 'clipframe'].includes(o.type),

  /* ---------- small math ---------- */
  inv: m => fabric.util.invertTransform(m),
  mul: (a, b) => fabric.util.multiplyTransformMatrices(a, b),
  linear(m){ return [m[0], m[1], m[2], m[3], 0, 0]; },
  pt(m, x, y){ return {x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5]}; },
  lerp: (a, b, t) => ({x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t}),
  bez(p0, p1, p2, p3, t){ const u = 1 - t; return {x: u*u*u*p0.x + 3*u*u*t*p1.x + 3*u*t*t*p2.x + t*t*t*p3.x, y: u*u*u*p0.y + 3*u*u*t*p1.y + 3*u*t*t*p2.y + t*t*t*p3.y}; },
  bezD(p0, p1, p2, p3, t){ const u = 1 - t; return {x: 3*u*u*(p1.x-p0.x) + 6*u*t*(p2.x-p1.x) + 3*t*t*(p3.x-p2.x), y: 3*u*u*(p1.y-p0.y) + 6*u*t*(p2.y-p1.y) + 3*t*t*(p3.y-p2.y)}; },
  accel: (t, a) => Math.pow(t, Math.pow(4, a / 100)),
  rnd(i){ const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); },   // fixed pseudo-random

  /* ---------- the object's own outline, in its own space ---------- */
  // cubic segments per subpath: [{closed, segs: [[p0, c1, c2, p3], ...]}]
  fromPaper(item){
    const kids = item instanceof paper.CompoundPath ? item.children : [item], out = [];
    kids.forEach(p => {
      const segs = [], n = p.segments.length, count = p.closed ? n : n - 1;
      for (let i = 0; i < count; i++){
        const a = p.segments[i], b = p.segments[(i + 1) % n];
        const p0 = {x: a.point.x, y: a.point.y}, p3 = {x: b.point.x, y: b.point.y};
        segs.push([p0, {x: p0.x + a.handleOut.x, y: p0.y + a.handleOut.y}, {x: p3.x + b.handleIn.x, y: p3.y + b.handleIn.y}, p3]);
      }
      if (segs.length) out.push({closed: p.closed, segs});
    });
    return out;
  },
  toD(subs){
    const f = v => +v.toFixed(3);
    return subs.map(s => {
      if (!s.segs.length) return '';
      let d = `M${f(s.segs[0][0].x)} ${f(s.segs[0][0].y)}`;
      s.segs.forEach(([, c1, c2, p3]) => { d += `C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(p3.x)} ${f(p3.y)}`; });
      return d + (s.closed ? 'Z' : '');
    }).join('');
  },
  polyToSubs(polys, closed){
    return polys.filter(p => p.length > 1).map(p => {
      const segs = []; const n = closed ? p.length : p.length - 1;
      for (let i = 0; i < n; i++){ const a = p[i], b = p[(i + 1) % p.length]; segs.push([a, this.lerp(a, b, 1 / 3), this.lerp(a, b, 2 / 3), b]); }
      return {closed, segs};
    });
  },
  baseOutline(o){
    // open paths stay open (envelopes and distortions bend strokes too)
    if (o.type === 'path'){
      const po = o.pathOffset, cmds = o.path.map(c => { const r = [c[0]]; for (let k = 1; k + 1 < c.length; k += 2) r.push(c[k] - po.x, c[k + 1] - po.y); return r; });
      const it = new paper.CompoundPath({pathData: fabric.util.joinPath ? fabric.util.joinPath(cmds) : cmds.map(c => c.join(' ')).join(' '), insert: false});
      return this.fromPaper(it);
    }
    if (o.type === 'line' || o.type === 'polyline'){
      const pts = o.type === 'line' ? (p => [{x: p.x1, y: p.y1}, {x: p.x2, y: p.y2}])(o.calcLinePoints()) : o.points.map(p => ({x: p.x - o.pathOffset.x, y: p.y - o.pathOffset.y}));
      return this.polyToSubs([pts], false);
    }
    const it = o.text != null ? TextCurves.item(o) : Shaping.svgItem(o);
    if (!it) return [];
    it.transform(new paper.Matrix(...this.inv(o.calcTransformMatrix())));
    return this.fromPaper(it);
  },
  boundsOf(subs){
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    subs.forEach(s => s.segs.forEach(seg => seg.forEach(p => { if (p.x < x0) x0 = p.x; if (p.y < y0) y0 = p.y; if (p.x > x1) x1 = p.x; if (p.y > y1) y1 = p.y; })));
    return {x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2};
  },
  flatten(subs, step){   // points along each subpath, at most `step` apart
    return subs.map(s => {
      const pts = [s.segs[0][0]];
      s.segs.forEach(q => {
        const straight = Math.hypot(q[1].x - this.lerp(q[0], q[3], 1 / 3).x, q[1].y - this.lerp(q[0], q[3], 1 / 3).y) < 1e-6 && Math.hypot(q[2].x - this.lerp(q[0], q[3], 2 / 3).x, q[2].y - this.lerp(q[0], q[3], 2 / 3).y) < 1e-6;
        const len = Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y) + Math.hypot(q[2].x - q[1].x, q[2].y - q[1].y) + Math.hypot(q[3].x - q[2].x, q[3].y - q[2].y);
        const n = Math.max(1, Math.ceil(len / step));
        for (let k = 1; k <= n; k++) pts.push(this.bez(...q, k / n));
      });
      if (s.closed) pts.pop();
      return {closed: s.closed, pts};
    });
  },

  /* ---------- distort ---------- */
  distort(subs, d, box){
    const c = {x: d.cx != null ? d.cx : box.cx, y: d.cy != null ? d.cy : box.cy};
    if (d.kind === 'push'){
      const s = Math.max(-200, Math.min(200, d.amount)) / 100, P = (p, k) => ({x: c.x + (p.x - c.x) * k, y: c.y + (p.y - c.y) * k});
      return subs.map(sp => ({closed: sp.closed, segs: sp.segs.map(([p0, c1, c2, p3]) => [P(p0, 1 + s), P(c1, 1 - s), P(c2, 1 - s), P(p3, 1 + s)])}));
    }
    let dmax = 0; subs.forEach(sp => sp.segs.forEach(q => { dmax = Math.max(dmax, Math.hypot(q[0].x - c.x, q[0].y - c.y), Math.hypot(q[3].x - c.x, q[3].y - c.y)); }));
    dmax = dmax || 1;
    if (d.kind === 'zipper'){
      const A = Math.max(0, d.amp), F = Math.max(0, Math.round(d.freq)), out = [];
      if (!F || !A) return subs;
      let tooth = 0;
      subs.forEach(sp => {
        const pts = [sp.segs[0][0]];
        sp.segs.forEach(q => {
          const n = 2 * F;
          for (let k = 1; k < n; k++){
            const t = k / n, p = this.bez(...q, t), dv = this.bezD(...q, t), l = Math.hypot(dv.x, dv.y) || 1;
            let a = A * (k % 2 ? 1 : -1);
            if (d.random) a *= 0.3 + 0.7 * this.rnd(tooth++);
            if (d.local) a *= Math.max(0, 1 - Math.hypot(p.x - c.x, p.y - c.y) / dmax);
            pts.push({x: p.x - dv.y / l * a, y: p.y + dv.x / l * a});
          }
          pts.push(q[3]);
        });
        if (sp.closed) pts.pop();
        out.push(d.smooth ? this.smooth(pts, sp.closed) : this.polyToSubs([pts], sp.closed)[0]);
      });
      return out;
    }
    if (d.kind === 'twister'){
      const ang = fabric.util.degreesToRadians(d.angle), b = this.boundsOf(subs), step = Math.max(b.w, b.h) / 64;
      return this.flatten(subs, step).map(({closed, pts}) => this.smooth(pts.map(p => {
        const a = ang * Math.hypot(p.x - c.x, p.y - c.y) / dmax, co = Math.cos(a), si = Math.sin(a), vx = p.x - c.x, vy = p.y - c.y;
        return {x: c.x + vx * co - vy * si, y: c.y + vx * si + vy * co};
      }), closed));
    }
    return subs;
  },
  // Catmull-Rom through the points, as cubic segments
  smooth(pts, closed){
    const n = pts.length, segs = [], get = i => closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))];
    const count = closed ? n : n - 1;
    for (let i = 0; i < count; i++){
      const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
      segs.push([p1, {x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6}, {x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6}, p2]);
    }
    return {closed, segs};
  },

  /* ---------- envelope ---------- */
  frame(box){
    const {x0, y0, x1, y1, cx, cy} = box;
    const P = [[x0, y1, 1], [cx, y1, 0], [x1, y1, 1], [x1, cy, 0], [x1, y0, 1], [cx, y0, 0], [x0, y0, 1], [x0, cy, 0]];   // from bottom-left round
    const nodes = P.map(([x, y, c]) => ({x, y, corner: !!c}));
    this.straightHandles(nodes);
    return nodes;
  },
  straightHandles(nodes, only){
    const n = nodes.length;
    nodes.forEach((a, i) => { if (only && !only.has(i)) return; const b = nodes[(i + 1) % n]; a.out = this.lerp(a, b, 1 / 3); b.in = this.lerp(a, b, 2 / 3); });
  },
  sides(nodes){   // node index runs: bottom (BL→BR), right (BR→TR), top (TR→TL), left (TL→BL)
    const cs = nodes.map((nd, i) => nd.corner ? i : -1).filter(i => i >= 0), n = nodes.length, run = (a, b) => { const r = [a]; for (let i = a; i !== b; ){ i = (i + 1) % n; r.push(i); } return r; };
    return {bottom: run(cs[0], cs[1]), right: run(cs[1], cs[2]), top: run(cs[2], cs[3]), left: run(cs[3], cs[0])};
  },
  sideSegs(nodes, idx, reverse){
    const segs = [];
    for (let k = 0; k + 1 < idx.length; k++){ const a = nodes[idx[k]], b = nodes[idx[k + 1]]; segs.push([a, a.out, b.in, b]); }
    return reverse ? segs.reverse().map(([a, c1, c2, b]) => [b, c2, c1, a]) : segs;
  },
  sideEval(segs, s, lens){
    s = Math.max(0, Math.min(1, s));
    let i, t;
    if (lens){ const tot = lens[lens.length - 1], target = s * tot; i = lens.findIndex(L => L >= target); i = Math.max(0, Math.min(segs.length - 1, i)); const L0 = i ? lens[i - 1] : 0; t = (target - L0) / ((lens[i] - L0) || 1); }
    else { const f = s * segs.length; i = Math.min(segs.length - 1, Math.floor(f)); t = f - i; }
    return this.bez(...segs[i], t);
  },
  cumLens(segs){ let acc = 0; return segs.map(q => { let L = 0, prev = q[0]; for (let k = 1; k <= 16; k++){ const p = this.bez(...q, k / 16); L += Math.hypot(p.x - prev.x, p.y - prev.y); prev = p; } return (acc += L); }); },
  envelopeMapper(env, box){
    const nodes = env.nodes, S = this.sides(nodes);
    const B = this.sideSegs(nodes, S.bottom), R = this.sideSegs(nodes, S.right), T = this.sideSegs(nodes, S.top, true), L = this.sideSegs(nodes, S.left, true);
    const byLen = env.mapping === 'original', lens = byLen ? [B, T, L, R].map(x => this.cumLens(x)) : [null, null, null, null];
    const P00 = nodes[S.bottom[0]], P10 = nodes[S.right[0]], P11 = nodes[S.top[0]], P01 = nodes[S.left[0]];
    const coons = (u, v) => {
      const b = this.sideEval(B, u, lens[0]), t = this.sideEval(T, u, lens[1]), l = this.sideEval(L, v, lens[2]), r = this.sideEval(R, v, lens[3]);
      return {x: (1 - v) * b.x + v * t.x + (1 - u) * l.x + u * r.x - ((1 - u) * (1 - v) * P00.x + u * (1 - v) * P10.x + (1 - u) * v * P01.x + u * v * P11.x),
              y: (1 - v) * b.y + v * t.y + (1 - u) * l.y + u * r.y - ((1 - u) * (1 - v) * P00.y + u * (1 - v) * P10.y + (1 - u) * v * P01.y + u * v * P11.y)};
    };
    let map = coons;
    if (env.mapping === 'horizontal' || env.mapping === 'vertical'){
      const poly = []; [B, R, T.slice().reverse().map(([a, c1, c2, b]) => [b, c2, c1, a]), L.slice().reverse().map(([a, c1, c2, b]) => [b, c2, c1, a])].forEach(side => side.forEach(q => { for (let k = 0; k < 24; k++) poly.push(this.bez(...q, k / 24)); }));
      const fb = poly.reduce((a, p) => ({x0: Math.min(a.x0, p.x), x1: Math.max(a.x1, p.x), y0: Math.min(a.y0, p.y), y1: Math.max(a.y1, p.y)}), {x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity});
      const cross = (horiz, val) => {
        const hits = [];
        for (let i = 0; i < poly.length; i++){ const a = poly[i], b = poly[(i + 1) % poly.length], A = horiz ? a.y : a.x, Bv = horiz ? b.y : b.x;
          if ((A - val) * (Bv - val) <= 0 && A !== Bv){ const t = (val - A) / (Bv - A); hits.push(horiz ? a.x + (b.x - a.x) * t : a.y + (b.y - a.y) * t); } }
        return hits.length ? [Math.min(...hits), Math.max(...hits)] : null;
      };
      map = env.mapping === 'horizontal'
        ? (u, v) => { const y = fb.y1 - v * (fb.y1 - fb.y0), h = cross(true, y); return h ? {x: h[0] + u * (h[1] - h[0]), y} : coons(u, v); }
        : (u, v) => { const x = fb.x0 + u * (fb.x1 - fb.x0), h = cross(false, x); return h ? {x, y: h[1] - v * (h[1] - h[0])} : coons(u, v); };
    }
    const bw = box.w || 1, bh = box.h || 1;
    return p => map((p.x - box.x0) / bw, (box.y1 - p.y) / bh);
  },
  envelope(subs, env){
    const box = env.box, f = this.envelopeMapper(env, box);
    if (env.keepLines) return subs.map(sp => ({closed: sp.closed, segs: sp.segs.map(q => q.map(f))}));
    const step = Math.max(box.w, box.h) / 400;
    return this.flatten(subs, step).map(({closed, pts}) => this.polyToSubs([pts.map(f)], closed)[0]);
  },

  /* ---------- contour (Clipper offsets, in page units) ---------- */
  contour(subsScene, c, fill, stroke){
    const K = 1000, polys = this.flatten(subsScene, 0.15).filter(s => s.closed).map(s => s.pts.map(p => ({X: Math.round(p.x * K), Y: Math.round(p.y * K)})));
    if (!polys.length) return [];
    const join = c.corners === 'round' ? ClipperLib.JoinType.jtRound : ClipperLib.JoinType.jtMiter;
    const off = d => c.corners === 'bevel' ? this.bevelOffset(polys, d * K) : (() => { const co = new ClipperLib.ClipperOffset(12.7, 0.05 * K); co.AddPaths(polys, join, ClipperLib.EndType.etClosedPolygon); const sol = new ClipperLib.Paths(); co.Execute(sol, d * K); return sol; })();
    const steps = [];
    if (c.mode === 'center'){
      for (let i = 1; i <= 400; i++){ const s = off(-i * c.offset); if (!s.length) break; steps.push(s); }
    } else {
      const n = Math.max(1, Math.min(999, Math.round(c.steps)));
      for (let i = 1; i <= n; i++) steps.push(off((c.mode === 'inside' ? -1 : 1) * n * c.offset * this.accel(i / n, c.objAcc || 0)));
    }
    const n = steps.length;
    return steps.map((sol, k) => {
      const t = this.accel((k + 1) / n, c.colAcc || 0);
      return {d: sol.map(p => 'M' + p.map(q => `${q.X / K} ${q.Y / K}`).join('L') + 'Z').join(''),
              fill: fill ? this.mix(fill, c.endFill, t, c.colorDir) : null, stroke: stroke ? this.mix(stroke, c.endStroke, t, c.colorDir) : null};
    }).filter(s => s.d);
  },
  // Clipper has no bevel join: build a band of width 2|d| along every edge with a triangle at each node
  // (the bevel), then add it to the shape (outward) or cut it out (inward)
  bevelOffset(polys, d){
    const r = Math.abs(d), band = [];
    polys.forEach(p => {
      const n = p.length, nrm = [];
      for (let i = 0; i < n; i++){ const a = p[i], b = p[(i + 1) % n], dx = b.X - a.X, dy = b.Y - a.Y, l = Math.hypot(dx, dy) || 1; nrm.push({x: dy / l * r, y: -dx / l * r}); }
      for (let i = 0; i < n; i++){
        const a = p[i], b = p[(i + 1) % n], m = nrm[i], q = nrm[(i - 1 + n) % n];
        band.push([{X: a.X + m.x, Y: a.Y + m.y}, {X: b.X + m.x, Y: b.Y + m.y}, {X: b.X - m.x, Y: b.Y - m.y}, {X: a.X - m.x, Y: a.Y - m.y}].map(v => ({X: Math.round(v.X), Y: Math.round(v.Y)})));
        [1, -1].forEach(sg => band.push([{X: a.X, Y: a.Y}, {X: Math.round(a.X + sg * q.x), Y: Math.round(a.Y + sg * q.y)}, {X: Math.round(a.X + sg * m.x), Y: Math.round(a.Y + sg * m.y)}]));
      }
    });
    const cl = new ClipperLib.Clipper(), out = new ClipperLib.Paths();
    cl.AddPaths(polys, ClipperLib.PolyType.ptSubject, true);
    cl.AddPaths(band, ClipperLib.PolyType.ptClip, true);
    cl.Execute(d >= 0 ? ClipperLib.ClipType.ctUnion : ClipperLib.ClipType.ctDifference, out, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
    return out;
  },
  mix(a, b, t, dir){
    const A = new fabric.Color(a), B = new fabric.Color(b);
    if (!dir || dir === 'direct'){ const s = A.getSource(), e = B.getSource(); return `rgba(${[0, 1, 2].map(i => Math.round(s[i] + (e[i] - s[i]) * t)).join(',')},${s[3] + (e[3] - s[3]) * t})`; }
    const ha = A.toHsl ? null : null;
    const hsl = c => { const [r, g, bb] = c.getSource().map((v, i) => i < 3 ? v / 255 : v), mx = Math.max(r, g, bb), mn = Math.min(r, g, bb), l = (mx + mn) / 2, d = mx - mn;
      let h = 0, s = 0; if (d){ s = d / (1 - Math.abs(2 * l - 1)); h = mx === r ? ((g - bb) / d) % 6 : mx === g ? (bb - r) / d + 2 : (r - g) / d + 4; h *= 60; if (h < 0) h += 360; } return [h, s, l]; };
    const [h1, s1, l1] = hsl(A), [h2, s2, l2] = hsl(B);
    let dh = h2 - h1; if (dir === 'cw' && dh < 0) dh += 360; if (dir === 'ccw' && dh > 0) dh -= 360;
    return `hsl(${(h1 + dh * t + 360) % 360},${(s1 + (s2 - s1) * t) * 100}%,${(l1 + (l2 - l1) * t) * 100}%)`;
  },

  /* ---------- computing and caching ---------- */
  sig(o){
    const g = ['type', 'width', 'height', 'text', 'fontSize', 'fontFamily', 'fontWeight', 'fontStyle', 'charSpacing', 'lineHeight', 'textAlign', 'rx', 'ry', 'radius', 'underline', 'pathSide', 'pathStartOffset', 'pathAlign'].map(k => o[k]);
    const m = this.linear(o.calcTransformMatrix()).map(v => +v.toFixed(4));
    return JSON.stringify([g, o.path && (o.type === 'path' ? o.path.length + ':' + JSON.stringify(o.path).length + ':' + JSON.stringify(o.path).slice(0, 400) : o.path.path && o.path.path.length), o.points && o.points.length, o.fx, m, o.fill && typeof o.fill === 'object' ? 'g' : o.fill, o.stroke, o.strokeWidth]);
  },
  compute(o){
    if (!o.fx || !this.canShape(o) || !(o.fx.contour || o.fx.envelope || o.fx.distort)) return null;
    if (o.text != null && !window.TEE_FONT_TTF){ TextCurves.ready().then(() => canvas.requestRenderAll()); return null; }
    const sig = this.sig(o);
    if (o.__fx && o.__fx.sig === sig) return o.__fx;
    Shaping.init();
    let out = null;
    try {
      let subs = this.baseOutline(o);
      if (!subs.length) return null;
      const box0 = this.boundsOf(subs);
      if (o.fx.distort) subs = this.distort(subs, o.fx.distort, box0);
      if (o.fx.envelope){ if (!o.fx.envelope.box) o.fx.envelope.box = box0; subs = this.envelope(subs, o.fx.envelope); }
      const warped = !!(o.fx.distort || o.fx.envelope);
      const geomD = warped ? this.toD(subs) : null;
      // contour works in page units: the outline turned and scaled like the object, without the move
      let contours = [], M0 = this.linear(o.calcTransformMatrix());
      if (o.fx.contour){
        const scene = subs.map(s => ({closed: s.closed, segs: s.segs.map(q => q.map(p => this.pt(M0, p.x, p.y)))}));
        const fill = o.fill && typeof o.fill === 'string' ? o.fill : o.fill && o.fill.colorStops ? o.fill.colorStops[0].color : null;
        contours = this.contour(scene, o.fx.contour, fill, o.strokeWidth ? o.stroke : null);
      }
      const bLocal = this.boundsOf(subs);
      out = {sig, box0, geomD, geomPath: geomD ? this.commands(geomD) : null, contours: contours.map(c => Object.assign(c, {path2d: new Path2D(c.d)})), M0, invM0: this.inv(M0), bLocal, warped};
      // local bounds of everything drawn (the contours too)
      if (contours.length){
        let x0 = bLocal.x0, y0 = bLocal.y0, x1 = bLocal.x1, y1 = bLocal.y1;
        contours.forEach(c => c.d.replace(/[ML]([-\d.e]+) ([-\d.e]+)/g, (_, X, Y) => { const p = this.pt(out.invM0, +X, +Y); x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }));
        out.bLocal = {x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2};
      }
    } catch (e){ console.warn('effect failed', e); out = null; }
    finally { paper.project.clear(); }
    o.__fx = out;
    return out;
  },
  commands(d){ return fabric.util.makePathSimpler(fabric.util.parsePath(d)); },
  trace(ctx, cmds){
    ctx.beginPath();
    cmds.forEach(c => { if (c[0] === 'M') ctx.moveTo(c[1], c[2]); else if (c[0] === 'L') ctx.lineTo(c[1], c[2]); else if (c[0] === 'C') ctx.bezierCurveTo(c[1], c[2], c[3], c[4], c[5], c[6]); else if (c[0] === 'Q') ctx.quadraticCurveTo(c[1], c[2], c[3], c[4]); else if (c[0] === 'Z') ctx.closePath(); });
  },
  // local bounds of the object as drawn without its shadow
  drawnBounds(o){
    const fx = this.compute(o);
    if (fx) return fx.bLocal;
    const w = o.width + (o.strokeWidth || 0), h = o.height + (o.strokeWidth || 0);
    return {x0: -w / 2, y0: -h / 2, x1: w / 2, y1: h / 2, w, h, cx: 0, cy: 0};
  },

  /* ---------- drawing ---------- */
  drawBody(o, ctx, plain){
    const fx = this.compute(o), P = fabric.Object.prototype;
    const lw = o.strokeWidth || 0;
    const drawSteps = list => list.forEach(s => {
      ctx.save(); ctx.transform(...fx.invM0);
      if (s.fill){ ctx.fillStyle = s.fill; ctx.fill(s.path2d, 'evenodd'); }
      if (s.stroke && lw){ ctx.strokeStyle = s.stroke; ctx.lineWidth = lw * (o.strokeUniform ? 1 : Math.abs(o.scaleX)); ctx.lineJoin = 'round'; ctx.stroke(s.path2d); }
      ctx.restore();
    });
    const c = o.fx.contour;
    if (fx && c && c.mode === 'outside') drawSteps(fx.contours.slice().reverse());        // farthest first, behind
    if (fx && fx.warped){
      // the warped outline with the object's own fill and outline
      const fr = o.fillRule; if (o.text != null) o.fillRule = 'nonzero';
      this.trace(ctx, fx.geomPath); P._renderPaintInOrder.call(o, ctx);
      o.fillRule = fr;
    } else plain(ctx);
    if (fx && c && c.mode !== 'outside') drawSteps(fx.contours);                          // outermost first, in front
  },
  drawShadow(o, ctx, plain){
    const s = o.fx.shadow, Dm = ctx.getTransform(), DM = [Dm.a, Dm.b, Dm.c, Dm.d, Dm.e, Dm.f];
    // the blurred shadow is kept as a bitmap and only moved while nothing but the position changes
    const key = [this.sig(o), JSON.stringify(o.fx), DM.slice(0, 4).map(v => v.toFixed(4)).join(), ctx.canvas === canvas.lowerCanvasEl].join('|');
    const hit = o.__shadowCache;
    if (hit && hit.key === key){ this.blitShadow(ctx, s, hit.c, Dm.e + hit.dx, Dm.f + hit.dy); return; }
    const scale = Math.sqrt(Math.abs(Dm.a * Dm.d - Dm.b * Dm.c)) || 1;
    const b = this.drawnBounds(o), pad = (o.strokeWidth || 0) + 2 / scale;
    const corners = [[b.x0 - pad, b.y0 - pad], [b.x1 + pad, b.y0 - pad], [b.x1 + pad, b.y1 + pad], [b.x0 - pad, b.y1 + pad]];
    // 1. the silhouette, in device pixels
    const dc = corners.map(([x, y]) => this.pt(DM, x, y));
    const sx0 = Math.floor(Math.min(...dc.map(p => p.x))), sy0 = Math.floor(Math.min(...dc.map(p => p.y))), sw = Math.ceil(Math.max(...dc.map(p => p.x))) - sx0, sh = Math.ceil(Math.max(...dc.map(p => p.y))) - sy0;
    if (sw < 1 || sh < 1 || sw * sh > 6e7) return;
    const sil = document.createElement('canvas'); sil.width = sw; sil.height = sh;
    const sc = sil.getContext('2d'); sc.setTransform(Dm.a, Dm.b, Dm.c, Dm.d, Dm.e - sx0, Dm.f - sy0);
    const op = o.opacity; o.opacity = 1;
    this.drawBody(o, sc, plain);
    o.opacity = op;
    sc.setTransform(1, 0, 0, 1, 0, 0); sc.globalCompositeOperation = 'source-in'; sc.fillStyle = s.color || '#000'; sc.fillRect(0, 0, sw, sh);
    // 2. where the shadow falls, in the object's own space
    let Pm;
    const lin = this.linear(o.calcTransformMatrix()), il = this.inv(lin);
    let A = null, E = null;
    if (!s.kind || s.kind === 'flat'){
      const v = this.pt(il, s.dx, s.dy);             // offsets are on the page; turned into the object's space
      Pm = [1, 0, 0, 1, v.x, v.y];
    } else {
      const e = this.edge(b, s), Lx = e.L;
      A = e.A; E = e.E;
      const wv = {x: E.x - A.x - Lx * e.n.x, y: E.y - A.y - Lx * e.n.y}, k = {x: wv.x / Lx, y: wv.y / Lx}, nA = e.n.x * A.x + e.n.y * A.y;
      Pm = [1 + k.x * e.n.x, k.y * e.n.x, k.x * e.n.y, 1 + k.y * e.n.y, -k.x * nA, -k.y * nA];
    }
    const T = this.mul(this.mul(DM, Pm), this.inv(DM));       // device → device
    const feather = Math.max(0, s.feather || 0) * scale, margin = Math.ceil(feather * 3 + 2);
    const tc = [[0, 0], [sw, 0], [sw, sh], [0, sh]].map(([x, y]) => this.pt(T, x + sx0, y + sy0));
    let ox0 = Math.floor(Math.min(...tc.map(p => p.x))) - margin, oy0 = Math.floor(Math.min(...tc.map(p => p.y))) - margin;
    let ow = Math.ceil(Math.max(...tc.map(p => p.x))) + margin - ox0, oh = Math.ceil(Math.max(...tc.map(p => p.y))) + margin - oy0;
    // never larger than the canvas being drawn on (plus the blur)
    const cw = ctx.canvas.width, ch = ctx.canvas.height;
    const cx0 = Math.max(ox0, -margin), cy0 = Math.max(oy0, -margin), cx1 = Math.min(ox0 + ow, cw + margin), cy1 = Math.min(oy0 + oh, ch + margin);
    if (cx1 <= cx0 || cy1 <= cy0) return;
    const clamped = cx0 !== ox0 || cy0 !== oy0 || cx1 !== ox0 + ow || cy1 !== oy0 + oh;
    ox0 = cx0; oy0 = cy0; ow = cx1 - cx0; oh = cy1 - cy0;
    const outC = document.createElement('canvas'); outC.width = ow; outC.height = oh;
    const oc = outC.getContext('2d');
    if (feather > 0.01) oc.filter = `blur(${(s.dir === 'average' ? 1.7 / Math.sqrt(3) : 1) * feather}px)`;
    oc.setTransform(...this.mul([1, 0, 0, 1, -ox0, -oy0], this.mul(T, [1, 0, 0, 1, sx0, sy0])));
    oc.drawImage(sil, 0, 0);
    oc.filter = 'none'; oc.setTransform(1, 0, 0, 1, 0, 0);
    // 3. feather direction and edges reshape the blurred coverage
    if ((s.dir && s.dir !== 'middle' && s.dir !== 'average') || (s.edges && s.edges !== 'linear')){
      const img = oc.getImageData(0, 0, ow, oh), px = img.data;
      for (let i = 3; i < px.length; i += 4){
        let t = px[i] / 255;
        if (s.dir === 'outside') t = Math.min(1, 2 * t); else if (s.dir === 'inside') t = Math.max(0, 2 * t - 1);
        if (s.edges === 'squared') t = t * t; else if (s.edges === 'invsquared') t = 1 - (1 - t) * (1 - t); else if (s.edges === 'flat') t = t > 0.01 ? 1 : 0;
        px[i] = Math.round(t * 255);
      }
      oc.putImageData(img, 0, 0);
    }
    // 4. a perspective shadow fades from its edge to its far end
    if (A && s.fade){
      const a = this.pt(DM, A.x, A.y), e = this.pt(DM, E.x, E.y), g = oc.createLinearGradient(a.x - ox0, a.y - oy0, e.x - ox0, e.y - oy0);
      g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, `rgba(0,0,0,${1 - s.fade / 100})`);
      oc.globalCompositeOperation = 'destination-in'; oc.fillStyle = g; oc.fillRect(0, 0, ow, oh);
    }
    // a shadow cut off by the canvas edge can't be reused once the object moves
    o.__shadowCache = clamped ? null : {key, c: outC, dx: ox0 - Dm.e, dy: oy0 - Dm.f};
    this.blitShadow(ctx, s, outC, ox0, oy0);
  },
  // 5. merged with what lies beneath
  blitShadow(ctx, s, c, x, y){
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = ctx.globalAlpha * (s.opacity != null ? s.opacity / 100 : 0.5);
    ctx.globalCompositeOperation = s.merge || 'multiply';
    ctx.drawImage(c, x, y);
    ctx.restore();
  },
  // perspective: the edge it stands on, in the object's own space
  edge(b, s){
    const kind = s.kind, L = kind === 'left' || kind === 'right' ? b.w : b.h, a = fabric.util.degreesToRadians(s.angle != null ? s.angle : 20), st = (s.stretch != null ? s.stretch : 60) / 100;
    const E = {
      bottom: {A: {x: b.cx, y: b.y1}, n: {x: 0, y: -1}, t: {x: 1, y: 0}},
      top:    {A: {x: b.cx, y: b.y0}, n: {x: 0, y: 1},  t: {x: 1, y: 0}},
      left:   {A: {x: b.x0, y: b.cy}, n: {x: 1, y: 0},  t: {x: 0, y: -1}},
      right:  {A: {x: b.x1, y: b.cy}, n: {x: -1, y: 0}, t: {x: 0, y: -1}},
    }[kind];
    const dir = {x: Math.cos(a) * E.t.x + Math.sin(a) * E.n.x, y: Math.cos(a) * E.t.y + Math.sin(a) * E.n.y};
    return {A: E.A, n: E.n, L: L || 1, E: {x: E.A.x + st * L * dir.x, y: E.A.y + st * L * dir.y}};
  },

  /* ---------- presets and defaults ---------- */
  defaults: {
    shadow: {kind: 'flat', dx: 2 * MM, dy: 2 * MM, angle: 20, stretch: 60, fade: 50, opacity: 50, feather: 1.5 * MM, dir: 'middle', edges: 'linear', merge: 'multiply', color: '#000000'},
    contour: {mode: 'outside', steps: 3, offset: 2 * MM, corners: 'miter', colorDir: 'direct', endFill: '#ffffff', endStroke: '#000000', objAcc: 0, colAcc: 0},
    envelope: {mapping: 'putty', keepLines: false},
    distort: {kind: 'push', amount: 20, amp: 2 * MM, freq: 6, random: false, smooth: false, local: false, angle: 90},
  },
  SHADOW_PRESETS: {
    soft:   {kind: 'flat', dx: 2 * MM, dy: 2 * MM, feather: 3 * MM, opacity: 50, dir: 'middle', merge: 'multiply'},
    tight:  {kind: 'flat', dx: 1 * MM, dy: 1 * MM, feather: 0.5 * MM, opacity: 70, dir: 'middle', merge: 'multiply'},
    lifted: {kind: 'flat', dx: 4 * MM, dy: 6 * MM, feather: 6 * MM, opacity: 40, dir: 'middle', merge: 'multiply'},
    hard:   {kind: 'flat', dx: 2 * MM, dy: 2 * MM, feather: 0, opacity: 100, dir: 'middle', merge: 'source-over'},
    glow:   {kind: 'flat', dx: 0, dy: 0, feather: 4 * MM, opacity: 85, dir: 'outside', merge: 'source-over', color: '#fde68a'},
    floorR: {kind: 'bottom', angle: 20, stretch: 60, fade: 50, feather: 1.5 * MM, opacity: 50, merge: 'multiply'},
    floorL: {kind: 'bottom', angle: 160, stretch: 60, fade: 50, feather: 1.5 * MM, opacity: 50, merge: 'multiply'},
    wall:   {kind: 'bottom', angle: 70, stretch: 90, fade: 60, feather: 2 * MM, opacity: 40, merge: 'multiply'},
  },
  envelopePreset(name, box){
    const nodes = this.frame(box), {w, h} = box, [BL, BM, BR, RM, TR, TM, TL, LM] = nodes;
    const arcSides = (...sides) => { const S = this.sides(nodes); sides.forEach(k => this.singleArc(nodes, S[k])); };
    if (name === 'arch'){ TM.y -= 0.3 * h; BM.y -= 0.3 * h; arcSides('top', 'bottom'); }
    if (name === 'bulge'){ TM.y -= 0.18 * h; BM.y += 0.18 * h; LM.x -= 0.12 * w; RM.x += 0.12 * w; arcSides('top', 'bottom', 'left', 'right'); }
    if (name === 'squeeze'){ TM.y += 0.15 * h; BM.y -= 0.15 * h; arcSides('top', 'bottom'); }
    if (name === 'perspective'){ TL.x += 0.2 * w; TR.x -= 0.2 * w; TM.x = (TL.x + TR.x) / 2; this.straightHandles(nodes); }
    if (name === 'flag'){
      const amp = 0.12 * h;
      [[BL, BM, BR], [TR, TM, TL]].forEach(([a, m, b], k) => {
        const dir = k ? -1 : 1;  // walk direction of the side
        a.out = {x: a.x + dir * w / 6, y: a.y - amp}; m.in = {x: m.x - dir * w / 6, y: m.y - amp};
        m.out = {x: m.x + dir * w / 6, y: m.y + amp}; b.in = {x: b.x - dir * w / 6, y: b.y + amp};
      });
    }
    if (name === 'circle'){
      const r = {x: w / 2, y: h / 2}, c = {x: box.cx, y: box.cy}, kk = 4 / 3 * Math.tan(Math.PI / 16);
      const angles = [135, 90, 45, 0, -45, -90, -135, 180].map(a => fabric.util.degreesToRadians(a));   // y-down: 90° is the bottom
      nodes.forEach((nd, i) => { const a = angles[i]; nd.x = c.x + r.x * Math.cos(a); nd.y = c.y + r.y * Math.sin(a); nd.a = a; });
      nodes.forEach((nd, i) => { const nx = nodes[(i + 1) % 8], a0 = nd.a, a1 = a0 - Math.PI / 4;
        nd.out = {x: nd.x + kk * r.x * Math.sin(a0), y: nd.y - kk * r.y * Math.cos(a0)};
        nx.in = {x: nx.x - kk * r.x * Math.sin(a1), y: nx.y + kk * r.y * Math.cos(a1)}; delete nd.a; });
    }
    return nodes;
  },
  // CorelDRAW single arc through a side's nodes (TraceDraw's tangents)
  singleArc(nodes, idx){
    const p = idx.map(i => nodes[i]), m = p.length - 1, t = [];
    for (let i = 1; i < m; i++) t[i] = {x: (p[i + 1].x - p[i - 1].x) / 2, y: (p[i + 1].y - p[i - 1].y) / 2};
    if (m === 1){ t[0] = t[1] = {x: p[1].x - p[0].x, y: p[1].y - p[0].y}; }
    else { t[0] = {x: 2 * (p[1].x - p[0].x) - t[1].x, y: 2 * (p[1].y - p[0].y) - t[1].y}; t[m] = {x: 2 * (p[m].x - p[m - 1].x) - t[m - 1].x, y: 2 * (p[m].y - p[m - 1].y) - t[m - 1].y}; }
    for (let i = 0; i < m; i++){ p[i].out = {x: p[i].x + t[i].x / 3, y: p[i].y + t[i].y / 3}; p[i + 1].in = {x: p[i + 1].x - t[i + 1].x / 3, y: p[i + 1].y - t[i + 1].y / 3}; }
  },
  doubleArc(nodes, idx, horizontal){
    for (let k = 0; k + 1 < idx.length; k++){
      const a = nodes[idx[k]], b = nodes[idx[k + 1]], d = horizontal ? (b.x - a.x) / 3 : (b.y - a.y) / 3;
      a.out = horizontal ? {x: a.x + d, y: a.y} : {x: a.x, y: a.y + d}; b.in = horizontal ? {x: b.x - d, y: b.y} : {x: b.x, y: b.y - d};
    }
  },

  /* ---------- applying to the selection ---------- */
  set(objs, kind, values, replace){
    objs.forEach(o => {
      if (!['shadow', 'transp'].includes(kind) && !this.canShape(o)) return;
      o.fx = Object.assign({}, o.fx);
      if (values === null) delete o.fx[kind];
      else o.fx[kind] = Object.assign({}, replace ? {} : (o.fx[kind] || this.defaults[kind]), values);
      if (!Object.keys(o.fx).length) o.fx = null;
      if (o.fx && kind === 'shadow') o.shadow = null;     // the live drop shadow replaces Fabric's simple one
      o.__fx = null; o.__blend = null; o.dirty = true; o.objectCaching = !this.hasAny(o);
    });
    canvas.requestRenderAll();
  },
  // permanent versions, for SVG export and "Break apart"
  bake(o){
    const fx = this.compute(o), out = [];
    const style = Object.assign(Shaping.styleOf(o), {fillRule: o.text != null ? 'nonzero' : (o.fillRule || 'nonzero')});
    const M = o.calcTransformMatrix();
    const toScene = d => { const it = new paper.CompoundPath({pathData: d, insert: false}); it.transform(new paper.Matrix(...M)); const r = it.pathData; return r; };
    Shaping.init();
    if (fx && fx.contours.length){
        fx.contours.forEach((s, i) => {
        const it = new paper.CompoundPath({pathData: s.d, insert: false}); it.transform(new paper.Matrix(...this.mul(M, fx.invM0)));
        out.push({order: o.fx.contour.mode === 'outside' ? -1 - i : 1 + i, obj: new fabric.Path(it.pathData, {fill: s.fill || '', stroke: s.stroke, strokeWidth: s.stroke ? o.strokeWidth : 0, fillRule: 'evenodd', name: `${nameOf(o)} contour ${i + 1}`})});
      });
    }
    const main = fx && fx.warped ? new fabric.Path(toScene(fx.geomD), Object.assign(style, {name: nameOf(o)})) : null;
    paper.project.clear();
    return {main, steps: out.sort((a, b) => a.order - b.order)};
  },
  sceneBounds(o){
    const b = this.drawnBounds(o), M = o.calcTransformMatrix();
    const pts = [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]].map(([x, y]) => this.pt(M, x, y));
    const s = o.fx && o.fx.shadow, extra = s ? (s.feather || 0) * 3 + Math.max(Math.abs(s.dx || 0), Math.abs(s.dy || 0)) + (s.kind && s.kind !== 'flat' ? Math.max(b.w, b.h) * (s.stretch || 60) / 100 : 0) : 0;
    const bb = o.fx && o.fx.blend ? Blend.bounds(o) : null;
    if (bb) pts.push({x: bb.left, y: bb.top}, {x: bb.left + bb.width, y: bb.top + bb.height});
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    return {left: Math.min(...xs) - extra, top: Math.min(...ys) - extra, width: Math.max(...xs) - Math.min(...xs) + 2 * extra, height: Math.max(...ys) - Math.min(...ys) + 2 * extra};
  },
};

/* ---------- hooking into Fabric's drawing ---------- */
(function(){
  const P = fabric.Object.prototype, baseCache = P.shouldCache;
  // groups (and clip frames) draw their members with their own drawObject, so each class is wrapped
  Effects.wrapDraw = proto => {
    const base = proto.drawObject;
    if (proto === P) Effects.baseDraw = base;
    proto.drawObject = function(ctx, forClipping){
      if (forClipping || !Effects.hasAny(this)) return base.call(this, ctx, forClipping);
      const plain = c => base.call(this, c, forClipping), fx = this.fx;
      if (fx.blend) Blend.draw(this, ctx, 'below');
      if (fx.shadow) Effects.drawShadow(this, ctx, plain);
      const body = c => (fx.contour || fx.envelope || fx.distort) ? Effects.drawBody(this, c, plain) : plain(c);
      if (Transp.needsLayer(this)) Transp.draw(this, ctx, body); else body(ctx);
      if (fx.blend) Blend.draw(this, ctx, 'above');
    };
  };
  Effects.wrapDraw(P); Effects.wrapDraw(fabric.Group.prototype);
  // effects reach past the object's box, so objects that have them (and groups holding them) draw without a cache
  P.shouldCache = function(){
    if (Effects.hasAny(this) || (this._objects && this._objects.some(o => Effects.hasAny(o)))){ this.ownCaching = false; return false; }
    return baseCache.call(this);
  };
  if (fabric.Group.prototype.shouldCache !== P.shouldCache){
    const g = fabric.Group.prototype.shouldCache;
    fabric.Group.prototype.shouldCache = function(){ if (this._objects.some(o => Effects.hasAny(o))){ this.ownCaching = false; return false; } return g.call(this); };
  }
})();
