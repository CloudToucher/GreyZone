import type { FastifyInstance } from 'fastify';
import type { Store } from './store.js';
import type { Director } from './dsh.js';
import { z } from 'zod';

interface RoomMetrics {
  roomId: string;
  title: string;
  seats: number;
  characters: number;
  journalEntries: number;
  currentRun?: {
    id: string;
    kind: string;
    status: string;
    stage: string;
    metrics: {
      elapsedMs: number;
      toolCalls: number;
      modelCalls: number;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens?: number;
      cacheWriteTokens?: number;
    };
  };
  recentRuns: Array<{
    id: string;
    kind: string;
    status: string;
    createdAt: string;
    metrics: any;
  }>;
}

interface ToolCallMetric {
  seq: number;
  run: string;
  name: string;
  elapsedMs: number;
  inputBytes: number;
  outputBytes: number;
  error?: string;
}

export function registerMonitorRoutes(app: FastifyInstance, store: Store, director: Director) {
  const adminAuth = (headers: { authorization?: string }) => {
    const token = headers.authorization?.replace(/^Bearer /, '');
    const expected = process.env.MONITOR_TOKEN;
    if (!expected) throw new Error('MONITOR_TOKEN 未配置');
    if (token !== expected) throw new Error('无权访问监控页面');
  };

  // 总览
  app.get('/monitor/overview', async (req, reply) => {
    try {
      adminAuth(req.headers);
    } catch (e) {
      return reply.code(403).send({ error: (e as Error).message });
    }

    const rooms = store.db.prepare('SELECT data FROM campaigns').all() as Array<{ data: string }>;
    const metrics: RoomMetrics[] = [];

    for (const row of rooms) {
      const room = JSON.parse(row.data);
      const seats = store.seats(room.id);
      const activeRun = store.active(room.id);

      const recentRuns = store.db
        .prepare('SELECT data FROM runs WHERE roomId=? ORDER BY createdAt DESC LIMIT 10')
        .all(room.id)
        .map((r: any) => {
          const run = JSON.parse(r.data);
          return {
            id: run.id,
            kind: run.kind,
            status: run.status,
            createdAt: run.createdAt,
            metrics: run.metrics,
          };
        });

      metrics.push({
        roomId: room.id,
        title: room.title,
        seats: seats.length,
        characters: seats.flatMap((s: any) => s.characters).length,
        journalEntries: room.journal.length,
        currentRun: activeRun
          ? {
              id: activeRun.id,
              kind: activeRun.kind,
              status: activeRun.status,
              stage: director.stage(room.id),
              metrics: activeRun.metrics,
            }
          : undefined,
        recentRuns,
      });
    }

    return reply.send({ rooms: metrics, timestamp: new Date().toISOString() });
  });

  // 单个房间详情
  app.get<{ Params: { id: string } }>('/monitor/rooms/:id', async (req, reply) => {
    try {
      adminAuth(req.headers);
    } catch (e) {
      return reply.code(403).send({ error: (e as Error).message });
    }

    const { id } = z.object({ id: z.string() }).parse(req.params);
    const room = store.room(id);
    const seats = store.seats(id);
    const activeRun = store.active(id);

    // 获取所有运行记录
    const runs = store.db
      .prepare('SELECT data FROM runs WHERE roomId=? ORDER BY createdAt DESC')
      .all(id)
      .map((r: any) => JSON.parse(r.data));

    // 获取工具调用统计
    const toolMetrics = store.db
      .prepare(
        `SELECT seq, run, data FROM metrics
         WHERE run IN (SELECT id FROM runs WHERE roomId=?)
         ORDER BY seq DESC LIMIT 200`,
      )
      .all(id)
      .map((r: any) => {
        const data = JSON.parse(r.data);
        return data.kind === 'tool'
          ? {
              seq: r.seq,
              run: r.run,
              name: data.name,
              elapsedMs: data.elapsedMs,
              inputBytes: data.inputBytes,
              outputBytes: data.outputBytes,
              error: data.error,
            }
          : null;
      })
      .filter(Boolean) as ToolCallMetric[];

    // 审计日志
    const auditLog = store.db
      .prepare('SELECT * FROM audit WHERE room=? ORDER BY seq DESC LIMIT 50')
      .all(id)
      .map((r: any) => ({
        seq: r.seq,
        run: r.run,
        checkpoint: r.checkpoint,
        data: JSON.parse(r.data),
        created: r.created,
      }));

    return reply.send({
      room: {
        id: room.id,
        title: room.title,
        worldVersion: room.worldVersion,
        revision: room.revision,
        sessionId: room.sessionId,
        sessionReady: room.sessionReady,
      },
      seats: seats.map((s) => ({
        id: s.id,
        name: s.name,
        host: s.host,
        characters: s.characters,
      })),
      currentRun: activeRun
        ? {
            ...activeRun,
            stage: director.stage(id),
          }
        : null,
      runs,
      toolMetrics,
      auditLog,
      records: Object.keys(room.world.records).length,
      boardCount: room.board.length,
    });
  });

  // 性能统计
  app.get<{ Params: { id: string } }>('/monitor/rooms/:id/performance', async (req, reply) => {
    try {
      adminAuth(req.headers);
    } catch (e) {
      return reply.code(403).send({ error: (e as Error).message });
    }

    const { id } = z.object({ id: z.string() }).parse(req.params);

    // 聚合工具性能
    const toolStats = store.db
      .prepare(
        `SELECT
          json_extract(data, '$.name') as name,
          COUNT(*) as count,
          AVG(json_extract(data, '$.elapsedMs')) as avgMs,
          MAX(json_extract(data, '$.elapsedMs')) as maxMs,
          SUM(CASE WHEN json_extract(data, '$.error') IS NOT NULL THEN 1 ELSE 0 END) as errors
         FROM metrics
         WHERE run IN (SELECT id FROM runs WHERE roomId=?)
         AND json_extract(data, '$.kind') = 'tool'
         GROUP BY name`,
      )
      .all(id);

    // 聚合运行性能
    const runStats = store.db
      .prepare(
        `SELECT
          json_extract(data, '$.kind') as kind,
          COUNT(*) as count,
          AVG(json_extract(data, '$.metrics.elapsedMs')) as avgElapsedMs,
          SUM(json_extract(data, '$.metrics.toolCalls')) as totalToolCalls,
          SUM(json_extract(data, '$.metrics.modelCalls')) as totalModelCalls,
          SUM(json_extract(data, '$.metrics.inputTokens')) as totalInputTokens,
          SUM(json_extract(data, '$.metrics.outputTokens')) as totalOutputTokens
         FROM runs
         WHERE roomId=?
         GROUP BY kind`,
      )
      .all(id);

    return reply.send({
      tools: toolStats,
      runs: runStats,
    });
  });

  // 监控页面HTML
  app.get('/monitor', async (req, reply) => {
    try {
      adminAuth(req.headers);
    } catch (e) {
      return reply.type('text/html').send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>监控登录</title>
          <style>
            body { font-family: system-ui; max-width: 400px; margin: 100px auto; padding: 20px; }
            input { width: 100%; padding: 8px; margin: 10px 0; }
            button { width: 100%; padding: 10px; background: #333; color: white; border: none; cursor: pointer; }
          </style>
        </head>
        <body>
          <h2>灰区团桌 - 监控面板</h2>
          <form onsubmit="event.preventDefault(); localStorage.setItem('monitor_token', document.getElementById('token').value); location.reload();">
            <input id="token" type="password" placeholder="输入 MONITOR_TOKEN" required>
            <button>登录</button>
          </form>
          <script>
            const saved = localStorage.getItem('monitor_token');
            if (saved) document.getElementById('token').value = saved;
          </script>
        </body>
        </html>
      `);
    }

    reply.type('text/html').send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>灰区团桌 - 监控面板</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0a0f0d;
      color: #d3dace;
      line-height: 1.5;
    }
    .header {
      background: #1a2420;
      padding: 20px;
      border-bottom: 1px solid #293633;
      position: sticky;
      top: 0;
      z-index: 10;
    }
    .header h1 { font-size: 20px; color: #d5b57b; }
    .header .status {
      margin-top: 5px;
      font-size: 13px;
      color: #8a9a8e;
    }
    .container { max-width: 1400px; margin: 0 auto; padding: 20px; }
    .rooms { display: grid; grid-template-columns: repeat(auto-fill, minmax(350px, 1fr)); gap: 20px; margin-bottom: 30px; }
    .room-card {
      background: #1a2420;
      border: 1px solid #293633;
      border-radius: 8px;
      padding: 20px;
      transition: border-color 0.2s;
    }
    .room-card:hover { border-color: #637d71; }
    .room-card h3 { color: #d5b57b; margin-bottom: 10px; }
    .room-card .code {
      display: inline-block;
      background: #293633;
      padding: 4px 8px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 14px;
    }
    .metrics {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
      margin: 15px 0;
      font-size: 13px;
    }
    .metric {
      background: #0f1512;
      padding: 10px;
      border-radius: 4px;
    }
    .metric-label { color: #8a9a8e; font-size: 11px; }
    .metric-value { color: #d3dace; font-size: 18px; font-weight: 600; }
    .status-badge {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 500;
      margin-top: 10px;
    }
    .status-running { background: rgba(213, 181, 123, 0.15); color: #d5b57b; }
    .status-idle { background: rgba(138, 154, 142, 0.15); color: #8a9a8e; }
    .status-failed { background: rgba(220, 100, 100, 0.15); color: #dc6464; }
    .section { margin-top: 30px; }
    .section h2 {
      color: #d5b57b;
      font-size: 18px;
      margin-bottom: 15px;
      padding-bottom: 10px;
      border-bottom: 1px solid #293633;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      background: #1a2420;
      border-radius: 8px;
      overflow: hidden;
    }
    th {
      background: #0f1512;
      padding: 12px;
      text-align: left;
      font-size: 12px;
      color: #8a9a8e;
      text-transform: uppercase;
      font-weight: 500;
    }
    td {
      padding: 12px;
      border-top: 1px solid #293633;
      font-size: 13px;
    }
    .mono { font-family: monospace; color: #a2b3a9; }
    .error { color: #dc6464; }
    button {
      background: #293633;
      color: #d3dace;
      border: none;
      padding: 8px 16px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
      transition: background 0.2s;
    }
    button:hover { background: #3a4843; }
    .refresh {
      position: fixed;
      bottom: 20px;
      right: 20px;
      padding: 12px 24px;
      background: #d5b57b;
      color: #0a0f0d;
      font-weight: 600;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>灰区团桌 · 监控面板</h1>
    <div class="status">实时监控 · <span id="timestamp">加载中...</span></div>
  </div>
  <div class="container">
    <div id="rooms" class="rooms"></div>
    <div id="details"></div>
  </div>
  <button class="refresh" onclick="loadData()">刷新数据</button>
  <script>
    const token = localStorage.getItem('monitor_token');
    if (!token) {
      location.href = '/monitor';
    }

    async function api(path) {
      const res = await fetch(path, {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      if (!res.ok) throw new Error('加载失败');
      return res.json();
    }

    function formatBytes(bytes) {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / 1048576).toFixed(2) + ' MB';
    }

    function formatMs(ms) {
      if (ms < 1000) return ms.toFixed(0) + 'ms';
      if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
      return (ms / 60000).toFixed(1) + 'min';
    }

    function formatTokens(n) {
      if (!n) return '0';
      if (n < 1000) return n;
      if (n < 1000000) return (n / 1000).toFixed(1) + 'K';
      return (n / 1000000).toFixed(2) + 'M';
    }

    async function loadData() {
      try {
        const data = await api('/monitor/overview');
        document.getElementById('timestamp').textContent = new Date(data.timestamp).toLocaleString('zh-CN');

        const roomsHtml = data.rooms.map(room => {
          const run = room.currentRun;
          const statusClass = run?.status === 'running' ? 'status-running' :
                             run?.status === 'failed' ? 'status-failed' : 'status-idle';
          const statusText = run?.status === 'running' ? '运行中' :
                            run?.status === 'failed' ? '已中断' : '空闲';

          return \`
            <div class="room-card" onclick="loadRoom('\${room.roomId}')">
              <h3>\${room.title}</h3>
              <span class="code">\${room.roomId}</span>
              <div class="metrics">
                <div class="metric">
                  <div class="metric-label">玩家/角色</div>
                  <div class="metric-value">\${room.seats} / \${room.characters}</div>
                </div>
                <div class="metric">
                  <div class="metric-label">团录条目</div>
                  <div class="metric-value">\${room.journalEntries}</div>
                </div>
              </div>
              \${run ? \`
                <div class="status-badge \${statusClass}">\${statusText} · \${run.kind}</div>
                <div style="margin-top: 10px; font-size: 12px; color: #8a9a8e;">
                  \${run.stage || '主持中'}<br>
                  模型调用: \${run.metrics.modelCalls} · 工具: \${run.metrics.toolCalls}<br>
                  Token: \${formatTokens(run.metrics.inputTokens)} in / \${formatTokens(run.metrics.outputTokens)} out
                </div>
              \` : '<div class="status-badge status-idle">无活动裁决</div>'}
            </div>
          \`;
        }).join('');

        document.getElementById('rooms').innerHTML = roomsHtml;
      } catch (e) {
        alert('加载失败: ' + e.message);
      }
    }

    async function loadRoom(id) {
      const data = await api('/monitor/rooms/' + id);
      const perf = await api('/monitor/rooms/' + id + '/performance');

      let html = '<div class="section"><h2>' + data.room.title + ' (' + id + ') 详细信息</h2>';

      // 当前运行
      if (data.currentRun) {
        const r = data.currentRun;
        html += \`<table style="margin-bottom: 20px;">
          <tr><th>当前裁决</th><th>状态</th><th>耗时</th><th>工具调用</th><th>模型调用</th></tr>
          <tr>
            <td class="mono">\${r.id.slice(0, 12)}</td>
            <td>\${r.status} · \${r.kind}</td>
            <td>\${formatMs(r.metrics.elapsedMs)}</td>
            <td>\${r.metrics.toolCalls}</td>
            <td>\${r.metrics.modelCalls}</td>
          </tr>
        </table>\`;
      }

      // 工具性能
      html += '<h2>工具性能统计</h2><table><tr><th>工具名</th><th>调用次数</th><th>平均耗时</th><th>最大耗时</th><th>错误次数</th></tr>';
      perf.tools.forEach(t => {
        html += \`<tr>
          <td class="mono">\${t.name}</td>
          <td>\${t.count}</td>
          <td>\${formatMs(t.avgMs)}</td>
          <td>\${formatMs(t.maxMs)}</td>
          <td class="\${t.errors > 0 ? 'error' : ''}">\${t.errors}</td>
        </tr>\`;
      });
      html += '</table>';

      // 最近工具调用
      html += '<h2 style="margin-top: 30px;">最近工具调用</h2><table><tr><th>工具</th><th>Run</th><th>耗时</th><th>输入</th><th>输出</th><th>状态</th></tr>';
      data.toolMetrics.slice(0, 30).forEach(m => {
        html += \`<tr>
          <td class="mono">\${m.name}</td>
          <td class="mono">\${m.run.slice(0, 8)}</td>
          <td>\${formatMs(m.elapsedMs)}</td>
          <td>\${formatBytes(m.inputBytes)}</td>
          <td>\${formatBytes(m.outputBytes)}</td>
          <td class="\${m.error ? 'error' : ''}">\${m.error || 'OK'}</td>
        </tr>\`;
      });
      html += '</table></div>';

      document.getElementById('details').innerHTML = html;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    loadData();
    setInterval(loadData, 10000); // 10秒自动刷新
  </script>
</body>
</html>
    `);
  });
}
