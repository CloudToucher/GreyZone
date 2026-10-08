// Loaded by dsh/Cordis. This is a transport adapter, not a model/tool loop.
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const pkg = (name) => pathToFileURL(join(process.env.GZ_DSH_PACKAGES, name, 'lib/index.js')).href;
const { createUserMessage } = await import(pkg('dsh-llm'));
const { installModelSelection } = await import(pkg('dsh-agent'));
export const name = 'greyzone-runner';
export const inject = ['agents', 'agentDefaultModel', 'sessions', 'systemPrompt', 'compaction'];
const send = (value) => process.stdout.write('GZ_RPC ' + JSON.stringify(value) + '\n');
export function apply(ctx) {
  let handle,
    busy = false;
  const persona = readFileSync(process.env.GZ_PERSONA_FILE, 'utf8');
  async function boot(resume) {
    if (handle) return handle.agent;
    const selection = ctx.agentDefaultModel.currentSelection();
    const setup = (agentCtx) => {
      installModelSelection(agentCtx, { current: selection, assembled: undefined });
      agentCtx.effect(
        () =>
          agentCtx.systemPrompt.section({
            name: 'deployment:persona',
            order: 0,
            text: persona,
            complete: true,
          }),
        'gm.persona',
      );
      agentCtx.systemPrompt.suppressRuntimeContext();
    };
    handle = resume
      ? await ctx.agents.resume({
          resumeSessionId: process.env.GZ_SESSION,
          setup,
          agentOptions: { provider: selection.provider, model: selection.model },
        })
      : await ctx.agents.create({
          sessionId: process.env.GZ_SESSION,
          meta: { cwd: process.cwd() },
          setup,
          agentOptions: { provider: selection.provider, model: selection.model },
        });
    await ctx.sessions.flush(handle.agent.session);
    send({ booted: true });
    return handle.agent;
  }
  const input = createInterface({ input: process.stdin });
  input.on('line', async (line) => {
    let request;
    let ownsBusy = false;
    try {
      request = JSON.parse(line);
      if (request.method === 'cancel') {
        handle?.agent.cancel({ kind: 'user' });
        send({ id: request.id, ok: true });
        return;
      }
      if (request.method === 'shutdown') {
        await handle?.dispose();
        ctx.appExit(0);
        return;
      }
      if (busy) throw new Error('GM_BUSY');
      busy = true;
      ownsBusy = true;
      const agent = await boot(request.resume);
      await agent.whenIdle();
      const first = agent.session.seq;
      const start = Date.now();
      if (request.method === 'compact') {
        const result = await ctx.compaction.compactNow(agent, new AbortController().signal);
        await ctx.sessions.flush(agent.session);
        const events = agent.session.events.filter(
          (e) => e.seq >= first && e.type === 'compaction/summary',
        );
        send({
          id: request.id,
          ok: true,
          compacted: result !== null,
          metrics: {
            elapsedMs: Date.now() - start,
            modelCalls: events.length,
            compactions: events.length,
            inputTokens: events.reduce((n, e) => n + (e.data.usage?.inputTokens ?? 0), 0),
            outputTokens: events.reduce((n, e) => n + (e.data.usage?.outputTokens ?? 0), 0),
            cacheReadTokens: events.reduce((n, e) => n + (e.data.usage?.cacheReadTokens ?? 0), 0),
            cacheWriteTokens: events.reduce((n, e) => n + (e.data.usage?.cacheWriteTokens ?? 0), 0),
          },
        });
      } else {
        agent.followup(
          createUserMessage({
            content: [{ type: 'text', text: request.prompt }],
            source: { kind: 'user' },
          }),
        );
        await agent.whenIdle();
        await ctx.sessions.flush(agent.session);
        const events = agent.session.events.filter((e) => e.seq >= first);
        const messages = events.filter((e) => e.type === 'assistant/message');
        const metrics = {
          elapsedMs: Date.now() - start,
          modelCalls:
            messages.length + events.filter((e) => e.type === 'compaction/summary').length,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          compactions: events.filter((e) => e.type === 'compaction/summary').length,
        };
        for (const e of events.filter(
          (e) => e.type === 'assistant/message' || e.type === 'compaction/summary',
        )) {
          metrics.inputTokens += e.data.usage?.inputTokens ?? 0;
          metrics.outputTokens += e.data.usage?.outputTokens ?? 0;
          metrics.cacheReadTokens += e.data.usage?.cacheReadTokens ?? 0;
          metrics.cacheWriteTokens += e.data.usage?.cacheWriteTokens ?? 0;
        }
        const end = events.filter((e) => e.type === 'turn/end').at(-1);
        send({
          id: request.id,
          ok: end?.data.reason?.kind === 'completed',
          metrics,
          reason: end?.data.reason?.kind ?? 'unknown',
        });
      }
    } catch (error) {
      send({ id: request?.id, ok: false, error: String(error?.message ?? error).slice(0, 1500) });
    } finally {
      if (ownsBusy) busy = false;
    }
  });
  input.on('close', () => {
    void handle?.dispose().finally(() => ctx.appExit(0));
  });
  ctx.effect(() => () => input.close(), 'gm.input');
  ctx
    .get('loader')
    ?.await()
    .then(() => send({ ready: true }))
    .catch((error) => send({ startupError: String(error.message) }));
}
