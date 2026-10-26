<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { PRESENCE_ENDPOINT, PRESENCE_HEARTBEAT_MS } from '../../../common/vp-presence';

const count = ref<number>();
const loading = ref(true);
let timer: ReturnType<typeof setInterval>;
let pending: AbortController | undefined;

async function refresh() {
  if (pending) return;
  const controller = new AbortController();
  pending = controller;
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(PRESENCE_ENDPOINT, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error('Presence unavailable');
    const data = await response.json();
    if (!Number.isSafeInteger(data.count) || data.count < 0) throw new Error('Invalid count');
    count.value = data.count;
  } catch { count.value = undefined; }
  finally {
    clearTimeout(timeout);
    loading.value = false;
    if (pending === controller) pending = undefined;
  }
}

onMounted(() => {
  void refresh();
  timer = setInterval(refresh, PRESENCE_HEARTBEAT_MS);
});
onBeforeUnmount(() => { clearInterval(timer); pending?.abort(); });
</script>

<template>
  <p class="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground" role="status" aria-live="polite" data-id="vp-presence-count">
    <span class="h-2 w-2 shrink-0 rounded-full" :class="count !== undefined ? 'bg-green-500' : 'bg-muted-foreground/40'" aria-hidden="true" />
    <span v-if="count !== undefined">现在有 {{ count }} 人正在 VP 中</span>
    <span v-else>{{ loading ? '正在获取 VP 人数…' : '在线人数暂不可用' }}</span>
  </p>
</template>
