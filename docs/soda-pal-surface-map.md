# Soda capability surface map

## Purpose and scope

This document is an inventory and decision record for the Soda capability
surface. It is not a public adapter export and it is not a generic argument
contract. The names below describe the supplied inventory only; a deferred
entry does not claim that Grits supports that operation.

The map has three dispositions:

- **Completed mapping** means that an existing Grits-owned operation is the
  selected boundary for the listed read behavior.
- **Next** means the operation is selected for the next Grits-owned slice, but
  is not claimed as implemented by this document.
- **Deferred** means the member remains outside the current Grits-owned
  surface until the stated contract is defined and implemented.

## Completed Grits mappings

| Grits operation | Inventory members | Semantics |
| --- | --- | --- |
| `objects.read` | `catBlob`, `showBlob`, `showBlobAsync` | Read object content through one Grits-owned object-read contract. The asynchronous member does not create a second surface. |
| `refs.resolve` | `resolveRev` | Resolve a revision or reference name to the Grits-owned reference identity used by later read operations. |
| `history.isAncestor` | `isAncestor` | Compare two commit IDs and return whether the first is an ancestor of the second, including the same-commit case. No presentation or repository mutation is part of this operation. |

These mappings intentionally cover read behavior only. Object creation,
reference mutation, formatting, and repository-state changes remain deferred.

## Complete inventory

### objects

| Member | Disposition | Reason |
| --- | --- | --- |
| `hashObjectStdin` | Deferred | Object identity and input ownership need a future domain contract. |
| `hashObjectForPath` | Deferred | Path-associated object identity needs a future domain contract. |
| `hashObjectNoWrite` | Deferred | Non-writing object identity still needs an explicit object domain contract. |
| `hashObjectForPathNoWrite` | Deferred | Path-associated identity and non-writing behavior need a future domain contract. |
| `hashObjectWriteBatch` | Deferred | Batch creation needs mutation and atomicity rules. |
| `hashObjectWriteBatchAsync` | Deferred | Asynchronous batch creation needs mutation and atomicity rules shared with the synchronous form. |
| `catBlob` | Completed mapping: `objects.read` | Read-only object content is covered by the completed object-read mapping. |
| `showBlob` | Completed mapping: `objects.read` | Read-only object content is covered by the completed object-read mapping. |
| `showBlobAsync` | Completed mapping: `objects.read` | Read-only object content uses the same completed object-read contract. |

### refs

| Member | Disposition | Reason |
| --- | --- | --- |
| `updateRefCas` | Deferred | Conditional reference mutation needs mutation and atomicity rules. |
| `fastForwardCheckout` | Deferred | Coupled reference and checkout behavior needs repository-feature and atomicity contracts. |
| `updateRef` | Deferred | Reference mutation needs mutation and atomicity rules. |
| `updateRefNoDeref` | Deferred | Direct reference mutation needs mutation and atomicity rules. |
| `remoteBranchesContaining` | Deferred | Containment across repository references needs a future repository-feature contract. |
| `deleteRef` | Deferred | Reference deletion needs mutation and atomicity rules. |
| `tagDelete` | Deferred | Tag deletion needs mutation and atomicity rules. |
| `tagCreate` | Deferred | Tag creation needs mutation and atomicity rules. |
| `tagAnnotated` | Deferred | Annotated-tag creation needs a future domain contract plus mutation and atomicity rules. |
| `tagList` | Deferred | Tag enumeration needs a future repository-feature contract. |

### index

| Member | Disposition | Reason |
| --- | --- | --- |
| `readTree` | Deferred | Index/tree interaction needs a future repository-feature contract. |
| `updateIndexCacheinfo` | Deferred | Index mutation needs mutation and atomicity rules. |
| `updateIndexForceRemove` | Deferred | Index removal needs mutation and atomicity rules. |
| `updateIndexForceRemovePathspec` | Deferred | Path-scoped index removal needs mutation and atomicity rules. |
| `updateIndexInfo` | Deferred | Index update semantics need a future repository-feature contract plus atomicity rules. |
| `writeTree` | Deferred | Tree materialization from index state needs a future repository-feature contract. |
| `statusPorcelain` | Deferred | Status presentation needs a future repository-feature contract. |
| `statusFull` | Deferred | Full status semantics need a future repository-feature contract. |
| `statusFullScoped` | Deferred | Scoped status semantics need a future repository-feature contract. |
| `stagedNames` | Deferred | Staged-name enumeration needs a future repository-feature contract. |
| `statusFullWithIgnored` | Deferred | Ignore-aware status semantics need a future repository-feature contract. |
| `statusBranch` | Deferred | Branch status semantics need a future repository-feature contract. |
| `statusBranchStream` | Deferred | Streaming branch status needs a future repository-feature contract and delivery rules. |

### commit

| Member | Disposition | Reason |
| --- | --- | --- |
| `commitTree` | Deferred | Commit creation needs a future domain contract plus mutation and atomicity rules. |
| `lsTreeNameOnly` | Deferred | Tree listing needs a future repository-feature contract. |
| `lsTreeNameOnlyZ` | Deferred | Delimited tree listing needs a future repository-feature contract and representation rules. |
| `lsTreeRecursiveZ` | Deferred | Recursive tree listing needs a future repository-feature contract and representation rules. |
| `lsTreePath` | Deferred | Path-specific tree listing needs a future repository-feature contract. |
| `lsTreeInfoZ` | Deferred | Detailed tree listing needs a future repository-feature contract and representation rules. |
| `mktree` | Deferred | Tree creation needs a future domain contract plus mutation and atomicity rules. |
| `show` | Deferred | Commit/object presentation needs a future domain contract and representation rules. |
| `logFormat` | Deferred | History presentation needs a future domain contract and representation rules. |
| `revListParents` | Deferred | Parent traversal needs a future repository-feature contract. |
| `catFileType` | Deferred | Object type inspection needs an explicit future object domain contract. |

