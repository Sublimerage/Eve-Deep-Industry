'use strict';

// --- Action: Recursive Helper to Sync UI Overrides to Tree Structure ---
function syncTreeBuildStates(node) {
  if (!node) return;
  const defaultBuildState = (node.depth === 0) ? true : false;
  node.isBuildingSelf = (window.buildSelfOverrides[node.typeId] !== undefined) ? window.buildSelfOverrides[node.typeId] : defaultBuildState;
  
  if (node.displayTypeId && window.buildSelfOverrides[node.displayTypeId] !== undefined) {
    node.isBuildingSelf = window.buildSelfOverrides[node.displayTypeId];
  }

  if (node.children) {
    node.children.forEach(child => syncTreeBuildStates(child));
  }
}

// --- Action: Bulk ME/TE Target (Build tab "Bulk ME/TE" card) ---
// A component only qualifies the same way its own per-card ME/TE fields do (see the card
// template in app.js): a real recipe with manufacturing materials, not a reaction (reactions have
// no ME/TE research at all).
function isTypeMEEligible(typeId) {
  const recipe = window.recipeMap && window.recipeMap[typeId];
  if (!recipe) return false;
  const hasMfg = recipe.mfgMaterials && recipe.mfgMaterials.length > 0;
  const hasReaction = recipe.reactionMaterials && recipe.reactionMaterials.length > 0;
  return hasMfg && !hasReaction;
}

// Called from toggleBuildSelf/buildAllComponents whenever a component becomes Build for the
// first time - if a bulk target is armed, this is what makes it "keep applying" to anything
// switched to Build from now on, not just what was already Build at the moment Apply was clicked.
function stampBulkMETargetIfArmed(typeId) {
  if (!window.bulkMETarget || !isTypeMEEligible(typeId)) return;
  window.customMEOverrides[typeId] = window.bulkMETarget.me;
  window.customTEOverrides[typeId] = window.bulkMETarget.te;
}
window.stampBulkMETargetIfArmed = stampBulkMETargetIfArmed;

// Sets every currently-built component (including the root/main card - it's just as manufacturable
// and just as subject to ME/TE as anything under it, and reported directly as the one card bulk
// apply silently skipped) to the given ME/TE right now, AND arms window.bulkMETarget so
// toggleBuildSelf/buildAllComponents keep stamping it onto anything switched to Build afterward too
// - until clearBulkMETarget() (the toast's "Stop" action, or the card's own Stop button) turns that
// back off. Forcibly overwrites even a component with its own auto-filled-from-owned-BPO value,
// same as any other manual ME/TE edit already does - this is a deliberate "assume everything's
// maxed/at this level" planning tool, not meant to defer to what you actually own.
function applyBulkMETarget(me, te) {
  const clampedME = Math.max(0, Math.min(10, parseFloat(me) || 0));
  const clampedTE = Math.max(0, Math.min(20, parseFloat(te) || 0));

  // Captured once - the very first bulk action since the last full Reset - not re-captured on a
  // second Max/Apply click (which would otherwise overwrite the true "before any of this" baseline
  // with an already-bulk-modified state). This is what resetBulkMETarget() restores wholesale,
  // deliberately not a per-click undo stack - the user explicitly asked for one full reset back to
  // "before pressing any button," not stepped undo.
  if (!window.bulkMEOriginalSnapshot) {
    window.bulkMEOriginalSnapshot = {
      me: { ...window.customMEOverrides },
      te: { ...window.customTEOverrides }
    };
  }
  window.bulkMETarget = { me: clampedME, te: clampedTE };

  function stampTree(node) {
    if (!node) return;
    if (node.isBuildingSelf && node.isManufacturable && !node.isReaction) {
      window.customMEOverrides[node.typeId] = clampedME;
      window.customTEOverrides[node.typeId] = clampedTE;
    }
    if (node.children) node.children.forEach(c => stampTree(c));
  }
  if (window.recipeTreeRoot) stampTree(window.recipeTreeRoot);

  if (window.currentProduct) {
    window.selectItem(window.currentProduct.id, window.currentProduct.name, true);
  } else if (typeof window.recalculate === 'function') {
    window.recalculate();
  }
  if (typeof window.updateBulkMEStatusUI === 'function') window.updateBulkMEStatusUI();

  if (typeof window.showToast === 'function') {
    window.showToast(`Set every built component to ME ${clampedME}% / TE ${clampedTE}% - will keep applying to anything you switch to Build from here on.`, 'success', { action: { label: 'Stop', onClick: () => window.clearBulkMETarget() } });
  }
}
window.applyBulkMETarget = applyBulkMETarget;

function applyBulkMETargetMax() {
  applyBulkMETarget(10, 20);
}
window.applyBulkMETargetMax = applyBulkMETargetMax;

