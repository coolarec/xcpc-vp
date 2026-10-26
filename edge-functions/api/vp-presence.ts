import { getStore } from '@edgeone/pages-blob';
import { handlePresence } from '../../src/server/vp-presence';

export async function onRequest(context: { request: Request; waitUntil?: (task: Promise<unknown>) => void }) {
  try {
    return await handlePresence(context.request, getStore('vp-presence'), {
      waitUntil: context.waitUntil ? task => context.waitUntil!(task) : undefined,
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Presence unavailable' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store' },
    });
  }
}
