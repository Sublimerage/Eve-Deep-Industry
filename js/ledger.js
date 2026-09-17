'use strict';

let activeJobs = [];
let buildHistory = [];

let activeOrderFilter = 'all';
let activeCategoryFilter = 'all';
let activeJobSearchQuery = '';
let activeJobStatusFilter = 'all'; // 'all' | 'started' | 'pending'
// Filters the queue to jobs whose resolved production preset label matches exactly - 'all' shows
// everything. Auto-imported jobs have no preset concept (see getJobStationLabel) so they never
// match a specific station and are hidden whenever one is selected, same as they're hidden from
// the preset row/badge everywhere else.
let activeStationFilter = 'all';
// Which character's jobs to show - 'all' (default) or a specific registered charId. Deliberately
// opt-in only: every job is ALWAYS visible under 'all' regardless of who it's tagged to (or whether
// it's tagged to anyone at all) - character ownership is shown as an informational tag on each job
// (see renderJobOwnershipBadgeHTML), not something that hides jobs on its own. An earlier version of
// this auto-hid jobs by ownership, which turned out to be the wrong default - explicitly reverted per
// direct feedback: all jobs should stay visible, with a manual filter for narrowing to one character.
let activeCharacterFilter = 'all';
// Personal/Corp - a SEPARATE question from the character filter above: "what KIND of job is this",
// not "whose is it" (a corp job installed by Bob is a different thing from Bob's own personal job,
// even though both show under "Bob" in the character dropdown). Both default true so nothing is
// hidden until the user actually unchecks one - restored after being removed once already, per direct
// feedback that removing it lost real functionality rather than just being superseded by the
// character filter.
let activeShowPersonalJobs = true;
let activeShowCorpJobs = true;
// Job IDs checked to "isolate" - when non-empty, the Consolidated BOM/multibuy below only reflects
// these jobs' materials instead of the whole queue, so you can shop for just what you're about to
// build without also buying for everything else still queued. Session-only (resets on reload), same
// as the other BOM filters above - it's a "right now I'm working on these" scratch selection, not a
// standing preference.
let isolatedJobIds = new Set();
// Which single job (if any) is in "Focus" mode - a completely different feature from isolation
// above. Isolation scopes the Consolidated BOM sidebar while every job card stays visible; Focus
// hides every OTHER job entirely and renders just this one (plus its full prerequisite chain) full-
// size, for "I want to see everything about this one build and start its prerequisites from here."
// Session-only, same as isolation.
let focusedJobId = null;
// job IDs with the BOM/details section explicitly EXPANDED - inverted from how this used to work
// (a set of collapsed ids, default expanded) specifically so a job you've never touched - most
// importantly a newly-added one - defaults to collapsed instead of dumping its full material list
// into an already-busy queue. Persisted so a reload doesn't lose which ones you opened.
let expandedJobCardIds = new Set(window.safeParseJSON(localStorage.getItem('eve_expanded_job_cards'), []));
// Job IDs whose run count is currently showing an editable input instead of the plain display -
// click-to-edit, not a permanently-visible input box, so the collapsed/default look stays exactly as
// clean as before this feature existed. Session-only, same as isolation/focus above.
let editingRunsJobIds = new Set();

// Whether the Consolidated BOM's "Already in Stock" section is expanded. Defaults collapsed - stock
// you already have is the LEAST important thing on this screen (what you still need to buy is), so
// starting it tucked away behind the divider keeps it from competing for attention with the shopping
// list above it. Session-only, same as the rest of this file's display toggles.
let isAcquiredBomSectionExpanded = false;
function toggleAcquiredBomSection() {
  isAcquiredBomSectionExpanded = !isAcquiredBomSectionExpanded;
  renderJournalPage();
}
window.toggleAcquiredBomSection = toggleAcquiredBomSection;
function toggleRunsEditMode(e, jobId) {
  if (e) e.stopPropagation();
  if (editingRunsJobIds.has(jobId)) editingRunsJobIds.delete(jobId);
  else editingRunsJobIds.add(jobId);
  renderJournalPage();
  if (editingRunsJobIds.has(jobId)) {
    // Focus the FIRST (Jobs) input right after it appears, matching its left-to-right reading order -
    // re-rendering just replaced the DOM node, so this has to happen on the next frame, not
    // synchronously here.
    requestAnimationFrame(() => {
      const input = document.getElementById(`jobs-edit-input-${jobId}`);
      if (input) { input.focus(); input.select(); }
    });
  }
}
window.toggleRunsEditMode = toggleRunsEditMode;

// A small icon-only toggle next to the run count - pencil when showing the plain number (click to
// edit), a plain "x" when the input is already open (click to cancel without changing anything).
// Deliberately NOT a bordered/filled button like the rest of the app's chip buttons - the whole point
// is a quiet affordance that doesn't turn the collapsed card's header into a form.
function renderRunsEditIconHTML(jobId, isEditing) {
  const icon = isEditing
    ? `<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>`
    : `<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>`;
  return `<svg onclick="toggleRunsEditMode(event, ${jobId})" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px; height:12px; flex-shrink:0; color:var(--text-mute); cursor:pointer;" title="${isEditing ? 'Cancel' : 'Edit run count'}">${icon}</svg>`;
}

// Real SVG icons for job status (pending/counting down/ready), replacing the ⏳/⏱/✓ emoji this used
// to render - matches the stroke-based icon style already used everywhere else in the app (edit
// pencil above, delete/copy/etc.). 'kind' is 'pending' | 'remaining' | 'ready'.
function renderJobStatusIconHTML(kind) {
  const paths = kind === 'ready'
    ? `<polyline points="20 6 9 17 4 12"/>`
    : kind === 'remaining'
      ? `<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>`
      : `<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/>`;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px; height:12px; flex-shrink:0;">${paths}</svg>`;
}

let activeQueueViewMode = localStorage.getItem('eve_queue_view_mode') || 'list'; // 'grid' | 'list'
// Which status groups ("started"/"pending") are collapsed - persisted the same way as card state.
// Both start collapsed by default (a fresh install, nothing in localStorage yet) - the user can
// expand either from here on, and that choice is what gets remembered afterward, not this default.
let collapsedJobGroups = new Set(window.safeParseJSON(localStorage.getItem('eve_collapsed_job_groups'), ['started', 'pending']));

function saveExpandedJobCardIds() {
  localStorage.setItem('eve_expanded_job_cards', JSON.stringify([...expandedJobCardIds]));
}

function saveCollapsedJobGroups() {
  localStorage.setItem('eve_collapsed_job_groups', JSON.stringify([...collapsedJobGroups]));
}

function toggleJobGroupCollapse(groupKey) {
  if (collapsedJobGroups.has(groupKey)) collapsedJobGroups.delete(groupKey);
  else collapsedJobGroups.add(groupKey);
  saveCollapsedJobGroups();
  renderJournalPage();
}
window.toggleJobGroupCollapse = toggleJobGroupCollapse;

// Which cluster ROOTS (list mode only - see buildJobClusters/renderJobClusterHTML) have their
// nested prerequisite jobs folded away - keyed by the root job's own id, persisted the same way as
// the status groups above so a folded cluster stays folded across reloads.
let collapsedClusterIds = new Set(window.safeParseJSON(localStorage.getItem('eve_collapsed_job_clusters'), []));

function saveCollapsedClusterIds() {
  localStorage.setItem('eve_collapsed_job_clusters', JSON.stringify([...collapsedClusterIds]));
}

function toggleClusterCollapse(e, jobId) {
  if (e) e.stopPropagation();
  if (collapsedClusterIds.has(jobId)) collapsedClusterIds.delete(jobId);
  else collapsedClusterIds.add(jobId);
  saveCollapsedClusterIds();
  renderJournalPage();
}
window.toggleClusterCollapse = toggleClusterCollapse;

function loadJournalState() {
  try {
    const savedJobs = localStorage.getItem('eve_ledger_jobs');
    activeJobs = window.safeParseJSON(savedJobs, []);
    if (!Array.isArray(activeJobs)) activeJobs = [];
  } catch (e) {
    activeJobs = [];
  }

  try {
    const savedHistory = localStorage.getItem('eve_ledger_history');
    buildHistory = window.safeParseJSON(savedHistory, []);
    if (!Array.isArray(buildHistory)) buildHistory = [];
  } catch (e) {
    buildHistory = [];
  }

  try {
    const rawSaved = localStorage.getItem('eve_raw_assets');
    const parsedRaw = window.safeParseJSON(rawSaved, []);
    rawAssetItems.length = 0; 
    parsedRaw.forEach(item => {
      if (item) rawAssetItems.push(item);
    });
  } catch (e) {
    rawAssetItems.length = 0;
  }

  try {
    const resolvedSaved = localStorage.getItem('eve_resolved_location_names');
    const parsedResolved = window.safeParseJSON(resolvedSaved, {});
    for (const key in resolvedLocationNames) {
      delete resolvedLocationNames[key];
    }
    Object.assign(resolvedLocationNames, parsedResolved);
  } catch (e) {
    for (const key in resolvedLocationNames) {
      delete resolvedLocationNames[key];
    }
  }

  try {
    const corpSaved = localStorage.getItem('eve_corp_division_names');
    const parsedCorp = window.safeParseJSON(corpSaved, {});
    for (const key in corpDivisionNames) {
      delete corpDivisionNames[key];
    }
    Object.assign(corpDivisionNames, parsedCorp);
  } catch (e) {
    for (const key in corpDivisionNames) {
      delete corpDivisionNames[key];
    }
  }

  try {
    const savedStocks = localStorage.getItem('eve_user_stock_map');
    const parsedStocks = window.safeParseJSON(savedStocks, {});
    for (const key in userStockMap) {
      delete userStockMap[key];
    }
    Object.assign(userStockMap, parsedStocks);
  } catch (e) {
    for (const key in userStockMap) {
      delete userStockMap[key];
    }
  }
}

// getItemCategory now lives in js/config.js (shared by app.js too, for the calculator's own BOM
// category filter) - kept as a window global so this call site didn't need to change.

// --- Profit display (always full cost - stock never affects profit, only the BOM shopping list) ---
// job.netProfit/job.calculatedCost are ALREADY full market cost from the moment they're calculated
// (calculateTreeNodeCost never credits stock - this has been the architecture since early on). A
// previous version of this file had a toggle that subtracted a stock-credit value from netProfit in
// "Full Cost" mode - but since netProfit was never stock-discounted to begin with, that subtraction
// was double-counting the stock value, which is what caused profit to swing wildly, sometimes
// severely negative. Stock only ever affects the consolidated BOM (shopping list) now - these
// functions keep their names so existing call sites don't need individual changes, but always return
// the real, unmodified value.
function getJobStockCreditValue(job) {
  return 0;
}
window.getJobStockCreditValue = getJobStockCreditValue;

function getEffectiveJobCost(job) {
  return job.calculatedCost || 0;
}
window.getEffectiveJobCost = getEffectiveJobCost;

function getEffectiveJobProfit(job) {
  return job.netProfit;
}
window.getEffectiveJobProfit = getEffectiveJobProfit;

// For every material any non-started job in `jobs` needs, how much is still needed once every job
// in the SAME list that produces that exact material (its own qtyNeeded - its real planned output,
// not just "a job for this exists") has been credited against it. Total demand and total supply are
// each summed once, then subtracted - equivalent to claiming from a shared pool material-by-material,
// just order-independent, since the end result (unclaimed demand) is the same regardless of which
// job's line happens to be processed first. Shared by the Consolidated BOM (which then applies its
// own display filters and real-stock netting on top) and by each prerequisite job's own card (which
// nets against real stock the same way, but never applies the BOM's display filters - see both call
// sites' own comments for why that split matters).
function computeQtyStillNeededAfterInternalSupply(jobs) {
  const supplyByTypeId = {};
  jobs.forEach(j => {
    if (j && j.productTypeId !== undefined) {
      supplyByTypeId[j.productTypeId] = (supplyByTypeId[j.productTypeId] || 0) + (j.qtyNeeded || 0);
    }
  });
  const demandByTypeId = {};
  jobs.forEach(job => {
    if (job && !job.isStarted && Array.isArray(job.materials)) {
      job.materials.forEach(mat => {
        if (!mat || !mat.typeId) return;
        demandByTypeId[mat.typeId] = (demandByTypeId[mat.typeId] || 0) + (mat.qtyNeeded || 0);
      });
    }
  });
  const result = {};
  Object.keys(demandByTypeId).forEach(typeId => {
    const stillNeeded = Math.max(0, demandByTypeId[typeId] - (supplyByTypeId[typeId] || 0));
    if (stillNeeded > 0) result[typeId] = stillNeeded;
  });
  return result;
}

function renderJournalPage() {
  loadJournalState();

  const activeJobsCountEl = document.getElementById('journal-active-jobs');
  const totalCostEl = document.getElementById('journal-total-cost');
  const materialsVolumeEl = document.getElementById('journal-materials-volume');
  const materialsCostEl = document.getElementById('journal-materials-cost');
  const totalProfitEl = document.getElementById('journal-total-profit');

  const deductModeInput = document.getElementById('deduct-stock-mode');
  const isStockDeductEnabled = deductModeInput ? deductModeInput.value === 'true' : true;

  // Stock allocation - computed ONCE here, for EVERY job in the queue, before any of the filtered/
  // isolated/collapsed views below get built from it. A started job's materials are already gone in
  // reality (the job is running in EVE right now) regardless of what ESI's own possibly-stale asset
  // snapshot currently reports - see applyJobMaterialsToStock's own comment for the full reasoning,
  // and the exact bug this closes: reported directly as "extremely bad" - a job's real consumption
  // went completely uncounted whenever its card, its whole status group, or the current search/filter
  // view happened to leave it un-rendered (which, for a collapsed "In Progress" section, is the
  // DEFAULT state), so a later job's own material line showed stock as if nothing had claimed it.
  // Every started job is deducted FIRST, in one pass, regardless of where filters/search would place
  // it - it already happened, so it isn't a "priority" choice the way splitting what's left across
  // several PENDING plans is. This feeds BOTH the Consolidated BOM sidebar below (so "what do I still
  // need to buy" accounts for stock already claimed by jobs you've already installed, not the raw ESI
  // figure) and, after every pending job depletes what's left in its own stored order (same order
  // "drag to reorder" changes - see the drag handle's own tooltip), each job card's own stock
  // indicator further down. Nothing past this point ever calls applyJobMaterialsToStock again -
  // renderActiveJobsList and everything under it only ever look up an already-computed result here.
  const allocatedStock = { ...userStockMap };
  const materialStockInfoByJobId = new Map();
  activeJobs.filter(j => j && j.isStarted).forEach(job => {
    const deductFromPool = !isJobConsumptionAlreadyReflectedByFreshAssets(job);
    materialStockInfoByJobId.set(job.id, applyJobMaterialsToStock(job, allocatedStock, isStockDeductEnabled, deductFromPool));
  });

  let totalActiveCost = 0;
  let totalPotentialProfit = 0;
  let profitDataMissing = false;
  activeJobs.forEach(job => {
    if (job) {
      totalActiveCost += job.calculatedCost || 0;
      const effProfit = getEffectiveJobProfit(job);
      if (effProfit !== undefined) {
        totalPotentialProfit += effProfit;
      } else if (!job.isSubBuild) {
        // Sub-build jobs deliberately have no netProfit (their value is already counted once, in the
        // final job's profit) - only a genuinely legacy job missing this field should raise the flag.
        profitDataMissing = true;
      }
    }
  });

  if (activeJobsCountEl) activeJobsCountEl.textContent = activeJobs.length.toLocaleString();
  if (totalCostEl) {
    totalCostEl.textContent = window.formatISKCompact(totalActiveCost);
    totalCostEl.title = Math.round(totalActiveCost).toLocaleString() + ' ISK';
  }
  if (totalProfitEl) {
    totalProfitEl.textContent = window.formatISKCompact(totalPotentialProfit) + (profitDataMissing ? ' *' : '');
    totalProfitEl.title = Math.round(totalPotentialProfit).toLocaleString() + ' ISK';
    totalProfitEl.className = `text-lg font-bold mono leading-tight ${totalPotentialProfit >= 0 ? 'text-green-400' : 'text-red-400'}`;
    totalProfitEl.title = profitDataMissing ? 'One or more queued jobs were added before profit tracking existed and are excluded from this total.' : '';
  }

  // When isolation is active, the BOM below is built only from these jobs instead of the whole
  // queue - a job's own sub-build prerequisites are pulled in automatically (matched by name, the
  // only link a sub-build job carries back to its parent) since excluding them would make the
  // isolated list wrongly ask you to buy something your own selected build already makes internally.
  const relevantJobsForBOM = (() => {
    if (isolatedJobIds.size === 0) return activeJobs;
    // parentJobId (the real per-job link - see buildJobClusters' own comment) is checked first; the
    // name-based fallback only fires for a sub-build saved before that field existed, and even then
    // only matters if you isolate a job that happens to share its name with another job's real parent.
    const isolatedNamesLegacy = new Set(
      Array.from(isolatedJobIds).map(id => activeJobs.find(j => j && j.id === id)?.name).filter(Boolean)
    );
    return activeJobs.filter(j => {
      if (!j) return false;
      if (isolatedJobIds.has(j.id)) return true;
      if (!j.isSubBuild) return false;
      if (j.parentJobId !== undefined && j.parentJobId !== null) return isolatedJobIds.has(j.parentJobId);
      return isolatedNamesLegacy.has(j.parentJobName);
    });
  })();

  // Anything that's the PRODUCT of another job already in the queue is being supplied internally,
  // not something to shop for - without this, a prerequisite job's own output (e.g. "Pure Synth Exile
  // Booster", produced by its own reaction job sitting right there in the queue) would show up in the
  // shopping list as if it needed to be bought from the market, even though it's already accounted
  // for by the job that makes it.
  //
  // Tracks HOW MUCH of each material is genuinely still needed after every job's own real planned
  // output (qtyNeeded, not just whether a supplying job exists at all) has claimed its share - same
  // shared-pool pattern used for real stock elsewhere in this app. Reported directly: manually
  // shrinking a prerequisite job's run count below what its parent actually needs used to leave the
  // Consolidated BOM showing the material as fully covered regardless, since the old check only
  // asked "does ANY job produce this typeId" - the parent's real shortfall was invisible right up
  // until the job actually ran short in EVE. Deliberately excludes the display filters (order/
  // category) and the final real-stock netting below - those are specific to what the BOM panel
  // shows, not to the true underlying shortfall - so job cards can ask "am I actually short" without
  // the answer depending on whatever the BOM happens to be filtered to right now.
  const qtyStillNeededByTypeId = computeQtyStillNeededAfterInternalSupply(relevantJobsForBOM);

  const consolidatedBOM = {};
  relevantJobsForBOM.forEach(job => {
    if (job && !job.isStarted && Array.isArray(job.materials)) {
      job.materials.forEach(mat => {
        if (!mat || !mat.typeId) return;
        const qtyStillNeeded = qtyStillNeededByTypeId[mat.typeId] || 0;
        if (qtyStillNeeded <= 0) return; // fully covered by what's already being built internally

        if (activeOrderFilter !== 'all' && mat.strategy !== activeOrderFilter) return;

        const category = getItemCategory(mat.typeId, mat.name);
        if (activeCategoryFilter !== 'all' && category !== activeCategoryFilter) return;

        const id = mat.typeId;
        if (!consolidatedBOM[id]) {
          consolidatedBOM[id] = {
            typeId: id,
            name: mat.name,
            totalQtyNeeded: qtyStillNeeded,
            unitPrice: mat.unitPrice || 0,
            strategy: mat.strategy || 'sell'
          };
        }
      });
    }
  });

  const bomItems = Object.values(consolidatedBOM);
  let aggregatedMissingCost = 0;
  let totalMaterialsVolume = 0;

  bomItems.forEach(item => {
    // allocatedStock, not raw userStockMap - already reduced by every STARTED job's real consumption
    // (see the pass at the top of this function), so "what's actually available for pending work" is
    // honest even while ESI's own asset snapshot hasn't caught up to reflect that consumption yet.
    const stockQty = isStockDeductEnabled ? (allocatedStock[item.typeId] || 0) : 0;
    const netMissing = Math.max(0, item.totalQtyNeeded - stockQty);
    item.stockQty = stockQty;
    item.netMissingQty = netMissing;
    item.lineCost = item.unitPrice * netMissing;
    aggregatedMissingCost += item.lineCost;
    const unitVolume = (window.EVE_VOLUMES && window.EVE_VOLUMES[item.typeId]) || 0;
    item.lineVolume = unitVolume * netMissing;
    totalMaterialsVolume += unitVolume * item.totalQtyNeeded;
  });

  bomItems.sort((a, b) => b.lineCost - a.lineCost);

  // Same "true missing" figure the BOM above lands on (internal supply AND real stock both netted
  // out), but for EVERY material genuinely short - not just whatever the BOM's own order/category
  // filters currently happen to be showing - keyed by the typeId of whichever job actually produces
  // it, so a prerequisite job's own card (renderJobCardHTML) can offer to top itself up by exactly
  // this many more runs regardless of what the BOM panel is filtered to at the moment.
  const jobShortfallByProductTypeId = {};
  Object.keys(qtyStillNeededByTypeId).forEach(typeId => {
    const grossShortfall = qtyStillNeededByTypeId[typeId];
    if (grossShortfall <= 0) return;
    const stockQty = isStockDeductEnabled ? (allocatedStock[typeId] || 0) : 0;
    const netShortfall = Math.max(0, grossShortfall - stockQty);
    if (netShortfall > 0) jobShortfallByProductTypeId[typeId] = netShortfall;
  });

  if (materialsVolumeEl) materialsVolumeEl.textContent = totalMaterialsVolume.toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' m3';
  if (materialsCostEl) {
    materialsCostEl.textContent = window.formatISKCompact(aggregatedMissingCost);
    materialsCostEl.title = Math.round(aggregatedMissingCost).toLocaleString() + ' ISK';
  }

  // Every PENDING job now claims what's left of the same pool, in their own stored order (drag-to-
  // reorder priority) - completes materialStockInfoByJobId for every job in the queue. Deliberately
  // walks ALL of activeJobs here, not just relevantJobsForBOM (isolation) or any search/status/
  // character filter currently applied to the view below - a job hidden from the CURRENT view still
  // really needs its own materials, and still has to claim its share of stock before jobs rendered
  // after it get to see what's left, exactly the same as if nothing were filtered/collapsed at all.
  activeJobs.filter(j => j && !j.isStarted).forEach(job => {
    materialStockInfoByJobId.set(job.id, applyJobMaterialsToStock(job, allocatedStock, isStockDeductEnabled));
  });

  renderActiveJobsList(materialStockInfoByJobId, jobShortfallByProductTypeId);
  renderConsolidatedBOMList(bomItems, aggregatedMissingCost);
  renderBuildHistoryLedger();
}

// Checked from a job card - toggles that one job in/out of the isolation set. Sub-build/started jobs
// never get a checkbox of their own (see the card templates), so this only ever receives a real root
// job's id.
function toggleJobIsolation(jobId) {
  if (isolatedJobIds.has(jobId)) isolatedJobIds.delete(jobId);
  else isolatedJobIds.add(jobId);
  renderJournalPage();
}
window.toggleJobIsolation = toggleJobIsolation;

// Focus mode - see the module-level focusedJobId comment for how this differs from isolation above.
// Clicking Focus on the job that's already focused exits back to the normal queue (a toggle);
// clicking it on a different job (e.g. a prerequisite's own Focus button while its parent is
// focused) switches focus to that job instead.
function enterJobFocus(jobId) {
  focusedJobId = (focusedJobId === jobId) ? null : jobId;
  renderJournalPage();
}
window.enterJobFocus = enterJobFocus;

function exitJobFocus() {
  focusedJobId = null;
  renderJournalPage();
}
window.exitJobFocus = exitJobFocus;

// Shared by both card layouts - a visibly different (solid-filled) state when this job is the one
// currently focused, both to confirm it worked and as a hint that clicking it again exits.
function renderFocusButtonHTML(job) {
  const isFocused = focusedJobId === job.id;
  const activeStyle = isFocused ? 'background:var(--accent); color:#0a1002;' : '';
  const title = isFocused
    ? 'Exit focus mode'
    : 'Focus: show just this job (and its prerequisites) full-size, with the rest of the queue hidden';
  return `<button onclick="event.stopPropagation(); enterJobFocus(${job.id})" class="lp-chip-btn flex-shrink-0" style="${activeStyle}" title="${title}">${window.svgIcon('search')} Focus</button>`;
}

function clearJobIsolation() {
  isolatedJobIds.clear();
  renderJournalPage();
}
window.clearJobIsolation = clearJobIsolation;

// Isolation status used to be its own always-visible banner row in the BOM sidebar - moved onto
// the Pending group divider instead (see renderActiveJobsList), since isolation only ever applies
// to pending jobs (the Shop checkbox only appears on those) and only needs to be visible AT ALL
// once something is actually isolated, saving a permanent row of space the rest of the time.

// The "isolate a job and see it in more detail" view: hides every other job in the queue and
// renders just this one, plus its full prerequisite chain (at any depth - a prerequisite's own
// prerequisite counts too), full-size and forced open. Reuses the existing grid card template
// (which already carries the preset row, unclipped material list with "+ Build" actions, and a
// working "Start Job" control) rather than a new layout - focus mode is a different FILTER + SCALE
// over the same cards, not a new component.
function renderFocusedJobView(container, jobId, materialStockInfoByJobId, jobShortfallByProductTypeId) {
  const focusedJob = activeJobs.find(j => j && j.id === jobId);
  if (!focusedJob) {
    // The focused job was built/deleted while focus was active - fall back to the normal queue
    // view instead of leaving the page on a dead end pointing at a job that no longer exists.
    focusedJobId = null;
    renderActiveJobsList(materialStockInfoByJobId, jobShortfallByProductTypeId);
    return;
  }

  // Walks the prerequisite chain by unique id (parentJobId), not by name - name-matching alone would
  // pull in every OTHER job sharing this one's product name too (e.g. one job split by hand into
  // several same-named smaller ones), not just this job's own real prerequisites. Falls back to name
  // matching only for a sub-build saved before parentJobId existed (see buildJobClusters' own comment
  // on the same tradeoff).
  const includedIds = new Set([focusedJob.id]);
  const includedNamesLegacy = new Set([focusedJob.name]);
  let grew = true;
  while (grew) {
    grew = false;
    activeJobs.forEach(j => {
      if (!j || includedIds.has(j.id) || !j.isSubBuild) return;
      const matched = (j.parentJobId !== undefined && j.parentJobId !== null)
        ? includedIds.has(j.parentJobId)
        : (j.parentJobName && includedNamesLegacy.has(j.parentJobName));
      if (matched) {
        includedIds.add(j.id);
        includedNamesLegacy.add(j.name);
        grew = true;
      }
    });
  }
  const focusJobs = activeJobs
    .filter(j => j && includedIds.has(j.id))
    .sort((a, b) => (a.id === focusedJob.id ? -1 : b.id === focusedJob.id ? 1 : 0));

  // Force every focused card open regardless of its remembered collapse state, then restore that
  // state afterward - focus mode is a temporary spotlight, not a permanent "always expand this"
  // change to the card (that's what the collapse toggle itself is for).
  const priorExpandState = focusJobs.map(j => expandedJobCardIds.has(j.id));
  focusJobs.forEach(j => expandedJobCardIds.add(j.id));
  const cardsHTML = focusJobs.map(j => renderJobCardHTML(j, materialStockInfoByJobId, true, jobShortfallByProductTypeId)).join('');
  focusJobs.forEach((j, i) => { if (!priorExpandState[i]) expandedJobCardIds.delete(j.id); });

  const prereqCount = focusJobs.length - 1;
  container.innerHTML = `
    <div class="lp-card p-2.5 flex items-center justify-between gap-2 mb-3" style="border-color:rgba(var(--accent-rgb),0.4);">
      <span class="text-xs font-bold uppercase tracking-wide" style="color:var(--accent);">
        ${window.svgIcon('search')} Focused on "${window.esc(focusedJob.name)}"${prereqCount > 0 ? ` + ${prereqCount} prerequisite${prereqCount > 1 ? 's' : ''}` : ''} - rest of the queue is hidden
      </span>
      <button onclick="exitJobFocus()" class="lp-chip-btn flex-shrink-0">← Back to Queue</button>
    </div>
    <div class="grid grid-cols-1 gap-3">
      ${cardsHTML}
    </div>
  `;
}

