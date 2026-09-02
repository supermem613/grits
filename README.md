# grits

> TypeScript Git Library

## Library API

The package root is the public Grits library entry. Import `createGrits` and
`GritsError` from `grits`:

```ts
import { createGrits, GritsError } from "grits";
```

Choose a repository explicitly when constructing the API. Filesystem
repositories require a non-empty path:

```ts
const filesystemGrits = createGrits({
  repository: { kind: "filesystem", path: "/path/to/repository" },
});
```

For an in-memory repository, omit the optional seed or provide one:

```ts
const memoryGrits = createGrits({
  repository: { kind: "memory" },
});
```

`createGrits` is synchronous and lazy: it returns the API object immediately
without opening the repository. The returned `capabilities` profile is
readonly and reports the selected repository kind plus the `objects.read`,
`refs.resolve`, and `history.isAncestor` capability statuses.

The public API supports `objects.read` and `refs.resolve` for both
explicit filesystem and memory repositories. The operations are asynchronous:

```ts
const object = await memoryGrits.objects.read(objectId);
const ref = await memoryGrits.refs.resolve("HEAD");
```

History ancestry checks are available through the same public handle:

```ts
const isAncestor = await memoryGrits.history.isAncestor(ancestorId, descendantId);
```

`history.isAncestor(ancestorId, descendantId)` accepts commit-ID strings and
returns a boolean. The result is `true` when the ancestor commit is reachable
from the descendant commit, including when both IDs name the same commit, and
`false` when it is not. Memory and filesystem repositories provide the same
commit-ID semantics. A missing or non-commit input rejects with the typed
`GritsError` code `NOT_FOUND` for the `history.isAncestor` operation. If a
reachable memory commit has a missing or non-commit parent link, the check also
fails loudly with that typed error instead of returning a false result.
Filesystem history ancestry accepts only full hexadecimal canonical commit IDs.
Revision expressions such as `HEAD` are NYI. History mutation is NYI.

Memory repositories read only their optional seeded objects and refs. An
unknown ref resolves to `null`; an unknown object rejects with the typed
`GritsError` code `NOT_FOUND`. Memory repositories never fall back to a
filesystem or Git implementation.

Filesystem repository access is lazy: `createGrits` returns synchronously, and
repository access begins when an asynchronous read or ref-resolution operation
is started. Filesystem reads expose blob, tree, and commit domain values, while
ref resolutions include the ref name and its object ID. Filesystem repository
or repository-access process failures reject with `GritsError` code
`REPOSITORY_UNAVAILABLE`.

`UNSUPPORTED_CAPABILITY` is the typed code reserved for future operations that
are not supported. `AUTH` is the typed code when HTTPS Smart HTTP returns HTTP
401. Grits does not send credentials. Check the error's `code` and `operation`
fields when handling typed failures:

```ts
try {
  await memoryGrits.objects.read(objectId);
} catch (error) {
  if (error instanceof GritsError && error.code === "NOT_FOUND") {
    console.log(`Object not found during ${error.operation}`);
  }
}
```

Import the library from `grits` in application code. There is no CLI.

## Support

The public library is three read operations on `createGrits`. The table below
lists additional git operations Grits implements internally. Those operations
are not a public export.

### Public library

| Operation | Status | Limits |
| --- | --- | --- |
| `objects.read` | Supported | Loose objects and pack v2 with idx v2. Pack v1 and other pack versions are NYI. |
| `refs.resolve` | Supported | Memory repositories read seeded refs only. An unknown ref returns `null`. |
| `history.isAncestor` | Supported | Filesystem accepts full hexadecimal commit IDs only. `HEAD` and other revision expressions are NYI. |

### Internal operations

