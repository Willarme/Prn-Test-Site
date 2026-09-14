import { renderDoorDocument } from '@/platform/pages/door-document';
import { readFixedDoor } from '@/platform/search/fixed-door-registry';
import { featureState } from '@/platform/features/state';

/** The approved demo door remains its reviewed asset, separate from staged SEO drafts. */
export async function GET(request: Request): Promise<Response> {
  if (await featureState('door_pages') !== 'LIVE') return new Response('not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  const door = await readFixedDoor('ac-blowing-warm-air');
  if (!door) return new Response('not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  return new Response(renderDoorDocument(door.html, request, undefined, door.canonical_path), { headers: {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
  } });
}
