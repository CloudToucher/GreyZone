import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import { readCharacterSummary, type CharacterSummary } from './grayZone'
import type { VisibleRoundState } from './runtime'

export interface ViewerSession {
  seatName: string
  role: 'dm' | 'player'
  token: string
}

export interface SeatRecord {
  name: string
  role: 'dm' | 'player'
  occupied: boolean
  tokenHash: string | null
  status: 'idle' | 'ready' | 'submitted' | 'locked'
  online: boolean
  lastSeenAt: string | null
}

export interface PendingTransfer {
  toSeat: string | null
  requestedBy: string | null
  requestedAt: string | null
}

export interface ControlBinding {
  characterPath: string
  label: string
  primarySeat: string | null
  dmHosted: boolean
  visibleTo: string[]
  pendingTransfer: PendingTransfer | null
}

export interface RoomState {
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

export interface ArchiveEntry {
  id: string
  packetPath: string
  resultPath: string | null
  updatedAt: string
}

export interface TreeNode {
  name: string
  path: string
  type: 'dir' | 'file'
  children?: TreeNode[]
}

export interface VisibleFile {
  path: string
  size: number
  mtime: number
  frontmatter: Record<string, unknown> | null
  content: string
}

export interface RoomSnapshot {
  room: RoomState
  viewer: { seatName: string; role: 'dm' | 'player' }
  seats: Array<{
    name: string
    role: 'dm' | 'player'
    status: SeatRecord['status']
    occupied: boolean
    online: boolean
    lastSeenAt: string | null
    controlledCharacterCount: number
  }>
  myIntent: IntentDocument
  visibleCharacters: CharacterSummary[]
  control: ControlBinding[]
  allIntents?: IntentDocument[]
  sharedBoard: VisibleFile | null
  archives: ArchiveEntry[]
  visibleRound: VisibleRoundState | null
  documentShortcuts: Array<{ title: string; path: string }>
}

interface SeatsFile {
  version: number
  seats: SeatRecord[]
}

interface ControlFile {
  version: number
  bindings: ControlBinding[]
}

const TABLE_DIR = 'table'
const ROOM_FILE = `${TABLE_DIR}/room.yaml`
const SEATS_FILE = `${TABLE_DIR}/seats.yaml`
const CONTROL_FILE = `${TABLE_DIR}/control.yaml`
const SHARED_BOARD_FILE = `${TABLE_DIR}/shared_board.md`
const INTENTS_DIR = `${TABLE_DIR}/intents`
const ROUNDS_DIR = `${TABLE_DIR}/rounds`

const PUBLIC_DOCS = new Set([
  'README.md',
  '开始游戏.md',
  'playground.md',
])

const PUBLIC_PREFIXES = ['rules', 'assets/items']
const PLAYER_HIDDEN_PREFIXES = ['dm_guide', 'scenes', 'story', 'assets/enemies', 'assets/npcs', 'tools', 'webui', '.git', 'node_modules']
const DM_HIDDEN_PREFIXES = ['webui', '.git', 'node_modules']

function nowIso() {
  return new Date().toISOString()
}

function normalizeSeatName(name: string) {
  return name.trim().replace(/\s+/g, ' ').slice(0, 40)
}

function relPath(...parts: string[]) {
  return parts.join('/').replace(/\\/g, '/')
}

function absolute(root: string, rel: string) {
  return path.resolve(root, rel)
}

function toPosix(p: string) {
  return p.split(path.sep).join('/')
}

function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

async function exists(abs: string) {
  try {
    await fs.access(abs)
    return true
  } catch {
    return false
  }
}

async function readYamlFile<T>(abs: string): Promise<T> {
  const raw = await fs.readFile(abs, 'utf8')
  const data = yaml.load(raw)
  return data as T
}

async function writeYamlFile(abs: string, value: unknown) {
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, yaml.dump(value, { lineWidth: 120, noRefs: true, sortKeys: false }), 'utf8')
}

function splitFrontmatter(text: string): {
  frontmatter: Record<string, unknown> | null
  body: string
} {
  if (!text.startsWith('---')) return { frontmatter: null, body: text }
  const end = text.indexOf('\n---', 3)
  if (end === -1) return { frontmatter: null, body: text }
  const raw = text.slice(3, end).replace(/^\r?\n/, '')
  const body = text.slice(end + 4).replace(/^\r?\n/, '')
  try {
    const data = yaml.load(raw)
    if (data && typeof data === 'object') {
      return { frontmatter: data as Record<string, unknown>, body }
    }
  } catch {
    /* ignore */
  }
  return { frontmatter: null, body: text }
}

