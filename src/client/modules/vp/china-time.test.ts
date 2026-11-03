import { expect, it } from 'vitest';
import { formatChinaTime, formatChinaTimeLabel, getChinaClockTime, nextChinaStart, parseChinaTime } from './china-time';

it('formats URL timestamps in China time without changing the instant', () => {
  const timestamp = Date.parse('2026-11-03T16:05:06.007Z');
  const formatted = formatChinaTime(timestamp);
  expect(formatted).toBe('2026-11-04T00:05:06.007+08:00');
  expect(Date.parse(formatted)).toBe(timestamp);
  expect(getChinaClockTime(timestamp)).toEqual({ hour: 0, minute: 5 });
  expect(formatChinaTimeLabel(timestamp)).toContain('2026年11月4日');
  expect(formatChinaTimeLabel(timestamp)).toContain('00:05');
});

it.each([
  ['2026-11-03T15:00:00Z', '2026-11-03T23:00:00+08:00'],
  ['2026-11-03T10:00:00-05:00', '2026-11-03T23:00:00+08:00'],
  ['2026-11-03T23:00', '2026-11-03T23:00:00+08:00'],
  ['2026-11-03', '2026-11-03T00:00:00+08:00'],
])('parses %s consistently across browser timezones', (input, expected) => {
  expect(parseChinaTime(input)).toBe(Date.parse(expected));
});

it.each([
  ['2026-11-03T15:50:00Z', 23, 55, '2026-11-03T23:55:00.000+08:00'],
  ['2026-11-03T15:50:00Z', 0, 5, '2026-11-04T00:05:00.000+08:00'],
  ['2026-11-03T16:10:00Z', 0, 5, '2026-11-05T00:05:00.000+08:00'],
  ['2026-12-31T16:00:00Z', 0, 0, '2027-01-02T00:00:00.000+08:00'],
  ['2026-11-01T05:30:00Z', 14, 0, '2026-11-01T14:00:00.000+08:00'],
])('schedules the next China-time occurrence from %s at %s:%s', (now, hour, minute, expected) => {
  expect(nextChinaStart(hour, minute, Date.parse(now))).toBe(expected);
});

it('rejects invalid times', () => {
  expect(parseChinaTime('invalid')).toBeNaN();
  expect(parseChinaTime('2026-11-03T25:00')).toBeNaN();
  for (const [hour, minute] of [[-1, 0], [24, 0], [0, 60], [1.5, 0]]) {
    expect(() => nextChinaStart(hour, minute, Date.now())).toThrow('北京时间');
  }
});