// Stops future auto-apply only - does not touch ME/TE values already set on components, and does
// NOT clear bulkMEOriginalSnapshot (a later Reset still needs to reach back past this point to the
// real original baseline, not just to whatever was true when Stop was clicked).
function clearBulkMETarget() {
  window.bulkMETarget = null;
  if (typeof window.recalculate === 'function') window.recalculate();
  if (typeof window.updateBulkMEStatusUI === 'function') window.updateBulkMEStatusUI();
  if (typeof window.showToast === 'function') {
    window.showToast('Stopped auto-applying bulk ME/TE to newly built components. Values already set are unchanged.', 'info');
  }
}
window.clearBulkMETarget = clearBulkMETarget;

// Full restore to exactly how every component's ME/TE stood before the first Max/Apply click -
// wholesale replaces customMEOverrides/customTEOverrides with the snapshot captured back in
// applyBulkMETarget, then clears both the target (stops future auto-apply too) and the snapshot
// itself, so the next Max/Apply click captures a fresh baseline rather than reusing this one.
function resetBulkMETarget() {
  if (!window.bulkMEOriginalSnapshot) return;
  window.customMEOverrides = { ...window.bulkMEOriginalSnapshot.me };
  window.customTEOverrides = { ...window.bulkMEOriginalSnapshot.te };
  window.bulkMETarget = null;
  window.bulkMEOriginalSnapshot = null;
  if (window.currentProduct) {
    window.selectItem(window.currentProduct.id, window.currentProduct.name, true);
  } else if (typeof window.recalculate === 'function') {
    window.recalculate();
  }
  if (typeof window.updateBulkMEStatusUI === 'function') window.updateBulkMEStatusUI();
  if (typeof window.showToast === 'function') {
    window.showToast('Every component\'s ME/TE restored to what it was before Bulk ME/TE was ever used.', 'success');
  }
}
window.resetBulkMETarget = resetBulkMETarget;

// Reflects bulkMETarget/bulkMEOriginalSnapshot (loaded from localStorage on page load, or set/
// cleared by the functions above) in the Build tab's own "Bulk ME/TE" card - shown/called from
// index.html's window.onload and from every apply/clear/reset above. The row (and its Reset
// button) stays visible even after Stop, as long as there's still a snapshot to restore to.
function updateBulkMEStatusUI() {
  const statusRow = document.getElementById('bulk-me-status');
  const statusText = document.getElementById('bulk-me-status-text');
  const stopBtn = document.getElementById('bulk-me-stop-btn');
  if (!statusRow || !statusText) return;
  const isArmed = !!window.bulkMETarget;
  const hasSnapshot = !!window.bulkMEOriginalSnapshot;
  if (!isArmed && !hasSnapshot) {
    statusRow.classList.add('hidden');
    return;
  }
  statusRow.classList.remove('hidden');
  statusText.textContent = isArmed
    ? `Auto-applying ME ${window.bulkMETarget.me}% / TE ${window.bulkMETarget.te}% to newly built components`
    : 'Bulk ME/TE stopped - components keep their current values.';
  if (stopBtn) stopBtn.classList.toggle('hidden', !isArmed);
}
window.updateBulkMEStatusUI = updateBulkMEStatusUI;

// --- Action: Toggle Component Build / Buy Mode ---
async function toggleBuildSelf(e, typeId) {
  if (e) e.stopPropagation();
  const currentState = (window.buildSelfOverrides[typeId] !== undefined) ? window.buildSelfOverrides[typeId] : false;
  window.buildSelfOverrides[typeId] = !currentState;
  if (!currentState) stampBulkMETargetIfArmed(typeId);

  const root = window.recipeTreeRoot;
  // An LP Store isolated direct-sell offer's root is a hand-built synthetic node with no real
  // recipe of its own (see isolateDirectSellOffer, js/lpstore.js) - selectItem() below would try
  // to rebuild the WHOLE tree from that typeId via the real recipe walk, find nothing manufacturable
  // there, and replace the entire hand-built root/redemption-item structure with a bare leaf. Toggling
  // Build/Buy on any node while that kind of root is active - a redemption-requirement item's own
  // toggle included - only ever needs a recalculate (js/lpstore.js's own recalculate hook re-derives
  // every node under that root from the current override state on every call), never a rebuild from
  // window.currentProduct.id. A BPC-isolated offer's root DOES have a real recipe (it came from
  // selectItem() in the first place), so it's untouched by this guard and keeps working exactly as
  // before.
  if (root && root.isLPIsolatedRoot && !root.recipe) {
    // Same pan-compensation every other per-card recalculate()-only control uses
    // (recalculateWithPanAnchor, app.js - see its own comment on the fallback chain this needs) -
    // this branch never calls selectItem at all, so without this the camera visibly jumped on every
    // Build/Buy toggle for an LP offer's synthetic root, unlike the Calculator page (which never
    // takes this branch, since its root is never isLPIsolatedRoot).
    await window.recalculateWithPanAnchor(e);
    return;
  }

  if (window.currentProduct) {
    // The card the Build/Buy button actually lives on, so selectItem can keep it pinned to its
    // current screen position through the rebuild instead of the whole diagram visibly jumping -
    // see selectItem's own anchorInstanceId comment for why that happens at all.
    const anchorEl = e && e.target ? e.target.closest('.diagram-node') : null;
    const anchorInstanceId = anchorEl ? parseInt(anchorEl.getAttribute('data-instance-id')) : null;
    await window.selectItem(window.currentProduct.id, window.currentProduct.name, true, anchorInstanceId);
  }
}

