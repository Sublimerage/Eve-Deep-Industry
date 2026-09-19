'use strict';

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
window.esc = esc;

// Final stage of an item icon's fallback chain (icon -> render -> this) - for an item with genuinely
// no image on either ESI endpoint. SKINs are the confirmed real case (they 404 on both), which is why
// the glyph shown here is the SKIN-shaped paint roller, not a generic box. Shared across every page's
// item icons - the Calculator's own node-card icon (js/app.js) hits this exact gap the moment a SKIN
// gets isolated into the tree view from an LP Store offer, same as LP Store's own list/search rows
// already handled; reusing the failed <img>'s own className keeps the placeholder the exact size/
// shape the image would have been, in whatever context (search row, group header, node card) called
// this, with no per-caller size parameter needed.
function handleItemIconLoadError(imgEl) {
  const span = document.createElement('span');
  span.className = (imgEl.className || '') + ' flex items-center justify-center flex-shrink-0';
  span.style.background = 'rgba(255,255,255,0.06)';
  span.style.color = 'var(--text-mute)';
  span.title = 'No image available for this item';
  span.innerHTML = window.svgIcon ? window.svgIcon('skin', { style: 'width:55%;height:55%;' }) : '';
  imgEl.replaceWith(span);
}
window.handleItemIconLoadError = handleItemIconLoadError;

// <input type="number"> validates keystrokes against the BROWSER'S LOCALE, not a fixed period - on a
// browser/OS set to a language that uses comma as its decimal separator, "." is silently rejected and
// only whole numbers can be typed at all (a well-known HTML gotcha, unrelated to this app's own code -
// every reader of these fields already uses parseFloat and is fully decimal-safe). Every percentage/fee
// field in this app uses type="text" + this locale-independent sanitizer instead: digits and at most
// one literal "." allowed, on every locale, with no native number-input weirdness to fight.
function sanitizeDecimalInput(e) {
  const input = e.target;
  const cursorFromEnd = input.value.length - input.selectionStart;
  let cleaned = input.value.replace(/[^0-9.]/g, '');
  const firstDot = cleaned.indexOf('.');
  if (firstDot !== -1) {
    cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
  }
  if (cleaned !== input.value) {
    input.value = cleaned;
    const pos = Math.max(0, cleaned.length - cursorFromEnd);
    input.setSelectionRange(pos, pos);
  }
}
window.sanitizeDecimalInput = sanitizeDecimalInput;

// Shared BOM item categorization (calculator + ledger consolidated BOM category filters).
function getItemCategory(typeId, name) {
  if (!name) return 'others';
  const n = name.toLowerCase();
  const mineralIds = new Set([34, 35, 36, 37, 38, 39, 40, 11399]);
  if (mineralIds.has(typeId) || n.includes('tritanium') || n.includes('pyerite') || n.includes('mexallon') || n.includes('isogen') || n.includes('nocxium') || n.includes('zydrine') || n.includes('megacyte') || n.includes('morphite')) {
    return 'minerals';
  }
  if (n.includes('fuel block')) {
    return 'fuel';
  }
  if (n.includes('gas') || n.includes('isotope') || n.includes('water') || n.includes('ozone') ||
      n.includes('plastics') || n.includes('chiral') || n.includes('cultures') || n.includes('viral') || n.includes('fiber') || n.includes('nanites')) {
    return 'pigas';
  }
  // Prefer real category classification (from generate_db.py's EVE Ref data) over name-keyword
  // matching - the keyword list above only recognizes hull-class words and a curated list of T1
  // ship names, so faction/pirate/T2 hulls (e.g. "Vargur", "Leshak") that don't contain any of those
  // words were silently miscategorized as "Others" even though they're genuinely ships.
  const catId = window.EVE_CATEGORIES ? window.EVE_CATEGORIES[typeId] : undefined;
  if (catId === 6) return 'ships';
  if (catId !== undefined && catId !== null) return 'others';
  if (typeof window.isShipType === 'function' && window.isShipType(typeId)) {
    return 'ships';
  }
  return 'others';
}
window.getItemCategory = getItemCategory;

// Shared toast notification, used site-wide for failures that previously only hit the console (or
// worse, got silently overwritten by a false "success" status). type is 'error' | 'success' | 'info'.
const TOAST_ICONS = {
  error: '<svg class="toast-icon" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="12.5"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
  success: '<svg class="toast-icon" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
  info: '<svg class="toast-icon" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
};
// options.action = { label, onClick } adds an inline button (e.g. "Undo") - clicking it runs
// onClick and dismisses the toast; the toast also just times out normally if it's never clicked.
function showToast(message, type, options) {
  type = (type === 'error' || type === 'success') ? type : 'info';
  options = options || {};
  const duration = options.duration || (options.action ? 8000 : 6000);
  let stack = document.getElementById('toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.id = 'toast-stack';
    document.body.appendChild(stack);
  }
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  const actionHtml = options.action ? `<button type="button" class="toast-action-btn">${window.esc(options.action.label)}</button>` : '';
  toast.innerHTML = `${TOAST_ICONS[type]}<span class="toast-message"></span>${actionHtml}<button type="button" class="toast-close" aria-label="Dismiss">&#10005;</button>`;
  toast.querySelector('.toast-message').textContent = message;
  toast.querySelector('.toast-close').addEventListener('click', () => toast.remove());
  if (options.action) {
    toast.querySelector('.toast-action-btn').addEventListener('click', () => {
      options.action.onClick();
      toast.remove();
    });
  }
  stack.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('is-visible'));
  setTimeout(() => {
    toast.classList.remove('is-visible');
    setTimeout(() => toast.remove(), 250);
  }, duration);
}
window.showToast = showToast;

// A price with no real backing market order (js/esi.js fetchMarketPrices() falls back to EVE's
// Estimated Item Value when no order data is found) previously rendered identically to a real
// price - this makes that visible wherever it's called, instead of a silent guess.
function estimatedPriceMarker(typeId) {
  const entry = window.priceCache && window.priceCache[typeId];
  if (!entry || !entry.isEstimated) return '';
  return ' <span class="text-amber-400 font-bold" style="font-size:0.85em;" title="No real market order data found for this item - showing EVE\'s Estimated Item Value instead of an actual buy/sell order.">(EST)</span>';
}
window.estimatedPriceMarker = estimatedPriceMarker;

// Shared blueprint-name detection - was independently reimplemented at 8+ call sites across
// app.js/ledger.js. A blueprint/formula/reaction item's typeId isn't valid against the /icon
// image endpoint (it 400s), so every place that renders an item icon or needs to tell "this is a
// blueprint, not the thing it makes" apart needs this same check.
function isBlueprintName(name) {
  const n = (name || '').toLowerCase();
  return n.includes('blueprint') || n.includes('formula') || n.includes('reaction');
}
window.isBlueprintName = isBlueprintName;

// Shared icon URL builder for the same reason - picks the /bp variant for blueprints, /icon
// otherwise, matching the exact pattern every render site already used by hand.
function getItemIconUrl(typeId, name, size) {
  size = size || 32;
  return isBlueprintName(name)
    ? `https://images.evetech.net/types/${typeId}/bp?size=${size}`
    : `https://images.evetech.net/types/${typeId}/icon?size=${size}`;
}
window.getItemIconUrl = getItemIconUrl;

// Shared "copy text, flash the button to confirm it worked, restore after a delay" pattern - was
// independently rewritten 6 times across app.js/ledger.js/invention.js with minor inconsistencies
// (some used .textContent, some .innerHTML; timeouts ranged 900-1500ms).
function copyToClipboardWithFeedback(text, btnEl, options) {
  options = options || {};
  const duration = options.duration || 1500;
  const useInnerHTML = !!options.useInnerHTML;
  navigator.clipboard.writeText(text).then(() => {
    if (!btnEl) return;
    const originalContent = useInnerHTML ? btnEl.innerHTML : btnEl.textContent;
    const originalClass = btnEl.className;
    if (useInnerHTML) btnEl.innerHTML = window.svgIcon('check') + ' Copied!'; else btnEl.textContent = 'Copied!';
    if (options.flashClassName) btnEl.className = options.flashClassName;
    setTimeout(() => {
      if (useInnerHTML) btnEl.innerHTML = originalContent; else btnEl.textContent = originalContent;
      if (options.flashClassName) btnEl.className = originalClass;
    }, duration);
  }).catch(() => {});
}
window.copyToClipboardWithFeedback = copyToClipboardWithFeedback;

// --- Shared inline-SVG icon set ---
// Replaces the emoji glyphs (🛒 ✔ ✖ ⚙ 💰 📥 🏭 🔎 📊 ...) that used to sit inside button labels,
// badges and status text. Every icon is a 24x24 stroke path in the same visual language as the
// rest of the app's icons (renderJobStatusIconHTML/renderRunsEditIconHTML in ledger.js, the toast
// icons above, the disclosure carets in the HTML): fill:none, stroke:currentColor, 2px round caps.
// Sizing + baseline alignment live in `svg.ico` rules in styles.css, so a call site can just drop
// in `window.svgIcon('cart')` with no dimensions and it inherits the surrounding text color/size.
const SVG_ICON_PATHS = {
  check: '<polyline points="20 6 9 17 4 12"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  cart: '<circle cx="9" cy="21" r="1.6"/><circle cx="18.5" cy="21" r="1.6"/><path d="M2 3h3l2.4 12.2a1.8 1.8 0 0 0 1.77 1.45h9a1.8 1.8 0 0 0 1.77-1.45L23 7H6"/>',
  search: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.05" y2="16.05"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7"/><polyline points="21 4 21 9 16 9"/>',
  clipboard: '<rect x="8" y="3" width="8" height="4" rx="1"/><path d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2"/>',
  factory: '<path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M7 18h.01"/><path d="M12 18h.01"/><path d="M17 18h.01"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  coin: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.66 3.58 3 8 3s8-1.34 8-3V6"/><path d="M4 12v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6"/>',
  hourglass: '<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.17a2 2 0 0 0-.59-1.41L12 12l-4.41 4.42A2 2 0 0 0 7 17.83V22"/><path d="M7 2v4.17a2 2 0 0 0 .59 1.41L12 12l4.41-4.42A2 2 0 0 0 17 6.17V2"/>',
  chart: '<line x1="4" y1="20" x2="4" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="20" y1="20" x2="20" y2="14"/>',
  tool: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  eye: '<path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/>',
  lock: '<rect x="4" y="10.5" width="16" height="10.5" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
  package: '<path d="M21 8 12 3 3 8l9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><line x1="12" y1="13" x2="12" y2="21"/>',
  message: '<path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/>',
  'external-link': '<path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
  // A paint droplet - SKINs are cosmetic ship reskins, and a drop of paint reads as "cosmetic/color"
  // clearly even at 14-16px, where the earlier paint-roller design read as an ambiguous blob. Used
  // both for the SKINs category pill and as the fallback glyph when a SKIN's image 404s on both the
  // icon and render endpoints (the confirmed real case this fallback exists for - see
  // handleItemIconLoadError's own comment).
  skin: '<path d="M12 2.69 17.66 8.35a8 8 0 1 1-11.31 0z"/>',
  pin: '<path d="M12 21s7-5.2 7-11a7 7 0 0 0-14 0c0 5.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  trending: '<polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/>',
  award: '<circle cx="12" cy="8" r="6"/><path d="M15.5 12.5 17 22l-5-3-5 3 1.5-9.5"/>',
  warning: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.71 3h18.98a2 2 0 0 0 1.71-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  play: '<polygon points="6 4 20 12 6 20 6 4"/>',
  list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3.5" y1="6" x2="3.51" y2="6"/><line x1="3.5" y1="12" x2="3.51" y2="12"/><line x1="3.5" y1="18" x2="3.51" y2="18"/>',
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1"/><rect x="13.5" y="3.5" width="7" height="7" rx="1"/><rect x="13.5" y="13.5" width="7" height="7" rx="1"/><rect x="3.5" y="13.5" width="7" height="7" rx="1"/>',
  activity: '<polyline points="3 12 8 12 11 4 15 20 18 12 21 12"/>',
  'chevron-right': '<polyline points="9 6 15 12 9 18"/>',
  'chevron-down': '<polyline points="6 9 12 15 18 9"/>',
  'chevron-up': '<polyline points="18 15 12 9 6 15"/>',
  'chevrons-up': '<polyline points="17 11 12 6 7 11"/><polyline points="17 18 12 13 7 18"/>',
  'chevrons-down': '<polyline points="7 13 12 18 17 13"/><polyline points="7 6 12 11 17 6"/>',
  grip: '<circle cx="9" cy="6" r="1.3"/><circle cx="9" cy="12" r="1.3"/><circle cx="9" cy="18" r="1.3"/><circle cx="15" cy="6" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="15" cy="18" r="1.3"/>',
  expand: '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>',
  collapse: '<polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/>',
  // Two small cards flowing down into one - "combine these duplicates into a single job", used on
  // the Ledger's Combine Duplicates control (ledger.html hand-writes the same path inline there,
  // same as every other static toolbar icon in that file - this registry entry is for JS-generated
  // markup that wants the same glyph).
  merge: '<rect x="2" y="3" width="8" height="6" rx="1.3"/><rect x="14" y="3" width="8" height="6" rx="1.3"/><path d="M6 9c0 3 3 3 6 5"/><path d="M18 9c0 3-3 3-6 5"/><rect x="6" y="16" width="12" height="6" rx="1.3"/>',
  // LP Store category filter bar + favorite toggle (js/lpstore.js) - same feather-style 24x24
  // stroke-path convention as everything above, so these drop into .lp-pill/icon-btn exactly like
  // the existing icons do. `star` doubles as the favorite toggle: callers fill it in via
  // opts.style="fill:currentColor" for the "favorited" state rather than a second registry entry -
  // fill/stroke are inherited SVG properties, so an inline style on the <svg> root cascades to the
  // bare <polygon> below with no fill of its own.
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  rocket: '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
  ammo: '<rect x="9" y="2" width="6" height="13" rx="2.6"/><path d="M9 12l3 10 3-10"/>',
  drone: '<circle cx="12" cy="12" r="3"/><line x1="12" y1="9" x2="12" y2="4.5"/><line x1="12" y1="15" x2="12" y2="19.5"/><line x1="9" y1="12" x2="4.5" y2="12"/><line x1="15" y1="12" x2="19.5" y2="12"/><circle cx="12" cy="3.2" r="1.7"/><circle cx="12" cy="20.8" r="1.7"/><circle cx="3.2" cy="12" r="1.7"/><circle cx="20.8" cy="12" r="1.7"/>',
  cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/>',
  book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  'file-text': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>',
  // Personal/Corp job ownership - same two glyphs the Ledger's own Personal/Corp job filter and the
  // stock/location filter's Personal/Corp toggle already use inline, registered here too so job-card
  // badges (renderJobMetaChipHTML) can share the exact same icon via svgIcon() instead of a third
  // hand-copied inline path.
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/>',
  building: '<path d="M4 21V7a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v14"/><path d="M12 11h6a1 1 0 0 1 1 1v9"/><line x1="8" y1="9" x2="8" y2="9.01"/><line x1="8" y1="13" x2="8" y2="13.01"/><line x1="8" y1="17" x2="8" y2="17.01"/><line x1="16" y1="15" x2="16" y2="15.01"/><line x1="16" y1="19" x2="16" y2="19.01"/>',
  // A plain plus - the Ledger's "top up this prerequisite job's runs" button (renderJobCardHTML/
  // renderJobListRowHTML) pairs this with the missing quantity so "+N" reads as an add action at a
  // glance instead of needing the tooltip to explain it.
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'
};

