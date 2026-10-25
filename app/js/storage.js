/* ===================== storage =====================
   Works straight from file:// with no server.
   • Chrome / Edge: the user picks a "designs folder" once (File System Access API). Projects are saved there as
     <name>.tee.json and exports go to exports/<name>/. The folder handle is remembered in IndexedDB.
   • Other browsers: projects are kept in this browser (localStorage) and saves/exports download instead.
   A browser backup of the open project is always kept so nothing is lost if the folder is unavailable. */

const IDB = {
  db: null,
  open(){
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('teestudio', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(this.db = r.result); r.onerror = () => rej(r.error);
    });
  },
  async get(k){ const db = await this.open(); return new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); },
  async set(k, v){ const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); }); },
};
const LS = {
  get(k){ try { return JSON.parse(localStorage.getItem(k)); } catch(e){ return null; } },
  set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch(e){ return false; } },
  del(k){ try { localStorage.removeItem(k); } catch(e){} },
};

const Store = {
  supported: typeof window.showDirectoryPicker === 'function',
  dir: null,            // FileSystemDirectoryHandle of the designs folder
  perm: 'none',         // 'granted' | 'prompt' | 'denied' | 'none'
  name: 'Untitled tee',
  fileName: null,       // current project's file inside the folder
  quiet: false,         // true while a project is being loaded (no saves)
  open: false,          // a project is open in the editor
  saveTimer: null, writing: Promise.resolve(), pending: false,

  slug(n = this.name){ return (n || 'untitled').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 60) || 'untitled'; },
  canWrite(){ return !!this.dir && this.perm === 'granted'; },
  dirName(){ return this.dir ? this.dir.name : ''; },

  async init(){
    if (!this.supported) return;
    try {
      const h = await IDB.get('dir');
      if (h){ this.dir = h; this.perm = await h.queryPermission({mode: 'readwrite'}); }
    } catch(e){ console.warn('Could not restore designs folder', e); }
  },
  async connect(){
    if (!this.supported) return toast('Saving into a folder needs Chrome or Edge. In this browser your work is kept in the browser and downloads instead.');
    try {
      const h = await window.showDirectoryPicker({id: 'teestudio', mode: 'readwrite', startIn: this.dir || 'documents'});
      this.dir = h; this.perm = 'granted';
      try { await IDB.set('dir', h); } catch(e){}
      toast(`Designs folder: ${h.name}`);
      if (this.open){ this.fileName = null; await this.saveNow(true); }
      Home.render(); setStatus();
    } catch(e){ if (e.name !== 'AbortError') toast('Could not open that folder: ' + e.message); }
  },
  async reconnect(){
    if (!this.dir) return this.connect();
    try { this.perm = await this.dir.requestPermission({mode: 'readwrite'}); } catch(e){ this.perm = 'denied'; }
    if (this.perm !== 'granted') toast('Permission was not given — pick the folder again');
    Home.render(); setStatus();
  },

  /* ----- project list ----- */
  async list(){
    if (this.canWrite()){
      const out = [];
      for await (const [n, h] of this.dir.entries()){
        if (h.kind !== 'file' || !n.endsWith('.tee.json')) continue;
        try {
          const f = await h.getFile(), d = JSON.parse(await f.text());
          out.push({file: n, name: d.name || n.replace(/\.tee\.json$/, ''), updated: d.updated || f.lastModified, thumb: d.thumb, where: 'folder'});
        } catch(e){ out.push({file: n, name: n, updated: 0, broken: true, where: 'folder'}); }
      }
      return out.sort((a, b) => new Date(b.updated) - new Date(a.updated));
    }
    const idx = LS.get('teestudio.projects') || {};
    return Object.entries(idx).map(([file, m]) => Object.assign({file, where: 'browser'}, m)).sort((a, b) => new Date(b.updated) - new Date(a.updated));
  },
  async read(item){
    if (item.where === 'folder'){ const h = await this.dir.getFileHandle(item.file); return JSON.parse(await (await h.getFile()).text()); }
    return LS.get('teestudio.p.' + item.file);
  },
  async uniqueFile(base){
    const taken = new Set((await this.list()).map(p => p.file));
    let n = base + '.tee.json', i = 2;
    while (taken.has(n)) n = `${base}-${i++}.tee.json`;
    return n;
  },

  /* ----- open / new ----- */
  openData(data, fileName, where, resave){
    this.quiet = true;
    this.name = data.name || (fileName || 'Untitled tee').replace(/\.tee\.json$|\.json$/, '');
    // a file picked from disk is adopted into the folder (or the browser) on its next save
    this.fileName = where ? fileName : null;
    openProject(data, () => {
      if (data.page && data.page !== 'front') switchPage(data.page);
      this.quiet = false; this.open = true; Home.hide(); setStatus();
      if (!where || resave) this.saveNow();
      toast(`Opened “${this.name}”`);
    });
  },
  async openItem(item){
    try { this.openData(await this.read(item), item.file, item.where); }
    catch(e){ toast('Could not open that project: ' + e.message); }
  },
  async newProject(name, sample){
    this.quiet = true; this.name = name.trim() || 'Untitled tee'; this.fileName = null;
    pages = {front: null, back: null}; page = 'front'; setPageVisual();
    loadJSON(null, () => {
      if (sample) buildSample();
      hist = []; hi = -1; snapshot();
      this.quiet = false; this.open = true; Home.hide();
      this.saveNow(); setStatus();
    });
  },

  /* ----- saving ----- */
  changed(){
    if (this.quiet || !this.open) return;
    LS.set('teestudio.backup', Object.assign(projectData(), {_file: this.fileName, _where: this.canWrite() ? 'folder' : 'browser'}));   // crash/close safety net
    this.pending = true; setStatus('Saving…');
    clearTimeout(this.saveTimer); this.saveTimer = setTimeout(() => this.saveNow(), 900);
  },
  thumb(){
    try { return canvas.toDataURL(Object.assign({format: 'png'}, cropArgs(12))); } catch(e){ return null; }
  },
  saveNow(explicit){
    clearTimeout(this.saveTimer);
    if (!this.open) return;
    const data = Object.assign(projectData(), {updated: new Date().toISOString(), thumb: this.thumb()});
    this.writing = this.writing.then(async () => {
      try {
        if (!this.fileName) this.fileName = await this.uniqueFile(this.slug());
        if (this.canWrite()){
          const h = await this.dir.getFileHandle(this.fileName, {create: true});
          const w = await h.createWritable(); await w.write(JSON.stringify(data)); await w.close();
        } else {
          const idx = LS.get('teestudio.projects') || {};
          const ok = LS.set('teestudio.p.' + this.fileName, data);
          idx[this.fileName] = {name: data.name, updated: data.updated, thumb: data.thumb}; LS.set('teestudio.projects', idx);
          if (!ok) throw new Error('browser storage is full — connect a designs folder or download a copy');
        }
        LS.set('teestudio.last', {file: this.fileName, where: this.canWrite() ? 'folder' : 'browser'});
        this.pending = false; setStatus();
        if (explicit) toast(this.canWrite() ? `Saved to ${this.dirName()}/${this.fileName}` : 'Saved in this browser');
      } catch(e){
        console.error(e); this.pending = true;
        if (this.dir && e.name === 'NotAllowedError'){ this.perm = 'prompt'; }
        setStatus('Not saved — ' + e.message);
        if (explicit) toast('Save failed: ' + e.message);
      }
    });
    return this.writing;
  },
  async rename(newName){
    newName = newName.trim(); if (!newName || newName === this.name) return;
    const old = this.fileName; this.name = newName; this.fileName = await this.uniqueFile(this.slug());
    await this.saveNow();
    try {
      if (old && old !== this.fileName){
        if (this.canWrite()) await this.dir.removeEntry(old);
        else { const idx = LS.get('teestudio.projects') || {}; delete idx[old]; LS.set('teestudio.projects', idx); LS.del('teestudio.p.' + old); }
      }
    } catch(e){}
    setStatus(); toast(`Renamed to “${newName}”`);
  },
  renamePrompt(){ const n = prompt('Design name', this.name); if (n) this.rename(n); },
  async remove(item){
    if (item.where === 'folder') await this.dir.removeEntry(item.file);
    else { const idx = LS.get('teestudio.projects') || {}; delete idx[item.file]; LS.set('teestudio.projects', idx); LS.del('teestudio.p.' + item.file); }
  },

  /* ----- exports: into <folder>/exports/<project>/, else a download ----- */
  async output(blob, relPath, silent){
    const file = `${this.slug()}-${relPath.split('/').pop()}`;
    if (this.canWrite()){
      let d = await this.dir.getDirectoryHandle('exports', {create: true});
      d = await d.getDirectoryHandle(this.slug(), {create: true});
      const parts = relPath.split('/'), leaf = parts.pop();
      for (const p of parts) d = await d.getDirectoryHandle(p, {create: true});
      const h = await d.getFileHandle(leaf, {create: true}), w = await h.createWritable();
      await w.write(blob); await w.close();
      const where = `${this.dirName()}/exports/${this.slug()}/${relPath}`;
      if (!silent) toast('Saved ' + where);
      return where;
    }
    const url = URL.createObjectURL(blob); download(url, file); setTimeout(() => URL.revokeObjectURL(url), 30000);
    if (!silent) toast('Downloaded ' + file);
    return file;
  },
};

