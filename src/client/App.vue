<template>
  <Sonner />
  <ClientOnly>
    <VinNotice />
  </ClientOnly>

  <router-view v-if="focusMode" v-slot="{ Component }">
    <Suspense>
      <component :is="Component" />
    </Suspense>
  </router-view>

  <div v-else class="min-h-screen bg-background text-foreground">
    <main class="w-full px-[50px] py-8 max-md:px-5">
      <router-view v-slot="{ Component }">
        <Suspense>
          <component :is="Component" />
        </Suspense>
      </router-view>
    </main>

    <BackTop />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import BackTop from './components/layout/BackTop.vue';
import ClientOnly from './components/common/ClientOnly.vue';
import VinNotice from './components/site/VinNotice.vue';
import { Sonner } from './components/ui/sonner';
import { revealBodyAfterInitialHydration } from './app/hydration-flicker-guard';

const route = useRoute();
const focusMode = computed(() => route.query.focus === 'yes' || route.query['聚焦'] === '是');

onMounted(() => {
  nextTick(() => {
    void revealBodyAfterInitialHydration(window);
  });
});
</script>