function svgIcon(name, opts) {
  opts = opts || {};
  const paths = SVG_ICON_PATHS[name];
  if (!paths) return '';
  const filled = name === 'grip';
  const cls = 'ico' + (opts.cls ? ' ' + opts.cls : '');
  const style = opts.style ? ` style="${opts.style}"` : '';
  const stroke = filled
    ? 'fill="currentColor" stroke="none"'
    : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  return `<svg class="${cls}" viewBox="0 0 24 24" ${stroke} aria-hidden="true"${style}>${paths}</svg>`;
}
window.svgIcon = svgIcon;

// Click-to-copy for an item/job display name (e.g. BOM rows, job cards) - so it can be pasted
// straight into EVE's own market/contract/multibuy search. The name is read from the clicked
// element's own data-copy-name attribute rather than threaded through the onclick string, so
// names containing quotes/apostrophes/ampersands (already HTML-escaped by esc() when the
// attribute was written) can't break the markup or need JS-string escaping of their own.
function copyNameToClipboard(e) {
  if (!e) return;
  e.stopPropagation();
  const el = e.currentTarget;
  const name = el && el.dataset ? el.dataset.copyName : null;
  if (!name) return;
  window.copyToClipboardWithFeedback(name, el, { duration: 900 });
}
window.copyNameToClipboard = copyNameToClipboard;

// Escape closes the Blueprint Browser drawer / Paste modal (index.html only - both are absent
// elsewhere, so the element lookups below just no-op on ledger.html/invention.html). custom-
// select.js already handles Escape for its own dropdown panels independently.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const themeMenu = document.getElementById('theme-menu');
  if (themeMenu && !themeMenu.classList.contains('hidden')) {
    themeMenu.classList.add('hidden');
    return;
  }
  const drawer = document.getElementById('blueprint-browser-drawer');
  if (drawer && !drawer.classList.contains('translate-x-full')) {
    if (typeof window.closeBlueprintBrowser === 'function') window.closeBlueprintBrowser();
    return;
  }
  const pasteModal = document.getElementById('paste-modal');
  if (pasteModal && !pasteModal.classList.contains('hidden')) {
    if (typeof window.closePasteModal === 'function') window.closePasteModal();
    return;
  }
  const controlFlyout = document.getElementById('control-flyout');
  if (controlFlyout && controlFlyout.classList.contains('open')) {
    if (typeof window.closeFlyoutPanel === 'function') window.closeFlyoutPanel();
  }
});

// Shared toggle-button handler for "Deduct Stock" controls across all pages - a clear on/off button
// instead of a dropdown, but keeps the exact same id="deduct-stock-mode" + .value === 'true' pattern
// every read site already uses, since <button value="..."> supports .value identically to <select>.
// Wrapped in withRootPanAnchor when it's available (the Calculator/LP Store pages, which have a
// pan/zoom diagram to anchor) - a sidebar button, not a diagram card. Pages without a diagram (e.g.
// the Ledger) never define withRootPanAnchor, so this falls back to calling recalcFnName directly.
async function toggleDeductStockButton(btn, recalcFnName) {
  if (!btn) return;
  const newValue = btn.value === 'true' ? 'false' : 'true';
  btn.value = newValue;
  updateDeductStockButtonVisual(btn);
  if (!recalcFnName || typeof window[recalcFnName] !== 'function') return;
  if (typeof window.withRootPanAnchor === 'function') {
    await window.withRootPanAnchor(async () => { window[recalcFnName](); });
  } else {
    window[recalcFnName]();
  }
}
window.toggleDeductStockButton = toggleDeductStockButton;

function updateDeductStockButtonVisual(btn) {
  if (!btn) return;
  if (btn.value === 'true') {
    btn.innerHTML = window.svgIcon('check') + ' Deducting Stock';
    btn.className = 'btn-glass w-full px-3 py-1.5 text-xs flex items-center justify-center gap-1.5';
    btn.title = 'Materials you already own are excluded from the shopping list/multibuy below - click to show the full list instead';
  } else {
    btn.innerHTML = window.svgIcon('x') + ' Not Deducting Stock';
    btn.className = 'btn-glass btn-glass-muted w-full px-3 py-1.5 text-xs flex items-center justify-center gap-1.5';
    btn.title = 'Shopping list/multibuy below shows the FULL amount needed, even for materials you already own - click to deduct owned stock instead';
  }
}
window.updateDeductStockButtonVisual = updateDeductStockButtonVisual;

// Same toggle-button pattern as Deduct Stock above, for the "Material Pricing" (buy order vs sell
// order) control - was a plain <select id="input-price-mode">, which read like a shared/generic
// setting rather than something you'd reach for on this specific page. A dedicated button, right next
// to Deduct Stock, makes it obviously this page's own control. getNodePriceStrategy() (optimizers.js)
// and getInventionInputPrice() (invention.js) both just read #input-price-mode's .value, unaware of
// whether it's a <select> or a <button> underneath - swapping the element needed no changes there.
function toggleMaterialPricingButton(btn, recalcFnName) {
  if (!btn) return;
  const newValue = btn.value === 'sell' ? 'buy' : 'sell';
  btn.value = newValue;
  updateMaterialPricingButtonVisual(btn);
  if (recalcFnName && typeof window[recalcFnName] === 'function') window[recalcFnName]();
}
window.toggleMaterialPricingButton = toggleMaterialPricingButton;

function updateMaterialPricingButtonVisual(btn) {
  if (!btn) return;
  if (btn.value === 'buy') {
    btn.innerHTML = window.svgIcon('coin') + ' Jita Buy Order';
    btn.className = 'btn-glass btn-glass-muted w-full px-3 py-1.5 text-xs flex items-center justify-center gap-1.5';
    btn.title = 'Materials/datacores/decryptor priced at the Jita buy order price - cheaper, but not guaranteed to fill. Click to switch to sell order pricing.';
  } else {
    btn.innerHTML = window.svgIcon('coin') + ' Jita Sell (Instant Buy)';
    btn.className = 'btn-glass w-full px-3 py-1.5 text-xs flex items-center justify-center gap-1.5';
    btn.title = 'Materials/datacores/decryptor priced at the Jita sell/instant-buy price - what it actually costs to acquire them right now. Click to switch to buy order pricing.';
  }
}
window.updateMaterialPricingButtonVisual = updateMaterialPricingButtonVisual;

function safeParseJSON(str, fallback) {
  if (!str || str === 'undefined' || str === 'null') return fallback;
  try {
    const parsed = JSON.parse(str);
    return parsed !== null && parsed !== undefined ? parsed : fallback;
  } catch (e) {
    return fallback;
  }
}
window.safeParseJSON = safeParseJSON;