// Groups a status-filtered job list into clusters for visual hierarchy (see the .job-cluster CSS
// comment) instead of the old "⚙ Prereq for: X" text line: each root is a job that ISN'T a sub-
// build, or IS one but its parent isn't in this same list - a prerequisite added after its parent
// already started can land in a different status group than its parent, and there's no adjacent
// parent to nest it under in that case, so it renders as its own top-level entry (with the text
// line kept as a fallback for exactly that situation - see renderJobCardHTML/renderJobListRowHTML).
// Links a sub-build to its REAL parent job by unique id, not by product name - two different queued
// jobs can easily share a name (e.g. one big run split by hand into several smaller same-product
// jobs), and matching by name alone can't tell them apart. Before parentJobId existed, a single
// sub-build job named-matched against EVERY root sharing its parent's name, so it visually rendered
// as a duplicate "child" under each one, even though only one real job record existed (confirmed by:
// deleting any one of the duplicates deleted the single underlying job and all the copies vanished
// together). Jobs saved before this fix only have parentJobName - those fall back to attaching to
// the first same-named root found (deterministic, at least not duplicated across all of them; WHICH
// one is arbitrary since the old data never recorded which specific instance it was really for).
function buildJobClusters(jobs) {
  const byId = new Map();
  const firstByName = new Map();
  jobs.forEach(j => {
    if (!j) return;
    byId.set(j.id, j);
    if (!firstByName.has(j.name)) firstByName.set(j.name, j);
  });
  const childrenOf = new Map(); // keyed by the PARENT's unique id
  const roots = [];
  jobs.forEach(j => {
    if (!j) return;
    let parentId = null;
    if (j.isSubBuild && j.parentJobId !== undefined && j.parentJobId !== null && byId.has(j.parentJobId)) {
      parentId = j.parentJobId;
    } else if (j.isSubBuild && !j.parentJobId && j.parentJobName && firstByName.has(j.parentJobName)) {
      parentId = firstByName.get(j.parentJobName).id;
    }
    if (parentId !== null) {
      if (!childrenOf.has(parentId)) childrenOf.set(parentId, []);
      childrenOf.get(parentId).push(j);
    } else {
      roots.push(j);
    }
  });
  return { roots, childrenOf };
}

// Recursively renders a job followed by its nested children (a prerequisite's own prerequisite
// nests one level deeper again) as one combined block. renderJob(job, depth) is whichever of
// renderJobListRowHTML/renderJobCardHTML the caller is using for the current view mode. Keyed by
// the job's own unique id (see buildJobClusters above), not its name.
function renderJobClusterHTML(job, childrenOf, depth, renderJob) {
  const kids = childrenOf.get(job.id) || [];
  const ownHTML = renderJob(job, depth, kids.length);
  if (kids.length === 0) return ownHTML;
  // Collapsed: the root's own row still renders (with its toggle showing the folded count), the
  // nested children just don't - same "always show the row, vary what's inside/beneath it" approach
  // used everywhere else in this file, rather than hiding the whole cluster.
  if (collapsedClusterIds.has(job.id)) return ownHTML;
  const kidsHTML = kids.map(k => renderJobClusterHTML(k, childrenOf, depth + 1, renderJob)).join('');
  return `<div class="job-cluster">${ownHTML}<div class="job-cluster-children">${kidsHTML}</div></div>`;
}

function renderActiveJobsList(materialStockInfoByJobId, jobShortfallByProductTypeId) {
  const container = document.getElementById('active-jobs-list');
  if (!container) return;

  populateStationFilterDropdown();

  if (activeJobs.length === 0) {
    container.innerHTML = `
      <div class="lp-card p-8 text-center mono" style="color:var(--text-mute);">
        No active manufacturing jobs queued in ledger. Go back to the calculator and click "Add to Job Queue" on any root item card to add jobs here.
      </div>
    `;
    return;
  }

  // Focus mode overrides everything below (search/status filters, grouping) - it's an explicit
  // "show me just this one" request, so it wins even if the focused job wouldn't otherwise match
  // the current filters.
  if (focusedJobId !== null) {
    renderFocusedJobView(container, focusedJobId, materialStockInfoByJobId, jobShortfallByProductTypeId);
    return;
  }

  const q = (activeJobSearchQuery || '').toLowerCase().trim();
  populateCharacterFilterDropdown();

  const visibleJobs = activeJobs.filter(job => {
    if (!job) return false;
    if (q && !(job.name || '').toLowerCase().includes(q)) return false;
    if (activeJobStatusFilter === 'started' && !job.isStarted) return false;
    if (activeJobStatusFilter === 'pending' && job.isStarted) return false;
    if (activeStationFilter !== 'all' && getJobStationLabel(job) !== activeStationFilter) return false;
    // Character filter - deliberately opt-in only (picked from the dropdown), never an automatic
    // hide. Every job stays visible under "All" regardless of which character owns it or whether it
    // has no owner at all ("planned for" is informational - see renderJobOwnershipBadgeHTML - not a
    // visibility gate). Narrowing to one specific character hides jobs with no owner too, since an
    // unassigned job isn't "from" that character either.
    if (activeCharacterFilter !== 'all' && job.ownerCharId !== activeCharacterFilter) return false;
    // Personal/Corp - combines with the character filter above (both must pass, not either/or). A
    // job with no scope at all predates ownership tracking (or was added while logged out) and stays
    // visible regardless of these toggles, same "no assumption made" treatment it already gets from
    // the character filter.
    if (job.scope === 'personal' && !activeShowPersonalJobs) return false;
    if (job.scope === 'corp' && !activeShowCorpJobs) return false;
    return true;
  });

  if (visibleJobs.length === 0) {
    container.innerHTML = `
      <div class="lp-card p-8 text-center mono" style="color:var(--text-mute);">
        No jobs match your current search/filter.
      </div>
    `;
    return;
  }

  const startedJobs = visibleJobs.filter(j => j.isStarted);
  const pendingJobs = visibleJobs.filter(j => !j.isStarted);

  const isListMode = activeQueueViewMode === 'list';
  const groupWrapClass = isListMode ? 'space-y-2' : 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3';
  // Nesting only works as a single column (list mode) - a CSS Grid row is only ever as tall as its
  // tallest cell, so a cluster with children forces every OTHER card sharing that row to leave a
  // huge empty gap beside it, and cards further down drift out of visual alignment entirely. Grid
  // mode instead stays flat/uniform (every card its own independent cell, same as before clusters
  // existed) and marks a prerequisite with a small icon on the card itself (see renderJobCardHTML)
  // rather than physical nesting.
  const renderGroup = (jobs) => {
    if (!isListMode) {
      return jobs.map(job => renderJobCardHTML(job, materialStockInfoByJobId, false, jobShortfallByProductTypeId)).join('');
    }
    const renderJob = (job, depth, childCount) => renderJobListRowHTML(job, materialStockInfoByJobId, depth, childCount, jobShortfallByProductTypeId);
    // Only the ROOTS of each cluster (see buildJobClusters) become items of the outer list - a
    // cluster with children renders as one self-contained block (row, then its nested children
    // indented underneath), so the list never sees individual parent/child rows separately.
    const { roots, childrenOf } = buildJobClusters(jobs);
    return roots.map(job => renderJobClusterHTML(job, childrenOf, 0, renderJob)).join('');
  };

  let html = '';
  if (activeJobStatusFilter !== 'pending' && startedJobs.length > 0) {
    const isCollapsed = collapsedJobGroups.has('started');
    html += `
      <div class="mb-2">
        <div class="lp-group-header is-active mb-2.5 cursor-pointer select-none" onclick="toggleJobGroupCollapse('started')">
          <span class="flex-shrink-0" style="color:var(--accent);">${window.svgIcon(isCollapsed ? 'chevron-right' : 'chevron-down')}</span>
          <span class="font-extrabold text-base rajdhani uppercase tracking-wider" style="color:var(--accent);">${window.svgIcon('activity')} In Progress</span>
          <span class="font-bold text-sm mono" style="color:var(--accent);">(${startedJobs.length})</span>
        </div>
        ${isCollapsed ? '' : `<div class="${groupWrapClass}">${renderGroup(startedJobs)}</div>`}
      </div>
    `;
  }
  if (activeJobStatusFilter !== 'started' && pendingJobs.length > 0) {
    const isCollapsed = collapsedJobGroups.has('pending');
    html += `
      <div>
        <div class="lp-group-header mb-2.5 cursor-pointer select-none" onclick="toggleJobGroupCollapse('pending')">
          <span class="flex-shrink-0" style="color:var(--text-mute);">${window.svgIcon(isCollapsed ? 'chevron-right' : 'chevron-down')}</span>
          <span class="font-extrabold text-base rajdhani uppercase tracking-wider" style="color:var(--text);">${window.svgIcon('hourglass')} Pending</span>
          <span class="font-bold text-sm mono" style="color:var(--text-mute);">(${pendingJobs.length})</span>
          ${isolatedJobIds.size > 0 ? `
            <span class="text-xs font-bold mono ml-auto flex-shrink-0" style="color:var(--accent);" title="The Consolidated BOM sidebar is only showing materials for these jobs (and their prerequisites), not the whole queue">${window.svgIcon('cart')} ${isolatedJobIds.size.toLocaleString()} selected</span>
            <button onclick="event.stopPropagation(); clearJobIsolation()" class="lp-chip-btn flex-shrink-0" title="Go back to showing materials for the whole queue">Show All</button>
          ` : ''}
        </div>
        ${isCollapsed ? '' : `<div class="${groupWrapClass}">${renderGroup(pendingJobs)}</div>`}
      </div>
    `;
  }
  container.innerHTML = html;
}

function updateViewModeButtonLabel() {
  const btn = document.getElementById('btn-view-mode');
  if (btn) btn.innerHTML = activeQueueViewMode === 'list'
    ? window.svgIcon('grid') + ' Grid View'
    : window.svgIcon('list') + ' List View';
}

function toggleQueueViewMode() {
  activeQueueViewMode = activeQueueViewMode === 'list' ? 'grid' : 'list';
  localStorage.setItem('eve_queue_view_mode', activeQueueViewMode);
  updateViewModeButtonLabel();
  renderJournalPage();
}
window.toggleQueueViewMode = toggleQueueViewMode;

// Compact single-line-per-job view. Shows the essentials (icon/name, runs, status, cost, profit,
// actions) with a chevron to expand the same BOM/details block used in grid view, reusing the same
// collapse state so switching views doesn't lose whether you had a job's details open.
function renderJobListRowHTML(job, materialStockInfoByJobId, depth, childCount, jobShortfallByProductTypeId) {
  const iconTypeId = job.productTypeId || job.typeId;
  const isJobReady = job.isStarted && job.startedAt && ((Date.now() - job.startedAt) / 1000 >= (job.totalBuildSeconds || 0));
  const jobIconUrl = window.getItemIconUrl(iconTypeId, window.TYPE_ID_TO_NAME[iconTypeId] || job.name, 64);
  const jobDisplayName = window.TYPE_ID_TO_NAME[iconTypeId] || (job.name || '')
    .replace(/ Blueprint$/i, '').replace(/ Reaction Formula$/i, '').replace(/ Formula$/i, '').trim();

  // Pending jobs previously just said "PENDING" with no indication of how long the build would
  // actually take once started - the estimated time was only visible after expanding the card's own
  // BOM block. Showing it right in the status column (same duration already computed for that block)
  // means "how long is this going to take" is answerable from the collapsed row alone. The word
  // "PENDING" itself is dropped - every row in this column already sits under a "⏳ PENDING" group
  // header, so repeating it on each individual row said nothing the icon+group context didn't already.
  // formatDurationCompact (not formatDuration) - full seconds-level precision on an estimate just
  // pushed long durations past this column's fixed width, and isn't information anyone needs anyway.
  let statusIconKind = 'pending';
  let statusText = job.totalBuildSeconds > 0 ? window.formatDurationCompact(job.totalBuildSeconds) : 'No time data';
  let isTimerBacked = false;
  if (job.isStarted && job.startedAt) {
    isTimerBacked = true;
    const elapsedSeconds = (Date.now() - job.startedAt) / 1000;
    const remaining = (job.totalBuildSeconds || 0) - elapsedSeconds;
    const ready = remaining <= 0;
    statusIconKind = ready ? 'ready' : 'remaining';
    statusText = ready ? 'Ready to Collect!' : `${window.formatDuration(Math.ceil(remaining))} remaining`;
  }
  const statusColor = job.isStarted && job.startedAt ? (statusIconKind === 'ready' ? 'var(--accent)' : 'var(--blue-300)') : 'var(--text-mute)';

  const p = getEffectiveJobProfit(job);
  const isExpanded = expandedJobCardIds.has(job.id);
  const isIsolated = isolatedJobIds.has(job.id);
  const cardStateClass = (job.isSubBuild ? 'job-subbuild' : (isJobReady ? 'job-ready' : (job.isStarted ? 'job-started' : ''))) + (isIsolated ? ' job-isolated' : '');
  // Isolation only makes sense for a real root job that still has materials to shop for - a sub-
  // build is pulled in automatically whenever its parent is isolated (see renderJournalPage), and a
  // started job's materials are already committed either way.
  // A bare unlabeled checkbox here was easy to miss entirely (confirmed - users couldn't find it),
  // so this uses the same labeled pill-check component the Stock & Location Personal/Corp toggles
  // use, instead of a 14px checkmark with no text.
  // The Shop pill only applies to root pending jobs (see comment above) - a sub-build/started job
  // renders the SAME pill markup but invisible (visibility:hidden, not an empty string) so it still
  // reserves its exact width. Without this, rows that skip it end up with one fewer element before
  // the icon than rows that have it, and everything after (icon, name, runs, cost...) drifts out of
  // column alignment against neighboring rows that DO show the pill.
  const isolationCheckboxHTML = `
    <label class="pill-check flex-shrink-0" onclick="event.stopPropagation()" title="Shop: show only this job's (and its prerequisites') materials in the Consolidated BOM sidebar" ${(!job.isStarted && !job.isSubBuild) ? '' : 'style="visibility:hidden;"'}>
      <input type="checkbox" ${isolatedJobIds.has(job.id) ? 'checked' : ''} onchange="toggleJobIsolation(${job.id})">
      <span class="pill-check-face">${window.svgIcon('cart')} Shop</span>
    </label>
  `;
  const focusButtonHTML = renderFocusButtonHTML(job);
  // Looked up, not computed - already deducted once, for every job, up front in renderJournalPage
  // (see applyJobMaterialsToStock's own comment for why that must happen regardless of any collapse/
  // filter state down here).
  const materialStockInfo = materialStockInfoByJobId.get(job.id) || [];

  // A prerequisite job's own run count is a one-time decision made when it was queued (or last
  // hand-edited) - it never revisits itself if what its parent(s) need, or your stock, changes
  // afterward (see computeQtyStillNeededAfterInternalSupply's own comment on why that's deliberate,
  // not an oversight). This surfaces the gap right on the job that can close it, instead of leaving
  // it as something only visible in the BOM sidebar - reported directly as wanting exactly this.
  const topUpRunsNeeded = (() => {
    if (!job.isSubBuild || job.isStarted || job.autoImported || job.productTypeId === undefined) return 0;
    const missingQty = (jobShortfallByProductTypeId && jobShortfallByProductTypeId[job.productTypeId]) || 0;
    if (missingQty <= 0) return 0;
    const recipe = window.recipeMap ? window.recipeMap[job.typeId] : null;
    const batchYield = (typeof window.getBatchYield === 'function' ? window.getBatchYield(recipe, false) : 1) || 1;
    return Math.ceil(missingQty / batchYield);
  })();

  const expandedDetailHTML = isExpanded ? `
    <div class="px-3 pb-3 pt-1" onclick="event.stopPropagation()">
      ${renderJobBOMBlockHTML(job, materialStockInfo)}
      ${!job.isStarted ? `
        <div class="lp-inset flex items-center gap-1.5 mt-2">
          <span class="text-xs font-bold flex-shrink-0" style="color:var(--text-mute);">Runs to start:</span>
          <input type="number" id="start-runs-${job.id}" value="${job.runsNeeded}" min="1" max="${job.runsNeeded}"
            onmousedown="event.stopPropagation()" onfocus="this.select()"
            class="field-line w-16 text-center font-bold p-1 text-sm" style="color:var(--accent);">
          <button onclick="startJobRuns(${job.id})" class="lp-chip-btn ml-auto flex-shrink-0">${window.svgIcon('play')} Start Job</button>
        </div>
      ` : ''}
    </div>
  ` : '';

  return `
    <div class="job-card lp-job-card ${cardStateClass}"
         draggable="true" data-job-id="${job.id}" ${depth ? `title="Prerequisite for: ${window.esc(job.parentJobName || 'another job')}"` : ''}
         ondragstart="handleJobDragStart(event, ${job.id})" ondragend="handleJobDragEnd(event)"
         ondragover="handleJobDragOver(event)" ondragleave="handleJobDragLeave(event)" ondrop="handleJobDrop(event, ${job.id})">
      <div class="flex items-center gap-2 p-2 cursor-pointer overflow-x-auto scrollbar-thin" onclick="toggleJobCardCollapse(${job.id})">
        <span class="drag-handle cursor-grab active:cursor-grabbing px-1 text-sm select-none flex-shrink-0" style="color:var(--text-mute);" onclick="event.stopPropagation()" title="Drag to reorder">${window.svgIcon('grip')}</span>
        ${isolationCheckboxHTML}
        ${focusButtonHTML}
        <span class="text-xs flex-shrink-0" style="color:var(--text-mute);">${window.svgIcon(isExpanded ? 'chevron-down' : 'chevron-right')}</span>
        <img src="${jobIconUrl}" alt="${window.esc(jobDisplayName)}" class="w-8 h-8 rounded-md flex-shrink-0" loading="lazy" onerror="this.onerror=null; this.src='https://images.evetech.net/types/${iconTypeId}/render?size=64';">
        <div class="min-w-0 flex-1">
          <!-- Sub-build relationship is a small inline badge next to the name, not its own text line
               below it - same treatment the grid card already uses. A dedicated "Prereq for: X" line
               was tried here, but keeping it out of the flow entirely (even hidden via visibility, it
               still occupies height) made the name column two lines tall on EVERY row, so the single-
               line columns beside it (icon, runs, status, cost, profit, preset) - centered via the
               row-level items-center - landed off from the name text itself, which is what "not
               centered" kept coming back to no matter how those other columns were tuned. Folding the
               relationship into the name line instead keeps every row genuinely one line tall, so
               items-center has nothing left to misalign. The parent name is still fully available on
               hover (title), same as a properly-nested (depth>0) sub-build already conveys via its own
               indentation + connector line - this just also covers an orphaned one (parent not present
               in the current filtered list) that has no indentation to lean on. -->
          <div class="font-bold text-sm truncate" style="color:var(--text);"><span class="copy-name" data-copy-name="${window.esc(jobDisplayName)}" onclick="copyNameToClipboard(event)" title="Click to copy: ${window.esc(jobDisplayName)}">${window.esc(jobDisplayName)}</span>${renderJobOwnershipBadgeHTML(job)}${renderPrereqBadgeHTML(job, 'ml-1 text-xs align-middle')}${(childCount > 0) ?`<button onclick="toggleClusterCollapse(event, ${job.id})" class="ml-1.5 lp-badge align-middle" style="cursor:pointer;" title="${collapsedClusterIds.has(job.id) ? `Show ${childCount} hidden prerequisite job${childCount > 1 ? 's' : ''}` : `Collapse ${childCount} prerequisite job${childCount > 1 ? 's' : ''} under this one`}">${window.svgIcon(collapsedClusterIds.has(job.id) ? 'chevron-right' : 'chevron-down')} ${childCount}</button>` : ''}</div>
        </div>
        <div class="flex items-center flex-shrink-0" style="margin-left:20px;">
          <!-- Edit icon lives INSIDE this same items-baseline row, right after "runs" - not as a
               separate sibling block. A separate sibling had no gap/baseline relationship to this row
               at all (cramped against "runs", vertically centered against the whole row's height
               instead of sitting on the small text's baseline the way "runs" itself does). Sharing this
               row's own items-baseline + gap-1.5 fixes both. Its width is still ALWAYS reserved (via
               visibility:hidden, not by omitting the element - same technique the Shop pill above uses)
               for started/auto-imported jobs, so the run count's own x position still doesn't drift
               row to row depending on which jobs happen to be editable. -->
          <div class="flex items-baseline justify-end gap-1 flex-shrink-0" style="width:230px;" onclick="event.stopPropagation()">
            ${editingRunsJobIds.has(job.id) ? `
              <span class="text-xs mono" style="color:var(--text-mute);">Jobs</span>
              <input type="number" id="jobs-edit-input-${job.id}" min="1" value="${job.jobCount || 1}" onkeydown="if(event.key==='Enter'){this.blur();}else if(event.key==='Escape'){toggleRunsEditMode(event, ${job.id});}" onblur="handleJobsRunsBlur(${job.id})" class="field-line text-sm font-extrabold mono text-center num-no-spin" style="width:${Math.max(4, String(job.jobCount || 1).length + 2)}ch; color:var(--accent);" title="Jobs - how many separate real jobs">
              <span class="text-sm mono" style="color:var(--text-mute);">×</span>
              <input type="number" id="runs-edit-input-${job.id}" min="1" value="${job.runsPerJob || job.runsNeeded}" onkeydown="if(event.key==='Enter'){this.blur();}else if(event.key==='Escape'){toggleRunsEditMode(event, ${job.id});}" onblur="handleJobsRunsBlur(${job.id})" class="field-line text-sm font-extrabold mono text-center num-no-spin" style="width:${Math.max(4, String(job.runsPerJob || job.runsNeeded).length + 2)}ch; color:var(--accent);" title="Runs per job - recalculates materials, cost, and time on commit">
              <span class="text-sm mono" style="color:var(--text-mute);">Run${(job.runsPerJob || job.runsNeeded) > 1 ? 's' : ''}</span>
            ` : `
              <span class="text-lg font-extrabold mono whitespace-nowrap cursor-pointer" style="color:var(--accent);" onclick="copyRunsToClipboard(event, ${job.runsNeeded})" title="Click to copy the run count to clipboard">${runsDisplayHTML(job)}</span>
            `}
            <span class="flex-shrink-0" style="width:12px;${(!job.isStarted && !job.autoImported) ? '' : ' visibility:hidden;'}">${renderRunsEditIconHTML(job.id, editingRunsJobIds.has(job.id))}</span>
            ${topUpRunsNeeded > 0 && !editingRunsJobIds.has(job.id) ? `
              <button onclick="topUpPrerequisiteJob(${job.id})" class="lp-chip-btn flex-shrink-0" style="color:var(--red-400, #f87171); border-color:rgba(248,113,113,0.35);" title="What's built here is short ${topUpRunsNeeded > 1 ? topUpRunsNeeded + ' runs' : '1 run'} of what your queue actually needs - click to add exactly that many">+${topUpRunsNeeded}</button>
            ` : ''}
          </div>
          <div class="lp-divider-col flex items-center gap-1.5 flex-shrink-0" style="width:260px;" title="Job status">
            <!-- Status icon (hourglass/stopwatch/check) gets the same fixed-slot treatment - it used to
                 be an emoji prefixed directly onto the status text, so its position (like the edit icon
                 above) drifted depending on how long that text was. id lets updateJobTimers() (below)
                 swap it from stopwatch to checkmark the moment a job goes ready, live, no full re-render
                 needed - it can't just be a child of .job-timer the way .timer-display is since that
                 would put it back inside the flex group whose width varies with the text, which is
                 exactly the misalignment this whole restructure exists to avoid. -->
            <span id="status-icon-${job.id}" class="flex-shrink-0" style="width:13px; color:${statusColor};">${renderJobStatusIconHTML(statusIconKind)}</span>
            <span class="flex-1 text-right" style="overflow:hidden; text-overflow:ellipsis;">
              ${isTimerBacked
                ? `<span class="job-timer" data-job-id="${job.id}" data-job-name="${window.esc(jobDisplayName)}" data-started-at="${job.startedAt}" data-total-seconds="${job.totalBuildSeconds || 0}"><span class="timer-display text-xs font-extrabold mono whitespace-nowrap" style="color:${statusColor};">${statusText}</span></span>`
                : `<span class="text-xs font-extrabold mono whitespace-nowrap" style="color:${statusColor};">${statusText}</span>`}
            </span>
          </div>
          <div class="flex flex-col items-end lp-divider-col flex-shrink-0" style="width:190px;" title="Total manufacturing cost for this job: ${Math.round(job.calculatedCost || 0).toLocaleString()} ISK">
            <span class="text-[8px] uppercase tracking-wide font-bold" style="color:var(--text-mute);">Cost</span>
            <span class="text-xs font-bold mono whitespace-nowrap" style="color:var(--cost);">${window.formatISKCompact(job.calculatedCost || 0)}</span>
          </div>
          <div class="flex flex-col items-end lp-divider-col flex-shrink-0" style="width:190px;" title="Net sell profit for this job${p !== undefined ? ': ' + Math.round(p).toLocaleString() + ' ISK' : ''}">
            <span class="text-[8px] uppercase tracking-wide font-bold" style="color:var(--text-mute);">Profit</span>
            <span class="text-xs font-bold mono whitespace-nowrap" style="color:${p !== undefined ? (p >= 0 ? 'var(--green)' : 'var(--red)') : 'var(--text-mute)'};">${p !== undefined ? window.formatISKCompact(p) : '—'}</span>
          </div>
          <!-- Its own fixed-width column, not tucked under the name - a job's production preset is
               independent of how many lines the name column happens to render (item name alone vs.
               item name + prereq caption), so pinning it here keeps it centered with runs/status/
               cost/profit every time instead of drifting with the name column's height or width. -->
          <div class="lp-divider-col flex-shrink-0" style="width:190px;" onclick="event.stopPropagation()">${renderJobMetaChipHTML(job, true)}</div>
          <div class="flex items-center gap-2 lp-divider-col flex-shrink-0" onclick="event.stopPropagation()">
          <button onclick="markJobAsBuilt(${job.id})" class="lp-chip-btn" title="Mark as built" aria-label="Mark as built">${window.svgIcon('check')}</button>
          <button onclick="deleteJobFromQueue(${job.id})" class="lp-badge lp-badge-danger" style="cursor:pointer;" title="Delete job" aria-label="Delete job">${window.svgIcon('x', { style: 'margin:0' })}</button>
          </div>
        </div>
      </div>
      ${expandedDetailHTML}
    </div>
  `;
}

// --- Production preset tracking (which system/structure/rigs a job's numbers assume) ---
// app.js (and its getProductionPresets/loadProductionPreset helpers) isn't loaded on this page, so
// saved presets are re-read directly from the same localStorage key rather than through a shared
// function - it's just JSON, no need for a cross-file dependency for a one-line parse.
function getSavedProductionPresetsLocal() {
  return window.safeParseJSON(localStorage.getItem('eve_production_presets'), {});
}

