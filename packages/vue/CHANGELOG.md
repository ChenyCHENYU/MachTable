# @agile-team/mach-table-vue

## 0.42.0

### Minor Changes

- Bound all-matching query row snapshots to the accepted page, batch dirty notifications for multi-cell edits and undo/redo, and unify selected-row markers and white selection controls across themes. Explicit cross-page selections retain their original snapshots; server-wide operations continue to use selectionState.

### Patch Changes

- Updated dependencies
  - @agile-team/mach-table@0.42.0

## 0.41.1

### Patch Changes

- Updated dependencies
  - @agile-team/mach-table@0.41.1

## 0.41.0

### Patch Changes

- Updated dependencies
  - @agile-team/mach-table@0.41.0

## 0.40.2

### Patch Changes

- 修复单列调宽影响其他列、取消宽度还原和滚动条引发的布局反跳；保留自动列对真实容器及数据变化的响应。

  紧凑编辑器使用独立工具条，避免确认操作挤压输入；优化主题加载动效、原生滚动条及自动高度末行完整显示。

  修复禁选叶行复用为分组行后复选框残留禁用状态；短表空态按可用高度缩放插画，保留文案与清除筛选操作。
- Updated dependencies
  - @agile-team/mach-table@0.40.2

## 0.40.1

### Patch Changes

- 全局组件重名时先拒绝注册，保留宿主已提供的配置；收敛重复的查询源解析与选择处理。
- Keep remote pagination valid after the last row on a page is removed. Recover the final available page with at most one additional request, publish only the accepted result, and cancel stale in-flight results when manual query criteria change.
- @agile-team/mach-table@0.40.1

## 0.40.0

### Minor Changes

- 内置主列表与明细展示场景。Vue/React 不传 preset 时默认 list；detail 将纯文字表头、只读默认、原生内容高度与 330px 上限收进包内。主题和密度继续继承通用配置，单表属性优先，同名项目预设保持完整优先；可用既有 createMachTablePreset("detail", overrides) 显式继承，false 可退出场景默认值。

  切换场景时将布局、分页和列默认值明确回退，保留业务排序、筛选与选择；非交互表头不再显示排序图标或手形光标，程序排序与无障碍排序信息保留。

### Patch Changes

- Updated dependencies
  - @agile-team/mach-table@0.40.0

## 0.39.2

### Patch Changes

- 补齐整行编辑的输入法组合态保护、字体加载后的尺寸缓存失效，以及树数据替换前的深度与循环校验。异常候选保留已有数据、草稿、选择、撤销和重载快照。普通字段的自动测高事务改为局部更新，上下文取值与格式化回调保留完整失效，保持浏览器真实高度。运行时空分页配置回退默认值。

  Vue/React 远程查询取消后及时结束等待，重复行 ID 响应保留上一份有效状态。Worker 复用隔离请求身份，释放实例时取消未完成任务，并清理迟到取消记录。复用既有国际化与生命周期清理机制，保持业务 API 和使用侧配置。
- Updated dependencies
  - @agile-team/mach-table@0.39.2

## 0.39.1

### Patch Changes

- 修复空值连续编辑后的原始值追踪与回滚，并让程序化选中遵守复选框的行资格规则。宽表快速搜索限制增量快照的占用，横向滚动只保留视口附近的列及必要的合并锚点。自动高度表在数据大幅缩减后释放多余的行节点和渲染器。

  自动换行按浏览器实际排版测高，字体变化后更新缓存；变高行的普通内容事务复用高度索引。修复异步校验期间排序导致继续编辑错误行、单选模式允许多选、当前页选择残留旧页数据，以及动态列刷新恢复已取消初始排序的问题。
- Updated dependencies
  - @agile-team/mach-table@0.39.1

## 0.39.0

### Minor Changes

- 5eb6beb: Keep newer row snapshots safe from queued writes and stale edit history. Grow short auto-height grids when data arrives and cap the body with `maxBodyHeight` for longer results. Distinguish local filter results in the built-in empty state and offer a single clear action. Scope content sizing to affected columns and sampled rows, improve schema editing and column reset, and keep toolbar search and server requests in sync.

