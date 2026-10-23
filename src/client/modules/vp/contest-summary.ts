import type * as srk from '@algoux/standard-ranklist';
import { convertToStaticRanklist, formatTimeDuration, numberToAlphabet, resolveText } from '@algoux/standard-ranklist-utils';

type Medal = 'gold' | 'silver' | 'bronze';
export interface MedalSummary {
  title: string;
  gold: number | null;
  silver: number | null;
  bronze: number | null;
}
export interface ContestSummary {
  title: string;
  date: string;
  durationMinutes: number | null;
  rule: string;
  schools: number;
  missingOrganizations: number;
  teams: number;
  officialTeams: number;
  people: number | null;
  peopleComplete: boolean;
  rosterTeams: number;
  problems: number;
  medals: MedalSummary[];
  medalError: boolean;
  problemLinks: { alias: string; title: string; url: string }[];
  referenceLinks: { title: string; url: string }[];
}

function text(value: srk.Text | undefined): string {
  return value === undefined || value === null ? '' : resolveText(value, ['zh-CN', 'zh-Hans', 'en']).trim();
}
export function safeContestLink(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^(https?:\/\/|\/\/)/i.test(value.trim())) return undefined;
  try {
    const url = new URL(value.startsWith('//') ? `https:${value}` : value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined;
    return url.href;
  } catch { return undefined; }
}
function medalType(segment: srk.RankSeriesSegment): Medal | undefined {
  if (typeof segment.style === 'string' && ['gold', 'silver', 'bronze'].includes(segment.style)) return segment.style as Medal;
  const title = text(segment.title);
  if (/\bgold\b|金奖|金牌/i.test(title)) return 'gold';
  if (/\bsilver\b|银奖|银牌/i.test(title)) return 'silver';
  if (/\bbronze\b|铜奖|铜牌/i.test(title)) return 'bronze';
}

/** Source statistics only: no assumed team size or inferred award ratios. */
export function summarizeContest(source: srk.Ranklist): ContestSummary {
  const rows = source.rows || [];
  const organizations = rows.map(row => text(row.user.organization).replace(/\s+/g, ' '));
  let people = 0;
  let rosterTeams = 0;
  let unknownRoles = false;
  for (const row of rows) {
    let teamPeople = 0;
    for (const person of row.user.teamMembers || []) {
      const role = person.role?.trim().toLowerCase();
      if (role === 'coach' || role === '教练') continue;
      if (role && !['teammember', 'captain', '选手', '队长'].includes(role)) { unknownRoles = true; continue; }
      if (text(person.name)) teamPeople++;
      else unknownRoles = true;
    }
    if (teamPeople) rosterTeams++;
    people += teamPeople;
  }
  const medals: MedalSummary[] = [];
  let medalError = false;
  const medalSeries = (source.series || []).map((series, index) => ({
    series, index, types: (series.segments || []).map(medalType),
  })).filter(item => item.types.some(Boolean));
  if (medalSeries.length) {
    try {
      // The converter can sort rows; never change the cached source used to start VP.
      const ranked = convertToStaticRanklist(JSON.parse(JSON.stringify(source)));
      for (const { series, index, types } of medalSeries) {
        const counts: MedalSummary = { title: series.title || '奖项', gold: null, silver: null, bronze: null };
        for (const type of types) if (type) counts[type] = 0;
        for (const row of ranked.rows) {
          const value = row.rankValues[index];
          if (!value || value.rank === null || value.segmentIndex == null) continue;
          const type = types[value.segmentIndex];
          if (type) counts[type] = (counts[type] || 0) + 1;
        }
        medals.push(counts);
      }
    } catch { medalError = true; }
  }
  const problemLinks = (source.problems || []).flatMap((problem, index) => {
    const url = safeContestLink(problem.link);
    return url ? [{ alias: problem.alias || numberToAlphabet(index), title: text(problem.title), url }] : [];
  });
  const referenceLinks = (source.contest.refLinks || []).flatMap(link => {
    const url = safeContestLink(link.link);
    return url ? [{ title: text(link.title) || '相关链接', url }] : [];
  });
  const duration = source.contest.duration ? formatTimeDuration(source.contest.duration, 'min') : NaN;
  return {
    title: text(source.contest.title), date: source.contest.startAt?.slice(0, 10) || '',
    durationMinutes: Number.isFinite(duration) && duration > 0 ? duration : null,
    rule: source.sorter?.algorithm === 'ICPC'
      ? source.sorter.config.extendedAlgorithms?.some(item => item.algorithm === 'CCPC26') ? 'CCPC 2026' : 'ICPC / 传统 CCPC'
      : source.sorter?.algorithm || '未提供',
    schools: new Set(organizations.filter(Boolean)).size,
    missingOrganizations: organizations.filter(item => !item).length,
    teams: rows.length, officialTeams: rows.filter(row => row.user.official !== false).length,
    people: people || (rows.length === 0 ? 0 : null),
    peopleComplete: rosterTeams === rows.length && !unknownRoles, rosterTeams,
    problems: source.problems?.length || 0, medals, medalError, problemLinks, referenceLinks,
  };
}
