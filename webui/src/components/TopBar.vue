<script setup lang="ts">
import { computed, ref } from 'vue'
import { useWorkspaceStore, type Panel } from '../stores/workspace'
import type { OpencodeProbeResult } from '../lib/api'

const ws = useWorkspaceStore()
const probing = ref(false)
const probeError = ref<string | null>(null)
const probeResult = ref<OpencodeProbeResult | null>(null)

const tabs: { id: Panel; label: string; sub: string; accent: string }[] = [
  { id: 'dm', label: 'DM 视图', sub: 'GAME MASTER', accent: 'navy' },
  { id: 'player', label: '角色视图', sub: 'OPERATOR', accent: 'crimson' },
]

const breadcrumb = computed(() => {
  if (!ws.currentPath) return []
  return ws.currentPath.split('/')
})

function switchPanel(p: Panel) {
  ws.setPanel(p)
}

function goHome() {
  if (ws.panel !== 'player') return
  ws.goHome()
}

async function runProbe() {
  probing.value = true
  probeError.value = '请先进入房间，再从房间顶部栏运行 opencode 自检'
  probeResult.value = null
  probing.value = false
}

const probeLabel = computed(() => {
  if (probing.value) return '检测中...'
  if (probeError.value) return 'FAIL'
  if (probeResult.value?.ok) return 'OK'
  return '自检'
})
</script>

<template>
  <header
    class="relative flex items-center justify-between gap-6 border-b-2 border-paper-950 bg-white px-6 py-3"
  >
    <!-- Brand (clickable on player panel = go home) -->
    <button
      @click="goHome"
      class="group flex items-center gap-3 text-left"
      :class="ws.panel === 'player' ? 'cursor-pointer' : 'cursor-default'"
      :disabled="ws.panel !== 'player'"
    >
      <div
        class="flex h-10 w-10 items-center justify-center rounded-sm bg-crimson-600 font-mono text-sm font-black text-white shadow-card transition group-hover:bg-crimson-700"
      >
        GZ
      </div>
      <div class="leading-tight">
        <div class="font-serif text-lg font-bold text-paper-950 tracking-tight">
          灰区<span class="text-crimson-600">：</span>撤离
        </div>
        <div class="font-mono text-[10px] uppercase tracking-[0.2em] text-paper-500">
          <template v-if="ws.panel === 'player'">
            <span class="group-hover:text-crimson-600">◂ HOME</span> · BRIEFING ROOM
          </template>
          <template v-else>GRAY ZONE / EXTRACTION · v0.0.1</template>
        </div>
      </div>
    </button>

    <!-- Tabs -->
    <nav class="flex items-stretch overflow-hidden rounded-sm border-2 border-paper-950">
      <button
        v-for="t in tabs"
        :key="t.id"
        @click="switchPanel(t.id)"
        class="group relative flex items-center gap-2.5 px-5 py-2 text-sm transition-colors"
        :class="[
          ws.panel === t.id
            ? t.accent === 'navy'
              ? 'bg-navy-800 text-white'
              : 'bg-crimson-600 text-white'
            : 'bg-white text-paper-700 hover:bg-paper-100',
          t.id !== tabs[tabs.length - 1].id ? 'border-r-2 border-paper-950' : '',
        ]"
      >
        <span
          class="inline-block h-2 w-2 rounded-full"
          :class="
            ws.panel === t.id
              ? 'bg-white shadow-[0_0_0_2px_rgba(255,255,255,0.25)]'
              : t.accent === 'navy'
              ? 'bg-navy-800'
              : 'bg-crimson-600'
          "
        />
        <span class="font-bold">{{ t.label }}</span>
        <span
          class="font-mono text-[10px] tracking-[0.15em]"
          :class="ws.panel === t.id ? 'text-white/70' : 'text-paper-500'"
        >
          {{ t.sub }}
        </span>
      </button>
    </nav>

    <div class="flex min-w-0 max-w-[40%] items-center gap-3">
      <!-- Breadcrumb -->
      <div class="flex min-w-0 flex-1 items-center gap-1 truncate font-mono text-xs">
        <span v-if="!breadcrumb.length" class="text-paper-500">— 未选择文件 —</span>
        <template v-else>
          <span
            v-for="(seg, i) in breadcrumb"
            :key="i"
            class="truncate"
            :class="
              i === breadcrumb.length - 1
                ? 'font-bold text-crimson-700'
                : 'text-paper-600'
            "
          >
            {{ seg }}<span v-if="i < breadcrumb.length - 1" class="px-1 text-paper-400">/</span>
          </span>
        </template>
      </div>

      <div class="flex shrink-0 items-center gap-2">
        <button
          @click="runProbe"
          :disabled="probing"
          class="rounded-sm border border-paper-300 bg-white px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em] transition hover:border-crimson-600 hover:text-crimson-700 disabled:opacity-50"
        >
          opencode {{ probeLabel }}
        </button>
        <span
          v-if="probeResult?.ok"
          class="rounded-sm bg-forest-600 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white"
        >
          {{ probeResult.stdout.includes('OK') ? 'OK' : 'PASS' }}
        </span>
        <span
          v-else-if="probeError"
          class="rounded-sm bg-crimson-600 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white"
        >
          FAIL
        </span>
      </div>
    </div>

    <!-- Crimson accent strip -->
    <div class="absolute inset-x-0 -bottom-0.5 h-0.5 bg-crimson-600" />
  </header>
</template>
