<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRoundStore } from '../stores/round'
import { useWorkspaceStore } from '../stores/workspace'
import type { RoundEvent } from '../lib/api'

const round = useRoundStore()
const ws = useWorkspaceStore()

const scroller = ref<HTMLElement | null>(null)
const autoScroll = ref(true)
const activeView = ref<'result' | 'log'>('result')

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
      return '正在整理提示词、角色卡和共享板上下文'
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

const statusText = computed(() => {
  const latest = latestEngineEvent.value
  switch (round.status) {
    case 'idle': return '等待玩家提交本轮...'
    case 'starting': return latest || '正在启动 opencode...'
    case 'running': return latest || 'DM 研判进行中'
    case 'done': return `本轮结束 · 退出码 ${round.exitCode ?? '?'}`
    case 'error': return `错误：${round.errorMsg || '未知'}`
  }
})

const elapsed = computed(() => {
  if (!round.startedAt) return ''
  const end = round.endedAt ?? Date.now()
  const s = Math.floor((end - round.startedAt) / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
})

// Parse DM output into protocol-oriented blocks
interface OutputBlock {
  type: 'header' | 'scene' | 'rule' | 'dice' | 'update' | 'text'
  content: string
  file?: string
}

const SECTION_TYPES: Record<string, OutputBlock['type']> = {
  '场景推进': 'scene',
  'Scene Progression': 'scene',
  '裁定': 'rule',
  'Rulings': 'rule',
  '状态变化': 'update',
  'Confirmed Changes': 'update',
  '新信息': 'text',
  'New Information': 'text',
  '后续可选方向': 'text',
  'Next Directions': 'text',
}

const blocks = computed<OutputBlock[]>(() => {
  const text = round.output
  if (!text) return []

  const lines = text.split('\n')
  const result: OutputBlock[] = []
  let currentTitle = ''
  let currentLines: string[] = []

  const flush = () => {
    if (!currentTitle && currentLines.length === 0) return
    if (currentTitle) {
      result.push({ type: 'header', content: currentTitle })
    }
    const content = currentLines.join('\n').trim()
    if (content) {
      const mapped = SECTION_TYPES[currentTitle]
      if (mapped) {
        result.push({ type: mapped, content })
      } else {
        for (const l of content.split('\n')) {
          if (!l.trim()) continue
          if (l.match(/d100|d10|d8|d6|d4/i) && l.match(/\d+/)) result.push({ type: 'dice', content: l })
          else result.push({ type: 'text', content: l })
        }
      }
    }
    currentLines = []
  }

  for (const line of lines) {
    const m = line.match(/^##\s+(.+)/)
    if (m) {
      flush()
      currentTitle = m[1].trim()
      continue
    }
    currentLines.push(line)
  }
  flush()

  if (result.length > 0) return result

  for (const l of lines) {
    if (!l.trim()) continue
    if (l.startsWith('##') || l.startsWith('###')) {
      result.push({ type: 'header', content: l.replace(/^#+\s*/, '') })
    } else if (l.match(/d100|d10|d8|d6|d4/i) && l.match(/\d+/)) {
      result.push({ type: 'dice', content: l })
    } else if (l.match(/HP|SP|AP|生命|体力/) && l.match(/\d+/)) {
      result.push({ type: 'update', content: l })
    } else if (l.match(/判定|检定|裁决|规则/i)) {
      result.push({ type: 'rule', content: l })
    } else if (l.match(/^[>]/)) {
      result.push({ type: 'scene', content: l.replace(/^>\s*/, '') })
    } else {
      const last = result[result.length - 1]
      if (last && last.type === 'text') last.content += '\n' + l
      else result.push({ type: 'text', content: l })
    }
  }
  return result
})

const engineEvents = computed(() =>
  round.events
    .filter((ev) => ev.type !== 'stdout')
    .slice(-14)
    .map((ev) => ({
      ts: formatTime(ev.ts),
      type: ev.type,
      text: formatEvent(ev),
    })),
)

const latestEngineEvent = computed(() => engineEvents.value[engineEvents.value.length - 1]?.text || '')

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

const classBy = (t: OutputBlock['type']) => {
  switch (t) {
    case 'header': return 'text-paper-950 font-bold text-[13px] border-l-2 border-crimson-600 pl-2'
    case 'scene': return 'text-navy-800 italic bg-navy-50/50 px-2 py-1 rounded-sm'
    case 'dice': return 'text-ochre-700 font-mono bg-ochre-50 px-2 py-1 rounded-sm border-l border-ochre-400'
    case 'update': return 'text-forest-700 font-mono bg-forest-50 px-2 py-1 rounded-sm border-l border-forest-400'
    case 'rule': return 'text-navy-700 font-mono bg-paper-100 px-2 py-1 rounded-sm'
    default: return 'text-paper-800'
  }
}

watch(() => round.events.length, () => {
  if (!autoScroll.value) return
  nextTick(() => { if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight })
})

watch(() => round.status, (s) => {
  if (round.kind === 'forge') return
  if (s === 'done' || s === 'error') { ws.loadTree(); if (ws.currentPath) ws.openFile(ws.currentPath).catch(() => {}) }
})
</script>

<template>
  <div class="flex h-full flex-col bg-white">
    <!-- Header -->
    <div class="flex flex-wrap items-center justify-between gap-2 border-b-2 border-paper-950 bg-paper-100 px-3 py-2">
      <div class="flex items-center gap-2">
        <span class="h-2 w-2 rounded-full"
          :class="round.status === 'running' || round.status === 'starting' ? 'bg-crimson-600 animate-pulse' : round.status === 'done' ? 'bg-forest-600' : round.status === 'error' ? 'bg-ochre-600' : 'bg-paper-400'" />
        <span class="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-700">DM 回复</span>
        <span class="font-mono text-[10px] font-bold"
          :class="round.status === 'done' ? 'text-forest-700' : round.status === 'error' ? 'text-ochre-700' : 'text-paper-600'">
          {{ statusText }}
        </span>
        <span v-if="elapsed" class="font-mono text-[10px] text-paper-500">{{ elapsed }}</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="mr-1 flex items-center gap-1 rounded-sm border border-paper-300 bg-white px-1 py-0.5">
          <button
            @click="activeView = 'result'"
            class="rounded-sm px-1.5 py-0.5 font-mono text-[10px]"
            :class="activeView === 'result' ? 'bg-paper-950 text-white' : 'text-paper-600 hover:text-paper-950'"
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
        <label class="flex items-center gap-1 font-mono text-[10px] text-paper-600 cursor-pointer">
          <input v-model="autoScroll" type="checkbox" class="accent-crimson-600" /> 自动滚动
        </label>
        <button @click="round.reset()" :disabled="round.status === 'running' || round.status === 'starting'"
          class="rounded-sm border border-paper-300 px-1.5 py-0.5 font-mono text-[10px] text-paper-700 hover:border-crimson-600 hover:text-crimson-700 disabled:opacity-40">
          清屏
        </button>
      </div>
    </div>

    <!-- Body -->
    <div ref="scroller" class="min-h-0 flex-1 overflow-y-auto bg-paper-950 p-3">
      <template v-if="round.status === 'idle' && !round.output">
        <div class="flex flex-col items-center gap-2 py-8">
          <div class="font-mono text-2xl text-paper-700">◆</div>
          <div class="font-mono text-xs text-paper-500">提交本轮后，DM 回复会显示在这里</div>
          <div class="font-mono text-[10px] text-paper-600">包括：场景叙事 · 检定结果 · 状态变更 · 骰池消耗</div>
        </div>
      </template>
      <div v-else-if="activeView === 'result'" class="space-y-2 font-sans text-[12px] leading-relaxed">
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

        <div v-for="(b, i) in blocks" :key="i" :class="[classBy(b.type), 'px-2 py-1 rounded-sm']"
          :style="{ color: b.type === 'text' ? '#cbd5e1' : undefined }">
          <span class="font-mono text-[9px] text-paper-600 mr-1" v-if="b.type !== 'text'">
            {{ b.type === 'header' ? '§' : b.type === 'dice' ? '⚄' : b.type === 'update' ? '↻' : b.type === 'rule' ? '⚖' : b.type === 'scene' ? '▸' : '' }}
          </span>
          {{ b.content }}
        </div>
      </div>
      <div v-else class="space-y-2 font-sans text-[12px] leading-relaxed">
        <div class="rounded-sm border border-white/10 bg-paper-900/80 p-2">
          <div class="mb-2 flex items-center justify-between gap-2">
            <span class="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-400">阶段事件</span>
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
      <div v-if="round.errorMsg" class="mt-2 rounded border-l-2 border-crimson-500 bg-crimson-900/40 px-2 py-1 font-mono text-[11px] text-crimson-200">
        ⚠ {{ round.errorMsg }}
      </div>
    </div>
  </div>
</template>
