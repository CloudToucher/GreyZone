<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ControlBinding, FilePayload, OpencodeProbeResult, RoomSnapshot, SessionCredentials, VisibleRoundState } from '@/lib/api'
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

const composeNote = ref('')
const selectedSeats = ref<string[]>([])
const requireAccept = ref(true)
const opsView = ref<'probe' | 'program' | 'round'>('probe')

const statusText: Record<string, string> = {
  idle: '待行动',
  ready: '已准备',
  submitted: '已提交',
  locked: '已锁定',
  running: '运行中',
  done: '完成',
  error: '错误',
}

const allSeatNames = computed(() =>
  props.snapshot.seats.filter((seat) => seat.role === 'player').map((seat) => seat.name),
)

const probeStatusLabel = computed(() => {
  if (props.probeBusy) return '自检中'
  if (props.probeResult?.ok) return '可用'
  if (props.probeError || props.probeResult) return '失败'
  return '未检'
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

function toggleSeat(name: string) {
  selectedSeats.value = selectedSeats.value.includes(name)
    ? selectedSeats.value.filter((seat) => seat !== name)
    : [...selectedSeats.value, name]
}

function compose() {
  emit('compose', { seatNames: selectedSeats.value, note: composeNote.value })
}

function run() {
  if (props.currentPacket) emit('runAction', props.currentPacket.roundId)
}

function assign(binding: ControlBinding, target: string) {
  emit('assign', {
    characterPath: binding.characterPath,
    primarySeat: target || null,
    dmHosted: !target,
    requireAccept: requireAccept.value,
  })
}
</script>

<template>
  <div class="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
    <section class="space-y-4">
      <div class="hud-frame">
        <span class="corner-bl"></span><span class="corner-br"></span>
        <div class="brief-heading !mb-3 !text-sm">房间席位</div>
        <div class="grid gap-3">
          <div v-for="seat in snapshot.seats" :key="seat.name" class="clash-card p-3">
            <div class="flex items-start justify-between gap-3">
              <div>
                <div class="font-serif text-lg font-bold text-paper-950">{{ seat.name }}</div>
                <div class="font-mono text-[10px] tracking-[0.18em] text-paper-700">
                  {{ seat.role === 'dm' ? 'DM' : '玩家' }} · {{ statusText[seat.status] || seat.status }} · {{ seat.controlledCharacterCount }} 个角色
                </div>
              </div>
              <div class="flex items-center gap-2">
                <button
                  v-if="seat.role === 'player'"
                  @click="toggleSeat(seat.name)"
                  class="rounded-sm border px-2 py-1 font-mono text-[10px] font-bold tracking-[0.12em]"
                  :class="selectedSeats.includes(seat.name) ? 'border-crimson-600 bg-crimson-600 text-white' : 'border-paper-300 bg-white text-paper-800'"
                >
                  {{ selectedSeats.includes(seat.name) ? '已纳入' : '纳入回合' }}
                </button>
                <button v-if="seat.role === 'player' && seat.occupied" @click="emit('releaseSeat', seat.name)" class="rounded-sm border border-paper-300 bg-white px-2 py-1 font-mono text-[10px] font-bold tracking-[0.12em] text-paper-800">
                  释放席位
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="clash-card overflow-hidden">
        <div class="clash-card-header px-4 py-3">
          <div class="font-mono text-[10px] font-bold tracking-[0.18em]">角色控制权</div>
        </div>
        <div class="space-y-3 p-4">
          <label class="flex items-center gap-2 font-mono text-[10px] tracking-[0.16em] text-paper-800">
            <input v-model="requireAccept" type="checkbox" />
            移交角色时需要玩家确认
          </label>

          <div v-for="binding in snapshot.control" :key="binding.characterPath" class="rounded-sm border border-paper-300 bg-paper-100 p-3">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div class="font-serif text-base font-bold text-paper-950">{{ binding.label }}</div>
                <button @click="emit('openFile', binding.characterPath)" class="font-mono text-[10px] tracking-[0.16em] text-paper-700 hover:text-crimson-700">{{ binding.characterPath }}</button>
              </div>
              <select :value="binding.primarySeat || ''" @change="assign(binding, ($event.target as HTMLSelectElement).value)" class="clash-select px-2 py-1 font-mono text-[11px]">
                <option value="">DM 托管</option>
                <option v-for="name in allSeatNames" :key="name" :value="name">{{ name }}</option>
              </select>
            </div>
            <div v-if="binding.pendingTransfer?.toSeat" class="mt-2 text-xs font-semibold text-ochre-700">等待 {{ binding.pendingTransfer.toSeat }} 确认移交</div>
          </div>
        </div>
      </div>
    </section>

    <section class="space-y-4">
      <div class="clash-card overflow-hidden border-2 border-crimson-600 shadow-[0_8px_24px_rgba(220,38,38,0.12)]">
        <div class="clash-card-header px-4 py-3">
          <div class="flex items-center justify-between gap-3">
            <div>
              <div class="font-mono text-[10px] font-bold tracking-[0.18em]">后台自检与程序日志</div>
              <div class="mt-1 text-sm text-white/90">这里显示 opencode 可用性、程序日志和回合事件。</div>
            </div>
            <button @click="emit('probe')" :disabled="probeBusy" class="rounded-sm border border-white/25 bg-white/10 px-3 py-1.5 font-mono text-[10px] font-bold tracking-[0.12em] text-white disabled:opacity-40">
              {{ probeBusy ? '自检中...' : '重跑自检' }}
            </button>
          </div>
        </div>
        <div class="space-y-4 p-4">
          <div class="grid gap-3 md:grid-cols-3">
            <div class="data-card">
              <div class="data-card-label"><span class="h-1 w-3 bg-crimson-600"></span>后台</div>
              <div class="data-card-value !text-2xl" :class="probeStatusTone">{{ probeStatusLabel }}</div>
              <div class="data-card-foot">{{ probeResult?.model || '等待首次自检' }}</div>
            </div>
            <div class="data-card">
              <div class="data-card-label"><span class="h-1 w-3 bg-navy-800"></span>耗时</div>
              <div class="data-card-value !text-2xl">{{ probeResult ? `${probeResult.durationMs}ms` : '--' }}</div>
              <div class="data-card-foot">{{ probeCheckedAt ? new Date(probeCheckedAt).toLocaleTimeString('zh-CN', { hour12: false }) : '尚未自检' }}</div>
            </div>
            <div class="data-card">
              <div class="data-card-label"><span class="h-1 w-3 bg-ochre-600"></span>日志</div>
              <div class="data-card-value !text-2xl">{{ programLogs.length }}</div>
              <div class="data-card-foot">{{ programLogs.length ? programLogs[programLogs.length - 1].message : '还没有日志' }}</div>
            </div>
          </div>

          <div class="flex flex-wrap gap-2">
            <button @click="opsView = 'probe'" class="rounded-sm border px-2 py-1 font-mono text-[10px] font-bold tracking-[0.12em]" :class="opsView === 'probe' ? 'border-navy-800 bg-navy-800 text-white' : 'border-paper-300 bg-white text-paper-800'">后台自检</button>
            <button @click="opsView = 'program'" class="rounded-sm border px-2 py-1 font-mono text-[10px] font-bold tracking-[0.12em]" :class="opsView === 'program' ? 'border-navy-800 bg-navy-800 text-white' : 'border-paper-300 bg-white text-paper-800'">程序日志</button>
            <button @click="opsView = 'round'" class="rounded-sm border px-2 py-1 font-mono text-[10px] font-bold tracking-[0.12em]" :class="opsView === 'round' ? 'border-navy-800 bg-navy-800 text-white' : 'border-paper-300 bg-white text-paper-800'">回合事件</button>
          </div>

          <div v-if="opsView === 'probe'" class="space-y-3">
            <div class="rounded-sm border border-paper-300 bg-paper-100 p-3">
              <div class="mt-1 grid gap-2 md:grid-cols-2">
                <div v-for="line in probeLines" :key="line.label" class="rounded-sm bg-white p-2">
                  <div class="font-mono text-[9px] tracking-[0.16em] text-paper-700">{{ line.label }}</div>
                  <div class="mt-1 break-all text-sm leading-6 text-paper-900">{{ line.value }}</div>
                </div>
              </div>
              <div v-if="probeError" class="mt-3 rounded-sm border border-crimson-200 bg-crimson-50 p-2 text-sm leading-6 text-crimson-700">{{ probeError }}</div>
            </div>
            <pre v-if="probeResult?.stderr" class="max-h-[12rem] overflow-auto whitespace-pre-wrap break-words rounded-sm bg-paper-950 p-3 font-mono text-[11px] leading-6 text-ochre-200">{{ probeResult.stderr }}</pre>
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
          <div class="font-mono text-[10px] font-bold tracking-[0.18em]">回合编排</div>
          <div class="mt-1 text-sm text-white/80">选择参与席位，生成回合包，再执行 AI DM。每次执行都会登记到 table/conversations.md。</div>
        </div>
        <div class="space-y-4 p-4">
          <div class="grid gap-4 lg:grid-cols-2">
            <div class="space-y-2">
              <div class="font-mono text-[10px] tracking-[0.18em] text-paper-800">当前提交</div>
              <article v-for="intent in snapshot.allIntents || []" :key="intent.seatName" class="rounded-sm border border-paper-300 bg-paper-100 p-3">
                <div class="flex items-center justify-between gap-2">
                  <div class="font-serif text-base font-bold text-paper-950">{{ intent.seatName }}</div>
                  <span class="font-mono text-[10px] tracking-[0.16em] text-paper-700">{{ statusText[snapshot.seats.find((seat) => seat.name === intent.seatName)?.status || 'idle'] }}</span>
                </div>
                <div class="mt-2 grid gap-2 md:grid-cols-2">
                  <div class="rounded-sm bg-white p-2">
                    <div class="font-mono text-[9px] tracking-[0.16em] text-paper-700">公开行动</div>
                    <div class="mt-1 whitespace-pre-wrap text-xs leading-6 text-paper-800">{{ intent.sections.public || '（空）' }}</div>
                  </div>
                  <div class="rounded-sm bg-white p-2">
                    <div class="font-mono text-[9px] tracking-[0.16em] text-paper-700">私密意图</div>
                    <div class="mt-1 whitespace-pre-wrap text-xs leading-6 text-paper-800">{{ intent.sections.privateToDm || '（空）' }}</div>
                  </div>
                </div>
              </article>
            </div>

            <div class="space-y-3">
              <label class="block space-y-1">
                <div class="font-mono text-[10px] tracking-[0.18em] text-paper-800">DM 给本轮的补充</div>
                <textarea v-model="composeNote" rows="8" class="clash-textarea w-full resize-y px-3 py-2 text-sm leading-6" />
              </label>
              <div class="flex flex-wrap gap-2">
                <button @click="compose" :disabled="busy" class="rounded-sm border border-navy-800 bg-navy-800 px-3 py-2 font-mono text-[10px] font-bold tracking-[0.12em] text-white disabled:opacity-40">生成回合包</button>
                <button @click="run" :disabled="busy || !currentPacket" class="rounded-sm border border-ochre-300 bg-ochre-500 px-3 py-2 font-mono text-[10px] font-bold tracking-[0.12em] text-paper-950 disabled:opacity-40">执行 AI DM</button>
              </div>

              <div v-if="currentPacket" class="rounded-sm border border-paper-300 bg-paper-100 p-3 text-sm leading-6 text-paper-800">
                <div class="font-mono text-[10px] tracking-[0.18em] text-paper-700">当前回合包</div>
                <div class="mt-1">{{ currentPacket.roundId }}</div>
                <div class="mt-1 flex flex-wrap gap-2">
                  <button @click="emit('openFile', currentPacket.packetPath)" class="rounded-sm border border-paper-300 bg-white px-2 py-1 font-mono text-[10px] font-bold tracking-[0.12em] text-paper-800">打开回合包</button>
                  <button @click="emit('openFile', currentPacket.resultPath)" class="rounded-sm border border-paper-300 bg-white px-2 py-1 font-mono text-[10px] font-bold tracking-[0.12em] text-paper-800">打开结果</button>
                </div>
              </div>
            </div>
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
