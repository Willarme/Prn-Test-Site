import js from "@eslint/js";
import tseslint from "typescript-eslint";
import nextPlugin from "@next/eslint-plugin-next";

export default tseslint.config(
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "out/**",
      "coverage/**",
      "next-env.d.ts",
      "data/runtime/**",
      // Local tooling state, git-excluded and never part of a build. It can hold
      // a whole checked-out worktree, which lints the entire repo a second time
      // and reports every finding twice.
      ".claude/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // The Next.js ESLint plugin — `next build` looks for it and warns when it
    // is missing ("The Next.js plugin was not detected in your ESLint
    // configuration"). The rules ship as eslintrc-style presets, so their
    // rule maps are spread in directly rather than extending the preset.
    // Scoped to src/ (the app code Next itself lints) — some rules, like
    // no-assign-module-variable, misfire on the vitest test files in tests/.
    files: ["src/**/*.{ts,tsx,js,jsx,mjs}"],
    plugins: { "@next/next": nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  }
);
