<script setup lang="ts">
import { onMounted } from 'vue'
import { ConfigProvider, theme } from 'ant-design-vue'
import zhCN from 'ant-design-vue/es/locale/zh_CN'
import { useChatStore } from './stores/chat'
import { useFaceTrackingStore } from './stores/faceTracking'

const chatStore = useChatStore()
const faceTrackingStore = useFaceTrackingStore()

onMounted(() => {
  chatStore.loadSettings()
  faceTrackingStore.loadFromStorage()
})
</script>

<template>
  <ConfigProvider :locale="zhCN" :theme="{ algorithm: theme.darkAlgorithm }">
    <router-view />
  </ConfigProvider>
</template>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial,
    'Noto Sans', sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol',
    'Noto Color Emoji';
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

#app {
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}
</style>
