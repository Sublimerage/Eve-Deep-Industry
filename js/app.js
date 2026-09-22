'use strict';

if (window.rootSellStrategy === undefined) window.rootSellStrategy = 'market-sell';
if (window.rootCustomPrice === undefined) window.rootCustomPrice = 0;
if (window.globalRuns === undefined) window.globalRuns = 1;
// How many separate real jobs window.globalRuns (runs PER job) represents - default 1, meaning
// "one job, this many runs", exactly today's behavior. See recalculate()'s own comment.
if (window.globalJobs === undefined) window.globalJobs = 1;

// (extractBuildTime, calculateAdjustedJobSeconds, calculateTotalBuildSeconds moved to config.js so
// the calculator, ledger, and invention pages can all share the same real time calculation)


// Binds custom card overrides directly to tree node structures before calculations
function syncTreeOverrides(node) {
  if (!node) return;
  const tId = node.typeId;
  const meMap = window.customMEOverrides || {};
  const teMap = window.customTEOverrides || {};
  // Same "default to your best owned BPO instead of 0/0" rule js/tree.js applies to brand-new
  // nodes - this is the re-sync path that runs on every recalculate for nodes that already exist,
  // so it needs the identical fallback or a node's ME/TE would revert to 0/0 the moment anything
  // else triggered a recalculate.
  const owned = typeof window.getBestOwnedBpoMeTe === 'function' ? window.getBestOwnedBpoMeTe(tId) : null;
  node.customME = meMap[tId] !== undefined ? meMap[tId] : (owned ? owned.me : 0);
  node.customTE = teMap[tId] !== undefined ? teMap[tId] : (owned ? owned.te : 0);
  if (node.children) {
    node.children.forEach(syncTreeOverrides);
  }
}

// Whether a node's current Job ME/TE came from an owned BPO rather than a manual edit - drives the
// small accent dot next to "Job ME/TE:" on its card (see the card template below).
function meTeIsAutoFilled(node) {
  const hasManualOverride = window.customMEOverrides && window.customMEOverrides[node.typeId] !== undefined;
  if (hasManualOverride) return false;
  return typeof window.getBestOwnedBpoMeTe === 'function' && !!window.getBestOwnedBpoMeTe(node.typeId);
}

// Tooltip text for that same row - explains WHERE the shown ME/TE came from, since a number that
// just appears with no explanation (especially the first time this shipped, when it used to always
// be 0/0) reads as a bug rather than the deliberate "use what you actually own" default it is.
function meTeSourceHint(node) {
  const hasManualOverride = window.customMEOverrides && window.customMEOverrides[node.typeId] !== undefined;
  if (hasManualOverride) return 'Manually set for this blueprint - edit to change, or clear localStorage\'s customMEOverrides to reset.';
  const owned = typeof window.getBestOwnedBpoMeTe === 'function' ? window.getBestOwnedBpoMeTe(node.typeId) : null;
  if (owned) return `Auto-filled from your best owned BPO (${owned.me}% ME / ${owned.te}% TE) - edit to override just this build.`;
  return 'No owned BPO found for this blueprint (or not logged in) - defaults to 0%/0% until you edit it.';
}

const SKILL_LEVEL_ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V'];

// Walks every currently-Built node (root included) and checks its recipe's requiredSkills against
// what's actually trained (eve_char_skills' full skill sheet, the same one calculateAdjustedJobSeconds
// already reads for the required-skill TIME bonus) - that time bonus silently contributes zero for a
// missing skill rather than flagging anything, so it's never actually told you whether you CAN build
// something, only how long it'd take if you could. Returns [] (not a false "you're missing
// everything") when no real skill sheet is loaded at all - a logged-out visitor gets no data to
// judge by, not a wall of false warnings.
// useRealSkillsOnly=true always reads your ACTUAL trained sheet, ignoring Simulate All to 5 - used
// for the training-time calculator below, which needs to answer "how long until this is really
// covered" regardless of whatever the simulate toggle happens to be previewing for build time right
// now. Every other caller (the per-item Need/Have breakdown, the Skills tab's warning dot) wants the
// toggle respected, so that stays the default.
function computeMissingSkills(root, useRealSkillsOnly) {
  // Whether to show anything at all is gated on the RAW sheet existing, deliberately not on the
  // effective (possibly-simulated) one below - "log in via ESI SSO to check this" should still show
  // for a logged-out visitor even with Simulate All to 5 armed, since there's no real baseline to
  // simulate a change against yet.
  const rawSheet = window.safeParseJSON(localStorage.getItem('eve_char_skills'), null);
  if (!rawSheet || !rawSheet.allSkills || Object.keys(rawSheet.allSkills).length === 0) return [];

  const trained = useRealSkillsOnly
    ? rawSheet.allSkills
    : (window.getEffectiveCharSkills ? window.getEffectiveCharSkills() : rawSheet).allSkills;
  const missingByItem = [];
  function walk(node) {
    if (!node) return;
    if (node.isBuildingSelf && node.recipe && Array.isArray(node.recipe.requiredSkills) && node.recipe.requiredSkills.length > 0) {
      const missing = node.recipe.requiredSkills
        .filter(req => (trained[req.skillId] || 0) < req.level)
        .map(req => ({
          skillId: req.skillId,
          skillName: (window.TYPE_ID_TO_NAME && window.TYPE_ID_TO_NAME[req.skillId]) || `Skill #${req.skillId}`,
          required: req.level,
          trained: trained[req.skillId] || 0
        }));
      if (missing.length > 0) {
        missingByItem.push({ typeId: node.typeId, name: node.productName || node.name, missing });
      }
    }
    if (node.children) node.children.forEach(walk);
  }
  walk(root);
  return missingByItem;
}
window.computeMissingSkills = computeMissingSkills;

// "What if every skill this build needs were trained to V?" - a pure display-time simulation, never
// touches the real trained sheet or localStorage. Routed through withRootPanAnchor like every other
// sidebar toggle on this page (see optimizers.js's own comment on why) - recalculate() at the end
// already refreshes the Skills panel itself (updateMissingSkillsUI is one of its own last steps).
async function toggleSimulateSkillsToFive() {
  window.simulateSkillsToFive = !window.simulateSkillsToFive;
  await window.withRootPanAnchor(async () => {
    if (typeof window.recalculate === 'function') await window.recalculate();
  });
}
window.toggleSimulateSkillsToFive = toggleSimulateSkillsToFive;

// Renders the "Simulate All to 5" toggle itself - same on/off visual language as
// updateDeductStockButtonVisual (js/config.js): btn-glass normally, btn-glass-muted when off,
// swap which one carries the accent to show which state is active. Disabled (not just inert-looking)
// with no real skill sheet loaded - there's nothing real to compare a simulated build against yet.
function renderSimulateSkillsToggle(hasSheet) {
  const on = !!window.simulateSkillsToFive;
  const disabledAttrs = hasSheet ? '' : ' disabled style="opacity:0.5;cursor:not-allowed;"';
  return `
    <button onclick="toggleSimulateSkillsToFive()" class="btn-glass${on ? '' : ' btn-glass-muted'} w-full px-3 py-1.5 text-xs flex items-center justify-center gap-1.5" style="margin-bottom:10px;"${disabledAttrs} title="${hasSheet ? 'Preview build time/missing-skill checks as if every skill this build needs were trained to level V - does not touch your real trained skills.' : 'Log in via ESI SSO first - nothing real to simulate against yet.'}">
      ${window.svgIcon ? window.svgIcon(on ? 'check' : 'zap') : ''} ${on ? 'Simulating All Skills at V' : 'Simulate All Skills at V'}
    </button>
  `;
}

// Refreshes the icon-rail Skills tab's warning dot and (if that panel is the one currently open)
// its own list body - called at the end of recalculate() so both track Build/Buy toggles and a
// skill sheet that finishes fetching after the tree already rendered.
function updateMissingSkillsUI() {
  const missing = computeMissingSkills(window.recipeTreeRoot);
  const dot = document.getElementById('skills-tab-dot');
  if (dot) dot.classList.toggle('hidden', missing.length === 0 || !!window.simulateSkillsToFive);

  const body = document.getElementById('skills-flyout-body');
  if (!body) return;
  const rawSheet = window.safeParseJSON(localStorage.getItem('eve_char_skills'), null);
  const hasSheet = !!(rawSheet && rawSheet.allSkills && Object.keys(rawSheet.allSkills).length > 0);
  const toggleHTML = renderSimulateSkillsToggle(hasSheet);

  // Training time is always computed against your REAL trained levels (useRealSkillsOnly), never
  // the simulated ones - otherwise arming Simulate All to 5 would make computeMissingSkills report
  // nothing missing at all, and the training-time section (whose entire job is "here's how long
  // until that simulated preview is actually true") would have nothing left to show right when it's
  // most relevant to be looking at it.
  const realMissing = window.simulateSkillsToFive ? computeMissingSkills(window.recipeTreeRoot, true) : missing;

  if (missing.length === 0) {
    body.innerHTML = toggleHTML + (hasSheet
      ? `<div class="fo-card-note" style="color:var(--accent);">Every component you're currently building is covered by your trained skills${window.simulateSkillsToFive ? ' (simulated at V)' : ''}.</div>`
      : `<div class="fo-card-note">Log in via ESI SSO (top right) to check your trained skills against what these blueprints actually require.</div>`)
      + `<div id="skills-training-time-body"></div>`;
  } else {
    body.innerHTML = toggleHTML + `<div id="skills-training-time-body"></div>` + missing.map(item => `
      <div style="margin-bottom:10px;">
        <div class="text-white font-semibold text-xs mb-1 truncate">${window.esc(item.name)}</div>
        ${item.missing.map(m => `
          <div class="fo-row" style="padding:3px 0;">
            <span class="fo-row-label" style="color:#e85555;" title="Skill ID ${m.skillId}">${window.esc(m.skillName)}</span>
            <span class="text-[11px] mono font-semibold" style="color:#e85555;">Need ${SKILL_LEVEL_ROMAN[m.required] || m.required} &middot; have ${SKILL_LEVEL_ROMAN[m.trained] || m.trained}</span>
          </div>
        `).join('')}
      </div>
    `).join('');
  }

  renderSkillTrainingTimes(realMissing);
}
window.updateMissingSkillsUI = updateMissingSkillsUI;

// How long until every one of these is actually trained, given the character's own real attributes
// (implant/remap-inclusive - see the attributes fetch's own comment in js/esi.js) - answers "how
// long do I need to train for those skills" directly, not just "what's missing." Dedupes across
// items first: the same skill can legitimately be required by several different components in one
// build (e.g. two different T2 components both needing the same Encryption Methods level) - training
// it once to the HIGHEST level any of them needs covers every appearance, so it should only ever be
// counted, and its own training time only computed, once - not once per item that happens to need it.
async function renderSkillTrainingTimes(missingByItem) {
  const container = document.getElementById('skills-training-time-body');
  if (!container) return;
  if (!missingByItem || missingByItem.length === 0) { container.innerHTML = ''; return; }

  const uniqueSkills = new Map();
  missingByItem.forEach(item => {
    item.missing.forEach(m => {
      const existing = uniqueSkills.get(m.skillId);
      if (!existing || m.required > existing.required) {
        uniqueSkills.set(m.skillId, { skillId: m.skillId, skillName: m.skillName, required: m.required, trained: m.trained });
      }
    });
  });

  const charAttributes = window.safeParseJSON(localStorage.getItem('eve_char_attributes'), null);

  // fetchSkillTrainingInfo hits a live ESI call only the FIRST time any given skill is ever asked
  // for (permanently cached after - see its own comment) - cheap enough in the common case
  // (updateMissingSkillsUI runs on every recalculate()) to just recompute plainly each time rather
  // than adding a separate diffing/memoization layer on top for what's normally a handful of skills.
  const results = await Promise.all(Array.from(uniqueSkills.values()).map(async (skill) => {
    const info = await window.fetchSkillTrainingInfo(skill.skillId);
    if (!info) return { ...skill, minutes: null };
    const minutes = window.estimateSkillTrainingMinutes(info.rank, skill.trained, skill.required, charAttributes, info.primaryAttr, info.secondaryAttr);
    return { ...skill, minutes };
  }));

  // The container this writes into may no longer exist, or may belong to a totally different tree
  // by the time these ESI calls resolve (recalculate() rebuilds it on every render, and the user is
  // free to switch products mid-fetch) - re-check rather than trust the reference captured above.
  const liveContainer = document.getElementById('skills-training-time-body');
  if (!liveContainer) return;

  const knownResults = results.filter(r => r.minutes != null);
  const totalMinutes = knownResults.reduce((sum, r) => sum + r.minutes, 0);
  const allKnown = knownResults.length === results.length;

  liveContainer.innerHTML = `
    <div class="fo-card" style="margin-bottom:10px;">
      <div class="fo-card-title">${window.svgIcon ? window.svgIcon('hourglass', { style: 'width:13px;height:13px;display:inline-block;vertical-align:-2px;margin-right:4px;' }) : ''}Estimated Training Time</div>
      ${!charAttributes ? `<div class="fo-card-note">Log in via ESI SSO to use your real attributes (remap + implants already included) - showing an unskilled 17/17/17/17/17 estimate until then.</div>` : ''}
      ${results.map(r => `
        <div class="fo-row" style="padding:3px 0;">
          <span class="fo-row-label" title="Skill ID ${r.skillId}">${window.esc(r.skillName)} <span class="mono" style="opacity:0.7;">${SKILL_LEVEL_ROMAN[r.trained] || r.trained}&rarr;${SKILL_LEVEL_ROMAN[r.required] || r.required}</span></span>
          <span class="text-[11px] mono font-semibold" style="color:var(--accent);">${r.minutes != null ? window.formatDurationCompact(r.minutes * 60) : 'unknown'}</span>
        </div>
      `).join('')}
      <div class="fo-row" style="padding:5px 0 0; margin-top:4px; border-top:1px solid #3a3025;">
        <span class="fo-row-label font-semibold">Total${allKnown ? '' : ' (partial)'}</span>
        <span class="text-[11px] mono font-bold" style="color:var(--accent);">${window.formatDurationCompact(totalMinutes * 60)}</span>
      </div>
      <div class="fo-card-note" style="margin-top:6px;">Assumes Omega training speed and full SP already banked at your current trained level - doesn't account for partial progress on a skill mid-training.</div>
    </div>
  `;
}
window.renderSkillTrainingTimes = renderSkillTrainingTimes;

function saveTaxSettings() {
  try {
    // facility-select's value is now the structure key itself (npc/raitaru/azbel/sotiyo) - a structure
    // is one thing at a time, so there's exactly one place this is read from.
    const facilityKey = document.getElementById('facility-select')?.value || 'sotiyo';
    localStorage.setItem('eve_active_facility_key', facilityKey);

    // Rig slot typeIds are written directly by selectRigForSlot() when the user picks one from the
    // search results - just read them back here to include in the settings snapshot.
    const rigSlot1 = localStorage.getItem('eve_rig_slot_1') || '';
    const rigSlot2 = localStorage.getItem('eve_rig_slot_2') || '';
    const rigSlot3 = localStorage.getItem('eve_rig_slot_3') || '';

    const settings = {
      facilityTax: document.getElementById('facility-tax')?.value,
      sccSurcharge: document.getElementById('scc-surcharge')?.value,
      salesTax: document.getElementById('sales-tax')?.value,
      brokerFee: document.getElementById('broker-fee')?.value,
      facilitySelect: facilityKey,
      contractTax: document.getElementById('contract-tax')?.value,
      contractBroker: document.getElementById('contract-broker')?.value,
      rigSlot1: rigSlot1,
      rigSlot2: rigSlot2,
      rigSlot3: rigSlot3
    };
    localStorage.setItem('eve_tax_settings', JSON.stringify(settings));
  } catch (e) { console.warn('[App] Failed to save tax/fee settings - they will reset on next reload:', e); }
}

// Called immediately when the structure-type dropdown changes, so the canonical localStorage key is
// updated right away (saveTaxSettings also does this, but this makes the single-source-of-truth
// intent explicit and keeps it working even if saveTaxSettings' own logic changes later).
function onStructureTypeChange() {
  const facilityKey = document.getElementById('facility-select')?.value || 'sotiyo';
  localStorage.setItem('eve_active_facility_key', facilityKey);
  renderStructureBonusChips();
  // A rig fitted for the OLD structure's size may no longer fit the new one at all - re-run the
  // tooltips (restoreRigSlotInputs, not just the search filter) so any now-mismatched rig picks up
  // describeRigBonus's "wrong size, not applied" warning immediately instead of only on next hover
  // after a search. The stored selection itself is left alone (not auto-cleared) - same reasoning
  // as leaving a stale collapse/expand override in place elsewhere: silently discarding a choice the
  // user made on a mere structure switch would be more surprising than a clearly-labeled mismatch.
  if (typeof window.restoreRigSlotInputs === 'function') window.restoreRigSlotInputs();
}
window.onStructureTypeChange = onStructureTypeChange;

// The selected structure's ME / TE / job-cost bonuses as three readable chips under the dropdown -
// the <option> text used to carry "(1% ME / 30% TE / 5% Fee)" inline, which was dense and easy to
// miss. A zero bonus is shown greyed (.is-off) rather than hidden, so the set always reads the same.
function renderStructureBonusChips() {
  const host = document.getElementById('structure-bonuses');
  if (!host) return;
  const s = window.getActiveStructureType ? window.getActiveStructureType() : { meBonus: 0, teBonus: 0, costBonus: 0 };
  const chip = (label, val, sign) => {
    const off = !val ? ' is-off' : '';
    return `<span class="struct-chip${off}">${label} <b>${val ? sign + val + '%' : '—'}</b></span>`;
  };
  host.innerHTML =
    chip('ME', s.meBonus, '+') +
    chip('TE', s.teBonus, '+') +
    chip('Job cost', s.costBonus, '−');
}
window.renderStructureBonusChips = renderStructureBonusChips;

function loadTaxSettings() {
  try {
    const saved = localStorage.getItem('eve_tax_settings');
    if (saved) {
      const settings = window.safeParseJSON(saved, {});
      if (settings.facilityTax !== undefined && document.getElementById('facility-tax')) document.getElementById('facility-tax').value = settings.facilityTax;
      if (settings.sccSurcharge !== undefined && document.getElementById('scc-surcharge')) document.getElementById('scc-surcharge').value = settings.sccSurcharge;
      if (settings.salesTax !== undefined && document.getElementById('sales-tax')) document.getElementById('sales-tax').value = settings.salesTax;
      if (settings.brokerFee !== undefined && document.getElementById('broker-fee')) document.getElementById('broker-fee').value = settings.brokerFee;
      if (settings.facilitySelect !== undefined && document.getElementById('facility-select')) document.getElementById('facility-select').value = settings.facilitySelect;
      if (settings.contractTax !== undefined && document.getElementById('contract-tax')) document.getElementById('contract-tax').value = settings.contractTax;
      if (settings.contractBroker !== undefined && document.getElementById('contract-broker')) document.getElementById('contract-broker').value = settings.contractBroker;
    }
  } catch (e) { console.warn('[App] Failed to load saved tax/fee settings - falling back to defaults:', e); }
}

// Filters the real rig item catalog (pulled from the generated database) as the user types, and
// renders matching results in the dropdown below the search box. Narrowed to whatever rig size the
// currently selected structure can actually fit (isRigSizeFittable, config.js) first - a Raitaru (M)
// can never fit an L or XL rig in real EVE, so there's no point offering one here either.
function searchRigSlot(slotNum, query) {
  const resultsEl = document.getElementById(`rig-slot-${slotNum}-results`);
  if (!resultsEl) return;
  const fullCatalog = typeof window.getRigItemCatalog === 'function' ? window.getRigItemCatalog() : [];
  if (fullCatalog.length === 0) {
    resultsEl.innerHTML = `<div class="p-1.5 text-slate-500">No rig data found - regenerate your database (generate_db.py) to enable rig search.</div>`;
    resultsEl.classList.remove('hidden');
    return;
  }
  const activeStructure = window.getActiveStructureType ? window.getActiveStructureType() : {};
  const catalog = activeStructure.rigSize ? fullCatalog.filter(r => r.size === activeStructure.rigSize) : [];
  if (catalog.length === 0) {
    resultsEl.innerHTML = `<div class="p-1.5 text-slate-500">${activeStructure.rigSize ? `No ${activeStructure.rigSize}-sized rigs found` : `${window.esc(activeStructure.shortLabel || 'This structure')} has no rig slots`} - pick an Engineering Complex or Refinery above to fit rigs.</div>`;
    resultsEl.classList.remove('hidden');
    return;
  }
  const q = (query || '').trim().toLowerCase();
  const matches = (q ? catalog.filter(r => r.name.toLowerCase().includes(q)) : catalog).slice(0, 25);
  const noneRow = `<div class="px-1.5 py-1 hover:bg-orange-500/15 cursor-pointer text-slate-400 border-b border-orange-500/15" onmousedown="selectRigForSlot(${slotNum}, 0, '')">— None —</div>`;
  const matchRows = matches.length > 0
    ? matches.map(r => `<div class="px-1.5 py-1 hover:bg-orange-500/15 cursor-pointer border-b border-orange-500/15" onmousedown="selectRigForSlot(${slotNum}, ${r.typeId}, '${window.esc(r.name)}')" title="${window.esc((typeof window.describeRigBonus === 'function' ? window.describeRigBonus(r.typeId) : r.name))}">${window.esc(r.name)}</div>`).join('')
    : `<div class="p-1.5 text-slate-500">No matching ${activeStructure.rigSize}-sized rigs found.</div>`;
  resultsEl.innerHTML = noneRow + matchRows;
  resultsEl.classList.remove('hidden');
}
window.searchRigSlot = searchRigSlot;

// Applies a rig selection (or clears it with typeId 0) for the given slot, persists it, and
// recalculates. Uses onmousedown (not onclick) in the results list above so it fires before the
// search input's onblur hides the dropdown.
// Wrapped in withRootPanAnchor (app.js) - a sidebar control, not a diagram card.
async function selectRigForSlot(slotNum, typeId, name) {
  const inputEl = document.getElementById(`rig-slot-${slotNum}-input`);
  const resultsEl = document.getElementById(`rig-slot-${slotNum}-results`);
  if (inputEl) {
    inputEl.value = typeId ? name : '';
    // Hovering the filled slot shows exactly what it's giving (real calculated %, security
    // multiplier already applied) instead of just the bare item name - see describeRigBonus.
    inputEl.title = typeId && typeof window.describeRigBonus === 'function' ? window.describeRigBonus(typeId) : '';
  }
  if (resultsEl) resultsEl.classList.add('hidden');
  setRigSlotFilledState(slotNum, !!typeId);
  localStorage.setItem(`eve_rig_slot_${slotNum}`, typeId ? String(typeId) : '');
  saveTaxSettings();
  await window.withRootPanAnchor(async () => { await recalculate(); });
}
window.selectRigForSlot = selectRigForSlot;

// Toggles the .is-filled class on a rig slot row so its number chip lights up and the clear (✕)
// button appears - purely visual, the real saved state is the typeId in localStorage.
function setRigSlotFilledState(slotNum, filled) {
  const row = document.querySelector(`.rig-slot[data-slot="${slotNum}"]`);
  if (row) row.classList.toggle('is-filled', !!filled);
}
window.setRigSlotFilledState = setRigSlotFilledState;

// Restores each rig slot's search input to show the saved rig's real name (looked up by the stored
// typeId), since the input just displays text - the typeId in localStorage is the actual saved state.
// --- Blueprint Browser ---
let _blueprintBrowserData = [];

// The item_id (+ its blueprint type_id, to validate the link is still current) of whichever
// blueprint was last sent to the calculator via "Load" - persisted (not just an in-memory variable)
// so reopening the browser later, even after a reload, still shows which one you're currently
// working from. Keyed by item_id (ESI's unique instance ID per physical blueprint copy) rather than
// type/ME/TE, since two BPCs of the same item at the same stats are still two different real objects
// and only one of them is the one you actually picked. The same pair is also what lets
// addCurrentJobToLedger() tag a queued job back to the exact BPC it came from (see that function).
function getLastLoadedBlueprintSource() {
  return window.safeParseJSON(localStorage.getItem('eve_last_loaded_blueprint_source'), null);
}
function getLastLoadedBlueprintItemId() {
  const source = getLastLoadedBlueprintSource();
  return source ? source.itemId : null;
}
function setLastLoadedBlueprintSource(itemId, typeId) {
  if (itemId === undefined || itemId === null) { localStorage.removeItem('eve_last_loaded_blueprint_source'); return; }
  localStorage.setItem('eve_last_loaded_blueprint_source', JSON.stringify({ itemId, typeId }));
}

let _blueprintBrowserOpenerEl = null;
async function openBlueprintBrowser() {
  _blueprintBrowserOpenerEl = document.activeElement;
  const backdrop = document.getElementById('blueprint-browser-backdrop');
  const drawer = document.getElementById('blueprint-browser-drawer');
  if (backdrop) backdrop.classList.remove('hidden');
  if (drawer) requestAnimationFrame(() => drawer.classList.remove('translate-x-full'));
  if (_blueprintBrowserData.length === 0) {
    await loadBlueprintBrowserData();
  } else {
    // Re-render (not re-fetch) from the already-cached list every time the drawer opens, not just
    // the first time - otherwise this just re-displays whatever was last rendered, which is from
    // BEFORE "Load" was ever clicked (Load closes the drawer immediately), so the "✔ Loaded"/"🔒
    // Queued" tags stay stuck at their old state until something forces a real refetch (the Refresh
    // button). Cheap and instant since it works off data already in memory, no ESI round-trip.
    filterBlueprintBrowser();
  }
}
window.openBlueprintBrowser = openBlueprintBrowser;

function closeBlueprintBrowser() {
  const backdrop = document.getElementById('blueprint-browser-backdrop');
  const drawer = document.getElementById('blueprint-browser-drawer');
  if (drawer) drawer.classList.add('translate-x-full');
  if (backdrop) setTimeout(() => backdrop.classList.add('hidden'), 300);
  if (_blueprintBrowserOpenerEl && typeof _blueprintBrowserOpenerEl.focus === 'function') _blueprintBrowserOpenerEl.focus();
  _blueprintBrowserOpenerEl = null;
}
window.closeBlueprintBrowser = closeBlueprintBrowser;

async function loadBlueprintBrowserData() {
  const listEl = document.getElementById('blueprint-browser-list');
  if (listEl) listEl.innerHTML = `<div class="text-slate-500 italic p-4 text-center">Loading your blueprints...</div>`;

  const [charBps, corpBps] = await Promise.all([
    typeof window.fetchCharacterBlueprints === 'function' ? window.fetchCharacterBlueprints() : [],
    typeof window.fetchCorpBlueprints === 'function' ? window.fetchCorpBlueprints() : []
  ]);

  const allBps = [...(charBps || []).map(b => ({ ...b, source: 'Personal' })), ...(corpBps || []).map(b => ({ ...b, source: 'Corp' }))];

  if (allBps.length === 0) {
    if (listEl) listEl.innerHTML = `<div class="text-slate-500 italic p-4 text-center">No blueprints found - make sure you're logged in via EVE SSO, or you may not own any.</div>`;
    return;
  }

  // Resolving which STATION a blueprint is really in (when it's sitting inside a container/can)
  // requires the character's full asset list, since a blueprint's own location_id points at the
  // container itself, not the station - the same hierarchy walk the asset/stock viewer already does.
  if (!window.rawAssetItems || window.rawAssetItems.length === 0) {
    if (listEl) listEl.innerHTML = `<div class="text-slate-500 italic p-4 text-center">Fetching your assets to resolve station/container locations...</div>`;
    if (typeof window.refreshLiveAssets === 'function') {
      try { await window.refreshLiveAssets(); } catch (e) { console.warn('Asset refresh for blueprint browser failed:', e); }
    }
  }

  const itemIdToAssetMap = window.buildItemIdToAssetMap ? window.buildItemIdToAssetMap() : {};
  allBps.forEach(b => {
    const hierarchy = window.resolveItemLocationHierarchy
      ? window.resolveItemLocationHierarchy(b.location_id, itemIdToAssetMap)
      : { rootLocationId: b.location_id, containerId: null };
    b.rootLocationId = hierarchy.rootLocationId;
    b.containerId = hierarchy.containerId;
  });

  // Resolve station/structure names for the root locations, and container names (custom in-game
  // names, if any were set) for anything sitting inside a container - both feed the same reliable
  // resolver/cache the stock viewer uses.
  const rootLocationIds = [...new Set(allBps.map(b => b.rootLocationId))];
  if (typeof window.resolveLocationIds === 'function') {
    await window.resolveLocationIds(rootLocationIds);
  }
  allBps.forEach(b => {
    b.stationName = (window.resolvedLocationNames && window.resolvedLocationNames[b.rootLocationId]) || `Location ${b.rootLocationId}`;
    if (b.containerId) {
      const containerAsset = itemIdToAssetMap[b.containerId];
      const containerTypeName = containerAsset ? (window.TYPE_ID_TO_NAME[containerAsset.type_id] || 'Container') : 'Container';
      const customName = window.resolvedLocationNames && window.resolvedLocationNames[b.containerId];
      b.containerName = customName || `${containerTypeName} (#${String(b.containerId).slice(-5)})`;
    } else {
      b.containerName = null;
    }
    // Category filter needs the PRODUCT's category (Ship/Module/Drone/Ammo/etc), not the blueprint's
    // own category (which is always "Blueprint") - resolve via the already-loaded recipe data.
    const recipe = window.recipeMap && window.recipeMap[b.type_id];
    const productTypeId = (recipe && recipe.productTypeID) || (window.BLUEPRINT_TO_PRODUCT_MAP && window.BLUEPRINT_TO_PRODUCT_MAP[b.type_id]);
    b.productTypeId = productTypeId;
    b.categoryId = (productTypeId && window.EVE_CATEGORIES) ? window.EVE_CATEGORIES[productTypeId] : undefined;
  });

  _blueprintBrowserData = allBps;
  populateBlueprintLocationDropdown();
  filterBlueprintBrowser();
}
window.loadBlueprintBrowserData = loadBlueprintBrowserData;

// Mirrors the calculator's populateLocationDropdown() structure (all/system/station/corp-division/
// container hierarchy with counts) but sourced from blueprint data and targeting its own dropdown -
// a separate element ID since index.html already has #stock-location-filter for general stock, and
// duplicate IDs on the same page would break document.getElementById lookups.
function populateBlueprintLocationDropdown() {
  const filterSelect = document.getElementById('blueprint-location-filter');
  if (!filterSelect) return;
  const currentSystemName = (document.getElementById('system-search')?.value || 'JITA').toUpperCase();
  const currentValue = filterSelect.value || 'all';
  filterSelect.innerHTML = `
    <option value="all" style="color: var(--accent); background-color: #0a0d0e; font-weight: bold;">All Locations</option>
    <option value="industry_system" style="color: var(--accent); background-color: #0a0d0e; font-weight: bold;">Current System Only (${currentSystemName})</option>
  `;
  const sagNameMap = {
    'CorpSAG1': window.corpDivisionNames[1] || 'DIVISION 1',
    'CorpSAG2': window.corpDivisionNames[2] || 'DIVISION 2',
    'CorpSAG3': window.corpDivisionNames[3] || 'DIVISION 3',
    'CorpSAG4': window.corpDivisionNames[4] || 'DIVISION 4',
    'CorpSAG5': window.corpDivisionNames[5] || 'DIVISION 5',
    'CorpSAG6': window.corpDivisionNames[6] || 'DIVISION 6',
    'CorpSAG7': window.corpDivisionNames[7] || 'DIVISION 7',
    'CorpDeliveries': 'CORP DELIVERIES'
  };
  const locCounts = {};
  _blueprintBrowserData.forEach(bp => {
    const locId = bp.rootLocationId;
    const locName = bp.stationName || `Location #${locId}`;
    if (!locCounts[locId]) {
      locCounts[locId] = { name: locName, count: 0, corpDivisions: {}, containers: {} };
    }
    locCounts[locId].count += 1;
    if (bp.source === 'Corp' && bp.location_flag && bp.location_flag.startsWith('Corp')) {
      const sagFlag = bp.location_flag;
      if (!locCounts[locId].corpDivisions[sagFlag]) {
        locCounts[locId].corpDivisions[sagFlag] = { name: sagNameMap[sagFlag] || sagFlag, count: 0 };
      }
      locCounts[locId].corpDivisions[sagFlag].count += 1;
    }
    if (bp.containerId) {
      const cId = bp.containerId;
      const cName = bp.containerName || `Container #${cId}`;
      if (!locCounts[locId].containers[cId]) {
        locCounts[locId].containers[cId] = { name: cName, count: 0 };
      }
      locCounts[locId].containers[cId].count += 1;
    }
  });
  for (const [locId, data] of Object.entries(locCounts)) {
    const mainOpt = document.createElement('option');
    mainOpt.value = `loc_${locId}`;
    const numericLocId = parseInt(locId);
    const isUpwellStructure = numericLocId > 1000000000000;
    mainOpt.style.color = isUpwellStructure ? 'var(--accent)' : '#4caf6f';
    mainOpt.style.backgroundColor = '#0a0d0e';
    mainOpt.style.fontWeight = 'bold';
    // Native <option> can't hold an inline SVG - the orange/green text color already distinguishes
    // Upwell structures from NPC stations, so no leading glyph is needed.
    mainOpt.textContent = `${data.name} (${data.count})`;
    filterSelect.appendChild(mainOpt);
    for (const [sagFlag, sagData] of Object.entries(data.corpDivisions)) {
      const sagOpt = document.createElement('option');
      sagOpt.value = `corpsag_${locId}_${sagFlag}`;
      sagOpt.style.color = '#c084fc';
      sagOpt.style.backgroundColor = '#030405';
      sagOpt.style.fontWeight = 'bold';
      sagOpt.textContent = `  └─ Corp: ${sagData.name} (${sagData.count})`;
      filterSelect.appendChild(sagOpt);
    }
    for (const [cId, cData] of Object.entries(data.containers)) {
      const containerOpt = document.createElement('option');
      containerOpt.value = `container_${cId}`;
      containerOpt.style.color = '#f8fafc';
      containerOpt.style.backgroundColor = '#030405';
      containerOpt.textContent = `  └─ Container: ${cData.name} (${cData.count})`;
      filterSelect.appendChild(containerOpt);
    }
  }
  filterSelect.value = filterSelect.querySelector(`option[value="${currentValue}"]`) ? currentValue : 'all';
}
window.populateBlueprintLocationDropdown = populateBlueprintLocationDropdown;

// Mirrors esi.js's filterLocationDropdownOptions() - text-filters the option list itself, since with
// many locations the dropdown is its own thing to search through.
function filterBlueprintLocationDropdownOptions() {
  const query = (document.getElementById('blueprint-location-search')?.value || '').trim().toUpperCase();
  const filterSelect = document.getElementById('blueprint-location-filter');
  if (!filterSelect) return;
  filterSelect.querySelectorAll('option').forEach(opt => {
    if (opt.value === 'all' || opt.value === 'industry_system') { opt.hidden = false; return; }
    opt.hidden = query.length > 0 && !opt.textContent.toUpperCase().includes(query);
  });
}
window.filterBlueprintLocationDropdownOptions = filterBlueprintLocationDropdownOptions;

