/** 长稳任务只读取测试参数；不向发布包注入诊断或采样代码。 */
function positiveInteger(name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

export const soakSettings = {
  seconds: positiveInteger("MACH_SOAK_SECONDS", 1800, 20, 7200),
  sampleSeconds: positiveInteger("MACH_SOAK_SAMPLE_SECONDS", 10, 1, 60),
  warmupCycles: 12,
  retainedHeapGrowthBytes: 8 * 1024 * 1024,
  retainedHeapPeakBytes: 16 * 1024 * 1024,
  retainedNodeGrowth: 32,
  retainedListenerGrowth: 8
};

if (soakSettings.seconds < soakSettings.sampleSeconds * 5) {
  throw new Error("The soak duration must contain at least five sample intervals.");
}
