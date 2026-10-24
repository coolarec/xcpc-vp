import type * as srk from '@algoux/standard-ranklist';
import {
  canRegenerateRanklist,
  filterSolutionsUntil,
  formatTimeDuration,
  getSortedCalculatedRawSolutions,
  regenerateRanklistBySolutions,
} from '@algoux/standard-ranklist-utils';
import type { CalculatedSolutionTetrad } from '@algoux/standard-ranklist-utils';

export type { CalculatedSolutionTetrad } from '@algoux/standard-ranklist-utils';
export const OWN_ID = '__vp_self__';

export interface ManualSubmission {
  problemIndex: number;
  timeMs: number;
  result: 'AC' | 'WA';
}

export interface PreparedReplay {
  /** Clean starting board, ordered by user.id rather than final rank. */
  source: srk.Ranklist;
  durationMs: number;
  frozenAtMs: number;
  solutions: CalculatedSolutionTetrad[];
  snapshotAt(ms: number, manual?: ManualSubmission[], ownName?: string): srk.Ranklist;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const emptyStatuses = (count: number): srk.RankProblemStatus[] =>
  Array.from({ length: count }, () => ({ result: null, solutions: [] }));
const byUserId = (a: srk.RanklistRow, b: srk.RanklistRow) =>
  a.user.id < b.user.id ? -1 : a.user.id > b.user.id ? 1 : 0;

function milliseconds(time: srk.TimeDuration, path: string): number {
  try {
    const value = formatTimeDuration(time, 'ms');
    if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) throw new Error('invalid duration');
    return value;
  } catch {
    throw new Error(`${path}: 无效时间，须为非负有限数及 SRK 时间单位。`);
  }
}

/** Replay supplied submissions with official SRK scoring, without synthesizing history. */
export function prepareReplay(data: srk.Ranklist): PreparedReplay {
  if (!canRegenerateRanklist(data) || !/^0\.3\.\d+$/.test(data.version)) {
    throw new Error('VP 仅支持 SRK 0.3.x 的 ICPC 比赛，不支持积分赛。');
  }
  if (data.sorter?.algorithm === 'ICPC') {
    for (const extension of data.sorter.config.extendedAlgorithms || []) {
      if (extension.algorithm !== 'CCPC26') throw new Error('VP 暂不支持此扩展赛制。');
      const threshold = extension.config.problemRevealAcceptedThreshold;
      const validCount = threshold.count !== undefined && Number.isSafeInteger(threshold.count) && threshold.count > 0;
      const validRatio = threshold.ratio !== undefined && Number.isFinite(threshold.ratio) && threshold.ratio > 0 && threshold.ratio <= 1;
      if ((!validCount && !validRatio) || (threshold.count !== undefined && !validCount) || (threshold.ratio !== undefined && !validRatio)) {
        throw new Error('CCPC 2026 揭题阈值无效：需要正整数队伍数或 (0, 1] 的比例。');
      }
    }
  }
  const durationMs = milliseconds(data.contest.duration, 'contest.duration');
  if (!durationMs || !data.problems.length) throw new Error('VP 需要正数赛长及至少一道题目。');
  const frozenAtMs = Math.max(0, durationMs - (data.contest.frozenDuration ? milliseconds(data.contest.frozenDuration, 'contest.frozenDuration') : 0));
  const startMs = Date.parse(data.contest.startAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(new Date(startMs + durationMs).getTime())) {
    throw new Error('contest.startAt: 无效比赛时间。');
  }
  if (data.sorter?.algorithm === 'ICPC' && data.sorter.config.penalty) {
    milliseconds(data.sorter.config.penalty, 'sorter.config.penalty');
  }
  const template = clone(data);
  template.rows.sort(byUserId);
  // Clear summaries before extraction: the official extractor otherwise creates
  // synthetic RJ submissions for accepted statuses without detailed solutions.
  const timelineRows: srk.RanklistRow[] = template.rows.map((row) => ({
    user: row.user,
    score: { value: 0 },
    statuses: row.statuses.map((status) => ({ result: null, solutions: status.solutions || [] })),
  }));
  const solutions = getSortedCalculatedRawSolutions(timelineRows);
  const baseline = regenerateRanklistBySolutions({ ...template, rows: timelineRows }, []);
  baseline._now = new Date(startMs).toISOString();
  return {
    source: clone(baseline),
    durationMs,
    frozenAtMs,
    solutions: clone(solutions),
    snapshotAt(ms, manual = [], ownName = '') {
      if (!Number.isFinite(ms)) throw new Error('重放时间必须是有限数。');
      if (!Array.isArray(manual) || typeof ownName !== 'string') throw new Error('无效的手动提交或队伍名称。');
      const timeMs = Math.max(0, Math.min(ms, durationMs));
      const own: srk.RanklistRow = {
        user: { id: OWN_ID, name: ownName.trim() || '我的队伍', official: true },
        score: { value: 0 },
        statuses: emptyStatuses(template.problems.length),
      };
      for (const submission of manual) {
        if (!submission ||
            !Number.isInteger(submission.problemIndex) || submission.problemIndex < 0 || submission.problemIndex >= own.statuses.length ||
            !Number.isFinite(submission.timeMs) || submission.timeMs < 0 || submission.timeMs > durationMs ||
            (submission.result !== 'AC' && submission.result !== 'WA')) {
          throw new Error('无效的手动提交：需要有效题号、比赛内时间及 AC/WA。');
        }
        own.statuses[submission.problemIndex].solutions!.push({ result: submission.result, time: [submission.timeMs, 'ms'] });
      }
      const hasOwn = !!ownName.trim() || manual.length > 0;
      const events = hasOwn ? getSortedCalculatedRawSolutions([...timelineRows, own]) : solutions;
      const input = hasOwn ? { ...baseline, rows: [...baseline.rows, own].sort(byUserId) } : baseline;
      const visibleSolutions = filterSolutionsUntil(events, [timeMs, 'ms']).map((solution): CalculatedSolutionTetrad =>
        timeMs < durationMs && solution[0] !== OWN_ID && formatTimeDuration(solution[3], 'ms') >= frozenAtMs
          ? [solution[0], solution[1], '?', solution[3]]
          : solution,
      );
      const snapshot = regenerateRanklistBySolutions(input, visibleSolutions);
      snapshot._now = new Date(startMs + timeMs).toISOString();
      // Official regeneration reuses users/solution tuples; detach the public snapshot.
      return clone(snapshot);
    },
  };
}
