import core = require("@agile-team/mach-table/business");
import vue = require("@agile-team/mach-table-vue/business");
import react = require("@agile-team/mach-table-react/business");
export const results = [core, vue, react].map(business => business.summarizeRows([{ amount: 12 }], {
  scope: "page", metrics: [{ id: "amount", kind: "sum", value: row => row.amount }]
}));
