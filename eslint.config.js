import tseslint from "typescript-eslint";

const sourceFiles = ["packages/*/src/**/*.{ts,tsx}"];
const testFiles = ["**/__tests__/**", "**/*.test.{ts,tsx}"];

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/coverage/**",
      "**/node_modules/**",
      "docs/.vitepress/**"
    ]
  },
  ...tseslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: sourceFiles,
    ignores: testFiles
  })),
  {
    files: ["packages/**/*.{ts,tsx}", "tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "no-console": "off"
    }
  },
  {
    files: sourceFiles,
    ignores: testFiles,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unsafe-unary-minus": "off",
      "@typescript-eslint/no-redundant-type-constituents": "off",
      "@typescript-eslint/only-throw-error": "off",
      "@typescript-eslint/restrict-plus-operands": "off",
      "@typescript-eslint/restrict-template-expressions": "off"
    }
  }
);
