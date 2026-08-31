# @agile-team/mach-table-react

## 0.23.0

### Minor Changes

- Surface the Core 0.23 governed API, incremental row update path and bounded remote datasource behavior through the existing single-package React installation; no adapter migration is required.

### Patch Changes

- Updated dependencies:
  - @agile-team/mach-table@0.23.0

## 0.19.1

### Patch Changes

- Publish the complete React installation and Worker guidance as npm registry README metadata.
- Updated dependencies:
  - @agile-team/mach-table@0.19.1

## 0.19.0

### Minor Changes

- Expose Core 0.19 domain APIs, batched updates, scoped refresh, random block datasources and optional Worker processing through the existing one-package React installation.
- Preserve Provider, hooks, lazy loading and renderer lifecycle compatibility while synchronizing public types.

### Patch Changes

- Updated dependencies:
  - @agile-team/mach-table@0.19.0

## 0.18.1

### Patch Changes

- Add direct CommonJS root-entry execution to the package export gate and keep the framework package line synchronized.
- Updated dependencies
  - @agile-team/mach-table@0.18.1

## 0.18.0

### Minor Changes

- Forward nested advanced filters through auto/manual remote-query requests and reset state.
- Add detailed save results, failure/conflict state, failed-row discovery and explicit conflict resolution to `useMachTableEditing()`.
- Refresh React cell renderers through the existing root instead of remounting on ordinary value updates.

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

- Re-export the 0.13 Core column workbench, lazy tree loading contracts and events through the React single-package entry.
- Keep Provider/table overrides and StrictMode lifecycle behavior compatible with existing 0.x consumers.
- Rename internal adapter modules and primary tests to the canonical `MachTable` name while retaining the documented `RobotGrid` compatibility export.

### Patch Changes

- Align npm author metadata with the package license and authorization documentation.
- Updated dependencies
  - @agile-team/mach-table@0.13.0

## 0.10.0

### Minor Changes

- Re-export the 0.10 Core API including semantic column types, action policies, partial save results, versioned column state and managed features.
- Keep Provider/table option overrides and StrictMode-safe lifecycle behavior compatible with 0.9.

### Patch Changes

- Minify production artifacts while retaining source maps and declaration output.
- Updated dependencies
  - @agile-team/mach-table@0.10.0

## 0.9.1

### Patch Changes

- Apply the MachTable Source-Available License 1.0 and document the prior written authorization requirement in the published package.
- Updated dependencies
  - @agile-team/mach-table@0.9.1

## 0.9.0

### Minor Changes

- Add `MachTableProvider` for application/route defaults, canonical `MachTable` props, accurate readiness, and stable lazy-loading support.
- Batch all reactive option changes into one atomic core update and retain the deprecated `RobotGrid` alias for 0.x compatibility.
- Re-export full-row editing and action-column helpers; support `editType` and `editableIndicator` props without adapter glue.

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
