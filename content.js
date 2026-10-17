(() => {
  'use strict';

  if (window.__arcTrackerLoaded) return;
  window.__arcTrackerLoaded = true;

  // ---------------------------------------------------------------------------
  // Config
  // ---------------------------------------------------------------------------

  const CONTRIB_PATH = '/home/contributors/my-contributions';
  const AUTO_SYNC_ON_LOAD_MS = 10 * 60 * 1000; // full page load: resync if older than 10 min
  const AUTO_SYNC_ON_NAV_MS = 2 * 60 * 1000;   // in-app navigation: resync if older than 2 min
  const SYNC_TIMEOUT_MS = 120 * 1000;
  const DEFAULT_SETTINGS = { mode: 'badge', autoSync: true, showPill: true };

  const MONTH = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.?';
  const DATE_SRC = `(?:${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}|Today|Yesterday|\\d+\\s+(?:second|minute|hour|day|week|month|year)s?\\s+ago)`;
  const DATE_RE = new RegExp(DATE_SRC, 'i');
  const LINE_RE = new RegExp(`^(${DATE_SRC})\\s*[·•]\\s*(.+)$`, 'i');
  const DATE_ONLY_RE = new RegExp(`^(${DATE_SRC})\\s*[·•]?$`, 'i');

  const isTop = window === window.top;
  let sameOriginParent = false;
  try { sameOriginParent = !isTop && window.parent.location.origin === location.origin; } catch (_) { /* cross-origin */ }

  const isContribPage = () => location.pathname.replace(/\/+$/, '').endsWith(CONTRIB_PATH);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------------------------------------------------------------------------
  // Text helpers
  // ---------------------------------------------------------------------------

  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

  function norm(s) {
    return (s || '')
      .normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[‘’'`]/g, '')
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  // Alternate keys so "[Event Replay] Foo" and "Event Replay: Foo" both match "Foo".
  function altKeys(title) {
    const keys = new Set([norm(title)]);
    const stripped = title.replace(/^\s*\[[^\]]*\]\s*/, '').replace(/^\s*(event replay|replay|video|livestream)\s*[:\-–]\s*/i, '');
    if (stripped !== title) keys.add(norm(stripped));
    keys.delete('');
    return [...keys];
  }

  function pathOf(href) {
    try {
      const u = new URL(href, location.href);
      if (u.origin !== location.origin) return null;
      return u.pathname.replace(/^\/[a-z]{2}(?=\/home\/)/, '').replace(/\/+$/, '');
    } catch (_) { return null; }
  }

  function classify(text) {
    const t = (text || '').toLowerCase();
    if (/watch|video|view/.test(t)) return 'watched';
    if (/comment|repl/.test(t)) return 'commented';
    if (/read/.test(t)) return 'read';
    if (/like|react|upvote/.test(t)) return 'liked';
    if (/post|creat|publish|submit/.test(t)) return 'posted';
    if (/attend|event|rsvp|regist/.test(t)) return 'attended';
    return 'engaged';
  }

  // ---------------------------------------------------------------------------
  // Storage
  // ---------------------------------------------------------------------------

  const state = { items: {}, settings: { ...DEFAULT_SETTINGS }, lastSync: 0 };

  async function loadState() {
    const s = await chrome.storage.local.get(['items', 'settings', 'lastSync']);
    state.items = s.items || {};
    state.settings = { ...DEFAULT_SETTINGS, ...(s.settings || {}) };
    state.lastSync = s.lastSync || 0;
  }

  // Merge scraped entries into storage. Returns the number of new keys added.
  async function mergeEntries(entries, { markSynced = false } = {}) {
    const s = await chrome.storage.local.get(['items']);
    const items = s.items || {};
    let added = 0;
    let changed = false;
    for (const e of entries) {
      const key = e.title ? norm(e.title) : (e.href ? 'href:' + e.href : null);
      if (!key) continue;
      const cur = items[key];
      if (!cur) {
        items[key] = { title: e.title, href: e.href || null, kinds: [e.kind], date: e.date, label: e.label };
        added++;
        changed = true;
        continue;
      }
      if (!cur.kinds.includes(e.kind)) { cur.kinds.push(e.kind); changed = true; }
      if (!cur.href && e.href) { cur.href = e.href; changed = true; }
    }
    const patch = {};
    if (changed) patch.items = items;
    if (markSynced) patch.lastSync = Date.now();
    if (Object.keys(patch).length) await chrome.storage.local.set(patch);
    return added;
  }

  // ---------------------------------------------------------------------------
  // Scraping the My Contributions page
  // ---------------------------------------------------------------------------

  // Row looks like:   Read Content x1
  //                   Sep 25th, 2026 · Add USDC Funding to Your App ...      + ◊ 2
  function scrapeContributions(root = document.body) {
    const out = new Map();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (DATE_RE.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
    });
    const seenLines = new Set();
    let node;
    while ((node = walker.nextNode())) {
      const start = node.parentElement;
      if (!start || start.closest('#arct-pill-host')) continue;

      // Climb to the smallest element whose text is "<date> · <title>".
      let line = null, date = null, title = null;
      let el = start;
      for (let i = 0; i < 4 && el && el !== document.body; i++, el = el.parentElement) {
        const text = clean(el.textContent);
        const m = text.match(LINE_RE);
        if (m) { line = el; date = m[1]; title = clean(m[2]); break; }
        if (!DATE_ONLY_RE.test(text)) break; // climbed into the row (label before the date)
      }

      // Fallback: date and title are separate siblings.
      if (!line) {
        const dm = clean(start.textContent).match(DATE_ONLY_RE);
        if (!dm) continue;
        let sib = start.nextElementSibling, rest = '';
        while (sib) { rest += ' ' + sib.textContent; sib = sib.nextElementSibling; }
        rest = clean(rest).replace(/^[·•]\s*/, '');
        if (!rest) continue;
        line = start.parentElement; date = dm[1]; title = rest;
      }

      if (seenLines.has(line)) continue;
      seenLines.add(line);

      // Strip trailing points ("+ 2") if they leaked into the line.
      title = title.replace(/\s*\+\s*\S?\s*\d+\s*$/, '').trim();
      if (!title || title.length < 2) continue;

      // Row = ancestor holding the activity label, without swallowing neighbouring rows.
      let row = line;
      for (let i = 0; i < 4 && row.parentElement && row.parentElement !== document.body; i++) {
        const p = row.parentElement;
        const dates = clean(p.textContent).match(new RegExp(DATE_SRC, 'gi')) || [];
        if (dates.length > 1) break;
        row = p;
      }
      const rowText = clean(row.textContent);
      const label = clean(rowText.split(date)[0].replace(/\bx\d+\b/i, ''));
      const kind = classify(label || rowText);

      const link = line.querySelector('a[href]') || (line.closest('a[href]')) || row.querySelector('a[href]');
      const href = link ? pathOf(link.getAttribute('href')) : null;

      const key = norm(title);
      const prev = out.get(key + '|' + kind);
      if (!prev) out.set(key + '|' + kind, { title, date, kind, label, href: href && !href.endsWith(CONTRIB_PATH) ? href : null });
    }
    return [...out.values()];
  }

  function scrollEverythingDown() {
    window.scrollTo(0, document.documentElement.scrollHeight);
    for (const el of document.querySelectorAll('main, div, section, ul')) {
      if (el.scrollHeight > el.clientHeight + 40) {
        const oy = getComputedStyle(el).overflowY;
        if (oy === 'auto' || oy === 'scroll') el.scrollTop = el.scrollHeight;
      }
    }
  }

  function clickLoadMore() {
    for (const b of document.querySelectorAll('button, a[role="button"], [role="button"]')) {
      const t = clean(b.textContent);
      if (/^(load|show|view|see) more( contributions| activity)?$/i.test(t) && !b.disabled) {
        b.click();
        return true;
      }
    }
    return false;
  }

  // Scroll through the contributions list, saving as we go.
  // quick=true stops once a couple of rounds turn up nothing new (newest-first list).
  async function harvest({ quick = false, onProgress } = {}) {
    // Wait for the first rows to render.
    const t0 = Date.now();
    while (scrapeContributions().length === 0 && Date.now() - t0 < 25000) await sleep(500);

    let lastCount = -1, stable = 0, idle = 0, total = 0;
    for (let round = 0; round < 150; round++) {
      const entries = scrapeContributions();
      const added = await mergeEntries(entries);
      total += added;
      onProgress && onProgress(entries.length, total);

      idle = added === 0 ? idle + 1 : 0;
      if (quick && round >= 1 && idle >= 2) break;

      stable = entries.length === lastCount ? stable + 1 : 0;
      lastCount = entries.length;
      if (stable >= 4) break;

      scrollEverythingDown();
      clickLoadMore();
      await sleep(700);
    }
    await mergeEntries([], { markSynced: true });
    return total;
  }

  // ---------------------------------------------------------------------------
  // Marking cards everywhere else
  // ---------------------------------------------------------------------------

  const KIND_TEXT = {
    read: 'Read', watched: 'Watched', commented: 'Commented', liked: 'Liked',
    posted: 'Posted', attended: 'Attended', engaged: 'Done',
  };

  function buildIndex() {
    const byTitle = new Map(), byHref = new Map(), list = [];
    for (const item of Object.values(state.items)) {
      if (item.title) for (const k of altKeys(item.title)) { byTitle.set(k, item); list.push([k, item]); }
      if (item.href) byHref.set(item.href, item);
    }
    return { byTitle, byHref, list };
  }

  function lookupText(text, idx) {
    const n = norm(text);
    if (n.length < 4) return null;
    const hit = idx.byTitle.get(n);
    if (hit) return hit;
    for (const k of altKeys(text)) { const h = idx.byTitle.get(k); if (h) return h; }
    // Visually truncated text ("New York...") — prefix match.
    if (/(\.\.\.|…)\s*$/.test(text) && n.length >= 15) {
      for (const [k, item] of idx.list) if (k.startsWith(n)) return item;
    }
    return null;
  }

  // Arc House (Gradual) card links carry aria-label="Read more about '<title>'".
  const READ_MORE_RE = /^Read more about\s*['‘’"“”](.*)['‘’"“”]\s*$/i;
  const contentLinkTitle = (a) => {
    const m = (a.getAttribute('aria-label') || '').match(READ_MORE_RE);
    return m ? m[1] : null;
  };

  // Climb from a card link to the outermost wrapper that holds only this item's links.
  function cardForLink(a) {
    const href = pathOf(a.getAttribute('href'));
    let node = a;
    for (let i = 0; i < 10; i++) {
      const p = node.parentElement;
      if (!p || p === document.body || p.matches('main, section, ul, ol, [role="list"], [role="feed"]')) break;
      const foreign = [...p.querySelectorAll('a[aria-label][href]')]
        .some((x) => contentLinkTitle(x) !== null && pathOf(x.getAttribute('href')) !== href);
      if (foreign) break;
      node = p;
    }
    return node;
  }

  const hasMedia = (el) => el.matches('img, picture, video') ||
    !!el.querySelector('img, picture, video, [style*="background-image"]');

  // From a matched title element, find the card that holds it.
  function cardFor(el, titleLen) {
    const limit = titleLen + 260;
    let node = el;
    for (let i = 0; i < 8 && node && node !== document.body; i++, node = node.parentElement) {
      if (clean(node.textContent).length > limit) break;
      if (hasMedia(node)) return node;
    }
    // Text-only cards: accept the link only if it's block-sized (not an inline text link).
    const a = el.closest('a[href]');
    if (a && clean(a.textContent).length <= limit && a.getBoundingClientRect().height >= 60) return a;
    return null;
  }

  function badgeFor(item) {
    const b = document.createElement('div');
    b.className = 'arct-badge';
    const kinds = item.kinds || ['engaged'];
    const primary = ['watched', 'read', 'commented'].find((k) => kinds.includes(k)) || kinds[0];
    b.dataset.kind = primary;
    b.title = `${kinds.map((k) => KIND_TEXT[k] || k).join(' + ')}${item.date ? ' · ' + item.date : ''}`;
    b.innerHTML =
      '<span class="arct-ic"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12.5l4 4L18 8" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></span>' +
      `<span class="arct-tx">${KIND_TEXT[primary] || 'Done'}</span>`;
    return b;
  }

  function markCard(card, item) {
    const key = norm(item.title || item.href);
    const sig = key + '|' + (item.kinds || []).join(',');
    if (card.dataset.arctSig === sig) return;
    unmarkCard(card);
    card.dataset.arctSig = sig;
    card.classList.add('arct-done');
    if (getComputedStyle(card).position === 'static') {
      card.style.position = 'relative';
      card.dataset.arctPos = '1';
    }
    card.appendChild(badgeFor(item));
  }

  function unmarkCard(card) {
    card.classList.remove('arct-done');
    delete card.dataset.arctSig;
    if (card.dataset.arctPos) { card.style.position = ''; delete card.dataset.arctPos; }
    card.querySelectorAll(':scope > .arct-badge').forEach((b) => b.remove());
  }

  function markPage() {
    document.documentElement.dataset.arctMode = state.settings.mode;
    const matched = new Set();

    if (!isContribPage()) {
      const idx = buildIndex();
      if (idx.byTitle.size || idx.byHref.size) {
        // 0) Card links labelled "Read more about '<title>'" — the reliable path.
        for (const a of document.querySelectorAll('a[aria-label][href]')) {
          const title = contentLinkTitle(a);
          if (title === null) continue;
          const item = idx.byHref.get(pathOf(a.getAttribute('href'))) || lookupText(clean(title), idx);
          if (!item) continue;
          const card = cardForLink(a);
          if (matched.has(card) || [...matched].some((m) => card.contains(m) || m.contains(card))) continue;
          markCard(card, item);
          matched.add(card);
        }
        // 1) Links whose path we know.
        if (idx.byHref.size) {
          for (const a of document.querySelectorAll('a[href]')) {
            const item = idx.byHref.get(pathOf(a.getAttribute('href')));
            if (!item) continue;
            const card = cardFor(a, (item.title || '').length || 120);
            if (!card || [...matched].some((m) => card.contains(m) || m.contains(card))) continue;
            markCard(card, item);
            matched.add(card);
          }
        }
        // 2) Titles.
        const els = document.body.querySelectorAll('h1, h2, h3, h4, h5, h6, p, span, div, a, strong');
        for (const el of els) {
          if (el.childElementCount > 4 || el.closest('.arct-badge, #arct-pill-host')) continue;
          const text = el.textContent;
          if (!text || text.length < 6 || text.length > 300) continue;
          const item = lookupText(clean(text), idx);
          if (!item) continue;
          const card = cardFor(el, clean(text).length);
          if (!card) continue;
          // Skip if this card overlaps one already matched (e.g. we climbed too far).
          if ([...matched].some((m) => card.contains(m) || m.contains(card))) continue;
          markCard(card, item);
          matched.add(card);
        }
      }
    }

    for (const c of document.querySelectorAll('.arct-done')) if (!matched.has(c)) unmarkCard(c);
    updatePill(matched.size);
  }

  // ---------------------------------------------------------------------------
  // Background sync via hidden same-origin iframe
  // ---------------------------------------------------------------------------

  let syncing = false;

  function startSync({ quick = true } = {}) {
    if (syncing || !isTop) return;
    syncing = true;
    updatePill();

    const frame = document.createElement('iframe');
    frame.id = 'arct-sync-frame';
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.src = CONTRIB_PATH + (quick ? '#arct-quick' : '#arct-full');
    // Kept inside the viewport (but invisible) so lazy-loading / intersection observers still fire.
    Object.assign(frame.style, {
      position: 'fixed', left: '0', top: '0', width: '1200px', height: '900px',
      opacity: '0', pointerEvents: 'none', zIndex: '-2147483647', border: '0',
    });

    let done = false;
    const finish = async () => {
      if (done) return;
      done = true;
      window.removeEventListener('message', onMsg);
      frame.remove();
      syncing = false;
      await loadState();
      markPage();
    };
    const onMsg = (e) => {
      if (e.origin === location.origin && e.data && e.data.type === 'arct-sync-done') finish();
    };
    window.addEventListener('message', onMsg);
    setTimeout(finish, SYNC_TIMEOUT_MS);
    document.documentElement.appendChild(frame);
  }

  // ---------------------------------------------------------------------------
  // Floating pill (shadow DOM so the site's CSS can't touch it)
  // ---------------------------------------------------------------------------

  let pill = null;

  function ensurePill() {
    if (!isTop || !state.settings.showPill) {
      if (pill) { pill.host.remove(); pill = null; }
      return null;
    }
    if (pill && document.documentElement.contains(pill.host)) return pill;
    const host = document.createElement('div');
    host.id = 'arct-pill-host';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        .pill { position: fixed; right: 20px; bottom: 20px; z-index: 2147483646;
          display: flex; align-items: center; gap: 10px; height: 40px; padding: 0 5px 0 6px;
          font: 500 12.5px/1 "Inter", system-ui, -apple-system, "Segoe UI", sans-serif; color: #16141f;
          background: rgba(255,255,255,.92); -webkit-backdrop-filter: blur(12px) saturate(1.4); backdrop-filter: blur(12px) saturate(1.4);
          border-radius: 999px; -webkit-font-smoothing: antialiased;
          box-shadow: 0 0 0 1px rgba(22,20,31,.07), 0 8px 24px rgba(40,20,90,.16), 0 2px 6px rgba(40,20,90,.08);
          animation: in .3s ease-out both; }
        @keyframes in { from { opacity: 0; transform: translateY(6px); } }
        .ic { width: 28px; height: 28px; border-radius: 50%; flex: none; display: grid; place-items: center; color: #fff;
          background: linear-gradient(135deg, #5b2ee6, #c0508a); }
        .ic svg { width: 15px; height: 15px; }
        .busy .ic { animation: pulse 1.1s ease-in-out infinite; }
        @keyframes pulse { 50% { opacity: .45; transform: scale(.92); } }
        .txt { white-space: nowrap; }
        .txt b { font-weight: 700; font-variant-numeric: tabular-nums; }
        .sep { width: 1px; height: 18px; background: rgba(22,20,31,.1); }
        button { all: unset; cursor: pointer; height: 30px; padding: 0 12px; border-radius: 999px;
          font-weight: 600; color: #5b2ee6; transition: background .15s; }
        button:hover { background: rgba(91,46,230,.09); }
        button:focus-visible { outline: 2px solid #5b2ee6; outline-offset: 1px; }
        button[disabled] { color: #a29eb8; cursor: default; background: none; }
        .x { width: 30px; padding: 0; display: grid; place-items: center; color: #a29eb8; }
        .x:hover { background: rgba(22,20,31,.06); color: #16141f; }
        .x svg { width: 12px; height: 12px; }
        @media (prefers-color-scheme: dark) {
          .pill { background: rgba(26,24,35,.9); color: #eeedf5; box-shadow: 0 0 0 1px rgba(255,255,255,.08), 0 8px 24px rgba(0,0,0,.4); }
          .sep { background: rgba(255,255,255,.12); }
          button { color: #a78bfa; } button:hover { background: rgba(167,139,250,.12); }
          .x { color: #6d6984; } .x:hover { background: rgba(255,255,255,.08); color: #eeedf5; }
        }
      </style>
      <div class="pill">
        <span class="ic"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12.5l4 4L18 8" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
        <span class="txt"></span>
        <span class="sep"></span>
        <button class="go"></button>
        <button class="x" title="Hide (turn back on from the extension popup)" aria-label="Hide"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg></button>
      </div>`;
    root.querySelector('.go').addEventListener('click', onPillClick);
    root.querySelector('.x').addEventListener('click', () => {
      state.settings.showPill = false;
      chrome.storage.local.set({ settings: state.settings });
    });
    document.documentElement.appendChild(host);
    pill = { host, root, txt: root.querySelector('.txt'), go: root.querySelector('.go'), box: root.querySelector('.pill') };
    return pill;
  }

  let harvesting = false;
  let pillStatus = null;
  let lastMatched = 0;

  async function onPillClick() {
    if (isContribPage()) {
      if (harvesting) return;
      harvesting = true;
      updatePill();
      await harvest({ onProgress: (seen) => { pillStatus = `Scanning… ${seen} rows`; updatePill(); } });
      harvesting = false;
      pillStatus = null;
      await loadState();
      updatePill();
    } else {
      startSync({ quick: false });
    }
  }

  function updatePill(matchedCount) {
    if (typeof matchedCount === 'number') lastMatched = matchedCount;
    const p = ensurePill();
    if (!p) return;
    const total = Object.keys(state.items).length;
    const busy = syncing || harvesting;
    p.box.classList.toggle('busy', busy);
    const set = (html) => { if (p.txt.innerHTML !== html) p.txt.innerHTML = html; };
    if (isContribPage()) {
      set(pillStatus || `<b>${total}</b> items tracked`);
      p.go.textContent = harvesting ? 'Scanning…' : 'Scan full history';
    } else {
      set(busy ? 'Syncing your history…'
        : total ? `<b>${lastMatched}</b> completed on this page` : 'Not synced yet');
      p.go.textContent = busy ? 'Syncing…' : 'Sync';
    }
    p.go.disabled = busy;
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------

  function debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

  async function runInSyncFrame() {
    const quick = !location.hash.includes('arct-full');
    try { await harvest({ quick }); } catch (_) { /* report done anyway */ }
    window.parent.postMessage({ type: 'arct-sync-done' }, location.origin);
  }

  async function main() {
    await loadState();

    // Hidden sync frame: just harvest and report back.
    if (!isTop) {
      if (sameOriginParent && isContribPage() && window.frameElement && window.frameElement.id === 'arct-sync-frame') {
        runInSyncFrame();
      }
      return;
    }

    let lastUrl = location.href;
    const passiveScrape = debounce(async () => {
      if (!isContribPage() || harvesting) return;
      const added = await mergeEntries(scrapeContributions(), { markSynced: true });
      if (added) { await loadState(); updatePill(); }
    }, 800);
    const remark = debounce(markPage, 350);

    const onDomChange = () => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        if (!isContribPage() && state.settings.autoSync && Date.now() - state.lastSync > AUTO_SYNC_ON_NAV_MS) startSync();
      }
      if (isContribPage()) passiveScrape();
      remark();
    };
    new MutationObserver((muts) => {
      // Ignore our own badge insertions.
      const ours = (n) => n.nodeType === 1 && (n.classList.contains('arct-badge') || n.id === 'arct-pill-host' || n.id === 'arct-sync-frame');
      if (muts.every((m) => m.type === 'childList' && [...m.addedNodes, ...m.removedNodes].every(ours))) return;
      onDomChange();
    }).observe(document.body, { childList: true, subtree: true, characterData: true });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.items) state.items = changes.items.newValue || {};
      if (changes.settings) state.settings = { ...DEFAULT_SETTINGS, ...(changes.settings.newValue || {}) };
      if (changes.lastSync) state.lastSync = changes.lastSync.newValue || 0;
      remark();
    });

    chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
      if (msg && msg.type === 'arct-sync') {
        if (isContribPage()) onPillClick(); else startSync({ quick: !msg.full });
        reply({ ok: true });
      }
    });

    markPage();
    if (isContribPage()) passiveScrape();
    else if (state.settings.autoSync && Date.now() - state.lastSync > AUTO_SYNC_ON_LOAD_MS) {
      setTimeout(() => startSync({ quick: state.lastSync > 0 }), 1500);
    }
  }

  // Exposed for testing in a page without the extension APIs.
  window.__arcTracker = { scrapeContributions, norm, altKeys, lookupText, cardFor, buildIndex, state, markPage };

  if (typeof chrome !== 'undefined' && chrome.storage) main();
})();
