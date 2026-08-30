# @agile-team/mach-table-xlsx

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

- Add an optional engine-agnostic XLSX import/export bridge.
- Support lazy engine loading so Excel code never enters Core or normal framework chunks.
- Reuse Core CSV serialization/import rules for formula protection, column selection and safe field mapping.

### Patch Changes

- Align npm author metadata with the package license and authorization documentation.
