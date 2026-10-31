import core = require("@agile-team/mach-table/business");
import vue = require("@agile-team/mach-table-vue/business");
import react = require("@agile-team/mach-table-react/business");
const source: core.DictionaryColumnSource<string> = { get: key => key === "A" ? "Ready" : undefined };
export const policies = [core.createDictionaryColumn(source), vue.createDictionaryColumn(source), react.createDictionaryColumn(source)];
const booleanSource: core.DictionaryColumnSource<boolean> = { get: key => key ? "是" : "否" };
export const booleanPolicies = [core, vue, react].map(business => business.createDictionaryColumn(booleanSource, {
  options: [{ value: false, label: "否" }], separator: "、"
}));
export const results = [core, vue, react].map(business => business.summarizeRows([{ amount: 12 }], {
  scope: "page", metrics: [{ id: "amount", kind: "sum", value: row => row.amount }]
}));
