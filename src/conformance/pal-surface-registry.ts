import { GritsError } from "../api/errors.js";
import { hashBlob } from "../internal/hash-blob.js";
import { writeLooseBlob } from "../internal/loose-object.js";

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

export type PalSlotContext = {
  repositoryPath?: string;
  stdin?: string;
};

export async function invokePalSlot(
  slotId: string,
  context: PalSlotContext = {},
): Promise<string> {
  if (!nyiPalSlotIds.includes(slotId)) {
    throw new GritsError(
      "INVALID_CONFIG",
      "invokePalSlot only accepts NYI PAL slot IDs.",
      slotId,
    );
  }

  const hashObjectSlots = new Set([
    "objects.hashObjectStdin",
    "objects.hashObjectForPath",
    "objects.hashObjectNoWrite",
    "objects.hashObjectForPathNoWrite",
    "objects.hashObjectWriteBatch",
    "objects.hashObjectWriteBatchAsync",
  ]);
  if (hashObjectSlots.has(slotId)) {
    if (typeof context.stdin !== "string") {
      throw new GritsError(
        "INVALID_CONFIG",
        "invokePalSlot requires stdin for object hash slots.",
        slotId,
      );
    }

    const content = Buffer.from(context.stdin);
    const id = hashBlob(content);
    if (
      (slotId === "objects.hashObjectStdin" ||
        slotId === "objects.hashObjectForPath" ||
        slotId === "objects.hashObjectWriteBatch" ||
        slotId === "objects.hashObjectWriteBatchAsync") &&
      typeof context.repositoryPath === "string" &&
      context.repositoryPath.length > 0
    ) {
      await writeLooseBlob(context.repositoryPath, content);
    }
    return id;
  }

  throw new GritsError(
    "NYI",
    `NYI: ${slotId} is not implemented.`,
    slotId,
  );
}
