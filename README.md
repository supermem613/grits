# grits

> TypeScript Git Library

## Library API

The package root is the public Grits library entry. Import `git` and
`GritsError` from `grits`:

```ts
import { git, GritsError } from "grits";
```

Commands are flat and asynchronous. Pass a memory `repository` or a filesystem
`repository` / `repositoryPath` on the call:

```ts
const objectId = await git.hashObjectNoWrite({ stdin: "hello\n" });
await git.clone({ path: source, dest });
const payload = await git.catBlob({
  repository: { kind: "memory", seed },
  rev: objectId,
});
const isAncestor = await git.isAncestor({
  repository: { kind: "filesystem", path: "/path/to/repository" },
  rev: ancestorId,
  otherRev: descendantId,
});
```

`git.isAncestor` returns `"true"` or `"false"`. A missing or non-commit input
rejects with `GritsError` code `NOT_FOUND`. Filesystem ancestry accepts only
full hexadecimal commit IDs. `HEAD` and other revision expressions are NYI.

Memory repositories read only their optional seeded objects and refs. An
unknown ref resolves to `""`. An unknown object rejects with `NOT_FOUND`.
Memory repositories never fall back to a filesystem repository.

Filesystem access starts when the command runs. Repository-access failures
reject with `REPOSITORY_UNAVAILABLE`. `AUTH` is the code when HTTPS Smart HTTP
returns HTTP 401. Grits does not send credentials.

```ts
try {
  await git.catBlob({
    repository: { kind: "memory", seed },
    rev: objectId,
  });
} catch (error) {
  if (error instanceof GritsError && error.code === "NOT_FOUND") {
    console.log(`Object not found during ${error.operation}`);
  }
}
```

Import the library from `grits` in application code. There is no CLI.

## Support

### Git operations (`git`)