async function listCharacterFiles(root: string) {
  const dir = absolute(root, 'characters/active')
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
    .map((entry) => relPath('characters/active', entry.name))
}

function defaultSharedBoard() {
  return [
    '# Shared Board',
    '',
    '## Public Situation',
    '- The room is initialized. DM can update this board each round.',
    '',
    '## Current Focus',
    '- Waiting for player submissions.',
    '',
    '## Recent Confirmed Changes',
    '- None yet.',
    '',
  ].join('\n')
}

export function sanitizeFileStem(input: string) {
  const trimmed = input.trim()
  if (!trimmed) return 'new_character'
  return trimmed.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 64)
}

function createIntentTemplate(seatName: string, updatedAt = nowIso()): string {
  return [
    `seat: ${seatName}`,
    `updated_at: ${updatedAt}`,
    '---',
    '',
    '# Intent Workspace',
    '',
    '## Public',
    '',
    '',
    '## Private For DM',
    '',
    '',
    '## Long Term',
    '',
    '',
    '## Triggers',
    '',
    '',
  ].join('\n')
}

export function parseIntentMarkdown(seatName: string, raw: string): IntentDocument {
  let body = raw
  let updatedAt: string | null = null
  if (raw.startsWith('---')) {
    const end = raw.indexOf('\n---', 3)
    if (end !== -1) {
      const frontmatterRaw = raw.slice(3, end).replace(/^\r?\n/, '')
      try {
        const frontmatter = yaml.load(frontmatterRaw) as Record<string, unknown> | null
        if (typeof frontmatter?.updated_at === 'string') updatedAt = frontmatter.updated_at
      } catch {
        /* ignore */
      }
      body = raw.slice(end + 4).replace(/^\r?\n/, '')
    }
  }

  const section = (title: string) => {
    const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`##\\s*${escaped}[\\s\\S]*?(?=\\n##|$)`)
    const match = body.match(re)?.[0] || ''
    return match
      .split('\n')
      .slice(1)
      .join('\n')
      .trim()
  }

  return {
    seatName,
    updatedAt,
    raw,
    sections: {
      public: section('Public'),
      privateToDm: section('Private For DM'),
      longTerm: section('Long Term'),
      triggers: section('Triggers'),
    },
  }
}

export function renderIntentMarkdown(seatName: string, sections: IntentSections, updatedAt = nowIso()) {
  return [
    '---',
    `seat: ${seatName}`,
    `updated_at: ${updatedAt}`,
    '---',
    '',
    '# Intent Workspace',
    '',
    '## Public',
    sections.public.trim(),
    '',
    '## Private For DM',
    sections.privateToDm.trim(),
    '',
    '## Long Term',
    sections.longTerm.trim(),
    '',
    '## Triggers',
    sections.triggers.trim(),
    '',
  ].join('\n')
}

async function loadRoom(root: string) {
  return readYamlFile<RoomState>(absolute(root, ROOM_FILE))
}

async function saveRoom(root: string, room: RoomState) {
  room.updatedAt = nowIso()
  await writeYamlFile(absolute(root, ROOM_FILE), room)
}

async function loadSeats(root: string) {
  return readYamlFile<SeatsFile>(absolute(root, SEATS_FILE))
}

async function saveSeats(root: string, seats: SeatsFile) {
  await writeYamlFile(absolute(root, SEATS_FILE), seats)
}

async function loadControl(root: string) {
  return readYamlFile<ControlFile>(absolute(root, CONTROL_FILE))
}

async function saveControl(root: string, control: ControlFile) {
  await writeYamlFile(absolute(root, CONTROL_FILE), control)
}

