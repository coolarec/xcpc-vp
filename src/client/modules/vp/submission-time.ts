/** Hours and minutes are contest elapsed time, not a time of day. */
export function parseSubmissionTime(hours: string, minutes: string, elapsedMs: number, durationMs: number): number {
  if (!/^\d+$/.test(hours) || !/^\d+$/.test(minutes)) throw new Error('提交时间的时、分须为非负整数。');
  const hour = Number(hours);
  const minute = Number(minutes);
  if (!Number.isSafeInteger(hour) || !Number.isSafeInteger(minute) || minute > 59) throw new Error('分钟须在 0–59 之间，小时须为非负整数。');
  const timeMs = (hour * 60 + minute) * 60_000;
  if (!Number.isSafeInteger(timeMs) || !Number.isFinite(durationMs) || durationMs <= 0 || timeMs >= durationMs) throw new Error('提交时间须早于比赛结束时间。');
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || timeMs > elapsedMs) throw new Error('提交时间不能晚于当前回放时间。');
  return timeMs;
}
