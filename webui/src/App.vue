<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import JoinGate from './rebuild/JoinGate.vue'
import ShellHeader from './rebuild/ShellHeader.vue'
import SessionTree from './rebuild/SessionTree.vue'
import PlayerWorkspace from './rebuild/PlayerWorkspace.vue'
import PlayerDocumentReader from './rebuild/PlayerDocumentReader.vue'
import DMConsole from './rebuild/DMConsole.vue'
import SharedBoard from './rebuild/SharedBoard.vue'
import {
  assignCharacter,
  composeRound,
  enableDmConsoleSession,
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
const LAST_CODE_KEY = 'gz.room.lastCode'

const session = ref<SessionCredentials | null>(null)
const snapshot = ref<RoomSnapshot | null>(null)
const tree = ref<{ tree: any } | null>(null)
const previewFile = ref<FilePayload | null>(null)
const activeFilePath = ref<string | null>(null)
const currentRound = ref<VisibleRoundState | null>(null)
const activeTab = ref<'player' | 'dm' | 'shared'>('player')
const showPlayerDocument = ref(false)
const showDmDocument = ref(false)
const joinBusy = ref(false)
const busy = ref(false)
const error = ref<string | null>(null)
const probeBusy = ref(false)
const probeResult = ref<OpencodeProbeResult | null>(null)
const probeError = ref<string | null>(null)
const probeCheckedAt = ref<string | null>(null)
const currentPacket = ref<{ roundId: string; packetPath: string; resultPath: string; seatNames: string[] } | null>(null)
const programLogs = ref<Array<{ ts: number; level: 'info' | 'ok' | 'warn' | 'error'; message: string; detail?: string }>>([])
const showDmUpgrade = ref(false)
const dmUpgradeCode = ref('')
const dmUpgradeBusy = ref(false)
const dmUpgradeError = ref<string | null>(null)

let closeEvents: (() => void) | null = null

const lastSeatName = computed(() => localStorage.getItem(LAST_NAME_KEY) || '')
const lastRoomCode = computed(() => localStorage.getItem(LAST_CODE_KEY) || '')
const hasDmConsole = computed(() => session.value?.role === 'dm' || !!session.value?.dmEnabled)

function pushProgramLog(level: 'info' | 'ok' | 'warn' | 'error', message: string, detail?: string) {
  programLogs.value = [
    ...programLogs.value.slice(-79),
    { ts: Date.now(), level, message, detail },
  ]
}

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
  session.value = {
    ...session.value,
    role: snapshot.value.viewer.role,
    dmEnabled: snapshot.value.viewer.dmEnabled,
  }
  persistSession(session.value)
  tree.value = await fetchTreeSession(session.value)
  currentRound.value = snapshot.value.visibleRound
  if (session.value.role === 'dm') activeTab.value = 'dm'
  if (activeTab.value === 'dm' && !hasDmConsole.value) activeTab.value = session.value.role === 'player' ? 'player' : 'shared'
}

function switchTab(tab: 'player' | 'dm' | 'shared') {
  activeTab.value = tab
  showPlayerDocument.value = false
  showDmDocument.value = false
}

function returnMainView() {
  showPlayerDocument.value = false
  showDmDocument.value = false
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

async function join(payload: { name: string; roomCode?: string }) {
  try {
    joinBusy.value = true
    error.value = null
    const name = payload.name.trim()
    const roomCode = payload.roomCode?.trim()
    const token = session.value?.seatName === name ? session.value.token : undefined
    const result = await joinRoom(name, token, roomCode)
    session.value = result.session
    persistSession(result.session)
    if (roomCode) localStorage.setItem(LAST_CODE_KEY, roomCode)
    await hydrate()
    bindEvents()
    pushProgramLog('ok', `宸茶繘鍏ュ腑浣?${result.session.seatName}`, result.session.role)
  } catch (err: any) {
    error.value = err?.message || String(err)
    pushProgramLog('error', '杩涘叆鎴块棿澶辫触', error.value || undefined)
  } finally {
    joinBusy.value = false
  }
}

async function refresh() {
  if (!session.value) return
  await hydrate()
  pushProgramLog('info', '已刷新房间快照')
}

async function leaveRoom() {
  closeEvents?.()
  closeEvents = null
  session.value = null
  snapshot.value = null
  tree.value = null
  previewFile.value = null
  activeFilePath.value = null
  currentRound.value = null
  currentPacket.value = null
  showPlayerDocument.value = false
  showDmDocument.value = false
  showDmUpgrade.value = false
  dmUpgradeCode.value = ''
  dmUpgradeError.value = null
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
    pushProgramLog('info', '已提交创角回合', result.roundId)
    currentPacket.value = null
  } finally {
    busy.value = false
  }
}

