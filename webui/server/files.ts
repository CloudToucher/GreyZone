import { promises as fs } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import {
  assignControl,
  authenticateViewer,
  buildSnapshot,
  buildTree,
  checkSceneReadiness,
  enableDmConsole,
  ensureTableState,
  joinSeat,
  loadIntentForSeat,
  readVisibleFile,
  releaseSeat,
  respondToTransfer,
  saveIntentForSeat,
  updateSeatStatus,
  loadSeatsFile,
  type IntentSections,
  type ViewerSession,
  writeVisibleFile,
} from './core'
import { runOpencodeProbe } from './opencode'
import { attachEventsStream, emitSnapshotRefresh } from './runtime'
import {
  buildJobArchives,
  buildJobQueueItems,
  buildAgentRunSummaries,
  enqueueActionJob,
  enqueueAiCompanionJob,
  enqueueAssistantJob,
  enqueueEnterJobs,
  enqueueForgeJob,
  getJob,
  latestVisibleJobResults,
  listJobs,
  readJobArtifact,
  type CharacterAction,
} from './jobs'

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

async function snapshotWithJobs(root: string, viewer: ViewerSession) {
  const snapshot = await buildSnapshot(root, viewer, null)
  const latestResults = await latestVisibleJobResults(root, viewer)
  const latestNarrative = latestResults.find((result) => result.kind !== 'assistant')
  const agentRuns = await buildAgentRunSummaries(root, viewer)
  snapshot.latestResults = latestResults as any
  snapshot.latestResultContent = latestNarrative?.content || null
  ;(snapshot as any).agentRuns = agentRuns
  ;(snapshot as any).activeAgentRuns = agentRuns.filter((run) => run.status === 'waiting' || run.status === 'running' || run.status === 'validating' || run.status === 'stale')
  snapshot.aiQueue = await buildJobQueueItems(root) as any
  snapshot.archives = await buildJobArchives(root)
  snapshot.visibleRound = null
  return snapshot
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
        const body = await readJsonBody(req)
        const characterPaths = Array.isArray(body?.characterPaths)
          ? body.characterPaths.filter((entry: unknown): entry is string => typeof entry === 'string').map((entry: string) => entry.trim()).filter(Boolean)
          : [typeof body?.characterPath === 'string' ? body.characterPath.trim() : ''].filter(Boolean)
        if (!characterPaths.length) return sendJson(res, 400, { error: 'characterPath is required' })
        const jobs = await enqueueEnterJobs(root, viewer, characterPaths)
        emitSnapshotRefresh('job-enter-created')
        const firstJob = jobs[0]
        return sendJson(res, 200, { roundId: firstJob.id, jobId: firstJob.id, jobIds: jobs.map((job) => job.id), job: firstJob, jobs })
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
        const job = await enqueueAssistantJob(root, viewer, question, charSummary)
        emitSnapshotRefresh('job-assistant-created')
        return sendJson(res, 200, { roundId: job.id, job })
      }

      if (req.method === 'POST' && route === '/jobs/enter') {
        const viewer = await requireViewer(root, req, res)
        if (!viewer) return
        const body = await readJsonBody(req)
        const characterPaths = Array.isArray(body?.characterPaths)
          ? body.characterPaths.filter((entry: unknown): entry is string => typeof entry === 'string').map((entry: string) => entry.trim()).filter(Boolean)
          : [typeof body?.characterPath === 'string' ? body.characterPath.trim() : ''].filter(Boolean)
        if (!characterPaths.length) return sendJson(res, 400, { error: 'characterPath is required' })
        const jobs = await enqueueEnterJobs(root, viewer, characterPaths)
        emitSnapshotRefresh('job-enter-created')
        const firstJob = jobs[0]
        return sendJson(res, 200, { jobId: firstJob.id, jobIds: jobs.map((job) => job.id), job: firstJob, jobs })
      }

      if (req.method === 'POST' && route === '/jobs/assistant') {
        const viewer = await requireViewer(root, req, res)
        if (!viewer) return
        const body = await readJsonBody(req)
        const question = typeof body?.question === 'string' ? body.question.trim() : ''
        if (!question) return sendJson(res, 400, { error: 'question is required' })
        const job = await enqueueAssistantJob(root, viewer, question, typeof body?.charSummary === 'string' ? body.charSummary : undefined)
        emitSnapshotRefresh('job-assistant-created')
        return sendJson(res, 200, { jobId: job.id, job })
      }

      if (req.method === 'POST' && route === '/jobs/forge') {
        const viewer = await requireViewer(root, req, res)
        if (!viewer) return
        const body = await readJsonBody(req)
        const job = await enqueueForgeJob(root, viewer, body?.forge || {})
        emitSnapshotRefresh('job-forge-created')
        return sendJson(res, 200, { jobId: job.id, job })
      }

      if (req.method === 'POST' && route === '/jobs/ai-companion') {
        const viewer = await requireViewer(root, req, res)
        if (!viewer) return
        const body = await readJsonBody(req)
        try {
          const job = await enqueueAiCompanionJob(root, viewer, body?.companion || body || {})
          emitSnapshotRefresh('job-ai-companion-created')
          return sendJson(res, 200, { jobId: job.id, job })
        } catch (error: any) {
          return sendJson(res, 400, { error: error?.message || 'ai companion job failed' })
        }
      }

      if (req.method === 'POST' && route === '/jobs/action') {
        const viewer = await requireViewer(root, req, res)
        if (!viewer) return
        const body = await readJsonBody(req)
        const actions = Array.isArray(body?.actions) ? body.actions as CharacterAction[] : undefined
        const job = await enqueueActionJob(root, viewer, actions)
        emitSnapshotRefresh('job-action-created')
        return sendJson(res, 200, { jobId: job.id, job })
      }

      if (req.method === 'GET' && route === '/jobs') {
        const viewer = await requireViewer(root, req, res)
        if (!viewer) return
        const jobs = await listJobs(root)
        const visible = viewer.role === 'dm' || viewer.dmEnabled
          ? jobs
          : jobs.filter((job) => job.participantSeats.includes(viewer.seatName) || job.createdBy === viewer.seatName)
        return sendJson(res, 200, { jobs: visible })
      }

      const jobArtifactMatch = route.match(/^\/jobs\/([^/]+)\/artifacts\/([^/]+)$/)
      if (req.method === 'GET' && jobArtifactMatch) {
        const viewer = await requireViewer(root, req, res)
        if (!viewer) return
        const artifact = await readJobArtifact(root, viewer, jobArtifactMatch[1], jobArtifactMatch[2])
        if (!artifact) return sendJson(res, 404, { error: 'job artifact not found or forbidden' })
        return sendJson(res, 200, artifact)
      }

      const jobMatch = route.match(/^\/jobs\/([^/]+)$/)
      if (req.method === 'GET' && jobMatch) {
        const viewer = await requireViewer(root, req, res)
        if (!viewer) return
        const job = await getJob(root, jobMatch[1])
        if (!job) return sendJson(res, 404, { error: 'job not found' })
        if (!(viewer.role === 'dm' || viewer.dmEnabled) && !job.participantSeats.includes(viewer.seatName) && job.createdBy !== viewer.seatName) {
          return sendJson(res, 403, { error: 'job forbidden' })
        }
        return sendJson(res, 200, { job })
      }

      if (req.method === 'GET' && route === '/session/snapshot') {
        const viewer = await requireViewer(root, req, res)
        if (!viewer) return
        const snapshot = await snapshotWithJobs(root, viewer)
        return sendJson(res, 200, snapshot)
      }

      if (req.method === 'GET' && route === '/events/stream') {
        const seatName = String(url.searchParams.get('seat') || '').trim()
        const token = String(url.searchParams.get('token') || '').trim()
        const viewer = seatName && token ? await authenticateViewer(root, seatName, token) : null
        if (!viewer) return sendJson(res, 401, { error: 'invalid session' })
        attachEventsStream(res, { seatName: viewer.seatName, role: viewer.role, dmEnabled: viewer.dmEnabled })
        const snapshot = await snapshotWithJobs(root, viewer)
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
          
          const job = await enqueueActionJob(root, viewer)
          emitSnapshotRefresh('job-action-created')
          
          return sendJson(res, 200, {
            intent,
            readiness,
            message: '全部就绪，已创建 AI DM job',
            jobId: job.id,
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
        const job = await enqueueActionJob(root, viewer)
        emitSnapshotRefresh('job-action-created')
        return sendJson(res, 200, {
          roundId: job.id,
          packetPath: job.artifacts.packet,
          resultPath: job.artifacts.rawResult,
          seatNames: job.participantSeats,
        })
      }

      if (req.method === 'POST' && route === '/round/run') {
        const viewer = await requireViewer(root, req, res)
        if (!viewer) return
        const body = await readJsonBody(req)
        const kind = body?.kind === 'forge' ? 'forge' : 'action'

        if (kind === 'forge') {
          const job = await enqueueForgeJob(root, viewer, body?.forge || {})
          emitSnapshotRefresh('job-forge-created')
          return sendJson(res, 200, { roundId: job.id, job })
        }

        const job = await enqueueActionJob(root, viewer)
        emitSnapshotRefresh('job-action-created')
        return sendJson(res, 200, { roundId: job.id, job })
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
