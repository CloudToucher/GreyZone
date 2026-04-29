<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { fetchDiceStats, generateDicePool, type DiceStats } from '../lib/api'
import { useRoundStore } from '../stores/round'
import { useWorkspaceStore } from '../stores/workspace'

const ws = useWorkspaceStore()
const round = useRoundStore()

const stats = ref<DiceStats | null>(null)
const loading = ref(false)
const generating = ref(false)
const err = ref<string | null>(null)

const DIE_COLORS: Record<string, string> = {
  d100: '#dc2626',
  d10: '#0f172a',
  d8: '#ca8a04',
  d6: '#15803d',
  d4: '#4b5563',
}
const DIE_ORDER = ['d100', 'd10', 'd8', 'd6', 'd4']

const hasPool = ref(false)

async function load() {
  loading.value = true
  err.value = null
  try {
    stats.value = await fetchDiceStats()
    hasPool.value = !!stats.value && stats.value.total > 0
  } catch (e: any) {
    err.value = e?.message || String(e)
  } finally {
    loading.value = false
  }
}

async function regenerate() {
  if (ws.panel !== 'dm') return
  generating.value = true
  err.value = null
  try {
    const { stats: fresh } = await generateDicePool()
    stats.value = fresh
    hasPool.value = !!fresh && fresh.total > 0
  } catch (e: any) {
    err.value = e?.message || String(e)
  } finally {
    generating.value = false
  }
}

// Reload when a round finishes (DM may have consumed dice)
onMounted(load)

function refresh() {
  load()
}
</script>

<template>
  <div class="flex h-full flex-col bg-white">
    <!-- Header -->
    <div
      class="flex items-center justify-between gap-2 border-b border-paper-300 bg-paper-100 px-3 py-2"
    >
      <div class="flex items-center gap-2">
        <span class="h-1.5 w-1.5 rounded-full bg-crimson-600"></span>
        <span class="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-700">
          骰池
        </span>
        <span
          v-if="stats"
          class="rounded-sm bg-paper-950 px-1.5 py-0.5 font-mono text-[9px] font-bold text-ochre-400"
        >
          {{ stats.total }} 剩余
        </span>
        <span v-if="stats?.generatedAt" class="font-mono text-[9px] text-paper-500">
          {{ stats.generatedAt }}
        </span>
      </div>
      <div class="flex items-center gap-1">
        <button
          @click="refresh"
          :disabled="loading"
          class="rounded-sm border border-paper-300 px-1.5 py-0.5 font-mono text-[10px] text-paper-700 hover:border-crimson-600 hover:text-crimson-700 disabled:opacity-40"
          title="刷新计数"
        >
          ↻
        </button>
        <button
          v-if="ws.panel === 'dm'"
          @click="regenerate"
          :disabled="generating || round.status === 'running'"
          class="rounded-sm border-2 border-paper-950 bg-paper-950 px-2 py-0.5 font-mono text-[10px] font-bold text-white hover:bg-crimson-600 disabled:opacity-40"
          title="重新切骰 — 用 python tools/dice_pool.py -o"
        >
          {{ generating ? '切骰中...' : '重新切骰' }}
        </button>
      </div>
    </div>

    <!-- Body -->
    <div class="min-h-0 flex-1 overflow-y-auto p-3">
      <div v-if="loading" class="font-mono text-xs text-paper-500">加载中...</div>
      <div v-else-if="err" class="font-mono text-xs text-crimson-700">{{ err }}</div>
      <div v-else-if="!hasPool" class="font-mono text-xs text-paper-500">
        <span class="text-ochre-600">⚠</span> 无骰池。
        <button
          v-if="ws.panel === 'dm'"
          @click="regenerate"
          class="font-bold text-crimson-700 underline"
        >
          点此生成
        </button>
      </div>
      <div v-else class="space-y-3">
        <!-- Per-die bar -->
        <div
          v-for="die in DIE_ORDER.filter((d) => stats?.dice?.[d])"
          :key="die"
          class="space-y-1"
        >
          <div class="flex items-center justify-between">
            <span
              class="flex items-center gap-1.5 font-mono text-[11px] font-bold"
              :style="{ color: DIE_COLORS[die] }"
            >
              <span
                class="inline-block h-2 w-2 rounded-sm"
                :style="{ background: DIE_COLORS[die] }"
              ></span>
              {{ die }}
            </span>
            <span class="font-mono text-[11px] font-bold text-paper-900">
              {{ stats!.dice[die] }}
            </span>
          </div>
          <div class="h-1.5 w-full overflow-hidden rounded-sm bg-paper-200">
            <div
              class="h-full"
              :style="{
                width: Math.max(2, ((stats!.dice[die] || 1) / (stats!.dice.d100 || 50)) * 100) + '%',
                background: DIE_COLORS[die],
              }"
            ></div>
          </div>
          <!-- Next N values preview -->
          <div class="flex flex-wrap gap-0.5 pt-0.5">
            <span
              v-for="(v, i) in (stats?.raw[die] || []).slice(0, 8)"
              :key="i"
              class="rounded-sm font-mono text-[9px] px-1 py-px tracking-wider"
              :class="i === 0 ? 'font-bold' : ''"
              :style="{
                background: `${DIE_COLORS[die]}12`,
                color: DIE_COLORS[die],
                border: `1px solid ${DIE_COLORS[die]}30`,
                opacity: i === 0 ? 1 : 0.65,
              }"
            >
              {{ v }}
            </span>
            <span v-if="(stats?.raw[die] || []).length > 8" class="font-mono text-[9px] text-paper-400 self-center">
              +{{ (stats!.raw[die] || []).length - 8 }} 个
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
