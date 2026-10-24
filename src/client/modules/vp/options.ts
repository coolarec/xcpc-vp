import type * as srk from '@algoux/standard-ranklist';

export interface VPOptions {
  rule: 'auto' | 'ICPC' | 'CCPC26';
  speed: number;
  startMinutes: number;
  team: string;
  feed: boolean;
  revealCount: number;
  revealRatio: number;
  autoplay: boolean;
}

export const DEFAULT_VP_OPTIONS: VPOptions = {
  rule: 'auto', speed: 1, startMinutes: 0, team: '', feed: true,
  revealCount: 50, revealRatio: 20, autoplay: false,
};

function value(query: Record<string, unknown>, key: string): string | undefined {
  const item = query[key];
  if (item === undefined || item === null) return undefined;
  if (typeof item !== 'string') throw new Error(`参数 ${key} 格式不正确。`);
  return item;
}

function numeric(query: Record<string, unknown>, key: string, fallback: number, max: number, integer = false): number {
  const raw = value(query, key);
  if (raw === undefined) return fallback;
  const num = raw.trim() === '' ? NaN : Number(raw);
  if (!Number.isFinite(num) || num < 0 || num > max || (integer && !Number.isInteger(num))) throw new Error(`参数 ${key} 必须为 0–${max} 之间的${integer ? '整数' : '数字'}。`);
  return num;
}

export function readVPOptions(query: Record<string, unknown>): VPOptions {
  const rule = value(query, 'rule') || 'auto';
  if (!['auto', 'ICPC', 'CCPC26'].includes(rule)) throw new Error('赛制参数仅支持 auto、ICPC 或 CCPC26。');
  const speed = numeric(query, 'speed', 1, 60);
  if (![1, 2, 5, 10, 30, 60].includes(speed)) throw new Error('倍速仅支持 1、2、5、10、30、60。');
  const team = (value(query, 'team') || '').trim();
  if (team.length > 80) throw new Error('队伍名称不能超过 80 字。');
  const feed = value(query, 'feed');
  if (feed !== undefined && !['0', '1'].includes(feed)) throw new Error('feed 参数必须为 0 或 1。');
  const play = value(query, 'play');
  if (play !== undefined && !['0', '1'].includes(play)) throw new Error('play 参数必须为 0 或 1。');
  const revealCount = numeric(query, 'count', 50, 100000, true);
  const revealRatio = numeric(query, 'ratio', 20, 100);
  if (rule === 'CCPC26' && revealCount === 0 && revealRatio === 0) throw new Error('CCPC 2026 至少需要一个非零揭题阈值。');
  return {
    rule: rule as VPOptions['rule'], speed, team, feed: feed !== '0', autoplay: play === '1',
    startMinutes: numeric(query, 'from', 0, 10080), revealCount, revealRatio,
  };
}

export function buildVPQuery(contest: string, options: VPOptions): Record<string, string> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(contest)) throw new Error('比赛 ID 无效。');
  const query: Record<string, string> = {
    contest, rule: options.rule, speed: String(options.speed),
    from: String(options.startMinutes), feed: options.feed ? '1' : '0', play: options.autoplay ? '1' : '0',
  };
  if (options.team.trim()) query.team = options.team.trim();
  if (options.rule === 'CCPC26') {
    query.count = String(options.revealCount);
    query.ratio = String(options.revealRatio);
  }
  readVPOptions(query);
  return query;
}

/** Change rules only; every snapshot is still scored and presented by SRK. */
export function applyVPOptions(source: srk.Ranklist, options: VPOptions): srk.Ranklist {
  if (source.sorter?.algorithm !== 'ICPC') throw new Error('目前仅支持 ICPC / CCPC 赛制榜单。');
  const data: srk.Ranklist = JSON.parse(JSON.stringify(source));
  const sorter = data.sorter as srk.SorterICPC;
  if (options.rule === 'ICPC') delete sorter.config.extendedAlgorithms;
  if (options.rule === 'CCPC26') {
    sorter.config.extendedAlgorithms = [{ algorithm: 'CCPC26', config: {
      problemRevealAcceptedThreshold: {
        ...(options.revealCount ? { count: options.revealCount } : {}),
        ...(options.revealRatio ? { ratio: options.revealRatio / 100 } : {}),
      },
    } }];
  }
  sorter.config.penalty = [20, 'min'];
  return data;
}
