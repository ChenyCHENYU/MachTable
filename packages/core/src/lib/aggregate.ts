export type AggValues = Record<string, any>;

export type AggFunction = (values: any[]) => any;

function numeric(values: any[]): number[] {
  return values.filter((v): v is number => typeof v === "number" && !isNaN(v));
}

export const BUILTIN_AGG_FUNCS: Record<string, AggFunction> = {
  sum: (values) => numeric(values).reduce((acc, v) => acc + v, 0),
  avg: (values) => {
    const nums = numeric(values);
    return nums.length === 0 ? null : nums.reduce((acc, v) => acc + v, 0) / nums.length;
  },
  count: (values) => values.length,
  min: (values) => {
    const nums = numeric(values);
    return nums.length === 0 ? null : Math.min(...nums);
  },
  max: (values) => {
    const nums = numeric(values);
    return nums.length === 0 ? null : Math.max(...nums);
  },
  first: (values) => (values.length > 0 ? values[0] : null),
  last: (values) => (values.length > 0 ? values[values.length - 1] : null)
};

export function createAggResolver(custom?: Record<string, AggFunction>): (name: string) => AggFunction | undefined {
  const merged = { ...BUILTIN_AGG_FUNCS, ...(custom ?? {}) };
  return (name: string) => merged[name];
}
