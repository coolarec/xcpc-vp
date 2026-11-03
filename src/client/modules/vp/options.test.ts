import { expect, it } from 'vitest';
import { buildVPQuery, readVPOptions } from './options';

it('round-trips the team organization through contest links', () => {
  const options = readVPOptions({ team: ' My team ', organization: ' 东北大学 ' });
  const query = buildVPQuery('icpc2025invitational-xi_an', options);
  expect(query).toMatchObject({ team: 'My team', organization: '东北大学' });
  expect(readVPOptions(query)).toMatchObject({ team: 'My team', organization: '东北大学' });
});

it('keeps existing team links working without an organization', () => {
  const options = readVPOptions({ team: 'My team' });
  expect(options.organization).toBe('');
  expect(buildVPQuery('test', options)).not.toHaveProperty('organization');
});

it('round-trips a real-time scheduled start through the contest link', () => {
  const at = '2026-10-27T03:04:05.000Z';
  const options = readVPOptions({ at });
  expect(options.scheduledAt).toBe('2026-10-27T11:04:05.000+08:00');
  expect(buildVPQuery('test', options).at).toBe('2026-10-27T11:04:05.000+08:00');
  expect(Date.parse(options.scheduledAt)).toBe(Date.parse(at));
});

it('includes the actual start time for immediate starts, including random contests', () => {
  const now = Date.parse('2026-11-03T15:00:00.000Z');
  for (const contest of ['test', 'random-contest']) {
    const query = buildVPQuery(contest, readVPOptions({ play: '1' }), now);
    expect(query.at).toBe('2026-11-03T23:00:00.000+08:00');
    expect(query).not.toHaveProperty('run');
    expect(buildVPQuery(contest, readVPOptions({ play: '1' }), now + 1000).at).not.toBe(query.at);
  }
});

it('interprets unzoned URL times as China time and emits explicit offsets', () => {
  const options = readVPOptions({ at: '2026-11-03T23:00:00', anchor: '2026-11-03T23:01:00' });
  expect(options.scheduledAt).toBe('2026-11-03T23:00:00.000+08:00');
  expect(options.anchorAt).toBe('2026-11-03T23:01:00.000+08:00');
  expect(buildVPQuery('test', options)).toMatchObject({ at: options.scheduledAt, anchor: options.anchorAt });
});

it('keeps old scheduled links automatic but respects an explicit pause', () => {
  const at = '2026-11-03T15:00:00.000Z';
  expect(readVPOptions({ at }).autoplay).toBe(true);
  expect(readVPOptions({ at, play: '0' }).autoplay).toBe(false);
});

it('validates clock anchors', () => {
  const at = '2026-11-03T15:00:00.000Z';
  for (const anchor of ['invalid', '2026-11-03T14:59:59.000Z']) {
    expect(() => readVPOptions({ at, anchor })).toThrow('计时基准时间格式不正确');
  }
  expect(() => readVPOptions({ anchor: at })).toThrow('计时基准时间格式不正确');
});