| Operation | Status | Limits |
| --- | --- | --- |
| `hashObjectStdin` | Supported | Writes a loose blob when a repository path is present. |
| `hashObjectForPath` | Supported | Hashes and writes the file at `path`. |
| `hashObjectNoWrite` | Supported | Hashes stdin and does not write. |
| `hashObjectForPathNoWrite` | Supported | Hashes the file at `path` and does not write. |
| `hashObjectWriteBatch` | Supported | Writes each path as a loose blob. |
| `hashObjectWriteBatchAsync` | Supported | Same write batch as the synchronous operation. |
| `catBlob` | Supported | Loose objects and pack v2 with idx v2. Pack v1 and other pack versions are NYI. |
| `showBlob` | Supported | Same as `catBlob`. |
| `showBlobAsync` | Supported | Same as `catBlob`. |
| `updateRefCas` | Supported | Conditional ref update. |
| `fastForwardCheckout` | Supported | Fast-forward plus checkout. |
| `updateRef` | Supported | Updates the named ref. |
| `updateRefNoDeref` | Supported | Updates the named ref without following symbolic refs. |
| `remoteBranchesContaining` | Supported | Lists remote branches that contain a commit. |
| `deleteRef` | Supported | Deletes the named ref. |
| `tagDelete` | Supported | Deletes `refs/tags/<name>`. |
| `tagCreate` | Supported | Lightweight tag at HEAD. |
| `tagAnnotated` | Supported | Annotated tag at HEAD. |
| `tagList` | Supported | Lists short tag names. |
| `readTree` | Supported | Loads a tree into the index. |
| `updateIndexCacheinfo` | Supported | Index cache-info update. |
| `updateIndexForceRemove` | Supported | Force-removes a path from the index. |
| `updateIndexForceRemovePathspec` | Supported | Force-removes a pathspec from the index. |
| `updateIndexInfo` | Supported | Index info update. |
| `writeTree` | Supported | Writes a tree from the index. |
| `statusPorcelain` | Supported | Porcelain status. |
| `statusFull` | Supported | NUL-delimited status. |
| `statusFullScoped` | Supported | Path-scoped NUL-delimited status. |
| `stagedNames` | Supported | Lists staged names. |
| `statusFullWithIgnored` | Supported | Status including ignored paths. |
| `statusBranch` | Supported | Status with branch header. |
| `statusBranchStream` | Supported | Same as `statusBranch`. |
| `commitTree` | Supported | Creates a commit from a tree. |
| `lsTreeNameOnly` | Supported | Tree names only. |
| `lsTreeNameOnlyZ` | Supported | NUL-delimited tree names. |
| `lsTreeRecursiveZ` | Supported | Recursive NUL-delimited tree listing. |
| `lsTreePath` | Supported | Path-scoped tree listing. |
| `lsTreeInfoZ` | Supported | Detailed NUL-delimited tree listing. |
| `mktree` | Supported | Creates a tree object. |
| `show` | Supported | Commit presentation. |
| `logFormat` | Supported | Subject log for one revision. |
| `revListParents` | Supported | Parent listing. |
| `catFileType` | Supported | Object type for a revision. |
| `checkout` | Supported | Checks out a revision. |
| `checkoutDetach` | Supported | Detached checkout. |
| `checkoutPath` | Supported | Path-scoped checkout. |
| `resetHard` | Supported | Hard reset to a revision. |
| `addDetach` | Supported | Adds a detached worktree. |
| `addNoCheckout` | Supported | Registers a worktree without checkout. |
| `sparseCheckoutInitCone` | Supported | Initializes cone sparse checkout. |
| `sparseCheckoutSet` | Supported | Sets cone patterns and resets the worktree. |
| `removeForce` | Supported | Force-removes a worktree. |
| `move` | Supported | Moves a worktree. |
| `prune` | Supported | Prunes stale worktrees. |
| `revParse` | Supported | Resolves a revision. |
| `resolveCommit` | Supported | Resolves a revision to a commit. |
| `revListCount` | Supported | Counts reachable commits. |
| `countCommits` | Supported | Same as `revListCount`. |
| `isAncestor` | Supported | Filesystem accepts full hexadecimal commit IDs only. `HEAD` and other revision expressions are NYI. |
| `firstCommit` | Supported | Root commit on the revision. |
| `lookupBlobAt` | Supported | Blob at path in a revision. |
| `lookupBlobsAtBatch` | Supported | Same lookup as `lookupBlobAt`. |
| `resolveRev` | Supported | Memory repositories read seeded refs only. An unknown ref returns `""`. |
| `splitPathRev` | Supported | Splits `rev:path`. |
| `mergeBase` | Supported | Merge-base of two revisions. |
| `revListObjects` | Supported | Reachable object listing. |
| `objectSizes` | Supported | Reachable object sizes. |
| `mergeFfOnly` | Supported | Fast-forward merge only. |
| `rebaseOnto` | Supported | Rebase onto a new base. |
| `rebaseAbort` | Supported | Aborts an in-progress rebase. |
| `nameStatusZ` | Supported | NUL-delimited name-status. |
| `nameStatusZBetween` | Supported | Name-status between two revisions. |
| `noIndex` | Supported | Untracked file comparison. |
| `unmergedNames` | Supported | Unmerged index names. |
| `cachedQuiet` | Supported | Quiet cached diff. |
| `configShowOrigin` | Supported | Config origin for a key. |
| `porcelain` | Supported | Porcelain blame. |
| `revPath` | Supported | Blame for a path. |
| `originUrl` | Supported | Reads `remote.origin.url`. |
| `fetchUpstream` | Supported | Local path remotes, `file://`, anonymous HTTPS Smart HTTP (protocol v1 and v2), and anonymous `git://` (TCP 9418, protocol v1). SSH, URL userinfo, `git://user@`, and credential helpers are NYI. HTTPS 401 rejects with `AUTH`. |
| `pushFf` | Supported | Local path remotes, `file://`, anonymous HTTPS receive-pack (protocol v1), and anonymous `git://` (protocol v1). Protocol v2 push, SSH, URL userinfo, `git://user@`, and credential helpers are NYI. HTTPS 401 rejects with `AUTH`. |
| `pushForceWithLease` | Partial | Local path remotes and `file://` only. HTTPS, SSH, `git://`, URL userinfo, and credential helpers are NYI. |
| `init` | Supported | Initializes a repository with `refs/heads/master`. |
| `clone` | Supported | Local path clone, `file://`, anonymous HTTPS clone (protocol v1 and v2, advertised default branch), and anonymous `git://` clone (protocol v1). SSH, URL userinfo, `git://user@`, and credential helpers are NYI. HTTPS 401 rejects with `AUTH`. |
| `connect` | Supported | Resolves HEAD. |

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