// Mirrors esi.js's applyStockLocationFilter() value parsing (all/industry_system/loc_/corpsag_/
// container_) but filters the blueprint list itself rather than building a stock quantity map.
function blueprintMatchesLocationFilter(bp, filterVal, activeSystemName) {
  if (filterVal === 'all') return true;
  if (filterVal === 'industry_system') return (bp.stationName || '').toUpperCase().includes(activeSystemName);
  if (filterVal.startsWith('loc_')) {
    return bp.rootLocationId === parseInt(filterVal.replace('loc_', ''));
  }
  if (filterVal.startsWith('corpsag_')) {
    const parts = filterVal.split('_');
    return bp.rootLocationId === parseInt(parts[1]) && bp.location_flag === parts[2];
  }
  if (filterVal.startsWith('container_')) {
    return bp.containerId === parseInt(filterVal.replace('container_', ''));
  }
  return true;
}

const BLUEPRINT_BROWSER_KNOWN_CATEGORIES = [6, 7, 18, 8, 65, 32]; // Ships, Modules, Drones, Ammo/Charges, Structures, Subsystems

function getCurrentlyFilteredBlueprints() {
  const q = (document.getElementById('blueprint-browser-search')?.value || '').toLowerCase().trim();
  const loc = document.getElementById('blueprint-location-filter')?.value || 'all';
  const activeSystemName = (document.getElementById('system-search')?.value || 'JITA').toUpperCase();
  const useChar = document.getElementById('blueprint-use-char')?.checked ?? true;
  const useCorp = document.getElementById('blueprint-use-corp')?.checked ?? true;
  const typeFilter = document.getElementById('blueprint-type-filter')?.value || 'all';
  const categoryFilter = document.getElementById('blueprint-category-filter')?.value || 'all';

  return _blueprintBrowserData.filter(b => {
    if (b.source === 'Personal' && !useChar) return false;
    if (b.source === 'Corp' && !useCorp) return false;
    const name = (window.TYPE_ID_TO_NAME[b.type_id] || `Type ${b.type_id}`).toLowerCase();
    if (q && !name.includes(q)) return false;
    if (!blueprintMatchesLocationFilter(b, loc, activeSystemName)) return false;
    if (typeFilter === 'bpo' && b.quantity !== -1) return false;
    if (typeFilter === 'bpc' && b.quantity === -1) return false;
    if (categoryFilter !== 'all') {
      if (categoryFilter === 'other') {
        if (BLUEPRINT_BROWSER_KNOWN_CATEGORIES.includes(b.categoryId)) return false;
      } else if (b.categoryId !== parseInt(categoryFilter)) {
        return false;
      }
    }
    return true;
  });
}

function filterBlueprintBrowser() {
  const stackEnabled = document.getElementById('blueprint-stack-toggle')?.checked ?? true;
  const sortByProfit = document.getElementById('blueprint-sort-by-profit')?.checked ?? false;
  const filtered = getCurrentlyFilteredBlueprints();
  renderBlueprintBrowserList(filtered, stackEnabled, sortByProfit);
}
window.filterBlueprintBrowser = filterBlueprintBrowser;

// Groups identical BPOs/BPCs into one displayed entry with a stack count - same type, ME, and TE for
// BPOs; same type, ME, TE, AND runs for BPCs (runs isn't meaningful for a BPO, which never depletes).
// Also correctly folds in blueprints ESI already reports as a pre-stacked group (quantity > 0).
// --- Profit Scanner ---
let _blueprintProfitCache = null; // key -> {profit, iskPerHour, runsUsed, qtyProduced, scannedAt} | null (scan failed) - loaded lazily from localStorage
// _v2: computeBlueprintManufacturingProfit used to compute a bare "revenue minus raw materials"
// figure with no sales tax/broker fee/job installation fee at all - anything cached under the old
// key is stale relative to the corrected formula and must never be read back as if it were still
// valid, hence the new key rather than reusing the old one (old entries just become inert).
const BLUEPRINT_PROFIT_CACHE_KEY = 'eve_blueprint_profit_cache_v2';

function getBlueprintProfitCache() {
  if (_blueprintProfitCache === null) {
    _blueprintProfitCache = window.safeParseJSON(localStorage.getItem(BLUEPRINT_PROFIT_CACHE_KEY), {});
  }
  return _blueprintProfitCache;
}

function saveBlueprintProfitCache() {
  try {
    localStorage.setItem(BLUEPRINT_PROFIT_CACHE_KEY, JSON.stringify(_blueprintProfitCache || {}));
  } catch (e) {
    console.warn('[BlueprintScan] Failed to persist profit cache (localStorage may be full):', e);
  }
}

