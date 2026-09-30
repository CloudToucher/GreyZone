import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Backpack,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Crosshair,
  Download,
  Flag,
  HeartPulse,
  MapPin,
  Radio,
  RotateCcw,
  Send,
  Shield,
  Users,
  X,
  Zap,
} from 'lucide-react';
import {
  capacity,
  carriedWeight,
  gameDate,
  profileNames,
  schoolNames,
  skillNames,
  statNames,
  type Command,
  type Profile,
  type PublicState,
  type School,
  type SessionCredentials,
  type Amendment,
} from '../shared/types';
import { ApiError, api, makeRequestId, subscribe } from './api';
import Map from './Map';
import { Landing, Workshop, PersonalDetails } from './Entry';
const KEY = 'greyzone.session.v2';
const RECENT = 'greyzone.recent.v2';
type RecentRoom = SessionCredentials & { name: string };
function recentRooms(): RecentRoom[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT) ?? '[]');
  } catch {
    return [];
  }
}
const schoolLimits: Record<School, string> = {
  none: '没有异能。依靠训练、装备和判断，同样能够进入灰区。',
  body: '短时强化一次发力。消耗2能量；无法抵挡步枪弹或恢复创伤。',
  element: '五米内对可见目标施加一次共振冲击。消耗3能量。',
  sense: '二十米内感知活动与能量轮廓。消耗2能量；无法读心或识别身份。',
  space: '十米内察觉空间扭曲，偏转手边轻物。消耗3能量；初阶无法瞬移。',
  mind: '稳定自身恐惧，或接触自愿者协助集中注意。消耗2能量；不能心控。',
};
function Rules({ close }: { close: () => void }) {
  return (
    <div className="modal-backdrop" onClick={close}>
      <section
        className="rules modal"
        role="dialog"
        aria-modal="true"
        aria-label="行动规则"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="icon close" onClick={close} aria-label="关闭规则">
          <X size={20} />
        </button>
        <span className="eyebrow">FIELD MANUAL / 02</span>
        <h2>先说办法，再承担结果。</h2>
        <p>
          你控制自己的角色。地图、物品和合同提供已知条件；自由输入用于交涉、改造、布置陷阱、寻找其他路线，以及任何有依据的行动。
        </p>
        <div className="rule-grid">
          <article>
            <b>01 / 裁定</b>
            <p>
              提问与讨论直接交流。需要承担代价的行动会列出时间、材料、检定与风险，你可以追问、改办法或确认。
            </p>
          </article>
          <article>
            <b>02 / 百分骰</b>
            <p>
              D100
              不超过目标值即成功。目标值来自属性×5、训练、环境、疲劳和伤势；普通检定限制在5%至95%。确定的事无需掷骰。
            </p>
          </article>
          <article>
            <b>03 / 活下来</b>
            <p>
              枪弹逐发计算。躯干护甲按装备记录减轻伤势。出血随时间持续，血量低于35失去意识，归零死亡。止血不等于治愈。
            </p>
          </article>
          <article>
            <b>04 / 异能</b>
            <p>
              灰区内适应一小时，接触结晶才能使用。连续使用增加耗能；共鸣加负荷超过意志会反噬。离开区域立即失效。
            </p>
          </article>
          <article>
            <b>05 / 时间</b>
            <p>
              移动、治疗、等待推动同一世界时钟。黑潮按周向外扩散，人物会迁移、供应会收缩。关闭网页不会推进游戏时间。
            </p>
          </article>
          <article>
            <b>06 / 多人</b>
            <p>
              最多四名玩家，各自拥有位置、装备和行动权。依次提交裁定，只有行动者能确认。长时间行动会影响所有人的饥渴和出血。
            </p>
          </article>
        </div>
        <p className="muted">
          属性采用1—10量表，身份、专长与装备来自你和主持人的共同设定。异能按谈妥的原理、范围与代价裁定，特殊用法和能力成长都可以继续商量。
        </p>
      </section>
    </div>
  );
}
type Retry = { path: string; body: Record<string, unknown> };
function SheetChanges({ changes }: { changes: Amendment['changes'] }) {
  return (
    <div className="sheet-changes">
      {changes.background && <p>{changes.background}</p>}
      {changes.personal && (
        <PersonalDetails
          personal={{
            identity: '',
            appearance: '',
            motives: '',
            relationships: '',
            preferences: '',
            boundaries: '',
            advantages: '',
            complications: '',
            notes: '',
            ...changes.personal,
          }}
        />
      )}
      {changes.stats && (
        <p>
          属性：
          {Object.entries(changes.stats)
            .map(([k, v]) => `${statNames[k as keyof typeof statNames]} ${v}`)
            .join(' · ')}
        </p>
      )}
      {changes.training && (
        <p>
          训练：
          {Object.entries(changes.training)
            .map(([k, v]) => `${skillNames[k as keyof typeof skillNames] ?? k} ${v}`)
            .join(' · ')}
        </p>
      )}
      {changes.expertise && (
        <section>
          <b>修订后的专长</b>
          {changes.expertise.length ? (
            changes.expertise.map((e) => (
              <p key={e.name}>
                {e.name} · {statNames[e.attribute]} + {e.training}
                <br />
                {e.scope}
              </p>
            ))
          ) : (
            <p>无专长</p>
          )}
        </section>
      )}
      {changes.abilities && (
        <section>
          <b>修订后的异能</b>
          {changes.abilities.length ? (
            changes.abilities.map((a) => (
              <div key={a.id}>
                <h4>
                  {a.name} · {schoolNames[a.school]}
                </h4>
                <p>{a.description}</p>
                <p>{a.applications}</p>
                <p>{a.limits}</p>
                <p>
                  能耗 {a.cost} · 负荷 +{a.strain} · {a.consequences}
                </p>
              </div>
            ))
          ) : (
            <p>无异能</p>
          )}
        </section>
      )}
    </div>
  );
}
export default function App() {
  const [credentials, setCredentials] = useState<SessionCredentials | null>(() => {
      try {
        return JSON.parse(localStorage.getItem(KEY) ?? 'null');
      } catch {
        return null;
      }
    }),
    [state, setState] = useState<PublicState | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [connected, setConnected] = useState(false),
    [rules, setRules] = useState(false),
    [intent, setIntent] = useState(''),
    [retry, setRetry] = useState<Retry | null>(null),
    [tab, setTab] = useState('map'),
    [mobile, setMobile] = useState('scene'),
    [selected, setSelected] = useState(''),
    [showInventory, setShowInventory] = useState(true),
    [mapExpanded, setMapExpanded] = useState(false),
    [history, setHistory] = useState(12);
  const current = useRef<PublicState | null>(null),
    sending = useRef(false),
    startedWorkshop = useRef(new Set<string>()),
    conversationEnd = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (mobile === 'scene')
      conversationEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [state?.journal.length, state?.proposal?.id, state?.sheetProposal?.id]);
  const accept = (s: PublicState) => {
    if (!current.current || s.id !== current.current.id || s.revision >= current.current.revision) {
      current.current = s;
      setState(s);
    }
  };
  useEffect(() => {
    if (!credentials) return;
    const abort = new AbortController();
    api<PublicState>(`/rooms/${credentials.room}`, undefined, credentials, abort.signal)
      .then((s) => {
        if (!abort.signal.aborted) accept(s);
      })
      .catch((e) => {
        if (abort.signal.aborted) return;
        setError(e.message);
        if (e instanceof ApiError && [401, 404].includes(e.status)) {
          localStorage.removeItem(KEY);
          setCredentials(null);
        }
      });
    void subscribe(
      credentials,
      abort.signal,
      (s) => {
        if (!abort.signal.aborted) accept(s);
      },
      setConnected,
    );
    return () => abort.abort();
  }, [credentials]);
  useEffect(() => {
    const w = state?.workshop;
    if (
      !state ||
      !credentials ||
      !w ||
      w.accepted ||
      w.version ||
      busy ||
      state.busy ||
      retry ||
      error ||
      startedWorkshop.current.has(w.requestId)
    )
      return;
    startedWorkshop.current.add(w.requestId);
    void send('workshop', { requestId: w.requestId, revision: state.revision, message: w.seed });
  }, [state, credentials, busy, retry, error]);
  useEffect(() => {
    if (!state || !credentials) return;
    const me = state.characters.find((c) => c.id === state.me);
    if (me?.ready)
      localStorage.setItem(
        RECENT,
        JSON.stringify(
          recentRooms().map((r) => (r.token === credentials.token ? { ...r, name: me.name } : r)),
        ),
      );
  }, [state, credentials]);
  async function enter(concept: string, room?: string) {
    setBusy(true);
    setError('');
    try {
      const r = await api<SessionCredentials & { state: PublicState }>(
        room ? `/rooms/${room}/join` : '/rooms',
        { concept },
      );
      const c = { room: r.room, token: r.token };
      localStorage.setItem(KEY, JSON.stringify(c));
      localStorage.setItem(
        RECENT,
        JSON.stringify(
          [
            { ...c, name: concept.slice(0, 18) },
            ...recentRooms().filter((x) => x.token !== c.token),
          ].slice(0, 12),
        ),
      );
      setCredentials(c);
      accept(r.state);
    } catch (e) {
      setError(e instanceof Error ? e.message : '登记失败。');
    } finally {
      setBusy(false);
    }
  }
  async function send(path: string, body: Record<string, unknown>, isRetry = false) {
    if (!credentials || sending.current) return false;
    if (retry && !isRetry) return false;
    const request = { path, body };
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      const s = await api<PublicState>(`/rooms/${credentials.room}/${path}`, body, credentials);
      accept(s);
      setRetry(null);
      if (path === 'actions') setIntent('');
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : '网络中断，无法确认服务器是否收到请求。');
      if (e instanceof ApiError && e.status < 500) {
        setRetry(null);
        if (e.status === 409)
          await api<PublicState>(`/rooms/${credentials.room}`, undefined, credentials)
            .then(accept)
            .catch(() => {});
      } else setRetry(request);
      return false;
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  function prepare(command?: Command, text?: string) {
    if (!state || (command && state.proposal) || retry) return;
    void send('actions', {
      requestId: makeRequestId(),
      revision: state.revision,
      intent: text ?? intent,
      ...(command ? { command } : {}),
    });
  }
  function decision(value: 'confirm' | 'discard') {
    if (!state?.proposal) return;
    void send('decisions', {
      requestId: makeRequestId(),
      revision: state.revision,
      proposalId: state.proposal.id,
      decision: value,
    });
  }
  async function exportRecord() {
    if (!credentials) return;
    const data = await api<PublicState>(
      `/rooms/${credentials.room}/export`,
      undefined,
      credentials,
    );
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `greyzone-${credentials.room}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  function leave() {
    localStorage.removeItem(KEY);
    setCredentials(null);
    current.current = null;
    setState(null);
    setError('');
    setIntent('');
    setSelected('');
    setRetry(null);
  }
  if (!state)
    return (
      <>
        {recentRooms().length > 0 && (
          <div className="recent-rooms">
            <span>继续已有战役</span>
            {recentRooms().map((r) => (
              <button
                key={r.token}
                disabled={busy}
                onClick={() => {
                  current.current = null;
                  localStorage.setItem(KEY, JSON.stringify({ room: r.room, token: r.token }));
                  setError('');
                  setCredentials({ room: r.room, token: r.token });
                }}
              >
                {r.name} · {r.room}
                <ArrowRight size={13} />
              </button>
            ))}
          </div>
        )}
        <Landing enter={enter} busy={busy} error={error} />
        <button className="help-floating" onClick={() => setRules(true)}>
          <CircleHelp size={17} />
          行动规则
        </button>
        {rules && <Rules close={() => setRules(false)} />}
      </>
    );
  const me = state.characters.find((c) => c.id === state.me)!,
    here = state.locations.find((l) => l.id === me.location)!,
    target = state.locations.find((l) => l.id === selected) ?? here;
  if (!me.ready && state.workshop)
    return (
      <Workshop
        state={state}
        busy={busy}
        error={error}
        retry={retry ? () => void send(retry.path, retry.body, true) : null}
        send={(message) =>
          send('workshop', {
            requestId: state.workshop!.version === 0 ? state.workshop!.requestId : makeRequestId(),
            revision: state.revision,
            message,
          })
        }
        begin={() =>
          void send('begin', {
            requestId: makeRequestId(),
            revision: state.revision,
            version: state.workshop!.version,
          })
        }
        cancel={() =>
          void api(`/rooms/${state.id}/cancel`, {}, credentials!).catch((e) => setError(e.message))
        }
        leave={leave}
      />
    );
  const locked = busy || !!state.busy || !!state.proposal || !!retry || me.status !== 'active';
  const talkLocked =
    busy || !!state.busy || !!retry || (!!state.proposal && state.proposal.actorId !== me.id);
  const connectedRoutes = state.routes.filter(
      (r) => r.from === me.location || r.to === me.location,
    ),
    route = connectedRoutes.find((r) => r.from === target.id || r.to === target.id);
  const action = (cmd: Command, label: string) => prepare(cmd, label);
  const requestText = (text: string) => {
    setIntent(text);
    setMobile('scene');
  };
  return (
    <div className="game">
      <header className="game-head">
        <a className="brand" href="/">
          <span className="brand-mark">灰</span>
          <span>
            灰区：撤离<small>GREY ZONE / EXTRACTION</small>
          </span>
        </a>
        <div className="world-time">
          <Clock3 size={15} />
          <span>{gameDate(state.minute)}</span>
          <b>第 {Math.floor(state.minute / 1440) + 1} 天</b>
        </div>
        <nav>
          <span className="room-code">
            <Users size={14} />
            {state.id} · {state.characters.length}/4
          </span>
          <span
            className={`connection ${connected ? 'online' : ''}`}
            title={connected ? '实时连接正常' : '正在重连'}
          >
            <Radio size={14} />
            {state.mode === 'dsh' ? 'dsh 主持' : '规则演练'}
          </span>
          <button
            className="icon"
            title="导出公开记录"
            aria-label="导出公开记录"
            onClick={() => void exportRecord().catch((e) => setError(e.message))}
          >
            <Download size={17} />
          </button>
          <button className="icon" title="规则" aria-label="规则" onClick={() => setRules(true)}>
            <CircleHelp size={17} />
          </button>
          <button
            className="icon"
            title="切换战役"
            aria-label="切换战役"
            disabled={busy || !!state.busy || !!retry}
            onClick={() => {
              localStorage.removeItem(KEY);
              setCredentials(null);
              current.current = null;
              setState(null);
              setError('');
              setIntent('');
              setSelected('');
            }}
          >
            <RotateCcw size={16} />
          </button>
        </nav>
      </header>
      <div className="mobile-tabs">
        {[
          ['character', '角色'],
          ['scene', '现场'],
          ['world', '区域'],
        ].map(([k, v]) => (
          <button key={k} className={mobile === k ? 'active' : ''} onClick={() => setMobile(k)}>
            {v}
          </button>
        ))}
      </div>
      <main className={`workspace table-layout panel-${mobile}`}>
        <aside className={`character-column ${mobile === 'character' ? 'mobile-active' : ''}`}>
          <div className="column-label">
            <span>人员档案</span>
            <span>PERSONNEL / 01</span>
          </div>
          <div className="character-heading">
            <span className="avatar">{me.name.slice(0, 1)}</span>
            <div>
              <h2>{me.name}</h2>
              <p>
                {me.personal.identity || profileNames[me.profile as Profile] || me.profile} ·{' '}
                {schoolNames[me.school]}
              </p>
            </div>
          </div>
          <div className={`health-strip ${me.status !== 'active' ? 'critical' : ''}`}>
            <HeartPulse size={17} />
            <b>
              {me.status === 'dead'
                ? '已死亡'
                : me.status === 'unconscious'
                  ? '失去意识'
                  : me.wounds.length
                    ? '负伤'
                    : '可行动'}
            </b>
            <span>血量 {Math.floor(me.blood)} / 100</span>
          </div>
          <div className="vital-grid">
            <div>
              <span>疲劳</span>
              <b>
                {Math.round(me.fatigue)}
                <small> / 100</small>
              </b>
            </div>
            <div>
              <span>未补水</span>
              <b>
                {me.thirst.toFixed(1)}
                <small> 小时</small>
              </b>
            </div>
            <div>
              <span>未进食</span>
              <b>
                {me.hunger.toFixed(1)}
                <small> 小时</small>
              </b>
            </div>
            <div>
              <span>负重</span>
              <b className={carriedWeight(me) > capacity(me) ? 'danger-text' : ''}>
                {carriedWeight(me).toFixed(1)}
                <small> / {capacity(me)} kg</small>
              </b>
            </div>
          </div>
          <div className="attributes">
            {Object.entries(statNames).map(([k, v]) => (
              <div key={k}>
                <span>{v}</span>
                <b>{me.stats[k as keyof typeof statNames]}</b>
              </div>
            ))}
          </div>
          {me.school !== 'none' && (
            <section className="power-card">
              <div>
                <Zap size={15} />
                <b>{schoolNames[me.school]}</b>
                <span>
                  {Math.floor(me.energy)} / {me.stats.RSN * 3}
                </span>
              </div>
              {me.abilities.length ? (
                me.abilities.map((a) => (
                  <details key={a.id}>
                    <summary>
                      {a.name} · 能耗 {a.cost} · 负荷 +{a.strain}
                    </summary>
                    <p>{a.description}</p>
                    <p>{a.applications}</p>
                    <p>{a.limits}</p>
                    <p>{a.consequences}</p>
                  </details>
                ))
              ) : (
                <p>{schoolLimits[me.school]}</p>
              )}
              <small>
                负荷 {me.strain.toFixed(1)} · 区域适应 {Math.floor(me.acclimated)}/60 分钟
              </small>
            </section>
          )}
          {me.wounds.length > 0 && (
            <section className="wounds">
              <h3>伤情</h3>
              {me.wounds.map((w) => (
                <div key={w.id}>
                  <b>
                    {w.part} · {w.severity}级伤
                  </b>
                  <span>
                    {w.bleeding ? `出血 ${w.bleeding}/分钟` : '已止血'} · {w.cause}
                  </span>
                  {w.bleeding > 0 ? (
                    <button
                      disabled={locked}
                      onClick={() => action({ kind: 'bandage', woundId: w.id }, `包扎${w.part}`)}
                    >
                      包扎止血
                    </button>
                  ) : (
                    <button
                      disabled={locked}
                      onClick={() =>
                        action({ kind: 'treat', woundId: w.id }, `为${w.part}伤口清创`)
                      }
                    >
                      清创处理
                    </button>
                  )}
                </div>
              ))}
            </section>
          )}
          {me.conditions.map((condition) => (
            <div className="power-card" key={condition.id}>
              <b>{condition.name}</b>
              <p>{condition.description}</p>
              {condition.expiresAt !== null && <small>至 {gameDate(condition.expiresAt)}</small>}
            </div>
          ))}
          <div className="money">
            <span>
              灰币 <b>{me.cash.toLocaleString()}</b>
            </span>
            <span>
              欠款 <b>{me.debt.toLocaleString()}</b>
            </span>
          </div>
          <button className="inventory-heading" onClick={() => setShowInventory(!showInventory)}>
            <Backpack size={16} />
            <b>随身物品</b>
            <ChevronDown size={15} />
          </button>
          {showInventory && (
            <div className="inventory">
              {me.inventory.map((i) => (
                <details key={i.id}>
                  <summary>
                    <span>{i.name}</span>
                    <b>{i.weapon ? `${i.weapon.loaded}/${i.weapon.capacity}` : `×${i.quantity}`}</b>
                  </summary>
                  <p>{i.description}</p>
                  <span className="item-meta">
                    {(i.weight * i.quantity).toFixed(2)} kg · 参考单价 {i.value} 灰币
                  </span>
                  {i.weapon && (
                    <button
                      disabled={locked}
                      onClick={() => action({ kind: 'reload', itemId: i.id }, `装填${i.name}`)}
                    >
                      装填弹药
                    </button>
                  )}
                  {['food', 'water'].includes(i.kind) && (
                    <button
                      disabled={locked}
                      onClick={() => action({ kind: 'consume', itemId: i.id }, `使用${i.name}`)}
                    >
                      使用一份
                    </button>
                  )}
                  <button
                    disabled={locked || state.mode === 'local'}
                    onClick={() => requestText(`使用${i.name}，我想`)}
                  >
                    用于自由行动
                  </button>
                </details>
              ))}
            </div>
          )}
          <details className="background">
            <summary>经历与同伴</summary>
            <p>{me.background}</p>
            <PersonalDetails personal={me.personal} />
            {me.expertise.map((e) => (
              <p key={e.name}>
                <b>
                  {e.name} · {statNames[e.attribute]} + {e.training}
                </b>
                <br />
                {e.scope}
              </p>
            ))}
            {state.characters
              .filter((c) => c.id !== me.id)
              .map((c) => (
                <p key={c.id}>
                  <b>{c.name}</b> · {state.locations.find((l) => l.id === c.location)?.name}
                  <br />
                  {c.status === 'active'
                    ? '可以行动'
                    : c.status === 'dead'
                      ? '已死亡'
                      : '失去意识'}{' '}
                  · {c.wounds.length} 处伤
                </p>
              ))}
          </details>
        </aside>
        <section className={`scene-column ${mobile === 'scene' ? 'mobile-active' : ''}`}>
          <div className="scene-header">
            <div>
              <span className="eyebrow">
                {here.zone < 0 ? 'OUTSIDE' : `ZONE ${String(here.zone).padStart(2, '0')}`} /
                当前地点
              </span>
              <h1>{here.name}</h1>
            </div>
            <span className="position">
              <MapPin size={14} />
              {me.stance === 'cover'
                ? '依托掩体'
                : me.stance === 'hidden'
                  ? '保持隐蔽'
                  : '正常活动'}
            </span>
          </div>
          <div className="scene-description">
            <p>{here.description}</p>
            {here.zone >= state.fogZone && (
              <p className="danger-text">黑潮覆盖：能见度下降，异能额外耗能，停留增加疲劳。</p>
            )}
            <div className="quick-actions">
              <button disabled={locked} onClick={() => action({ kind: 'inspect' }, '观察附近')}>
                <Crosshair size={14} />
                观察附近
              </button>
              {here.shelter && (
                <button
                  disabled={locked}
                  onClick={() => action({ kind: 'rest', hours: 4 }, '在这里休息四小时')}
                >
                  <Clock3 size={14} />
                  休息四小时
                </button>
              )}
              <button
                onClick={() => {
                  setTab('map');
                  setMobile('world');
                }}
              >
                <MapPin size={14} />
                查看路线
              </button>
            </div>
          </div>
          <div className="journal-heading">
            <span>现场记录</span>
            <span>{state.journal.length} 条 · 结果持续保存</span>
          </div>
          <div className="journal" aria-live="polite">
            {state.journal.length > history && (
              <button className="text-button" onClick={() => setHistory(history + 20)}>
                查看更早的记录
              </button>
            )}
            {state.journal.slice(-history).map((e) => (
              <article className="entry" key={e.id}>
                <div className="entry-meta">
                  <time>{gameDate(e.minute).slice(11)}</time>
                  <span>{e.actor ?? '现场'}</span>
                  <b>{e.title}</b>
                </div>
                {e.intent && <blockquote>{e.intent}</blockquote>}
                <p>{e.text}</p>
                {e.roll && (
                  <div className={`roll ${e.roll.success ? 'passed' : 'failed'}`}>
                    <span>
                      {skillNames[e.roll.skill as keyof typeof skillNames] ?? e.roll.skill}
                    </span>
                    <b>
                      D100 <strong>{e.roll.value}</strong> / {e.roll.target}
                    </b>
                    <span>{e.roll.success ? '成功' : '失败'}</span>
                  </div>
                )}
                {e.facts.length > 0 && (
                  <details className="ledger">
                    <summary>结算记录 · {e.facts.length} 项</summary>
                    <ul>
                      {e.facts.map((f, i) => (
                        <li key={i}>{f}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </article>
            ))}
          </div>
          <div className="action-area">
            {state.sheetProposal && (
              <section className="proposal sheet-proposal">
                <span className="eyebrow">主持人提出的角色修订</span>
                <p>{state.sheetProposal.reason}</p>
                <SheetChanges changes={state.sheetProposal.changes} />
                <div className="proposal-buttons">
                  <button
                    className="primary"
                    disabled={locked}
                    onClick={() =>
                      void send('sheet-decisions', {
                        requestId: makeRequestId(),
                        revision: state.revision,
                        proposalId: state.sheetProposal!.id,
                        decision: 'confirm',
                      })
                    }
                  >
                    采用这份修订
                  </button>
                  <button
                    disabled={locked}
                    onClick={() =>
                      void send('sheet-decisions', {
                        requestId: makeRequestId(),
                        revision: state.revision,
                        proposalId: state.sheetProposal!.id,
                        decision: 'discard',
                      })
                    }
                  >
                    保持现有档案
                  </button>
                </div>
                <p className="muted">还想修改，可以继续告诉主持人。</p>
              </section>
            )}
            {error && (
              <div className="error" role="alert">
                {error}
                {retry && (
                  <button disabled={busy} onClick={() => void send(retry.path, retry.body, true)}>
                    <RotateCcw size={14} />
                    重试未确认请求
                  </button>
                )}
              </div>
            )}
            {state.busy && (
              <div className="thinking">
                <span className="spinner" />
                {state.busy}
                <button
                  onClick={() =>
                    void api(`/rooms/${state.id}/cancel`, {}, credentials!).catch((e) =>
                      setError(e.message),
                    )
                  }
                >
                  取消评估
                </button>
              </div>
            )}
            {state.proposal && (
              <section className="proposal">
                <div className="proposal-head">
                  <span>行动裁定 / 待确认</span>
                  <b>{state.characters.find((c) => c.id === state.proposal!.actorId)?.name}</b>
                </div>
                <h3>{state.proposal.summary}</h3>
                <p>{state.proposal.method}</p>
                <div className="proposal-stats">
                  <span>
                    <Clock3 size={14} />
                    {state.proposal.minutes} 分钟
                  </span>
                  <span>
                    <Crosshair size={14} />
                    {state.proposal.chance === null
                      ? '无需检定'
                      : `${skillNames[state.proposal.skill! as keyof typeof skillNames] ?? state.proposal.skill} ${state.proposal.chance}%`}
                  </span>
                  {state.proposal.powerCost > 0 && (
                    <span>
                      <Zap size={14} />
                      {state.proposal.powerCost} 能量 · 失控 {state.proposal.instability}%
                    </span>
                  )}
                </div>
                <p className="muted">{state.proposal.difficultyReason}</p>
                {state.proposal.costs.length > 0 && (
                  <p className="cost-line">消耗：{state.proposal.costs.join('、')}</p>
                )}
                <ul>
                  {state.proposal.risks.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
                <div className="proposal-buttons">
                  {state.proposal.actorId === me.id && (
                    <button
                      className="primary"
                      disabled={busy || !!retry}
                      onClick={() => decision('confirm')}
                    >
                      <Check size={16} />
                      确认行动
                    </button>
                  )}
                  {(state.proposal.actorId === me.id || state.isHost) && (
                    <button disabled={busy || !!retry} onClick={() => decision('discard')}>
                      撤回，修改办法
                    </button>
                  )}
                </div>
              </section>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                prepare();
              }}
            >
              <label htmlFor="intent" className="intent-label">
                接下来呢？
                <span>
                  {state.mode === 'local' ? '当前为基础规则演练' : '行动、对话，或和主持人商量'}
                </span>
              </label>
              <textarea
                id="intent"
                value={intent}
                onChange={(e) => setIntent(e.target.value)}
                disabled={talkLocked || state.mode === 'local'}
                maxLength={1600}
                rows={3}
                placeholder={
                  state.mode === 'local'
                    ? '规则演练请使用观察、地图、物品与交易操作。'
                    : '你说了什么，打算怎么做？也可以问主持人目前有哪些已知条件。'
                }
              />
              <div className="compose-foot">
                <span>可以说话、行动、提问，或直接和主持人讨论。</span>
                <button
                  className="primary"
                  disabled={talkLocked || !intent.trim() || state.mode === 'local'}
                  type="submit"
                >
                  发送
                  <Send size={15} />
                </button>
              </div>
            </form>
          </div>
          <div ref={conversationEnd} />
        </section>
        <aside className={`world-column ${mobile === 'world' ? 'mobile-active' : ''}`}>
          <div className="context-tabs">
            {[
              ['map', '区域'],
              ['people', '现场'],
              ['contracts', '合同'],
              ['notes', '情报'],
            ].map(([k, v]) => (
              <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
                {v}
              </button>
            ))}
          </div>
          {tab === 'map' && (
            <>
              <div className="world-map-head">
                <span>新沪港灰区</span>
                <button
                  className="map-expand"
                  onClick={() => setMapExpanded(true)}
                  aria-label="展开区域地图"
                >
                  展开
                </button>
                <b>
                  {state.environment.tide === 'closed'
                    ? '裂隙已关闭'
                    : `黑潮前锋 · ${state.fogZone} 区${state.environment.tide === 'contained' ? ' / 已遏制' : ''}`}
                </b>
              </div>
              <Map
                locations={state.locations}
                routes={state.routes}
                current={me.location}
                selected={target.id}
                onSelect={setSelected}
                fogZone={state.fogZone}
              />
              <div className="map-key">
                <span>
                  <i /> 当前位置
                </span>
                <span>点击地点查看路线</span>
              </div>
              <section className="map-detail">
                <span className="eyebrow">
                  {target.zone < 0 ? '边界外' : `${target.zone} 区`} / 地点档案
                </span>
                <h3>{target.name}</h3>
                <p>{target.description}</p>
                {target.id !== me.location &&
                  (route ? (
                    <button
                      className="primary"
                      disabled={locked}
                      onClick={() => {
                        action({ kind: 'travel', target: target.id }, `前往${target.name}`);
                        setMobile('scene');
                      }}
                    >
                      准备前往 · {route.minutes} 分钟
                      <ArrowUpRight size={16} />
                    </button>
                  ) : (
                    <p className="muted">
                      当前没有直接路线。沿已知道路逐段前进，或向主持人说明勘查新路线的办法。
                    </p>
                  ))}
              </section>
              <section className="near-routes">
                <h3>从这里出发</h3>
                {connectedRoutes.map((r) => {
                  const next = state.locations.find(
                    (l) => l.id === (r.from === me.location ? r.to : r.from),
                  )!;
                  return (
                    <button
                      key={r.id}
                      disabled={locked}
                      onClick={() => {
                        setSelected(next.id);
                        action({ kind: 'travel', target: next.id }, `前往${next.name}`);
                        setMobile('scene');
                      }}
                    >
                      <span>{next.name}</span>
                      <small>{r.minutes} 分钟</small>
                      <ArrowRight size={14} />
                    </button>
                  );
                })}
              </section>
            </>
          )}
          {tab === 'people' && (
            <section className="people-list">
              <div className="context-intro">
                <span className="eyebrow">现场可见</span>
                <h3>人、物与交易</h3>
                <p>点击交谈把对象写入行动框。对方的利益与库存会影响回应。</p>
              </div>
              {state.entities.map((e) => (
                <article key={e.id} className="entity">
                  <div>
                    <h3>{e.name}</h3>
                    <span className={e.hostile ? 'hostile' : 'tag'}>
                      {e.hostile ? '敌对' : e.faction}
                    </span>
                  </div>
                  <p>{e.description}</p>
                  <p className="muted">{e.state}</p>
                  <div className="entity-actions">
                    <button
                      disabled={locked || state.mode === 'local'}
                      onClick={() => requestText(`我走近${e.name}，保持距离，想问：`)}
                    >
                      交谈 / 互动
                    </button>
                    {e.kind === 'person' || e.kind === 'machine' ? (
                      <button
                        disabled={locked || e.health <= 0}
                        onClick={() => {
                          action({ kind: 'attack', target: e.id }, `朝${e.name}射击`);
                          setMobile('scene');
                        }}
                      >
                        射击
                      </button>
                    ) : null}
                  </div>
                  {e.merchant && (
                    <details className="shop">
                      <summary>查看交易库存 · {e.inventory.length} 类</summary>
                      {e.inventory.map((i) => (
                        <div key={i.id}>
                          <span>
                            {i.name}
                            <small>
                              库存 {i.quantity} · 单价{' '}
                              {Math.ceil(i.value * (1 + Math.floor(state.minute / 10080) * 0.1))}
                            </small>
                          </span>
                          <button
                            disabled={locked}
                            onClick={() => {
                              action(
                                { kind: 'buy', entityId: e.id, itemId: i.id, quantity: 1 },
                                `向${e.name}购买${i.name}`,
                              );
                              setMobile('scene');
                            }}
                          >
                            买 1
                          </button>
                        </div>
                      ))}
                      <label>
                        出售一件物品
                        <select
                          defaultValue=""
                          disabled={locked}
                          onChange={(ev) => {
                            if (ev.target.value) {
                              action(
                                {
                                  kind: 'sell',
                                  entityId: e.id,
                                  itemId: ev.target.value,
                                  quantity: 1,
                                },
                                `向${e.name}出售物品`,
                              );
                              setMobile('scene');
                              ev.target.value = '';
                            }
                          }}
                        >
                          <option value="">选择物品 · 按参考价五折收购</option>
                          {me.inventory.map((i) => (
                            <option key={i.id} value={i.id}>
                              {i.name} · {Math.ceil(i.value * 0.5)} 灰币
                            </option>
                          ))}
                        </select>
                      </label>
                    </details>
                  )}
                  {!e.merchant && e.inventory.length > 0 && (
                    <small className="muted">
                      可见物品：{e.inventory.map((i) => `${i.name} ×${i.quantity}`).join('、')}
                    </small>
                  )}
                </article>
              ))}
            </section>
          )}
          {tab === 'contracts' && (
            <section className="contracts">
              <div className="context-intro">
                <span className="eyebrow">工作与报酬</span>
                <h3>你可以选择接工。</h3>
                <p>合同不解锁地图。接工后仍可交易、调查或改变计划，超期则无法按原条件交付。</p>
              </div>
              {state.contracts.map((t) => (
                <article className="contract" key={t.id}>
                  <span className="tag">
                    {
                      {
                        offered: '可接受',
                        accepted: '已接受',
                        completed: '已完成',
                        expired: '已过期',
                      }[t.status]
                    }
                  </span>
                  <h3>{t.name}</h3>
                  <p>{t.description}</p>
                  <div>
                    <b>{t.reward} 灰币</b>
                    <small>截止 {gameDate(t.deadline).slice(0, 10)}</small>
                  </div>
                  {['offered', 'accepted'].includes(t.status) && (
                    <button
                      disabled={locked}
                      onClick={() => {
                        action(
                          { kind: t.status === 'offered' ? 'contract' : 'deliver', target: t.id },
                          `${t.status === 'offered' ? '接受' : '交付'}${t.name}`,
                        );
                        setMobile('scene');
                      }}
                    >
                      {t.status === 'offered' ? '与委托人签约' : '当面交付物资'}
                      <ArrowRight size={14} />
                    </button>
                  )}
                </article>
              ))}
            </section>
          )}
          {tab === 'notes' && (
            <section className="notes">
              <div className="context-intro">
                <span className="eyebrow">已知信息</span>
                <h3>情报与约定</h3>
              </div>
              {state.facts.map((f, i) => (
                <p key={i}>
                  <Flag size={13} />
                  {f}
                </p>
              ))}
              <h3>势力关系</h3>
              {Object.entries(state.reputation).map(([k, v]) => (
                <div className="relation" key={k}>
                  <span>{k}</span>
                  <b>
                    {v > 0 ? '+' : ''}
                    {v}
                  </b>
                </div>
              ))}
              <h3>裁定先例</h3>
              {state.rulings.map((r) => (
                <p key={r.id}>
                  <b>{r.scope}</b> · {r.trigger}：{r.ruling}
                </p>
              ))}
              {state.precedents.length ? (
                state.precedents.map((p, i) => <p key={i}>{p}</p>)
              ) : (
                <p className="muted">尝试新的办法后，可复用的裁定会记录在这里。</p>
              )}
            </section>
          )}
        </aside>
      </main>
      <footer className="game-footer">
        <span>
          <Shield size={12} /> 自动保存 · 修订 {state.revision}
        </span>
        <span>房间码用于邀请新角色；当前角色凭证保存在这个浏览器。</span>
      </footer>
      {mapExpanded && (
        <div className="modal-backdrop" onClick={() => setMapExpanded(false)}>
          <section
            className="modal expanded-map"
            role="dialog"
            aria-modal="true"
            aria-label="区域地图"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="icon close"
              aria-label="关闭区域地图"
              onClick={() => setMapExpanded(false)}
            >
              <X size={20} />
            </button>
            <span className="eyebrow">新沪港 / 区域地图</span>
            <Map
              locations={state.locations}
              routes={state.routes}
              current={me.location}
              selected={target.id}
              onSelect={setSelected}
              fogZone={state.fogZone}
              large
            />
            <div className="expanded-map-detail">
              <h3>{target.name}</h3>
              <p>{target.description}</p>
              {target.id !== me.location && route && (
                <button
                  className="primary"
                  disabled={locked}
                  onClick={() => {
                    setMapExpanded(false);
                    action({ kind: 'travel', target: target.id }, `前往${target.name}`);
                    setMobile('scene');
                  }}
                >
                  准备前往 · {route.minutes} 分钟
                  <ArrowRight size={15} />
                </button>
              )}
            </div>
          </section>
        </div>
      )}
      {rules && <Rules close={() => setRules(false)} />}
    </div>
  );
}
