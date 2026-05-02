<script setup lang="ts">
import { computed, ref } from 'vue'
import type { FilePayload, OpencodeProbeResult, RoomSnapshot, SessionCredentials, VisibleRoundState } from '@/lib/api'
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

const opsView = ref<'queue' | 'probe' | 'program' | 'round'>('queue')

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
        <div class="grid gap-3 p-4 md:grid-cols-3">
          <div class="data-card">
            <div class="data-card-label"><span class="h-1 w-3 bg-navy-800"></span>队列</div>
            <div class="data-card-value !text-2xl">{{ snapshot.aiQueue.length }}</div>
            <div class="data-card-foot">{{ round ? statusText[round.status] || round.status : '无运行任务' }}</div>
          </div>
          <div class="data-card">
            <div class="data-card-label"><span class="h-1 w-3 bg-crimson-600"></span>opencode</div>
            <div class="data-card-value !text-2xl" :class="probeStatusTone">{{ probeStatusLabel }}</div>
            <div class="data-card-foot">{{ probeResult?.model || '等待自检' }}</div>
          </div>
          <div class="data-card">
            <div class="data-card-label"><span class="h-1 w-3 bg-ochre-600"></span>场景线程</div>
            <div class="data-card-value !text-2xl">{{ snapshot.sceneThreads.length }}</div>
            <div class="data-card-foot">{{ snapshot.publicIntents.filter((entry) => entry.status === 'submitted').length }} 个已提交</div>
          </div>
        </div>
      </div>

      <div class="clash-card overflow-hidden">
        <div class="clash-card-header px-4 py-3">
          <div class="font-mono text-[10px] font-bold tracking-[0.18em]">处理队列</div>
        </div>
        <div class="space-y-3 p-4">
          <article v-for="item in snapshot.aiQueue" :key="item.id" class="rounded-sm border border-paper-300 bg-paper-100 p-3">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div class="font-serif text-base font-bold text-paper-950">{{ item.id }}</div>
                <div class="mt-1 font-mono text-[10px] tracking-[0.14em] text-paper-700">
                  {{ item.kind }} · {{ statusText[item.status] || item.status }} · {{ new Date(item.updatedAt).toLocaleString('zh-CN', { hour12: false }) }}
                </div>
              </div>
              <button
                v-if="item.id === 'submitted-intents' || (item.status === 'error' && item.kind === 'action')"
                @click="retryQueueItem(item.id)"
                :disabled="busy"
                class="rounded-sm border border-ochre-300 bg-ochre-500 px-3 py-2 font-mono text-[10px] font-bold tracking-[0.12em] text-paper-950 disabled:opacity-40"
              >
                重跑
              </button>
            </div>
            <div class="mt-2 text-sm leading-6 text-paper-800">
              席位：{{ item.participantSeats.join(', ') || '未记录' }}<br>
              场景：{{ item.sceneIds.join(', ') || '未记录' }}
            </div>
            <div class="mt-3 flex flex-wrap gap-2">
              <button v-if="item.packetPath" @click="emit('openFile', item.packetPath)" class="rounded-sm border border-paper-300 bg-white px-2 py-1 font-mono text-[10px] font-bold tracking-[0.12em] text-paper-800">回合包</button>
              <button v-if="item.resultPath" @click="emit('openFile', item.resultPath)" class="rounded-sm border border-paper-300 bg-white px-2 py-1 font-mono text-[10px] font-bold tracking-[0.12em] text-paper-800">结果</button>
            </div>
            <div v-if="item.error" class="mt-2 rounded-sm border border-crimson-200 bg-crimson-50 p-2 text-sm text-crimson-700">{{ item.error }}</div>
          </article>
          <div v-if="!snapshot.aiQueue.length" class="text-sm leading-7 text-paper-800">当前没有 AI DM 任务。</div>
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
            <button @click="opsView = 'queue'" class="rounded-sm border px-2 py-1 font-mono text-[10px] font-bold tracking-[0.12em]" :class="opsView === 'queue' ? 'border-navy-800 bg-navy-800 text-white' : 'border-paper-300 bg-white text-paper-800'">队列</button>
            <button @click="opsView = 'probe'" class="rounded-sm border px-2 py-1 font-mono text-[10px] font-bold tracking-[0.12em]" :class="opsView === 'probe' ? 'border-navy-800 bg-navy-800 text-white' : 'border-paper-300 bg-white text-paper-800'">自检</button>
            <button @click="opsView = 'program'" class="rounded-sm border px-2 py-1 font-mono text-[10px] font-bold tracking-[0.12em]" :class="opsView === 'program' ? 'border-navy-800 bg-navy-800 text-white' : 'border-paper-300 bg-white text-paper-800'">程序日志</button>
            <button @click="opsView = 'round'" class="rounded-sm border px-2 py-1 font-mono text-[10px] font-bold tracking-[0.12em]" :class="opsView === 'round' ? 'border-navy-800 bg-navy-800 text-white' : 'border-paper-300 bg-white text-paper-800'">回合事件</button>
          </div>

          <div v-if="opsView === 'queue'" class="rounded-sm border border-paper-300 bg-paper-100 p-3">
            <div v-if="snapshot.aiQueue.length" class="space-y-2">
              <div v-for="item in snapshot.aiQueue" :key="`detail-${item.id}`" class="rounded-sm bg-white p-3 text-sm leading-6 text-paper-800">
                <div class="font-serif text-base font-bold text-paper-950">{{ item.id }}</div>
                <div class="mt-1 font-mono text-[10px] tracking-[0.14em] text-paper-700">
                  {{ item.kind }} · {{ statusText[item.status] || item.status }} · {{ new Date(item.updatedAt).toLocaleString('zh-CN', { hour12: false }) }}
                </div>
                <div class="mt-2">席位：{{ item.participantSeats.join(', ') || '未记录' }}</div>
                <div>场景：{{ item.sceneIds.join(', ') || '未记录' }}</div>
                <div class="mt-2 flex flex-wrap gap-2">
                  <button v-if="item.packetPath" @click="emit('openFile', item.packetPath)" class="rounded-sm border border-paper-300 bg-paper-100 px-2 py-1 font-mono text-[10px] font-bold tracking-[0.12em] text-paper-800">回合包</button>
                  <button v-if="item.resultPath" @click="emit('openFile', item.resultPath)" class="rounded-sm border border-paper-300 bg-paper-100 px-2 py-1 font-mono text-[10px] font-bold tracking-[0.12em] text-paper-800">结果</button>
                </div>
                <div v-if="item.error" class="mt-2 rounded-sm border border-crimson-200 bg-crimson-50 p-2 text-crimson-700">{{ item.error }}</div>
              </div>
            </div>
            <div v-else class="text-sm leading-7 text-paper-800">
              当前没有 AI DM 任务。玩家提交行动后会自动进入等待队列；第一版执行仍是串行，数据模型已保留并发场景线程。
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
            <div v-if="round?.logs?.length" class="max-h-[22rem] overflow-auto">
              <div v-for="(entry, index) in round.logs" :key="index" class="flex gap-2 font-mono text-[11px] leading-6 text-paper-800">
                <span class="shrink-0 text-paper-700">{{ new Date(entry.ts).toLocaleTimeString('zh-CN', { hour12: false }) }}</span>
                <span class="shrink-0 font-bold" :class="entry.stream === 'stderr' ? 'text-ochre-700' : entry.stream === 'stdout' ? 'text-forest-700' : 'text-crimson-700'">{{ entry.stream }}</span>
                <span class="min-w-0 whitespace-pre-wrap break-words">{{ entry.text }}</span>
              </div>
            </div>
            <div v-else class="text-sm text-paper-800">当前还没有回合事件。</div>
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
