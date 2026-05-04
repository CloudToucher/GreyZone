<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { AgentRunSummary, FilePayload, OpencodeProbeResult, RoomSnapshot, SessionCredentials, VisibleRoundState } from '@/lib/api'
import RenderedMarkdown from './RenderedMarkdown.vue'

const props = defineProps<{
  session: SessionCredentials
  snapshot: RoomSnapshot
  busy: boolean
  round: VisibleRoundState | null
  currentPacket: { roundId: string; packetPath: string; resultPath: string; seatNames: string[] } | null
  previewFile: FilePayload | null
  probeBusy: boolean
  probeResult: OpencodeProbeResult | null
  probeError: string | null
  probeCheckedAt: string | null
  programLogs: Array<{ ts: number; level: 'info' | 'ok' | 'warn' | 'error'; message: string; detail?: string }>
}>()

const emit = defineEmits<{
  compose: [payload: { seatNames: string[]; note?: string }]
  runAction: [roundId: string]
  assign: [payload: { characterPath: string; primarySeat: string | null; dmHosted: boolean; requireAccept?: boolean }]
  releaseSeat: [seatName: string]
  openFile: [path: string]
  probe: []
}>()

const opsView = ref<'agents' | 'queue' | 'probe' | 'program' | 'timeline'>('agents')
const nowTick = ref(Date.now())
let monitorTimer: ReturnType<typeof setInterval> | null = null

const statusText: Record<string, string> = {
  idle: '待行动',
  ready: '草稿',
  submitted: '已提交',
  locked: 'AI 处理中',
  waiting: '等待处理',
  composing: '已生成回合包',
  running: '运行中',
  done: '完成',
  error: '错误',
  validating: '解析中',
  stale: '可能卡住',
}

onMounted(() => {
  monitorTimer = setInterval(() => {
    nowTick.value = Date.now()
  }, 2000)
})

onBeforeUnmount(() => {
  if (monitorTimer) clearInterval(monitorTimer)
})

const agentRuns = computed(() => props.snapshot.agentRuns || [])
const runningCount = computed(() => agentRuns.value.filter((run) => run.status === 'running' || run.status === 'validating').length)
const waitingCount = computed(() => agentRuns.value.filter((run) => run.status === 'waiting').length)
const unhealthyCount = computed(() => agentRuns.value.filter((run) => run.status === 'error' || run.stale).length)
const latestDone = computed(() => agentRuns.value.find((run) => run.status === 'done' && run.durationMs != null))

function formatMs(ms: number | null | undefined) {
  if (ms == null) return '未开始'
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return minutes ? `${minutes}分${rest.toString().padStart(2, '0')}秒` : `${rest}秒`
}

function elapsedFor(run: AgentRunSummary) {
  if (run.endedAt) return formatMs(run.durationMs ?? run.elapsedMs)
  const start = new Date(run.startedAt || run.createdAt).getTime()
  if (Number.isNaN(start)) return formatMs(run.elapsedMs)
  return formatMs(nowTick.value - start)
}

function runTone(run: AgentRunSummary) {
  if (run.stale || run.status === 'stale') return 'border-ochre-400 bg-ochre-50'
  if (run.status === 'error') return 'border-crimson-300 bg-crimson-50'
  if (run.status === 'done') return 'border-forest-300 bg-forest-50'
  if (run.status === 'running' || run.status === 'validating') return 'border-navy-300 bg-navy-50'
  return 'border-paper-300 bg-paper-100'
}

function artifactPath(run: AgentRunSummary, name: string) {
  return run.artifacts?.[name] || ''
}

function artifactLabel(run: AgentRunSummary, name: string) {
  const stat = run.artifactStats.find((entry) => entry.name === name)
  if (!stat) return name
  return `${name} ${stat.exists ? `${stat.size}B` : 'missing'}`
}

const probeStatusLabel = computed(() => {
  if (props.probeBusy) return '自检中'
  if (props.probeResult?.ok) return '可用'
  if (props.probeError || props.probeResult) return '失败'
  return '未自检'
})

const probeStatusTone = computed(() => {
  if (props.probeBusy) return 'text-ochre-700'
  if (props.probeResult?.ok) return 'text-forest-700'
  if (props.probeError || props.probeResult) return 'text-crimson-700'
  return 'text-paper-700'
})

