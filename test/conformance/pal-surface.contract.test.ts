import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  mappedPalSlotIds,
  nyiPalSlotIds,
  palSlotIds,
  palSlotToCanonicalOperation,
} from "../../src/conformance/pal-surface-registry.js";

// Oracle: namespaced Soda PAL slots from soda/src/git/pal.ts.
// Production must match this contract and is not free to choose another set.
const SODA_PAL_SLOT_IDS = [
  "objects.hashObjectStdin",
  "objects.hashObjectForPath",
  "objects.hashObjectNoWrite",
  "objects.hashObjectForPathNoWrite",
  "objects.hashObjectWriteBatch",
  "objects.hashObjectWriteBatchAsync",
  "objects.catBlob",
  "objects.showBlob",
  "objects.showBlobAsync",
  "refs.updateRefCas",
  "refs.fastForwardCheckout",
  "refs.updateRef",
  "refs.updateRefNoDeref",
  "refs.remoteBranchesContaining",
  "refs.deleteRef",
  "refs.tagDelete",
  "refs.tagCreate",
  "refs.tagAnnotated",
  "refs.tagList",
  "index.readTree",
  "index.updateIndexCacheinfo",
  "index.updateIndexForceRemove",
  "index.updateIndexForceRemovePathspec",
  "index.updateIndexInfo",
  "index.writeTree",
  "index.statusPorcelain",
  "index.statusFull",
  "index.statusFullScoped",
  "index.stagedNames",
  "index.statusFullWithIgnored",
  "index.statusBranch",
  "index.statusBranchStream",
  "commit.commitTree",
  "commit.lsTreeNameOnly",
  "commit.lsTreeNameOnlyZ",
  "commit.lsTreeRecursiveZ",
  "commit.lsTreePath",
  "commit.lsTreeInfoZ",
  "commit.mktree",
  "commit.show",
  "commit.logFormat",
  "commit.revListParents",
  "commit.catFileType",
  "worktree.checkout",
  "worktree.checkoutDetach",
  "worktree.checkoutPath",
  "worktree.resetHard",
  "worktree.addDetach",
  "worktree.addNoCheckout",
  "worktree.sparseCheckoutInitCone",
  "worktree.sparseCheckoutSet",
  "worktree.removeForce",
  "worktree.move",
  "worktree.prune",
  "history.revParse",
  "history.resolveCommit",
  "history.revListCount",
  "history.countCommits",
  "history.isAncestor",
  "history.firstCommit",
  "history.lookupBlobAt",
  "history.lookupBlobsAtBatch",
  "history.resolveRev",
  "history.splitPathRev",
  "history.mergeBase",
  "history.revListObjects",
  "history.objectSizes",
  "merge.mergeFfOnly",
  "merge.rebaseOnto",
  "merge.rebaseAbort",
  "diff.nameStatusZ",
  "diff.nameStatusZBetween",
  "diff.noIndex",
  "diff.unmergedNames",
  "diff.cachedQuiet",
  "diff.configShowOrigin",
  "blame.porcelain",
  "blame.revPath",
  "remote.originUrl",
  "remote.fetchUpstream",
  "remote.pushFf",
  "remote.pushForceWithLease",
  "bootstrap.init",
  "bootstrap.clone",
  "bootstrap.connect",
  "repo.init",
  "repo.clone",
  "repo.connect",
  "system.selfUpdate",
  "system.selfBuild",
  "system.launchBrowserWindow",
] as const;

const SODA_MAPPED_PAL_SLOT_IDS = [
  "objects.catBlob",
  "objects.showBlob",
  "objects.showBlobAsync",
  "history.resolveRev",
  "history.isAncestor",
] as const;

const SODA_SLOT_TO_CANONICAL = {
  "objects.catBlob": "objects.read",
  "objects.showBlob": "objects.read",
  "objects.showBlobAsync": "objects.read",
  "history.resolveRev": "refs.resolve",
  "history.isAncestor": "history.isAncestor",
} as const;

const SODA_MAPPED_PAL_SLOT_ID_SET = new Set<string>(SODA_MAPPED_PAL_SLOT_IDS);
const SODA_NYI_PAL_SLOT_IDS = SODA_PAL_SLOT_IDS.filter(
  (slotId) => !SODA_MAPPED_PAL_SLOT_ID_SET.has(slotId),
);

describe("PAL surface registry", () => {
  it("freezes the exact 91/5/86 Soda PAL slot contract", () => {
    assert.deepEqual([...palSlotIds], [...SODA_PAL_SLOT_IDS].sort());
    assert.deepEqual([...mappedPalSlotIds], [...SODA_MAPPED_PAL_SLOT_IDS].sort());
    assert.deepEqual([...nyiPalSlotIds], [...SODA_NYI_PAL_SLOT_IDS].sort());
    assert.deepEqual({ ...palSlotToCanonicalOperation }, { ...SODA_SLOT_TO_CANONICAL });
    assert.equal(palSlotIds.length, 91);
    assert.equal(mappedPalSlotIds.length, 5);
    assert.equal(nyiPalSlotIds.length, 86);
  });
});
