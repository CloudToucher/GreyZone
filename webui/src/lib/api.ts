export interface TreeNode {
  name: string
  path: string
  type: 'dir' | 'file'
  children?: TreeNode[]
}

export interface FilePayload {
  path: string
  size: number
  mtime: number
  frontmatter: Record<string, unknown> | null
  content: string
}

export interface SessionCredentials {
  seatName: string
  role: 'dm' | 'player'
  token: string
  dmEnabled?: boolean
}

export interface IntentSections {
  public: string
  privateToDm: string
  longTerm: string
  triggers: string
}

export interface IntentDocument {
  seatName: string
  updatedAt: string | null
  sections: IntentSections
  raw: string
}

export interface CharacterSummary {
  path: string
  name: string
  controller: string | null
  title: string
  concept: string
  currentSituation: string
  location: string
  sceneId: string
  partyId: string
  visibilityScope: 'private' | 'scene' | 'public'
  inventory: string[]
  safeBox: Array<{ label: string; item: string; empty: boolean }>
  semanticStatus: string[]
  stats: {
    level?: string | number
    xp?: string | number
    blood?: {
      total: number
      light: number
      severe: number
      narrative?: string
    }
    energy?: {
      current: number
      max: number
    }
    hp?: string
    sp?: string
    ap?: string | number
    attributes?: Record<string, number>
  }
}

export interface ControlBinding {
  characterPath: string
  label: string
  primarySeat: string | null
  dmHosted: boolean
  visibleTo: string[]
  pendingTransfer: {
    toSeat: string | null
    requestedBy: string | null
    requestedAt: string | null
  } | null
}

export interface PublicIntentSummary {
  seatName: string
  status: 'idle' | 'ready' | 'submitted' | 'locked'
  updatedAt: string | null
  publicText: string
  longTerm: string
  characterNames: string[]
  characterPaths: string[]
  sceneId: string
  location: string
}

export interface SceneThread {
  id: string
  location: string
  partyIds: string[]
  seatNames: string[]
  characters: Array<{
    name: string
    path: string
    controller: string | null
    location: string
    partyId: string
  }>
  statuses: Array<{ seatName: string; status: 'idle' | 'ready' | 'submitted' | 'locked' }>
}

export interface LatestResultSummary {
  id: string
  path: string
  updatedAt: string
  title: string
  excerpt: string
  visibility: 'public' | 'scene' | 'private'
}

export interface AiQueueItem {
  id: string
  kind: 'action' | 'forge'
  status: 'waiting' | 'composing' | 'running' | 'done' | 'error'
  participantSeats: string[]
  sceneIds: string[]
  packetPath?: string
  resultPath?: string | null
  updatedAt: string
  error?: string | null
}

export interface RoomSnapshot {
  room: {
    version: number
    title: string
    ruleset: string
    ownerSeat: string
    phase: 'idle' | 'composing' | 'running'
    currentRoundId: string | null
    sharedBoardPath: string
    createdAt: string
    updatedAt: string
  }
  viewer: {
    seatName: string
    role: 'dm' | 'player'
    dmEnabled?: boolean
  }
  seats: Array<{
    name: string
    role: 'dm' | 'player'
    status: 'idle' | 'ready' | 'submitted' | 'locked'
    occupied: boolean
    online: boolean
    lastSeenAt: string | null
    controlledCharacterCount: number
  }>
  myIntent: IntentDocument
  visibleCharacters: CharacterSummary[]
  control: ControlBinding[]
  allIntents?: IntentDocument[]
  publicIntents: PublicIntentSummary[]
  sceneThreads: SceneThread[]
  latestResults: LatestResultSummary[]
  aiQueue: AiQueueItem[]
  sharedBoard: FilePayload | null
  archives: Array<{
    id: string
    kind: 'action' | 'forge'
    packetPath: string
    resultPath: string | null
    updatedAt: string
  }>
  visibleRound: VisibleRoundState | null
  documentShortcuts: Array<{ title: string; path: string }>
}