// --- Action: Per-Card ME / TE Inputs ---
function onCardMEChange(e, typeId, instanceId) {
  if (e) e.stopPropagation();
  const val = Math.max(0, Math.min(10, parseFloat(e.target.value) || 0));
  window.customMEOverrides[typeId] = val;
  if (window.currentProduct) {
    window.selectItem(window.currentProduct.id, window.currentProduct.name, true, instanceId);
  }
}

// --- Action: Per-Card TE Change ---
// onCardMEChange (above) already pins the card via selectItem's own anchorInstanceId - this used to
// call recalculate() directly instead with no compensation at all, an asymmetry that made editing
// TE (but not ME) visibly jump the camera.
async function onCardTEChange(e, typeId, instanceId) {
  if (e) e.stopPropagation();
  const val = Math.max(0, Math.min(20, parseFloat(e.target.value) || 0));
  window.customTEOverrides[typeId] = val;
  await window.recalculateWithPanAnchor(e);
}

// --- Action: Build All Sub-Components ---
// buildRecursiveRecipeTree (tree.js) only fetches a node's OWN children while that node's OWN
// isBuildingSelf is true at fetch time - so a component sitting in Buy mode has an empty children
// array, not because it has no sub-materials, but because they were simply never fetched. Marking
// it to Build here doesn't retroactively fill that in; only a real rebuild does. That rebuild can
// then reveal a brand new layer of manufacturable children underneath it that this function has
// never even seen - which themselves need marking and another rebuild to reveal what's under THEM,
// and so on - so this loops mark-then-rebuild until a full pass finds nothing new to flip, reaching
// the true bottom of the tree in one click instead of leaving deeper components stuck in Buy mode
// until something else happens to force a rebuild.
// Uses selectItem(..., preserveView=true) for that rebuild - the same mechanism the per-card Build/
// Buy toggle (toggleBuildSelf) already relies on - rather than a flag-sync-only re-render. That
// used to be deliberately avoided here because a rebuild hands every node a fresh instanceId
// (tree.js's ++instanceCounter), which would silently invalidate any card the user had expanded/
// collapsed. node.pathKey (tree.js) now gives collapsedInstanceIds/expandedOverrideIds a stable key
// that survives a rebuild (see nodeStableKey in app.js), so that concern no longer applies.
// Marks every manufacturable node in the given subtree to Build, returning whether anything
// actually changed - shared by Build All (calls this in a loop until a pass changes nothing, see
// its own comment on why) and +1 Layer below (calls it exactly once per click).
function markAllBuild(node) {
  let changedAny = false;
  if (!node) return changedAny;
  if (node.isManufacturable) {
    if (window.buildSelfOverrides[node.typeId] !== true) changedAny = true;
    window.buildSelfOverrides[node.typeId] = true;
    stampBulkMETargetIfArmed(node.typeId);
    if (node.displayTypeId) {
      if (window.buildSelfOverrides[node.displayTypeId] !== true) changedAny = true;
      window.buildSelfOverrides[node.displayTypeId] = true;
      stampBulkMETargetIfArmed(node.displayTypeId);
    }
  }
  if (node.children) {
    node.children.forEach(c => { if (markAllBuild(c)) changedAny = true; });
  }
  return changedAny;
}
window.markAllBuild = markAllBuild;

async function buildAllComponents() {
  if (!window.recipeTreeRoot) return;
  const root = window.recipeTreeRoot;

  // An LP Store isolated direct-sell offer's root is a hand-built synthetic node with no real
  // recipe of its own (see toggleBuildSelf's own comment for the full explanation) - selectItem()
  // would destroy it, so this path only ever needs a flag sync + recalculate, same as before.
  const isLPSynthetic = root.isLPIsolatedRoot && !root.recipe;
  if (isLPSynthetic || !window.currentProduct) {
    markAllBuild(root);
    syncTreeBuildStates(root);
    if (typeof window.recalculate === 'function') window.recalculate();
    return;
  }

  const btn = document.getElementById('build-all-btn');
  const originalLabel = btn ? btn.innerHTML : null;
  if (btn) btn.disabled = true;

  let changed = markAllBuild(root);
  let guard = 0;
  while (changed && guard < 25) {
    if (btn) btn.innerHTML = `Building all${'.'.repeat((guard % 3) + 1)}`;
    await window.selectItem(window.currentProduct.id, window.currentProduct.name, true);
    changed = markAllBuild(window.recipeTreeRoot);
    guard++;
  }
  if (guard === 0 && typeof window.recalculate === 'function') window.recalculate();

  if (btn) {
    btn.disabled = false;
    btn.innerHTML = originalLabel;
  }
}