| Family | Operation | Status | Limits |
| --- | --- | --- | --- |
| objects | `hashObjectStdin` | Supported | Writes a loose blob when a repository path is present. |
| objects | `hashObjectForPath` | Supported | Hashes and writes the file at `path`. |
| objects | `hashObjectNoWrite` | Supported | Hashes stdin and does not write. |
| objects | `hashObjectForPathNoWrite` | Supported | Hashes the file at `path` and does not write. |
| objects | `hashObjectWriteBatch` | Supported | Writes each path as a loose blob. |
| objects | `hashObjectWriteBatchAsync` | Supported | Same write batch as the synchronous operation. |
| objects | `catBlob` | Supported | Public `objects.read`. |
| objects | `showBlob` | Supported | Public `objects.read`. |
| objects | `showBlobAsync` | Supported | Public `objects.read`. |
| refs | `updateRefCas` | Supported | Conditional ref update. |
| refs | `fastForwardCheckout` | Supported | Fast-forward plus checkout. |
| refs | `updateRef` | Supported | Updates the named ref. |
| refs | `updateRefNoDeref` | Supported | Updates the named ref without following symbolic refs. |
| refs | `remoteBranchesContaining` | Supported | Lists remote branches that contain a commit. |
| refs | `deleteRef` | Supported | Deletes the named ref. |
| refs | `tagDelete` | Supported | Deletes `refs/tags/<name>`. |
| refs | `tagCreate` | Supported | Lightweight tag at HEAD. |
| refs | `tagAnnotated` | Supported | Annotated tag at HEAD. |
| refs | `tagList` | Supported | Lists short tag names. |
| index | `readTree` | Supported | Loads a tree into the index. |
| index | `updateIndexCacheinfo` | Supported | Index cache-info update. |
| index | `updateIndexForceRemove` | Supported | Force-removes a path from the index. |
| index | `updateIndexForceRemovePathspec` | Supported | Force-removes a pathspec from the index. |
| index | `updateIndexInfo` | Supported | Index info update. |
| index | `writeTree` | Supported | Writes a tree from the index. |
| index | `statusPorcelain` | Supported | Porcelain status. |
| index | `statusFull` | Supported | NUL-delimited status. |
| index | `statusFullScoped` | Supported | Path-scoped NUL-delimited status. |
| index | `stagedNames` | Supported | Lists staged names. |
| index | `statusFullWithIgnored` | Supported | Status including ignored paths. |
| index | `statusBranch` | Supported | Status with branch header. |
| index | `statusBranchStream` | Supported | Same as `statusBranch`. |
| commit | `commitTree` | Supported | Creates a commit from a tree. |
| commit | `lsTreeNameOnly` | Supported | Tree names only. |
| commit | `lsTreeNameOnlyZ` | Supported | NUL-delimited tree names. |
| commit | `lsTreeRecursiveZ` | Supported | Recursive NUL-delimited tree listing. |
| commit | `lsTreePath` | Supported | Path-scoped tree listing. |
| commit | `lsTreeInfoZ` | Supported | Detailed NUL-delimited tree listing. |
| commit | `mktree` | Supported | Creates a tree object. |
| commit | `show` | Supported | Commit presentation. |
| commit | `logFormat` | Supported | Subject log for one revision. |
| commit | `revListParents` | Supported | Parent listing. |
| commit | `catFileType` | Supported | Object type for a revision. |
| worktree | `checkout` | Supported | Checks out a revision. |
| worktree | `checkoutDetach` | Supported | Detached checkout. |
| worktree | `checkoutPath` | Supported | Path-scoped checkout. |
| worktree | `resetHard` | Supported | Hard reset to a revision. |
| worktree | `addDetach` | Supported | Adds a detached worktree. |
| worktree | `addNoCheckout` | Supported | Registers a worktree without checkout. |
| worktree | `sparseCheckoutInitCone` | Supported | Initializes cone sparse checkout. |
| worktree | `sparseCheckoutSet` | Supported | Sets cone patterns and resets the worktree. |
| worktree | `removeForce` | Supported | Force-removes a worktree. |
| worktree | `move` | Supported | Moves a worktree. |
| worktree | `prune` | Supported | Prunes stale worktrees. |
| history | `revParse` | Supported | Resolves a revision. |
| history | `resolveCommit` | Supported | Resolves a revision to a commit. |
| history | `revListCount` | Supported | Counts reachable commits. |
| history | `countCommits` | Supported | Same as `revListCount`. |
| history | `isAncestor` | Supported | Public `history.isAncestor`. |
| history | `firstCommit` | Supported | Root commit on the revision. |
| history | `lookupBlobAt` | Supported | Blob at path in a revision. |
| history | `lookupBlobsAtBatch` | Supported | Same lookup as `lookupBlobAt`. |
| history | `resolveRev` | Supported | Public `refs.resolve`. |
| history | `splitPathRev` | Supported | Splits `rev:path`. |
| history | `mergeBase` | Supported | Merge-base of two revisions. |
| history | `revListObjects` | Supported | Reachable object listing. |
| history | `objectSizes` | Supported | Reachable object sizes. |
| merge | `mergeFfOnly` | Supported | Fast-forward merge only. |
| merge | `rebaseOnto` | Supported | Rebase onto a new base. |
| merge | `rebaseAbort` | Supported | Aborts an in-progress rebase. |
| diff | `nameStatusZ` | Supported | NUL-delimited name-status. |
| diff | `nameStatusZBetween` | Supported | Name-status between two revisions. |
| diff | `noIndex` | Supported | Untracked file comparison. |
| diff | `unmergedNames` | Supported | Unmerged index names. |
| diff | `cachedQuiet` | Supported | Quiet cached diff. |
| diff | `configShowOrigin` | Supported | Config origin for a key. |
| blame | `porcelain` | Supported | Porcelain blame. |
| blame | `revPath` | Supported | Blame for a path. |
| remote | `originUrl` | Supported | Reads `remote.origin.url`. |
| remote | `fetchUpstream` | Supported | Local path remotes, `file://`, anonymous HTTPS Smart HTTP (protocol v1 and v2), and anonymous `git://` (TCP 9418, protocol v1). SSH, URL userinfo, `git://user@`, and credential helpers are NYI. HTTPS 401 rejects with `AUTH`. |
| remote | `pushFf` | Supported | Local path remotes, `file://`, anonymous HTTPS receive-pack (protocol v1), and anonymous `git://` (protocol v1). Protocol v2 push, SSH, URL userinfo, `git://user@`, and credential helpers are NYI. HTTPS 401 rejects with `AUTH`. |
| remote | `pushForceWithLease` | Partial | Local path remotes and `file://` only. HTTPS, SSH, `git://`, URL userinfo, and credential helpers are NYI. |
| bootstrap | `init` | Supported | Initializes a repository with `refs/heads/master`. |
| bootstrap | `clone` | Supported | Local path clone, `file://`, anonymous HTTPS clone (protocol v1 and v2, advertised default branch), and anonymous `git://` clone (protocol v1). SSH, URL userinfo, `git://user@`, and credential helpers are NYI. HTTPS 401 rejects with `AUTH`. |
| bootstrap | `connect` | Supported | Resolves HEAD. |
| repo | `init` | Supported | Same as `bootstrap.init`. |
| repo | `clone` | Supported | Same as `bootstrap.clone`. |
| repo | `connect` | Supported | Same as `bootstrap.connect`. |
| system | `selfUpdate` | NYI | Host operation, not a git repository operation. |
| system | `selfBuild` | NYI | Host operation, not a git repository operation. |
| system | `launchBrowserWindow` | NYI | Host operation, not a git repository operation. |

Memory repositories do not run remote sync. HTTPS push does not speak protocol
v2. Thin packs and ofs-delta pack writes are NYI. Grits does not send
credentials on HTTPS or `git://`.

## Conventions

- **Lean deps.** Runtime deps stay at zero. Add a runtime dep only with a
  clear reason — every dep is supply-chain risk.

## Development

```bash
npm run build               # tsc -> dist/
npm run lint                # type-check (src + test)
npm test                    # all tests
npm run test:unit           # unit only
npm run test:integration    # integration only
npm run clean               # remove dist/
```

CI runs on Ubuntu + Windows via GitHub Actions (`.github/workflows/ci.yml`).

## Project structure

```
src/
  index.ts            # Public library entry
  api/                # Public types and errors
  internal/           # Adapters and Git internals
  conformance/        # Operation registry
test/
  run.mjs             # Cross-platform test runner (HOME-sandboxed)
  tsconfig.json       # Test type-check config
  unit/               # Unit tests (*.test.ts)
  integration/        # Integration tests (*.test.ts)
```

## License

MIT
