import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  const page = { setContent: vi.fn(), emulateMediaType: vi.fn(), pdf: vi.fn(), close: vi.fn() };
  const browser = { newPage: vi.fn(), on: vi.fn(), close: vi.fn() };
  return { page, browser, exists: vi.fn(), launch: vi.fn(), executablePath: vi.fn(), defaultArgs: vi.fn() };
});
vi.mock('node:fs', () => ({ existsSync: mocks.exists }));
vi.mock('puppeteer-core', () => ({ default: { launch: mocks.launch, defaultArgs: mocks.defaultArgs } }));
vi.mock('@sparticuz/chromium', () => ({ default: { args: ['--no-sandbox', '--no-zygote'], executablePath: mocks.executablePath } }));
import { closePdfRenderer, pdfRendererAvailable, pdfRuntimeKind, renderPacketPdf } from '@/domain/packet/pdf';

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('process', { ...process, platform: 'linux', arch: 'x64', versions: { ...process.versions, node: '22.22.2' },
    env: { VERCEL: '1' } });
  mocks.exists.mockReturnValue(false);
  mocks.executablePath.mockResolvedValue('/tmp/chromium');
  mocks.defaultArgs.mockImplementation(({ args, headless }) => [...args, `--headless=${headless}`]);
  mocks.launch.mockResolvedValue(mocks.browser); mocks.browser.newPage.mockResolvedValue(mocks.page);
  mocks.page.pdf.mockResolvedValue(Buffer.from('%PDF-synthetic-runtime-test'));
  mocks.page.close.mockResolvedValue(undefined); mocks.browser.close.mockResolvedValue(undefined);
});
afterEach(async () => { await closePdfRenderer(); vi.unstubAllGlobals(); });

it('Vercel Linux uses packaged shell and required launch args without a system browser', async () => {
  expect(pdfRuntimeKind()).toBe('serverless'); expect(pdfRendererAvailable()).toBe(true);
  expect((await renderPacketPdf('<p>Synthetic packet</p>'))?.subarray(0, 4).toString()).toBe('%PDF');
  expect(mocks.executablePath).toHaveBeenCalledWith();
  expect(mocks.launch).toHaveBeenCalledWith(expect.objectContaining({ executablePath: '/tmp/chromium', headless: 'shell', args: expect.arrayContaining(['--no-sandbox']) }));
  expect(mocks.page.pdf).toHaveBeenCalledWith(expect.objectContaining({ format: 'Letter', printBackground: true, preferCSSPageSize: true }));
  expect(mocks.page.close).toHaveBeenCalledOnce();
});
it('an explicit configured local browser takes precedence without extracting Chromium', async () => {
  process.env.PRN_PDF_BROWSER_PATH = '/configured/browser'; mocks.exists.mockReturnValue(true);
  await renderPacketPdf('<p>Synthetic packet</p>');
  expect(pdfRuntimeKind()).toBe('local'); expect(mocks.executablePath).not.toHaveBeenCalled();
  expect(mocks.launch).toHaveBeenCalledWith(expect.objectContaining({ executablePath: '/configured/browser', headless: true }));
});
it.each(['disabled', 'missing-configured-browser', 'unsupported-node', 'unsupported-architecture'])('%s returns no PDF and launches nothing', async reason => {
  if (reason === 'disabled') process.env.PRN_PDF_DISABLED = '1';
  if (reason === 'missing-configured-browser') process.env.PRN_PDF_BROWSER_PATH = '/missing/browser';
  if (reason === 'unsupported-node') vi.stubGlobal('process', { ...process, versions: { node: '22.16.0' } });
  if (reason === 'unsupported-architecture') vi.stubGlobal('process', { ...process, arch: 'arm64' });
  expect(pdfRendererAvailable()).toBe(false); expect(await renderPacketPdf('<p>Packet</p>')).toBeNull();
  expect(mocks.executablePath).not.toHaveBeenCalled(); expect(mocks.launch).not.toHaveBeenCalled();
});
it('concurrent cold renders share one extraction and browser launch', async () => {
  const results = await Promise.all([renderPacketPdf('<p>One</p>'), renderPacketPdf('<p>Two</p>')]);
  expect(results.every(Buffer.isBuffer)).toBe(true);
  expect(mocks.executablePath).toHaveBeenCalledOnce(); expect(mocks.launch).toHaveBeenCalledOnce();
  expect(mocks.browser.newPage).toHaveBeenCalledTimes(2);
});
it('failed launch clears the cache so the next request can retry', async () => {
  mocks.launch.mockRejectedValueOnce(new Error('Synthetic runtime failure'));
  expect(await renderPacketPdf('<p>One</p>')).toBeNull();
  expect(Buffer.isBuffer(await renderPacketPdf('<p>Two</p>'))).toBe(true);
  expect(mocks.launch).toHaveBeenCalledTimes(2);
});
it('failed rendering closes its page and returns no generated PDF', async () => {
  mocks.page.pdf.mockRejectedValueOnce(new Error('Synthetic print failure'));
  expect(await renderPacketPdf('<p>Packet</p>')).toBeNull(); expect(mocks.page.close).toHaveBeenCalledOnce();
});
