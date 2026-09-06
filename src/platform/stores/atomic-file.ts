import { randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const pause = new Int32Array(new SharedArrayBuffer(4));
const LOCK_TIMEOUT_MS = 10_000;

function code(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException)?.code;
}

function lockContention(error: unknown): boolean {
  // Windows can report a delete-pending lock as EPERM/EACCES rather than
  // EEXIST. Retry acquisition within the same deadline; never skip the lock.
  return ["EEXIST", "EPERM", "EACCES", "EBUSY"].includes(code(error) ?? "");
}

function deadOwner(lock: string): boolean {
  try {
    const owner = JSON.parse(readFileSync(lock, "utf8")) as { pid?: number };
    if (!Number.isSafeInteger(owner.pid) || !owner.pid || owner.pid < 1) return false;
    try { process.kill(owner.pid, 0); return false; }
    catch (error) { return code(error) === "ESRCH"; }
  } catch { return false; }
}

/** Serialize dead-owner recovery so a second recoverer cannot remove a new lock. */
function recoverDeadLock(lock: string): void {
  if (!deadOwner(lock)) return;
  const recovery = `${lock}.recovery`;
  let fd: number;
  try { fd = openSync(recovery, "wx", 0o600); }
  catch (error) { if (lockContention(error)) return; throw error; }
  try {
    if (deadOwner(lock)) unlinkSync(lock);
  } finally {
    closeSync(fd);
    unlinkSync(recovery);
  }
}

/**
 * A synchronous cross-process transaction boundary for local JSON files.
 * Never put an async callback here. Unknown owners/timeouts fail closed;
 * interrupted recovery markers require inspection, never a blind lock delete.
 */
export function withFileLock<T>(target: string, action: () => T): T {
  mkdirSync(dirname(target), { recursive: true });
  const lock = `${target}.lock`;
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let fd: number | undefined;
  while (fd === undefined) {
    if (Date.now() >= deadline) throw new Error("Local store is busy or its lock needs recovery. Try again after the active writer finishes.");
    if (existsSync(`${lock}.recovery`)) { Atomics.wait(pause, 0, 0, 10); continue; }
    try {
      fd = openSync(lock, "wx", 0o600);
      writeFileSync(fd, JSON.stringify({ pid: process.pid, nonce: randomUUID() }));
      fsyncSync(fd);
    } catch (error) {
      if (fd !== undefined) { closeSync(fd); fd = undefined; try { unlinkSync(lock); } catch { /* preserve original error */ } throw error; }
      if (!lockContention(error)) throw error;
      if (code(error) === "EEXIST") recoverDeadLock(lock);
      Atomics.wait(pause, 0, 0, 10);
    }
  }
  try {
    const result = action();
    if (result && typeof (result as { then?: unknown }).then === "function") throw new Error("File transaction callback must be synchronous");
    return result;
  } finally {
    closeSync(fd);
    unlinkSync(lock);
  }
}

/** Atomic replacement. Caller must hold withFileLock for read/modify/write. */
export function writeFileAtomic(target: string, data: string | Uint8Array): void {
  mkdirSync(dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  const fd = openSync(temp, "wx", 0o600);
  try { writeFileSync(fd, data); fsyncSync(fd); }
  catch (error) { closeSync(fd); try { unlinkSync(temp); } catch { /* preserve error */ } throw error; }
  closeSync(fd);
  try { renameSync(temp, target); }
  catch (error) { try { unlinkSync(temp); } catch { /* preserve error */ } throw error; }
}