// Renders a compact "Xd Yh ago" style relative time string for the scan-age tooltip.
function formatScanAge(scannedAt) {
  if (!scannedAt) return 'unknown';
  const seconds = Math.max(0, (Date.now() - scannedAt) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h ago`;
}

function getBlueprintProfitCacheKey(bp) {
  const isBPO = bp.quantity === -1;
  return isBPO
    ? `bpo|${bp.type_id}|${bp.material_efficiency}|${bp.time_efficiency}`
    : `bpc|${bp.type_id}|${bp.material_efficiency}|${bp.time_efficiency}|${bp.runs}`;
}

// Manufacturing profit for one blueprint at its REAL owned ME/TE - for a BPC, using its actual
// remaining runs; for a BPO (infinite runs), using 1 run as the representative unit, since ISK/hour
// and per-run profit are what's actually comparable across BPOs and BPCs alike.
async function computeBlueprintManufacturingProfit(bp) {
  if (!bp.productTypeId) return null;
  const runsToUse = (bp.quantity === -1) ? 1 : Math.max(1, bp.runs);

  window.customMEOverrides = window.customMEOverrides || {};
  window.customTEOverrides = window.customTEOverrides || {};
  window.customMEOverrides[bp.type_id] = bp.material_efficiency;
  window.customTEOverrides[bp.type_id] = bp.time_efficiency;
  window.recipeTreeRootProductTypeId = bp.productTypeId;

  const productName = window.TYPE_ID_TO_NAME[bp.productTypeId] || 'Item';
  let root;
  try {
    root = await window.buildRecursiveRecipeTree(bp.type_id, productName + ' Blueprint', runsToUse, 0, 6, new Set(), null);
  } finally {
    window.recipeTreeRootProductTypeId = null;
  }
  if (!root) return null;

  root.runsNeeded = runsToUse;
  root.qtyNeeded = runsToUse * (root.batchYield || 1);
  const facility = (window.getActiveStructureType ? window.getActiveStructureType().meBonus : 1.0) / 100;
  if (typeof window.scaleTreeQuantities === 'function') window.scaleTreeQuantities(root, facility);

  const allTypeIds = new Set();
  if (typeof window.collectAllTypeIds === 'function') window.collectAllTypeIds(root, allTypeIds);
  allTypeIds.add(bp.productTypeId);
  if (typeof window.fetchMarketPrices === 'function') await window.fetchMarketPrices(Array.from(allTypeIds));
  // jobEIV feeds calculateNodeJobFee below - without this it's always 0, silently zeroing out the
  // job installation fee regardless of build size.
  if (typeof window.calculateNodeEIV === 'function') window.calculateNodeEIV(root);

  const materialCost = typeof window.calculateTreeNodeCost === 'function' ? window.calculateTreeNodeCost(root) : 0;

  // Same fee inputs recalculate() itself reads for the number actually shown once you load a
  // blueprint into the Calculator - sales tax + broker fee on the sale, and the manufacturing job
  // installation fee (facility tax + SCC surcharge + system cost index, scaled by EIV). This scan
  // previously computed a bare "revenue minus raw materials" figure with NONE of these, which
  // quietly overstated profit - job fees scale with the economic value being processed, so the gap
  // grows with the build, and was likely a big chunk of why a huge/expensive blueprint's scanned
  // number here didn't match what the Calculator showed for the same blueprint.
  const { salesTax, brokerFee, facilityTax, sccSurcharge } = window.getActiveFeeInputs();
  const structureType = window.getActiveStructureType ? window.getActiveStructureType() : { costBonus: 0 };
  const structureRoleBonus = (structureType.costBonus || 0) / 100;
  const jobFees = typeof window.calculateNodeJobFee === 'function' ? window.calculateNodeJobFee(root, facilityTax, sccSurcharge, structureRoleBonus) : 0;
  const totalCost = materialCost + jobFees;

  const outputPrices = window.priceCache[bp.productTypeId] || { sell: 0 };
  const grossSell = outputPrices.sell * root.qtyNeeded;
  const netSellRevenue = grossSell * (1 - salesTax - brokerFee);
  const profit = netSellRevenue - totalCost;
  const buildSeconds = typeof window.calculateTotalBuildSeconds === 'function' ? window.calculateTotalBuildSeconds(root) : 0;
  const iskPerHour = buildSeconds > 0 ? profit / (buildSeconds / 3600) : null;

  return { profit, iskPerHour, runsUsed: runsToUse, qtyProduced: root.qtyNeeded, scannedAt: Date.now() };
}

async function scanSingleBlueprintProfit(typeId, me, te, runs, quantity, productTypeId, btnEl) {
  const bp = { type_id: typeId, material_efficiency: me, time_efficiency: te, runs: runs, quantity: quantity, productTypeId: productTypeId };
  const key = getBlueprintProfitCacheKey(bp);
  const cache = getBlueprintProfitCache();

  const origHTML = btnEl ? btnEl.innerHTML : null;
  if (btnEl) { btnEl.disabled = true; btnEl.innerHTML = window.svgIcon('hourglass'); }
  try {
    cache[key] = await computeBlueprintManufacturingProfit(bp);
  } catch (e) {
    console.warn('[BlueprintScan] Failed for', typeId, e);
    cache[key] = null;
  }
  saveBlueprintProfitCache();
  if (btnEl) { btnEl.disabled = false; btnEl.innerHTML = origHTML; }
  filterBlueprintBrowser();
}
window.scanSingleBlueprintProfit = scanSingleBlueprintProfit;

async function scanBlueprintProfits() {
  const btn = document.getElementById('blueprint-scan-btn');
  if (btn) btn.disabled = true;
  const cache = getBlueprintProfitCache();

  // Scan whatever's currently visible under the active filters, stacked first so identical
  // BPOs/BPCs aren't recomputed redundantly.
  const currentFiltered = getCurrentlyFilteredBlueprints();
  const stackEnabled = document.getElementById('blueprint-stack-toggle')?.checked ?? true;
  const toScan = stackEnabled ? stackBlueprints(currentFiltered) : currentFiltered;

  let done = 0;
  for (const bp of toScan) {
    const key = getBlueprintProfitCacheKey(bp);
    try {
      cache[key] = await computeBlueprintManufacturingProfit(bp);
    } catch (e) {
      console.warn('[BlueprintScan] Failed for', bp.type_id, e);
      cache[key] = null;
    }
    done++;
    if (btn) btn.innerHTML = window.svgIcon('hourglass') + ` Scanning ${done}/${toScan.length}...`;
  }
  saveBlueprintProfitCache();

  if (btn) { btn.disabled = false; btn.innerHTML = window.svgIcon('chart') + ' Scan Profit'; }
  filterBlueprintBrowser();
}
window.scanBlueprintProfits = scanBlueprintProfits;

// --- What Can I Build Right Now ---
// Checks a blueprint's DIRECT materials (its own immediate ingredient list, ME-adjusted using the
// same formula the calculator uses elsewhere) against current stock - deliberately not a full
// recursive tree check, since "what can I build right now" means "could I click Build in-game with
// zero shopping trip", not "do I have raw materials for the entire multi-stage supply chain".
function computeBlueprintReadiness(bp) {
  const recipe = window.recipeMap && window.recipeMap[bp.type_id];
  if (!recipe) return null;
  const isReaction = !!(recipe.reactionMaterials && recipe.reactionMaterials.length > 0);
  const materials = isReaction ? recipe.reactionMaterials : recipe.mfgMaterials;
  if (!materials || materials.length === 0) return null;

  const me = bp.material_efficiency || 0;
  const structureType = window.getActiveStructureType ? window.getActiveStructureType() : { meBonus: 0 };
  const facilityBonus = (structureType.meBonus || 0) / 100;
  const rigMEBonus = window.getEffectiveRigBonusForTypeId ? window.getEffectiveRigBonusForTypeId(bp.productTypeId, 'ME') : 0;

  // Per-1-run quantity for each material, then how many WHOLE runs current stock covers for THAT
  // material alone - the true buildable run count is the minimum across all materials (the single
  // most limiting ingredient). This is a close approximation, not perfectly exact in every edge case
  // (the real per-N-runs formula rounds once for the whole batch, not per-run), but well within a
  // rounding error and far more useful than a binary yes/no.
  let maxRunsFromStock = Infinity;
  materials.forEach(m => {
    const baseQty = m.baseQty !== undefined ? m.baseQty : (m.qty || 1);
    const perRunQty = window.calculateInputQuantity
      ? window.calculateInputQuantity(baseQty, 1, me, facilityBonus, isReaction, rigMEBonus)
      : Math.ceil(baseQty);
    // stockAfterLedgerClaims, not raw userStockMap - materials already claimed by the Ledger's own
    // queued/started jobs aren't actually free to build with (see computeStockAfterLedgerClaims'
    // own comment in js/config.js).
    const stockPool = window.stockAfterLedgerClaims || window.userStockMap || {};
    const owned = stockPool[m.typeId] || 0;
    const runsThisAllows = perRunQty > 0 ? Math.floor(owned / perRunQty) : Infinity;
    if (runsThisAllows < maxRunsFromStock) maxRunsFromStock = runsThisAllows;
  });
  if (!isFinite(maxRunsFromStock)) maxRunsFromStock = 0; // no real materials data resolved

  const isBPO = bp.quantity === -1;
  const buildableRuns = isBPO ? maxRunsFromStock : Math.min(maxRunsFromStock, Math.max(1, bp.runs));

  return { buildableRuns, isReaction };
}

let _blueprintReadinessCache = {}; // same cache-key scheme as the profit scanner
let _readinessFilterActive = false;

async function scanBlueprintReadiness() {
  const btn = document.getElementById('blueprint-readiness-btn');
  if (!btn) return;

  // Already showing filtered results - this click means "go back to showing everything", using the
  // already-cached data, no need to rescan since stock hasn't been touched by this action.
  if (_readinessFilterActive) {
    _readinessFilterActive = false;
    btn.innerHTML = window.svgIcon('zap') + ' What Can I Build Right Now?';
    btn.className = 'btn-glass w-full px-2.5 py-1.5 text-[10px]';
    filterBlueprintBrowser();
    return;
  }

  btn.disabled = true;
  _blueprintReadinessCache = {}; // stock changes constantly, unlike ME/TE - always fresh, no persistence

  const currentFiltered = getCurrentlyFilteredBlueprints();
  const stackEnabled = document.getElementById('blueprint-stack-toggle')?.checked ?? true;
  const toCheck = stackEnabled ? stackBlueprints(currentFiltered) : currentFiltered;

  if (toCheck.length === 0) {
    btn.disabled = false;
    const originalHTML = btn.innerHTML;
    btn.innerHTML = window.svgIcon('warning') + ' No blueprints match your current filters';
    setTimeout(() => { if (btn) btn.innerHTML = originalHTML; }, 3000);
    return;
  }

  toCheck.forEach(bp => {
    const key = getBlueprintProfitCacheKey(bp);
    _blueprintReadinessCache[key] = computeBlueprintReadiness(bp);
  });

  btn.disabled = false;
  const buildableCount = Object.values(_blueprintReadinessCache).filter(r => r && r.buildableRuns > 0).length;
  const checkedCount = Object.values(_blueprintReadinessCache).filter(r => r !== null).length;

  if (buildableCount === 0) {
    const originalHTML = btn.innerHTML;
    btn.innerHTML = checkedCount > 0
      ? window.svgIcon('warning') + ' Nothing buildable with current stock'
      : window.svgIcon('warning') + ' No material data found';
    setTimeout(() => { if (btn) btn.innerHTML = originalHTML; }, 4000);
    return;
  }

  _readinessFilterActive = true;
  btn.innerHTML = window.svgIcon('eye') + ` Show All (${buildableCount} Buildable)`;
  btn.className = 'btn-glass btn-glass-muted w-full px-2.5 py-1.5 text-[10px]';
  btn.title = `Showing only the ${buildableCount} of ${checkedCount} checked blueprints you can build right now with current stock - click to show everything again`;
  filterBlueprintBrowser();
}
window.scanBlueprintReadiness = scanBlueprintReadiness;

function stackBlueprints(list) {
  const groups = {};
  const order = [];
  list.forEach(bp => {
    const isBPO = bp.quantity === -1;
    const key = isBPO
      ? `bpo|${bp.type_id}|${bp.material_efficiency}|${bp.time_efficiency}|${bp.rootLocationId}|${bp.containerId || ''}`
      : `bpc|${bp.type_id}|${bp.material_efficiency}|${bp.time_efficiency}|${bp.runs}|${bp.rootLocationId}|${bp.containerId || ''}`;
    const countForThisEntry = (!isBPO && bp.quantity > 0) ? bp.quantity : 1;
    if (!groups[key]) {
      groups[key] = { ...bp, stackCount: 0, memberItemIds: [] };
      order.push(key);
    }
    groups[key].stackCount += countForThisEntry;
    // Track every ESI row (and how many physical copies IT represents - ESI can itself already
    // report a stack of identical unused BPCs as one row with quantity > 1 sharing one item_id)
    // folded into this displayed group, so the "N of M queued" badge below can add usage across
    // all of them, not just whichever one happened to become the group's representative object.
    groups[key].memberItemIds.push({ itemId: bp.item_id, count: countForThisEntry });
  });
  return order.map(key => groups[key]);
}

function renderBlueprintBrowserList(list, stackEnabled, sortByProfit) {
  const listEl = document.getElementById('blueprint-browser-list');
  if (!listEl) return;
  if (list.length === 0) {
    listEl.innerHTML = `<div class="text-slate-500 italic p-4 text-center">No blueprints match your search/filter.</div>`;
    return;
  }

  let processedList = stackEnabled ? stackBlueprints(list) : list;

  // Attach scanned profit data (if any) from the cache, keyed by (type, ME, TE, runs-if-BPC).
  const profitCache = getBlueprintProfitCache();
  processedList = processedList.map(bp => ({
    ...bp,
    _profitResult: profitCache[getBlueprintProfitCacheKey(bp)],
    _readinessResult: _blueprintReadinessCache[getBlueprintProfitCacheKey(bp)]
  }));

  // "What Can I Build" filter mode: only show items with at least 1 buildable run, hiding anything
  // missing components entirely - the point of this mode is "show me what's actually buildable",
  // not a full inventory audit.
  if (_readinessFilterActive) {
    processedList = processedList.filter(bp => bp._readinessResult && bp._readinessResult.buildableRuns > 0);
    if (processedList.length === 0) {
      listEl.innerHTML = `<div class="text-slate-500 italic p-4 text-center">Nothing buildable with current stock under your active filters. Click "Show All" to see everything again.</div>`;
      return;
    }
  }

  const lastLoadedItemId = getLastLoadedBlueprintItemId();
  // Read fresh from the queue itself every render, rather than maintaining a separate tracked set -
  // that way the tag always matches reality with zero extra bookkeeping: deleting, collecting, or
  // undoing a queued job automatically clears its tag here too, since it's just gone from the source
  // of truth this reads. Sums RUNS, not job count or copy count - a BPC with runs left on it isn't
  // "used up" by one job the way a single-run copy is, and queuing a second job against its
  // remaining runs is completely legitimate, not a duplicate use. Counting jobs (or even physical
  // copies) instead of runs was exactly the gap: a 5-run BPC with a single 2-run job queued against
  // it read as "1/1 Queued" - fully spoken for - when really 3 runs were still free to plan against.
  const queuedRunsByItemId = new Map();
  window.safeParseJSON(localStorage.getItem('eve_ledger_jobs'), []).forEach(j => {
    const id = j && j.sourceBlueprintItemId;
    if (id === undefined || id === null) return;
    queuedRunsByItemId.set(id, (queuedRunsByItemId.get(id) || 0) + (j.runsNeeded || 0));
  });

  const renderRow = (bp, showStationLabel) => {
    const name = window.TYPE_ID_TO_NAME[bp.type_id] || `Type ${bp.type_id}`;
    const isOriginal = bp.quantity === -1;
    const bpImageVariant = isOriginal ? 'bp' : 'bpc';
    const isCurrentlyLoaded = lastLoadedItemId !== null && bp.item_id === lastLoadedItemId;
    const loadedBadge = isCurrentlyLoaded
      ? `<span class="lp-badge lp-badge-accent flex-shrink-0" title="This is the blueprint currently loaded in the calculator">${window.svgIcon('check')} Loaded</span>`
      : '';
    // A BPO never depletes (unlimited runs), so "runs queued" isn't a meaningful warning for one -
    // this only ever shows for BPCs, matching what it's actually for: not double-planning a
    // resource that runs out.
    let queuedBadge = '';
    if (!isOriginal) {
      // memberItemIds only exists on a stackBlueprints() group (stacking ON); with stacking OFF, bp
      // is one real ESI row, so it's its own sole "member" - either way, every member here shares
      // the same runs-per-copy (bp.runs is part of the stacking key), so total available runs for
      // the row is just runs-per-copy times how many physical copies are folded into it.
      const members = bp.memberItemIds || [{ itemId: bp.item_id, count: (bp.quantity > 0) ? bp.quantity : 1 }];
      const runsPerCopy = bp.runs || 1;
      const totalRuns = members.reduce((sum, m) => sum + m.count, 0) * runsPerCopy;
      // Summed raw across every member FIRST, capped only once against the whole stack's total - not
      // capped per-member before summing. "Load" only ever tags ONE specific physical copy's item_id
      // (see setLastLoadedBlueprintSource) - clicking "Add to Job Queue" more than once without re-
      // Loading a different copy in between (the normal way to queue several separate batches against
      // the same BPC's run pool) tags every one of those jobs to that SAME single item_id. Capping
      // per-member at that one copy's own runsPerCopy (its old behavior) silently threw away
      // everything past the first copy's worth - e.g. two separate 4-run adds against one 4-run BPC
      // read back as "4/12 queued" forever, no matter how many more times you added, since each add
      // individually still fit under that one member's own 4-run cap.
      const queuedRunsRaw = members.reduce((sum, m) => sum + (queuedRunsByItemId.get(m.itemId) || 0), 0);
      const queuedRuns = Math.min(queuedRunsRaw, totalRuns);
      queuedBadge = queuedRuns > 0
        ? `<span class="lp-badge lp-badge-danger flex-shrink-0" title="${queuedRuns} of ${totalRuns} run${totalRuns > 1 ? 's' : ''} already sitting in a queued ledger job">${window.svgIcon('lock')} ${queuedRuns}/${totalRuns} runs queued</span>`
        : '';
    }
    const stackBadge = (bp.stackCount && bp.stackCount > 1)
      ? `<span class="lp-badge flex-shrink-0" title="${bp.stackCount} identical copies stacked together">x${bp.stackCount}</span>`
      : '';
    const containerBadge = bp.containerName
      ? `<span class="lp-badge flex-shrink-0" title="Inside container: ${window.esc(bp.containerName)}">${window.svgIcon('package')} ${window.esc(bp.containerName)}</span>`
      : '';
    const stationBadge = showStationLabel
      ? `<span class="text-[9px] text-slate-500 flex-shrink-0" title="${window.esc(bp.stationName)}">${window.svgIcon('pin')} ${window.esc(bp.stationName)}</span>`
      : '';
    let profitBadge = '';
    if (bp._profitResult === null) {
      profitBadge = `<span class="text-xs text-red-400 font-bold flex-shrink-0 whitespace-nowrap" title="Profit scan failed for this item - see console">${window.svgIcon('warning')} scan failed</span>`;
    } else if (bp._profitResult) {
      const p = bp._profitResult;
      const profitColor = p.profit >= 0 ? 'text-green-400' : 'text-red-400';
      profitBadge = `<span class="text-sm font-extrabold ${profitColor} flex-shrink-0 whitespace-nowrap" title="Manufacturing profit for ${p.runsUsed} run${p.runsUsed > 1 ? 's' : ''} (${p.qtyProduced} units)${p.iskPerHour !== null ? `, ${Math.round(p.iskPerHour).toLocaleString()} ISK/hour` : ''} - scanned ${formatScanAge(p.scannedAt)}">${Math.round(p.profit).toLocaleString()} ISK</span>`;
    }
    let readinessBadge = '';
    if (bp._readinessResult === null) {
      readinessBadge = `<span class="text-xs text-slate-500 flex-shrink-0" title="No direct material data found for this blueprint">—</span>`;
    } else if (bp._readinessResult) {
      const r = bp._readinessResult;
      readinessBadge = r.buildableRuns > 0
        ? `<span class="lp-badge lp-badge-accent flex-shrink-0" title="Current stock covers ${r.buildableRuns.toLocaleString()} full run${r.buildableRuns > 1 ? 's' : ''}">${window.svgIcon('check')} ${r.buildableRuns.toLocaleString()} run${r.buildableRuns > 1 ? 's' : ''}</span>`
        : `<span class="lp-badge lp-badge-danger flex-shrink-0" title="Not enough stock for even 1 run right now">${window.svgIcon('warning')} 0 runs</span>`;
    }
    // Source ("Personal"/"Corp") and run count sit inline with the name now, not on their own
    // text row below - keeps each card to a slimmer two-line footprint instead of three.
    const sourceBadge = `<span class="text-[10px] font-semibold text-slate-500 flex-shrink-0">${window.esc(bp.source)}</span>`;
    const runsBadge = !isOriginal ? `<span class="text-[10px] font-semibold text-slate-500 flex-shrink-0">&bull; Runs: ${bp.runs}</span>` : '';
    // BPO/BPC as an explicit text badge, not just the icon variant - the /bp vs /bpc render EVE's
    // image server returns for the same type_id is a subtle white-vs-tinted document difference at
    // 32px, easy to misread at a glance; this makes the distinction unambiguous regardless of how
    // that icon renders.
    const originalBadge = isOriginal
      ? `<span class="text-[10px] font-bold flex-shrink-0" style="color:var(--text-mute);">BPO</span>`
      : `<span class="text-[10px] font-bold flex-shrink-0" style="color:var(--blue);">BPC</span>`;

    return `
      <div class="rounded-lg bg-black/20 border border-orange-500/20 hover:border-orange-500 p-2.5 transition space-y-1.5${isCurrentlyLoaded ? ' bp-row-loaded' : ''}">
        <div class="flex items-center gap-1.5 min-w-0">
          <img src="https://images.evetech.net/types/${bp.type_id}/${bpImageVariant}?size=32" alt="${window.esc(name)}" class="w-8 h-8 rounded-md border border-white/10 bg-black/40 flex-shrink-0" loading="lazy" title="${isOriginal ? 'Blueprint Original (BPO)' : 'Blueprint Copy (BPC)'}">
          <span class="font-bold text-slate-200 truncate">${window.esc(name)}</span>
          ${originalBadge}${loadedBadge}${queuedBadge}${sourceBadge}${runsBadge}${stackBadge}${readinessBadge}
        </div>
        <div class="flex items-center justify-between gap-3">
          <div class="text-[10px] text-slate-500 truncate flex items-center gap-1.5 min-w-0">
            ${containerBadge}${stationBadge}
          </div>
          <div class="flex items-center gap-2 flex-shrink-0">
            ${profitBadge}
            <span class="text-[11px] font-bold text-orange-300 bg-orange-950/50 border border-orange-700/40 rounded-full px-1.5 py-0.5 whitespace-nowrap">ME ${bp.material_efficiency}%</span>
            <span class="text-[11px] font-bold text-orange-300 bg-orange-950/50 border border-orange-700/40 rounded-full px-1.5 py-0.5 whitespace-nowrap">TE ${bp.time_efficiency}%</span>
            <button onclick="scanSingleBlueprintProfit(${bp.type_id}, ${bp.material_efficiency}, ${bp.time_efficiency}, ${bp.runs}, ${bp.quantity}, ${bp.productTypeId || 'null'}, this)" class="btn-glass px-2 py-1 flex items-center justify-center" title="Scan just this blueprint's profit">
              <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;"><line x1="4" y1="20" x2="4" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="20" y1="20" x2="20" y2="14"/></svg>
            </button>
            <button onclick="loadBlueprintIntoCalculator(${bp.type_id}, ${bp.material_efficiency}, ${bp.time_efficiency}, ${bp.runs}, ${bp.item_id || 'null'})" class="btn-glass px-2.5 py-1 text-[10px]">Load</button>
          </div>
        </div>
      </div>
    `;
  };

  if (sortByProfit) {
    // Flat list, ranked by profit regardless of station - grouping by location doesn't make sense
    // when the whole point is "which of my blueprints is most worth building right now."
    const sorted = [...processedList].sort((a, b) => {
      const av = a._profitResult ? a._profitResult.profit : -Infinity;
      const bv = b._profitResult ? b._profitResult.profit : -Infinity;
      return bv - av;
    });
    const unscannedCount = sorted.filter(bp => bp._profitResult === undefined).length;
    const hint = unscannedCount > 0
      ? `<div class="text-[10px] text-orange-400 italic mb-2 px-1">${unscannedCount} item${unscannedCount > 1 ? 's' : ''} not yet scanned - click "Scan Profit" to include them in the ranking.</div>`
      : '';
    listEl.innerHTML = hint + `<div class="space-y-1.5">${sorted.map(bp => renderRow(bp, true)).join('')}</div>`;
    return;
  }

  // Group by station so blueprints are clearly parented to the station they're actually in, not
  // shown as a flat list.
  const byStation = {};
  processedList.forEach(bp => {
    const key = bp.stationName;
    if (!byStation[key]) byStation[key] = [];
    byStation[key].push(bp);
  });

  // ESI convention: quantity -1 = original (BPO), -2 = copy (BPC); positive quantity = a stack of BPCs.
  listEl.innerHTML = Object.keys(byStation).sort().map(stationName => {
    const rows = byStation[stationName].map(bp => renderRow(bp, false)).join('');
    return `
      <div class="mb-3">
        <div class="text-[10px] font-bold text-orange-300 uppercase tracking-wide mb-1.5 px-1">${window.svgIcon('pin')} ${window.esc(stationName)}</div>
        <div class="space-y-1.5">${rows}</div>
      </div>
    `;
  }).join('');
}

function loadBlueprintIntoCalculator(blueprintTypeId, me, te, runs, itemId) {
  window.customMEOverrides = window.customMEOverrides || {};
  window.customTEOverrides = window.customTEOverrides || {};
  window.customMEOverrides[blueprintTypeId] = me;
  window.customTEOverrides[blueprintTypeId] = te;

  // Remember exactly which physical blueprint copy this was, so reopening the browser later - even
  // after a reload - still shows it highlighted, and so Add to Job Queue can tag the resulting job
  // back to it (see getLastLoadedBlueprintSource's comment).
  setLastLoadedBlueprintSource(itemId, blueprintTypeId);

  // BPOs report runs as -1 (unlimited) - only a real BPC has a meaningful fixed run count to carry
  // over. Set before calling selectItem (with preserveView=true, which skips selectItem's own reset
  // of globalRuns) so the tree gets built at the BPC's actual max runs, not the default of 1.
  if (typeof runs === 'number' && runs > 0) {
    window.globalRuns = runs;
    const runsInput = document.getElementById('bp-runs');
    if (runsInput) runsInput.value = runs;
  }

  // The root node's identity (.typeId) ends up being whatever gets passed to selectItem/
  // buildRecursiveRecipeTree - it must be the BLUEPRINT's own type ID here, matching the key the
  // ME/TE overrides above were just set under. Passing the product ID instead (what this used to do)
  // meant the root node's typeId never matched the override key, so it silently fell back to 0/0.
  const productTypeId = (window.BLUEPRINT_TO_PRODUCT_MAP && window.BLUEPRINT_TO_PRODUCT_MAP[blueprintTypeId]) || blueprintTypeId;
  const productName = window.TYPE_ID_TO_NAME[productTypeId] || window.EVE_ITEMS[productTypeId] || `Item ${productTypeId}`;
  const blueprintName = window.EVE_ITEMS[blueprintTypeId] || `${productName} Blueprint`;

  closeBlueprintBrowser();
  if (typeof window.selectItem === 'function') {
    window.selectItem(blueprintTypeId, blueprintName, true);
  }
}
window.loadBlueprintIntoCalculator = loadBlueprintIntoCalculator;

// --- Production Presets (system + structure + rigs) ---
function getProductionPresets() {
  return window.safeParseJSON(localStorage.getItem('eve_production_presets'), {});
}

// Reads the LIVE current system/structure/rigs directly from the same localStorage keys
// saveProductionPreset itself reads when saving one - a plain snapshot object, not tied to whether it
// matches any saved preset. Ported from js/ledger.js's own getCurrentLiveProductionSnapshot (that page
// doesn't load this file, so it keeps its own copy reading the same shared keys) - used here so the
// card-level quick-select below can show what's ACTUALLY active right now even when it isn't a saved
// preset, not just "no preset selected."
function getCurrentLiveProductionSnapshot() {
  const sel = window.safeParseJSON(localStorage.getItem('eve_selected_system'), {});
  return {
    systemId: sel.id || null, systemName: sel.name || null,
    facilityKey: localStorage.getItem('eve_active_facility_key') || 'sotiyo',
    rig1: localStorage.getItem('eve_rig_slot_1') || '',
    rig2: localStorage.getItem('eve_rig_slot_2') || '',
    rig3: localStorage.getItem('eve_rig_slot_3') || ''
  };
}

// Turns a snapshot into a friendly label: the name of a currently-saved preset if all fields still
// match exactly, otherwise a synthesized "Structure @ System, N rigs" description - so there's always
// something readable on the card even for a combo that was never saved as a named preset. Ported from
// js/ledger.js's own resolveProductionPresetLabel (same reasoning - that page re-reads presets
// directly rather than depending on this file).
function resolveProductionPresetLabel(snapshot) {
  if (!snapshot) return 'Unknown';
  const presets = getProductionPresets();
  const matchName = Object.keys(presets).find(name => {
    const p = presets[name];
    return p && p.systemId === snapshot.systemId && p.facilityKey === snapshot.facilityKey &&
      (p.rig1 || '') === (snapshot.rig1 || '') && (p.rig2 || '') === (snapshot.rig2 || '') && (p.rig3 || '') === (snapshot.rig3 || '');
  });
  if (matchName) return matchName;
  const structureLabel = (window.STRUCTURE_TYPES && window.STRUCTURE_TYPES[snapshot.facilityKey] && window.STRUCTURE_TYPES[snapshot.facilityKey].shortLabel) || snapshot.facilityKey || '?';
  const rigCount = [snapshot.rig1, snapshot.rig2, snapshot.rig3].filter(Boolean).length;
  const rigLabel = rigCount > 0 ? `, ${rigCount} rig${rigCount > 1 ? 's' : ''}` : ', no rigs';
  return snapshot.systemName ? `${structureLabel} @ ${snapshot.systemName}${rigLabel}` : `${structureLabel}${rigLabel}`;
}

// Quick station switcher for the root card itself - editing (save/delete) still lives in the left
// Structure flyout, but SELECTING one now also lives right on the card: reported directly that the
// flyout wasn't useful for this specifically because (1) it never shows what's currently active unless
// you open it, and (2) switching meant leaving the card to go find it. The select's own "current"
// option always reflects the LIVE system/structure/rigs (via resolveProductionPresetLabel above), not
// just whichever saved preset (if any) happens to match - same pattern the Ledger's own per-job preset
// chip already uses for exactly this reason (see renderJobMetaChipHTML in js/ledger.js).
function renderCardStationSelectorHTML() {
  const label = resolveProductionPresetLabel(getCurrentLiveProductionSnapshot());
  const presets = getProductionPresets();
  const presetNames = Object.keys(presets).sort();
  const currentOptionHTML = `<option value="" selected>${window.esc(label)}</option>`;
  const optionsHTML = presetNames.map(name => `<option value="${window.esc(name)}">${window.esc(name)}</option>`).join('');
  const findBestDisabled = presetNames.length < 2;
  return `
    <div class="flex items-center gap-1.5 min-w-0" onclick="event.stopPropagation()" title="Current production station - pick a saved preset to switch instantly. Manage (save/rename/delete) presets from the Structure panel on the left.">
      <span class="text-slate-400 flex-shrink-0" style="width:13px;">${window.svgIcon('factory')}</span>
      <select onchange="if (this.value) loadProductionPreset(this.value);" class="field-line flex-1 min-w-0 font-bold text-xs" style="max-width:220px; overflow:hidden; text-overflow:ellipsis;" ${presetNames.length === 0 ? 'disabled' : ''}>
        ${currentOptionHTML}
        ${optionsHTML}
      </select>
      <button id="find-best-station-btn" onclick="findBestProductionStation()" class="icon-btn flex-shrink-0" style="width:22px;height:22px;" ${findBestDisabled ? 'disabled' : ''} title="${findBestDisabled ? 'Save at least 2 production station presets to compare' : 'Check every saved station preset against this build and switch to whichever is cheapest'}">
        ${window.svgIcon('zap', { style: 'width:12px;height:12px;' })}
      </button>
    </div>
  `;
}
window.renderCardStationSelectorHTML = renderCardStationSelectorHTML;

// Re-applies a plain system/structure/rig/tax snapshot (not necessarily a saved preset - e.g. the
// live setup findBestProductionStation started from) - the same steps loadProductionPreset itself
// runs, minus the preset-dropdown bookkeeping that only makes sense for an actual named preset.
// Wrapped in withRootPanAnchor (app.js) - a sidebar control, not a diagram card.
async function applyProductionSnapshot(snapshot) {
  if (!snapshot) return;
  if (snapshot.systemId && typeof window.selectSolarSystem === 'function') {
    await window.selectSolarSystem(snapshot.systemId, snapshot.systemName);
  }
  const facilitySelect = document.getElementById('facility-select');
  if (facilitySelect && snapshot.facilityKey) {
    facilitySelect.value = snapshot.facilityKey;
    onStructureTypeChange();
  }
  const facilityTaxInput = document.getElementById('facility-tax');
  if (facilityTaxInput && snapshot.facilityTax !== undefined) facilityTaxInput.value = snapshot.facilityTax;
  saveTaxSettings();
  [1, 2, 3].forEach(slot => localStorage.setItem(`eve_rig_slot_${slot}`, snapshot[`rig${slot}`] || ''));
  restoreRigSlotInputs();
  await window.withRootPanAnchor(async () => {
    if (typeof window.recalculate === 'function') await window.recalculate();
  });
}
window.applyProductionSnapshot = applyProductionSnapshot;

// Tries every saved production station preset against the CURRENTLY loaded build (real system SCI +
// structure bonuses + rig bonuses + facility tax, via the exact same loadProductionPreset path a
// manual pick uses - not a separate/duplicated cost formula) and switches to whichever comes out
// cheapest. Only ever switches AWAY from what's live if a saved preset actually beats it - the live
// setup itself might not even be a saved preset, and "best" shouldn't mean "downgrade to one that
// was merely checked." Card re-renders (via each loadProductionPreset's own recalculate() call)
// replace this button's DOM element every step, so its own progress label is re-queried fresh each
// time rather than cached - a stale reference from before the first render would silently stop
// updating on screen after that.
async function findBestProductionStation() {
  if (!window.recipeTreeRoot) return;
  const presetNames = Object.keys(getProductionPresets()).sort();
  if (presetNames.length < 2) {
    if (typeof window.showToast === 'function') window.showToast('Save at least 2 production station presets first, so there is something to compare.', 'info');
    return;
  }

  const originalSnapshot = { ...getCurrentLiveProductionSnapshot(), facilityTax: document.getElementById('facility-tax')?.value };
  const originalLabel = resolveProductionPresetLabel(getCurrentLiveProductionSnapshot());
  const originalCost = window.recipeTreeRoot.calculatedCost || 0;
  let bestCost = originalCost;
  let bestName = null;

  const setBtnProgress = (text) => {
    const btn = document.getElementById('find-best-station-btn');
    if (btn) {
      btn.disabled = true;
      btn.style.width = 'auto';
      btn.style.padding = '0 8px';
      btn.innerHTML = `<span class="text-xs font-bold" style="white-space:nowrap;">${window.esc(text)}</span>`;
    }
  };

  try {
    for (let i = 0; i < presetNames.length; i++) {
      const name = presetNames[i];
      setBtnProgress(`${i + 1}/${presetNames.length}`);
      try {
        await loadProductionPreset(name);
        const cost = window.recipeTreeRoot.calculatedCost;
        if (typeof cost === 'number' && cost > 0 && cost < bestCost) {
          bestCost = cost;
          bestName = name;
        }
      } catch (e) {
        console.warn(`[App] Skipped "${name}" while finding the best station - it failed to load:`, e);
      }
    }

    if (bestName) {
      await loadProductionPreset(bestName);
      const savings = originalCost - bestCost;
      const savingsLabel = originalCost > 0 ? ` - saves ${window.formatISKCompact(savings)} vs "${originalLabel}"` : '';
      if (typeof window.showToast === 'function') window.showToast(`Best station: "${bestName}"${savingsLabel} (checked ${presetNames.length}).`, 'success');
    } else {
      await applyProductionSnapshot(originalSnapshot);
      if (typeof window.showToast === 'function') window.showToast(`"${originalLabel}" is already your cheapest option - checked ${presetNames.length} saved presets.`, 'info');
    }
  } finally {
    // Whichever branch ran above always ends in a recalculate() that redraws this button fresh in
    // its normal (non-loading) state - this is only a safety net for the unexpected case where
    // something threw before either branch's own final load/apply call ran. Wrapped in
    // withRootPanAnchor like every other bare recalculate() in this file - nesting inside the
    // loadProductionPreset/applyProductionSnapshot calls above is safe, see optimizers.js's own note.
    await window.withRootPanAnchor(async () => {
      if (typeof window.recalculate === 'function') await window.recalculate();
    });
  }
}
window.findBestProductionStation = findBestProductionStation;

function renderProductionPresetDropdown() {
  const select = document.getElementById('production-preset-select');
  if (!select) return;
  const presets = getProductionPresets();
  const currentValue = select.value;
  select.innerHTML = `<option value="">— Load a saved production station —</option>` +
    Object.keys(presets).sort().map(name => {
      const p = presets[name];
      const taxLabel = p.facilityTax !== undefined ? `, ${p.facilityTax}% Fac Tax` : '';
      return `<option value="${window.esc(name)}">${window.esc(name)} (${window.esc(p.systemName)}, ${window.esc(p.facilityLabel)}${taxLabel})</option>`;
    }).join('');
  if (presets[currentValue]) select.value = currentValue;
}
window.renderProductionPresetDropdown = renderProductionPresetDropdown;

function saveProductionPreset() {
  const name = prompt('Name this production station preset (e.g. "Home Sotiyo", "Staging Raitaru"):');
  if (!name || !name.trim()) return;

  const savedSystem = window.safeParseJSON(localStorage.getItem('eve_selected_system'), { id: null, name: 'JITA' });
  const facilityKey = localStorage.getItem('eve_active_facility_key') || 'sotiyo';
  const facilitySelect = document.getElementById('facility-select');
  const facilityLabel = facilitySelect ? (facilitySelect.options[facilitySelect.selectedIndex]?.text || facilityKey) : facilityKey;

  const presets = getProductionPresets();
  presets[name.trim()] = {
    systemId: savedSystem.id,
    systemName: savedSystem.name,
    facilityKey: facilityKey,
    facilityLabel: facilityLabel,
    // Facility (job installation) tax is set per-structure by whoever owns it, not a fixed game
    // constant like the SCC surcharge - it genuinely varies station to station, so it belongs in the
    // preset alongside the structure/system/rigs rather than staying one global "Fac" input that gets
    // silently left over from whichever station was last used.
    facilityTax: document.getElementById('facility-tax')?.value || '1.0',
    rig1: localStorage.getItem('eve_rig_slot_1') || '',
    rig2: localStorage.getItem('eve_rig_slot_2') || '',
    rig3: localStorage.getItem('eve_rig_slot_3') || ''
  };
  localStorage.setItem('eve_production_presets', JSON.stringify(presets));
  renderProductionPresetDropdown();
  const select = document.getElementById('production-preset-select');
  if (select) select.value = name.trim();
}
window.saveProductionPreset = saveProductionPreset;

async function loadProductionPreset(name) {
  if (!name) return;
  const presets = getProductionPresets();
  const preset = presets[name];
  if (!preset) return;

  if (preset.systemId && typeof window.selectSolarSystem === 'function') {
    await window.selectSolarSystem(preset.systemId, preset.systemName);
  }

  const facilitySelect = document.getElementById('facility-select');
  if (facilitySelect) {
    facilitySelect.value = preset.facilityKey;
    onStructureTypeChange();
  }

  // Older presets saved before facilityTax existed have no such field - leave whatever tax rate is
  // currently entered alone rather than clobbering it with something.
  const facilityTaxInput = document.getElementById('facility-tax');
  if (facilityTaxInput && preset.facilityTax !== undefined) {
    facilityTaxInput.value = preset.facilityTax;
  }
  saveTaxSettings();

  [1, 2, 3].forEach(slot => {
    const rigTypeId = preset[`rig${slot}`];
    localStorage.setItem(`eve_rig_slot_${slot}`, rigTypeId || '');
  });
  restoreRigSlotInputs();

  // Keeps the left Structure flyout's own dropdown in sync too - it only updates itself for free when
  // IT is the one used to pick a preset (the native select's value already matches by the time onchange
  // fires); loading one from the card's own quick-select (a different element) wouldn't otherwise touch
  // it, and it'd keep showing whatever was selected there last.
  renderProductionPresetDropdown();
  const presetSelect = document.getElementById('production-preset-select');
  if (presetSelect) presetSelect.value = name;

  await window.withRootPanAnchor(async () => {
    if (typeof window.recalculate === 'function') await window.recalculate();
  });
}
window.loadProductionPreset = loadProductionPreset;

function deleteProductionPreset() {
  const select = document.getElementById('production-preset-select');
  const name = select?.value;
  if (!name) {
    if (typeof window.showToast === 'function') window.showToast('Select a preset from the dropdown first, then click delete.', 'info');
    return;
  }
  const presets = getProductionPresets();
  const deletedPreset = presets[name];
  delete presets[name];
  localStorage.setItem('eve_production_presets', JSON.stringify(presets));
  renderProductionPresetDropdown();
  if (typeof window.showToast === 'function') {
    window.showToast(`Deleted the "${name}" preset.`, 'info', { action: { label: 'Undo', onClick: () => {
      const currentPresets = getProductionPresets();
      currentPresets[name] = deletedPreset;
      localStorage.setItem('eve_production_presets', JSON.stringify(currentPresets));
      renderProductionPresetDropdown();
    } } });
  }
}
window.deleteProductionPreset = deleteProductionPreset;

function restoreRigSlotInputs() {
  for (let slot = 1; slot <= 3; slot++) {
    const rigTypeId = parseInt(localStorage.getItem(`eve_rig_slot_${slot}`));
    const inputEl = document.getElementById(`rig-slot-${slot}-input`);
    const name = (rigTypeId && window.EVE_ITEMS && window.EVE_ITEMS[rigTypeId]) ? window.EVE_ITEMS[rigTypeId] : '';
    if (inputEl) {
      inputEl.value = name;
      inputEl.title = name && typeof window.describeRigBonus === 'function' ? window.describeRigBonus(rigTypeId) : '';
    }
    setRigSlotFilledState(slot, !!name);
  }
}

// --- Markets: home market search/selection ---
let _homeMarketSearchToken = 0;
async function searchHomeMarket(query) {
  const resultsEl = document.getElementById('home-market-results');
  if (!resultsEl) return;
  const token = ++_homeMarketSearchToken;
  const q = (query || '').trim();
  if (q.length < 3) {
    resultsEl.innerHTML = `<div class="p-1.5 text-slate-500">Type at least 3 characters...</div>`;
    resultsEl.classList.remove('hidden');
    return;
  }
  resultsEl.innerHTML = `<div class="p-1.5 text-slate-500">Searching...</div>`;
  resultsEl.classList.remove('hidden');
  const matches = await window.searchStationsByName(q);
  if (token !== _homeMarketSearchToken) return; // a newer search superseded this one
  if (matches === null) {
    resultsEl.innerHTML = `<div class="p-1.5 text-orange-400">${window.svgIcon('warning')} Log in via EVE SSO first - station search requires an authenticated character (ESI removed the old public search endpoint).</div>`;
    return;
  }
  if (matches.length === 0) {
    resultsEl.innerHTML = `<div class="p-1.5 text-slate-500">No matching stations found.</div>`;
    return;
  }
  resultsEl.innerHTML = matches.map(m => `
    <div class="px-2 py-1.5 hover:bg-orange-500/15 cursor-pointer border-b border-orange-500/15" onmousedown="selectHomeMarket(${m.stationId}, '${window.esc(m.stationName)}')">
      ${window.esc(m.stationName)}
    </div>
  `).join('');
}
window.searchHomeMarket = searchHomeMarket;

function selectHomeMarket(stationId, stationName) {
  localStorage.setItem('eve_home_station_id', String(stationId));
  localStorage.setItem('eve_home_station_name', stationName);
  const inputEl = document.getElementById('home-market-input');
  if (inputEl) inputEl.value = stationName;
  const resultsEl = document.getElementById('home-market-results');
  if (resultsEl) resultsEl.classList.add('hidden');
  // Prices already cached are all keyed by typeId only (no per-station distinction), so switching
  // home markets requires clearing them - otherwise stale Jita prices would linger under a new market.
  window.priceCache = {};
  if (window.currentProduct) {
    window.selectItem(window.currentProduct.id, window.currentProduct.name, true);
  }
}
window.selectHomeMarket = selectHomeMarket;

function restoreHomeMarketInput() {
  const inputEl = document.getElementById('home-market-input');
  const savedName = localStorage.getItem('eve_home_station_name');
  if (inputEl) inputEl.value = savedName || 'Jita IV - Moon 4 - Caldari Navy Assembly Plant';
}

// --- Markets: tracked markets management (for Compare Markets) ---
function renderTrackedMarketsList() {
  const listEl = document.getElementById('tracked-markets-list');
  if (!listEl) return;
  const markets = window.getTrackedMarkets ? window.getTrackedMarkets() : [];
  if (markets.length === 0) {
    listEl.innerHTML = `<div class="text-[10px] text-slate-500 italic">Loading default hubs...</div>`;
    return;
  }
  listEl.innerHTML = markets.map(m => `
    <div class="flex items-center justify-between bg-black/30 border border-orange-500/20 px-2 py-1 text-[10px] rounded">
      <span class="text-slate-300 truncate mono">${window.esc(m.stationName)}</span>
      <button onclick="removeTrackedMarketAndRefresh(${m.stationId})" class="text-red-400 hover:text-red-300 ml-1.5 flex-shrink-0 flex" title="Stop tracking this market">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="2.5" stroke-linecap="round" style="width:11px;height:11px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  `).join('');
}
window.renderTrackedMarketsList = renderTrackedMarketsList;

function removeTrackedMarketAndRefresh(stationId) {
  window.removeTrackedMarket(stationId);
  renderTrackedMarketsList();
}
window.removeTrackedMarketAndRefresh = removeTrackedMarketAndRefresh;

let _addMarketSearchToken = 0;
async function searchAddMarket(query) {
  const resultsEl = document.getElementById('add-market-results');
  if (!resultsEl) return;
  const token = ++_addMarketSearchToken;
  const q = (query || '').trim();
  if (q.length < 3) {
    resultsEl.innerHTML = `<div class="p-1.5 text-slate-500">Type at least 3 characters...</div>`;
    resultsEl.classList.remove('hidden');
    return;
  }
  resultsEl.innerHTML = `<div class="p-1.5 text-slate-500">Searching...</div>`;
  resultsEl.classList.remove('hidden');
  const matches = await window.searchStationsByName(q);
  if (token !== _addMarketSearchToken) return;
  if (matches === null) {
    resultsEl.innerHTML = `<div class="p-1.5 text-orange-400">${window.svgIcon('warning')} Log in via EVE SSO first - station search requires an authenticated character (ESI removed the old public search endpoint).</div>`;
    return;
  }
  if (matches.length === 0) {
    resultsEl.innerHTML = `<div class="p-1.5 text-slate-500">No matching stations found.</div>`;
    return;
  }
  resultsEl.innerHTML = matches.map(m => `
    <div class="px-2 py-1.5 hover:bg-orange-500/15 cursor-pointer border-b border-orange-500/15" onmousedown="confirmAddMarket(${m.stationId}, '${window.esc(m.stationName)}')">
      ${window.esc(m.stationName)}
    </div>
  `).join('');
}
window.searchAddMarket = searchAddMarket;

async function confirmAddMarket(stationId, stationName) {
  const resultsEl = document.getElementById('add-market-results');
  const inputEl = document.getElementById('add-market-input');
  if (resultsEl) { resultsEl.innerHTML = `<div class="p-1.5 text-slate-500">Adding...</div>`; }
  const regionInfo = await window.resolveStationRegion(stationId);
  window.addTrackedMarket({
    stationId: stationId,
    stationName: stationName,
    regionId: regionInfo ? regionInfo.regionId : null,
    systemId: regionInfo ? regionInfo.systemId : null
  });
  if (inputEl) inputEl.value = '';
  if (resultsEl) resultsEl.classList.add('hidden');
  renderTrackedMarketsList();
}
window.confirmAddMarket = confirmAddMarket;

// --- Compare Markets panel ---
async function openMarketComparison(e, typeId, itemName) {
  if (e) e.stopPropagation();
  const existing = document.getElementById('market-comparison-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'market-comparison-modal';
  modal.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-[999] p-4';
  modal.onclick = (evt) => { if (evt.target === modal) modal.remove(); };
  modal.innerHTML = `
    <div class="bg-[#0a0d0e] border border-orange-500/80 p-5 w-full max-w-2xl shadow-2xl text-xs mono">
      <div class="flex justify-between items-center border-b border-orange-500/20 pb-3 mb-3">
        <h3 class="text-base font-bold text-orange-300 rajdhani tracking-wider">${window.svgIcon('trending')} Compare Markets: ${window.esc(itemName)}</h3>
        <button onclick="document.getElementById('market-comparison-modal').remove()" class="text-slate-400 hover:text-white font-bold text-base" title="Close">${window.svgIcon('x')}</button>
      </div>
      <div id="market-comparison-body" class="text-slate-400">Loading prices and trade volume across tracked markets...</div>
      <div class="text-[10px] text-slate-500 mt-3 leading-relaxed">
        Volume is the average units traded per day over the last 7 days (from EVE's market history) - a low price with very low volume may be hard to actually buy/sell at that price. Sorted by price does NOT mean sorted by "best" - liquidity matters too.
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const results = await window.fetchMarketComparison(typeId);
  const bodyEl = document.getElementById('market-comparison-body');
  if (!bodyEl) return; // modal was closed before the fetch finished

  if (results.length === 0) {
    bodyEl.innerHTML = `<div class="text-slate-500 italic">No tracked markets yet - add some in the sidebar's Markets section.</div>`;
    return;
  }

  const rows = results.map(r => `
    <tr class="border-b border-orange-500/15">
      <td class="p-2 text-slate-200">${window.esc(r.stationName)}</td>
      <td class="p-2 text-right text-orange-300 font-bold">${r.sell > 0 ? Math.round(r.sell).toLocaleString() : '—'}</td>
      <td class="p-2 text-right text-orange-300 font-bold">${r.buy > 0 ? Math.round(r.buy).toLocaleString() : '—'}</td>
      <td class="p-2 text-right ${r.avgVolume === null ? 'text-slate-500' : (r.avgVolume < 10 ? 'text-red-400' : r.avgVolume < 100 ? 'text-orange-400' : 'text-green-400')} font-bold">
        ${r.avgVolume === null ? 'Unknown' : r.avgVolume.toLocaleString() + '/day'}
      </td>
    </tr>
  `).join('');

  bodyEl.innerHTML = `
    <table class="w-full text-left border-collapse">
      <thead>
        <tr class="text-slate-400 border-b border-orange-500/20 uppercase text-[10px] font-bold">
          <th class="p-2">Market</th>
          <th class="p-2 text-right">Lowest Sell</th>
          <th class="p-2 text-right">Highest Buy</th>
          <th class="p-2 text-right">Avg Daily Volume</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}
window.openMarketComparison = openMarketComparison;


function searchItems(query) {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  const exact = [], starts = [], contains = [];
  for (const [k, v] of Object.entries(window.IDX || {})) {
    // Both checks matter here: the name pattern keeps results to "X Blueprint"/"X Reaction Formula"
    // style entries specifically (recipeMap is dual-indexed by product AND blueprint ID, so without
    // this a plain product name like "Rifter" would show up as a separate duplicate result alongside
    // "Rifter Blueprint" for the exact same recipe). The recipe-existence check catches phantom
    // entries that pass the name pattern but have no real data behind them (e.g. "Synth Drop Booster
    // Reaction" - a different item than the real "...Reaction Formula" that shares part of its name).
    const isBlueprint = window.isBlueprintName(k);
    if (!isBlueprint) continue;
    if (!window.recipeMap || !window.recipeMap[v.id]) continue;

    if (k === q) exact.push(v);
    else if (k.startsWith(q)) starts.push(v);
    else if (k.includes(q)) contains.push(v);
  }
  return [...exact, ...starts, ...contains].slice(0, 15);
}

function searchSolarSystemsLocally(query) {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  const exact = [], starts = [], contains = [];
  for (const [k, v] of Object.entries(window.SYSTEM_IDX || {})) {
    if (k === q) exact.push(v);
    else if (k.startsWith(q)) starts.push(v);
    else if (k.includes(q)) contains.push(v);
  }
  return [...exact, ...starts, ...contains].slice(0, 15);
}

async function fetchEsiSystemSearch(query) {
  const q = query.trim();
  if (q.length < 2) return [];
  try {
    const results = [];
    const idsRes = await fetch('https://esi.evetech.net/latest/universe/ids/?datasource=tranquility&language=en', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([q])
    });
    if (idsRes.ok) {
      const idsData = await idsRes.json();
      if (idsData && idsData.systems) {
        idsData.systems.forEach(sys => {
          const item = { id: sys.id, name: sys.name.toUpperCase() };
          window.SYSTEM_IDX[sys.name.toLowerCase()] = item;
          window.systemNameCache[sys.id] = item.name;
          results.push(item);
        });
      }
    }
    return results;
  } catch (err) { return []; }
}

async function fetchEsiSearchResults(query) {
  try {
    if (!query || query.trim().length < 2) return [];
    const data = window.esiCharacterSearch ? await window.esiCharacterSearch(query.trim(), 'inventory_type') : {};
    if (!data.inventory_type || !data.inventory_type.length) return [];
    const ids = data.inventory_type.slice(0, 10);
    const namesRes = await fetch('https://esi.evetech.net/latest/universe/names/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ids)
    });
    if (!namesRes.ok) return [];
    const namesData = await namesRes.json();
    const results = [];
    namesData.forEach(item => {
      const obj = { id: item.id, name: item.name };
      window.IDX[item.name.toLowerCase()] = obj;
      results.push(obj);
    });
    return results;
  } catch (err) { return []; }
}

async function resolveProductIdFromBlueprintNameAsync(blueprintName) {
  const local = window.resolveProductIdFromBlueprintName(blueprintName);
  if (local) return local;
  try {
    let pName = blueprintName.replace(/ Blueprint$/i, '').replace(/ Reaction Formula$/i, '').replace(/ Formula$/i, '').trim();
    const hits = await fetchEsiSearchResults(pName);
    if (hits && hits.length > 0) {
      const match = hits.find(h => h.name.toLowerCase() === pName.toLowerCase());
      if (match) return match.id;
    }
  } catch (e) { console.warn(`[App] ESI search fallback failed while resolving product id for "${blueprintName}":`, e); }
  return null;
}

// Search dropdowns are rendered position:fixed instead of absolute so they escape the flyout
// panel's own overflow-y:auto - an absolutely-positioned dropdown still gets clipped by an
// ancestor's scroll box even though it's outside that ancestor's normal layout flow, which was
// cutting long result lists off at the flyout's border. position:fixed has no such ancestor, so
// this just needs the input's real screen position computed once, right before showing it.
function positionFixedDropdown(inputEl, resultsEl) {
  const rect = inputEl.getBoundingClientRect();
  resultsEl.style.top = (rect.bottom + 4) + 'px';
  resultsEl.style.left = rect.left + 'px';
  resultsEl.style.width = rect.width + 'px';
}

const searchInput = document.getElementById('item-search');
const searchResults = document.getElementById('search-results');

// #search-results lives (in the HTML) inside .stat-strip, which has its own position:relative +
// z-index:10 - that alone establishes a stacking context, and a positioned descendant can't
// escape its ancestor's stacking context just by declaring a bigger z-index of its own (that
// fixed a *different*, containing-block-only bug on this same dropdown - see .stat-strip's own
// backdrop-filter override in styles.css). Concretely: #search-results' z-index:500 was only
// ever being compared against other things inside .stat-strip, while .stat-strip itself
// (z-index:10) lost to .icon-rail (z-index:40) and .flyout-panel (z-index:100) - the dropdown
// rendered correctly positioned but still visually buried under both. Reparenting it to be a
// direct child of body sidesteps the whole ancestor-stacking-context problem instead of trying
// to out-z-index it; positionFixedDropdown's coordinates are viewport-relative regardless of
// where in the DOM the element actually lives, so nothing else about it needs to change.
if (searchResults && searchResults.parentElement !== document.body) {
  document.body.appendChild(searchResults);
}

if (searchInput) {
  searchInput.addEventListener('input', async () => {
    const q = searchInput.value.trim();
    if (!q) {
      if (searchResults) searchResults.classList.add('hidden');
      return;
    }
    let hits = searchItems(q);
    if (q.length >= 2) {
      // fetchEsiSearchResults hits EVE's general item-name search - it has no idea what's actually
      // buildable, so it'll happily return skins, boosters, or any other named item that matches the
      // query. Apply the exact same buildability filter searchItems() already uses locally (a real
      // blueprint/formula/reaction name AND a recipe genuinely present in recipeMap) before merging.
      const onlineHitsRaw = await fetchEsiSearchResults(q);
      const onlineHits = onlineHitsRaw.filter(h => {
        return window.isBlueprintName(h.name) && window.recipeMap && window.recipeMap[h.id];
      });
      const map = new Map();
      hits.forEach(h => map.set(h.id, h));
      onlineHits.forEach(h => map.set(h.id, h));
      hits = Array.from(map.values()).slice(0, 15);
    }
    const safeQ = window.esc(q);
    if (!hits.length) {
      if (searchResults) {
        searchResults.innerHTML = `<div class="p-3 text-slate-400 text-xs italic">No matching items found for "${safeQ}"</div>`;
        positionFixedDropdown(searchInput, searchResults);
        searchResults.classList.remove('hidden');
      }
      return;
    }
    if (searchResults) {
      searchResults.innerHTML = hits.map(item => {
        const isBp = window.isBlueprintName(item.name);
        // Blueprints aren't valid /icon items - show the manufactured product's icon instead.
        const displayIconId = isBp
          ? (window.resolveProductIdFromBlueprintName(item.name) || window.BLUEPRINT_TO_PRODUCT_MAP[item.id] || item.id)
          : item.id;
        return `
        <div class="px-3 py-2 hover:bg-orange-500/15 cursor-pointer flex items-center space-x-3 text-xs border-b border-orange-500/15"
             onclick="selectItem(${item.id}, '${window.esc(item.name)}')">
          <img src="https://images.evetech.net/types/${displayIconId}/icon?size=32" alt="${window.esc(item.name)}" class="w-6 h-6 " loading="lazy" onerror="this.onerror=null; this.src='https://images.evetech.net/types/${displayIconId}/render?size=32';">
          <span class="font-semibold text-slate-200">${window.esc(item.name)}</span>
        </div>
      `;
      }).join('');
      positionFixedDropdown(searchInput, searchResults);
      searchResults.classList.remove('hidden');
    }
  });
}

document.addEventListener('click', (e) => {
  if (searchInput && searchResults && !searchInput.contains(e.target) && !searchResults.contains(e.target)) {
    searchResults.classList.add('hidden');
  }
});

const systemSearchInput = document.getElementById('system-search');
const systemSearchResults = document.getElementById('system-results');

if (systemSearchInput) {
  systemSearchInput.addEventListener('input', async () => {
    const q = systemSearchInput.value.trim();
    if (!q) {
      if (systemSearchResults) systemSearchResults.classList.add('hidden');
      return;
    }
    let hits = searchSolarSystemsLocally(q);
    if (q.length >= 2) {
      const esiHits = await fetchEsiSystemSearch(q);
      const map = new Map();
      hits.forEach(h => map.set(h.id, h));
      esiHits.forEach(h => map.set(h.id, h));
      hits = Array.from(map.values()).slice(0, 10);
    }
    if (!hits.length) {
      if (systemSearchResults) {
        systemSearchResults.innerHTML = `<div class="p-2 text-slate-400 text-xs italic">No matching system found</div>`;
        positionFixedDropdown(systemSearchInput, systemSearchResults);
        systemSearchResults.classList.remove('hidden');
      }
      return;
    }
    if (systemSearchResults) {
      systemSearchResults.innerHTML = hits.map(sys => `
        <div class="px-3 py-1.5 hover:bg-orange-500/15 cursor-pointer text-xs font-bold text-orange-300 border-b border-orange-500/15 mono"
             onclick="window.selectSolarSystem(${sys.id}, '${window.esc(sys.name)}')">
          ${window.esc(sys.name)}
        </div>
      `).join('');
      positionFixedDropdown(systemSearchInput, systemSearchResults);
      systemSearchResults.classList.remove('hidden');
    }
  });

  systemSearchInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const q = systemSearchInput.value.trim();
      if (q) { await window.resolveSystemSCI(q); }
    }
  });
}

document.addEventListener('click', (e) => {
  if (systemSearchInput && systemSearchResults && !systemSearchInput.contains(e.target) && !systemSearchResults.contains(e.target)) {
    systemSearchResults.classList.add('hidden');
  }
});

// Encodes the current build (item, runs, structure, reactions, price mode, system) into a URL so
// it can be handed to someone else and reopen in the exact same configuration. Deliberately doesn't
// try to capture per-component ME/TE overrides or individual buy/build choices - just the settings
// that matter for "here's the build I'm looking at", kept simple enough to fit comfortably in a URL.
function shareCurrentBuild(event) {
  if (!window.currentProduct) {
    if (typeof window.showToast === 'function') window.showToast('Select an item to build first.', 'info');
    return;
  }
  const state = {
    id: window.currentProduct.id,
    name: window.currentProduct.name,
    runs: window.globalRuns || 1,
    facility: document.getElementById('facility-select')?.value,
    reactions: document.getElementById('include-reactions')?.value,
    priceMode: document.getElementById('input-price-mode')?.value,
    system: document.getElementById('system-search')?.value
  };
  const encoded = btoa(encodeURIComponent(JSON.stringify(state)));
  const url = `${window.location.origin}${window.location.pathname}?build=${encoded}`;
  const btn = event ? event.currentTarget : null;
  navigator.clipboard.writeText(url).then(() => {
    if (typeof window.showToast === 'function') window.showToast('Build link copied to clipboard.', 'success');
    if (btn) {
      const orig = btn.innerHTML;
      btn.innerHTML = window.svgIcon('check') + ' Copied!';
      setTimeout(() => { btn.innerHTML = orig; }, 1500);
    }
  }).catch(() => {
    if (typeof window.showToast === 'function') window.showToast('Could not copy the link - your browser may have blocked clipboard access.', 'error');
  });
}
window.shareCurrentBuild = shareCurrentBuild;

// Restores a build shared via shareCurrentBuild() above, if the page loaded with a ?build= param.
async function applySharedBuildFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const encoded = params.get('build');
  if (!encoded) return;
  let state;
  try {
    state = JSON.parse(decodeURIComponent(atob(encoded)));
  } catch (e) {
    console.warn('Invalid shared build link:', e);
    return;
  }
  if (!state || !state.id || !state.name) return;

  // Settings are applied (and their change events fired) before selectItem() runs, so any handler
  // that reads them during the build - guarded by "if (currentProduct)" checks - safely no-ops
  // since currentProduct isn't set yet, instead of firing prematurely against the wrong item.
  const settingFields = [
    ['facility-select', state.facility],
    ['include-reactions', state.reactions],
    ['input-price-mode', state.priceMode]
  ];
  settingFields.forEach(([id, value]) => {
    if (!value) return;
    const el = document.getElementById(id);
    if (!el) return;
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  if (state.system) {
    const systemInput = document.getElementById('system-search');
    if (systemInput) systemInput.value = state.system;
  }

  await window.selectItem(state.id, state.name, false);

  // Runs AND the optional ME/TE override (used by the Invention page's "send to Calculator" button,
  // linking to a specific decryptor's actual resulting BPC - e.g. ME+4/TE+8 out of a real decryptor,
  // not a plain unresearched ME0/TE0 copy of the blueprint) both have to be applied AFTER selectItem
  // returns, never before - selectItem(..., false) unconditionally resets globalRuns to 1 and
  // customMEOverrides/customTEOverrides to {} as part of "starting fresh" on a new item, so anything
  // set beforehand is immediately wiped out. A single recalculate() afterward picks up both: it reads
  // window.globalRuns directly, and its first step (syncTreeOverrides) re-reads customMEOverrides/
  // customTEOverrides onto the already-built tree - no second selectItem/rebuild needed for either.
  let needsRecalculate = false;
  if (state.runs && state.runs > 1) {
    window.globalRuns = state.runs;
    needsRecalculate = true;
  }
  if (state.me !== undefined || state.te !== undefined) {
    window.customMEOverrides = window.customMEOverrides || {};
    window.customTEOverrides = window.customTEOverrides || {};
    if (state.me !== undefined) window.customMEOverrides[state.id] = state.me;
    if (state.te !== undefined) window.customTEOverrides[state.id] = state.te;
    needsRecalculate = true;
  }
  if (needsRecalculate && typeof recalculate === 'function') recalculate();

  if (typeof window.showToast === 'function') window.showToast(`Loaded shared build: ${state.name}`, 'success');
  // Strip the param so refreshing doesn't keep re-applying (and re-toasting) the same shared state.
  window.history.replaceState({}, document.title, window.location.pathname);
}
window.applySharedBuildFromUrl = applySharedBuildFromUrl;

async function selectItem(typeId, name, preserveView = false, anchorInstanceId = null) {
  if (searchInput) searchInput.value = name;
  if (searchResults) searchResults.classList.add('hidden');
  window.currentProduct = { id: typeId, name };
  if (!preserveView) {
    window.selectedInstanceId = null;
    window.isolatedInstanceId = null;
    window.isolatedPathKey = null;
    window.rootSellStrategy = 'market-sell';
    window.rootCustomPrice = 0;
    window.globalRuns = 1;
    window.globalJobs = 1;
    const globalInput = document.getElementById('bp-runs');
    if (globalInput) globalInput.value = 1;

    window.buildSelfOverrides = {};
    window.customBuyModes = {};
    window.customMEOverrides = {};
    window.customTEOverrides = {};
  }

  // toggleBuildSelf/onCardMEChange/onCardTEChange all call selectItem with preserveView=true
  // specifically so clicking Build/Buy or editing a card's ME/TE doesn't feel like it reset
  // anything - but the rebuild below still hands every node a fresh instanceId (tree.js's
  // ++instanceCounter), and window.selectedInstanceId is tracked by that raw id at every one of
  // its many call sites. Captured here instead - the one place recipeTreeRoot's instanceIds
  // actually change - rather than keeping a parallel pathKey in sync at each of those call sites,
  // which is exactly the kind of thing that's easy to miss in one of them (see how
  // window.isolatedPathKey needs the same treatment, just at its own two, far fewer, call sites).
  const prevSelectedPathKey = (preserveView && window.selectedInstanceId != null && window.recipeTreeRoot)
    ? (findNodeByInstanceId(window.recipeTreeRoot, window.selectedInstanceId) || {}).pathKey
    : null;

  // Same problem, different symptom: clicking Build/Buy or editing ME/TE (see toggleBuildSelf's/
  // onCardMEChange's own callers) re-renders the whole diagram from scratch, and adding or removing
  // even one column shifts every OTHER column's local position within #pan-zoom-content - panX/panY
  // themselves never change, but the card the user was just looking at visibly jumps anyway because
  // the content around it reflowed. anchorInstanceId is the specific card whose button/input was
  // just interacted with (its own card, found via closest('.diagram-node') at the call site) -
  // capturing its on-screen rect now and re-measuring it after the rebuild (below, once the new DOM
  // exists) gives the exact screen-pixel drift to cancel out of panX/panY, so that one card - and
  // everything else, since it's all rigidly laid out relative to it - stays visually still.
  // Same root-anchoring exception recalculateWithPanAnchor uses (js/app.js) - building a component
  // out for the first time inserts new columns BETWEEN it and the root, so pinning the clicked card
  // itself can't stop root (and the LP Economics card right after it) from visibly sliding over. This
  // is the OTHER call path that needed that fix: recalculateWithPanAnchor only ever runs for controls
  // that call bare recalculate() (Hide/Compact, TE edit, Sell/Buy pill) - toggleBuildSelf's normal
  // branch (any component WITH a real recipe) calls selectItem() directly instead, which had its own,
  // older, separate anchor logic that never got the same LP-specific branch - so Build/Buy on a
  // regular tree component, easily the single most common click on this page, kept drifting even
  // after every other control was fixed.
  const isLPStore = !!(window.recipeTreeRoot && window.recipeTreeRoot.isLPIsolatedRoot);
  const effectiveAnchorInstanceId = isLPStore
    ? (window.recipeTreeRoot ? window.recipeTreeRoot.instanceId : null)
    : anchorInstanceId;
  let anchorPathKey = null;
  let anchorRectBefore = null;
  if (preserveView && effectiveAnchorInstanceId != null && window.recipeTreeRoot) {
    const anchorNode = findNodeByInstanceId(window.recipeTreeRoot, effectiveAnchorInstanceId);
    if (anchorNode) {
      anchorPathKey = anchorNode.pathKey;
      const anchorEl = document.getElementById(`node-card-${effectiveAnchorInstanceId}`);
      if (anchorEl) anchorRectBefore = anchorEl.getBoundingClientRect();
    }
  }

  window.recipeTreeRootProductTypeId = null;
  if (window.isBlueprintName(name)) {
    const resolvedProductTypeId = await window.resolveProductIdFromBlueprintNameAsync(name);
    if (resolvedProductTypeId) {
      window.recipeTreeRootProductTypeId = resolvedProductTypeId;
    }
  }

  const maxDepth = 10;
  window.recipeTreeRoot = await window.buildRecursiveRecipeTree(typeId, name, 1, 0, maxDepth, new Set(), null);

  if (prevSelectedPathKey) {
    const resyncedNode = findNodeByPathKey(window.recipeTreeRoot, prevSelectedPathKey);
    if (resyncedNode) window.selectedInstanceId = resyncedNode.instanceId;
  }

  // Awaited - window.recalculate is a plain synchronous function on the Calculator, so calling it
  // bare "worked" there by accident (a synchronous call still blocks until it's done regardless of
  // whether the caller awaits it). On the LP Store, installLPRecalculateHook (js/lpstore.js) replaces
  // this exact same global binding with an async, coalescing wrapper - calling it bare there let this
  // code measure the anchor card's position (right below) before that async work had actually
  // finished rendering, computing pan compensation against a stale or half-updated layout instead of
  // the real final one. That's what made the very first Build/Buy toggle on a freshly isolated LP
  // Store offer specifically prone to a real, measured drift (confirmed directly: a real anchor toggle
  // moved the root card 90px with this bug in place, zero px with it fixed) even though the exact same
  // click worked instantly and correctly on the Calculator.
  await recalculate();

  if (anchorPathKey && anchorRectBefore) {
    const anchorNodeAfter = findNodeByPathKey(window.recipeTreeRoot, anchorPathKey);
    const anchorElAfter = anchorNodeAfter ? document.getElementById(`node-card-${anchorNodeAfter.instanceId}`) : null;
    if (anchorElAfter) {
      const rectAfter = anchorElAfter.getBoundingClientRect();
      // translate() is the outermost function in updateTransform's transform list, so its effect on
      // the final screen position is a uniform, scale-independent shift - subtracting the anchor's
      // own screen-position drift from panX/panY cancels that drift for every card at once, not
      // just this one.
      window.panX -= (rectAfter.left - anchorRectBefore.left);
      window.panY -= (rectAfter.top - anchorRectBefore.top);
      updateTransform();
    }
  }

  // Drawn synchronously here too when preserveView - the anchor correction just above changed
  // panX/panY again, after recalculate() already drew once for the pre-correction position, same
  // reasoning as resetPanZoom's own comment.
  if (!preserveView) { resetPanZoom(); } else { drawConnectingLines(); window.scheduleConnectingLinesRedraw(); }

  const statusText = document.getElementById('status-text');
  const statusDot = document.getElementById('status-dot');
  if (statusText) statusText.textContent = 'TREE READY | UPDATING MARKET PRICES...';
  if (statusDot) statusDot.className = 'w-2.5 h-2.5 rounded-full bg-orange-400';

  const allTypeIds = new Set();
  window.collectAllTypeIds(window.recipeTreeRoot, allTypeIds);
  // Deliberately not awaited - selectItem's own caller (a click handler, or withRootPanAnchor
  // wrapping one) doesn't wait around for the real ESI price fetch to finish, or every rebuild
  // would freeze the UI for however long that network call takes. But that also meant this callback
  // ran completely outside any anchor's protection - by the time it fires, the click that started
  // this is long over and whatever wrapped it (withRootPanAnchor, if any) already measured its
  // "after" position and returned, with no idea this second render was still coming. On a fast/
  // cached local price fetch this lands so quickly it's invisible; against the real ESI API over a
  // real connection, especially for a tree with many priced materials, it can easily take long
  // enough to land well after the click - reported directly as the camera drifting on "almost any
  // action," including several (+1/-1 Layer, the optimizers, Bulk ME/TE Apply) that rebuild via this
  // exact function. Wrapping just this callback in its own withRootPanAnchor re-measures against
  // root's CURRENT position right before the price-driven re-render, so it's pinned regardless of
  // whatever else happened - or how long the fetch took - in between.
  window.fetchMarketPrices(Array.from(allTypeIds)).finally(async () => {
    if (statusDot) statusDot.className = 'w-2.5 h-2.5 rounded-full bg-green-400';
    if (statusText) statusText.textContent = 'RECIPES & PRICES LOADED';
    if (typeof window.withRootPanAnchor === 'function') {
      await window.withRootPanAnchor(async () => { await recalculate(); });
    } else {
      recalculate();
    }
  });
}

function collectGlobalDemand(node, demandMap = {}) {
  if (!node) return demandMap;
  const typeId = node.displayTypeId || node.typeId;
  if (!demandMap[typeId]) {
    demandMap[typeId] = { typeId, name: node.name, totalQtyNeeded: 0, isBuildingSelf: node.isBuildingSelf, batchYield: node.batchYield || 1, productTypeId: node.productTypeId, nodes: [] };
  }
  demandMap[typeId].totalQtyNeeded += node.qtyNeeded;
  demandMap[typeId].nodes.push(node);
  if (node.isBuildingSelf && node.children) {
    node.children.forEach(child => { if (child) collectGlobalDemand(child, demandMap); });
  }
  return demandMap;
}

function saveActiveState() {
  try {
    localStorage.setItem('eve_active_product', JSON.stringify(window.currentProduct));
    localStorage.setItem('eve_build_self_overrides', JSON.stringify(window.buildSelfOverrides));
    localStorage.setItem('eve_custom_buy_modes', JSON.stringify(window.customBuyModes));
    localStorage.setItem('eve_custom_me_overrides', JSON.stringify(window.customMEOverrides));
    localStorage.setItem('eve_custom_te_overrides', JSON.stringify(window.customTEOverrides));
    localStorage.setItem('eve_bulk_me_target', JSON.stringify(window.bulkMETarget || null));
    localStorage.setItem('eve_bulk_me_snapshot', JSON.stringify(window.bulkMEOriginalSnapshot || null));
    localStorage.setItem('eve_global_runs', window.globalRuns);
    localStorage.setItem('eve_global_jobs', window.globalJobs);
    localStorage.setItem('eve_root_sell_strategy', window.rootSellStrategy);
    localStorage.setItem('eve_root_custom_price', window.rootCustomPrice);
    // Keyed by pathKey (see nodeStableKey/tree.js), not the raw instanceId - stable across a full
    // reload's fresh tree build as long as the same product and build overrides come back too
    // (both saved right alongside these), which is exactly what loadSavedState restores first.
    localStorage.setItem('eve_collapsed_instance_ids', JSON.stringify(Array.from(window.collapsedInstanceIds || [])));
    localStorage.setItem('eve_expanded_override_ids', JSON.stringify(Array.from(window.expandedOverrideIds || [])));
    localStorage.setItem('eve_compact_visible_ids', JSON.stringify(Array.from(window.compactVisibleIds || [])));
    localStorage.setItem('eve_compact_all_mode', window.compactAllMode ? '1' : '0');
  } catch (e) { console.warn('[App] Failed to save the current build state - it will be lost on reload:', e); }
}

function loadSavedState() {
  try {
    window.buildSelfOverrides = window.safeParseJSON(localStorage.getItem('eve_build_self_overrides'), {});
    window.customBuyModes = window.safeParseJSON(localStorage.getItem('eve_custom_buy_modes'), {});
    window.customMEOverrides = window.safeParseJSON(localStorage.getItem('eve_custom_me_overrides'), {});
    window.customTEOverrides = window.safeParseJSON(localStorage.getItem('eve_custom_te_overrides'), {});
    window.bulkMETarget = window.safeParseJSON(localStorage.getItem('eve_bulk_me_target'), null);
    window.bulkMEOriginalSnapshot = window.safeParseJSON(localStorage.getItem('eve_bulk_me_snapshot'), null);
    window.globalRuns = parseInt(localStorage.getItem('eve_global_runs')) || 1;
    window.globalJobs = parseInt(localStorage.getItem('eve_global_jobs')) || 1;
    window.rootSellStrategy = localStorage.getItem('eve_root_sell_strategy') || 'market-sell';
    window.rootCustomPrice = parseFloat(localStorage.getItem('eve_root_custom_price')) || 0;
    window.collapsedInstanceIds = new Set(window.safeParseJSON(localStorage.getItem('eve_collapsed_instance_ids'), []));
    window.expandedOverrideIds = new Set(window.safeParseJSON(localStorage.getItem('eve_expanded_override_ids'), []));
    window.compactVisibleIds = new Set(window.safeParseJSON(localStorage.getItem('eve_compact_visible_ids'), []));
    window.compactAllMode = localStorage.getItem('eve_compact_all_mode') === '1';

    const savedProduct = window.safeParseJSON(localStorage.getItem('eve_active_product'), null);
    if (savedProduct && savedProduct.id && savedProduct.name) {
      selectItem(savedProduct.id, savedProduct.name, true);
    } else {
      selectItem(944, 'Punisher Blueprint');
    }
  } catch (e) { selectItem(944, 'Punisher Blueprint'); }
}

function recalculate() {
  if (!window.recipeTreeRoot) return;
  const activeEl = document.activeElement;
  const activeId = activeEl ? activeEl.id : null;

  syncTreeOverrides(window.recipeTreeRoot);
  // globalRuns is runs PER JOB; globalJobs is how many separate real jobs that represents (default
  // 1, so inputVal === globalRuns for every root that isn't using this - zero behavior change for
  // the vast majority of cards). See buildRecursiveRecipeTree's own comment on node.jobCount for why
  // this distinction exists: N separate jobs each round their own materials up independently, which
  // needs MORE material than one combined N*runsPerJob-run job would - relevant for a limited-run
  // BPC (redeemed from LP, or just several physical copies of a max-run BPC you're planning around).
  const runsPerJob = Math.max(1, window.globalRuns || 1);
  const jobCount = Math.max(1, window.globalJobs || 1);
  const inputVal = jobCount * runsPerJob;

  const { salesTax, brokerFee, facilityTax, sccSurcharge } = window.getActiveFeeInputs();
  const structureType = window.getActiveStructureType ? window.getActiveStructureType() : { costBonus: 5.0, meBonus: 1.0 };
  const structureRoleBonus = structureType.costBonus / 100;

  const contractTaxPercent = parseFloat(document.getElementById('contract-tax')?.value) || 0.5;
  const contractBrokerPercent = parseFloat(document.getElementById('contract-broker')?.value) || 1.65;
  const contractTaxRate = contractTaxPercent / 100;
  const contractBrokerRate = contractBrokerPercent / 100;

  const facility = structureType.meBonus / 100;
  const priceStrategy = document.getElementById('input-price-mode')?.value || 'sell';

  const rootYield = window.recipeTreeRoot.batchYield || 1;
  const rootRunsNeeded = inputVal;
  const totalRootOutputQty = rootYield * inputVal;

  window.recipeTreeRoot.qtyNeeded = totalRootOutputQty;
  window.recipeTreeRoot.runsNeeded = rootRunsNeeded;
  window.recipeTreeRoot.jobCount = jobCount;

  window.scaleTreeQuantities(window.recipeTreeRoot, facility);
  window.calculateNodeEIV(window.recipeTreeRoot);

  const globalDemand = collectGlobalDemand(window.recipeTreeRoot);
  let totalSurplusMaterialValue = 0;

  Object.values(globalDemand).forEach(item => {
    // CORRECTION: Exclude the root node's typeId (both blueprint and product IDs) from surplus credit! [1]
    const rootProductTypeId = window.recipeTreeRoot.productTypeId || window.recipeTreeRoot.typeId;
    if (item.typeId === window.recipeTreeRoot.typeId || item.typeId === rootProductTypeId || item.productTypeId === rootProductTypeId) {
      return;
    }

    if (item.isBuildingSelf && item.batchYield > 1) {
      const runs = Math.ceil(item.totalQtyNeeded / item.batchYield);
      const totalProduced = runs * item.batchYield;
      const netSurplusQty = totalProduced - item.totalQtyNeeded;
      if (netSurplusQty > 0) {
        const productTypeId = item.productTypeId || item.typeId;
        const prices = window.priceCache[productTypeId] || { sell: 0, buy: 0 };
        const unitPrice = prices.sell || prices.buy || window.getEIV(item.typeId) || 0;
        totalSurplusMaterialValue += netSurplusQty * unitPrice;
      }
    }
  });

  let rawMaterialCost = 0;
  if (window.recipeTreeRoot.isBuildingSelf && window.recipeTreeRoot.children && window.recipeTreeRoot.children.length > 0) {
    window.recipeTreeRoot.children.forEach(child => { rawMaterialCost += window.calculateTreeNodeCost(child); });
  } else {
    const rootStrategy = window.getNodePriceStrategy(window.recipeTreeRoot);
    const productTypeId = window.recipeTreeRoot.productTypeId || window.recipeTreeRoot.typeId;
    const prices = window.priceCache[productTypeId] || { sell: 0, buy: 0 };
    let unitPrice = rootStrategy === 'sell' ? prices.sell : prices.buy;
    if (rootStrategy === 'buy') { unitPrice = unitPrice * (1 + brokerFee); }
    const deductModeInput = document.getElementById('deduct-stock-mode');
    const isStockDeductEnabled = deductModeInput ? deductModeInput.value === 'true' : true;
    // stockAfterLedgerClaims, not raw userStockMap - see computeStockAfterLedgerClaims' own comment
    // in js/config.js.
    const rootStockPool = window.stockAfterLedgerClaims || window.userStockMap || {};
    const stockQty = isStockDeductEnabled ? (rootStockPool[productTypeId] || rootStockPool[window.recipeTreeRoot.typeId] || 0) : 0;
    const netRootQty = Math.max(0, totalRootOutputQty - stockQty);
    rawMaterialCost = unitPrice * netRootQty;
  }

  let effectiveMaterialCost = rawMaterialCost;
  let totalJobFees = window.calculateNodeJobFee(window.recipeTreeRoot, facilityTax, sccSurcharge, structureRoleBonus);
  let totalProductionCost = effectiveMaterialCost + totalJobFees;

  const rootProductTypeId = window.recipeTreeRoot.productTypeId || window.recipeTreeRoot.typeId;
  const outputPrices = window.priceCache[rootProductTypeId] || { sell: 0, buy: 0 };
  const selectedStrategy = window.rootSellStrategy || 'market-sell';
  let unitSellPrice = 0;
  let isContractMode = selectedStrategy === 'custom-contract';

  if (selectedStrategy === 'market-sell') { unitSellPrice = outputPrices.sell; }
  else if (selectedStrategy === 'custom-market-sell' || selectedStrategy === 'custom-contract') { unitSellPrice = window.rootCustomPrice || 0; }

  const grossSellRevenue = unitSellPrice * totalRootOutputQty;
  const grossBuyRevenue = outputPrices.buy * totalRootOutputQty;

  window.recipeTreeRoot.calculatedCost = totalProductionCost;
  window.recipeTreeRoot.outputMarketValue = grossSellRevenue;

  let netSellRevenue = grossSellRevenue;
  let netBuyRevenue = grossBuyRevenue * (1 - salesTax);

  if (isContractMode) {
    const cSalesTax = grossSellRevenue * contractTaxRate;
    const cBrokerFee = (grossSellRevenue * contractBrokerRate) + 10000;
    netSellRevenue = grossSellRevenue - cSalesTax - cBrokerFee;
    window.recipeTreeRoot.contractSalesTax = cSalesTax;
    window.recipeTreeRoot.contractBrokerFee = cBrokerFee;
  } else {
    netSellRevenue = grossSellRevenue * (1 - salesTax - brokerFee);
  }

  const profitSell = netSellRevenue + totalSurplusMaterialValue - totalProductionCost;
  const profitBuy = netBuyRevenue + totalSurplusMaterialValue - totalProductionCost;
  
  window.recipeTreeRoot.netProfitSell = profitSell;
  window.recipeTreeRoot.netProfitBuy = profitBuy;

  const roiSell = totalProductionCost > 0 ? ((profitSell / totalProductionCost) * 100).toFixed(1) : 0;
  const roiBuy = totalProductionCost > 0 ? ((profitBuy / totalProductionCost) * 100).toFixed(1) : 0;

  const summaryCostEl = document.getElementById('summary-build-cost');
  if (summaryCostEl) summaryCostEl.textContent = Math.round(totalProductionCost).toLocaleString() + ' ISK';
  const summarySubtextEl = document.getElementById('summary-runs-subtext');
  if (summarySubtextEl) summarySubtextEl.textContent = `Mat: ${Math.round(effectiveMaterialCost).toLocaleString()} + Fee: ${Math.round(totalJobFees).toLocaleString()}`;
  const summarySurplusEl = document.getElementById('summary-surplus-credit');
  if (summarySurplusEl) summarySurplusEl.textContent = Math.round(totalSurplusMaterialValue).toLocaleString() + ' ISK';
  const summaryOutSellEl = document.getElementById('summary-output-sell');
  if (summaryOutSellEl) summaryOutSellEl.textContent = Math.round(netSellRevenue).toLocaleString() + ' ISK';
  const summaryOutBuyEl = document.getElementById('summary-output-buy');
  if (summaryOutBuyEl) {
    if (isContractMode) { summaryOutBuyEl.textContent = 'Net Contract: ' + Math.round(netSellRevenue).toLocaleString() + ' ISK'; }
    else { summaryOutBuyEl.textContent = `Instant Buy: ${Math.round(netBuyRevenue).toLocaleString()} ISK`; }
  }

  const pSellEl = document.getElementById('summary-profit-sell');
  if (pSellEl) {
    pSellEl.textContent = Math.round(profitSell).toLocaleString() + ' ISK';
    pSellEl.className = `text-sm font-bold mt-0.5 mono ${profitSell >= 0 ? 'text-green-400' : 'text-red-500'}`;
  }
  const pSellLabelEl = document.getElementById('summary-profit-sell-label');
  if (pSellLabelEl) { pSellLabelEl.textContent = isContractMode ? 'Net Profit (Contract Output)' : 'Net Profit (Sell Output)'; }

  const roiSellEl = document.getElementById('summary-roi-sell');
  if (roiSellEl) {
    const finalRoi = totalProductionCost > 0 ? ((profitSell / totalProductionCost) * 100).toFixed(1) : 0;
    let label = (window.rootSellStrategy === 'custom-contract') ? 'Contract ROI' : 'Sell ROI';
    roiSellEl.textContent = `${label}: ${finalRoi}%`;
  }

  const pBuyEl = document.getElementById('summary-profit-buy');
  if (pBuyEl) {
    pBuyEl.textContent = Math.round(profitBuy).toLocaleString() + ' ISK';
    pBuyEl.className = `text-sm font-bold mt-0.5 mono ${profitBuy >= 0 ? 'text-green-400' : 'text-red-500'}`;
  }
  const roiBuyEl = document.getElementById('summary-roi-buy');
  if (roiBuyEl) roiBuyEl.textContent = `ROI: ${roiBuy}%`;

  // Total estimated build time across every job actually being manufactured in the tree - read
  // directly by the root card to show its own "Est. Build Time" and "Est. ISK/Hour" lines.
  const totalBuildSeconds = calculateTotalBuildSeconds(window.recipeTreeRoot);
  window.recipeTreeRoot.totalBuildSeconds = totalBuildSeconds;

  if (window.isolatedInstanceId) {
    let isoNode = findNodeByInstanceId(window.recipeTreeRoot, window.isolatedInstanceId);
    if (!isoNode && window.isolatedPathKey) {
      // A preserveView rebuild (toggleBuildSelf, an ME/TE edit - see selectItem's own comment)
      // hands every node a fresh instanceId, so the isolated node's old id no longer exists in the
      // new tree even though the SAME logical node still does. Re-find it by pathKey and re-sync
      // isolatedInstanceId, instead of falling through to "isolated node gone" and silently kicking
      // the user out of isolate mode just for clicking Build/Buy or editing ME/TE on a card.
      isoNode = findNodeByPathKey(window.recipeTreeRoot, window.isolatedPathKey);
      if (isoNode) window.isolatedInstanceId = isoNode.instanceId;
    }
    if (isoNode) { renderIsolatedDiagram(); } else { window.isolatedInstanceId = null; window.isolatedPathKey = null; updateIsolateModeBanner(); renderTreeDiagram(window.recipeTreeRoot, priceStrategy, profitSell, roiSell); }
  } else { renderTreeDiagram(window.recipeTreeRoot, priceStrategy, profitSell, roiSell); }
  
  renderBillOfMaterials(window.recipeTreeRoot, brokerFee);
  // Drawn synchronously, immediately, right here - not deferred at all. The cards above just got
  // torn down and rebuilt (and, for anything wrapped in withRootPanAnchor/recalculateWithPanAnchor,
  // panX/panY just jumped to compensate), which moves every card INSTANTLY via the CSS transform,
  // but the SVG lines are a separate overlay that only gets its coordinates from drawConnectingLines
  // - leaving them for later, however briefly, always shows SOMETHING wrong in the meantime: first
  // it was the OLD lines sitting stale at their OLD coordinates (reported as jumping "a quarter of a
  // screen" to the right on Collapse); clearing immediately and deferring the redraw instead fixed
  // that but traded it for a brief blank flash (reported as a flicker on page load/Collapse) - and
  // that flash turned out to be timing-sensitive enough to only show up in some browsers (Chrome,
  // not Vivaldi) even after tightening the delay. Drawing for real right here, synchronously, means
  // there's simply never a gap for either artifact to appear in - getBoundingClientRect() (which
  // drawConnectingLines uses throughout) forces a real layout flush, so this reflects the ACTUAL
  // just-rebuilt DOM, not stale data. The one thing this can still miss: a handful of cards using
  // content-visibility's off-screen placeholder size if the browser hasn't gotten around to
  // measuring their true size yet (see createNodeCard's own comment on why root specifically is
  // excluded from that) - scheduleConnectingLinesRedraw right after is a silent follow-up correction
  // for exactly that edge case, not the primary draw, so on the vastly more common case where
  // nothing was mid-placeholder, this second pass repaints something already correct and changes
  // nothing visible at all.
  drawConnectingLines();
  window.scheduleConnectingLinesRedraw();
  if (typeof window.updateMissingSkillsUI === 'function') window.updateMissingSkillsUI();

  saveActiveState();
  try {
    localStorage.setItem('eve_raw_assets', JSON.stringify(window.rawAssetItems || []));
    localStorage.setItem('eve_resolved_location_names', JSON.stringify(window.resolvedLocationNames || {}));
    localStorage.setItem('eve_corp_division_names', JSON.stringify(window.corpDivisionNames || {}));
    localStorage.setItem('eve_user_stock_map', JSON.stringify(window.userStockMap || {}));
  } catch (err) {}

  if (activeId) {
    const newActiveEl = document.getElementById(activeId);
    if (newActiveEl) {
      newActiveEl.focus();
      const val = newActiveEl.value;
      newActiveEl.value = '';
      newActiveEl.value = val;
    }
  }
}

// A column with more siblings than this auto-compacts to chips without needing an explicit click -
// see renderTreeDiagram's second pass below. Chosen to roughly match "still comfortably fits on one
// screen without scrolling" for a typical window height at the default zoom.
const AUTO_COMPACT_SIBLING_THRESHOLD = 8;

// collapsedInstanceIds/expandedOverrideIds key off this rather than the raw instanceId - instanceId
// is a monotonically-increasing counter (tree.js) that a preserveView rebuild (toggleBuildSelf,
// buildAllComponents, an ME/TE edit) hands out fresh on every node, so a Set keyed by instanceId
// alone goes entirely stale the moment any of those run, silently reverting every manually-expanded
// card back to whatever the auto-compact threshold says. node.pathKey (tree.js) is the chain of
// typeIds from root to this position, which stays identical across such a rebuild as long as the
// tree's shape above this node hasn't changed - falls back to instanceId for the rare hand-built
// node that never went through buildRecursiveRecipeTree (an LP Store synthetic root/redemption node).
function nodeStableKey(node) { return (node && node.pathKey) || (node && node.instanceId); }

// Rescales a node's ALREADY-FETCHED subtree (children, grandchildren, ...) to a new target quantity
// and recomputes everything that depends on quantity - runs, EIV, cost, job fee - to match. This is
// the shared "resize this branch to one combined batch" primitive behind both the same-tier diagram
// merge (renderSubtreeColumns, below) and the Ledger's own job-queue merge
// (resolveStockAwareSubBuilds) - both need the SAME real EVE mechanic (ME rounds up once for the
// WHOLE batch, not once per separate smaller job - confirmed directly: 5 separate 5-run jobs at 3%
// ME need 245 total material, one combined 25-run job needs only 243) applied the same way, so they
// can never disagree with each other about what "combined" means. Mutates node in place - callers
// that need the original values back (like resolveStockAwareSubBuilds' existing save/restore dance
// around a single node) are responsible for restoring them themselves afterward.
function rescaleNodeToQuantity(node, qty, facility) {
  node.qtyNeeded = qty;
  if (typeof window.scaleTreeQuantities === 'function') window.scaleTreeQuantities(node, facility);
  if (typeof window.calculateNodeEIV === 'function') window.calculateNodeEIV(node);
  if (typeof window.calculateTreeNodeCost === 'function') window.calculateTreeNodeCost(node);
  const feeInputs = typeof window.getActiveFeeInputs === 'function' ? window.getActiveFeeInputs() : { facilityTax: 0, sccSurcharge: 0 };
  const structureType = typeof window.getActiveStructureType === 'function' ? window.getActiveStructureType() : { costBonus: 0 };
  if (typeof window.calculateNodeJobFee === 'function') window.calculateNodeJobFee(node, feeInputs.facilityTax, feeInputs.sccSurcharge, (structureType.costBonus || 0) / 100);
}
window.rescaleNodeToQuantity = rescaleNodeToQuantity;

// The traverse/merge/auto-compact/column-render pipeline, factored out of renderTreeDiagram so
// renderIsolatedDiagram can reuse it unchanged for just a subtree - isolating a component used to
// show only its direct children and direct parent (one level each way), which meant it could never
// answer "what does this whole branch actually look like." Running the exact same pipeline rooted
// at the isolated node instead of window.recipeTreeRoot gives the full recursive branch, with the
// same per-tier compacting/merging that already keeps a capital ship's full tree manageable -
// without needing a second, parallel implementation of any of this to keep in sync.
function renderSubtreeColumns(container, rootNode) {
  if (!rootNode) return;
  const levels = [];
  function traverse(node) {
    if (!node) return;
    if (!levels[node.depth]) levels[node.depth] = [];
    levels[node.depth].push(node);
    // A collapsed node still renders itself, but its children (and everything beneath them) are
    // hidden from every depth column - this is what actually shrinks a runaway-tall build. A node
    // no longer in "build" mode gets the same treatment: buildRecursiveRecipeTree only fetches a
    // node's children while isBuildingSelf is true (tree.js), so flipping a node from Build back to
    // Buy later WITHOUT a full rebuild (the Min Profit optimizer does exactly this - a flag-sync +
    // recalculate, not selectItem() - see applyBuildProfitOptimizer's own comment on why) leaves
    // node.children still populated with stale data from when it WAS building. drawLinesForNode
    // already skips drawing a line to a non-building node's children; without the same check here,
    // those stale children kept getting cards rendered anyway - present on screen with no line
    // connecting them to anything, exactly the bug this fixes. Only EXPLICIT collapse is checked
    // here - auto-compact (below) can't be folded into this same recursive pass, since a depth's
    // final sibling count isn't known until every branch feeding it has been visited, which for a
    // node with several parents-in-common ancestors doesn't happen until traversal is done.
    if (window.collapsedInstanceIds.has(nodeStableKey(node)) || !node.isBuildingSelf) return;
    if (node.children) { node.children.forEach(child => { if (child) traverse(child); }); }
  }
  traverse(rootNode);

  // Second pass: merge same-tier duplicates of the same material - e.g. five different components
  // in one column all separately needing Tritanium used to render as five near-identical cards.
  // Two eligible cases: a true leaf (nothing beneath it, so there's nothing to reconcile - raw/
  // bought materials, the common case), or a Build-mode branch with its own children. The branch
  // case used to be excluded entirely (a merged branch's own children would need different
  // quantities of ITS OWN inputs too, recursively) - resolved by actually recomputing them:
  // rescaleNodeToQuantity (above) resizes the survivor's WHOLE already-fetched subtree to the
  // combined total using the same real EVE mechanic (ME rounds once for the whole batch, not once
  // per separate smaller job), and the other branches' entire subtrees are dropped from rendering
  // via markSubtreeAsLoser below - their real tree data is untouched (BOM/cost totals elsewhere
  // still sum every individual instance correctly), only what the diagram draws changes. Connecting
  // lines need no extra work either way: every one of the original consumers still iterates its own
  // real child node object when drawing lines (drawConnectingLinesForTree), and mergeRedirect
  // already sends every one of those - survivor's own instanceId included, via the `|| child.
  // instanceId` fallback - to the one surviving card's id, so they naturally fan in on it.
  // Runs before auto-compact (below) so the sibling-count threshold judges the column AFTER
  // dedup, not before - a tier that looks like 15 siblings but is really 3 duplicate materials +
  // 9 unique ones should be judged as 9-ish wide, not 15.
  const mergeRedirect = {};
  const loserInstanceIds = new Set();
  const facilityForMerge = (window.getActiveStructureType ? window.getActiveStructureType().meBonus : 1.0) / 100;
  function markSubtreeAsLoser(node) {
    if (!node) return;
    loserInstanceIds.add(node.instanceId);
    (node.children || []).forEach(markSubtreeAsLoser);
  }
  levels.forEach((nodesAtDepth, depth) => {
    if (!nodesAtDepth || depth === 0) return;
    const groups = new Map();
    nodesAtDepth.forEach(node => {
      if (loserInstanceIds.has(node.instanceId)) return; // subtree of an earlier (shallower) merge this same pass - already spoken for
      const isTrueLeaf = (!node.children || node.children.length === 0) && !node.isBuildingSelf;
      const isBuildableBranch = node.isBuildingSelf && node.isManufacturable && node.children && node.children.length > 0;
      if (!isTrueLeaf && !isBuildableBranch) return;
      const pid = node.productTypeId || node.typeId;
      if (!groups.has(pid)) groups.set(pid, []);
      groups.get(pid).push(node);
    });
    const mergedAwayIds = new Set();
    groups.forEach(group => {
      if (group.length < 2) return;
      const survivor = group[0];
      // parentName is captured now (not looked up later from a bare id) purely so the tooltip
      // can say WHICH component needs how much, not just a count - findNodeByInstanceId is cheap
      // enough here since a merge group is realistically a handful of nodes, not hundreds.
      survivor._mergedSources = group.map(n => {
        const parent = n.parentInstanceId ? findNodeByInstanceId(rootNode, n.parentInstanceId) : null;
        const parentName = parent ? (parent.productName || parent.name.replace(/ Blueprint$/i, '').replace(/ Reaction Formula$/i, '').replace(/ Formula$/i, '').trim()) : 'this build';
        return { instanceId: n.instanceId, qtyNeeded: n.qtyNeeded, parentName };
      });
      survivor._mergedQtyNeeded = group.reduce((sum, n) => sum + (n.qtyNeeded || 0), 0);
      if (survivor.isBuildingSelf) {
        rescaleNodeToQuantity(survivor, survivor._mergedQtyNeeded, facilityForMerge);
        survivor._mergedCost = survivor.calculatedCost; // the real recomputed combined-batch cost, not a sum of separately-rounded parts
        for (let i = 1; i < group.length; i++) markSubtreeAsLoser(group[i]);
      } else {
        survivor._mergedCost = group.reduce((sum, n) => sum + (n.calculatedCost || 0), 0);
      }
      for (let i = 1; i < group.length; i++) {
        mergeRedirect[group[i].instanceId] = survivor.instanceId;
        mergedAwayIds.add(group[i].instanceId);
      }
    });
    if (mergedAwayIds.size > 0) {
      levels[depth] = nodesAtDepth.filter(n => !mergedAwayIds.has(n.instanceId));
    }
  });
  // A Build-mode merge's losing branches are dropped entirely, not just at the depth they were
  // found - their whole subtree (already collected into deeper levels by the traverse pass above)
  // needs to go too, or their now-superseded, never-rescaled children would render as orphaned
  // duplicates of the survivor's own freshly-rescaled ones.
  if (loserInstanceIds.size > 0) {
    for (let d = 0; d < levels.length; d++) {
      if (levels[d]) levels[d] = levels[d].filter(n => !loserInstanceIds.has(n.instanceId));
    }
  }
  // drawConnectingLinesForTree reads this to redirect a merged-away child's line endpoint to the
  // surviving card - every original parent still iterates its own real child node objects (the
  // tree's actual parent/child relationships are untouched, only which nodes get their own
  // rendered card changes), so this is the only place that needs to know a merge happened at all.
  window.__mergeRedirect = mergeRedirect;

  // Third pass: auto-compact any column wider than AUTO_COMPACT_SIBLING_THRESHOLD - shrinks a chip
  // for being crowded, same as compactVisibleIds/compactAllMode above, WITHOUT hiding what's
  // underneath (see markDescendantsHidden's own comment below for why this changed). This is what
  // makes a huge build manageable without first having to know to click Collapse All. An explicit
  // choice always wins over this rule in either direction: collapsedInstanceIds forces compact even
  // in a small column, expandedOverrideIds forces full-size even in an oversized one (see
  // toggleNodeCollapse).
  const autoCompactIds = new Set();
  const hiddenByCompactIds = new Set();
  // Only Collapse All (collapsedInstanceIds, below) still calls this - it used to also fire for a
  // column just being over the auto-compact sibling threshold, which meant a card with a lot of
  // siblings (a capital ship easily has 15-20 top-level components, well past the 8-sibling
  // threshold) silently hid every one of ITS OWN descendants too, with no explicit collapse ever
  // requested. Reported directly: "+1 Layer"'s newly-revealed tier wasn't appearing at all - it was
  // rendering fine in the underlying data, just immediately hidden by this rule on its own parent
  // tier, which had nothing to do with the tier the user just asked to reveal. Auto-compact-for-
  // overflow now gets the same "shrink but stay visible and connected" treatment as
  // compactVisibleIds/compactAllMode above - it was never supposed to be a second way to hide things,
  // only a way to keep a wide column from overwhelming the screen.
  function markDescendantsHidden(node) {
    if (!node || !node.children) return;
    node.children.forEach(child => {
      if (!child) return;
      hiddenByCompactIds.add(child.instanceId);
      markDescendantsHidden(child);
    });
  }
  levels.forEach((nodesAtDepth, depth) => {
    if (!nodesAtDepth || depth === 0) return;
    const overCap = nodesAtDepth.length > AUTO_COMPACT_SIBLING_THRESHOLD;
    nodesAtDepth.forEach(node => {
      // Compact All (compactAllNodes, below) is a different thing from Collapse All/auto-compact -
      // it renders every card as a small chip WITHOUT hiding what's under it, so the whole tree
      // stays visible and every chip still connects to the next layer, just shrunk. Deliberately
      // skips markDescendantsHidden below - that's the one call that actually hides anything, and
      // this mode's whole point is not to.
      if (window.compactAllMode) {
        autoCompactIds.add(node.instanceId);
        return;
      }
      const key = nodeStableKey(node);
      // Individually compacting ONE card (Space, a chip's own click, the per-card "Compact" button -
      // all toggleNodeCollapse) used to go through collapsedInstanceIds below, which hides whatever
      // was underneath it too - reported directly as pressing Space to compact a card hiding its own
      // connections, when the actual ask was Compact All's per-node treatment (shrink, stay visible
      // and connected) applied to just that one card. compactVisibleIds is that: same chip render,
      // deliberately skips markDescendantsHidden exactly like Compact All does above.
      if (window.compactVisibleIds.has(key)) {
        autoCompactIds.add(node.instanceId);
        return;
      }
      if (window.collapsedInstanceIds.has(key)) {
        autoCompactIds.add(node.instanceId);
        markDescendantsHidden(node);
        return;
      }
      if (overCap && !window.expandedOverrideIds.has(key)) {
        autoCompactIds.add(node.instanceId);
      }
    });
  });
  if (hiddenByCompactIds.size > 0) {
    for (let d = 0; d < levels.length; d++) {
      if (levels[d]) levels[d] = levels[d].filter(n => !hiddenByCompactIds.has(n.instanceId));
    }
  }

  // Each depth level is one plain single-file column - deliberately NOT a wrapping grid. That was
  // tried (wrap into a grid of sub-columns once a tier has many siblings) and reverted: it broke
  // the diagram's actual point, which is showing WHICH card connects to WHICH - a line between two
  // cards that used to travel cleanly through the empty gap between two single-file columns now had
  // to cross through whatever unrelated cards the grid happened to place in its path, and since
  // #tree-svg renders behind .diagram-node (z-index 1 vs 2 - fine when lines rarely cross a card,
  // not fine once they routinely do), those crossings were often just invisible. Collapsing (now
  // including auto-compact above) is what actually carries the size fix: a capital ship's wide top
  // tier collapsing down to one-line chips already took a real 178,000px-tall column down to
  // ~1,750px on its own, without needing to touch how siblings are arranged at all.
  levels.reverse().forEach((nodesAtDepth) => {
    const colDiv = document.createElement('div');
    colDiv.className = 'flex flex-col space-y-6 justify-center';
    nodesAtDepth.forEach(node => { if (node) { colDiv.appendChild(createNodeCard(node, autoCompactIds.has(node.instanceId))); } });
    container.appendChild(colDiv);
  });
}

function renderTreeDiagram(rootNode, priceStrategy, profitSell, roiSell) {
  const container = document.getElementById('tree-container');
  if (!container) return;
  container.innerHTML = '';
  if (!rootNode) return;
  renderSubtreeColumns(container, rootNode);
  applyNodeHighlightClasses();
}

// Counts every descendant currently hidden beneath a collapsed node, for the "N hidden" badge.
function countDescendants(node) {
  if (!node || !node.children) return 0;
  let count = 0;
  node.children.forEach(child => {
    if (child) count += 1 + countDescendants(child);
  });
  return count;
}

// Shared by every per-card control that only ever needs a plain recalculate() - never a full tree
// rebuild via selectItem (Hide/Compact, the Sell/Buy/LP acquisition pill, the compact chip's own
// toggle icon) - so each of those stays pinned to its current screen position through the
// re-render, exactly like selectItem's own anchorInstanceId mechanism already does for Build/Buy
// mode and ME/TE edits (see its own comment for the full "why" - reflow of the content AROUND a
// card visibly shifts it even though panX/panY themselves never change). Those three controls were
// each independently calling recalculate() directly with no compensation at all, reported directly
// as the camera jumping on Hide/Compact on both the Calculator and LP Store pages.
//
// A plain recalculate() never rebuilds the tree via buildRecursiveRecipeTree, so the anchor almost
// always keeps its own instanceId - the fast path below (same node-card-{instanceId} element,
// compact chips included, since createNodeCard sets card.id unconditionally either way) covers the
// Calculator and most of the LP Store. The one exception: js/lpstore.js's recalculate hook rebuilds
// EVERY redemption-requirement child fresh, with a brand new instanceId, on every single pass - even
// for a plain Hide/Compact click on one of those cards specifically (see ensureLPRedemptionNodesPresent's
// own comment on why it re-derives them every time, not just once). pathKey and, failing that,
// _lpRequiredItemProductTypeId (the one identity that survives even a required item's own flat-stub
// <-> real-subtree transition - see injectLPRedemptionNodes' own comment) are the fallbacks for that
// case, tried in order from cheapest/most-common to most specific.
//
// On the LP Store specifically, the anchor is always the ROOT card, never whatever was actually
// clicked - reported directly as "the camera drifts a lot" there despite the exact clicked card
// provably staying at 0px drift. The reason: columns lay out left-to-right by depth with the root
// always rightmost (renderTreeDiagram, js/app.js) - building a required item for the first time
// inserts a whole new run of columns for its own materials BETWEEN it and the root, so even with
// the clicked card perfectly pinned, the root - and the LP Economics card appended just past it,
// which is the whole point of this interaction, checking how the numbers just changed - visibly
// shifts anyway, simply because there's now more diagram between them than there was a moment ago.
// No single fixed anchor can prevent that when new content is inserted in between two points; the
// fix is choosing the anchor the user is actually watching (root/economics), not the button they
// happened to click, letting the clicked card itself be the one that moves instead.
async function recalculateWithPanAnchor(e) {
  const isLPStore = !!(window.recipeTreeRoot && window.recipeTreeRoot.isLPIsolatedRoot);
  const anchorEl = isLPStore
    ? (window.recipeTreeRoot ? document.getElementById(`node-card-${window.recipeTreeRoot.instanceId}`) : null)
    : (e && e.target ? e.target.closest('.diagram-node') : null);
  const anchorInstanceId = anchorEl ? anchorEl.getAttribute('data-instance-id') : null;
  const rectBefore = anchorEl ? anchorEl.getBoundingClientRect() : null;
  const anchorNodeBefore = (anchorInstanceId != null && window.recipeTreeRoot)
    ? findNodeByInstanceId(window.recipeTreeRoot, parseInt(anchorInstanceId)) : null;
  const anchorPathKey = anchorNodeBefore ? anchorNodeBefore.pathKey : null;
  const anchorProductTypeId = anchorNodeBefore ? anchorNodeBefore._lpRequiredItemProductTypeId : undefined;

  if (typeof window.recalculate === 'function') await window.recalculate();

  if (!rectBefore || !window.recipeTreeRoot) return;

  let anchorElAfter = anchorInstanceId != null ? document.getElementById(`node-card-${anchorInstanceId}`) : null;
  if (!anchorElAfter) {
    let anchorNodeAfter = anchorPathKey ? findNodeByPathKey(window.recipeTreeRoot, anchorPathKey) : null;
    if (!anchorNodeAfter && anchorProductTypeId !== undefined) {
      (function findByRequiredItemProductTypeId(node) {
        if (!node || anchorNodeAfter) return;
        if (node._lpRequiredItemProductTypeId === anchorProductTypeId) { anchorNodeAfter = node; return; }
        if (node.children) node.children.forEach(findByRequiredItemProductTypeId);
      })(window.recipeTreeRoot);
    }
    anchorElAfter = anchorNodeAfter ? document.getElementById(`node-card-${anchorNodeAfter.instanceId}`) : null;
  }

  if (anchorElAfter) {
    const rectAfter = anchorElAfter.getBoundingClientRect();
    window.panX -= (rectAfter.left - rectBefore.left);
    window.panY -= (rectAfter.top - rectBefore.top);
    updateTransform();
  }
}
window.recalculateWithPanAnchor = recalculateWithPanAnchor;

// Anchors on the root card through an arbitrary async action, regardless of page - for bulk
// sidebar buttons (Build All, Buy All, +1/-1 Layer) that have no single clicked card to pin the
// way per-card controls do (selectItem's own anchorInstanceId, recalculateWithPanAnchor's
// e.target lookup): they're triggered from the Build flyout panel, not a diagram card, and can
// insert or remove any number of columns anywhere in the tree at once. Root (and whatever's
// rendered right after it) is what you're actually watching to see the overall effect of a bulk
// change, same reasoning as recalculateWithPanAnchor's own LP Store branch - just generalized to
// every page and every bulk action instead of one page's per-card clicks. Reported directly: Build
// All, Buy All, and the two Layer buttons all visibly moved the camera, unlike every other control.
// Measures root ONCE before and ONCE after the whole action (not per intermediate rebuild inside
// it, e.g. Build All's own mark-then-rebuild loop) via pathKey, which survives a rebuild's fresh
// instanceIds the same way every other anchor lookup here already relies on.
async function withRootPanAnchor(action) {
  const rootBefore = window.recipeTreeRoot;
  const anchorElBefore = rootBefore ? document.getElementById(`node-card-${rootBefore.instanceId}`) : null;
  const rectBefore = anchorElBefore ? anchorElBefore.getBoundingClientRect() : null;
  const anchorPathKey = rootBefore ? rootBefore.pathKey : null;

  await action();

  if (!rectBefore || !anchorPathKey || !window.recipeTreeRoot) return;
  const anchorNodeAfter = findNodeByPathKey(window.recipeTreeRoot, anchorPathKey);
  const anchorElAfter = anchorNodeAfter ? document.getElementById(`node-card-${anchorNodeAfter.instanceId}`) : null;
  if (anchorElAfter) {
    const rectAfter = anchorElAfter.getBoundingClientRect();
    window.panX -= (rectAfter.left - rectBefore.left);
    window.panY -= (rectAfter.top - rectBefore.top);
    updateTransform();
  }
}
window.withRootPanAnchor = withRootPanAnchor;

// A node can be compact for three different reasons - explicitly collapsed (Collapse All - hides
// descendants), individually compacted (this function, on a single card - does NOT hide
// descendants), or auto-compacted for sitting in an oversized column (renderTreeDiagram) - and a
// click always means "flip whatever it's actually showing right now," not "toggle one specific flag"
// (which would be a no-op on an auto-compacted chip that was never explicitly touched in the first
// place). Reading the card's own rendered class is the simplest single source of truth for "which
// one is it right now" without duplicating the sibling-count threshold logic here too.
//
// Compacting HERE always goes through compactVisibleIds, never collapsedInstanceIds - reported
// directly: pressing Space to compact one selected card was hiding its connections to whatever was
// underneath it, when the actual ask was the same "shrink but stay visible and connected" treatment
// Compact All already gives the whole tree, just scoped to one card. collapsedInstanceIds (the
// hiding one) is now reserved for Collapse All alone - this function, the compact chip's own click,
// and the per-card "Compact" button all route through the non-hiding set instead.
async function toggleNodeCollapse(e, instanceId, pathKey) {
  if (e) e.stopPropagation();
  // The inline onclick="...(event, id, '${node.pathKey}')" build (below) stringifies a genuinely
  // missing pathKey into the literal text "undefined" rather than an actual undefined value - guard
  // against that specific string too, or a node lacking a pathKey silently collapses/expands under
  // a meaningless shared key instead of falling back to its own instanceId.
  const key = (pathKey && pathKey !== 'undefined') ? pathKey : instanceId;
  const cardEl = document.getElementById(`node-card-${instanceId}`);
  const currentlyCompact = cardEl ? cardEl.classList.contains('diagram-node-compact') : (window.collapsedInstanceIds.has(key) || window.compactVisibleIds.has(key));
  if (currentlyCompact) {
    // Expand: force full-size regardless of why it was compact - just clearing one of the two
    // compact sets wouldn't be enough if the column is still over the auto-compact threshold
    // (expandedOverrideIds covers that), or if it got here via the OTHER compact set somehow.
    window.collapsedInstanceIds.delete(key);
    window.compactVisibleIds.delete(key);
    window.expandedOverrideIds.add(key);
  } else {
    window.expandedOverrideIds.delete(key);
    window.compactVisibleIds.add(key);
  }
  await recalculateWithPanAnchor(e);
}
window.toggleNodeCollapse = toggleNodeCollapse;

// Collapses every node in the tree except the root - a leaf (nothing to hide) still collapses,
// purely to save space, same as any other node now. Root itself is deliberately never collapsible
// (createNodeCard excludes it outright) - collapsing it here anyway used to hide the root's own
// children from the tree entirely (traverse's own early-return doesn't know root is special),
// which is why Collapse All previously left only the root card visible instead of a column of chips.
// The Collapse/Expand buttons pulse once for a first-time visitor (same trick as the Community
// button - see initCommunityMenuButton) until they're actually used once, then never again.
function markCollapseExpandSeen() {
  if (localStorage.getItem('eve_collapse_btn_seen') === '1') return;
  localStorage.setItem('eve_collapse_btn_seen', '1');
  const btn = document.getElementById('collapse-all-btn');
  if (btn) btn.classList.remove('community-btn-pulse');
}

// Wrapped in withRootPanAnchor (app.js) like every other sidebar button - reported directly: this
// (and Expand All/Compact All below) used to always recenter the camera on the root via
// centerOnRootNode() afterward, which is exactly the kind of unrequested camera move that was
// already fixed for Build All/Buy All/the Layer buttons/the optimizers - the rule is the camera only
// ever moves for an action that's explicitly ABOUT the camera (F, right-click drag, scroll), never
// as a side effect of a state-changing button. Root now just stays pinned where it already was.
async function collapseAllNodes() {
  if (!window.recipeTreeRoot) return;
  markCollapseExpandSeen();
  window.compactAllMode = false; // a real hide, not the "shrink but keep everything visible" mode
  function walk(node, isRoot) {
    if (!node) return;
    if (!isRoot) {
      const key = nodeStableKey(node);
      window.collapsedInstanceIds.add(key);
      window.expandedOverrideIds.delete(key);
      window.compactVisibleIds.delete(key);
    }
    if (node.children) node.children.forEach(c => walk(c, false));
  }
  walk(window.recipeTreeRoot, true);
  await window.withRootPanAnchor(async () => {
    if (typeof window.recalculate === 'function') await window.recalculate();
  });
}
window.collapseAllNodes = collapseAllNodes;

// Forces every node full-size right now, including anything that would otherwise auto-compact for
// being in an oversized column - a snapshot action (like Collapse All), not a standing "never
// auto-compact again" mode, so a later switch to an even bigger build still auto-compacts normally.
async function expandAllNodes() {
  markCollapseExpandSeen();
  window.compactAllMode = false;
  window.collapsedInstanceIds.clear();
  window.compactVisibleIds.clear();
  function walk(node, isRoot) {
    if (!node) return;
    if (!isRoot) window.expandedOverrideIds.add(nodeStableKey(node));
    if (node.children) node.children.forEach(c => walk(c, false));
  }
  if (window.recipeTreeRoot) walk(window.recipeTreeRoot, true);
  await window.withRootPanAnchor(async () => {
    if (typeof window.recalculate === 'function') await window.recalculate();
  });
}
window.expandAllNodes = expandAllNodes;

// Compact All - deliberately different from Collapse All: that one (and plain auto-compact) hides
// every descendant of whatever it compacts, which is what actually shrinks a runaway-tall build,
// but also means you lose the ability to see how anything deeper connects. This shrinks EVERY card
// in the whole tree down to a small chip WITHOUT hiding anything - the full structure, every layer,
// stays visible and connected, just much smaller - reported directly as wanted alongside Collapse
// All, not instead of it. See renderSubtreeColumns' own compactAllMode branch (right above
// markDescendantsHidden) for the render-side half of this - that's the part that actually skips
// hiding descendants when this mode is active.
async function compactAllNodes() {
  if (!window.recipeTreeRoot) return;
  markCollapseExpandSeen();
  window.compactAllMode = true;
  window.collapsedInstanceIds = new Set();
  window.expandedOverrideIds = new Set();
  window.compactVisibleIds = new Set();
  await window.withRootPanAnchor(async () => {
    if (typeof window.recalculate === 'function') await window.recalculate();
  });
}
window.compactAllNodes = compactAllNodes;

// Stops the Collapse button's pulse before it ever plays for a returning visitor - same reasoning
// as initCommunityMenuButton (the static HTML always starts with the class present, so a fresh
// visitor sees it with no flash either way).
function initCollapseExpandPulse() {
  if (localStorage.getItem('eve_collapse_btn_seen') === '1') {
    const btn = document.getElementById('collapse-all-btn');
    if (btn) btn.classList.remove('community-btn-pulse');
  }
}
window.initCollapseExpandPulse = initCollapseExpandPulse;
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCollapseExpandPulse);
} else {
  initCollapseExpandPulse();
}