### worktree

| Member | Disposition | Reason |
| --- | --- | --- |
| `checkout` | Deferred | Worktree transitions need repository-feature and mutation/atomicity contracts. |
| `checkoutDetach` | Deferred | Detached worktree transitions need repository-feature and mutation/atomicity contracts. |
| `checkoutPath` | Deferred | Path-scoped worktree mutation needs repository-feature and atomicity contracts. |
| `resetHard` | Deferred | Destructive worktree and index changes need mutation and atomicity rules. |
| `addDetach` | Deferred | Worktree creation needs repository-feature and mutation/atomicity contracts. |
| `addNoCheckout` | Deferred | Worktree registration without materialization needs repository-feature and atomicity contracts. |
| `sparseCheckoutInitCone` | Deferred | Sparse worktree setup needs a future repository-feature contract. |
| `sparseCheckoutSet` | Deferred | Sparse worktree mutation needs repository-feature and atomicity contracts. |
| `removeForce` | Deferred | Forced worktree removal needs mutation and atomicity rules. |
| `move` | Deferred | Worktree relocation needs repository-feature and mutation/atomicity contracts. |
| `prune` | Deferred | Worktree cleanup needs repository-feature and mutation/atomicity contracts. |

### history

| Member | Disposition | Reason |
| --- | --- | --- |
| `revParse` | Deferred | Revision parsing needs a future domain contract beyond reference resolution. |
| `resolveCommit` | Deferred | Commit-specific resolution needs a future repository-feature contract. |
| `revListCount` | Deferred | History counting needs a future repository-feature contract. |
| `countCommits` | Deferred | History counting needs a future repository-feature contract. |
| `isAncestor` | Completed mapping: `history.isAncestor` | Read-only comparison of two commit IDs with a boolean ancestor result is covered by the completed history mapping. |
| `firstCommit` | Deferred | Root-commit discovery needs a future repository-feature contract. |
| `lookupBlobAt` | Deferred | Historical path-to-object lookup needs a future repository-feature contract. |
| `lookupBlobsAtBatch` | Deferred | Batched historical lookup needs a future repository-feature contract and batching rules. |
| `resolveRev` | Completed mapping: `refs.resolve` | Revision/reference resolution is covered by the completed reference-resolution mapping. |
| `splitPathRev` | Deferred | Path and revision parsing needs a future domain contract. |
| `mergeBase` | Deferred | Graph-base computation needs a future repository-feature contract. |
| `revListObjects` | Deferred | Reachability traversal needs a future repository-feature contract. |
| `objectSizes` | Deferred | Reachability and size reporting need a future repository-feature contract. |

### merge

| Member | Disposition | Reason |
| --- | --- | --- |
| `mergeFfOnly` | Deferred | Merge mutation needs a future repository-feature contract plus mutation and atomicity rules. |
| `rebaseOnto` | Deferred | Rebase mutation needs a future repository-feature contract plus mutation and atomicity rules. |
| `rebaseAbort` | Deferred | Rebase recovery mutation needs a future repository-feature contract plus atomicity rules. |

### diff

| Member | Disposition | Reason |
| --- | --- | --- |
| `nameStatusZ` | Deferred | Change enumeration needs a future repository-feature contract and representation rules. |
| `nameStatusZBetween` | Deferred | Comparative change enumeration needs a future repository-feature contract and representation rules. |
| `noIndex` | Deferred | Untracked comparison needs a future repository-feature contract. |
| `unmergedNames` | Deferred | Conflict enumeration needs a future repository-feature contract. |
| `cachedQuiet` | Deferred | Cached-change detection needs a future repository-feature contract. |
| `configShowOrigin` | Deferred | Configuration inspection needs a future repository-feature contract. |

### blame

| Member | Disposition | Reason |
| --- | --- | --- |
| `porcelain` | Deferred | Line attribution needs a future domain contract and repository-feature contract. |
| `revPath` | Deferred | Revision/path attribution needs a future domain contract and repository-feature contract. |

### remote

| Member | Disposition | Reason |
| --- | --- | --- |
| `originUrl` | Deferred | Remote identity needs a future transport contract. |
| `fetchUpstream` | Deferred | Remote synchronization needs a future transport contract plus mutation and atomicity rules. |
| `pushFf` | Deferred | Remote update needs a future transport contract plus mutation and atomicity rules. |
| `pushForceWithLease` | Deferred | Conditional remote mutation needs a future transport contract plus mutation and atomicity rules. |

### bootstrap

| Member | Disposition | Reason |
| --- | --- | --- |
| `init` | Deferred | Repository creation is a repository feature with mutation and atomicity requirements. |
| `clone` | Deferred | Repository acquisition needs transport and repository-feature contracts. |

### repo

| Member | Disposition | Reason |
| --- | --- | --- |
| `connect` | Deferred | Repository connection needs a future repository-feature contract and boundary ownership rules. |

### system

| Member | Disposition | Reason |
| --- | --- | --- |
| `selfUpdate` | Deferred | This belongs to the separate non-Git system boundary. |
| `selfBuild` | Deferred | This belongs to the separate non-Git system boundary. |
| `launchBrowserWindow` | Deferred | This belongs to the separate non-Git system boundary. |

## Boundary decision

The current Grits-owned surface is limited to the completed `objects.read`,
`refs.resolve`, and `history.isAncestor` mappings. Every remaining inventory
member is **Deferred** until its future domain contract, mutation and atomicity
policy, repository feature contract, transport contract, or separate non-Git
system boundary is explicitly established. This document does not claim support
for any deferred member.
