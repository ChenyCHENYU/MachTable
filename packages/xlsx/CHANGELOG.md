# @agile-team/mach-table-xlsx

## 0.29.0

### Patch Changes

- Updated dependencies
  - @agile-team/mach-table@0.29.0

> `0.28.1` below records an internal implementation milestone folded into
> `0.29.0`; it was not published as a separate npm version.

## 0.28.1

### Patch Changes

- Keep body-mounted filters, column workbenches, menus, drawers, tooltips and column-drag previews scoped to the owning grid theme; align selection-column header and row checkboxes; and add a bounded visual column-drag preview.

  Keep cell editors mounted across pointer and focus changes, prevent IME composition Enter events from committing, and require the inline confirm/cancel controls or an explicit keyboard command to finish the edit transaction.

  Tree-shake package metadata so the browser runtime embeds only the public version string rather than the complete package manifest.

  Treat official utility and renderer-only columns as intentional display columns so row actions do not emit misleading development warnings.
- Updated dependencies
  - @agile-team/mach-table@0.28.1

## 0.28.0

### Patch Changes

- Keep the optional XLSX bridge aligned with the governed 0.28 Core release; the workbook engine remains external and optional.
- Updated dependencies:
  - @agile-team/mach-table@0.28.0

## 0.25.0

### Patch Changes

- Keep the optional XLSX extension aligned with the 0.25 state and API contracts.
- Updated dependencies:
  - @agile-team/mach-table@0.25.0

## 0.24.0

### Patch Changes

- Update the optional XLSX bridge to consume the canonical Core row, selection and IO domains without adding workbook runtime code to normal table pages.
- Updated dependencies:
  - @agile-team/mach-table@0.24.0

## 0.23.0

### Patch Changes

- Keep the optional XLSX bridge aligned with the governed 0.23 Core release without adding workbook code to the default bundle.
- Updated dependencies:
  - @agile-team/mach-table@0.23.0

## 0.19.1

### Patch Changes

- Publish the optional XLSX integration guide as npm registry README metadata.
- Updated dependencies:
  - @agile-team/mach-table@0.19.1

## 0.19.0

### Patch Changes

- Keep the optional XLSX bridge synchronized with the 0.19 Core API line without adding workbook code to the default grid bundle.
- Updated dependencies:
  - @agile-team/mach-table@0.19.0

## 0.18.1

### Patch Changes

- Keep the optional extension on the verified synchronized 0.18.1 package line.
- Updated dependencies
  - @agile-team/mach-table@0.18.1

## 0.18.0

### Patch Changes

- Keep the optional XLSX bridge aligned with the 0.18 Core API and fixed workspace release line.
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

- Add an optional engine-agnostic XLSX import/export bridge.
- Support lazy engine loading so Excel code never enters Core or normal framework chunks.
- Reuse Core CSV serialization/import rules for formula protection, column selection and safe field mapping.

### Patch Changes

- Align npm author metadata with the package license and authorization documentation.
