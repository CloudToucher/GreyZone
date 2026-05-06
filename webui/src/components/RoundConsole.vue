<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRoundStore } from '../stores/round'
import { useWorkspaceStore } from '../stores/workspace'
import type { RoundEvent } from '../lib/api'

const round = useRoundStore()
const ws = useWorkspaceStore()

const scroller = ref<HTMLElement | null>(null)
const autoScroll = ref(true)
const activeView = ref<'output' | 'log'>('output')

function parseMeta(data?: string): Record<string, unknown> | null {
  if (!data) return null
  try {
    return JSON.parse(data) as Record<string, unknown>
  } catch {
    return null
  }
}

function formatEvent(ev: RoundEvent): string {
  if (ev.type === 'start') return ev.data || '已发送 opencode 命令'
  if (ev.type === 'stderr') return (ev.data || '').trim() || 'stderr 输出'
  if (ev.type === 'error') return ev.data || '发生错误'
  if (ev.type === 'end') return `进程结束 · exit ${ev.code ?? '?'}`
  if (ev.type !== 'meta') return ev.data || ev.type

  const meta = parseMeta(ev.data)
  const phase = typeof meta?.phase === 'string' ? meta.phase : ''
  switch (phase) {
    case 'round_created':
      return `已创建回合 ${String(meta?.roundId || '').slice(0, 8)}`
    case 'stream_open':
      return '已连接执行记录流'
    case 'building_prompt':
      return '正在整理提示词与上下文'
    case 'prompt_ready':
      return `提示词已就绪 · ${meta?.promptBytes ?? '?'} bytes · ${meta?.model ?? 'model ?'}`
    case 'spawning':
      return `准备启动 ${meta?.command || 'opencode'}`
    case 'spawned':
      return `opencode 已启动 · PID ${meta?.pid ?? '?'} · ${meta?.model ?? 'model ?'}`
    default:
      return ev.data || 'meta'
  }
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

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

const engineEvents = computed(() =>
  round.events
    .filter((ev) => ev.type !== 'stdout')
    .slice(-14)
    .map((ev) => ({
      ts: formatTime(ev.ts),
      text: formatEvent(ev),
    })),
)

const waitingForFirstOutput = computed(() =>
  (round.status === 'starting' || round.status === 'running') && !round.output.trim(),
)

const rawLines = computed(() => {
  const lines: { ts: string; stream: string; text: string }[] = []
  for (const ev of round.events) {
    if (ev.type === 'stdout' || ev.type === 'stderr') {
      const parts = (ev.data || '').split(/\r?\n/)
      for (const part of parts) {
        const text = part.trimEnd()
        if (!text.trim()) continue
        lines.push({
          ts: formatTime(ev.ts),
          stream: ev.type === 'stdout' ? 'OUT' : 'ERR',
          text,
        })
      }
    }
  }
  return lines.slice(-160)
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
        <div class="mr-1 flex items-center gap-1 rounded-sm border border-paper-300 bg-white px-1 py-0.5">
          <button
            @click="activeView = 'output'"
            class="rounded-sm px-1.5 py-0.5 font-mono text-[10px]"
            :class="activeView === 'output' ? 'bg-paper-950 text-white' : 'text-paper-600 hover:text-paper-950'"
          >
            主回复
          </button>
          <button
            @click="activeView = 'log'"
            class="rounded-sm px-1.5 py-0.5 font-mono text-[10px]"
            :class="activeView === 'log' ? 'bg-paper-950 text-white' : 'text-paper-600 hover:text-paper-950'"
          >
            执行记录
          </button>
        </div>
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
            玩家在行动语义板写好行动后点 <span class="text-ochre-400">[ 提交本轮 ]</span>，
            opencode 的实时输出将出现在这里。
          </div>
        </div>
      </template>
      <div v-else-if="activeView === 'output'" class="space-y-3">
        <div v-if="waitingForFirstOutput" class="rounded-sm border border-white/10 bg-paper-900/80 p-2">
          <div class="mb-2 flex items-center justify-between gap-2">
            <span class="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-400">执行状态</span>
            <span class="font-mono text-[10px] text-ochre-300">等待模型首段输出...</span>
          </div>
          <div v-if="engineEvents.length" class="space-y-1">
            <div v-for="(entry, idx) in engineEvents" :key="idx" class="flex gap-2 font-mono text-[11px] leading-relaxed">
              <span class="shrink-0 text-paper-500">{{ entry.ts }}</span>
              <span class="shrink-0 text-crimson-300">›</span>
              <span class="min-w-0 text-paper-200">{{ entry.text }}</span>
            </div>
          </div>
          <div v-else class="font-mono text-[11px] text-paper-500">尚未收到执行事件。</div>
        </div>
        <pre class="whitespace-pre-wrap break-words">{{ round.output || '(等待输出...)' }}</pre>
      </div>
      <div v-else class="space-y-3">
        <div class="rounded-sm border border-white/10 bg-paper-900/80 p-2">
          <div class="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-400">阶段事件</div>
          <div v-if="engineEvents.length" class="space-y-1">
            <div v-for="(entry, idx) in engineEvents" :key="idx" class="flex gap-2 font-mono text-[11px] leading-relaxed">
              <span class="shrink-0 text-paper-500">{{ entry.ts }}</span>
              <span class="shrink-0 text-crimson-300">›</span>
              <span class="min-w-0 text-paper-200">{{ entry.text }}</span>
            </div>
          </div>
          <div v-else class="font-mono text-[11px] text-paper-500">尚未收到执行事件。</div>
        </div>
        <div class="rounded-sm border border-white/10 bg-paper-900/80 p-2">
          <div class="mb-2 flex items-center justify-between gap-2">
            <span class="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-400">原始 opencode 输出</span>
            <span v-if="waitingForFirstOutput" class="font-mono text-[10px] text-ochre-300">等待模型首段输出...</span>
          </div>
          <div v-if="rawLines.length" class="max-h-[24rem] overflow-y-auto rounded-sm bg-paper-950/70 p-2">
            <div
              v-for="(line, idx) in rawLines"
              :key="idx"
              class="flex gap-2 font-mono text-[11px] leading-relaxed"
            >
              <span class="shrink-0 text-paper-500">{{ line.ts }}</span>
              <span
                class="shrink-0 font-bold"
                :class="line.stream === 'ERR' ? 'text-ochre-300' : 'text-forest-300'"
              >
                {{ line.stream }}
              </span>
              <span class="min-w-0 whitespace-pre-wrap break-words text-paper-200">{{ line.text }}</span>
            </div>
          </div>
          <div v-else class="font-mono text-[11px] text-paper-500">还没有收到 stdout/stderr 内容。</div>
        </div>
      </div>
      <div v-if="round.errorMsg" class="mt-2 rounded border-l-2 border-crimson-500 bg-crimson-900/40 px-2 py-1 text-crimson-200">
        ⚠ {{ round.errorMsg }}
      </div>
    </div>
  </div>
</template>
