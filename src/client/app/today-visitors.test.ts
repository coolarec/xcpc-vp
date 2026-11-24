import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.resetModules();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('location', new URL('https://vp.example/?contest=contest-id&team=team-name'));
});
afterEach(() => vi.unstubAllGlobals());

it('shares one request per page and only sends the site root', async () => {
  fetchMock.mockResolvedValue(Response.json({ busuanzi_today_uv: 0, busuanzi_site_uv: 23 }));
  const { getTodayVisitors } = await import('./today-visitors');
  const count = getTodayVisitors();
  expect(getTodayVisitors()).toBe(count);
  expect(await count).toBe(0);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith('https://cdn.busuanzi.cc/api.php', expect.objectContaining({
    method: 'POST',
    body: '{"url":"https://vp.example/","referrer":""}',
    referrerPolicy: 'no-referrer',
    credentials: 'omit',
  }));
});

it('returns no count when the service is unavailable', async () => {
  fetchMock.mockRejectedValue(new Error('Network error'));
  const { getTodayVisitors } = await import('./today-visitors');
  expect(await getTodayVisitors()).toBeUndefined();
});

it('ignores non-success responses even when they include a count', async () => {
  fetchMock.mockResolvedValue(Response.json({ busuanzi_today_uv: 23 }, { status: 503 }));
  const { getTodayVisitors } = await import('./today-visitors');
  expect(await getTodayVisitors()).toBeUndefined();
});

it.each([null, {}, { busuanzi_today_uv: -1 }, { busuanzi_today_uv: '42' }])('ignores invalid data: %j', async data => {
  fetchMock.mockResolvedValue(Response.json(data));
  const { getTodayVisitors } = await import('./today-visitors');
  expect(await getTodayVisitors()).toBeUndefined();
});
