export default {
  extends: ["@commitlint/config-conventional"],
  ignores: [(message) => message.startsWith("Version Packages")],
  rules: {
    "type-enum": [
      2,
      "always",
      ["feat", "fix", "perf", "refactor", "docs", "test", "build", "ci", "chore", "revert"]
    ],
    "scope-empty": [2, "never"],
    "header-max-length": [2, "always", 100],
    "subject-empty": [2, "never"],
    "subject-case": [0]
  }
};
