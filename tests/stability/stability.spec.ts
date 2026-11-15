import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { resolve } from "node:path";
import type { CycleSnapshot, ResourceSnapshot } from "./fixture";
import { soakSettings } from "./settings";

interface Sample extends ResourceSnapshot {
  elapsedSeconds: number;
  completedCycles: number;
  retainedHeapBytes: number;
  documents: number;
  nodes: number;
  jsEventListeners: number;
}

const url = "http://127.0.0.1:4177/__stability";
const core = resolve(import.meta.dirname, "../../packages/core");
const fixture = resolve(import.meta.dirname, "fixture.ts");

function median(values: number[]): number {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

/** 回归斜率只描述当前记录；不拿短时噪声推导生产泄漏速率。 */
function heapSlope(samples: Sample[]): number {
  const averageTime = samples.reduce((sum, sample) => sum + sample.elapsedSeconds, 0) / samples.length;
  const averageHeap = samples.reduce((sum, sample) => sum + sample.retainedHeapBytes, 0) / samples.length;
  const covariance = samples.reduce((sum, sample) => sum + (sample.elapsedSeconds - averageTime) * (sample.retainedHeapBytes - averageHeap), 0);
  const variance = samples.reduce((sum, sample) => sum + (sample.elapsedSeconds - averageTime) ** 2, 0);
  return variance === 0 ? 0 : covariance / variance * 60;
}

async function readSample(page: Page, cdp: CDPSession, elapsedSeconds: number, completedCycles: number): Promise<Sample> {
  // 在独立协议任务中强制回收；避免刚 deref 的 WeakRef 在同一 JS 任务中被保活。
  await cdp.send("HeapProfiler.collectGarbage");
  await cdp.send("HeapProfiler.collectGarbage");
  const [heap, dom] = await Promise.all([
    cdp.send("Runtime.getHeapUsage"),
    cdp.send("Memory.getDOMCounters")
  ]);
  const resources = await page.evaluate(() => window.machStabilityFixture.resources());
  return { elapsedSeconds, completedCycles, retainedHeapBytes: heap.usedSize, ...dom, ...resources };
}

function checkCycle(snapshot: CycleSnapshot): void {
  // 单块 50 行、14 行视口且最多保留焦点块，4 块预算外只允许保护/进展槽位。
  expect(snapshot.cachedBlocks).toBeLessThanOrEqual(6);
  expect(snapshot.renderedCells).toBeLessThan(2000);
  expect(snapshot.selectedRows).toBe(1);
  expect(snapshot.dirtyRowsAfterRollback).toBe(0);
  expect(snapshot.destroyedCacheBlocks).toBe(0);
  expect(snapshot.remainingRoots).toBe(0);
  expect(snapshot.pendingTransports).toBe(0);
  expect(snapshot.pendingBeforeQueryChange).toBeGreaterThan(0);
  expect(snapshot.queryTransportAborts).toBeGreaterThan(0);
  expect(snapshot.pendingBeforeDestroy).toBeGreaterThan(0);
  expect(snapshot.destroyTransportAborts).toBeGreaterThan(0);
  expect(snapshot.gridErrors).toEqual([]);
}

function checkResources(sample: Sample): void {
  expect(sample.remainingRoots).toBe(0);
  expect(sample.liveDetachedRoots).toBe(0);
  expect(sample.pendingTransports).toBe(0);
  expect(sample.lateModelEvents).toBe(0);
  expect(sample.gridErrors).toEqual([]);
}

test("mixed remote data and editing stay bounded after repeated destruction", async ({ page, context }, testInfo) => {
  const errors: string[] = [];
  const recordError = (message: string) => { if (errors.length < 20) errors.push(message.slice(0, 1000)); };
  page.on("pageerror", error => recordError(`pageerror: ${error.message}`));
  // 不访问 console args 的 JSHandle，避免观测侧延长 Error/DOM 对象生命周期。
  page.on("console", message => { if (message.type() === "error") recordError(`console.error: ${message.text()}`); });
  await page.route(url, route => route.fulfill({
    contentType: "text/html", body: `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="icon" href="data:,">
      <link rel="stylesheet" href="/@fs${core}/dist/mach-table.css">
      <style>body{margin:20px;font:13px system-ui}#grid{width:1100px;height:420px}</style>
      </head><body><h1>MachTable 长稳验证夹具</h1><div id="grid"></div>
      <script type="module" src="/@fs${fixture}"></script></body></html>`
  }));
  await page.goto(url);
  await page.waitForFunction(() => Boolean(window.machStabilityFixture));
  const cdp = await context.newCDPSession(page);
  const samples: Sample[] = [];
  let completedCycles = 0;
  let maximumCacheBlocks = 0;
  let maximumRenderedCells = 0;
  let started = 0;
  try {
    for (; completedCycles < soakSettings.warmupCycles; completedCycles++) {
      checkCycle(await page.evaluate(iteration => window.machStabilityFixture.cycle(iteration), completedCycles));
      expect(errors).toEqual([]);
    }
    started = Date.now();
    // 基线同样在真实混合负载和 GC 之后取得；不以冷页面作为参考。
    for (let index = 0; index < 3; index++) {
      const snapshot = await page.evaluate(iteration => window.machStabilityFixture.cycle(iteration), completedCycles++);
      checkCycle(snapshot);
      const sample = await readSample(page, cdp, (Date.now() - started) / 1000, completedCycles);
      checkResources(sample);
      samples.push(sample);
    }
    let lastSampleAt = Date.now();
    let lastProgressAt = Date.now();
    const deadline = started + soakSettings.seconds * 1000;
    while (Date.now() < deadline) {
      const snapshot = await page.evaluate(iteration => window.machStabilityFixture.cycle(iteration), completedCycles++);
      checkCycle(snapshot);
      expect(errors).toEqual([]);
      maximumCacheBlocks = Math.max(maximumCacheBlocks, snapshot.cachedBlocks);
      maximumRenderedCells = Math.max(maximumRenderedCells, snapshot.renderedCells);
      if (Date.now() - lastSampleAt >= soakSettings.sampleSeconds * 1000) {
        const sample = await readSample(page, cdp, (Date.now() - started) / 1000, completedCycles);
        checkResources(sample);
        samples.push(sample);
        lastSampleAt = Date.now();
        if (Date.now() - lastProgressAt >= 60_000) {
          console.log(`[stability] ${Math.round(sample.elapsedSeconds)}s, ${completedCycles} cycles, GC heap ${sample.retainedHeapBytes} B, detached roots ${sample.liveDetachedRoots}`);
          lastProgressAt = Date.now();
        }
      }
    }
    const final = await readSample(page, cdp, (Date.now() - started) / 1000, completedCycles);
    checkResources(final);
    samples.push(final);
    expect(samples.length).toBeGreaterThanOrEqual(6);
    const baseline = samples.slice(0, 3);
    const retainedHeapBaseline = median(baseline.map(sample => sample.retainedHeapBytes));
    const retainedHeapFinal = median(samples.slice(-3).map(sample => sample.retainedHeapBytes));
    expect(retainedHeapFinal - retainedHeapBaseline).toBeLessThanOrEqual(soakSettings.retainedHeapGrowthBytes);
    expect(Math.max(...samples.map(sample => sample.retainedHeapBytes)) - retainedHeapBaseline).toBeLessThanOrEqual(soakSettings.retainedHeapPeakBytes);
    expect(final.documents).toBeLessThanOrEqual(Math.max(...baseline.map(sample => sample.documents)));
    expect(final.nodes).toBeLessThanOrEqual(Math.max(...baseline.map(sample => sample.nodes)) + soakSettings.retainedNodeGrowth);
    expect(final.jsEventListeners).toBeLessThanOrEqual(Math.max(...baseline.map(sample => sample.jsEventListeners)) + soakSettings.retainedListenerGrowth);
    expect(errors).toEqual([]);
  } finally {
    await testInfo.attach("stability-metrics", {
      contentType: "application/json",
      body: JSON.stringify({
        settings: soakSettings, browserVersion: context.browser()?.version(),
        elapsedSeconds: started ? (Date.now() - started) / 1000 : 0,
        completedCycles, maximumCacheBlocks, maximumRenderedCells,
        retainedHeapSlopeBytesPerMinute: samples.length > 1 ? heapSlope(samples) : null,
        scope: "Chromium CDP with forced GC; finite synthetic workload, not a proof of absence of all leaks or real business UAT.",
        errors, samples
      }, null, 2)
    });
    await cdp.detach().catch(() => { /* 浏览器崩溃时保留原始断言和测量，不以清理错误覆盖。 */ });
  }
});
