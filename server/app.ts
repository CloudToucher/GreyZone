import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import staticFiles from '@fastify/static';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { actionInput, characterInput, conceptInput, creationReplySchema } from '../shared/types.js';
import {
  actor,
  character,
  commit,
  GameError,
  nativePlan,
  newSession,
  propose,
  publicView,
  canFlow,
  converse,
  amendSheet,
  type Die,
} from './engine.js';
import { powers } from './content.js';
import { DshDirector, LocalDirector, locateDsh, type Director } from './ai/dsh.js';
import { newToken, Store, tokenHash, type SavedRoom, type Seat } from './store.js';
import { unformedCharacter, openWorkshop, adoptCharacter, validateDraft } from './creation.js';
interface Options {
  directory: string;
  director?: Director;
  die?: Die;
  serveStatic?: boolean;
}
export async function createApp(options: Options) {
  const store = new Store(options.directory);
  await store.init();
  const app = Fastify({ bodyLimit: 65536, logger: false, requestTimeout: 780000 });
  const directors: Record<'dsh' | 'local', Director> = {
    dsh: options.director ?? new DshDirector(),
    local: options.director ?? new LocalDirector(),
  };
  const pending = new Map<
    string,
    { controller: AbortController; actorId: string; stage: string }
  >();
  const streams = new Map<string, Set<{ reply: FastifyReply; seat: Seat }>>();
  const view = (room: SavedRoom, seat: Seat) =>
    publicView(room.state, seat.characterId, seat.host, pending.get(room.state.id)?.stage ?? null);
  const broadcast = (id: string) => {
    const room = store.get(id);
    for (const client of streams.get(id) ?? [])
      client.reply.raw.write(`data: ${JSON.stringify(view(room, client.seat))}\n\n`);
  };
  const auth = (request: FastifyRequest) => {
    const { id } = z.object({ id: z.string().regex(/^[A-Z0-9]{6}$/) }).parse(request.params);
    const token = request.headers.authorization?.replace(/^Bearer /, '') ?? '';
    if (!/^[a-f0-9]{64}$/.test(token)) throw new GameError('需要房间凭证。', 401);
    return { id, seat: store.authenticate(id, token) };
  };
  const revision = (room: SavedRoom, n: number) => {
    if (room.state.revision !== n)
      throw new GameError('局面已更新，请查看最新状态后重新提交。', 409);
  };
  const received = (room: SavedRoom, id: string, actorId: string) =>
    room.receipts.some((r) => r.id === id && r.actorId === actorId);
  const receipt = (room: SavedRoom, id: string, actorId: string) => {
    room.receipts.push({ id, actorId });
    room.receipts = room.receipts.slice(-128);
    room.state.revision++;
  };
  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    if (request.url.startsWith('/api')) reply.header('Cache-Control', 'no-store');
    const origin = request.headers.origin;
    if (
      origin &&
      !new Set([
        process.env.ALLOWED_ORIGIN,
        `http://${request.headers.host}`,
        'http://localhost:5173',
        'http://127.0.0.1:5173',
      ]).has(origin)
    )
      throw new GameError('此网页来源不允许访问房间。', 403);
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError)
      return reply.code(400).send({ error: '请求格式无效，请检查输入。' });
    if (error instanceof GameError)
      return reply.code(error.statusCode).send({ error: error.message });
    console.error('Request failed:', error instanceof Error ? error.name : 'unknown');
    return reply
      .code(500)
      .send({ error: '处理或保存失败。请保留页面重试，未确认的操作不会扣除资源。' });
  });
  app.get('/api/health', async () => ({
    ok: true,
    title: '灰区：撤离',
    version: 2,
    dshInstalled: await locateDsh().then(
      () => true,
      () => false,
    ),
  }));
  app.get('/api/catalog', async () => ({ powers }));
  app.post('/api/rooms', async (request, reply) => {
    const input = z
      .union([conceptInput, characterInput.extend({ mode: z.literal('local') })])
      .parse(request.body);
    const mode = 'concept' in input ? 'dsh' : input.mode;
    if (mode === 'dsh' && !options.director) await locateDsh();
    let id: string;
    do {
      id = randomBytes(3).toString('hex').toUpperCase();
    } while (store.has(id));
    const c = 'concept' in input ? unformedCharacter() : character(input),
      token = newToken();
    const room: SavedRoom = {
      format: 2,
      state: newSession(id, mode, c),
      seats: [{ tokenHash: tokenHash(token), characterId: c.id, host: true }],
      receipts: [],
    };
    if ('concept' in input) openWorkshop(room.state, c.id, input.concept);
    await store.save(room);
    return reply.code(201).send({ room: id, token, state: view(room, room.seats[0]) });
  });
  app.post('/api/rooms/:id/join', async (request) => {
    const { id } = z.object({ id: z.string().regex(/^[A-Z0-9]{6}$/) }).parse(request.params),
      input = z.union([conceptInput, characterInput]).parse(request.body);
    return store.exclusive(id, async () => {
      const room = store.get(id);
      if (room.state.proposal) throw new GameError('请等当前行动确认或撤回后再加入。', 409);
      if (room.seats.length >= 4) throw new GameError('房间已满，最多四名玩家。', 409);
      if (room.state.mode === 'dsh' && !('concept' in input))
        throw new GameError('请先向主持人描述想扮演的角色。');
      if (room.state.mode === 'local' && 'concept' in input)
        throw new GameError('这是旧版规则演练房间；自由角色请新建 dsh 战役。');
      if ('name' in input && room.state.characters.some((c) => c.name === input.name))
        throw new GameError('这个名字已有人使用。');
      const c = 'concept' in input ? unformedCharacter() : character(input),
        token = newToken(),
        seat = { tokenHash: tokenHash(token), characterId: c.id, host: false };
      room.state.characters.push(c);
      if ('concept' in input) openWorkshop(room.state, c.id, input.concept);
      room.seats.push(seat);
      room.state.revision++;
      await store.save(room);
      broadcast(id);
      return { room: id, token, state: view(room, seat) };
    });
  });
  app.get('/api/rooms/:id', async (request) => {
    const { id, seat } = auth(request);
    return view(store.get(id), seat);
  });
  app.get('/api/rooms/:id/events', async (request, reply) => {
    const { id, seat } = auth(request),
      clients = streams.get(id) ?? new Set();
    if (clients.size >= 12) throw new GameError('房间连接过多。', 429);
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const client = { reply, seat };
    clients.add(client);
    streams.set(id, clients);
    reply.raw.write(`data: ${JSON.stringify(view(store.get(id), seat))}\n\n`);
    const heartbeat = setInterval(() => reply.raw.write(': keepalive\n\n'), 15000);
    reply.raw.on('close', () => {
      clearInterval(heartbeat);
      clients.delete(client);
      if (!clients.size) streams.delete(id);
    });
  });
  const workshopInput = z
    .object({
      requestId: z.string().uuid(),
      revision: z.number().int().nonnegative(),
      message: z.string().trim().min(1).max(12000),
    })
    .strict();
  app.post('/api/rooms/:id/workshop', async (request) => {
    const { id, seat } = auth(request),
      input = workshopInput.parse(request.body);
    return store.exclusive(id, async () => {
      const room = store.get(id);
      if (received(room, input.requestId, seat.characterId)) return view(room, seat);
      revision(room, input.revision);
      const w = room.state.workshops[seat.characterId];
      if (!w || w.accepted || actor(room.state, seat.characterId).ready)
        throw new GameError('该角色已进入游戏。');
      const director = directors[room.state.mode];
      if (!director.create) throw new GameError('此主持方式不支持角色讨论。', 503);
      const controller = new AbortController();
      pending.set(id, {
        controller,
        actorId: seat.characterId,
        stage: '主持人正在阅读你的想法，准备角色与开场',
      });
      broadcast(id);
      try {
        const answer = creationReplySchema.parse(
          await director.create(room.state, seat.characterId, input.message, controller.signal),
        );
        if (controller.signal.aborted) throw new GameError('讨论已取消，原草案仍然保留。', 409);
        if (answer.draft) validateDraft(room.state, seat.characterId, answer.draft);
        w.messages.push({ role: 'player', text: input.message }, { role: 'gm', text: answer.text });
        // A clarification invalidates adoption of an earlier draft until the GM supplies a revision.
        w.draft = answer.draft;
        w.questions = answer.questions;
        w.version++;
        receipt(room, input.requestId, seat.characterId);
        await store.save(room);
        pending.delete(id);
        return view(room, seat);
      } finally {
        pending.delete(id);
        broadcast(id);
      }
    });
  });
  app.post('/api/rooms/:id/begin', async (request) => {
    const { id, seat } = auth(request),
      input = z
        .object({
          requestId: z.string().uuid(),
          revision: z.number().int().nonnegative(),
          version: z.number().int().positive(),
        })
        .strict()
        .parse(request.body);
    return store.exclusive(id, async () => {
      const room = store.get(id);
      if (received(room, input.requestId, seat.characterId)) return view(room, seat);
      revision(room, input.revision);
      if (room.state.proposal) throw new GameError('请等同伴的当前行动确认后加入场景。', 409);
      adoptCharacter(room.state, seat.characterId, input.version);
      receipt(room, input.requestId, seat.characterId);
      await store.save(room);
      broadcast(id);
      return view(room, seat);
    });
  });
  app.post('/api/rooms/:id/actions', async (request) => {
    const { id, seat } = auth(request),
      input = actionInput.parse(request.body);
    return store.exclusive(id, async () => {
      const room = store.get(id);
      if (received(room, input.requestId, seat.characterId)) return view(room, seat);
      revision(room, input.revision);
      if (
        room.state.proposal &&
        (input.command || room.state.proposal.actorId !== seat.characterId)
      )
        throw new GameError('当前行动者可以继续与主持人讨论这份裁定；其他行动请等它结束。', 409);
      const controller = new AbortController();
      pending.set(id, {
        controller,
        actorId: seat.characterId,
        stage: '主持人正在评估办法、时间与风险',
      });
      broadcast(id);
      try {
        const c = actor(room.state, seat.characterId);
        if (!c.ready) throw new GameError('请先确认角色草案，进入游戏。');
        const director = directors[room.state.mode];
        const p = input.command
          ? nativePlan(room.state, c, input.command)
          : await (director.respond ?? director.plan).call(
              director,
              room.state,
              c.id,
              input.intent,
              controller.signal,
              (stage) => {
                const job = pending.get(id);
                if (job) {
                  job.stage = stage;
                  broadcast(id);
                }
              },
            );
        if (controller.signal.aborted) throw new GameError('评估已取消。', 409);
        if ('tool' in p && p.tool === 'amend') {
          amendSheet(room.state, c.id, p);
          room.state.sheetProposals[c.id] = { ...p, id: randomUUID(), actorId: c.id };
          room.state.journal.push({
            id: randomUUID(),
            minute: room.state.minute,
            actor: c.name,
            intent: input.intent,
            title: '讨论角色调整',
            text: p.text,
            facts: [],
          });
        } else if ('tool' in p) converse(room.state, c.id, input.intent, p);
        else {
          const revising = !!room.state.proposal;
          room.state.proposal = propose(room.state, c.id, input.intent, p, input.command);
          if (!revising && !input.command && canFlow(room.state, p))
            room.state = commit(room.state, c.id, room.state.proposal.id, options.die);
        }
        receipt(room, input.requestId, c.id);
        await store.save(room);
        pending.delete(id);
        return view(room, seat);
      } finally {
        pending.delete(id);
        broadcast(id);
      }
    });
  });
  const decisionSchema = z
    .object({
      requestId: z.string().uuid(),
      revision: z.number().int().nonnegative(),
      proposalId: z.string(),
      decision: z.enum(['confirm', 'discard']),
    })
    .strict();
  app.post('/api/rooms/:id/decisions', async (request) => {
    const { id, seat } = auth(request),
      input = decisionSchema.parse(request.body);
    return store.exclusive(id, async () => {
      const room = store.get(id);
      if (received(room, input.requestId, seat.characterId)) return view(room, seat);
      revision(room, input.revision);
      const p = room.state.proposal;
      if (!p || p.id !== input.proposalId) throw new GameError('裁定已失效。', 409);
      if (p.actorId !== seat.characterId && !(input.decision === 'discard' && seat.host))
        throw new GameError('只有行动者能确认自己的行动。', 403);
      if (input.decision === 'discard') room.state.proposal = null;
      else room.state = commit(room.state, seat.characterId, p.id, options.die);
      receipt(room, input.requestId, seat.characterId);
      await store.save(room);
      broadcast(id);
      return view(room, seat);
    });
  });
  app.post('/api/rooms/:id/sheet-decisions', async (request) => {
    const { id, seat } = auth(request),
      input = decisionSchema.parse(request.body);
    return store.exclusive(id, async () => {
      const room = store.get(id);
      if (received(room, input.requestId, seat.characterId)) return view(room, seat);
      revision(room, input.revision);
      const amendment = room.state.sheetProposals[seat.characterId];
      if (!amendment || amendment.id !== input.proposalId)
        throw new GameError('这份档案修订不属于你，或已失效。', 409);
      if (room.state.proposal) throw new GameError('先处理当前行动，再调整角色档案。', 409);
      if (input.decision === 'confirm') amendSheet(room.state, seat.characterId, amendment, true);
      else delete room.state.sheetProposals[seat.characterId];
      receipt(room, input.requestId, seat.characterId);
      await store.save(room);
      broadcast(id);
      return view(room, seat);
    });
  });
  app.post('/api/rooms/:id/cancel', async (request) => {
    const { id, seat } = auth(request),
      job = pending.get(id);
    if (job && !seat.host && job.actorId !== seat.characterId)
      throw new GameError('只有行动者或房主可以取消评估。', 403);
    job?.controller.abort();
    return { ok: true };
  });
  app.get('/api/rooms/:id/export', async (request, reply) => {
    const { id, seat } = auth(request);
    reply.header('Content-Disposition', `attachment; filename="greyzone-${id}.json"`);
    return view(store.get(id), seat);
  });
  if (options.serveStatic !== false && existsSync(resolve('dist/index.html'))) {
    await app.register(staticFiles, { root: resolve('dist') });
    app.setNotFoundHandler((request, reply) =>
      request.url.startsWith('/api/')
        ? reply.code(404).send({ error: '接口不存在。' })
        : reply.sendFile('index.html'),
    );
  }
  app.addHook('preClose', async () => {
    for (const job of pending.values()) job.controller.abort();
    for (const clients of streams.values()) for (const client of clients) client.reply.raw.end();
  });
  app.addHook('onClose', async () => {
    await store.close();
  });
  return app;
}
