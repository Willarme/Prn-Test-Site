import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { renderDoorDocument } from '@/platform/pages/door-document';

/** The approved demo door remains its reviewed asset, separate from staged SEO drafts. */
export async function GET(request: Request): Promise<Response> {
  let source: string;
  try { source = await readFile(join(process.cwd(), 'content/doors/ac-blowing-warm-air.html'), 'utf8'); }
  catch { return new Response('not found', { status: 404 }); }
  return new Response(renderDoorDocument(source, request, undefined, '/problems/ac-blowing-warm-air'), { headers: {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
  } });
}
