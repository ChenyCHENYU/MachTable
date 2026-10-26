/** Shared operator order for validation, column popups and the optional builder. */
export const FILTER_MATCHES = {
  text: ["contains", "notContains", "equals", "notEquals", "startsWith", "endsWith", "blank", "notBlank"],
  number: ["equals", "notEquals", "lessThan", "lessThanOrEqual", "greaterThan", "greaterThanOrEqual", "inRange", "blank", "notBlank"],
  date: ["equals", "notEquals", "lessThan", "greaterThan", "inRange", "blank", "notBlank"]
} as const;