// A short, sequenced onboarding tour through #pan-tip-callout (same element/position/pulse styling
// throughout - only the icon/text/button swap between steps): right-click-to-pan, then arrow-key
// tree walking, then the F/I/Space shortcuts. Shown once ever, one step at a time, each advanced
// ONLY by its own button click - not by touching the canvas or pressing the real key, same
// reasoning as the single pan tip this replaced: an accidental trigger shouldn't count as "seen,"
// or someone could blow through the whole tour by accident without reading any of it. Same
// "static-visible, JS hides it for a returning visitor" pattern as the Collapse button's pulse
// above, so there's no flash for a first-timer - the static HTML already shows step 1's own
// content, so even a slow JS init still shows something correct in the meantime.
const ONBOARDING_TIPS = [
  {
    icon: '<path d="M12 3a6 6 0 0 1 6 6v6a6 6 0 0 1-12 0V9a6 6 0 0 1 6-6z"/><line x1="12" y1="3.2" x2="12" y2="11"/><path d="M12 3.2a6 6 0 0 1 5.9 5.8h-5.9z" fill="var(--accent)" stroke="none"/>',
    html: 'Right-click + drag to <span class="text-white font-bold">pan</span> the canvas'
  },
  {
    icon: '<polyline points="12,3 12,21"/><polyline points="3,12 21,12"/><polyline points="9,6 12,3 15,6"/><polyline points="9,18 12,21 15,18"/><polyline points="6,9 3,12 6,15"/><polyline points="18,9 21,12 18,15"/>',
    html: 'Use <span class="text-white font-bold">arrow keys</span> to walk the tree, card to card'
  },
  {
    icon: '<rect x="2.5" y="6.5" width="19" height="11" rx="2"/><line x1="6" y1="10.5" x2="6.01" y2="10.5"/><line x1="10" y1="10.5" x2="10.01" y2="10.5"/><line x1="14" y1="10.5" x2="14.01" y2="10.5"/><line x1="18" y1="10.5" x2="18.01" y2="10.5"/><line x1="7.5" y1="14" x2="16.5" y2="14"/>',
    html: '<span class="text-white font-bold">F</span> centers the selected card &middot; <span class="text-white font-bold">I</span> isolates it &middot; <span class="text-white font-bold">Space</span> compacts/expands it'
  }
];
let onboardingTipStep = 0;

