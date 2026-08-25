import js from "@eslint/js";
import tseslint from "typescript-eslint";

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
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  }
);