// Turns a job's raw productionSnapshot into a friendly label: the name of a currently-saved preset
// if all 5 fields still match exactly, otherwise a synthesized "Structure @ System" description so
// there's always something readable even for a combo that was never saved as a named preset.
function resolveProductionPresetLabel(snapshot) {
  if (!snapshot) return 'Unknown';
  const presets = getSavedProductionPresetsLocal();
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

// Fallback for a job added before preset tracking existed - best guess is whatever's live right now.
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

// The label used to both DISPLAY and FILTER by station - null for auto-imported jobs (no preset
// concept, see the note on activeStationFilter above), otherwise the same resolved label the badge/
// row already show, so "filter by station" always matches what's actually printed on the card.
function getJobStationLabel(job) {
  if (!job || job.autoImported) return null;
  return resolveProductionPresetLabel(job.productionSnapshot || getCurrentLiveProductionSnapshot());
}

// Keeps the #station-filter-select options in sync with whatever stations are actually in use right
// now - jobs/presets can change at any time, so this is cheap to just rebuild on every render rather
// than trying to track when it might have gone stale.
function populateStationFilterDropdown() {
  const select = document.getElementById('station-filter-select');
  if (!select) return;
  const labels = Array.from(new Set(activeJobs.map(getJobStationLabel).filter(Boolean))).sort();
  // Nothing to filter by (no jobs, or only auto-imported ones) - hide it entirely rather than show
  // a dropdown with nothing but "All Stations" in it.
  if (labels.length === 0) {
    select.closest('[data-station-filter-wrap]')?.classList.add('hidden');
    return;
  }
  select.closest('[data-station-filter-wrap]')?.classList.remove('hidden');
  // A station that's no longer in use (last job using it was deleted/rebuilt) falls back to "all"
  // instead of silently filtering to a now-empty list with no visible explanation why.
  if (activeStationFilter !== 'all' && !labels.includes(activeStationFilter)) activeStationFilter = 'all';
  select.innerHTML = `<option value="all">All Stations</option>` +
    labels.map(l => `<option value="${window.esc(l)}" ${l === activeStationFilter ? 'selected' : ''}>${window.esc(l)}</option>`).join('');
}

function setStationFilter(value) {
  activeStationFilter = value || 'all';
  renderJournalPage();
}
window.setStationFilter = setStationFilter;

// Compact metadata chip for the collapsed card header - visible without expanding, so a wrong
// preset (or an auto-imported source) is still spottable at a glance across the whole queue. Used
// to be two separate full-width uppercase text lines (one for auto-imported, one for preset); a
// job only ever shows one of the two (auto-imported jobs have no preset concept - see
// getJobStationLabel), so one small pill in place of a whole sentence-line covers both cases.
// .lp-badge wraps by default (fine for the short fixed badges it's normally used for elsewhere -
// "BPO"/"BPC", "✓ Queued") but a preset label is arbitrary-length text, and a wrapped multi-line
// pill looks broken rather than compact - truncating with an ellipsis (full label still in the
// title) keeps it a clean single line regardless of how long the label is.
const CHIP_TRUNCATE_STYLE = 'display:inline-block; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; vertical-align:bottom;';
// A LIVE control, not just a readout: the select's own "currently selected" option IS the resolved
// label, so at rest it reads exactly like the old static badge did - but opening it lists every other
// saved preset, and picking one calls the same changeJobProductionPreset the expanded BOM block's own
// preset row uses. Previously this only existed inside the expanded detail (renderJobPresetRowHTML),
// so changing a job's preset required expanding the card (or Focus mode, which force-expands it) -
// this puts the same action one click away from the collapsed title in both list and grid mode.
// `inline` (used by the list row) drops the own-line "mt-1" wrapper and shrinks the select's max
// width, since the caller there already places this chip in a shared flex row next to the prereq
// text instead of stacking it on its own line beneath - see renderJobListRowHTML. flex-shrink-0
// keeps the preset control at a consistent, clickable width in that shared row - the prereq text
// next to it (min-w-0 flex-1, no shrink-0) is the one that gives up space and truncates first.
function renderJobMetaChipHTML(job, inline) {
  const outerCls = inline ? 'min-w-0 flex-shrink-0' : 'mt-1';
  if (job.autoImported) {
    const meTe = job.meLevel !== undefined ? ` | ME: ${job.meLevel}% TE: ${job.teLevel}%` : '';
    return `<div class="${outerCls}"><span class="lp-badge lp-badge-accent" style="${CHIP_TRUNCATE_STYLE}" title="No matching plan existed - imported from your active EVE job${window.esc(meTe)}">${window.svgIcon('download')} Auto-imported</span></div>`;
  }
  const isAssumed = !job.productionSnapshot;
  const label = resolveProductionPresetLabel(job.productionSnapshot || getCurrentLiveProductionSnapshot());
  const presets = getSavedProductionPresetsLocal();
  const presetNames = Object.keys(presets).sort();
  const currentOptionHTML = `<option value="" selected>${window.esc(label)}${isAssumed ? ' (assumed)' : ''}</option>`;
  const optionsHTML = presetNames.map(name => `<option value="${window.esc(name)}">${window.esc(name)}</option>`).join('');
  return `
    <div class="${outerCls}" onclick="event.stopPropagation()">
      <select onchange="if (this.value) changeJobProductionPreset(${job.id}, this.value);" class="lp-badge" style="${CHIP_TRUNCATE_STYLE} max-width:${inline ? '160px' : '220px'}; font-size:10px; cursor:pointer;" ${presetNames.length === 0 ? 'disabled' : ''} title="Production preset this job assumes - click to change">
        ${currentOptionHTML}
        ${optionsHTML}
      </select>
    </div>
  `;
}

// Small "ME: X% TE: Y%" readout for the expanded job detail - see getJobMeTe's own comment for where
// each job type's real value actually lives. Shown for every job (previously this was only visible by
// hovering the auto-imported chip's tooltip, and not shown anywhere at all for a manually-planned job)
// since knowing which research level a job's materials/time were computed against matters for telling
// two otherwise-identical-looking jobs apart, and for trusting the numbers below it.
function renderJobMeTeRowHTML(job) {
  const meTe = getJobMeTe(job);
  return `
    <div class="flex items-center gap-1 text-xs mono flex-shrink-0" style="color:var(--text-mute);" title="Material Efficiency / Time Efficiency this job's materials, cost, and build time are computed against">
      <span style="color:var(--orange-400, #fb923c);">ME ${meTe.me}%</span>
      <span>/</span>
      <span style="color:var(--orange-400, #fb923c);">TE ${meTe.te}%</span>
    </div>
  `;
}

// "Preset:" row + change control for the expanded job detail, plus the ME/TE readout above - the
// preset control itself is skipped for auto-imported (real ESI) jobs, whose cost/time/materials
// already come from EVE itself and shouldn't be replaced by a guess, but the ME/TE readout still
// applies to those too (see renderJobMeTeRowHTML).
function renderJobPresetRowHTML(job) {
  if (job.autoImported) {
    return `
      <div class="flex items-center justify-between gap-2 mb-1.5 pb-1.5 flex-wrap" style="border-bottom:1px solid rgba(255,255,255,0.06);">
        <span class="text-xs font-bold flex-shrink-0" style="color:var(--text-mute);" title="Real EVE job - cost/time/materials come from ESI directly, no preset assumption involved">
          ${window.svgIcon('download')} From your active EVE job
        </span>
        ${renderJobMeTeRowHTML(job)}
        <!-- Same "reserve the width even when nothing goes here" trick this file already uses for the
             Shop pill and the runs-edit icon. A non-auto-imported job's row below has THREE children
             (label, ME/TE, "Change preset..." select), so justify-between lands ME/TE in the middle.
             An auto-imported job has no preset to change - skipped on purpose, its numbers come
             straight from EVE, not a guess (see the label above) - but without a third child here,
             justify-between treats ME/TE as the LAST child instead and shoves it to the far right,
             landing it in a completely different spot than every other job's row. Matching the
             select's own max-width keeps the ME/TE readout's own position consistent between the two
             instead of jumping based on which kind of job it is. -->
        <span class="flex-shrink-0" style="width:170px; visibility:hidden;" aria-hidden="true"></span>
      </div>
    `;
  }
  const isAssumed = !job.productionSnapshot;
  const label = resolveProductionPresetLabel(job.productionSnapshot || getCurrentLiveProductionSnapshot());
  const presets = getSavedProductionPresetsLocal();
  const presetNames = Object.keys(presets).sort();
  const optionsHTML = presetNames.length > 0
    ? presetNames.map(name => `<option value="${window.esc(name)}">${window.esc(name)} (${window.esc(presets[name].systemName)}, ${window.esc(presets[name].facilityLabel)})</option>`).join('')
    : `<option value="" disabled>No saved presets yet - save one from the Calculator</option>`;
  return `
    <div class="flex items-center justify-between gap-2 mb-1.5 pb-1.5 flex-wrap" style="border-bottom:1px solid rgba(255,255,255,0.06);">
      <span class="text-xs font-bold flex-shrink-0" style="color:var(--text-mute);" title="${isAssumed ? 'This job predates preset tracking, or its preset no longer matches a saved one - showing your currently active setup as a best guess.' : 'Production preset this job\'s materials/cost/time assume'}">
        ${window.svgIcon('factory')} ${window.esc(label)}${isAssumed ? ' <span style="font-style:italic;">(assumed)</span>' : ''}
      </span>
      ${renderJobMeTeRowHTML(job)}
      <select onchange="changeJobProductionPreset(${job.id}, this.value); this.value='';" class="field-line text-[10px] font-bold flex-shrink-0" style="max-width:170px; color:var(--accent);" ${presetNames.length === 0 ? 'disabled' : ''} title="Change which production preset this job assumes and recompute its materials/cost/time">
        <option value="" selected>Change preset...</option>
        ${optionsHTML}
      </select>
    </div>
  `;
}

// Shared engine behind "change this job's preset" and "spin off a prerequisite job": temporarily
// applies a productionSnapshot's facility/rig/system globals, rebuilds a fresh ME/TE-adjusted tree
// for the given blueprint+runs (same bridge buildAutoImportedJob already uses to do this outside the
// Calculator page), and ALWAYS restores every touched global afterward regardless of success/failure.
// `buildConfig` (optional - a job's own buildConfigSnapshot, set at add-time in app.js) covers the
// OTHER thing that's live global state on the Calculator but starts empty on this page every load:
// which sub-assemblies were toggled to "Build" vs "Buy", any per-component buy-order override, and
// any custom ME/TE override. Without restoring these too, a fresh tree rebuilt here would silently
// default every sub-component below the root back to "buy at market price" - overstating cost for
// anything the user had actually chosen to build cheaper themselves (as its own separate queued
// sub-build job), even though the numbers shown at the moment the job was first added were correct.
async function rebuildTreeForSnapshot(blueprintTypeId, name, runs, productTypeId, snapshot, buildConfig, jobCount = 1) {
  if (typeof window.buildRecursiveRecipeTree !== 'function') throw new Error('Recipe tree builder not available.');

  const prevFacilityKey = localStorage.getItem('eve_active_facility_key');
  const prevRig1 = localStorage.getItem('eve_rig_slot_1');
  const prevRig2 = localStorage.getItem('eve_rig_slot_2');
  const prevRig3 = localStorage.getItem('eve_rig_slot_3');
  const prevSecurity = window.activeSystemSecurity;
  const prevMfgSCI = window.activeMfgSCI;
  const prevReactSCI = window.activeReactSCI;
  const prevInventionSCI = window.activeInventionSCI;
  const prevBuildSelfOverrides = window.buildSelfOverrides;
  const prevCustomBuyModes = window.customBuyModes;
  const prevCustomMEOverrides = window.customMEOverrides;
  const prevCustomTEOverrides = window.customTEOverrides;

  try {
    if (buildConfig) {
      window.buildSelfOverrides = { ...(buildConfig.buildSelfOverrides || {}) };
      window.customBuyModes = { ...(buildConfig.customBuyModes || {}) };
      window.customMEOverrides = { ...(buildConfig.customMEOverrides || {}) };
      window.customTEOverrides = { ...(buildConfig.customTEOverrides || {}) };
    }
    localStorage.setItem('eve_active_facility_key', snapshot.facilityKey || 'sotiyo');
    localStorage.setItem('eve_rig_slot_1', snapshot.rig1 || '');
    localStorage.setItem('eve_rig_slot_2', snapshot.rig2 || '');
    localStorage.setItem('eve_rig_slot_3', snapshot.rig3 || '');
    // Also fetches when activeSystemSecurity is still unset, not just when the system id differs -
    // this page (unlike the Calculator) never has its own "select a system" flow to populate it on
    // load, so on a fresh Ledger page load it starts undefined. Skipping the fetch just because
    // snapshot.systemId happens to equal eve_selected_system's id left it undefined all session,
    // which getSecurityMultiplier() (config.js) silently reads as highsec (1.0x) - understating a
    // low/null-sec rig's actual bonus and overstating every reaction material's requirement by
    // however much that rig should have been discounting it (a rig-bearing job in lowsec/nullsec
    // needs its real 1.9x/2.1x multiplier applied, not the highsec fallback).
    const currentSystemId = window.safeParseJSON(localStorage.getItem('eve_selected_system'), {}).id;
    const securityUnknown = window.activeSystemSecurity === undefined || window.activeSystemSecurity === null;
    if (snapshot.systemId && (snapshot.systemId !== currentSystemId || securityUnknown) && typeof window.fetchSystemSCIById === 'function') {
      await window.fetchSystemSCIById(snapshot.systemId, snapshot.systemName);
    }

    window.recipeTreeRootProductTypeId = productTypeId;
    let root;
    try {
      root = await window.buildRecursiveRecipeTree(blueprintTypeId, name, runs, 0, 6, new Set(), null, jobCount);
    } finally {
      window.recipeTreeRootProductTypeId = null;
    }
    if (!root) throw new Error('Could not resolve a recipe tree.');

    root.runsNeeded = runs;
    root.qtyNeeded = runs * (root.batchYield || 1);
    root.jobCount = Math.max(1, jobCount || 1);
    const facility = (window.getActiveStructureType ? window.getActiveStructureType().meBonus : 1.0) / 100;
    if (typeof window.scaleTreeQuantities === 'function') window.scaleTreeQuantities(root, facility);

    const allTypeIds = new Set();
    if (typeof window.collectAllTypeIds === 'function') window.collectAllTypeIds(root, allTypeIds);
    if (typeof window.fetchMarketPrices === 'function') await window.fetchMarketPrices(Array.from(allTypeIds));
    if (typeof window.calculateNodeEIV === 'function') window.calculateNodeEIV(root);

    return {
      root: root,
      calculatedCost: typeof window.calculateTreeNodeCost === 'function' ? window.calculateTreeNodeCost(root) : 0,
      materials: typeof window.extractJobMaterialsForNode === 'function' ? window.extractJobMaterialsForNode(root) : [],
      totalBuildSeconds: typeof window.calculateTotalBuildSeconds === 'function' ? window.calculateTotalBuildSeconds(root) : 0
    };
  } finally {
    if (prevFacilityKey === null) localStorage.removeItem('eve_active_facility_key'); else localStorage.setItem('eve_active_facility_key', prevFacilityKey);
    if (prevRig1 === null) localStorage.removeItem('eve_rig_slot_1'); else localStorage.setItem('eve_rig_slot_1', prevRig1);
    if (prevRig2 === null) localStorage.removeItem('eve_rig_slot_2'); else localStorage.setItem('eve_rig_slot_2', prevRig2);
    if (prevRig3 === null) localStorage.removeItem('eve_rig_slot_3'); else localStorage.setItem('eve_rig_slot_3', prevRig3);
    window.activeSystemSecurity = prevSecurity;
    window.activeMfgSCI = prevMfgSCI;
    window.activeReactSCI = prevReactSCI;
    window.activeInventionSCI = prevInventionSCI;
    window.buildSelfOverrides = prevBuildSelfOverrides;
    window.customBuyModes = prevCustomBuyModes;
    window.customMEOverrides = prevCustomMEOverrides;
    window.customTEOverrides = prevCustomTEOverrides;
  }
}

async function changeJobProductionPreset(jobId, presetName) {
  if (!presetName) return;
  const job = activeJobs.find(j => j && j.id === jobId);
  if (!job || job.autoImported) return;
  const preset = getSavedProductionPresetsLocal()[presetName];
  if (!preset) return;

  if (typeof window.showToast === 'function') window.showToast(`Recomputing "${window.esc(job.name)}" for "${window.esc(presetName)}"...`, 'info');
  try {
    const result = await rebuildTreeForSnapshot(job.typeId, job.name + ' Blueprint', job.runsNeeded, job.productTypeId, preset, job.buildConfigSnapshot, job.jobCount || 1);
    job.calculatedCost = result.calculatedCost;
    job.qtyNeeded = result.root.qtyNeeded;
    job.materials = result.materials;
    job.totalBuildSeconds = result.totalBuildSeconds;
    // Keep the job's own sell price/strategy as-is - only the bonus-driven numbers (cost/time/
    // materials) should move when the preset changes, not what you'd sell the output for.
    if (job.netProfit !== undefined) {
      job.netProfit = (job.unitSellPrice || 0) * job.qtyNeeded - job.calculatedCost;
    }
    job.productionSnapshot = {
      systemId: preset.systemId || null, systemName: preset.systemName || null,
      facilityKey: preset.facilityKey || 'sotiyo',
      rig1: preset.rig1 || '', rig2: preset.rig2 || '', rig3: preset.rig3 || ''
    };
    localStorage.setItem('eve_ledger_jobs', JSON.stringify(activeJobs));
    renderJournalPage();
    if (typeof window.showToast === 'function') window.showToast(`"${window.esc(job.name)}" now uses the "${window.esc(presetName)}" preset.`, 'success');
  } catch (e) {
    console.warn('[Ledger] changeJobProductionPreset failed:', e);
    if (typeof window.showToast === 'function') window.showToast('Failed to recompute this job for the new preset - it was left unchanged.', 'error');
  }
}
window.changeJobProductionPreset = changeJobProductionPreset;

// Lets a not-yet-started job's Jobs and Runs-per-job be edited directly, instead of having to delete
// it and re-add it from the Calculator at the right quantity. Full rebuild (not a linear qty/cost
// scale) for the same reason changeJobProductionPreset does one - batch yields and sub-component
// rounding don't scale proportionally with run count, so only a real rebuild keeps materials/cost/
// time accurate, AND correctly re-applies the jobCount split-rounding (see js/tree.js's own comment
// on node.jobCount) for whatever the new Jobs count is. Blocked for a started job (EVE itself won't
// let you change a job's runs once it's actually running - see startJobRuns for the real mechanic,
// splitting off a subset before starting) and for an auto-imported job (its run count is real ESI
// data, not something to overwrite with a guess).
//
// Both the Jobs and Runs inputs share this one commit function (called from each one's onblur, via
// handleJobsRunsBlur below) - reading whichever value is CURRENTLY in each field at commit time,
// not "the one that just blurred", so tabbing from Jobs into Runs (or the reverse) always commits
// both fields together in one rebuild rather than committing Jobs alone first with a stale Runs value.
async function commitJobsRunsEdit(jobId) {
  const job = activeJobs.find(j => j && j.id === jobId);
  if (!job || job.isStarted || job.autoImported) { editingRunsJobIds.delete(jobId); renderJournalPage(); return; }

  const jobsInput = document.getElementById(`jobs-edit-input-${jobId}`);
  const runsInput = document.getElementById(`runs-edit-input-${jobId}`);
  const jobCount = Math.max(1, Math.floor(Number(jobsInput ? jobsInput.value : job.jobCount || 1)) || 1);
  const runsPerJob = Math.max(1, Math.floor(Number(runsInput ? runsInput.value : job.runsPerJob || job.runsNeeded)) || 1);
  const runs = jobCount * runsPerJob;

  editingRunsJobIds.delete(jobId); // editing is done either way (committed or a no-op) - back to plain display
  if (runs === job.runsNeeded && jobCount === (job.jobCount || 1)) { renderJournalPage(); return; } // no-op (e.g. re-typed the same values) - just redraw to restore the inputs' displayed values

  const snapshot = job.productionSnapshot || getCurrentLiveProductionSnapshot();
  const label = jobCount > 1 ? `${jobCount} jobs × ${runsPerJob} run${runsPerJob > 1 ? 's' : ''}` : `${runs} run${runs > 1 ? 's' : ''}`;
  if (typeof window.showToast === 'function') window.showToast(`Recomputing "${window.esc(job.name)}" for ${label}...`, 'info');
  const oldMaterials = Array.isArray(job.materials) ? job.materials : [];
  try {
    const result = await rebuildTreeForSnapshot(job.typeId, job.name + ' Blueprint', runs, job.productTypeId, snapshot, job.buildConfigSnapshot, jobCount);
    job.runsNeeded = runs;
    job.jobCount = jobCount;
    job.runsPerJob = runsPerJob;
    job.qtyNeeded = result.root.qtyNeeded;
    job.calculatedCost = result.calculatedCost;
    job.materials = result.materials;
    job.totalBuildSeconds = result.totalBuildSeconds;
    // Keep the job's own sell price/strategy as-is - only what scales with quantity should move.
    if (job.netProfit !== undefined) {
      job.netProfit = (job.unitSellPrice || 0) * job.qtyNeeded - job.calculatedCost;
    }
    await cascadeRunChangeToChildren(job, oldMaterials);
    localStorage.setItem('eve_ledger_jobs', JSON.stringify(activeJobs));
    renderJournalPage();
    if (typeof window.showToast === 'function') window.showToast(`"${window.esc(job.name)}" now set to ${label}.`, 'success');
  } catch (e) {
    console.warn('[Ledger] commitJobsRunsEdit failed:', e);
    if (typeof window.showToast === 'function') window.showToast('Failed to recompute this job for the new Jobs/Runs - it was left unchanged.', 'error');
    renderJournalPage(); // restore the inputs to the job's actual (unchanged) values
  }
}
window.commitJobsRunsEdit = commitJobsRunsEdit;

// Tops up a prerequisite job by exactly enough runs to cover what the rest of the queue still needs
// from it - the click-to-act counterpart of the "+N" button rendered next to that job's own run
// count (see renderJobCardHTML/renderJobListRowHTML's own topUpRunsNeeded). Recomputes the shortfall
// fresh here rather than trusting whatever number was baked into the button at the last render - the
// queue could have changed in the meantime (another job started, a material's stock refreshed), and
// this should only ever add exactly what's genuinely still missing right now, not a stale amount.
async function topUpPrerequisiteJob(jobId) {
  const job = activeJobs.find(j => j && j.id === jobId);
  if (!job || !job.isSubBuild || job.isStarted || job.autoImported || job.productTypeId === undefined) return;

  const deductModeInput = document.getElementById('deduct-stock-mode');
  const isStockDeductEnabled = deductModeInput ? deductModeInput.value === 'true' : true;
  const qtyStillNeededByTypeId = computeQtyStillNeededAfterInternalSupply(activeJobs);
  const grossShortfall = qtyStillNeededByTypeId[job.productTypeId] || 0;
  const stockQty = isStockDeductEnabled ? (userStockMap[job.productTypeId] || 0) : 0;
  const missingQty = Math.max(0, grossShortfall - stockQty);
  if (missingQty <= 0) { renderJournalPage(); return; } // already covered by now - just refresh the view

  const recipe = window.recipeMap ? window.recipeMap[job.typeId] : null;
  const batchYield = (typeof window.getBatchYield === 'function' ? window.getBatchYield(recipe, false) : 1) || 1;
  const additionalRuns = Math.ceil(missingQty / batchYield);
  const jobCount = job.jobCount || 1;
  const newRunsNeeded = (job.runsNeeded || 0) + additionalRuns;
  const newRunsPerJob = Math.ceil(newRunsNeeded / jobCount);

  const oldMaterials = Array.isArray(job.materials) ? job.materials : [];
  const snapshot = job.productionSnapshot || getCurrentLiveProductionSnapshot();
  if (typeof window.showToast === 'function') window.showToast(`Topping up "${window.esc(job.name)}" by ${additionalRuns} run${additionalRuns > 1 ? 's' : ''}...`, 'info');
  try {
    const result = await rebuildTreeForSnapshot(job.typeId, job.name + ' Blueprint', newRunsNeeded, job.productTypeId, snapshot, job.buildConfigSnapshot, jobCount);
    job.runsNeeded = newRunsNeeded;
    job.runsPerJob = newRunsPerJob;
    job.qtyNeeded = result.root.qtyNeeded;
    job.calculatedCost = result.calculatedCost;
    job.materials = result.materials;
    job.totalBuildSeconds = result.totalBuildSeconds;
    if (job.netProfit !== undefined) {
      job.netProfit = (job.unitSellPrice || 0) * job.qtyNeeded - job.calculatedCost;
    }
    await cascadeRunChangeToChildren(job, oldMaterials);
    localStorage.setItem('eve_ledger_jobs', JSON.stringify(activeJobs));
    renderJournalPage();
    if (typeof window.showToast === 'function') window.showToast(`"${window.esc(job.name)}" now covers the missing ${Math.round(missingQty).toLocaleString()} - set to ${newRunsNeeded} runs.`, 'success');
  } catch (e) {
    console.warn('[Ledger] topUpPrerequisiteJob failed:', e);
    if (typeof window.showToast === 'function') window.showToast('Failed to top up this job - it was left unchanged.', 'error');
    renderJournalPage();
  }
}
window.topUpPrerequisiteJob = topUpPrerequisiteJob;

// Shared onblur for the Jobs/Runs input PAIR - Tab moving focus from one to the sibling fires this
// input's blur BEFORE the sibling gains focus, so committing immediately on every blur would commit
// Jobs alone (with a not-yet-edited Runs value) the moment focus leaves it while tabbing through, not
// just when the user is actually done with both. Deferring one tick and checking where focus actually
// landed - the sibling input (still mid-edit, don't commit yet) or genuinely elsewhere (commit now,
// reading both fields' latest values) - makes tabbing through both feel like one edit, not two.
function handleJobsRunsBlur(jobId) {
  setTimeout(() => {
    const active = document.activeElement;
    if (active && (active.id === `jobs-edit-input-${jobId}` || active.id === `runs-edit-input-${jobId}`)) return;
    commitJobsRunsEdit(jobId);
  }, 0);
}
window.handleJobsRunsBlur = handleJobsRunsBlur;

// A queued prerequisite job was sized to cover a specific material need at the time it was created
// (e.g. "build 3 runs to cover the 600 units still missing after stock") - left alone after the
// PARENT's own run count changes, that sizing silently goes stale: the parent now needs a different
// amount of that same material, but the prereq job just sits at its old run count. This rescales
// every linked, not-yet-started prerequisite proportionally to how the parent's need for its
// specific material changed (600 units -> 857 units scales a 3-run prereq up, not reset to whatever
// the parent's FULL raw requirement is regardless of stock - that would silently throw away
// whatever stock-aware sizing the user/the "+ Build" flow originally chose), then recurses into that
// child's own prerequisites (if it has any) so a multi-level chain stays in sync top to bottom.
// Best-effort per child - one child failing to recompute (e.g. a transient price-fetch error) is
// logged and skipped, not fatal to the parent's own already-applied and already-saved run change.
async function cascadeRunChangeToChildren(parentJob, oldMaterials) {
  const children = activeJobs.filter(j => j && j.isSubBuild && !j.isStarted && !j.autoImported && j.productTypeId &&
    (j.parentJobId !== undefined && j.parentJobId !== null ? j.parentJobId === parentJob.id : j.parentJobName === parentJob.name));
  if (!children.length) return;
  const newMaterials = Array.isArray(parentJob.materials) ? parentJob.materials : [];
  for (const child of children) {
    const oldMat = oldMaterials.find(m => m && m.typeId === child.productTypeId);
    const newMat = newMaterials.find(m => m && m.typeId === child.productTypeId);
    if (!oldMat || !newMat || !(oldMat.qtyNeeded > 0) || !(newMat.qtyNeeded > 0)) continue; // nothing to scale from/to
    if (Math.abs(newMat.qtyNeeded - oldMat.qtyNeeded) < 1e-6) continue; // parent's need for this material didn't actually move
    const scale = newMat.qtyNeeded / oldMat.qtyNeeded;
    const targetQty = (child.qtyNeeded || 0) * scale;
    const recipe = window.recipeMap ? window.recipeMap[child.typeId] : null;
    const batchYield = typeof window.getBatchYield === 'function' ? window.getBatchYield(recipe, false) : 1;
    const childRuns = Math.max(1, Math.ceil(targetQty / (batchYield || 1)));
    if (childRuns === child.runsNeeded) continue; // rounds out to the same run count either way
    const oldChildMaterials = Array.isArray(child.materials) ? child.materials : [];
    try {
      const childSnapshot = child.productionSnapshot || parentJob.productionSnapshot || getCurrentLiveProductionSnapshot();
      const childBuildConfig = child.buildConfigSnapshot || parentJob.buildConfigSnapshot;
      const result = await rebuildTreeForSnapshot(child.typeId, child.name + ' Blueprint', childRuns, child.productTypeId, childSnapshot, childBuildConfig);
      child.runsNeeded = childRuns;
      child.qtyNeeded = result.root.qtyNeeded;
      child.calculatedCost = result.calculatedCost;
      child.materials = result.materials;
      child.totalBuildSeconds = result.totalBuildSeconds;
      await cascadeRunChangeToChildren(child, oldChildMaterials); // propagate further, if this child has prereqs of its own
    } catch (e) {
      console.warn('[Ledger] cascadeRunChangeToChildren failed for child job', child.id, e);
    }
  }
}

// Spins a buildable material off a job's own material list into its own queued prerequisite job,
// linked exactly the way a Calculator-side sub-build already is (isSubBuild/parentJobName) - so it
// gets picked up by internallySuppliedPool in renderJournalPage() for free, no new suppression logic
// needed for the parent's material row to stop double-counting it.
async function addMaterialAsPrerequisiteJob(jobId, typeId, missingQty) {
  const parentJob = activeJobs.find(j => j && j.id === jobId);
  if (!parentJob) return;
  const mat = Array.isArray(parentJob.materials) ? parentJob.materials.find(m => m && m.typeId === typeId) : null;
  if (!mat) return;
  if (activeJobs.some(j => j && j.productTypeId === typeId)) {
    if (typeof window.showToast === 'function') window.showToast(`"${window.esc(mat.name)}" is already queued as its own job.`, 'info');
    return;
  }
  // Build for what's actually MISSING after stock (passed in by the caller, which already knows the
  // stock-adjusted deficit), not the material's full requirement - falls back to the full amount only
  // if no deficit was given (e.g. called directly, outside the normal "+ Build" button flow).
  const targetQty = (missingQty !== undefined && missingQty !== null) ? Number(missingQty) : mat.qtyNeeded;
  if (targetQty <= 0) return;
  const blueprintTypeId = (typeof window.findBlueprintTypeIdForProduct === 'function' ? window.findBlueprintTypeIdForProduct(typeId) : null)
    || (typeof window.resolveBlueprintIdFromProductName === 'function' ? window.resolveBlueprintIdFromProductName(mat.name) : null);
  if (!blueprintTypeId) {
    if (typeof window.showToast === 'function') window.showToast(`No known blueprint for "${window.esc(mat.name)}" - it may be a raw material.`, 'error');
    return;
  }

  const recipe = window.recipeMap ? window.recipeMap[blueprintTypeId] : null;
  const batchYield = typeof window.getBatchYield === 'function' ? window.getBatchYield(recipe, false) : 1;
  const runs = Math.max(1, Math.ceil(targetQty / (batchYield || 1)));
  // Build using the PARENT job's own preset (falling back to whatever's currently live if the
  // parent predates preset tracking), so a prerequisite spun off from a job stays consistent with
  // it instead of silently picking up whatever the Calculator happens to be set to right now.
  const snapshot = parentJob.productionSnapshot || getCurrentLiveProductionSnapshot();
  // Same reasoning as the preset - inherit the parent's build/buy choices (which of ITS OWN sub-
  // components were toggled to build vs. buy, any buy-order/ME/TE overrides) rather than whatever's
  // live on this page (nothing, on a fresh Ledger load), and carry it forward on the new job so ITS
  // own future recomputes stay consistent too.
  const buildConfig = parentJob.buildConfigSnapshot;

  try {
    const result = await rebuildTreeForSnapshot(blueprintTypeId, mat.name + ' Blueprint', runs, typeId, snapshot, buildConfig);
    const newJob = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      typeId: blueprintTypeId,
      productTypeId: typeId,
      name: result.root.productName || mat.name,
      runsNeeded: runs,
      qtyNeeded: result.root.qtyNeeded,
      calculatedCost: result.calculatedCost,
      totalBuildSeconds: result.totalBuildSeconds,
      materials: result.materials,
      isSubBuild: true,
      parentJobId: jobId,
      parentJobName: parentJob.name, // display-only (the "⚙ Prereq for: X" label) - parentJobId is the real link
      productionSnapshot: snapshot,
      buildConfigSnapshot: buildConfig,
      // Same ownership as the parent - a prerequisite spun off from a personal job is personal too,
      // one spun off from a corp job is corp-shared too, same as the buildConfigSnapshot inheritance
      // just above.
      scope: parentJob.scope,
      ownerCharId: parentJob.ownerCharId,
      corpId: parentJob.corpId,
      addedAt: new Date().toISOString()
    };
    const parentIndex = activeJobs.findIndex(j => j && j.id === jobId);
    if (parentIndex === -1) activeJobs.push(newJob); else activeJobs.splice(parentIndex, 0, newJob);
    localStorage.setItem('eve_ledger_jobs', JSON.stringify(activeJobs));
    renderJournalPage();
    if (typeof window.showToast === 'function') window.showToast(`Added "${window.esc(newJob.name)}" (${runs} run${runs > 1 ? 's' : ''}) as a prerequisite for "${window.esc(parentJob.name)}".`, 'success');
  } catch (e) {
    console.warn('[Ledger] addMaterialAsPrerequisiteJob failed:', e);
    if (typeof window.showToast === 'function') window.showToast('Failed to queue this material as a job.', 'error');
  }
}
window.addMaterialAsPrerequisiteJob = addMaterialAsPrerequisiteJob;