export async function ensureTableState(root: string) {
  await fs.mkdir(absolute(root, INTENTS_DIR), { recursive: true })
  await fs.mkdir(absolute(root, ROUNDS_DIR), { recursive: true })

  const roomExists = await exists(absolute(root, ROOM_FILE))
  const seatsExists = await exists(absolute(root, SEATS_FILE))
  const controlExists = await exists(absolute(root, CONTROL_FILE))
  const sharedExists = await exists(absolute(root, SHARED_BOARD_FILE))

  const createdAt = nowIso()
  if (!roomExists) {
    await writeYamlFile(absolute(root, ROOM_FILE), {
      version: 1,
      title: 'Gray Zone Table',
      ruleset: 'gray-zone',
      ownerSeat: 'DM',
      phase: 'idle',
      currentRoundId: null,
      sharedBoardPath: SHARED_BOARD_FILE,
      createdAt,
      updatedAt: createdAt,
    } satisfies RoomState)
  }

  const charPaths = await listCharacterFiles(root)
  const charSummaries = (
    await Promise.all(
      charPaths.map(async (rel) => readCharacterSummary(absolute(root, rel), rel)),
    )
  ).filter((entry): entry is CharacterSummary => !!entry)

  if (!seatsExists) {
    const seatNames = new Set(['DM', ...charSummaries.map((entry) => entry.controller).filter(Boolean) as string[]])
    const seats: SeatRecord[] = [...seatNames].map((name) => ({
      name,
      role: name === 'DM' ? 'dm' : 'player',
      occupied: false,
      tokenHash: null,
      status: 'idle',
      online: false,
      lastSeenAt: null,
    }))
    await writeYamlFile(absolute(root, SEATS_FILE), { version: 1, seats })
  }

  if (!controlExists) {
    const bindings: ControlBinding[] = charSummaries.map((entry) => ({
      characterPath: entry.path,
      label: entry.name,
      primarySeat: entry.controller,
      dmHosted: !entry.controller,
      visibleTo: entry.controller ? [entry.controller] : [],
      pendingTransfer: null,
    }))
    await writeYamlFile(absolute(root, CONTROL_FILE), { version: 1, bindings })
  }

  if (!sharedExists) {
    await fs.writeFile(absolute(root, SHARED_BOARD_FILE), defaultSharedBoard(), 'utf8')
  }

  await reconcileTableFromCharacters(root)
}

export async function reconcileTableFromCharacters(root: string) {
  const room = await loadRoom(root)
  const seatsFile = await loadSeats(root)
  const controlFile = await loadControl(root)
  const charPaths = await listCharacterFiles(root)
  const charSummaries = (
    await Promise.all(charPaths.map(async (rel) => readCharacterSummary(absolute(root, rel), rel)))
  ).filter((entry): entry is CharacterSummary => !!entry)

  const seatNames = new Set(seatsFile.seats.map((seat) => seat.name))
  seatNames.add(room.ownerSeat)

  for (const summary of charSummaries) {
    if (summary.controller) seatNames.add(summary.controller)
  }

  const nextSeats = [...seatNames].map((name) => {
    const current = seatsFile.seats.find((seat) => seat.name === name)
    return current || {
      name,
      role: (name === room.ownerSeat ? 'dm' : 'player') as 'dm' | 'player',
      occupied: false,
      tokenHash: null,
      status: 'idle' as const,
      online: false,
      lastSeenAt: null,
    }
  })
  seatsFile.seats = nextSeats
  await saveSeats(root, seatsFile)

  const nextBindings = charSummaries.map((summary) => {
    const current = controlFile.bindings.find((binding) => binding.characterPath === summary.path)
    const primarySeat = current?.pendingTransfer ? current.primarySeat : summary.controller
    return {
      characterPath: summary.path,
      label: summary.name,
      primarySeat: current?.pendingTransfer ? current.primarySeat : primarySeat,
      dmHosted: current?.pendingTransfer ? current.dmHosted : !primarySeat,
      visibleTo: Array.from(new Set([...(current?.visibleTo || []), ...(primarySeat ? [primarySeat] : [])])),
      pendingTransfer: current?.pendingTransfer || null,
    } satisfies ControlBinding
  })

  controlFile.bindings = nextBindings
  await saveControl(root, controlFile)

  for (const seat of seatsFile.seats) {
    const intentPath = absolute(root, relPath(INTENTS_DIR, `${sanitizeFileStem(seat.name)}.md`))
    if (!(await exists(intentPath))) {
      await fs.writeFile(intentPath, createIntentTemplate(seat.name), 'utf8')
    }
  }
}

export async function authenticateViewer(root: string, seatName: string, token: string) {
  await ensureTableState(root)
  const seatsFile = await loadSeats(root)
  const seat = seatsFile.seats.find((entry) => entry.name === seatName)
  if (!seat || !seat.tokenHash) return null
  if (seat.tokenHash !== tokenHash(token)) return null
  seat.online = true
  seat.lastSeenAt = nowIso()
  await saveSeats(root, seatsFile)
  return {
    seatName: seat.name,
    role: seat.role,
    token,
  } satisfies ViewerSession
}

