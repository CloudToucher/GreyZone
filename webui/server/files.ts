import { promises as fs } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import {
  assignControl,
  authenticateViewer,
  buildSnapshot,
  buildTree,
  checkSceneReadiness,
  createAiRoundPacket,
  canWritePath,
  createRoundPacket,
  DM_HOSTED_MARKER,
  enableDmConsole,
  ensureTableState,
  finalizeSeatsAfterRound,
  joinSeat,
  loadIntentForSeat,
  markRoomIdle,
  readVisibleFile,
  reconcileTableFromCharacters,
  releaseSeat,
  respondToTransfer,
  saveIntentForSeat,
  updateSeatStatus,
  loadSeatsFile,
  type IntentSections,
  type SceneReadinessResult,
  type ViewerSession,
  writeVisibleFile,
} from './core'
import { runActionRound, runAssistantQuery, runForgeRound, runOpencodeProbe, runWelcomeRound, startDmSession, writeDmTrigger, getDmSessionState, pollDmResult, startDmHeartbeat, stopDmHeartbeat, stopDmSession } from './opencode'
import { attachEventsStream, beginRound, emitSnapshotRefresh, finishRound, getVisibleRound, appendRoundLog } from './runtime'

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

      if (req.method === 'POST' && route === '/game/enter') {
        const viewer = await requireViewer(root, req, res)
        if (!viewer) return
        const roundId = cryptoRandomId()
        const result = await startDmSession({
          workspaceRoot: root,
          welcomeRoundId: roundId,
        })
        if (result.alreadyRunning) {
          return sendJson(res, 200, { roundId: null, message: 'DM session already running' })
        }
        if ('error' in result && result.error) {
          return sendJson(res, 500, { error: result.error })
        }
        const welcomePath = result.welcomeResultPath!
        
        // Start heartbeat monitoring
        startDmHeartbeat(root, async () => {
          appendRoundLog('meta', 'DM Session heartbeat lost — restarting session')
          await stopDmSession()
          stopDmHeartbeat()
          // Restart DM session
          const newRoundId = cryptoRandomId()
          void startDmSession({
            workspaceRoot: root,
            welcomeRoundId: newRoundId,
          })
        })
        
        // Start polling for welcome result marker
        pollDmResult(root, welcomePath, {
          onDone: async (content, marker) => {
            appendRoundLog('meta', 'DM Session welcome scene completed')
            beginRound({
              id: roundId,
              kind: 'forge',
              status: 'running',
              startedAt: new Date().toISOString(),
              participantSeats: [viewer.seatName],
              packetPath: `table/rounds/${roundId}/packet.md`,
              resultPath: welcomePath,
              affectedFiles: [`table/rounds/${roundId}/result.md`],
            })
            finishRound({
              status: 'done',
              endedAt: new Date().toISOString(),
              exitCode: 0,
              resultPath: welcomePath,
              resultContent: content,
              resultMarker: marker,
              affectedFiles: [`table/rounds/${roundId}/result.md`],
            })
            emitSnapshotRefresh('dm-session-welcome-ready')
          },
          onTimeout: async () => {
            appendRoundLog('meta', 'DM Session welcome scene TIMEOUT')
            emitSnapshotRefresh('dm-session-welcome-timeout')
          },
        })
        emitSnapshotRefresh('enter-grey-zone')
        return sendJson(res, 200, { roundId })
      }

      if (req.method === 'GET' && route === '/scene/readiness') {
        const viewer = await requireViewer(root, req, res)
        if (!viewer) return
        const readiness = await checkSceneReadiness(root, viewer.seatName)
        return sendJson(res, 200, readiness)
      }

      if (req.method === 'POST' && route === '/assistant/ask') {
        const viewer = await requireViewer(root, req, res)
        if (!viewer) return
        const body = await readJsonBody(req)
        const question = typeof body?.question === 'string' ? body.question.trim() : ''
        if (!question) {
          return sendJson(res, 400, { error: 'question is required' })
        }
        const charSummary = typeof body?.charSummary === 'string' ? body.charSummary : undefined
        const roundId = cryptoRandomId()
        void runAssistantQuery({
          workspaceRoot: root,
          viewer,
          roundId,
          question,
          charSummary,
        })
        emitSnapshotRefresh('assistant-started')
        return sendJson(res, 200, { roundId })
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
        let normalizedStatus: string | null = null
        if (typeof body?.status === 'string') {
          const normalized = body.status
        
          // If player saves while already submitted, revert to idle (they're editing their intent)
          const seatsFile = await loadSeatsFile(root)
          const currentSeat = seatsFile.seats.find((s) => s.name === viewer.seatName)
          const wasSubmitted = currentSeat?.status === 'submitted'
        
          if (wasSubmitted && normalized !== 'submitted') {
            // Player was ready but now saving with non-submitted status → intent was modified
            await updateSeatStatus(root, viewer.seatName, 'idle')
            normalizedStatus = 'idle'
          } else if (normalized === 'idle' || normalized === 'ready' || normalized === 'submitted' || normalized === 'locked') {
            await updateSeatStatus(root, viewer.seatName, normalized)
            normalizedStatus = normalized
          }
        }
        emitSnapshotRefresh('intent-updated')
        
        if (normalizedStatus === 'submitted') {
          // Check scene readiness
          const readiness = await checkSceneReadiness(root, viewer.seatName)
          
          if (!readiness.allReady) {
            // Not all players ready — just acknowledge submission, don't fire yet
            return sendJson(res, 200, {
              intent,
              readiness,
              message: `场景 ${readiness.sceneId} 等待其他玩家就绪`,
            })
          }
          
          // All scene players ready — fire the round
          void (async () => {
            try {
              const packet = await createAiRoundPacket(root, { reason: `submitted:${viewer.seatName}` })
              const dmState = getDmSessionState()
              
              if (dmState.status === 'running') {
                await writeDmTrigger({
                  workspaceRoot: root,
                  roundId: packet.roundId,
                  packetPath: packet.packetPath,
                  resultPath: packet.resultPath,
                  seatNames: packet.seatNames,
                })
                pollDmResult(root, packet.resultPath, {
                  onDone: async (content, marker) => {
                    appendRoundLog('meta', `DM session round ${packet.roundId} completed via trigger file`)
                    beginRound({
                      id: packet.roundId,
                      kind: 'action',
                      status: 'running',
                      startedAt: new Date().toISOString(),
                      participantSeats: packet.seatNames,
                      packetPath: packet.packetPath,
                      resultPath: packet.resultPath,
                      affectedFiles: [packet.packetPath, packet.resultPath],
                    })
                    finishRound({
                      status: 'done',
                      endedAt: new Date().toISOString(),
                      exitCode: 0,
                      resultPath: packet.resultPath,
                      resultContent: content,
                      resultMarker: marker,
                      affectedFiles: [packet.packetPath, packet.resultPath],
                    })
                    await reconcileTableFromCharacters(root)
                    await finalizeSeatsAfterRound(root, packet.seatNames)
                    await markRoomIdle(root)
                    emitSnapshotRefresh('dm-session-round-done')
                  },
                  onTimeout: async () => {
                    appendRoundLog('meta', `DM session round ${packet.roundId} TIMEOUT waiting for marker`)
                    emitSnapshotRefresh('dm-session-round-timeout')
                  },
                })
              } else {
                const aiViewer = { seatName: 'AI DM', role: 'dm' as const, token: '', dmEnabled: true }
                void runActionRound({
                  workspaceRoot: root,
                  viewer: aiViewer,
                  roundId: packet.roundId,
                  seatNames: packet.seatNames,
                  packetPath: packet.packetPath,
                  resultPath: packet.resultPath,
                })
              }
              emitSnapshotRefresh('ai-round-started')
            } catch (error: any) {
              const message = String(error?.message || error)
              if (!/already processing|尚未全部就绪/.test(message)) {
                console.error('[gray-zone-ai-auto]', error)
              }
              emitSnapshotRefresh('ai-round-skipped')
            }
          })()
          
          return sendJson(res, 200, {
            intent,
            readiness,
            message: '全部就绪，已触发 AI DM 处理',
          })
        }
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
        if (/创建角色|forge/i.test(packetContent.slice(0, 500))) {
          return sendJson(res, 409, { error: 'this is a character creation packet; it cannot be rerun as an action round' })
        }
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
