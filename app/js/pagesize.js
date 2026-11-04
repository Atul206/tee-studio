/* ===================== page size =====================
   The size choice on the New design screen, and File > Page size… for a design already open.
   Sizes are kept in inches; one size for the front and back of a design. */

const PAGE_MM = v => v / 25.4;
const PAGE_PRESETS = [
  ['T-shirt', [['tee', 'Standard front / back', 12, 16], ['over', 'Oversized print', 15, 18], ['youth', 'Youth', 9, 12], ['chest', 'Left chest', 4, 4], ['sleeve', 'Sleeve', 3.5, 12], ['label', 'Neck label', 3, 3]]],
  ['Paper', [['a3', 'A3', PAGE_MM(297), PAGE_MM(420)], ['a4', 'A4', PAGE_MM(210), PAGE_MM(297)], ['a5', 'A5', PAGE_MM(148), PAGE_MM(210)], ['letter', 'Letter', 8.5, 11], ['tabloid', 'Tabloid', 11, 17]]],
];
const PAGE_UNITS = {in: 1, cm: 2.54, mm: 25.4};
const PAGE_MIN = 0.5, PAGE_MAX = 48;   // inches

// one set of fields in `el`; .value() gives {w, h} in inches, always within the limits
class PageFields {
  constructor(el){
    this.w = 12; this.h = 16; this.unit = 'in';
    el.className = 'pagesize';
    el.innerHTML = `<label class="hint">Page size</label>
      <select class="sel"></select>
      <div class="psrow">
        <span class="fld">W <input type="number" min="0" step="any" inputmode="decimal"></span>
        <span class="fld">H <input type="number" min="0" step="any" inputmode="decimal"></span>
        <select class="sel" style="width:auto" title="Units"><option>in</option><option>cm</option><option>mm</option></select>
        <div class="seg"><button type="button" data-o="p" title="Portrait">▯</button><button type="button" data-o="l" title="Landscape">▭</button></div>
      </div>
      <span class="hint"></span>`;
    const [preset, unit] = el.querySelectorAll('select'), [iw, ih] = el.querySelectorAll('input');
    Object.assign(this, {preset, unitEl: unit, iw, ih, note: el.querySelector('span.hint:last-child'), orient: [...el.querySelectorAll('[data-o]')]});
    PAGE_PRESETS.forEach(([group, list]) => {
      const g = document.createElement('optgroup'); g.label = group;
      list.forEach(([id, name, w, h]) => { const o = document.createElement('option'); o.value = id; o.textContent = `${name} (${this.fmt(w)} × ${this.fmt(h)} in)`; g.appendChild(o); });
      preset.appendChild(g);
    });
    const custom = document.createElement('option'); custom.value = 'custom'; custom.textContent = 'Custom size'; preset.appendChild(custom);
    preset.onchange = () => { const p = this.find(preset.value); if (p){ this.w = p[2]; this.h = p[3]; this.show(); } else this.show(); };
    unit.onchange = () => { this.unit = unit.value; this.show(); };
    [[iw, 'w'], [ih, 'h']].forEach(([inp, k]) => inp.oninput = () => { const v = parseFloat(inp.value); if (v > 0){ this[k] = v / PAGE_UNITS[this.unit]; this.match(); this.note.textContent = this.summary(); this.paintOrient(); } });
    [iw, ih].forEach(inp => inp.onblur = () => this.show());
    this.orient.forEach(b => b.onclick = () => { const land = b.dataset.o === 'l'; if (land !== this.w > this.h && this.w !== this.h){ [this.w, this.h] = [this.h, this.w]; this.show(); } });
    this.show();
  }
  fmt(v){ return +v.toFixed(2); }
  find(id){ for (const [, list] of PAGE_PRESETS){ const p = list.find(x => x[0] === id); if (p) return p; } return null; }
  // a preset in either orientation is still that preset
  match(){
    const near = (a, b) => Math.abs(a - b) < 0.005; let id = 'custom';
    PAGE_PRESETS.forEach(([, list]) => list.forEach(p => { if ((near(p[2], this.w) && near(p[3], this.h)) || (near(p[2], this.h) && near(p[3], this.w))) id = p[0]; }));
    this.preset.value = id;
  }
  clamp(v){ return Math.max(PAGE_MIN, Math.min(PAGE_MAX, v)); }
  value(){ return {w: this.clamp(this.w), h: this.clamp(this.h)}; }
  summary(){ const v = this.value(); return `${Math.round(v.w * 300)} × ${Math.round(v.h * 300)} px at 300 dpi · ${PAGE_MIN} to ${PAGE_MAX} in`; }
  paintOrient(){ this.orient.forEach(b => b.classList.toggle('on', b.dataset.o === 'l' ? this.w > this.h : this.w <= this.h)); }
  show(){
    this.w = this.clamp(this.w); this.h = this.clamp(this.h);
    const k = PAGE_UNITS[this.unit], d = this.unit === 'mm' ? 1 : 2;
    this.iw.value = +(this.w * k).toFixed(d); this.ih.value = +(this.h * k).toFixed(d);
    this.match(); this.note.textContent = this.summary(); this.paintOrient();
  }
  set(w, h){ this.w = w; this.h = h; this.show(); }
}

const PageSize = {
  home: new PageFields($('homePage')),
  dlg: null,
  open(){
    if (!this.dlg){
      const m = document.createElement('div'); m.className = 'modal'; m.id = 'pageDlg';
      m.innerHTML = `<div><h3>Page size</h3><div class="pf"></div><span class="hint">Artwork stays where it is on the page: anything now outside the print area is flagged and left out of print exports.</span><div class="foot"><button class="btn ghost" data-c="0">Cancel</button><button class="btn primary" data-c="1">Apply</button></div></div>`;
      document.body.appendChild(m);
      this.fields = new PageFields(m.querySelector('.pf')); this.dlg = m;
      m.querySelector('[data-c="0"]').onclick = () => m.classList.remove('on');
      m.querySelector('[data-c="1"]').onclick = () => { m.classList.remove('on'); this.apply(this.fields.value()); };
      m.addEventListener('pointerdown', e => { if (e.target === m) m.classList.remove('on'); });
    }
    this.fields.set(PA_IN.w, PA_IN.h);
    this.dlg.classList.add('on');
  },
  apply({w, h}){
    if (w === PA_IN.w && h === PA_IN.h) return;
    setPageSize(w, h); refresh(); autosave();
    toast(`Page size ${inchText(w)} × ${inchText(h)} in`);
  },
};