// --- Action: +1 Layer of Build ---
// Exactly ONE mark-then-rebuild pass of Build All's own loop, instead of looping to convergence -
// each click reveals and builds precisely the next tier down (root's own direct components first,
// then what was underneath THOSE, and so on), instead of jumping straight to the full depth.
async function buildOneLayerDeeper() {
  if (!window.recipeTreeRoot) return;
  const root = window.recipeTreeRoot;

  const isLPSynthetic = root.isLPIsolatedRoot && !root.recipe;
  if (isLPSynthetic || !window.currentProduct) {
    const changed = markAllBuild(root);
    syncTreeBuildStates(root);
    if (typeof window.recalculate === 'function') window.recalculate();
    if (!changed && typeof window.showToast === 'function') window.showToast('Already fully built - nothing deeper to reveal.', 'info');
    return;
  }

  const changed = markAllBuild(root);
  if (!changed) {
    if (typeof window.showToast === 'function') window.showToast('Already fully built - nothing deeper to reveal.', 'info');
    return;
  }
  await window.selectItem(window.currentProduct.id, window.currentProduct.name, true);
}
window.buildOneLayerDeeper = buildOneLayerDeeper;

// Collects the current "build frontier": every node set to Build whose own manufacturable children
// are either absent or all still Buy - i.e. the deepest tier actually being built, walked
// independently down EVERY branch (a build tree isn't uniformly deep, so this is never a single
// global depth) rather than one shared number. Root is never included - there's always at least
// the main item itself set to Build, or none of any of this makes sense.
function findBuildFrontier(node, isRoot, frontier) {
  if (!node || !node.isManufacturable || !node.isBuildingSelf) return;
  const buildingChildren = (node.children || []).filter(c => c.isManufacturable && c.isBuildingSelf);
  if (buildingChildren.length === 0) {
    if (!isRoot) frontier.push(node);
  } else {
    buildingChildren.forEach(c => findBuildFrontier(c, false, frontier));
  }
}

// --- Action: -1 Layer of Build ---
// The reverse of +1 Layer: flips the current build frontier (above) back to Buy, retracting every
// branch's own deepest built tier by exactly one step. Symmetric with +1 Layer for the common case
// of clicking them back and forth, but computed fresh from whatever the tree actually looks like
// right now rather than a separate click-counter - so it stays correct even if some cards were
// toggled by hand in between, instead of just undoing "the last click" blindly.
async function buildOneLayerShallower() {
  if (!window.recipeTreeRoot) return;
  const root = window.recipeTreeRoot;
  const frontier = [];
  findBuildFrontier(root, true, frontier);
  if (frontier.length === 0) {
    if (typeof window.showToast === 'function') window.showToast('Nothing to retract - only the main item itself is set to Build.', 'info');
    return;
  }
  frontier.forEach(node => {
    window.buildSelfOverrides[node.typeId] = false;
    if (node.displayTypeId) window.buildSelfOverrides[node.displayTypeId] = false;
  });

  const isLPSynthetic = root.isLPIsolatedRoot && !root.recipe;
  if (isLPSynthetic || !window.currentProduct) {
    syncTreeBuildStates(root);
    if (typeof window.recalculate === 'function') window.recalculate();
    return;
  }
  await window.selectItem(window.currentProduct.id, window.currentProduct.name, true);
}
window.buildOneLayerShallower = buildOneLayerShallower;

// --- Action: Buy All Sub-Components ---
async function buyAllSubComponents() {
  window.buildSelfOverrides = {};
  syncTreeBuildStates(window.recipeTreeRoot);
  window.applyComponentSpreadOptimizer();
}

// --- Action: Reset Smart Buy Override Modes ---
function resetSmartBuyModes() {
  if (Object.keys(window.customBuyModes || {}).length === 0) return;
  const snapshot = { ...window.customBuyModes };
  window.customBuyModes = {};
  if (typeof window.recalculate === 'function') {
    window.recalculate();
  }
  if (typeof window.showToast === 'function') {
    window.showToast('Reset every component\'s buy/build override back to default.', 'info', { action: { label: 'Undo', onClick: () => {
      window.customBuyModes = snapshot;
      if (typeof window.recalculate === 'function') window.recalculate();
    } } });
  }
}