const probeLines = computed(() => {
  const result = props.probeResult
  const lines: Array<{ label: string; value: string }> = [{ label: '状态', value: probeStatusLabel.value }]
  if (result?.model) lines.push({ label: '模型', value: result.model })
  if (result?.command) lines.push({ label: '命令', value: result.command })
  if (result?.durationMs != null) lines.push({ label: '耗时', value: `${result.durationMs}ms` })
  if (result?.xdgConfigHome) lines.push({ label: 'XDG_CONFIG_HOME', value: result.xdgConfigHome })
  if (props.probeCheckedAt) lines.push({ label: '自检时间', value: new Date(props.probeCheckedAt).toLocaleString('zh-CN', { hour12: false }) })
  if (result?.timedOut) lines.push({ label: '超时', value: '是' })
  if (result?.code != null) lines.push({ label: '退出码', value: String(result.code) })
  if (result?.diagnosis) lines.push({ label: '诊断', value: result.diagnosis })
  return lines
})

function levelTone(level: 'info' | 'ok' | 'warn' | 'error') {
  if (level === 'ok') return 'text-forest-700'
  if (level === 'warn') return 'text-ochre-700'
  if (level === 'error') return 'text-crimson-700'
  return 'text-paper-700'
}

function retryQueueItem(id: string) {
  if (props.busy) return
  if (id === 'submitted-intents') {
    emit('compose', { seatNames: [], note: 'AI 监控台手动重试：处理当前已提交意图。' })
    return
  }
  emit('runAction', id)
}
</script>