### Patch Changes

- Updated dependencies [9aa646a]
- Updated dependencies [5eb6beb]
  - @agile-team/mach-table@0.39.0

## 0.38.0

### Patch Changes

- Updated dependencies
  - @agile-team/mach-table@0.38.0

## 0.37.0

### Minor Changes

- 移除内置字典缓存、字典渲染器、专用列适配及对应公共协议。字典等数据插件完全由项目安装和组合，表格只消费普通选项、同步 valueFormatter/valueParser/valueSerializer 和刷新调用；business 入口保留本地语义合计。删除 createCachedDictionary、createDictionaryRenderer、createDictionaryColumn，升级需按指南改为项目层普通列配置。

### Patch Changes

- Updated dependencies
  - @agile-team/mach-table@0.37.0

## 0.36.0

### Patch Changes

- Updated dependencies
  - @agile-team/mach-table@0.36.0

## 0.35.3

### Patch Changes

- Updated dependencies
  - @agile-team/mach-table@0.35.3

## 0.35.2

### Patch Changes

- Updated dependencies
  - @agile-team/mach-table@0.35.2

## 0.35.1

### Patch Changes

- Updated dependencies
  - @agile-team/mach-table@0.35.1

## 0.35.0

### Patch Changes

- Updated dependencies
  - @agile-team/mach-table@0.35.0

## 0.34.2

### Patch Changes

- Updated dependencies
  - @agile-team/mach-table@0.34.2

## 0.34.1

### Patch Changes

- Updated dependencies
  - @agile-team/mach-table@0.34.1

## 0.34.0

### Minor Changes

- Add an optional `/business` entry to Core, Vue and React for explicit dictionary display/parsing/output policies and scoped local semantic totals. Preserve raw typed codes by default, reject ambiguous labels, and keep asynchronous lookup, currency/unit grouping and exact arithmetic under application control. Keep the existing root API and default behavior unchanged; measure the new dependency-free entry separately without raising existing bundle budgets.

  Harden cached dictionary request ownership: share queued and in-flight lookups, invalidate stale generations, settle superseded waiters, bound missing-key caching by TTL/LRU, and isolate cancellation and error observers. Keep all four published packages aligned; XLSX retains its existing API and typed IO behavior.

### Patch Changes

- Updated dependencies
  - @agile-team/mach-table@0.34.0

## 0.33.0

### Minor Changes

- Unify column value parsing and serialization, add typed matrix IO and optional bounded import preview/validation, and keep XLSX cell types without a CSV round trip. Harden finite numeric aggregates and typed group identities with safe legacy expansion migration. Skip unrelated local projection work with conservative scalar dependency snapshots, preserve adapter configuration on unrelated updates, own processors per grid, and map oversized scroll ranges into bounded browser coordinates. Add reproducible, separately timed benchmark workloads, example type gates and shared byte-budget documentation.

### Patch Changes

- Updated dependencies
  - @agile-team/mach-table@0.33.0

## 0.32.1

### Patch Changes

- Keep advanced keyboard ordering within visible siblings when rows are filtered, while preserving the complete source model, atomic save intent and undo/redo history. Keep all four packages on the same patch version.
- Updated dependencies
  - @agile-team/mach-table@0.32.1

## 0.32.0

### Minor Changes

- Add optional advanced filtering, change review, diagnostics, enterprise preferences, multi-row/tree ordering with persisted undo/redo, route-based server grouping, multi-range selection and bounded Pivot/formula/chart workspaces. Vue and React expose the same optional subpaths from a single installed adapter package.

  Unify internal resource ownership and cover initialization failure, KeepAlive, async unmount and StrictMode. Protect in-progress edits and stale asynchronous responses; complete the remote cache fault matrix and initial visible block loading. Keep existing default runtime and CSS budgets, and measure the new optional entries separately.

### Patch Changes

- Updated dependencies
  - @agile-team/mach-table@0.32.0

## 0.31.2

### Patch Changes

- Unify editing, clipboard, clearing and fill validation, cancel stale async input, retain unsaved remote rows across cache eviction, and isolate framework workflows across grid replacement. Compile filter metadata once per refresh and preserve stable sorting when saved columns no longer exist, without adding public configuration or runtime dependencies.
- Updated dependencies
  - @agile-team/mach-table@0.31.2

