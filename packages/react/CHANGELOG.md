# @agile-team/mach-table-react

## 0.4.1

### Patch Changes

- Simplify framework adoption to one package: Vue and React adapters now install the matching core automatically, re-export its complete public API and types, and expose framework-local stylesheet entry points.
- Updated dependencies
  - @agile-team/mach-table@0.4.1

## 0.4.0

### Minor Changes

- Harden renderer lifecycles, infinite datasource cancellation and unknown-total loading,
  CSV/path security, runtime option updates, error reporting, framework adapter reactivity,
  package exports, tests, documentation, and CI/release verification.

  Add shared runtime option metadata, complete Vue/React prop synchronization,
  per-grid component registries, composable GridFeature lifecycles, typed/narrow service
  boundaries, safe overlay content defaults, coverage/E2E gates, and gzip size budgets.
  Overlay strings now render as text by default; trusted legacy HTML must opt in with
  `allowUnsafeOverlayHtml`, while HTMLElement factories remain the recommended path.

### Patch Changes

- Updated dependencies
  - @agile-team/mach-table@0.4.0