export async function joinSeat(root: string, rawName: string, providedToken?: string) {
  await ensureTableState(root)
  const seatName = normalizeSeatName(rawName)
  if (!seatName) throw new Error('Seat name is required')

  const room = await loadRoom(root)
  const seatsFile = await loadSeats(root)
  let seat = seatsFile.seats.find((entry) => entry.name === seatName)
  const nextToken = providedToken?.trim() || randomUUID()
  const nextHash = tokenHash(nextToken)

  if (seat?.tokenHash && seat.tokenHash !== nextHash) {
    throw new Error('Seat already occupied')
  }

  if (!seat) {
    seat = {
      name: seatName,
      role: seatName === room.ownerSeat ? 'dm' : 'player',
      occupied: true,
      tokenHash: nextHash,
      status: 'idle',
      online: true,
      lastSeenAt: nowIso(),
    }
    seatsFile.seats.push(seat)
  } else {
    seat.occupied = true
    seat.tokenHash = nextHash
    seat.online = true
    seat.lastSeenAt = nowIso()
  }

  await saveSeats(root, seatsFile)
  const intentPath = absolute(root, relPath(INTENTS_DIR, `${sanitizeFileStem(seat.name)}.md`))
  if (!(await exists(intentPath))) {
    await fs.writeFile(intentPath, createIntentTemplate(seat.name), 'utf8')
  }

  return {
    seatName: seat.name,
    role: seat.role,
    token: nextToken,
  } satisfies ViewerSession
}

export async function releaseSeat(root: string, viewer: ViewerSession, seatName: string) {
  if (viewer.role !== 'dm') throw new Error('Only DM can release seats')
  const seatsFile = await loadSeats(root)
  const seat = seatsFile.seats.find((entry) => entry.name === seatName)
  if (!seat) throw new Error('Seat not found')
  seat.occupied = false
  seat.tokenHash = null
  seat.online = false
  seat.status = 'idle'
  seat.lastSeenAt = nowIso()
  await saveSeats(root, seatsFile)
}

export async function updateSeatStatus(root: string, seatName: string, status: SeatRecord['status']) {
  const seatsFile = await loadSeats(root)
  const seat = seatsFile.seats.find((entry) => entry.name === seatName)
  if (!seat) throw new Error('Seat not found')
  seat.status = status
  seat.lastSeenAt = nowIso()
  await saveSeats(root, seatsFile)
}

export async function getIntentPathForSeat(root: string, seatName: string) {
  await ensureTableState(root)
  return absolute(root, relPath(INTENTS_DIR, `${sanitizeFileStem(seatName)}.md`))
}

export async function loadIntentForSeat(root: string, seatName: string) {
  const abs = await getIntentPathForSeat(root, seatName)
  const raw = await fs.readFile(abs, 'utf8')
  return parseIntentMarkdown(seatName, raw)
}

export async function saveIntentForSeat(root: string, seatName: string, sections: IntentSections) {
  const raw = renderIntentMarkdown(seatName, sections)
  const abs = await getIntentPathForSeat(root, seatName)
  await fs.writeFile(abs, raw, 'utf8')
  return parseIntentMarkdown(seatName, raw)
}

export async function assignControl(root: string, viewer: ViewerSession, args: {
  characterPath: string
  primarySeat: string | null
  dmHosted: boolean
  requireAccept?: boolean
}) {
  if (viewer.role !== 'dm') throw new Error('Only DM can assign control')
  const controlFile = await loadControl(root)
  const binding = controlFile.bindings.find((entry) => entry.characterPath === args.characterPath)
  if (!binding) throw new Error('Character binding not found')

  if (args.requireAccept && args.primarySeat && binding.primarySeat !== args.primarySeat) {
    binding.pendingTransfer = {
      toSeat: args.primarySeat,
      requestedBy: viewer.seatName,
      requestedAt: nowIso(),
    }
  } else {
    binding.primarySeat = args.dmHosted ? null : args.primarySeat
    binding.dmHosted = args.dmHosted
    binding.pendingTransfer = null
    binding.visibleTo = Array.from(new Set([...(binding.visibleTo || []), ...(args.primarySeat ? [args.primarySeat] : [])]))
    await syncCharacterController(root, binding.characterPath, binding.primarySeat)
  }

  await saveControl(root, controlFile)
}

