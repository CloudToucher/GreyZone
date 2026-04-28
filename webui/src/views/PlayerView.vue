<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import MarkdownView from '../components/MarkdownView.vue'
import StatusBar from '../components/StatusBar.vue'
import PlaygroundEditor from '../components/PlaygroundEditor.vue'
import SafeHouse from '../components/SafeHouse.vue'
import DMFeedback from '../components/DMFeedback.vue'
import DicePanel from '../components/DicePanel.vue'
import CharacterForge from '../components/CharacterForge.vue'
import PlayerHub from './PlayerHub.vue'
import { extractController, parseCharacterSemanticState } from '../lib/charsheet'
import { useWorkspaceStore } from '../stores/workspace'
import { useRoundStore } from '../stores/round'
import { usePlayerStore } from '../stores/players'
import { fetchDiceStats, fetchFile, fetchTree, type DiceStats, type FilePayload, type RoundEvent } from '../lib/api'

const ws = useWorkspaceStore()
const round = useRoundStore()
const ply = usePlayerStore()

type PlayerTab = 'forge' | 'playground' | 'safehouse' | 'dmfeedback' | 'docs' | 'hub'

type ForgeResultSection = {
  title: string
  content: string
}

type PlayerCharacterCard = {
  path: string
  title: string
  payload: FilePayload
  controller: string | null
  semantic: ReturnType<typeof parseCharacterSemanticState>
}

const activeTab = ref<PlayerTab>('hub')
const forgeSideView = ref<'result' | 'log'>('result')
const diceStats = ref<DiceStats | null>(null)
const showDice = ref(false)
const playerCharacters = ref<PlayerCharacterCard[]>([])
const currentCharacterPath = computed(() => ply.currentCharacterPath || null)
const currentCharacter = computed(() => playerCharacters.value.find((c) => c.path === currentCharacterPath.value) || null)

function parseMeta(data?: string): Record<string, unknown> | null {
  if (!data) return null
  try {
    return JSON.parse(data) as Record<string, unknown>
  } catch {
    return null
  }
}

function formatForgeEvent(ev: RoundEvent) {
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
      return '已连接实时日志流'
    case 'building_prompt':
      return '正在整理创角提示词与绑定信息'
    case 'prompt_ready':
      return `提示词已就绪 · ${meta?.promptBytes ?? '?'} bytes`
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

const forgeEngineEvents = computed(() =>
  round.events
    .filter((ev) => ev.type !== 'stdout')
    .slice(-10)
    .map((ev) => ({
      ts: formatTime(ev.ts),
      text: formatForgeEvent(ev),
    })),
)

const forgeWaitingForOutput = computed(() =>
  round.kind === 'forge' &&
  (round.status === 'starting' || round.status === 'running') &&
  !round.output.trim(),
)

const forgeRawLines = computed(() => {
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
  return lines.slice(-120)
})

const forgeSections = computed<ForgeResultSection[]>(() => {
  if (round.kind !== 'forge' || !round.output.trim()) return []
  const result: ForgeResultSection[] = []
  const regex = /^##\s+(.+)$/gm
  const matches = [...round.output.matchAll(regex)]
  for (let i = 0; i < matches.length; i++) {
    const title = matches[i][1].trim()
    const start = (matches[i].index ?? 0) + matches[i][0].length
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? round.output.length) : round.output.length
    const content = round.output.slice(start, end).trim()
    result.push({ title, content })
  }
  return result
})

async function loadPlayerCharacters() {
  try {
    const { tree } = await fetchTree('player')
    const paths: string[] = []
    function walk(nodes: typeof tree.children) {
      for (const n of nodes || []) {
        if (n.type === 'dir') walk(n.children)
        else if (n.path.startsWith('characters/active/') && n.path.toLowerCase().endsWith('.md')) paths.push(n.path)
      }
    }
    walk(tree.children)

    const cards = await Promise.all(
      paths.map(async (path) => {
        const payload = await fetchFile('player', path)
        return {
          path,
          title: path.split('/').pop()?.replace(/\.md$/i, '') || path,
          payload,
          controller: extractController(payload.frontmatter),
          semantic: parseCharacterSemanticState(payload.frontmatter, payload.content),
        } satisfies PlayerCharacterCard
      }),
    )
    playerCharacters.value = cards
    ply.syncFromCharacters(
      cards.map((card) => ({
        path: card.path,
        title: card.semantic.summary?.name || card.title,
        controller: card.controller,
      })),
    )
  } catch {
    playerCharacters.value = []
  }
}