// How much of the raw ESI stock figure is ALREADY claimed by jobs sitting in the Ledger's own queue -
// shared here (config.js loads on every page) rather than duplicated per-page, so the Calculator's own
// "do I have enough" display and the Ledger's own job cards can never silently disagree about "how
// much do I actually still have" - the same class of bug already caught once between the Ledger's card
// display and its own Copy BOM button. Reads eve_ledger_jobs fresh from localStorage every call (not
// some other page's in-memory activeJobs array, which the Calculator never has) so this works
// correctly from any page. Returns a NEW object (never mutates rawStockMap) - the caller should treat
// this as ITS OWN starting stock pool instead of the raw ESI figure, then deplete further for whatever
// it's calculating (its own build, its own tree, etc.).
//
// Only STARTED jobs deduct here - a merely queued job hasn't actually consumed anything yet (in EVE
// or in this app), so it isn't a real claim on your stock, just a plan that could still be reordered
// or deleted. Reported directly, and discussed at length: reserving stock for something not yet
// committed to made the Calculator understate what's genuinely available while planning a second,
// unrelated build, and didn't match how the Ledger's OWN internal reconciliation already treats
// started vs. pending jobs differently (see js/ledger.js's renderJournalPage/applyJobMaterialsToStock
// - started jobs are deducted unconditionally there too; only pending ones compete for what's left, a
// distinction this function previously ignored entirely). A started job whose consumption a fresh ESI
// asset refresh has already confirmed isn't subtracted again - see getEsiAssetsExpiry (js/esi.js) and
// job.assetsExpiryAtStart (js/ledger.js) for the full reasoning; critically, that freshness signal
// lives in localStorage (shared across every tab), not a plain window.* variable, specifically so
// this function and js/ledger.js's own applyJobMaterialsToStock always reach the SAME answer for the
// same job - an earlier version that used a per-tab in-memory variable let the two pages disagree
// outright (reported directly: the Ledger showing an item as entirely missing while the Calculator
// showed almost all of it covered, for the same real stock). Deliberately re-implemented here rather
// than sharing js/ledger.js's own applyJobMaterialsToStock, since that version also returns rich
// per-job/per-material detail for rendering each job's own BOM block, which nothing outside the
// Ledger page needs; this only ever needs the final depleted pool.
function computeStockAfterLedgerClaims(rawStockMap) {
  const pool = { ...(rawStockMap || {}) };
  const jobs = safeParseJSON(localStorage.getItem('eve_ledger_jobs'), []);
  if (!Array.isArray(jobs)) return pool;
  const currentAssetsExpiry = window.getEsiAssetsExpiry ? window.getEsiAssetsExpiry() : null;

  const deductJob = (job, deductFromPool) => {
    if (!job || !Array.isArray(job.materials)) return;
    job.materials.forEach(mat => {
      if (!mat || mat.typeId === undefined) return;
      const available = pool[mat.typeId] || 0;
      const consumed = Math.min(mat.qtyNeeded || 0, available);
      if (deductFromPool && pool[mat.typeId] !== undefined) {
        pool[mat.typeId] = Math.max(0, pool[mat.typeId] - consumed);
      }
    });
  };

  jobs.filter(j => j && j.isStarted).forEach(job => {
    // Falls back to the job's own real startedAt when it has no assetsExpiryAtStart stamp at all
    // (started before this freshness feature existed) - see
    // isJobConsumptionAlreadyReflectedByFreshAssets' own comment in js/ledger.js for the full
    // reasoning, and why the alternative (refusing to ever trust fresh data for an older job) is worse.
    const baseline = (job.assetsExpiryAtStart !== undefined && job.assetsExpiryAtStart !== null)
      ? job.assetsExpiryAtStart
      : job.startedAt;
    const alreadyReflected = baseline !== undefined && baseline !== null
      && currentAssetsExpiry !== null && currentAssetsExpiry > baseline;
    deductJob(job, !alreadyReflected);
  });

  return pool;
}
window.computeStockAfterLedgerClaims = computeStockAfterLedgerClaims;

function formatDuration(seconds) {
  if (!seconds || isNaN(seconds) || seconds <= 0) return '0s';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (mins > 0) parts.push(`${mins}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
  return parts.join(' ');
}
window.formatDuration = formatDuration;

// Top-2-significant-units version of the above, for spots where full seconds-level precision on an
// ESTIMATE is more clutter than information (and can overflow a fixed-width column) - "11d 16h"
// instead of "11d 16h 49m 38s". formatDuration() itself stays untouched (its full precision matters
// for live-ticking countdowns), this is a separate, deliberately-scoped variant.
function formatDurationCompact(seconds) {
  if (!seconds || isNaN(seconds) || seconds <= 0) return '0s';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  let primary, secondary;
  if (days > 0) { primary = `${days}d`; secondary = hours > 0 ? `${hours}h` : null; }
  else if (hours > 0) { primary = `${hours}h`; secondary = mins > 0 ? `${mins}m` : null; }
  else if (mins > 0) { primary = `${mins}m`; secondary = secs > 0 ? `${secs}s` : null; }
  else { primary = `${secs}s`; secondary = null; }
  return secondary ? `${primary} ${secondary}` : primary;
}
window.formatDurationCompact = formatDurationCompact;

// Compact "23.5M ISK" style formatting for tight spaces (ledger job cards, summary tiles) - full
// precision stays available via the caller's own title/tooltip, this is display-only. Deliberately
// kept as ONE shared function used from a small, specific set of call sites (not a global find/
// replace of every .toLocaleString() + ' ISK' in the app) so it's easy to dial back later if it
// turns out to trade away more clarity than it saves in space.
function formatISKCompact(value) {
  const n = Math.round(value || 0);
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B ISK`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1)}M ISK`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K ISK`;
  return `${sign}${abs.toLocaleString()} ISK`;
}
window.formatISKCompact = formatISKCompact;