function renderOnboardingTip() {
  const el = document.getElementById('pan-tip-callout');
  if (!el) return;
  const step = ONBOARDING_TIPS[onboardingTipStep];
  const isLast = onboardingTipStep === ONBOARDING_TIPS.length - 1;
  el.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5 flex-shrink-0" style="color:var(--accent);">${step.icon}</svg>
    <span class="text-slate-200 font-semibold">${step.html}</span>
    <button onclick="advanceOnboardingTip()" class="btn-glass px-2.5 py-1 text-[10.5px] font-bold flex-shrink-0" style="white-space:nowrap;">${isLast ? 'Got it' : 'Next'}</button>
  `;
}

function advanceOnboardingTip() {
  onboardingTipStep++;
  if (onboardingTipStep >= ONBOARDING_TIPS.length) {
    localStorage.setItem('eve_onboarding_tips_seen', '1');
    const el = document.getElementById('pan-tip-callout');
    if (el) el.classList.add('hidden');
    return;
  }
  renderOnboardingTip();
}
window.advanceOnboardingTip = advanceOnboardingTip;

function initOnboardingTip() {
  const el = document.getElementById('pan-tip-callout');
  if (!el) return;
  if (localStorage.getItem('eve_onboarding_tips_seen') === '1') {
    el.classList.add('hidden');
    return;
  }
  renderOnboardingTip();
}
window.initOnboardingTip = initOnboardingTip;
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initOnboardingTip);
} else {
  initOnboardingTip();
}

function createNodeCard(node, autoCompact) {
  const productTypeId = node.productTypeId || node.typeId;
  const prices = window.priceCache[productTypeId] || { sell: 0, buy: 0 };
  const isRoot = node.depth === 0;
  const isIsolated = node.instanceId === window.isolatedInstanceId;
  const deductModeInput = document.getElementById('deduct-stock-mode');
  const isStockDeductEnabled = deductModeInput ? deductModeInput.value === 'true' : true;
  // stockAfterLedgerClaims, not raw userStockMap - see computeStockAfterLedgerClaims' own comment in
  // js/config.js.
  const nodeStockPool = window.stockAfterLedgerClaims || window.userStockMap || {};
  const stockQty = isStockDeductEnabled ? (nodeStockPool[productTypeId] || nodeStockPool[node.typeId] || 0) : 0;

  const card = document.createElement('div');
  card.id = `node-card-${node.instanceId}`;
  card.setAttribute('data-instance-id', node.instanceId);
  card.onclick = (e) => onNodeClick(e, node.instanceId);

  const iconUrlEarly = window.getItemIconUrl(productTypeId, window.TYPE_ID_TO_NAME[productTypeId] || node.name, 128);

  // A merged card (renderTreeDiagram's own same-tier duplicate-material pass) shows the SUM across
  // every consumer instead of just its own qty/cost, plus a small "×N" badge with a breakdown
  // tooltip naming which components need how much. Every other node's _mergedSources is simply
  // undefined, so effectiveQty/effectiveCost fall straight through to the plain node values.
  const mergedSources = node._mergedSources;
  const effectiveQty = mergedSources ? node._mergedQtyNeeded : node.qtyNeeded;
  const effectiveCost = mergedSources ? node._mergedCost : node.calculatedCost;
  const mergedBadge = mergedSources ? ` <span class="text-[10px]" style="color:var(--accent);" title="Shared by ${mergedSources.length} components:\n${mergedSources.map(s => `• ${s.parentName}: ${s.qtyNeeded.toLocaleString()}`).join('\n')}">×${mergedSources.length}</span>` : '';

  // Root's Net Profit row shrinks its own font in steps as the ISK figure gets longer (same
  // "step down instead of wrap" trick as lpstore.js's hero-num sizing) so a big profit/loss number
  // plus the "(X.X%)" alongside it stay on one line instead of wrapping the % underneath and
  // growing the card - which is otherwise the plain overflow behavior of a 32px number in a fixed
  // width column once it passes ~9 characters.
  // Steps chosen by directly measuring, per length, the largest size that still leaves the
  // "Net Profit" label and this value clear of each other (not just clear of the card edge -
  // a flexed row snaps its value flush to the edge regardless of overflow, so edge distance alone
  // doesn't tell you it fits) - so this uses noticeably more of the card's real width than a flat
  // guess would, without re-introducing the wrap.
  // Root-only: the tree-wide missing-skills check (computeMissingSkills, above) only needs to run
  // once per render, not once per card, so it's computed here and only for isRoot rather than inside
  // every createNodeCard call.
  const missingSkills = isRoot ? computeMissingSkills(node) : [];

  const netProfitNumStr = Math.round(node.netProfitSell || 0).toLocaleString();
  const netProfitLen = netProfitNumStr.length;
  const netProfitFontSize = netProfitLen <= 9 ? '36px' : netProfitLen <= 11 ? '28px' : netProfitLen <= 13 ? '24px' : netProfitLen <= 16 ? '20px' : netProfitLen <= 18 ? '17px' : '14px';

  // The Cost row and Job Inst. Fee row don't need their OWN shrink tiers the way Net Profit does -
  // measured directly, their label is already small enough (Cost row's caption was always 9.5px;
  // Job Inst. Fee's is given the same treatment below) that the value can stay at one fixed size
  // and still never touch it, all the way out to a 19-digit ISK figure. Shrinking the value on top
  // of that was the mistake in the previous pass - it made ordinary numbers harder to read for no
  // reason, and left every row on the card using a different font-size scale. Just nowrap + a fixed
  // size here; only the actual hero number (Net Profit) needs to flex.
  const costNumStr = Math.round(effectiveCost || 0).toLocaleString();
  const jobFeeNumStr = Math.round(node.jobFee || 0).toLocaleString();

  // Collapsed (explicit OR auto-compact, passed in by renderTreeDiagram) non-root, non-isolated
  // cards render as a compact "chip" instead of the full card - just the icon, name, qty, cost, and
  // a single click-anywhere-to-expand control. No longer requires node.children.length > 0: a leaf
  // (nothing to hide - raw materials, "Buy" items) can still be compacted purely to save space, it
  // just has nothing to reveal on expand. The isolated card is excluded even if it would otherwise
  // be compact - isolating a card means you specifically want to see its own detail, not a chip.
  if (!isRoot && !isIsolated && (window.collapsedInstanceIds.has(nodeStableKey(node)) || window.compactVisibleIds.has(nodeStableKey(node)) || (autoCompact && !window.expandedOverrideIds.has(nodeStableKey(node))))) {
    const compactDisplayName = node.productName || node.name.replace(/ Blueprint$/i, '').replace(/ Reaction Formula$/i, '').replace(/ Formula$/i, '').trim();
    const hiddenCount = countDescendants(node);

    // Same "Buy via: Sell/Buy" state the full card's own two labeled buttons control (below, in the
    // non-compact branch) - shown here as one small icon instead, since a chip has no room for text
    // buttons. Doubles as the indicator: whichever icon is showing IS the current strategy. Only
    // offered where the full card would offer it too (nothing to buy if this node builds itself and
    // has real children). 'lp' gets its own icon/color (matching the full card's purple LP pill) so
    // it reads correctly at a glance, but a click always lands on 'buy' - LP stays reachable only
    // from the expanded card's own dedicated button (see toggleComponentBuyMode's own comment).
    const isBuyEligible = !node.isBuildingSelf || !node.children || node.children.length === 0;
    const compactBuyStrategy = isBuyEligible ? window.getNodePriceStrategy(node) : null;
    const compactBuyToggle = isBuyEligible ? `
        <button onclick="toggleComponentBuyMode(event, ${node.typeId})" class="toggle-btn flex-shrink-0 ${compactBuyStrategy === 'lp' ? '' : (compactBuyStrategy === 'buy' ? 'toggle-btn-active-accent' : 'toggle-btn-active-buy')}" style="padding:5px 7px;${compactBuyStrategy === 'lp' ? 'color:#c084fc;border-color:#c084fc;' : ''}" title="${compactBuyStrategy === 'lp' ? 'Acquiring via LP store offer - click to switch to a market Buy Order' : compactBuyStrategy === 'buy' ? 'Buying via Buy Order - click to switch to instant Sell-order buying' : 'Buying via instant Sell Orders - click to switch to a Buy Order'}">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-3.5 h-3.5">${
            compactBuyStrategy === 'lp' ? '<circle cx="12" cy="8" r="5"/><path d="M8.5 12.5L7 21l5-3 5 3-1.5-8.5"/>'
            : compactBuyStrategy === 'buy' ? '<path d="M6 3h9l3 3v15H6z"/><line x1="9" y1="9" x2="15" y2="9"/><line x1="9" y1="13" x2="15" y2="13"/>'
            : '<polygon points="13,2 3,14 11,14 9,22 21,10 13,10"/>'
          }</svg>
        </button>` : '';

    // w-[352px] (10% over w-80) - matches the expanded card's own width, which got the same bump
    // for the same reason: room for the Sell/Buy price row below without truncating on expensive
    // items. The two icon buttons below get a touch less horizontal padding than the default
    // toggle-btn - they carry no text, so the usual padding was pure waste at this size.
    card.className = 'diagram-node diagram-node-compact glass-card p-2.5 shadow-lg transition-all relative w-[352px]';
    card.title = 'Click to expand';
    card.onclick = (e) => toggleNodeCollapse(e, node.instanceId, node.pathKey);
    card.innerHTML = `
      <div class="flex items-center gap-2.5">
        <img src="${iconUrlEarly}" alt="${window.esc(compactDisplayName)}" class="w-8 h-8 rounded-md border border-white/10 bg-black/40 flex-shrink-0" onerror="this.onerror=function(){window.handleItemIconLoadError(this);}; this.src='https://images.evetech.net/types/${productTypeId}/icon?size=64';">
        <div class="min-w-0 flex-1">
          <div class="font-bold text-xs text-white truncate" title="${window.esc(compactDisplayName)}">${window.esc(compactDisplayName)}${mergedBadge}</div>
          <div class="text-[11px] mono flex items-center justify-between gap-2">
            <span class="text-orange-400 truncate min-w-0" title="Qty: ${effectiveQty.toLocaleString()}">Qty: ${effectiveQty.toLocaleString()}</span>
            <span class="font-bold truncate min-w-0 flex-shrink-0" style="color:var(--cost);" title="${Math.round(effectiveCost || 0).toLocaleString()} ISK">${Math.round(effectiveCost || 0).toLocaleString()} <span style="font-size:0.7em;">ISK</span></span>
          </div>
        </div>
        ${compactBuyToggle}
        <span class="toggle-btn toggle-btn-active-accent flex-shrink-0" style="padding:5px 7px;">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9,18 15,12 9,6"/></svg>${hiddenCount > 0 ? ` +${hiddenCount}` : ''}
        </span>
      </div>
    `;
    return card;
  }

  // Card status accent - a colored top edge (matching the same language node-selected/
  // node-parent-highlight already use), not the old design's hardcoded-hex left-border stripe,
  // which didn't reference the current palette at all and looked like a leftover from another
  // theme entirely.
  // w-[352px] (was w-72, then w-80 - now 10% over that) - widened as part of trading width for
  // height: the price/cost block below packs Sell+Buy onto one row and collapses every
  // label-then-value pair onto a single line, which needs room to keep numbers from crowding into
  // the truncation ellipsis - a big-ticket item (a whole ship as someone else's material, say) can
  // run into the billions of ISK, which w-80 alone still wasn't quite wide enough for.
  let cardStyle = 'w-[352px]';
  let borderAccent = '';
  if (isRoot) { cardStyle = 'w-96'; }
  // isRedemptionRequirement (LP Store page only, js/lpstore.js injectLPRedemptionNodes) - an item
  // turned in to redeem an LP offer, not a build material at all, so it gets its own color rather
  // than falling into the ordinary "bought, not built" blue below.
  else if (node.isRedemptionRequirement) { cardStyle = 'w-[352px]'; borderAccent = 'border-top-color:#c084fc;'; }
  else if (!node.isBuildingSelf) { cardStyle = 'w-[352px]'; borderAccent = 'border-top-color:var(--blue);'; }
  else if (node.isReaction) { cardStyle = 'w-[352px]'; borderAccent = 'border-top-color:var(--violet);'; }
  else if (node.batchYield > 1) { cardStyle = 'w-[352px]'; borderAccent = 'border-top-color:var(--accent);'; }

  const totalProduced = node.runsNeeded * node.batchYield;
  const surplus = totalProduced - node.qtyNeeded;

  // CORRECTION: Strict blueprint path safety check inside the card loop prevents any imageservers 400s
  const iconUrl = window.getItemIconUrl(productTypeId, window.TYPE_ID_TO_NAME[productTypeId] || node.name, 128);

  const unitEIV = node.unitEIV || 0;
  const totalEIV = node.jobEIV || (unitEIV * node.qtyNeeded);
  const formattedUnitEIV = Math.round(unitEIV).toLocaleString() + ' ISK';
  const formattedTotalEIV = Math.round(totalEIV).toLocaleString() + ' ISK';

  const savingsPct = prices.sell > 0 && prices.buy > 0 && prices.sell > prices.buy ? (((prices.sell - prices.buy) / prices.sell) * 100).toFixed(1) : null;
  const currentBuyStrategy = window.getNodePriceStrategy(node);

  let sellStrategyUI = '';
  if (isRoot) {
    const curStrategy = window.rootSellStrategy || 'market-sell';
    const curCustomPrice = window.rootCustomPrice || '';
    const isCustomPriceNeeded = curStrategy === 'custom-market-sell' || curStrategy === 'custom-contract';

    sellStrategyUI = `
      <div class="mb-2 pt-2 border-t border-white/10 space-y-1.5" onclick="event.stopPropagation()">
        <div class="flex justify-between items-center text-xs mono gap-2">
          <span class="text-slate-300 font-bold flex-shrink-0">Sell Channel:</span>
          <select id="card-sell-strategy" onchange="syncSellStrategy(event)" class="bg-black/30 text-white px-2.5 py-1.5 text-xs outline-none min-w-0" style="border-radius:var(--radius-input); border:1px solid rgba(255,255,255,0.1);">
            <option value="market-sell" ${curStrategy === 'market-sell' ? 'selected' : ''}>Auto</option>
            <option value="custom-market-sell" ${curStrategy === 'custom-market-sell' ? 'selected' : ''}>Custom Market Sell</option>
            <option value="custom-contract" ${curStrategy === 'custom-contract' ? 'selected' : ''}>Custom Contract</option>
          </select>
        </div>
        ${isCustomPriceNeeded ? `
          <div class="flex flex-col text-xs mono">
            <div class="flex justify-between items-center">
              <span class="text-slate-300 font-bold">Custom Sell Price:</span>
              <div class="flex items-center space-x-1">
                <input type="number" id="card-custom-price" value="${curCustomPrice}" placeholder="Unit Price" onchange="syncCustomPrice(event)" class="w-24 bg-black/30 text-center text-green-400 font-bold px-2 py-1.5 outline-none text-xs" style="border-radius:var(--radius-input); border:1px solid rgba(255,255,255,0.1);">
                <span class="text-slate-500 text-xs">ISK</span>
              </div>
            </div>
            <div class="text-xs text-green-400 text-right font-bold mt-1">${Math.round(window.rootCustomPrice || 0).toLocaleString()} ISK</div>
          </div>
        ` : ''}
        <!-- onmousedown, not onclick - reported bug: clicking this sometimes did nothing. Root cause:
             recalculate() (called by at least two background completions unrelated to this click -
             selectItem's own market-price fetch, and fetchAdjustedPrices' EIV fetch, both on their own
             network timing) unconditionally wipes and rebuilds every card via renderTreeDiagram's
             container.innerHTML = ''. If that lands between mousedown and mouseup on this button, the
             original element is gone by the time the browser would fire click - real browsers don't
             synthesize a click for a mousedown target that's no longer in the document, so the action
             silently never happens. mousedown fires the instant the button is pressed instead of after
             a full press-release cycle, closing almost all of that window - same defense this file
             already uses for search-result rows (see selectRigForSlot's own comment) against a
             different trigger of the same underlying class of race. A separate onclick stopper is
             still needed alongside it: addCurrentJobToLedger's own recalculate() call replaces this
             very button (and its ancestor card) as one of its first steps, so the browser's click event
             (fired after mouseup, targeting whatever's now in that same screen position) would
             otherwise bubble unblocked into the card's own onclick (card.onclick = onNodeClick,
             assigned in createNodeCard) and toggle that card's selection highlight as an unwanted side
             effect of every single use, not just the race case. -->
        <button onmousedown="addCurrentJobToLedger(event)" onclick="event.stopPropagation()" class="btn-glass w-full mt-2 py-1.5 text-sm flex items-center justify-center gap-1.5">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add to Job Queue
        </button>
      </div>
    `;
  }

  let buildTimeUI = '';
  if (node.isBuildingSelf && node.isManufacturable) {
    const baseTime = extractBuildTime(node.recipe);
    // getEffectiveCharSkills, not a direct localStorage read - so this tooltip's own displayed
    // levels stay consistent with whatever calculateAdjustedJobSeconds actually used a few lines
    // down (including Simulate All to 5, if armed) instead of quietly showing the real level next to
    // a simulated time.
    const skills = window.getEffectiveCharSkills ? window.getEffectiveCharSkills() : window.safeParseJSON(localStorage.getItem('eve_char_skills'), { industry: 5, advIndustry: 5, allSkills: { [window.REACTIONS_SKILL_ID || 45746]: 5 } });
    const structureType = window.getActiveStructureType ? window.getActiveStructureType() : { shortLabel: 'Sotiyo', teBonus: 30.0 };
    const structureName = structureType.shortLabel;
    const structureTEBonus = `${structureType.teBonus}%`;
    const rigTEBonus = window.getEffectiveRigBonusForTypeId ? window.getEffectiveRigBonusForTypeId(node.productTypeId, 'TE') : 0;

    if (baseTime > 0) {
      const totalSeconds = calculateAdjustedJobSeconds(baseTime, node.customTE, node.runsNeeded, node.isReaction, node.productTypeId, node.recipe.requiredSkills);
      // Reactions and manufacturing are reduced by entirely different skills (Reactions vs.
      // Industry/Advanced Industry - see REACTIONS_SKILL_ID in config.js), so the tooltip has to
      // name the one that's actually in effect rather than always showing Industry/Adv. Industry.
      const skillLine = node.isReaction
        ? `• Reactions Level: ${(skills.allSkills && skills.allSkills[window.REACTIONS_SKILL_ID || 45746]) || 0}/5`
        : `• Industry Level: ${skills.industry}/5\n• Advanced Industry Level: ${skills.advIndustry}/5`;
      const hoverTitle = `Skill Reductions Applied:\n${skillLine}\n• Structure Bonus: ${structureName} (${structureTEBonus} TE reduction)${rigTEBonus > 0 ? `\n• Rig Bonus: -${rigTEBonus.toFixed(2)}% TE` : ''}\n• Base SDE Time: ${window.formatDuration(baseTime)}`;

      buildTimeUI = `
        <div class="flex justify-between text-xs text-slate-400 mono cursor-help" title="${window.esc(hoverTitle)}">
          <span>Est. Build Time:</span>
          <span class="text-slate-300 font-semibold">${window.formatDuration(totalSeconds)}</span>
        </div>
      `;
    } else {
      buildTimeUI = `
        <div class="flex justify-between text-xs text-slate-400 mono cursor-help" title="No manufacturing time data found for this blueprint in the local database or Fuzzwork lookup.">
          <span>Est. Build Time:</span>
          <span class="text-slate-500 italic">No Time Data</span>
        </div>
      `;
    }
  }

  // diagram-node-root (isRoot only) opts OUT of the general content-visibility:auto rule (see its
  // own comment in css/styles.css) - root is what withRootPanAnchor and recalculateWithPanAnchor
  // measure via getBoundingClientRect() on literally every single wrapped button, and recalculate()
  // tears down and rebuilds every card's DOM element from scratch on every call (renderSubtreeColumns
  // always creates fresh nodes, never reuses old ones) - so content-visibility's own "remembered last
  // real size" optimization can never actually carry over between renders the way it would for an
  // element that persists across a normal page's scroll. Root's own real size was landing on the
  // wrong side of that race often enough to matter: reported directly (with a live stack trace) as a
  // consistent ~105px drift on EVERY repeated click of an already-fully-compacted tree, where the
  // rendered layout genuinely was not changing at all - the only thing that could explain a real,
  // repeatable error that size was the one card the correction actually measures intermittently
  // getting sized off its contain-intrinsic-size placeholder (352x280) instead of its true, usually
  // taller, content. Root is always exactly one card - giving it up front, always-real layout costs
  // nothing measurable next to the 1000+ cards this rule exists for in the first place.
  card.className = `diagram-node glass-card p-2.5 shadow-lg transition-all relative ${cardStyle}${isRoot ? ' diagram-node-root' : ''}`;
  if (borderAccent) card.setAttribute('style', borderAccent);
  card.innerHTML = `
    <div class="flex items-start space-x-3 border-b border-[#3a3025] pb-2.5 mb-2.5">
      <img src="${iconUrl}" alt="${window.esc(node.productName || node.name)}" class="w-10 h-10 rounded-md border border-white/10 bg-black/40 flex-shrink-0" onerror="this.onerror=function(){window.handleItemIconLoadError(this);}; this.src='https://images.evetech.net/types/${productTypeId}/icon?size=64';">
      <div class="min-w-0 flex-1">
        <div class="flex items-center justify-between gap-1.5">
          <span class="font-bold text-sm text-white truncate min-w-0 cursor-pointer hover:text-orange-300 hover:underline transition" onclick="copyMaterialNameToClipboard(event, this, '${window.esc(node.productName || node.name.replace(/ Blueprint$/i, '').replace(/ Reaction Formula$/i, '').replace(/ Formula$/i, '').trim()).replace(/'/g, "\\'")}')" title="Click to copy this item's exact name to your clipboard, ready to paste into EVE's search/market">${node.productName || node.name.replace(/ Blueprint$/i, '').replace(/ Reaction Formula$/i, '').replace(/ Formula$/i, '').trim()}</span>${mergedBadge}
          <div class="flex items-center space-x-1 flex-shrink-0">
            ${node.isRedemptionRequirement ? `<span class="text-[9px] mono px-1.5 py-0.5 rounded flex-shrink-0" style="background:rgba(192,132,252,0.15); color:#c084fc;" title="Turned in to redeem this LP store offer - not a build material.">REDEEM</span>` : ''}
            ${isRoot ? `
              <div class="relative group inline-block" onclick="event.stopPropagation()">
                <span class="toggle-btn cursor-help" title="Unit EIV: ${formattedUnitEIV} | Total Job EIV: ${formattedTotalEIV}">
                  <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="8.01"/><line x1="12" y1="11" x2="12" y2="16"/></svg>
                  EIV
                </span>
                <div class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block bg-black/90 border border-[var(--accent)] text-white text-xs p-2 rounded shadow-2xl z-[999] whitespace-nowrap mono pointer-events-none">
                  <div class="text-orange-300 font-bold border-b border-[#3a3025] pb-1 mb-1">Estimated Item Value (EIV)</div>
                  <div class="flex justify-between space-x-4 text-slate-300"><span>Unit EIV:</span> <span class="text-orange-300 font-bold">${formattedUnitEIV}</span></div>
                  <div class="flex justify-between space-x-4 text-slate-300"><span>Total Job EIV:</span> <span class="text-orange-400 font-bold">${formattedTotalEIV}</span></div>
                </div>
              </div>
            ` : ''}
            ${isRoot && missingSkills.length > 0 ? `
              <div class="relative group inline-block" onclick="event.stopPropagation()">
                <span class="toggle-btn cursor-pointer" style="color:#e85555;border-color:rgba(232,85,85,0.4);background:rgba(232,85,85,0.14);" onclick="openFlyoutSection('skills')" title="Missing required skills somewhere in this build - click for details">
                  <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.7 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                  Skills
                </span>
                <div class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block bg-black/90 border border-[#e85555] text-white text-xs p-2 rounded shadow-2xl z-[999] whitespace-nowrap mono pointer-events-none">
                  <div class="text-[#e85555] font-bold border-b border-[#3a3025] pb-1 mb-1">Missing Required Skills</div>
                  ${missingSkills.slice(0, 4).map(item => `<div class="text-slate-300">${window.esc(item.name)}: <span class="text-[#e85555] font-semibold">${item.missing.map(m => window.esc(m.skillName)).join(', ')}</span></div>`).join('')}
                  ${missingSkills.length > 4 ? `<div class="text-slate-500 italic">+${missingSkills.length - 4} more - see the Skills tab</div>` : ''}
                </div>
              </div>
            ` : ''}
            ${!isRoot ? `
              <button onclick="toggleNodeCollapse(event, ${node.instanceId}, '${node.pathKey}')" class="toggle-btn" style="min-width:88px;justify-content:center;" title="Shrink to a compact chip - whatever's underneath stays visible and connected, nothing gets hidden">
                <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6,9 12,15 18,9"/></svg> Compact
              </button>
            ` : ''}
            ${isIsolated ? `
              <button onclick="exitIsolation(event)" class="icon-btn" style="width:26px;height:26px;" title="Exit isolation view">
                <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" style="width:14px;height:14px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            ` : `
              <button onclick="isolateComponent(event, ${node.instanceId})" class="icon-btn" style="width:26px;height:26px;" title="Isolate: show only this card and its direct connections">
                <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><path d="M4 9V5a1 1 0 011-1h4"/><path d="M20 9V5a1 1 0 00-1-1h-4"/><path d="M4 15v4a1 1 0 001 1h4"/><path d="M20 15v4a1 1 0 01-1 1h-4"/></svg>
              </button>
            `}
          </div>
        </div>
        <div class="text-sm text-orange-400 mono flex items-center justify-between mt-0.5">
          <span>${isRoot ? `Output Qty: ${node.qtyNeeded.toLocaleString()} ${node.productName}` : `Req Qty: ${effectiveQty.toLocaleString()}`}</span>
          ${stockQty > 0 ? `<span class="text-slate-400 text-xs" title="In Stock in Hangar">Stock: ${stockQty.toLocaleString()}</span>` : ''}
        </div>
        ${stockQty > 0 ? (() => {
          const totalSegs = 10;
          const filledSegs = Math.min(totalSegs, Math.round((stockQty / effectiveQty) * totalSegs));
          return `<div class="seg-bar mt-1.5" title="Stock covers ${Math.min(100, Math.round((stockQty / effectiveQty) * 100))}% of what this needs">${Array.from({length: totalSegs}, (_, i) => `<div class="${i < filledSegs ? 'filled' : ''}"></div>`).join('')}</div>`;
        })() : ''}
        ${node.isBuildingSelf && node.batchYield > 1 && !node.isLPIsolatedRoot ? `<div class="text-orange-300 text-xs mono font-semibold mt-0.5">(${node.runsNeeded} Run${node.runsNeeded > 1 ? 's' : ''} @ ${node.batchYield}/run ${surplus > 0 ? `→ ${surplus} Surplus` : ''})</div>` : ''}
      </div>
    </div>

    <div class="space-y-2.5">
      ${isRoot ? `
        <div class="border-t border-[#3a3025] pt-2.5">
          ${renderCardStationSelectorHTML()}
        </div>
      ` : ''}
      ${isRoot ? `
        <div class="border-t border-[#3a3025] pt-2.5 flex items-center ${node.isLPIsolatedRoot ? 'justify-between' : 'gap-3'} text-sm mono">
          ${node.isLPIsolatedRoot ? `
            <span class="text-slate-300 font-bold" title="How many separate times you redeem this LP store offer - NOT blueprint runs. Each redemption grants a fixed amount (shown above), so everything scales as this count times that fixed amount.">Times Redeemed:</span>
            <div class="flex items-center space-x-1">
              <input type="number" id="card-bp-runs" value="${node._lpRedemptionCount || 1}" min="1" max="1000000" onchange="window.onLPRedemptionCountChange(event)" onkeydown="if(event.key==='Enter') this.blur()" class="w-16 bg-black/40 rounded text-center font-bold p-1 outline-none" style="border:1px solid rgba(var(--accent-rgb),0.5); color:var(--accent);">
              <span class="text-slate-400 text-xs">time${(node._lpRedemptionCount || 1) === 1 ? '' : 's'}</span>
            </div>
          ` : `
            <div class="flex items-center gap-1.5">
              <span class="text-slate-300 font-bold" title="How many separate real jobs to plan for - each one rounds its own materials up independently, same as several physical copies of a max-run BPC would in EVE. Leave at 1 for a single normal job.">Jobs:</span>
              <input type="number" id="card-bp-jobs" value="${node.jobCount || 1}" min="1" max="1000000" onchange="syncCardJobsToGlobal(event)" onkeydown="if(event.key==='Enter') this.blur()" class="w-14 bg-black/40 rounded text-center font-bold p-1 outline-none" style="border:1px solid rgba(var(--accent-rgb),0.5); color:var(--accent);">
            </div>
            <div class="flex items-center gap-1.5">
              <span class="text-slate-300 font-bold" title="Runs per job.">Runs:</span>
              <input type="number" id="card-bp-runs" value="${Math.max(1, Math.round(node.runsNeeded / (node.jobCount || 1)))}" min="1" max="1000000" onchange="syncCardRunsToGlobal(event)" onkeydown="if(event.key==='Enter') this.blur()" class="w-14 bg-black/40 rounded text-center font-bold p-1 outline-none" style="border:1px solid rgba(var(--accent-rgb),0.5); color:var(--accent);">
            </div>
          `}
        </div>
      ` : ''}
      ${sellStrategyUI}

      ${(!isRoot && node.isManufacturable) || (!isRoot && (!node.isBuildingSelf || !node.children || node.children.length === 0)) || (node.isBuildingSelf && node.isManufacturable && !node.isReaction) ? `
        <div class="border-t border-[#3a3025] pt-2 space-y-1.5">
          ${!isRoot && node.isManufacturable ? `
            <div class="flex items-center justify-between text-xs mono">
              <span class="text-slate-400 font-semibold">Mode:</span>
              <div class="flex space-x-1">
                ${(() => {
                  // A redemption-requirement node (LP Store, js/lpstore.js) toggles through its own
                  // handler keyed by a stable product typeId, not the shared toggleBuildSelf - see
                  // toggleBuildSelf's own guard note and injectLPRedemptionNodes' _lpRequiredItemProductTypeId
                  // comment for why. Every other node (index.html included) is unaffected.
                  const fn = node.isRedemptionRequirement
                    ? `toggleLPRequiredItemBuild(event, ${node._lpRequiredItemProductTypeId})`
                    : `toggleBuildSelf(event, ${node.typeId})`;
                  return `
                <button onclick="${fn}" class="toggle-btn ${node.isBuildingSelf ? 'toggle-btn-active-accent' : ''}">
                  <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 6l4 4-8.5 8.5a2 2 0 01-2.8 0v0a2 2 0 010-2.8L15.2 7.2"/><path d="M12 8l4-4 4 4-4 4"/></svg>
                  Build
                </button>
                <button onclick="${fn}" class="toggle-btn ${!node.isBuildingSelf ? 'toggle-btn-active-buy' : ''}">
                  <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/><path d="M2 4h2l2.4 12.4a2 2 0 002 1.6h8.4a2 2 0 002-1.6L21 8H6"/></svg>
                  Buy
                </button>`;
                })()}
              </div>
            </div>
          ` : ''}
          ${!isRoot && (!node.isBuildingSelf || !node.children || node.children.length === 0) ? `
            <div class="flex items-center justify-between text-xs mono">
              <span class="text-slate-400 font-semibold">Buy via:</span>
              <div class="flex space-x-1">
                <button onclick="setComponentBuyMode(event, ${node.typeId}, 'sell')" class="toggle-btn ${currentBuyStrategy === 'sell' ? 'toggle-btn-active-buy' : ''}" title="Instant Buy off Sell Orders">
                  <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13,2 3,14 11,14 9,22 21,10 13,10"/></svg>
                  Sell
                </button>
                <button onclick="setComponentBuyMode(event, ${node.typeId}, 'buy')" class="toggle-btn ${currentBuyStrategy === 'buy' ? 'toggle-btn-active-accent' : ''}" title="Order Placing via Buy Orders - usually the more profitable option, since you set the price instead of paying the instant sell-order premium">
                  <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h9l3 3v15H6z"/><line x1="9" y1="9" x2="15" y2="9"/><line x1="9" y1="13" x2="15" y2="13"/></svg>
                  Buy
                </button>
                ${(window.__lpOfferByOutputTypeId && window.__lpOfferByOutputTypeId[productTypeId]) ? `
                  <button onclick="setComponentBuyMode(event, ${node.typeId}, 'lp')" class="toggle-btn ${currentBuyStrategy === 'lp' ? 'toggle-btn-active-accent' : ''}" style="${currentBuyStrategy === 'lp' ? 'color:#c084fc;border-color:#c084fc;' : ''}" title="Acquire via this LP store's own offer instead of buying it on the market">
                    <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="5"/><path d="M8.5 12.5L7 21l5-3 5 3-1.5-8.5"/></svg>
                    LP
                  </button>
                ` : ''}
              </div>
            </div>
          ` : ''}
          ${node.isBuildingSelf && node.isManufacturable && !node.isReaction ? `
            <div class="flex items-center justify-between text-xs mono" onmousedown="event.stopPropagation()" title="${window.esc(meTeSourceHint(node))}">
              <span class="text-slate-400 font-semibold">Job ME/TE:${meTeIsAutoFilled(node) ? ' <span style="color:var(--accent);" title="Auto-filled from your best owned BPO">●</span>' : ''}</span>
              <div class="flex items-center space-x-1">
                <input type="number" id="card-me-${node.instanceId}" min="0" max="10" value="${node.customME}" onchange="onCardMEChange(event, ${node.typeId}, ${node.instanceId})" class="field-line w-10 text-center text-orange-400 font-bold p-0.5">
                <span class="text-slate-500">%</span>
                <input type="number" id="card-te-${node.instanceId}" min="0" max="20" value="${node.customTE}" onchange="onCardTEChange(event, ${node.typeId}, ${node.instanceId})" class="field-line w-10 text-center text-orange-400 font-bold p-0.5">
                <span class="text-slate-500">%</span>
              </div>
            </div>
          ` : ''}
        </div>
      ` : ''}

      <div class="text-sm mono space-y-1.5 border-t border-[#3a3025] pt-2.5">
        <div class="flex items-center gap-2">
          <div class="min-w-0 flex-1 truncate" title="Lowest Sell: ${prices.sell.toLocaleString()} ISK">
            <span class="text-slate-500 uppercase tracking-wide" style="font-size:9.5px;">Sell</span>
            <span class="text-green-400 font-bold ml-1 text-xs">${prices.sell.toLocaleString()}${window.estimatedPriceMarker ? window.estimatedPriceMarker(productTypeId) : ''}</span>
          </div>
          <div class="min-w-0 flex-1 truncate" title="Highest Buy: ${prices.buy.toLocaleString()} ISK">
            <span class="text-slate-500 uppercase tracking-wide" style="font-size:9.5px;">Buy</span>
            <span class="text-slate-300 ml-1 text-xs">${prices.buy.toLocaleString()}${window.estimatedPriceMarker ? window.estimatedPriceMarker(productTypeId) : ''}</span>
          </div>
        </div>
        <div class="flex items-center justify-between text-xs">
          <span>${!isRoot && savingsPct !== null ? `<span class="text-slate-400 uppercase tracking-wide" style="font-size:9.5px;">Order Savings</span> <span class="text-green-400 font-bold">${savingsPct}%</span>` : ''}</span>
          <button onclick="openMarketComparison(event, ${productTypeId}, '${window.esc(node.productName || node.name)}')" class="icon-btn flex-shrink-0" style="width:22px;height:22px;" title="Compare price and trade volume across your tracked markets">
            <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;"><polyline points="17,1 21,5 17,9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7,23 3,19 7,15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>
          </button>
        </div>
        ${node.jobFee > 0 && node.isBuildingSelf ? `<div class="flex items-center justify-between text-xs"><span class="text-[#e85555] uppercase tracking-wide flex-shrink-0" style="font-size:9.5px;">Job Inst. Fee</span><span class="text-[#e85555] font-bold" style="white-space:nowrap;">+${jobFeeNumStr} <span style="font-size:0.7em;">ISK</span></span></div>` : ''}
        <div class="flex items-center justify-between border-t border-[#3a3025] pt-1.5">
          <span class="text-slate-400 uppercase tracking-wide flex-shrink-0" style="font-size:9.5px;">${isRoot ? 'Total Production Cost' : node.isBuildingSelf ? 'Build Cost' : node._lpAcquiredOffer ? 'LP Redemption Cost' : 'Market Buy Cost'}</span>
          <span class="font-bold" style="color:var(--cost);white-space:nowrap;">${costNumStr} <span style="font-size:0.7em;">ISK</span></span>
        </div>
        ${isRoot ? `
          <div class="flex items-center justify-between border-t border-green-500/40 pt-1.5">
            <span class="text-slate-400 uppercase tracking-wide" style="font-size:9.5px;">Net Profit</span>
            <span style="white-space:nowrap;">
              <span class="hero-num ${(node.netProfitSell || 0) >= 0 ? 'profit' : 'loss'}" style="font-size:${netProfitFontSize};">${netProfitNumStr}</span>
              <span class="hero-num ${(node.netProfitSell || 0) >= 0 ? 'profit' : 'loss'}" style="font-size:11px;">ISK</span>
              <!-- Same (Net Profit / Total Production Cost) x 100 formula the "Sell ROI" summary stat
                   box above the canvas already uses (see recalculate's own roiSell) - computed fresh
                   here from values already in scope for the root (effectiveCost IS totalProductionCost
                   for root - see effectiveCost's own comment) rather than threading roiSell all the way
                   down from renderTreeDiagram, so this can never drift out of sync with that number. -->
              <span class="text-xs font-semibold" style="opacity:0.65;">(${effectiveCost > 0 ? ((node.netProfitSell || 0) / effectiveCost * 100).toFixed(1) : '0.0'}%)</span>
            </span>
          </div>
        ` : ''}
      </div>
      ${(buildTimeUI || isRoot) ? `
        <div class="text-sm mono space-y-1 border-t border-[#3a3025] pt-1.5">
          ${buildTimeUI}
          ${isRoot ? `
            <div class="flex justify-between text-xs text-slate-400 mono cursor-help" title="This job's own time PLUS every sub-component you're manufacturing yourself (not buying) - this is the number the Ledger's countdown timer actually uses, since building sub-components takes real time before you can even start the final job.">
              <span>Total Project Time:</span>
              ${node.totalBuildSeconds > 0
                ? `<span class="text-slate-300 font-semibold">${window.formatDuration(node.totalBuildSeconds)}</span>`
                : `<span class="text-slate-500 italic">No Time Data</span>`}
            </div>
          ` : ''}
          ${isRoot ? `
            <div class="flex justify-between text-xs text-slate-400 mono cursor-help" title="Total net sell profit divided by the total time to build this item and every sub-component you're manufacturing yourself.">
              <span>Est. ISK/Hour:</span>
              ${node.totalBuildSeconds > 0
                ? `<span class="${(node.netProfitSell || 0) >= 0 ? 'text-green-400' : 'text-red-400'} font-semibold">${Math.round((node.netProfitSell || 0) / (node.totalBuildSeconds / 3600)).toLocaleString()} <span style="font-size:0.7em;">ISK</span></span>`
                : `<span class="text-slate-500 italic">No Time Data</span>`}
            </div>
          ` : ''}
        </div>
      ` : ''}
    </div>
  `;
  return card;
}

function syncCardRunsToGlobal(e) {
  const val = Math.max(1, parseInt(e.target.value) || 1);
  window.globalRuns = val;
  const globalInput = document.getElementById('bp-runs');
  if (globalInput) { globalInput.value = val; }
  recalculate();
}

// Companion to syncCardRunsToGlobal - see recalculate()'s own comment on globalJobs/globalRuns.
function syncCardJobsToGlobal(e) {
  const val = Math.max(1, parseInt(e.target.value) || 1);
  window.globalJobs = val;
  recalculate();
}
window.syncCardJobsToGlobal = syncCardJobsToGlobal;

function syncCustomPrice(e) {
  const val = parseFloat(e.target.value) || 0;
  window.rootCustomPrice = val >= 0 ? val : 0;
  recalculate();
}

function syncCustomTax(e) {
  const val = parseFloat(e.target.value) || 0;
  window.rootCustomTax = val >= 0 ? val : 0;
  recalculate();
}

function syncSellStrategy(e) {
  window.rootSellStrategy = e.target.value;
  recalculate();
}

// (extractJobMaterialsForNode moved to config.js so both the calculator and ledger pages can use it)

// A Build-toggled sub-assembly's own queued job used to always plan to manufacture the FULL
// theoretical quantity its parent's recipe calls for, completely ignoring how much of that exact
// component was already sitting in stock - reported directly: "even though i have some of the
// required component in stock, the calculator added the entire needed stock to build instead of
// just building the missing stuff." extractJobMaterialsForNode (js/config.js) already correctly
// computes a stock-reduced "net" quantity for a built component whenever it lists it as a material
// of its parent - that number was purely informational until now; the actual job queued for that
// component, and in turn ITS OWN raw-material shopping list underneath it, never used it at all.
//
// Walks the tree top-down one boundary at a time, reusing extractJobMaterialsForNode's own already-
// correct per-level stock math at each one instead of duplicating it - a component appearing
// directly under root gets root's own reading of how much stock covers it; one nested inside
// another Build-toggled sub-assembly instead gets THAT sub-assembly's own reading (computed once its
// own quantity has already been shrunk to its net-of-stock size and cascaded to its children), so a
// smaller outer job correctly asks for proportionally less underneath it too. Each boundary node is
// temporarily shrunk to its net run count, its own materials/cost/time captured at that size, then
// restored before returning - so nothing about the live tree or the Calculator's own display is left
// changed afterward. Deliberately does NOT touch calculateTreeNodeCost's own cost/profit figures for
// the live view (stock-agnostic by design, see that function's own comment) - this only changes what
// gets queued to the Ledger. Doesn't attempt to share one stock pool across sibling boundaries at
// different branches of the tree (each of extractJobMaterialsForNode's calls still gets its own
// fresh reading of window.userStockMap, same as before) - a rarer edge case than the one reported,
// and out of scope for this fix.
function resolveStockAwareSubBuilds(root, facility) {
  const subBuilds = [];

  function resolveLevel(parentMaterials, parentNode) {
    (parentNode.children || []).forEach(child => {
      const isBoundary = child.depth > 0 && child.isBuildingSelf && child.children && child.children.length > 0;
      if (!isBoundary) return;

      const productTypeId = child.productTypeId || child.typeId;
      const materialEntry = parentMaterials.find(m => m.typeId === productTypeId);
      const netQtyNeeded = materialEntry ? materialEntry.netQtyNeeded : child.qtyNeeded;
      const stockConsumed = materialEntry ? materialEntry.stockQty : 0;
      const batchYield = child.batchYield || 1;
      const netRunsNeeded = Math.ceil(netQtyNeeded / batchYield);

      const originalRunsNeeded = child.runsNeeded;
      const originalQtyNeeded = child.qtyNeeded;
      child.runsNeeded = netRunsNeeded;
      child.qtyNeeded = netRunsNeeded * batchYield;
      if (typeof window.scaleTreeQuantities === 'function') window.scaleTreeQuantities(child, facility);

      const childMaterials = extractJobMaterialsForNode(child);
      const calculatedCost = typeof window.calculateTreeNodeCost === 'function' ? window.calculateTreeNodeCost(child) : 0;
      const totalBuildSeconds = typeof calculateTotalBuildSeconds === 'function' ? calculateTotalBuildSeconds(child) : 0;

      resolveLevel(childMaterials, child); // anything nested one level deeper inside this boundary - pushed first, so prerequisites land deepest-first in subBuilds, matching collectSubBuildNodes' own ordering

      if (netRunsNeeded > 0) {
        subBuilds.push({ node: child, stockConsumed, netQtyNeeded, netRunsNeeded, materials: childMaterials, calculatedCost, totalBuildSeconds });
      }

      child.runsNeeded = originalRunsNeeded;
      child.qtyNeeded = originalQtyNeeded;
      if (typeof window.scaleTreeQuantities === 'function') window.scaleTreeQuantities(child, facility);
    });
  }

  const rootMaterials = extractJobMaterialsForNode(root);
  resolveLevel(rootMaterials, root);
  return { rootMaterials, subBuilds: mergeDuplicateSubBuilds(subBuilds, facility) };
}

// Same material needed by several different branches (e.g. a capital component used by many
// different modules) used to queue one separate small job per branch - no point building the same
// thing 5 separate times when it's really one thing needed 5x over. Groups subBuilds by product,
// and for any group of 2+, discards the individual entries for one combined one: sums their net
// quantities, rounds up to combined whole runs (same "round once for the whole batch" real EVE
// mechanic as rescaleNodeToQuantity, js/app.js's diagram merge, and the direct comparison this was
// built from - 5 separate 5-run jobs at 3% ME need 245 material total, one combined 25-run job
// needs only 243), and recomputes materials/cost/time for that combined job fresh rather than
// summing 5 separately-rounded results. Reuses one representative real node (temporarily resized
// and restored after, same as resolveLevel's own single-node dance above) rather than any of the
// others - which specific one is arbitrary, they're all the same product.
function mergeDuplicateSubBuilds(subBuilds, facility) {
  const groups = new Map();
  subBuilds.forEach(sb => {
    const pid = sb.node.productTypeId || sb.node.typeId;
    if (!groups.has(pid)) groups.set(pid, []);
    groups.get(pid).push(sb);
  });

  const merged = [];
  groups.forEach(group => {
    if (group.length < 2) { merged.push(group[0]); return; }

    const representative = group[0].node;
    const combinedNetQty = group.reduce((sum, sb) => sum + sb.netQtyNeeded, 0);
    const combinedStockConsumed = group.reduce((sum, sb) => sum + (sb.stockConsumed || 0), 0);
    const batchYield = representative.batchYield || 1;
    const combinedNetRuns = Math.ceil(combinedNetQty / batchYield);

    const originalRunsNeeded = representative.runsNeeded;
    const originalQtyNeeded = representative.qtyNeeded;
    representative.runsNeeded = combinedNetRuns;
    representative.qtyNeeded = combinedNetRuns * batchYield;
    if (typeof window.scaleTreeQuantities === 'function') window.scaleTreeQuantities(representative, facility);

    const materials = extractJobMaterialsForNode(representative);
    const calculatedCost = typeof window.calculateTreeNodeCost === 'function' ? window.calculateTreeNodeCost(representative) : 0;
    const totalBuildSeconds = typeof calculateTotalBuildSeconds === 'function' ? calculateTotalBuildSeconds(representative) : 0;

    merged.push({
      node: representative,
      stockConsumed: combinedStockConsumed,
      netQtyNeeded: combinedNetRuns * batchYield,
      netRunsNeeded: combinedNetRuns,
      materials,
      calculatedCost,
      totalBuildSeconds
    });

    representative.runsNeeded = originalRunsNeeded;
    representative.qtyNeeded = originalQtyNeeded;
    if (typeof window.scaleTreeQuantities === 'function') window.scaleTreeQuantities(representative, facility);
  });
  return merged;
}

function addCurrentJobToLedger(e) {
  if (e) e.stopPropagation();
  if (!window.recipeTreeRoot) return;

  recalculate();

  let queue = [];
  try {
    const saved = localStorage.getItem('eve_ledger_jobs');
    if (saved) {
      queue = JSON.parse(saved);
    }
  } catch (err) {
    queue = [];
  }

  const selectedStrategy = window.rootSellStrategy || 'market-sell';
  const rootProductTypeId = window.recipeTreeRoot.productTypeId || window.recipeTreeRoot.typeId;
  const outputPrices = window.priceCache[rootProductTypeId] || { sell: 0, buy: 0 };
  let customPrice = window.rootCustomPrice || 0;
  let unitSellPrice = selectedStrategy.startsWith('custom-') ? customPrice : outputPrices.sell;
  const baseTime = extractBuildTime(window.recipeTreeRoot.recipe, window.recipeTreeRoot.typeId, window.recipeTreeRoot.name);

  const structureTypeForStock = window.getActiveStructureType ? window.getActiveStructureType() : { costBonus: 5.0, meBonus: 1.0 };
  const facilityForStock = structureTypeForStock.meBonus / 100;
  const stockAwareResult = resolveStockAwareSubBuilds(window.recipeTreeRoot, facilityForStock);
  const materials = stockAwareResult.rootMaterials;

  const rootJobName = window.recipeTreeRoot.productName || window.recipeTreeRoot.name.replace(/ Blueprint$/i, '').replace(/ Reaction Formula$/i, '').replace(/ Formula$/i, '').trim();

  // Snapshot of the 5 raw values that actually drive ME/TE/cost bonuses, taken directly from
  // whatever's live right now - NOT a reference to a saved preset name (presets can be renamed or
  // deleted later; the job should stay accurate to what was really used regardless). The Ledger
  // compares this against currently-saved presets at display time to show a friendly name if one
  // still matches, and offers it as the starting point for "change this job's production preset".
  const selectedSystem = window.safeParseJSON(localStorage.getItem('eve_selected_system'), {});
  const productionSnapshot = {
    systemId: selectedSystem.id || null,
    systemName: selectedSystem.name || null,
    facilityKey: localStorage.getItem('eve_active_facility_key') || 'sotiyo',
    rig1: localStorage.getItem('eve_rig_slot_1') || '',
    rig2: localStorage.getItem('eve_rig_slot_2') || '',
    rig3: localStorage.getItem('eve_rig_slot_3') || ''
  };
  // Same idea as productionSnapshot, but for the OTHER thing that's live global state here and
  // nowhere near persisted on the Ledger page: which sub-assemblies are toggled to build vs. buy,
  // any per-component buy-order override, and any custom ME/TE override. The Ledger recomputes a
  // job's tree fresh (run count changes, preset changes) using window.buildRecursiveRecipeTree, which
  // reads these same maps - without carrying a copy along, that recompute would start from all-empty
  // and silently price every sub-component as "buy at market" regardless of what was chosen here.
  //
  // customMEOverrides/customTEOverrides specifically get backfilled (into this LOCAL copy only, not
  // the live global maps) with every node's actual RESOLVED node.customME/customTE before snapshotting
  // - a node you never manually edited still shows a real ME/TE on its card via tree.js's own
  // owned-BPO auto-fill default (getDefaultMeTeForBlueprint), but that default is never written back
  // into these maps. Without this backfill, queuing a job straight off that auto-fill (without ever
  // touching the ME/TE fields by hand) silently snapshotted an EMPTY override, and the Ledger showed
  // 0%/0% for it despite the Calculator correctly showing the real researched BPO level. Backfilling
  // only the local copy (not window.customMEOverrides itself) keeps the Calculator's own "always
  // follow my current best-owned BPO" default live and un-frozen for every item added afterward.
  const snapshotMEOverrides = { ...(window.customMEOverrides || {}) };
  const snapshotTEOverrides = { ...(window.customTEOverrides || {}) };
  (function backfillResolvedMeTe(node) {
    if (!node) return;
    if (node.typeId !== undefined) {
      if (snapshotMEOverrides[node.typeId] === undefined) snapshotMEOverrides[node.typeId] = node.customME || 0;
      if (snapshotTEOverrides[node.typeId] === undefined) snapshotTEOverrides[node.typeId] = node.customTE || 0;
    }
    if (node.children) node.children.forEach(backfillResolvedMeTe);
  })(window.recipeTreeRoot);

  const buildConfigSnapshot = {
    buildSelfOverrides: { ...(window.buildSelfOverrides || {}) },
    customBuyModes: { ...(window.customBuyModes || {}) },
    customMEOverrides: snapshotMEOverrides,
    customTEOverrides: snapshotTEOverrides
  };

  // Generated up front (not inline in the job object below) so subBuildJobs can link to it - a
  // sub-build needs to know its parent's actual unique id, not just its NAME, or the Ledger's list-
  // mode hierarchy (buildJobClusters) can't tell apart two different queued jobs that happen to share
  // a product name (e.g. one 7-run job split by hand into several same-named smaller ones) and ends
  // up attaching the same single sub-build under EVERY same-named root instead of just its actual one.
  const rootJobId = Date.now() + Math.floor(Math.random() * 1000);

  // Every build-toggled sub-assembly becomes its own queued job, inserted before the final job since
  // it's a prerequisite for it. These deliberately have no netProfit field - the final job's profit
  // already accounts for the savings from building these instead of buying them, so giving each
  // sub-build its own "profit" figure would double-count the same value. The ledger's profit totals
  // already skip any job where netProfit is undefined, so this "just works" without extra bookkeeping.
  // A manually-planned job is personal to whoever's active when it's added - not corp-shared, since
  // there's no way yet to know it'll turn out to match a real corp job (js/ledger.js's sync upgrades
  // it to scope:'corp' automatically once/if it actually does - see its own comment on that).
  const addedByCharId = window.getActiveCharId ? window.getActiveCharId() : null;
  // stockAwareResult.subBuilds (computed above, alongside the root's own materials) already excludes
  // anything fully covered by existing stock and sizes everything else down to just the shortfall -
  // see resolveStockAwareSubBuilds' own comment for why a plain tree walk (the old collectSubBuildNodes
  // + node.runsNeeded/qtyNeeded here) couldn't do that on its own.
  const subBuildJobs = stockAwareResult.subBuilds.map(sb => ({
    id: Date.now() + Math.floor(Math.random() * 1000) + sb.node.instanceId,
    typeId: sb.node.typeId,
    productTypeId: sb.node.productTypeId,
    name: sb.node.productName || sb.node.name.replace(/ Blueprint$/i, '').replace(/ Reaction Formula$/i, '').replace(/ Formula$/i, '').trim(),
    runsNeeded: sb.netRunsNeeded,
    qtyNeeded: sb.netQtyNeeded,
    calculatedCost: sb.calculatedCost || 0,
    baseTime: extractBuildTime(sb.node.recipe),
    totalBuildSeconds: sb.totalBuildSeconds,
    materials: sb.materials,
    isSubBuild: true,
    parentJobId: rootJobId,
    parentJobName: rootJobName, // display-only now (the "⚙ Prereq for: X" label) - parentJobId is the real link
    productionSnapshot: productionSnapshot,
    buildConfigSnapshot: buildConfigSnapshot,
    scope: 'personal',
    ownerCharId: addedByCharId,
    addedAt: new Date().toISOString()
  }));

  // If the currently-loaded item is still the exact BPC last pulled in via "Load" in the blueprint
  // browser (typeId match - a plain search selection in between would have replaced currentProduct
  // without touching this stored source, so the match check is what stops a stale link surviving
  // onto an unrelated job), tag the job with that BPC's item_id so the browser can mark it as
  // already spoken for and you don't accidentally plan to use the same copy again.
  const bpSource = getLastLoadedBlueprintSource();
  const sourceBlueprintItemId = (bpSource && bpSource.typeId === window.recipeTreeRoot.typeId) ? bpSource.itemId : undefined;

  // jobCount > 1 means runsNeeded does NOT mean "one job with this many runs" the way it does for
  // every other job - it's jobCount SEPARATE real jobs of (runsNeeded/jobCount) runs each, each
  // needing its own installation in EVE (an LP Store BPC redemption, or several physical copies of a
  // limited-run BPC planned via the root card's own "Jobs" field - see js/tree.js's own comment on
  // node.jobCount). Recorded on the job so the Ledger can show that distinction as "N Jobs x R Runs"
  // instead of a bare "N Runs" that reads identically to one real combined multi-run job.
  const jobCount = window.recipeTreeRoot.jobCount || 1;
  const runsPerJob = window.globalRuns || 1;

  const job = {
    id: rootJobId,
    typeId: window.recipeTreeRoot.typeId,
    name: rootJobName,
    productTypeId: window.recipeTreeRoot.productTypeId,
    runsNeeded: window.recipeTreeRoot.runsNeeded,
    qtyNeeded: window.recipeTreeRoot.qtyNeeded,
    calculatedCost: window.recipeTreeRoot.calculatedCost || 0,
    baseTime: baseTime,
    totalBuildSeconds: calculateTotalBuildSeconds(window.recipeTreeRoot),
    netProfit: window.recipeTreeRoot.netProfitSell || 0,
    sellStrategy: selectedStrategy,
    unitSellPrice: unitSellPrice,
    materials: materials,
    sourceBlueprintItemId: sourceBlueprintItemId,
    productionSnapshot: productionSnapshot,
    buildConfigSnapshot: buildConfigSnapshot,
    jobCount: jobCount,
    runsPerJob: runsPerJob,
    scope: 'personal',
    ownerCharId: addedByCharId,
    addedAt: new Date().toISOString()
  };

  // Sub-build (prerequisite) jobs go in first, final job last.
  queue.push(...subBuildJobs, job);
  localStorage.setItem('eve_ledger_jobs', JSON.stringify(queue));
  localStorage.setItem('eve_user_stock_map', JSON.stringify(window.userStockMap || {}));

  updateHeaderLedgerCount();
  // The "My Blueprints" panel's own "N/M runs queued" badge (renderBlueprintBrowserList, above) reads
  // fresh from eve_ledger_jobs on every render already - it was never stale data, just nothing here
  // was telling it to re-render after adding a job. filterBlueprintBrowser() is a no-op if the panel
  // was never opened this session (_blueprintBrowserData starts empty) or isn't currently in the DOM.
  if (typeof window.filterBlueprintBrowser === 'function') window.filterBlueprintBrowser();

  // A toast (not the clicked button's own text, which the recalculate() call above already
  // replaced by re-rendering the whole tree diagram - by the time execution gets here, e.target is
  // a detached node from the OLD render, so writing to it was never actually visible) - this is the
  // one piece of feedback for this action that's guaranteed to still be in the live DOM.
  if (typeof window.showToast === 'function') {
    const message = subBuildJobs.length > 0
      ? `Added ${subBuildJobs.length + 1} jobs to the queue (${window.esc(rootJobName)} + ${subBuildJobs.length} prerequisite${subBuildJobs.length > 1 ? 's' : ''}).`
      : `Added "${window.esc(rootJobName)}" to the job queue.`;
    window.showToast(message, 'success');
  }
}

function updateHeaderLedgerCount() {
  const badge = document.getElementById('header-journal-count');
  if (!badge) return;
  try {
    const saved = localStorage.getItem('eve_ledger_jobs');
    if (saved) {
      const queue = JSON.parse(saved);
      badge.textContent = Array.isArray(queue) ? queue.length.toString() : '0';
    } else {
      badge.textContent = '0';
    }
  } catch (e) {
    badge.textContent = '0';
  }
}

function onNodeClick(e, instanceId) {
  e.stopPropagation();
  window.selectedInstanceId = (window.selectedInstanceId === instanceId) ? null : instanceId;
  applyNodeHighlightClasses();
  drawConnectingLines();
}

function clearHighlight() {
  if (window.selectedInstanceId !== null) {
    window.selectedInstanceId = null;
    applyNodeHighlightClasses();
    drawConnectingLines();
  }
}

function findNodeByInstanceId(root, id) {
  if (!root) return null;
  if (root.instanceId === id) return root;
  if (root.children) {
    for (const child of root.children) {
      if (child) {
        const found = findNodeByInstanceId(child, id);
        if (found) return found;
      }
    }
  }
  return null;
}

// Same idea as nodeStableKey/resolveRenderedNode - pathKey survives a preserveView rebuild
// (toggleBuildSelf, an ME/TE edit) where instanceId doesn't, so re-finding a node by pathKey after
// one of those is how window.isolatedInstanceId gets re-synced to the freshly-rebuilt tree instead
// of going stale and silently kicking the user out of isolate mode (see recalculate's own use of
// this).
function findNodeByPathKey(root, pathKey) {
  if (!root || pathKey == null) return null;
  if (root.pathKey === pathKey) return root;
  if (root.children) {
    for (const child of root.children) {
      if (child) {
        const found = findNodeByPathKey(child, pathKey);
        if (found) return found;
      }
    }
  }
  return null;
}

function applyNodeHighlightClasses() {
  const allCards = document.querySelectorAll('.diagram-node');
  
  if (!window.selectedInstanceId) {
    allCards.forEach(card => {
      card.classList.remove('node-selected', 'node-child-highlight', 'node-parent-highlight', 'node-dimmed');
    });
    return;
  }

  const selectedNode = findNodeByInstanceId(window.recipeTreeRoot, window.selectedInstanceId);
  // A same-tier duplicate material merged into a shared card (renderTreeDiagram's merge pass) no
  // longer has a card of its own under its original instanceId - resolve through the same
  // __mergeRedirect map drawConnectingLinesForTree already uses to position the line, or a merged
  // child's real (surviving) card never picks up node-child-highlight even though its connecting
  // line does, leaving it looking unrelated to the selection it's actually feeding into.
  const childInstanceIds = new Set((selectedNode ? selectedNode.children : []).map(c =>
    (window.__mergeRedirect && window.__mergeRedirect[c.instanceId]) || c.instanceId
  ));
  const parentInstanceId = selectedNode ? selectedNode.parentInstanceId : null;

  allCards.forEach(card => {
    const instanceId = parseInt(card.getAttribute('data-instance-id'));
    card.classList.remove('node-selected', 'node-child-highlight', 'node-parent-highlight', 'node-dimmed');

    if (instanceId === window.selectedInstanceId) {
      card.classList.add('node-selected');
    } else if (childInstanceIds.has(instanceId)) {
      card.classList.add('node-child-highlight');
    } else if (instanceId === parentInstanceId) {
      card.classList.add('node-parent-highlight');
    } else if (window.isolatedInstanceId == null) {
      // Same reasoning as drawConnectingLinesForTree's own isDimmedConnection - isolate mode
      // already shows nothing but the one branch in view, so there's no "sea of unrelated cards"
      // for dimming to help a selection stand out against.
      card.classList.add('node-dimmed');
    }
  });
}

function highlightNodeByTypeId(typeId) {
  function findMatchingNode(node) {
    if (!node) return null;
    // BOM rows are keyed by productTypeId (the traded item). For raw materials, typeId and
    // productTypeId are the same, so the old typeId/displayTypeId-only check happened to work. But
    // for a manufacturable sub-component toggled to "Buy", node.typeId is the blueprint's own id while
    // productTypeId is the actual traded item the BOM row represents - only checking typeId/displayTypeId
    // silently failed to find those nodes, which is why clicking some BOM rows never centered anything.
    if (node.typeId === typeId || node.displayTypeId === typeId || node.productTypeId === typeId) return node;
    if (node.children) {
      for (const child of node.children) {
        if (child) {
          const found = findMatchingNode(child);
          if (found) return found;
        }
      }
    }
    return null;
  }

  let targetNode = findMatchingNode(window.recipeTreeRoot);
  if (targetNode) {
    // A BOM row can point at a material that renderTreeDiagram's own merge pass folded into a
    // shared card elsewhere (window.__mergeRedirect) - resolve to that survivor and make sure its
    // real position is actually open, or this silently selects a node with no card to center on.
    targetNode = resolveRenderedNode(targetNode);
    const needsExpand = ensureNodeVisible(targetNode);
    window.selectedInstanceId = targetNode.instanceId;
    if (needsExpand && typeof window.recalculate === 'function') window.recalculate();
    applyNodeHighlightClasses();
    // Drawn synchronously - see recalculate()'s own comment on why an immediate draw beats a
    // deferred one. scheduleConnectingLinesRedraw right after is just the placeholder-settling
    // follow-up correction, same as everywhere else.
    drawConnectingLines();
    window.scheduleConnectingLinesRedraw();
    centerOnSelectedNode();
  }
}

// Shows/hides the "you're isolated" banner (index.html/lpstore.html) and keeps its name current -
// called whenever isolate mode is entered, exited, or re-rendered, so it never goes stale (e.g.
// after a Build/Buy click extends the isolated branch and the banner needs to reflect that this is
// still the same isolated card, just with more now showing beneath it).
function updateIsolateModeBanner() {
  const banner = document.getElementById('isolate-mode-banner');
  if (!banner) return;
  if (window.isolatedInstanceId == null) {
    banner.classList.add('hidden');
    return;
  }
  const node = findNodeByInstanceId(window.recipeTreeRoot, window.isolatedInstanceId);
  const nameEl = document.getElementById('isolate-mode-banner-name');
  if (nameEl) nameEl.textContent = node ? (node.productName || node.name) : '';
  banner.classList.remove('hidden');
}
window.updateIsolateModeBanner = updateIsolateModeBanner;

function isolateComponent(e, instanceId) {
  if (e) e.stopPropagation();
  const node = findNodeByInstanceId(window.recipeTreeRoot, instanceId);
  window.isolatedInstanceId = instanceId;
  window.isolatedPathKey = node ? node.pathKey : null;
  window.selectedInstanceId = instanceId;
  renderIsolatedDiagram();
  // Drawn synchronously - renderIsolatedDiagram doesn't go through recalculate(), so this needs its
  // own immediate draw the same way; scheduleConnectingLinesRedraw right after is just the
  // placeholder-settling follow-up correction, same as everywhere else.
  drawConnectingLines();
  window.scheduleConnectingLinesRedraw();
  setTimeout(centerOnSelectedNode, 60);
}

function exitIsolation(e) {
  if (e) e.stopPropagation();
  const targetId = window.isolatedInstanceId || window.selectedInstanceId;
  window.isolatedInstanceId = null;
  window.isolatedPathKey = null;
  updateIsolateModeBanner();
  recalculate();
  setTimeout(() => {
    window.selectedInstanceId = targetId;
    applyNodeHighlightClasses();
    // Drawn synchronously - see recalculate()'s own comment on why an immediate draw beats a
    // deferred one.
    drawConnectingLines();
    window.scheduleConnectingLinesRedraw();
    centerOnSelectedNode();
  }, 60);
}

function renderIsolatedDiagram() {
  const container = document.getElementById('tree-container');
  if (!container) return;
  container.innerHTML = '';

  const isolatedNode = findNodeByInstanceId(window.recipeTreeRoot, window.isolatedInstanceId);
  if (!isolatedNode) return;
  updateIsolateModeBanner();

  const parentNode = isolatedNode.parentInstanceId ? findNodeByInstanceId(window.recipeTreeRoot, isolatedNode.parentInstanceId) : null;

  if (!isolatedNode.isBuildingSelf || isolatedNode.children.length === 0) {
    const placeholderCol = document.createElement('div');
    placeholderCol.className = 'flex flex-col space-y-4 justify-center';
    placeholderCol.innerHTML = `<div class="bg-[#0a0d0e] border border-orange-500/20 p-3 text-xs text-slate-400 mono ">${!isolatedNode.isBuildingSelf ? 'Purchased off Market (No decomposed inputs)' : 'No inputs (Base Material)'}</div>`;
    container.appendChild(placeholderCol);
  }

  // Everything connected to the isolated node, all the way down - not just its direct children.
  // Reuses the exact same traverse/merge/auto-compact pipeline the main diagram runs, rooted at
  // isolatedNode instead of window.recipeTreeRoot, so a big component's own branch gets the same
  // compacting treatment instead of an unbounded column. isolatedNode's own column (the traversal's
  // own root) naturally ends up rightmost among these, right where the old fixed "center" card used
  // to sit.
  renderSubtreeColumns(container, isolatedNode);

  // Output side deliberately stays exactly one level - the immediate parent this node feeds into,
  // not the full path back to the final product. That's the one relationship outside isolatedNode's
  // own subtree, so it's still drawn separately below rather than through renderSubtreeColumns.
  const outputCol = document.createElement('div');
  outputCol.className = 'flex flex-col justify-center';

  if (parentNode) {
    outputCol.appendChild(createNodeCard(parentNode));
  } else {
    outputCol.innerHTML = `<div class="bg-[#0a0d0e] border border-orange-500/50 p-3 text-xs text-orange-300 font-bold mono ">Final Target Output</div>`;
  }
  container.appendChild(outputCol);

  applyNodeHighlightClasses();
}

function centerOnInstanceId(targetId) {
  if (!targetId) return;

  const card = document.getElementById(`node-card-${targetId}`);
  const viewport = document.getElementById('viewport');
  const content = document.getElementById('pan-zoom-content');

  if (!card || !viewport || !content) return;

  viewport.scrollTop = 0;
  viewport.scrollLeft = 0;

  const viewportRect = viewport.getBoundingClientRect();
  const contentRect = content.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();

  const cardContentX = (cardRect.left - contentRect.left) / window.zoomScale;
  const cardContentY = (cardRect.top - contentRect.top) / window.zoomScale;

  const cardContentWidth = cardRect.width / window.zoomScale;
  const cardContentHeight = cardRect.height / window.zoomScale;

  const cardContentCenterX = cardContentX + cardContentWidth / 2;
  const cardContentCenterY = cardContentY + cardContentHeight / 2;

  window.panX = (viewportRect.width / 2) - cardContentCenterX * window.zoomScale;
  window.panY = (viewportRect.height / 2) - cardContentCenterY * window.zoomScale;

  updateTransform();
  // Drawn synchronously - centerOnInstanceId is the shared camera-move primitive behind F/
  // centerOnRootNode/centerOnSelectedNode, and just moved the camera again here, same reasoning as
  // recalculate()'s own comment on why an immediate draw beats a deferred one.
  drawConnectingLines();
  window.scheduleConnectingLinesRedraw();

  card.classList.add('ring-4', 'ring-orange-400');
  setTimeout(() => card.classList.remove('ring-4', 'ring-orange-400'), 800);
}

function centerOnRootNode() {
  if (window.recipeTreeRoot) centerOnInstanceId(window.recipeTreeRoot.instanceId);
}

function centerOnSelectedNode() {
  let targetId = window.isolatedInstanceId || window.selectedInstanceId;

  if (!targetId && window.recipeTreeRoot) {
    targetId = window.recipeTreeRoot.instanceId;
  }

  centerOnInstanceId(targetId);
}

// Replaces every plain setTimeout(drawConnectingLines, 50) elsewhere in this file - reported directly as a brief
// flicker (blank, then lines) right after a page load or a Collapse/Expand click. Direct side effect
// of the fix just above: clearing the SVG the instant the cards move (instead of only when the
// redraw itself runs, 50ms later) is what fixed the worse bug - stale, visibly-misaligned old lines
// - but a flat 50ms wall-clock delay is both slower than it needs to be (the browser is usually
// done painting the new layout well before that) and, more importantly, un-coalesced: page load in
// particular can trigger several recalculate() calls in quick succession (the initial render, then
// the price-fetch completion a moment later, sometimes more) - each one clearing the SVG again the
// instant it starts, independently of whether the PREVIOUS one's own redraw had even landed yet,
// which is exactly what a multi-clear-then-redraw flicker looks like. Cancelling any still-pending
// redraw before scheduling a new one means only the LAST of several rapid recalculate() calls ever
// actually redraws - and a double requestAnimationFrame (wait for the browser to have already
// painted the current, just-cleared frame, then draw on the next one) lands far sooner than 50ms
// while still giving layout every chance to have fully settled first.
let _pendingLinesRedrawFrame = null;
function scheduleConnectingLinesRedraw() {
  if (_pendingLinesRedrawFrame) cancelAnimationFrame(_pendingLinesRedrawFrame);
  _pendingLinesRedrawFrame = requestAnimationFrame(() => {
    _pendingLinesRedrawFrame = requestAnimationFrame(() => {
      _pendingLinesRedrawFrame = null;
      drawConnectingLines();
    });
  });
}
window.scheduleConnectingLinesRedraw = scheduleConnectingLinesRedraw;

function drawConnectingLines() {
  const svg = document.getElementById('tree-svg');
  const container = document.getElementById('tree-container');
  if (!svg || !container) return;
  
  svg.setAttribute('width', container.scrollWidth);
  svg.setAttribute('height', container.scrollHeight);
  svg.innerHTML = '';

  if (!window.recipeTreeRoot) return;

  const containerRect = container.getBoundingClientRect();

  if (window.isolatedInstanceId !== null) {
    const isolatedNode = findNodeByInstanceId(window.recipeTreeRoot, window.isolatedInstanceId);
    if (!isolatedNode) return;

    // Every line INSIDE the isolated branch (isolatedNode down through its full recursive
    // subtree, per renderIsolatedDiagram's own use of renderSubtreeColumns) reuses the exact same
    // walk/highlight/merge-redirect logic the main diagram uses - only the ONE line going the
    // other way, up to the immediate parent/output, is special-cased below, since that parent
    // isn't part of isolatedNode's own subtree.
    drawConnectingLinesForTree(isolatedNode);

    if (isolatedNode.parentInstanceId) {
      const parentNode = findNodeByInstanceId(window.recipeTreeRoot, isolatedNode.parentInstanceId);
      const isoEl = document.getElementById(`node-card-${window.isolatedInstanceId}`);
      const parentEl = parentNode ? document.getElementById('node-card-' + parentNode.instanceId) : null;
      if (isoEl && parentEl) {
        const isoRect = isoEl.getBoundingClientRect();
        const isoRightX = (isoRect.right - containerRect.left) / window.zoomScale;
        const isoCenterY = (isoRect.top + isoRect.height / 2 - containerRect.top) / window.zoomScale;
        const parentRect = parentEl.getBoundingClientRect();
        const endX = (parentRect.left - containerRect.left) / window.zoomScale;
        const endY = (parentRect.top + parentRect.height / 2 - containerRect.top) / window.zoomScale;

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', `M ${isoRightX} ${isoCenterY} C ${isoRightX + 40} ${isoCenterY}, ${endX - 40} ${endY}, ${endX} ${endY}`);
        path.setAttribute('stroke', '#6a98de');
        path.setAttribute('stroke-width', '3.5');
        path.setAttribute('stroke-opacity', '1.0');
        path.setAttribute('fill', 'none');
        svg.appendChild(path);
      }
    }
    return;
  }

  drawConnectingLinesForTree(window.recipeTreeRoot);
}

function drawConnectingLinesForTree(root) {
  if (!root) return;
  
  const container = document.getElementById('tree-container');
  const svg = document.getElementById('tree-svg');
  if (!svg || !container) return;

  const containerRect = container.getBoundingClientRect();
  const selectedNode = window.selectedInstanceId ? findNodeByInstanceId(window.recipeTreeRoot, window.selectedInstanceId) : null;
  const activeChildIds = new Set(selectedNode ? selectedNode.children.map(c => c.instanceId) : []);
  const parentInstanceId = selectedNode ? selectedNode.parentInstanceId : null;

  function drawLinesForNode(node) {
    if (!node.isBuildingSelf || !node.children || node.children.length === 0) return;

    const parentEl = document.getElementById(`node-card-${node.instanceId}`);
    if (!parentEl) return;

    const parentRect = parentEl.getBoundingClientRect();
    
    const endX = (parentRect.left - containerRect.left) / window.zoomScale;
    const endY = (parentRect.top + parentRect.height / 2 - containerRect.top) / window.zoomScale;

    node.children.forEach(child => {
      if (child) {
        // A merged-away duplicate material (renderTreeDiagram's own merge pass) has no card of its
        // own anymore - every parent that originally needed it still redirects here to the one
        // surviving card instead, so a shared material naturally ends up with a line from every
        // real consumer converging on it.
        const redirectedChildId = (window.__mergeRedirect && window.__mergeRedirect[child.instanceId]) || child.instanceId;
        const childEl = document.getElementById(`node-card-${redirectedChildId}`);
        if (childEl) {
          const childRect = childEl.getBoundingClientRect();
          
          const startX = (childRect.right - containerRect.left) / window.zoomScale;
          const startY = (childRect.top + childRect.height / 2 - containerRect.top) / window.zoomScale;

          const controlX1 = startX + 40;
          const controlX2 = endX - 40;

          const isInputConnection = (window.selectedInstanceId !== null) && 
            (node.instanceId === window.selectedInstanceId && activeChildIds.has(child.instanceId));

          const isOutputConnection = (window.selectedInstanceId !== null) && 
            (child.instanceId === window.selectedInstanceId && node.instanceId === parentInstanceId);

          const isHighlightedConnection = isInputConnection || isOutputConnection;
          // Isolate mode already shows nothing but this one branch - every line in it is relevant,
          // so skip the "fade everything except the current selection" treatment that exists to
          // make a selection stand out among a sea of UNrelated lines in the full diagram. Without
          // this, the whole branch beyond the isolated node's own immediate neighbors would render
          // at near-zero opacity by default, defeating the point of showing it at all.
          const isDimmedConnection = (window.selectedInstanceId !== null) && !isHighlightedConnection && window.isolatedInstanceId == null;

          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.setAttribute('d', `M ${startX} ${startY} C ${controlX1} ${startY}, ${controlX2} ${endY}, ${endX} ${endY}`);
          
          if (isHighlightedConnection) {
            path.setAttribute('stroke', isOutputConnection ? '#6a98de' : '#c8ff4d');
            path.setAttribute('stroke-width', '3.5');
            path.setAttribute('stroke-opacity', '1.0');
          } else if (isDimmedConnection) {
            path.setAttribute('stroke', '#6b7078');
            path.setAttribute('stroke-width', '1.5');
            path.setAttribute('stroke-opacity', '0.12');
          } else if (child.isRedemptionRequirement) {
            // Matches the redemption-requirement card's own purple accent (isRedemptionRequirement,
            // js/lpstore.js injectLPRedemptionNodes) - visually separates "turned in to redeem this
            // offer" lines from ordinary build-material ones at a glance.
            path.setAttribute('stroke', '#c084fc');
            path.setAttribute('stroke-width', '2');
            path.setAttribute('stroke-opacity', '0.8');
          } else {
            path.setAttribute('stroke', '#6b7078');
            path.setAttribute('stroke-width', '2');
            path.setAttribute('stroke-opacity', '0.75');
          }

          path.setAttribute('fill', 'none');
          svg.appendChild(path);
        }
      }
      drawLinesForNode(child);
    });
  }

  drawLinesForNode(root);
}

let bomViewMode = localStorage.getItem('eve_bom_view_mode') || 'card'; // 'card' | 'compact'
let bomOrderFilter = 'all'; // 'all' | 'buy' | 'sell'
let bomCategoryFilter = 'all'; // 'all' | 'minerals' | 'pigas' | 'fuel' | 'ships' | 'others'

// Wrapped in withRootPanAnchor (app.js) - a BOM panel pill, not a diagram card.
async function setBOMCategoryFilter(cat) {
  bomCategoryFilter = cat;
  await window.withRootPanAnchor(async () => {
    if (typeof window.recalculate === 'function') await window.recalculate();
  });
}
window.setBOMCategoryFilter = setBOMCategoryFilter;

function updateBomViewModeButtonLabel() {
  const btn = document.getElementById('btn-bom-view-mode');
  if (btn) btn.innerHTML = bomViewMode === 'compact'
    ? window.svgIcon('grid') + ' Detailed'
    : window.svgIcon('list') + ' Compact';
}

// Wrapped in withRootPanAnchor (app.js) - a BOM panel button, not a diagram card.
async function toggleBomViewMode() {
  bomViewMode = bomViewMode === 'compact' ? 'card' : 'compact';
  localStorage.setItem('eve_bom_view_mode', bomViewMode);
  updateBomViewModeButtonLabel();
  await window.withRootPanAnchor(async () => {
    if (typeof window.recalculate === 'function') await window.recalculate();
  });
}
window.toggleBomViewMode = toggleBomViewMode;

// Wrapped in withRootPanAnchor (app.js) - a BOM panel pill, not a diagram card.
async function setBOMOrderFilter(type) {
  bomOrderFilter = type;
  const btnAll = document.getElementById('btn-bom-order-all');
  const btnBuy = document.getElementById('btn-bom-order-buy');
  const btnSell = document.getElementById('btn-bom-order-sell');
  const pillStyle = 'padding:5px 12px;';
  if (btnAll) { btnAll.className = `lp-pill${type === 'all' ? ' active' : ''}`; btnAll.style.cssText = pillStyle; }
  if (btnBuy) { btnBuy.className = `lp-pill${type === 'buy' ? ' active' : ''}`; btnBuy.style.cssText = pillStyle; }
  if (btnSell) { btnSell.className = `lp-pill${type === 'sell' ? ' active' : ''}`; btnSell.style.cssText = pillStyle; }
  await window.withRootPanAnchor(async () => {
    if (typeof window.recalculate === 'function') await window.recalculate();
  });
}
window.setBOMOrderFilter = setBOMOrderFilter;

// Whether the Bill of Materials' "Already in Stock" section is expanded - same collapsible-divider
// system as the Ledger's Consolidated BOM (js/ledger.js), applied here too. Defaults collapsed: stock
// you already own is the least important thing on this list, what you still need to buy is what
// matters, so it starts tucked behind the divider instead of competing for attention with the actual
// shopping list above it. Session-only (not persisted), same as this app's other display toggles.
let isCalcAcquiredBomSectionExpanded = false;
// Wrapped in withRootPanAnchor (app.js) - a BOM panel divider toggle, not a diagram card.
async function toggleCalcAcquiredBomSection() {
  isCalcAcquiredBomSectionExpanded = !isCalcAcquiredBomSectionExpanded;
  await window.withRootPanAnchor(async () => {
    if (typeof recalculate === 'function') await recalculate();
  });
}
window.toggleCalcAcquiredBomSection = toggleCalcAcquiredBomSection;

function renderBillOfMaterials(rootNode, brokerFee = 0) {
  const listContainer = document.getElementById('bom-items-list');
  if (!listContainer) return;
  listContainer.innerHTML = '';

  if (!rootNode) return;

  const deductModeInput = document.getElementById('deduct-stock-mode');
  const isStockDeductEnabled = deductModeInput ? deductModeInput.value === 'true' : true;
  const bomMap = {};
  // Shared pool that gets decremented as materials are claimed across the WHOLE tree - reading
  // window.userStockMap directly per-leaf (the previous approach) let the same physical stock get
  // counted as covering multiple different sub-components' needs simultaneously, whenever the same
  // raw material (e.g. Tritanium) was needed in more than one place in the build. Starts from
  // stockAfterLedgerClaims, not raw userStockMap - materials already claimed by the Ledger's own
  // queued/started jobs aren't actually free to use here either (see computeStockAfterLedgerClaims'
  // own comment in js/config.js - reported directly: the Ledger's own BOM correctly accounted for
  // this, but "the calculator still thinks I have all the items needed").
  const allocatedStockPool = { ...(window.stockAfterLedgerClaims || window.userStockMap) };

  function generateBOM(node) {
    if (!node) return;
    if (!node.isBuildingSelf || !node.children || node.children.length === 0) {
      const typeId = node.displayTypeId || node.typeId;
      const strategy = window.getNodePriceStrategy(node);
      // An 'lp' component is redeemed from an LP store, not bought on the market - it has no place
      // in a market shopping list/Copy Multibuy, so it's left out of the BOM entirely (its own cost
      // is tracked separately, see js/lpstore.js's LP-specific stat strip).
      if (strategy === 'lp') return;

      const productTypeId = node.productTypeId || node.typeId;
      const availableStock = isStockDeductEnabled ? (allocatedStockPool[productTypeId] || allocatedStockPool[node.typeId] || 0) : 0;
      const consumedFromStock = Math.min(node.qtyNeeded, availableStock);
      if (isStockDeductEnabled && allocatedStockPool[productTypeId] !== undefined) {
        allocatedStockPool[productTypeId] = Math.max(0, allocatedStockPool[productTypeId] - consumedFromStock);
      }
      const netQtyNeeded = Math.max(0, node.qtyNeeded - consumedFromStock);

      if (!bomMap[productTypeId]) {
        bomMap[productTypeId] = {
          typeId: productTypeId,
          name: node.name.replace(' Blueprint', ''),
          qty: 0,
          totalQtyNeeded: 0, // gross demand BEFORE stock deduction - lets a fully-covered item still
                              // show up (in the "Already in Stock" section) instead of vanishing outright
          strategy: strategy
        };
      }
      bomMap[productTypeId].qty += netQtyNeeded;
      bomMap[productTypeId].totalQtyNeeded += node.qtyNeeded;
    } else {
      node.children.forEach(child => {
        if (child) generateBOM(child);
      });
    }
  }

  if (rootNode.isBuildingSelf && rootNode.children && rootNode.children.length > 0) {
    rootNode.children.forEach(c => {
      if (c) generateBOM(c);
    });
  } else {
    const rootTypeId = rootNode.productTypeId || rootNode.typeId;
    const strategy = getNodeStrategyOnly(rootNode); // safe strategy getter
    // stockAfterLedgerClaims, not raw userStockMap - see computeStockAfterLedgerClaims' own comment
    // in js/config.js.
    const stockQty = isStockDeductEnabled ? (allocatedStockPool[rootTypeId] || allocatedStockPool[rootNode.typeId] || 0) : 0;
    const netQtyNeeded = Math.max(0, rootNode.qtyNeeded - stockQty);

    bomMap[rootTypeId] = { typeId: rootTypeId, name: rootNode.productName || rootNode.name.replace(' Blueprint', ''), qty: netQtyNeeded, totalQtyNeeded: rootNode.qtyNeeded, strategy: strategy };
  }

  // Keeps a fully-stock-covered item (qty === 0) IN the list now, instead of filtering it out - it
  // still has real demand (totalQtyNeeded > 0), just none of it left to buy. Only genuine zero-demand
  // entries (shouldn't normally occur, but a stale/rounding edge case isn't impossible) get dropped.
  const bomItems = Object.values(bomMap).filter(item => {
    if (item.totalQtyNeeded <= 0) return false;
    if (bomOrderFilter !== 'all' && item.strategy !== bomOrderFilter) return false;
    if (bomCategoryFilter !== 'all' && window.getItemCategory(item.typeId, item.name) !== bomCategoryFilter) return false;
    return true;
  });
  let totalBOMCost = 0;
  let totalBOMVolume = 0;

  bomItems.forEach(item => {
    const prices = window.priceCache[item.typeId] || { sell: 0, buy: 0 };
    let unitPrice = item.strategy === 'sell' ? prices.sell : prices.buy;
    if (item.strategy === 'buy') {
      unitPrice = unitPrice * (1 + brokerFee);
    }
    item.unitPrice = unitPrice;
    item.lineCost = unitPrice * item.qty;
    totalBOMCost += item.lineCost;
    const unitVolume = (window.EVE_VOLUMES && window.EVE_VOLUMES[item.typeId]) || 0;
    item.lineVolume = unitVolume * item.qty;
    totalBOMVolume += item.lineVolume;
  });

  bomItems.sort((a, b) => b.lineCost - a.lineCost);

  updateBomViewModeButtonLabel();
  const isCompact = bomViewMode === 'compact';

  // Buy stays lime (matches the buy/sell toggle buttons, where buy is highlighted as "usually more
  // profitable"); sell gets a distinct blue so the two read apart instead of both being green.
  const buildStrategyBadgeHTML = (item) => item.strategy === 'sell'
    ? `<span class="lp-badge lp-badge-blue">SELL</span>`
    : `<span class="lp-badge lp-badge-accent">BUY</span>`;

  // Shared row builder for both groups below - an "acquired" row (fully covered by stock) drops the
  // click-to-focus behavior, the qty/unit-price breakdown, and the ISK figure (replaced with a plain
  // "✔ In Stock", muted rather than green - stock you already own shouldn't visually outrank what you
  // still need to buy, which is what actually matters here).
  function buildBOMRowElement(item, isAcquired) {
    const row = document.createElement('div');
    const strategyBadge = buildStrategyBadgeHTML(item);
    const costOrInStockHTML = isAcquired
      ? `<span class="font-bold mono flex-shrink-0" style="color:var(--text-mute);">${window.svgIcon('check')} In Stock</span>`
      : `<span class="font-bold mono flex-shrink-0" style="color:var(--cost);">${Math.round(item.lineCost).toLocaleString()} ISK${window.estimatedPriceMarker ? window.estimatedPriceMarker(item.typeId) : ''}</span>`;
    // Clickable regardless of stock status - an "Already in Stock" row is still a real material in
    // the build diagram, just one you don't need to buy; there's no reason jumping to it in the tree
    // should only work for the ones you still need to shop for.
    row.title = 'Click to find and focus this material in the build diagram';
    row.onclick = () => highlightNodeByTypeId(item.typeId);

    if (isCompact) {
      row.className = 'lp-list-item cursor-pointer';
      row.style.cssText = 'padding-left:0; padding-right:0;';
      row.innerHTML = `
        <img src="https://images.evetech.net/types/${item.typeId}/icon?size=32" alt="${window.esc(item.name)}" class="w-5 h-5 rounded flex-shrink-0" loading="lazy" onerror="this.onerror=null; this.src='https://images.evetech.net/types/${item.typeId}/render?size=32';">
        ${strategyBadge}
        <span class="font-semibold truncate flex-1" style="color:var(--text-soft);"><span class="copy-name" data-copy-name="${window.esc(item.name)}" onclick="copyNameToClipboard(event)" title="Click to copy: ${window.esc(item.name)}">${item.name}</span></span>
        ${isAcquired ? '' : `<span class="text-xs mono flex-shrink-0" style="color:var(--text-mute);">&times;${item.qty.toLocaleString()}</span>`}
        <span class="flex-shrink-0 w-24 text-right">${costOrInStockHTML}</span>
      `;
    } else {
      row.className = 'lp-card p-2.5 transition cursor-pointer';
      row.innerHTML = `
        <div class="flex items-start gap-2.5">
          <img src="https://images.evetech.net/types/${item.typeId}/icon?size=32" alt="${window.esc(item.name)}" class="w-8 h-8 rounded-md flex-shrink-0" loading="lazy" onerror="this.onerror=null; this.src='https://images.evetech.net/types/${item.typeId}/render?size=32';">
          <div class="min-w-0 flex-1">
            <div class="flex items-center justify-between gap-2">
              <span class="font-semibold truncate" style="color:var(--text-soft);"><span class="copy-name" data-copy-name="${window.esc(item.name)}" onclick="copyNameToClipboard(event)" title="Click to copy: ${window.esc(item.name)}">${item.name}</span></span>
              ${costOrInStockHTML}
            </div>
            <div class="flex items-center gap-1 mt-1.5">
              ${strategyBadge}
            </div>
            ${isAcquired ? '' : `<div class="text-xs mono mt-1.5" style="color:var(--text-mute);">Qty: ${item.qty.toLocaleString()} &times; ${Math.round(item.unitPrice).toLocaleString()} ISK${item.lineVolume > 0 ? ` &bull; ${item.lineVolume.toLocaleString(undefined, {maximumFractionDigits: 1})} m3` : ''}</div>`}
          </div>
        </div>
      `;
    }
    return row;
  }

  const needToBuyItems = bomItems.filter(item => item.qty > 0);
  const acquiredItems = bomItems.filter(item => item.qty === 0);

  needToBuyItems.forEach(item => listContainer.appendChild(buildBOMRowElement(item, false)));

  if (acquiredItems.length > 0) {
    const divider = document.createElement('div');
    divider.className = 'lp-group-header mt-2.5 mb-2.5';
    divider.style.cursor = 'pointer';
    divider.title = isCalcAcquiredBomSectionExpanded ? 'Collapse' : 'Expand';
    divider.onclick = () => window.toggleCalcAcquiredBomSection();
    divider.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px; height:13px; flex-shrink:0; transform:rotate(${isCalcAcquiredBomSectionExpanded ? '0' : '-90'}deg); transition:transform 0.15s ease;"><polyline points="6 9 12 15 18 9"/></svg>
      <span class="text-xs font-bold uppercase tracking-wide" style="color:var(--text-mute);">Already in Stock</span>
      <span class="text-xs font-bold mono ml-auto" style="color:var(--text-mute);">${acquiredItems.length.toLocaleString()}</span>
    `;
    listContainer.appendChild(divider);
    if (isCalcAcquiredBomSectionExpanded) {
      acquiredItems.forEach(item => listContainer.appendChild(buildBOMRowElement(item, true)));
    }
  }

  const countEl = document.getElementById('bom-type-count');
  if (countEl) countEl.textContent = bomItems.length.toLocaleString();

  const totalEl = document.getElementById('bom-total-isk');
  if (totalEl) totalEl.textContent = Math.round(totalBOMCost).toLocaleString() + ' ISK';

  const volumeEl = document.getElementById('bom-total-volume');
  if (volumeEl) volumeEl.textContent = totalBOMVolume.toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' m3';

  // Only what's actually still needed - bomItems now also carries fully-stock-covered entries (qty
  // === 0, shown in the "Already in Stock" section), which have nothing left to buy and would only
  // pollute a multibuy paste with "Item x0" lines if included here.
  window.currentBOMText = bomItems.filter(i => i.qty > 0).map(i => `${i.name} x${i.qty}`).join('\n');
}