async function focusCurrentPlayerCharacter() {
  await ws.loadTree()
  if (ply.currentCharacterPath) {
    try {
      await ws.openFile(ply.currentCharacterPath)
      return
    } catch {
      /* fall through to home */
    }
  }
  ws.goHome()
}

onMounted(async () => {
  try { diceStats.value = await fetchDiceStats() } catch {}
  await loadPlayerCharacters()
  if (!ws.currentPath && ply.currentCharacterPath) {
    await focusCurrentPlayerCharacter()
  }
})

async function onPlayerChange(e: Event) {
  const name = (e.target as HTMLSelectElement).value
  ply.setPlayer(name)
  await focusCurrentPlayerCharacter()
  if (!ply.currentCharacterPath) {
    activeTab.value = 'hub'
  }
}

// Auto-switch based on round kind
watch(() => round.status, (s) => {
  if (s === 'running' || s === 'starting') {
    activeTab.value = round.kind === 'forge' ? 'forge' : 'dmfeedback'
  }
  if (s === 'done' && round.kind === 'forge' && round.createdCharacterPath) {
    loadPlayerCharacters().then(() => focusCurrentPlayerCharacter())
    activeTab.value = 'forge'
  }
})

// Auto-switch to hub if no file selected
watch(() => ws.currentPath, (p) => {
  if (!p) activeTab.value = 'hub'
  else if (activeTab.value === 'hub') activeTab.value = 'docs'
})

const tabs: { id: PlayerTab; label: string; icon: string; badge?: () => string | number | undefined }[] = [
  { id: 'hub', label: '主控台', icon: '▣' },
  { id: 'forge', label: '创角', icon: '✦' },
  { id: 'playground', label: '行动语义', icon: '◈', badge: () => round.status === 'idle' ? '待命' : undefined },
  { id: 'safehouse', label: '角色资源', icon: '⌂' },
  { id: 'dmfeedback', label: 'DM反馈', icon: '▶', badge: () => round.status === 'running' ? 'LIVE' : round.status === 'done' ? '✓' : undefined },
  { id: 'docs', label: '文档', icon: '▣' },
]
</script>

