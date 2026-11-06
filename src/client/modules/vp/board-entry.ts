import type * as srk from '@algoux/standard-ranklist';
import { isCCPC26Ranklist } from '@/utils/ccpc26.util';
import { buildVPQuery, type VPOptions } from './options';

export type VPBoard = 'rankland' | 'domjudge';

export function supportsDomjudgeEntry(data: srk.Ranklist, rule: VPOptions['rule']): boolean {
  return data.sorter?.algorithm === 'ICPC' && rule !== 'CCPC26' && (rule === 'ICPC' || !isCCPC26Ranklist(data));
}

/** The selected system determines the document before entering a contest. */
export function buildContestEntry(board: VPBoard, contest: string, options: VPOptions) {
  const query = buildVPQuery(contest, options);
  return `${board === 'domjudge' ? '/domjudge.html' : '/'}?${new URLSearchParams(query)}`;
}
