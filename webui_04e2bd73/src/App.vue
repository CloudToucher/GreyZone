<script setup lang="ts">
import { computed, onMounted } from 'vue'
import TopBar from './components/TopBar.vue'
import FileTree from './components/FileTree.vue'
import DMView from './views/DMView.vue'
import PlayerView from './views/PlayerView.vue'
import { useWorkspaceStore } from './stores/workspace'

const ws = useWorkspaceStore()

onMounted(() => {
  ws.bootstrap()
})

const modeLabel = computed(() => (ws.panel === 'dm' ? 'GAME MASTER' : 'OPERATOR'))
const modeColor = computed(() =>
  ws.panel === 'dm' ? 'bg-navy-800' : 'bg-crimson-600',
)
</script>

<template>
  <div class="flex h-screen w-screen flex-col bg-paper-100">
    <TopBar />

    <main class="flex min-h-0 flex-1">
      <!-- Left rail -->
      <div class="w-64 shrink-0 border-r-2 border-paper-950">
        <FileTree />
      </div>

      <!-- Center -->
      <div class="flex min-w-0 flex-1 flex-col">
        <DMView v-if="ws.panel === 'dm'" />
        <PlayerView v-else />
      </div>
    </main>

    <!-- Bottom strip — game-style HUD telemetry for player, doc-style for DM -->
    <footer
      class="flex items-center justify-between border-t-2 border-paper-950 bg-white px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.15em]"
    >
      <div class="flex items-center gap-2">
        <span class="h-2 w-2 rounded-full" :class="modeColor" />
        <span class="font-semibold text-paper-800">{{ modeLabel }}</span>
        <span class="text-paper-500">MODE</span>
        <template v-if="ws.panel === 'player'">
          <span class="ml-3 text-paper-300">|</span>
          <span class="text-paper-500">SECTOR</span>
          <span class="font-bold text-crimson-700">FENCE-01</span>
          <span class="ml-3 text-paper-300">|</span>
          <span class="text-paper-500">ZONE STATUS</span>
          <span class="font-bold text-ochre-700">ACTIVE</span>
        </template>
      </div>
      <div class="flex items-center gap-3 text-paper-500">
        <span>v0.3 · playground + 藏身处 + DM反馈</span>
        <span class="text-paper-300">|</span>
        <span class="text-paper-500">opencode ✓</span>
      </div>
    </footer>
  </div>
</template>
