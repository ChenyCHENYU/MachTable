import { applyPortalTheme, bindDismissListeners, clamp, el, nextUid } from "./dom";

export interface SelectControlOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectControlClassNames {
  root?: string;
  native?: string;
  trigger?: string;
  value?: string;
  caret?: string;
  listbox?: string;
  option?: string;
}

export interface SelectControlOptions {
  ariaLabel: string;
  options: readonly SelectControlOption[];
  value?: string;
  classNames?: SelectControlClassNames;
  themeSource?: HTMLElement | null;
  onChange?: (value: string) => void;
}

export interface SelectControl {
  el: HTMLElement;
  native: HTMLSelectElement;
  trigger: HTMLButtonElement;
  listbox: HTMLElement;
  contains(target: Node): boolean;
  isOpen(): boolean;
  open(): void;
  close(restoreFocus?: boolean): boolean;
  focus(): void;
  getValue(): string;
  setValue(value: string): void;
  setOptions(options: readonly SelectControlOption[], value?: string): void;
  destroy(): void;
}

interface ActiveSelectControl {
  owner: HTMLElement | null;
  close: (restoreFocus?: boolean) => boolean;
  contains: (target: Node) => boolean;
  reposition: () => void;
}

let activeSelect: ActiveSelectControl | null = null;

/** Close only the portalled select owned by the grid that is being suspended. */
export function closeGridSelect(root: HTMLElement): void {
  if (activeSelect?.owner && (root === activeSelect.owner || root.contains(activeSelect.owner))) activeSelect.close();
}

function onActiveSelectMouseDown(event: MouseEvent): void {
  const target = event.target as Node;
  if (!activeSelect?.contains(target)) activeSelect?.close();
}

function onActiveSelectViewportChange(): void {
  activeSelect?.reposition();
}

function onActiveSelectKeyDown(event: KeyboardEvent): void {
  if (event.key !== "Escape" || !activeSelect) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  activeSelect.close(true);
}

function bindActiveSelectEvents(active: boolean): void {
  bindDismissListeners(active, onActiveSelectMouseDown, onActiveSelectKeyDown);
  const method = active ? "addEventListener" : "removeEventListener";
  window[method]("resize", onActiveSelectViewportChange);
  window[method]("scroll", onActiveSelectViewportChange, true);
}

function activateSelect(next: ActiveSelectControl): void {
  if (activeSelect?.close !== next.close) activeSelect?.close();
  if (activeSelect) return;
  activeSelect = next;
  bindActiveSelectEvents(true);
}

function deactivateSelect(close: ActiveSelectControl["close"]): void {
  if (activeSelect?.close !== close) return;
  activeSelect = null;
  bindActiveSelectEvents(false);
}

function classNames(base: string, extra?: string): string {
  return extra ? `${base} ${extra}` : base;
}

function nextEnabledIndex(
  options: readonly SelectControlOption[],
  current: number,
  direction: 1 | -1
): number {
  const hasCurrent = options[current] && !options[current].disabled;
  const start = hasCurrent ? current + direction : direction > 0 ? 0 : options.length - 1;
  for (let index = start; index >= 0 && index < options.length; index += direction) {
    if (!options[index].disabled) return index;
  }
  return hasCurrent ? current : -1;
}

function selectedIndex(options: readonly SelectControlOption[], value: string): number {
  return options.findIndex((option) => option.value === value && !option.disabled);
}

