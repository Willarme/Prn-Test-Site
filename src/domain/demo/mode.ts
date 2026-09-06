/** The local stateful demo is explicit; hosted prepared samples need no store. */
export function demoSamplesEnabled(): boolean {
  return process.env.PRN_RUNTIME_STORE === "file" && Boolean(process.env.PRN_DEV_DB_PATH) &&
    (process.env.PRN_CLIENT_DEMO === "1" ||
      (process.env.NODE_ENV !== "production" && process.env.NEXT_DIST_DIR === ".next-codex-demo"));
}
