'use strict';

// Eve Deep Industry - phone layout (mobile.html). This file is the shared core every screen builds
// on: small helpers, icons, the toast, bottom sheets, tabs, settings, production stations, stock and
// the EVE account. The five screens live in mobile-calc.js, mobile-ledger.js, mobile-invention.js,
// mobile-lp.js and mobile-jita.js, and register themselves on window.MB.
//
// The phone layout reuses the desktop site's own code (eve_db.js, js/config.js, js/esi.js,
// js/tree.js, js/optimizers.js) unchanged, and reads and writes the same localStorage keys, so
// logins, stations, fees, the Ledger and everything else stay shared with the desktop pages.
// Two rules keep that sharing safe:
//  - mobile.html carries hidden inputs with the desktop's own IDs (facility-tax, sales-tax,
//    include-reactions, deduct-stock-mode, ...). syncShim() keeps them in step with the phone's
//    settings, so desktop functions that read those inputs see the same values the phone shows.
//  - Nothing here defines a global recalculate(): js/esi.js calls one after prices, systems or
//    assets load if it exists. The phone listens for eve:assets-refreshed instead.
window.MB = (() => {
  const MB = {};

  /* =====================  Helpers  ===================== */
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MINUS = '−';
  const full = x => (x < -0.5 ? MINUS : '') + Math.round(Math.abs(x || 0)).toLocaleString('en-US');
  function compact(x, signed) {
    x = x || 0;
    const a = Math.abs(x);
    let s;
    if (a >= 1e12) s = (a / 1e12).toFixed(2) + 'T';
    else if (a >= 1e9) s = (a / 1e9).toFixed(2) + 'B';
    else if (a >= 1e6) s = (a / 1e6).toFixed(2) + 'M';
    else if (a >= 1e3) s = (a / 1e3).toFixed(1) + 'K';
    else if (a > 0 && a < 10) s = a.toFixed(2);
    else s = a.toFixed(0);
    if (x < 0 && s !== '0' && s !== '0.00') return MINUS + s;
    return (signed && x > 0 ? '+' : '') + s;
  }
  const qty = q => Math.round(q || 0).toLocaleString('en-US');
  function dur(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
    return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : m ? `${m}m` : `${sec}s`;
  }
  function ago(ms) {
    const s = Math.max(0, (Date.now() - ms) / 1000);
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }
  const pctText = x => (Math.round(x * 10000) / 100).toString() + '%';
  const nameOf = id => (window.TYPE_ID_TO_NAME && window.TYPE_ID_TO_NAME[id]) || (window.EVE_ITEMS && window.EVE_ITEMS[id]) || `Item ${id}`;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  Object.assign(MB, { $, $$, esc, MINUS, full, compact, qty, dur, ago, pctText, nameOf, sleep });

  // localStorage, safely: private windows and full storage throw, and the page must still work.
  const LS = {
    get(key, fallback) { try { return window.safeParseJSON(localStorage.getItem(key), fallback); } catch (e) { return fallback; } },
    raw(key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
    set(key, value) { try { localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value)); } catch (e) { console.warn('[Phone] Could not save', key, e); } },
    remove(key) { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } }
  };
  MB.LS = LS;

  /* =====================  Icons (inline SVG, no emoji)  ===================== */
  const ICON = {
    chev: '<svg class="i" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
    down: '<svg class="i" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>',
    back: '<svg class="i" viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>',
    copy: '<svg class="i" viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 012-2h9"/></svg>',
    bolt: '<svg class="i" viewBox="0 0 24 24"><polygon points="13,2 3,14 11,14 9,22 21,10 13,10"/></svg>',
    order: '<svg class="i" viewBox="0 0 24 24"><path d="M6 3h9l3 3v15H6z"/><line x1="9" y1="9" x2="15" y2="9"/><line x1="9" y1="13" x2="15" y2="13"/></svg>',
    lock: '<svg class="i" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V7a4 4 0 018 0v4"/></svg>',
    none: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" stroke-dasharray="3 3"/></svg>',
    skill: '<svg class="i" viewBox="0 0 24 24"><path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z"/></svg>',
    box: '<svg class="i" viewBox="0 0 24 24"><path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><line x1="12" y1="13" x2="12" y2="21"/></svg>',
    bp: '<svg class="i" viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
    clock: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    refresh: '<svg class="i" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-3-6.7"/><polyline points="21 4 21 9 16 9"/></svg>',
    edit: '<svg class="i" viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><line x1="13.5" y1="6.5" x2="17.5" y2="10.5"/></svg>',
    plus: '<svg class="i" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    x: '<svg class="i" viewBox="0 0 24 24"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>',
    chart: '<svg class="i" viewBox="0 0 24 24"><path d="M3 20h18"/><path d="M5 16l4-5 4 3 6-8"/></svg>',
    star: '<svg class="i" viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    check: '<svg class="i" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>',
    search: '<svg class="i" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>',
    trash: '<svg class="i" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>',
    list: '<svg class="i" viewBox="0 0 24 24"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/></svg>',
    rows: '<svg class="i" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/></svg>',
    warn: '<svg class="i" viewBox="0 0 24 24"><path d="M12 3.5L2.5 20h19z"/><line x1="12" y1="10" x2="12" y2="14"/><circle cx="12" cy="17" r="0.6" fill="currentColor"/></svg>',
    pin: '<svg class="i" viewBox="0 0 24 24"><path d="M12 21s-6.5-6.1-6.5-11a6.5 6.5 0 0113 0c0 4.9-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/></svg>',
    tag: '<svg class="i" viewBox="0 0 24 24"><path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.3"/></svg>',
    sparkle: '<svg class="i" viewBox="0 0 24 24"><path d="M12 3l1.8 4.6L18.5 9l-4.7 1.5L12 15l-1.8-4.5L5.5 9l4.7-1.4z"/><path d="M18.5 15.5l.8 2 2 .8-2 .7-.8 2-.8-2-2-.7 2-.8z"/></svg>',
    undo: '<svg class="i" viewBox="0 0 24 24"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/></svg>',
    factory: '<svg class="i" viewBox="0 0 24 24"><path d="M3 21V10l6 4V10l6 4V5h6v16z"/><line x1="7" y1="17" x2="7" y2="17.01"/><line x1="12" y1="17" x2="12" y2="17.01"/><line x1="17" y1="17" x2="17" y2="17.01"/></svg>',
    bell: '<svg class="i" viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 0112 0v5l2 2H4z"/><path d="M10 20a2 2 0 004 0"/></svg>',
    sync: '<svg class="i" viewBox="0 0 24 24"><path d="M20 12a8 8 0 01-14 5.3"/><path d="M4 12a8 8 0 0114-5.3"/><polyline points="18 3 18 7 14 7"/><polyline points="6 21 6 17 10 17"/></svg>',
    merge: '<svg class="i" viewBox="0 0 24 24"><circle cx="6" cy="6" r="2.2"/><circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="12" r="2.2"/><path d="M6 8.2v7.6M8 7l8 4M8 17l8-4"/></svg>',
    play: '<svg class="i" viewBox="0 0 24 24"><polygon points="7 4 20 12 7 20"/></svg>',
    desktop: '<svg class="i" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="1.5"/><line x1="8" y1="20" x2="16" y2="20"/><line x1="12" y1="16" x2="12" y2="20"/></svg>',
    ext: '<svg class="i" viewBox="0 0 24 24"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/></svg>',
    heart: '<svg class="i" viewBox="0 0 24 24"><path d="M12 20s-7-4.5-9-9.5C1.7 6.9 4.2 4 7.2 4c2 0 3.6 1.2 4.8 2.8C13.2 5.2 14.8 4 16.8 4c3 0 5.5 2.9 4.2 6.5-2 5-9 9.5-9 9.5z"/></svg>',
    truck: '<svg class="i" viewBox="0 0 24 24"><path d="M2 6h11v10H2z"/><path d="M13 9h4l4 4v3h-8"/><circle cx="6" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/></svg>'
  };
  const AVATAR = '<svg viewBox="0 0 40 40"><circle cx="20" cy="15" r="7" fill="currentColor"/><path d="M6 38c1.5-8 7-12 14-12s12.5 4 14 12z" fill="currentColor"/></svg>';
  MB.ICON = ICON;
  MB.AVATAR = AVATAR;

  // EVE's image server: product icons for items, the blueprint render for blueprints. A missing
  // icon falls back to a neutral outline via CSS (the <img> hides itself).
  function iconUrl(typeId, variant, size) {
    return `https://images.evetech.net/types/${typeId}/${variant || 'icon'}?size=${size || 64}`;
  }
  function iconHTML(typeId, cls, variant) {
    if (!typeId) return `<span class="ic ic-none ${cls || ''}" aria-hidden="true">${ICON.none}</span>`;
    return `<span class="ic ${cls || ''}" aria-hidden="true"><img src="${iconUrl(typeId, variant)}" alt="" loading="lazy" decoding="async" onerror="this.remove()"></span>`;
  }
  MB.iconUrl = iconUrl;
  MB.iconHTML = iconHTML;

  /* =====================  Toast  ===================== */
  let toastTimer = null;
  function toast(msg, action) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('has-act', !!action);
    if (action) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'act';
      b.textContent = action.label;
      b.addEventListener('click', () => { t.classList.remove('show', 'has-act'); action.run(); });
      t.append(b);
    }
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show', 'has-act'), action ? 6000 : 3200);
  }
  MB.toast = toast;
  // Desktop code (login failures, token refresh problems, ...) reports through window.showToast.
  // On the phone that lands in the phone's own toast rather than the desktop's styled stack.
  window.showToast = (message, type, options) => toast(message, options && options.action ? { label: options.action.label, run: options.action.onClick } : null);

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (err) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'absolute'; ta.style.left = '-9999px';
        document.body.appendChild(ta); ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch (err2) { return false; }
    }
  }
  MB.copyText = copyText;

  /* =====================  Phone preferences  ===================== */
  // Desktop resets these on every visit (they're plain inputs with no saved value); the phone
  // remembers them. Kept in their own key so nothing on the desktop side is affected.
  const PREF_DEFAULTS = {
    reactions: true,          // desktop "Reactions ON/OFF"
    priceMode: 'sell',        // desktop "Material cost: Sell (Instant) / Buy Order"
    deduct: true,             // desktop "Deducting Stock"
    stockPersonal: true, stockCorp: true, stockLoc: 'all',
    opt: { build: 5, spread: 5, budget: 1 },
    bom: { cat: 'all', order: 'all', compact: false },
    simV: false,
    tipDismissed: false
  };
  const prefs = Object.assign({}, PREF_DEFAULTS, LS.get('eve_mobile_prefs', {}));
  prefs.opt = Object.assign({}, PREF_DEFAULTS.opt, prefs.opt || {});
  prefs.bom = Object.assign({}, PREF_DEFAULTS.bom, prefs.bom || {});
  MB.prefs = prefs;
  MB.savePrefs = () => LS.set('eve_mobile_prefs', prefs);

  /* =====================  Taxes and fees (shared with desktop)  ===================== */
  // eve_tax_settings holds strings in percent. The desktop reads them with `parseFloat(x) || default`,
  // which turns a real 0 back into the default; the phone keeps 0 as 0.
  const FEE_DEFAULTS = { facilityTax: 1.0, sccSurcharge: 4.0, salesTax: 3.6, brokerFee: 1.0, contractTax: 0.5, contractBroker: 1.65 };
  function readFees() {
    const s = LS.get('eve_tax_settings', {});
    const out = {};
    for (const k of Object.keys(FEE_DEFAULTS)) {
      const v = parseFloat(s[k]);
      out[k] = Number.isFinite(v) && v >= 0 ? v : FEE_DEFAULTS[k];
    }
    return out;
  }
  function writeFees(changes) {
    const s = LS.get('eve_tax_settings', {});
    for (const [k, v] of Object.entries(changes)) s[k] = String(v);
    LS.set('eve_tax_settings', s);
    syncShim();
  }
  MB.readFees = readFees;
  MB.writeFees = writeFees;
  // Fractions, the way the engine and every formula want them.
  MB.feeFrac = () => {
    const f = readFees();
    return { facilityTax: f.facilityTax / 100, sccSurcharge: f.sccSurcharge / 100, salesTax: f.salesTax / 100, brokerFee: f.brokerFee / 100, contractTax: f.contractTax / 100, contractBroker: f.contractBroker / 100 };
  };

  // Keep the hidden desktop inputs in step with the phone (see the note at the top of this file).
  function syncShim() {
    const f = readFees();
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = String(v); };
    set('facility-tax', f.facilityTax);
    set('scc-surcharge', f.sccSurcharge);
    set('sales-tax', f.salesTax);
    set('broker-fee', f.brokerFee);
    set('contract-tax', f.contractTax);
    set('contract-broker', f.contractBroker);
    set('include-reactions', prefs.reactions ? 'true' : 'false');
    set('input-price-mode', prefs.priceMode);
    set('deduct-stock-mode', prefs.deduct ? 'true' : 'false');
    set('build-profit-threshold', prefs.opt.build);
    set('buy-savings-threshold', prefs.opt.spread);
    set('total-cost-savings-threshold', prefs.opt.budget);
    window.simulateSkillsToFive = !!prefs.simV;
  }
  MB.syncShim = syncShim;

  /* =====================  Solar systems: cost indices and security  ===================== */
  // ESI's /industry/systems/ has every system's cost indices in one call; cached for an hour.
  // Security never changes, so it's cached for good.
  let industrySystems = null;
  const secCache = LS.get('eve_mobile_system_security', {});
  async function loadIndustrySystems(force) {
    const cached = LS.get('eve_mobile_industry_systems', null);
    if (!force && cached && cached.fetchedAt > Date.now() - 3600e3 && cached.data) {
      industrySystems = cached.data;
      return industrySystems;
    }
    try {
      const res = await fetch('https://esi.evetech.net/latest/industry/systems/?datasource=tranquility');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const list = await res.json();
      const data = {};
      list.forEach(s => {
        const e = { mfg: 0.01, react: 0.01, inv: 0.02 };
        (s.cost_indices || []).forEach(ci => {
          if (ci.activity === 'manufacturing') e.mfg = ci.cost_index;
          if (ci.activity === 'reaction') e.react = ci.cost_index;
          if (ci.activity === 'invention') e.inv = ci.cost_index;
        });
        data[s.solar_system_id] = e;
      });
      industrySystems = data;
      LS.set('eve_mobile_industry_systems', { fetchedAt: Date.now(), data });
    } catch (e) {
      console.warn('[Phone] Industry system indices failed to load:', e);
      if (cached && cached.data) industrySystems = cached.data;
    }
    return industrySystems;
  }
  async function loadSecurity(systemId) {
    if (!systemId || secCache[systemId] !== undefined) return secCache[systemId];
    try {
      const res = await fetch(`https://esi.evetech.net/latest/universe/systems/${systemId}/?datasource=tranquility`);
      if (res.ok) {
        const d = await res.json();
        if (typeof d.security_status === 'number') {
          secCache[systemId] = d.security_status;
          LS.set('eve_mobile_system_security', secCache);
        }
      }
    } catch (e) { console.warn('[Phone] System security lookup failed:', e); }
    return secCache[systemId];
  }
  // Same defaults the desktop uses when a system has no entry (fetchSystemSCIById).
  function sysInfo(systemId) {
    const e = (industrySystems && industrySystems[systemId]) || { mfg: 0.01, react: 0.01, inv: 0.02, missing: true };
    const sec = secCache[systemId];
    return { ...e, sec: typeof sec === 'number' ? sec : null };
  }
  const secMult = sec => (sec === null || sec === undefined ? 1.0 : sec >= 0.45 ? 1.0 : sec > 0.0 ? 1.9 : 2.1);
  const secBand = sec => (sec === null || sec === undefined ? 'high' : sec >= 0.45 ? 'high' : sec > 0.0 ? 'low' : 'null');
  const secHTML = sec => (sec === null || sec === undefined ? '' : `<span class="sec ${secBand(sec)}">${(Math.round(sec * 10) / 10).toFixed(1)}</span>`);
  function systemName(systemId, fallback) {
    const n = (window.systemNameCache && window.systemNameCache[systemId]) || fallback || '';
    // Systems come in capitals from the desktop's caches: JITA -> Jita, 1DQ1-A stays as it is.
    return n ? (/\d/.test(n) ? n : n.toLowerCase().replace(/(^|[\s-])([a-z])/g, (m, a, b) => a + b.toUpperCase())) : `System ${systemId}`;
  }
  // Local search over every solar system the site knows (eve_db.js), prefix matches first.
  function searchSystems(q, limit = 8) {
    const ql = q.trim().toLowerCase();
    if (!ql) return [];
    const starts = [], contains = [];
    for (const [k, v] of Object.entries(window.SYSTEM_IDX || {})) {
      if (k.startsWith(ql)) starts.push(v); else if (k.includes(ql)) contains.push(v);
      if (starts.length >= limit) break;
    }
    return [...starts, ...contains].slice(0, limit);
  }
  Object.assign(MB, { loadIndustrySystems, loadSecurity, sysInfo, secMult, secBand, secHTML, systemName, searchSystems });

  /* =====================  Production stations (desktop presets)  ===================== */
  // A station is { systemId, systemName, facilityKey, facilityTax, rig1, rig2, rig3 }. Saved ones
  // are the desktop's production presets (eve_production_presets, keyed by name); the active one is
  // spread over eve_selected_system, eve_active_facility_key, eve_rig_slot_1..3 and
  // eve_tax_settings.facilityTax - exactly what the desktop reads.
  const STRUCT = window.STRUCTURE_TYPES;
  const STRUCT_ORDER = ['npc', 'raitaru', 'azbel', 'sotiyo', 'athanor', 'tatara'];
  function liveStation() {
    const sel = LS.get('eve_selected_system', {});
    return {
      systemId: sel.id || 30000142,
      systemName: sel.name || 'JITA',
      facilityKey: LS.raw('eve_active_facility_key') || 'sotiyo',
      facilityTax: readFees().facilityTax,
      rig1: LS.raw('eve_rig_slot_1') || '', rig2: LS.raw('eve_rig_slot_2') || '', rig3: LS.raw('eve_rig_slot_3') || ''
    };
  }
  const presets = () => LS.get('eve_production_presets', {});
  const sameStation = (a, b) => !!a && !!b && a.systemId === b.systemId && a.facilityKey === b.facilityKey &&
    (a.rig1 || '') === (b.rig1 || '') && (a.rig2 || '') === (b.rig2 || '') && (a.rig3 || '') === (b.rig3 || '');
  // Every saved station, plus the live setup when it isn't one of them. Same matching rule as the
  // desktop's resolveProductionPresetLabel (tax isn't part of the match there either).
  function stationList() {
    const live = liveStation();
    const list = Object.entries(presets()).sort((a, b) => a[0].localeCompare(b[0])).map(([name, p]) => ({
      id: 'p:' + name, name, saved: true,
      systemId: p.systemId, systemName: p.systemName, facilityKey: p.facilityKey || 'sotiyo',
      facilityTax: p.facilityTax !== undefined && Number.isFinite(parseFloat(p.facilityTax)) ? parseFloat(p.facilityTax) : live.facilityTax,
      rig1: p.rig1 || '', rig2: p.rig2 || '', rig3: p.rig3 || ''
    }));
    const match = list.find(s => sameStation(s, live) && s.facilityTax === live.facilityTax) || list.find(s => sameStation(s, live));
    if (!match) {
      const rigCount = [live.rig1, live.rig2, live.rig3].filter(Boolean).length;
      list.unshift({ id: 'live', saved: false, name: `${STRUCT[live.facilityKey] ? STRUCT[live.facilityKey].shortLabel : live.facilityKey} in ${systemName(live.systemId, live.systemName)}`, ...live, rigCount });
    }
    return list;
  }
  function activeStation() {
    const live = liveStation();
    const list = stationList();
    return list.find(s => s.id === 'live') || list.find(s => sameStation(s, live) && s.facilityTax === live.facilityTax) || list.find(s => sameStation(s, live)) || list[0];
  }
  const rigIds = st => [st.rig1, st.rig2, st.rig3].map(r => parseInt(r) || 0);
  // Makes a station the live one, the same way the desktop's loadProductionPreset does.
  async function applyStation(st) {
    LS.set('eve_selected_system', { id: st.systemId, name: String(st.systemName || '').toUpperCase() });
    LS.set('eve_active_facility_key', st.facilityKey);
    [1, 2, 3].forEach(i => LS.set(`eve_rig_slot_${i}`, st[`rig${i}`] ? String(st[`rig${i}`]) : ''));
    const s = LS.get('eve_tax_settings', {});
    s.facilityTax = String(st.facilityTax);
    s.facilitySelect = st.facilityKey;
    s.rigSlot1 = st.rig1 || ''; s.rigSlot2 = st.rig2 || ''; s.rigSlot3 = st.rig3 || '';
    LS.set('eve_tax_settings', s);
    await loadSecurity(st.systemId);
    setStationGlobals();
    syncShim();
  }
  function savePreset(name, st, oldName) {
    const p = presets();
    if (oldName && oldName !== name) delete p[oldName];
    p[name] = {
      systemId: st.systemId, systemName: String(st.systemName || '').toUpperCase(), facilityKey: st.facilityKey,
      facilityLabel: STRUCT[st.facilityKey] ? STRUCT[st.facilityKey].label : st.facilityKey,
      facilityTax: String(st.facilityTax), rig1: st.rig1 ? String(st.rig1) : '', rig2: st.rig2 ? String(st.rig2) : '', rig3: st.rig3 ? String(st.rig3) : ''
    };
    LS.set('eve_production_presets', p);
  }
  function deletePreset(name) {
    const p = presets();
    const removed = p[name];
    delete p[name];
    LS.set('eve_production_presets', p);
    return removed;
  }
  function restorePreset(name, data) { const p = presets(); p[name] = data; LS.set('eve_production_presets', p); }
  // Desktop code that prices ledger jobs reads these globals for the active station.
  function setStationGlobals() {
    const st = liveStation();
    const info = sysInfo(st.systemId);
    window.activeMfgSCI = info.mfg;
    window.activeReactSCI = info.react;
    window.activeInventionSCI = info.inv;
    window.activeSystemSecurity = info.sec;
  }
  // What the engine needs to price a build at a station.
  function engineStation(st) {
    const info = sysInfo(st.systemId);
    return { structure: st.facilityKey, sec: info.sec, sci: { mfg: info.mfg, react: info.react }, tax: st.facilityTax / 100, rigs: rigIds(st).filter(Boolean) };
  }
  function stationMeta(st) {
    const info = sysInfo(st.systemId);
    const n = rigIds(st).filter(Boolean).length;
    return `${esc(systemName(st.systemId, st.systemName))} ${secHTML(info.sec)} · ${esc(STRUCT[st.facilityKey] ? STRUCT[st.facilityKey].shortLabel : st.facilityKey)} · ${st.facilityTax}% tax · ${n ? `${n} rig${n === 1 ? '' : 's'}` : 'no rigs'}`;
  }
  Object.assign(MB, { STRUCT, STRUCT_ORDER, liveStation, stationList, activeStation, applyStation, savePreset, deletePreset, restorePreset, setStationGlobals, engineStation, stationMeta, rigIds, sameStation, presets });

  /* =====================  Rigs  ===================== */
  // Manufacturing rigs, parsed with the desktop's own rules (config.js parseRigName and
  // doesRigMatchProduct). Matching a product is cached per rig.
  const rigCache = new Map();
  function rigInfo(typeId) {
    if (!typeId) return null;
    if (rigCache.has(typeId)) return rigCache.get(typeId);
    const name = window.EVE_ITEMS ? window.EVE_ITEMS[typeId] : null;
    const parsed = name ? window.parseRigName(name) : null;
    let info = null;
    if (parsed) {
      const hits = new Map();
      info = {
        typeId, name, size: parsed.size, tier: parsed.tier, bonusType: parsed.bonusType, parsed,
        matches(pt) { if (!hits.has(pt)) hits.set(pt, !!window.doesRigMatchProduct(parsed, pt)); return hits.get(pt); }
      };
    }
    rigCache.set(typeId, info);
    return info;
  }
  const rigCatalog = () => (window.getRigItemCatalog ? window.getRigItemCatalog() : []).filter(r => r.kind === 'manufacturing');
  MB.rigInfo = rigInfo;
  MB.rigCatalog = rigCatalog;

  /* =====================  The calculation engine  ===================== */
  // A direct port of the site's cost / quantity / job fee / leftover / build time rules
  // (js/tree.js calculateInputQuantity + scaleTreeQuantities, js/optimizers.js calculateTreeNodeCost
  // + calculateNodeJobFee, js/config.js calculateAdjustedJobSeconds, js/app.js recalculate's
  // leftover credit and selling). Checked against the site's own numbers: see the phone layout
  // mockup's validation (36 checks, 0 differences). It works on a flattened copy of the site's own
  // tree (built by js/tree.js with every part set to Build), so switching Build/Buy, stations, runs
  // or ME/TE never needs a rebuild.
  function createEngine() {
    function makeItem(raw) {
      const nodes = raw.nodes.map(n => ({ ...n, kids: [] }));
      const byId = new Map(nodes.map(n => [n.i, n]));
      let root = null;
      for (const n of nodes) { if (n.p == null || !byId.has(n.p)) { if (!root) root = n; } else byId.get(n.p).kids.push(n); }
      return { pt: raw.pt, bp: raw.bp, name: raw.name, bpName: raw.bpName, group: raw.group, nodes, byId, root, prices: raw.prices };
    }
    function stationMath(station) {
      const type = STRUCT[station.structure] || STRUCT.npc;
      const rigs = station.rigs.map(rigInfo).filter(r => r && type.rigSize && r.size === type.rigSize);
      return { type, sci: station.sci, tax: station.tax, mult: secMult(station.sec), rigs };
    }
    function rigBonus(pt, sm, kind) {
      let best = 0;
      for (const r of sm.rigs) {
        if (r.bonusType !== 'BOTH' && r.bonusType !== kind) continue;
        if (!r.matches(pt)) continue;
        best = Math.max(best, (kind === 'ME' ? RIG_ME_BASE : RIG_TE_BASE)[r.tier] * sm.mult);
      }
      return best;
    }
    // js/tree.js calculateInputQuantity, unchanged
    function inputQty(baseQty, runs, me, facilityBonus, isReaction, rigMEBonus) {
      const meFactor = isReaction ? 1.0 : (1 - me / 100);
      const facFactor = (1 - parseFloat(facilityBonus || 0));
      const rigFactor = 1 - (parseFloat(rigMEBonus) || 0) / 100;
      const minQty = isReaction ? 1 : runs;
      return Math.max(minQty, Math.ceil(runs * baseQty * meFactor * facFactor * rigFactor));
    }
    // cfg: { runs, jobs, station, ov, sources, defaultSource, meOv, teOv, skills, implantPct, fee,
    //        reactions, sell: {mode: auto|market|contract, price} }
    function evaluate(item, cfg) {
      const sm = stationMath(cfg.station);
      const fee = cfg.fee;
      const { root } = item;
      const noReact = cfg.reactions === false;
      const wants = n => (cfg.ov[n.k] !== undefined ? cfg.ov[n.k] : n.d === 0) && !(noReact && n.r);
      const built = n => wants(n) && n.kids.length > 0;
      const meOf = n => (cfg.meOv[n.k] !== undefined ? cfg.meOv[n.k] : n.me);
      const teOf = n => (cfg.teOv[n.k] !== undefined ? cfg.teOv[n.k] : n.te);
      const price = pt => item.prices[pt] || { sell: 0, buy: 0 };
      const sourceOf = n => cfg.sources[n.k] || cfg.defaultSource;
      const unitPrice = n => (sourceOf(n) === 'buy' ? price(n.pt).buy * (1 + fee.brokerFee) : price(n.pt).sell);

      const facility = sm.type.meBonus / 100;
      const jobs = Math.max(1, cfg.jobs || 1);
      root.q = root.y * cfg.runs * jobs;
      root.runs = cfg.runs * jobs;
      (function scale(n) {
        if (!n.hasMats) return;
        if (n !== root) n.runs = Math.ceil(n.q / n.y);
        const rig = rigBonus(n.pt, sm, 'ME');
        const me = n.r ? 0 : meOf(n);
        const nJobs = n === root ? jobs : 1;
        for (const c of n.kids) {
          c.q = nJobs > 1 ? nJobs * inputQty(c.base, n.runs / nJobs, me, facility, n.r, rig) : inputQty(c.base, n.runs, me, facility, n.r, rig);
          scale(c);
        }
      })(root);

      const sk = cfg.skills;
      function jobSeconds(n) {
        if (!n.bt) return 0;
        let skill;
        if (n.r) skill = 1 - 0.04 * ((sk.allSkills && sk.allSkills[REACTIONS_SKILL_ID]) || 0);
        else {
          let req = 1.0;
          if (sk.allSkills) for (const id of n.rs) req *= (1 - 0.01 * (sk.allSkills[id] || 0));
          skill = (1 - 0.04 * (sk.industry || 0)) * (1 - 0.03 * (sk.advIndustry || 0)) * req;
        }
        const te = n.r ? 0 : teOf(n);
        const implant = n.r ? 1 : (1 - (cfg.implantPct || 0) / 100);
        return n.bt * (1 - te / 100) * skill * (1 - sm.type.teBonus / 100) * (1 - rigBonus(n.pt, sm, 'TE') / 100) * implant * (n.runs || 1);
      }

      let fees = 0, seconds = 0;
      (function cost(n) {
        n.buy = unitPrice(n) * n.q;
        n.isBuilt = built(n);
        if (n.kids.length) {
          let s = 0;
          for (const c of n.kids) s += cost(c);
          n.fee = n.m && n.hasMats ? n.bre * n.runs * ((n.r ? sm.sci.react : sm.sci.mfg) * (1 - sm.type.costBonus / 100) + sm.tax + fee.sccSurcharge) : 0;
          n.build = s + n.fee;
          n.secs = jobSeconds(n);
        } else { n.build = null; n.fee = 0; n.secs = 0; }
        n.all = n.isBuilt ? n.build : n.buy;
        return n.all;
      })(root);
      (function inPlay(n) { if (!n.isBuilt) return; fees += n.fee; seconds += n.secs; n.kids.forEach(inPlay); })(root);

      const demand = new Map();
      (function collect(n) {
        let e = demand.get(n.k);
        if (!e) { e = { k: n.k, pt: n.pt, total: 0, building: wants(n), y: n.y || 1 }; demand.set(n.k, e); }
        e.total += n.q;
        if (wants(n)) n.kids.forEach(collect);
      })(root);
      let surplus = 0;
      for (const e of demand.values()) {
        if (e.k === root.k || e.pt === root.pt) continue;
        if (e.building && e.y > 1) {
          const runs = Math.ceil(e.total / e.y);
          const extra = runs * e.y - e.total;
          if (extra > 0) { const p = price(e.pt); surplus += extra * (p.sell || p.buy || window.getEIV(e.k) || 0); }
        }
      }

      const sell = cfg.sell || { mode: 'auto' };
      const marketNet = price(root.pt).sell * root.q * (1 - fee.salesTax - fee.brokerFee);
      const unitSell = sell.mode === 'auto' ? price(root.pt).sell : (sell.price || 0);
      const gross = unitSell * root.q;
      let net, contractTax = 0, contractBroker = 0;
      if (sell.mode === 'contract') {
        contractTax = gross * fee.contractTax;
        contractBroker = gross * fee.contractBroker + 10000;
        net = gross - contractTax - contractBroker;
      } else {
        net = gross * (1 - fee.salesTax - fee.brokerFee);
      }
      const total = root.all;
      return { cost: total, fees, net, marketNet, gross, unitSell, contractTax, contractBroker, surplus, profit: net + surplus - total, seconds };
    }
    return { makeItem, evaluate, stationMath, rigBonus, inputQty };
  }
  const E = createEngine();
  MB.E = E;

  // Flattens a site tree (js/tree.js node objects) into the engine's node list. The tree must have
  // had scaleTreeQuantities + calculateNodeEIV run on it with every part built, so jobEIV is set.
  function flattenTree(root) {
    const nodes = [];
    (function walk(n, parent) {
      let base = null;
      if (parent && parent.recipe && Array.isArray(parent.recipe.materials)) {
        const mat = parent.recipe.materials.find(m => m.typeId === (n.productTypeId || n.typeId));
        base = mat ? mat.baseQty : null;
      }
      const hasMats = !!(n.recipe && n.recipe.materials && n.recipe.materials.length);
      nodes.push({
        i: n.instanceId, p: n.parentInstanceId, k: n.displayTypeId || n.typeId, pt: n.productTypeId || n.typeId,
        n: n.productName || (n.name || '').replace(/ Blueprint$/i, ''), q: n.qtyNeeded, q0: n.qtyNeeded, m: !!n.isManufacturable, r: !!n.isReaction, d: n.depth,
        base, me: n.customME || 0, te: n.customTE || 0, y: n.batchYield || 1, bre: hasMats && n.runsNeeded ? n.jobEIV / n.runsNeeded : 0, hasMats,
        bt: n.recipe ? window.extractBuildTime(n.recipe) : 0,
        rs: (n.recipe && Array.isArray(n.recipe.requiredSkills)) ? n.recipe.requiredSkills.map(s => s.skillId) : [],
        rsl: (n.recipe && Array.isArray(n.recipe.requiredSkills)) ? n.recipe.requiredSkills.map(s => [s.skillId, s.level]) : [],
        // The materials behind this part's EIV, so job fees can be recomputed once EVE's adjusted
        // prices arrive (js/esi.js calculateNodeEIV: sum of adjusted price x base quantity per run).
        em: hasMats ? n.recipe.materials.map(m => [m.typeId, m.baseQty]) : null
      });
      (n.children || []).forEach(c => { if (c) walk(c, n); });
    })(root, null);
    return nodes;
  }
  MB.flattenTree = flattenTree;

  // EIV per run for every part, from whatever adjusted prices are loaded right now.
  function refreshEIV(item) {
    for (const n of item.nodes) if (n.em) n.bre = n.em.reduce((s, [t, b]) => s + window.getEIV(t) * b, 0);
  }
  // Default ME/TE per blueprint: your best owned original, like js/tree.js getDefaultMeTeForBlueprint.
  function refreshDefaults(item) {
    for (const n of item.nodes) {
      if (!n.m) continue;
      const owned = window.getBestOwnedBpoMeTe ? window.getBestOwnedBpoMeTe(n.k) : null;
      n.me = owned ? owned.me : 0;
      n.te = owned ? owned.te : 0;
    }
  }
  MB.refreshEIV = refreshEIV;
  MB.refreshDefaults = refreshDefaults;

  // The site's tree builder reads the desktop's global build/ME/TE/price-source maps while it
  // awaits, so only one thing at a time may swap them in (Calculator loads, Add to Ledger, Ledger
  // rebuilds and imports, Invention). Each of those runs through this queue.
  let treeQueue = Promise.resolve();
  function treeLock(fn) {
    const run = treeQueue.then(() => fn());
    treeQueue = run.catch(() => {});
    return run;
  }
  MB.treeLock = treeLock;

  // Builds an item's full tree with the site's own builder, every part set to Build and reactions
  // on, then prices it (Jita, via js/esi.js) and hands back an engine item. The desktop's global
  // build/ME/TE maps are borrowed for the build and put back afterwards.
  const loadFullItem = (bpId, onProgress) => treeLock(() => loadFullItemNow(bpId, onProgress));
  async function loadFullItemNow(bpId, onProgress) {
    const recipe = window.recipeMap[bpId];
    if (!recipe) throw new Error('No recipe for ' + bpId);
    const bpName = (window.EVE_ITEMS && window.EVE_ITEMS[bpId]) || nameOf(bpId);
    const saved = { b: window.buildSelfOverrides, me: window.customMEOverrides, te: window.customTEOverrides, m: window.customBuyModes };
    const reactEl = document.getElementById('include-reactions');
    const prevReact = reactEl ? reactEl.value : 'true';
    let root;
    try {
      if (reactEl) reactEl.value = 'true';
      window.buildSelfOverrides = {};
      window.customMEOverrides = {};
      window.customTEOverrides = {};
      window.customBuyModes = {};
      if (onProgress) onProgress('Reading the recipe…');
      await window.markBuildableDescendantsRecursive(bpId, 0, 10, new Set());
      let pt = parseInt(recipe.productTypeID) || (window.BLUEPRINT_TO_PRODUCT_MAP && window.BLUEPRINT_TO_PRODUCT_MAP[bpId]) || null;
      if (!pt && window.isBlueprintName(bpName)) pt = window.resolveProductIdFromBlueprintName(bpName);
      window.recipeTreeRootProductTypeId = pt;
      root = await window.buildRecursiveRecipeTree(bpId, bpName, 1, 0, 10, new Set(), null);
      window.recipeTreeRootProductTypeId = null;
      const y = root.batchYield || 1;
      root.qtyNeeded = y; root.runsNeeded = 1; root.jobCount = 1;
      window.scaleTreeQuantities(root, (window.getActiveStructureType().meBonus || 0) / 100);
      window.calculateNodeEIV(root);
    } finally {
      window.recipeTreeRootProductTypeId = null;
      window.buildSelfOverrides = saved.b; window.customMEOverrides = saved.me; window.customTEOverrides = saved.te; window.customBuyModes = saved.m;
      if (reactEl) reactEl.value = prevReact;
    }
    const nodes = flattenTree(root);
    if (onProgress) onProgress('Getting Jita prices…');
    await ensurePrices(nodes.map(n => n.pt));
    const pt = root.productTypeId || root.typeId;
    return E.makeItem({ pt, bp: bpId, name: root.productName || nameOf(pt), bpName, group: (window.EVE_GROUP_NAMES && window.EVE_GROUP_NAMES[pt]) || '', nodes, prices: window.priceCache });
  }
  MB.loadFullItem = loadFullItem;

  // Jita prices through the site's own fetcher (Fuzzwork, station from eve_home_station_id).
  async function ensurePrices(ids) {
    const want = [...new Set(ids.filter(Boolean).map(Number))];
    if (want.length) await window.fetchMarketPrices(want);
  }
  MB.ensurePrices = ensurePrices;
  MB.price = pt => window.priceCache[pt] || { sell: 0, buy: 0 };

  /* =====================  Skills  ===================== */
  const DEFAULT_SKILLS = { industry: 5, advIndustry: 5, allSkills: { 45746: 5 } };
  const rawSkills = () => LS.get('eve_char_skills', null);
  const hasSkillSheet = () => { const s = rawSkills(); return !!(s && s.allSkills && Object.keys(s.allSkills).length); };
  // The same sheet the desktop's build-time maths reads (getEffectiveCharSkills), as a plain object.
  function skillsForEngine() {
    const raw = rawSkills() || DEFAULT_SKILLS;
    if (!prefs.simV || !hasSkillSheet()) return { industry: raw.industry || 0, advIndustry: raw.advIndustry || 0, allSkills: raw.allSkills || {} };
    return {
      industry: Math.max(raw.industry || 0, 5), advIndustry: Math.max(raw.advIndustry || 0, 5),
      allSkills: new Proxy(raw.allSkills || {}, { get(t, p) { if (typeof p !== 'string') return t[p]; return Math.max(t[p] || 0, 5); } })
    };
  }
  const implantPct = () => parseFloat(LS.raw('eve_mfg_implant_bonus_pct')) || 0;
  Object.assign(MB, { rawSkills, hasSkillSheet, skillsForEngine, implantPct });

  /* =====================  Stock (your assets)  ===================== */
  // Same filter rules as the desktop's applyStockLocationFilter (js/esi.js), on the same saved
  // asset list. window.userStockMap and window.stockAfterLedgerClaims are set too, since desktop
  // functions the phone reuses read them.
  let stockMap = {};
  function rebuildStock() {
    const loc = prefs.stockLoc || 'all';
    const sysName = String(liveStation().systemName || 'JITA').toUpperCase();
    stockMap = {};
    (window.rawAssetItems || []).forEach(item => {
      if (item.owner_type === 'char' && !prefs.stockPersonal) return;
      if (item.owner_type === 'corp' && !prefs.stockCorp) return;
      const rootLocId = item.root_location_id || item.location_id;
      const locName = (window.resolvedLocationNames && window.resolvedLocationNames[rootLocId]) || '';
      let include = false;
      if (loc === 'all') include = true;
      else if (loc === 'industry_system') include = locName.includes(sysName);
      else if (loc.startsWith('loc_')) include = rootLocId === parseInt(loc.slice(4));
      else if (loc.startsWith('corpsag_')) { const parts = loc.split('_'); include = rootLocId === parseInt(parts[1]) && item.location_flag === parts[2]; }
      else if (loc.startsWith('container_')) include = item.container_id === parseInt(loc.slice(10));
      if (include) stockMap[item.type_id] = (stockMap[item.type_id] || 0) + item.quantity;
    });
    window.userStockMap = stockMap;
    window.stockAfterLedgerClaims = window.computeStockAfterLedgerClaims ? window.computeStockAfterLedgerClaims(stockMap) : { ...stockMap };
  }
  // Raw stock under the filters, and what's left once STARTED Ledger jobs have taken theirs.
  const stockOf = pt => stockMap[pt] || 0;
  const freeStockOf = pt => (window.stockAfterLedgerClaims ? window.stockAfterLedgerClaims[pt] || 0 : stockOf(pt));
  // What comes off a shopping list: nothing while "Take what I own off the list" is off.
  const have = pt => (prefs.deduct && isLoggedIn() ? freeStockOf(pt) : 0);
  // Location choices, built like the desktop's populateLocationDropdown.
  function stockLocations() {
    const sagName = f => {
      const n = f.startsWith('CorpSAG') ? (window.corpDivisionNames && window.corpDivisionNames[f.slice(7)]) : null;
      return n || (f === 'CorpDeliveries' ? 'Corp deliveries' : f.replace('CorpSAG', 'Division '));
    };
    const locs = {};
    (window.rawAssetItems || []).forEach(item => {
      const id = item.root_location_id || item.location_id;
      if (!locs[id]) locs[id] = { name: (window.resolvedLocationNames && window.resolvedLocationNames[id]) || `Location ${id}`, n: 0, divs: {}, cans: {} };
      locs[id].n += item.quantity;
      if (item.owner_type === 'corp' && item.location_flag && item.location_flag.startsWith('Corp')) {
        locs[id].divs[item.location_flag] = (locs[id].divs[item.location_flag] || 0) + item.quantity;
      }
      if (item.container_id) locs[id].cans[item.container_id] = (locs[id].cans[item.container_id] || 0) + item.quantity;
    });
    const out = [['all', 'All locations'], ['industry_system', `This station's system (${systemName(liveStation().systemId, liveStation().systemName)})`]];
    Object.entries(locs).sort((a, b) => b[1].n - a[1].n).forEach(([id, d]) => {
      out.push([`loc_${id}`, `${titleCase(d.name)} (${qty(d.n)})`]);
      Object.entries(d.divs).forEach(([f, n]) => out.push([`corpsag_${id}_${f}`, `  └ Corp: ${titleCase(sagName(f))} (${qty(n)})`]));
      Object.entries(d.cans).forEach(([cid, n]) => out.push([`container_${cid}`, `  └ Container: ${titleCase((window.resolvedLocationNames && window.resolvedLocationNames[cid]) || 'Container')} (${qty(n)})`]));
    });
    return out;
  }
  // ESI names come back in capitals on the desktop; the phone shows them in normal case.
  function titleCase(s) {
    return String(s || '').toLowerCase().replace(/(^|[\s\-(\[/])([a-z])/g, (m, a, b) => a + b.toUpperCase()).replace(/\b(Iv|Ix|Vi|Vii|Viii|Ii|Iii|Xi|Xii|Xiii|Xiv|Xv)\b/g, m => m.toUpperCase());
  }
  // The saved copy of your assets, so stock shows straight away before the live refresh lands.
  function restoreSavedAssets() {
    const raw = LS.get('eve_raw_assets', []);
    window.rawAssetItems = Array.isArray(raw) ? raw.filter(Boolean) : [];
    Object.assign(window.resolvedLocationNames, LS.get('eve_resolved_location_names', {}));
    Object.assign(window.corpDivisionNames, LS.get('eve_corp_division_names', {}));
  }
  Object.assign(MB, { rebuildStock, stockOf, freeStockOf, have, stockLocations, titleCase, restoreSavedAssets });

  /* =====================  EVE account  ===================== */
  const characters = () => Object.values(window.loadCharacterStore ? window.loadCharacterStore() : {}).sort((a, b) => (a.charName || '').localeCompare(b.charName || ''));
  const activeChar = () => (window.getActiveCharacterRecord ? window.getActiveCharacterRecord() : null);
  function isLoggedIn() { const c = activeChar(); return !!(c && c.accessToken); }
  const portrait = (charId, size) => `https://images.evetech.net/characters/${charId}/portrait?size=${size || 64}`;
  function login(intent) {
    try { sessionStorage.setItem('eve_mobile_return', location.hash || '#calc'); } catch (e) { /* ignore */ }
    window.startEsiSSOLogin(intent);
  }
  Object.assign(MB, { characters, activeChar, isLoggedIn, portrait, login });

  /* =====================  Bottom sheets  ===================== */
  // Screens register sheets: MB.SHEETS[kind] = { title(), html(), after?(), click?(e), input?(e), change?(e) }.
  const SHEETS = {};
  let sheetKind = null;
  let sheetReturn = null;
  function fillSheet() {
    const s = SHEETS[sheetKind];
    if (!s) return;
    $('#sheet-title').textContent = s.title();
    $('#sheet-body').innerHTML = s.html();
    if (s.after) s.after();
  }
  function openSheet(kind, from) {
    sheetKind = kind;
    sheetReturn = from || document.activeElement;
    if (SHEETS[kind] && SHEETS[kind].open) SHEETS[kind].open();
    fillSheet();
    $('#scrim').classList.add('open');
    const s = $('#sheet');
    s.classList.add('open');
    s.setAttribute('aria-hidden', 'false');
    s.scrollTop = 0;
    $('#sheet-close').focus({ preventScroll: true });
  }
  function closeSheet() {
    if (!sheetKind) return;
    const s = $('#sheet');
    $('#scrim').classList.remove('open');
    s.classList.remove('open');
    s.setAttribute('aria-hidden', 'true');
    const was = sheetKind;
    sheetKind = null;
    if (SHEETS[was] && SHEETS[was].close) SHEETS[was].close();
    if (sheetReturn && document.body.contains(sheetReturn)) sheetReturn.focus({ preventScroll: true });
  }
  // Switch to another sheet in place (the button that opened the first one keeps focus return).
  function gotoSheet(kind) {
    sheetKind = kind;
    if (SHEETS[kind] && SHEETS[kind].open) SHEETS[kind].open();
    fillSheet();
    $('#sheet').scrollTop = 0;
    const first = $('#sheet-body').querySelector('button:not([disabled]), input');
    if (first) first.focus({ preventScroll: true });
  }
  const refillSheet = (...kinds) => { if (sheetKind && (!kinds.length || kinds.includes(sheetKind))) fillSheet(); };
  Object.assign(MB, { SHEETS, openSheet, closeSheet, fillSheet, gotoSheet, refillSheet, sheetKind: () => sheetKind });

  function stepper(key, value, min, max, label) {
    return `<span class="stepper"><button type="button" data-step="${key}" data-d="-1" aria-label="Lower ${esc(label)}"${value <= min ? ' disabled' : ''}>−</button><output aria-live="polite">${value}</output><button type="button" data-step="${key}" data-d="1" aria-label="Raise ${esc(label)}"${value >= max ? ' disabled' : ''}>+</button></span>`;
  }
  MB.stepper = stepper;

  // A percentage field: numbers from 0 to 100, comma or dot. Anything else puts the old value back.
  function readPct(el, old) {
    const v = parseFloat(String(el.value).replace(',', '.').replace('%', '').trim());
    if (!(v >= 0 && v <= 100)) { el.value = old; toast('Enter a number from 0 to 100'); return null; }
    const r = Math.round(v * 1000) / 1000;
    el.value = r;
    return r;
  }
  MB.readPct = readPct;

  /* =====================  Screens and tabs  ===================== */
  // Screens register: MB.screens[name] = { title, render(), enter?() }.
  MB.screens = {};
  const DESKTOP_PAGE = { calc: 'index.html', ledger: 'ledger.html', inv: 'invention.html', lp: 'lpstore.html', jita: 'shoppinglist.html' };
  let screen = 'calc';
  function goScreen(name, opts) {
    if (!MB.screens[name]) name = 'calc';
    screen = name;
    $$('.tab').forEach(t => t.setAttribute('aria-current', t.dataset.screen === name ? 'page' : 'false'));
    $$('.screen').forEach(s => { s.hidden = s.id !== 'screen-' + name; });
    $('#appbar-title').textContent = MB.screens[name].title;
    document.title = `${MB.screens[name].title} — Eve Deep Industry`;
    try { history.replaceState(null, '', location.pathname + location.search + '#' + name); } catch (e) { /* ignore */ }
    const wide = $('#wide-desktop-link'); // the "desktop site" link beside the phone on a wide screen
    if (wide) wide.href = DESKTOP_PAGE[name] || 'index.html';
    const sc = MB.screens[name];
    if (sc.enter) sc.enter(opts); else sc.render();
    if (!(opts && opts.keepScroll)) $('#screen-' + name).scrollTop = 0;
  }
  MB.goScreen = goScreen;
  MB.screen = () => screen;
  // The desktop page for what's on screen, remembered as the choice for this browser.
  MB.desktopUrl = () => DESKTOP_PAGE[screen] || 'index.html';
  MB.goDesktop = () => { LS.set('eve_prefer_desktop', '1'); location.href = MB.desktopUrl(); };

  // Re-render whatever's visible (after a login, an asset refresh, a station change, ...).
  function renderAll() {
    renderAcctBtn();
    for (const sc of Object.values(MB.screens)) if (sc.always) sc.always();
    if (MB.screens[screen]) MB.screens[screen].render();
    refillSheet('account', 'settings');
  }
  MB.renderAll = renderAll;

  function renderAcctBtn() {
    const b = $('#acct-btn');
    const c = activeChar();
    if (c && c.accessToken) {
      b.className = 'acct in';
      b.innerHTML = `<span class="avatar" aria-hidden="true"><img src="${portrait(c.charId, 64)}" alt="" onerror="this.remove()"></span>`;
      b.setAttribute('aria-label', `Account: ${c.charName}`);
    } else {
      b.className = 'acct';
      b.innerHTML = `${ICON.lock}Log in`;
      b.setAttribute('aria-label', 'Log in with EVE Online');
    }
  }
  MB.renderAcctBtn = renderAcctBtn;

  /* =====================  Account sheet  ===================== */
  SHEETS.account = {
    title: () => (isLoggedIn() ? 'Your characters' : 'Log in'),
    html() {
      if (!isLoggedIn()) {
        return `<p class="sheet-lead">Log in with EVE Online so the tool can use:</p>
          <ul class="perks">
            <li>${ICON.skill}<span><b>Your skills</b>, for build times and invention success chance</span></li>
            <li>${ICON.box}<span><b>Your hangars and corp</b>, to take what you already own off shopping lists</span></li>
            <li>${ICON.bp}<span><b>Your blueprints</b>, with their real ME/TE</span></li>
            <li>${ICON.clock}<span><b>Your running jobs</b>, synced into the Ledger</span></li>
            <li>${ICON.star}<span><b>Your LP balances</b>, for the LP Store</span></li>
          </ul>
          <button class="btn primary" type="button" data-acct="login">${ICON.lock}Log in with EVE Online</button>
          <p class="note">This opens EVE's own login page. The site never sees your password, and only asks to read the things above.</p>`;
      }
      const c = activeChar();
      const synced = parseInt(LS.raw('eve_assets_last_synced')) || 0;
      const sk = rawSkills();
      return `<div class="pilot"><span class="avatar" aria-hidden="true"><img src="${portrait(c.charId, 128)}" alt="" onerror="this.remove()"></span><div><b>${esc(c.charName)}</b><span>${esc(c.corpName || '')}${c.corpTicker ? ` [${esc(c.corpTicker)}]` : ''}</span></div></div>
        <div class="card">
          <div class="kv"><span class="k">Build skills<small>${sk ? `Industry ${sk.industry || 0} · Advanced Industry ${sk.advIndustry || 0} · ${Object.keys(sk.allSkills || {}).length} skills read` : 'Loading…'}</small></span></div>
          <div class="kv"><span class="k">Personal and corp assets<small>${synced ? `refreshed ${ago(synced)}` : 'not refreshed yet'} · ${qty((window.rawAssetItems || []).length)} stacks</small></span><button class="iconbtn" type="button" data-acct="refresh" aria-label="Refresh assets">${ICON.refresh}</button></div>
        </div>
        <div class="card-title">Characters</div>
        <div class="card">${characters().map(ch => `
          <div class="kv"><span class="avatar" aria-hidden="true"><img src="${portrait(ch.charId, 64)}" alt="" onerror="this.remove()"></span>
            <span class="k">${esc(ch.charName)}<small>${ch.charId === c.charId ? 'active' : esc(ch.corpTicker ? `[${ch.corpTicker}]` : '')}</small></span>
            ${ch.charId === c.charId ? '' : `<button class="btn" style="width:auto;height:38px" type="button" data-acct="switch" data-char="${esc(ch.charId)}">Switch</button>`}
            <button class="iconbtn" type="button" data-acct="remove" data-char="${esc(ch.charId)}" aria-label="Log out ${esc(ch.charName)}">${ICON.x}</button>
          </div>`).join('')}
          <div class="kv"><button class="linkbtn" style="margin:0" type="button" data-acct="add">+ Add another character</button></div>
        </div>`;
    },
    async click(e) {
      const a = e.target.closest('[data-acct]');
      if (!a) return;
      const act = a.dataset.acct;
      if (act === 'login') { login(); return; }
      if (act === 'add') { login('add'); return; }
      if (act === 'refresh') {
        a.disabled = true;
        a.innerHTML = '<span class="spin" aria-hidden="true"></span>';
        toast('Refreshing your assets from EVE…');
        await window.refreshLiveAssets();
        return;
      }
      if (act === 'switch') {
        a.disabled = true;
        await window.setActiveChar(a.dataset.char);
        renderAll();
        toast(`Switched to ${activeChar().charName}`);
        return;
      }
      if (act === 'remove') {
        const ch = characters().find(x => x.charId === a.dataset.char);
        window.removeCharacter(a.dataset.char);
        if (!isLoggedIn()) { window.rawAssetItems = []; rebuildStock(); closeSheet(); }
        renderAll();
        toast(`Logged out ${ch ? ch.charName : 'the character'}`);
      }
    }
  };

  /* =====================  Wiring  ===================== */
  $('#sheet').addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
  $('#sheet-close').addEventListener('click', closeSheet);
  $('#scrim').addEventListener('click', closeSheet);
  for (const type of ['click', 'input', 'change']) {
    $('#sheet-body').addEventListener(type, e => {
      const s = SHEETS[sheetKind];
      if (type === 'click') {
        const g = e.target.closest('[data-goto-sheet]');
        if (g) { gotoSheet(g.dataset.gotoSheet); return; }
      }
      if (s && s[type]) s[type](e);
    });
  }
  $('#acct-btn').addEventListener('click', e => openSheet('account', e.currentTarget));
  $$('.tab').forEach(t => t.addEventListener('click', () => { closeSheet(); goScreen(t.dataset.screen); }));

  /* =====================  Start  ===================== */
  MB.start = async () => {
    window.buildPrepackedIndexes();
    if (window.restoreOwnedBpoIndexFromCache) window.restoreOwnedBpoIndexFromCache();
    restoreSavedAssets();
    syncShim();
    rebuildStock();
    renderAcctBtn();

    // Coming back from EVE's login page: the code is still in the URL, so exchange it first.
    const params = new URLSearchParams(location.search);
    const fromLogin = params.has('code') || params.has('error');
    let returnTo = null;
    try { returnTo = sessionStorage.getItem('eve_mobile_return'); sessionStorage.removeItem('eve_mobile_return'); } catch (e) { /* ignore */ }
    const first = (fromLogin && returnTo ? returnTo : location.hash).replace('#', '') || 'calc';

    await Promise.race([Promise.all([loadIndustrySystems(), loadSecurity(liveStation().systemId)]), sleep(4000)]);
    setStationGlobals();
    goScreen(first);

    // Background: adjusted prices (job fees), then the login/asset refresh.
    const eiv = window.fetchAdjustedPrices().catch(err => console.warn('[Phone] Adjusted prices failed:', err));
    MB.eivReady = eiv;
    eiv.then(() => { MB.eivLoaded = true; window.dispatchEvent(new CustomEvent('mb:eiv-ready')); });
    window.handleEsiSSOCallback()
      .then(() => { renderAll(); if (fromLogin && isLoggedIn()) toast(`Logged in as ${activeChar().charName}`); })
      .catch(err => console.error('[Phone] Login handling failed:', err));
  };

  window.addEventListener('eve:assets-refreshed', () => { rebuildStock(); renderAll(); });
  window.addEventListener('eve:active-character-changed', () => { renderAcctBtn(); });

  return MB;
})();