## 0.31.1

### Patch Changes

- Rebind the Vue table API after keyed component replacement even when Vue flushes the component ref before its mounted hook. Keep readiness, controller commands and selection listeners attached to the current table, and ignore deferred work from replaced or disposed instances.
- @agile-team/mach-table@0.31.1

## 0.31.0

### Minor Changes

- Add optional, first-match rowStyleRules with theme-aware tones and custom colors across virtual and pinned rows. Improve row ordering with themed handles, cross-pane drop feedback, position previews, edge scrolling, pointer cancellation and keyboard moves. Reject automatic ordering for sorted, grouped, tree, remote and externally processed data; keep event-only intent available for flat external data. Row drag events now run after managed moves and expose targetIndex/applied while retaining the legacy toIndex insertion boundary.

  Preserve existing bundle budgets by minifying unambiguous TypeScript-private implementation properties and shipping a minified stylesheet at the unchanged CSS import path. Public and string-addressed property names remain reserved.

### Patch Changes

- ba9bb12: Fix tree expansion clicks when range selection is enabled, give tree controls a fixed footprint so labels remain readable, and show an active-column guide with live pixel width while resizing.
- Updated dependencies
- Updated dependencies [ba9bb12]
  - @agile-team/mach-table@0.31.0

## 0.30.1

### Patch Changes

- Fix responsive column width budgeting so pinned panes are subtracted once and vertical scrollbar space is respected. In fit layout, preserve measured content widths as responsive bases across resizing, column definition updates, and state persistence; keep utility widths and explicit manual resizing intact. Normal-layout auto sizing remains unchanged.
- Updated dependencies
  - @agile-team/mach-table@0.30.1

## 0.30.0

### Minor Changes

- Add an opt-in server export request snapshot for filtered and cross-page selected data. Preserve all existing grid, CSV, XLSX, toolbar, rendering, and editing behavior; clarify remote export scope and add scenario-oriented documentation.

### Patch Changes

- Updated dependencies
  - @agile-team/mach-table@0.30.0

## 0.29.2

### Patch Changes

- Publish the adapter with a registry-resolved Core dependency instead of leaking the internal workspace protocol.
- Updated dependencies
  - @agile-team/mach-table@0.29.2

## 0.29.1

### Minor Changes

- Add typed `defineVueColumns()` render columns, `defineVueTableConfig()`, and an inferred controller `bindings` object so Vue pages can keep table definitions data-driven and templates flat. Preserve named slots as explicit overrides and inherit Core alignment, loading, empty and editing behavior.

### Patch Changes

- Updated dependencies
  - @agile-team/mach-table@0.29.1

> `0.28.1` below records an internal implementation milestone folded into
> `0.29.1`; it was not published as a separate npm version.

## 0.28.1

### Patch Changes

- Keep body-mounted filters, column workbenches, menus, drawers, tooltips and column-drag previews scoped to the owning grid theme; align selection-column header and row checkboxes; and add a bounded visual column-drag preview.

  Keep cell editors mounted across pointer and focus changes, prevent IME composition Enter events from committing, and require the inline confirm/cancel controls or an explicit keyboard command to finish the edit transaction.

  Tree-shake package metadata so the browser runtime embeds only the public version string rather than the complete package manifest.

  Treat official utility and renderer-only columns as intentional display columns so row actions do not emit misleading development warnings.

  Add localized select-editor labels, stable cell/row editing focus, complete range borders and host-controlled modal/drawer editing through `rowActionsColumn.onEdit`.

  Use the shared themed listbox for toolbar density and Core-owned selects, eliminating platform-native popup flashes without changing Vue props, emits or command wiring.
- Updated dependencies
  - @agile-team/mach-table@0.28.1

## 0.28.0

### Minor Changes

- Adopt the complexity-free 0.28 Core baseline without changing Vue component, plugin, slot or composable contracts.

### Patch Changes

- Updated dependencies:
  - @agile-team/mach-table@0.28.0

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
