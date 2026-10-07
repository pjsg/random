'use strict';

// ---------- Storage ----------
const CFG_KEY = 'rng.configs.v1';
const stateKey = id => 'rng.state.v1.' + id;
const $ = id => document.getElementById(id);

function loadConfigs() {
  try { return JSON.parse(localStorage.getItem(CFG_KEY)) || []; } catch { return []; }
}
function saveConfigs(list) { localStorage.setItem(CFG_KEY, JSON.stringify(list)); }
function loadState(id) {
  try { return JSON.parse(localStorage.getItem(stateKey(id))) || { groups: {}, history: [] }; }
  catch { return { groups: {}, history: [] }; }
}
function saveState(id, st) { localStorage.setItem(stateKey(id), JSON.stringify(st)); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

// ---------- Random helpers ----------
function randInt(n) { // uniform integer in [0, n) for n up to 2^53
  if (n <= 1) return 0;
  const c = window.crypto;
  if (n <= 0x100000000 && c && c.getRandomValues) {
    const lim = Math.floor(0x100000000 / n) * n;
    const buf = new Uint32Array(1);
    do { c.getRandomValues(buf); } while (buf[0] >= lim);
    return buf[0] % n;
  }
  return Math.floor(Math.random() * n);
}

// ---------- Field model ----------
function decimals(x) {
  const s = String(x);
  if (s.includes('e-')) return parseInt(s.split('e-')[1], 10);
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}
function fieldSize(f) {
  if (f.type === 'list') return f.values.length;
  return Math.floor(Math.round((f.max - f.min) / f.step * 1e9) / 1e9) + 1;
}
function fieldValue(f, k) {
  if (f.type === 'list') return f.values[k];
  const d = Math.max(decimals(f.step), decimals(f.min));
  return (f.min + k * f.step).toFixed(d);
}
function randomDisplay(f) { return fieldValue(f, randInt(fieldSize(f))); }

// Validate + normalise a config object (from editor or import). Throws Error with message.
function normalise(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Configuration must be a JSON object.');
  const name = String(raw.name || '').trim();
  if (!name) throw new Error('Configuration needs a name.');
  if (!Array.isArray(raw.fields) || !raw.fields.length) throw new Error('Configuration needs at least one field.');
  const fields = raw.fields.map((r, i) => {
    const where = `Field ${i + 1}: `;
    const fname = String(r.name || '').trim() || `Field ${i + 1}`;
    let type = r.type;
    if (type !== 'number' && type !== 'list') type = Array.isArray(r.values) ? 'list' : 'number';
    const f = { name: fname, type, group: String(r.group || '').trim() };
    if (type === 'number') {
      f.min = Number(r.min ?? 1);
      f.max = Number(r.max ?? 100);
      f.step = Number(r.step ?? 1);
      if (![f.min, f.max, f.step].every(Number.isFinite)) throw new Error(where + 'min, max and step must be numbers.');
      if (f.step <= 0) throw new Error(where + 'step must be greater than 0.');
      if (f.max < f.min) throw new Error(where + 'max must be ≥ min.');
      if (fieldSize(f) > 1e12) throw new Error(where + 'range is too large.');
    } else {
      let vals = r.values;
      if (typeof vals === 'string') vals = vals.split(/[\n,]/);
      if (!Array.isArray(vals)) throw new Error(where + 'values must be a list.');
      f.values = vals.map(v => String(v).trim()).filter(v => v !== '');
      if (!f.values.length) throw new Error(where + 'needs at least one value.');
    }
    return f;
  });
  // Optional top-level "groups": [["Field A","Field B"], ...] by field name
  if (Array.isArray(raw.groups)) {
    raw.groups.forEach((names, gi) => {
      if (!Array.isArray(names)) return;
      names.forEach(n => {
        const f = fields.find(x => x.name === n);
        if (f && !f.group) f.group = 'G' + (gi + 1);
      });
    });
  }
  // Check group sizes are representable
  for (const [g, fs] of Object.entries(groupsOf({ fields }))) {
    const size = fs.reduce((p, f) => p * fieldSize(f), 1);
    if (size > Number.MAX_SAFE_INTEGER) throw new Error(`Group "${g}" has too many combinations.`);
  }
  return { id: raw.id || uid(), name, fields };
}

function groupsOf(cfg) {
  const g = {};
  cfg.fields.forEach(f => { if (f.group) (g[f.group] = g[f.group] || []).push(f); });
  return g;
}
function groupSize(fs) { return fs.reduce((p, f) => p * fieldSize(f), 1); }
function signature(cfg) { return JSON.stringify(cfg.fields); }

// ---------- Generation ----------
// Pick an unused combination index for a group; returns {index, reset}
function pickUnused(total, used) {
  let reset = false;
  if (used.size >= total) { used.clear(); reset = true; }
  const remaining = total - used.size;
  if (used.size < total / 2 || total > 2e6) {
    let n;
    do { n = randInt(total); } while (used.has(n));
    return { index: n, reset };
  }
  let skip = randInt(remaining);
  for (let n = 0; n < total; n++) {
    if (used.has(n)) continue;
    if (skip-- === 0) return { index: n, reset };
  }
  throw new Error('unreachable');
}

function generate(cfg, st) {
  const result = new Array(cfg.fields.length);
  const notes = [];
  const gs = groupsOf(cfg);
  for (const [g, fs] of Object.entries(gs)) {
    const total = groupSize(fs);
    const used = new Set(st.groups[g] || []);
    const { index, reset } = pickUnused(total, used);
    if (reset) notes.push(`Group "${g}" was exhausted – starting over.`);
    used.add(index);
    st.groups[g] = Array.from(used);
    let rem = index;
    for (let i = fs.length - 1; i >= 0; i--) { // mixed-radix decode
      const s = fieldSize(fs[i]);
      const k = rem % s; rem = Math.floor(rem / s);
      result[cfg.fields.indexOf(fs[i])] = fieldValue(fs[i], k);
    }
  }
  cfg.fields.forEach((f, i) => { if (!f.group) result[i] = randomDisplay(f); });
  return { values: result, notes };
}

// ---------- Views ----------
let configs = loadConfigs();
let current = null;   // config being run / edited
let editing = null;   // draft while editing
let rolling = false;

function show(view) {
  for (const v of ['viewHome', 'viewRun', 'viewEdit']) $(v).classList.toggle('hidden', v !== view);
  window.scrollTo(0, 0);
}
function setMsg(el, text, kind) { el.textContent = text || ''; el.className = 'msg' + (kind ? ' ' + kind : '') + (el.classList.contains('center') ? ' center' : ''); }

function summary(cfg) {
  const gs = Object.keys(groupsOf(cfg)).length;
  return `${cfg.fields.length} field${cfg.fields.length === 1 ? '' : 's'}` +
    (gs ? ` · ${gs} no-repeat group${gs === 1 ? '' : 's'}` : '') +
    ' — ' + cfg.fields.map(f => f.name).join(', ');
}

function renderHome() {
  const box = $('configList');
  box.textContent = '';
  $('emptyMsg').classList.toggle('hidden', configs.length > 0);
  configs.forEach(cfg => {
    const card = document.createElement('div');
    card.className = 'card';
    const h = document.createElement('h3'); h.textContent = cfg.name;
    const m = document.createElement('div'); m.className = 'meta'; m.textContent = summary(cfg);
    const row = document.createElement('div'); row.className = 'row';
    const use = document.createElement('button'); use.className = 'primary'; use.textContent = 'Use';
    use.onclick = () => openRun(cfg.id);
    const ed = document.createElement('button'); ed.textContent = 'Edit';
    ed.onclick = () => openEdit(cfg.id);
    row.append(use, ed);
    card.append(h, m, row);
    box.append(card);
  });
  show('viewHome');
}

// ----- Run view -----
function openRun(id) {
  current = configs.find(c => c.id === id);
  if (!current) return renderHome();
  const st = loadState(id);
  if (st.sig !== signature(current)) { st.groups = {}; st.history = []; st.sig = signature(current); saveState(id, st); }
  $('runName').textContent = current.name;
  const tiles = $('tiles');
  tiles.textContent = '';
  current.fields.forEach(f => {
    const t = document.createElement('div'); t.className = 'tile';
    if (f.group) { const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = '⟳̸ ' + f.group; tag.title = 'No-repeat group ' + f.group; t.append(tag); }
    const l = document.createElement('div'); l.className = 'label'; l.textContent = f.name;
    const v = document.createElement('div'); v.className = 'value'; v.textContent = '–';
    t.append(l, v);
    tiles.append(t);
  });
  setMsg($('runMsg'), '');
  renderHistory(st);
  renderGroupInfo(st);
  show('viewRun');
}

function renderHistory(st) {
  const ol = $('history');
  ol.textContent = '';
  if (!st.history.length) { const li = document.createElement('li'); li.textContent = 'Nothing generated yet.'; ol.append(li); return; }
  st.history.forEach(h => {
    const li = document.createElement('li');
    h.forEach((v, i) => {
      if (i) li.append(' · ');
      const b = document.createElement('b'); b.textContent = v; li.append(b);
    });
    ol.append(li);
  });
}

function renderGroupInfo(st) {
  const box = $('groupInfo');
  box.textContent = '';
  const gs = groupsOf(current);
  const names = Object.keys(gs);
  box.classList.toggle('hidden', !names.length);
  if (!names.length) return;
  const h = document.createElement('h3'); h.textContent = 'Without-replacement groups'; box.append(h);
  names.forEach(g => {
    const total = groupSize(gs[g]);
    const used = (st.groups[g] || []).length;
    const row = document.createElement('div'); row.className = 'ginfo';
    const t = document.createElement('span');
    t.textContent = `${g} (${gs[g].map(f => f.name).join(' + ')}): ${used} of ${total.toLocaleString()} combinations used`;
    const b = document.createElement('button'); b.className = 'small'; b.textContent = 'Reset';
    b.onclick = () => {
      const s = loadState(current.id); delete s.groups[g]; saveState(current.id, s);
      renderGroupInfo(s); setMsg($('runMsg'), `Group "${g}" reset.`, 'ok');
    };
    row.append(t, b); box.append(row);
  });
}

function onGenerate() {
  if (rolling || !current) return;
  const st = loadState(current.id);
  st.sig = signature(current);
  const { values, notes } = generate(current, st);
  st.history = [values, ...st.history].slice(0, 50);
  saveState(current.id, st); // persist immediately so a reload can't replay a value
  setMsg($('runMsg'), '');
  animate(values, () => {
    renderHistory(st);
    renderGroupInfo(st);
    if (notes.length) setMsg($('runMsg'), notes.join(' '), 'ok');
  });
}

function animate(finals, done) {
  rolling = true;
  $('genBtn').disabled = true;
  const tiles = Array.from($('tiles').children);
  const n = tiles.length;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const start = performance.now();
  const stopAt = tiles.map((_, i) => 650 + (n > 1 ? (i / (n - 1)) * 350 : 350)); // all settled within ~1s
  const lastSwap = tiles.map(() => 0);
  const settled = tiles.map(() => false);
  tiles.forEach(t => { t.classList.remove('landed'); t.classList.add('rolling'); });

  function frame(now) {
    const dt = now - start;
    let pending = 0;
    tiles.forEach((t, i) => {
      if (settled[i]) return;
      const val = t.querySelector('.value');
      if (dt >= stopAt[i] || reduce && dt >= 100) {
        settled[i] = true;
        val.textContent = finals[i];
        t.classList.remove('rolling');
        void t.offsetWidth; // restart pop animation
        t.classList.add('landed');
      } else {
        pending++;
        // slow down the flicker as we approach the end
        const gap = 40 + (dt / stopAt[i]) * 90;
        if (now - lastSwap[i] > gap) { val.textContent = randomDisplay(current.fields[i]); lastSwap[i] = now; }
      }
    });
    if (pending) requestAnimationFrame(frame);
    else { rolling = false; $('genBtn').disabled = false; done(); }
  }
  requestAnimationFrame(frame);
}

// ----- Edit view -----
function openEdit(id) {
  if (id) {
    const c = configs.find(x => x.id === id);
    editing = JSON.parse(JSON.stringify(c));
    $('editTitle').textContent = 'Edit configuration';
    $('deleteBtn').classList.remove('hidden');
  } else {
    editing = {
      id: uid(), name: '',
      fields: [{ name: 'Number', type: 'number', min: 1, max: 100, step: 1, group: '' }]
    };
    $('editTitle').textContent = 'New configuration';
    $('deleteBtn').classList.add('hidden');
  }
  $('cfgName').value = editing.name;
  renderFieldEditors();
  setMsg($('editMsg'), '');
  show('viewEdit');
}

function renderFieldEditors() {
  const box = $('fieldEditors');
  box.textContent = '';
  editing.fields.forEach((f, i) => {
    const w = document.createElement('div'); w.className = 'field-ed';
    w.innerHTML = `
      <div class="head"><b>Field ${i + 1}</b>
        <span><button class="small up">↑</button> <button class="small down">↓</button> <button class="small danger rm">Remove</button></span></div>
      <div class="grid">
        <label>Name<input class="f-name"></label>
        <label>Type<select class="f-type"><option value="number">Numeric</option><option value="list">List of values</option></select></label>
        <label>No-repeat group<input class="f-group" placeholder="(none)" maxlength="20" list="groupNames"></label>
      </div>
      <div class="num grid3">
        <label>Min<input class="f-min" type="number" step="any"></label>
        <label>Max<input class="f-max" type="number" step="any"></label>
        <label>Step<input class="f-step" type="number" step="any" min="0"></label>
      </div>
      <div class="lst">
        <label style="margin-top:10px">Values (one per line, or comma separated)<textarea class="f-values" rows="4" placeholder="Blue&#10;Red&#10;Green&#10;Orange"></textarea></label>
      </div>`;
    const q = s => w.querySelector(s);
    q('.f-name').value = f.name;
    q('.f-type').value = f.type;
    q('.f-group').value = f.group || '';
    q('.f-min').value = f.min ?? 1;
    q('.f-max').value = f.max ?? 100;
    q('.f-step').value = f.step ?? 1;
    q('.f-values').value = (f.values || []).join('\n');
    const sync = () => {
      q('.num').classList.toggle('hidden', f.type !== 'number');
      q('.lst').classList.toggle('hidden', f.type !== 'list');
    };
    sync();
    q('.f-name').oninput = e => f.name = e.target.value;
    q('.f-group').oninput = e => f.group = e.target.value;
    q('.f-type').onchange = e => { f.type = e.target.value; sync(); };
    q('.f-min').oninput = e => f.min = e.target.value;
    q('.f-max').oninput = e => f.max = e.target.value;
    q('.f-step').oninput = e => f.step = e.target.value;
    q('.f-values').oninput = e => f.values = e.target.value.split(/[\n,]/);
    q('.rm').onclick = () => { if (editing.fields.length > 1) { editing.fields.splice(i, 1); renderFieldEditors(); } };
    q('.up').onclick = () => { if (i > 0) { [editing.fields[i - 1], editing.fields[i]] = [f, editing.fields[i - 1]]; renderFieldEditors(); } };
    q('.down').onclick = () => { if (i < editing.fields.length - 1) { [editing.fields[i + 1], editing.fields[i]] = [f, editing.fields[i + 1]]; renderFieldEditors(); } };
    box.append(w);
  });
  let dl = $('groupNames');
  if (!dl) { dl = document.createElement('datalist'); dl.id = 'groupNames'; document.body.append(dl); }
  dl.textContent = '';
  ['A', 'B', 'C'].forEach(g => { const o = document.createElement('option'); o.value = g; dl.append(o); });
}

function onSave() {
  editing.name = $('cfgName').value;
  let cfg;
  try { cfg = normalise(editing); } catch (e) { return setMsg($('editMsg'), e.message, 'err'); }
  cfg.id = editing.id;
  upsert(cfg);
  localStorage.removeItem(stateKey(cfg.id)); // structure may have changed
  renderHome();
}

function upsert(cfg) {
  const i = configs.findIndex(c => c.id === cfg.id);
  if (i >= 0) configs[i] = cfg; else configs.push(cfg);
  saveConfigs(configs);
}

// ----- Import / export -----
function importObject(obj) {
  const arr = Array.isArray(obj) ? obj : [obj];
  const added = arr.map(o => {
    const cfg = normalise({ ...o, id: undefined }); // always a fresh id
    upsert(cfg);
    return cfg.name;
  });
  renderHome();
  setMsg($('importMsg'), `Imported: ${added.join(', ')}`, 'ok');
}

async function importFromUrl(url) {
  setMsg($('importMsg'), 'Fetching…');
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    importObject(await res.json());
  } catch (e) {
    setMsg($('importMsg'), 'Import failed: ' + e.message, 'err');
  }
}

