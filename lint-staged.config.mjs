function quote(file) {
  return JSON.stringify(file);
}

function eslintCommand(files) {
  return `eslint --fix --cache --cache-location node_modules/.cache/eslint --max-warnings=0 ${files.map(quote).join(" ")}`;
}

export default {
  "packages/**/*.{ts,tsx}": eslintCommand,
  "tests/**/*.ts": eslintCommand
};