// Computes AND deducts one job's material needs against the shared stock pool, decoupled from any
// HTML generation - this must run exactly once per job, in display order, for EVERY job regardless of
// whether its card happens to be visually expanded. It used to live entirely inside
// renderJobBOMBlockHTML below, which renderJobCardHTML/renderJobListRowHTML only ever called for an
// EXPANDED card - meaning a COLLAPSED job (the default state for every card, started or pending, until
// you personally click to expand it) silently never touched allocatedStock at all. Its real material
// consumption was invisible to every job rendered after it, so later jobs saw the full undiminished
// stock as if nothing had claimed it. Reported directly as "extremely bad": 5 already-started 10-run
// jobs of the same item (very plausibly sitting collapsed, since there's nothing to do with a job
// that's already running) never subtracted their 50 units from the shared pool, so a later job's own
// material line showed 60 in stock instead of the real 10 - exactly this bug, not an ESI-freshness
// issue. Returns one entry per material ({mat, consumedQty, netMissing, isAcquired}) so
// renderJobBOMBlockHTML can render from these already-computed numbers instead of re-deriving (and
// re-deducting) them a second time when the card IS expanded.
// deductFromPool (default true) - set false when a NEWER asset-cache generation has been confirmed
// since this job started (see job.assetsExpiryAtStart's own stamping comment) - meaning the current
// allocatedStock figure is real, fresh ESI data that ALREADY excludes this job's consumption.
// Subtracting it again on top of an already-correct number would silently understate real stock for
// every job rendered after it - the opposite of this function's whole purpose. The job's own per-
// material numbers below are still computed and returned either way (so its own card still shows
// something sensible), just without mutating the shared pool when skipped. A version of this freshness
// check briefly lived entirely in each tab's own private memory (window.esiAssetsExpiry) instead of
// shared storage - two tabs could independently reach a DIFFERENT answer to "has fresh data arrived
// yet?" for the exact same job, so they'd silently disagree outright. getEsiAssetsExpiry() (js/esi.js)
// now reads a value shared via localStorage instead, so every tab agrees.
function applyJobMaterialsToStock(job, allocatedStock, isStockDeductEnabled, deductFromPool = true) {
  return (Array.isArray(job.materials) ? job.materials : []).map(mat => {
    if (!mat) return null;
    const availableInStock = isStockDeductEnabled ? (allocatedStock[mat.typeId] || 0) : 0;
    const consumedQty = Math.min(mat.qtyNeeded, availableInStock);
    if (deductFromPool && isStockDeductEnabled && allocatedStock[mat.typeId] !== undefined) {
      allocatedStock[mat.typeId] = Math.max(0, allocatedStock[mat.typeId] - consumedQty);
    }
    const netMissing = Math.max(0, mat.qtyNeeded - consumedQty);
    return { mat, consumedQty, netMissing, isAcquired: netMissing === 0 };
  }).filter(Boolean);
}

// Shared by renderJournalPage's own allocation pass and copyIndividualJobMultibuy, so the two can never
// diverge on the decision itself even if they diverge on which jobs they're looking at. Read fresh
// every call (never cached) so a "Refresh Assets" click in ANOTHER tab is picked up on this tab's very
// next render.
function isJobConsumptionAlreadyReflectedByFreshAssets(job) {
  const currentExpiry = window.getEsiAssetsExpiry ? window.getEsiAssetsExpiry() : null;
  if (currentExpiry === null) return false;
  // A job stamped with a known assetsExpiryAtStart (every isStarted:true call site does this) compares
  // against that exact value - proof a NEW cache generation appeared since the job started (Expires
  // only advances when CCP's cache genuinely turns over, never otherwise, see getEsiAssetsExpiry's own
  // comment). A job with NO stamp at all predates this tracking entirely (started before this feature
  // shipped this session, or before any asset fetch had ever happened) - falls back to the job's own
  // real startedAt time instead of refusing forever. Reported directly: several real jobs that started
  // before this feature existed were having their materials permanently double-subtracted on top of
  // stock data that had long since caught up, with no way for them to ever stop - the tool has to age
  // out of "just started, can't confirm yet" the same way a stamped job does, using the only real
  // timestamp it has. Slightly less airtight than the stamped comparison (if the CURRENT cache
  // generation happened to already be active when the job started, this can trust it a little early -
  // bounded by one ESI cache window, "on the order of an hour") but permanently refusing to trust fresh
  // data for any job older than this feature is strictly worse.
  const baseline = (job.assetsExpiryAtStart !== undefined && job.assetsExpiryAtStart !== null)
    ? job.assetsExpiryAtStart
    : job.startedAt;
  return baseline !== undefined && baseline !== null && currentExpiry > baseline;
}

function renderJobBOMBlockHTML(job, materialStockInfo, isFocusMode) {
    // Focus mode trades the compact per-card list (small text, no icons, clipped to a few rows -
    // right for a grid full of cards) for a much roomier one (item icons, larger text, no clip) -
    // it's the whole reason Focus mode exists, so this is the one place that distinction matters.
    const rowTextClass = isFocusMode ? 'text-sm' : 'text-xs';
    const rowPadClass = isFocusMode ? 'py-2' : 'py-1';
    const buildBtnStyle = isFocusMode ? '' : 'font-size:9px; padding:2px 6px;';
    const queuedTextClass = isFocusMode ? 'text-xs' : 'text-[9px]';

    const individualBOMHTML = materialStockInfo.length ? materialStockInfo.map(({ mat, netMissing, isAcquired }) => {

      // "+ Build" lets a buildable material become its own prerequisite job in one click - resolved
      // the same way buildRecursiveRecipeTree resolves it for its own children, so "buildable" here
      // means exactly what it means everywhere else in the app. Sized for netMissing (what's actually
      // short after stock), not mat.qtyNeeded (the material's full requirement) - otherwise stock you
      // already hold gets built again on top of what you have instead of just topping up the deficit.
      // Only offered while there IS a deficit - nothing to build once stock already covers it.
      let buildActionHTML = '';
      const queuedForMat = isAcquired ? null : activeJobs.find(j => j && j.productTypeId === mat.typeId);
      if (isAcquired) {
        buildActionHTML = '';
      } else if (queuedForMat) {
        // A queued-but-not-started prerequisite reads "Queued" (accent green, matching the checkmark
        // - it exists, nothing left to do); once you actually start it in-game and mark it started
        // here, it's no longer just sitting in the queue - same blue used for an in-progress job's
        // own row elsewhere in the Ledger, so this badge tracks that job's real state instead of
        // freezing at "Queued" the moment it's added. Text-only, no icon - the icon this used to pair
        // with (renderJobStatusIconHTML) isn't tagged svg.ico, so it missed the inline-block fix every
        // OTHER icon in this app gets and rendered on its own line above the text instead of beside it.
        buildActionHTML = queuedForMat.isStarted
          ? `<span class="${queuedTextClass} font-bold flex-shrink-0" style="color:var(--blue-300);" title="A queued job for this is currently in progress">In Progress</span>`
          : `<span class="${queuedTextClass} font-bold flex-shrink-0" style="color:var(--accent);" title="Already queued as its own job">${window.svgIcon('check')} Queued</span>`;
      } else {
        const bpId = (typeof window.findBlueprintTypeIdForProduct === 'function' ? window.findBlueprintTypeIdForProduct(mat.typeId) : null)
          || (typeof window.resolveBlueprintIdFromProductName === 'function' ? window.resolveBlueprintIdFromProductName(mat.name) : null);
        if (bpId) {
          buildActionHTML = `<button onclick="event.stopPropagation(); addMaterialAsPrerequisiteJob(${job.id}, ${mat.typeId}, ${netMissing})" class="lp-chip-btn flex-shrink-0" style="${buildBtnStyle}" title="Queue a job for just the ${netMissing.toLocaleString()} missing, not the full ${mat.qtyNeeded.toLocaleString()} needed">+ Build</button>`;
        }
      }

      const iconHTML = isFocusMode
        ? `<img src="${window.getItemIconUrl(mat.typeId, mat.name, 32)}" alt="${window.esc(mat.name)}" class="w-6 h-6 rounded flex-shrink-0" loading="lazy" onerror="this.style.visibility='hidden';">`
        : '';

      return `
        <div class="lp-mat-row flex justify-between items-center ${rowTextClass} mono ${rowPadClass} gap-2 px-1.5 rounded" style="color:${isAcquired ? 'var(--accent)' : 'var(--text-mute)'};">
          ${iconHTML}
          <span class="truncate pr-2 flex-1 min-w-0"><span class="copy-name" data-copy-name="${window.esc(mat.name)}" onclick="copyNameToClipboard(event)" title="Click to copy: ${window.esc(mat.name)}">${window.esc(mat.name)}</span></span>
          <span class="flex-shrink-0 whitespace-nowrap">${isAcquired ? `${window.svgIcon('check')} ${mat.qtyNeeded.toLocaleString()}` : `x${mat.qtyNeeded.toLocaleString()} (Deficit: ${netMissing.toLocaleString()})`}</span>
          <!-- Always reserved at a fixed width, even when empty (isAcquired never sets buildActionHTML)
               - otherwise the qty span just above drifts left/right row to row depending on whether
               THIS particular row happens to show a "+ Build" button, a "Queued"/"In Progress" badge,
               or nothing, since justify-between redistributes space across however many children a row
               actually has. Right-aligned within the slot to match where a bare qty (no badge) already
               sits flush to the row's own right edge. -->
          <span class="flex-shrink-0 text-right" style="width:78px;">${buildActionHTML}</span>
        </div>
      `;
    }).join('') : '<div class="text-xs italic py-1" style="color:var(--text-mute);">No materials logged for this build.</div>';

    let buildTimeUI = '';
    let totalBuildSeconds = job.totalBuildSeconds;
    // Not stored on the job object itself, so inferred the same way app.js's own isReaction flag
    // is first derived - a real recipe genuinely can't have both a mfgMaterials and a
    // reactionMaterials list, so this is exact, not a guess. Used below both for the legacy
    // fallback calc and for the hover tooltip, which otherwise always named Industry/Advanced
    // Industry even on a reaction job (those skills don't affect reactions at all - see
    // REACTIONS_SKILL_ID in config.js; the Reactions skill does, at 4%/level).
    const jobRecipe = window.recipeMap && window.recipeMap[job.productTypeId];
    const jobIsReaction = !!(jobRecipe && jobRecipe.reactionMaterials && jobRecipe.reactionMaterials.length > 0);
    const skills = window.safeParseJSON(localStorage.getItem('eve_char_skills'), { industry: 5, advIndustry: 5, allSkills: { [window.REACTIONS_SKILL_ID || 45746]: 5 } });
    const reactionsLevel = (skills.allSkills && skills.allSkills[window.REACTIONS_SKILL_ID || 45746]) || 0;

    if (totalBuildSeconds === undefined) {
      // Legacy jobs added before totalBuildSeconds existed: fall back to the root job's own time only,
      // adjusted for skills/facility/rig but not TE (TE per sub-component isn't recoverable without the
      // full tree, which isn't available on this page).
      const baseTime = job.baseTime || 0;
      if (baseTime > 0) {
        const skillTimeFactor = jobIsReaction
          ? (1 - (0.04 * reactionsLevel))
          : (1 - (0.04 * (skills.industry || 0))) * (1 - (0.03 * (skills.advIndustry || 0)));
        const structureType = window.getActiveStructureType ? window.getActiveStructureType() : { teBonus: 30.0 };
        const facilityFactor = 1 - (structureType.teBonus / 100);
        const rigTEBonus = window.getEffectiveRigBonusForTypeId ? window.getEffectiveRigBonusForTypeId(job.productTypeId, 'TE') : 0;
        const rigFactor = 1 - (rigTEBonus / 100);
        const implantFactor = 1 - ((window.getManufacturingImplantBonusPercent ? window.getManufacturingImplantBonusPercent() : 0) / 100);
        totalBuildSeconds = baseTime * skillTimeFactor * facilityFactor * rigFactor * implantFactor * (job.runsNeeded || 1);
      } else {
        totalBuildSeconds = 0;
      }
    }
    const structureType = window.getActiveStructureType ? window.getActiveStructureType() : { shortLabel: 'Sotiyo' };
    const structureName = structureType.shortLabel;
    const rigTEBonusDisplay = window.getEffectiveRigBonusForTypeId ? window.getEffectiveRigBonusForTypeId(job.productTypeId, 'TE') : 0;

    if (totalBuildSeconds > 0) {
      const skillLabel = jobIsReaction ? `Reactions: ${reactionsLevel}/5` : `Industry: ${skills.industry}/5 | Advanced Industry: ${skills.advIndustry}/5`;
      const hoverTitle = `Total time to build this item and every sub-component you're manufacturing yourself.\n${skillLabel} | Facility: ${structureName}${rigTEBonusDisplay > 0 ? ` | Rig: -${rigTEBonusDisplay.toFixed(2)}% TE` : ''}`;

      const effJobProfit = getEffectiveJobProfit(job);
      const iskPerHour = effJobProfit !== undefined ? (effJobProfit / (totalBuildSeconds / 3600)) : null;
      const iskPerHourUI = iskPerHour !== null
        ? `<div class="flex justify-between text-xs mono" title="${Math.round(iskPerHour).toLocaleString()} ISK/hour"><span style="color:var(--text-mute);">Est. ISK/Hour:</span><span class="font-bold" style="color:${iskPerHour >= 0 ? 'var(--green)' : 'var(--red)'};">${window.formatISKCompact(iskPerHour)}</span></div>`
        : '';

      buildTimeUI = `
        <div class="flex justify-between text-xs mono cursor-help" style="color:var(--text-mute);" title="${window.esc(hoverTitle)}">
          <span>Est. Build Time:</span>
          <span class="font-semibold" style="color:var(--text-soft);">${window.formatDuration(totalBuildSeconds)}</span>
        </div>
        ${iskPerHourUI}
      `;
    } else {
      // Be honest that no time data was found, rather than silently omitting the line entirely -
      // a permanently missing line with no data looks identical to a rendering bug.
      buildTimeUI = `
        <div class="flex justify-between text-xs mono cursor-help" style="color:var(--text-mute);" title="No manufacturing time data was found for this job's blueprint at the time it was added.">
          <span>Est. Build Time:</span>
          <span class="italic" style="color:var(--text-mute);">No Time Data</span>
        </div>
      `;
    }

    const headerTextClass = isFocusMode ? 'text-sm' : 'text-xs';
    const statsTextClass = isFocusMode ? 'text-sm' : 'text-xs';
    return `
      <div class="lp-inset">
        ${renderJobPresetRowHTML(job)}
        <div class="flex justify-between items-center mb-1.5 pb-1.5" style="border-bottom:1px solid rgba(255,255,255,0.06);">
          <span class="${headerTextClass} font-bold uppercase tracking-wider rajdhani" style="color:var(--accent);">Job Materials (BOM)</span>
          <button onclick="copyIndividualJobMultibuy(event, ${job.id})" class="lp-chip-btn" style="font-size:10px; padding:3px 8px;">
            ${window.svgIcon('clipboard')} Copy BOM
          </button>
        </div>
        <div class="${isFocusMode ? '' : 'max-h-48 overflow-y-auto'} scrollbar-thin">
          ${individualBOMHTML}
        </div>
        <div class="flex flex-col ${statsTextClass} mono font-bold pt-1.5 mt-1 space-y-1" style="border-top:1px solid rgba(255,255,255,0.06);">
          ${buildTimeUI}
          <div class="flex justify-between items-center mt-0.5" title="${Math.round(job.calculatedCost).toLocaleString()} ISK">
            <span style="color:var(--text-soft);">Total Build Cost:</span>
            <span style="color:var(--cost);">${window.formatISKCompact(job.calculatedCost)}</span>
          </div>
          ${(() => { const p = getEffectiveJobProfit(job); return p !== undefined ? `
            <div class="flex justify-between items-center" title="${Math.round(p).toLocaleString()} ISK">
              <span style="color:var(--text-soft);">Total Profit:</span>
              <span style="color:${p >= 0 ? 'var(--green)' : 'var(--red)'};">${window.formatISKCompact(p)}</span>
            </div>
          ` : ''; })()}
        </div>
      </div>
    `;
}

function renderJobCardHTML(job, materialStockInfoByJobId, isFocusMode, jobShortfallByProductTypeId) {
    const iconTypeId = job.productTypeId || job.typeId;
    const isJobReady = job.isStarted && job.startedAt && ((Date.now() - job.startedAt) / 1000 >= (job.totalBuildSeconds || 0));
    const isCollapsed = !expandedJobCardIds.has(job.id);
    // Looked up, not computed - already deducted once, for every job, up front in renderJournalPage
    // (see applyJobMaterialsToStock's own comment for why that must happen regardless of any collapse/
    // filter state down here).
    const materialStockInfo = materialStockInfoByJobId.get(job.id) || [];

    // A prerequisite job's own run count is a one-time decision made when it was queued (or last
    // hand-edited) - it never revisits itself if what its parent(s) need, or your stock, changes
    // afterward (see computeQtyStillNeededAfterInternalSupply's own comment on why that's deliberate,
    // not an oversight). This surfaces the gap right on the job that can close it, instead of leaving
    // it as something only visible in the BOM sidebar - reported directly as wanting exactly this.
    const topUpRunsNeeded = (() => {
      if (!job.isSubBuild || job.isStarted || job.autoImported || job.productTypeId === undefined) return 0;
      const missingQty = (jobShortfallByProductTypeId && jobShortfallByProductTypeId[job.productTypeId]) || 0;
      if (missingQty <= 0) return 0;
      const recipe = window.recipeMap ? window.recipeMap[job.typeId] : null;
      const batchYield = (typeof window.getBatchYield === 'function' ? window.getBatchYield(recipe, false) : 1) || 1;
      return Math.ceil(missingQty / batchYield);
    })();

    // Isolation only makes sense for a real root job that still has materials to shop for - a sub-
    // build is pulled in automatically whenever its parent is isolated (see renderJournalPage), and
    // a started job's materials are already committed either way.
    // Same labeled pill-check as the list-row version (see renderJobListRowHTML) instead of a bare
    // unlabeled checkbox - this container already has its own stopPropagation, so the label doesn't
    // need its own like the list-row version does.
    const isolationCheckboxHTML = (!job.isStarted && !job.isSubBuild) ? `
      <label class="pill-check flex-shrink-0" title="Shop: show only this job's (and its prerequisites') materials in the Consolidated BOM sidebar">
        <input type="checkbox" ${isolatedJobIds.has(job.id) ? 'checked' : ''} onchange="toggleJobIsolation(${job.id})">
        <span class="pill-check-face">${window.svgIcon('cart')} Shop</span>
      </label>
    ` : '';

    const dragHandleHTML = `
      <div class="flex items-center gap-1 flex-shrink-0" onclick="event.stopPropagation()">
        ${isolationCheckboxHTML}
        ${renderFocusButtonHTML(job)}
        <button onclick="toggleJobCardCollapse(${job.id})" class="px-1 text-xs select-none" style="color:var(--text-mute);" title="${isCollapsed ? 'Show full details' : 'Hide Bill of Materials'}">
          ${window.svgIcon(isCollapsed ? 'chevron-right' : 'chevron-down')}
        </button>
        <span class="drag-handle cursor-grab active:cursor-grabbing px-1.5 py-0.5 text-sm select-none" style="color:var(--text-mute);" title="Drag to reorder (changes stock allocation priority)">
          ${window.svgIcon('grip')}
        </span>
      </div>
    `;

    // CORRECTION: Direct blueprint path safety check inside active jobs loop prevents any imageservers 400 errors [1.1.1, 1.1.4]
    const jobIconUrl = window.getItemIconUrl(iconTypeId, window.TYPE_ID_TO_NAME[iconTypeId] || job.name, 64);
    // The job may have been saved with the raw searched name (e.g. "Vargur Blueprint") - always show
    // the manufactured product's name on the card instead.
    const jobDisplayName = window.TYPE_ID_TO_NAME[iconTypeId] || (job.name || '')
      .replace(/ Blueprint$/i, '').replace(/ Reaction Formula$/i, '').replace(/ Formula$/i, '').trim();

    // Status banner - kept prominent, right under the header, instead of buried below the BOM, since
    // job status is one of the most important things to see at a glance.
    let statusBannerHTML = '';
    if (job.isStarted && job.startedAt) {
      const elapsedSeconds = (Date.now() - job.startedAt) / 1000;
      const remaining = (job.totalBuildSeconds || 0) - elapsedSeconds;
      const ready = remaining <= 0;
      const text = ready ? 'Ready to Collect!' : `${window.formatDuration(Math.ceil(remaining))} remaining`;
      statusBannerHTML = `
        <div class="job-timer lp-status-row ${ready ? 'is-ready' : ''}" data-job-id="${job.id}" data-job-name="${window.esc(job.name)}" data-started-at="${job.startedAt}" data-total-seconds="${job.totalBuildSeconds || 0}">
          <span class="text-xs font-bold uppercase tracking-wide flex-shrink-0" style="color:var(--text-soft);">Status:</span>
          <span class="flex items-center gap-1.5">
            <span id="status-icon-${job.id}" class="flex-shrink-0" style="width:14px; color:${ready ? 'var(--accent)' : 'var(--blue-300)'};">${renderJobStatusIconHTML(ready ? 'ready' : 'remaining')}</span>
            <span class="timer-display text-sm font-extrabold mono" style="color:${ready ? 'var(--accent)' : 'var(--blue-300)'};">${text}</span>
          </span>
        </div>
      `;
    } else {
      // "Pending" is dropped - it's the only status a not-yet-started job can have, so the word said
      // nothing the hourglass icon didn't already. formatDurationCompact (not formatDuration) keeps a
      // long estimate from ballooning into "11d 16h 49m 38s" for what's just an estimate anyway.
      const pendingText = job.totalBuildSeconds > 0 ? window.formatDurationCompact(job.totalBuildSeconds) : 'No time data';
      statusBannerHTML = `
        <div class="lp-status-row">
          <span class="text-xs font-bold uppercase tracking-wide flex-shrink-0" style="color:var(--text-soft);">Status:</span>
          <span class="flex items-center gap-1.5">
            <span id="status-icon-${job.id}" class="flex-shrink-0" style="width:14px; color:var(--text-mute);">${renderJobStatusIconHTML('pending')}</span>
            <span class="text-sm font-extrabold mono" style="color:var(--text-mute);">${pendingText}</span>
          </span>
        </div>
      `;
    }

    const startJobRowHTML = (!job.isStarted) ? `
      <div class="lp-inset flex items-center gap-1.5" onclick="event.stopPropagation()">
        <span class="text-xs font-bold flex-shrink-0" style="color:var(--text-mute);" title="Starting fewer than all runs splits this into a started job plus a still-queued job for the rest, matching how EVE actually queues manufacturing jobs.">Runs to start:</span>
        <input type="number" id="start-runs-${job.id}" value="${job.runsNeeded}" min="1" max="${job.runsNeeded}"
          onmousedown="event.stopPropagation()" onfocus="this.select()"
          class="field-line w-16 text-center font-bold p-1 text-sm" style="color:var(--accent);">
        <button onclick="startJobRuns(${job.id})" class="lp-chip-btn ml-auto flex-shrink-0">${window.svgIcon('play')} Start Job</button>
      </div>
    ` : '';

    const cardStateClass = (job.isSubBuild ? 'job-subbuild' : (isJobReady ? 'job-ready' : (job.isStarted ? 'job-started' : ''))) + (isolatedJobIds.has(job.id) ? ' job-isolated' : '');

    return `
      <div class="job-card lp-job-card ${cardStateClass} p-3 flex flex-col justify-between transition space-y-2"
           draggable="true" data-job-id="${job.id}" ${(job.isSubBuild && !isFocusMode) ? `title="Prerequisite for: ${window.esc(getPrereqLabel(job))}"` : ''}
           ondragstart="handleJobDragStart(event, ${job.id})" ondragend="handleJobDragEnd(event)"
           ondragover="handleJobDragOver(event)" ondragleave="handleJobDragLeave(event)" ondrop="handleJobDrop(event, ${job.id})">
        <div class="flex items-start justify-between">
          <div class="flex items-start space-x-3 min-w-0 flex-1">
            <img src="${jobIconUrl}" alt="${window.esc(jobDisplayName)}" class="${isFocusMode ? 'w-20 h-20' : 'w-12 h-12'} rounded-md flex-shrink-0" loading="lazy" onerror="this.onerror=null; this.src='https://images.evetech.net/types/${iconTypeId}/render?size=64';">
            <div class="min-w-0 flex-1">
              <h3 class="font-bold ${isFocusMode ? 'text-2xl' : 'text-base'} truncate" style="color:var(--text);"><span class="copy-name" data-copy-name="${window.esc(jobDisplayName)}" onclick="copyNameToClipboard(event)" title="Click to copy: ${window.esc(jobDisplayName)}">${window.esc(jobDisplayName)}</span>${!isFocusMode ? renderPrereqBadgeHTML(job, 'ml-1 text-xs align-middle') : ''}</h3>
              ${(job.isSubBuild && isFocusMode) ? `<div class="text-xs mono font-bold uppercase tracking-wide mt-0.5" style="color:var(--text-mute);" title="This is a sub-assembly required by another queued job - build it first.">${window.svgIcon('gear')} Prerequisite for: ${window.esc(getPrereqLabel(job))}</div>` : ''}
              <div class="flex items-center gap-1.5 flex-wrap">
                ${renderJobMetaChipHTML(job)}
                ${renderJobOwnershipPillHTML(job)}
              </div>
            </div>
          </div>
          ${dragHandleHTML}
        </div>

        ${statusBannerHTML}

        <div class="flex items-center justify-between px-1" onclick="event.stopPropagation()">
          ${editingRunsJobIds.has(job.id) ? `
            <span class="flex items-baseline gap-1.5">
              <span class="text-xs mono" style="color:var(--text-mute);">Jobs</span>
              <input type="number" id="jobs-edit-input-${job.id}" min="1" value="${job.jobCount || 1}" onkeydown="if(event.key==='Enter'){this.blur();}else if(event.key==='Escape'){toggleRunsEditMode(event, ${job.id});}" onblur="handleJobsRunsBlur(${job.id})" class="field-line text-xl font-extrabold mono text-center num-no-spin" style="width:${Math.max(3, String(job.jobCount || 1).length + 2)}ch; color:var(--accent);" title="How many separate real jobs - each one rounds its own materials up independently, same as several physical BPC copies would in EVE">
              <span class="text-sm mono" style="color:var(--text-mute);">×</span>
              <input type="number" id="runs-edit-input-${job.id}" min="1" value="${job.runsPerJob || job.runsNeeded}" onkeydown="if(event.key==='Enter'){this.blur();}else if(event.key==='Escape'){toggleRunsEditMode(event, ${job.id});}" onblur="handleJobsRunsBlur(${job.id})" class="field-line text-xl font-extrabold mono text-center num-no-spin" style="width:${Math.max(3, String(job.runsPerJob || job.runsNeeded).length + 2)}ch; color:var(--accent);" title="Runs per job - recalculates materials, cost, and time on commit">
              <span class="text-sm mono" style="color:var(--text-mute);">Run${(job.runsPerJob || job.runsNeeded) > 1 ? 's' : ''}</span>
              ${renderRunsEditIconHTML(job.id, true)}
            </span>
          ` : `
            <span class="flex items-baseline gap-1.5">
              <span
                class="text-xl font-extrabold mono cursor-pointer transition"
                style="color:var(--accent);"
                onclick="copyRunsToClipboard(event, ${job.runsNeeded})"
                title="Click to copy the run count to clipboard">
                ${runsDisplayHTML(job)}
              </span>
              ${(!job.isStarted && !job.autoImported) ? renderRunsEditIconHTML(job.id, false) : ''}
              ${topUpRunsNeeded > 0 ? `
                <button onclick="event.stopPropagation(); topUpPrerequisiteJob(${job.id})" class="lp-chip-btn flex-shrink-0" style="color:var(--red-400, #f87171); border-color:rgba(248,113,113,0.35);" title="What's built here is short ${topUpRunsNeeded > 1 ? topUpRunsNeeded + ' runs' : '1 run'} of what your queue actually needs - click to add exactly that many">+${topUpRunsNeeded}</button>
              ` : ''}
            </span>
          `}
          <span class="text-sm mono" style="color:var(--text-mute);">${job.qtyNeeded.toLocaleString()} units total</span>
        </div>

        ${!isCollapsed ? renderJobBOMBlockHTML(job, materialStockInfo, isFocusMode) : `
          <div class="lp-inset text-xs italic text-center" style="color:var(--text-mute);">
            Details minimized - click the chevron above to expand
          </div>
        `}

        ${startJobRowHTML}

        <div class="flex items-center gap-2 pt-1">
          <button onclick="markJobAsBuilt(${job.id})" class="lp-badge lp-badge-accent py-1.5 px-3 text-sm flex items-center justify-center gap-1" style="cursor:pointer;">
            ${window.svgIcon('check')} Built
          </button>
          <button onclick="deleteJobFromQueue(${job.id})" class="lp-badge lp-badge-danger py-1.5 px-3 text-sm flex items-center justify-center gap-1" style="cursor:pointer;">
            ${window.svgIcon('x')} Delete
          </button>
        </div>
      </div>
    `;
}

