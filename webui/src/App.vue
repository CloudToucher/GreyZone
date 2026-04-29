<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import JoinGate from './rebuild/JoinGate.vue'
import ShellHeader from './rebuild/ShellHeader.vue'
import PlayerWorkspace from './rebuild/PlayerWorkspace.vue'
import DMConsole from './rebuild/DMConsole.vue'
import SharedBoard from './rebuild/SharedBoard.vue'
import {
  assignCharacter,
  composeRound,
  fetchFileSession,
  fetchSnapshot,
  fetchTreeSession,
  joinRoom,
  openEvents,
  probeOpencode,
  releaseSeatSession,
  respondToTransfer,
  runRound,
  saveMyIntent,
  type FilePayload,
  type OpencodeProbeResult,
  type RoomSnapshot,
  type SessionCredentials,
  type VisibleRoundState,
} from './lib/api'

const STORAGE_KEY = 'gz.room.session'
const LAST_NAME_KEY = 'gz.room.lastName'

const session = ref<SessionCredentials | null>(null)
const snapshot = ref<RoomSnapshot | null>(null)
const tree = ref<{ tree: any } | null>(null)
const previewFile = ref<FilePayload | null>(null)
const currentRound = ref<VisibleRoundState | null>(null)
const activeTab = ref<'player' | 'dm' | 'shared'>('player')
const joinBusy = ref(false)
const busy = ref(false)
const error = ref<string | null>(null)
const probeBusy = ref(false)
const probeResult = ref<OpencodeProbeResult | null>(null)
const currentPacket = ref<{ roundId: string; packetPath: string; resultPath: string; seatNames: string[] } | null>(null)

let closeEvents: (() => void) | null = null

const lastSeatName = computed(() => localStorage.getItem(LAST_NAME_KEY) || '')

function persistSession(value: SessionCredentials | null) {
  if (!value) {
    localStorage.removeItem(STORAGE_KEY)
    return
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  localStorage.setItem(LAST_NAME_KEY, value.seatName)
}

function loadStoredSession() {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as SessionCredentials
  } catch {
    return null
  }
}

async function hydrate() {
  if (!session.value) return
  snapshot.value = await fetchSnapshot(session.value)
  tree.value = await fetchTreeSession(session.value)
  currentRound.value = snapshot.value.visibleRound
  if (session.value.role === 'dm') activeTab.value = 'dm'
  else activeTab.value = 'player'
}

function bindEvents() {
  closeEvents?.()
  if (!session.value) return
  closeEvents = openEvents(session.value, {
    onSnapshot: (next) => {
      snapshot.value = next
      currentRound.value = next.visibleRound
    },
    onRefresh: async () => {
      if (!session.value) return
      snapshot.value = await fetchSnapshot(session.value)
      tree.value = await fetchTreeSession(session.value)
      currentRound.value = snapshot.value.visibleRound
    },
    onRound: (round) => {
      currentRound.value = round
    },
  })
}

async function join(name: string) {
  try {
    joinBusy.value = true
    error.value = null
    const token = session.value?.seatName === name ? session.value.token : undefined
    const result = await joinRoom(name, token)
    session.value = result.session
    persistSession(result.session)
    await hydrate()
    bindEvents()
  } catch (err: any) {
    error.value = err?.message || String(err)
  } finally {
    joinBusy.value = false
  }
}

async function refresh() {
  if (!session.value) return
  await hydrate()
}

async function leaveRoom() {
  closeEvents?.()
  closeEvents = null
  session.value = null
  snapshot.value = null
  tree.value = null
  previewFile.value = null
  currentRound.value = null
  currentPacket.value = null
  persistSession(null)
}

async function saveIntent(sections: any, status?: 'idle' | 'ready' | 'submitted') {
  if (!session.value) return
  busy.value = true
  try {
    await saveMyIntent(session.value, sections, status)
    await refresh()
  } finally {
    busy.value = false
  }
}

