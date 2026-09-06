import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PRINTED_READER_VERSION } from '@/domain/problem/printed-evidence';

const mocked = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mocked.spawn }));

class FakeChild extends EventEmitter {
  readonly pid = 4242; // A live child, not an ENOENT/no-process spawn failure.
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly kill = vi.fn(() => true);
  closed = false;
  close(code: number | null = 0) {
    if (!this.closed) { this.closed = true; this.emit('close', code); }
  }
}
let children: FakeChild[];
let pending: Promise<unknown>[];
let read: typeof import('@/platform/problem/printed-evidence').readPrintedEvidence;
const input = { evidence_id: 'ev_process_synthetic', image: new Uint8Array([1, 2, 3]) };
function start() { const result = read(input); pending.push(result); return result; }
const blank = JSON.stringify({ reader_version: PRINTED_READER_VERSION, width: 10, height: 10, lines: [] });

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  children = []; pending = [];
  mocked.spawn.mockReset().mockImplementation(() => { const child = new FakeChild(); children.push(child); return child; });
  read = (await import('@/platform/problem/printed-evidence')).readPrintedEvidence;
});
afterEach(async () => {
  for (const child of children) child.close(1);
  await Promise.allSettled(pending);
  vi.useRealTimers(); vi.unstubAllEnvs();
});

describe('OCR child lifecycle and bounded failure', () => {
  it('rejects non-string evidence identity without coercion or a child process', async () => {
    const result = read({ ...input, evidence_id: 123 as unknown as string }); pending.push(result);
    expect(mocked.spawn).not.toHaveBeenCalled();
    expect((await result).evidence_id).toBe('');
  });

  it('holds occupancy until successful close, then permits another read', async () => {
    const first = start();
    expect((await start()).outcome).toBe('unavailable');
    expect(mocked.spawn).toHaveBeenCalledTimes(1);
    children[0].stdout.write(blank); children[0].close(0);
    expect((await first).outcome).toBe('unreadable');
    const next = start();
    expect(mocked.spawn).toHaveBeenCalledTimes(2);
    children[1].stdout.write(blank); children[1].close(0);
    expect((await next).outcome).toBe('unreadable');
  });

  it('deadline returns unavailable, but a killed child keeps occupancy until close', async () => {
    let returned = false;
    const first = start().then(result => { returned = true; return result; });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(children[0].kill).toHaveBeenCalledWith('SIGKILL');
    expect(returned).toBe(true); // A failed kill/slow close must not hang the HTTP read.
    expect((await first).outcome).toBe('unavailable');
    expect((await start()).outcome).toBe('unavailable');
    expect(mocked.spawn).toHaveBeenCalledTimes(1);
    children[0].close(null);
    const next = start();
    expect(mocked.spawn).toHaveBeenCalledTimes(2);
    children[1].close(1); await next;
  });

  it('an error from a live child does not release occupancy before its close', async () => {
    const first = start();
    children[0].emit('error', new Error('SYNTHETIC kill failure'));
    // Allow either immediate failure or close-time failure; ownership is the invariant.
    await Promise.resolve(); await Promise.resolve();
    expect((await start()).outcome).toBe('unavailable');
    expect(mocked.spawn).toHaveBeenCalledTimes(1);
    children[0].close(1);
    expect((await first).outcome).toBe('unavailable');
    const next = start(); expect(mocked.spawn).toHaveBeenCalledTimes(2);
    children[1].close(1); await next;
  });

  it('oversized stdout is killed and never accepted as a partial valid result', async () => {
    const result = start();
    children[0].stdout.write(Buffer.alloc(128 * 1024 + 1, 32));
    expect(children[0].kill).toHaveBeenCalledWith('SIGKILL');
    children[0].stdout.write(blank); children[0].close(0);
    expect((await result).outcome).toBe('unavailable');
  });

  it('stdin errors are failures and do not accept later valid output', async () => {
    const result = start();
    children[0].stdin.emit('error', new Error('SYNTHETIC EPIPE'));
    expect(children[0].kill).toHaveBeenCalledWith('SIGKILL');
    children[0].stdout.write(blank); children[0].close(0);
    expect((await result).outcome).toBe('unavailable');
  });

  it('failure is idempotent when kill itself emits a child error', async () => {
    const result = start();
    children[0].kill.mockImplementationOnce(() => { children[0].emit('error', new Error('SYNTHETIC EPERM')); return false; });
    children[0].stdin.emit('error', new Error('SYNTHETIC EPIPE'));
    expect(children[0].kill).toHaveBeenCalledTimes(1);
    expect((await result).outcome).toBe('unavailable');
    expect((await start()).outcome).toBe('unavailable');
    expect(mocked.spawn).toHaveBeenCalledTimes(1);
    children[0].close(1);
  });

  it('a synchronous spawn exception leaves no child and allows another read', async () => {
    mocked.spawn.mockImplementationOnce(() => { throw new Error('SYNTHETIC spawn failure'); });
    expect((await start()).outcome).toBe('unavailable');
    const next = start();
    expect(mocked.spawn).toHaveBeenCalledTimes(2);
    children[0].close(1); await next;
  });

  it.each([[0, '{malformed'], [1, blank], [null, blank]] as const)('exit %s with invalid result stays unavailable', async (code, output) => {
    const result = start(); children[0].stdout.write(output); children[0].close(code);
    expect((await result).outcome).toBe('unavailable');
  });

  it('spawns only the bounded entrypoint, hides its window and excludes inherited secrets/options', async () => {
    vi.stubEnv('NODE_OPTIONS', '--require synthetic-untrusted-loader');
    vi.stubEnv('OPENROUTER_API_KEY', 'SYNTHETIC_SECRET');
    vi.stubEnv('HTTP_PROXY', 'http://synthetic-proxy.invalid');
    const result = start();
    const [executable, args, options] = mocked.spawn.mock.calls[0];
    expect(executable).toBe(process.execPath);
    expect(args).toHaveLength(1);
    expect(args[0]).toMatch(/tools[/\\]ocr-printed-evidence\.mjs$/);
    expect(options).toMatchObject({ windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    expect(Object.keys(options.env).every(key => ['SystemRoot', 'NODE_ENV'].includes(key))).toBe(true);
    expect(options.env.NODE_ENV).toBe('production');
    expect(options.env).not.toHaveProperty('NODE_OPTIONS');
    expect(JSON.stringify(options)).not.toContain('SYNTHETIC_SECRET');
    children[0].close(1); await result;
  });
});
