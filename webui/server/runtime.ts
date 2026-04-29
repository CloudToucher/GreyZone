import type { ServerResponse } from 'node:http'

export interface RuntimeViewer {
  seatName: string
  role: 'dm' | 'player'
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

interface Listener {
  viewer: RuntimeViewer
  res: ServerResponse
}

interface RoundState {
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
  logs: Array<{ stream: 'stdout' | 'stderr' | 'meta'; text: string; ts: number }>
}

const listeners = new Set<Listener>()
let activeRound: RoundState | null = null

function sendSse(res: ServerResponse, event: string, payload: unknown) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
  } catch {
    /* connection gone */
  }
}

function publicRound(round: RoundState): VisibleRoundState {
  return {
    id: round.id,
    kind: round.kind,
    status: round.status,
    startedAt: round.startedAt,
    endedAt: round.endedAt,
    exitCode: round.exitCode,
    error: round.error,
    participantSeats: round.participantSeats,
    packetPath: round.packetPath,
    resultPath: round.resultPath,
    affectedFiles: round.affectedFiles,
  }
}

export function getVisibleRound(viewer: RuntimeViewer): VisibleRoundState | null {
  if (!activeRound) return null
  if (viewer.role === 'dm') return { ...publicRound(activeRound), logs: activeRound.logs.slice(-200) }
  return publicRound(activeRound)
}

export function attachEventsStream(res: ServerResponse, viewer: RuntimeViewer) {
  const listener: Listener = { res, viewer }
  listeners.add(listener)

  res.statusCode = 200
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.write('retry: 2000\n\n')

  const visible = getVisibleRound(viewer)
  if (visible) sendSse(res, 'round', visible)

  res.on('close', () => {
    listeners.delete(listener)
  })
}

export function emitSnapshotRefresh(reason: string) {
  for (const listener of listeners) {
    sendSse(listener.res, 'snapshot-refresh', { reason, ts: Date.now() })
  }
}

function emitRoundUpdate() {
  for (const listener of listeners) {
    sendSse(listener.res, 'round', getVisibleRound(listener.viewer))
  }
}

export function beginRound(round: Omit<RoundState, 'logs'>) {
  activeRound = { ...round, logs: [] }
  emitRoundUpdate()
  emitSnapshotRefresh('round-started')
}

export function appendRoundLog(stream: 'stdout' | 'stderr' | 'meta', text: string) {
  if (!activeRound || !text.trim()) return
  activeRound.logs.push({ stream, text, ts: Date.now() })
  if (activeRound.logs.length > 400) {
    activeRound.logs.splice(0, activeRound.logs.length - 400)
  }
  emitRoundUpdate()
}

export function finishRound(update: {
  status: 'done' | 'error'
  endedAt: string
  exitCode?: number | null
  error?: string | null
  resultPath?: string
  affectedFiles?: string[]
}) {
  if (!activeRound) return
  activeRound.status = update.status
  activeRound.endedAt = update.endedAt
  activeRound.exitCode = update.exitCode
  activeRound.error = update.error ?? null
  if (update.resultPath) activeRound.resultPath = update.resultPath
  if (update.affectedFiles) activeRound.affectedFiles = update.affectedFiles
  emitRoundUpdate()
  emitSnapshotRefresh('round-finished')
}