export async function respondToTransfer(root: string, viewer: ViewerSession, characterPath: string, accept: boolean) {
  const controlFile = await loadControl(root)
  const binding = controlFile.bindings.find((entry) => entry.characterPath === characterPath)
  if (!binding || !binding.pendingTransfer?.toSeat) throw new Error('Pending transfer not found')
  if (binding.pendingTransfer.toSeat !== viewer.seatName) throw new Error('Transfer not assigned to this seat')

  if (accept) {
    binding.primarySeat = viewer.seatName
    binding.dmHosted = false
    binding.visibleTo = Array.from(new Set([...(binding.visibleTo || []), viewer.seatName]))
    await syncCharacterController(root, binding.characterPath, viewer.seatName)
  }
  binding.pendingTransfer = null
  await saveControl(root, controlFile)
}

async function syncCharacterController(root: string, characterPath: string, controller: string | null) {
  const abs = absolute(root, characterPath)
  const raw = await fs.readFile(abs, 'utf8')
  const { frontmatter, body } = splitFrontmatter(raw)
  const nextFrontmatter = {
    ...(frontmatter || {}),
    controller: controller || '',
  }
  const rendered = `---\n${yaml.dump(nextFrontmatter, { lineWidth: 120, noRefs: true, sortKeys: false })}---\n\n${body}`
  await fs.writeFile(abs, rendered, 'utf8')
}

async function readSharedBoard(root: string) {
  return readVisibleFile(root, { seatName: 'DM', role: 'dm', token: '' }, SHARED_BOARD_FILE)
}

function isPublicPath(rel: string) {
  if (PUBLIC_DOCS.has(rel)) return true
  return PUBLIC_PREFIXES.some((prefix) => rel === prefix || rel.startsWith(prefix + '/'))
}

async function canSeeCharacter(root: string, viewer: ViewerSession, rel: string) {
  const controlFile = await loadControl(root)
  const binding = controlFile.bindings.find((entry) => entry.characterPath === rel)
  if (!binding) return false
  if (viewer.role === 'dm') return true
  if (binding.primarySeat === viewer.seatName) return true
  return binding.visibleTo.includes(viewer.seatName)
}

function hiddenByRole(role: 'dm' | 'player', rel: string) {
  const prefixes = role === 'dm' ? DM_HIDDEN_PREFIXES : PLAYER_HIDDEN_PREFIXES
  return prefixes.some((prefix) => rel === prefix || rel.startsWith(prefix + '/'))
}

export async function canReadPath(root: string, viewer: ViewerSession, rel: string) {
  const normalized = rel.replace(/^\/+/, '').replace(/\\/g, '/')
  if (!normalized) return false
  if (hiddenByRole(viewer.role, normalized)) return false
  if (viewer.role === 'dm') return true
  if (isPublicPath(normalized)) return true
  if (normalized === SHARED_BOARD_FILE) return true
  if (normalized.startsWith(`${ROUNDS_DIR}/`) && normalized.endsWith('/result.md')) return true
  if (normalized === relPath(INTENTS_DIR, `${sanitizeFileStem(viewer.seatName)}.md`)) return true
  if (normalized.startsWith('characters/active/') && normalized.endsWith('.md')) {
    return canSeeCharacter(root, viewer, normalized)
  }
  return false
}

export async function canWritePath(root: string, viewer: ViewerSession, rel: string) {
  const normalized = rel.replace(/^\/+/, '').replace(/\\/g, '/')
  if (!(await canReadPath(root, viewer, normalized)) && viewer.role !== 'dm') return false
  if (viewer.role === 'dm') return true
  return normalized === relPath(INTENTS_DIR, `${sanitizeFileStem(viewer.seatName)}.md`)
}

export async function readVisibleFile(root: string, viewer: ViewerSession, rel: string): Promise<VisibleFile | null> {
  const normalized = rel.replace(/^\/+/, '').replace(/\\/g, '/')
  if (!(await canReadPath(root, viewer, normalized))) return null
  const abs = absolute(root, normalized)
  const stat = await fs.stat(abs).catch(() => null)
  if (!stat?.isFile()) return null
  const raw = await fs.readFile(abs, 'utf8')
  const { frontmatter, body } = splitFrontmatter(raw)
  return {
    path: normalized,
    size: stat.size,
    mtime: stat.mtimeMs,
    frontmatter,
    content: body,
  }
}