function getNodeStrategyOnly(node) {
  if (!node) return 'sell';
  const globalStrategy = document.getElementById('input-price-mode')?.value || 'sell';
  return window.customBuyModes[node.typeId] || globalStrategy;
}

// --- Icon rail flyout navigation ---
// Single-panel model: exactly one of these sections is ever shown at a time, inside the one
// #control-flyout panel, switched by clicking its icon-rail tab. Replaced the old model where each
// icon opened its OWN independent floating popover (any combination of which could be open at
// once, JS-stacked top-to-bottom by measuring each one's height every time) - that let the sidebar
// turn into an unpredictable pile of separately-shaped boxes; this can't, by construction.
const FLYOUT_TITLES = {
  pricing: 'Pricing',
  build: 'Build & Optimize',
  structure: 'System & Structure',
  implants: 'Pilot Implants',
  fees: 'Taxes & Fees',
  markets: 'Markets',
  skills: 'Skills',
  // 'store'/'station' are lpstore.html-only section ids (its own icon-rail reuses this exact
  // lookup, plus 'pricing'/'build'/'fees' above for the sections it shares in spirit with the
  // Calculator) - harmless extra keys here, index.html never asks for either.
  store: 'LP Store',
  station: 'Production Station'
};

function openFlyoutSection(sectionId) {
  const panel = document.getElementById('control-flyout');
  const targetBtn = document.getElementById(`icon-btn-${sectionId}`);
  const targetSection = document.getElementById(`flyout-${sectionId}`);
  if (!panel || !targetBtn || !targetSection) return;

  // Clicking the tab that's already open closes the panel instead of re-opening it - same toggle
  // behavior the old per-flyout buttons had, just against the one shared panel now.
  if (panel.classList.contains('open') && targetBtn.classList.contains('icon-rail-btn-active')) {
    closeFlyoutPanel();
    return;
  }

  document.querySelectorAll('#control-sidebar .icon-rail-btn').forEach(b => b.classList.remove('icon-rail-btn-active'));
  document.querySelectorAll('#control-flyout .flyout-section').forEach(s => s.classList.remove('active'));
  targetBtn.classList.add('icon-rail-btn-active');
  targetSection.classList.add('active');
  const titleEl = document.getElementById('flyout-panel-title');
  if (titleEl) titleEl.textContent = FLYOUT_TITLES[sectionId] || '';
  panel.classList.add('open');
}
window.openFlyoutSection = openFlyoutSection;

