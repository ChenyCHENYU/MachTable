# @agile-team/mach-table-vue

## 0.9.0

### Minor Changes

- Add application and route-scoped defaults through `MachTablePlugin` and `provideMachTableDefaults`, configurable async loading/error boundaries, accurate readiness, and canonical `MachTable` types.
- Batch all reactive option changes into one atomic core update and retain the deprecated `RobotGrid` alias for 0.x compatibility.
- Re-export full-row editing and action-column helpers; support reactive `editType` and `editableIndicator` props without adapter glue.

### Patch Changes

- Updated dependencies
  - @agile-team/mach-table@0.9.0

## 0.5.0

### Minor Changes

- Add production-ready loading strategies: Vue now supports typed synchronous and asynchronous global plugins with explicit preloading, while React exposes its component as the package default for direct `React.lazy` integration. Documentation and examples now cover local, global, route-level, SSR and lazy-loading adoption patterns.

### Patch Changes

- Updated dependencies
  - @agile-team/mach-table@0.5.0

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
