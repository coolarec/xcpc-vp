<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import SetupView from './setup.view.vue';
import VpView from './vp.view.vue';
import PresenceCount from './PresenceCount.vue';

const route = useRoute();
const contestKey = computed(() => typeof route.query.contest === 'string' ? route.query.contest : '');
</script>

<template>
  <VpView v-if="contestKey" :key="`${contestKey}:${route.query.run || ''}`" />
  <SetupView v-else />
  <footer class="mt-6 text-center text-xs leading-6 text-muted-foreground">
    <div>本网站数据来源 Rankland，访问 <a href="https://rank.ac" class="text-primary hover:underline">rank.ac</a> 自动跳转</div>
    <div>Thanks to <a href="https://algoux.org/" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline">algoUX</a> and <a href="https://www.coolarec.link/" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline">CoolArec</a> ❤️</div>
  </footer>
</template>
