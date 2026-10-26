/*
 * MyExpense UI. Vanilla JS, no dependencies, works offline.
 * All data lives in IndexedDB on this device (see db.js). Nothing is sent anywhere.
 */
(function () {
  'use strict';

  const C = window.MyExpenseCore;
  const DB = window.MyExpenseDB;
  const ME = C.ME;
  const APP_VERSION = '1.1.3';
  const PREVIEW = !!window.MYEXPENSE_PREVIEW;

  let S = null; // in-memory copy of the database
  let device = {}; // per-device metadata (last backup time), never exported
  let idx = null;
  let deferredInstall = null;
  let swWaiting = null;

  const ui = {
    month: C.monthOf(C.todayISO()),
    tx: { q: '', from: '', to: '', categoryId: '', type: '', paymentMethod: '', classification: '', limit: 100 },
    splitTab: 'friends',
    showArchivedFriends: false,
    showArchivedGroups: false,
    activityLimit: 60,
    report: { period: 'month', anchor: C.todayISO(), from: '', to: '', categoryId: '' },
    lastPayment: 'UPI',
    lastRoute: '',
  };

  /* ------------------------------------------------------------ helpers */

  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const inr = (p, o) => C.formatINR(p, o);

  const I = {
    home: '<path d="M3.5 10.2 12 3.5l8.5 6.7V20a.8.8 0 0 1-.8.8H15v-6H9v6H4.3a.8.8 0 0 1-.8-.8z"/>',
    list: '<path d="M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01"/>',
    split: '<circle cx="9" cy="8.5" r="3.3"/><path d="M3 20c.6-3.4 3.1-5.6 6-5.6s5.4 2.2 6 5.6"/><circle cx="17" cy="9.5" r="2.4"/><path d="M16.3 14.4c2.6.2 4.4 2.3 4.9 5.6"/>',
    chart: '<path d="M5 20v-8M10.5 20V5M16 20v-6M21.5 20h-19"/>',
    settings: '<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    left: '<path d="m14.5 18-6-6 6-6"/>',
    right: '<path d="m9.5 18 6-6-6-6"/>',
    close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
    download: '<path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14"/>',
    upload: '<path d="M12 15V4m0 0L8 8m4-4 4 4M5 19h14"/>',
    contact: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><circle cx="12" cy="10" r="3"/><path d="M7 18c.8-2.4 2.7-3.8 5-3.8s4.2 1.4 5 3.8"/>',
    swap: '<path d="M7 4v15m0 0-3-3m3 3 3-3M17 20V5m0 0-3 3m3-3 3 3"/>',
    warn: '<path d="M12 4 2.8 19.5h18.4zM12 10v4.5M12 17h.01"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    in: '<path d="M17 7 7 17M7 8.5V17h8.5"/>',
    out: '<path d="M7 17 17 7M8.5 7H17v8.5"/>',
    bill: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    settle: '<path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5"/>',
    chev: '<path d="m9.5 6 6 6-6 6"/>',
  };
  const icon = (n, cls) => `<svg class="ic ${cls || ''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${I[n]}</svg>`;

  const CAT_COLORS = {
    cat_food: '#D97B29',
    cat_groceries: '#6E8B2D',
    cat_shopping: '#9A3F8F',
    cat_travel: '#2C84B8',
    cat_rent: '#4453B8',
    cat_bills: '#5F6E82',
    cat_entertainment: '#C7436E',
    cat_medical: '#16867A',
    cat_salary: '#21804A',
    cat_other: '#94816A',
  };
  const EXTRA_COLORS = ['#B8862B', '#7A55C4', '#2F9C9C', '#C25A3A', '#4F7F5B', '#9C5B7B', '#3C6E9E', '#8A7C2F'];

  function catColor(id) {
    if (CAT_COLORS[id]) return CAT_COLORS[id];
    let h = 0;
    for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return EXTRA_COLORS[h % EXTRA_COLORS.length];
  }
  const CAT_EMOJI = {
    cat_food: '🍔', cat_groceries: '🛒', cat_shopping: '🛍️', cat_travel: '✈️', cat_rent: '🏠',
    cat_bills: '💡', cat_entertainment: '🎬', cat_medical: '💊', cat_salary: '💰', cat_other: '📦',
  };
  const EMOJI_HINTS = [
    [/pet|dog|\bcat\b/i, '🐾'], [/fuel|petrol|diesel|cng/i, '⛽'], [/gift/i, '🎁'], [/edu|school|course|book|fee/i, '📚'],
    [/gym|fitness|sport/i, '🏋️'], [/emi|loan|bank/i, '🏦'], [/invest|sip|stock|mutual/i, '📈'], [/coffee|tea|chai|cafe/i, '☕'],
    [/kid|baby|child/i, '🧸'], [/phone|mobile|recharge|internet|wifi/i, '📱'], [/cab|uber|ola|auto|metro|bus|train|commute/i, '🚕'],
    [/beauty|salon|groom/i, '💇'], [/insur/i, '🛡️'], [/maid|help|cook|clean/i, '🧹'], [/freelance|bonus|interest|refund|income|cashback/i, '💵'],
    [/donat|charity/i, '🙏'], [/drink|bar|party/i, '🥂'], [/cloth|fashion/i, '👕'], [/electric|water|gas/i, '💡'],
    [/subscr|netflix|ott|prime/i, '📺'], [/health|doctor|hospital/i, '🩺'], [/food|swiggy|zomato|restaurant/i, '🍽️'],
  ];
  function catEmoji(id) {
    if (CAT_EMOJI[id]) return CAT_EMOJI[id];
    const c = idx && idx.cat.get(id);
    const n = c ? c.name : '';
    for (const [re, e] of EMOJI_HINTS) if (re.test(n)) return e;
    return '🏷️';
  }
  function catIcon(id, size) {
    const col = catColor(id);
    return `<span class="cat-ic${size ? ' ' + size : ''}" style="--t:${col}24" aria-hidden="true">${catEmoji(id)}</span>`;
  }
  const AV_COLORS = ['#0F766E', '#7C3AED', '#DB2777', '#EA580C', '#2563EB', '#65A30D', '#0891B2', '#B45309'];
  function avatarColor(id) {
    if (id === 'me') return '#0F766E';
    let h = 0;
    for (const ch of String(id)) h = (h * 33 + ch.charCodeAt(0)) >>> 0;
    return AV_COLORS[h % AV_COLORS.length];
  }
  function avatar(id, name, cls) {
    return `<span class="avatar ${cls || ''}" style="--a:${avatarColor(id)}" aria-hidden="true">${esc(initials(name))}</span>`;
  }
  const catName = (id) => (idx.cat.get(id) ? idx.cat.get(id).name : 'Other');
  const personName = (id) => (id === ME ? 'You' : idx.friend.get(id) ? idx.friend.get(id).name : 'Removed friend');

  const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function fmtDate(iso, withDay) {
    if (!iso) return '';
    const d = C.parseISO(iso);
    const thisYear = new Date().getFullYear();
    const base = `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}${d.getFullYear() !== thisYear ? ' ' + d.getFullYear() : ''}`;
    return withDay ? `${DAYS_SHORT[d.getDay()]}, ${base}` : base;
  }
  function fmtMonth(mk) {
    const [y, m] = mk.split('-').map(Number);
    return `${MONTHS_LONG[m - 1]} ${y}`;
  }
  function fmtTs(ts) {
    if (!ts) return 'never';
    const d = new Date(ts);
    return `${fmtDate(C.toISODate(d))}, ${d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`;
  }
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;

  function reindex() {
    idx = {
      cat: new Map(S.categories.map((c) => [c.id, c])),
      friend: new Map(S.friends.map((f) => [f.id, f])),
      group: new Map(S.groups.map((g) => [g.id, g])),
      txn: new Map(S.transactions.map((t) => [t.id, t])),
      se: new Map(S.sharedExpenses.map((s) => [s.id, s])),
      st: new Map(S.settlements.map((s) => [s.id, s])),
      bal: C.myBalances(S),
    };
  }

  const THEME_KEY = 'myexpense-theme';
  function getTheme() {
    try {
      const t = localStorage.getItem(THEME_KEY);
      return t === 'light' || t === 'dark' ? t : 'system';
    } catch (err) {
      return 'system';
    }
  }
  function applyTheme(t) {
    const root = document.documentElement;
    if (t === 'light' || t === 'dark') root.setAttribute('data-theme', t);
    else root.removeAttribute('data-theme');
    const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    $$('meta[name="theme-color"]').forEach((m) => {
      if (t === 'system') m.setAttribute('content', m.media.includes('dark') ? '#0b0f14' : '#f3f5f7');
      else m.setAttribute('content', dark ? '#0b0f14' : '#f3f5f7');
    });
  }
  function setTheme(t) {
    try {
      if (t === 'system') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, t);
    } catch (err) {
      /* storage blocked: still apply for this session */
    }
    applyTheme(t);
  }

  function sortedCategories(type) {
    return S.categories
      .filter((c) => !type || c.type === type || c.type === 'both')
      .slice()
      .sort((a, b) => (a.id === C.OTHER_CATEGORY_ID) - (b.id === C.OTHER_CATEGORY_ID) || a.name.localeCompare(b.name));
  }
  function activeFriends() {
    return S.friends.filter((f) => !f.archived).sort((a, b) => a.name.localeCompare(b.name));
  }

  /* ------------------------------------------------------- persistence */

  let channel = null;
  try {
    channel = new BroadcastChannel('myexpense');
    channel.onmessage = async (e) => {
      if (e.data === 'changed') {
        const r = await DB.loadAll();
        S = r.state;
        device = r.device;
        reindex();
        render();
      }
    };
  } catch (err) {
    channel = null;
  }

  function applyOps(ops) {
    for (const op of ops) {
      if (op.store === DB.META) {
        if (op.put.key === 'settings') S.settings = op.put.value;
        if (op.put.key === 'device') device = op.put.value;
        continue;
      }
      const arr = S[op.store];
      if (op.put) {
        const i = arr.findIndex((r) => r.id === op.put.id);
        if (i >= 0) arr[i] = op.put;
        else arr.push(op.put);
      } else {
        const i = arr.findIndex((r) => r.id === op.del);
        if (i >= 0) arr.splice(i, 1);
      }
    }
  }

  /** Write ops atomically, then update memory and the screen. Throws on failure after telling the user. */
  async function persist(ops) {
    try {
      await DB.commit(ops);
    } catch (err) {
      toast(`Not saved. ${err && err.message ? err.message : 'Storage error.'}`, 'error');
      throw err;
    }
    applyOps(ops);
    reindex();
    if (channel) channel.postMessage('changed');
    render();
  }

  /* ------------------------------------------------------- ui primitives */

  function toast(msg, kind) {
    const host = $('#toasts');
    const el = document.createElement('div');
    el.className = `toast ${kind || ''}`;
    el.textContent = msg;
    while (host.children.length >= 2) host.firstElementChild.remove();
    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 300);
    }, kind === 'error' ? 6000 : 3200);
  }

  const sheets = [];
  let sheetSeq = 0;

  function openSheet(opts) {
    const id = `sheet-title-${++sheetSeq}`;
    const wrap = document.createElement('div');
    wrap.className = 'sheet-wrap';
    wrap.innerHTML = `
      <div class="sheet-backdrop" data-close></div>
      <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="${id}">
        <div class="sheet-grip" aria-hidden="true"></div>
        <header class="sheet-head">
          <h2 id="${id}">${esc(opts.title)}</h2>
          <button type="button" class="icon-btn" data-close aria-label="Close">${icon('close')}</button>
        </header>
        <div class="sheet-body">${opts.html}</div>
      </div>`;
    const prevFocus = document.activeElement;
    document.body.appendChild(wrap);
    document.body.classList.add('no-scroll');
    $$('#app, #topbar, .tabbar, .fab').forEach((el) => el.setAttribute('inert', ''));
    sheets.forEach((s) => s.wrap.setAttribute('inert', ''));
    const api = {
      wrap,
      el: $('.sheet', wrap),
      closed: false,
      close() {
        if (api.closed) return;
        api.closed = true;
        wrap.classList.remove('open');
        sheets.splice(sheets.indexOf(api), 1);
        setTimeout(() => wrap.remove(), 220);
        if (sheets.length) sheets[sheets.length - 1].wrap.removeAttribute('inert');
        else {
          document.body.classList.remove('no-scroll');
          $$('[inert]').forEach((el) => el.removeAttribute('inert'));
        }
        if (opts.onClose) opts.onClose();
        if (prevFocus && prevFocus.focus && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true });
      },
    };
    wrap.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) api.close();
    });
    sheets.push(api);
    requestAnimationFrame(() => wrap.classList.add('open'));
    if (opts.onMount) opts.onMount(api.el, api);
    const focusEl = (opts.focus && $(opts.focus, api.el)) || $('h2', api.el);
    if (focusEl) {
      if (focusEl.tagName === 'H2') focusEl.setAttribute('tabindex', '-1');
      setTimeout(() => focusEl.focus({ preventScroll: true }), 60);
    }
    return api;
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sheets.length) sheets[sheets.length - 1].close();
  });

  function confirmDialog(o) {
    return new Promise((resolve) => {
      let answered = false;
      openSheet({
        title: o.title,
        html: `
          <div class="sheet-text">${o.message}</div>
          ${o.requireText ? `<label class="field"><span>Type ${esc(o.requireText)} to confirm</span><input type="text" id="cf-text" autocomplete="off" autocapitalize="characters"></label>` : ''}
          <div class="sheet-actions">
            <button type="button" class="btn ghost" data-close>${esc(o.cancelLabel || 'Cancel')}</button>
            <button type="button" class="btn ${o.danger ? 'danger' : 'primary'}" id="cf-ok">${esc(o.confirmLabel || 'Confirm')}</button>
          </div>`,
        focus: o.requireText ? '#cf-text' : '#cf-ok',
        onClose: () => {
          if (!answered) resolve(false);
        },
        onMount: (el, api) => {
          $('#cf-ok', el).addEventListener('click', () => {
            if (o.requireText && $('#cf-text', el).value.trim().toUpperCase() !== o.requireText) {
              $('#cf-text', el).setAttribute('aria-invalid', 'true');
              $('#cf-text', el).focus();
              return;
            }
            answered = true;
            api.close();
            resolve(true);
          });
        },
      });
    });
  }

  function showFormError(form, msg) {
    const box = $('.form-error', form);
    if (!box) return toast(msg, 'error');
    box.textContent = msg;
    box.hidden = !msg;
    if (msg) box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function options(list, selected) {
    return list.map(([v, label]) => `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(label)}</option>`).join('');
  }

  function segmented(name, list, selected, extraAttr) {
    return `<div class="seg" role="radiogroup">${list
      .map(
        ([v, label]) => `<label class="seg-opt"><input type="radio" name="${name}" value="${esc(v)}"${v === selected ? ' checked' : ''} ${extraAttr || ''}><span>${esc(label)}</span></label>`
      )
      .join('')}</div>`;
  }

  /* ------------------------------------------------------------- render */

  function parseRoute() {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    return { name: parts[0] || 'home', sub: parts[1] || '', id: parts[2] || '' };
  }

  function render() {
    if (!S) return;
    try {
      renderView();
    } catch (err) {
      showFatal(err, 'render');
    }
  }

  function renderView() {
    const r = parseRoute();
    const key = location.hash;
    const keepScroll = key === ui.lastRoute ? window.scrollY : 0;
    let v;
    switch (r.name) {
      case 'transactions':
        v = viewTransactions();
        break;
      case 'split':
        if (r.sub === 'friend') v = viewFriend(r.id);
        else if (r.sub === 'group') v = viewGroup(r.id);
        else v = viewSplit();
        break;
      case 'reports':
        v = viewReports();
        break;
      case 'settings':
        v = viewSettings();
        break;
      default:
        v = viewHome();
    }
    $('#topbar').innerHTML = `
      ${v.back ? `<a class="icon-btn back" href="${v.back}" aria-label="Back">${icon('left')}</a>` : ''}
      <h1>${esc(v.title)}</h1>
      <div class="topbar-actions">${v.actions || ''}</div>`;
    $('#view').innerHTML = v.body;
    $$('.tabbar a').forEach((a) => a.setAttribute('aria-current', a.dataset.tab === r.name ? 'page' : 'false'));
    document.title = `${v.title} | MyExpense`;
    if (v.mount) v.mount();
    window.scrollTo(0, keepScroll);
    ui.lastRoute = key;
  }

  const NO_DATA = 'No data to display';
  function noData(text) {
    return `<div class="no-data"><span aria-hidden="true">📭</span><div><strong>${NO_DATA}</strong>${text ? `<small>${text}</small>` : ''}</div></div>`;
  }

  function emptyState(title, text, actionsHtml) {
    return `<div class="empty"><div class="empty-ic" aria-hidden="true">📭</div><p class="empty-title">${esc(title)}</p><p class="empty-text">${text}</p>${actionsHtml ? `<div class="empty-actions">${actionsHtml}</div>` : ''}</div>`;
  }

  /* --------------------------------------------------------------- home */

  function ringSvg(pct, cls) {
    const r = 34;
    const c = 2 * Math.PI * r;
    const p = Math.min(100, Math.max(0, pct));
    return `<svg class="ring" viewBox="0 0 84 84" aria-hidden="true">
      <circle class="track" cx="42" cy="42" r="${r}" fill="none" stroke-width="8"/>
      <circle class="bar ${cls}" cx="42" cy="42" r="${r}" fill="none" stroke-width="8" stroke-linecap="round"
        stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - p / 100)).toFixed(2)}" transform="rotate(-90 42 42)"/>
      <text x="42" y="44" text-anchor="middle">${pct > 999 ? '999+' : pct}%</text>
      <text class="sub" x="42" y="57" text-anchor="middle">used</text>
    </svg>`;
  }

  function donut(cats, total) {
    const r = 46;
    const c = 2 * Math.PI * r;
    let off = 0;
    const segs = cats
      .map(([id, amt]) => {
        const len = (amt / (total || 1)) * c;
        const gap = cats.length > 1 && len > 4 ? 2 : 0;
        const el = `<circle cx="60" cy="60" r="${r}" fill="none" stroke="${catColor(id)}" stroke-width="16" stroke-dasharray="${Math.max(0, len - gap).toFixed(2)} ${(c - Math.max(0, len - gap)).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 60 60)"><title>${esc(catName(id))}: ${inr(amt)}</title></circle>`;
        off += len;
        return el;
      })
      .join('');
    return `<svg class="donut" viewBox="0 0 120 120" role="img" aria-label="${esc(`Spending by category, total ${inr(total)}`)}">
      <circle class="d-track" cx="60" cy="60" r="${r}" fill="none" stroke-width="16"/>${segs}
      <text class="d-total" x="60" y="62" text-anchor="middle">${esc(C.formatINRCompact(total))}</text>
      <text class="d-sub" x="60" y="75" text-anchor="middle">spent</text></svg>`;
  }

  function viewHome() {
    const mk = ui.month;
    const range = C.monthRange(mk);
    const sum = C.summarize(S, range);
    const budget = C.budgetFor(S, mk);
    const bal = idx.bal;
    const cats = [...sum.byCategory].sort((a, b) => b[1] - a[1]);
    const today = C.todayISO();
    const isCurrent = mk === C.monthOf(today);
    const monthName = MONTHS_LONG[Number(mk.slice(5)) - 1];

    let hero;
    if (budget) {
      const remaining = budget.amount - sum.spending;
      const pct = Math.round((sum.spending / budget.amount) * 100);
      const denom = Math.max(budget.amount, sum.spending) || 1;
      const over = remaining < 0;
      const near = !over && pct >= S.settings.warnThreshold;
      const segs = cats.map(([id, amt]) => `<span class="seg-bar" style="width:${((amt / denom) * 100).toFixed(3)}%;--c:${catColor(id)}"></span>`).join('');
      const marker = over ? `<span class="strip-marker" style="left:${((budget.amount / denom) * 100).toFixed(3)}%"></span>` : '';
      const daysLeft = isCurrent ? C.daysBetween(today, range.to) + 1 : 0;
      const perDay = !over && daysLeft > 0 ? Math.floor(remaining / daysLeft / 100) * 100 : 0;
      hero = `
        <div class="hero-top">
          <div>
            <p class="hero-label">${over ? 'Over budget by' : `Left to spend in ${monthName}`}</p>
            <p class="hero-amount ${over ? 'neg' : ''}">${inr(Math.abs(remaining))}</p>
            <p class="hero-meta">${inr(sum.spending)} of ${inr(budget.amount)}</p>
          </div>
          ${ringSvg(pct, over ? 'over' : near ? 'warn' : '')}
        </div>
        <div class="strip" role="img" aria-label="${esc(`${inr(sum.spending)} spent of ${inr(budget.amount)} budget`)}">${segs}${marker}</div>
        <div class="hero-foot">
          ${perDay > 0 ? `<span class="pill">${inr(perDay)}/day for ${plural(daysLeft, 'day')}</span>` : `<span>${budget.source === 'default' ? 'Default budget' : 'Monthly budget'}</span>`}
          <button type="button" class="link" data-action="edit-budget" data-month="${mk}">Edit budget</button>
        </div>
        ${over ? `<p class="alert danger" role="status">${icon('warn')}You have crossed this month’s budget.</p>` : near ? `<p class="alert warn" role="status">${icon('warn')}${pct}% of the budget is used.</p>` : ''}`;
    } else {
      hero = `
        <p class="hero-label">Spent in ${monthName}</p>
        <p class="hero-amount">${inr(sum.spending)}</p>
        <div class="strip" aria-hidden="true">${cats.map(([id, amt]) => `<span class="seg-bar" style="width:${((amt / (sum.spending || 1)) * 100).toFixed(3)}%;--c:${catColor(id)}"></span>`).join('')}</div>
        <div class="hero-foot"><span>No budget for this month</span><button type="button" class="link" data-action="edit-budget" data-month="${mk}">Set budget</button></div>`;
    }

    const recent = S.transactions.filter((t) => C.inRange(t.date, range)).sort(txSort).slice(0, 5);
    const hasAny = S.transactions.length + S.sharedExpenses.length > 0;
    const backupDue = S.transactions.length + S.sharedExpenses.length >= 5 &&
      (!device.lastBackupAt || Date.now() - Date.parse(device.lastBackupAt) > 30 * 86400000);
    const top = cats.slice(0, 5);
    if (cats.length > 5) top.push(['__rest', cats.slice(5).reduce((a, c) => a + c[1], 0)]);

    const oweCard = S.friends.length
      ? `<a class="owe-card" href="#/split">
          <div><span class="mini-label">Friends owe you</span><span class="mini-value pos">${inr(bal.receivable)}</span></div>
          <span class="sep"></span>
          <div><span class="mini-label">You owe</span><span class="mini-value ${bal.payable ? 'neg' : ''}">${inr(bal.payable)}</span></div>
          ${icon('chev', 'chev')}</a>`
      : `<a class="owe-card" href="#/split"><span class="cat-ic sm" style="--t:#0f766e22">🤝</span><div><span class="owe-text">Split bills with friends</span><span class="mini-label">Track who owes whom</span></div>${icon('chev', 'chev')}</a>`;

    const body = `
      <div class="month-switch">
        <button type="button" class="icon-btn" data-action="month-prev" aria-label="Previous month">${icon('left')}</button>
        <span class="month-label" aria-live="polite">${fmtMonth(mk)}</span>
        <button type="button" class="icon-btn" data-action="month-next" aria-label="Next month">${icon('right')}</button>
        ${!isCurrent ? `<button type="button" class="chip" data-action="month-today">Today</button>` : ''}
      </div>
      ${PREVIEW ? '<div class="notice">Preview mode: backup export and import are off. Host the project and install it for daily use.</div>' : ''}
      <section class="hero">${hero}</section>
      <section class="duo">
        <div class="mini"><span class="mini-ic in">${icon('in')}</span><div><span class="mini-label">Income</span><span class="mini-value">${inr(sum.income)}</span></div></div>
        <div class="mini"><span class="mini-ic out">${icon('out')}</span><div><span class="mini-label">Spent</span><span class="mini-value">${inr(sum.spending)}</span></div></div>
      </section>
      <section class="quick" aria-label="Quick actions">
        <button type="button" data-action="add-txn" data-type="expense"><span class="q-ic out">${icon('out')}</span>Expense</button>
        <button type="button" data-action="add-txn" data-type="income"><span class="q-ic in">${icon('in')}</span>Income</button>
        <button type="button" data-action="add-shared"><span class="q-ic split">${icon('bill')}</span>Split bill</button>
        <button type="button" data-action="add-settlement"><span class="q-ic settle">${icon('settle')}</span>Settle up</button>
      </section>
      ${oweCard}
      ${backupDue ? `<div class="notice">${device.lastBackupAt ? `Last backup ${fmtDate(C.toISODate(new Date(device.lastBackupAt)))}.` : 'No backup yet.'} Your data lives only on this phone. <a href="#/settings" class="link">Back up now</a></div>` : ''}
      <section class="panel">
        <h2 class="panel-title">Spending by category</h2>
        ${cats.length ? `<div class="donut-center">${donut(cats, sum.spending)}</div>${legendList(top, sum.spending)}` : noData(`No spending in ${fmtMonth(mk)} yet.`)}
      </section>
      <section class="panel">
        <div class="panel-head"><h2 class="panel-title">Recent</h2><a class="link small" href="#/transactions">See all</a></div>
        ${recent.length ? `<div class="rows">${recent.map(txRow).join('')}</div>` : !hasAny ? emptyState(NO_DATA, 'You have not added anything yet. Tap + below to add your first expense.', `<button type="button" class="btn primary" data-action="add-txn" data-type="expense">Add expense</button><button type="button" class="btn ghost" data-action="import-json">Restore backup</button>`) : noData(`Nothing recorded in ${fmtMonth(mk)}.`)}
      </section>`;
    return {
      title: 'MyExpense',
      body,
      actions: `<a class="icon-btn soft" href="#/settings" aria-label="Settings">${icon('gear')}</a>`,
    };
  }

  function legendList(items, total) {
    return `<ul class="cat-bars">${items
      .map(([id, amt]) => {
        const rest = id === '__rest';
        return `<li>${rest ? '<span class="cat-ic sm" style="--t:#94a3b824">•••</span>' : catIcon(id, 'sm')}
          <span class="cat-name">${rest ? 'Others' : esc(catName(id))}</span>
          <span class="cat-amt">${inr(amt)} <span class="muted">${total ? Math.round((amt / total) * 100) : 0}%</span></span>
          <span class="cat-track"><span style="width:${total ? ((amt / total) * 100).toFixed(1) : 0}%;--c:${rest ? '#94a3b8' : catColor(id)}"></span></span></li>`;
      })
      .join('')}</ul>`;
  }

  function categoryBars(cats, total) {
    return legendList(cats, total);
  }

  function txSort(a, b) {
    return C.cmp(b.date, a.date) || C.cmp(b.createdAt, a.createdAt);
  }

  function txRow(t) {
    const se = t.classification === 'shared' ? idx.se.get(t.sharedExpenseId) : null;
    const title = t.description || catName(t.categoryId);
    let sub = t.description ? `${catName(t.categoryId)}, ${t.paymentMethod}` : t.paymentMethod;
    if (se) sub = `Your share ${inr(C.myShare(se))} of ${inr(se.totalAmount)}`;
    if (t.tags && t.tags.length) sub += `  ${t.tags.map((g) => `#${g}`).join(' ')}`;
    return `<button type="button" class="row" data-action="edit-txn" data-id="${esc(t.id)}">
      ${catIcon(t.categoryId)}
      <span class="row-main">
        <span class="row-title">${esc(title)}${se ? ' <span class="badge">SPLIT</span>' : ''}</span>
        <span class="row-sub">${esc(sub)}</span>
      </span>
      <span class="row-amt ${t.type === 'income' ? 'pos' : ''}">${t.type === 'income' ? '+' : '\u2212'}${inr(t.amount)}<span class="row-date">${fmtDate(t.date)}</span></span>
    </button>`;
  }

  /* -------------------------------------------------------- transactions */

  function filteredTxns() {
    const f = ui.tx;
    const q = f.q.trim().toLowerCase();
    const qAmount = C.parseAmount(f.q);
    return S.transactions
      .filter((t) => {
        if (f.from && t.date < f.from) return false;
        if (f.to && t.date > f.to) return false;
        if (f.categoryId && t.categoryId !== f.categoryId) return false;
        if (f.type && t.type !== f.type) return false;
        if (f.paymentMethod && t.paymentMethod !== f.paymentMethod) return false;
        if (f.classification && t.classification !== f.classification) return false;
        if (q) {
          const hay = `${t.description} ${catName(t.categoryId)} ${(t.tags || []).join(' ')} ${t.paymentMethod}`.toLowerCase();
          if (!hay.includes(q) && !(qAmount && t.amount === qAmount)) return false;
        }
        return true;
      })
      .sort(txSort);
  }

  function activeFilterChips() {
    const f = ui.tx;
    const chips = [];
    if (f.from || f.to) chips.push(['dates', `${f.from ? fmtDate(f.from) : 'Start'} to ${f.to ? fmtDate(f.to) : 'today'}`]);
    if (f.categoryId) chips.push(['categoryId', catName(f.categoryId)]);
    if (f.type) chips.push(['type', f.type === 'income' ? 'Income' : 'Expenses']);
    if (f.paymentMethod) chips.push(['paymentMethod', f.paymentMethod]);
    if (f.classification) chips.push(['classification', f.classification === 'shared' ? 'Split bills' : 'Personal']);
    return chips;
  }

  function renderTxnList() {
    const list = filteredTxns();
    let inc = 0;
    let exp = 0;
    for (const t of list) t.type === 'income' ? (inc += t.amount) : (exp += t.amount);
    const shown = list.slice(0, ui.tx.limit);
    const days = new Map();
    for (const t of shown) {
      if (!days.has(t.date)) days.set(t.date, []);
      days.get(t.date).push(t);
    }
    let html = '';
    for (const [d, items] of days) {
      const out = items.filter((t) => t.type === 'expense').reduce((a, t) => a + t.amount, 0);
      html += `<div class="day-head"><span>${fmtDate(d, true)}</span><span>${out ? '\u2212' + inr(out) : ''}</span></div><div class="rows">${items.map(txRow).join('')}</div>`;
    }
    return `
      ${list.length ? `<div class="list-summary"><span class="pill">${plural(list.length, 'entry', 'entries')}</span><span class="pill">In <b class="pos">${inr(inc)}</b></span><span class="pill">Out <b>${inr(exp)}</b></span></div>` : ''}
      ${list.length ? html : S.transactions.length ? emptyState(NO_DATA, 'Nothing matches your search or filters.', `<button type="button" class="btn ghost" data-action="tx-clear">Clear filters</button>`) : `<div style="margin-top:14px">${emptyState(NO_DATA, 'No transactions yet. Tap + below to add income or an expense.', `<button type="button" class="btn primary" data-action="add-txn" data-type="expense">Add expense</button>`)}</div>`}
      ${list.length > shown.length ? `<button type="button" class="btn ghost block" data-action="tx-more">Show ${Math.min(100, list.length - shown.length)} more</button>` : ''}`;
  }

  function viewTransactions() {
    const chips = activeFilterChips();
    const body = `
      <div class="search-row">
        <label class="search">${icon('search')}<span class="sr-only">Search transactions</span><input type="search" id="tx-q" placeholder="Search description, tag, amount" value="${esc(ui.tx.q)}" enterkeyhint="search"></label>
        <button type="button" class="btn ghost filter-btn" data-action="tx-filters" aria-label="Filters">${icon('filter')}<span>Filters${chips.length ? ` (${chips.length})` : ''}</span></button>
      </div>
      ${chips.length ? `<div class="chips">${chips.map(([k, label]) => `<button type="button" class="chip on" data-action="tx-chip-remove" data-key="${k}" aria-label="Remove filter ${esc(label)}">${esc(label)} ${icon('close')}</button>`).join('')}<button type="button" class="chip" data-action="tx-clear">Clear all</button></div>` : ''}
      <div id="tx-list">${renderTxnList()}</div>`;
    return {
      title: 'Transactions',
      body,
      actions: `<button type="button" class="icon-btn" data-action="tx-export" aria-label="Export these transactions as CSV" title="Export CSV">${icon('download')}</button>`,
      mount() {
        const q = $('#tx-q');
        q.addEventListener('input', () => {
          ui.tx.q = q.value;
          ui.tx.limit = 100;
          $('#tx-list').innerHTML = renderTxnList();
        });
      },
    };
  }

  function openTxFilters() {
    const f = ui.tx;
    openSheet({
      title: 'Filter transactions',
      html: `<form id="ff" class="form">
        <div class="grid2">
          <label class="field"><span>From</span><input type="date" name="from" value="${esc(f.from)}"></label>
          <label class="field"><span>To</span><input type="date" name="to" value="${esc(f.to)}"></label>
        </div>
        <div class="quick-dates">
          <button type="button" class="chip" data-range="month">This month</button>
          <button type="button" class="chip" data-range="last">Last month</button>
          <button type="button" class="chip" data-range="year">This year</button>
        </div>
        <label class="field"><span>Type</span><select name="type">${options([['', 'All'], ['expense', 'Expenses'], ['income', 'Income']], f.type)}</select></label>
        <label class="field"><span>Category</span><select name="categoryId">${options([['', 'All categories'], ...sortedCategories().map((c) => [c.id, c.name])], f.categoryId)}</select></label>
        <label class="field"><span>Payment method</span><select name="paymentMethod">${options([['', 'All methods'], ...C.PAYMENT_METHODS.map((m) => [m, m])], f.paymentMethod)}</select></label>
        <label class="field"><span>Personal or split</span><select name="classification">${options([['', 'Both'], ['personal', 'Personal'], ['shared', 'Split bills (cash you paid)']], f.classification)}</select></label>
        <div class="form-error" role="alert" hidden></div>
        <div class="sheet-actions"><button type="button" class="btn ghost" id="ff-reset">Reset</button><button type="submit" class="btn primary">Show results</button></div>
      </form>`,
      onMount(el, api) {
        const form = $('#ff', el);
        $$('[data-range]', el).forEach((b) =>
          b.addEventListener('click', () => {
            const t = C.todayISO();
            let r;
            if (b.dataset.range === 'month') r = C.monthRange(C.monthOf(t));
            else if (b.dataset.range === 'last') r = C.monthRange(C.addMonths(C.monthOf(t), -1));
            else r = C.yearRange(t.slice(0, 4));
            form.from.value = r.from;
            form.to.value = r.to;
          })
        );
        $('#ff-reset', el).addEventListener('click', () => {
          Object.assign(ui.tx, { from: '', to: '', categoryId: '', type: '', paymentMethod: '', classification: '', limit: 100 });
          api.close();
          render();
        });
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const from = form.from.value;
          const to = form.to.value;
          if (from && to && from > to) return showFormError(form, 'The start date is after the end date.');
          Object.assign(ui.tx, { from, to, type: form.type.value, categoryId: form.categoryId.value, paymentMethod: form.paymentMethod.value, classification: form.classification.value, limit: 100 });
          api.close();
          render();
        });
      },
    });
  }

  /* --------------------------------------------------- transaction form */

  function radioVal(form, name) {
    const el = form.querySelector(`input[name="${name}"]:checked`);
    return el ? el.value : '';
  }

  function openQuickAdd() {
    openSheet({
      title: 'What do you want to add?',
      html: `<div class="quick-grid">
        <button type="button" class="qa" data-qa="expense"><span class="qa-ic out">${icon('out')}</span><span><strong>Expense</strong><small>Something you paid for yourself</small></span></button>
        <button type="button" class="qa" data-qa="income"><span class="qa-ic in">${icon('in')}</span><span><strong>Income</strong><small>Salary or money you received</small></span></button>
        <button type="button" class="qa" data-qa="split"><span class="qa-ic split">${icon('bill')}</span><span><strong>Split a bill</strong><small>Shared with friends, you or they paid</small></span></button>
        <button type="button" class="qa" data-qa="settle"><span class="qa-ic settle">${icon('settle')}</span><span><strong>Settle up</strong><small>Record money paid back</small></span></button>
      </div>`,
      onMount(el, api) {
        el.addEventListener('click', (e) => {
          const b = e.target.closest('[data-qa]');
          if (!b) return;
          api.close();
          const k = b.dataset.qa;
          setTimeout(() => {
            if (k === 'expense' || k === 'income') openTxnForm(null, { type: k });
            else if (k === 'split') openSharedForm(null, {});
            else openSettlementForm(null, {});
          }, 120);
        });
      },
    });
  }

  function openTxnForm(txn, preset) {
    if (txn && txn.classification === 'shared') {
      const se = idx.se.get(txn.sharedExpenseId);
      if (se) return openSharedForm(se);
    }
    const p = preset || {};
    const f = txn
      ? { ...txn, amountText: C.amountToInput(txn.amount), tagsText: (txn.tags || []).join(', ') }
      : {
          type: p.type || 'expense',
          amountText: '',
          categoryId: p.type === 'income' ? 'cat_salary' : '',
          date: C.todayISO(),
          paymentMethod: ui.lastPayment,
          description: '',
          tagsText: '',
        };
    const catTiles = (type, selected) => {
      const list = sortedCategories(type);
      if (selected && !list.find((c) => c.id === selected) && idx.cat.get(selected)) list.push(idx.cat.get(selected));
      return list
        .map((c) => `<label class="cat-tile"><input type="radio" name="categoryId" value="${esc(c.id)}" ${c.id === selected ? 'checked' : ''}><span>${catIcon(c.id)}<em>${esc(c.name)}</em></span></label>`)
        .join('');
    };
    const pmChips = C.PAYMENT_METHODS.map((m) => `<label class="chip-opt"><input type="radio" name="paymentMethod" value="${esc(m)}" ${m === f.paymentMethod ? 'checked' : ''}><span>${esc(m)}</span></label>`).join('');
    openSheet({
      title: txn ? 'Edit transaction' : f.type === 'income' ? 'Add income' : 'Add expense',
      focus: txn ? null : '#tx-amount',
      html: `<form id="txf" class="form" novalidate>
        ${segmented('type', [['expense', 'Expense'], ['income', 'Income']], f.type)}
        <label class="big-amount"><span class="sr-only">Amount</span><span class="cur" aria-hidden="true">₹</span><input id="tx-amount" name="amount" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(f.amountText)}" size="4"></label>
        <fieldset class="field"><legend>Category</legend><div class="cat-grid" id="cat-grid">${catTiles(f.type, f.categoryId)}</div></fieldset>
        <fieldset class="field"><legend>Paid with</legend><div class="chip-row">${pmChips}</div></fieldset>
        <div class="grid2">
          <label class="field"><span>Date</span><input type="date" name="date" value="${esc(f.date)}"></label>
          <label class="field"><span>Note <em>optional</em></span><input name="description" maxlength="${C.LIMITS.description}" value="${esc(f.description)}" placeholder="What for?" autocomplete="off"></label>
        </div>
        <label class="field"><span>Tags <em>optional, comma separated</em></span><input name="tags" value="${esc(f.tagsText)}" placeholder="office, weekend" autocomplete="off"></label>
        <label class="switch-row" id="split-row" ${f.type === 'income' ? 'hidden' : ''}>
          <span><strong>Split with friends</strong><small>Only your share will count as spending</small></span>
          <input type="checkbox" class="switch" name="splitToggle" role="switch">
        </label>
        <div class="form-error" role="alert" hidden></div>
        <div class="sheet-actions">
          ${txn ? `<button type="button" class="btn danger-ghost" id="tx-del">Delete</button>` : ''}
          <button type="submit" class="btn primary" id="tx-save">${txn ? 'Save changes' : 'Save'}</button>
        </div>
      </form>`,
      onMount(el, api) {
        const form = $('#txf', el);
        const syncType = () => {
          const type = radioVal(form, 'type');
          const cur = radioVal(form, 'categoryId');
          const keep = cur && sortedCategories(type).some((c) => c.id === cur) ? cur : type === 'income' ? 'cat_salary' : '';
          $('#cat-grid', el).innerHTML = catTiles(type, keep);
          $('#split-row', el).hidden = type === 'income';
          if (type === 'income') form.splitToggle.checked = false;
          $('h2', api.el).textContent = txn ? 'Edit transaction' : type === 'income' ? 'Add income' : 'Add expense';
          syncSplit();
        };
        const syncSplit = () => {
          $('#tx-save', el).textContent = form.splitToggle.checked ? 'Next: choose friends' : txn ? 'Save changes' : 'Save';
        };
        $$('input[name=type]', el).forEach((r) => r.addEventListener('change', syncType));
        form.splitToggle.addEventListener('change', syncSplit);

        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const type = radioVal(form, 'type');
          const amount = C.parseAmount(form.amount.value);
          if (amount === null || amount === 0) return showFormError(form, 'Enter an amount greater than zero, like 250 or 99.50.');
          const categoryId = radioVal(form, 'categoryId');
          if (!categoryId) return showFormError(form, 'Pick a category.');
          if (!C.isISODate(form.date.value)) return showFormError(form, 'Choose a valid date.');
          const paymentMethod = radioVal(form, 'paymentMethod') || 'Other';
          const tags = Array.from(new Set(form.tags.value.split(',').map((x) => x.trim().replace(/^#/, '')).filter(Boolean)));
          if (tags.some((g) => g.length > C.LIMITS.tag)) return showFormError(form, `Keep each tag under ${C.LIMITS.tag} characters.`);
          if (tags.length > C.LIMITS.tags) return showFormError(form, `Use at most ${C.LIMITS.tags} tags.`);
          ui.lastPayment = paymentMethod;
          if (type === 'expense' && form.splitToggle.checked) {
            api.close();
            setTimeout(() => openSharedForm(null, {
              total: amount,
              description: form.description.value.trim(),
              date: form.date.value,
              categoryId,
              paymentMethod,
              replaceTxnId: txn ? txn.id : null,
            }), 120);
            return;
          }
          const now = C.nowISO();
          const rec = {
            id: txn ? txn.id : C.uid('txn'),
            type,
            amount,
            currency: 'INR',
            categoryId,
            date: form.date.value,
            paymentMethod,
            description: form.description.value.trim(),
            classification: 'personal',
            sharedExpenseId: null,
            tags,
            createdAt: txn ? txn.createdAt : now,
            updatedAt: now,
          };
          const errs = C.validateTransaction(rec, C.buildContext(S));
          if (errs.length) return showFormError(form, errs[0]);
          try {
            await persist([{ store: 'transactions', put: rec }]);
            api.close();
            toast(txn ? 'Changes saved.' : `${type === 'income' ? 'Income' : 'Expense'} of ${inr(amount)} saved.`);
          } catch (err) {
            /* toast already shown */
          }
        });
        if (txn) {
          $('#tx-del', el).addEventListener('click', async () => {
            const ok = await confirmDialog({
              title: 'Delete this transaction?',
              message: `<p>${esc(txn.description || catName(txn.categoryId))}, ${inr(txn.amount)} on ${fmtDate(txn.date)}. This cannot be undone.</p>`,
              confirmLabel: 'Delete',
              danger: true,
            });
            if (!ok) return;
            await persist([{ store: 'transactions', del: txn.id }]);
            api.close();
            toast('Transaction deleted.');
          });
        }
      },
    });
  }

  /* ------------------------------------------------------------- split */

  function balancePhrase(friendId, net) {
    const n = personName(friendId);
    if (net > 0) return { text: `${n} owes you ${inr(net)}`, cls: 'pos' };
    if (net < 0) return { text: `You owe ${n} ${inr(-net)}`, cls: 'neg' };
    return { text: 'Settled up', cls: 'muted' };
  }

  function viewSplit() {
    const bal = idx.bal;
    const tab = ui.splitTab;
    let content = '';
    if (tab === 'friends') {
      const list = S.friends
        .filter((f) => ui.showArchivedFriends || !f.archived)
        .sort((a, b) => a.archived - b.archived || Math.abs(bal.perFriend.get(b.id) || 0) - Math.abs(bal.perFriend.get(a.id) || 0) || a.name.localeCompare(b.name));
      const archivedCount = S.friends.filter((f) => f.archived).length;
      content = `
        <div class="panel-head"><span class="muted small">${plural(S.friends.length - archivedCount, 'friend')}</span><span class="head-btns"><button type="button" class="btn ghost small" data-action="import-contacts">${icon('contact')}Contacts</button><button type="button" class="btn ghost small" data-action="add-friend">${icon('plus')}Add</button></span></div>
        ${list.length > 8 ? `<label class="search list-search">${icon('search')}<span class="sr-only">Search friends</span><input type="search" id="friend-q" placeholder="Search friends" autocomplete="off"></label>` : ''}
        ${list.length ? `<div class="rows" id="friend-rows">${list
          .map((f) => {
            const b = balancePhrase(f.id, bal.perFriend.get(f.id) || 0);
            return `<a class="row" href="#/split/friend/${encodeURIComponent(f.id)}" data-q="${esc((f.name + ' ' + (f.phone || '')).toLowerCase())}">
              ${avatar(f.id, f.name)}
              <span class="row-main"><span class="row-title">${esc(f.name)}${f.archived ? ' <span class="badge">Archived</span>' : ''}</span>${f.phone ? `<span class="row-sub">${esc(f.phone)}</span>` : ''}</span>
              <span class="row-amt small ${b.cls}">${esc(b.text)}</span></a>`;
          })
          .join('')}</div>` : emptyState(NO_DATA, 'No friends added yet. Add the people you share bills with; they do not need an account.', `<button type="button" class="btn primary" data-action="import-contacts">${icon('contact')}From contacts</button><button type="button" class="btn ghost" data-action="add-friend">Type a name</button>`)}
        ${archivedCount ? `<button type="button" class="btn ghost block" data-action="toggle-archived-friends">${ui.showArchivedFriends ? 'Hide' : 'Show'} ${plural(archivedCount, 'archived friend')}</button>` : ''}`;
    } else if (tab === 'groups') {
      const list = S.groups.filter((g) => ui.showArchivedGroups || !g.archived).sort((a, b) => a.archived - b.archived || a.name.localeCompare(b.name));
      const archivedCount = S.groups.filter((g) => g.archived).length;
      content = `
        <div class="panel-head"><span class="muted small">${plural(S.groups.length - archivedCount, 'group')}</span><button type="button" class="btn ghost small" data-action="add-group">${icon('plus')}New group</button></div>
        ${list.length ? `<div class="rows">${list
          .map((g) => {
            const nets = C.personNets(S.sharedExpenses, S.settlements, g.id);
            const mine = nets.get(ME) || 0;
            return `<a class="row" href="#/split/group/${encodeURIComponent(g.id)}">
              ${avatar(g.id, g.name, 'group')}
              <span class="row-main"><span class="row-title">${esc(g.name)}${g.archived ? ' <span class="badge">Archived</span>' : ''}</span><span class="row-sub">${plural(g.memberFriendIds.length + 1, 'person', 'people')}</span></span>
              <span class="row-amt small ${mine > 0 ? 'pos' : mine < 0 ? 'neg' : 'muted'}">${mine > 0 ? `You get back ${inr(mine)}` : mine < 0 ? `You owe ${inr(-mine)}` : 'Settled up'}</span></a>`;
          })
          .join('')}</div>` : emptyState(NO_DATA, 'No groups yet. Make one like Goa Trip or Flat Expenses.', `<button type="button" class="btn primary" data-action="add-group">New group</button>`)}
        ${archivedCount ? `<button type="button" class="btn ghost block" data-action="toggle-archived-groups">${ui.showArchivedGroups ? 'Hide' : 'Show'} ${plural(archivedCount, 'archived group')}</button>` : ''}`;
    } else {
      const items = activityItems(() => true);
      content = items.length
        ? `<div class="rows">${items.slice(0, ui.activityLimit).map((it) => activityRow(it)).join('')}</div>${items.length > ui.activityLimit ? `<button type="button" class="btn ghost block" data-action="activity-more">Show more</button>` : ''}`
        : emptyState(NO_DATA, 'Shared bills and payments with friends will appear here.', '');
    }
    const body = `
      <section class="balance-card">
        <div><span class="stat-label">Friends owe you</span><span class="stat-value pos">${inr(bal.receivable)}</span></div>
        <div><span class="stat-label">You owe</span><span class="stat-value neg">${inr(bal.payable)}</span></div>
        <div class="span2"><span class="stat-label">Net</span><span class="stat-value ${bal.net > 0 ? 'pos' : bal.net < 0 ? 'neg' : ''}">${inr(bal.net, { signed: true })}</span><span class="stat-note">Calculated from shared expenses and recorded payments. Not cash in hand.</span></div>
      </section>
      <div class="action-row">
        <button type="button" class="btn primary" data-action="add-shared">${icon('plus')}Split a bill</button>
        <button type="button" class="btn ghost" data-action="add-settlement">Record payment</button>
      </div>
      <div class="tabs" role="tablist">
        ${[['friends', 'Friends'], ['groups', 'Groups'], ['activity', 'Activity']].map(([k, l]) => `<button type="button" role="tab" aria-selected="${tab === k}" class="tab" data-action="split-tab" data-tab="${k}">${l}</button>`).join('')}
      </div>
      <div class="tab-panel">${content}</div>`;
    return {
      title: 'Split',
      body,
      mount() {
        const q = $('#friend-q');
        if (q)
          q.addEventListener('input', () => {
            const t = q.value.trim().toLowerCase();
            $$('#friend-rows .row').forEach((r) => (r.hidden = !!t && !r.dataset.q.includes(t)));
          });
      },
    };
  }

  function initials(name) {
    const parts = String(name).trim().split(/\s+/).filter(Boolean);
    return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }

  function activityItems(pred) {
    const items = [];
    for (const se of S.sharedExpenses) if (pred(se, 'se')) items.push({ kind: 'se', rec: se, date: se.date, ts: se.createdAt });
    for (const st of S.settlements) if (pred(st, 'st')) items.push({ kind: 'st', rec: st, date: st.date, ts: st.createdAt });
    return items.sort((a, b) => C.cmp(b.date, a.date) || C.cmp(b.ts, a.ts));
  }

  function activityRow(it, friendId) {
    if (it.kind === 'se') {
      const se = it.rec;
      const g = se.groupId ? idx.group.get(se.groupId) : null;
      let effect = '';
      if (friendId) {
        const d = C.effectOnFriend(se, friendId);
        effect = d > 0 ? `<span class="pos">${personName(friendId)} owes you ${inr(d)}</span>` : d < 0 ? `<span class="neg">You owe ${inr(-d)}</span>` : '<span class="muted">Not between you two</span>';
      } else {
        const mine = C.myShare(se);
        if (se.payerPersonId === ME) effect = se.totalAmount - mine > 0 ? `<span class="pos">You lent ${inr(se.totalAmount - mine)}</span>` : '<span class="muted">You paid your share</span>';
        else effect = mine > 0 ? `<span class="neg">You borrowed ${inr(mine)}</span>` : '<span class="muted">Not involved</span>';
      }
      return `<button type="button" class="row" data-action="edit-shared" data-id="${esc(se.id)}">
        ${catIcon(se.categoryId || C.OTHER_CATEGORY_ID)}
        <span class="row-main"><span class="row-title">${esc(se.description)}</span>
        <span class="row-sub">${esc(personName(se.payerPersonId))} paid ${inr(se.totalAmount)}${g ? `, ${esc(g.name)}` : ''}, ${fmtDate(se.date)}</span></span>
        <span class="row-amt small">${effect}</span></button>`;
    }
    const st = it.rec;
    const g = st.groupId ? idx.group.get(st.groupId) : null;
    const who = st.payerPersonId === ME ? `You paid ${personName(st.receiverPersonId)}` : st.receiverPersonId === ME ? `${personName(st.payerPersonId)} paid you` : `${personName(st.payerPersonId)} paid ${personName(st.receiverPersonId)}`;
    return `<button type="button" class="row" data-action="edit-settlement" data-id="${esc(st.id)}">
      <span class="dot settle" aria-hidden="true"></span>
      <span class="row-main"><span class="row-title">${esc(who)}</span><span class="row-sub">Payment recorded${g ? `, ${esc(g.name)}` : ''}, ${fmtDate(st.date)}${st.note ? `, ${esc(st.note)}` : ''}</span></span>
      <span class="row-amt small">${inr(st.amount)}</span></button>`;
  }

  function viewFriend(id) {
    const f = idx.friend.get(id);
    if (!f) return { title: 'Friend', back: '#/split', body: emptyState('Friend not found', 'This friend may have been deleted.', '<a class="btn ghost" href="#/split">Back to Split</a>') };
    const net = idx.bal.perFriend.get(id) || 0;
    const b = balancePhrase(id, net);
    const items = activityItems((r, kind) =>
      kind === 'se' ? r.payerPersonId === id || r.participantShares.some((p) => p.personId === id) : r.payerPersonId === id || r.receiverPersonId === id
    );
    const body = `
      <section class="person-head">
        ${avatar(f.id, f.name, 'big')}
        <div><p class="person-name">${esc(f.name)}${f.archived ? ' <span class="badge">Archived</span>' : ''}</p>${f.phone ? `<p class="muted small">${esc(f.phone)}</p>` : ''}${f.notes ? `<p class="muted small">${esc(f.notes)}</p>` : ''}</div>
      </section>
      <section class="balance-line ${b.cls}"><span>${esc(b.text)}</span></section>
      <div class="action-row">
        ${net !== 0 ? `<button type="button" class="btn primary" data-action="add-settlement" data-from="${net > 0 ? esc(id) : ME}" data-to="${net > 0 ? ME : esc(id)}" data-amount="${Math.abs(net)}">Record payment</button>` : ''}
        <button type="button" class="btn ${net !== 0 ? 'ghost' : 'primary'}" data-action="add-shared" data-friend="${esc(id)}">${icon('plus')}Split a bill</button>
      </div>
      <p class="hint">Balances are calculated from the records below. Record a payment only after money actually changes hands.</p>
      <h2 class="panel-title out">History</h2>
      ${items.length ? `<div class="rows">${items.map((it) => activityRow(it, id)).join('')}</div>` : noData(`No shared bills or payments with ${esc(f.name)} yet.`)}`;
    return {
      title: f.name,
      back: '#/split',
      body,
      actions: `<button type="button" class="btn ghost small" data-action="edit-friend" data-id="${esc(id)}">Edit</button>`,
    };
  }

  function viewGroup(id) {
    const g = idx.group.get(id);
    if (!g) return { title: 'Group', back: '#/split', body: emptyState('Group not found', 'This group may have been deleted.', '<a class="btn ghost" href="#/split">Back to Split</a>') };
    const nets = C.personNets(S.sharedExpenses, S.settlements, id);
    const people = Array.from(new Set([ME, ...g.memberFriendIds, ...nets.keys()]));
    const ses = S.sharedExpenses.filter((s) => s.groupId === id);
    const total = ses.reduce((a, s) => a + s.totalAmount, 0);
    const mine = ses.reduce((a, s) => a + C.myShare(s), 0);
    const ledger = C.buildLedger(S.sharedExpenses, S.settlements, { groupId: id });
    const pairs = [];
    for (let i = 0; i < people.length; i++)
      for (let j = i + 1; j < people.length; j++) {
        const v = ledger.between(people[i], people[j]);
        if (v > 0) pairs.push({ from: people[j], to: people[i], amount: v });
        else if (v < 0) pairs.push({ from: people[i], to: people[j], amount: -v });
      }
    const suggestions = C.suggestSettlements(nets);
    const items = activityItems((r) => r.groupId === id);
    const owesLine = (p) => `${esc(personName(p.from))} ${p.from === ME ? 'owe' : 'owes'} ${esc(p.to === ME ? 'you' : personName(p.to))} <strong>${inr(p.amount)}</strong>`;
    const body = `
      <section class="person-head">
        ${avatar(g.id, g.name, 'big group')}
        <div><p class="person-name">${esc(g.name)}${g.archived ? ' <span class="badge">Archived</span>' : ''}</p><p class="muted small">You, ${esc(g.memberFriendIds.map(personName).join(', ') || 'no friends yet')}</p></div>
      </section>
      <section class="stats">
        <div class="stat"><span class="stat-label">Group spending</span><span class="stat-value">${inr(total)}</span></div>
        <div class="stat"><span class="stat-label">Your share</span><span class="stat-value">${inr(mine)}</span></div>
      </section>
      <div class="action-row">
        <button type="button" class="btn primary" data-action="add-shared" data-group="${esc(id)}">${icon('plus')}Add expense</button>
        <button type="button" class="btn ghost" data-action="add-settlement" data-group="${esc(id)}">Record payment</button>
      </div>
      <section class="panel">
        <h2 class="panel-title">Balances in this group</h2>
        <ul class="plain">${people
          .map((p) => {
            const v = nets.get(p) || 0;
            return `<li><span>${esc(personName(p))}</span><span class="${v > 0 ? 'pos' : v < 0 ? 'neg' : 'muted'}">${v > 0 ? `${p === ME ? 'get' : 'gets'} back ${inr(v)}` : v < 0 ? `${p === ME ? 'owe' : 'owes'} ${inr(-v)}` : 'settled'}</span></li>`;
          })
          .join('')}</ul>
        ${pairs.length ? `<h3 class="sub-title">Who owes whom</h3><ul class="plain">${pairs.map((p) => `<li><span>${owesLine(p)}</span></li>`).join('')}</ul>` : ''}
        ${suggestions.length > 0 && suggestions.length < pairs.length ? `<h3 class="sub-title">Fewest payments to settle everyone</h3><ul class="plain">${suggestions
          .map((s) => `<li><span>${owesLine(s)}</span><button type="button" class="btn ghost small" data-action="add-settlement" data-from="${esc(s.from)}" data-to="${esc(s.to)}" data-amount="${s.amount}" data-group="${esc(id)}">Record</button></li>`)
          .join('')}</ul><p class="hint">A suggestion only. Nothing changes until you record a payment.</p>` : ''}
        <p class="hint">Only expenses and payments tagged with this group count here. Payments recorded without a group still count in each friend’s overall balance.</p>
      </section>
      <h2 class="panel-title out">Activity</h2>
      ${items.length ? `<div class="rows">${items.map((it) => activityRow(it)).join('')}</div>` : noData('No expenses in this group yet.')}`;
    return { title: g.name, back: '#/split', body, actions: `<button type="button" class="btn ghost small" data-action="edit-group" data-id="${esc(id)}">Edit</button>` };
  }

  /* ----------------------------------------------------- shared expense form */

  function openSharedForm(se, preset) {
    const p = preset || {};
    const f = se
      ? {
          description: se.description,
          totalText: C.amountToInput(se.totalAmount),
          date: se.date,
          categoryId: se.categoryId || C.OTHER_CATEGORY_ID,
          groupId: se.groupId || '',
          payer: se.payerPersonId,
          paymentMethod: se.paymentMethod || 'UPI',
          method: se.splitMethod,
          participants: se.participantShares.map((x) => x.personId),
          inputs: Object.fromEntries(
            se.participantShares.map((x) => [x.personId, se.splitMethod === 'fixed' ? C.amountToInput(x.share) : se.splitMethod === 'percent' ? C.percentToInput(x.input) : ''])
          ),
          notes: se.notes || '',
        }
      : {
          description: p.description || '',
          totalText: p.total ? C.amountToInput(p.total) : '',
          date: p.date || C.todayISO(),
          categoryId: p.categoryId || 'cat_food',
          groupId: p.groupId || '',
          payer: ME,
          paymentMethod: p.paymentMethod || ui.lastPayment,
          method: 'equal',
          participants: [],
          inputs: {},
          notes: '',
        };
    if (!se) {
      if (f.groupId && idx.group.get(f.groupId)) f.participants = [ME, ...idx.group.get(f.groupId).memberFriendIds.filter((id) => idx.friend.get(id) && !idx.friend.get(id).archived)];
      else if (p.friendId) f.participants = [ME, p.friendId];
      else f.participants = [ME];
    }

    const groups = S.groups.filter((g) => !g.archived || g.id === f.groupId);
    const candidates = () => {
      let ids;
      if (f.groupId && idx.group.get(f.groupId)) ids = [ME, ...idx.group.get(f.groupId).memberFriendIds];
      else ids = [ME, ...activeFriends().map((x) => x.id)];
      for (const id of [...f.participants, f.payer]) if (!ids.includes(id)) ids.push(id);
      return ids;
    };

    if (!activeFriends().length && !se) {
      openSheet({
        title: 'Add a friend first',
        html: `<p class="sheet-text">To split a bill you need at least one friend to share it with. Friends do not need an account.</p>
          <div class="sheet-actions"><button type="button" class="btn ghost" data-close>Not now</button><button type="button" class="btn primary" id="af">Add friend</button></div>`,
        onMount(el, api) {
          $('#af', el).addEventListener('click', () => {
            api.close();
            openFriendForm(null, () => openSharedForm(null, p));
          });
        },
      });
      return;
    }

    openSheet({
      title: se ? 'Edit shared expense' : 'Add shared expense',
      focus: se ? null : f.description ? '#se-total' : '#se-desc',
      html: `<form id="sef" class="form" novalidate>
        <label class="field"><span>Description</span><input id="se-desc" name="description" maxlength="${C.LIMITS.description}" value="${esc(f.description)}" placeholder="Dinner at Saravana Bhavan" autocomplete="off" required></label>
        <div class="grid2">
          <label class="field amount-field"><span>Total bill</span><span class="amount-input"><span aria-hidden="true">₹</span><input id="se-total" name="total" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(f.totalText)}" required></span></label>
          <label class="field"><span>Date</span><input type="date" name="date" value="${esc(f.date)}" required></label>
        </div>
        <div class="grid2">
          <label class="field"><span>Category</span><select name="categoryId">${options(sortedCategories('expense').map((c) => [c.id, c.name]), f.categoryId)}</select></label>
          <label class="field"><span>Group <em>optional</em></span><select name="groupId">${options([['', 'No group'], ...groups.map((g) => [g.id, g.name])], f.groupId)}</select></label>
        </div>
        <div class="grid2">
          <label class="field"><span>Paid by</span><select name="payer" id="se-payer"></select></label>
          <label class="field" id="pm-field"><span>Paid with</span><select name="paymentMethod">${options(C.PAYMENT_METHODS.map((m) => [m, m]), f.paymentMethod)}</select></label>
        </div>
        <fieldset class="field">
          <legend>Split</legend>
          ${segmented('method', [['equal', 'Equally'], ['fixed', 'By amount'], ['percent', 'By percent']], f.method)}
        </fieldset>
        <fieldset class="field parts-field">
          <legend>Who shared it</legend>
          <div id="se-parts" class="parts"></div>
          <p class="split-status" id="se-status" aria-live="polite"></p>
        </fieldset>
        <label class="field"><span>Notes <em>optional</em></span><textarea name="notes" rows="2" maxlength="${C.LIMITS.notes}">${esc(f.notes)}</textarea></label>
        <div class="form-error" role="alert" hidden></div>
        <div class="sheet-actions">
          ${se ? `<button type="button" class="btn danger-ghost" id="se-del">Delete</button>` : ''}
          <button type="submit" class="btn primary">${se ? 'Save changes' : 'Save'}</button>
        </div>
      </form>`,
      onMount(el, api) {
        const form = $('#sef', el);
        const partsEl = $('#se-parts', el);
        const statusEl = $('#se-status', el);

        const renderPayer = () => {
          const cands = Array.from(new Set([ME, ...candidates().filter((id) => f.participants.includes(id)), f.payer]));
          if (!candidates().includes(f.payer)) f.payer = ME;
          $('#se-payer', el).innerHTML = options(cands.map((id) => [id, id === ME ? 'You' : personName(id)]), f.payer);
          $('#pm-field', el).hidden = f.payer !== ME;
        };

        const entries = () => {
          const totalPaise = C.parseAmount(form.total.value);
          const list = candidates().filter((id) => f.participants.includes(id));
          return {
            totalPaise,
            list: list.map((id) => {
              const raw = (f.inputs[id] || '').trim();
              let input = null;
              if (f.method === 'fixed') input = raw === '' ? 0 : C.parseAmount(raw);
              if (f.method === 'percent') input = raw === '' ? 0 : C.parsePercent(raw);
              return { personId: id, input: input === null ? NaN : input };
            }),
          };
        };

        const compute = () => {
          const { totalPaise, list } = entries();
          if (totalPaise === null || totalPaise === 0) return { ok: false, error: 'Enter the total bill.' };
          return C.computeSplit(totalPaise, f.method, list);
        };

        const updatePreview = () => {
          const r = compute();
          const map = r.ok ? new Map(r.shares.map((s) => [s.personId, s.share])) : new Map();
          $$('.part-row', partsEl).forEach((row) => {
            const id = row.dataset.pid;
            const shareEl = $('.part-share', row);
            shareEl.textContent = f.participants.includes(id) && r.ok ? inr(map.get(id) || 0) : '';
          });
          if (!r.ok) {
            statusEl.className = 'split-status bad';
            statusEl.textContent = r.error;
            return r;
          }
          const total = C.parseAmount(form.total.value);
          const mine = map.get(ME) || 0;
          let text;
          if (f.payer === ME) {
            const lent = total - mine;
            text = `You pay ${inr(total)}. Your share is ${inr(mine)}${lent ? `, friends owe you ${inr(lent)}` : ''}. Only ${inr(mine)} counts as your spending.`;
          } else {
            text = `${personName(f.payer)} pays ${inr(total)}. Your share is ${inr(mine)}${mine ? `, which you owe ${personName(f.payer)}` : ''}.`;
          }
          statusEl.className = 'split-status ok';
          statusEl.textContent = text;
          return r;
        };

        const prefillInputs = () => {
          const total = C.parseAmount(form.total.value);
          const ids = candidates().filter((id) => f.participants.includes(id));
          if (!ids.length) return;
          if (f.method === 'percent') {
            const base = Math.floor(10000 / ids.length);
            let rem = 10000 - base * ids.length;
            ids.forEach((id) => {
              f.inputs[id] = C.percentToInput(base + (rem-- > 0 ? 1 : 0));
            });
          } else if (f.method === 'fixed' && total) {
            const r = C.computeSplit(total, 'equal', ids.map((personId) => ({ personId })));
            if (r.ok) r.shares.forEach((s) => (f.inputs[s.personId] = C.amountToInput(s.share)));
          }
        };

        let partQuery = '';
        const renderParts = () => {
          const all = candidates();
          const big = all.length > 9;
          const t = partQuery.trim().toLowerCase();
          const chosen = all.filter((id) => id === ME || f.participants.includes(id));
          let rest = all.filter((id) => id !== ME && !f.participants.includes(id));
          if (t) rest = rest.filter((id) => personName(id).toLowerCase().includes(t) || ((idx.friend.get(id) || {}).phone || '').includes(t));
          const hidden = big && !t ? Math.max(0, rest.length - 12) : 0;
          if (hidden) rest = rest.slice(0, 12);
          const cands = chosen.concat(rest);
          const searchHtml = big ? `<label class="search part-search">${icon('search')}<span class="sr-only">Search friends</span><input type="search" id="se-q" placeholder="Search ${all.length - 1} friends" value="${esc(partQuery)}" autocomplete="off"></label>` : '';
          partsEl.innerHTML = searchHtml + cands
            .map((id) => {
              const on = f.participants.includes(id);
              const archived = id !== ME && idx.friend.get(id) && idx.friend.get(id).archived;
              return `<div class="part-row${on ? ' on' : ''}" data-pid="${esc(id)}">
                <label class="check"><input type="checkbox" ${on ? 'checked' : ''} data-part><span>${esc(id === ME ? 'You' : personName(id))}${archived ? ' (archived)' : ''}</span></label>
                ${on && f.method !== 'equal' ? `<span class="part-input-wrap">${f.method === 'fixed' ? '<span aria-hidden="true">₹</span>' : ''}<input class="part-input" data-input inputmode="decimal" autocomplete="off" value="${esc(f.inputs[id] || '')}" aria-label="${f.method === 'fixed' ? 'Amount' : 'Percent'} for ${esc(id === ME ? 'you' : personName(id))}">${f.method === 'percent' ? '<span aria-hidden="true">%</span>' : ''}</span>` : ''}
                <span class="part-share"></span>
              </div>`;
            })
            .join('') + (hidden ? `<p class="hint">${hidden} more. Search to find them.</p>` : '') + (t && !rest.length ? '<p class="hint">No friend matches that search.</p>' : '') + (f.groupId ? '' : `<button type="button" class="btn ghost small" id="se-add-friend">${icon('plus')}New friend</button>`);
          const sq = $('#se-q', partsEl);
          if (sq)
            sq.addEventListener('input', () => {
              partQuery = sq.value;
              const pos = sq.selectionStart;
              renderParts();
              const again = $('#se-q', partsEl);
              again.focus();
              try {
                again.setSelectionRange(pos, pos);
              } catch (err) {
                /* ignore */
              }
            });
          $$('[data-part]', partsEl).forEach((cb) =>
            cb.addEventListener('change', () => {
              const id = cb.closest('.part-row').dataset.pid;
              if (cb.checked) f.participants.push(id);
              else f.participants = f.participants.filter((x) => x !== id);
              if (cb.checked) partQuery = '';
              renderPayer();
              renderParts();
            })
          );
          $$('[data-input]', partsEl).forEach((inp) =>
            inp.addEventListener('input', () => {
              f.inputs[inp.closest('.part-row').dataset.pid] = inp.value;
              updatePreview();
            })
          );
          const addBtn = $('#se-add-friend', partsEl);
          if (addBtn)
            addBtn.addEventListener('click', () =>
              openFriendForm(null, (fr) => {
                f.participants.push(fr.id);
                renderPayer();
                renderParts();
              })
            );
          updatePreview();
        };

        form.groupId.addEventListener('change', () => {
          f.groupId = form.groupId.value;
          const g = idx.group.get(f.groupId);
          if (g) f.participants = [ME, ...g.memberFriendIds.filter((id) => idx.friend.get(id) && !idx.friend.get(id).archived)];
          renderPayer();
          renderParts();
        });
        form.payer.addEventListener('change', () => {
          f.payer = form.payer.value;
          $('#pm-field', el).hidden = f.payer !== ME;
          updatePreview();
        });
        $$('input[name=method]', el).forEach((r) =>
          r.addEventListener('change', () => {
            f.method = r.value;
            f.inputs = {};
            prefillInputs();
            renderParts();
          })
        );
        form.total.addEventListener('input', updatePreview);

        renderPayer();
        renderParts();

        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const description = form.description.value.trim();
          if (!description) return showFormError(form, 'Add a short description, like Dinner or Cab to airport.');
          const total = C.parseAmount(form.total.value);
          if (total === null || total === 0) return showFormError(form, 'Enter the total bill, greater than zero.');
          if (!C.isISODate(form.date.value)) return showFormError(form, 'Choose a valid date.');
          if (!f.participants.length) return showFormError(form, 'Choose at least one person who shared this.');
          const r = compute();
          if (!r.ok) return showFormError(form, r.error);
          if (f.participants.length === 1 && f.participants[0] === f.payer) {
            return showFormError(form, f.payer === ME ? 'Only you are in this split. Add it as a personal expense instead, or tick the friends who shared it.' : 'The payer is the only person in this split, so nobody owes anything. Tick who else shared it.');
          }
          const now = C.nowISO();
          const rec = {
            id: se ? se.id : C.uid('se'),
            description,
            totalAmount: total,
            date: form.date.value,
            payerPersonId: f.payer,
            participantShares: r.shares,
            splitMethod: f.method,
            categoryId: form.categoryId.value || C.OTHER_CATEGORY_ID,
            groupId: f.groupId || null,
            linkedTransactionId: se ? se.linkedTransactionId : null,
            paymentMethod: f.payer === ME ? form.paymentMethod.value : null,
            notes: form.notes.value.trim() || null,
            createdAt: se ? se.createdAt : now,
            updatedAt: now,
          };
          const existing = rec.linkedTransactionId ? idx.txn.get(rec.linkedTransactionId) : null;
          const linked = C.deriveLinkedTransaction(rec, existing, now);
          const ops = [];
          if (linked) {
            rec.linkedTransactionId = linked.id;
            ops.push({ store: 'transactions', put: linked });
          } else {
            if (existing) ops.push({ store: 'transactions', del: existing.id });
            rec.linkedTransactionId = null;
          }
          if (p.replaceTxnId && (!linked || p.replaceTxnId !== linked.id)) ops.push({ store: 'transactions', del: p.replaceTxnId });
          const ctx = C.buildContext(S);
          ctx.sharedExpenseIds.add(rec.id);
          const errs = C.validateSharedExpense(rec, ctx).concat(linked ? C.validateTransaction(linked, ctx) : []);
          if (errs.length) return showFormError(form, errs[0]);
          ops.push({ store: 'sharedExpenses', put: rec });
          if (f.payer === ME) ui.lastPayment = form.paymentMethod.value;
          try {
            await persist(ops);
            api.close();
            toast(se ? 'Shared expense updated. Balances recalculated.' : 'Shared expense saved.');
          } catch (err) {
            /* shown */
          }
        });

        if (se) {
          $('#se-del', el).addEventListener('click', async () => {
            const ok = await confirmDialog({
              title: 'Delete this shared expense?',
              message: `<p>${esc(se.description)}, ${inr(se.totalAmount)} on ${fmtDate(se.date)}.</p><p>Balances with everyone in it will be recalculated${se.linkedTransactionId ? ' and the matching transaction will be removed' : ''}. Recorded payments are not changed.</p>`,
              confirmLabel: 'Delete',
              danger: true,
            });
            if (!ok) return;
            const ops = [{ store: 'sharedExpenses', del: se.id }];
            if (se.linkedTransactionId && idx.txn.get(se.linkedTransactionId)) ops.push({ store: 'transactions', del: se.linkedTransactionId });
            await persist(ops);
            api.close();
            toast('Shared expense deleted.');
          });
        }
      },
    });
  }

  /* ------------------------------------------------------------ settlement */

  function openSettlementForm(st, preset) {
    const p = preset || {};
    const f = st
      ? { payer: st.payerPersonId, receiver: st.receiverPersonId, amountText: C.amountToInput(st.amount), date: st.date, groupId: st.groupId || '', note: st.note || '' }
      : { payer: p.from || '', receiver: p.to || ME, amountText: p.amount ? C.amountToInput(Number(p.amount)) : '', date: C.todayISO(), groupId: p.groupId || '', note: '' };
    if (!st && !f.payer) {
      const firstDebtor = [...idx.bal.perFriend].find(([, v]) => v > 0);
      f.payer = firstDebtor ? firstDebtor[0] : activeFriends()[0] ? activeFriends()[0].id : '';
      if (firstDebtor && !p.amount) f.amountText = '';
    }
    if (!activeFriends().length && !st) {
      toast('Add a friend first. Payments are recorded between you and a friend.', 'error');
      return;
    }
    const people = () => {
      const ids = [ME, ...activeFriends().map((x) => x.id)];
      for (const id of [f.payer, f.receiver]) if (id && !ids.includes(id)) ids.push(id);
      return ids;
    };
    const groups = S.groups.filter((g) => !g.archived || g.id === f.groupId);
    openSheet({
      title: st ? 'Edit payment' : 'Record a payment',
      html: `<form id="stf" class="form" novalidate>
        <p class="hint">Record money that actually changed hands, like a UPI transfer or cash. Balances update only from recorded payments.</p>
        <div class="payer-row">
          <label class="field"><span>Who paid</span><select name="payer">${options(people().map((id) => [id, id === ME ? 'You' : personName(id)]), f.payer)}</select></label>
          <button type="button" class="icon-btn swap" id="st-swap" aria-label="Swap payer and receiver">${icon('swap')}</button>
          <label class="field"><span>Who received</span><select name="receiver">${options(people().map((id) => [id, id === ME ? 'You' : personName(id)]), f.receiver)}</select></label>
        </div>
        <p class="hint strong" id="st-owed" aria-live="polite"></p>
        <div class="grid2">
          <label class="field amount-field"><span>Amount</span><span class="amount-input"><span aria-hidden="true">₹</span><input name="amount" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(f.amountText)}"></span></label>
          <label class="field"><span>Date</span><input type="date" name="date" value="${esc(f.date)}"></label>
        </div>
        <label class="field"><span>Group <em>optional</em></span><select name="groupId">${options([['', 'No group'], ...groups.map((g) => [g.id, g.name])], f.groupId)}</select></label>
        <label class="field"><span>Note <em>optional</em></span><input name="note" maxlength="200" value="${esc(f.note)}" placeholder="UPI ref, cash at office" autocomplete="off"></label>
        <div class="form-error" role="alert" hidden></div>
        <div class="sheet-actions">
          ${st ? `<button type="button" class="btn danger-ghost" id="st-del">Delete</button>` : ''}
          <button type="submit" class="btn primary">${st ? 'Save changes' : 'Record payment'}</button>
        </div>
      </form>`,
      onMount(el, api) {
        const form = $('#stf', el);
        const outstanding = () => {
          const payer = form.payer.value;
          const receiver = form.receiver.value;
          const others = S.settlements.filter((x) => !st || x.id !== st.id);
          const ledger = C.buildLedger(S.sharedExpenses, others, form.groupId.value ? { groupId: form.groupId.value } : null);
          return ledger.between(receiver, payer); // how much payer owes receiver, excluding this payment
        };
        const updateOwed = () => {
          const payer = form.payer.value;
          const receiver = form.receiver.value;
          const box = $('#st-owed', el);
          if (payer === receiver) {
            box.innerHTML = 'Choose two different people.';
            return;
          }
          const o = outstanding();
          const scope = form.groupId.value ? ' in this group' : '';
          const pn = personName(payer);
          const rn = receiver === ME ? 'you' : personName(receiver);
          if (o > 0) box.innerHTML = `${esc(pn)} ${payer === ME ? 'owe' : 'owes'} ${esc(rn)} ${inr(o)}${scope}. <button type="button" class="link" id="st-full">Use full amount</button>`;
          else box.innerHTML = `${esc(pn)} ${payer === ME ? 'do' : 'does'} not owe ${esc(rn)} anything${scope}.`;
          const full = $('#st-full', el);
          if (full) full.addEventListener('click', () => (form.amount.value = C.amountToInput(o)));
        };
        ['payer', 'receiver', 'groupId'].forEach((n) => form[n].addEventListener('change', updateOwed));
        $('#st-swap', el).addEventListener('click', () => {
          const a = form.payer.value;
          form.payer.value = form.receiver.value;
          form.receiver.value = a;
          updateOwed();
        });
        updateOwed();
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const payer = form.payer.value;
          const receiver = form.receiver.value;
          if (payer === receiver) return showFormError(form, 'The payer and receiver must be different people.');
          const amount = C.parseAmount(form.amount.value);
          if (amount === null || amount === 0) return showFormError(form, 'Enter the amount that was paid.');
          if (!C.isISODate(form.date.value)) return showFormError(form, 'Choose a valid date.');
          const o = outstanding();
          if (amount > o) {
            const ok = await confirmDialog({
              title: 'Record more than is owed?',
              message: `<p>${esc(personName(payer))} ${o > 0 ? `${payer === ME ? 'owe' : 'owes'} only ${inr(o)}` : `${payer === ME ? 'do' : 'does'} not owe anything`}. After this payment ${esc(receiver === ME ? 'you' : personName(receiver))} will owe ${esc(payer === ME ? 'you' : personName(payer))} ${inr(amount - Math.max(o, 0))}.</p>`,
              confirmLabel: 'Record anyway',
            });
            if (!ok) return;
          }
          const now = C.nowISO();
          const rec = {
            id: st ? st.id : C.uid('st'),
            payerPersonId: payer,
            receiverPersonId: receiver,
            amount,
            date: form.date.value,
            groupId: form.groupId.value || null,
            note: form.note.value.trim() || null,
            createdAt: st ? st.createdAt : now,
            updatedAt: now,
          };
          const errs = C.validateSettlement(rec, C.buildContext(S));
          if (errs.length) return showFormError(form, errs[0]);
          try {
            await persist([{ store: 'settlements', put: rec }]);
            api.close();
            toast(st ? 'Payment updated. Balances recalculated.' : `Payment of ${inr(amount)} recorded.`);
          } catch (err) {
            /* shown */
          }
        });
        if (st) {
          $('#st-del', el).addEventListener('click', async () => {
            const ok = await confirmDialog({
              title: 'Delete this payment?',
              message: `<p>${esc(personName(st.payerPersonId))} to ${esc(personName(st.receiverPersonId))}, ${inr(st.amount)} on ${fmtDate(st.date)}. The balance will go back to what it was before this payment.</p>`,
              confirmLabel: 'Delete',
              danger: true,
            });
            if (!ok) return;
            await persist([{ store: 'settlements', del: st.id }]);
            api.close();
            toast('Payment deleted.');
          });
        }
      },
    });
  }

  /* ---------------------------------------------------------------- friends */

  const contactsSupported = () => 'contacts' in navigator && typeof navigator.contacts.select === 'function' && window.isSecureContext;
  const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = () => /Android/i.test(navigator.userAgent);

  /** Key used to spot the same person twice: last 10 digits of the number, else the lower-case name. */
  function contactKey(name, phone) {
    const d = String(phone || '').replace(/\D/g, '');
    if (d.length >= 7) return `p:${d.slice(-10)}`;
    return `n:${String(name || '').trim().toLowerCase()}`;
  }

  function openContactsHelp() {
    let body;
    if (isIOS()) {
      body = `<p>iPhone keeps contact access switched off for web apps until you turn it on once:</p>
        <ol class="steps">
          <li>Open the iPhone <b>Settings</b> app.</li>
          <li>Go to <b>Apps → Safari → Advanced → Feature Flags</b>. On older iOS versions this is <b>Safari → Advanced → Experimental Features</b>.</li>
          <li>Turn on <b>Contact Picker API</b>.</li>
          <li>Fully close MyExpense (swipe it away) and open it again.</li>
        </ol>
        <p class="hint">Apple labels this experimental, so it may behave differently between iOS versions. If it still does not appear, add friends by typing their name.</p>`;
    } else if (isAndroid()) {
      body = `<p>Contact access works in <b>Google Chrome</b> on Android.</p>
        <ol class="steps"><li>Open MyExpense from its home screen icon, or in Chrome (not Samsung Internet, Firefox or an in-app browser).</li><li>Make sure Chrome is up to date in the Play Store.</li></ol>`;
    } else {
      body = '<p>Contact access is only available on phones: Chrome on Android, or Safari on iPhone with the setting turned on. On a computer, add friends by typing their name.</p>';
    }
    openSheet({
      title: 'Turn on contact access',
      html: `<div class="sheet-text">${body}<p class="hint">MyExpense only receives the contacts you select, keeps them on this phone, and never uploads them.</p></div>
        <div class="sheet-actions"><button type="button" class="btn ghost" data-close>Close</button><button type="button" class="btn primary" id="ch-manual">Type a friend instead</button></div>`,
      onMount(el, api) {
        $('#ch-manual', el).addEventListener('click', () => {
          api.close();
          setTimeout(() => openFriendForm(null), 120);
        });
      },
    });
  }

  async function importContacts() {
    if (!contactsSupported()) return openContactsHelp();
    let picked;
    try {
      picked = await navigator.contacts.select(['name', 'tel'], { multiple: true });
    } catch (err) {
      toast('Contacts could not be opened. Permission may have been denied.', 'error');
      return;
    }
    if (!picked || !picked.length) return;
    const existing = new Map();
    for (const f of S.friends) existing.set(contactKey(f.name, f.phone), f);
    const seen = new Set();
    const rows = [];
    for (const c of picked) {
      const phone = (c.tel && c.tel.find((t) => t && t.trim())) || '';
      const name = ((c.name && c.name.find((n) => n && n.trim())) || phone || '').trim();
      if (!name) continue;
      const key = contactKey(name, phone);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ name: name.slice(0, C.LIMITS.name), phone: phone.trim().slice(0, C.LIMITS.phone) || null, dup: existing.get(key) || null });
    }
    rows.sort((a, b) => (!!a.dup - !!b.dup) || a.name.localeCompare(b.name));
    const fresh = rows.filter((r) => !r.dup).length;
    if (!fresh) {
      toast(rows.length ? 'Everyone you picked is already in your friends.' : 'The selected contacts had no name or number.');
      return;
    }
    openSheet({
      title: `Add ${plural(fresh, 'friend')}`,
      html: `<div class="import-tools">
          ${rows.length > 8 ? `<label class="search">${icon('search')}<span class="sr-only">Search contacts</span><input type="search" id="ci-q" placeholder="Search name or number" autocomplete="off"></label>` : ''}
          <div class="import-bar"><span id="ci-count"></span><span><button type="button" class="link" id="ci-all">Select all</button> <button type="button" class="link" id="ci-none">None</button></span></div>
        </div>
        <div class="parts" id="ci-list">${rows
          .map((r, i) => `<div class="part-row" data-q="${esc((r.name + ' ' + (r.phone || '')).toLowerCase())}">
            <label class="check">${r.dup ? '<input type="checkbox" disabled checked>' : `<input type="checkbox" data-i="${i}" checked>`}
            <span>${esc(r.name)}${r.phone ? `<small class="muted"> ${esc(r.phone)}</small>` : ''}</span></label>
            ${r.dup ? '<span class="badge">Added</span>' : ''}</div>`)
          .join('')}</div>
        <div class="sheet-actions"><button type="button" class="btn ghost" data-close>Cancel</button><button type="button" class="btn primary" id="ci-add"></button></div>`,
      onMount(el, api) {
        const boxes = () => $$('input[data-i]', el);
        const update = () => {
          const n = boxes().filter((b) => b.checked).length;
          $('#ci-count', el).textContent = `${n} of ${fresh} selected`;
          const btn = $('#ci-add', el);
          btn.textContent = n ? `Add ${plural(n, 'friend')}` : 'Select contacts';
          btn.disabled = !n;
        };
        el.addEventListener('change', (e) => {
          if (e.target.matches('input[data-i]')) update();
        });
        const visible = (b) => !b.closest('.part-row').hidden;
        $('#ci-all', el).addEventListener('click', () => {
          boxes().forEach((b) => visible(b) && (b.checked = true));
          update();
        });
        $('#ci-none', el).addEventListener('click', () => {
          boxes().forEach((b) => visible(b) && (b.checked = false));
          update();
        });
        const q = $('#ci-q', el);
        if (q)
          q.addEventListener('input', () => {
            const t = q.value.trim().toLowerCase();
            $$('#ci-list .part-row', el).forEach((r) => (r.hidden = !!t && !r.dataset.q.includes(t)));
          });
        update();
        $('#ci-add', el).addEventListener('click', async () => {
          const now = C.nowISO();
          const ops = boxes()
            .filter((b) => b.checked)
            .map((b) => {
              const r = rows[Number(b.dataset.i)];
              return { store: 'friends', put: { id: C.uid('fr'), name: r.name, phone: r.phone, notes: null, archived: false, createdAt: now, updatedAt: now } };
            })
            .filter((op) => C.validateFriend(op.put).length === 0);
          if (!ops.length) return;
          await persist(ops);
          api.close();
          toast(`${plural(ops.length, 'friend')} added from contacts.`);
        });
      },
    });
  }

  function friendRefs(id) {
    const ses = S.sharedExpenses.filter((s) => s.payerPersonId === id || s.participantShares.some((p) => p.personId === id)).length;
    const sts = S.settlements.filter((s) => s.payerPersonId === id || s.receiverPersonId === id).length;
    return ses + sts;
  }

  function openFriendForm(fr, onSaved) {
    openSheet({
      title: fr ? 'Edit friend' : 'Add friend',
      focus: fr ? null : '#fr-name',
      html: `<form id="frf" class="form" novalidate>
        ${!fr ? (contactsSupported()
          ? `<button type="button" class="btn ghost block" id="fr-pick">${icon('contact')}Choose from contacts</button><p class="hint">Your phone shows its own contact picker. Only the name and number you pick are saved on this device. Nothing is uploaded.</p>`
          : `<button type="button" class="btn ghost block" id="fr-help">${icon('contact')}Choose from contacts</button><p class="hint">Contact access is off in this browser. Tap above to see how to turn it on, or type the details below.</p>`) : ''}
        <label class="field"><span>Name</span><input id="fr-name" name="name" maxlength="${C.LIMITS.name}" value="${esc(fr ? fr.name : '')}" autocomplete="off" required></label>
        <label class="field"><span>Phone <em>optional</em></span><input name="phone" type="tel" maxlength="${C.LIMITS.phone}" value="${esc(fr && fr.phone ? fr.phone : '')}" autocomplete="off"></label>
        <label class="field"><span>Notes <em>optional</em></span><input name="notes" maxlength="${C.LIMITS.notes}" value="${esc(fr && fr.notes ? fr.notes : '')}" autocomplete="off"></label>
        <div class="form-error" role="alert" hidden></div>
        <div class="sheet-actions">
          ${fr ? `<button type="button" class="btn danger-ghost" id="fr-more">${fr.archived ? 'Restore or delete' : 'Archive or delete'}</button>` : ''}
          <button type="submit" class="btn primary">${fr ? 'Save changes' : 'Add friend'}</button>
        </div>
      </form>`,
      onMount(el, api) {
        const form = $('#frf', el);
        const help = $('#fr-help', el);
        if (help)
          help.addEventListener('click', () => {
            api.close();
            setTimeout(openContactsHelp, 120);
          });
        const pick = $('#fr-pick', el);
        if (pick)
          pick.addEventListener('click', async () => {
            try {
              const res = await navigator.contacts.select(['name', 'tel'], { multiple: false });
              if (res && res[0]) {
                if (res[0].name && res[0].name[0]) form.name.value = res[0].name[0].slice(0, C.LIMITS.name);
                if (res[0].tel && res[0].tel[0]) form.phone.value = res[0].tel[0].slice(0, C.LIMITS.phone);
              }
            } catch (err) {
              showFormError(form, 'Contacts could not be opened. Permission may have been denied. You can type the details instead.');
            }
          });
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const name = form.name.value.trim();
          if (!name) return showFormError(form, 'Enter a name.');
          const dup = S.friends.find((x) => x.id !== (fr && fr.id) && x.name.trim().toLowerCase() === name.toLowerCase());
          if (dup) {
            const ok = await confirmDialog({
              title: 'A friend with this name exists',
              message: `<p>You already have ${esc(dup.name)}${dup.archived ? ' (archived)' : ''}. Save another person with the same name?</p>`,
              confirmLabel: 'Save anyway',
            });
            if (!ok) return;
          }
          const now = C.nowISO();
          const rec = {
            id: fr ? fr.id : C.uid('fr'),
            name,
            phone: form.phone.value.trim() || null,
            notes: form.notes.value.trim() || null,
            archived: fr ? fr.archived : false,
            createdAt: fr ? fr.createdAt : now,
            updatedAt: now,
          };
          const errs = C.validateFriend(rec);
          if (errs.length) return showFormError(form, errs[0]);
          await persist([{ store: 'friends', put: rec }]);
          api.close();
          toast(fr ? 'Friend updated.' : `${name} added.`);
          if (onSaved) onSaved(rec);
        });
        if (fr) $('#fr-more', el).addEventListener('click', () => friendLifecycle(fr, api));
      },
    });
  }

  async function friendLifecycle(fr, parentSheet) {
    const refs = friendRefs(fr.id);
    const net = idx.bal.perFriend.get(fr.id) || 0;
    openSheet({
      title: fr.name,
      html: `<div class="sheet-text">
          ${fr.archived ? '<p>This friend is archived. Their history and balance are kept.</p>' : '<p>Archiving hides this friend from new expenses. Their history and balance are kept.</p>'}
          ${net ? `<p class="strong">${esc(balancePhrase(fr.id, net).text)}. Archiving does not settle this.</p>` : ''}
          ${refs ? `<p>Delete is not available because ${esc(fr.name)} appears in ${plural(refs, 'shared expense or payment', 'shared expenses or payments')}. Delete those first or archive instead.</p>` : '<p>Delete removes this friend completely, including from any groups.</p>'}
        </div>
        <div class="sheet-actions">
          <button type="button" class="btn danger-ghost" id="fl-del" ${refs ? 'disabled' : ''}>Delete</button>
          <button type="button" class="btn primary" id="fl-arch">${fr.archived ? 'Restore' : 'Archive'}</button>
        </div>`,
      onMount(el, api) {
        $('#fl-arch', el).addEventListener('click', async () => {
          await persist([{ store: 'friends', put: { ...fr, archived: !fr.archived, updatedAt: C.nowISO() } }]);
          api.close();
          parentSheet.close();
          toast(fr.archived ? `${fr.name} restored.` : `${fr.name} archived.`);
        });
        $('#fl-del', el).addEventListener('click', async () => {
          if (friendRefs(fr.id)) return;
          const ok = await confirmDialog({ title: `Delete ${fr.name}?`, message: '<p>This cannot be undone.</p>', confirmLabel: 'Delete', danger: true });
          if (!ok) return;
          const now = C.nowISO();
          const ops = [{ store: 'friends', del: fr.id }];
          for (const g of S.groups) if (g.memberFriendIds.includes(fr.id)) ops.push({ store: 'groups', put: { ...g, memberFriendIds: g.memberFriendIds.filter((x) => x !== fr.id), updatedAt: now } });
          await persist(ops);
          api.close();
          parentSheet.close();
          location.hash = '#/split';
          toast(`${fr.name} deleted.`);
        });
      },
    });
  }

  /* ----------------------------------------------------------------- groups */

  function openGroupForm(g) {
    const members = new Set(g ? g.memberFriendIds : []);
    const list = () => {
      const ids = activeFriends().map((x) => x.id);
      for (const id of members) if (!ids.includes(id)) ids.push(id);
      return ids;
    };
    openSheet({
      title: g ? 'Edit group' : 'New group',
      focus: g ? null : '#gr-name',
      html: `<form id="grf" class="form" novalidate>
        <label class="field"><span>Group name</span><input id="gr-name" name="name" maxlength="${C.LIMITS.name}" value="${esc(g ? g.name : '')}" placeholder="Goa Trip, Flat Expenses" autocomplete="off"></label>
        <fieldset class="field"><legend>Members <em>you are always included</em></legend>
          ${list().length > 8 ? `<label class="search part-search">${icon('search')}<span class="sr-only">Search friends</span><input type="search" id="gr-q" placeholder="Search friends" autocomplete="off"></label>` : ''}
          <div class="parts" id="gr-members">${list().length ? list().map((id) => `<div class="part-row"><label class="check"><input type="checkbox" value="${esc(id)}" ${members.has(id) ? 'checked' : ''}><span>${esc(personName(id))}</span></label></div>`).join('') : '<p class="muted small">No friends yet.</p>'}</div>
          <button type="button" class="btn ghost small" id="gr-add-friend">${icon('plus')}New friend</button>
        </fieldset>
        <div class="form-error" role="alert" hidden></div>
        <div class="sheet-actions">
          ${g ? `<button type="button" class="btn danger-ghost" id="gr-more">${g.archived ? 'Restore or delete' : 'Archive or delete'}</button>` : ''}
          <button type="submit" class="btn primary">${g ? 'Save changes' : 'Create group'}</button>
        </div>
      </form>`,
      onMount(el, api) {
        const form = $('#grf', el);
        const gq = $('#gr-q', el);
        if (gq)
          gq.addEventListener('input', () => {
            const t = gq.value.trim().toLowerCase();
            $$('#gr-members .part-row', el).forEach((r) => (r.hidden = !!t && !r.textContent.toLowerCase().includes(t)));
          });
        $('#gr-add-friend', el).addEventListener('click', () =>
          openFriendForm(null, (fr) => {
            const box = $('#gr-members', el);
            if ($('p', box)) box.innerHTML = '';
            box.insertAdjacentHTML('beforeend', `<div class="part-row"><label class="check"><input type="checkbox" value="${esc(fr.id)}" checked><span>${esc(fr.name)}</span></label></div>`);
          })
        );
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const name = form.name.value.trim();
          if (!name) return showFormError(form, 'Give the group a name.');
          const ids = $$('#gr-members input:checked', el).map((i) => i.value);
          if (g) {
            const nets = C.personNets(S.sharedExpenses, S.settlements, g.id);
            const removedWithBalance = g.memberFriendIds.filter((id) => !ids.includes(id) && (nets.get(id) || 0) !== 0);
            if (removedWithBalance.length) {
              const ok = await confirmDialog({
                title: 'Remove members with a balance?',
                message: `<p>${esc(removedWithBalance.map(personName).join(', '))} still ${removedWithBalance.length > 1 ? 'have' : 'has'} a balance in this group. Their past expenses stay, but they will not appear for new ones.</p>`,
                confirmLabel: 'Remove',
              });
              if (!ok) return;
            }
          }
          const now = C.nowISO();
          const rec = { id: g ? g.id : C.uid('grp'), name, memberFriendIds: ids, archived: g ? g.archived : false, createdAt: g ? g.createdAt : now, updatedAt: now };
          const errs = C.validateGroup(rec, C.buildContext(S));
          if (errs.length) return showFormError(form, errs[0]);
          await persist([{ store: 'groups', put: rec }]);
          api.close();
          toast(g ? 'Group updated.' : `${name} created.`);
          if (!g) location.hash = `#/split/group/${encodeURIComponent(rec.id)}`;
        });
        if (g)
          $('#gr-more', el).addEventListener('click', () => {
            const refs = S.sharedExpenses.filter((s) => s.groupId === g.id).length + S.settlements.filter((s) => s.groupId === g.id).length;
            openSheet({
              title: g.name,
              html: `<div class="sheet-text"><p>Archiving hides this group from new expenses. All its history and balances are kept.</p>
                ${refs ? `<p>Delete is not available because this group has ${plural(refs, 'record')}. Archive it instead.</p>` : '<p>This group has no expenses, so it can be deleted.</p>'}</div>
                <div class="sheet-actions"><button type="button" class="btn danger-ghost" id="gl-del" ${refs ? 'disabled' : ''}>Delete</button><button type="button" class="btn primary" id="gl-arch">${g.archived ? 'Restore' : 'Archive'}</button></div>`,
              onMount(el2, api2) {
                $('#gl-arch', el2).addEventListener('click', async () => {
                  await persist([{ store: 'groups', put: { ...g, archived: !g.archived, updatedAt: C.nowISO() } }]);
                  api2.close();
                  api.close();
                  toast(g.archived ? 'Group restored.' : 'Group archived. History kept.');
                });
                $('#gl-del', el2).addEventListener('click', async () => {
                  if (refs) return;
                  await persist([{ store: 'groups', del: g.id }]);
                  api2.close();
                  api.close();
                  location.hash = '#/split';
                  toast('Group deleted.');
                });
              },
            });
          });
      },
    });
  }

  /* --------------------------------------------------------------- reports */

  function reportRange() {
    const r = ui.report;
    if (r.period === 'week') return C.weekRange(r.anchor);
    if (r.period === 'year') return C.yearRange(r.anchor.slice(0, 4));
    if (r.period === 'custom') {
      const from = r.from || C.monthRange(C.monthOf(C.todayISO())).from;
      const to = r.to || C.todayISO();
      return from <= to ? { from, to } : { from: to, to: from };
    }
    return C.monthRange(C.monthOf(r.anchor));
  }
  function previousRange(range) {
    const p = ui.report.period;
    if (p === 'week') return { from: C.addDays(range.from, -7), to: C.addDays(range.to, -7) };
    if (p === 'year') return C.yearRange(String(Number(range.from.slice(0, 4)) - 1));
    if (p === 'month') return C.monthRange(C.addMonths(C.monthOf(range.from), -1));
    const len = C.daysBetween(range.from, range.to) + 1;
    return { from: C.addDays(range.from, -len), to: C.addDays(range.from, -1) };
  }
  function rangeLabel(range) {
    const p = ui.report.period;
    if (p === 'month') return fmtMonth(C.monthOf(range.from));
    if (p === 'year') return range.from.slice(0, 4);
    return `${fmtDate(range.from)} to ${fmtDate(range.to)}`;
  }
  function prevLabel(range) {
    const p = ui.report.period;
    if (p === 'month') return MONTHS_LONG[Number(range.from.slice(5, 7)) - 1];
    if (p === 'year') return range.from.slice(0, 4);
    if (p === 'week') return 'the week before';
    return 'the same number of days before';
  }

  function niceMax(v) {
    if (v <= 0) return 100;
    const mag = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * mag >= v) return m * mag;
    return 10 * mag;
  }

  /** Small dependency-free SVG bar chart. series: [{ values, cls, name }] */
  function barChart(labels, series, opts) {
    const o = opts || {};
    const W = 340;
    const H = 170;
    const padL = 42;
    const padB = 22;
    const padT = 8;
    const plotW = W - padL - 6;
    const plotH = H - padB - padT;
    const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
    const n = labels.length;
    const groupW = plotW / n;
    const barW = Math.max(1.5, (groupW * 0.72) / series.length);
    const every = Math.ceil(n / (o.maxLabels || 8));
    let g = '';
    for (const t of [0, 0.5, 1]) {
      const y = padT + plotH - plotH * t;
      g += `<line x1="${padL}" x2="${W - 4}" y1="${y}" y2="${y}" class="grid"/><text x="${padL - 6}" y="${y + 3.5}" class="axis" text-anchor="end">${esc(C.formatINRCompact(max * t))}</text>`;
    }
    labels.forEach((lab, i) => {
      series.forEach((s, k) => {
        const v = s.values[i] || 0;
        const h = (v / max) * plotH;
        const x = padL + i * groupW + (groupW - barW * series.length) / 2 + k * barW;
        if (v > 0) g += `<rect x="${x.toFixed(2)}" y="${(padT + plotH - h).toFixed(2)}" width="${barW.toFixed(2)}" height="${Math.max(h, 1).toFixed(2)}" rx="1.5" class="${s.cls}"><title>${esc(`${lab}: ${s.name} ${C.formatINR(v)}`)}</title></rect>`;
      });
      if (i % every === 0) g += `<text x="${(padL + i * groupW + groupW / 2).toFixed(2)}" y="${H - 6}" class="axis" text-anchor="middle">${esc(lab)}</text>`;
    });
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.label || 'Chart')}">${g}</svg>`;
  }

  function viewReports() {
    const R = ui.report;
    const range = reportRange();
    const prev = previousRange(range);
    const cat = R.categoryId;
    const sum = C.summarize(S, range, cat);
    const psum = C.summarize(S, prev, cat);
    const days = C.daysBetween(range.from, range.to) + 1;
    const daily = days <= 62;
    const elapsed = Math.max(1, Math.min(days, C.daysBetween(range.from, C.todayISO()) + 1));
    const hasData = sum.spending > 0 || sum.income > 0 || sum.sharedCashPaid > 0;

    let trend = '';
    if (daily) {
      const list = C.listDays(range);
      const labels = list.map((d) => (R.period === 'week' ? DAYS_SHORT[C.parseISO(d).getDay()] : String(Number(d.slice(8)))));
      trend = barChart(labels, [{ values: list.map((d) => sum.byDay.get(d) || 0), cls: 'b-spend', name: 'Spending' }], { label: `Daily personal spending, ${rangeLabel(range)}`, maxLabels: R.period === 'week' ? 7 : 8 });
    } else {
      const months = C.listMonths(range);
      trend = barChart(
        months.map((m) => MONTHS_SHORT[Number(m.slice(5)) - 1]),
        [
          { values: months.map((m) => sum.incomeByMonth.get(m) || 0), cls: 'b-income', name: 'Income' },
          { values: months.map((m) => sum.byMonth.get(m) || 0), cls: 'b-spend', name: 'Spending' },
        ],
        { label: `Monthly income and personal spending, ${rangeLabel(range)}`, maxLabels: 12 }
      );
    }

    const diff = sum.spending - psum.spending;
    let cmpText;
    if (psum.spending === 0) cmpText = `No personal spending recorded in ${prevLabel(prev)}.`;
    else if (diff === 0) cmpText = `Same as ${prevLabel(prev)}.`;
    else cmpText = `${inr(Math.abs(diff))} ${diff > 0 ? 'more' : 'less'} than ${prevLabel(prev)} (${diff > 0 ? '+' : '\u2212'}${Math.round((Math.abs(diff) / psum.spending) * 100)}%).`;

    const cats = [...sum.byCategory].sort((a, b) => b[1] - a[1]);
    const ioMax = Math.max(sum.income, sum.spending, 1);
    const bal = idx.bal;
    const saved = sum.income - sum.spending;

    const body = `
      <div class="seg wide" role="radiogroup" aria-label="Report period">
        ${[['week', 'Week'], ['month', 'Month'], ['year', 'Year'], ['custom', 'Custom']].map(([k, l]) => `<label class="seg-opt"><input type="radio" name="rp" value="${k}" ${R.period === k ? 'checked' : ''} data-report-period><span>${l}</span></label>`).join('')}
      </div>
      ${R.period === 'custom'
        ? `<div class="grid2"><label class="field"><span>From</span><input type="date" id="rp-from" value="${esc(range.from)}"></label><label class="field"><span>To</span><input type="date" id="rp-to" value="${esc(range.to)}"></label></div>`
        : `<div class="month-switch"><button type="button" class="icon-btn" data-action="report-prev" aria-label="Previous period">${icon('left')}</button><span class="month-label">${esc(rangeLabel(range))}</span><button type="button" class="icon-btn" data-action="report-next" aria-label="Next period">${icon('right')}</button></div>`}
      <label class="field inline"><span>Category</span><select id="rp-cat">${options([['', 'All categories'], ...sortedCategories().map((c) => [c.id, c.name])], cat)}</select></label>
      ${!hasData ? emptyState(NO_DATA, `Nothing was recorded between ${fmtDate(range.from)} and ${fmtDate(range.to)}${cat ? ` in ${esc(catName(cat))}` : ''}. Try another period or add transactions.`, '') : `
      <section class="report-hero">
        <p class="hero-label">Personal spending</p>
        <p class="hero-amount">${inr(sum.spending)}</p>
        <p class="hero-meta">${esc(cmpText)} Average ${inr(Math.round(sum.spending / elapsed))} a day.</p>
      </section>
      <section class="stats">
        <div class="stat"><span class="stat-label">Income</span><span class="stat-value pos">${inr(sum.income)}</span></div>
        <div class="stat"><span class="stat-label">Income minus spending</span><span class="stat-value ${saved >= 0 ? 'pos' : 'neg'}">${inr(saved, { signed: true })}</span></div>
        <div class="stat"><span class="stat-label">Cash paid for split bills</span><span class="stat-value">${inr(sum.sharedCashPaid)}</span><span class="stat-note">${inr(sum.paidForFriends)} of it was for friends, so it is not in your spending</span></div>
        <div class="stat"><span class="stat-label">Payments</span><span class="stat-value small-v">In ${inr(sum.settlementsReceived)}<br>Out ${inr(sum.settlementsPaid)}</span><span class="stat-note">Settlements with friends. Not income or spending.</span></div>
      </section>
      <section class="panel">
        <h2 class="panel-title">${daily ? 'Daily spending' : 'Income and spending by month'}</h2>
        ${trend}
        ${!daily ? '<p class="legend"><span class="key b-income"></span>Income <span class="key b-spend"></span>Personal spending</p>' : ''}
      </section>
      <section class="panel">
        <h2 class="panel-title">Income vs personal spending</h2>
        <div class="io">
          <div class="io-row"><span>Income</span><span class="io-track"><span class="b-income" style="width:${((sum.income / ioMax) * 100).toFixed(1)}%"></span></span><span>${inr(sum.income)}</span></div>
          <div class="io-row"><span>Spending</span><span class="io-track"><span class="b-spend" style="width:${((sum.spending / ioMax) * 100).toFixed(1)}%"></span></span><span>${inr(sum.spending)}</span></div>
        </div>
      </section>
      <section class="panel">
        <h2 class="panel-title">Categories, highest first</h2>
        ${cats.length ? `<div class="donut-center">${donut(cats, sum.spending)}</div>${legendList(cats, sum.spending)}` : noData('No spending in this period.')}
      </section>`}
      <section class="panel">
        <h2 class="panel-title">Shared balances today</h2>
        <ul class="plain">
          <li><span>Friends owe you</span><span class="pos">${inr(bal.receivable)}</span></li>
          <li><span>You owe friends</span><span class="neg">${inr(bal.payable)}</span></li>
          <li><span>Net</span><span class="${bal.net >= 0 ? 'pos' : 'neg'}">${inr(bal.net, { signed: true })}</span></li>
        </ul>
      </section>
      <p class="hint">Personal spending is your personal expenses plus only your share of split bills. Money you paid for friends, money they owe you, and settlements are kept separate so nothing is counted twice.</p>`;
    return {
      title: 'Reports',
      body,
      actions: hasData ? `<button type="button" class="icon-btn" data-action="report-export" aria-label="Export this report as CSV" title="Export CSV">${icon('download')}</button>` : '',
      mount() {
        $$('[data-report-period]').forEach((r) =>
          r.addEventListener('change', () => {
            ui.report.period = r.value;
            if (r.value === 'custom' && !ui.report.from) {
              const cur = C.monthRange(C.monthOf(C.todayISO()));
              ui.report.from = cur.from;
              ui.report.to = C.todayISO();
            }
            render();
          })
        );
        $('#rp-cat').addEventListener('change', (e) => {
          ui.report.categoryId = e.target.value;
          render();
        });
        const from = $('#rp-from');
        if (from) {
          const apply = () => {
            if (C.isISODate($('#rp-from').value)) ui.report.from = $('#rp-from').value;
            if (C.isISODate($('#rp-to').value)) ui.report.to = $('#rp-to').value;
            render();
          };
          from.addEventListener('change', apply);
          $('#rp-to').addEventListener('change', apply);
        }
      },
    };
  }

  function shiftReport(dir) {
    const r = ui.report;
    if (r.period === 'week') r.anchor = C.addDays(r.anchor, 7 * dir);
    else if (r.period === 'year') r.anchor = `${Number(r.anchor.slice(0, 4)) + dir}${r.anchor.slice(4)}`;
    else r.anchor = `${C.addMonths(C.monthOf(r.anchor), dir)}-01`;
    render();
  }

  /* -------------------------------------------------------------- settings */

  function viewSettings() {
    const mk = C.monthOf(C.todayISO());
    const b = C.budgetFor(S, mk);
    const counts = C.countRecords(S);
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    const swReady = 'serviceWorker' in navigator && !!navigator.serviceWorker.controller;
    const theme = getTheme();
    const body = `
      <section class="panel">
        <h2 class="panel-title">Appearance</h2>
        <div class="seg theme-seg" role="radiogroup" aria-label="Theme">
          ${[['system', '📱 System'], ['light', '☀️ Light'], ['dark', '🌙 Dark']].map(([k, l]) => `<label class="seg-opt"><input type="radio" name="theme" value="${k}" ${theme === k ? 'checked' : ''}><span>${l}</span></label>`).join('')}
        </div>
        <p class="hint" style="margin-bottom:0">System follows your phone’s light or dark mode. Saved on this device only.</p>
      </section>
      <section class="panel">
        <h2 class="panel-title">Budget</h2>
        <ul class="plain">
          <li><span>${fmtMonth(mk)}</span><span>${b ? inr(b.amount) + (b.source === 'default' ? ' (default)' : '') : 'Not set'} <button type="button" class="link" data-action="edit-budget" data-month="${mk}">Change</button></span></li>
        </ul>
        <form id="set-form" class="form" novalidate>
          <div class="grid2">
            <label class="field"><span>Default monthly budget</span><span class="amount-input"><span aria-hidden="true">₹</span><input name="defaultBudget" inputmode="decimal" value="${S.settings.defaultBudget ? esc(C.amountToInput(S.settings.defaultBudget)) : ''}" placeholder="None"></span></label>
            <label class="field"><span>Warn me at</span><span class="amount-input"><input name="warnThreshold" inputmode="numeric" value="${S.settings.warnThreshold}"><span aria-hidden="true">%</span></span></label>
          </div>
          <p class="hint">The default applies to any month without its own budget. Only your personal spending counts against it, including just your share of split bills.</p>
          <div class="form-error" role="alert" hidden></div>
          <button type="submit" class="btn ghost">Save budget settings</button>
        </form>
      </section>

      <section class="panel">
        <div class="panel-head"><h2 class="panel-title">Categories</h2><button type="button" class="btn ghost small" data-action="manage-categories">Manage</button></div>
        <p class="muted small">${plural(S.categories.length, 'category', 'categories')}, ${S.categories.filter((c) => c.isCustom).length} custom.</p>
      </section>

      <section class="panel" id="backup">
        <h2 class="panel-title">Backup and restore</h2>
        <p class="hint">Your data is stored only in this browser on this device. It is not encrypted by MyExpense, not synced, and the phone or browser can delete it, for example when you clear site data or uninstall. Export a backup regularly and keep the file in Files, iCloud Drive or Google Drive yourself.</p>
        <p class="small">Last backup from this device: <strong>${esc(fmtTs(device.lastBackupAt))}</strong></p>
        <div class="stack">
          <button type="button" class="btn primary block" data-action="export-json">${icon('download')}Export full backup (JSON)</button>
          <button type="button" class="btn ghost block" data-action="import-json">${icon('upload')}Import a backup</button>
          <button type="button" class="btn ghost block" data-action="export-csv">Export all transactions (CSV)</button>
          <button type="button" class="btn ghost block" data-action="export-split-csv">Export split history (CSV)</button>
        </div>
        <p class="muted small">On this device: ${plural(counts.transactions, 'transaction')}, ${plural(counts.sharedExpenses, 'shared expense')}, ${plural(counts.settlements, 'payment')}, ${plural(counts.friends, 'friend')}, ${plural(counts.groups, 'group')}.</p>
      </section>

      <section class="panel">
        <h2 class="panel-title">This device</h2>
        <ul class="plain" id="device-info">
          <li><span>Installed as app</span><span>${standalone ? 'Yes' : 'No'}</span></li>
          <li><span>Works offline</span><span>${PREVIEW ? 'Not in preview' : swReady ? 'Yes' : 'Not yet'}</span></li>
          <li><span>Storage protection</span><span id="persist-state">Checking</span></li>
          <li><span>Storage used</span><span id="storage-used">Checking</span></li>
        </ul>
        ${deferredInstall ? `<button type="button" class="btn primary block" data-action="install-app">Install MyExpense</button>` : ''}
        ${!standalone ? `<details class="howto"><summary>How to install</summary>
          <p><strong>iPhone:</strong> open this page in Safari, tap Share, then Add to Home Screen.</p>
          <p><strong>Android:</strong> open this page in Chrome, tap the menu, then Install app or Add to Home screen.</p>
          <p>Each phone keeps its own separate data. To move data, export a backup on one phone and import it on the other.</p></details>` : ''}
        ${!PREVIEW && !swReady ? '<p class="hint">Offline use starts after the app has loaded once over the internet. Reopen it once while online if this still says Not yet.</p>' : ''}
      </section>

      <section class="panel danger-zone">
        <h2 class="panel-title">Erase data</h2>
        <p class="hint">Removes every transaction, friend, group, split and payment from this device. Export a backup first if you might need it.</p>
        <button type="button" class="btn danger-ghost block" data-action="erase-all">Erase all data on this device</button>
      </section>
      <p class="muted small center">MyExpense ${APP_VERSION}, data schema ${C.SCHEMA_VERSION}. No account, no tracking, no data leaves this device.</p>`;
    return {
      title: 'Settings',
      back: '#/home',
      body,
      mount() {
        $$('input[name=theme]').forEach((r) =>
          r.addEventListener('change', () => {
            setTheme(r.value);
            toast(r.value === 'system' ? 'Theme now follows your phone.' : `${r.value === 'dark' ? 'Dark' : 'Light'} theme on.`);
          })
        );
        const form = $('#set-form');
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const raw = form.defaultBudget.value.trim();
          const db = raw ? C.parseAmount(raw) : 0;
          if (db === null) return showFormError(form, 'Enter the default budget as a number, like 40000.');
          const th = Number(form.warnThreshold.value);
          if (!Number.isInteger(th) || th < 1 || th > 100) return showFormError(form, 'The warning level must be a whole number from 1 to 100.');
          showFormError(form, '');
          await persist([{ store: DB.META, put: { key: 'settings', value: { ...S.settings, defaultBudget: db, warnThreshold: th } } }]);
          toast('Budget settings saved.');
        });
        storageInfo();
      },
    };
  }

  async function storageInfo() {
    const ps = $('#persist-state');
    const su = $('#storage-used');
    try {
      if (navigator.storage && navigator.storage.persisted) {
        const p = await navigator.storage.persisted();
        if (ps) ps.innerHTML = p ? 'Protected from automatic cleanup' : `Not protected <button type="button" class="link" data-action="request-persist">Ask</button>`;
      } else if (ps) ps.textContent = 'Not supported';
      if (navigator.storage && navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        if (su) su.textContent = `${(est.usage / 1048576).toFixed(1)} MB`;
      } else if (su) su.textContent = 'Unknown';
    } catch (err) {
      if (ps) ps.textContent = 'Unknown';
      if (su) su.textContent = 'Unknown';
    }
  }

  function openBudgetForm(mk) {
    const rec = S.budgets.find((b) => b.month === mk);
    const eff = C.budgetFor(S, mk);
    openSheet({
      title: `Budget for ${fmtMonth(mk)}`,
      focus: '#bd-amount',
      html: `<form id="bdf" class="form" novalidate>
        <label class="field amount-field"><span>Monthly budget</span><span class="amount-input"><span aria-hidden="true">₹</span><input id="bd-amount" name="amount" inputmode="decimal" value="${eff ? esc(C.amountToInput(eff.amount)) : ''}" placeholder="40000" autocomplete="off"></span></label>
        <label class="check"><input type="checkbox" name="asDefault" ${!S.settings.defaultBudget ? 'checked' : ''}><span>Also use this for months without their own budget</span></label>
        <p class="hint">Counts your personal expenses and only your share of split bills. Money friends owe you is not income.</p>
        <div class="form-error" role="alert" hidden></div>
        <div class="sheet-actions">
          ${rec ? `<button type="button" class="btn danger-ghost" id="bd-clear">${S.settings.defaultBudget ? 'Use default' : 'Remove'}</button>` : ''}
          <button type="submit" class="btn primary">Save budget</button>
        </div>
      </form>`,
      onMount(el, api) {
        const form = $('#bdf', el);
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const amount = C.parseAmount(form.amount.value);
          if (amount === null || amount === 0) return showFormError(form, 'Enter a budget greater than zero.');
          const now = C.nowISO();
          const ops = [{ store: 'budgets', put: { id: rec ? rec.id : C.budgetId(mk), month: mk, amount, createdAt: rec ? rec.createdAt : now, updatedAt: now } }];
          if (form.asDefault.checked) ops.push({ store: DB.META, put: { key: 'settings', value: { ...S.settings, defaultBudget: amount } } });
          await persist(ops);
          api.close();
          toast(`Budget for ${fmtMonth(mk)} set to ${inr(amount)}.`);
        });
        const clr = $('#bd-clear', el);
        if (clr)
          clr.addEventListener('click', async () => {
            await persist([{ store: 'budgets', del: rec.id }]);
            api.close();
            toast(S.settings.defaultBudget ? 'This month now uses the default budget.' : 'Budget removed.');
          });
      },
    });
  }

  function openCategories() {
    const rowsHtml = () =>
      sortedCategories()
        .map((c) => {
          const used = S.transactions.filter((t) => t.categoryId === c.id).length + S.sharedExpenses.filter((s) => s.categoryId === c.id).length;
          return `<button type="button" class="row" data-cat="${esc(c.id)}">${catIcon(c.id, 'sm')}<span class="row-main"><span class="row-title">${esc(c.name)}</span><span class="row-sub">${c.type === 'both' ? 'Income and expense' : c.type === 'income' ? 'Income' : 'Expense'}, used ${plural(used, 'time')}</span></span></button>`;
        })
        .join('');
    openSheet({
      title: 'Categories',
      html: `<button type="button" class="btn ghost block" id="cat-add">${icon('plus')}New category</button><div class="rows" id="cat-rows">${rowsHtml()}</div>`,
      onMount(el) {
        const refresh = () => ($('#cat-rows', el).innerHTML = rowsHtml());
        $('#cat-add', el).addEventListener('click', () => openCategoryForm(null, refresh));
        $('#cat-rows', el).addEventListener('click', (e) => {
          const b = e.target.closest('[data-cat]');
          if (b) openCategoryForm(idx.cat.get(b.dataset.cat), refresh);
        });
      },
    });
  }

  function openCategoryForm(c, done) {
    openSheet({
      title: c ? 'Edit category' : 'New category',
      focus: '#cat-name',
      html: `<form id="catf" class="form" novalidate>
        <label class="field"><span>Name</span><input id="cat-name" name="name" maxlength="${C.LIMITS.name}" value="${esc(c ? c.name : '')}" autocomplete="off"></label>
        <label class="field"><span>Used for</span><select name="type">${options([['expense', 'Expenses'], ['income', 'Income'], ['both', 'Both']], c ? c.type : 'expense')}</select></label>
        <div class="form-error" role="alert" hidden></div>
        <div class="sheet-actions">
          ${c && c.id !== C.OTHER_CATEGORY_ID ? `<button type="button" class="btn danger-ghost" id="cat-del">Delete</button>` : ''}
          <button type="submit" class="btn primary">${c ? 'Save changes' : 'Add category'}</button>
        </div>
      </form>`,
      onMount(el, api) {
        const form = $('#catf', el);
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const name = form.name.value.trim();
          if (!name) return showFormError(form, 'Enter a name.');
          if (S.categories.some((x) => x.id !== (c && c.id) && x.name.trim().toLowerCase() === name.toLowerCase())) return showFormError(form, 'A category with this name already exists.');
          const now = C.nowISO();
          const rec = { id: c ? c.id : C.uid('cat'), name, type: form.type.value, isCustom: c ? c.isCustom : true, createdAt: c ? c.createdAt : now, updatedAt: now };
          const errs = C.validateCategory(rec);
          if (errs.length) return showFormError(form, errs[0]);
          await persist([{ store: 'categories', put: rec }]);
          api.close();
          if (done) done();
          toast(c ? 'Category updated.' : 'Category added.');
        });
        const del = $('#cat-del', el);
        if (del)
          del.addEventListener('click', async () => {
            const txs = S.transactions.filter((t) => t.categoryId === c.id);
            const ses = S.sharedExpenses.filter((s) => s.categoryId === c.id);
            const n = txs.length + ses.length;
            const ok = await confirmDialog({
              title: `Delete ${c.name}?`,
              message: n ? `<p>${plural(n, 'record')} use this category. They will move to Other.</p>` : '<p>No records use this category.</p>',
              confirmLabel: 'Delete',
              danger: true,
            });
            if (!ok) return;
            const now = C.nowISO();
            const ops = [];
            for (const s of ses) {
              const rec = { ...s, categoryId: C.OTHER_CATEGORY_ID, updatedAt: now };
              ops.push({ store: 'sharedExpenses', put: rec });
            }
            for (const t of txs) ops.push({ store: 'transactions', put: { ...t, categoryId: C.OTHER_CATEGORY_ID, updatedAt: now } });
            ops.push({ store: 'categories', del: c.id });
            await persist(ops);
            api.close();
            if (done) done();
            toast('Category deleted.');
          });
      },
    });
  }

  /* --------------------------------------------------------- import/export */

  const isTouch = () => window.matchMedia('(pointer: coarse)').matches;

  /** Offer a file to the user: share sheet on phones (Save to Files / Drive), download elsewhere. */
  async function saveFile(filename, mime, content) {
    if (PREVIEW) {
      toast('File export is disabled in this preview. Use the installed app to export.', 'error');
      return 'blocked';
    }
    const blob = new Blob([content], { type: mime });
    try {
      const file = new File([blob], filename, { type: mime });
      if (isTouch() && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        return 'shared';
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return 'cancelled';
      // fall through to download
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);
    return 'downloaded';
  }

  function stamp() {
    const d = new Date();
    return `${C.toISODate(d)}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  }

  async function exportBackup(silentLabel) {
    const json = JSON.stringify(C.buildBackup(S), null, 1);
    const res = await saveFile(`myexpense-backup_${stamp()}.json`, 'application/json', json);
    if (res === 'shared' || res === 'downloaded') {
      await persist([{ store: DB.META, put: { key: 'device', value: { ...device, lastBackupAt: C.nowISO() } } }]);
      if (!silentLabel) toast('Backup file created. Keep it somewhere safe outside this phone.');
      return true;
    }
    return false;
  }

  function txnCsvRows(list) {
    const rows = [['Date', 'Type', 'Category', 'Amount (INR)', 'Payment method', 'Personal or split', 'Your share (INR)', 'Description', 'Tags', 'Transaction ID']];
    for (const t of list) {
      const se = t.classification === 'shared' ? idx.se.get(t.sharedExpenseId) : null;
      rows.push([
        t.date,
        t.type === 'income' ? 'Income' : 'Expense',
        catName(t.categoryId),
        C.amountToDecimal(t.amount),
        t.paymentMethod,
        t.classification === 'shared' ? 'Split bill (cash paid)' : 'Personal',
        se ? C.amountToDecimal(C.myShare(se)) : t.type === 'expense' ? C.amountToDecimal(t.amount) : '',
        t.description,
        (t.tags || []).join(' '),
        t.id,
      ]);
    }
    return rows;
  }

  function splitCsvRows() {
    const rows = [['Date', 'Kind', 'Description', 'Group', 'Paid by', 'Received by', 'Amount (INR)', 'Split method', 'Your share (INR)', 'Participants', 'Category', 'Notes', 'ID']];
    const items = activityItems(() => true).reverse();
    for (const it of items) {
      const r = it.rec;
      const g = r.groupId && idx.group.get(r.groupId) ? idx.group.get(r.groupId).name : '';
      if (it.kind === 'se') {
        rows.push([
          r.date, 'Shared expense', r.description, g, personName(r.payerPersonId), '', C.amountToDecimal(r.totalAmount),
          { equal: 'Equal', fixed: 'Amounts', percent: 'Percent' }[r.splitMethod], C.amountToDecimal(C.myShare(r)),
          r.participantShares.map((p) => `${personName(p.personId)}: ${C.amountToDecimal(p.share)}`).join('; '),
          catName(r.categoryId || C.OTHER_CATEGORY_ID), r.notes || '', r.id,
        ]);
      } else {
        rows.push([r.date, 'Payment', r.note || '', g, personName(r.payerPersonId), personName(r.receiverPersonId), C.amountToDecimal(r.amount), '', '', '', '', '', r.id]);
      }
    }
    return rows;
  }

  function reportCsvRows() {
    const range = reportRange();
    const cat = ui.report.categoryId;
    const sum = C.summarize(S, range, cat);
    const rows = [
      ['MyExpense report', `${range.from} to ${range.to}`, cat ? `Category: ${catName(cat)}` : 'All categories'],
      [],
      ['Summary', 'Amount (INR)'],
      ['Personal spending', C.amountToDecimal(sum.spending)],
      ['Income', C.amountToDecimal(sum.income)],
      ['Income minus spending', C.amountToDecimal(sum.income - sum.spending)],
      ['Cash paid for split bills', C.amountToDecimal(sum.sharedCashPaid)],
      ['Of which paid for friends', C.amountToDecimal(sum.paidForFriends)],
      ['Payments received from friends', C.amountToDecimal(sum.settlementsReceived)],
      ['Payments made to friends', C.amountToDecimal(sum.settlementsPaid)],
      ['Friends owe you (today)', C.amountToDecimal(idx.bal.receivable)],
      ['You owe friends (today)', C.amountToDecimal(idx.bal.payable)],
      [],
      ['Category', 'Personal spending (INR)', 'Share of total (%)'],
      ...[...sum.byCategory].sort((a, b) => b[1] - a[1]).map(([id, v]) => [catName(id), C.amountToDecimal(v), sum.spending ? Math.round((v / sum.spending) * 1000) / 10 : 0]),
      [],
      ['Date', 'Personal spending (INR)', 'Income (INR)'],
      ...C.listDays(range).map((d) => [d, C.amountToDecimal(sum.byDay.get(d) || 0), C.amountToDecimal(sum.incomeByDay.get(d) || 0)]),
    ];
    return rows;
  }

  function pickFile() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.addEventListener('change', () => resolve(input.files && input.files[0] ? input.files[0] : null));
      input.click();
    });
  }

  async function startImport() {
    const file = await pickFile();
    if (!file) return;
    if (file.size > 25 * 1048576) return toast('This file is too large to be a MyExpense backup.', 'error');
    let text;
    try {
      text = await file.text();
    } catch (err) {
      return toast('The file could not be read.', 'error');
    }
    const parsed = C.parseBackup(text);
    if (!parsed.ok) {
      openSheet({
        title: 'This backup cannot be imported',
        html: `<div class="sheet-text"><p>${esc(file.name)} was checked and nothing was changed.</p><ul class="errors">${parsed.errors.slice(0, 12).map((e) => `<li>${esc(e)}</li>`).join('')}</ul>${parsed.errors.length > 12 ? `<p class="muted small">And ${parsed.errors.length - 12} more problems.</p>` : ''}</div><div class="sheet-actions"><button type="button" class="btn primary" data-close>Close</button></div>`,
      });
      return;
    }
    const inc = parsed.meta.counts;
    const merge = C.planMerge(S, parsed.state);
    const hasCurrent = S.transactions.length + S.sharedExpenses.length + S.settlements.length + S.friends.length > 0;
    const statLine = (k, label) => {
      const s = merge.stats[k];
      return `<tr><td>${label}</td><td>${inc[k]}</td><td>${s.added}</td><td>${s.updated}</td></tr>`;
    };
    openSheet({
      title: 'Import backup',
      html: `<div class="sheet-text">
          <p><strong>${esc(file.name)}</strong>${parsed.meta.exportedAt ? `, exported ${esc(fmtTs(parsed.meta.exportedAt))}` : ''}. The file passed all checks.</p>
          <div class="table-wrap"><table class="mini">
            <thead><tr><th>Records</th><th>In file</th><th>New if merged</th><th>Newer if merged</th></tr></thead>
            <tbody>
              ${statLine('transactions', 'Transactions')}${statLine('sharedExpenses', 'Shared expenses')}${statLine('settlements', 'Payments')}${statLine('friends', 'Friends')}${statLine('groups', 'Groups')}${statLine('categories', 'Categories')}${statLine('budgets', 'Budgets')}
            </tbody></table></div>
        </div>
        <div class="choice">
          <h3>Replace</h3>
          <p class="hint">This device will hold exactly what is in the file. ${hasCurrent ? 'Everything currently on this device is removed.' : 'This device has no data yet.'}</p>
          ${hasCurrent ? `<label class="check"><input type="checkbox" id="im-pre" checked><span>Export a backup of this device first</span></label>` : ''}
          <button type="button" class="btn ${hasCurrent ? 'danger' : 'primary'} block" id="im-replace">Replace all data</button>
        </div>
        ${hasCurrent ? `<div class="choice">
          <h3>Merge</h3>
          <p class="hint">Adds records that are new, and takes the newer version where the same record was edited on both devices. Same-named categories are combined. Deletions are not copied over, and settings on this device are kept.</p>
          ${merge.ok ? `<button type="button" class="btn primary block" id="im-merge">Merge into this device</button>` : `<p class="alert danger">Merging would leave inconsistent data, so it is not offered: ${esc(merge.errors[0])}</p>`}
        </div>` : ''}`,
      onMount(el, api) {
        $('#im-replace', el).addEventListener('click', async () => {
          if (hasCurrent) {
            const pre = $('#im-pre', el);
            if (pre && pre.checked) {
              const saved = await exportBackup(true);
              if (!saved) {
                const go = await confirmDialog({ title: 'Pre-import backup not saved', message: '<p>The backup of this device was not saved. Replace anyway?</p>', confirmLabel: 'Replace anyway', danger: true });
                if (!go) return;
              }
            }
            const ok = await confirmDialog({
              title: 'Replace all data on this device?',
              message: `<p>${plural(S.transactions.length, 'transaction')}, ${plural(S.sharedExpenses.length, 'shared expense')} and ${plural(S.friends.length, 'friend')} on this device will be replaced by the contents of the file.</p>`,
              confirmLabel: 'Replace',
              danger: true,
              requireText: 'REPLACE',
            });
            if (!ok) return;
          }
          await applyImport({ ...parsed.state, settings: parsed.state.settings });
          api.close();
          toast('Backup restored.');
        });
        const m = $('#im-merge', el);
        if (m)
          m.addEventListener('click', async () => {
            await applyImport(merge.state);
            api.close();
            const added = Object.values(merge.stats).reduce((a, s) => a + s.added, 0);
            const updated = Object.values(merge.stats).reduce((a, s) => a + s.updated, 0);
            toast(`Merged. ${plural(added, 'record')} added, ${updated} updated.`);
          });
      },
    });
  }

  async function applyImport(next) {
    const errs = C.validateState(next);
    if (errs.length) {
      toast(`Import stopped, nothing changed: ${errs[0]}`, 'error');
      throw new Error(errs[0]);
    }
    try {
      await DB.replaceAll(next);
    } catch (err) {
      toast(`Import failed, nothing changed: ${err.message}`, 'error');
      throw err;
    }
    S = next;
    reindex();
    if (channel) channel.postMessage('changed');
    render();
  }

  /* ----------------------------------------------------------- event wiring */

  const actions = {
    'month-prev': () => {
      ui.month = C.addMonths(ui.month, -1);
      render();
    },
    'month-next': () => {
      ui.month = C.addMonths(ui.month, 1);
      render();
    },
    'month-today': () => {
      ui.month = C.monthOf(C.todayISO());
      render();
    },
    'quick-add': () => openQuickAdd(),
    'add-txn': (el) => openTxnForm(null, { type: el.dataset.type || 'expense' }),
    'edit-txn': (el) => {
      const t = idx.txn.get(el.dataset.id);
      if (t) openTxnForm(t);
    },
    'tx-filters': () => openTxFilters(),
    'tx-clear': () => {
      Object.assign(ui.tx, { q: '', from: '', to: '', categoryId: '', type: '', paymentMethod: '', classification: '', limit: 100 });
      render();
    },
    'tx-chip-remove': (el) => {
      const k = el.dataset.key;
      if (k === 'dates') {
        ui.tx.from = '';
        ui.tx.to = '';
      } else ui.tx[k] = '';
      render();
    },
    'tx-more': () => {
      ui.tx.limit += 100;
      $('#tx-list').innerHTML = renderTxnList();
    },
    'tx-export': async () => {
      const list = filteredTxns();
      if (!list.length) return toast('No transactions to export.', 'error');
      const r = await saveFile(`myexpense-transactions_${stamp()}.csv`, 'text/csv', C.toCSV(txnCsvRows(list)));
      if (r === 'shared' || r === 'downloaded') toast(`${plural(list.length, 'transaction')} exported.`);
    },
    'add-shared': (el) => openSharedForm(null, { groupId: el.dataset.group, friendId: el.dataset.friend }),
    'edit-shared': (el) => {
      const se = idx.se.get(el.dataset.id);
      if (se) openSharedForm(se);
    },
    'add-settlement': (el) => openSettlementForm(null, { from: el.dataset.from, to: el.dataset.to, amount: el.dataset.amount, groupId: el.dataset.group }),
    'edit-settlement': (el) => {
      const st = idx.st.get(el.dataset.id);
      if (st) openSettlementForm(st);
    },
    'add-friend': () => openFriendForm(null),
    'import-contacts': () => importContacts(),
    'edit-friend': (el) => {
      const f = idx.friend.get(el.dataset.id);
      if (f) openFriendForm(f);
    },
    'add-group': () => openGroupForm(null),
    'edit-group': (el) => {
      const g = idx.group.get(el.dataset.id);
      if (g) openGroupForm(g);
    },
    'split-tab': (el) => {
      ui.splitTab = el.dataset.tab;
      render();
    },
    'toggle-archived-friends': () => {
      ui.showArchivedFriends = !ui.showArchivedFriends;
      render();
    },
    'toggle-archived-groups': () => {
      ui.showArchivedGroups = !ui.showArchivedGroups;
      render();
    },
    'activity-more': () => {
      ui.activityLimit += 60;
      render();
    },
    'report-prev': () => shiftReport(-1),
    'report-next': () => shiftReport(1),
    'report-export': async () => {
      const r = await saveFile(`myexpense-report_${stamp()}.csv`, 'text/csv', C.toCSV(reportCsvRows()));
      if (r === 'shared' || r === 'downloaded') toast('Report exported.');
    },
    'edit-budget': (el) => openBudgetForm(el.dataset.month || C.monthOf(C.todayISO())),
    'manage-categories': () => openCategories(),
    'export-json': () => exportBackup(),
    'export-csv': async () => {
      const list = S.transactions.slice().sort(txSort).reverse();
      if (!list.length) return toast('No transactions to export yet.', 'error');
      const r = await saveFile(`myexpense-transactions_${stamp()}.csv`, 'text/csv', C.toCSV(txnCsvRows(list)));
      if (r === 'shared' || r === 'downloaded') toast('Transactions exported.');
    },
    'export-split-csv': async () => {
      if (!S.sharedExpenses.length && !S.settlements.length) return toast('No split history to export yet.', 'error');
      const r = await saveFile(`myexpense-split-history_${stamp()}.csv`, 'text/csv', C.toCSV(splitCsvRows()));
      if (r === 'shared' || r === 'downloaded') toast('Split history exported.');
    },
    'import-json': () => {
      if (PREVIEW) return toast('Import is disabled in this preview. Use the installed app.', 'error');
      startImport().catch(() => {});
    },
    'request-persist': async () => {
      try {
        const ok = await navigator.storage.persist();
        toast(ok ? 'Storage is now protected from automatic cleanup.' : 'The browser declined. Installing the app to your home screen usually helps.', ok ? '' : 'error');
      } catch (err) {
        toast('This browser does not support storage protection.', 'error');
      }
      storageInfo();
    },
    'install-app': async () => {
      if (!deferredInstall) return;
      deferredInstall.prompt();
      try {
        await deferredInstall.userChoice;
      } catch (err) {
        /* ignore */
      }
      deferredInstall = null;
      render();
    },
    'erase-all': async () => {
      const ok = await confirmDialog({
        title: 'Erase all data on this device?',
        message: `<p>This permanently removes ${plural(S.transactions.length, 'transaction')}, ${plural(S.sharedExpenses.length, 'shared expense')}, ${plural(S.settlements.length, 'payment')} and ${plural(S.friends.length, 'friend')} from this device. It cannot be undone.</p>`,
        confirmLabel: 'Erase everything',
        danger: true,
        requireText: 'ERASE',
      });
      if (!ok) return;
      try {
        S = await DB.eraseAll();
        device = {};
        reindex();
        if (channel) channel.postMessage('changed');
        location.hash = '#/home';
        render();
        toast('All data erased from this device.');
      } catch (err) {
        toast(`Could not erase: ${err.message}`, 'error');
      }
    },
    reload: () => location.reload(),
    'repair-app': () => repairApp(),
    'apply-update': () => {
      if (swWaiting) {
        window.__myexpenseReload = true;
        swWaiting.postMessage('SKIP_WAITING');
      } else location.reload();
    },
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const fn = actions[el.dataset.action];
    if (fn) {
      e.preventDefault();
      Promise.resolve(fn(el, e)).catch(() => {});
    }
  });
  window.addEventListener('hashchange', () => {
    while (sheets.length) sheets[sheets.length - 1].close();
    render();
  });

  /* ------------------------------------------------------------------ PWA */

  function setupPWA() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstall = e;
      if (parseRoute().name === 'settings') render();
    });
    window.addEventListener('appinstalled', () => {
      deferredInstall = null;
      toast('MyExpense installed.');
    });
    if (PREVIEW || !('serviceWorker' in navigator)) return;
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
    if (location.protocol !== 'https:' && !local) return;
    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        const watched = new WeakSet();
        const watch = (w) => {
          if (watched.has(w)) return;
          watched.add(w);
          w.addEventListener('statechange', () => {
            if (w.state === 'installed') {
              if (navigator.serviceWorker.controller) {
                swWaiting = w;
                showUpdateBanner();
              } else toast('Ready to work offline.');
            }
          });
        };
        if (reg.waiting && navigator.serviceWorker.controller) {
          swWaiting = reg.waiting;
          showUpdateBanner();
        }
        if (reg.installing) watch(reg.installing);
        reg.addEventListener('updatefound', () => reg.installing && watch(reg.installing));
      })
      .catch(() => {
        /* offline support unavailable; the app still works online */
      });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (window.__myexpenseReload) location.reload();
    });
  }

  function showUpdateBanner() {
    const b = $('#update-banner');
    b.hidden = false;
    b.innerHTML = `<span>A new version of MyExpense is ready.</span><button type="button" class="btn small primary" data-action="apply-update">Update</button>`;
  }

  function showFatal(err, kind) {
    const msg = err && err.message ? err.message : String(err || 'Unknown error');
    const storage = kind === 'storage';
    const tb = $('#topbar');
    if (tb && !tb.textContent.trim()) tb.innerHTML = '<h1>MyExpense</h1>';
    $('#view').innerHTML = `<div class="empty fatal"><div class="empty-ic" aria-hidden="true">${storage ? '🗄️' : '⚠️'}</div>
      <p class="empty-title">${storage ? 'Your data could not be loaded' : 'Something went wrong on this screen'}</p>
      <p class="empty-text">${esc(msg)}</p>
      <p class="empty-text">${storage
        ? 'Private browsing and in-app browsers (WhatsApp, Instagram) block storage. Open the app from its home screen icon, or in Safari or Chrome, and try again.'
        : 'Your saved data has not been changed. Try again, or repair the app.'}</p>
      <div class="empty-actions">
        <button type="button" class="btn primary" data-action="reload">Try again</button>
        <button type="button" class="btn ghost" data-action="repair-app">Repair app</button>
      </div>
      <p class="hint">Repair clears the app’s cached files and downloads them again. Your transactions, friends and splits are kept.</p></div>`;
  }

  function withTimeout(promise, ms, message) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(message)), ms);
      promise.then(
        (v) => {
          clearTimeout(t);
          resolve(v);
        },
        (e) => {
          clearTimeout(t);
          reject(e);
        }
      );
    });
  }

  async function repairApp() {
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      if (window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.filter((k) => k.startsWith('myexpense-')).map((k) => caches.delete(k)));
      }
    } catch (err) {
      /* best effort */
    }
    const url = new URL(location.href);
    url.searchParams.set('r', String(Date.now()));
    location.replace(url.toString());
  }

  // Catch startup failures so the screen never sits on "Loading" forever.
  window.addEventListener('error', (e) => {
    if (!S) showFatal(e.error || new Error(e.message || 'Script error'), 'render');
  });
  window.addEventListener('unhandledrejection', (e) => {
    if (!S) showFatal(e.reason || new Error('Startup failed'), 'render');
  });

  async function boot() {
    applyTheme(getTheme());
    setupPWA();
    try {
      const r = await withTimeout(DB.loadAll(), 12000, 'Storage did not respond in time. This can happen right after an iOS update or when storage is full.');
      S = r.state;
      device = r.device || {};
    } catch (err) {
      showFatal(err, 'storage');
      return;
    }
    reindex();
    if (!location.hash) history.replaceState(null, '', '#/home');
    render();
    window.addEventListener('myexpense:dbclosed', () => toast('MyExpense was updated in another tab. Reload this tab.', 'error'));
    if (!navigator.onLine && !PREVIEW && 'serviceWorker' in navigator && !navigator.serviceWorker.controller) {
      toast('You are offline and this app is not saved for offline use yet. Open it once while online.', 'error');
    }
    try {
      if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
    } catch (err) {
      /* optional */
    }
  }

  boot();
})();