// --- Search / status filter controls ---
function filterJobsBySearch(query) {
  activeJobSearchQuery = query;
  renderJournalPage();
}
window.filterJobsBySearch = filterJobsBySearch;

function setJobStatusFilter(status) {
  activeJobStatusFilter = status;
  ['all', 'started', 'pending'].forEach(s => {
    const btn = document.getElementById(`btn-status-${s}`);
    if (btn) btn.className = `lp-pill${s === status ? ' active' : ''}`;
  });
  renderJournalPage();
}
window.setJobStatusFilter = setJobStatusFilter;

// Personal/Corp job-ownership pill toggles - reuses the same .pill-check pattern already on this
// page for the stock/location filter (#use-char-assets/#use-corp-assets).
// Same "hide the dropdown entirely if there's nothing to filter by" pattern populateStationFilter
// Dropdown already uses - a single registered character (or none) has nothing meaningful to narrow
// to, so the control disappears rather than showing an empty/useless "All Characters" dropdown. Lists
// every REGISTERED character (js/esi.js), not just the ones with jobs, since narrowing to a character
// with zero jobs right now is still a meaningful thing to check.
function populateCharacterFilterDropdown() {
  const select = document.getElementById('character-filter-select');
  if (!select) return;
  const store = window.loadCharacterStore ? window.loadCharacterStore() : {};
  const chars = Object.values(store).sort((a, b) => (a.charName || '').localeCompare(b.charName || ''));
  if (chars.length < 2) {
    select.closest('[data-character-filter-wrap]')?.classList.add('hidden');
    return;
  }
  select.closest('[data-character-filter-wrap]')?.classList.remove('hidden');
  // A removed character falls back to "all" instead of silently filtering to a now-meaningless id.
  if (activeCharacterFilter !== 'all' && !chars.some(c => c.charId === activeCharacterFilter)) activeCharacterFilter = 'all';
  select.innerHTML = `<option value="all">All Characters</option>` +
    chars.map(c => `<option value="${window.esc(c.charId)}" ${c.charId === activeCharacterFilter ? 'selected' : ''}>${window.esc(c.charName)}</option>`).join('');
}

function setCharacterFilter(value) {
  activeCharacterFilter = value || 'all';
  renderJournalPage();
}
window.setCharacterFilter = setCharacterFilter;

// Personal/Corp pill toggles - reuses the same .pill-check pattern already on this page for the
// stock/location filter's own Personal/Corp toggle (#use-char-assets/#use-corp-assets).
function setJobOwnershipFilter() {
  const personalBox = document.getElementById('show-personal-jobs');
  const corpBox = document.getElementById('show-corp-jobs');
  activeShowPersonalJobs = personalBox ? personalBox.checked : true;
  activeShowCorpJobs = corpBox ? corpBox.checked : true;
  renderJournalPage();
}
window.setJobOwnershipFilter = setJobOwnershipFilter;

// Switching the active character, or adding/removing one, changes what the character filter dropdown
// itself should even list - re-render whenever it fires rather than requiring a manual refresh/reload.
window.addEventListener('eve:active-character-changed', () => {
  if (typeof renderJournalPage === 'function') renderJournalPage();
});

// --- Minimize/maximize card details ---
function toggleJobCardCollapse(jobId) {
  if (expandedJobCardIds.has(jobId)) expandedJobCardIds.delete(jobId);
  else expandedJobCardIds.add(jobId);
  saveExpandedJobCardIds();
  renderJournalPage();
}
window.toggleJobCardCollapse = toggleJobCardCollapse;

function collapseAllJobCards() {
  expandedJobCardIds.clear();
  saveExpandedJobCardIds();
  renderJournalPage();
}
window.collapseAllJobCards = collapseAllJobCards;

function expandAllJobCards() {
  activeJobs.forEach(j => { if (j) expandedJobCardIds.add(j.id); });
  saveExpandedJobCardIds();
  renderJournalPage();
}
window.expandAllJobCards = expandAllJobCards;

// --- Click-to-copy runs count ---
function copyRunsToClipboard(e, runs) {
  if (e) e.stopPropagation();
  window.copyToClipboardWithFeedback(String(runs), e && e.target, { duration: 900 });
}
window.copyRunsToClipboard = copyRunsToClipboard;

// A job's own ME/TE, from whichever of the two places it can live: an auto-imported (real ESI) job
// carries its real researched level directly on meLevel/teLevel (see buildAutoImportedJob); a
// manually-planned job has no such field - its ME/TE is whatever override was live in the Calculator
// at add-time, captured in buildConfigSnapshot.customMEOverrides/customTEOverrides keyed by the
// blueprint's own typeId (same convention tree.js's own node.customME/customTE default from - see its
// own comment on why unset means 0). Shared by the merge-duplicate grouping below (so different
// research levels never get merged into one job) and by the job detail view (so ME/TE is visible at
// all for a plan, not just for an auto-imported real job).
function getJobMeTe(job) {
  if (!job) return { me: 0, te: 0 };
  if (job.meLevel !== undefined || job.teLevel !== undefined) {
    return { me: job.meLevel || 0, te: job.teLevel || 0 };
  }
  const snapshot = job.buildConfigSnapshot || {};
  const me = (snapshot.customMEOverrides && snapshot.customMEOverrides[job.typeId] !== undefined) ? snapshot.customMEOverrides[job.typeId] : 0;
  const te = (snapshot.customTEOverrides && snapshot.customTEOverrides[job.typeId] !== undefined) ? snapshot.customTEOverrides[job.typeId] : 0;
  return { me, te };
}

// --- Combine duplicate jobs ---
// Only merges jobs that are safely equivalent: same product, same ME/TE (see getJobMeTe above - a
// ME3/10-run job and a ME5/12-run job of the same item are NOT the same plan and must never collapse
// into one, reported directly: they were merging into a single job that silently lost one side's real
// run count/research level), same build/buy config context (sub-build vs final, and which job it's a
// prerequisite for), same sell strategy, same character ownership (scope/ownerCharId/corpId - two
// identical jobs for two different characters are two separate real installs, each character's own
// job slot, not one either of them could run; reported directly that combining used to silently adopt
// jobs[0]'s owner and swallow the other character's job under that identity), and neither one already
// started. Jobs that differ in any of these (e.g. one set to build, one to buy; one selling via buy
// order vs sell order; one planned for a different character) are deliberately left alone, since
// merging those would silently lose information about which configuration - or which person - applies
// to which materials.
// Merging is a pure re-labeling of already-computed material lists (sum the qtyNeeded each ORIGINAL
// job already worked out for its own run count) - it never rebuilds a tree for the new combined run
// count. That matters: EVE applies ME rounding per job you actually run, so two separate jobs of, say,
// 3 and 4 runs each round their own material lines up independently, and can need very slightly more
// material in total than one single 7-run job would. Since you still run these as separate real EVE
// jobs after combining here (this only merges the LEDGER's bookkeeping of them into one row), keeping
// each original job's own already-rounded numbers and just adding them together is the correct match
// for reality - recomputing as "1 job of 7 runs" would understate what you actually need.
// Sums a group of 2+ duplicate jobs' already-computed numbers into one job carrying jobs[0]'s
// identity - shared by both merge passes in combineDuplicateJobs below, since the actual summing math
// (materials, cost, runs, time) is identical whether the group shared a parent or not.
// The multi-job-plan display fields (jobCount/runsPerJob - "N Jobs x R Runs", see runsDisplayHTML's
// own comment for what they mean) are the one exception to "inherit everything from jobs[0]":
// jobs[0].jobCount counted only its OWN pre-merge runs, so a merged row has to reconcile it against
// the new combined runsNeeded or it silently under-reports how many real EVE installs the row now
// stands for. Both merge passes now include per-job run size in their grouping key (normalized to ''
// for ordinary continuous-run jobs - see their own comments), so every multi-job plan reaching here
// shares one runsPerJob; jobCount is then re-derived straight from the summed runsNeeded
// (Math.round(summedRunsNeeded / runsPerJob)), NOT by adding up the stored jobCount fields - the same
// self-healing "derive from the run counts themselves" approach as syncWithEveIndustryJobs' split
// logic (search this file for "perJobRuns" for the full reasoning), so an already-stale stored
// jobCount corrects itself on the next merge instead of propagating. A group with no multi-job plan
// in it keeps the plain "just show runsNeeded" path untouched.
function mergeJobsInto(jobs) {
  const materialsMap = {};
  jobs.forEach(j => {
    (j.materials || []).forEach(m => {
      if (!m) return;
      if (!materialsMap[m.typeId]) {
        materialsMap[m.typeId] = { ...m, qtyNeeded: 0, stockQty: 0, netQtyNeeded: 0, lineCost: 0 };
      }
      materialsMap[m.typeId].qtyNeeded += m.qtyNeeded || 0;
      materialsMap[m.typeId].stockQty += m.stockQty || 0;
      materialsMap[m.typeId].netQtyNeeded += m.netQtyNeeded || 0;
      materialsMap[m.typeId].lineCost += m.lineCost || 0;
    });
  });
  const first = jobs[0];
  const summedRunsNeeded = jobs.reduce((s, j) => s + (j.runsNeeded || 0), 0);

  // Per-job run size of the multi-job plans in this group. With runsPerJob in both merge passes' keys
  // this Set is size 0 (every job is an ordinary continuous-run job) or size 1 (every multi-job plan
  // shares one per-job size) in practice. The size > 1 branch is a defensive fallback for a group
  // that somehow ends up genuinely mixed - there's no honest single "N Jobs x R Runs" for it, so drop
  // to the plain runsNeeded display rather than adopting one job's size arbitrarily (the bug this
  // whole reconciliation fixes, just louder).
  const perJobRunSizes = new Set(
    jobs.filter(j => (j.jobCount || 1) > 1 && (j.runsPerJob || 0) > 0).map(j => j.runsPerJob)
  );
  let multiJobFields;
  if (perJobRunSizes.size === 1) {
    const runsPerJob = perJobRunSizes.values().next().value;
    multiJobFields = { jobCount: Math.max(1, Math.round(summedRunsNeeded / runsPerJob)), runsPerJob };
  } else if (perJobRunSizes.size > 1) {
    multiJobFields = { jobCount: 1, runsPerJob: undefined };
  } else {
    multiJobFields = {};
  }

  return {
    ...first,
    runsNeeded: summedRunsNeeded,
    qtyNeeded: jobs.reduce((s, j) => s + (j.qtyNeeded || 0), 0),
    calculatedCost: jobs.reduce((s, j) => s + (j.calculatedCost || 0), 0),
    netProfit: jobs.every(j => j.netProfit !== undefined) ? jobs.reduce((s, j) => s + j.netProfit, 0) : undefined,
    totalBuildSeconds: jobs.reduce((s, j) => s + (j.totalBuildSeconds || 0), 0),
    materials: Object.values(materialsMap),
    addedAt: jobs.reduce((earliest, j) => (j.addedAt && j.addedAt < earliest) ? j.addedAt : earliest, first.addedAt),
    ...multiJobFields
  };
}

// Re-points any job whose parent was just absorbed into `survivor` at the survivor's id instead, so
// the next merge pass (or the final render) sees the corrected link rather than a reference to a job
// id that no longer exists in the queue. Shared by both merge passes below.
function repointChildrenToSurvivor(queue, absorbedIds, survivor) {
  if (absorbedIds.size === 0) return;
  queue.forEach(j => {
    if (j && j.isSubBuild && j.parentJobId !== undefined && j.parentJobId !== null && absorbedIds.has(j.parentJobId)) {
      j.parentJobId = survivor.id;
      j.parentJobName = survivor.name;
    }
  });
}

// A normal prerequisite's label is just its one parent's name (job.parentJobName). A pooled cross-
// parent prerequisite (see combineDuplicateJobs' Pass B) doesn't have a single parent any more - it
// lists every job it now feeds instead, resolving each id's current name from whichever list still has
// it (an in-progress parent from activeJobs, or a completed one from buildHistory) rather than trusting
// a name captured at pool time, which could go stale if that job is later renamed/requeued.
function getPrereqLabel(job) {
  if (Array.isArray(job.sharedParentIds) && job.sharedParentIds.length > 0) {
    const names = job.sharedParentIds.map(id => {
      const found = (activeJobs.find(j => j && j.id === id)) || (buildHistory.find(r => r && r.id === id));
      return found ? found.name : null;
    }).filter(Boolean);
    return names.length ? names.join(', ') : `${job.sharedParentIds.length} job${job.sharedParentIds.length > 1 ? 's' : ''}`;
  }
  return job.parentJobName || 'another job';
}

// Character ownership tag - lets you tell at a glance whose job this is now that several characters
// can be registered at once (js/esi.js). A job with no owner at all predates that feature, or was
// added while logged out, and shows nothing here rather than an "Unassigned" badge cluttering every
// such job. Every job stays visible regardless of scope/owner (see renderActiveJobsList's own
// character filter, which is opt-in only, never automatic) - this is purely informational.
//
// Portrait fetch failed (rare - a deleted/renamed character, or a network hiccup) - swap in the old
// generic person/building icon instead. A named handler, not an inline outerHTML string, because
// svgIcon()'s own markup uses double quotes throughout, which would terminate an inline onerror="..."
// attribute the moment it appeared (same reasoning js/lpstore.js's own handleLPIconLoadError already
// documents for the identical problem there).
function handleJobOwnerPortraitError(imgEl, iconName) {
  const span = document.createElement('span');
  span.style.cssText = 'display:inline-flex; vertical-align:middle; color:var(--text-mute);';
  span.innerHTML = window.svgIcon(iconName);
  imgEl.replaceWith(span);
}
window.handleJobOwnerPortraitError = handleJobOwnerPortraitError;

function ownerNameAndTitle(job) {
  const record = window.getCharacterRecord ? window.getCharacterRecord(job.ownerCharId) : null;
  // The owner might be a real EVE character not registered in THIS tool (e.g. a corp-mate's
  // installer_id from a matched/auto-imported corp job) - still worth showing something rather than
  // silently dropping the tag, just without a resolvable name. The portrait itself works either way -
  // images.evetech.net only needs a real character id, not a login - so even an unregistered corp-
  // mate still gets a real recognizable face, just no resolvable name text next to it.
  const name = record ? record.charName : `Pilot ${job.ownerCharId}`;
  const title = job.scope === 'corp' ? `Corp job - installed by ${name}` : `Planned for ${name}`;
  return { name, title, fallbackIcon: job.scope === 'corp' ? 'building' : 'user' };
}

// List view: a plain circular portrait, no name (the compact row has no room for one - see
// renderJobListRowHTML's own comment), inline with the item name. Sized decisively larger than the
// first pass (24px, not a timid bump) and actually confirmed at that size in a real screenshot before
// shipping it - a small nudge turned out to be imperceptible last time.
function renderJobOwnershipBadgeHTML(job) {
  if (!job.ownerCharId) return '';
  const { title, fallbackIcon } = ownerNameAndTitle(job);
  const portraitHTML = `<img src="https://images.evetech.net/characters/${job.ownerCharId}/portrait?size=64" alt="" loading="lazy" style="width:24px;height:24px;border-radius:50%;flex-shrink:0;vertical-align:middle;" onerror="handleJobOwnerPortraitError(this, '${fallbackIcon}')">`;
  return `<span class="ml-1" style="display:inline-flex;vertical-align:middle;" title="${window.esc(title)}">${portraitHTML}</span>`;
}

// Card/Focus view: back to a labeled pill in the header row, same family as the preset chip next to
// it - reported directly that overlapping it on the item's own icon looked "smashed together" and too
// busy, and that a round portrait was never the problem in the first place (an earlier round-vs-square
// fix here was solving the wrong thing). ml-2 (not ml-1) and its own flex-shrink-0 keep a clear gap
// from the preset chip rather than crowding it - positioned AFTER it (to its right), not before, per
// direct request.
function renderJobOwnershipPillHTML(job) {
  if (!job.ownerCharId) return '';
  const { name, title, fallbackIcon } = ownerNameAndTitle(job);
  const portraitHTML = `<img src="https://images.evetech.net/characters/${job.ownerCharId}/portrait?size=64" alt="" loading="lazy" onerror="handleJobOwnerPortraitError(this, '${fallbackIcon}')">`;
  return `<span class="lp-owner-pill ml-2 flex-shrink-0" title="${window.esc(title)}">${portraitHTML}${window.esc(name)}</span>`;
}

// Distinguishes a multi-job plan from a normal combined multi-run job - same runsNeeded field,
// completely different real-world meaning (see js/tree.js's own comment on node.jobCount, and
// js/app.js's on job.jobCount/job.runsPerJob). Without this, "5,000
// Runs" reads identically whether it's one real 5,000-run job or - as it can actually be, an LP
// Store redemption or several physical copies of a limited-run BPC planned via the root card's own
// "Jobs" field - 5,000 separate single-run jobs that each need their own install in EVE.
//
// Plain text ("N Jobs x R Runs"), not an icon+tooltip badge (an earlier version of this used a
// layers icon next to the job name for exactly this) - a glance at the number itself is clearer than
// a separate symbol you have to already know the meaning of, and it generalizes past LP Store
// offers (always 1 run per job) to any jobCount/runsPerJob combination the Calculator's own "Jobs"
// field can produce.
// The "Job(s)"/"Run(s)" words render smaller and lighter-weight than the numbers next to them (the
// parent span carries the big bold accent styling for the numbers - this only needs to override size/
// weight, color still inherits so the words stay the same green as the numbers) - the count is the
// thing actually worth reading at a glance; the unit word is just there to disambiguate it.
function runsDisplayHTML(job) {
  const unit = (word) => `<span style="font-size:0.6em; font-weight:600;">${word}</span>`;
  if ((job.jobCount || 1) <= 1) {
    return `${job.runsNeeded.toLocaleString()} ${unit(`Run${job.runsNeeded > 1 ? 's' : ''}`)}`;
  }
  return `${job.jobCount.toLocaleString()} ${unit(`Job${job.jobCount > 1 ? 's' : ''}`)} <span style="opacity:0.6; font-size:0.7em; font-weight:600;">&times;</span> ${(job.runsPerJob || 1).toLocaleString()} ${unit(`Run${(job.runsPerJob || 1) > 1 ? 's' : ''}`)}`;
}

// The small gear icon next to a prerequisite's name - a shared one gets a "xN" count alongside it so
// it reads as "feeds several jobs" at a glance, not just on hover.
function renderPrereqBadgeHTML(job, extraClass) {
  if (!job.isSubBuild) return '';
  const isShared = Array.isArray(job.sharedParentIds) && job.sharedParentIds.length > 1;
  const label = getPrereqLabel(job);
  const title = isShared ? `Shared prerequisite for: ${window.esc(label)}` : `Prerequisite for: ${window.esc(label)}`;
  const countHTML = isShared ? ` &times;${job.sharedParentIds.length}` : '';
  return `<span class="${extraClass || ''}" style="color:var(--text-mute);" title="${title}">${window.svgIcon('gear')}${countHTML}</span>`;
}

// One tight-merge pass: same item, same actual parent (or both roots). Mutates `activeJobs` and
// returns how many duplicate jobs it eliminated (0 = nothing to merge). A cross-parent duplicate - the
// SAME item, but for two genuinely different parents - deliberately does NOT merge here; that's what
// poolCrossParentDuplicatesOnce below is for.
function tightMergeSameParentOnce() {
  const groups = {};
  const order = [];
  activeJobs.forEach(job => {
    if (!job) return;
    if (job.isStarted) { order.push({ key: null, job }); return; } // never combine started jobs
    // Two sub-builds only tight-merge if they're prerequisites for the SAME actual parent job -
    // grouping by parentJobId (falling back to parentJobName only for a sub-build saved before that
    // field existed) instead of name alone, or two different jobs' prerequisites could get merged
    // together just because their parents happen to share a product name (see buildJobClusters' own
    // comment).
    const parentKey = job.isSubBuild
      ? ((job.parentJobId !== undefined && job.parentJobId !== null) ? `id:${job.parentJobId}` : `name:${job.parentJobName || ''}`)
      : '';
    const meTe = getJobMeTe(job);
    // Ownership is part of the identity here, same tier as sellStrategy/parentKey/meTe above - two
    // identical jobs for two different characters are two separate real EVE install actions (each
    // character has their own job slots and has to personally install their own copy), not one bigger
    // job either of them could run. Merging them used to silently adopt jobs[0]'s owner and drop the
    // other character's job into that identity - invisible under a character filter, wrong under the
    // Personal/Corp scope filter. Keying on scope/ownerCharId/corpId means same-owner duplicates still
    // combine exactly as before, but different-owner ones simply never group together in the first
    // place, so mergeJobsInto never has to choose whose identity survives.
    // Per-job run size (see runsDisplayHTML's own comment on jobCount/runsPerJob) is identity too, for
    // the same reason: a "3 Jobs x 12 Runs" plan and a "2 Jobs x 25 Runs" plan of the same item are
    // genuinely different real-world install patterns, not one combinable batch, and mergeJobsInto has
    // no honest way to fold two different per-job sizes into a single "N Jobs x R Runs" row. Only a
    // real multi-job plan (jobCount > 1) contributes this; an ordinary continuous-run job normalizes
    // to '' so a stray runsPerJob left on it can't stop it combining with a plain duplicate as before.
    const perJobRunsKey = (job.jobCount || 1) > 1 ? (job.runsPerJob || '') : '';
    const key = [
      job.productTypeId || job.typeId,
      job.isSubBuild ? 'sub' : 'final',
      parentKey,
      job.sellStrategy || '',
      meTe.me,
      meTe.te,
      job.scope || '',
      job.ownerCharId || '',
      job.corpId || '',
      perJobRunsKey
    ].join('|');
    if (!groups[key]) groups[key] = [];
    groups[key].push(job);
    order.push({ key, job });
  });

  const mergedByKey = {};
  let eliminated = 0;
  Object.keys(groups).forEach(key => {
    const jobs = groups[key];
    if (jobs.length < 2) return;
    eliminated += jobs.length - 1;
    mergedByKey[key] = mergeJobsInto(jobs);
  });
  if (eliminated === 0) return 0;

  const newQueue = [];
  const emittedKeys = new Set();
  order.forEach(({ key, job }) => {
    if (key === null) { newQueue.push(job); return; }
    if (mergedByKey[key]) {
      if (!emittedKeys.has(key)) { newQueue.push(mergedByKey[key]); emittedKeys.add(key); }
    } else {
      newQueue.push(job);
    }
  });
  Object.keys(groups).forEach(key => {
    const jobs = groups[key];
    if (jobs.length < 2) return;
    const survivor = mergedByKey[key];
    const absorbedIds = new Set(jobs.map(j => j.id));
    absorbedIds.delete(survivor.id);
    repointChildrenToSurvivor(newQueue, absorbedIds, survivor);
  });
  activeJobs = newQueue;
  return eliminated;
}

// One cross-parent pooling pass: same item + sell strategy, but DIFFERENT parents. Only ever called
// once tightMergeSameParentOnce has run to a full fixed point (see combineDuplicateJobs) - otherwise
// two jobs that just became same-parent duplicates via a same-pass repoint, but haven't been
// re-grouped by the tight pass yet, would look like a genuine cross-parent case here even though the
// very next tight pass was about to merge them anyway. Once tight-merging is stable, anything still
// duplicated by product+strategy is guaranteed to have genuinely different parents (or already be
// shared/orphaned) - safe to pool. In EVE these can still be run as one bigger batch and used across
// both final products - the only thing actually different between them is which job they're a
// prerequisite FOR, not what they ARE. Pooled into one job with parentJobId cleared and
// sharedParentIds listing every job it now feeds, instead of picking just one parent to keep - that
// needs zero extra plumbing to render or shop correctly: buildJobClusters already treats a sub-build
// with no resolvable parent as its own top-level entry (the same fallback an orphaned prerequisite -
// e.g. its one parent got deleted - already used), and internallySuppliedPool already tracks a
// covered material queue-wide by product rather than per-parent, so it still correctly keeps that
// material off every parent's shopping list, not just one.
function poolCrossParentDuplicatesOnce() {
  const looseGroups = {};
  const looseOrder = [];
  activeJobs.forEach(job => {
    if (!job || job.isStarted || !job.isSubBuild) { looseOrder.push({ key: null, job }); return; }
    const meTe = getJobMeTe(job);
    // Same ownership reasoning as tightMergeSameParentOnce's own key above - a shared cross-parent
    // prerequisite still needs to stay a per-character thing, not get pooled onto whichever job
    // happened to be jobs[0]. Per-job run size is keyed for the same reason too (see that key's own
    // perJobRunsKey comment): different multi-job plan shapes must never pool into one nonsensical
    // "N Jobs x R Runs" row; an ordinary continuous-run job normalizes to '' so it still pools freely.
    const perJobRunsKey = (job.jobCount || 1) > 1 ? (job.runsPerJob || '') : '';
    const key = [job.productTypeId || job.typeId, job.sellStrategy || '', meTe.me, meTe.te, job.scope || '', job.ownerCharId || '', job.corpId || '', perJobRunsKey].join('|');
    if (!looseGroups[key]) looseGroups[key] = [];
    looseGroups[key].push(job);
    looseOrder.push({ key, job });
  });

  const pooledByKey = {};
  let eliminated = 0;
  Object.keys(looseGroups).forEach(key => {
    const jobs = looseGroups[key];
    if (jobs.length < 2) return;
    eliminated += jobs.length - 1;
    const merged = mergeJobsInto(jobs);
    const contributedParentIds = new Set();
    jobs.forEach(j => {
      if (Array.isArray(j.sharedParentIds) && j.sharedParentIds.length) {
        j.sharedParentIds.forEach(id => contributedParentIds.add(id));
      } else if (j.parentJobId !== undefined && j.parentJobId !== null) {
        contributedParentIds.add(j.parentJobId);
      }
    });
    merged.parentJobId = null;
    merged.parentJobName = null;
    merged.sharedParentIds = Array.from(contributedParentIds);
    pooledByKey[key] = merged;
  });
  if (eliminated === 0) return 0;

  const newQueue = [];
  const emittedPoolKeys = new Set();
  looseOrder.forEach(({ key, job }) => {
    if (key === null) { newQueue.push(job); return; }
    if (pooledByKey[key]) {
      if (!emittedPoolKeys.has(key)) { newQueue.push(pooledByKey[key]); emittedPoolKeys.add(key); }
    } else {
      newQueue.push(job);
    }
  });
  Object.keys(looseGroups).forEach(key => {
    const jobs = looseGroups[key];
    if (jobs.length < 2) return;
    const survivor = pooledByKey[key];
    const absorbedIds = new Set(jobs.map(j => j.id));
    absorbedIds.delete(survivor.id);
    repointChildrenToSurvivor(newQueue, absorbedIds, survivor);
  });
  activeJobs = newQueue;
  return eliminated;
}

