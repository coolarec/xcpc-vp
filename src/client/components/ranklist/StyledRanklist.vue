<script setup lang="ts">
import { computed } from 'vue';
import { createCheckers } from 'ts-interface-checker';
import * as srkChecker from '@/lib/srk-checker/index.d.ti';
import StyledRanklistRenderer from './StyledRanklistRenderer.vue';
import type { StyledRanklistRendererProps } from './styled-ranklist-types';

const props = defineProps<StyledRanklistRendererProps>();
const checkerSuite = Object.fromEntries(
  Object.entries(srkChecker).filter(([, checker]) => {
    return !!checker && typeof (checker as { getChecker?: unknown }).getChecker === 'function';
  }),
);
const { Ranklist: ranklistChecker } = createCheckers(checkerSuite as any);

const srkCheckError = computed(() => {
  try {
    ranklistChecker.check(props.data);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
});
</script>

<template>
  <div v-if="srkCheckError" class="ml-8">
    <h3>Error occurred while checking srk:</h3>
    <pre>{{ srkCheckError }}</pre>
  </div>
  <StyledRanklistRenderer v-else v-bind="props">
    <template #after-ref-links>
      <slot name="after-ref-links" />
    </template>
    <template #extra-action="{ ranklist }">
      <slot name="extra-action" :ranklist="ranklist" />
    </template>
  </StyledRanklistRenderer>
</template>
