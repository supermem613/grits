# grits

> Typed Git repository API for filesystem and in-memory repositories.

## Quick start

```bash
git clone https://github.com/<you>/grits.git ~/repos/grits
cd ~/repos/grits
npm install
npm run build
```

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

The first read slice supports `objects.read` and `refs.resolve` for both
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
Filesystem history ancestry currently accepts only full hexadecimal canonical
commit IDs; revision expressions such as `HEAD` are not accepted yet, and
broader revision support plus history mutation operations remain deferred.

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
are not supported. Check the error's `code` and `operation` fields when
handling typed failures:

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
  conformance/        # PAL surface registry
test/
  run.mjs             # Cross-platform test runner (HOME-sandboxed)
  tsconfig.json       # Test type-check config
  unit/               # Unit tests (*.test.ts)
  integration/        # Integration tests (*.test.ts)
```

## License

MIT