function combineDuplicateJobs() {
  loadJournalState();
  let combinedCount = 0;

  // Tight-merges always run to a full fixed point before EVER trying to pool - see
  // poolCrossParentDuplicatesOnce's own comment for why that ordering matters. Pooling can itself
  // unlock new tight-merge opportunities one level down (a grandchild whose parent just got pooled
  // away now shares a corrected parentJobId with a sibling), so the two alternate - stabilize tight
  // merges, try one pool pass, and if that pooled anything, go stabilize tight merges again - until a
  // full round changes nothing. Capped well above any realistic nesting depth (this app's own recipe-
  // tree walk caps at 6) purely as a safety net against an unexpected data shape looping forever, not
  // because deep chains are expected.
  for (let round = 0; round < 12; round++) {
    let tightEliminatedThisRound = 0;
    let eliminatedThisPass;
    while ((eliminatedThisPass = tightMergeSameParentOnce()) > 0) tightEliminatedThisRound += eliminatedThisPass;
    const looseEliminated = poolCrossParentDuplicatesOnce();
    combinedCount += tightEliminatedThisRound + looseEliminated;
    if (tightEliminatedThisRound === 0 && looseEliminated === 0) break;
  }

  localStorage.setItem('eve_ledger_jobs', JSON.stringify(activeJobs));
  renderJournalPage();

  if (combinedCount === 0) {
    if (typeof window.showToast === 'function') window.showToast('No combinable duplicate jobs found. Jobs only combine when they match on item, build/buy context, sell strategy, and character ownership, and neither is already started.', 'info');
  } else if (typeof window.showToast === 'function') {
    window.showToast(`Combined ${combinedCount} duplicate job${combinedCount > 1 ? 's' : ''}.`, 'success');
  }
}
window.combineDuplicateJobs = combineDuplicateJobs;

function copyIndividualJobMultibuy(e, jobId) {
  if (e) e.stopPropagation();
  const job = activeJobs.find(j => j && j.id === jobId);
  if (!job || !Array.isArray(job.materials)) return;

  const deductModeInput = document.getElementById('deduct-stock-mode');
  const isStockDeductEnabled = deductModeInput ? deductModeInput.value === 'true' : true;

  // "Missing Qty" on this clipboard text MUST agree with what the job's own card shows for the same
  // material, so this deducts stock in the EXACT ordering renderJournalPage's materialStockInfoByJobId
  // pass uses (and via the same applyJobMaterialsToStock helper, not a third reimplementation of the
  // math): every STARTED job first, then every PENDING job, each group in its own stored relative
  // order. This function used to instead walk activeJobs in raw storage index order up to the target
  // job - which mixes started/pending as stored and can hand a pending job stored before a started
  // job first claim on stock that the on-screen card correctly gives to the started job, so the
  // copied Missing Qty and the rendered card disagreed for that material.
  const allocatedStock = { ...userStockMap };
  const orderedJobs = [
    ...activeJobs.filter(j => j && j.isStarted),
    ...activeJobs.filter(j => j && !j.isStarted)
  ];
  let targetMaterialStockInfo = [];
  for (const j of orderedJobs) {
    // Same isJobConsumptionAlreadyReflectedByFreshAssets check as renderJournalPage's own pass, so the
    // two can never diverge - without it, a started job whose consumption a fresh asset refresh has
    // already confirmed would still get double-subtracted HERE even though the card itself doesn't,
    // right back to Copy BOM and the card disagreeing.
    const deductFromPool = !(j.isStarted && isJobConsumptionAlreadyReflectedByFreshAssets(j));
    const info = applyJobMaterialsToStock(j, allocatedStock, isStockDeductEnabled, deductFromPool);
    if (j.id === jobId) {
      targetMaterialStockInfo = info;
      break;
    }
  }

  const textList = targetMaterialStockInfo
    .filter(({ mat, netMissing }) => {
      if (!mat) return false;
      if (mat.strategy === 'lp') return false; // acquired via an LP Store redemption, not a market purchase
      return netMissing > 0;
    })
    .map(({ mat, netMissing }) => `${mat.name} x${netMissing}`)
    .join('\n');

  if (!textList.trim()) return;

  window.copyToClipboardWithFeedback(textList, e.target, { useInnerHTML: true });
}

let bomViewMode = localStorage.getItem('eve_bom_view_mode') || 'card'; // 'card' | 'compact' - shared with the calculator page

function updateBomViewModeButtonLabel() {
  const btn = document.getElementById('btn-bom-view-mode');
  if (btn) btn.innerHTML = bomViewMode === 'compact'
    ? window.svgIcon('grid') + ' Detailed'
    : window.svgIcon('list') + ' Compact';
}

function toggleBomViewMode() {
  bomViewMode = bomViewMode === 'compact' ? 'card' : 'compact';
  localStorage.setItem('eve_bom_view_mode', bomViewMode);
  updateBomViewModeButtonLabel();
  renderJournalPage();
}
window.toggleBomViewMode = toggleBomViewMode;

function renderConsolidatedBOMList(bomItems, totalMissingISK) {
  const container = document.getElementById('journal-bom-items');
  const bomTypesEl = document.getElementById('journal-bom-types');
  const bomTotalEl = document.getElementById('journal-bom-total');
  const bomVolumeEl = document.getElementById('journal-bom-volume');

  if (bomTypesEl) bomTypesEl.textContent = bomItems.length.toString();
  if (bomTotalEl) bomTotalEl.textContent = Math.round(totalMissingISK).toLocaleString() + ' ISK';
  // item.lineVolume (set in renderJournalPage, right next to lineCost/netMissingQty) is already
  // volume-of-what's-missing, not volume of the full requirement - same "missing after stock" scope
  // as the ISK total right below this, just for m3 instead of ISK.
  if (bomVolumeEl) {
    const totalMissingVolume = bomItems.reduce((sum, item) => sum + (item.lineVolume || 0), 0);
    bomVolumeEl.textContent = totalMissingVolume.toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' m3';
  }

  if (!container) return;
  updateBomViewModeButtonLabel();

  if (bomItems.length === 0) {
    container.innerHTML = `
      <div class="lp-card p-4 text-center mono italic" style="color:var(--text-mute);">
        No active material demands in queue matching selected filters.
      </div>
    `;
    return;
  }

  const isCompact = bomViewMode === 'compact';

  // A stock-covered item used to just fade to 55% opacity in place and still print "0 ISK" - both
  // read as "this line is broken/loading", not "you already have this", especially at a glance
  // scanning a long list. It's a hard split: still-need-to-buy items render first, full strength,
  // exactly as before; anything fully covered by stock drops into its own "Already in Stock" section
  // below a divider (same .lp-group-header treatment the job queue's own Pending/In Progress groups
  // use). A green accent used to stand in for the old fade, but that made stock you already own MORE
  // visually prominent than what you actually need to buy - backwards, since the buy list is what
  // matters. The divider + a collapsed-by-default section does the separating instead; items inside
  // get no special color treatment at all now, just a plain "✔ In Stock" (muted, not green) replacing
  // the redundant "0 ISK" - the point isn't that it costs nothing, it's that there's nothing to buy.
  const needToBuyItems = bomItems.filter(item => item.netMissingQty > 0);
  const acquiredItems = bomItems.filter(item => item.netMissingQty === 0);

  const renderItemHTML = (item, isCompleted) => {
    const statusBadge = isCompleted
      ? `<span class="lp-badge lp-badge-accent">Acquired</span>`
      : `<span class="lp-badge">Missing</span>`;

    // Buy stays lime (matches the buy/sell toggle buttons, where buy is highlighted as "usually
    // more profitable"); sell gets a distinct blue so the two read apart at a glance instead of
    // both being the same green. 'lp' (acquired via an LP Store redemption, not the market at all -
    // see js/optimizers.js calculateTreeNodeCost) used to fall through to this same BUY badge, which
    // actively said the wrong thing about how to actually get this material - it gets its own
    // violet tag instead, matching the same violet already used for redemption-requirement cards
    // elsewhere in the LP Store.
    const strategyBadge = item.strategy === 'lp'
      ? `<span class="lp-badge lp-badge-violet" title="Acquired via an LP Store redemption, not bought on the market">LP</span>`
      : item.strategy === 'sell'
      ? `<span class="lp-badge lp-badge-blue">SELL</span>`
      : `<span class="lp-badge lp-badge-accent">BUY</span>`;

    // CORRECTION: Direct blueprint path safety check inside the consolidated BOM prevents any imageservers 400 errors [1.1.1, 1.1.4]
    const itemIconUrl = window.getItemIconUrl(item.typeId, window.TYPE_ID_TO_NAME[item.typeId] || item.name, 32);
    const costOrInStockHTML = isCompleted
      ? `<span class="font-bold mono flex-shrink-0" style="color:var(--text-mute);">${window.svgIcon('check')} In Stock</span>`
      : `<span class="font-bold mono flex-shrink-0" style="color:var(--cost);">${Math.round(item.lineCost).toLocaleString()} ISK${window.estimatedPriceMarker ? window.estimatedPriceMarker(item.typeId) : ''}</span>`;

    if (isCompact) {
      return `
        <div class="lp-list-item" style="padding-left:0; padding-right:0;">
          <img src="${itemIconUrl}" alt="${window.esc(item.name)}" class="w-5 h-5 rounded flex-shrink-0" loading="lazy" onerror="this.onerror=null; this.src='https://images.evetech.net/types/${item.typeId}/render?size=32';">
          ${strategyBadge}
          <span class="font-semibold truncate flex-1" style="color:var(--text-soft);"><span class="copy-name" data-copy-name="${window.esc(item.name)}" onclick="copyNameToClipboard(event)" title="Click to copy: ${window.esc(item.name)}">${window.esc(item.name)}</span></span>
          ${isCompleted ? '' : `<span class="text-xs mono flex-shrink-0" style="color:var(--text-mute);">&times;${item.netMissingQty.toLocaleString()}</span>`}
          <span class="flex-shrink-0 w-24 text-right">${costOrInStockHTML}</span>
        </div>
      `;
    }

    return `
      <div class="lp-card p-2.5 transition">
        <div class="flex items-start gap-2.5">
          <img src="${itemIconUrl}" alt="${window.esc(item.name)}" class="w-8 h-8 rounded-md flex-shrink-0" loading="lazy" onerror="this.onerror=null; this.src='https://images.evetech.net/types/${item.typeId}/render?size=32';">
          <div class="min-w-0 flex-1">
            <div class="flex items-center justify-between gap-2">
              <span class="font-semibold truncate" style="color:var(--text-soft);"><span class="copy-name" data-copy-name="${window.esc(item.name)}" onclick="copyNameToClipboard(event)" title="Click to copy: ${window.esc(item.name)}">${window.esc(item.name)}</span></span>
              ${costOrInStockHTML}
            </div>
            <div class="flex items-center gap-1 mt-1.5">
              ${strategyBadge}
              ${statusBadge}
            </div>
            ${item.netMissingQty > 0 ? `<div class="text-xs mono mt-1.5" style="color:var(--text-mute);">Qty: ${item.netMissingQty.toLocaleString()} &times; ${Math.round(item.unitPrice).toLocaleString()} ISK${item.lineVolume > 0 ? ` &bull; ${item.lineVolume.toLocaleString(undefined, {maximumFractionDigits: 1})} m3` : ''}</div>` : ''}
          </div>
        </div>
      </div>
    `;
  };

  const needToBuyHTML = needToBuyItems.map(item => renderItemHTML(item, false)).join('');
  const chevronSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px; height:13px; flex-shrink:0; transform:rotate(${isAcquiredBomSectionExpanded ? '0' : '-90'}deg); transition:transform 0.15s ease;"><polyline points="6 9 12 15 18 9"/></svg>`;
  const acquiredHTML = acquiredItems.length > 0 ? `
    <div class="lp-group-header mt-2.5 mb-2.5" style="cursor:pointer;" onclick="toggleAcquiredBomSection()" title="${isAcquiredBomSectionExpanded ? 'Collapse' : 'Expand'}">
      ${chevronSvg}
      <span class="text-xs font-bold uppercase tracking-wide" style="color:var(--text-mute);">Already in Stock</span>
      <span class="text-xs font-bold mono ml-auto" style="color:var(--text-mute);">${acquiredItems.length.toLocaleString()}</span>
    </div>
    ${isAcquiredBomSectionExpanded ? acquiredItems.map(item => renderItemHTML(item, true)).join('') : ''}
  ` : '';

  container.innerHTML = needToBuyHTML + acquiredHTML;

  window.journalMultibuyText = bomItems
    .filter(i => i.netMissingQty > 0 && i.strategy !== 'lp') // LP-acquired materials aren't a market purchase - don't paste them into a multibuy order
    .map(i => `${i.name} x${i.netMissingQty}`)
    .join('\n');
}

function copyJournalMultibuy() {
  if (!window.journalMultibuyText) return;
  
  const btn = document.querySelector('button[onclick="copyJournalMultibuy()"]');
  window.copyToClipboardWithFeedback(window.journalMultibuyText, btn);
}

// Starts a job (or a portion of it). Starting fewer than all remaining runs splits the job into an
// "in progress" fragment (started now, with its own timer) and a still-queued fragment for the rest -
// this mirrors real EVE mechanics, where a queued industry job has one fixed run count and duration,
// so starting a subset of runs means queuing a genuinely separate job for what's left.
function startJobRuns(jobId) {
  const input = document.getElementById(`start-runs-${jobId}`);
  const requestedRuns = input ? parseInt(input.value) : NaN;

  loadJournalState();
  const jobIndex = activeJobs.findIndex(j => j && j.id === jobId);
  if (jobIndex === -1) return;
  const job = activeJobs[jobIndex];
  const totalRuns = job.runsNeeded || 1;
  const startRuns = Math.max(1, Math.min(isNaN(requestedRuns) ? totalRuns : requestedRuns, totalRuns));

  if (startRuns >= totalRuns) {
    job.startedAt = Date.now();
    job.isStarted = true;
    // Stamps which shared asset-cache "generation" (see js/esi.js's getEsiAssetsExpiry, backed by
    // localStorage so every tab agrees) was current the moment this job started -
    // isJobConsumptionAlreadyReflectedByFreshAssets only keeps manually compensating for this job's
    // real consumption while that shared value hasn't advanced past this stamp yet. null (never
    // observed an Expires header at all, e.g. never logged in this session) falls back to always
    // compensating - the safe default.
    job.assetsExpiryAtStart = window.getEsiAssetsExpiry ? window.getEsiAssetsExpiry() : null;
    localStorage.setItem('eve_ledger_jobs', JSON.stringify(activeJobs));
    renderJournalPage();
    return;
  }

  const ratio = startRuns / totalRuns;
  const remainingRuns = totalRuns - startRuns;
  const remainingRatio = remainingRuns / totalRuns;

  // Split each material's total between the two fragments WITHOUT rounding each side independently.
  // m.qtyNeeded already went through Math.ceil once (calculateInputQuantity, for the full totalRuns) -
  // re-ceiling BOTH ratio*qtyNeeded and (1-ratio)*qtyNeeded separately can round up twice on the same
  // total, but the real danger is the STARTED side specifically: it can come out LOWER than a fresh
  // single-run calculation would give (provably, ceil(ceil(n*x)*r) <= ceil(x) for r=1/n). The started
  // side is what gets subtracted from the shared stock pool as "already consumed" when the BOM
  // renders - an under-counted started side leaves MORE apparent stock for every job rendered after it
  // than physically exists, which is exactly "the ledger looked fine, then I ran out in game." Ceiling
  // only the started side (conservative: assume at least this much was really consumed) and deriving
  // the remaining side as the exact complement guarantees the two fragments always sum back to the
  // trusted original total - no material invented or lost in the split, and no phantom stock leaking
  // into later jobs. (Same fix as syncWithEveIndustryJobs' own splitMaterials.)
  const splitMaterials = () => {
    const started = [], remaining = [];
    (Array.isArray(job.materials) ? job.materials : []).forEach(m => {
      const startedQty = Math.min(m.qtyNeeded, Math.ceil(m.qtyNeeded * ratio));
      const remainingQty = Math.max(0, m.qtyNeeded - startedQty);
      const startedStock = Math.min(m.stockQty || 0, startedQty);
      const remainingStock = (m.stockQty || 0) - startedStock;
      started.push({ ...m, qtyNeeded: startedQty, stockQty: startedStock, netQtyNeeded: Math.max(0, startedQty - startedStock), lineCost: (m.unitPrice || 0) * Math.max(0, startedQty - startedStock) });
      remaining.push({ ...m, qtyNeeded: remainingQty, stockQty: remainingStock, netQtyNeeded: Math.max(0, remainingQty - remainingStock), lineCost: (m.unitPrice || 0) * Math.max(0, remainingQty - remainingStock) });
    });
    return { started, remaining };
  };
  const { started: startedMaterials, remaining: remainingMaterials } = splitMaterials();

  const activeFragment = {
    ...job,
    id: Date.now() + Math.floor(Math.random() * 1000),
    runsNeeded: startRuns,
    qtyNeeded: Math.round((job.qtyNeeded || 0) * ratio),
    calculatedCost: (job.calculatedCost || 0) * ratio,
    netProfit: job.netProfit !== undefined ? job.netProfit * ratio : undefined,
    totalBuildSeconds: (job.totalBuildSeconds || 0) * ratio,
    materials: startedMaterials,
    startedAt: Date.now(),
    isStarted: true,
    // See the full-start branch above for what this stamps and why.
    assetsExpiryAtStart: window.getEsiAssetsExpiry ? window.getEsiAssetsExpiry() : null,
    splitFromId: job.id
  };

  const remainingFragment = {
    ...job,
    id: Date.now() + Math.floor(Math.random() * 1000) + 1,
    runsNeeded: remainingRuns,
    qtyNeeded: Math.round((job.qtyNeeded || 0) * remainingRatio),
    calculatedCost: (job.calculatedCost || 0) * remainingRatio,
    netProfit: job.netProfit !== undefined ? job.netProfit * remainingRatio : undefined,
    totalBuildSeconds: (job.totalBuildSeconds || 0) * remainingRatio,
    materials: remainingMaterials,
    startedAt: undefined,
    isStarted: false,
    splitFromId: job.id
  };

  activeJobs.splice(jobIndex, 1, activeFragment, remainingFragment);
  localStorage.setItem('eve_ledger_jobs', JSON.stringify(activeJobs));
  renderJournalPage();
}
window.startJobRuns = startJobRuns;

// Refreshes only the countdown text on already-rendered timer elements, without a full re-render -
// keeps started jobs' timers live every second without disturbing anything else on the page (drag
// state, scroll position, focused inputs, etc).
// Tracks which jobs a browser notification has already fired for, so a job doesn't notify twice
// and so a job that was ALREADY ready before this tab was even opened doesn't fire one either -
// the first tick only seeds this set from whatever's already ready; only jobs that flip to ready
// on a LATER tick (i.e. actually just finished while this tab was open) trigger a real notification.
const _notifiedReadyJobIds = new Set();
let _jobTimerTickCount = 0;

function updateJobTimers() {
  _jobTimerTickCount++;
  document.querySelectorAll('.job-timer').forEach(el => {
    const startedAt = parseInt(el.dataset.startedAt);
    const totalSeconds = parseFloat(el.dataset.totalSeconds);
    const display = el.querySelector('.timer-display');
    if (!display || !startedAt) return;
    const elapsedSeconds = (Date.now() - startedAt) / 1000;
    const remaining = totalSeconds - elapsedSeconds;
    // Only text content and color update on each tick - the class list (size/weight/nowrap) was
    // already set correctly at render time for whichever context this timer lives in (compact list
    // row vs. grid card banner) and must not be clobbered here, or a live tick would silently strip
    // e.g. whitespace-nowrap and cause the text to re-wrap mid-countdown.
    if (remaining <= 0) {
      display.textContent = 'Ready to Collect!';
      display.style.color = 'var(--accent)';
      // The status icon (stopwatch, set at render time) has to be flipped to a checkmark live too - it
      // isn't inside .job-timer (see the render-time comment on status-icon-*), so it's not touched by
      // anything else here unless done explicitly.
      const icon = document.getElementById(`status-icon-${el.dataset.jobId}`);
      if (icon) { icon.innerHTML = renderJobStatusIconHTML('ready'); icon.style.color = 'var(--accent)'; }
      el.classList.add('is-ready');
      // The parent card only shows the bold "ready" color once actually ready - update it live here
      // so it doesn't sit in the wrong color until the next full re-render.
      const card = el.closest('.job-card');
      if (card && !card.classList.contains('job-subbuild')) {
        card.classList.remove('job-started');
        card.classList.add('job-ready');
      }
      const jobId = el.dataset.jobId;
      if (jobId && !_notifiedReadyJobIds.has(jobId)) {
        _notifiedReadyJobIds.add(jobId);
        if (_jobTimerTickCount > 1) notifyJobReady(el.dataset.jobName || 'A job');
      }
    } else {
      display.textContent = `${window.formatDuration(Math.ceil(remaining))} remaining`;
      display.style.color = 'var(--blue-300)';
    }
  });
}
if (!window._jobTimerIntervalStarted) {
  window._jobTimerIntervalStarted = true;
  setInterval(updateJobTimers, 1000);
}

function isJobNotificationsEnabled() {
  return localStorage.getItem('eve_job_notifications') === 'true' && typeof Notification !== 'undefined' && Notification.permission === 'granted';
}

function notifyJobReady(jobName) {
  if (!isJobNotificationsEnabled()) return;
  try {
    const n = new Notification('Job Ready to Collect', { body: `${jobName} has finished building.`, tag: 'eve-job-ready-' + jobName });
    n.onclick = () => { window.focus(); n.close(); };
  } catch (e) { console.warn('[Ledger] Failed to show the job-ready browser notification:', e); }
}

function updateJobNotificationButton() {
  const btn = document.getElementById('btn-job-notifications');
  if (!btn) return;
  const supported = typeof Notification !== 'undefined';
  const enabled = isJobNotificationsEnabled();
  // Icon-only now (see ledger.html) - on/off state reads from the same accent-vs-muted color
  // language every other toggle in this app already uses, plus the tooltip on hover, rather than a
  // permanent "Notify: On"/"Notify When Ready" text label.
  btn.className = `btn-glass ${enabled ? '' : 'btn-glass-muted'} px-2 py-1 flex items-center justify-center`;
  btn.title = !supported
    ? 'Your browser does not support notifications'
    : enabled
      ? 'Notify When Ready: job-ready notifications are on - click to turn off'
      : 'Notify When Ready: get a browser notification when a job finishes building';
}

function toggleJobNotifications() {
  if (typeof Notification === 'undefined') {
    if (typeof window.showToast === 'function') window.showToast('Your browser does not support notifications.', 'error');
    return;
  }
  if (isJobNotificationsEnabled()) {
    localStorage.setItem('eve_job_notifications', 'false');
    updateJobNotificationButton();
    if (typeof window.showToast === 'function') window.showToast('Job-ready notifications turned off.', 'info');
    return;
  }
  Notification.requestPermission().then(permission => {
    if (permission === 'granted') {
      localStorage.setItem('eve_job_notifications', 'true');
      if (typeof window.showToast === 'function') window.showToast('You\'ll get a notification when a job is ready to collect.', 'success');
    } else {
      localStorage.setItem('eve_job_notifications', 'false');
      if (typeof window.showToast === 'function') window.showToast('Notification permission was not granted.', 'error');
    }
    updateJobNotificationButton();
  });
}
window.toggleJobNotifications = toggleJobNotifications;

