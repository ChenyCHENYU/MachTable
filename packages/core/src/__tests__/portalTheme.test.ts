// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { applyPortalTheme } from "../lib/dom";
afterEach(() => document.body.replaceChildren());

describe("grid-scoped portal tokens", () => {
  it("inherits newly introduced mach tokens without copying application variables or unrelated CSS", () => {
    const source = document.body.appendChild(document.createElement("div"));
    const portal = document.body.appendChild(document.createElement("div"));
    source.style.setProperty("--mach-primary", "rgb(1, 2, 3)");
    source.style.setProperty("--mach-future-chart-accent", "  rebeccapurple  ");
    source.style.setProperty("--application-secret-token", "do not inherit");
    source.style.fontFamily = "serif";
    source.style.colorScheme = "dark";
    applyPortalTheme(portal, source);
    expect(portal.classList.contains("mach-portal")).toBe(true);
    expect(portal.style.getPropertyValue("--mach-primary")).toBe("rgb(1, 2, 3)");
    expect(portal.style.getPropertyValue("--mach-future-chart-accent")).toBe("rebeccapurple");
    expect(portal.style.getPropertyValue("--application-secret-token")).toBe("");
    expect(portal.style.fontFamily).toBe("");
    expect(portal.style.colorScheme).toBe("dark");
  });

  it("resolves each portal from its own source and tolerates an absent source", () => {
    const first = document.body.appendChild(document.createElement("div")), second = document.body.appendChild(document.createElement("div"));
    first.style.setProperty("--mach-future-chart-accent", "red"); second.style.setProperty("--mach-future-chart-accent", "green");
    const one = document.createElement("div"), two = document.createElement("div"), none = document.createElement("div");
    applyPortalTheme(one, first); applyPortalTheme(two, second); applyPortalTheme(none, null);
    expect(one.style.getPropertyValue("--mach-future-chart-accent")).toBe("red");
    expect(two.style.getPropertyValue("--mach-future-chart-accent")).toBe("green");
    expect(none.classList.contains("mach-portal")).toBe(true);
  });
});
