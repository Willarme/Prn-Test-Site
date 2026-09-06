import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // T1-15's HTTP-level tests each spawn their own `next dev` (in-process,
    // real server, real RSC serialization — the only way to prove the
    // browser payload honestly). Two such servers compiling concurrently
    // against the SAME .next cache directory contend badly and time out, so
    // test FILES run one at a time; within a file, tests still run in
    // their normal order. The rest of the suite (~200 pure-unit tests) has
    // no server of its own and adds negligible time to a sequential run.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