async function onComposeRound(payload: { seatNames: string[]; note?: string }) {
  if (!session.value) return
  busy.value = true
  try {
    currentPacket.value = await composeRound(session.value, payload)
    pushProgramLog('ok', '已生成 AI DM 回合包', currentPacket.value.roundId)
    await runRound(session.value, { kind: 'action', roundId: currentPacket.value.roundId })
    pushProgramLog('info', '已从 AI 监控台重跑当前队列', currentPacket.value.roundId)
    await refresh()
  } finally {
    busy.value = false
  }
}

async function onRunAction(roundId: string) {
  if (!session.value) return
  busy.value = true
  try {
    pushProgramLog('info', '寮€濮嬫墽琛?AI DM 鍥炲悎', roundId)
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
  activeFilePath.value = path
  showPlayerDocument.value = activeTab.value === 'player' && session.value.role === 'player'
  showDmDocument.value = activeTab.value === 'dm' && hasDmConsole.value
  try {
    previewFile.value = await fetchFileSession(session.value, path)
  } catch (err: any) {
    previewFile.value = {
      path,
      size: 0,
      mtime: Date.now(),
      frontmatter: null,
      content: `鏃犳硶鎵撳紑姝ゆ枃浠讹細${err?.message || String(err)}`,
    }
  }
}

async function runProbe() {
  if (!session.value) return
  probeBusy.value = true
  probeError.value = null
  pushProgramLog('info', '寮€濮?opencode 鍚庡彴鏍￠獙', session.value.seatName)
  try {
    probeResult.value = await probeOpencode(session.value)
    probeCheckedAt.value = new Date().toISOString()
    if (!probeResult.value.ok) {
      probeError.value = probeResult.value.error || probeResult.value.stderr || probeResult.value.stdout || `opencode exited with ${probeResult.value.code ?? 'unknown'}`
      pushProgramLog('error', 'opencode 鍚庡彴鏍￠獙澶辫触', probeError.value)
    } else {
      pushProgramLog('ok', 'opencode 鍚庡彴鏍￠獙閫氳繃', `${probeResult.value.model} 路 ${probeResult.value.durationMs}ms`)
    }
  } catch (err: any) {
    probeResult.value = null
    probeCheckedAt.value = new Date().toISOString()
    probeError.value = err?.message || String(err)
    pushProgramLog('error', 'opencode 鍚庡彴鏍￠獙寮傚父', probeError.value || undefined)
  } finally {
    probeBusy.value = false
  }
}

async function enableDmConsole() {
  if (!session.value) return
  dmUpgradeBusy.value = true
  dmUpgradeError.value = null
  try {
    const result = await enableDmConsoleSession(session.value, dmUpgradeCode.value)
    session.value = result.session
    persistSession(result.session)
    activeTab.value = 'dm'
    showDmUpgrade.value = false
    dmUpgradeCode.value = ''
    await hydrate()
    bindEvents()
    pushProgramLog('ok', '已为当前席位启用 AI 监控台', result.session.seatName)
  } catch (err: any) {
    dmUpgradeError.value = err?.message || String(err)
    pushProgramLog('error', '启用 AI 监控台失败', dmUpgradeError.value || undefined)
  } finally {
    dmUpgradeBusy.value = false
  }
}

watch(() => hasDmConsole.value, (enabled) => {
  if (enabled && !probeResult.value && !probeBusy.value) {
    void runProbe()
  }
})

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
    :last-room-code="lastRoomCode"
    @join="join"
  />

  <div v-else class="flex h-full flex-col bg-paper-100">
    <ShellHeader
      :session="session"
      :snapshot="snapshot"
      :active-tab="activeTab"
      :probing="probeBusy"
      :probe-result="probeResult"
      :probe-error="probeError"
      :probe-checked-at="probeCheckedAt"
      :current-path="activeFilePath"
      @switch-tab="switchTab"
      @refresh="refresh"
      @probe="runProbe"
      @leave="leaveRoom"
      @enable-dm="showDmUpgrade = true"
    />

    <div v-if="showDmUpgrade" class="absolute inset-0 z-30 flex items-center justify-center bg-paper-950/35 px-4">
      <div class="w-full max-w-md rounded-sm border-2 border-paper-950 bg-white shadow-[0_12px_40px_rgba(12,10,9,0.18)]">
        <div class="border-b-2 border-paper-950 px-5 py-4">
          <div class="font-mono text-[10px] font-bold tracking-[0.18em] text-paper-700">添加 AI 监控台</div>
          <div class="mt-1 text-sm leading-6 text-paper-800">输入房间口令后，当前席位会临时获得 AI 运行监控权限。</div>
        </div>
        <div class="space-y-4 px-5 py-4">
          <label class="block space-y-2">
            <div class="font-mono text-[10px] tracking-[0.18em] text-paper-700">DM CODE</div>
            <input
              v-model="dmUpgradeCode"
              type="password"
              autocomplete="current-password"
              class="clash-input w-full px-3 py-3 font-sans text-sm"
              placeholder="由房主提供"
              @keydown.enter.prevent="enableDmConsole"
            />
          </label>
          <div v-if="dmUpgradeError" class="rounded-sm border border-crimson-200 bg-crimson-50 px-3 py-2 text-sm text-crimson-700">
            {{ dmUpgradeError }}
          </div>
          <div class="flex justify-end gap-2">
            <button
              @click="showDmUpgrade = false"
              class="rounded-sm border border-paper-300 bg-white px-3 py-2 font-mono text-[10px] font-bold tracking-[0.12em] text-paper-800"
            >
              取消
            </button>
            <button
              @click="enableDmConsole"
              :disabled="dmUpgradeBusy || !dmUpgradeCode.trim()"
              class="rounded-sm border border-navy-800 bg-navy-800 px-3 py-2 font-mono text-[10px] font-bold tracking-[0.12em] text-white disabled:opacity-40"
            >
              {{ dmUpgradeBusy ? '验证中...' : '启用 AI 监控台' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <main class="flex min-h-0 flex-1">
      <div class="hidden w-72 shrink-0 border-r-2 border-paper-950 bg-white xl:block">
        <SessionTree
          :snapshot="snapshot"
          :tree="tree?.tree || null"
          :current-path="activeFilePath"
          :active-tab="activeTab"
          @open-file="openFile"
          @return-home="returnMainView"
        />
      </div>

      <div class="min-w-0 flex-1 overflow-y-auto px-6 py-6">
        <template v-if="activeTab === 'player' && session.role === 'player'">
          <PlayerDocumentReader
            v-if="showPlayerDocument"
            :file="previewFile"
            @close="showPlayerDocument = false"
          />
          <PlayerWorkspace
            v-else
            :session="session"
            :snapshot="snapshot"
            :busy="busy"
            :round="currentRound"
            :preview-file="previewFile"
            @save-intent="saveIntent"
            @respond-transfer="onRespondTransfer"
            @run-forge="onRunForge"
            @open-file="openFile"
          />
        </template>

        <DMConsole
          v-else-if="activeTab === 'dm' && hasDmConsole && !showDmDocument"
          :session="session"
          :snapshot="snapshot"
          :busy="busy"
          :round="currentRound"
          :current-packet="currentPacket"
          :preview-file="previewFile"
          :probe-busy="probeBusy"
          :probe-result="probeResult"
          :probe-error="probeError"
          :probe-checked-at="probeCheckedAt"
          :program-logs="programLogs"
          @compose="onComposeRound"
          @run-action="onRunAction"
          @assign="onAssign"
          @release-seat="onReleaseSeat"
          @open-file="openFile"
          @probe="runProbe"
        />

        <PlayerDocumentReader
          v-else-if="activeTab === 'dm' && hasDmConsole && showDmDocument"
          :file="previewFile"
          title="AI 监控文件浏览"`r`n          return-label="返回 AI 监控台"
          @close="showDmDocument = false"
        />

        <SharedBoard
          v-else
          :session="session"
          :snapshot="snapshot"
          :tree="tree?.tree || null"
          :preview-file="previewFile"
          @open-file="openFile"
        />
      </div>
    </main>
  </div>
</template>