export async function writeVisibleFile(root: string, viewer: ViewerSession, rel: string, content: string) {
  const normalized = rel.replace(/^\/+/, '').replace(/\\/g, '/')
  if (!(await canWritePath(root, viewer, normalized))) throw new Error('Write forbidden')
  const abs = absolute(root, normalized)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, content, 'utf8')
}

export async function buildTree(root: string, viewer: ViewerSession): Promise<TreeNode> {
  async function walk(absDir: string, relDir: string): Promise<TreeNode | null> {
    const entries = await fs.readdir(absDir, { withFileTypes: true }).catch(() => [])
    const children: TreeNode[] = []

    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.well-known') continue
      const childRel = relDir ? relPath(relDir, entry.name) : entry.name
      if (hiddenByRole(viewer.role, childRel)) continue
      const childAbs = path.join(absDir, entry.name)

      if (entry.isDirectory()) {
        const node = await walk(childAbs, childRel)
        if (node?.children?.length) children.push(node)
        continue
      }

      if (!entry.isFile()) continue
      if (!/\.(md|ya?ml|json)$/i.test(entry.name)) continue
      if (await canReadPath(root, viewer, childRel)) {
        children.push({ name: entry.name, path: childRel, type: 'file' })
      }
    }

    children.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name, 'zh-Hans-CN')
    })

    return { name: relDir ? path.basename(absDir) : 'workspace', path: relDir, type: 'dir', children }
  }

  return (await walk(root, '')) || { name: 'workspace', path: '', type: 'dir', children: [] }
}

export async function createRoundPacket(root: string, viewer: ViewerSession, args: {
  seatNames?: string[]
  note?: string
}) {
  if (viewer.role !== 'dm') throw new Error('Only DM can compose rounds')
  await ensureTableState(root)
  const room = await loadRoom(root)
  const seatsFile = await loadSeats(root)
  const controlFile = await loadControl(root)
  const roundId = randomUUID()
  const seatNames = args.seatNames?.length
    ? args.seatNames
    : seatsFile.seats.filter((seat) => seat.status === 'submitted' || seat.status === 'ready').map((seat) => seat.name)

  const intents = await Promise.all(seatNames.map(async (seatName) => loadIntentForSeat(root, seatName)))
  const bindings = controlFile.bindings.filter((binding) => binding.primarySeat && seatNames.includes(binding.primarySeat))
  const characterBlocks = await Promise.all(
    bindings.map(async (binding) => {
      const payload = await readVisibleFile(root, viewer, binding.characterPath)
      return payload
        ? `### ${binding.label} (${binding.characterPath})\n\n${payload.frontmatter ? `Frontmatter:\n\`\`\`yaml\n${yaml.dump(payload.frontmatter)}\`\`\`\n\n` : ''}${payload.content}`
        : `### ${binding.label} (${binding.characterPath})\n\n(unreadable)`
    }),
  )

  const packetPath = relPath(ROUNDS_DIR, roundId, 'packet.md')
  const resultPath = relPath(ROUNDS_DIR, roundId, 'result.md')

  const packet = [
    '# Round Packet',
    '',
    `- round_id: ${roundId}`,
    `- generated_at: ${nowIso()}`,
    `- dm: ${viewer.seatName}`,
    `- seats: ${seatNames.join(', ') || '(none)'}`,
    `- result_path: ${resultPath}`,
    '',
    '## Room State',
    `- title: ${room.title}`,
    `- ruleset: ${room.ruleset}`,
    '',
    '## DM Note',
    args.note?.trim() || '(none)',
    '',
    '## Player Intents',
    ...intents.flatMap((intent) => [
      `### ${intent.seatName}`,
      '',
      '#### Public',
      intent.sections.public || '(empty)',
      '',
      '#### Private For DM',
      intent.sections.privateToDm || '(empty)',
      '',
      '#### Long Term',
      intent.sections.longTerm || '(empty)',
      '',
      '#### Triggers',
      intent.sections.triggers || '(empty)',
      '',
    ]),
    '## Controlled Characters',
    ...characterBlocks,
    '',
    '## Shared Board',
    (await fs.readFile(absolute(root, SHARED_BOARD_FILE), 'utf8').catch(() => '')),
    '',
  ].join('\n')

  await fs.mkdir(absolute(root, relPath(ROUNDS_DIR, roundId)), { recursive: true })
  await fs.writeFile(absolute(root, packetPath), packet, 'utf8')

  for (const seatName of seatNames) {
    const seat = seatsFile.seats.find((entry) => entry.name === seatName)
    if (seat) seat.status = 'locked'
  }
  await saveSeats(root, seatsFile)

  room.phase = 'composing'
  room.currentRoundId = roundId
  await saveRoom(root, room)

  return { roundId, packetPath, resultPath, seatNames }
}

