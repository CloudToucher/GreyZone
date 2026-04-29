<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ControlBinding, FilePayload, RoomSnapshot, SessionCredentials, VisibleRoundState } from '@/lib/api'

const props = defineProps<{
  session: SessionCredentials
  snapshot: RoomSnapshot
  busy: boolean
  round: VisibleRoundState | null
  currentPacket: { roundId: string; packetPath: string; resultPath: string; seatNames: string[] } | null
  previewFile: FilePayload | null
}>()

const emit = defineEmits<{
  compose: [payload: { seatNames: string[]; note?: string }]
  runAction: [roundId: string]
  assign: [payload: { characterPath: string; primarySeat: string | null; dmHosted: boolean; requireAccept?: boolean }]
  releaseSeat: [seatName: string]
  openFile: [path: string]
}>()

const composeNote = ref('')
const selectedSeats = ref<string[]>([])
const requireAccept = ref(true)

const allSeatNames = computed(() =>
  props.snapshot.seats.filter((seat) => seat.role === 'player').map((seat) => seat.name),
)

function toggleSeat(name: string) {
  if (selectedSeats.value.includes(name)) {
    selectedSeats.value = selectedSeats.value.filter((seat) => seat !== name)
  } else {
    selectedSeats.value = [...selectedSeats.value, name]
  }
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
        <div class="brief-heading !mb-3 !text-sm">Room Seats</div>
        <div class="grid gap-3">
          <div v-for="seat in snapshot.seats" :key="seat.name" class="clash-card p-3">
            <div class="flex items-start justify-between gap-3">
              <div>
                <div class="font-serif text-lg font-bold text-paper-950">{{ seat.name }}</div>
                <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-500">
                  {{ seat.role }} | {{ seat.status }} | {{ seat.controlledCharacterCount }} characters
                </div>
              </div>
              <div class="flex items-center gap-2">
                <button
                  v-if="seat.role === 'player'"
                  @click="toggleSeat(seat.name)"
                  class="rounded-sm border px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em]"
                  :class="selectedSeats.includes(seat.name) ? 'border-crimson-600 bg-crimson-600 text-white' : 'border-paper-300 bg-white text-paper-700'"
                >
                  {{ selectedSeats.includes(seat.name) ? 'Queued' : 'Include' }}
                </button>
                <button
                  v-if="seat.role === 'player' && seat.occupied"
                  @click="emit('releaseSeat', seat.name)"
                  class="rounded-sm border border-paper-300 bg-white px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-paper-700"
                >
                  Release
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="clash-card overflow-hidden">
        <div class="clash-card-header px-4 py-3">
          <div class="font-mono text-[10px] font-bold uppercase tracking-[0.18em]">Control Bindings</div>
        </div>
        <div class="space-y-3 p-4">
          <label class="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-paper-600">
            <input v-model="requireAccept" type="checkbox" />
            Require accept on transfer
          </label>

          <div v-for="binding in snapshot.control" :key="binding.characterPath" class="rounded-sm border border-paper-200 bg-paper-100 p-3">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div class="font-serif text-base font-bold text-paper-950">{{ binding.label }}</div>
                <div class="font-mono text-[10px] uppercase tracking-[0.16em] text-paper-500">{{ binding.characterPath }}</div>
              </div>
              <div class="flex items-center gap-2">
                <select
                  :value="binding.primarySeat || ''"
                  @change="assign(binding, ($event.target as HTMLSelectElement).value)"
                  class="clash-select px-2 py-1 font-mono text-[11px]"
                >
                  <option value="">DM Hosted</option>
                  <option v-for="name in allSeatNames" :key="name" :value="name">{{ name }}</option>
                </select>
              </div>
            </div>
            <div v-if="binding.pendingTransfer?.toSeat" class="mt-2 text-xs text-ochre-700">
              Pending transfer to {{ binding.pendingTransfer.toSeat }}
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="space-y-4">
      <div class="clash-card overflow-hidden">
        <div class="clash-card-header px-4 py-3">
          <div class="font-mono text-[10px] font-bold uppercase tracking-[0.18em]">Round Composer</div>
          <div class="mt-1 text-sm text-white/75">选定席位，生成 packet，再执行 AI DM。</div>
        </div>
        <div class="space-y-4 p-4">
          <div class="grid gap-4 lg:grid-cols-2">
            <div class="space-y-2">
              <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-600">Current Submissions</div>
              <div class="space-y-2">
                <article v-for="intent in snapshot.allIntents || []" :key="intent.seatName" class="rounded-sm border border-paper-200 bg-paper-100 p-3">
                  <div class="flex items-center justify-between gap-2">
                    <div class="font-serif text-base font-bold text-paper-950">{{ intent.seatName }}</div>
                    <span class="font-mono text-[10px] uppercase tracking-[0.16em] text-paper-500">
                      {{ snapshot.seats.find((seat) => seat.name === intent.seatName)?.status || 'idle' }}
                    </span>
                  </div>
                  <div class="mt-2 grid gap-2 md:grid-cols-2">
                    <div class="rounded-sm bg-white p-2">
                      <div class="font-mono text-[9px] uppercase tracking-[0.16em] text-paper-500">Public</div>
                      <div class="mt-1 whitespace-pre-wrap text-xs leading-6 text-paper-700">{{ intent.sections.public || '(empty)' }}</div>
                    </div>
                    <div class="rounded-sm bg-white p-2">
                      <div class="font-mono text-[9px] uppercase tracking-[0.16em] text-paper-500">Private For DM</div>
                      <div class="mt-1 whitespace-pre-wrap text-xs leading-6 text-paper-700">{{ intent.sections.privateToDm || '(empty)' }}</div>
                    </div>
                  </div>
                </article>
              </div>
            </div>

            <div class="space-y-3">
              <label class="block space-y-1">
                <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-600">DM Note For Packet</div>
                <textarea v-model="composeNote" rows="8" class="clash-textarea w-full resize-y px-3 py-2 text-sm leading-6" />
              </label>
              <div class="flex flex-wrap gap-2">
                <button @click="compose" :disabled="busy" class="rounded-sm border border-navy-800 bg-navy-800 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-white disabled:opacity-40">
                  Compose Packet
                </button>
                <button @click="run" :disabled="busy || !currentPacket" class="rounded-sm border border-ochre-300 bg-ochre-500 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-paper-950 disabled:opacity-40">
                  Run AI DM
                </button>
              </div>

              <div v-if="currentPacket" class="rounded-sm border border-paper-200 bg-paper-100 p-3 text-sm leading-6 text-paper-700">
                <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-500">Current Packet</div>
                <div class="mt-1">{{ currentPacket.roundId }}</div>
                <div class="mt-1 flex flex-wrap gap-2">
                  <button @click="emit('openFile', currentPacket.packetPath)" class="rounded-sm border border-paper-300 bg-white px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-paper-700">
                    Open Packet
                  </button>
                  <button @click="emit('openFile', currentPacket.resultPath)" class="rounded-sm border border-paper-300 bg-white px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-paper-700">
                    Open Result
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="hud-frame">
        <span class="corner-bl"></span><span class="corner-br"></span>
        <div class="brief-heading !mb-3 !text-sm">Round Runtime</div>
        <div v-if="round" class="space-y-3">
          <div class="grid gap-3 md:grid-cols-3">
            <div class="data-card">
              <div class="data-card-label"><span class="h-1 w-3 bg-crimson-600"></span>Status</div>
              <div class="data-card-value !text-2xl">{{ round.status }}</div>
              <div class="data-card-foot">{{ round.kind }}</div>
            </div>
            <div class="data-card">
              <div class="data-card-label"><span class="h-1 w-3 bg-navy-800"></span>Round</div>
              <div class="data-card-value !text-lg">{{ round.id.slice(0, 8) }}</div>
              <div class="data-card-foot">PACKET LIVE</div>
            </div>
            <div class="data-card">
              <div class="data-card-label"><span class="h-1 w-3 bg-ochre-600"></span>Seats</div>
              <div class="data-card-value !text-2xl">{{ round.participantSeats.length }}</div>
              <div class="data-card-foot">{{ round.participantSeats.join(', ') || 'none' }}</div>
            </div>
          </div>

          <div v-if="round.logs?.length" class="clash-card max-h-[24rem] overflow-auto p-3">
            <div v-for="(entry, index) in round.logs" :key="index" class="flex gap-2 font-mono text-[11px] leading-6 text-paper-700">
              <span class="shrink-0 text-paper-500">{{ new Date(entry.ts).toLocaleTimeString('zh-CN', { hour12: false }) }}</span>
              <span class="shrink-0 font-bold" :class="entry.stream === 'stderr' ? 'text-ochre-700' : entry.stream === 'stdout' ? 'text-forest-700' : 'text-crimson-700'">{{ entry.stream }}</span>
              <span class="min-w-0 whitespace-pre-wrap break-words">{{ entry.text }}</span>
            </div>
          </div>
        </div>
        <div v-else class="text-sm text-paper-500">No active round right now.</div>
      </div>

      <div class="clash-card overflow-hidden">
        <div class="clash-card-header px-4 py-3">
          <div class="font-mono text-[10px] font-bold uppercase tracking-[0.18em]">File Preview</div>
        </div>
        <div class="p-4">
          <pre v-if="previewFile" class="max-h-[28rem] overflow-auto whitespace-pre-wrap text-sm leading-7 text-paper-700">{{ previewFile.content }}</pre>
          <div v-else class="text-sm text-paper-500">Open a packet or result file to preview it here.</div>
        </div>
      </div>
    </section>
  </div>
</template>
