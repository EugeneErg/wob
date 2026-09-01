<template>
  <!--
    A status light, not a control.
    
    This used to own the sign-in flow, and that was the wrong home for it: the
    corner of the main menu is where you glance to see whether you are signed
    in, not where you go to do something about it. Signing in lives on the
    settings screen now, reached the way everything else is.
  -->
  <div v-if="session.status === 'signed-in'" class="badge">
    <img v-if="session.user.avatar" :src="session.user.avatar" alt="" />
    <span>{{ firstName }}</span>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { session } from '../core/session.js'

const firstName = computed(() => (session.user?.name || '').split(' ')[0] || 'Account')
</script>

<style scoped>
.badge {
  display: flex; align-items: center; gap: 7px;
  font-size: 12px; color: var(--muted);
  padding: 4px 10px 4px 4px;
  background: rgba(16, 26, 32, 0.66);
  border: 1px solid var(--line); border-radius: 999px;
}
.badge img { width: 22px; height: 22px; border-radius: 50%; }
</style>
