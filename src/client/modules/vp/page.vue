<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import SetupView from './setup.view.vue';
import VpView from './vp.view.vue';

const route = useRoute();
const contestKey = computed(() => typeof route.query.contest === 'string' ? route.query.contest : '');
</script>

<template>
  <VpView v-if="contestKey" :key="`${contestKey}:${route.query.run || ''}`" />
  <SetupView v-else />
</template>
