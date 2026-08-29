# @agile-team/mach-table

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