// Matches real active EVE industry jobs (from ESI) against PENDING ledger jobs, by product + run
// count, and marks matches as started using the REAL start time and duration EVE calculated - this
// replaces this app's own time estimate with the actual in-game number once a job is confirmed
// running, and means you don't have to manually click Start for jobs you already started in-game.
async function syncWithEveIndustryJobs(silent) {
  const btn = document.getElementById('btn-sync-eve-jobs');
  const btnLabel = document.getElementById('btn-sync-eve-jobs-label');
  if (btn && !silent) { btn.disabled = true; if (btnLabel) btnLabel.textContent = 'Syncing...'; }

  const [charJobs, corpJobs, charBps, corpBps] = await Promise.all([
    typeof window.fetchActiveIndustryJobs === 'function' ? window.fetchActiveIndustryJobs() : null,
    typeof window.fetchActiveCorpIndustryJobs === 'function' ? window.fetchActiveCorpIndustryJobs() : [],
    typeof window.fetchCharacterBlueprints === 'function' ? window.fetchCharacterBlueprints() : [],
    typeof window.fetchCorpBlueprints === 'function' ? window.fetchCorpBlueprints() : []
  ]);

  if (btn) { btn.disabled = false; if (btnLabel) btnLabel.textContent = 'Sync EVE Jobs'; }

  console.info(`[JobSync] Fetched ${charJobs ? charJobs.length : 'null (fetch failed)'} character job(s), ${corpJobs ? corpJobs.length : 0} corp job(s), ${(charBps||[]).length} char blueprint(s), ${(corpBps||[]).length} corp blueprint(s).`);

  if (!charJobs && (!corpJobs || corpJobs.length === 0)) {
    if (!silent && typeof window.showToast === 'function') window.showToast('Could not fetch active industry jobs. Make sure you are logged in via EVE SSO - if you logged in before this feature existed, log out and back in once to grant the new Industry Jobs permissions.', 'error');
    return;
  }

  const activeCharId = window.getActiveCharId ? window.getActiveCharId() : null;
  const activeCharRecord = window.getActiveCharacterRecord ? window.getActiveCharacterRecord() : null;

  // Tag each raw job with which endpoint it came from BEFORE merging - personal (this character's
  // own /characters/{id}/industry/jobs/) vs. corp (any corp member's, via /corporations/{id}/
  // industry/jobs/, requires Factory Manager). The merge below used to discard this distinction
  // entirely, which meant an auto-imported job had no way to know whether it should be tagged
  // personal-to-this-character or shared-corp-wide (see buildAutoImportedJob below, and the ledger
  // visibility filter in renderActiveJobsList).
  (charJobs || []).forEach(j => { if (j) j._source = 'personal'; });
  (corpJobs || []).forEach(j => { if (j) j._source = 'corp'; });

  // Merge character jobs (this character's own) with corp jobs (any corp member's, if this character
  // has the Factory Manager role) - dedupe by job_id in case the same job appears in both.
  const seenJobIds = new Set();
  const allRealJobs = [...(charJobs || []), ...(corpJobs || [])].filter(j => {
    if (!j || seenJobIds.has(j.job_id)) return false;
    seenJobIds.add(j.job_id);
    return true;
  });

  // Only manufacturing (1) and reaction jobs represent "building an item" the way the ledger models
  // it - research/copying/invention jobs are skipped. Reaction is documented as activity_id 11, but
  // ESI has a long-standing, confirmed inconsistency (see esi-issues#997) where it sometimes reports
  // real reaction jobs as activity_id 9 instead - an undocumented value that doesn't appear in the
  // SDE's own ramActivities table at all. Checking only 11 silently dropped any job ESI happened to
  // tag this way, with no error or warning to explain why it never showed up.
  const activeRealJobs = allRealJobs.filter(j => j && j.status === 'active' && (j.activity_id === 1 || j.activity_id === 9 || j.activity_id === 11));
  console.info(`[JobSync] ${activeRealJobs.length} active manufacturing/reaction job(s) out of ${allRealJobs.length} total fetched.`);
  activeRealJobs.forEach(rj => {
    console.info(`[JobSync]   Active real job: job_id=${rj.job_id}, product_type_id=${rj.product_type_id}, blueprint_id=${rj.blueprint_id}, blueprint_type_id=${rj.blueprint_type_id}, activity_id=${rj.activity_id}, runs=${rj.runs}`);
  });

  // Real ME/TE for the specific blueprint instance used, keyed by blueprint_id (item_id) - this is a
  // separate endpoint from industry jobs, since a job's blueprint_id only references the item, not
  // its research level.
  const blueprintMeTeMap = {};
  [...(charBps || []), ...(corpBps || [])].forEach(bp => {
    if (bp && bp.item_id !== undefined) {
      blueprintMeTeMap[bp.item_id] = { me: bp.material_efficiency || 0, te: bp.time_efficiency || 0 };
    }
  });

  // A corp job's blueprint may be personally owned by whichever corp-mate ran it, not a corp asset -
  // charBps/corpBps above only ever see the ACTIVE character's own blueprints plus the corp's own
  // assets, never a registered corp-mate's personal one. Widen visibility by also fetching every
  // OTHER registered character sharing this corp's own blueprint list, using each one's own stored
  // token (read-only, no token/character gets switched active by this). Closes the exact gap behind
  // "a corp job auto-imported instead of matching a pending job with the right ME/TE" for any
  // corp-mate who's also registered in this tool.
  if (typeof window.getRegisteredCharactersInActiveCorp === 'function' && typeof window.fetchCharacterBlueprints === 'function') {
    const corpMates = window.getRegisteredCharactersInActiveCorp().filter(c => c.charId !== activeCharId);
    if (corpMates.length) {
      const corpMateBps = await Promise.all(corpMates.map(c => window.fetchCharacterBlueprints(c.charId, c.accessToken)));
      let addedCount = 0;
      corpMateBps.forEach((bps, i) => {
        (bps || []).forEach(bp => {
          if (bp && bp.item_id !== undefined && blueprintMeTeMap[bp.item_id] === undefined) {
            blueprintMeTeMap[bp.item_id] = { me: bp.material_efficiency || 0, te: bp.time_efficiency || 0 };
            addedCount++;
          }
        });
        console.info(`[JobSync] Fetched ${(bps || []).length} blueprint(s) owned by registered corp-mate "${corpMates[i].charName}".`);
      });
      if (addedCount) console.info(`[JobSync] ${addedCount} blueprint(s) newly visible via registered corp-mates (not already covered by your own or the corp's blueprints).`);
    }
  }

  loadJournalState();

  // Backfill ownership onto jobs that are already tracked (isStarted + eveJobId) but still carry no
  // scope - either synced before the ownership-tagging feature existed, or matched before this
  // character was registered. Pass 1/2 below only ever touch UNtracked real jobs (see
  // alreadyTrackedEveJobIds just below, which exists specifically to skip re-processing these) - so
  // without this pass, an old in-progress job would carry scope:undefined forever no matter how many
  // times you sync, which silently defeats the Personal/Corp filter for exactly the in-progress jobs
  // it matters most for (reported directly: "the corp filter doesn't seem to be changing anything,
  // even though most of the in-progress jobs are corp jobs"). Matches purely by eveJobId against this
  // sync's own freshly-tagged real job list - the same _source/installer_id trust Pass 1 already
  // applies to a brand-new match, just applied retroactively. A job whose real ESI job has since
  // completed (no longer in the active list at all) can't be backfilled this way and keeps showing
  // regardless of the filter, same as any other legacy/unassigned job.
  let backfilledOwnershipCount = 0;
  activeJobs.forEach(job => {
    if (!job || !job.isStarted || job.eveJobId === undefined || job.scope) return;
    const rj = activeRealJobs.find(r => r.job_id === job.eveJobId);
    if (!rj) return;
    job.scope = rj._source === 'corp' ? 'corp' : 'personal';
    job.corpId = rj._source === 'corp' ? (activeCharRecord ? activeCharRecord.corpId : undefined) : undefined;
    if (rj.installer_id !== undefined) job.ownerCharId = String(rj.installer_id);
    backfilledOwnershipCount++;
  });
  if (backfilledOwnershipCount) console.info(`[JobSync] Backfilled character ownership onto ${backfilledOwnershipCount} already-tracked in-progress job(s) that predated ownership tracking.`);

  // Anything already tracked by an existing STARTED ledger job (from a previous sync), OR already
  // marked Built and moved to history, must be skipped here - otherwise every sync re-imports the
  // same real job as a brand new duplicate. History matters just as much as active jobs: if you mark
  // a job Built in the app but haven't clicked Deliver in EVE yet, ESI keeps reporting that job as
  // active, and the very next silent auto-sync (which runs on every page load) would otherwise see it
  // as untracked and bring it back as a "new" ready-to-collect job.
  const alreadyTrackedEveJobIds = new Set([
    ...activeJobs.filter(j => j && j.isStarted && j.eveJobId !== undefined).map(j => j.eveJobId),
    ...buildHistory.filter(r => r && r.eveJobId !== undefined).map(r => r.eveJobId)
  ]);
  const untrackedRealJobs = activeRealJobs.filter(rj => !alreadyTrackedEveJobIds.has(rj.job_id));
  console.info(`[JobSync] ${activeRealJobs.length - untrackedRealJobs.length} real job(s) already tracked by an existing started ledger job - skipping those, ${untrackedRealJobs.length} remain to match/import.`);

  const usedRealJobIds = new Set();
  let matchedCount = 0;
  let importedCount = 0;

  // Pass 1: match against existing PENDING ledger jobs. A real job's run count fitting inside a
  // larger pending job's run count splits it (started fragment + still-queued remainder) - the same
  // thing a manual partial "Start Job" already does - rather than ever creating a redundant duplicate.
  untrackedRealJobs.forEach(rj => {
    if (usedRealJobIds.has(rj.job_id)) return;
    const targetProductId = rj.product_type_id;
    // The real blueprint's ACTUAL researched ME/TE (from ESI, same source buildAutoImportedJob's own
    // Pass 2 already trusts) must match what the pending job's own material/time numbers were
    // calculated with (its buildConfigSnapshot's per-blueprint override, defaulting to 0/0 the same
    // way tree.js's own node.customME/customTE default - see its own comment). A pending job assumes
    // fixed ME/TE at add-time; if the blueprint actually used in-game was researched differently, the
    // pending job's materials are for the WRONG numbers, and splitting them would silently carry that
    // mismatch into both fragments. Safer to treat it as no fit at all and let it auto-import in Pass
    // 2 instead, which always computes fresh from the real ME/TE.
    const realBpInfo = blueprintMeTeMap[rj.blueprint_id] || { me: 0, te: 0 };
    const candidates = activeJobs
      .filter(j => {
        if (!j || j.isStarted || (j.productTypeId || j.typeId) !== targetProductId || j.runsNeeded < rj.runs) return false;
        const snapshot = j.buildConfigSnapshot || {};
        const jobME = (snapshot.customMEOverrides && snapshot.customMEOverrides[j.typeId] !== undefined) ? snapshot.customMEOverrides[j.typeId] : 0;
        const jobTE = (snapshot.customTEOverrides && snapshot.customTEOverrides[j.typeId] !== undefined) ? snapshot.customTEOverrides[j.typeId] : 0;
        return jobME === realBpInfo.me && jobTE === realBpInfo.te;
      })
      .sort((a, b) => a.runsNeeded - b.runsNeeded); // smallest sufficient fit first, to avoid attributing a small job to a much larger unrelated one
    const candidate = candidates[0];
    if (!candidate) {
      // Logs WHY each same-product pending job was rejected (too few runs vs. ME/TE mismatch vs.
      // already started), not just that none fit - the combined boolean filter above can't tell them
      // apart on its own, and guessing which one applied from outside the browser is not possible.
      // See the conversation that led here: a 32-run pending job silently not absorbing a 57-run real
      // job looked identical in the log to a genuine ME/TE mismatch until this existed.
      const sameProductPending = activeJobs.filter(j => j && (j.productTypeId || j.typeId) === targetProductId);
      if (sameProductPending.length) {
        console.info(`[JobSync]   ⚠ Real job_id=${rj.job_id} (blueprint_id=${rj.blueprint_id}, ME=${realBpInfo.me}%, TE=${realBpInfo.te}%, runs=${rj.runs}) found ${sameProductPending.length} pending/active job(s) for the same product, but none matched - falling through to auto-import. Detail:`);
        sameProductPending.forEach(j => {
          const snapshot = j.buildConfigSnapshot || {};
          const jobME = (snapshot.customMEOverrides && snapshot.customMEOverrides[j.typeId] !== undefined) ? snapshot.customMEOverrides[j.typeId] : 0;
          const jobTE = (snapshot.customTEOverrides && snapshot.customTEOverrides[j.typeId] !== undefined) ? snapshot.customTEOverrides[j.typeId] : 0;
          const reasons = [];
          if (j.isStarted) reasons.push('already started');
          if (j.runsNeeded < rj.runs) reasons.push(`too few runs (has ${j.runsNeeded}, real job needs ${rj.runs})`);
          if (jobME !== realBpInfo.me || jobTE !== realBpInfo.te) reasons.push(`ME/TE mismatch (ledger assumed ME=${jobME}%/TE=${jobTE}%, real blueprint is ME=${realBpInfo.me}%/TE=${realBpInfo.te}%)`);
          console.info(`[JobSync]     - "${j.name}" (id=${j.id}, runs=${j.runsNeeded}): ${reasons.length ? reasons.join('; ') : 'unknown reason'}`);
        });
      }
      return; // no fit among pending jobs - falls through to auto-import in pass 2
    }

    usedRealJobIds.add(rj.job_id);
    matchedCount++;
    const jobIndex = activeJobs.findIndex(j => j.id === candidate.id);
    if (jobIndex === -1) return;

    const startedAt = new Date(rj.start_date).getTime();
    const totalBuildSeconds = Math.max(0, (new Date(rj.end_date).getTime() - startedAt) / 1000);

    // A manually-planned job is tagged with whoever's active at add-time (or nobody, if planned while
    // logged out) since there's no way yet to know who'll actually run it - now that a real match
    // confirms it, the REAL data wins: update the scope/owner to what ESI actually reports rather than
    // trusting the original guess. installer_id is the real character who ran it (for a corp job this
    // is very often a DIFFERENT character than whoever's active/synced it) - this is what lets a
    // previously-unassigned or differently-guessed job show "which character the job is on" once it's
    // actually started, same as a fresh auto-import already does (see buildAutoImportedJob). candidate
    // and activeJobs[jobIndex] are the same object (candidate came from filtering activeJobs), so this
    // mutation is picked up by both the full-match branch below and the split-fragment spread.
    candidate.scope = rj._source === 'corp' ? 'corp' : 'personal';
    candidate.corpId = rj._source === 'corp' ? (window.getActiveCharacterRecord ? (window.getActiveCharacterRecord() || {}).corpId : undefined) : undefined;
    if (rj.installer_id !== undefined) candidate.ownerCharId = String(rj.installer_id);

    if (rj.runs >= candidate.runsNeeded) {
      console.info(`[JobSync]   ✔ MATCHED "${candidate.name}" (full ${candidate.runsNeeded} runs) to real job_id=${rj.job_id}`);
      activeJobs[jobIndex].isStarted = true;
      // See startJobRuns' own comment on job.assetsExpiryAtStart for what this stamps and why.
      activeJobs[jobIndex].assetsExpiryAtStart = window.getEsiAssetsExpiry ? window.getEsiAssetsExpiry() : null;
      activeJobs[jobIndex].startedAt = startedAt;
      activeJobs[jobIndex].totalBuildSeconds = totalBuildSeconds;
      activeJobs[jobIndex].eveJobId = rj.job_id;
    } else {
      console.info(`[JobSync]   ✔ MATCHED "${candidate.name}" - splitting: ${rj.runs} of ${candidate.runsNeeded} runs started (job_id=${rj.job_id}), ${candidate.runsNeeded - rj.runs} remain pending`);
      const totalRuns = candidate.runsNeeded;
      const startRuns = rj.runs;
      const ratio = startRuns / totalRuns;
      const remainingRuns = totalRuns - startRuns;
      const remainingRatio = remainingRuns / totalRuns;

      // A multi-job plan (candidate.jobCount > 1 - see runsDisplayHTML's own comment on why this
      // differs from an ordinary continuous-run job) is jobCount SEPARATE real jobs of runsPerJob
      // runs each - one matched real job is exactly ONE of those jobs finishing, not a proportional
      // slice of one giant job. Without this, both fragments below (built via `...candidate`) kept the
      // ORIGINAL jobCount/runsPerJob completely unchanged - reported directly: starting 2 of 11
      // planned 12-run jobs showed as "11 Jobs x 12 Runs" on BOTH newly-started fragments (should each
      // read plain "12 Runs" - a single job) AND the still-pending remainder (should have dropped to
      // "9 Jobs x 12 Runs", but visibly never shrank at all no matter how many real jobs synced).
      // Derived from the run counts themselves (startRuns/remainingRuns divided by perJobRuns) rather
      // than subtracting from candidate.jobCount directly - runsNeeded has always been tracked
      // correctly through every split (only the jobCount/runsPerJob display metadata went stale), so
      // deriving from it self-heals an already-corrupted pending entry the very next time a real job
      // matches it, even one left over from before this fix existed, without needing its stored
      // jobCount to already be right. An ordinary (non-multi-job) candidate has no runsPerJob at all,
      // so perJobRuns falls back to its own full runsNeeded - that makes startedJobCount and
      // remainingJobCount both come out as 1 (via the rounding below), which normalizes right back to
      // today's plain-runs display for that case (see runsDisplayHTML: jobCount <= 1 is the same
      // "just show runsNeeded" path whether jobCount is 1, 0, or absent) - no behavior change for the
      // common single-job case.
      const perJobRuns = candidate.runsPerJob || candidate.runsNeeded;
      const startedJobCount = perJobRuns > 0 ? Math.max(1, Math.round(startRuns / perJobRuns)) : 1;
      const remainingJobCount = perJobRuns > 0 ? Math.max(0, Math.round(remainingRuns / perJobRuns)) : 0;

      // Split each material's total between the two fragments WITHOUT rounding each side
      // independently. m.qtyNeeded already went through Math.ceil once (calculateInputQuantity, for
      // the full totalRuns) - re-ceiling BOTH ratio*qtyNeeded and (1-ratio)*qtyNeeded separately can
      // round up twice on the same total, but the real danger is the STARTED side specifically: it can
      // come out LOWER than a fresh single-run calculation would give (provably, ceil(ceil(n*x)*r) <=
      // ceil(x) for r=1/n). The started side is what gets subtracted from the shared stock pool as
      // "already consumed" when the BOM renders - an under-counted started side leaves MORE apparent
      // stock for every job rendered after it than physically exists, which is exactly "the ledger
      // looked fine, then I ran out in game." Ceiling only the started side (conservative: assume at
      // least this much was really consumed) and deriving the remaining side as the exact complement
      // guarantees the two fragments always sum back to the trusted original total - no material
      // invented or lost in the split, and no phantom stock leaking into later jobs.
      const splitMaterials = () => {
        const started = [], remaining = [];
        (Array.isArray(candidate.materials) ? candidate.materials : []).forEach(m => {
          const startedQty = Math.min(m.qtyNeeded, Math.ceil(m.qtyNeeded * ratio));
          const remainingQty = Math.max(0, m.qtyNeeded - startedQty);
          const startedStock = Math.min(m.stockQty || 0, startedQty);
          const remainingStock = (m.stockQty || 0) - startedStock;
          started.push({ ...m, qtyNeeded: startedQty, stockQty: startedStock, netQtyNeeded: Math.max(0, startedQty - startedStock), lineCost: (m.unitPrice || 0) * Math.max(0, startedQty - startedStock) });
          remaining.push({ ...m, qtyNeeded: remainingQty, stockQty: remainingStock, netQtyNeeded: Math.max(0, remainingQty - remainingStock), lineCost: (m.unitPrice || 0) * Math.max(0, remainingQty - remainingStock) });
        });
        return { started, remaining };
      };
      const { started: startedMaterials, remaining: remainingMaterials } = splitMaterials();

      const activeFragment = {
        ...candidate,
        id: Date.now() + Math.floor(Math.random() * 1000),
        runsNeeded: startRuns,
        jobCount: startedJobCount,
        runsPerJob: perJobRuns,
        qtyNeeded: Math.round((candidate.qtyNeeded || 0) * ratio),
        calculatedCost: (candidate.calculatedCost || 0) * ratio,
        netProfit: candidate.netProfit !== undefined ? candidate.netProfit * ratio : undefined,
        totalBuildSeconds: totalBuildSeconds,
        materials: startedMaterials,
        startedAt: startedAt,
        isStarted: true,
        // See startJobRuns' own comment on job.assetsExpiryAtStart for what this stamps and why.
        assetsExpiryAtStart: window.getEsiAssetsExpiry ? window.getEsiAssetsExpiry() : null,
        eveJobId: rj.job_id,
        splitFromId: candidate.id
      };
      const remainingFragment = {
        ...candidate,
        id: Date.now() + Math.floor(Math.random() * 1000) + 1,
        runsNeeded: remainingRuns,
        jobCount: remainingJobCount,
        runsPerJob: perJobRuns,
        qtyNeeded: Math.round((candidate.qtyNeeded || 0) * remainingRatio),
        calculatedCost: (candidate.calculatedCost || 0) * remainingRatio,
        netProfit: candidate.netProfit !== undefined ? candidate.netProfit * remainingRatio : undefined,
        totalBuildSeconds: (candidate.totalBuildSeconds || 0) * remainingRatio,
        materials: remainingMaterials,
        startedAt: undefined,
        isStarted: false,
        splitFromId: candidate.id
      };
      activeJobs.splice(jobIndex, 1, activeFragment, remainingFragment);
    }
  });

  // Pass 2: any remaining active real job with no ledger counterpart gets auto-imported - built as a
  // real recipe tree using the blueprint's ACTUAL researched ME/TE, priced at market sell only.
  for (const rj of untrackedRealJobs) {
    if (usedRealJobIds.has(rj.job_id)) continue;
    console.info(`[JobSync]   ⬇ No pending job fits real job_id=${rj.job_id} (product ${rj.product_type_id}, ${rj.runs} runs) - auto-importing.`);
    const imported = await buildAutoImportedJob(rj, blueprintMeTeMap);
    if (imported) {
      activeJobs.push(imported);
      importedCount++;
    } else {
      console.warn(`[JobSync]   ✘ Auto-import failed for real job_id=${rj.job_id} - see warnings above for why.`);
    }
  }

  localStorage.setItem('eve_ledger_jobs', JSON.stringify(activeJobs));
  renderJournalPage();

  if (!silent && typeof window.showToast === 'function') {
    if (matchedCount === 0 && importedCount === 0) {
      window.showToast('No active EVE industry jobs found to sync (or none matched/imported). Check the browser console for [JobSync] diagnostic details.', 'info');
    } else {
      window.showToast(`Synced ${matchedCount} job(s) against existing plans, auto-imported ${importedCount} job(s) with no prior plan - using EVE's real start time, duration, and researched ME/TE.`, 'success');
    }
  }
}
window.syncWithEveIndustryJobs = syncWithEveIndustryJobs;

// Builds a full ledger job entry for a real EVE industry job that has no matching pending plan,
// using the tool's own recipe database and the blueprint's ACTUAL researched ME/TE (fetched
// separately, since the industry jobs endpoint doesn't carry that). Prices materials and output at
// market sell only, per instruction - no buy/sell strategy modeling for auto-imports.
async function buildAutoImportedJob(realJob, blueprintMeTeMap) {
  try {
    const blueprintTypeId = realJob.blueprint_type_id;
    const productTypeId = realJob.product_type_id;
    const runs = realJob.runs;
    const bpInfo = blueprintMeTeMap[realJob.blueprint_id] || { me: 0, te: 0 };
    console.info(`[JobSync]   Blueprint ME/TE for blueprint_id=${realJob.blueprint_id}: ME=${bpInfo.me}%, TE=${bpInfo.te}% ${blueprintMeTeMap[realJob.blueprint_id] === undefined ? '(not found in your blueprints list - defaulting to 0/0, verify this against the job in-game)' : ''}`);

    if (typeof window.buildRecursiveRecipeTree !== 'function') {
      console.warn('[JobSync] Recipe tree builder not available - cannot auto-import.');
      return null;
    }

    window.customMEOverrides = window.customMEOverrides || {};
    window.customTEOverrides = window.customTEOverrides || {};
    window.customMEOverrides[blueprintTypeId] = bpInfo.me;
    window.customTEOverrides[blueprintTypeId] = bpInfo.te;
    window.recipeTreeRootProductTypeId = productTypeId; // we already know this for certain from ESI

    const productName = (window.TYPE_ID_TO_NAME && window.TYPE_ID_TO_NAME[productTypeId]) || (window.EVE_ITEMS && window.EVE_ITEMS[productTypeId]) || `Item ${productTypeId}`;
    // A reaction's source item is a "Reaction Formula", never a "Blueprint" - matters here because
    // this constructed name is what resolveProductIdFromBlueprintName() would parse if
    // recipeTreeRootProductTypeId (set just above, and normally what actually resolves the root)
    // were ever unset, and it's also just what ends up labeling the node before downstream suffix-
    // stripping cleans it up.
    const isReactionJob = realJob.activity_id === 9 || realJob.activity_id === 11;
    const sourceName = productName + (isReactionJob ? ' Reaction Formula' : ' Blueprint');

    let root;
    try {
      // qty is a rough guess (batch yield unknown until the recipe resolves) - corrected below.
      root = await window.buildRecursiveRecipeTree(blueprintTypeId, sourceName, runs, 0, 6, new Set(), null);
    } finally {
      window.recipeTreeRootProductTypeId = null; // don't leak into unrelated calls
    }

    if (!root) {
      console.warn(`[JobSync] Could not resolve a recipe for blueprint_type_id=${blueprintTypeId} (product ${productTypeId}) - this item may not be in your local database. Try regenerating it.`);
      return null;
    }

    // Force the EXACT real run count (the tree derives runs from a qty/batchYield guess, which we
    // don't know in advance) and re-cascade quantities through the tree with the corrected count.
    root.runsNeeded = runs;
    root.qtyNeeded = runs * (root.batchYield || 1);
    const facility = (window.getActiveStructureType ? window.getActiveStructureType().meBonus : 1.0) / 100;
    if (typeof window.scaleTreeQuantities === 'function') window.scaleTreeQuantities(root, facility);

    const allTypeIds = new Set();
    if (typeof window.collectAllTypeIds === 'function') window.collectAllTypeIds(root, allTypeIds);
    if (typeof window.fetchMarketPrices === 'function') await window.fetchMarketPrices(Array.from(allTypeIds));
    if (typeof window.calculateNodeEIV === 'function') window.calculateNodeEIV(root);

    const materialCost = typeof window.calculateTreeNodeCost === 'function' ? window.calculateTreeNodeCost(root) : 0;
    // ESI's own reported job installation fee is more accurate here than re-estimating our own -
    // it's the real ISK EVE actually charged for this specific job.
    const totalCost = materialCost + (realJob.cost || 0);

    const outputPrices = window.priceCache[productTypeId] || { sell: 0, buy: 0 };
    const grossSell = outputPrices.sell * root.qtyNeeded;
    const netProfit = grossSell - totalCost;

    const totalBuildSeconds = Math.max(0, (new Date(realJob.end_date).getTime() - new Date(realJob.start_date).getTime()) / 1000);
    const materials = typeof window.extractJobMaterialsForNode === 'function' ? window.extractJobMaterialsForNode(root) : [];

    // Ownership tag: 'personal' jobs came from THIS character's own /industry/jobs/ endpoint (realJob
    // was tagged _source:'personal' before the charJobs/corpJobs merge, above) and stay scoped to
    // whoever is logged in when the sync ran; 'corp' jobs came from the corp endpoint (any member,
    // requires Factory Manager) and become visible to every registered character sharing that corp -
    // see renderActiveJobsList's own visibility filter. installer_id (who actually ran it in-game) is
    // ESI's own field, kept for personal jobs' ownerCharId even though today it's always the active
    // character for a 'personal'-sourced job (their own jobs endpoint can only ever return jobs THEY
    // installed) - corp jobs use it for real, since the installer is often a different corp-mate.
    const activeCharId = window.getActiveCharId ? window.getActiveCharId() : null;
    const activeCorpId = window.getActiveCharacterRecord ? (window.getActiveCharacterRecord() || {}).corpId : null;
    const scope = realJob._source === 'corp' ? 'corp' : 'personal';

    return {
      id: Date.now() + Math.floor(Math.random() * 1000) + realJob.job_id,
      typeId: blueprintTypeId,
      productTypeId: productTypeId,
      name: productName,
      runsNeeded: runs,
      qtyNeeded: root.qtyNeeded,
      calculatedCost: totalCost,
      totalBuildSeconds: totalBuildSeconds,
      netProfit: netProfit,
      sellStrategy: 'market-sell',
      unitSellPrice: outputPrices.sell,
      materials: materials,
      isStarted: true,
      // See startJobRuns' own comment on job.assetsExpiryAtStart for what this stamps and why.
      assetsExpiryAtStart: window.getEsiAssetsExpiry ? window.getEsiAssetsExpiry() : null,
      startedAt: new Date(realJob.start_date).getTime(),
      eveJobId: realJob.job_id,
      autoImported: true,
      meLevel: bpInfo.me,
      teLevel: bpInfo.te,
      scope: scope,
      ownerCharId: realJob.installer_id !== undefined ? String(realJob.installer_id) : activeCharId,
      corpId: scope === 'corp' ? activeCorpId : undefined,
      addedAt: new Date().toISOString()
    };
  } catch (e) {
    console.warn(`[JobSync] Auto-import threw an error for job_id=${realJob.job_id}:`, e);
    return null;
  }
}


function collectAllReadyJobs() {
  loadJournalState();
  const readyJobs = activeJobs.filter(j => j && j.isStarted && j.startedAt && ((Date.now() - j.startedAt) / 1000 >= (j.totalBuildSeconds || 0)));
  if (readyJobs.length === 0) {
    if (typeof window.showToast === 'function') window.showToast('No jobs are ready to collect yet.', 'info');
    return;
  }
  readyJobs.forEach(j => markJobAsBuilt(j.id));
}
window.collectAllReadyJobs = collectAllReadyJobs;

function markJobAsBuilt(jobId) {
  loadJournalState();
  const jobIndex = activeJobs.findIndex(j => j && j.id === jobId);
  if (jobIndex === -1) return;
  const job = activeJobs[jobIndex];

  const record = {
    id: job.id,
    typeId: job.typeId,
    productTypeId: job.productTypeId,
    name: job.name,
    runsNeeded: job.runsNeeded,
    qtyNeeded: job.qtyNeeded,
    calculatedCost: job.calculatedCost,
    netProfit: job.netProfit,
    isSubBuild: job.isSubBuild,
    parentJobId: job.parentJobId,
    parentJobName: job.parentJobName,
    autoImported: job.autoImported,
    materials: job.materials,
    eveJobId: job.eveJobId,
    baseTime: job.baseTime,
    totalBuildSeconds: job.totalBuildSeconds,
    // Carried through so a re-queued job (see requeueCompletedJob) still knows what preset/build-vs-
    // buy configuration produced these numbers, instead of silently falling back to "whatever's live
    // right now" the moment it's ever recomputed (run count/preset change) after being re-queued.
    productionSnapshot: job.productionSnapshot,
    buildConfigSnapshot: job.buildConfigSnapshot,
    // Same reason - a re-queued job should stay scoped to whoever it originally belonged to, not
    // silently become visible to everyone (or nobody) just because it round-tripped through history.
    scope: job.scope,
    ownerCharId: job.ownerCharId,
    corpId: job.corpId,
    completedAt: new Date().toISOString()
  };

  buildHistory.unshift(record);
  localStorage.setItem('eve_ledger_history', JSON.stringify(buildHistory));

  activeJobs.splice(jobIndex, 1);
  localStorage.setItem('eve_ledger_jobs', JSON.stringify(activeJobs));

  renderJournalPage();
}

function requeueCompletedJob(recordId) {
  loadJournalState();
  const recordIndex = buildHistory.findIndex(r => r && r.id === recordId);
  if (recordIndex === -1) return;
  const record = buildHistory[recordIndex];

  const job = {
    id: Date.now() + Math.floor(Math.random() * 1000), 
    typeId: record.typeId,
    productTypeId: record.productTypeId,
    name: record.name,
    runsNeeded: record.runsNeeded,
    qtyNeeded: record.qtyNeeded,
    calculatedCost: record.calculatedCost,
    materials: record.materials || [],
    baseTime: record.baseTime,
    totalBuildSeconds: record.totalBuildSeconds,
    productionSnapshot: record.productionSnapshot,
    buildConfigSnapshot: record.buildConfigSnapshot,
    scope: record.scope,
    ownerCharId: record.ownerCharId,
    corpId: record.corpId,
    addedAt: new Date().toISOString()
  };

  activeJobs.push(job);
  localStorage.setItem('eve_ledger_jobs', JSON.stringify(activeJobs));

  renderJournalPage();
}

