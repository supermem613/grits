import { GritsError } from "../api/errors.js";

const PAL_SLOTS_BY_FAMILY = {
  objects: [
    "hashObjectStdin",
    "hashObjectForPath",
    "hashObjectNoWrite",
    "hashObjectForPathNoWrite",
    "hashObjectWriteBatch",
    "hashObjectWriteBatchAsync",
    "catBlob",
    "showBlob",
    "showBlobAsync",
  ],
  refs: [
    "updateRefCas",
    "fastForwardCheckout",
    "updateRef",
    "updateRefNoDeref",
    "remoteBranchesContaining",
    "deleteRef",
    "tagDelete",
    "tagCreate",
    "tagAnnotated",
    "tagList",
  ],
  index: [
    "readTree",
    "updateIndexCacheinfo",
    "updateIndexForceRemove",
    "updateIndexForceRemovePathspec",
    "updateIndexInfo",
    "writeTree",
    "statusPorcelain",
    "statusFull",
    "statusFullScoped",
    "stagedNames",
    "statusFullWithIgnored",
    "statusBranch",
    "statusBranchStream",
  ],
  commit: [
    "commitTree",
    "lsTreeNameOnly",
    "lsTreeNameOnlyZ",
    "lsTreeRecursiveZ",
    "lsTreePath",
    "lsTreeInfoZ",
    "mktree",
    "show",
    "logFormat",
    "revListParents",
    "catFileType",
  ],
  worktree: [
    "checkout",
    "checkoutDetach",
    "checkoutPath",
    "resetHard",
    "addDetach",
    "addNoCheckout",
    "sparseCheckoutInitCone",
    "sparseCheckoutSet",
    "removeForce",
    "move",
    "prune",
  ],
  history: [
    "revParse",
    "resolveCommit",
    "revListCount",
    "countCommits",
    "isAncestor",
    "firstCommit",
    "lookupBlobAt",
    "lookupBlobsAtBatch",
    "resolveRev",
    "splitPathRev",
    "mergeBase",
    "revListObjects",
    "objectSizes",
  ],
  merge: ["mergeFfOnly", "rebaseOnto", "rebaseAbort"],
  diff: [
    "nameStatusZ",
    "nameStatusZBetween",
    "noIndex",
    "unmergedNames",
    "cachedQuiet",
    "configShowOrigin",
  ],
  blame: ["porcelain", "revPath"],
  remote: ["originUrl", "fetchUpstream", "pushFf", "pushForceWithLease"],
  bootstrap: ["init", "clone", "connect"],
  repo: ["init", "clone", "connect"],
  system: ["selfUpdate", "selfBuild", "launchBrowserWindow"],
} as const;

export const palSlotToCanonicalOperation: Readonly<Record<string, string>> = Object.freeze({
  "objects.catBlob": "objects.read",
  "objects.showBlob": "objects.read",
  "objects.showBlobAsync": "objects.read",
  "history.resolveRev": "refs.resolve",
  "history.isAncestor": "history.isAncestor",
});

export const palSlotIds: readonly string[] = Object.freeze(
  Object.entries(PAL_SLOTS_BY_FAMILY).flatMap(([family, members]) =>
    members.map((member) => `${family}.${member}`),
  ).sort(),
);

export const mappedPalSlotIds: readonly string[] = Object.freeze(
  Object.keys(palSlotToCanonicalOperation).sort(),
);

export const nyiPalSlotIds: readonly string[] = Object.freeze(
  palSlotIds.filter((slotId) => palSlotToCanonicalOperation[slotId] === undefined),
);

export async function invokePalSlot(slotId: string): Promise<never> {
  if (!nyiPalSlotIds.includes(slotId)) {
    throw new GritsError(
      "INVALID_CONFIG",
      "invokePalSlot only accepts NYI PAL slot IDs.",
      slotId,
    );
  }

  throw new GritsError(
    "UNSUPPORTED_CAPABILITY",
    `Capability ${slotId} is not implemented.`,
    slotId,
  );
}
