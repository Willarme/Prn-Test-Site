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
    // Register the Next.js ESLint plugin globally but attach NO global rules:
    // `next build` detects the plugin by resolving this config and checking
    // its plugins, so the plugin must exist outside any files-scoped block (a
    // scoped block is invisible to the detector and the "plugin not detected"
    // warning fires even though linting works).
    plugins: { "@next/next": nextPlugin },
  },
  {
    // The Next.js rules themselves, scoped to src/ (the app code Next itself
    // lints) — some rules, like no-assign-module-variable, misfire on the
    // vitest test files in tests/.
    files: ["src/**/*.{ts,tsx,js,jsx,mjs}"],
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