// --- Shared: One-Time Full-Depth Tree Expansion (used by every optimizer below) ---
// buildRecursiveRecipeTree (tree.js) only fetches a node's OWN children while that node's OWN
// isBuildingSelf was true at fetch time - every node deeper than depth 0 defaults to Buy until
// something overrides it, so on a freshly-loaded deep build almost nothing past depth 1 has ever
// been fetched at all. Buy isn't a "collapsed" state hiding data that already exists - the
// sub-materials were simply never created as node objects. Every optimizer below walks
// node.children to find its candidates/leaves, so without this, each one can only ever reach
// whatever happened to already be fetched - exactly the same blind spot buildAllComponents() had
// before it started mark-then-rebuilding (see its own comment).
// Uses that identical mark-then-rebuild loop: mark every manufacturable node found so far to Build,
// do a real rebuild via selectItem(..., preserveView=true), see what NEW manufacturable nodes that
// revealed, and repeat until a full pass finds nothing new - reaching the true bottom of the tree
// (or maxDepth/circular cutoff) in a bounded number of passes.
// Returns the buildSelfOverrides snapshot from BEFORE this ran, so a caller that only needed the
// tree's STRUCTURE fully discovered (not "build everything") can restore it. The fetched
// node.children stay populated in memory regardless of what buildSelfOverrides/isBuildingSelf say
// afterward - only a real rebuild (another selectItem() call) would ever clear them again, and
// nothing after this function returns triggers one; syncTreeBuildStates only touches the flags.
// Returns null (nothing to restore, nothing changed) if there's no tree, no active product, or the
// tree root is an LP Store isolated direct-sell offer's hand-built synthetic root (see
// toggleBuildSelf's own comment) - selectItem() would destroy that kind of root rather than rebuild it.
async function cascadeExpandFullTree() {
  if (!window.recipeTreeRoot || !window.currentProduct) return null;
  const root = window.recipeTreeRoot;
  if (root.isLPIsolatedRoot && !root.recipe) return null;

  function markAllManufacturable(node) {
    let changedAny = false;
    if (!node) return changedAny;
    if (node.isManufacturable) {
      if (window.buildSelfOverrides[node.typeId] !== true) changedAny = true;
      window.buildSelfOverrides[node.typeId] = true;
      if (node.displayTypeId && window.buildSelfOverrides[node.displayTypeId] !== true) {
        window.buildSelfOverrides[node.displayTypeId] = true;
        changedAny = true;
      }
    }
    if (node.children) node.children.forEach(c => { if (markAllManufacturable(c)) changedAny = true; });
    return changedAny;
  }

  const originalOverrides = { ...window.buildSelfOverrides };
  let changed = markAllManufacturable(root);
  let guard = 0;
  while (changed && guard < 25) {
    await window.selectItem(window.currentProduct.id, window.currentProduct.name, true);
    changed = markAllManufacturable(window.recipeTreeRoot);
    guard++;
  }
  return originalOverrides;
}

