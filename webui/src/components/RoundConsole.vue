<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRoundStore } from '../stores/round'
import { useWorkspaceStore } from '../stores/workspace'

const round = useRoundStore()
const ws = useWorkspaceStore()

const scroller = ref<HTMLElement | null>(null)
const autoScroll = ref(true)

const statusLabel = computed(() => {
  switch (round.status) {
    case 'idle':
      return '空闲'
    case 'starting':
      return '启动中...'
    case 'running':
      return '运行中'
    case 'done':
      return `完成 (exit ${round.exitCode ?? '?'})`
    case 'error':
      return `错误`
  }
  return ''
})

const statusColor = computed(() => {
  switch (round.status) {
    case 'idle':
      return 'bg-paper-400'
    case 'starting':
    case 'running':
      return 'bg-crimson-600'
    case 'done':
      return 'bg-forest-600'
    case 'error':
      return 'bg-ochre-600'
  }
  return 'bg-paper-400'
})

const elapsed = computed(() => {
  if (!round.startedAt) return ''
  const end = round.endedAt ?? Date.now()
  const sec = Math.floor((end - round.startedAt) / 1000)
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
})

watch(
  () => round.events.length,
  () => {
    if (!autoScroll.value) return
    nextTick(() => {
      if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight
    })
  },
)

watch(
  () => round.status,
  (s) => {
    if (s === 'done' || s === 'error') {
      // refresh tree + currently open file (DM may have edited it)
      ws.loadTree()
      if (ws.currentPath) ws.openFile(ws.currentPath).catch(() => {})
    }
  },
)
</script>

<template>
  <div class="flex h-full flex-col bg-white">
    <!-- Header -->
    <div
      class="flex items-center justify-between gap-3 border-b-2 border-paper-950 bg-paper-100 px-3 py-2"
    >
      <div class="flex items-center gap-2">
        <span class="h-2 w-2 rounded-full" :class="statusColor"></span>
        <span class="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-700">
          DM 控制台 · OPENCODE
        </span>
        <span class="font-mono text-[10px] font-bold text-paper-900">
          {{ statusLabel }}
        </span>
        <span v-if="elapsed" class="font-mono text-[10px] text-paper-500">{{ elapsed }}</span>
      </div>
      <div class="flex items-center gap-1">
        <label
          class="flex cursor-pointer items-center gap-1 font-mono text-[10px] text-paper-600"
        >
          <input v-model="autoScroll" type="checkbox" class="accent-crimson-600" />
          自动滚动
        </label>
        <button
          @click="round.reset()"
          class="rounded-sm border border-paper-300 px-1.5 py-0.5 font-mono text-[10px] text-paper-700 hover:border-crimson-600 hover:text-crimson-700"
          :disabled="round.status === 'running' || round.status === 'starting'"
        >
          清屏
        </button>
      </div>
    </div>

    <!-- Body -->
    <div ref="scroller" class="min-h-0 flex-1 overflow-y-auto bg-paper-950 px-3 py-2 font-mono text-[12px] leading-relaxed text-paper-200">
      <template v-if="round.status === 'idle' && !round.output">
        <div class="text-paper-500">
          <span class="text-crimson-400">$</span> 等待玩家提交本轮...
          <div class="mt-2 text-paper-600">
            玩家在 PLAYGROUND 写好行动后点 <span class="text-ochre-400">[ 提交本轮 ]</span>，
            opencode 的实时输出将出现在这里。
          </div>
        </div>
      </template>
      <pre v-else class="whitespace-pre-wrap break-words">{{ round.output || '(等待输出...)' }}</pre>
      <div v-if="round.errorMsg" class="mt-2 rounded border-l-2 border-crimson-500 bg-crimson-900/40 px-2 py-1 text-crimson-200">
        ⚠ {{ round.errorMsg }}
      </div>
    </div>
  </div>
</template>