function closeFlyoutPanel() {
  const panel = document.getElementById('control-flyout');
  if (panel) panel.classList.remove('open');
  document.querySelectorAll('#control-sidebar .icon-rail-btn').forEach(b => b.classList.remove('icon-rail-btn-active'));
}
window.closeFlyoutPanel = closeFlyoutPanel;

function copyMaterialNameToClipboard(event, el, name) {
  if (event) event.stopPropagation();
  window.copyToClipboardWithFeedback(name, el, { duration: 1200, flashClassName: 'truncate text-green-400 font-bold transition' });
}
window.copyMaterialNameToClipboard = copyMaterialNameToClipboard;

function copyMultibuyText() {
  if (!window.currentBOMText) return;
  const btn = document.querySelector('button[onclick="copyMultibuyText()"]');
  window.copyToClipboardWithFeedback(window.currentBOMText, btn);
}

// Smooth Pan and Zoom Engine
const viewport = document.getElementById('viewport');
const content = document.getElementById('pan-zoom-content');

if (viewport) {
  // Right mouse button drags to pan, via the Pointer Events API - NOT plain mousedown/mousemove/
  // mouseup, which was tried first and was unreliable on real hardware: a right-button hold also
  // arms the browser's own context-menu gesture recognition, and plain mouse events aren't
  // guaranteed to dispatch promptly while that's being resolved - reported as "doesn't pan while
  // held, gets stuck, then dumps all the movement at once on release." move/end listeners are on
  // window (same as the original middle-click version), not just #viewport, so tracking never
  // depends on the cursor staying inside the viewport's own box. setPointerCapture is layered on
  // top as a *bonus* - the same technique map/canvas tools (Mapbox GL JS, Figma, etc.) use for
  // exactly this gesture - but wrapped defensively: it can throw (confirmed while testing this),
  // and a thrown, uncaught error there would silently abort the rest of pointerdown and leave
  // isPanning stuck false, i.e. right-click doing nothing at all.
  viewport.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('contextmenu', (e) => {
    if (window.isPanning) e.preventDefault();
  });

  viewport.addEventListener('pointerdown', (e) => {
    if (e.button === 2) {
      e.preventDefault();
      try { viewport.setPointerCapture(e.pointerId); } catch (err) {}
      window.isPanning = true;
      window.panPointerId = e.pointerId;
      window.startX = e.clientX - window.panX;
      window.startY = e.clientY - window.panY;
      viewport.style.cursor = 'grabbing';
      suspendCardBlurDuringPanZoom();
    }
  });

  // rAF-batched, not applied straight off every pointermove - a real mouse/trackpad can fire that
  // event far more often than the screen actually repaints (measured 100-200+/sec on real hardware,
  // well past a 60-144Hz refresh rate), and updateTransform's write was happening once per EVENT
  // instead of once per FRAME. Individually cheap, but on a big capital ship build (1000+ rendered
  // cards, see suspendCardBlurDuringPanZoom's own comment on the same-sized problem with blur) the
  // sheer call volume was enough to back up the main thread and show up as exactly the classic
  // "cursor gets ahead of the canvas, then it jerks to catch up" pattern - reported directly as
  // "moving the camera is super stuttery" even after blur-suspend already shipped. Storing only the
  // latest event and flushing at most once per animation frame is the standard fix for this whole
  // class of problem (the same technique any pan/zoom canvas tool - Figma, Mapbox GL JS, etc. - uses,
  // consistent with this file's own pointer-capture comment above citing the same precedent).
  let pendingPanClientX = 0, pendingPanClientY = 0, panRafScheduled = false;
  function flushPanFrame() {
    panRafScheduled = false;
    if (!window.isPanning) return;
    window.panX = pendingPanClientX - window.startX;
    window.panY = pendingPanClientY - window.startY;
    updateTransform();
  }
  window.addEventListener('pointermove', (e) => {
    if (window.isPanning && e.pointerId === window.panPointerId) {
      pendingPanClientX = e.clientX;
      pendingPanClientY = e.clientY;
      if (!panRafScheduled) {
        panRafScheduled = true;
        requestAnimationFrame(flushPanFrame);
      }
    }
  });

  function endViewportPan(e) {
    if (!window.isPanning) return;
    if (e && e.pointerId !== undefined && e.pointerId !== window.panPointerId) return;
    window.isPanning = false;
    try { viewport.releasePointerCapture(window.panPointerId); } catch (err) {}
    window.panPointerId = null;
    viewport.style.cursor = 'grab';
    resumeCardBlurAfterPanZoom(0);
  }
  window.addEventListener('pointerup', endViewportPan);
  window.addEventListener('pointercancel', endViewportPan);
  // Safety net: if pointerup/pointercancel is ever missed (window loses focus mid-drag), don't
  // leave panning stuck on with no way to turn it back off short of reloading the page.
  window.addEventListener('blur', () => endViewportPan(null));

  // Same rAF-batching as the pan handler above for updateTransform (a trackpad's momentum scroll
  // fires wheel events just as fast as a mouse fires pointermove). drawConnectingLines is worse than
  // updateTransform though - it walks the whole tree and calls getBoundingClientRect() per card, real
  // layout-forcing work - so unlike updateTransform it isn't just batched to once/frame, it's pushed
  // out entirely until scrolling actually stops (same debounce idea already used for the blur
  // resume below, reusing its own delay), instead of paying that cost on every single tick.
  let pendingZoomRafScheduled = false;
  let wheelLinesRedrawTimeout = null;
  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
    const newScale = Math.min(Math.max(0.2, window.zoomScale * zoomFactor), 3.0);

    const rect = viewport.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    window.panX = mouseX - (mouseX - window.panX) * (newScale / window.zoomScale);
    window.panY = mouseY - (mouseY - window.panY) * (newScale / window.zoomScale);
    window.zoomScale = newScale;

    if (!pendingZoomRafScheduled) {
      pendingZoomRafScheduled = true;
      requestAnimationFrame(() => { pendingZoomRafScheduled = false; updateTransform(); });
    }
    clearTimeout(wheelLinesRedrawTimeout);
    wheelLinesRedrawTimeout = setTimeout(drawConnectingLines, 150);
    // No pointerup-equivalent for a wheel gesture, so debounce it instead - each tick pushes the
    // resume back out, and it only actually fires once scrolling has genuinely stopped for a beat.
    suspendCardBlurDuringPanZoom();
    resumeCardBlurAfterPanZoom(150);
  }, { passive: false });
}