// Optimizer 1: True Greedy Build vs Buy Profit Margin Optimizer
async function applyBuildProfitOptimizer() {
  const inputThreshold = parseFloat(document.getElementById('build-profit-threshold')?.value);
  const threshold = isNaN(inputThreshold) ? 5.0 : Math.max(0, inputThreshold);

  if (!window.recipeTreeRoot) return;

  // Reach every manufacturable node in the tree, not just whatever's already been fetched (see
  // cascadeExpandFullTree's own comment). Deliberately left at "everything Build" afterward, not
  // restored: calculateTreeNodeCost prices a Buy-mode node flatly at market and never recurses into
  // its children, so every ancestor along a candidate's path must actually be building for its cost
  // to thread down to that candidate at all. "Build everything" is exactly the right starting
  // baseline for a "decide Build vs Buy for every component in this build" optimizer - the loop
  // below then flips each candidate to Buy wherever that isn't profitable, top-down, so a candidate
  // whose parent already got flipped to Buy correctly shows no further gain from building it either
  // (you're buying the parent pre-made; its own sub-materials are moot).
  await cascadeExpandFullTree();

  // Pre-fetch market prices for all type IDs before evaluating build margins
  const allTypeIds = new Set();
  if (typeof window.collectAllTypeIds === 'function') {
    window.collectAllTypeIds(window.recipeTreeRoot, allTypeIds);
    await window.fetchMarketPrices(Array.from(allTypeIds));
  }

  // Collect all manufacturable sub-component type IDs in the recipe tree
  const manufacturableTypeIds = new Set();
  function collectManufacturableNodes(node) {
    if (!node) return;
    if (node.depth > 0 && node.isManufacturable) {
      manufacturableTypeIds.add(node.displayTypeId || node.typeId);
    }
    if (node.children) {
      node.children.forEach(child => collectManufacturableNodes(child));
    }
  }
  collectManufacturableNodes(window.recipeTreeRoot);

  const { facilityTax, sccSurcharge, brokerFee, salesTax } = window.getActiveFeeInputs();
  const structureType = window.getActiveStructureType ? window.getActiveStructureType() : { costBonus: 5.0, meBonus: 1.0 };
  const structureRoleBonus = structureType.costBonus / 100;
  const facility = structureType.meBonus / 100;

  // Helper to run a silent simulation test for profit under given build overrides
  function simulateProfit() {
    syncTreeBuildStates(window.recipeTreeRoot);
    if (typeof window.scaleTreeQuantities === 'function') {
      window.scaleTreeQuantities(window.recipeTreeRoot, facility);
    }
    if (typeof window.calculateNodeEIV === 'function') {
      window.calculateNodeEIV(window.recipeTreeRoot);
    }

    let matCost = 0;
    if (window.recipeTreeRoot.isBuildingSelf && window.recipeTreeRoot.children && window.recipeTreeRoot.children.length > 0) {
      window.recipeTreeRoot.children.forEach(child => {
        matCost += calculateTreeNodeCost(child);
      });
    } else {
      const productTypeId = window.recipeTreeRoot.productTypeId || window.recipeTreeRoot.typeId;
      const rootPrices = window.priceCache[productTypeId] || { sell: 0, buy: 0 };
      matCost = (rootPrices.sell || rootPrices.buy || 0) * window.recipeTreeRoot.qtyNeeded;
    }

    const jobFees = calculateNodeJobFee(window.recipeTreeRoot, facilityTax, sccSurcharge, structureRoleBonus);
    const totalCost = matCost + jobFees;

    const productTypeId = window.recipeTreeRoot.productTypeId || window.recipeTreeRoot.typeId;
    const outputPrices = window.priceCache[productTypeId] || { sell: 0, buy: 0 };
    const grossSell = outputPrices.sell * window.recipeTreeRoot.qtyNeeded;
    const netSell = grossSell * (1 - salesTax - brokerFee);

    return netSell - totalCost;
  }

  console.info(`[BuildOptimizer] Threshold: ${threshold}%, candidates found: ${manufacturableTypeIds.size}`, Array.from(manufacturableTypeIds));

  // Test building vs buying for each sub-component from bottom-up
  for (const typeId of Array.from(manufacturableTypeIds)) {
    window.buildSelfOverrides[typeId] = false;
    const profitBuy = simulateProfit();

    window.buildSelfOverrides[typeId] = true;
    const profitBuild = simulateProfit();

    const profitGain = profitBuild - profitBuy;
    // % impact measured against the whole build's total cost - matches the Budget Impact optimizer's
    // approach. The previous version normalized against this component's unit price times the ROOT's
    // quantity (often just 1, for a single ship), a denominator with no real connection to the actual
    // scale of the decision, which produced near-arbitrary percentages and made the threshold check
    // effectively meaningless.
    const rootTotalCost = window.recipeTreeRoot.calculatedCost || 1;
    const marginGainPct = rootTotalCost > 0 ? (profitGain / rootTotalCost) * 100 : 0;

    const willBuild = profitBuild > profitBuy && marginGainPct >= threshold;
    console.info(`[BuildOptimizer] typeId=${typeId}: profitBuy=${Math.round(profitBuy).toLocaleString()}, profitBuild=${Math.round(profitBuild).toLocaleString()}, profitGain=${Math.round(profitGain).toLocaleString()}, rootTotalCost=${Math.round(rootTotalCost).toLocaleString()}, marginGainPct=${marginGainPct.toFixed(3)}%, threshold=${threshold}% => ${willBuild ? 'BUILD' : 'buy'}`);

    // Only keep BUILD mode if building actually INCREASES net profit by >= threshold %
    if (willBuild) {
      window.buildSelfOverrides[typeId] = true;
    } else {
      window.buildSelfOverrides[typeId] = false;
    }
  }

  // Re-apply final optimal tree state - see buildAllComponents() above for why this stays a flag
  // sync + recalculate instead of a full selectItem() rebuild.
  syncTreeBuildStates(window.recipeTreeRoot);
  if (typeof window.recalculate === 'function') window.recalculate();
}

// Optimizer 2: Component Market Spread Threshold
async function applyComponentSpreadOptimizer() {
  const inputThreshold = parseFloat(document.getElementById('buy-savings-threshold')?.value);
  const threshold = isNaN(inputThreshold) ? 5.0 : Math.max(0, inputThreshold);

  if (!window.recipeTreeRoot) return;

  // Unlike applyBuildProfitOptimizer, this optimizer never decides Build vs Buy - it only picks a
  // buy-order-vs-instant-sell-order STRATEGY for whatever's already a leaf, so
  // cascadeExpandFullTree's temporary "build everything" gets restored afterward rather than kept.
  // optimizeNode's own recursion into node.children below is unconditional (not gated on
  // isBuildingSelf), so once the cascade has fetched every manufacturable node's children at least
  // once, restoring the real Build/Buy split still leaves every genuine leaf - at any depth -
  // reachable, without this button silently also flipping the whole build to Build mode as a side effect.
  const originalOverrides = await cascadeExpandFullTree();
  if (originalOverrides) {
    window.buildSelfOverrides = originalOverrides;
    syncTreeBuildStates(window.recipeTreeRoot);
    const allTypeIds = new Set();
    if (typeof window.collectAllTypeIds === 'function') {
      window.collectAllTypeIds(window.recipeTreeRoot, allTypeIds);
      await window.fetchMarketPrices(Array.from(allTypeIds));
    }
    if (typeof window.recalculate === 'function') window.recalculate();
  }

  function optimizeNode(node) {
    if (!node) return;
    
    if (!node.isBuildingSelf || !node.children || node.children.length === 0) {
      const typeId = node.displayTypeId || node.typeId;
      // Use the tree-resolved productTypeId (never the blueprint's own id) for pricing.
      const productTypeId = node.productTypeId || typeId;
      const prices = window.priceCache[productTypeId] || { sell: 0, buy: 0 };
      
      if (prices.sell > 0 && prices.buy > 0 && prices.sell > prices.buy) {
        const spreadPct = ((prices.sell - prices.buy) / prices.sell) * 100;
        if (spreadPct >= threshold) {
          window.customBuyModes[typeId] = 'buy';  // Market spread is large enough: place a Buy Order!
        } else {
          window.customBuyModes[typeId] = 'sell'; // Market spread is small: buy instantly off Sell Orders!
        }
      } else {
        window.customBuyModes[typeId] = 'sell'; 
      }
    }

    if (node.children) {
      node.children.forEach(child => optimizeNode(child));
    }
  }

  optimizeNode(window.recipeTreeRoot);
  if (typeof window.recalculate === 'function') window.recalculate();
}