async function onRespondTransfer(characterPath: string, accept: boolean) {
  if (!session.value) return
  busy.value = true
  try {
    await respondToTransfer(session.value, characterPath, accept)
    await refresh()
  } finally {
    busy.value = false
  }
}

async function onRunForge(payload: any) {
  if (!session.value) return
  busy.value = true
  try {
    const result = await runRound(session.value, { kind: 'forge', forge: payload })
    currentPacket.value = {
      roundId: result.roundId,
      packetPath: `table/rounds/${result.roundId}/packet.md`,
      resultPath: `table/rounds/${result.roundId}/result.md`,
      seatNames: [session.value.seatName],
    }
  } finally {
    busy.value = false
  }
}

async function onComposeRound(payload: { seatNames: string[]; note?: string }) {
  if (!session.value) return
  busy.value = true
  try {
    currentPacket.value = await composeRound(session.value, payload)
    await refresh()
  } finally {
    busy.value = false
  }
}

async function onRunAction(roundId: string) {
  if (!session.value) return
  busy.value = true
  try {
    await runRound(session.value, { kind: 'action', roundId })
    await refresh()
  } finally {
    busy.value = false
  }
}

async function onAssign(payload: { characterPath: string; primarySeat: string | null; dmHosted: boolean; requireAccept?: boolean }) {
  if (!session.value) return
  busy.value = true
  try {
    await assignCharacter(session.value, payload)
    await refresh()
  } finally {
    busy.value = false
  }
}

async function onReleaseSeat(seatName: string) {
  if (!session.value) return
  busy.value = true
  try {
    await releaseSeatSession(session.value, seatName)
    await refresh()
  } finally {
    busy.value = false
  }
}

async function openFile(path: string) {
  if (!session.value) return
  previewFile.value = await fetchFileSession(session.value, path)
}

async function runProbe() {
  probeBusy.value = true
  try {
    probeResult.value = await probeOpencode()
  } finally {
    probeBusy.value = false
  }
}

onMounted(async () => {
  const stored = loadStoredSession()
  if (!stored) return
  session.value = stored
  try {
    await hydrate()
    bindEvents()
  } catch {
    await leaveRoom()
  }
})

onBeforeUnmount(() => {
  closeEvents?.()
})
</script>

<template>
  <JoinGate
    v-if="!session || !snapshot"
    :busy="joinBusy"
    :error="error"
    :last-seat-name="lastSeatName"
    @join="join"
  />

  <div v-else class="min-h-screen bg-paper-100">
    <ShellHeader
      :session="session"
      :snapshot="snapshot"
      :active-tab="activeTab"
      :probing="probeBusy"
      :probe-result="probeResult"
      @switch-tab="activeTab = $event"
      @refresh="refresh"
      @probe="runProbe"
      @leave="leaveRoom"
    />

    <main class="mx-auto max-w-[1600px] px-6 py-6">
      <PlayerWorkspace
        v-if="activeTab === 'player' && session.role === 'player'"
        :session="session"
        :snapshot="snapshot"
        :busy="busy"
        :round="currentRound"
        @save-intent="saveIntent"
        @respond-transfer="onRespondTransfer"
        @run-forge="onRunForge"
      />

      <DMConsole
        v-else-if="activeTab === 'dm' && session.role === 'dm'"
        :session="session"
        :snapshot="snapshot"
        :busy="busy"
        :round="currentRound"
        :current-packet="currentPacket"
        :preview-file="previewFile"
        @compose="onComposeRound"
        @run-action="onRunAction"
        @assign="onAssign"
        @release-seat="onReleaseSeat"
        @open-file="openFile"
      />

      <SharedBoard
        v-else
        :session="session"
        :snapshot="snapshot"
        :tree="tree?.tree || null"
        :preview-file="previewFile"
        @open-file="openFile"
      />
    </main>
  </div>
</template>
