let countRequest: Promise<number | undefined> | undefined;

export function getTodayVisitors() {
  return countRequest ??= fetchTodayVisitors();
}

async function fetchTodayVisitors() {
  try {
    const response = await fetch('https://cdn.busuanzi.cc/api.php', {
      method: 'POST',
      // Count the site without sharing contest IDs, team names or referrers.
      body: JSON.stringify({ url: `${location.origin}/`, referrer: '' }),
      referrerPolicy: 'no-referrer',
      credentials: 'omit',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return;
    const count: unknown = (await response.json())?.busuanzi_today_uv;
    if (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0) return count;
  } catch { /* Visitor statistics must not interrupt VP. */ }
}