// Optimizer 3: Build Cost Savings Impact Threshold
async function applyBudgetImpactOptimizer() {
  const inputThreshold = parseFloat(document.getElementById('total-cost-savings-threshold')?.value);
  const threshold = isNaN(inputThreshold) ? 1.0 : Math.max(0, inputThreshold);

  if (!window.recipeTreeRoot) return;

  // See applyComponentSpreadOptimizer's own comment just above - same reasoning applies here:
  // this optimizer only picks a buy-order-vs-instant-sell-order strategy for existing leaves, so
  // the temporary "build everything" cascade gets restored, not kept.
  const originalOverrides = await cascadeExpandFullTree();
  if (originalOverrides) {
    window.buildSelfOverrides = originalOverrides;
    syncTreeBuildStates(window.recipeTreeRoot);
    const allTypeIds = new Set();
    if (typeof window.collectAllTypeIds === 'function') {
      window.collectAllTypeIds(window.recipeTreeRoot, allTypeIds);
      await window.fetchMarketPrices(Array.from(allTypeIds));
    }
    if (typeof window.recalculate === 'function') window.recalculate();
  }

  function optimizeNode(node) {
    if (!node) return;
    
    if (!node.isBuildingSelf || !node.children || node.children.length === 0) {
      const typeId = node.displayTypeId || node.typeId;
      // Use the tree-resolved productTypeId (never the blueprint's own id) for pricing.
      const productTypeId = node.productTypeId || typeId;
      const prices = window.priceCache[productTypeId] || { sell: 0, buy: 0 };
      
      const deductModeInput = document.getElementById('deduct-stock-mode');
      const isStockDeductEnabled = deductModeInput ? deductModeInput.value === 'true' : true;
      const stockQty = isStockDeductEnabled ? (window.userStockMap[productTypeId] || window.userStockMap[node.typeId] || 0) : 0;
      const netQtyNeeded = Math.max(0, node.qtyNeeded - stockQty);

      const sellTotal = prices.sell * netQtyNeeded;
      const buyTotal = prices.buy * netQtyNeeded;

      if (sellTotal > 0 && buyTotal > 0 && sellTotal > buyTotal) {
        const rootTotalCost = window.recipeTreeRoot?.calculatedCost || 1;
        const budgetImpactPct = rootTotalCost > 0 ? ((sellTotal - buyTotal) / rootTotalCost) * 100 : 0;

        if (budgetImpactPct >= threshold) {
          window.customBuyModes[typeId] = 'buy';  // Saves enough on overall budget: place a Buy Order!
        } else {
          window.customBuyModes[typeId] = 'sell'; // Minor impact on total budget: buy off Sell Orders!
        }
      } else {
        window.customBuyModes[typeId] = 'sell';
      }
    }

    if (node.children) {
      node.children.forEach(child => optimizeNode(child));
    }
  }

  optimizeNode(window.recipeTreeRoot);
  if (typeof window.recalculate === 'function') window.recalculate();
}

async function setComponentBuyMode(e, typeId, mode) {
  if (e) e.stopPropagation();
  window.customBuyModes[typeId] = mode;
  await window.recalculateWithPanAnchor(e);
}

// A compact chip has no room for the full card's two labeled Sell/Buy buttons, so this is a single
// icon that both shows and flips the current strategy - same underlying state (customBuyModes), just
// a click-to-switch control instead of two separate ones. Never lands on 'lp': that stays reachable
// only from the full card's own dedicated button (see createNodeCard's own comment on why), so
// flipping away from it here always goes to 'buy', not a third cycle position.
async function toggleComponentBuyMode(e, typeId) {
  if (e) e.stopPropagation();
  const globalStrategy = document.getElementById('input-price-mode')?.value || 'sell';
  const current = window.customBuyModes[typeId] || globalStrategy;
  window.customBuyModes[typeId] = (current === 'buy') ? 'sell' : 'buy';
  await window.recalculateWithPanAnchor(e);
}
window.toggleComponentBuyMode = toggleComponentBuyMode;

