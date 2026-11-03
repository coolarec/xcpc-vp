<script setup lang="ts">
import { computed } from 'vue';
import type * as srk from '@algoux/standard-ranklist';
import { getProgressMetrics } from '@algoux/standard-ranklist-renderer-component-core';
import { secToTimeStr } from '@algoux/standard-ranklist-utils';

const props = defineProps<{ data: srk.Ranklist; elapsedMs: number; live: boolean }>();

// The VP clock is the only time source, including while paused and after the contest ends.
const metrics = computed(() => getProgressMetrics(
  props.data, Date.parse(props.data.contest.startAt) + props.elapsedMs, 0, 0, false,
));
const percent = computed(() => {
  const duration = metrics.value.elapsed + metrics.value.remaining;
  return duration ? metrics.value.elapsed / duration * 100 : 0;
});
</script>

<template>
  <div class="srk-progress-bar-container">
    <div class="srk-progress-bar" role="progressbar" aria-label="比赛进度" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="Math.round(percent)">
      <div class="srk-progress-bar-body">
        <div class="srk-progress-bar-segment srk-progress-bar-normal" :style="{ width: `${metrics.frozenBreakpoint * 100}%` }">
          <div class="srk-progress-bar-fill" :style="{ width: `${metrics.normalInnerPercent}%` }" />
        </div>
        <div class="srk-progress-bar-segment srk-progress-bar-frozen" :style="{ width: `${(1 - metrics.frozenBreakpoint) * 100}%` }">
          <div class="srk-progress-bar-fill" :style="{ width: `${metrics.frozenInnerPercent}%` }" />
        </div>
      </div>
    </div>
    <div class="srk-progress-secondary-area">
      <div class="srk-progress-secondary-area-left">Elapsed: {{ secToTimeStr(Math.round(metrics.elapsed / 1000)) }}</div>
      <div class="srk-progress-secondary-area-center">
        <div v-if="live && metrics.remaining > 0" class="srk-progress-live-text">Live</div>
        <div v-else style="visibility: hidden">SRK</div>
      </div>
      <div class="srk-progress-secondary-area-right">Remaining: {{ secToTimeStr(Math.round(metrics.remaining / 1000)) }}</div>
    </div>
  </div>
</template>