/* ---------- status in the menu bar ---------- */
function setStatus(msg){
  const el = $('docname'); if (!el) return;
  const where = Store.canWrite() ? `${Store.dirName()}/${Store.fileName || Store.slug() + '.tee.json'}` : Store.dir ? 'folder needs permission — kept in browser' : 'kept in this browser';
  el.innerHTML = '';
  const n = document.createElement('b'); n.textContent = Store.name; n.title = 'Click to rename'; n.onclick = () => Store.renamePrompt();
  const s = document.createElement('span'); s.className = 'savestate' + (msg && msg.startsWith('Not saved') ? ' bad' : '');
  s.textContent = msg || (Store.pending ? 'Saving…' : `✓ Saved · ${where}`);
  el.append(n, s);
  if (Store.dir && Store.perm !== 'granted'){
    const b = document.createElement('button'); b.className = 'btn ghost mini'; b.textContent = 'Reconnect folder'; b.onclick = () => Store.reconnect(); el.append(b);
  }
}
window.addEventListener('beforeunload', e => { if (Store.pending){ Store.saveNow(); e.preventDefault(); e.returnValue = ''; } });

/* ===================== home screen ===================== */
const Home = {
  el: null,
  show(){ $('home').classList.add('on'); this.render(); },
  hide(){ $('home').classList.remove('on'); },
  async render(){
    const f = $('homeFolder');
    if (!Store.supported){
      f.innerHTML = `<div class="hf warn"><b>This browser can’t save into a folder.</b> Open this file in <b>Chrome</b> or <b>Edge</b> to save projects and exports next to the app. Here, projects are kept inside this browser and exports download.</div>`;
    } else if (Store.canWrite()){
      f.innerHTML = `<div class="hf ok"><b>Designs folder:</b> <code></code> <span>Projects save here automatically · exports go to <code>exports/</code></span> <button class="btn ghost mini" id="hfChange">Change folder</button></div>`;
      f.querySelector('code').textContent = Store.dirName();
      $('hfChange').onclick = () => Store.connect();
    } else if (Store.dir){
      f.innerHTML = `<div class="hf warn"><b>Reconnect your designs folder</b> <code></code> — the browser asks once per visit. <button class="btn primary mini" id="hfRe">Reconnect</button> <button class="btn ghost mini" id="hfChange">Pick another</button></div>`;
      f.querySelector('code').textContent = Store.dirName();
      $('hfRe').onclick = () => Store.reconnect(); $('hfChange').onclick = () => Store.connect();
    } else {
      f.innerHTML = `<div class="hf"><b>Choose where your work is saved.</b> Pick the <code>my-designs</code> folder that came with Tee Studio (or any folder). Projects and exports are written there as real files you can copy, back up or share. <button class="btn primary mini" id="hfPick">Choose designs folder</button></div>`;
      $('hfPick').onclick = () => Store.connect();
    }
    const backup = LS.get('teestudio.backup');
    $('homeResume').style.display = backup && !Store.open ? 'flex' : 'none';
    if (backup) $('homeResumeName').textContent = backup.name || 'Untitled tee';
    $('homeClose').style.display = Store.open ? 'inline-flex' : 'none';
    const grid = $('homeList'); grid.innerHTML = '<div class="empty">Loading…</div>';
    let items = [];
    try { items = await Store.list(); } catch(e){ grid.innerHTML = `<div class="empty">Could not read the folder: ${e.message}</div>`; return; }
    $('homeCount').textContent = items.length ? `${items.length} design${items.length > 1 ? 's' : ''} · ${Store.canWrite() ? 'in ' + Store.dirName() : 'in this browser'}` : '';
    grid.innerHTML = items.length ? '' : `<div class="empty">No saved designs yet. Start a new one on the left.</div>`;
    items.forEach(it => {
      const c = document.createElement('div'); c.className = 'pcard' + (it.file === Store.fileName && Store.open ? ' cur' : '');
      c.innerHTML = `<div class="pthumb"></div><div class="pmeta"><b></b><small></small></div><button class="pdel" title="Delete design">🗑</button>`;
      if (it.thumb) c.querySelector('.pthumb').style.backgroundImage = `url("${it.thumb}")`;
      c.querySelector('b').textContent = it.name;
      c.querySelector('small').textContent = it.broken ? 'Unreadable file' : new Date(it.updated).toLocaleString([], {dateStyle: 'medium', timeStyle: 'short'});
      c.onclick = e => { if (!e.target.closest('.pdel')) Store.openItem(it); };
      c.querySelector('.pdel').onclick = async () => {
        if (!confirm(`Delete “${it.name}”${it.where === 'folder' ? ' from ' + Store.dirName() : ''}? Exports are kept.`)) return;
        try { await Store.remove(it); if (it.file === Store.fileName){ Store.fileName = null; } this.render(); } catch(e){ toast('Delete failed: ' + e.message); }
      };
      grid.appendChild(c);
    });
  },
};
$('homeNew').onclick = () => Store.newProject($('homeName').value, false);
$('homeSample').onclick = () => Store.newProject($('homeName').value || 'Stay Wild', true);
$('homeOpenFile').onclick = () => $('fileOpen').click();
$('homeResume').onclick = () => {
  const b = LS.get('teestudio.backup'); if (!b) return;
  const same = b._file && b._where === (Store.canWrite() ? 'folder' : 'browser');
  Store.openData(b, same ? b._file : (b.name || 'Untitled tee') + '.tee.json', same ? b._where : undefined, true);
};
$('homeClose').onclick = () => Home.hide();
$('homeName').addEventListener('keydown', e => { if (e.key === 'Enter') $('homeNew').click(); });
