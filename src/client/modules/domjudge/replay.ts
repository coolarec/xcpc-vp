import type * as srk from '@algoux/standard-ranklist';
import { formatTimeDuration } from '@algoux/standard-ranklist-utils';
import { applyVPOptions, type VPOptions } from '../vp/options';
import { prepareReplay } from '../vp/replay';
import { supportsNativeDomjudge } from '@/components/ranklist/domjudge/native';

/** DOMjudge VP always hides results in the last hour, even if source metadata omits a freeze. */
export function prepareDomjudgeReplay(source: srk.Ranklist, options: VPOptions) {
  const data = applyVPOptions(source, options);
  if (!supportsNativeDomjudge(data)) throw new Error('DOMjudge 仅支持传统赛制。请返回选赛入口选择 RankLand。');
  data.contest.frozenDuration = [Math.min(3_600_000, formatTimeDuration(data.contest.duration)), 'ms'];
  return prepareReplay(data);
}