export interface VisibleRoundState {
  id: string
  kind: 'action' | 'forge'
  status: 'idle' | 'running' | 'done' | 'error'
  startedAt: string
  endedAt?: string
  exitCode?: number | null
  error?: string | null
  participantSeats: string[]
  packetPath?: string
  resultPath?: string
  affectedFiles: string[]
  logs?: Array<{ stream: 'stdout' | 'stderr' | 'meta'; text: string; ts: number }>
}

export interface ForgePayload {
  name?: string
  concept?: string
  identity?: string
  motivation?: string
  strength?: string
  storyTone?: string
  signatureWish?: string
  weaknesses?: string
  boundaries?: string
  extraNotes?: string
  fileHint?: string
}

export interface OpencodeProbeResult {
  ok: boolean
  code: number | null
  stdout: string
  stderr: string
  model: string
  title: string
  command: string
  xdgConfigHome: string
  timedOut: boolean
  durationMs: number
  error?: string
  diagnosis?: string
}

export interface DiceStats {
  dice: Record<string, number>
  raw: Record<string, number[]>
  total: number
  generatedAt: string | null
}

function authHeaders(session?: SessionCredentials) {
  const headers: Record<string, string> = {}
  if (session) {
    headers['x-gz-seat'] = encodeURIComponent(session.seatName)
    headers['x-gz-token'] = session.token
  }
  return headers
}

async function parseJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const message = typeof data?.error === 'string' ? data.error : `${res.status} ${res.statusText}`
    throw new Error(message)
  }
  return data as T
}

async function getJson<T>(url: string, session?: SessionCredentials): Promise<T> {
  const res = await fetch(url, {
    cache: 'no-store',
    headers: authHeaders(session),
  })
  return parseJson<T>(res)
}

async function sendJson<T>(url: string, method: 'POST' | 'PUT', body: unknown, session?: SessionCredentials): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(session),
    },
    body: JSON.stringify(body),
  })
  return parseJson<T>(res)
}

export async function joinRoom(name: string, token?: string, roomCode?: string) {
  return sendJson<{ session: SessionCredentials }>('/api/session/join', 'POST', { name, token, roomCode })
}

export async function releaseSeatSession(session: SessionCredentials, seatName: string) {
  return sendJson<{ ok: true }>('/api/session/release', 'POST', { seatName }, session)
}

export async function enableDmConsoleSession(session: SessionCredentials, roomCode: string) {
  return sendJson<{ session: SessionCredentials }>('/api/session/enable-dm', 'POST', { roomCode }, session)
}

export async function fetchSnapshot(session: SessionCredentials) {
  return getJson<RoomSnapshot>('/api/session/snapshot', session)
}

export async function fetchMyIntent(session: SessionCredentials) {
  return getJson<IntentDocument>('/api/intents/self', session)
}

export async function saveMyIntent(
  session: SessionCredentials,
  sections: IntentSections,
  status?: 'idle' | 'ready' | 'submitted' | 'locked',
) {
  return sendJson<IntentDocument>('/api/intents/self', 'PUT', { sections, status }, session)
}

export async function assignCharacter(
  session: SessionCredentials,
  payload: {
    characterPath: string
    primarySeat: string | null
    dmHosted: boolean
    requireAccept?: boolean
  },
) {
  return sendJson<{ ok: true }>('/api/control/assign', 'POST', payload, session)
}

export async function respondToTransfer(
  session: SessionCredentials,
  characterPath: string,
  accept: boolean,
) {
  return sendJson<{ ok: true }>('/api/control/transfer/respond', 'POST', { characterPath, accept }, session)
}

export async function composeRound(
  session: SessionCredentials,
  payload: { seatNames?: string[]; note?: string },
) {
  return sendJson<{ roundId: string; packetPath: string; resultPath: string; seatNames: string[] }>(
    '/api/round/compose',
    'POST',
    payload,
    session,
  )
}

export async function runRound(
  session: SessionCredentials,
  payload:
    | { kind: 'action'; roundId: string }
    | { kind: 'forge'; roundId?: string; forge: ForgePayload },
) {
  return sendJson<{ roundId: string }>('/api/round/run', 'POST', payload, session)
}

