const CHINA_OFFSET_MS = 8 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

export function formatChinaTime(timestamp: number): string {
  return new Date(timestamp + CHINA_OFFSET_MS).toISOString().replace('Z', '+08:00');
}

/** Treat ISO dates without a timezone as China time, independent of the browser timezone. */
export function parseChinaTime(value: string): number {
  const match = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?))?(Z|[+-]\d{2}:?\d{2})?$/i.exec(value);
  if (!match) return NaN;
  return Date.parse(`${match[1]}T${match[2] || '00:00:00'}${match[3] || '+08:00'}`);
}

export function getChinaClockTime(timestamp: number) {
  const date = new Date(timestamp + CHINA_OFFSET_MS);
  return { hour: date.getUTCHours(), minute: date.getUTCMinutes() };
}

export function nextChinaStart(hour: number, minute: number, now: number): string {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59 || !Number.isFinite(now)) {
    throw new Error('请选择有效的北京时间。');
  }
  const date = new Date(now + CHINA_OFFSET_MS);
  let timestamp = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour, minute) - CHINA_OFFSET_MS;
  if (timestamp <= now) timestamp += DAY_MS;
  return formatChinaTime(timestamp);
}

export function formatChinaTimeLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23',
  });
}