export async function markRoomRunning(root: string, roundId: string) {
  const room = await loadRoom(root)
  room.phase = 'running'
  room.currentRoundId = roundId
  await saveRoom(root, room)
}

export async function markRoomIdle(root: string) {
  const room = await loadRoom(root)
  room.phase = 'idle'
  room.currentRoundId = null
  await saveRoom(root, room)
}

export async function finalizeSeatsAfterRound(root: string, seatNames: string[]) {
  const seatsFile = await loadSeats(root)
  for (const seatName of seatNames) {
    const seat = seatsFile.seats.find((entry) => entry.name === seatName)
    if (seat && seat.status === 'locked') seat.status = 'idle'
  }
  await saveSeats(root, seatsFile)
}

export async function listArchives(root: string) {
  const roundsAbs = absolute(root, ROUNDS_DIR)
  const entries = await fs.readdir(roundsAbs, { withFileTypes: true }).catch(() => [])
  const archives: ArchiveEntry[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const roundDir = absolute(root, relPath(ROUNDS_DIR, entry.name))
    const packetPath = relPath(ROUNDS_DIR, entry.name, 'packet.md')
    const resultPath = relPath(ROUNDS_DIR, entry.name, 'result.md')
    const packetStat = await fs.stat(absolute(root, packetPath)).catch(() => null)
    const resultStat = await fs.stat(absolute(root, resultPath)).catch(() => null)
    archives.push({
      id: entry.name,
      packetPath,
      resultPath: resultStat ? resultPath : null,
      updatedAt: new Date(Math.max(packetStat?.mtimeMs || 0, resultStat?.mtimeMs || 0)).toISOString(),
    })
    void roundDir
  }
  return archives.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 20)
}

export async function buildSnapshot(root: string, viewer: ViewerSession, visibleRound: VisibleRoundState | null): Promise<RoomSnapshot> {
  await ensureTableState(root)
  const room = await loadRoom(root)
  const seatsFile = await loadSeats(root)
  const controlFile = await loadControl(root)
  const myIntent = await loadIntentForSeat(root, viewer.seatName)

  const charPaths = controlFile.bindings
    .filter((binding) => viewer.role === 'dm' || binding.primarySeat === viewer.seatName || binding.visibleTo.includes(viewer.seatName))
    .map((binding) => binding.characterPath)

  const visibleCharacters = (
    await Promise.all(charPaths.map(async (rel) => readCharacterSummary(absolute(root, rel), rel)))
  ).filter((entry): entry is CharacterSummary => !!entry)

  const seats = seatsFile.seats.map((seat) => ({
    name: seat.name,
    role: seat.role,
    status: seat.status,
    occupied: seat.occupied,
    online: seat.online,
    lastSeenAt: seat.lastSeenAt,
    controlledCharacterCount: controlFile.bindings.filter((binding) => binding.primarySeat === seat.name).length,
  }))

  const sharedBoard = await readSharedBoard(root)
  const archives = await listArchives(root)
  const documentShortcuts = [
    { title: 'Shared Board', path: SHARED_BOARD_FILE },
    { title: 'Rules Quick Index', path: 'rules/00_规则速查索引.md' },
    { title: 'Core Rules', path: 'rules/01_核心规则书.md' },
    { title: 'Character Forge Guide', path: 'characters/templates/角色生成指南.md' },
  ]

  const snapshot: RoomSnapshot = {
    room,
    viewer: { seatName: viewer.seatName, role: viewer.role },
    seats,
    myIntent,
    visibleCharacters,
    control: viewer.role === 'dm'
      ? controlFile.bindings
      : controlFile.bindings.filter((binding) => binding.primarySeat === viewer.seatName || binding.visibleTo.includes(viewer.seatName)),
    sharedBoard,
    archives,
    visibleRound,
    documentShortcuts,
  }

  if (viewer.role === 'dm') {
    snapshot.allIntents = await Promise.all(seatsFile.seats.map(async (seat) => loadIntentForSeat(root, seat.name)))
  }

  return snapshot
}