function deleteJobFromQueue(jobId) {
  loadJournalState();
  const index = activeJobs.findIndex(j => j && j.id === jobId);
  if (index === -1) return;
  const job = activeJobs[index];

  // Cascade: delete this job AND every prerequisite job queued under it, recursively (a prereq can
  // itself have its own prereq) - left behind, they became orphaned jobs with nothing to belong to
  // instead of actually going away with the job they were queued for. parentJobId (the real per-job
  // link) is checked first; the name-based fallback only matters for a sub-build saved before that
  // field existed.
  const toDelete = new Set([jobId]);
  let addedMore = true;
  while (addedMore) {
    addedMore = false;
    activeJobs.forEach(j => {
      if (!j || toDelete.has(j.id) || !j.isSubBuild) return;
      const belongsToDeleted = (j.parentJobId !== undefined && j.parentJobId !== null)
        ? toDelete.has(j.parentJobId)
        : Array.from(toDelete).some(id => activeJobs.find(x => x && x.id === id)?.name === j.parentJobName);
      if (belongsToDeleted) { toDelete.add(j.id); addedMore = true; }
    });
  }

  // Snapshot each removed job with its original index so Undo can restore the exact original
  // ordering, not just re-append everything at the end of the queue.
  const removed = activeJobs
    .map((j, i) => ({ job: j, i }))
    .filter(({ job: j }) => j && toDelete.has(j.id))
    .sort((a, b) => a.i - b.i);

  // If a SURVIVING job is a pooled cross-parent prerequisite (see combineDuplicateJobs' Pass B) that
  // included one of the jobs being deleted among its sharedParentIds, scrub that reference - otherwise
  // it would keep claiming to still feed a job that no longer exists. Down to exactly one remaining
  // parent, it's no longer meaningfully "shared" any more, so it un-pools back into a normal single-
  // parent prerequisite instead of staying a 1-item "shared" list forever. Each affected job's PRIOR
  // state is captured alongside `removed` so Undo can restore it exactly, not just leave the scrub in
  // place after bringing the deleted job(s) back.
  const scrubbed = [];
  activeJobs.forEach(j => {
    if (!j || toDelete.has(j.id) || !Array.isArray(j.sharedParentIds) || j.sharedParentIds.length === 0) return;
    const remainingParentIds = j.sharedParentIds.filter(id => !toDelete.has(id));
    if (remainingParentIds.length === j.sharedParentIds.length) return; // none of its parents were deleted
    scrubbed.push({ jobId: j.id, prevSharedParentIds: j.sharedParentIds, prevParentJobId: j.parentJobId, prevParentJobName: j.parentJobName });
    if (remainingParentIds.length >= 2) {
      j.sharedParentIds = remainingParentIds;
    } else if (remainingParentIds.length === 1) {
      const soleParent = activeJobs.find(x => x && x.id === remainingParentIds[0]);
      j.parentJobId = remainingParentIds[0];
      j.parentJobName = soleParent ? soleParent.name : j.parentJobName;
      delete j.sharedParentIds;
    } else {
      j.sharedParentIds = []; // every job it served was deleted at once - left parent-less rather than inventing a fake link
    }
  });

  activeJobs = activeJobs.filter(j => !j || !toDelete.has(j.id));
  localStorage.setItem('eve_ledger_jobs', JSON.stringify(activeJobs));
  renderJournalPage();

  const prereqCount = removed.length - 1;
  const message = prereqCount > 0
    ? `Removed "${job.name}" and ${prereqCount} prerequisite job${prereqCount > 1 ? 's' : ''} from the queue.`
    : `Removed "${job.name}" from the queue.`;

  if (typeof window.showToast === 'function') {
    window.showToast(message, 'info', { action: { label: 'Undo', onClick: () => {
      loadJournalState();
      removed.forEach(({ job: j, i }) => {
        activeJobs.splice(Math.min(i, activeJobs.length), 0, j);
      });
      scrubbed.forEach(({ jobId, prevSharedParentIds, prevParentJobId, prevParentJobName }) => {
        const stillThere = activeJobs.find(x => x && x.id === jobId);
        if (!stillThere) return;
        stillThere.sharedParentIds = prevSharedParentIds;
        stillThere.parentJobId = prevParentJobId;
        stillThere.parentJobName = prevParentJobName;
      });
      localStorage.setItem('eve_ledger_jobs', JSON.stringify(activeJobs));
      renderJournalPage();
    } } });
  }
}

function renderBuildHistoryLedger() {
  const container = document.getElementById('journal-history-rows');
  if (!container) return;

  const totalProfitEl = document.getElementById('journal-history-total-profit');
  const historyCountEl = document.getElementById('journal-history-count');
  if (historyCountEl) historyCountEl.textContent = buildHistory.length.toLocaleString();
  if (totalProfitEl) {
    let totalHistoryProfit = 0;
    let historyProfitMissing = false;
    buildHistory.forEach(record => {
      if (record) {
        // History records use their own stored netProfit directly - NOT getEffectiveJobProfit(), which
        // applies the stock-credit toggle. A completed job's profit is a fixed historical fact from
        // when it finished; it shouldn't fluctuate based on a live "with/without stock credit" display
        // preference the way a still-pending job's projected profit reasonably can.
        if (record.netProfit !== undefined) {
          totalHistoryProfit += record.netProfit;
        } else if (!record.isSubBuild) {
          historyProfitMissing = true;
        }
      }
    });
    totalProfitEl.textContent = Math.round(totalHistoryProfit).toLocaleString() + ' ISK' + (historyProfitMissing ? ' *' : '');
    totalProfitEl.className = 'font-bold text-xs';
    totalProfitEl.style.color = totalHistoryProfit >= 0 ? 'var(--green)' : 'var(--red)';
  }

  if (buildHistory.length === 0) {
    container.innerHTML = `
      <tr>
        <td colspan="7" class="p-4 text-center mono italic" style="color:var(--text-mute);">
          No completed build records logged in ledger history database.
        </td>
      </tr>
    `;
    return;
  }

  // Sales tax + broker fee for the break-even column below - read from the same shared
  // 'eve_tax_settings' localStorage key the Calculator/Invention pages write to (see
  // loadSharedTaxSettings there), not getActiveFeeInputs(), which reads DOM input fields this page
  // doesn't have and would silently fall back to its own hardcoded defaults every time. Falls back
  // to those same defaults (3.6%/1.0%) only when nothing's been configured anywhere yet.
  const sharedTaxSettings = window.safeParseJSON(localStorage.getItem('eve_tax_settings'), {});
  const salesTaxPct = parseFloat(sharedTaxSettings.salesTax) || 3.6;
  const brokerFeePct = parseFloat(sharedTaxSettings.brokerFee) || 1.0;
  const netSellFraction = 1 - (salesTaxPct + brokerFeePct) / 100;

  container.innerHTML = buildHistory.map(record => {
    if (!record) return '';
    const formattedDate = record.completedAt ? new Date(record.completedAt).toLocaleDateString() + ' ' + new Date(record.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A';
    const recordDisplayName = window.TYPE_ID_TO_NAME[record.productTypeId] || (record.name || '')
      .replace(/ Blueprint$/i, '').replace(/ Reaction Formula$/i, '').replace(/ Formula$/i, '').trim();
    // Minimum per-unit sell price that gets this job back to 0 profit: total manufacturing cost
    // spread across every unit produced, grossed back up to cover sales tax + broker fee on the
    // sale itself (selling at exactly cost/qty would still net a loss once those are taken out).
    const qtyProduced = record.qtyNeeded || 0;
    const breakEvenPrice = (qtyProduced > 0 && netSellFraction > 0) ? (record.calculatedCost || 0) / (qtyProduced * netSellFraction) : null;
    const breakEvenHTML = breakEvenPrice !== null ? `${Math.round(breakEvenPrice).toLocaleString()} ISK` : '&mdash;';
    return `
      <tr style="color:var(--text-soft);">
        <td>${formattedDate}</td>
        <td class="font-bold" style="color:var(--text);">${window.esc(recordDisplayName)}${record.isSubBuild ? `<span class="ml-1.5 text-xs font-semibold normal-case" style="color:var(--text-mute);" title="Prerequisite for: ${window.esc(getPrereqLabel(record))}">${window.svgIcon('gear')} prereq</span>` : ''}</td>
        <td class="text-right">${record.runsNeeded.toLocaleString()}</td>
        <td class="text-right font-bold" style="color:var(--accent);">${record.qtyNeeded.toLocaleString()}</td>
        <td class="text-right font-bold" style="color:var(--cost);">${Math.round(record.calculatedCost || 0).toLocaleString()} ISK</td>
        <td class="text-right font-bold" style="color:var(--text);" title="Sell at or above this per unit to at least break even, after ${salesTaxPct}% sales tax + ${brokerFeePct}% broker fee">${breakEvenHTML}</td>
        <td>
          <div class="flex items-center space-x-1.5">
            <button onclick="requeueCompletedJob(${record.id})" class="lp-chip-btn">
              ${window.svgIcon('refresh')} Re-queue
            </button>
            <button onclick="deleteHistoryRecord(${record.id})" class="lp-badge lp-badge-danger" style="cursor:pointer;" title="Delete this entry" aria-label="Delete this entry">
              ${window.svgIcon('x', { style: 'margin:0' })}
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function deleteHistoryRecord(recordId) {
  const index = buildHistory.findIndex(r => r && r.id === recordId);
  if (index === -1) return;
  const record = buildHistory[index];
  buildHistory.splice(index, 1);
  localStorage.setItem('eve_ledger_history', JSON.stringify(buildHistory));
  renderJournalPage();
  if (typeof window.showToast === 'function') {
    window.showToast(`Removed "${record.name}" from build history.`, 'info', { action: { label: 'Undo', onClick: () => {
      buildHistory.splice(index, 0, record);
      localStorage.setItem('eve_ledger_history', JSON.stringify(buildHistory));
      renderJournalPage();
    } } });
  }
}
window.deleteHistoryRecord = deleteHistoryRecord;

function clearJournalHistory() {
  if (buildHistory.length === 0) return;
  const count = buildHistory.length;
  const snapshot = buildHistory.slice();
  localStorage.removeItem('eve_ledger_history');
  renderJournalPage();
  if (typeof window.showToast === 'function') {
    window.showToast(`Cleared ${count.toLocaleString()} build history record(s).`, 'info', { action: { label: 'Undo', onClick: () => {
      buildHistory = snapshot.slice();
      localStorage.setItem('eve_ledger_history', JSON.stringify(buildHistory));
      renderJournalPage();
    } } });
  }
}

let _draggedJobId = null;

function handleJobDragStart(e, jobId) {
  _draggedJobId = jobId;
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', String(jobId)); } catch (err) {}
  if (e.currentTarget) e.currentTarget.classList.add('opacity-40');
}
window.handleJobDragStart = handleJobDragStart;

function handleJobDragEnd(e) {
  if (e.currentTarget) e.currentTarget.classList.remove('opacity-40');
  document.querySelectorAll('.job-card').forEach(el => el.classList.remove('ring-2', 'ring-cyan-400'));
  _draggedJobId = null;
}
window.handleJobDragEnd = handleJobDragEnd;

function handleJobDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  if (e.currentTarget) e.currentTarget.classList.add('ring-2', 'ring-cyan-400');
}
window.handleJobDragOver = handleJobDragOver;

function handleJobDragLeave(e) {
  if (e.currentTarget) e.currentTarget.classList.remove('ring-2', 'ring-cyan-400');
}
window.handleJobDragLeave = handleJobDragLeave;

// Dragging directly changes the array position, which is what drives stock allocation priority -
// same effect the old Up/Down buttons had, just without repeated clicking to move something far.
function handleJobDrop(e, targetJobId) {
  e.preventDefault();
  if (e.currentTarget) e.currentTarget.classList.remove('ring-2', 'ring-cyan-400');
  if (_draggedJobId === null || _draggedJobId === targetJobId) return;

  loadJournalState();
  const fromIndex = activeJobs.findIndex(j => j && j.id === _draggedJobId);
  const toIndex = activeJobs.findIndex(j => j && j.id === targetJobId);
  if (fromIndex === -1 || toIndex === -1) return;

  const [moved] = activeJobs.splice(fromIndex, 1);
  activeJobs.splice(toIndex, 0, moved);

  localStorage.setItem('eve_ledger_jobs', JSON.stringify(activeJobs));
  _draggedJobId = null;
  renderJournalPage();
}
window.handleJobDrop = handleJobDrop;

function populateJournalLocationDropdown() {
  const filterSelect = document.getElementById('stock-location-filter');
  if (!filterSelect) return;
  const currentValue = filterSelect.value || 'all';

  filterSelect.innerHTML = `
    <option value="all" style="color: var(--accent); background-color: #0c1318; font-weight: bold;">All Locations (Combined Assets)</option>
    <option value="industry_system" style="color: var(--accent); background-color: #0c1318; font-weight: bold;">Current System Only (JITA)</option>
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
  window.rawAssetItems.forEach(item => {
    if (!item) return;
    const locId = item.root_location_id || item.location_id;
    const locName = window.resolvedLocationNames[locId] || `Location #${locId}`;

    if (!locCounts[locId]) {
      locCounts[locId] = { name: locName, count: 0, corpDivisions: {}, containers: {} };
    }
    locCounts[locId].count += item.quantity;

    if (item.owner_type === 'corp' && item.location_flag && item.location_flag.startsWith('Corp')) {
      const sagFlag = item.location_flag;
      if (!locCounts[locId].corpDivisions[sagFlag]) {
        locCounts[locId].corpDivisions[sagFlag] = { name: sagNameMap[sagFlag] || sagFlag, count: 0 };
      }
      locCounts[locId].corpDivisions[sagFlag].count += item.quantity;
    }

    if (item.container_id) {
      const cId = item.container_id;
      const cName = window.resolvedLocationNames[cId] || `Container #${cId}`;
      if (!locCounts[locId].containers[cId]) {
        locCounts[locId].containers[cId] = { name: cName, count: 0 };
      }
      locCounts[locId].containers[cId].count += item.quantity;
    }
  });

  for (const [locId, data] of Object.entries(locCounts)) {
    const mainOpt = document.createElement('option');
    mainOpt.value = `loc_${locId}`;
    const numericLocId = parseInt(locId);
    const isUpwellStructure = numericLocId > 1000000000000;
    // Native <option> can't hold an inline SVG - the orange/green text color already distinguishes
    // Upwell structures from NPC stations, so no leading glyph is needed.
    if (isUpwellStructure) {
      mainOpt.style.color = 'var(--accent)';
      mainOpt.style.backgroundColor = '#0c1318';
      mainOpt.style.fontWeight = 'bold';
      mainOpt.textContent = `${data.name} (${data.count.toLocaleString()} items)`;
    } else {
      mainOpt.style.color = 'var(--green)';
      mainOpt.style.backgroundColor = '#0c1318';
      mainOpt.style.fontWeight = 'bold';
      mainOpt.textContent = `${data.name} (${data.count.toLocaleString()} items)`;
    }
    filterSelect.appendChild(mainOpt);

    for (const [sagFlag, sagData] of Object.entries(data.corpDivisions)) {
      const sagOpt = document.createElement('option');
      sagOpt.value = `corpsag_${locId}_${sagFlag}`;
      sagOpt.style.color = 'var(--accent)';
      sagOpt.style.backgroundColor = '#070b0f';
      sagOpt.style.fontWeight = 'bold';
      sagOpt.textContent = `  └─ Corp: ${sagData.name} (${sagData.count.toLocaleString()} items)`;
      filterSelect.appendChild(sagOpt);
    }

    for (const [cId, cData] of Object.entries(data.containers)) {
      const containerOpt = document.createElement('option');
      containerOpt.value = `container_${cId}`;
      containerOpt.style.color = '#f8fafc';
      containerOpt.style.backgroundColor = '#070b0f';
      containerOpt.textContent = `  └─ Container: ${cData.name} (${cData.count.toLocaleString()} items)`;
      filterSelect.appendChild(containerOpt);
    }
  }

  if (filterSelect.querySelector(`option[value="${currentValue}"]`)) {
    filterSelect.value = currentValue;
  } else {
    filterSelect.value = 'all';
  }
}

function filterJournalLocationOptions() {
  const query = (document.getElementById('location-filter-search')?.value || '').trim().toUpperCase();
  const filterSelect = document.getElementById('stock-location-filter');
  const feedbackBadge = document.getElementById('location-search-feedback');
  if (!filterSelect) return;

  const options = filterSelect.querySelectorAll('option');
  let visibleCount = 0;
  options.forEach(opt => {
    if (opt.value === 'all' || opt.value === 'industry_system') {
      opt.style.display = '';
    } else {
      if (!query || opt.textContent.toUpperCase().includes(query)) {
        opt.style.display = '';
        visibleCount++;
      } else {
        opt.style.display = 'none';
      }
    }
  });

  if (feedbackBadge) {
    if (query) {
      feedbackBadge.textContent = `Found: ${visibleCount.toLocaleString()}`;
      feedbackBadge.classList.remove('hidden');
    } else {
      feedbackBadge.textContent = '';
      feedbackBadge.classList.add('hidden');
    }
  }
  if (typeof window.openCustomSelect === 'function') window.openCustomSelect('stock-location-filter');
}

// "Last synced: Xm ago" line next to the Stock & Location panel's Refresh button - the age is
// what actually answers "can I trust this stock count", not just whether a sync ever happened.
function updateStockLastSyncedDisplay() {
  const el = document.getElementById('stock-last-synced');
  if (!el) return;
  const raw = localStorage.getItem('eve_assets_last_synced');
  const ts = raw ? parseInt(raw, 10) : null;
  const ago = ts ? window.formatTimeAgo(ts) : null;
  el.textContent = ago ? `Last synced: ${ago}` : 'Never synced';
}
window.updateStockLastSyncedDisplay = updateStockLastSyncedDisplay;
// Keep the "Xm ago" text current while the ledger sits open, same idea as the job countdown timers.
setInterval(() => { if (typeof updateStockLastSyncedDisplay === 'function') updateStockLastSyncedDisplay(); }, 60000);

// Real re-sync (not just the age label above), for as long as the Ledger tab stays open. Both asset
// stock and EVE job status were previously only ever refreshed once, on page load (inside
// handleEsiSSOCallback's "no OAuth code, just check if we're already logged in" branch, chained into
// syncWithEveIndustryJobs) - correct while the tab gets reloaded often, but a long manufacturing
// session where the Ledger just sits open in a tab across many real jobs starting/finishing would
// never see fresher data until a manual reload or a click on "Sync EVE Jobs"/"Refresh" stock. That's
// what was actually behind "stock syncing takes a very long time" - not the sync being slow once
// triggered, but nothing ever re-triggering it.
//
// This used to be a blind flat 10-minute setInterval - reported directly that a freshly-installed
// corp job still took a long time to show up, and "a long wait is not good at all... needs to be a
// lot quicker." A fixed interval is a guess in both directions: CCP's own server-side cache on the
// industry-jobs endpoints (recorded per-fetch as an exact timestamp by esi.js's
// recordEsiIndustryJobsExpiry, parsed from ESI's own `Expires` response header) says precisely when
// fresh data will actually exist, so this reschedules itself to fire right at that moment instead of
// up to ~10 extra minutes late on a fixed timer - the fastest this tool can honestly get without
// re-asking ESI before it has anything new to say, which ESI's own best-practices guidance calls out
// as "circumventing ESI caching." Falls back to the old 10-minute cadence whenever no Expires info is
// available yet (nothing fetched yet this session, every fetch has failed so far, or not logged in),
// and never fires sooner than 30s even if a header comes back already-expired or malformed, so this
// can never hot-loop.
function scheduleNextEsiJobSync() {
  const expiryMap = window.esiIndustryJobsExpiry || {};
  const knownExpiries = [expiryMap['char-industry'], expiryMap['corp-industry']]
    .filter(t => typeof t === 'number' && t > Date.now());
  const delay = knownExpiries.length ? Math.max(30000, Math.min(...knownExpiries) - Date.now() + 2000) : 600000;
  setTimeout(runScheduledEsiJobSync, delay);
}
function runScheduledEsiJobSync() {
  if (!(window.getActiveCharId && window.getActiveCharId())) { setTimeout(runScheduledEsiJobSync, 600000); return; } // not logged in - check back later rather than stopping forever
  if (typeof window.handleEsiSSOCallback === 'function') {
    window.handleEsiSSOCallback()
      .then(() => { if (typeof window.syncWithEveIndustryJobs === 'function') return window.syncWithEveIndustryJobs(true); })
      .catch(err => console.error('[Ledger] Periodic background sync error:', err))
      .then(scheduleNextEsiJobSync);
  } else {
    scheduleNextEsiJobSync();
  }
}
scheduleNextEsiJobSync();

function applyJournalStockFilter() {
  const filterVal = document.getElementById('stock-location-filter')?.value || 'all';
  const useChar = document.getElementById('use-char-assets')?.checked ?? true;
  const useCorp = document.getElementById('use-corp-assets')?.checked ?? true;

  window.userStockMap = {};
  window.rawAssetItems.forEach(item => {
    if (!item) return;
    if (item.owner_type === 'char' && !useChar) return;
    if (item.owner_type === 'corp' && !useCorp) return;

    let include = false;
    const rootLocId = item.root_location_id || item.location_id;
    const itemLocName = window.resolvedLocationNames[rootLocId] || '';

    if (filterVal === 'all') {
      include = true;
    } else if (filterVal === 'industry_system') {
      include = itemLocName.includes('JITA');
    } else if (filterVal.startsWith('loc_')) {
      const targetLocId = parseInt(filterVal.replace('loc_', ''));
      include = rootLocId === targetLocId;
    } else if (filterVal.startsWith('corpsag_')) {
      const parts = filterVal.split('_');
      const targetLocId = parseInt(parts[1]);
      const targetSag = parts[2];
      include = (rootLocId === targetLocId) && (item.location_flag === targetSag);
    } else if (filterVal.startsWith('container_')) {
      const targetContainerId = parseInt(filterVal.replace('container_', ''));
      include = item.container_id === targetContainerId;
    }

    if (include) {
      window.userStockMap[item.type_id] = (window.userStockMap[item.type_id] || 0) + item.quantity;
    }
  });

  localStorage.setItem('eve_user_stock_map', JSON.stringify(window.userStockMap));
  renderJournalPage();
}

function recalculateJournalStock() {
  applyJournalStockFilter();
}

function setBOMOrderFilter(type) {
  activeOrderFilter = type;
  const btnAll = document.getElementById('btn-order-all');
  const btnBuy = document.getElementById('btn-order-buy');
  const btnSell = document.getElementById('btn-order-sell');

  const pillStyle = 'padding:5px 12px;';
  if (btnAll) { btnAll.className = `lp-pill${type === 'all' ? ' active' : ''}`; btnAll.style.cssText = pillStyle; }
  if (btnBuy) { btnBuy.className = `lp-pill${type === 'buy' ? ' active' : ''}`; btnBuy.style.cssText = pillStyle; }
  if (btnSell) { btnSell.className = `lp-pill${type === 'sell' ? ' active' : ''}`; btnSell.style.cssText = pillStyle; }

  renderJournalPage();
}

function setBOMCategoryFilter(cat) {
  activeCategoryFilter = cat;
  renderJournalPage();
}

// Explicit window bindings
window.copyJournalMultibuy = copyJournalMultibuy;
window.copyIndividualJobMultibuy = copyIndividualJobMultibuy;
window.markJobAsBuilt = markJobAsBuilt;
window.requeueCompletedJob = requeueCompletedJob;
window.deleteJobFromQueue = deleteJobFromQueue;
window.clearJournalHistory = clearJournalHistory;
window.applyJournalStockFilter = applyJournalStockFilter;
window.filterJournalLocationOptions = filterJournalLocationOptions;
window.recalculateJournalStock = recalculateJournalStock;
window.setBOMOrderFilter = setBOMOrderFilter;
window.setBOMCategoryFilter = setBOMCategoryFilter;

// --- Completed History Drawer ---
function getHistoryDrawerState() {
  return localStorage.getItem('eve_history_drawer_state') || 'collapsed';
}

function applyHistoryDrawerState(state) {
  const drawer = document.getElementById('history-drawer');
  const header = document.getElementById('history-drawer-header');
  const chevron = document.getElementById('history-drawer-chevron');
  const pulltab = document.getElementById('history-drawer-pulltab');
  const sizeBtn = document.getElementById('history-drawer-size-btn');
  if (!drawer) return;
  // Collapsed height is measured from the header's own real rendered height rather than a hardcoded
  // guess - a hardcoded px value smaller than the header's actual content height (badges/buttons at
  // this font size) made the header overflow its own box, which both broke vertical centering and let
  // the row's own bottom edge (and the table underneath) peek out past the drawer's painted background.
  if (state === 'collapsed') {
    drawer.style.height = (header ? header.getBoundingClientRect().height : 48) + 'px';
    if (chevron) chevron.innerHTML = window.svgIcon('chevron-up');
    if (pulltab) pulltab.innerHTML = window.svgIcon('chevrons-up');
    if (sizeBtn) sizeBtn.classList.add('hidden');
  } else if (state === 'tall') {
    drawer.style.height = '70vh';
    if (chevron) chevron.innerHTML = window.svgIcon('chevron-down');
    if (pulltab) pulltab.innerHTML = window.svgIcon('chevrons-down');
    if (sizeBtn) { sizeBtn.classList.remove('hidden'); sizeBtn.innerHTML = window.svgIcon('collapse') + ' Shorter'; }
  } else {
    drawer.style.height = '24rem';
    if (chevron) chevron.innerHTML = window.svgIcon('chevron-down');
    if (pulltab) pulltab.innerHTML = window.svgIcon('chevrons-down');
    if (sizeBtn) { sizeBtn.classList.remove('hidden'); sizeBtn.innerHTML = window.svgIcon('expand') + ' Taller'; }
  }
  localStorage.setItem('eve_history_drawer_state', state);
}

function toggleHistoryDrawer() {
  applyHistoryDrawerState(getHistoryDrawerState() === 'collapsed' ? 'normal' : 'collapsed');
}
window.toggleHistoryDrawer = toggleHistoryDrawer;

function toggleHistoryDrawerSize() {
  applyHistoryDrawerState(getHistoryDrawerState() === 'tall' ? 'normal' : 'tall');
}
window.toggleHistoryDrawerSize = toggleHistoryDrawerSize;

// The drawer above is position:fixed, so its own bottom inset (see #history-drawer in
// styles.css) is measured from the true viewport edge - it has no idea the site-legal-footer
// (a real flow element, last in body's own column) is also sitting down there now. Guessing a
// fixed px value for that clearance would break again the moment the footer's text wraps to a
// second line at a narrower window width, so this measures the footer's actual rendered height
// (same "measure, don't guess" reasoning as applyHistoryDrawerState's collapsed-height read
// above) and exposes it as --footer-clearance, which #history-drawer's own bottom inset keys off
// of directly - the drawer now sits exactly where the footer's own flow-space begins (its real
// height plus the same row-gap that already separates every other pair of flow siblings in the
// body column), so it floats flush above the footer instead of overlapping it or leaving a
// mismatched dead gap above it.
//
// .content-row's margin-bottom is set directly here too, rather than via a second CSS var: it
// only has to clear the fixed drawer itself (the footer's own space is already handled
// automatically by flex, since content-row and the footer are real flow siblings) - drawer height
// plus a small resting gap, both independent of the footer's height entirely.
function updateFooterClearance() {
  const footer = document.querySelector('.site-legal-footer');
  const drawer = document.getElementById('history-drawer');
  const contentRow = document.querySelector('.content-row');
  if (!footer) return;
  const gapPx = parseFloat(getComputedStyle(document.body).rowGap) || 8;
  document.documentElement.style.setProperty('--footer-clearance', (footer.getBoundingClientRect().height + gapPx) + 'px');
  if (drawer && contentRow) {
    contentRow.style.marginBottom = (drawer.getBoundingClientRect().height + 14) + 'px';
  }
}
window.addEventListener('resize', updateFooterClearance);
updateFooterClearance();

window.onload = async () => {
  updateFooterClearance();
  if (typeof window.buildPrepackedIndexes === 'function') {
    window.buildPrepackedIndexes();
  }

  try {
    loadJournalState();
    updateViewModeButtonLabel();
    populateJournalLocationDropdown();
    updateStockLastSyncedDisplay();
    renderJournalPage();
    applyHistoryDrawerState(getHistoryDrawerState());
    updateJobNotificationButton();
  } catch (err) {
    console.error("Ledger state load error:", err);
  }

  if (typeof window.handleEsiSSOCallback === 'function') {
    window.handleEsiSSOCallback()
      .then(() => { if (typeof window.syncWithEveIndustryJobs === 'function') return window.syncWithEveIndustryJobs(true); })
      .catch(err => console.error("SSO Callback error:", err));
  }

  if (typeof window.fetchAdjustedPrices === 'function') {
    window.fetchAdjustedPrices().catch(err => console.error("Adjusted prices fetch error:", err));
  }
};