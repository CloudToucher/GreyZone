import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import staticFiles from '@fastify/static';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { Store, Fault, uid } from './store.js';
import { Library } from './library.js';
import { GameTools, descriptions, schemas } from './tools.js';
import { project } from './projection.js';
import { DshDirector, type Director } from './dsh.js';
import type { Campaign, Run, Seat, Intent } from '../shared/types.js';

export function createApp(
  options: {
    directory?: string;
    store?: Store;
    library?: Library;
    director?: (store: Store, library: Library, notify: (id: string) => void) => Director;
    serveStatic?: boolean;
  } = {},
) {
  const directory = resolve(options.directory ?? process.env.DATA_DIR ?? '.data/v3');
  const store = options.store ?? new Store(resolve(directory, 'table.sqlite'));
  const library = options.library ?? new Library();
  const app = Fastify({ bodyLimit: 262144, logger: false });
  const streams = new Map<string, Set<{ reply: FastifyReply; seatId: string }>>();
  const notify = (id: string) => {
    for (const stream of streams.get(id) ?? []) {
      const seat = store.seats(id).find((s) => s.id === stream.seatId);
      if (seat && !stream.reply.raw.destroyed)
        stream.reply.raw.write(
          `data: ${JSON.stringify(project(store, store.room(id), seat, director.stage(id)))}\n\n`,
        );
    }
  };
  const director =
    options.director?.(store, library, notify) ??
    new DshDirector(store, library, directory, notify);
  const tools = new GameTools(store, library, notify);
  const auth = (req: FastifyRequest) => {
    const id = z
      .object({ id: z.string().regex(/^[A-F0-9]{6}$/) })
      .passthrough()
      .parse(req.params).id;
    const token = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
    return { id, seat: store.authenticate(id, token) };
  };
  const host = (seat: Seat) => {
    if (!seat.host) throw new Fault('只有房主能发起或中断裁决。', 403);
  };
  const owned = (seat: Seat, id: string) => {
    if (!seat.characters.includes(id)) throw new Fault('这不是你控制的角色。', 403);
  };
  const idle = (id: string) => {
    if (store.active(id)) throw new Fault('请先完成当前裁决。行动板仍可继续补充。', 409);
  };
  const key = z.string().min(1).max(100),
    body = z.object({ requestId: key });
  const launch = (run: Run) => {
    void director.launch(run.id).catch(() => {
      const fresh = store.run(run.id);
      if (fresh.status === 'running') {
        fresh.status = 'failed';
        fresh.error = '主持尚未启动，请稍后继续。';
        store.saveRun(fresh);
        notify(fresh.roomId);
      }
    });
  };
  const start = (
    id: string,
    kind: Run['kind'],
    request: string,
    ownerCharacter?: string,
    responseAudience?: string[],
  ) => {
    idle(id);
    const room = store.room(id);
    const actions =
      kind === 'round'
        ? room.board.filter((a) => room.world.records[a.characterId]?.data.ready === true)
        : [];
    if (kind === 'round' && !actions.length) throw new Fault('先在行动板提交本轮意图。');
    const run: Run = {
      id: uid('run'),
      roomId: id,
      kind,
      status: 'running',
      baseVersion: room.worldVersion,
      draft: structuredClone(room.world),
      actions,
      request,
      ownerCharacter,
      responseAudience:
        responseAudience ?? (kind === 'workshop' && ownerCharacter ? [ownerCharacter] : ['table']),
      changes: [],
      decisions: [],
      checkpoint: 0,
      createdAt: new Date().toISOString(),
      metrics: {
        elapsedMs: 0,
        toolCalls: 0,
        modelCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        compactions: 0,
        resumptions: 0,
      },
    };
    room.board = room.board.filter((a) => !actions.some((x) => x.id === a.id));
    room.revision++;
    store.saveRoom(room);
    store.saveRun(run);
    return run;
  };
  const update = (id: string, seat: Seat, requestId: string, input: unknown, fn: () => unknown) => {
    const result = store.once('api:' + id + ':' + seat.id, requestId, input, fn);
    notify(id);
    return result;
  };
  app.addHook('onRequest', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer');
    if (req.url.startsWith('/api')) reply.header('Cache-Control', 'no-store');
    const origin = req.headers.origin;
    if (
      origin &&
      !new Set([
        `http://${req.headers.host}`,
        `https://${req.headers.host}`,
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        process.env.ALLOWED_ORIGIN,
      ]).has(origin)
    )
      throw new Fault('此来源不能访问团桌。', 403);
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof z.ZodError)
      return reply.code(400).send({
        error: '输入不符合格式。',
        issues: error.issues.map((i) => ({ path: i.path, message: i.message })),
      });
    if (error instanceof Fault) return reply.code(error.status).send({ error: error.message });
    console.error(error);
    return reply.code(500).send({ error: '保存或处理失败；请保留原请求重试。' });
  });
  app.get('/api/health', async () => ({ ok: true, version: 3, title: '灰区 · 团桌' }));
  app.get('/api/rules', async () => ({
    text:
      library.get('rules/quick.md').text +
      '\n\n' +
      library.get('rules/core.md').text +
      '\n\n' +
      library.get('rules/powers.md').text,
  }));
  app.post('/api/rooms', async (req, reply) => {
    const input = body
      .extend({ name: z.string().min(1).max(50), title: z.string().max(100).default('灰区冒险') })
      .parse(req.body);
    const result = store.once('create', input.requestId, input, () => {
      let id: string;
      do {
        id = randomBytes(3).toString('hex').toUpperCase();
      } while (store.db.prepare('SELECT id FROM campaigns WHERE id=?').get(id));
      const room: Campaign = {
        format: 3,
        id,
        title: input.title,
        revision: 0,
        worldVersion: 0,
        world: library.seed(),
        board: [],
        messages: [],
        journal: [],
        sessionId: uid('greyzone'),
        sessionReady: false,
      };
      store.saveRoom(room);
      return { id, ...store.addSeat(id, input.name, true) };
    });
    return reply.code(201).send(result);
  });
  app.post('/api/rooms/:id/join', async (req) => {
    const { id } = z.object({ id: z.string().regex(/^[A-F0-9]{6}$/) }).parse(req.params),
      input = body.extend({ name: z.string().min(1).max(50) }).parse(req.body);
    const result = store.once('join:' + id, input.requestId, input, () => {
      store.room(id);
      if (store.seats(id).length >= 6) throw new Fault('本桌已有六名玩家。');
      return { id, ...store.addSeat(id, input.name, false) };
    });
    notify(id);
    return result;
  });
  app.get('/api/rooms/:id', async (req) => {
    const { id, seat } = auth(req);
    return project(store, store.room(id), seat, director.stage(id));
  });
  app.get('/api/rooms/:id/events', async (req, reply) => {
    const { id, seat } = auth(req);
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const set = streams.get(id) ?? new Set();
    streams.set(id, set);
    const connection = { reply, seatId: seat.id };
    set.add(connection);
    reply.raw.write(
      `data: ${JSON.stringify(project(store, store.room(id), seat, director.stage(id)))}\n\n`,
    );
    const heartbeat = setInterval(() => reply.raw.write(': keepalive\n\n'), 15000);
    req.raw.on('close', () => {
      clearInterval(heartbeat);
      set.delete(connection);
      if (!set.size) streams.delete(id);
    });
  });
  app.post('/api/rooms/:id/characters', async (req) => {
    const { id, seat } = auth(req),
      input = body
        .extend({ name: z.string().min(1).max(60), concept: z.string().max(12000).default('') })
        .parse(req.body);
    return update(id, seat, input.requestId, { route: 'character', ...input }, () => {
      idle(id);
      if (seat.characters.length >= 4) throw new Fault('每名玩家最多控制四个角色。');
      const room = store.room(id),
        characterId = uid('pc');
      room.world.records[characterId] = {
        id: characterId,
        kind: 'character',
        name: input.name,
        audience: [characterId],
        secret: '',
        data: {
          background: input.concept,
          stats: { body: 1, agility: 1, perception: 2, mind: 0 },
          specialties: [],
          abilities: [],
          resources: { cash: 0 },
          conditions: [],
          location: 'fence',
          status: 'active',
          ready: false,
          delegated: false,
        },
      };
      seat.characters.push(characterId);
      store.saveSeat(seat);
      room.worldVersion++;
      room.revision++;
      store.saveRoom(room);
      return { characterId };
    });
  });
  app.post('/api/rooms/:id/workshop', async (req) => {
    const { id, seat } = auth(req),
      input = body
        .extend({ characterId: z.string(), text: z.string().min(1).max(12000) })
        .parse(req.body);
    owned(seat, input.characterId);
    const result = update(id, seat, input.requestId, { route: 'workshop', ...input }, () => {
      if (store.room(id).world.records[input.characterId]?.data.ready)
        throw new Fault('已入场角色的实际学习与修订请提交行动板。');
      const run = start(id, 'workshop', input.text, input.characterId);
      return { runId: run.id };
    }) as { runId: string };
    const run = store.run(result.runId);
    if (run.status === 'running') launch(run);
    return result;
  });
  app.post('/api/rooms/:id/adopt', async (req) => {
    const { id, seat } = auth(req),
      input = body.extend({ characterId: z.string() }).parse(req.body);
    owned(seat, input.characterId);
    return update(id, seat, input.requestId, { route: 'adopt', ...input }, () => {
      idle(id);
      const room = store.room(id),
        r = room.world.records[input.characterId];
      if (!r || !(r.data.specialties as string[]).length)
        throw new Fault('先和主持人完成角色草案。');
      r.data.ready = true;
      room.worldVersion++;
      room.revision++;
      store.saveRoom(room);
      return { adopted: true };
    });
  });
  app.post('/api/rooms/:id/delegation', async (req) => {
    const { id, seat } = auth(req),
      input = body.extend({ characterId: z.string(), enabled: z.boolean() }).parse(req.body);
    owned(seat, input.characterId);
    return update(id, seat, input.requestId, { route: 'delegate', ...input }, () => {
      idle(id);
      const room = store.room(id);
      room.world.records[input.characterId].data.delegated = input.enabled;
      room.worldVersion++;
      room.revision++;
      store.saveRoom(room);
      return { enabled: input.enabled };
    });
  });
  app.post('/api/rooms/:id/board', async (req) => {
    const { id, seat } = auth(req),
      input = body
        .extend({
          actionId: z.string().optional(),
          characterId: z.string(),
          text: z.string().min(1).max(8000),
          private: z.boolean().default(false),
        })
        .parse(req.body);
    owned(seat, input.characterId);
    return update(id, seat, input.requestId, { route: 'board', ...input }, () => {
      const room = store.room(id);
      if (!room.world.records[input.characterId]?.data.ready)
        throw new Fault('角色采用档案后才能行动。');
      const existing = input.actionId ? room.board.find((a) => a.id === input.actionId) : undefined;
      if (input.actionId && (!existing || existing.seatId !== seat.id))
        throw new Fault('行动已经冻结或不属于你。', 409);
      const intent: Intent = {
        id: existing?.id ?? uid('action'),
        seatId: seat.id,
        characterId: input.characterId,
        text: input.text,
        audience: input.private ? [input.characterId] : ['table'],
        createdAt: existing?.createdAt ?? new Date().toISOString(),
      };
      room.board = room.board.filter((a) => a.id !== intent.id);
      room.board.push(intent);
      room.revision++;
      store.saveRoom(room);
      return { actionId: intent.id };
    });
  });
  app.post('/api/rooms/:id/withdraw', async (req) => {
    const { id, seat } = auth(req),
      input = body.extend({ actionId: z.string() }).parse(req.body);
    return update(id, seat, input.requestId, { route: 'withdraw', ...input }, () => {
      const room = store.room(id),
        a = room.board.find((a) => a.id === input.actionId);
      if (!a || a.seatId !== seat.id) throw new Fault('只能撤回自己尚未冻结的行动。', 409);
      room.board = room.board.filter((a) => a.id !== input.actionId);
      room.revision++;
      store.saveRoom(room);
      return { withdrawn: true };
    });
  });
  app.post('/api/rooms/:id/messages', async (req) => {
    const { id, seat } = auth(req),
      input = body
        .extend({
          text: z.string().min(1).max(8000),
          askGM: z.boolean().default(false),
          characterId: z.string().optional(),
          private: z.boolean().default(false),
        })
        .parse(req.body);
    if (input.characterId) owned(seat, input.characterId);
    if (input.private && !input.characterId) throw new Fault('私密讨论需要指定自己的角色。');
    const result = update(id, seat, input.requestId, { route: 'message', ...input }, () => {
      if (input.askGM) idle(id);
      const room = store.room(id);
      room.messages.push({
        id: uid('msg'),
        seatId: seat.id,
        name: seat.name,
        text: input.text,
        audience: input.private ? [input.characterId!] : ['table'],
        createdAt: new Date().toISOString(),
      });
      room.revision++;
      store.saveRoom(room);
      return input.askGM
        ? {
            runId: start(
              id,
              'discussion',
              input.text,
              input.characterId,
              input.private ? [input.characterId!] : ['table'],
            ).id,
          }
        : { sent: true };
    }) as { runId?: string };
    if (result.runId) {
      const run = store.run(result.runId);
      if (run.status === 'running') launch(run);
    }
    return result;
  });
  app.post('/api/rooms/:id/run', async (req) => {
    const { id, seat } = auth(req);
    host(seat);
    const input = body.parse(req.body);
    const result = update(id, seat, input.requestId, { route: 'run', ...input }, () => ({
      runId: start(id, 'round', '按各玩家提交的意图主持这一批行动。').id,
    })) as { runId: string };
    const run = store.run(result.runId);
    if (run.status === 'running') launch(run);
    return result;
  });
  app.post('/api/rooms/:id/answer', async (req) => {
    const { id, seat } = auth(req),
      input = body
        .extend({ runId: z.string(), characterId: z.string(), text: z.string().min(1).max(6000) })
        .parse(req.body);
    owned(seat, input.characterId);
    const result = update(id, seat, input.requestId, { route: 'answer', ...input }, () => {
      const run = store.run(input.runId);
      if (
        run.roomId !== id ||
        run.status !== 'waiting' ||
        !run.question?.characters.includes(input.characterId)
      )
        throw new Fault('当前没有等待你的这个回答。', 409);
      run.question.answers[input.characterId] = input.text;
      if (run.question.characters.every((c) => run.question!.answers[c])) {
        run.status = 'running';
        run.metrics.resumptions++;
      }
      store.saveRun(run);
      return { runId: run.id, resume: run.status === 'running' };
    }) as { runId: string; resume: boolean };
    if (result.resume && store.run(result.runId).status === 'running')
      launch(store.run(result.runId));
    return result;
  });
  app.post('/api/rooms/:id/resume', async (req) => {
    const { id, seat } = auth(req);
    const input = body.extend({ runId: z.string() }).parse(req.body);
    const result = update(id, seat, input.requestId, { route: 'resume', ...input }, () => {
      const run = store.run(input.runId);
      if (run.roomId !== id) throw new Fault('裁决不属于此团桌。', 403);
      if (!seat.host && (!run.ownerCharacter || !seat.characters.includes(run.ownerCharacter)))
        throw new Fault('由房主或角色所有者继续裁决。', 403);
      if (run.status !== 'failed') throw new Fault('这轮没有中断。', 409);
      run.status = 'running';
      delete run.error;
      run.metrics.resumptions++;
      store.saveRun(run);
      return { runId: run.id };
    }) as { runId: string };
    if (store.run(result.runId).status === 'running') launch(store.run(result.runId));
    return result;
  });
  app.post('/api/rooms/:id/stop', async (req) => {
    const { id, seat } = auth(req);
    host(seat);
    const input = body.extend({ runId: z.string() }).parse(req.body);
    const result = update(id, seat, input.requestId, { route: 'stop', ...input }, () => {
      const run = store.run(input.runId);
      if (run.roomId !== id || run.status !== 'running')
        throw new Fault('没有正在运行的裁决。', 409);
      run.status = 'failed';
      run.error = '房主暂停了裁决，可从已保存的进度继续。';
      store.saveRun(run);
      return { stopped: true };
    });
    director.stop(id);
    return result;
  });
  app.post('/api/rooms/:id/compact', async (req) => {
    const { id, seat } = auth(req);
    host(seat);
    return { compacted: await director.compact(id) };
  });
  app.get('/api/rooms/:id/export', async (req, reply) => {
    const { id, seat } = auth(req);
    reply.header('Content-Disposition', `attachment; filename="greyzone-${id}.json"`);
    return project(store, store.room(id), seat);
  });
  app.post('/internal/mcp/:room', async (req, reply) => {
    const { room } = z.object({ room: z.string() }).parse(req.params);
    if (!director.authorized(room, req.headers.authorization?.replace(/^Bearer /, '') ?? ''))
      throw new Fault('工具连接无效。', 403);
    const mcp = new McpServer({ name: 'greyzone-table', version: '3.0.0' });
    for (const name of Object.keys(schemas) as (keyof typeof schemas)[])
      mcp.registerTool(
        name,
        { description: descriptions[name], inputSchema: schemas[name] },
        async (args: unknown) => {
          try {
            const bound = director.toolRun(room);
            const run = bound ? store.run(bound) : null;
            if (!run) throw new Fault('没有活动裁决。');
            director.progress?.(
              room,
              name.startsWith('context_')
                ? '主持人正在查阅资料'
                : name === 'turn_commit'
                  ? '主持人正在整理结果'
                  : '主持人正在裁决',
            );
            const result = tools.call(name, args, run.id);
            return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
          } catch (error) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    error: error instanceof Error ? error.message : '工具失败',
                    instruction:
                      '根据错误修正调用。未提交的数据不会出现在玩家视图；已掷骰不能重掷。',
                  }),
                },
              ],
            };
          }
        },
      );
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await mcp.connect(transport);
    reply.hijack();
    reply.raw.on('close', () => {
      void transport.close();
      void mcp.close();
    });
    await transport.handleRequest(req.raw, reply.raw, req.body);
  });
  if (options.serveStatic !== false && existsSync(resolve('dist/index.html'))) {
    void app.register(staticFiles, { root: resolve('dist') });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith('/api') || req.url.startsWith('/internal')
        ? reply.code(404).send({ error: '不存在的接口。' })
        : reply.sendFile('index.html'),
    );
  }
  app.addHook('onClose', async () => {
    await director.close();
    for (const set of streams.values()) for (const s of set) s.reply.raw.end();
    store.close();
  });
  return {
    app,
    store,
    library,
    tools,
    director,
    notify,
    setUrl: (url: string) => {
      if (director instanceof DshDirector) director.baseUrl = url;
    },
  };
}
