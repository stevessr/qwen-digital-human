import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'Home',
    component: () => import('@/components/MainLayout.vue'),
  },
  {
    path: '/config',
    name: 'Config',
    component: () => import('@/views/ConfigPage.vue'),
  },
  {
    path: '/models',
    name: 'Models',
    component: () => import('@/views/ModelsPage.vue'),
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

export default router
