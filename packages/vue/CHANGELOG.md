# @agile-team/mach-table-vue

## 0.25.0

### Minor Changes

- Reset sorting plus regular, advanced and quick filters with one deterministic remote request.
- Keep controlled quick-filter refs synchronized with Grid API changes while issuing exactly one remote request.
- Preserve both application-level event observers and page listeners, and align optional toolbar global types with the `/ui` plugin boundary.
- Add documentation import validation and correct all config-center, editor and renderer examples.

### Patch Changes

- Updated dependencies:
  - @agile-team/mach-table@0.25.0

## 0.24.0

### Minor Changes

- Align Vue with the canonical `MachTable`, `useMachTable`, `bindings` and domain API contracts; remove pre-adoption compatibility aliases and duplicate defaults injection.
- Keep the root entry focused on the component, lifecycle/config primitives and Core exports; move workflows, UI, framework adapters, editors and Worker helpers to explicit tree-shakeable subpaths.
- Support the unified per-table persistence configuration and strict application/preset configuration boundary.

### Patch Changes

- Updated dependencies:
  - @agile-team/mach-table@0.24.0

## 0.23.0

### Minor Changes

- Surface the Core 0.23 governed API, incremental row update path and bounded remote datasource behavior through the existing single-package Vue installation; no adapter migration is required.

### Patch Changes

- Updated dependencies:
  - @agile-team/mach-table@0.23.0

## 0.19.1

### Patch Changes

- Publish the complete Vue installation and Worker guidance as npm registry README metadata.
- Updated dependencies:
  - @agile-team/mach-table@0.19.1

## 0.19.0

### Minor Changes

- Expose Core 0.19 domain APIs, batched updates, scoped refresh, random block datasources and optional Worker processing through the existing one-package Vue installation.
- Keep Vue props, global/async plugins, native slots and controller workflows compatible while synchronizing the complete public type surface.

### Patch Changes

- Updated dependencies:
  - @agile-team/mach-table@0.19.0

## 0.18.1

### Patch Changes

- Fix the CommonJS root entry by removing duplicate explicit Core configuration re-exports that collided with the adapter's Core star export.
- Add direct ESM/CommonJS adapter entry execution to the package export gate so the published runtime path cannot regress silently.
- Updated dependencies
  - @agile-team/mach-table@0.18.1

## 0.18.0

### Minor Changes

- Forward nested advanced filters through auto/manual remote-query requests and reset state.
- Add detailed save results, failure/conflict state, failed-row discovery and explicit conflict resolution to `useMachTableEditing()`.
- Refresh Vue cell and slot renderers in place through reactive params instead of remounting on ordinary value updates.

### Patch Changes

- Updated dependencies
  - @agile-team/mach-table@0.18.0

## 0.15.0

### Minor Changes

- Make interactive column resizing an explicit opt-in, harden pointer cancellation and runtime toggling, persist completed width changes exactly once, preserve responsive automatic/flex widths across state restoration, expose a safe single-column width API, and synchronize framework examples and integration documentation.

### Patch Changes

- Updated dependencies
  - @agile-team/mach-table@0.15.0

## 0.14.0

### Minor Changes

- Deliver the 0.14 usability release: shared application configuration, compact row keys, automatic full-state persistence, explicit error and auto-height layouts, framework-neutral commands, resilient row-action saves, Vue/React controllers and remote workflows, optional standard toolbars, stronger consumer type gates, and synchronized examples and documentation.

### Patch Changes

- Updated dependencies
  - @agile-team/mach-table@0.14.0

## 0.13.0

### Minor Changes

- Add a lifecycle-safe `vueCellEditor()` factory and zero-dependency `createElementPlusEditors()` bridge through the tree-shakable `./editors` entry with optional host app context.
- Complete remote query empty/error overlay bindings while retaining cancellation, retries and cross-page/query-wide selection.
- Re-export the 0.13 Core workbench and lazy-tree APIs and events.
- Rename internal adapter modules and primary tests to the canonical `MachTable` name while retaining the documented `RobotGrid` compatibility export.

### Patch Changes

- Align npm author metadata with the package license and authorization documentation.
- Updated dependencies
  - @agile-team/mach-table@0.13.0

## 0.10.0

### Minor Changes

- Add dedicated `mach-table.config.ts` support with app/route/preset/table layering and option-source diagnostics.
- Add native cell/header/editor/loading/empty/detail/action slots and automatic fit layout.
- Add `useMachTableQuery()` for cancellable remote pagination, stale-response protection, cross-page/query-wide selection and retries.
- Add `useMachTableEditing()` for reactive dirty state, partial save, rollback, reveal and unsaved-page guards.
- Re-export semantic business columns, dictionary caches, action policies and versioned column storage from Core.

### Patch Changes

- Minify production artifacts and add a tree-shakable `./workflows` entry for query/editing composables while retaining root exports.
- Updated dependencies
  - @agile-team/mach-table@0.10.0

## 0.9.1

### Patch Changes

- Apply the MachTable Source-Available License 1.0 and document the prior written authorization requirement in the published package.
- Updated dependencies
  - @agile-team/mach-table@0.9.1

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
