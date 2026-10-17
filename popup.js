const ORIGIN = 'https://community.arc.io';
const CONTRIB_URL = ORIGIN + '/home/contributors/my-contributions';
const DEFAULT_SETTINGS = { mode: 'badge', autoSync: true, showPill: true };
const KIND_LABEL = { read: 'Read', watched: 'Watched', commented: 'Commented', liked: 'Liked', posted: 'Posted', attended: 'Attended', engaged: 'Done' };
const KIND_CLASS = { read: 'k-read', watched: 'k-watched', commented: 'k-commented' };

const $ = (id) => document.getElementById(id);
let items = {};
let settings = { ...DEFAULT_SETTINGS };
let lastSync = 0;
let syncing = false;

function ago(ts) {
  if (!ts) return 'Not synced yet';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'Synced just now';
  if (s < 3600) return `Synced ${Math.round(s / 60)} min ago`;
  if (s < 86400) return `Synced ${Math.round(s / 3600)} h ago`;
  return `Synced ${Math.round(s / 86400)} d ago`;
}

function renderStatus() {
  $('sync-status').textContent = syncing ? 'Syncing your contributions…' : ago(lastSync);
  $('status-dot').className = 'dot ' + (syncing ? 'busy' : lastSync ? 'ok' : '');
  $('sync').disabled = syncing;
  $('sync').classList.toggle('spinning', syncing);
  $('sync-label').textContent = syncing ? 'Syncing' : 'Sync';
}

function renderStats() {
  const list = Object.values(items);
  const count = (k) => list.filter((i) => (i.kinds || []).includes(k)).length;
  const n = { read: count('read'), watched: count('watched'), commented: count('commented') };
  $('n-total').textContent = list.length.toLocaleString();
  $('n-read').textContent = n.read;
  $('n-watched').textContent = n.watched;
  $('n-commented').textContent = n.commented;

  const bar = $('bar');
  bar.textContent = '';
  for (const k of ['read', 'watched', 'commented']) {
    if (!n[k]) continue;
    const s = document.createElement('span');
    s.className = KIND_CLASS[k];
    s.style.flexGrow = n[k];
    bar.appendChild(s);
  }
}

function renderList() {
  const list = Object.values(items).sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  const q = $('search').value.trim().toLowerCase();
  const ul = $('items');
  ul.textContent = '';
  const shown = list.filter((i) => !q || (i.title || '').toLowerCase().includes(q)).slice(0, 400);
  if (!shown.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = list.length ? 'No matches' : 'Nothing tracked yet — press Sync';
    ul.appendChild(li);
    return;
  }
  for (const i of shown) {
    const li = document.createElement('li');
    const t = document.createElement('span');
    t.className = 't';
    t.textContent = i.title || i.href;
    t.title = [i.title, i.date].filter(Boolean).join(' · ');
    const chips = document.createElement('span');
    chips.className = 'chips';
    for (const k of i.kinds || []) {
      const c = document.createElement('span');
      c.className = 'chip';
      const dot = document.createElement('i');
      dot.className = KIND_CLASS[k] || 'k-other';
      c.append(dot, KIND_LABEL[k] || k);
      chips.appendChild(c);
    }
    li.append(t, chips);
    ul.appendChild(li);
  }
}

function renderSettings() {
  for (const b of $('mode').querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.value === settings.mode));
  $('autoSync').checked = settings.autoSync;
  $('showPill').checked = settings.showPill;
}

function saveSettings() {
  chrome.storage.local.set({ settings });
  renderSettings();
}

async function load() {
  const s = await chrome.storage.local.get(['items', 'settings', 'lastSync']);
  items = s.items || {};
  settings = { ...DEFAULT_SETTINGS, ...(s.settings || {}) };
  lastSync = s.lastSync || 0;
  renderSettings();
  renderStats();
  renderList();
  renderStatus();
}

$('mode').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-value]');
  if (!b) return;
  settings.mode = b.dataset.value;
  saveSettings();
});
$('autoSync').addEventListener('change', (e) => { settings.autoSync = e.target.checked; saveSettings(); });
$('showPill').addEventListener('change', (e) => { settings.showPill = e.target.checked; saveSettings(); });
$('search').addEventListener('input', renderList);

$('open').addEventListener('click', () => chrome.tabs.create({ url: CONTRIB_URL }));

$('sync').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.url && tab.url.startsWith(ORIGIN)) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'arct-sync', full: true });
      syncing = true;
      renderStatus();
      return;
    } catch (_) { /* content script not loaded yet (tab opened before install) */ }
  }
  // Not on Arc House: open the contributions page; the content script saves it as it loads.
  chrome.tabs.create({ url: CONTRIB_URL });
});

$('clear').addEventListener('click', async () => {
  if (!confirm('Reset all tracked items? They will come back on the next sync.')) return;
  await chrome.storage.local.remove(['items', 'lastSync']);
  load();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.items) { items = changes.items.newValue || {}; renderStats(); renderList(); }
  if (changes.lastSync) { lastSync = changes.lastSync.newValue || 0; syncing = false; renderStatus(); }
});

setInterval(renderStatus, 30000);
load();
