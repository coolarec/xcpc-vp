<template>
  <div class="plugin_scroll-solution-container" data-id="scroll-solution-container">
    <TransitionGroup name="scroll-solution" tag="div">
      <div
        v-for="item in visibleItems"
        :key="item.key"
        class="plugin_scroll-solution-toast"
      >
        <div class="container">
          <div class="score">{{ item.data.score.value }}</div>
          <div class="user">
            <span class="user-name">{{ resolveDisplayText(item.data.user.name) }}</span>
            <span v-if="item.data.user.organization" class="user-second-name">
              {{ resolveDisplayText(item.data.user.organization) }}
            </span>
          </div>
          <div class="problem">{{ item.data.problem.alias }}</div>
          <div :class="resultClass(item.data.result)">
            <span>{{ item.data.result }}</span>
          </div>
        </div>
      </div>
    </TransitionGroup>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { resolveText } from '@algoux/standard-ranklist-utils';
import type * as srk from '@algoux/standard-ranklist';

export interface ScrollSolutionDataItem {
  problem: {
    alias: string;
  };
  score: {
    value: srk.RankScore['value'];
  };
  result: Exclude<srk.SolutionResultFull, null>;
  user: {
    name: srk.User['name'];
    organization: srk.User['organization'];
  };
}

interface VisibleItem {
  key: number;
  data: ScrollSolutionDataItem;
}

const props = withDefaults(defineProps<{ containerMaxHeight?: number }>(), {
  containerMaxHeight: 0,
});

const ITEM_HEIGHT = 45;
const POP_LIMIT = 20;
const POP_INTERVAL = 200;
const MIN_DELAY = 1000;
const RJ_DELAY = 10_000;
const DELAY_MAP: Record<string, number> = {
  FB: 180_000,
  AC: 20_000,
  RJ: RJ_DELAY,
  '?': 10_000,
  WA: RJ_DELAY,
  PE: RJ_DELAY,
  TLE: RJ_DELAY,
  MLE: RJ_DELAY,
  OLE: RJ_DELAY,
  RTE: RJ_DELAY,
  CE: RJ_DELAY,
  UKE: RJ_DELAY,
};

const visibleItems = ref<VisibleItem[]>([]);
const queue: ScrollSolutionDataItem[] = [];
const timers: number[] = [];
let nextKey = 1;
let popInterval = POP_INTERVAL;
let queueTimer: number | undefined;

const popLimit = computed(() => {
  if (!props.containerMaxHeight) {
    return POP_LIMIT;
  }
  return Math.max(1, Math.floor(props.containerMaxHeight / ITEM_HEIGHT));
});

function pushSolutions(rows: ScrollSolutionDataItem[]) {
  if (!rows.length) {
    return;
  }
  for (const row of rows) {
    if (row.result === 'FB') {
      pop(row, DELAY_MAP[row.result]);
    } else {
      queue.push(row);
    }
  }
}

function pop(data: ScrollSolutionDataItem, delay = DELAY_MAP[data.result] || RJ_DELAY) {
  const key = nextKey;
  nextKey += 1;
  visibleItems.value = [...visibleItems.value, { key, data }].slice(-popLimit.value);
  const timer = window.setTimeout(() => {
    visibleItems.value = visibleItems.value.filter((item) => item.key !== key);
  }, delay);
  timers.push(timer);
}

function popFromQueue() {
  if (queue.length > 0) {
    const maxPopInterval = 100;
    const next = queue[0];
    let delay = DELAY_MAP[next.result] || RJ_DELAY;

    if (queue.length <= popLimit.value) {
      popInterval = maxPopInterval;
    } else {
      const scale = Math.max(1 / (queue.length / popLimit.value) - 0.5, 0.01);
      delay = MIN_DELAY + delay * scale;
      popInterval = maxPopInterval * scale;
    }

    pop(next, delay);
    queue.shift();
  }
  queueTimer = window.setTimeout(popFromQueue, popInterval);
}

function resultClass(result: ScrollSolutionDataItem['result']) {
  return [
    'result',
    result === 'FB' ? 'result-fb' : '',
    result === 'AC' ? 'result-ac' : '',
    result !== 'FB' && result !== 'AC' && result !== '?' ? 'result-rj' : '',
    result === '?' ? 'result-fz' : '',
  ];
}

function resolveDisplayText(text: srk.Text) {
  return resolveText(text);
}

onMounted(() => {
  popFromQueue();
});

onBeforeUnmount(() => {
  if (queueTimer !== undefined) {
    window.clearTimeout(queueTimer);
  }
  for (const timer of timers) {
    window.clearTimeout(timer);
  }
});

defineExpose({
  pushSolutions,
});
</script>

<style scoped>
.plugin_scroll-solution-container {
  --bg: #fff;
  --text: #333;
  --color-user-second-name: #828282;
  --color-ac-bg: #4fb24f;
  --color-rj-bg: #e23a36;
  --color-result-text: #fff;

  position: fixed;
  bottom: 0;
  left: 0;
  z-index: 50;
  width: 250px;
  padding: 0;
  color: var(--text);
  pointer-events: none;
}

:global(.dark) .plugin_scroll-solution-container {
  --bg: #272727;
  --text: rgb(223, 223, 233);
  --color-user-second-name: #a5a5a5;
  --color-ac-bg: #1f841f;
  --color-rj-bg: #a02a27;
  --color-result-text: var(--text);
}

.plugin_scroll-solution-toast {
  margin: 0;
  min-height: initial;
  padding: 0;
  border-radius: 0;
  background-color: var(--bg);
  font-family: "Helvetica Neue", Helvetica, "Microsoft Yahei", Arial, sans-serif;
}

.container {
  display: flex;
  align-items: center;
  height: 45px;
}

.score {
  width: 40px;
  text-align: center;
}

.user {
  width: 125px;
  height: 45px;
  overflow: hidden;
}

.user span {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 1;
}

.user-name {
  font-size: 14px;
}

.user-second-name {
  color: var(--color-user-second-name);
  font-size: 11px;
}

.problem {
  width: 40px;
  text-align: center;
}

.result {
  display: flex;
  width: 45px;
  align-self: stretch;
  align-items: center;
  justify-content: center;
  text-align: center;
}

.result-fb {
  color: #fff;
  background-color: #4fb24f;
  background-image: linear-gradient(-45deg, #4fb24f, #099209, #15d015, #14cc14);
  background-size: 400% 400%;
  animation: bg-gradient-animation 6s infinite linear;
}

.result-fb span {
  animation: blink 1.5s infinite linear;
}

.result-ac {
  color: var(--color-result-text);
  background-color: var(--color-ac-bg);
}

.result-rj {
  color: var(--color-result-text);
  background-color: var(--color-rj-bg);
}

.scroll-solution-enter-active,
.scroll-solution-leave-active {
  transition: all 0.2s ease;
}

.scroll-solution-enter-from,
.scroll-solution-leave-to {
  opacity: 0;
  transform: translateX(-16px);
}

@keyframes bg-gradient-animation {
  0% {
    background-position: 0% 50%;
  }

  50% {
    background-position: 100% 50%;
  }

  100% {
    background-position: 0% 50%;
  }
}

@keyframes blink {
  0% {
    opacity: 1;
  }

  25% {
    opacity: 0.9;
  }

  50% {
    opacity: 0.3;
  }

  75% {
    opacity: 0.9;
  }

  100% {
    opacity: 1;
  }
}
</style>
