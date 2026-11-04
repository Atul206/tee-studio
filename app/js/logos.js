/* ===================== logo templates =====================
   A logo is plain data (window.TEE_LOGOS, written to logos/logos.js by the MCP server in mcp/) and appears as
   a card in Assets. Coordinates are in the logo's own units, usually the pixels of the image it was traced from.

   spec = {name, viewBox: [x, y, w, h], widthIn?, elements: [...]}, drawn bottom to top. Elements:
     path      {d, fill, stroke, strokeWidth, fillRule, cap, join}
     polyline  {points: [[x, y]...], smooth, closed, fill, stroke, strokeWidth}
     circle    {cx, cy, r, fill, stroke, strokeWidth}
     dots      {points: [[x, y, r?]...], r, fill}
     text      {text, x, y, align, fontFamily, fontSize, fontWeight, fill, angle, charSpacing}
     arcText   {text, cx, cy, r, startDeg, endDeg, direction, fontFamily, fontSize, fontWeight, fill}
   Angles: 0 = right, 90 = down. "cw" text runs over the top with letters outside the circle; "ccw" runs along
   the bottom with letters inside, reading left to right. The letters are spaced to fill the arc. */

const LogoTemplates = {
  list: () => window.TEE_LOGOS || [],
  fonts(spec){ return Promise.all(spec.elements.filter(e => e.text != null).map(e => document.fonts.load(`${e.fontWeight || 400} 16px "${e.fontFamily || 'Montserrat'}"`).catch(() => {}))); },
  // what an element paints, with `ink` replacing every colour (for comparing against a photo)
  paint(e, ink){
    const c = v => v && v !== 'none' ? (ink || v) : '';
    return {fill: c(e.fill), stroke: c(e.stroke) || null, strokeWidth: e.stroke && e.stroke !== 'none' ? (e.strokeWidth == null ? 1 : e.strokeWidth) : 0, fillRule: e.fillRule || 'nonzero', strokeLineCap: e.cap || 'round', strokeLineJoin: e.join || 'round', strokeUniform: false, objectCaching: false, name: e.name};
  },
  circleD: (x, y, r) => `M${x - r} ${y}A${r} ${r} 0 1 0 ${x + r} ${y}A${r} ${r} 0 1 0 ${x - r} ${y}Z`,
  element(e, ink, box){
    if (e.type === 'path') return new fabric.Path(e.d, this.paint(e, ink));
    if (e.type === 'circle') return new fabric.Path(this.circleD(e.cx, e.cy, e.r), this.paint(e, ink));
    if (e.type === 'dots') return new fabric.Path(e.points.map(p => this.circleD(p[0], p[1], p[2] || e.r || 1)).join(''), this.paint(e, ink));
    if (e.type === 'polyline'){
      const pts = e.points.map(p => ({x: p[0], y: p[1]}));
      const d = e.smooth ? Effects.toD([Effects.smooth(pts, !!e.closed)]) : 'M' + pts.map(q => `${q.x} ${q.y}`).join('L') + (e.closed ? 'Z' : '');
      return new fabric.Path(d, this.paint(e, ink));
    }
    if (e.type === 'text'){
      const t = new fabric.IText(e.text, this.textStyle(e, ink, {textAlign: e.align || 'center', angle: e.angle || 0, charSpacing: e.charSpacing || 0}));
      t.setPositionByOrigin(new fabric.Point(e.x, e.y), e.align === 'left' ? 'left' : e.align === 'right' ? 'right' : 'center', 'center'); t.setCoords();
      return t;
    }
    if (e.type === 'arcText') return this.arcText(e, ink, box);
    throw new Error('Unknown logo element: ' + e.type);
  },
  textStyle(e, ink, extra){ return Object.assign({fontFamily: e.fontFamily || 'Montserrat', fontSize: e.fontSize || 12, fontWeight: e.fontWeight || 400, fill: ink || e.fill || '#000000', name: e.name || e.text.slice(0, 40), objectCaching: false}, extra); },
  arcText(e, ink, box){
    const cw = e.direction !== 'ccw', sweep = cw ? ((e.endDeg - e.startDeg) % 360 + 360) % 360 : ((e.startDeg - e.endDeg) % 360 + 360) % 360, s = cw ? 1 : -1;
    const P = (a, r) => ({x: e.cx + r * Math.cos(a * Math.PI / 180), y: e.cy + r * Math.sin(a * Math.PI / 180)});
    const a = P(e.startDeg, e.r), b = P(e.startDeg + s * (sweep + 8), e.r), size = e.fontSize || 12;
    const t = new fabric.IText(e.text, this.textStyle(e, ink, {textAlign: 'left', charSpacing: 0}));
    const want = e.r * sweep * Math.PI / 180;
    if (e.text.length > 1) t.set('charSpacing', (want - t.calcTextWidth()) / (e.text.length - 1) / size * 1000);
    const p = new fabric.Path(`M${a.x} ${a.y}A${e.r} ${e.r} 0 ${sweep + 8 > 180 ? 1 : 0} ${cw ? 1 : 0} ${b.x} ${b.y}`, {visible: false, fill: '', stroke: '', strokeWidth: 0});
    t.set({path: p, pathSide: 'left', pathStartOffset: 0, pathAlign: 'baseline'});
    t.initDimensions(); t.setPositionByOrigin(new fabric.Point(p.pathOffset.x, p.pathOffset.y), 'center', 'center'); t.setCoords();
    // letters stand off their circle: the group's box has to reach round them
    const out = e.r + (cw ? size * 0.78 : size * 0.1);
    for (let k = 0; k <= sweep; k += 3) box.push(P(e.startDeg + s * k, out));
    return t;
  },
  build(spec, ink){
    const box = [], parts = spec.elements.map(e => this.element(e, ink, box));
    if (box.length){
      const xs = box.map(q => q.x), ys = box.map(q => q.y), m = (x, y) => `M${x} ${y}L${x} ${y}`;
      parts.unshift(new fabric.Path(m(Math.min(...xs), Math.min(...ys)) + m(Math.max(...xs), Math.max(...ys)), {fill: '#000000', strokeWidth: 0, name: 'Logo box', objectCaching: false}));
    }
    return new fabric.Group(parts, {name: spec.name, objectCaching: false});
  },
  async add(spec){
    await this.fonts(spec);
    const g = this.build(spec), wIn = spec.widthIn || 10;
    g.scale(Math.min(wIn * PX_PER_IN / g.width, PA_W * 0.96 / g.width, PA_H * 0.96 / g.height));
    addAndSelect(placeCenter(g)); snapshot(); refresh();
    return g;
  },
  // Assets > Logos
  cards(){
    const list = this.list(); if (!list.length) return;
    const after = document.querySelector('[data-tpl="marker"]'); if (!after) return;
    const sec = document.createElement('div'); sec.className = 'sec'; sec.id = 'logoSec';
    sec.innerHTML = '<h4>Logos</h4><div class="grid2"></div>';
    after.closest('.sec').after(sec);
    list.forEach(spec => {
      const b = document.createElement('button'); b.className = 'card'; b.title = spec.name;
      b.style.cssText = 'height:60px;justify-content:flex-start;gap:8px;font-size:11px;overflow:hidden;background-clip:padding-box';
      const thumb = this.thumb(spec), label = document.createElement('span'); label.textContent = spec.name;
      if (thumb) b.appendChild(thumb);
      b.appendChild(label);
      b.onclick = () => this.add(spec);
      sec.querySelector('.grid2').appendChild(b);
    });
  },
  thumb(spec){
    try {
      const [x, y, w, h] = spec.viewBox, ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`); svg.setAttribute('width', 36); svg.setAttribute('height', 36); svg.style.cssText = 'flex:0 0 auto;background:#3a3b40;border-radius:4px';
      spec.elements.forEach(e => {
        if (e.type === 'path'){ const p = document.createElementNS(ns, 'path'); p.setAttribute('d', e.d); this.svgPaint(p, e); svg.appendChild(p); }
        else if (e.type === 'circle'){ const p = document.createElementNS(ns, 'path'); p.setAttribute('d', this.circleD(e.cx, e.cy, e.r)); this.svgPaint(p, e); svg.appendChild(p); }
        else if (e.type === 'dots'){ const p = document.createElementNS(ns, 'path'); p.setAttribute('d', e.points.map(q => this.circleD(q[0], q[1], q[2] || e.r || 1)).join('')); this.svgPaint(p, e); svg.appendChild(p); }
        else if (e.type === 'polyline'){ const p = document.createElementNS(ns, 'polyline'); p.setAttribute('points', e.points.map(q => q.slice(0, 2).join(',')).join(' ')); this.svgPaint(p, e); svg.appendChild(p); }
      });
      return svg;
    } catch (e){ return null; }
  },
  svgPaint(p, e){ p.setAttribute('fill', e.fill || 'none'); p.setAttribute('fill-rule', e.fillRule || 'nonzero'); if (e.stroke && e.stroke !== 'none'){ p.setAttribute('stroke', e.stroke); p.setAttribute('stroke-width', e.strokeWidth == null ? 1 : e.strokeWidth); } },
};
LogoTemplates.cards();
