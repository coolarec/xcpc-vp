import type { VPOptions } from './options';
import { formatChinaTime } from './china-time';

/** Reconstruct timing solely from the URL, including time spent away from the page. */
export function readVPClock(options: VPOptions, durationMs: number, now: number) {
  const start = Date.parse(options.scheduledAt);
  const anchor = options.anchorAt ? Date.parse(options.anchorAt) : start;
  const waiting = options.autoplay && now < start;
  const elapsed = Math.min(durationMs, options.startMinutes * 60_000 +
    (options.autoplay && Number.isFinite(anchor) ? Math.max(0, now - anchor) * options.speed : 0));
  return { elapsed, running: options.autoplay && !waiting && elapsed < durationMs, waiting };
}

/** Keep the actual start stable while changing the clock's progress, speed or play state. */
export function reanchorVPClock(options: VPOptions, elapsed: number, now: number, changes: Partial<VPOptions>): VPOptions {
  return { ...options, startMinutes: elapsed / 60_000, anchorAt: formatChinaTime(now), ...changes };
}
