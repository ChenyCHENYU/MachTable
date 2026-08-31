# @agile-team/mach-table

## 0.23.0

### Minor Changes

- Establish API Governance V3 with eight lazy, responsibility-focused domain facades, cross-package signature snapshots and an explicit stable/experimental/internal policy while preserving the 0.x flat compatibility surface.
- Commit runtime option patches through one scheduler batch and skip the full local row pipeline for safe update-only transactions; sorted, filtered, grouped, tree, spanned and variable-height models retain the conservative full path.
- Bound random-access datasource concurrency, prioritize explicit loads and scroll-direction prefetch, add retry jitter and expose active/queued request diagnostics.
- Share browser Long Tasks observation across grid instances, strengthen 100k-row/500-column/continuous-scroll/lifecycle gates, and add semantic API/resource contract tests.
- Add fast runtime-only and map-free release builds plus publishable artifact budgets, reducing installed package size without changing consumer code.

## 0.19.1

### Patch Changes

- Embed the synchronized package README into npm registry metadata and add a release gate that prevents empty package-page documentation.

## 0.19.0

### Minor Changes

- Add coalesced `api.batch()` updates, targeted `refreshCells`, discoverable domain APIs and a checked public API snapshot while retaining all flat 0.x methods.
- Replace linear horizontal and variable-row geometry work with prefix/binary and Fenwick indexes; add root containment, stronger teardown and layout/model/long-task/heap diagnostics.
- Add opt-in random-access datasource blocks with request deduplication, cancellation, retry, adjacent prefetch, LRU eviction, loading rows and cache diagnostics.
- Add an optional CSP-safe `/worker` data processor subpath, standard serializable field processor and feature dependency semver ranges without putting Worker runtime code in the default entry.
- Expand performance, complexity, API, unit, package and documentation gates for the 0.19 contracts.

## 0.18.1

### Patch Changes

- Keep the synchronized package line on the verified 0.18.1 release and extend release validation to execute every framework adapter through both ESM and CommonJS entry points.

## 0.18.0

### Minor Changes

- Add metadata-driven runtime option sanitization and dependency-aware `GridFeature` manifests with version, requirement, conflict, cycle isolation and active-feature diagnostics.
- Add bounded nested advanced filters, GridState v1→v2 migration, safe named-view stores and explicit preference/business-state separation.
- Add snapshot-safe detailed batch saves with validation failures and version conflicts, plus conflict-resolution helpers that preserve edits made while a request is in flight.
- Add in-place cell renderer refresh and bounded viewport performance metrics with average, P95, long-render and rendered-range evidence.
- Harden persisted state and filter normalization against malformed, cyclic and oversized JavaScript/JSON input while reducing tracked complexity debt.

## 0.15.0

### Minor Changes

- Make interactive column resizing an explicit opt-in, harden pointer cancellation and runtime toggling, persist completed width changes exactly once, preserve responsive automatic/flex widths across state restoration, expose a safe single-column width API, and synchronize framework examples and integration documentation.

## 0.14.0

### Minor Changes

- Deliver the 0.14 usability release: shared application configuration, compact row keys, automatic full-state persistence, explicit error and auto-height layouts, framework-neutral commands, resilient row-action saves, Vue/React controllers and remote workflows, optional standard toolbars, stronger consumer type gates, and synchronized examples and documentation.

## 0.13.0

### Minor Changes

- Add a searchable built-in column workbench with visibility, pinning, ordering, sizing, reset and a headless item API for custom drawers.
- Add cancellable, deduplicated lazy tree loading with atomic subtree replacement, loading/error state, retries and lifecycle events.
- Add public workbench, lazy-tree and data-source error contracts while retaining the 0.x `openColumnPanel` compatibility alias.
- Consolidate the completed 0.10—0.13 product route without freezing the 1.0 API.

### Patch Changes

- Align npm author metadata with the copyright holder named in the package license: ChenyCHENYU (Agile Team).

## 0.10.0

### Minor Changes

- Add layered application presets, semantic column types, batched TTL/LRU dictionaries and central action permission/confirmation/error policies.
- Add controlled server pagination, typed option reads/writes, query-wide selection rules and partial-success change saving.
- Add versioned/migratable column preference storage, runtime GridOption validation with spelling suggestions, and automatically managed feature resources.
- Add Vue-native lifecycle support for renderer/overlay cleanup and constrained automatic column fitting in Core.
- Minify production artifacts with source maps, reducing the complete Core ESM gzip footprint below the existing 80 KB budget.

## 0.9.1

### Patch Changes

- Replace the MIT terms with the MachTable Source-Available License 1.0. Any use from this version requires prior written authorization from the copyright holder.
- Add an evidence-based AG Grid, Vxe-Table, Surely Table, Handsontable, RevoGrid and VTable gap analysis with benchmark and versioned delivery plans.

## 0.9.0

### Minor Changes

- Add versioned full-grid state capture/restore, typed column helpers, reusable enterprise presets, readiness promises, stable diagnostics/error codes, and atomic runtime option updates.
- Add row and column virtualization hardening, ordered async transaction batching, datasource retry with cancellation, lifecycle leak checks, and 100k-row/100-column performance gates.
- Add async edit validation plus dirty-row tracking, rollback, save snapshots, and safe acknowledgement of edits made while a save is in flight.
- Add polished cell edit affordances and confirm/cancel controls, transactionally staged full-row editing with per-cell/cross-field validation, setter rollback and grouped undo, plus row editing lifecycle APIs/events.
- Add arbitrary and row-aware action columns with semantic icon states, async/disabled actions, and menu, drawer or fully-inline overflow modes.
- Complete grid/treegrid ARIA metadata, active-descendant focus, header/body keyboard navigation, editable-cell Tab escape, and cross-browser interaction coverage.
- Add package export/consumer type gates and canonical `MachTable` APIs while retaining deprecated `RobotGrid` aliases throughout 0.x.

## 0.5.0

### Minor Changes

- Add production-ready loading strategies: Vue now supports typed synchronous and asynchronous global plugins with explicit preloading, while React exposes its component as the package default for direct `React.lazy` integration. Documentation and examples now cover local, global, route-level, SSR and lazy-loading adoption patterns.

## 0.4.1

### Patch Changes

- Simplify framework adoption to one package: Vue and React adapters now install the matching core automatically, re-export its complete public API and types, and expose framework-local stylesheet entry points.

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