function getNodePriceStrategy(node) {
  const globalStrategy = document.getElementById('input-price-mode')?.value || 'sell';
  return window.customBuyModes[node.typeId] || globalStrategy;
}

function calculateTreeNodeCost(node) {
  const productTypeId = node.productTypeId || node.typeId;

  if (!node.isBuildingSelf || !node.children || node.children.length === 0) {
    const strategy = getNodePriceStrategy(node);

    // 'lp' only ever gets set by the LP Store page's own pill (js/app.js createNodeCard), which
    // only renders when window.__lpOfferByOutputTypeId already has a match for this component - so
    // this branch is unreachable on every other page. Prices this leaf from the matching LP offer
    // (cheapest-LP one, if more than one exists) instead of the market: the ISK portion (isk_cost +
    // required_items, both priced at Jita sell) becomes this node's calculatedCost same as any other
    // leaf, while the LP portion has nowhere to live in this ISK-only tree, so it's tallied on a
    // page-global accumulator the LP Store page reads after recalculate() finishes.
    if (strategy === 'lp') {
      const offers = window.__lpOfferByOutputTypeId && window.__lpOfferByOutputTypeId[productTypeId];
      if (offers && offers.length) {
        const offer = offers.slice().sort((a, b) => a.lp_cost - b.lp_cost)[0];
        const batches = Math.ceil(node.qtyNeeded / (offer.quantity || 1));
        let requiredItemsCost = 0;
        (offer.required_items || []).forEach(r => {
          requiredItemsCost += ((window.priceCache[r.type_id] || {}).sell || 0) * r.quantity;
        });
        window.__lpSpentThisRecalc = (window.__lpSpentThisRecalc || 0) + batches * offer.lp_cost;
        node._lpAcquiredOffer = offer;
        node._lpAcquiredBatches = batches;
        node.calculatedCost = batches * (offer.isk_cost + requiredItemsCost);
        return node.calculatedCost;
      }
      // No matching offer found (shouldn't normally happen - the pill that sets this only ever
      // renders when one exists) - fall through to sell pricing rather than silently costing 0.
    }
    node._lpAcquiredOffer = null;

    const prices = window.priceCache[productTypeId] || { sell: 0, buy: 0 };
    let unitPrice = strategy === 'sell' ? prices.sell : prices.buy;
    if (strategy === 'buy') {
      const brokerFeeInput = document.getElementById('broker-fee');
      const brokerFee = brokerFeeInput ? (parseFloat(brokerFeeInput.value) || 0) / 100 : 0.01;
      unitPrice = unitPrice * (1 + brokerFee);
    }
    // Cost/profit always reflects the full economic value of everything this build actually needs,
    // regardless of what you currently have in stock - a stable, predictable number that doesn't
    // swing based on stock levels. "Deduct Stock" now only affects the BOM sidebar's shopping list
    // and Copy Multibuy (what you still need to go acquire), handled separately from cost/profit.
    node.calculatedCost = unitPrice * node.qtyNeeded;
    return node.calculatedCost;
  }

  let total = 0;
  node.children.forEach(child => {
    total += calculateTreeNodeCost(child);
  });
  node.calculatedCost = total;
  return total;
}

function calculateNodeJobFee(node, facilityTax, sccSurcharge, structureRoleBonus) {
  if (!node || !node.isBuildingSelf || !node.recipe || !node.recipe.materials) return 0;

  const sci = node.isReaction ? window.activeReactSCI : window.activeMfgSCI;
  const jobEIV = node.jobEIV || 0;

  const systemFee = jobEIV * sci * (1 - structureRoleBonus);
  const facilityFee = jobEIV * facilityTax;
  const sccFee = jobEIV * sccSurcharge;

  const totalNodeJobFee = systemFee + facilityFee + sccFee;

  node.jobFee = totalNodeJobFee;

  let childJobFees = 0;
  if (node.children && node.children.length > 0) {
    node.children.forEach(child => {
      childJobFees += calculateNodeJobFee(child, facilityTax, sccSurcharge, structureRoleBonus);
    });
  }

  return totalNodeJobFee + childJobFees;
}

// Explicit window bindings
window.syncTreeBuildStates = syncTreeBuildStates;
window.toggleBuildSelf = toggleBuildSelf;
window.onCardMEChange = onCardMEChange;
window.onCardTEChange = onCardTEChange;
window.buildAllComponents = buildAllComponents;
window.buyAllSubComponents = buyAllSubComponents;
window.resetSmartBuyModes = resetSmartBuyModes;
window.applyBuildProfitOptimizer = applyBuildProfitOptimizer;
window.applyComponentSpreadOptimizer = applyComponentSpreadOptimizer;
window.applyBudgetImpactOptimizer = applyBudgetImpactOptimizer;
window.setComponentBuyMode = setComponentBuyMode;
window.getNodePriceStrategy = getNodePriceStrategy;
window.calculateTreeNodeCost = calculateTreeNodeCost;
window.calculateNodeJobFee = calculateNodeJobFee;