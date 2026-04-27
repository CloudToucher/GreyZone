<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import MarkdownView from '../components/MarkdownView.vue'
import StatusBar from '../components/StatusBar.vue'
import PlaygroundEditor from '../components/PlaygroundEditor.vue'
import SafeHouse from '../components/SafeHouse.vue'
import DMFeedback from '../components/DMFeedback.vue'
import DicePanel from '../components/DicePanel.vue'
import PlayerHub from './PlayerHub.vue'
import { useWorkspaceStore } from '../stores/workspace'
import { useRoundStore } from '../stores/round'
import { usePlayerStore } from '../stores/players'
import { fetchDiceStats, fetchTree, type DiceStats } from '../lib/api'

const ws = useWorkspaceStore()
const round = useRoundStore()
const ply = usePlayerStore()

type PlayerTab = 'playground' | 'safehouse' | 'dmfeedback' | 'docs' | 'hub'

const activeTab = ref<PlayerTab>('hub')
const diceStats = ref<DiceStats | null>(null)
const showDice = ref(false)

onMounted(async () => {
  try { diceStats.value = await fetchDiceStats() } catch {}
})

function onPlayerChange(e: Event) {
  ply.setPlayer((e.target as HTMLSelectElement).value)
}

// Auto-switch to DM feedback when a round starts
watch(() => round.status, (s) => {
  if (s === 'running' || s === 'starting') activeTab.value = 'dmfeedback'
})

// Auto-switch to hub if no file selected
watch(() => ws.currentPath, (p) => {
  if (!p) activeTab.value = 'hub'
  else if (activeTab.value === 'hub') activeTab.value = 'docs'
})

const tabs: { id: PlayerTab; label: string; icon: string; badge?: () => string | number | undefined }[] = [
  { id: 'hub', label: '主控台', icon: '▣' },
  { id: 'playground', label: '行动板', icon: '◈', badge: () => round.status === 'idle' ? '待命' : undefined },
  { id: 'safehouse', label: '藏身处', icon: '⌂' },
  { id: 'dmfeedback', label: 'DM反馈', icon: '▶', badge: () => round.status === 'running' ? 'LIVE' : round.status === 'done' ? '✓' : undefined },
  { id: 'docs', label: '文档', icon: '▣' },
]
</script>

<template>
  <div class="relative flex h-full min-w-0 flex-1 flex-col">
    <!-- Faint pattern -->
    <div aria-hidden="true" class="pointer-events-none absolute inset-0 opacity-[0.04]"
      style="background-image: repeating-linear-gradient(45deg, #0c0a09 0, #0c0a09 1px, transparent 1px, transparent 22px);" />

    <!-- Tab bar -->
    <div class="relative z-10 flex items-center justify-between gap-2 border-b-2 border-paper-950 bg-white px-3 py-1">
      <div class="flex items-stretch gap-0.5">
        <button v-for="t in tabs" :key="t.id" @click="activeTab = t.id"
          class="flex items-center gap-1.5 rounded-t-sm px-3 py-1.5 text-[11px] font-bold transition-colors border-b-2 -mb-0.5"
          :class="activeTab === t.id
            ? 'border-crimson-600 text-crimson-700 bg-crimson-50/60'
            : 'border-transparent text-paper-500 hover:text-paper-800 hover:bg-paper-50'">
          <span class="font-mono text-[11px]">{{ t.icon }}</span>
          {{ t.label }}
          <span v-if="t.badge?.()" class="rounded-sm px-1 py-px font-mono text-[8px] font-bold leading-tight"
            :class="t.badge?.() === 'LIVE' ? 'bg-crimson-600 text-white animate-pulse' : 'bg-paper-200 text-paper-600'">
            {{ t.badge?.() }}
          </span>
        </button>
      </div>

      <div class="flex items-center gap-2">
        <!-- Player identity -->
        <div class="flex items-center gap-1 rounded-sm border border-paper-300 bg-paper-50 px-1.5 py-0.5">
          <span class="font-mono text-[9px] uppercase tracking-widest text-paper-400">OP</span>
          <select :value="ply.currentName" @change="onPlayerChange"
            class="bg-transparent font-mono text-[10px] font-bold text-paper-900 focus:outline-none max-w-[80px]">
            <option v-for="p in ply.roster" :key="p.name" :value="p.name">{{ p.name }}</option>
          </select>
        </div>
        <button @click="showDice = !showDice"
          class="rounded-sm border border-paper-300 bg-white px-1.5 py-0.5 font-mono text-[9px] text-paper-500 hover:border-crimson-600 hover:text-crimson-700">
          骰子{{ diceStats ? ` ${diceStats.total}` : '' }}
        </button>
      </div>
    </div>

    <div class="relative z-10 flex min-h-0 flex-1">
      <!-- Main panel -->
      <div class="flex min-h-0 flex-1 flex-col" :class="{ 'border-r border-paper-300': showDice }">
        <!-- Status bar (shown in docs/hub) -->
        <StatusBar v-if="activeTab === 'docs' || activeTab === 'hub'" />

        <div v-if="activeTab === 'hub'" class="min-h-0 flex-1 overflow-y-auto">
          <PlayerHub />
        </div>
        <div v-else-if="activeTab === 'playground'" class="min-h-0 flex-1 flex flex-col">
          <PlaygroundEditor />
        </div>
        <div v-else-if="activeTab === 'safehouse'" class="min-h-0 flex-1 flex flex-col">
          <SafeHouse />
        </div>
        <div v-else-if="activeTab === 'dmfeedback'" class="min-h-0 flex-1 flex flex-col">
          <DMFeedback />
        </div>
        <div v-else-if="activeTab === 'docs'" class="min-h-0 flex-1">
          <MarkdownView />
        </div>
      </div>

      <!-- Dice sidebar -->
      <div v-if="showDice" class="w-56 shrink-0">
        <DicePanel />
      </div>
    </div>
  </div>
</template>