<template>
  <div class="clash-grid-accent relative flex h-full min-w-0 flex-1 flex-col bg-paper-100">
    <!-- Faint pattern -->
    <div aria-hidden="true" class="pointer-events-none absolute inset-0 opacity-[0.04]"
      style="background-image: repeating-linear-gradient(45deg, #0c0a09 0, #0c0a09 1px, transparent 1px, transparent 22px);" />

    <!-- Tab bar -->
    <div class="clash-toolbar relative z-10 flex items-center justify-between gap-2 px-3 py-1">
      <div class="flex items-stretch gap-0.5">
        <button v-for="t in tabs" :key="t.id" @click="activeTab = t.id"
          class="clash-tab flex items-center gap-1.5 px-3 py-1.5 text-[11px] transition-colors"
          :class="activeTab === t.id
            ? 'active'
            : 'idle'">
          <span class="font-mono text-[11px]">{{ t.icon }}</span>
          {{ t.label }}
          <span v-if="t.badge?.()" class="rounded-sm px-1 py-px font-mono text-[8px] font-bold leading-tight"
            :class="t.badge?.() === 'LIVE' ? 'bg-crimson-600 text-white animate-pulse' : 'bg-white/15 text-white/80'">
            {{ t.badge?.() }}
          </span>
        </button>
      </div>

      <div class="flex items-center gap-2">
        <!-- Player identity -->
        <div class="flex items-center gap-1 rounded-sm border border-white/20 bg-white/10 px-1.5 py-0.5">
          <span class="font-mono text-[9px] uppercase tracking-widest text-white/65">OP</span>
          <select :value="ply.currentName" @change="onPlayerChange"
            class="bg-transparent font-mono text-[10px] font-bold text-white focus:outline-none max-w-[80px]">
            <option v-for="p in ply.roster" :key="p.name" :value="p.name">{{ p.name }}</option>
          </select>
        </div>
        <button @click="showDice = !showDice"
          class="rounded-sm border border-white/20 bg-white/10 px-1.5 py-0.5 font-mono text-[9px] font-bold text-white hover:border-ochre-300 hover:bg-white/15">
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
          <div v-if="currentCharacter" class="clash-panel navy mx-4 mt-4 px-4 py-3">
            <div class="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-paper-500">当前玩家角色界面</div>
            <div class="mt-1 flex flex-wrap items-start justify-between gap-3">
              <div>
                <div class="font-serif text-lg font-bold text-paper-950">{{ currentCharacter.semantic.summary?.name || currentCharacter.title }}</div>
                <div v-if="currentCharacter.semantic.concept" class="mt-1 max-w-3xl text-sm leading-relaxed text-paper-700">{{ currentCharacter.semantic.concept }}</div>
                <div v-if="currentCharacter.semantic.keyRelations.length" class="mt-2 text-sm text-paper-600">
                  <span class="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-500">关键关系</span>
                  <ul class="mt-1 list-disc pl-5 leading-relaxed">
                    <li v-for="(rel, idx) in currentCharacter.semantic.keyRelations.slice(0, 3)" :key="idx">{{ rel }}</li>
                  </ul>
                </div>
              </div>
              <button @click="ws.openFile(currentCharacter.path)"
                class="rounded-sm border border-paper-300 bg-white px-2.5 py-1 font-mono text-[10px] font-bold text-paper-700 hover:border-crimson-600 hover:text-crimson-700">
                打开当前角色档案
              </button>
            </div>
          </div>
          <PlayerHub />
        </div>
        <div v-else-if="activeTab === 'forge'" class="min-h-0 flex-1 flex flex-col">
          <div class="min-h-0 flex flex-1 flex-col xl:flex-row">
            <div class="min-h-0 flex-1 border-b border-paper-200 xl:border-b-0 xl:border-r">
              <CharacterForge />
            </div>
            <div class="min-h-0 w-full xl:w-[38%] bg-paper-100">
              <div class="flex h-full flex-col">
                <div class="clash-card-header px-4 py-3">
                  <div class="flex items-center justify-between gap-2">
                    <div class="font-mono text-[10px] font-bold uppercase tracking-[0.18em]">创角结果</div>
                    <div class="flex items-center gap-1 rounded-sm border border-white/15 bg-white/5 px-1 py-0.5">
                      <button
                        @click="forgeSideView = 'result'"
                        class="rounded-sm px-1.5 py-0.5 font-mono text-[10px]"
                        :class="forgeSideView === 'result' ? 'bg-white text-paper-950' : 'text-white/75 hover:text-white'"
                      >
                        结果
                      </button>
                      <button
                        @click="forgeSideView = 'log'"
                        class="rounded-sm px-1.5 py-0.5 font-mono text-[10px]"
                        :class="forgeSideView === 'log' ? 'bg-white text-paper-950' : 'text-white/75 hover:text-white'"
                      >
                        日志
                      </button>
                    </div>
                  </div>
                  <div class="mt-1 text-sm text-white/75">
                    {{ round.status === 'idle' ? '提交后，这里会展示 DM 为你整理的初始角色结果。' : round.status === 'running' || round.status === 'starting' ? 'DM 正在根据你的设想生成角色...' : round.createdCharacterPath ? `已写入：${round.createdCharacterPath}` : '等待结果...' }}
                  </div>
                </div>
                <div class="min-h-0 flex-1 overflow-y-auto p-4">
                  <div v-if="forgeSideView === 'log'" class="space-y-3">
                    <div class="clash-card p-3">
                      <div class="mb-2 flex items-center justify-between gap-2">
                        <div class="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-paper-700">阶段事件</div>
                        <span v-if="forgeWaitingForOutput" class="font-mono text-[10px] text-ochre-700">等待模型首段输出...</span>
                      </div>
                      <div v-if="forgeEngineEvents.length" class="space-y-1">
                        <div v-for="(entry, idx) in forgeEngineEvents" :key="idx" class="flex gap-2 font-mono text-[11px] leading-relaxed text-paper-700">
                          <span class="shrink-0 text-paper-500">{{ entry.ts }}</span>
                          <span class="shrink-0 text-crimson-600">›</span>
                          <span class="min-w-0">{{ entry.text }}</span>
                        </div>
                      </div>
                      <div v-else class="font-mono text-[11px] text-paper-500">已提交创角请求，等待执行事件...</div>
                    </div>
                    <div class="clash-card p-3">
                      <div class="mb-2 flex items-center justify-between gap-2">
                        <div class="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-paper-700">原始 opencode 输出</div>
                        <span v-if="forgeWaitingForOutput" class="font-mono text-[10px] text-ochre-700">等待模型首段输出...</span>
                      </div>
                      <div v-if="forgeRawLines.length" class="max-h-[24rem] overflow-y-auto rounded-sm bg-paper-100 p-2">
                        <div v-for="(line, idx) in forgeRawLines" :key="idx" class="flex gap-2 font-mono text-[11px] leading-relaxed text-paper-700">
                          <span class="shrink-0 text-paper-500">{{ line.ts }}</span>
                          <span class="shrink-0 font-bold" :class="line.stream === 'ERR' ? 'text-ochre-700' : 'text-forest-700'">{{ line.stream }}</span>
                          <span class="min-w-0 whitespace-pre-wrap break-words">{{ line.text }}</span>
                        </div>
                      </div>
                      <div v-else class="font-mono text-[11px] text-paper-500">还没有收到 stdout/stderr 内容。</div>
                    </div>
                  </div>
                  <template v-else>
                    <div v-if="round.kind === 'forge' && (round.status === 'starting' || round.status === 'running' || forgeEngineEvents.length)"
                    class="clash-card mb-3 p-3">
                      <div class="mb-2 flex items-center justify-between gap-2">
                        <div class="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-paper-700">执行状态</div>
                        <span v-if="forgeWaitingForOutput" class="font-mono text-[10px] text-ochre-700">等待模型首段输出...</span>
                      </div>
                      <div v-if="forgeEngineEvents.length" class="space-y-1">
                        <div v-for="(entry, idx) in forgeEngineEvents" :key="idx" class="flex gap-2 font-mono text-[11px] leading-relaxed text-paper-700">
                          <span class="shrink-0 text-paper-500">{{ entry.ts }}</span>
                          <span class="shrink-0 text-crimson-600">›</span>
                          <span class="min-w-0">{{ entry.text }}</span>
                        </div>
                      </div>
                      <div v-else class="font-mono text-[11px] text-paper-500">已提交创角请求，等待执行事件...</div>
                    </div>
                    <div v-if="forgeSections.length === 0" class="clash-card border-dashed p-4 font-sans text-sm leading-relaxed text-paper-500">
                      这里会按「角色概念 / 初始状态 / 起始装备 / 优势 / 代价与隐患 / 当前处境 / 已写入文件」展示结果。
                    </div>
                    <div v-else class="space-y-3">
                      <section v-for="sec in forgeSections" :key="sec.title" class="clash-card p-3">
                        <div class="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-crimson-700">{{ sec.title }}</div>
                        <pre class="whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-paper-700">{{ sec.content || '（空）' }}</pre>
                      </section>
                    </div>
                  </template>
                </div>
              </div>
            </div>
          </div>
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