// Every tree card has backdrop-filter: blur() for the "glass" look (see .glass-card's own comment
// on why that's kept even though it's expensive) - fine for a static card, but reported directly
// as "the canvas navigation becomes quite laggy" on a big capital ship build, and measured directly:
// a stress test at ~1500 rendered cards (a fully-expanded capital ship after Build All easily
// reaches this - merged materials and auto-compact both help, but a wide-and-shallow tree, or one
// that's had Expand All used on it, can still land here) went from ~11ms/frame with blur off to
// ~2000ms/frame with it on, while panning - the browser has to re-sample the blur for every single
// card on every frame the content moves under it. Suspending it for the exact duration of an active
// pan or zoom gesture (never permanently - see resume below) keeps the identical look the rest of
// the time, since a still card costs nothing extra, while eliminating the actual laggy moment. Scoped
// to just #pan-zoom-content's own cards via the CSS selector (css/styles.css) - the header/sidebar/
// BOM panel have a small, fixed element count regardless of tree size and were never the problem.
let cardBlurResumeTimeout = null;
function suspendCardBlurDuringPanZoom() {
  if (content) content.classList.add('pan-zoom-active');
  clearTimeout(cardBlurResumeTimeout);
}
function resumeCardBlurAfterPanZoom(delayMs) {
  clearTimeout(cardBlurResumeTimeout);
  cardBlurResumeTimeout = setTimeout(() => {
    if (content) content.classList.remove('pan-zoom-active');
  }, delayMs);
}

// Applies panX/panY at full float precision now, not rounded to the nearest pixel - reported
// directly: the camera crept a few pixels off on almost every button click, even ones already
// pinning the root card via withRootPanAnchor. Root-caused directly: rounding here meant the
// actually-rendered position was never quite what a pan-anchor correction (computed from a precise
// getBoundingClientRect delta) asked for, off by up to 0.5px every single time - individually
// invisible, but each button click's own correction is computed from THAT already-slightly-wrong
// rendered position, so successive clicks on genuinely different actions (not just undoing each
// other) had no reason to cancel out and could drift the same direction click after click.
// Confirmed directly: dropping the rounding took a measured 0.425px residual on one collapse/expand
// pair down to 0.0002px (plain floating-point noise). Sub-pixel CSS transforms render fine in every
// modern browser - this was never providing any real benefit.
function updateTransform() {
  if (content) content.style.transform = `translate(${window.panX}px, ${window.panY}px) scale(${window.zoomScale})`;
  const zoomText = document.getElementById('zoom-level-text');
  if (zoomText) zoomText.textContent = `Zoom: ${Math.round(window.zoomScale * 100)}%`;
}

function resetPanZoom() {
  window.zoomScale = 1.0;
  window.panX = 0;
  window.panY = 0;
  updateTransform();
  // Drawn synchronously, immediately - resetPanZoom runs right after recalculate() on every fresh
  // product load (selectItem's !preserveView branch), and just changed panX/panY AGAIN after
  // recalculate() already drew once for the pre-reset camera position - so this needs its own fresh,
  // immediate redraw for the new one, same reasoning as recalculate()'s own comment on why an
  // immediate draw beats a deferred one (no gap for a blank flash OR stale lines to appear in).
  // scheduleConnectingLinesRedraw right after is only the same silent placeholder-settling follow-up
  // correction every other call site uses now, not the primary draw.
  drawConnectingLines();
  window.scheduleConnectingLinesRedraw();
  centerOnRootNode();
}

window.addCurrentJobToLedger = addCurrentJobToLedger;
window.updateHeaderLedgerCount = updateHeaderLedgerCount;
window.syncSellStrategy = syncSellStrategy;
window.syncCustomPrice = syncCustomPrice;
window.syncCustomTax = syncCustomTax;
window.syncCardRunsToGlobal = syncCardRunsToGlobal;
window.selectItem = selectItem;
window.clearHighlight = clearHighlight;
window.isolateComponent = isolateComponent;
window.exitIsolation = exitIsolation;
window.onNodeClick = onNodeClick;
window.highlightNodeByTypeId = highlightNodeByTypeId;
window.centerOnSelectedNode = centerOnSelectedNode;
window.centerOnRootNode = centerOnRootNode;
window.resetPanZoom = resetPanZoom;
window.copyMultibuyText = copyMultibuyText;
window.resolveProductIdFromBlueprintNameAsync = resolveProductIdFromBlueprintNameAsync;

// Initialize Application
// --- Halftone triangle background ---
// Generates a radial halftone of triangles: large/dense near the edges, shrinking and fading
// toward the center. A true radial halftone can't be done with repeating CSS patterns alone
// (they're uniform, not distance-varying), so this computes it directly in JS.
// addEventListener rather than a plain `window.onload =` assignment - lpstore.html loads this file
// alongside js/lpstore.js, which needs its own load handler to run too. A raw assignment would have
// whichever script loads second silently clobber the other's init entirely; addEventListener lets
// both coexist and fire in load order, with no change in behavior on pages that only load one.
window.addEventListener('load', async () => {
  if (typeof window.buildPrepackedIndexes === 'function') {
    window.buildPrepackedIndexes();
  }

  // Load static local states instantly so the app is interactive immediately!
  try {
    restoreRigSlotInputs(); // Show each rig slot's saved rig name (if any) before restoring other tax settings
    // Repaint the last-known owned-BPO ME/TE index instantly (before the live re-fetch in
    // fetchUserAndCorpAssets lands) so loadSavedState() below builds its tree with real ME/TE
    // defaults from the start, not 0/0 for a few seconds until ESI answers.
    if (typeof window.restoreOwnedBpoIndexFromCache === 'function') window.restoreOwnedBpoIndexFromCache();
    renderProductionPresetDropdown();
    restoreHomeMarketInput();
    renderTrackedMarketsList();
    if (typeof window.ensureDefaultTrackedMarkets === 'function') {
      window.ensureDefaultTrackedMarkets().then(() => renderTrackedMarketsList()).catch(err => console.warn('Default market seeding failed:', err));
    }
    loadTaxSettings(); // Load custom taxes from localStorage!
    if (typeof window.restoreManufacturingImplantSetting === 'function') window.restoreManufacturingImplantSetting('mfg-implant-select');
    renderStructureBonusChips(); // ME/TE/cost chips under the structure dropdown (after loadTaxSettings sets the <select>)
    loadSavedState(); // Load previous product & overrides persistently from localStorage!
    if (typeof window.updateBulkMEStatusUI === 'function') window.updateBulkMEStatusUI(); // Reflect a restored bulk ME/TE target (loadSavedState doesn't re-render the Build tab's own static card)
    updateHeaderLedgerCount(); // Update badge on load!
  } catch (err) {
    console.error("State restoration error:", err);
  }

  // A shared build link (?build=...) takes priority over whatever was last open locally - applied
  // after loadSavedState() above so it overrides that restored session instead of the other way
  // around. No-ops immediately if there's no such param.
  if (typeof window.applySharedBuildFromUrl === 'function') {
    window.applySharedBuildFromUrl().catch(err => console.error("Shared build restore error:", err));
  }

  // Restore the previously-selected solar system (SCI) - was defined but never called, so the
  // system silently reset to the default (Jita) on every reload.
  if (typeof window.loadSavedSystem === 'function') {
    window.loadSavedSystem().catch(err => console.error("Saved system restore error:", err));
  }

  // Handle SSO Callback and assets asynchronously in the background
  if (typeof window.handleEsiSSOCallback === 'function') {
    window.handleEsiSSOCallback().catch(err => console.error("SSO Callback error:", err));
  }

  // Fetch adjusted prices asynchronously in the background
  if (typeof window.fetchAdjustedPrices === 'function') {
    window.fetchAdjustedPrices().catch(err => console.error("Adjusted prices fetch error:", err));
  }

  window.addEventListener('resize', drawConnectingLines);
});

// "F" key: center/focus on the selected card, or the final output card when nothing is selected.
// centerOnSelectedNode() already falls back to window.recipeTreeRoot when nothing is selected.
window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() !== 'f' || e.ctrlKey || e.metaKey || e.altKey) return;
  const activeEl = document.activeElement;
  const tag = activeEl ? activeEl.tagName : '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (activeEl && activeEl.isContentEditable)) return;
  if (typeof window.centerOnSelectedNode === 'function') {
    e.preventDefault();
    window.centerOnSelectedNode();
  }
});

// "I" key: isolate the selected card - same target isolateComponent's own per-card button uses,
// just without needing to reach for the mouse. No-op if nothing is selected (there's no card to
// isolate). "Escape" reverses it via the same exitIsolation() the panel's own exit button calls.
window.addEventListener('keydown', (e) => {
  const activeEl = document.activeElement;
  const tag = activeEl ? activeEl.tagName : '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (activeEl && activeEl.isContentEditable)) return;

  if (e.key.toLowerCase() === 'i' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (window.selectedInstanceId != null && typeof window.isolateComponent === 'function') {
      e.preventDefault();
      window.isolateComponent(null, window.selectedInstanceId);
    }
    return;
  }
  if (e.key === 'Escape' && window.isolatedInstanceId != null && typeof window.exitIsolation === 'function') {
    e.preventDefault();
    window.exitIsolation(null);
  }
});

// A same-tier merged material (renderTreeDiagram's own merge pass) redirects every duplicate
// consumer's own tree node to one surviving card - see window.__mergeRedirect and drawLinesForNode's
// own use of it. Any code that selects a node by instanceId (keyboard navigation, Space-to-toggle)
// needs the same redirect, or it can land on a duplicate that was never given a card of its own:
// window.selectedInstanceId then points at nothing on screen, so highlighting, centering, and every
// further arrow press silently do nothing useful - looking exactly like navigation "stopped
// working," when the actual cause is a stale, card-less selection.
function resolveRenderedNode(node) {
  if (!node) return node;
  const redirectedId = (window.__mergeRedirect && window.__mergeRedirect[node.instanceId]) || node.instanceId;
  if (redirectedId === node.instanceId) return node;
  return findNodeByInstanceId(window.recipeTreeRoot, redirectedId) || node;
}

// Walks a node's ancestor chain, force-expanding any that are hiding it - the same "expand
// regardless of why it was compact" move toggleNodeCollapse makes for a single card, just applied
// up the whole chain at once. A survivor card's real tree position (see resolveRenderedNode above)
// can sit under a completely different, independently-collapsed branch of the tree from wherever
// navigation started - resolving the id alone isn't enough if that branch was never opened, so
// keyboard navigation calls this on every target before centering on it. Returns whether anything
// actually changed, so the caller knows a recalculate() (not just a highlight refresh) is needed.
// stopAtInstanceId caps the walk at (and including) that node, and short-circuits entirely if node
// itself already IS the boundary - isolate mode passes its single rendered output parent's id
// here, since renderIsolatedDiagram never renders anything above it. Without a cap, walking all the
// way to the real tree root while isolated would force-expand ancestors nothing on screen even
// shows right now, and those overrides would then unexpectedly persist into the main diagram once
// the user exits isolation.
function ensureNodeVisible(node, stopAtInstanceId) {
  if (!node) return false;
  if (stopAtInstanceId != null && node.instanceId === stopAtInstanceId) return false;
  let changed = false;
  let n = node.parentInstanceId != null ? findNodeByInstanceId(window.recipeTreeRoot, node.parentInstanceId) : null;
  while (n) {
    const key = nodeStableKey(n);
    if (window.collapsedInstanceIds.has(key)) {
      window.collapsedInstanceIds.delete(key);
      changed = true;
    }
    if (n.depth > 0 && !window.expandedOverrideIds.has(key)) {
      const el = document.getElementById(`node-card-${n.instanceId}`);
      const isCompact = !el || el.classList.contains('diagram-node-compact');
      if (isCompact) {
        window.expandedOverrideIds.add(key);
        changed = true;
      }
    }
    if (stopAtInstanceId != null && n.instanceId === stopAtInstanceId) break;
    n = n.parentInstanceId != null ? findNodeByInstanceId(window.recipeTreeRoot, n.parentInstanceId) : null;
  }
  return changed;
}

// Arrow keys: walk the tree without reaching for the mouse. Up/Down move to the next/prev card in
// the same on-screen column (see the 'prevSibling'/'nextSibling' branch below for why that's a DOM
// walk and not current's own real tree siblings). Left/Right follow the diagram's actual on-screen
// layout, not a generic "children indent rightward" assumption - renderTreeDiagram appends depth
// columns via levels.reverse(), so the root/final output sits on the RIGHT and raw materials are
// on the LEFT. Right therefore jumps to the parent (toward the output) and Left jumps to the first
// child (deeper into materials). ensureNodeVisible force-opens whatever's hiding the destination -
// a compact chip along the way, same as clicking it would, but also a same-tier merged material's
// real position under a totally different, independently-collapsed branch (see
// resolveRenderedNode/window.__mergeRedirect) - so "walk into" always lands somewhere on screen.
// Every move re-centers the view on the new card via the same centerOnInstanceId "F" and a BOM-row
// click already use, so the selection never lands somewhere off-screen. A dead end (root has no
// parent/siblings, a leaf has no child) is a no-op rather than wrapping around, which would be
// surprising in a tree this shape.
//
// Isolate mode also uses this, since renderIsolatedDiagram (see its own comment) now renders the
// isolated node's full subtree with real parent/child/sibling relationships throughout - but it
// only ever renders ONE extra node beyond that subtree, the immediate output parent. Real
// parent/child lookups would otherwise walk straight past that single rendered card into nodes
// nothing on screen shows, landing exactly back in the "arrows silently do nothing" bug this whole
// redirect/visibility system exists to prevent - so the output parent gets its own pair of rules
// below: nothing further out (Right dead-ends there) and "in" means back to the isolated node
// specifically, not some real child of that parent that was never rendered here at all.
function navigateTreeSelection(direction) {
  if (!window.recipeTreeRoot) return;

  const isolatedNode = window.isolatedInstanceId != null ? findNodeByInstanceId(window.recipeTreeRoot, window.isolatedInstanceId) : null;
  const isolateOutputParentId = isolatedNode && isolatedNode.parentInstanceId != null ? isolatedNode.parentInstanceId : null;

  if (window.selectedInstanceId == null) {
    // Nothing selected yet - the first press just selects/centers the isolated node (or root, in
    // the normal view), giving a clear starting point to walk from instead of silently no-op-ing
    // against a "current node" never actually shown as selected.
    const startId = isolatedNode ? isolatedNode.instanceId : window.recipeTreeRoot.instanceId;
    window.selectedInstanceId = startId;
    applyNodeHighlightClasses();
    centerOnInstanceId(startId);
    return;
  }

  let current = findNodeByInstanceId(window.recipeTreeRoot, window.selectedInstanceId);
  if (!current) return;
  current = resolveRenderedNode(current);
  if (current.instanceId !== window.selectedInstanceId) {
    // Self-heal a selection left pointing at a merged-away duplicate (from before this redirect
    // existed, or from clicking a BOM row/some other path that doesn't go through a card click).
    window.selectedInstanceId = current.instanceId;
  }

  let target = null;

  if (isolatedNode && current.instanceId === isolateOutputParentId) {
    if (direction === 'child') target = isolatedNode;
    // 'parent' (and Up/Down, which find no DOM sibling either - the output card sits alone in its
    // own column) fall through as a dead end - there's genuinely nothing further out rendered.
  } else if (direction === 'parent') {
    if (current.parentInstanceId != null) target = findNodeByInstanceId(window.recipeTreeRoot, current.parentInstanceId);
  } else if (direction === 'child') {
    if (current.children && current.children.length > 0) target = current.children[0];
  } else if (direction === 'prevSibling' || direction === 'nextSibling') {
    // "Next/prev sibling" means the next/prev card in the same on-screen column, NOT the next/prev
    // entry in current's own real parent.children - those only line up when nothing in the column
    // has been merged. Once renderTreeDiagram's merge pass folds same-tier duplicates into one
    // shared card, a column mixes materials that really belong to several different parents, and a
    // card visually right next to the selected one can easily be a different parent's input
    // entirely - walking by real tree-siblings would silently skip straight past it. Walking the
    // actual DOM order of the column (every depth tier is one plain top-to-bottom column - see
    // renderTreeDiagram's own comment on why it's deliberately not a wrapping grid) always matches
    // what's really on screen, merged or not.
    const currentEl = document.getElementById(`node-card-${current.instanceId}`);
    const siblingEl = currentEl ? (direction === 'prevSibling' ? currentEl.previousElementSibling : currentEl.nextElementSibling) : null;
    if (siblingEl && siblingEl.classList.contains('diagram-node')) {
      const siblingId = parseInt(siblingEl.getAttribute('data-instance-id'));
      target = findNodeByInstanceId(window.recipeTreeRoot, siblingId);
    }
  }

  if (!target) return;
  target = resolveRenderedNode(target);
  const needsExpand = ensureNodeVisible(target, isolateOutputParentId);

  window.selectedInstanceId = target.instanceId;
  if (needsExpand && typeof window.recalculate === 'function') {
    window.recalculate();
  } else {
    applyNodeHighlightClasses();
  }
  centerOnInstanceId(target.instanceId);
}
window.navigateTreeSelection = navigateTreeSelection;

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const dirByKey = { ArrowUp: 'prevSibling', ArrowDown: 'nextSibling', ArrowLeft: 'child', ArrowRight: 'parent' };
  const direction = dirByKey[e.key];
  if (!direction) return;
  const activeEl = document.activeElement;
  const tag = activeEl ? activeEl.tagName : '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (activeEl && activeEl.isContentEditable)) return;
  e.preventDefault();
  navigateTreeSelection(direction);
});

// Space: compact/expand the selected card - same toggleNodeCollapse a chip's own click-anywhere
// uses, just without needing the mouse. Works in isolate mode too now that it renders a real,
// multi-level subtree (see renderIsolatedDiagram). Root is excluded (it's never collapsible - see
// toggleNodeCollapse's own callers, createNodeCard never gives root a compact chip in the first
// place).
window.addEventListener('keydown', (e) => {
  if (e.key !== ' ' && e.key !== 'Spacebar') return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (window.selectedInstanceId == null || !window.recipeTreeRoot) return;
  const activeEl = document.activeElement;
  const tag = activeEl ? activeEl.tagName : '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || (activeEl && activeEl.isContentEditable)) return;
  let node = findNodeByInstanceId(window.recipeTreeRoot, window.selectedInstanceId);
  if (!node) return;
  node = resolveRenderedNode(node);
  if (node.depth === 0) return;
  if (node.instanceId !== window.selectedInstanceId) {
    window.selectedInstanceId = node.instanceId;
    applyNodeHighlightClasses();
  }
  e.preventDefault();
  toggleNodeCollapse(null, node.instanceId, node.pathKey);
});