export function createSelectControl(config: SelectControlOptions): SelectControl {
  const root = el("div", classNames("mach-select-control", config.classNames?.root));
  const native = el("select", classNames("mach-select-native", config.classNames?.native));
  native.hidden = true;
  native.tabIndex = -1;
  native.setAttribute("aria-hidden", "true");

  const trigger = el("button", classNames("mach-select-trigger", config.classNames?.trigger));
  trigger.type = "button";
  trigger.setAttribute("role", "combobox");
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-label", config.ariaLabel);
  const valueLabel = el("span", classNames("mach-select-value", config.classNames?.value));
  const caret = el("span", classNames("mach-select-caret", config.classNames?.caret));
  caret.setAttribute("aria-hidden", "true");
  trigger.append(valueLabel, caret);

  const listbox = el("div", classNames("mach-select-listbox", config.classNames?.listbox));
  listbox.id = nextUid("mach-select-listbox");
  listbox.setAttribute("role", "listbox");
  listbox.setAttribute("aria-hidden", "true");
  trigger.setAttribute("aria-controls", listbox.id);
  root.append(native, trigger);

  let options = [...config.options];
  let items: HTMLButtonElement[] = [];
  let activeIndex = -1;
  let destroyed = false;

  const currentThemeSource = (): HTMLElement | null =>
    config.themeSource ?? root.closest<HTMLElement>(".mach-root") ?? root;
  const contains = (target: Node): boolean => root.contains(target) || listbox.contains(target);
  const isOpen = (): boolean => listbox.classList.contains("mach-select-listbox--open");

  const sync = (): void => {
    const option = options.find((candidate) => candidate.value === native.value);
    valueLabel.textContent = option?.label ?? native.value;
    items.forEach((item, index) => {
      const selected = options[index]?.value === native.value;
      item.setAttribute("aria-selected", selected ? "true" : "false");
      item.classList.toggle("mach-select-option--selected", selected);
      item.classList.toggle("mach-select-option--active", index === activeIndex);
    });
    trigger.setAttribute("aria-activedescendant", activeIndex >= 0 ? items[activeIndex]?.id ?? "" : "");
  };

  const positionListbox = (): void => {
    const rect = trigger.getBoundingClientRect();
    const listRect = listbox.getBoundingClientRect();
    const width = Math.max(rect.width, listRect.width);
    const left = clamp(rect.left, 8, Math.max(8, window.innerWidth - width - 8));
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const openAbove = spaceBelow < Math.min(listRect.height, 240) && rect.top > spaceBelow;
    const top = openAbove
      ? Math.max(8, rect.top - listRect.height - 5)
      : Math.min(window.innerHeight - listRect.height - 8, rect.bottom + 5);
    listbox.style.minWidth = `${rect.width}px`;
    listbox.style.left = `${left}px`;
    listbox.style.top = `${Math.max(8, top)}px`;
    listbox.classList.toggle("mach-select-listbox--above", openAbove);
  };

  const close = (restoreFocus = false): boolean => {
    if (!isOpen()) return false;
    listbox.classList.remove("mach-select-listbox--open", "mach-select-listbox--above");
    listbox.setAttribute("aria-hidden", "true");
    trigger.setAttribute("aria-expanded", "false");
    trigger.removeAttribute("aria-activedescendant");
    listbox.remove();
    deactivateSelect(close);
    if (restoreFocus && !destroyed) trigger.focus({ preventScroll: true });
    return true;
  };

  const setActive = (index: number, scroll = true): void => {
    if (!options[index] || options[index].disabled) return;
    activeIndex = index;
    sync();
    if (scroll) items[index]?.scrollIntoView?.({ block: "nearest" });
  };

  const open = (): void => {
    if (destroyed || trigger.disabled || isOpen()) return;
    const owner = currentThemeSource();
    activateSelect({
      owner,
      close,
      contains,
      reposition: positionListbox
    });
    activeIndex = selectedIndex(options, native.value);
    if (activeIndex < 0) activeIndex = nextEnabledIndex(options, -1, 1);
    applyPortalTheme(listbox, owner);
    document.body.appendChild(listbox);
    listbox.classList.add("mach-select-listbox--open");
    listbox.setAttribute("aria-hidden", "false");
    trigger.setAttribute("aria-expanded", "true");
    positionListbox();
    sync();
    items[activeIndex]?.scrollIntoView?.({ block: "nearest" });
  };

  const choose = (index: number): void => {
    const option = options[index];
    if (!option || option.disabled) return;
    native.value = option.value;
    activeIndex = index;
    sync();
    close(true);
    native.dispatchEvent(new Event("input", { bubbles: true }));
    native.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const rebuild = (nextOptions: readonly SelectControlOption[], value?: string): void => {
    options = [...nextOptions];
    native.replaceChildren();
    listbox.replaceChildren();
    items = options.map((option, index) => {
      const nativeOption = document.createElement("option");
      nativeOption.value = option.value;
      nativeOption.textContent = option.label;
      nativeOption.disabled = option.disabled === true;
      native.appendChild(nativeOption);
      const item = el("button", classNames("mach-select-option", config.classNames?.option));
      item.id = `${listbox.id}-option-${index}`;
      item.type = "button";
      item.tabIndex = -1;
      item.dataset.value = option.value;
      item.disabled = option.disabled === true;
      item.setAttribute("role", "option");
      item.textContent = option.label;
      item.addEventListener("mousedown", (event) => event.preventDefault());
      item.addEventListener("click", () => choose(index));
      listbox.appendChild(item);
      return item;
    });
    const fallback = options.find((option) => !option.disabled)?.value ?? "";
    native.value = value != null && options.some((option) => option.value === value) ? value : fallback;
    activeIndex = selectedIndex(options, native.value);
    sync();
  };

  const onTriggerKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Tab") {
      close();
      return;
    }
    if (event.key === "Escape") {
      if (!close(true)) return;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      if (!isOpen()) open();
      else choose(activeIndex);
      return;
    }
    let next = activeIndex;
    if (event.key === "ArrowDown") next = nextEnabledIndex(options, activeIndex, 1);
    else if (event.key === "ArrowUp") next = nextEnabledIndex(options, activeIndex, -1);
    else if (event.key === "Home") next = nextEnabledIndex(options, -1, 1);
    else if (event.key === "End") next = nextEnabledIndex(options, -1, -1);
    else return;
    event.preventDefault();
    event.stopPropagation();
    if (!isOpen()) open();
    setActive(next);
  };

  const onNativeChange = (): void => {
    activeIndex = selectedIndex(options, native.value);
    sync();
    config.onChange?.(native.value);
  };

  trigger.addEventListener("click", () => {
    if (!close()) open();
  });
  trigger.addEventListener("keydown", onTriggerKeyDown);
  native.addEventListener("change", onNativeChange);
  rebuild(options, config.value);

  return {
    el: root,
    native,
    trigger,
    listbox,
    contains,
    isOpen,
    open,
    close,
    focus: () => trigger.focus({ preventScroll: true }),
    getValue: () => native.value,
    setValue: (value) => {
      native.value = value;
      activeIndex = selectedIndex(options, value);
      sync();
    },
    setOptions: rebuild,
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      close();
      trigger.removeEventListener("keydown", onTriggerKeyDown);
      native.removeEventListener("change", onNativeChange);
      root.remove();
    }
  };
}