<template>
  <div class="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
    <section class="space-y-4">
      <div class="clash-card overflow-hidden border-2 border-navy-800">
        <div class="clash-card-header px-4 py-3">
          <div class="font-mono text-[10px] font-bold tracking-[0.18em]">AI 监控台</div>
          <div class="mt-1 text-sm text-white/85">这里只观察 AI DM 的后台状态、队列、日志和归档；不选择玩家、不裁定场景。</div>
        </div>
        <div class="grid gap-3 p-4 md:grid-cols-4">
          <div class="data-card">
            <div class="data-card-label"><span class="h-1 w-3 bg-navy-800"></span>运行中</div>
            <div class="data-card-value !text-2xl">{{ runningCount }}</div>
            <div class="data-card-foot">Agent 正在处理</div>
          </div>
          <div class="data-card">
            <div class="data-card-label"><span class="h-1 w-3 bg-ochre-600"></span>等待中</div>
            <div class="data-card-value !text-2xl">{{ waitingCount }}</div>
            <div class="data-card-foot">排队等待写锁/调度</div>
          </div>
          <div class="data-card">
            <div class="data-card-label"><span class="h-1 w-3 bg-crimson-600"></span>异常</div>
            <div class="data-card-value !text-2xl">{{ unhealthyCount }}</div>
            <div class="data-card-foot">错误或可能卡住</div>
          </div>
          <div class="data-card">
            <div class="data-card-label"><span class="h-1 w-3 bg-forest-700"></span>最近完成</div>
            <div class="data-card-value !text-2xl">{{ latestDone ? formatMs(latestDone.durationMs) : '-' }}</div>
            <div class="data-card-foot">{{ latestDone?.title || '暂无完成任务' }}</div>
          </div>
        </div>
      </div>

      <div class="clash-card overflow-hidden">
        <div class="clash-card-header px-4 py-3">
          <div class="font-mono text-[10px] font-bold tracking-[0.18em]">处理队列</div>
        </div>
        <div class="space-y-3 p-4">
          <article v-for="run in agentRuns" :key="run.id" class="rounded-sm border p-3" :class="runTone(run)">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div class="font-serif text-base font-bold text-paper-950">{{ run.title }}</div>
                <div class="mt-1 font-mono text-[10px] tracking-[0.14em] text-paper-700">
                  {{ run.id }} · {{ run.agentName }} · {{ run.currentStep }}
                </div>
              </div>
              <div class="shrink-0 text-right font-mono text-[10px] leading-5 text-paper-800">
                <div>{{ run.stale ? '可能卡住' : (statusText[run.status] || run.status) }}</div>
                <div>{{ elapsedFor(run) }}</div>
              </div>
            </div>
            <div class="mt-2 text-sm leading-6 text-paper-800">
              席位：{{ run.participantSeats.join(', ') || '未记录' }}<br>
              角色：{{ run.participantCharacters.map((character) => `${character.name}@${character.sceneId}`).join('、') || '未记录' }}<br>
              开始：{{ run.startedAt ? new Date(run.startedAt).toLocaleString('zh-CN', { hour12: false }) : '未开始' }} ·
              最后事件：{{ run.lastEventAt ? new Date(run.lastEventAt).toLocaleTimeString('zh-CN', { hour12: false }) : '暂无' }}
            </div>
            <div class="mt-3 flex flex-wrap gap-2">
              <button v-if="artifactPath(run, 'packet')" @click="emit('openFile', artifactPath(run, 'packet'))" class="rounded-sm border border-paper-300 bg-white px-2 py-1 font-mono text-[10px] font-bold tracking-[0.12em] text-paper-800">{{ artifactLabel(run, 'packet') }}</button>
              <button v-if="artifactPath(run, 'prompt')" @click="emit('openFile', artifactPath(run, 'prompt'))" class="rounded-sm border border-paper-300 bg-white px-2 py-1 font-mono text-[10px] font-bold tracking-[0.12em] text-paper-800">{{ artifactLabel(run, 'prompt') }}</button>
              <button v-if="artifactPath(run, 'rawResult')" @click="emit('openFile', artifactPath(run, 'rawResult'))" class="rounded-sm border border-paper-300 bg-white px-2 py-1 font-mono text-[10px] font-bold tracking-[0.12em] text-paper-800">{{ artifactLabel(run, 'rawResult') }}</button>
              <button v-if="artifactPath(run, 'parsedResult')" @click="emit('openFile', artifactPath(run, 'parsedResult'))" class="rounded-sm border border-paper-300 bg-white px-2 py-1 font-mono text-[10px] font-bold tracking-[0.12em] text-paper-800">{{ artifactLabel(run, 'parsedResult') }}</button>
              <button v-if="artifactPath(run, 'stdout')" @click="emit('openFile', artifactPath(run, 'stdout'))" class="rounded-sm border border-paper-300 bg-white px-2 py-1 font-mono text-[10px] font-bold tracking-[0.12em] text-paper-800">{{ artifactLabel(run, 'stdout') }}</button>
              <button v-if="artifactPath(run, 'stderr')" @click="emit('openFile', artifactPath(run, 'stderr'))" class="rounded-sm border border-paper-300 bg-white px-2 py-1 font-mono text-[10px] font-bold tracking-[0.12em] text-paper-800">{{ artifactLabel(run, 'stderr') }}</button>
              <button v-if="artifactPath(run, 'events')" @click="emit('openFile', artifactPath(run, 'events'))" class="rounded-sm border border-paper-300 bg-white px-2 py-1 font-mono text-[10px] font-bold tracking-[0.12em] text-paper-800">{{ artifactLabel(run, 'events') }}</button>
            </div>
            <div v-if="run.error" class="mt-2 rounded-sm border border-crimson-200 bg-crimson-50 p-2 text-sm text-crimson-700">{{ run.error }}</div>
            <div v-if="run.warnings.length" class="mt-2 rounded-sm border border-ochre-200 bg-ochre-50 p-2 text-sm text-ochre-800">{{ run.warnings.join(' / ') }}</div>
          </article>
          <div v-if="!agentRuns.length" class="text-sm leading-7 text-paper-800">当前没有 Agent 任务。</div>
        </div>
      </div>

      <div class="hud-frame">
        <span class="corner-bl"></span><span class="corner-br"></span>
        <div class="brief-heading !mb-3 !text-sm">场景 / 分队线程</div>
        <div class="space-y-3">
          <article v-for="thread in snapshot.sceneThreads" :key="thread.id" class="rounded-sm border border-paper-300 bg-white p-3">
            <div class="font-serif text-base font-bold text-paper-950">{{ thread.location }}</div>
            <div class="mt-1 font-mono text-[10px] tracking-[0.14em] text-paper-700">{{ thread.id }} · {{ thread.partyIds.join(', ') || '无分队' }}</div>
            <div class="mt-2 text-sm leading-6 text-paper-800">
              {{ thread.characters.map((character) => `${character.name}${character.controller ? `(${character.controller})` : ''}`).join('、') }}
            </div>
          </article>
        </div>
      </div>
    </section>

    <section class="space-y-4">
      <div class="clash-card overflow-hidden">
        <div class="clash-card-header px-4 py-3">
          <div class="flex items-center justify-between gap-3">
            <div>
              <div class="font-mono text-[10px] font-bold tracking-[0.18em]">后台状态与日志</div>
              <div class="mt-1 text-sm text-white/85">opencode 自检、程序日志和当前回合事件。</div>
            </div>
            <button @click="emit('probe')" :disabled="probeBusy" class="rounded-sm border border-white/25 bg-white/10 px-3 py-1.5 font-mono text-[10px] font-bold tracking-[0.12em] text-white disabled:opacity-40">
              {{ probeBusy ? '自检中...' : '重跑自检' }}
            </button>
          </div>
        </div>
        <div class="space-y-4 p-4">
          <div class="flex flex-wrap gap-2">
            <button @click="opsView = 'agents'" class="rounded-sm border px-2 py-1 font-mono text-[10px] font-bold tracking-[0.12em]" :class="opsView === 'agents' ? 'border-navy-800 bg-navy-800 text-white' : 'border-paper-300 bg-white text-paper-800'">Agent</button>
            <button @click="opsView = 'probe'" class="rounded-sm border px-2 py-1 font-mono text-[10px] font-bold tracking-[0.12em]" :class="opsView === 'probe' ? 'border-navy-800 bg-navy-800 text-white' : 'border-paper-300 bg-white text-paper-800'">自检</button>
            <button @click="opsView = 'program'" class="rounded-sm border px-2 py-1 font-mono text-[10px] font-bold tracking-[0.12em]" :class="opsView === 'program' ? 'border-navy-800 bg-navy-800 text-white' : 'border-paper-300 bg-white text-paper-800'">程序日志</button>
            <button @click="opsView = 'timeline'" class="rounded-sm border px-2 py-1 font-mono text-[10px] font-bold tracking-[0.12em]" :class="opsView === 'timeline' ? 'border-navy-800 bg-navy-800 text-white' : 'border-paper-300 bg-white text-paper-800'">时间线</button>
          </div>

          <div v-if="opsView === 'agents'" class="rounded-sm border border-paper-300 bg-paper-100 p-3">
            <div v-if="agentRuns.length" class="space-y-2">
              <div v-for="run in agentRuns" :key="`detail-${run.id}`" class="rounded-sm border bg-white p-3 text-sm leading-6 text-paper-800" :class="runTone(run)">
                <div class="font-serif text-base font-bold text-paper-950">{{ run.title }}</div>
                <div class="mt-1 font-mono text-[10px] tracking-[0.14em] text-paper-700">
                  {{ run.id }} · {{ run.agentName }} · {{ run.phase }} · {{ run.currentStep }}
                </div>
                <div class="mt-2">状态：{{ run.stale ? '可能卡住' : (statusText[run.status] || run.status) }} · 耗时：{{ elapsedFor(run) }}</div>
                <div>席位：{{ run.participantSeats.join(', ') || '未记录' }}</div>
                <div>角色：{{ run.participantCharacters.map((character) => character.name).join('、') || '未记录' }}</div>
                <div>最后事件：{{ run.lastEventAt ? new Date(run.lastEventAt).toLocaleString('zh-CN', { hour12: false }) : '暂无' }}</div>
                <div class="mt-2 flex flex-wrap gap-2">
                  <button v-if="artifactPath(run, 'manifest')" @click="emit('openFile', artifactPath(run, 'manifest'))" class="rounded-sm border border-paper-300 bg-paper-100 px-2 py-1 font-mono text-[10px] font-bold tracking-[0.12em] text-paper-800">manifest</button>
                  <button v-if="artifactPath(run, 'packet')" @click="emit('openFile', artifactPath(run, 'packet'))" class="rounded-sm border border-paper-300 bg-paper-100 px-2 py-1 font-mono text-[10px] font-bold tracking-[0.12em] text-paper-800">packet</button>
                  <button v-if="artifactPath(run, 'prompt')" @click="emit('openFile', artifactPath(run, 'prompt'))" class="rounded-sm border border-paper-300 bg-paper-100 px-2 py-1 font-mono text-[10px] font-bold tracking-[0.12em] text-paper-800">prompt</button>
                  <button v-if="artifactPath(run, 'rawResult')" @click="emit('openFile', artifactPath(run, 'rawResult'))" class="rounded-sm border border-paper-300 bg-paper-100 px-2 py-1 font-mono text-[10px] font-bold tracking-[0.12em] text-paper-800">raw</button>
                  <button v-if="artifactPath(run, 'parsedResult')" @click="emit('openFile', artifactPath(run, 'parsedResult'))" class="rounded-sm border border-paper-300 bg-paper-100 px-2 py-1 font-mono text-[10px] font-bold tracking-[0.12em] text-paper-800">parsed</button>
                  <button v-if="artifactPath(run, 'events')" @click="emit('openFile', artifactPath(run, 'events'))" class="rounded-sm border border-paper-300 bg-paper-100 px-2 py-1 font-mono text-[10px] font-bold tracking-[0.12em] text-paper-800">events</button>
                </div>
                <div v-if="run.error" class="mt-2 rounded-sm border border-crimson-200 bg-crimson-50 p-2 text-crimson-700">{{ run.error }}</div>
              </div>
            </div>
            <div v-else class="text-sm leading-7 text-paper-800">
              当前没有 Agent 任务。
            </div>
          </div>

          <div v-else-if="opsView === 'probe'" class="rounded-sm border border-paper-300 bg-paper-100 p-3">
            <div class="grid gap-2 md:grid-cols-2">
              <div v-for="line in probeLines" :key="line.label" class="rounded-sm bg-white p-2">
                <div class="font-mono text-[9px] tracking-[0.16em] text-paper-700">{{ line.label }}</div>
                <div class="mt-1 break-all text-sm leading-6 text-paper-900">{{ line.value }}</div>
              </div>
            </div>
            <div v-if="probeError" class="mt-3 rounded-sm border border-crimson-200 bg-crimson-50 p-2 text-sm leading-6 text-crimson-700">{{ probeError }}</div>
          </div>

          <div v-else-if="opsView === 'program'" class="rounded-sm border border-paper-300 bg-paper-100 p-3">
            <div v-if="programLogs.length" class="max-h-[22rem] space-y-2 overflow-auto">
              <div v-for="(entry, index) in programLogs.slice().reverse()" :key="index" class="rounded-sm bg-white p-2">
                <div class="flex flex-wrap items-center gap-2 font-mono text-[10px] tracking-[0.14em]">
                  <span class="text-paper-500">{{ new Date(entry.ts).toLocaleTimeString('zh-CN', { hour12: false }) }}</span>
                  <span class="font-bold uppercase" :class="levelTone(entry.level)">{{ entry.level }}</span>
                  <span class="text-paper-900">{{ entry.message }}</span>
                </div>
                <div v-if="entry.detail" class="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-paper-700">{{ entry.detail }}</div>
              </div>
            </div>
            <div v-else class="text-sm text-paper-800">还没有程序日志。</div>
          </div>

          <div v-else class="rounded-sm border border-paper-300 bg-paper-100 p-3">
            <div v-if="agentRuns.length" class="max-h-[22rem] space-y-2 overflow-auto">
              <div v-for="run in agentRuns" :key="`timeline-${run.id}`" class="rounded-sm bg-white p-2 text-sm leading-6 text-paper-800">
                <div class="font-serif text-base font-bold text-paper-950">{{ run.title }}</div>
                <div class="mt-1 font-mono text-[10px] tracking-[0.14em] text-paper-700">
                  {{ run.status }} · {{ run.currentStep }} · {{ elapsedFor(run) }}
                </div>
                <div class="mt-2 flex flex-wrap gap-2">
                  <span class="stamp text-paper-800">created {{ new Date(run.createdAt).toLocaleTimeString('zh-CN', { hour12: false }) }}</span>
                  <span v-if="run.startedAt" class="stamp text-paper-800">started {{ new Date(run.startedAt).toLocaleTimeString('zh-CN', { hour12: false }) }}</span>
                  <span v-if="run.lastEventAt" class="stamp text-paper-800">last {{ new Date(run.lastEventAt).toLocaleTimeString('zh-CN', { hour12: false }) }}</span>
                  <span v-if="run.endedAt" class="stamp text-paper-800">ended {{ new Date(run.endedAt).toLocaleTimeString('zh-CN', { hour12: false }) }}</span>
                </div>
                <button v-if="artifactPath(run, 'events')" @click="emit('openFile', artifactPath(run, 'events'))" class="mt-2 rounded-sm border border-paper-300 bg-paper-100 px-2 py-1 font-mono text-[10px] font-bold tracking-[0.12em] text-paper-800">
                  打开 events.ndjson
                </button>
              </div>
            </div>
            <div v-else class="text-sm text-paper-800">当前还没有 Agent 时间线。</div>
          </div>
        </div>
      </div>

      <div class="clash-card overflow-hidden">
        <div class="clash-card-header px-4 py-3">
          <div class="font-mono text-[10px] font-bold tracking-[0.18em]">文件阅读</div>
        </div>
        <div class="p-4">
          <div v-if="previewFile">
            <div class="mb-2 font-mono text-[10px] tracking-[0.18em] text-paper-800">{{ previewFile.path }}</div>
            <RenderedMarkdown :content="previewFile.content" compact max-height="32rem" />
          </div>
          <div v-else class="text-sm text-paper-800">打开回合包、结果、角色卡或对话索引后，会在这里渲染阅读。</div>
        </div>
      </div>
    </section>
  </div>
</template>
