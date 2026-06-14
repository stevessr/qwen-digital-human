<script setup lang="ts">
import { Layout } from 'ant-design-vue'
import AvatarPanel from './Avatar/AvatarPanel.vue'
import MapPanel from './Map/MapPanel.vue'
import ChatSidebar from './Chat/ChatSidebar.vue'

const { Sider, Content } = Layout
</script>

<template>
  <Layout style="height: 100vh">
    <Content style="display: flex; flex-direction: column; min-width: 0; background: #0a0a0a; position: relative">
      <AvatarPanel />
      <MapPanel style="flex: 1; min-height: 280px" />
    </Content>

    <Sider
      width="420"
      theme="dark"
      style="background: #1e1e1e; border-left: 1px solid #333"
    >
      <ChatSidebar />
    </Sider>
  </Layout>
</template>