function onExport() {
  const { id, ...rest } = current;
  $('exportText').value = JSON.stringify(rest, null, 2);
  $('exportDlg').showModal();
}

// ---------- Wiring ----------
$('homeLink').onclick = e => { e.preventDefault(); renderHome(); };
$('newBtn').onclick = () => openEdit(null);
$('addField').onclick = () => {
  editing.fields.push({ name: 'Field ' + (editing.fields.length + 1), type: 'number', min: 1, max: 100, step: 1, group: '' });
  renderFieldEditors();
};
$('saveBtn').onclick = onSave;
$('cancelBtn').onclick = renderHome;
$('deleteBtn').onclick = () => {
  if (!confirm('Delete this configuration and its saved state?')) return;
  configs = configs.filter(c => c.id !== editing.id);
  saveConfigs(configs);
  localStorage.removeItem(stateKey(editing.id));
  renderHome();
};
$('genBtn').onclick = onGenerate;
$('runEdit').onclick = () => openEdit(current.id);
$('runExport').onclick = onExport;
$('closeExport').onclick = () => $('exportDlg').close();
$('copyBtn').onclick = () => { $('exportText').select(); navigator.clipboard?.writeText($('exportText').value); };
$('importUrlBtn').onclick = () => { const u = $('importUrl').value.trim(); if (u) importFromUrl(u); };
$('importTextBtn').onclick = () => {
  try { importObject(JSON.parse($('importText').value)); $('importText').value = ''; }
  catch (e) { setMsg($('importMsg'), 'Import failed: ' + e.message, 'err'); }
};
document.addEventListener('keydown', e => {
  if ((e.key === ' ' || e.key === 'Enter') && !$('viewRun').classList.contains('hidden') &&
      !/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(document.activeElement.tagName)) {
    e.preventDefault(); onGenerate();
  }
});

// Start: honour ?import=URL
renderHome();
const params = new URLSearchParams(location.search);
if (params.get('import')) {
  $('importUrl').value = params.get('import');
  importFromUrl(params.get('import')).then(() => history.replaceState(null, '', location.pathname));
}

// PWA: offline support via service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