export async function fetchTreeSession(session: SessionCredentials) {
  return getJson<{ tree: TreeNode }>('/api/tree', session)
}

export async function fetchFileSession(session: SessionCredentials, relPath: string) {
  return getJson<FilePayload>(`/api/file?path=${encodeURIComponent(relPath)}`, session)
}

export async function saveFileSession(session: SessionCredentials, relPath: string, content: string) {
  return sendJson<{ ok: true }>(`/api/file?path=${encodeURIComponent(relPath)}`, 'PUT', { content }, session)
}

export async function probeOpencode(session: SessionCredentials) {
  const res = await fetch('/api/opencode/probe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(session),
    },
    body: JSON.stringify({}),
  })
  const data = await res.json().catch(() => null) as OpencodeProbeResult | { error?: string } | null
  if (!res.ok) {
    if (data && 'ok' in data) return data as OpencodeProbeResult
    throw new Error(data?.error || `${res.status} ${res.statusText}`)
  }
  return data as OpencodeProbeResult
}

export function openEvents(
  session: SessionCredentials,
  handlers: {
    onSnapshot?: (snapshot: RoomSnapshot) => void
    onRefresh?: (payload: { reason: string; ts: number }) => void
    onRound?: (round: VisibleRoundState | null) => void
  },
) {
  const url = `/api/events/stream?seat=${encodeURIComponent(session.seatName)}&token=${encodeURIComponent(session.token)}`
  const source = new EventSource(url)

  source.addEventListener('snapshot', (event) => {
    try {
      handlers.onSnapshot?.(JSON.parse((event as MessageEvent).data) as RoomSnapshot)
    } catch {
      /* ignore */
    }
  })

  source.addEventListener('snapshot-refresh', (event) => {
    try {
      handlers.onRefresh?.(JSON.parse((event as MessageEvent).data) as { reason: string; ts: number })
    } catch {
      /* ignore */
    }
  })

  source.addEventListener('round', (event) => {
    try {
      handlers.onRound?.(JSON.parse((event as MessageEvent).data) as VisibleRoundState | null)
    } catch {
      /* ignore */
    }
  })

  return () => source.close()
}

// Legacy exports kept only so the old prototype files still type-check.
export type Panel = 'dm' | 'player'

function withPlayer(url: string, player?: string): string {
  if (!player) return url
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}player=${encodeURIComponent(player)}`
}

export function fetchTree(_panel: Panel, _opts?: { player?: string }) {
  return getJson<{ panel: Panel; player?: string | null; tree: TreeNode }>(withPlayer('/api/tree'))
}

export function fetchFile(_panel: Panel, relPath: string, _opts?: { player?: string }) {
  return getJson<FilePayload>(`/api/file?path=${encodeURIComponent(relPath)}`)
}

export async function saveFile(_panel: Panel, relPath: string, content: string, _opts?: { player?: string }) {
  return sendJson<{ ok: true }>(`/api/file?path=${encodeURIComponent(relPath)}`, 'PUT', { content })
}

export interface RoundStartBody {
  panel: Panel
  kind?: 'action' | 'forge'
  player?: string
  action: string
  character?: string
  prompt?: string
  forge?: ForgePayload
}

export interface RoundEvent {
  type: 'start' | 'stdout' | 'stderr' | 'end' | 'error' | 'meta'
  data?: string
  code?: number | null
  ts: number
}

export type RoundHandler = (ev: RoundEvent) => void

export async function startRound(_body: RoundStartBody): Promise<{ roundId: string }> {
  return { roundId: 'legacy-disabled' }
}

export function streamRound(_roundId: string, _onEvent: RoundHandler, _onOpen?: () => void): () => void {
  return () => {}
}

export async function fetchDiceStats(): Promise<DiceStats | null> {
  return null
}

export async function generateDicePool(): Promise<{ message: string; stats: DiceStats | null }> {
  return { message: 'disabled', stats: null }
}
