import { promises as fs } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import {
  assignControl,
  authenticateViewer,
  buildSnapshot,
  buildTree,
  canWritePath,
  createRoundPacket,
  enableDmConsole,
  ensureTableState,
  joinSeat,
  loadIntentForSeat,
  readVisibleFile,
  releaseSeat,
  respondToTransfer,
  saveIntentForSeat,
  updateSeatStatus,
  type IntentSections,
  type ViewerSession,
  writeVisibleFile,
} from './core'
import { runActionRound, runForgeRound, runOpencodeProbe } from './opencode'
import { attachEventsStream, emitSnapshotRefresh, getVisibleRound } from './runtime'

async function readJsonBody(req: IncomingMessage, max = 4 * 1024 * 1024): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    req.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > max) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (!text) return resolve({})
      try {
        resolve(JSON.parse(text))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(payload))
}

function viewerHeaders(req: IncomingMessage) {
  const rawSeatName = String(req.headers['x-gz-seat'] || '').trim()
  const seatName = rawSeatName ? safeDecodeURIComponent(rawSeatName) : ''
  const token = String(req.headers['x-gz-token'] || '').trim()
  return { seatName, token }
}

function safeDecodeURIComponent(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

async function requireViewer(root: string, req: IncomingMessage, res: ServerResponse): Promise<ViewerSession | null> {
  const { seatName, token } = viewerHeaders(req)
  if (!seatName || !token) {
    sendJson(res, 401, { error: 'missing session headers' })
    return null
  }
  const viewer = await authenticateViewer(root, seatName, token)
  if (!viewer) {
    sendJson(res, 401, { error: 'invalid session' })
    return null
  }
  return viewer
}

function parseRelative(url: URL) {
  return (url.searchParams.get('path') || '').replace(/^\/+/, '').replace(/\\/g, '/')
}

function roomCodeForSeat(root: string, seatName: string) {
  const roomCode = process.env.GZ_ROOM_CODE?.trim()
  return roomCode
}

function validateRoomCode(root: string, seatName: string, roomCode: unknown) {
  const expected = roomCodeForSeat(root, seatName)
  if (!expected) return true
  return typeof roomCode === 'string' && roomCode.trim() === expected
}

export function filesMiddleware(workspaceRoot: string) {
  const root = path.resolve(workspaceRoot)
  return async function handle(req: IncomingMessage, res: ServerResponse, next: (err?: any) => void) {
    try {
      await ensureTableState(root)
      const url = new URL(req.url || '/', 'http://localhost')
      const route = url.pathname

      if (req.method === 'GET' && route === '/health') {
        return sendJson(res, 200, { ok: true })
      }

      if (req.method === 'POST' && route === '/opencode/probe') {
        const viewer = await requireViewer(root, req, res)
        if (!viewer) return
        const result = await runOpencodeProbe(root)
        return sendJson(res, result.ok ? 200 : 502, result)
      }

      if (req.method === 'POST' && route === '/session/join') {
        const body = await readJsonBody(req)
        const name = typeof body?.name === 'string' ? body.name : ''
        const token = typeof body?.token === 'string' ? body.token : undefined
        if (!validateRoomCode(root, name, body?.roomCode)) {
          return sendJson(res, 403, { error: 'invalid room code' })
        }
        try {
          const session = await joinSeat(root, name, token)
          emitSnapshotRefresh('seat-joined')
          return sendJson(res, 200, { session })
        } catch (error: any) {
          return sendJson(res, 409, { error: error?.message || 'seat join failed' })
        }
      }

      if (req.method === 'POST' && route === '/session/release') {
        const viewer = await requireViewer(root, req, res)
        if (!viewer) return
        const body = await readJsonBody(req)
        const seatName = typeof body?.seatName === 'string' ? body.seatName : ''
        await releaseSeat(root, viewer, seatName)
        emitSnapshotRefresh('seat-released')
        return sendJson(res, 200, { ok: true })
      }

      if (req.method === 'POST' && route === '/session/enable-dm') {
        const viewer = await requireViewer(root, req, res)
        if (!viewer) return
        const body = await readJsonBody(req)
        const roomCode = typeof body?.roomCode === 'string' ? body.roomCode : ''
        try {
          const session = await enableDmConsole(root, viewer, roomCode)
          emitSnapshotRefresh('dm-console-enabled')
          return sendJson(res, 200, { session })
        } catch (error: any) {
          return sendJson(res, 403, { error: error?.message || 'failed to enable dm console' })
        }
      }

      if (req.method === 'GET' && route === '/session/snapshot') {
        const viewer = await requireViewer(root, req, res)
        if (!viewer) return
        const snapshot = await buildSnapshot(root, viewer, getVisibleRound({ seatName: viewer.seatName, role: viewer.role, dmEnabled: viewer.dmEnabled }))
        return sendJson(res, 200, snapshot)
      }

      if (req.method === 'GET' && route === '/events/stream') {
        const seatName = String(url.searchParams.get('seat') || '').trim()
        const token = String(url.searchParams.get('token') || '').trim()
        const viewer = seatName && token ? await authenticateViewer(root, seatName, token) : null
        if (!viewer) return sendJson(res, 401, { error: 'invalid session' })
        attachEventsStream(res, { seatName: viewer.seatName, role: viewer.role, dmEnabled: viewer.dmEnabled })
        const snapshot = await buildSnapshot(root, viewer, getVisibleRound({ seatName: viewer.seatName, role: viewer.role, dmEnabled: viewer.dmEnabled }))
        res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`)
        return
      }

      if (req.method === 'GET' && route === '/intents/self') {
        const viewer = await requireViewer(root, req, res)
        if (!viewer) return
        const intent = await loadIntentForSeat(root, viewer.seatName)
        return sendJson(res, 200, intent)
      }

      if (req.method === 'PUT' && route === '/intents/self') {
        const viewer = await requireViewer(root, req, res)
        if (!viewer) return
        const body = await readJsonBody(req)
        const sections = body?.sections as IntentSections | undefined
        if (!sections || typeof sections.public !== 'string' || typeof sections.privateToDm !== 'string' || typeof sections.longTerm !== 'string' || typeof sections.triggers !== 'string') {
          return sendJson(res, 400, { error: 'invalid sections payload' })
        }
        const intent = await saveIntentForSeat(root, viewer.seatName, sections)
        if (typeof body?.status === 'string') {
          const normalized = body.status
          if (normalized === 'idle' || normalized === 'ready' || normalized === 'submitted' || normalized === 'locked') {
            await updateSeatStatus(root, viewer.seatName, normalized)
          }
        }
        emitSnapshotRefresh('intent-updated')
        return sendJson(res, 200, intent)
      }

      if (req.method === 'POST' && route === '/control/assign') {
        const viewer = await requireViewer(root, req, res)
        if (!viewer) return
        const body = await readJsonBody(req)
        await assignControl(root, viewer, {
          characterPath: String(body?.characterPath || ''),
          primarySeat: body?.primarySeat == null ? null : String(body.primarySeat),
          dmHosted: Boolean(body?.dmHosted),
          requireAccept: Boolean(body?.requireAccept),
        })
        emitSnapshotRefresh('control-assigned')
        return sendJson(res, 200, { ok: true })
      }

      if (req.method === 'POST' && route === '/control/transfer/respond') {
        const viewer = await requireViewer(root, req, res)
        if (!viewer) return
        const body = await readJsonBody(req)
        await respondToTransfer(root, viewer, String(body?.characterPath || ''), Boolean(body?.accept))
        emitSnapshotRefresh('transfer-responded')
        return sendJson(res, 200, { ok: true })
      }

      if (req.method === 'POST' && route === '/round/compose') {
        const viewer = await requireViewer(root, req, res)
        if (!viewer) return
        const body = await readJsonBody(req)
        const result = await createRoundPacket(root, viewer, {
          seatNames: Array.isArray(body?.seatNames) ? body.seatNames.map((value: unknown) => String(value)) : undefined,
          note: typeof body?.note === 'string' ? body.note : undefined,
        })
        emitSnapshotRefresh('round-composed')
        return sendJson(res, 200, result)
      }

      if (req.method === 'POST' && route === '/round/run') {
        const viewer = await requireViewer(root, req, res)
        if (!viewer) return
        const body = await readJsonBody(req)
        const kind = body?.kind === 'forge' ? 'forge' : 'action'

        if (kind === 'forge') {
          const roundId = typeof body?.roundId === 'string' && body.roundId ? body.roundId : cryptoRandomId()
          void runForgeRound({
            workspaceRoot: root,
            viewer,
            roundId,
            forge: body?.forge || {},
          })
          emitSnapshotRefresh('forge-started')
          return sendJson(res, 200, { roundId })
        }

        const roundId = String(body?.roundId || '')
        const packetPath = `table/rounds/${roundId}/packet.md`
        const resultPath = `table/rounds/${roundId}/result.md`
        const packetExists = await fs.stat(path.resolve(root, packetPath)).catch(() => null)
        if (!packetExists?.isFile()) {
          return sendJson(res, 404, { error: 'round packet not found' })
        }

        const packetContent = await fs.readFile(path.resolve(root, packetPath), 'utf8')
        const seatsMatch = packetContent.match(/- seats:\s*(.+)/)
        const seatNames = seatsMatch?.[1]
          ? seatsMatch[1].split(',').map((value) => value.trim()).filter(Boolean)
          : []

        void runActionRound({
          workspaceRoot: root,
          viewer,
          roundId,
          seatNames,
          packetPath,
          resultPath,
        })
        emitSnapshotRefresh('round-started')
        return sendJson(res, 200, { roundId })
      }

      if (req.method === 'GET' && route === '/tree') {
        const viewer = await requireViewer(root, req, res)
        if (!viewer) return
        const tree = await buildTree(root, viewer)
        return sendJson(res, 200, { tree })
      }

      if (req.method === 'GET' && route === '/file') {
        const viewer = await requireViewer(root, req, res)
        if (!viewer) return
        const file = await readVisibleFile(root, viewer, parseRelative(url))
        if (!file) return sendJson(res, 404, { error: 'file not found or forbidden' })
        return sendJson(res, 200, file)
      }

      if (req.method === 'PUT' && route === '/file') {
        const viewer = await requireViewer(root, req, res)
        if (!viewer) return
        const rel = parseRelative(url)
        const body = await readJsonBody(req)
        if (typeof body?.content !== 'string') return sendJson(res, 400, { error: 'body.content must be a string' })
        try {
          await writeVisibleFile(root, viewer, rel, body.content)
          emitSnapshotRefresh('file-written')
          return sendJson(res, 200, { ok: true })
        } catch (error: any) {
          return sendJson(res, 403, { error: error?.message || 'write forbidden' })
        }
      }

      return next()
    } catch (error: any) {
      console.error('[gray-zone-api]', error)
      sendJson(res, 500, { error: error?.message || 'internal error' })
    }
  }
}

function cryptoRandomId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}