// Compact "Xm ago" / "Xh Ym ago" relative-time string - e.g. for "last synced" indicators.
function formatTimeAgo(timestampMs) {
  if (!timestampMs) return null;
  const seconds = Math.max(0, (Date.now() - timestampMs) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h ago`;
}
window.formatTimeAgo = formatTimeAgo;

// --- Selectable color themes ---
// The actual re-skinning happens purely in CSS (see css/styles.css's html[data-theme="..."] blocks)
// by swapping --accent/--accent-2/--accent-rgb and the --copper-* ramp - this list is just the menu
// content plus the localStorage/attribute bookkeeping. A tiny inline script in each page's <head>
// (not deferred) sets the data-theme attribute before first paint using the same localStorage key,
// so there's no flash of the default theme while these deferred scripts are still loading.
const COLOR_THEMES = [
  { id: 'lime', label: 'Lime', dot: '#9de137' },
  { id: 'copper', label: 'Copper', dot: '#d3915a' },
  { id: 'cyan', label: 'Cyan', dot: '#22c3d4' },
  { id: 'violet', label: 'Violet', dot: '#a374e0' }
];

function getSavedColorTheme() {
  try {
    const saved = localStorage.getItem('eve_color_theme');
    return COLOR_THEMES.some(t => t.id === saved) ? saved : 'lime';
  } catch (e) {
    return 'lime';
  }
}
window.getSavedColorTheme = getSavedColorTheme;

function applyColorTheme(themeId) {
  if (!COLOR_THEMES.some(t => t.id === themeId)) themeId = 'lime';
  if (themeId === 'lime') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', themeId);
  }
  try { localStorage.setItem('eve_color_theme', themeId); } catch (e) { console.warn('[Config] Failed to save the color theme choice - it will reset on next reload:', e); }
  document.querySelectorAll('.theme-swatch').forEach(el => {
    el.classList.toggle('is-active', el.dataset.themeId === themeId);
  });
}
window.applyColorTheme = applyColorTheme;

function renderThemeMenu() {
  const menu = document.getElementById('theme-menu');
  if (!menu) return;
  const current = getSavedColorTheme();
  menu.innerHTML = COLOR_THEMES.map(t => `
    <div class="theme-swatch${t.id === current ? ' is-active' : ''}" data-theme-id="${t.id}" onclick="applyColorTheme('${t.id}')" title="${window.esc(t.label)}">
      <span class="theme-swatch-dot" style="background:${t.dot};"></span>
      <span class="theme-swatch-label">${window.esc(t.label)}</span>
    </div>
  `).join('');
}
window.renderThemeMenu = renderThemeMenu;

function toggleThemeMenu(event) {
  if (event) event.stopPropagation();
  const menu = document.getElementById('theme-menu');
  if (!menu) return;
  if (menu.classList.contains('hidden')) {
    renderThemeMenu();
    menu.classList.remove('hidden');
  } else {
    menu.classList.add('hidden');
  }
}
window.toggleThemeMenu = toggleThemeMenu;

document.addEventListener('click', (e) => {
  const menu = document.getElementById('theme-menu');
  if (!menu || menu.classList.contains('hidden')) return;
  if (!menu.contains(e.target) && !e.target.closest('#theme-menu-btn')) {
    menu.classList.add('hidden');
  }
});

// Same toggle-panel pattern as the theme menu above (icon button + absolute-positioned panel,
// closed by an outside click) - Discord invite, in-game mail target, and ISK donation targets, all
// in one place reachable from every page's header. The character/corp NAME itself doubles as a
// showinfo: link (EVE's own real chat-link scheme, confirmed via live forum examples: character is
// type 1377, corporation is type 2, format showinfo:TYPE//ID) in case the visitor's OS has EVE's
// client registered as that protocol's handler - unconfirmed whether that actually fires reliably
// from a plain browser (one 2017 third-party dev's own account says it doesn't by default), so the
// dedicated Copy button next to it is the one guaranteed-to-work action, not this.
function toggleCommunityMenu(event) {
  if (event) event.stopPropagation();
  const menu = document.getElementById('community-menu');
  if (!menu) return;
  menu.classList.toggle('hidden');
  // The button's attention-pulse (see .community-btn-pulse, CSS) is only meant to catch a
  // first-time visitor's eye - once they've actually opened this once, it's found and doesn't need
  // to keep drawing attention every subsequent visit.
  if (!menu.classList.contains('hidden')) {
    localStorage.setItem('eve_community_menu_seen', '1');
    const btn = document.getElementById('community-menu-btn');
    if (btn) btn.classList.remove('community-btn-pulse');
  }
}
window.toggleCommunityMenu = toggleCommunityMenu;

// Stops the pulse before it ever plays for a returning visitor who's already opened this once -
// without this, every fresh page load would re-add the animation from the HTML's own static class
// list regardless of past visits.
function initCommunityMenuButton() {
  if (localStorage.getItem('eve_community_menu_seen') === '1') {
    const btn = document.getElementById('community-menu-btn');
    if (btn) btn.classList.remove('community-btn-pulse');
  }
}
window.initCommunityMenuButton = initCommunityMenuButton;
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCommunityMenuButton);
} else {
  initCommunityMenuButton();
}

document.addEventListener('click', (e) => {
  const menu = document.getElementById('community-menu');
  if (!menu || menu.classList.contains('hidden')) return;
  if (!menu.contains(e.target) && !e.target.closest('#community-menu-btn')) {
    menu.classList.add('hidden');
  }
});

window.HARDCODED_CLIENT_ID = '20e4087a1f564a3e897aaaa6daebbecd';

var IDX = {};                  
var TYPE_ID_TO_NAME = {};      
var SYSTEM_IDX = {};           
var recipeMap = {};            
var currentProduct = null;      
var recipeTreeRoot = null;      
var blueprintCache = {};        
var priceCache = {};            
var eivCache = {};              
var rawAssetItems = [];         
var userStockMap = {};          
var systemNameCache = {};       
var resolvedLocationNames = {}; 
var corpDivisionNames = {};     
var instanceCounter = 0;        
var buildSelfOverrides = {};    
var customBuyModes = {};        
var customMEOverrides = {};     
var customTEOverrides = {};     
var selectedInstanceId = null;  
var isolatedInstanceId = null;  
// Despite the name, these are keyed by node.pathKey (tree.js), not the raw instanceId - see
// nodeStableKey in app.js for why (instanceId doesn't survive a preserveView rebuild, pathKey does).
var collapsedInstanceIds = new Set(); // positions explicitly collapsed to a compact chip by the user
// Positions explicitly expanded back to full size by the user, overriding the auto-compact rule
// in renderTreeDiagram (a wide tier's siblings compact automatically past a sibling-count
// threshold, without needing an explicit click) - see toggleNodeCollapse in app.js for how a click
// picks the right one of these two sets to update based on what's actually on screen right now.
var expandedOverrideIds = new Set();
var activeMfgSCI = 0.0425;
var activeReactSCI = 0.0110;
var activeInventionSCI = 0.0200;
var zoomScale = 1.0;
var panX = 0;
var panY = 0;
var isPanning = false;
var startX = 0;
var startY = 0;

window.IDX = IDX;
window.TYPE_ID_TO_NAME = TYPE_ID_TO_NAME;
window.SYSTEM_IDX = SYSTEM_IDX;
window.recipeMap = recipeMap;
window.currentProduct = currentProduct;
window.recipeTreeRoot = recipeTreeRoot;
window.blueprintCache = blueprintCache;
window.priceCache = priceCache;
window.eivCache = eivCache;
window.rawAssetItems = rawAssetItems;
window.userStockMap = userStockMap;

// Extracts the direct material requirements for manufacturing a given node (flattening through any
// of its own build-toggled children down to what's actually bought/raw). Used both for jobs added
// from the calculator and for jobs auto-imported from real EVE industry data on the ledger page.
function extractJobMaterialsForNode(startNode) {
  const materials = [];
  const deductModeInput = document.getElementById('deduct-stock-mode');
  const isStockDeductEnabled = deductModeInput ? deductModeInput.value === 'true' : true;
  // Shared pool decremented as materials are claimed across the whole tree - checking each leaf
  // independently against the full stock amount (the previous approach) let the same physical stock
  // get counted as covering multiple different sub-components simultaneously.
  const allocatedStockPool = { ...window.userStockMap };

  function walk(node) {
    if (!node) return;
    // A sub-build boundary (same criteria collectSubBuildNodes uses) becomes its OWN separate ledger
    // job - recursing past it here would re-list its raw ingredients as if they belonged directly to
    // THIS job too, double-counting materials the separate sub-build job already accounts for on its
    // own. Treat it as a leaf: list the sub-build's own product as the material needed, stop there.
    const isSubBuildBoundary = node.depth > 0 && node.isBuildingSelf && node.children && node.children.length > 0;
    if (!node.isBuildingSelf || !node.children || node.children.length === 0 || isSubBuildBoundary) {
      const productTypeId = node.productTypeId || node.typeId;
      const strategy = window.getNodePriceStrategy ? window.getNodePriceStrategy(node) : 'sell';
      const availableStock = isStockDeductEnabled ? (allocatedStockPool[productTypeId] || allocatedStockPool[node.typeId] || 0) : 0;
      const consumedFromStock = Math.min(node.qtyNeeded, availableStock);
      if (isStockDeductEnabled && allocatedStockPool[productTypeId] !== undefined) {
        allocatedStockPool[productTypeId] = Math.max(0, allocatedStockPool[productTypeId] - consumedFromStock);
      }
      const netQtyNeeded = Math.max(0, node.qtyNeeded - consumedFromStock);
      const prices = window.priceCache[productTypeId] || { sell: 0, buy: 0 };
      // 'lp' (acquired via an LP Store redemption instead of the market - js/optimizers.js
      // calculateTreeNodeCost) falling into the sell/buy binary below used to silently price it at
      // market BUY, which is a different number from what it actually costs (isk_cost + required
      // items, not a market order) - the same recalculate() pass that ran right before this function
      // was called already priced this exact node correctly via calculateTreeNodeCost and stamped
      // the real total on node.calculatedCost, so deriving a per-unit price from that keeps this
      // consistent with the isolated canvas/BOM sidebar's own cost figure for the same component
      // instead of quietly recomputing a different, wrong one.
      const unitPrice = (strategy === 'lp' && node.qtyNeeded > 0 && typeof node.calculatedCost === 'number')
        ? node.calculatedCost / node.qtyNeeded
        : (strategy === 'sell' ? prices.sell : prices.buy);
      materials.push({
        typeId: productTypeId,
        name: node.name.replace(' Blueprint', ''),
        qtyNeeded: node.qtyNeeded,
        stockQty: consumedFromStock,
        netQtyNeeded: netQtyNeeded,
        strategy: strategy,
        unitPrice: unitPrice,
        lineCost: unitPrice * netQtyNeeded
      });
    } else {
      node.children.forEach(child => { if (child) walk(child); });
    }
  }

  if (startNode.isBuildingSelf && startNode.children && startNode.children.length > 0) {
    startNode.children.forEach(child => { if (child) walk(child); });
  } else {
    walk(startNode);
  }
  return materials;
}
window.extractJobMaterialsForNode = extractJobMaterialsForNode;

// Strictly queries exact unreduced SDE manufacturing durations directly from SDE database
function extractBuildTime(recipe) {
  if (!recipe) return 0;
  return parseInt(recipe.time || recipe.t || recipe.timeSeconds || recipe.duration || recipe.mfgTime || recipe.productionTime || 0);
}
window.extractBuildTime = extractBuildTime;

// Applies TE research, character skills (Industry/Advanced Industry), the selected facility's time
// bonus, and a manufacturing implant to a single job's raw SDE duration. Reactions can't be
// TE-researched, so TE is ignored for them. Shared by the per-card time display, the total-tree time
// summary, the ledger, and the invention calculator - the invention calculator reuses this same
// function with isReaction=true for its OWN (non-manufacturing) invention time, which is why the
// implant factor below is gated the same way TE already is: no Beancounter implant in EVE reduces
// invention time, only manufacturing time, so it must never apply to that call.
const MANUFACTURING_IMPLANT_BONUS_KEY = 'eve_mfg_implant_bonus_pct';
function getManufacturingImplantBonusPercent() {
  return parseFloat(localStorage.getItem(MANUFACTURING_IMPLANT_BONUS_KEY)) || 0;
}
window.getManufacturingImplantBonusPercent = getManufacturingImplantBonusPercent;

function saveManufacturingImplantSetting(value) {
  localStorage.setItem(MANUFACTURING_IMPLANT_BONUS_KEY, value || '0');
}
window.saveManufacturingImplantSetting = saveManufacturingImplantSetting;

// Restores a page's own <select id="mfg-implant-select"> to the shared saved value on load - the
// setting itself lives in one localStorage key read fresh by calculateAdjustedJobSeconds, same as
// eve_char_skills, so every page's copy of the control always agrees.
function restoreManufacturingImplantSetting(selectId) {
  const el = document.getElementById(selectId);
  if (!el) return;
  el.value = String(getManufacturingImplantBonusPercent());
}
window.restoreManufacturingImplantSetting = restoreManufacturingImplantSetting;

const _loggedSkillDiagnosticIds = new Set();
function logSkillDiagnosticOnce(typeId, message) {
  const key = `${typeId}`;
  if (_loggedSkillDiagnosticIds.has(key)) return;
  _loggedSkillDiagnosticIds.add(key);
  console.info(message);
}

// Reactions type ID (localized/renamed nowhere - it's a fixed skill in the SDE): the ONLY skill
// that affects reaction time (4% reduction per level, confirmed against EVE University's wiki and
// EVE Ref's mirror of the in-game skill description). Industry/Advanced Industry are
// manufacturing-only skills and have no effect on reactions - a real bug here previously (this
// function applied both to every job, reactions included, with reactions only picking up any
// skill-based reduction at all by accident, via whatever happened to be listed in that specific
// formula's requiredSkills, at the wrong 1%/level rate meant for unrelated required-skill bonuses).
const REACTIONS_SKILL_ID = 45746;
window.REACTIONS_SKILL_ID = REACTIONS_SKILL_ID;

// Single shared read of the trained skill sheet - every real read site (build-time math here, the
// Missing Required Skills check, the ME/TE hover tooltip) goes through this instead of its own
// separate localStorage.getItem('eve_char_skills') call, so the "Simulate All to 5" toggle
// (js/app.js) only has to be taught to ONE place, not kept in sync across several. When armed, every
// lookup into allSkills - including one for a skill that was never trained at all - returns at least
// 5 via a Proxy, since simulating "what if every needed skill were trained to V" is the whole point;
// a skill genuinely already above 5 is impossible (5 is the real in-game cap), so max(real, 5) can
// never under-report anything real, only stand in for what isn't trained yet.
function getEffectiveCharSkills() {
  const raw = window.safeParseJSON(localStorage.getItem('eve_char_skills'), { industry: 5, advIndustry: 5, allSkills: { [REACTIONS_SKILL_ID]: 5 } });
  if (!window.simulateSkillsToFive) return raw;
  return {
    industry: Math.max(raw.industry || 0, 5),
    advIndustry: Math.max(raw.advIndustry || 0, 5),
    allSkills: new Proxy(raw.allSkills || {}, {
      get(target, prop) {
        if (typeof prop !== 'string' && typeof prop !== 'number') return target[prop];
        return Math.max(target[prop] || 0, 5);
      }
    })
  };
}
window.getEffectiveCharSkills = getEffectiveCharSkills;

function calculateAdjustedJobSeconds(baseTimeSeconds, customTE, runsNeeded, isReaction, productTypeId, requiredSkills, isInvention) {
  if (!baseTimeSeconds || baseTimeSeconds <= 0) return 0;
  const skills = getEffectiveCharSkills();

  // The isReaction PARAMETER also gets passed true by invention.js purely to reuse this
  // function's "skip TE-research" behavior below - invention isn't actually a reaction, and its
  // own time is genuinely reduced by Industry/Advanced Industry, not the Reactions skill. So which
  // skill applies can't just trust that parameter - it re-derives real reaction status from the
  // product's own recipe data instead, which invention's product (always a manufactured item)
  // never has a reactionMaterials list for.
  const recipeForSkillCheck = window.recipeMap && window.recipeMap[productTypeId];
  const isActualReaction = !!(recipeForSkillCheck && recipeForSkillCheck.reactionMaterials && recipeForSkillCheck.reactionMaterials.length > 0);

  let skillTimeFactor;
  if (isActualReaction) {
    const reactionsLevel = (skills.allSkills && skills.allSkills[REACTIONS_SKILL_ID]) || 0;
    skillTimeFactor = 1 - (0.04 * reactionsLevel);
    logSkillDiagnosticOnce(productTypeId, `[BuildTime/Skills] Item ${productTypeId} (reaction): Reactions skill level ${reactionsLevel}, factor: ${skillTimeFactor.toFixed(4)}. Industry/Advanced Industry do not apply to reactions.`);
  } else {
    const indFactor = 1 - (0.04 * (skills.industry || 0));
    const advIndFactor = 1 - (0.03 * (skills.advIndustry || 0));

    let requiredSkillFactor = 1.0;
    if (Array.isArray(requiredSkills) && requiredSkills.length > 0) {
      if (!skills.allSkills) {
        logSkillDiagnosticOnce(productTypeId, `[BuildTime/Skills] Item ${productTypeId} requires skills but no full skill sheet is loaded (skills.allSkills missing) - log in via ESI SSO to fetch your trained skill levels, otherwise these bonuses stay at 0.`);
      } else {
        requiredSkills.forEach(reqSkill => {
          const playerLevel = skills.allSkills[reqSkill.skillId] || 0;
          requiredSkillFactor *= (1 - (0.01 * playerLevel));
        });
        logSkillDiagnosticOnce(productTypeId, `[BuildTime/Skills] Item ${productTypeId}: required skills ${JSON.stringify(requiredSkills)}, your trained levels: ${requiredSkills.map(s => `${s.skillId}=${skills.allSkills[s.skillId] || 0}`).join(', ')}, combined factor: ${requiredSkillFactor.toFixed(4)}`);
      }
    } else if (requiredSkills !== undefined) {
      logSkillDiagnosticOnce(productTypeId, `[BuildTime/Skills] Item ${productTypeId}: recipe has no requiredSkills data (empty array) - either this item genuinely needs none, or your local database predates this feature and needs regenerating (generate_db.py).`);
    }

    skillTimeFactor = indFactor * advIndFactor * requiredSkillFactor;
  }

  const te = isReaction ? 0 : (customTE || 0);
  const teFactor = 1 - (te / 100);
  const structureType = window.getActiveStructureType ? window.getActiveStructureType() : { teBonus: 30.0 };
  const facilityFactor = 1 - (structureType.teBonus / 100);
  // Invention isn't manufacturing, so a "Advanced Small Ship Manufacturing Time Efficiency" rig
  // matching the invented item's own category has no business speeding it up - only a real
  // Invention Accelerator/Optimization/Laboratory Optimization rig should (see
  // getEffectiveInventionRigBonus, above). Before isInvention existed, this unconditionally called
  // the manufacturing lookup for every isReaction=true call including invention.js's own, which
  // silently applied whatever manufacturing rig happened to match the T2 product's category instead
  // of the real invention rig bonus - wrong bonus, and the real one was never searchable at all
  // (parseRigName excluded it) to even be wrong in a way anyone could fix by refitting.
  const rigTEBonus = isInvention
    ? (window.getEffectiveInventionRigBonus ? window.getEffectiveInventionRigBonus('time') : 0)
    : (window.getEffectiveRigBonusForTypeId ? window.getEffectiveRigBonusForTypeId(productTypeId, 'TE') : 0);
  const rigFactor = 1 - (rigTEBonus / 100);
  const implantFactor = isReaction ? 1 : (1 - (getManufacturingImplantBonusPercent() / 100));
  return baseTimeSeconds * teFactor * skillTimeFactor * facilityFactor * rigFactor * implantFactor * (runsNeeded || 1);
}
window.calculateAdjustedJobSeconds = calculateAdjustedJobSeconds;

// Recursively sums the adjusted build time across every job actually being manufactured in the tree.
function calculateTotalBuildSeconds(node) {
  if (!node || !node.isBuildingSelf) return 0;
  let total = 0;
  if (node.recipe) {
    total += calculateAdjustedJobSeconds(extractBuildTime(node.recipe), node.customTE, node.runsNeeded, node.isReaction, node.productTypeId, node.recipe.requiredSkills);
  }
  if (node.children) {
    node.children.forEach(child => { if (child) total += calculateTotalBuildSeconds(child); });
  }
  return total;
}
window.calculateTotalBuildSeconds = calculateTotalBuildSeconds;

window.systemNameCache = systemNameCache;
window.resolvedLocationNames = resolvedLocationNames;
window.corpDivisionNames = corpDivisionNames;
window.instanceCounter = instanceCounter;
window.buildSelfOverrides = buildSelfOverrides;
window.customBuyModes = customBuyModes;
window.customMEOverrides = customMEOverrides;
window.customTEOverrides = customTEOverrides;
window.selectedInstanceId = selectedInstanceId;
window.isolatedInstanceId = isolatedInstanceId;
window.collapsedInstanceIds = collapsedInstanceIds;
window.expandedOverrideIds = expandedOverrideIds;
window.activeMfgSCI = activeMfgSCI;
window.activeReactSCI = activeReactSCI;
window.activeInventionSCI = activeInventionSCI;
window.zoomScale = zoomScale;
window.panX = panX;
window.panY = panY;
window.isPanning = isPanning;
window.startX = startX;
window.startY = startY;

window.BLUEPRINT_TO_PRODUCT_MAP = {
  57523: 57486, 
  57515: 57478, 
  57516: 57479, 
  17714: 17715  
};

const RAW_BASE_MATERIALS = new Set([
  34, 35, 36, 37, 38, 39, 40, 11399, 
  16274, 16275, 17887, 17888,        
  16272, 16273,                      
  3689, 3683, 9848,                  
  2267, 2268, 2270, 2272, 2305       
]);
window.RAW_BASE_MATERIALS = RAW_BASE_MATERIALS;

const POPULAR_ITEMS = [
  { id: 48519, bpId: 49715, name: "Drekavac" },
  { id: 47271, bpId: 47968, name: "Leshak" },
  { id: 621,   bpId: 622,   name: "Caracal" },
  { id: 12005, bpId: 12006, name: "Ishtar" },
  { id: 587,   bpId: 588,   name: "Rifter" },
  { id: 24698, bpId: 24699, name: "Drake" },
  { id: 644,   bpId: 645,   name: "Raven" },
  { id: 642,   bpId: 643,   name: "Megathron" },
  { id: 643,   bpId: 644,   name: "Abaddon" },
  { id: 12015, bpId: 12016, name: "Dominix" },
  { id: 11987, bpId: 11988, name: "Cerberus" },
  { id: 11989, bpId: 11990, name: "Eagle" },
  { id: 4247,  bpId: 4248,  name: "Hydrogen Fuel Block" },
  { id: 4246,  bpId: 4248,  name: "Helium Fuel Block" },
  { id: 16681, bpId: 17730, name: "Tungsten Carbide" },
  { id: 34,    name: "Tritanium" },
  { id: 35,    name: "Pyerite" },
  { id: 36,    name: "Mexallon" },
  { id: 37,    name: "Isogen" },
  { id: 38,    name: "Nocxium" },
  { id: 39,    name: "Zydrine" },
  { id: 40,    name: "Megacyte" }
];
window.POPULAR_ITEMS = POPULAR_ITEMS;

// --- Tracked Markets (for the multi-market Compare Markets feature) ---
// Default hub NAMES only, not hardcoded station/region IDs - those get resolved via ESI at runtime
// (resolveStationByName + resolveStationRegion in esi.js) and cached, rather than trusting guessed
// numeric IDs the way the earlier ship-group-id mistake did.
const DEFAULT_TRADE_HUB_NAMES = [
  'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
  'Amarr VIII (Oris) - Emperor Family Academy',
  'Dodixie IX - Moon 20 - Federation Navy Assembly Plant',
  'Rens VI - Moon 8 - Brutor Tribe Treasury',
  'Hek VIII - Moon 12 - Boundless Creation Factory'
];

function getTrackedMarkets() {
  try {
    const saved = localStorage.getItem('eve_tracked_markets');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) { console.warn('[Config] Failed to load saved tracked markets - falling back to the default list:', e); }
  return [];
}
window.getTrackedMarkets = getTrackedMarkets;

function saveTrackedMarkets(markets) {
  localStorage.setItem('eve_tracked_markets', JSON.stringify(markets));
}
window.saveTrackedMarkets = saveTrackedMarkets;

function addTrackedMarket(market) {
  const markets = getTrackedMarkets();
  if (markets.some(m => m.stationId === market.stationId)) return; // already tracked
  markets.push(market);
  saveTrackedMarkets(markets);
}
window.addTrackedMarket = addTrackedMarket;

function removeTrackedMarket(stationId) {
  const markets = getTrackedMarkets().filter(m => m.stationId !== stationId);
  saveTrackedMarkets(markets);
}
window.removeTrackedMarket = removeTrackedMarket;

// One-time setup: resolves the 5 default hub names to real station/region IDs via ESI and seeds the
// tracked markets list, if it's empty (first run, or a fresh browser profile).
async function ensureDefaultTrackedMarkets() {
  if (getTrackedMarkets().length > 0) return; // already seeded
  const resolved = [];
  for (const name of DEFAULT_TRADE_HUB_NAMES) {
    try {
      const station = await window.resolveStationByName(name);
      if (!station) continue;
      const regionInfo = await window.resolveStationRegion(station.stationId);
      resolved.push({
        stationId: station.stationId,
        stationName: station.stationName,
        regionId: regionInfo ? regionInfo.regionId : null,
        systemId: regionInfo ? regionInfo.systemId : null
      });
    } catch (e) {
      console.warn(`Failed to resolve default hub "${name}":`, e);
    }
  }
  if (resolved.length > 0) saveTrackedMarkets(resolved);
}
window.ensureDefaultTrackedMarkets = ensureDefaultTrackedMarkets;

// --- Unified Structure Type System ---
// A station/structure is ONE thing - it can't simultaneously be "Raitaru" in one dropdown and
// "Sotiyo" in another. This table is the single source of truth for every bonus a structure type
// grants (ME, TE, and job-fee/cost reduction), replacing what used to be two separate, and therefore
// occasionally self-contradictory, dropdowns.
// Numbers confirmed via CCP's official "Building Dreams: Introducing Engineering Complexes" dev blog:
// Raitaru: 1% ME / 15% TE (cost bonus not directly quoted in that source - 3% is inferred from the
// clear ascending progression 3/4/5 that matches the 15/20/30 TE progression, not independently
// confirmed the way Azbel/Sotiyo's cost bonus is). Azbel: 1% ME / 20% TE / 4% cost (confirmed).
// Sotiyo: 1% ME / 30% TE / 5% cost (confirmed). NOTE: this corrects a bug in this app's own prior
// dropdown, which had listed Sotiyo's fee bonus as -3% instead of the correct -5%.
// Athanor/Tatara are Refineries, not Engineering Complexes - they run reactions (and reprocessing),
// not manufacturing, so their meBonus is 0.0 (a Refinery's base structure bonus grants no material
// efficiency at all; reaction ME only ever comes from a fitted rig, never the structure itself -
// see getEffectiveRigBonusForTypeId). Their TE/cost progression mirrors the EC line one tier down
// (Refineries only come in M/L, there's no XL refinery): Athanor 20% TE / 3% cost like Raitaru,
// Tatara 30% TE / 5% cost like Sotiyo.
// rigSize is the real in-game rig slot size for each structure (null for NPC stations, which have
// no rig slots at all) - a structure can only physically fit rigs of its own exact size class, no
// cross-compatibility, which is what lets the rig search (searchRigSlot, app.js) and the effective-
// bonus calculators (getEffectiveRigBonusForTypeId/getEffectiveInventionRigBonus, below) both filter
// out rigs that could never actually be fitted to whatever's currently selected.
const STRUCTURE_TYPES = {
  npc:     { label: 'NPC Station',        shortLabel: 'NPC Station', meBonus: 0.0, teBonus: 0.0,  costBonus: 0.0, rigSize: null },
  raitaru: { label: 'Raitaru (M Engineering Complex)', shortLabel: 'Raitaru', meBonus: 1.0, teBonus: 15.0, costBonus: 3.0, rigSize: 'M' },
  azbel:   { label: 'Azbel (L Engineering Complex)',   shortLabel: 'Azbel',   meBonus: 1.0, teBonus: 20.0, costBonus: 4.0, rigSize: 'L' },
  sotiyo:  { label: 'Sotiyo (XL Engineering Complex)', shortLabel: 'Sotiyo',  meBonus: 1.0, teBonus: 30.0, costBonus: 5.0, rigSize: 'XL' },
  athanor: { label: 'Athanor (M Refinery)',  shortLabel: 'Athanor', meBonus: 0.0, teBonus: 20.0, costBonus: 3.0, rigSize: 'M' },
  tatara:  { label: 'Tatara (L Refinery)',   shortLabel: 'Tatara',  meBonus: 0.0, teBonus: 30.0, costBonus: 5.0, rigSize: 'L' }
};
window.STRUCTURE_TYPES = STRUCTURE_TYPES;

// The single canonical read of "what structure am I in" - everything (ME calc, TE calc, job fee calc)
// should call this instead of reading separate DOM elements or maintaining its own copy of the numbers.
function getActiveStructureType() {
  const key = localStorage.getItem('eve_active_facility_key') || 'sotiyo';
  return STRUCTURE_TYPES[key] || STRUCTURE_TYPES.npc;
}
window.getActiveStructureType = getActiveStructureType;

// The single canonical read of the 4 tax/fee input fields (Facility/SCC/Sales/Broker), same idea as
// getActiveStructureType() above - already divided by 100 into fraction form (0.01 = 1%), same
// defaults every call site already agreed on. This exact set of expressions used to be copy-pasted
// verbatim across app.js, optimizers.js, and invention.js (18+ near-identical occurrences) - precisely
// the kind of duplication that already caused two real profit-formula bugs in this app (one page
// computing a fee correctly, a sibling silently missing it). One reader, one place to fix from now on.
function getActiveFeeInputs() {
  return {
    facilityTax: (parseFloat(document.getElementById('facility-tax')?.value) || 1.0) / 100,
    sccSurcharge: (parseFloat(document.getElementById('scc-surcharge')?.value) || 4.0) / 100,
    salesTax: (parseFloat(document.getElementById('sales-tax')?.value) || 3.6) / 100,
    brokerFee: (parseFloat(document.getElementById('broker-fee')?.value) || 1.0) / 100
  };
}
window.getActiveFeeInputs = getActiveFeeInputs;


// Real rig items are discovered directly from the generated database (window.EVE_ITEMS +
// window.EVE_GROUP_NAMES), not hand-typed - there are dozens of distinct rigs (per size tier, per
// ship-size class, per tech tier), and a fixed 5-bucket list can't represent that. A rig only affects
// the specific category/size class named in its own item name (e.g. "Small Ship" rigs don't help a
// Battleship), which we determine by parsing that name.

// ME base %: confirmed via EVE Online forums (Tier I = 2%, Tier II = 2.4%, before security multiplier).
// TE base %: NOT independently confirmed - estimated using the same Tier I->II scaling ratio (1.2x) as
// the confirmed ME figures. If your in-game rig shows a different %, this is the number to correct.
const RIG_ME_BASE = { T1: 2.0, T2: 2.4 };
const RIG_TE_BASE = { T1: 20.0, T2: 24.0 };

// Security bonus multipliers - confirmed via EVE Ref dogma attributes (High Security / Low Security /
// Nullsec and Wormhole Bonus Multiplier): highsec x1.0, lowsec x1.9, null/WH x2.1.
function getSecurityMultiplier() {
  const sec = window.activeSystemSecurity;
  if (sec === undefined || sec === null) return 1.0; // unknown system - assume highsec (safe default)
  if (sec >= 0.45) return 1.0;
  if (sec > 0.0) return 1.9;
  return 2.1;
}
window.getSecurityMultiplier = getSecurityMultiplier;

// Parses a real Standup rig item name into structured data. Rig names follow a very consistent EVE
// naming convention: "Standup {M|L|XL}-Set [Basic|Advanced ]{category} [Manufacturing ][Material|Time ]Efficiency {I|II}".
// Returns null for anything that isn't a manufacturing/reaction efficiency rig - Invention/Research/
// Blueprint Copy rigs end in "Optimization"/"Accelerator" rather than "Efficiency" and follow a
// completely different naming grammar, so they're parsed separately by parseResearchRigName below
// (getRigItemCatalog tries both and merges the results into one searchable list).
function parseRigName(rawName) {
  if (!rawName) return null;
  const sizeMatch = rawName.match(/^Standup (M|L|XL)-Set (.+)$/);
  if (!sizeMatch) return null;
  const size = sizeMatch[1];
  let rest = sizeMatch[2];

  const tierMatch = rest.match(/ (I{1,2})$/);
  if (!tierMatch) return null;
  const tier = tierMatch[1] === 'II' ? 'T2' : 'T1';
  rest = rest.slice(0, -tierMatch[0].length);

  if (!/ Efficiency$/.test(rest)) return null; // excludes Optimization (Invention/Copy) and other non-Efficiency rigs
  rest = rest.slice(0, -' Efficiency'.length);

  let bonusType = 'BOTH'; // L/XL-tier rigs typically grant combined ME+TE in one item
  if (/ Material$/.test(rest)) { bonusType = 'ME'; rest = rest.slice(0, -' Material'.length); }
  else if (/ Time$/.test(rest)) { bonusType = 'TE'; rest = rest.slice(0, -' Time'.length); }

  if (/ Manufacturing$/.test(rest)) rest = rest.slice(0, -' Manufacturing'.length);

  let spec = null; // Basic = affects T1 items, Advanced = affects T2/T3 - see disclosed limitation below
  if (/^Basic /.test(rest)) { spec = 'Basic'; rest = rest.slice('Basic '.length); }
  else if (/^Advanced /.test(rest)) { spec = 'Advanced'; rest = rest.slice('Advanced '.length); }

  const categoryLabel = rest.trim();
  if (!categoryLabel) return null;
  return { size, tier, bonusType, spec, categoryLabel };
}
window.parseRigName = parseRigName;

// The OTHER real rig naming grammar - R&D-job rigs (Invention, Blueprint ME/TE Research, Blueprint
// Copy), which reduce a job's TIME and/or ISK COST rather than a manufacturing job's material/time
// need. Confirmed via EVE Ref dogma attributes (Standup M-Set Invention Accelerator I/II: Time
// Reduction Bonus -20%/-24%; Standup M-Set Invention Cost Optimization I/II: Cost Reduction Bonus
// -10%/-12%; same security multipliers as manufacturing rigs). Grammar:
//   M-tier: "Standup M-Set {category} {Accelerator|Cost Optimization} {I|II}" - time and cost split
//     into separate items, same as M-tier Manufacturing Efficiency rigs split Material/Time.
//   L-tier: "Standup L-Set {category} Optimization {I|II}" - one item combining both time AND cost
//     for its own single category (confirmed via EVE Ref: L-Set Invention Optimization I carries
//     BOTH a -20% Time Reduction Bonus and a -10% Cost Reduction Bonus).
//   XL-tier: "Standup XL-Set Laboratory Optimization {I|II}" - one item combining both time and cost
//     across EVERY research category at once (confirmed via EVE Ref: same -24%/-12% as the L-tier
//     rigs' own T2 values) - there's no per-category split at this tier, mirroring how XL-tier
//     Manufacturing Efficiency rigs also stop splitting by ship size.
// No success-chance bonus exists on any of these (confirmed absent from every dogma attribute page
// checked) - only skills and decryptors affect invention's success chance in real EVE.
function parseResearchRigName(rawName) {
  if (!rawName) return null;
  const sizeMatch = rawName.match(/^Standup (M|L|XL)-Set (.+)$/);
  if (!sizeMatch) return null;
  const size = sizeMatch[1];
  let rest = sizeMatch[2];

  const tierMatch = rest.match(/ (I{1,2})$/);
  if (!tierMatch) return null;
  const tier = tierMatch[1] === 'II' ? 'T2' : 'T1';
  rest = rest.slice(0, -tierMatch[0].length);

  if (rest === 'Laboratory Optimization') {
    return { size, tier, effect: 'BOTH', categories: ['invention', 'meResearch', 'teResearch', 'copy'] };
  }

  let category = null;
  if (/^Invention /.test(rest)) { category = 'invention'; rest = rest.slice('Invention '.length); }
  else if (/^ME Research /.test(rest)) { category = 'meResearch'; rest = rest.slice('ME Research '.length); }
  else if (/^TE Research /.test(rest)) { category = 'teResearch'; rest = rest.slice('TE Research '.length); }
  else if (/^Blueprint Copy /.test(rest)) { category = 'copy'; rest = rest.slice('Blueprint Copy '.length); }
  else return null;

  let effect;
  if (rest === 'Accelerator') effect = 'time';
  else if (rest === 'Cost Optimization') effect = 'cost';
  else if (rest === 'Optimization') effect = 'BOTH';
  else return null;

  return { size, tier, effect, categories: [category] };
}
window.parseResearchRigName = parseResearchRigName;

// A THIRD, irregular rig family - 5 limited "Thukker" edition component/structure rigs, found via a
// full audit of every "Structure Engineering Rig"/"Reactor Rig" item against both parsers above. They
// don't follow either naming grammar (no I/II tier suffix at all - single-tier items), so they're
// listed explicitly rather than pattern-matched. Confirmed via EVE Ref dogma attributes: each carries
// its normal ME/TE bonus PLUS a separate, larger "Thukker Enhanced Capital Component Material
// Reduction Bonus" (always -3.7%) that only applies to capital construction components specifically,
// and - unlike every other rig here - a security-space curve that FAVORS lowsec (0.1x high, 1.9x low,
// 0.1x null/WH) instead of the usual high/low/null-WH progression. That inverted curve and the split
// base/capital bonus don't fit this app's existing bonus-application model (doesFitRigMatchProduct's
// category matching assumes the standard curve), so these are made searchable/selectable with an
// accurate tooltip but deliberately NOT wired into any bonus calculation - same precedent as the
// research-rig categories this app has no job calculator for yet.
const THUKKER_RIG_DATA = {
  'Standup M-Set Thukker Basic Capital Component Manufacturing Material Efficiency': { size: 'M', me: 0, te: 0, capME: 3.7, scope: 'Basic Capital Construction Components' },
  'Standup L-Set Thukker Basic Capital Component Manufacturing Efficiency': { size: 'L', me: 0, te: 20, capME: 3.7, scope: 'Basic Capital Construction Components' },
  'Standup M-Set Thukker Advanced Component Manufacturing Material Efficiency': { size: 'M', me: 2, te: 0, capME: 3.7, scope: 'Advanced Components (and Capital Construction Components)' },
  'Standup L-Set Thukker Advanced Component Manufacturing Efficiency': { size: 'L', me: 2, te: 20, capME: 3.7, scope: 'Advanced Components (and Capital Construction Components)' },
  'Standup XL-Set Thukker Structure and Component Manufacturing Efficiency': { size: 'XL', me: 2, te: 20, capME: 3.7, scope: 'Structures and Components' }
};
function parseThukkerRigName(rawName) {
  const data = THUKKER_RIG_DATA[rawName];
  if (!data) return null;
  return { size: data.size, tier: 'T1', me: data.me, te: data.te, capME: data.capME, scope: data.scope };
}
window.parseThukkerRigName = parseThukkerRigName;

// Real affected-groups lists per ship-tier rig (small/medium/large x basic/advanced), confirmed via
// EVE Ref dogma attributes on one M/L-tier typeId per tier. This REPLACES an earlier heuristic
// (guessing size/tech-class from keywords in the group name) that a full audit found genuinely wrong
// in several real, buildable cases: it classified "Command Ship" (Eos, Vulture, Sleipnir) as large
// when the real rig for it is Advanced MEDIUM Ship; it classified "Industrial Command Ship" (Orca,
// Porpoise) as Advanced tech class when the real rig for it is BASIC Large Ship; and it matched
// Titan/Supercarrier hulls (Erebus, Avatar, Hel, Revenant) against "Large Ship (Advanced)" even
// though neither appears in ANY Standup ship rig's real affected-groups list - supercapitals simply
// aren't covered by rig bonuses the same way smaller capitals are. "Expedition Command Ship" (the
// Odysseus) genuinely appears in both the Basic and Advanced Medium Ship lists on EVE Ref, so it's
// included in both here rather than picked arbitrarily.
const SHIP_RIG_GROUPS = {
  'small|basic': new Set(['Frigate', 'Shuttle', 'Destroyer']),
  'small|advanced': new Set(['Assault Frigate', 'Interdictor', 'Covert Ops', 'Interceptor', 'Stealth Bomber', 'Electronic Attack Ship', 'Expedition Frigate', 'Tactical Destroyer', 'Logistics Frigate', 'Command Destroyer']),
  'medium|basic': new Set(['Cruiser', 'Hauler', 'Combat Battlecruiser', 'Mining Barge', 'Attack Battlecruiser', 'Expedition Command Ship', 'Special Edition Yachts']),
  'medium|advanced': new Set(['Heavy Assault Cruiser', 'Deep Space Transport', 'Command Ship', 'Exhumer', 'Logistics', 'Force Recon Ship', 'Heavy Interdiction Cruiser', 'Combat Recon Ship', 'Strategic Cruiser', 'Blockade Runner', 'Flag Cruiser', 'Expedition Command Ship']),
  'large|basic': new Set(['Battleship', 'Freighter', 'Industrial Command Ship']),
  'large|advanced': new Set(['Black Ops', 'Marauder', 'Jump Freighter'])
};

// Real affected-groups lists for every manufacturing rig family, confirmed via EVE Ref dogma
// attributes on at least one M/L-tier item per family (identical group list at every size for a
// given family - only the base % differs by I/II tier). A full audit (every distinct categoryLabel
// parseRigName can produce, cross-checked against real game data) found several families beyond
// Component/Structure that were also wrong - some silently matching NOTHING at all.
// "Component" (plain Advanced Component M/L-tier rigs, e.g. typeId 43866/37175): notably does NOT
// include the plain "Capital Construction Components" group (Capital Armor Plates, Capital
// Construction Parts, etc.) - only "Advanced Capital Construction Components" (Capital Fusion
// Thruster, Capital Nanoelectrical Microprocessor, etc.), a distinct, earlier tier in the real
// capital build chain. That other, plain capital tier belongs to the SEPARATE "Capital Component"
// (Basic-only) rig family below instead - they are not interchangeable despite the similar names.
const COMPONENT_RIG_GROUPS = new Set(['Tool', 'Construction Components', 'Data Interfaces', 'Advanced Capital Construction Components', 'Hybrid Tech Components']);
// "Capital Component" (Basic-only, L-tier, e.g. typeId 43719/43721 - no plain/Advanced M-tier
// variant exists for this one). Previously fell into the same bucket as plain "Component" above via
// a loose `label.includes('component')` check, which was wrong - this family has its own, much
// narrower single-group scope confirmed via EVE Ref.
const CAPITAL_COMPONENT_RIG_GROUPS = new Set(['Capital Construction Components']);
// "Structure" (M/L-tier rigs, e.g. typeId 43874/43721): also affects the Upwell structure-hull and
// structure-module categories themselves (catId 65/66). EVE Ref also lists Starbase/Infrastructure
// Upgrades/Sovereignty Structures as affected categories, but nothing in this app's recipe data is
// buildable under those (legacy POS/sov mechanics) - left out rather than guessing their category
// IDs, matching this app's rule against guessing unverified EVE numbers.
const STRUCTURE_RIG_GROUPS = new Set(['Structure Components', 'Fuel Block', 'Skyhook']);
// "Capital Ship" (L-tier only, e.g. typeId 37172) - previously matched NOTHING: it falls into the
// general ship branch via `label.includes('ship')`, but has no Basic/Advanced spec and isn't
// small/medium/large, so it fell through every check there to a bare `return false`. Confirmed via
// EVE Ref: matches these specific ship groups, not a size/tech-class heuristic like the other tiers.
const CAPITAL_SHIP_RIG_GROUPS = new Set(['Dreadnought', 'Carrier', 'Capital Industrial Ship', 'Force Auxiliary', 'Lancer Dreadnought', 'Command Carrier']);
// "Equipment" (plain, M/L-tier) and "Equipment and Consumable" (XL-tier, broader) both also cover
// these 4 real container groups (catId 2, not 7/20/22) - previously missed entirely since the old
// check was catId-only.
const EQUIPMENT_RIG_CONTAINER_GROUPS = new Set(['Cargo Container', 'Secure Cargo Container', 'Audit Log Secure Container', 'Freight Container']);

// Checks whether a parsed rig actually affects a given product, based on real category/group data.
function doesRigMatchProduct(parsed, typeId) {
  const catId = window.EVE_CATEGORIES ? window.EVE_CATEGORIES[typeId] : undefined;
  const label = parsed.categoryLabel.toLowerCase();
  if (label === 'ship' || label.includes('ship')) {
    // The bare XL-tier "Ship" rig alone also covers Subsystem (catId 32) manufacturing - T3
    // Strategic Cruiser subsystems - confirmed via EVE Ref ("Affected Categories: Ship, Subsystem").
    // Every other ship-family rig (Capital/Small/Medium/Large, Basic or Advanced) is Ship-only.
    if (label === 'ship' && catId === 32) return true;
    if (label === 'capital ship') {
      if (catId !== 6) return false;
      return CAPITAL_SHIP_RIG_GROUPS.has(window.EVE_GROUP_NAMES ? window.EVE_GROUP_NAMES[typeId] : null);
    }
    if (catId !== 6) return false;
    if (label === 'ship') return true; // sizeless XL-tier rig - any ship, no size/tier split
    const groupName = window.EVE_GROUP_NAMES ? window.EVE_GROUP_NAMES[typeId] : null;
    const sizeKey = label.includes('small') ? 'small' : label.includes('medium') ? 'medium' : label.includes('large') ? 'large' : null;
    if (!sizeKey || !parsed.spec) return false;
    const groups = SHIP_RIG_GROUPS[`${sizeKey}|${parsed.spec.toLowerCase()}`];
    return groups ? groups.has(groupName) : false;
  }
  if (label === 'ammunition') return catId === 8;
  if (label.includes('drone') || label.includes('fighter')) return catId === 18 || catId === 87;
  if (label === 'equipment' || label === 'equipment and consumable') {
    const groupName = window.EVE_GROUP_NAMES ? window.EVE_GROUP_NAMES[typeId] : null;
    if (EQUIPMENT_RIG_CONTAINER_GROUPS.has(groupName)) return true;
    // Module(7)/Implant(20)/Deployable(22) for the plain rig - the old catId===66 here was simply
    // wrong (66 is Structure Module, unrelated to this family) and real Implant/Deployable coverage
    // was missing entirely. The XL "...and Consumable" rig adds Charge(8)/Drone(18)/Fighter(87) on
    // top, confirmed via its own, broader EVE Ref affected-categories list.
    if (label === 'equipment') return catId === 7 || catId === 20 || catId === 22;
    return catId === 7 || catId === 8 || catId === 18 || catId === 20 || catId === 22 || catId === 87;
  }
  if (label === 'capital component') {
    return CAPITAL_COMPONENT_RIG_GROUPS.has(window.EVE_GROUP_NAMES ? window.EVE_GROUP_NAMES[typeId] : null);
  }
  if (label.includes('component') || label.includes('structure')) {
    const groupName = window.EVE_GROUP_NAMES ? window.EVE_GROUP_NAMES[typeId] : null;
    const matchesComponent = label.includes('component') && COMPONENT_RIG_GROUPS.has(groupName);
    const matchesStructure = label.includes('structure') && (STRUCTURE_RIG_GROUPS.has(groupName) || catId === 65 || catId === 66);
    // The XL-tier "Structure and Component" rig alone also covers the plain (non-Advanced) capital
    // tier - Capital Armor Plates, Capital Construction Parts, etc. - which the M/L "Component" rig
    // does not (confirmed via EVE Ref: its own affected-groups list omits this group entirely).
    const matchesXLCapitalTier = label === 'structure and component' && groupName === 'Capital Construction Components';
    return matchesComponent || matchesStructure || matchesXLCapitalTier;
  }
  // Reaction rigs (Athanor/Tatara) match by the reaction PRODUCT's own item group, not category - the
  // 3 named reaction material lines (Biochemical/Composite/Hybrid Polymer) are real SDE group names.
  if (label.includes('reactor')) {
    const groupName = window.EVE_GROUP_NAMES ? window.EVE_GROUP_NAMES[typeId] : null;
    if (label === 'biochemical reactor') return groupName === 'Biochemical Material';
    if (label === 'composite reactor') return groupName === 'Composite';
    if (label === 'hybrid reactor') return groupName === 'Hybrid Polymers';
    // Bare "Reactor" = the L-Set Tatara-tier rig, which has no per-category split - confirmed via
    // in-game rig data to cover every reaction-adjacent material group at once, including the
    // simple-reaction/moon-material chain that feeds the 3 named categories (Athanor's split M-Set
    // rigs, above, only cover their own single named category - Intermediate/Molecular-Forged/
    // Unrefined reactions have no Athanor-tier rig at all, only Tatara's).
    if (label === 'reactor') {
      return ['Biochemical Material', 'Composite', 'Hybrid Polymers', 'Intermediate Materials', 'Molecular-Forged Materials', 'Unrefined Mineral'].includes(groupName);
    }
  }
  return false;
}
window.doesRigMatchProduct = doesRigMatchProduct;

let _rigItemCatalogCache = null;
// Scans the actual generated database for every real Structure Engineering Rig OR Reactor Rig item
// (identified by its real in-game group name), parses each one (as either a manufacturing/reaction
// Efficiency rig or a research/invention rig - see parseRigName/parseResearchRigName above), and
// returns the merged list - this is what populates the rig search dropdowns, so the list always
// reflects what's really in the game data. Reactor Rig is a separate group family from Engineering
// Rig (Athanor/Tatara's reaction ME/TE rigs vs Raitaru/Azbel/Sotiyo's manufacturing ones) - omitting
// it here previously made every reaction rig, including the real Tatara "Standup L-Set Reactor
// Efficiency" rig, unsearchable and unselectable.
function getRigItemCatalog() {
  if (_rigItemCatalogCache) return _rigItemCatalogCache;
  const rigs = [];
  if (window.EVE_ITEMS && window.EVE_GROUP_NAMES) {
    for (const typeIdStr of Object.keys(window.EVE_ITEMS)) {
      const groupName = window.EVE_GROUP_NAMES[typeIdStr];
      if (!groupName || (!groupName.includes('Structure Engineering Rig') && !groupName.includes('Reactor Rig'))) continue;
      const name = window.EVE_ITEMS[typeIdStr];
      const parsedMfg = parseRigName(name);
      const parsedResearch = parsedMfg ? null : parseResearchRigName(name);
      const parsedThukker = (parsedMfg || parsedResearch) ? null : parseThukkerRigName(name);
      const parsed = parsedMfg || parsedResearch || parsedThukker;
      if (!parsed) continue; // still not recognized - a combat/defense rig, reprocessing, etc.
      const kind = parsedMfg ? 'manufacturing' : (parsedResearch ? 'research' : 'thukker');
      rigs.push({ typeId: parseInt(typeIdStr), name, kind, ...parsed });
    }
    rigs.sort((a, b) => a.name.localeCompare(b.name));
  }
  _rigItemCatalogCache = rigs;
  return rigs;
}
window.getRigItemCatalog = getRigItemCatalog;

// A rig can only ever be physically fitted to a structure whose rig-slot size matches its own exact
// size class (no cross-compatibility, unlike ship rig calibration) - shared by the search filter
// (searchRigSlot, app.js) and both effective-bonus calculators below, so a rig that could never
// really be fitted to whatever's currently selected never silently contributes a bonus either.
function isRigSizeFittable(rigSize) {
  const activeRigSize = (window.getActiveStructureType ? window.getActiveStructureType() : {}).rigSize;
  if (!activeRigSize) return false; // NPC station - no rig slots at all
  return rigSize === activeRigSize;
}
window.isRigSizeFittable = isRigSizeFittable;

// Reads the 3 rig slot selections (stored as the rig's own typeId) and returns the effective % bonus
// (already including the security multiplier) for the given product typeId and bonus type ('ME'/'TE').
// Only one rig "of the same type" can be fitted in-game, so matching slots take the max, not the sum.
function getEffectiveRigBonusForTypeId(typeId, bonusType) {
  const secMult = getSecurityMultiplier();
  let best = 0;
  for (let slot = 1; slot <= 3; slot++) {
    const rigTypeId = parseInt(localStorage.getItem(`eve_rig_slot_${slot}`));
    if (!rigTypeId) continue;
    const rigName = window.EVE_ITEMS ? window.EVE_ITEMS[rigTypeId] : null;
    if (!rigName) continue;
    const parsed = parseRigName(rigName);
    if (!parsed) continue;
    if (!isRigSizeFittable(parsed.size)) continue;
    if (parsed.bonusType !== 'BOTH' && parsed.bonusType !== bonusType) continue;
    if (!doesRigMatchProduct(parsed, typeId)) continue;
    const base = bonusType === 'ME' ? RIG_ME_BASE[parsed.tier] : RIG_TE_BASE[parsed.tier];
    best = Math.max(best, base * secMult);
  }
  return best;
}
window.getEffectiveRigBonusForTypeId = getEffectiveRigBonusForTypeId;

// Time/cost base %: confirmed via EVE Ref dogma attributes - see parseResearchRigName's own comment
// for the exact items checked and values found.
const RESEARCH_RIG_TIME_BASE = { T1: 20.0, T2: 24.0 };
const RESEARCH_RIG_COST_BASE = { T1: 10.0, T2: 12.0 };
// Same pattern as getEffectiveRigBonusForTypeId, but for the research-rig family and scoped to a
// single category ('invention', for now - this app only has an actual Invention job cost/time
// calculation to apply the result to; ME/TE Research and Blueprint Copy rigs are searchable and
// selectable via the same catalog, but this app has no research/copy job calculator yet for their
// own bonus to plug into). kind is 'time' or 'cost'.
function getEffectiveInventionRigBonus(kind) {
  const secMult = getSecurityMultiplier();
  let best = 0;
  for (let slot = 1; slot <= 3; slot++) {
    const rigTypeId = parseInt(localStorage.getItem(`eve_rig_slot_${slot}`));
    if (!rigTypeId) continue;
    const rigName = window.EVE_ITEMS ? window.EVE_ITEMS[rigTypeId] : null;
    if (!rigName) continue;
    const parsed = parseResearchRigName(rigName);
    if (!parsed) continue;
    if (!isRigSizeFittable(parsed.size)) continue;
    if (parsed.effect !== 'BOTH' && parsed.effect !== kind) continue;
    if (!parsed.categories.includes('invention')) continue;
    const base = kind === 'time' ? RESEARCH_RIG_TIME_BASE[parsed.tier] : RESEARCH_RIG_COST_BASE[parsed.tier];
    best = Math.max(best, base * secMult);
  }
  return best;
}
window.getEffectiveInventionRigBonus = getEffectiveInventionRigBonus;

// Human-readable description of what a specific fitted rig actually does, for the rig slot's own
// hover tooltip (selectRigForSlot/restoreRigSlotInputs, app.js) - the real calculated bonus with the
// current system's security multiplier already folded in, not just the bare item name, plus a clear
// warning if it's the wrong size to ever actually fit the currently selected structure at all.
function describeRigBonus(typeId) {
  const rigName = window.EVE_ITEMS ? window.EVE_ITEMS[typeId] : null;
  if (!rigName) return '';
  const secMult = getSecurityMultiplier();
  const parsedMfg = parseRigName(rigName);
  const parsedResearch = parsedMfg ? null : parseResearchRigName(rigName);
  const parsed = parsedMfg || parsedResearch || parseThukkerRigName(rigName);
  if (!parsed) return rigName;

  const activeStructure = window.getActiveStructureType ? window.getActiveStructureType() : {};
  const mismatchNote = isRigSizeFittable(parsed.size) ? '' : `\n⚠ Wrong size for the selected structure (needs a ${activeStructure.rigSize || 'no'}-sized rig) - this bonus is NOT being applied.`;

  if (parsedMfg) {
    const specLabel = parsed.spec ? `${parsed.spec} ` : '';
    const lines = [];
    if (parsed.bonusType === 'ME' || parsed.bonusType === 'BOTH') lines.push(`ME: -${(RIG_ME_BASE[parsed.tier] * secMult).toFixed(1)}% material need for ${specLabel}${parsed.categoryLabel}`);
    if (parsed.bonusType === 'TE' || parsed.bonusType === 'BOTH') lines.push(`TE: -${(RIG_TE_BASE[parsed.tier] * secMult).toFixed(1)}% build time for ${specLabel}${parsed.categoryLabel}`);
    return `${rigName}\n${lines.join('\n')}${mismatchNote}`;
  }

  if (!parsedResearch) {
    // Thukker-family rig - fixed, verified numbers (no I/II tier, no security multiplier applied here
    // since its curve is inverted from every other rig - see parseThukkerRigName's own comment).
    const lines = [];
    if (parsed.me > 0) lines.push(`ME: -${parsed.me}% material need for ${parsed.scope}`);
    lines.push(`ME: -${parsed.capME}% material need specifically for Capital Construction Components`);
    if (parsed.te > 0) lines.push(`TE: -${parsed.te}% build time for ${parsed.scope}`);
    const secNote = '\n⚠ Unusual scaling: only 0.1x effective in highsec/null/WH, but 1.9x in lowsec (opposite of every other rig).';
    const notModeledNote = '\n(Not yet used in any calculation on this app - this special Thukker-line bonus curve isn\'t modeled here yet.)';
    return `${rigName}\n${lines.join('\n')}${secNote}${notModeledNote}${mismatchNote}`;
  }

  const categoryLabels = { invention: 'Invention', meResearch: 'ME Research', teResearch: 'TE Research', copy: 'Blueprint Copying' };
  const catText = parsed.categories.map(c => categoryLabels[c] || c).join(' + ');
  const lines = [];
  if (parsed.effect === 'time' || parsed.effect === 'BOTH') lines.push(`Time: -${(RESEARCH_RIG_TIME_BASE[parsed.tier] * secMult).toFixed(1)}% for ${catText}`);
  if (parsed.effect === 'cost' || parsed.effect === 'BOTH') lines.push(`Cost: -${(RESEARCH_RIG_COST_BASE[parsed.tier] * secMult).toFixed(1)}% for ${catText}`);
  const notUsedNote = parsed.categories.includes('invention') ? '' : '\n(Not yet used in any calculation on this app - only Invention job cost/time factors in rig bonuses right now.)';
  return `${rigName}\n${lines.join('\n')}${notUsedNote}${mismatchNote}`;
}
window.describeRigBonus = describeRigBonus;

const POPULAR_SYSTEMS = [
  { id: 30000142, name: "JITA" }, { id: 30000144, name: "PERIMETER" },
  { id: 30002187, name: "AMARR" }, { id: 30002659, name: "DODIXIE" },
  { id: 30002510, name: "RENS" }, { id: 30002053, name: "HEK" },
  { id: 30002537, name: "AMAMAKE" }, { id: 30004759, name: "1DQ1-A" }
];
window.POPULAR_SYSTEMS = POPULAR_SYSTEMS;

function extractRecipeYield(recipe) {
  if (!recipe) return 1;
  const candidates = [
    recipe.productQtyPerRun, recipe.mfgQtyPerRun, recipe.reactionQtyPerRun,
    recipe.outputQty, recipe.portionSize, recipe.quantity, recipe.qty,
    recipe.productQty, recipe.pQty, recipe.yield, recipe.batchYield,
    recipe.amount, recipe.qtyPerRun, recipe.products?.[0]?.quantity,
    recipe.products?.[0]?.qty, recipe.activityProducts?.[1]?.[0]?.quantity,
    recipe.activityProducts?.[11]?.[0]?.quantity, recipe.activityProducts?.['1']?.[0]?.quantity,
    recipe.activityProducts?.['11']?.[0]?.quantity
  ];
  for (const c of candidates) {
    const val = parseInt(c);
    if (!isNaN(val) && val > 0) return val;
  }
  return 1;
}
window.extractRecipeYield = extractRecipeYield;

// Emptied out 2026-09-03 after a full audit (triggered by a report that Gila's materials didn't
// match in-game - see git history / session notes for the Gila-specific writeup) found every single
// entry this object had ever held was wrong in some way, and eve_db.js's own EVE_RECIPES table
// (the real SDE data this app ships) already has a correct, complete recipe for every real item
// involved. Two different failure modes, both silent (buildPrepackedIndexes below applies this
// object unconditionally - no guard against overwriting good data with bad, unlike the main
// recipesObj/setRecipeMapEntry pass):
//   1. Stale-but-right-id (the Gila entry): id was correct, but the hand-typed materials/time were
//      wrong or outdated versus the current SDE data.
//   2. Wrong-id entirely (the reaction-formula entries: Tungsten/Titanium Carbide, Crystalline
//      Carbonide, Hydrogen Fuel Block): the ids used didn't even belong to the items the entries
//      claimed to be. 16681 was labeled "Tungsten Carbide" but is really Nanotransistors (real
//      Tungsten Carbide is 16672); 16680 "Titanium Carbide" is really Phenolic Composites (real one
//      is 16671); 16679 "Crystalline Carbonide" is really Fullerides (real one is 16670); 17728/17729
//      "Crystalline Carbonide"/its blueprint are really Megathron Navy Issue and its blueprint - a
//      completely unrelated faction battleship; 4247/4248 "Hydrogen Fuel Block" are really Helium
//      Fuel Block and Warp Disruption Field Generator II. Every one of those wrong ids was silently
//      clobbering recipeMap for a real, unrelated item every time the app loaded (e.g. any Megathron
//      Navy Issue BPC anywhere in the app would have displayed/built as fictional "Crystalline
//      Carbonide" instead of the real battleship) - worse than the Gila case, since it corrupted
//      items that had nothing to do with what this object was trying to add.
// If a genuine SDE gap ever shows up again (a real item with no usable recipeMap entry at all, not
// just one that "looks wrong"), verify the correct id/materials against eve_db.js's own EVE_RECIPES
// and real EVE data before adding anything back here - don't restore any of the above from history.
const BUILTIN_RECIPES = {};
window.BUILTIN_RECIPES = BUILTIN_RECIPES;

window.buildPrepackedIndexes = function() {
  const statusText = document.getElementById('status-text');
  const statusDot = document.getElementById('status-dot');
  try {
    const itemsObj = (typeof EVE_ITEMS !== 'undefined') ? EVE_ITEMS : (window.EVE_ITEMS || null);
    const recipesObj = (typeof EVE_RECIPES !== 'undefined') ? EVE_RECIPES : (window.EVE_RECIPES || null);
    const systemsObj = (typeof EVE_SYSTEMS !== 'undefined') ? EVE_SYSTEMS : (window.EVE_SYSTEMS || null);

    if (itemsObj && typeof itemsObj === 'object') {
      for (const [idStr, name] of Object.entries(itemsObj)) {
        const numericId = parseInt(idStr);
        IDX[name.toLowerCase()] = { id: numericId, name: name };
        TYPE_ID_TO_NAME[numericId] = name; 
      }
    } else {
      POPULAR_ITEMS.forEach(r => {
        IDX[r.name.toLowerCase()] = { id: r.id, name: r.name };
        TYPE_ID_TO_NAME[r.id] = r.name;
      });
    }

    if (systemsObj && typeof systemsObj === 'object') {
      for (const [id, name] of Object.entries(systemsObj)) {
        SYSTEM_IDX[name.toLowerCase()] = { id: parseInt(id), name: name.toUpperCase() };
        systemNameCache[id] = name.toUpperCase();
      }
    } else {
      POPULAR_SYSTEMS.forEach(sys => {
        SYSTEM_IDX[sys.name.toLowerCase()] = { id: sys.id, name: sys.name.toUpperCase() };
        systemNameCache[sys.id] = sys.name.toUpperCase();
      });
    }

    // EVE_RECIPES can contain a self-referential entry for a plain product item (its own
    // blueprintTypeID wrongly equal to its productTypeID - an SDE/fetch data-quality issue, not
    // something this app's own logic produces) sitting alongside the item's REAL recipe under a
    // different key. Both write to the same recipeMap slot, so whichever happens to be iterated
    // last here would silently win - this guard keeps a real (non-self-referential) recipe from
    // ever being overwritten by a self-referential one, regardless of Object.entries() order.
    const setRecipeMapEntry = (key, recipe) => {
      const existing = recipeMap[key];
      const incomingIsSelfRef = recipe.blueprintTypeID === recipe.productTypeID;
      if (existing && incomingIsSelfRef && existing.blueprintTypeID !== existing.productTypeID) return;
      recipeMap[key] = recipe;
    };

    if (recipesObj && typeof recipesObj === 'object') {
      for (const [idStr, recipe] of Object.entries(recipesObj)) {
        if (!recipe) continue;
        const keyId = parseInt(idStr);
        setRecipeMapEntry(keyId, recipe);
        const bpId = recipe.blueprintTypeID || recipe.bp || recipe.bpId;
        const pId = recipe.productTypeID || recipe.product || recipe.p || recipe.pId;
        if (bpId) setRecipeMapEntry(parseInt(bpId), recipe);
        if (pId) setRecipeMapEntry(parseInt(pId), recipe);
      }
    }

    for (const [idStr, recipe] of Object.entries(BUILTIN_RECIPES)) {
      const keyId = parseInt(idStr);
      recipeMap[keyId] = recipe;
      if (recipe.blueprintTypeID) recipeMap[recipe.blueprintTypeID] = recipe;
      if (recipe.productTypeID) recipeMap[recipe.productTypeID] = recipe;
    }

    // Dynamic SDE local index builder to match any Blueprint to its Product ID
    window.BLUEPRINT_TO_PRODUCT_MAP = window.BLUEPRINT_TO_PRODUCT_MAP || {};
    const blueprintSuffix = " blueprint";
    const formulaSuffix = " reaction formula";
    const formulaSuffix2 = " formula";

    for (const [name, item] of Object.entries(IDX)) {
      let pName = null;
      if (name.endsWith(blueprintSuffix)) {
        pName = name.slice(0, -blueprintSuffix.length);
      } else if (name.endsWith(formulaSuffix)) {
        pName = name.slice(0, -formulaSuffix.length);
      } else if (name.endsWith(formulaSuffix2)) {
        pName = name.slice(0, -formulaSuffix2.length);
      }

      if (pName) {
        const pItem = IDX[pName.trim()];
        if (pItem) {
          window.BLUEPRINT_TO_PRODUCT_MAP[item.id] = pItem.id;
        }
      }
    }

    if (statusDot) statusDot.className = 'w-2.5 h-2.5 rounded-full bg-green-400';
    if (statusText) statusText.textContent = `INDEX READY (${Object.keys(IDX).length.toLocaleString()} ITEMS)`;
  } catch (err) {
    console.error('buildPrepackedIndexes error:', err);
    if (statusDot) statusDot.className = 'w-2.5 h-2.5 rounded-full bg-red-500';
    if (statusText) statusText.textContent = 'INDEX LOAD ERROR: ' + err.message;
  }
};