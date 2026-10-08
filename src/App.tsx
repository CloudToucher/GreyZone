import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Compass,
  Download,
  Edit3,
  EyeOff,
  FileText,
  LoaderCircle,
  MapPin,
  MessageCircle,
  Pause,
  Play,
  Plus,
  Radio,
  Send,
  Shield,
  Users,
  X,
} from 'lucide-react';
import {
  attributes,
  dateLabel,
  type Data,
  type Json,
  type PublicRecord,
  type PublicState,
} from '../shared/types';
import { api, ApiError, subscribe, type Access } from './api';

const requestId = () => crypto.randomUUID();
const saved = (): Access[] => {
  try {
    return JSON.parse(localStorage.getItem('greyzone.tables.v3') ?? '[]');
  } catch {
    return [];
  }
};
const labels: Record<string, string> = {
  background: '经历',
  appearance: '外貌',
  goals: '目标',
  relationships: '关系',
  preferences: '玩法约定',
  description: '说明',
  role: '身份',
  status: '状况',
  active: '可行动',
  incapacitated: '失能',
  dying: '濒死',
  dead: '死亡',
  resources: '物资',
  cash: '灰币',
  abilities: '能力',
  principle: '原理',
  range: '范围',
  prerequisites: '条件',
  cost: '代价',
  overload: '透支后果',
  limits: '限制',
  applications: '用途',
  remedy: '处理办法',
  part: '部位',
  severity: '伤情',
  quantity: '数量',
  weight: '重量',
  ammo: '弹药',
  capacity: '容量',
  loaded: '已装弹',
  owner: '持有人',
  region: '区域',
  notes: '笔记',
  school: '体系',
  conditions: '伤势与状态',
};
function Words({ value }: { value: Json }) {
  if (value === null || value === '') return null;
  if (typeof value === 'boolean') return <>{value ? '是' : '否'}</>;
  if (Array.isArray(value))
    return (
      <div className="value-list">
        {value.map((v, i) => (
          <div key={i}>
            <Words value={v} />
          </div>
        ))}
      </div>
    );
  if (typeof value === 'object')
    return (
      <dl className="details-grid">
        {Object.entries(value)
          .filter(([k]) => !['id', 'ready', 'delegated'].includes(k))
          .map(([k, v]) => (
            <div key={k}>
              <dt>{labels[k] ?? k}</dt>
              <dd>
                <Words value={v} />
              </dd>
            </div>
          ))}
      </dl>
    );
  return <>{labels[String(value)] ?? String(value)}</>;
}
function Paragraphs({ text }: { text: string }) {
  return (
    <div className="prose">
      {text.split(/\n\s*\n/).map((p, i) => (
        <p key={i}>
          {p
            .replace(/^#{1,4}\s/gm, '')
            .split(/(\*\*[^*]+\*\*)/g)
            .map((s, j) => (s.startsWith('**') ? <strong key={j}>{s.slice(2, -2)}</strong> : s))}
        </p>
      ))}
    </div>
  );
}
function Empty({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Compass;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="empty">
      <Icon size={26} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

function Gate({ enter }: { enter: (a: Access) => void }) {
  const [mode, setMode] = useState<'create' | 'join'>('create'),
    [name, setName] = useState(''),
    [room, setRoom] = useState(''),
    [title, setTitle] = useState('灰区冒险'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const pending = useRef<{ path: string; body: unknown } | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const input = { requestId: requestId(), name, ...(mode === 'create' ? { title } : {}) };
    const task = pending.current ?? {
      path: mode === 'create' ? '/api/rooms' : `/api/rooms/${room.toUpperCase()}/join`,
      body: input,
    };
    pending.current = task;
    try {
      const result = await api<{ id: string; token: string }>(task.path, undefined, task.body);
      pending.current = null;
      enter({ ...result, name });
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError && e.status) pending.current = null;
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="gate">
      <header className="gate-head">
        <span className="brand">
          灰区<span>TRPG / 团桌</span>
        </span>
        <span className="edition">2037 · 新沪港</span>
      </header>
      <div className="gate-body">
        <section className="gate-world">
          <div className="eyebrow">
            <span className="signal" /> 封锁区内，生活仍在继续
          </div>
          <h1>灰区</h1>
          <p className="gate-subtitle">
            你做出选择。
            <br />
            人物与世界作出回应。
          </p>
          <p className="gate-description">
            港口留下的机器还在转，诊所缺药，雨水正在淹没旧通道。你可能来找一个人，挣一笔钱，也可能一直住在这里。
          </p>
          <div className="world-lines">
            <div>
              <span>01</span>
              <p>
                用自己的话行动<b>调查、交涉、制造，或尝试从未写进规则的办法。</b>
              </p>
            </div>
            <div>
              <span>02</span>
              <p>
                与同伴共同决定<b>各自写下意图，由主持人综合处理这一轮。</b>
              </p>
            </div>
            <div>
              <span>03</span>
              <p>
                承担真实的后果<b>资源会耗尽，关系会改变，伤势需要时间。</b>
              </p>
            </div>
          </div>
        </section>
        <section className="gate-form">
          <div className="eyebrow">落座之前</div>
          <h2>开始你们的冒险</h2>
          <p className="muted">进入团桌后，再与主持人讨论角色与开场。</p>
          <div className="segmented">
            <button
              className={mode === 'create' ? 'selected' : ''}
              onClick={() => {
                setMode('create');
                pending.current = null;
              }}
            >
              创建团桌
            </button>
            <button
              className={mode === 'join' ? 'selected' : ''}
              onClick={() => {
                setMode('join');
                pending.current = null;
              }}
            >
              加入朋友
            </button>
          </div>
          <form onSubmit={submit}>
            <label>
              你的称呼
              <input
                required
                maxLength={50}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="其他玩家怎样称呼你"
              />
            </label>
            {mode === 'create' ? (
              <label>
                团桌名称
                <input
                  required
                  maxLength={100}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
            ) : (
              <label>
                六位团桌码
                <input
                  className="room-code"
                  required
                  pattern="[A-Fa-f0-9]{6}"
                  maxLength={6}
                  value={room}
                  onChange={(e) => setRoom(e.target.value.toUpperCase())}
                  placeholder="例如 A3F108"
                />
              </label>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="primary wide" disabled={busy}>
              {busy ? <LoaderCircle className="spin" size={18} /> : <ArrowRight size={18} />}{' '}
              {mode === 'create' ? '创建团桌' : '进入团桌'}
            </button>
          </form>
          {saved().length > 0 && (
            <div className="recent">
              <div className="eyebrow">继续上次的团桌</div>
              {saved().map((a) => (
                <button key={a.id + a.token} onClick={() => enter(a)}>
                  <span>
                    {a.name ?? '冒险者'} <small>{a.id}</small>
                  </span>
                  <ArrowRight size={16} />
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
      <footer className="gate-footer">
        灰区 · 自由叙事桌上角色扮演游戏<span>AI 主持 / 轻规则 / 多人协作</span>
      </footer>
    </main>
  );
}

function MapView({ records }: { records: PublicRecord[] }) {
  const places = records.filter((r) => r.kind === 'place');
  const [chosen, setChosen] = useState<string>();
  const selected = places.find((r) => r.id === chosen);
  const positions = Object.fromEntries(
    places.map((p, i) => [p.id, { x: 90 + (i % 3) * 190, y: 65 + Math.floor(i / 3) * 110 }]),
  );
  return (
    <>
      <div className="map-key">
        <span className="signal" /> 只展示你已经知道的地点与连接
      </div>
      <svg
        className="map"
        viewBox={`0 0 560 ${Math.max(220, Math.ceil(places.length / 3) * 110 + 20)}`}
        role="img"
        aria-label="已知地点关系图"
      >
        <defs>
          <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#293633" strokeWidth="0.4" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
        {places.flatMap((p) =>
          Array.isArray(p.data.links)
            ? p.data.links
                .filter((id) => positions[String(id)])
                .map((id) => (
                  <line
                    key={p.id + id}
                    x1={positions[p.id].x}
                    y1={positions[p.id].y}
                    x2={positions[String(id)].x}
                    y2={positions[String(id)].y}
                    stroke="#637d71"
                    strokeDasharray="4 5"
                  />
                ))
            : [],
        )}
        {places.map((p) => (
          <g
            key={p.id}
            tabIndex={0}
            role="button"
            aria-label={p.name}
            onClick={() => setChosen(p.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setChosen(p.id);
            }}
            className="map-place"
          >
            <circle
              cx={positions[p.id].x}
              cy={positions[p.id].y}
              r={chosen === p.id ? 8 : 5}
              fill={chosen === p.id ? '#d5b57b' : '#a2b3a9'}
            />
            <text
              x={positions[p.id].x}
              y={positions[p.id].y + 27}
              textAnchor="middle"
              fill="#d3dace"
              fontSize="13"
            >
              {p.name}
            </text>
          </g>
        ))}
      </svg>
      {selected && (
        <article className="map-detail">
          <h3>{selected.name}</h3>
          <Words value={selected.data.description ?? ''} />
        </article>
      )}
    </>
  );
}

export default function App() {
  const [access, setAccess] = useState<Access | null>(() => {
    try {
      return JSON.parse(sessionStorage.getItem('greyzone.active.v3') ?? 'null');
    } catch {
      return null;
    }
  });
  const [state, setState] = useState<PublicState | null>(null),
    [online, setOnline] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [characterId, setCharacterId] = useState(''),
    [text, setText] = useState(''),
    [mode, setMode] = useState<'action' | 'discussion'>('action'),
    [privateInput, setPrivateInput] = useState(false),
    [askGM, setAskGM] = useState(false),
    [editing, setEditing] = useState<string>();
  const [panel, setPanel] = useState<'sheet' | 'inventory' | 'people'>('sheet'),
    [modal, setModal] = useState<'map' | 'rules' | 'new' | null>(null),
    [mobile, setMobile] = useState('story'),
    [rules, setRules] = useState(''),
    [answer, setAnswer] = useState<Record<string, string>>({}),
    [newName, setNewName] = useState(''),
    [concept, setConcept] = useState('');
  const [pending, setPending] = useState<{ path: string; body: unknown } | null>(null);
  const storyBottom = useRef<HTMLDivElement>(null);
  const own = state?.records.filter((r) => state.me.characters.includes(r.id)) ?? [],
    character = own.find((r) => r.id === characterId) ?? own[0],
    ready = character?.data.ready === true;
  const name = (id: string) =>
    state?.records.find((r) => r.id === id)?.name ??
    state?.board.find((a) => a.characterId === id)?.characterName ??
    state?.seats.find((s) => s.characters.includes(id))?.name ??
    '角色';
  function enter(a: Access) {
    setAccess(a);
    setState(null);
    setError('');
    setPending(null);
    sessionStorage.setItem('greyzone.active.v3', JSON.stringify(a));
    const all = saved().filter((s) => s.id !== a.id || s.token !== a.token);
    localStorage.setItem('greyzone.tables.v3', JSON.stringify([a, ...all].slice(0, 12)));
  }
  function leave() {
    setAccess(null);
    setState(null);
    sessionStorage.removeItem('greyzone.active.v3');
  }
  useEffect(() => {
    if (!access) return;
    const controller = new AbortController();
    void subscribe(access, controller.signal, setState, setOnline);
    void api<PublicState>(`/api/rooms/${access.id}`, access)
      .then(setState)
      .catch((e) => setError(e.message));
    return () => controller.abort();
  }, [access]);
  useEffect(() => {
    if (character && !characterId) setCharacterId(character.id);
  }, [character, characterId]);
  useEffect(() => {
    if (modal === 'rules' && !rules)
      void api<{ text: string }>('/api/rules').then((r) => setRules(r.text));
  }, [modal, rules]);
  async function send(
    path: string,
    payload: Record<string, unknown> = {},
    retry = false,
  ): Promise<boolean> {
    if (!access) return false;
    setBusy(true);
    setError('');
    const task =
      retry && pending
        ? pending
        : { path: `/api/rooms/${access.id}/${path}`, body: { requestId: requestId(), ...payload } };
    setPending(task);
    try {
      const result = await api<{ characterId?: string }>(task.path, access, task.body);
      if (result.characterId) setCharacterId(result.characterId);
      setPending(null);
      try {
        setState(await api<PublicState>(`/api/rooms/${access.id}`, access));
      } catch {
        setError('请求已保存，正在重新同步显示。无需重复提交。');
      }
      return true;
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError && e.status) setPending(null);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    let ok = false;
    if (mode === 'discussion')
      ok = await send('messages', {
        text,
        askGM,
        characterId: character?.id,
        private: privateInput,
      });
    else if (character)
      ok = await send(ready ? 'board' : 'workshop', {
        characterId: character.id,
        text,
        ...(ready ? { private: privateInput, actionId: editing } : {}),
      });
    if (ok) {
      setText('');
      setEditing(undefined);
      setMobile('story');
    }
  }
  async function exportLog() {
    if (!access) return;
    const data = await api<PublicState>(`/api/rooms/${access.id}/export`, access),
      url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      );
    const a = document.createElement('a');
    a.href = url;
    a.download = `灰区-${access.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  if (!access) return <Gate enter={enter} />;
  if (!state)
    return (
      <div className="loading">
        <LoaderCircle className="spin" />
        <p>{error || '正在回到团桌…'}</p>
        <button className="quiet" onClick={leave}>
          返回入口
        </button>
      </div>
    );
  const inventory = state.records.filter(
    (r) => r.kind === 'item' && r.data.owner === character?.id && Number(r.data.quantity) > 0,
  );
  const question = state.run?.question,
    canResume = state.me.host || state.run?.kind === 'workshop';
  return (
    <div className="table-shell">
      <header className="table-head">
        <button className="brand" onClick={leave} title="回到团桌入口">
          灰区<span>TRPG / 团桌</span>
        </button>
        <div className="table-title">
          <h1>{state.title}</h1>
          <span>{dateLabel(state.minute)} · 游戏内时间</span>
        </div>
        <div className="table-actions">
          <span className={'connection ' + (online ? 'live' : '')}>
            <i />
            {online ? '已连接' : '重连中'}
          </span>
          <button
            className="room-tag"
            onClick={() => {
              void navigator.clipboard.writeText(state.id);
            }}
            title="复制团桌码"
          >
            <Users size={14} />
            {state.id}
          </button>
          <button
            className="icon-button"
            title="导出我的记录"
            aria-label="导出我的记录"
            onClick={() => void exportLog()}
          >
            <Download size={17} />
          </button>
          <button
            className="icon-button"
            title="规则"
            aria-label="查看规则"
            onClick={() => setModal('rules')}
          >
            <FileText size={17} />
          </button>
        </div>
      </header>
      <nav className="mobile-nav">
        {[
          ['story', '团录'],
          ['board', '行动板'],
          ['character', '角色'],
        ].map(([id, label]) => (
          <button key={id} className={mobile === id ? 'active' : ''} onClick={() => setMobile(id)}>
            {label}
          </button>
        ))}
      </nav>
      {error && (
        <div className="error-strip" role="alert">
          {error}
          {pending && (
            <button disabled={busy} onClick={() => void send('', {}, true)}>
              重试这次请求
            </button>
          )}
          <button
            aria-label="关闭错误"
            onClick={() => {
              setError('');
              setPending(null);
            }}
          >
            <X size={16} />
          </button>
        </div>
      )}
      <main className={'table-columns mobile-' + mobile}>
        <aside className="character-panel">
          <div className="panel-heading">
            <span className="eyebrow">你的角色</span>
            <button
              className="icon-button"
              aria-label="创建角色"
              disabled={!!state.run || busy}
              onClick={() => setModal('new')}
            >
              <Plus size={17} />
            </button>
          </div>
          {own.length ? (
            <>
              <select
                aria-label="当前角色"
                value={character?.id}
                onChange={(e) => {
                  setCharacterId(e.target.value);
                  setEditing(undefined);
                  setText('');
                }}
              >
                {own.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                    {r.data.ready ? '' : ' · 草案'}
                  </option>
                ))}
              </select>
              <section className="character-identity">
                <div className="portrait">{character!.name.slice(-1)}</div>
                <span className="eyebrow">{ready ? '已入场' : '与主持人共同创建'}</span>
                <h2>{character!.name}</h2>
                <p>
                  <MapPin size={13} />
                  {name(String(character!.data.location))}
                </p>
                <span
                  className={'status-label ' + (character!.data.status === 'active' ? '' : 'hurt')}
                >
                  {labels[String(character!.data.status)] ?? String(character!.data.status)}
                </span>
              </section>
              <nav className="detail-tabs">
                {[
                  ['sheet', '档案'],
                  ['inventory', '物品'],
                  ['people', '关系'],
                ].map(([id, label]) => (
                  <button
                    className={panel === id ? 'selected' : ''}
                    onClick={() => setPanel(id as typeof panel)}
                    key={id}
                  >
                    {label}
                    {id === 'inventory' && <small>{inventory.length}</small>}
                  </button>
                ))}
              </nav>
              {panel === 'sheet' && (
                <div className="sheet">
                  <div className="stats">
                    {Object.entries(attributes).map(([key, label]) => (
                      <div key={key}>
                        <b>+{String((character!.data.stats as Data)?.[key] ?? 0)}</b>
                        <span>{label}</span>
                      </div>
                    ))}
                  </div>
                  <div className="tags">
                    {((character!.data.specialties ?? []) as string[]).map((s) => (
                      <span key={s}>{s}</span>
                    ))}
                  </div>
                  {Object.entries(character!.data)
                    .filter(
                      ([k, v]) =>
                        ![
                          'stats',
                          'specialties',
                          'location',
                          'status',
                          'resources',
                          'ready',
                          'delegated',
                          'conditions',
                        ].includes(k) &&
                        v !== '' &&
                        (!Array.isArray(v) || v.length > 0),
                    )
                    .map(([k, v]) => (
                      <section className="sheet-section" key={k}>
                        <h3>{labels[k] ?? k}</h3>
                        <Words value={v} />
                      </section>
                    ))}
                  {Array.isArray(character!.data.conditions) &&
                    character!.data.conditions.length > 0 && (
                      <section className="sheet-section wound">
                        <h3>伤势与状态</h3>
                        <Words value={character!.data.conditions} />
                      </section>
                    )}
                  <section className="sheet-section">
                    <h3>资源</h3>
                    <Words value={character!.data.resources ?? {}} />
                  </section>
                  {!ready ? (
                    <button
                      className="primary wide"
                      disabled={
                        busy || !!state.run || !(character!.data.specialties as string[]).length
                      }
                      onClick={() => void send('adopt', { characterId: character!.id })}
                    >
                      <Check size={16} />
                      采用这份角色档案
                    </button>
                  ) : (
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={character!.data.delegated === true}
                        disabled={busy || !!state.run}
                        onChange={(e) =>
                          void send('delegation', {
                            characterId: character!.id,
                            enabled: e.target.checked,
                          })
                        }
                      />
                      允许主持人托管此角色
                    </label>
                  )}
                </div>
              )}
              {panel === 'inventory' && (
                <div className="inventory">
                  {inventory.length ? (
                    inventory.map((item) => (
                      <details key={item.id}>
                        <summary>
                          <span>{item.name}</span>
                          <b>×{String(item.data.quantity)}</b>
                        </summary>
                        <Words
                          value={Object.fromEntries(
                            Object.entries(item.data).filter(
                              ([k]) => !['owner', 'quantity'].includes(k),
                            ),
                          )}
                        />
                      </details>
                    ))
                  ) : (
                    <p className="muted inset">装备会随角色讨论和实际行动入账。</p>
                  )}
                </div>
              )}
              {panel === 'people' && (
                <div className="people">
                  <section className="sheet-section">
                    <h3>你的关系</h3>
                    <Words value={character!.data.relationships ?? '尚未记录'} />
                  </section>
                  {state.records
                    .filter((r) => ['npc', 'relation', 'fact'].includes(r.kind))
                    .map((r) => (
                      <details key={r.id}>
                        <summary>{r.name}</summary>
                        <Words value={r.data} />
                      </details>
                    ))}
                </div>
              )}
            </>
          ) : (
            <Empty icon={Users} title="先认识你要扮演的人">
              点击右上角的加号，写下名字和想法，再与主持人讨论。
            </Empty>
          )}
          <button className="map-open" onClick={() => setModal('map')}>
            <Compass size={18} />
            <span>
              已知地图<small>地点与通行关系</small>
            </span>
            <ArrowRight size={16} />
          </button>
        </aside>
        <section className="story-panel">
          <div className="story-heading">
            <div>
              <span className="eyebrow">团录</span>
              <h2>正在发生的事</h2>
            </div>
            <button
              className="icon-button"
              aria-label="跳到最新记录"
              onClick={() =>
                storyBottom.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
              }
            >
              <ArrowDown size={18} />
            </button>
          </div>
          <div className="story-scroll">
            {state.journal.length ? (
              state.journal.map((entry, i) => (
                <article className="entry" key={entry.id}>
                  <div className="entry-meta">
                    <span className="entry-index">{String(i + 1).padStart(2, '0')}</span>
                    <span>主持人</span>
                    <time>{dateLabel(entry.minute)}</time>
                  </div>
                  {entry.passages.map((p, j) => (
                    <div key={j}>
                      {!p.audience.includes('table') && (
                        <div className="private-mark">
                          <EyeOff size={12} />
                          与你有关的记录
                        </div>
                      )}
                      <Paragraphs text={p.text} />
                    </div>
                  ))}
                  {(entry.changes.length > 0 ||
                    state.rolls.some(
                      (r) =>
                        r.runId === entry.runId &&
                        (entry.checkIds?.includes(r.id) ??
                          state.journal.find((e) => e.runId === r.runId)?.id === entry.id),
                    )) && (
                    <details className="ledger">
                      <summary>
                        <span>
                          <FileText size={13} />
                          记录与检定
                        </span>
                        <ChevronDown size={13} />
                      </summary>
                      {state.rolls
                        .filter(
                          (r) =>
                            r.runId === entry.runId &&
                            (entry.checkIds?.includes(r.id) ??
                              state.journal.find((e) => e.runId === r.runId)?.id === entry.id),
                        )
                        .map((r) => (
                          <div className="roll" key={r.id}>
                            <b>d20</b>
                            <div>
                              {r.purpose}
                              <small>
                                {r.dice.join(' / ')}
                                {r.modifier >= 0 ? ' + ' : ' − '}
                                {Math.abs(r.modifier)} = {r.total}
                                {r.difficulty ? `，目标 ${r.difficulty}` : ''}
                                {r.opponent ? `，对抗 ${r.opponent.total}` : ''} ·{' '}
                                {r.outcome
                                  ? { win: '胜出', tie: '持平', loss: '失利' }[r.outcome]
                                  : r.success
                                    ? '成功'
                                    : '未达成'}
                              </small>
                            </div>
                          </div>
                        ))}
                      {entry.changes.map((c, j) => (
                        <div className="change" key={j}>
                          <span>{c.name}</span>
                          {c.summary}
                        </div>
                      ))}
                    </details>
                  )}
                  {entry.decisions.some((d) => d.status !== 'done') && (
                    <div className="decisions">
                      {entry.decisions
                        .filter((d) => d.status !== 'done')
                        .map((d) => (
                          <p key={d.actionId}>
                            {
                              {
                                partial: '部分执行',
                                deferred: '顺延',
                                interrupted: '中断',
                                rejected: '未执行',
                              }[d.status as 'partial']
                            }
                            ：{d.reason}
                          </p>
                        ))}
                    </div>
                  )}
                </article>
              ))
            ) : (
              <div className="story-welcome">
                <div className="coordinate">NEW HUGANG / 2037</div>
                <h2>让冒险从一个人开始。</h2>
                <p>
                  身份、专长、装备、牵挂，以及你为什么在这里。
                  <br />
                  先与主持人讨论；采用档案后，把第一步写到行动板。
                </p>
                <div className="welcome-rule">
                  <span>01</span>创建角色
                  <ArrowRight size={15} />
                  <span>02</span>写下意图
                  <ArrowRight size={15} />
                  <span>03</span>共同裁决
                </div>
              </div>
            )}
            {state.messages.length > 0 && (
              <details className="discussion-log">
                <summary>
                  <MessageCircle size={14} />
                  场外讨论 · {state.messages.length} 条
                </summary>
                {state.messages.map((m) => (
                  <p key={m.id}>
                    <b>{m.name}</b>
                    <span>{m.text}</span>
                  </p>
                ))}
              </details>
            )}
            {state.run && (
              <div className="gm-status">
                <span className={state.run.status === 'running' ? 'signal pulse' : 'signal'} />
                <span>
                  {state.run.status === 'running'
                    ? state.run.stage || '主持人正在处理这一轮'
                    : state.run.status === 'waiting'
                      ? '等待相关玩家回应'
                      : (state.run.error ?? '本轮暂时中断')}
                </span>
              </div>
            )}
            {question && (
              <form
                className="question"
                onSubmit={async (e) => {
                  e.preventDefault();
                  for (const id of question.characters.filter(
                    (c) => !question.answers[c] && answer[c]?.trim(),
                  )) {
                    const ok = await send('answer', {
                      runId: state.run!.id,
                      characterId: id,
                      text: answer[id],
                    });
                    if (!ok) return;
                  }
                  setAnswer({});
                }}
              >
                <h3>主持人需要你的决定</h3>
                <Paragraphs text={question.prompt} />
                {question.characters.every((c) => question.answers[c]) ? (
                  <p>已收到你的回答，等待其他角色。</p>
                ) : (
                  <>
                    {question.characters
                      .filter((c) => !question.answers[c])
                      .map((id) => (
                        <label key={id}>
                          {name(id)}的决定
                          <textarea
                            value={answer[id] ?? ''}
                            onChange={(e) => setAnswer({ ...answer, [id]: e.target.value })}
                            placeholder="说明这个角色的决定"
                          />
                        </label>
                      ))}
                    <button
                      className="primary"
                      disabled={
                        busy ||
                        !question.characters.some((c) => !question.answers[c] && answer[c]?.trim())
                      }
                    >
                      回复主持人
                    </button>
                  </>
                )}
              </form>
            )}
            {state.run?.status === 'failed' && canResume && (
              <button
                className="primary resume"
                disabled={busy}
                onClick={() => void send('resume', { runId: state.run!.id })}
              >
                <Play size={15} />
                继续本轮裁决
              </button>
            )}
            <div ref={storyBottom} />
          </div>
          <form className="composer" onSubmit={submit}>
            <div className="composer-top">
              <div className="compose-tabs">
                <button
                  type="button"
                  className={mode === 'action' ? 'selected' : ''}
                  onClick={() => setMode('action')}
                >
                  {ready ? '提交行动' : '讨论角色'}
                </button>
                <button
                  type="button"
                  className={mode === 'discussion' ? 'selected' : ''}
                  onClick={() => setMode('discussion')}
                >
                  场外讨论
                </button>
              </div>
              <span>
                {mode === 'action' ? (character?.name ?? '先创建一个角色') : '不会推进游戏时间'}
              </span>
            </div>
            {editing && (
              <div className="editing">
                修改尚未裁决的行动
                <button
                  type="button"
                  onClick={() => {
                    setEditing(undefined);
                    setText('');
                  }}
                >
                  取消修改
                </button>
              </div>
            )}
            <textarea
              aria-label={mode === 'action' ? (ready ? '你的行动' : '角色讨论') : '场外讨论'}
              rows={4}
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={8000}
              disabled={busy || (mode === 'action' && !character)}
              placeholder={
                mode === 'discussion'
                  ? '讨论规则、整理思路，或和同伴商量。'
                  : ready
                    ? '描述你要做什么、如何去做，以及情况变化时的打算。'
                    : '说说这个人的经历、专长、能力和装备，也可以提出对草案的修改。'
              }
            />
            <div className="composer-bottom">
              <div className="composer-options">
                {ready && (
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={privateInput}
                      onChange={(e) => setPrivateInput(e.target.checked)}
                    />
                    私密
                  </label>
                )}
                {mode === 'discussion' && (
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={askGM}
                      onChange={(e) => setAskGM(e.target.checked)}
                    />
                    请主持人回应
                  </label>
                )}
                {mode === 'action' && ready && <small>提交后进入行动板，发起裁决时才执行。</small>}
              </div>
              <button
                className="primary"
                disabled={
                  busy ||
                  !!pending ||
                  !text.trim() ||
                  (mode === 'action' && (!character || (!ready && !!state.run))) ||
                  (mode === 'discussion' && askGM && !!state.run)
                }
              >
                <Send size={15} />
                {mode === 'discussion' ? '发送' : ready ? '加入行动板' : '与主持人讨论'}
              </button>
            </div>
          </form>
        </section>
        <aside className="board-panel">
          <div className="panel-heading">
            <span className="eyebrow">下一批行动</span>
            <span className="count">{state.boardCount}</span>
          </div>
          <h2>行动板</h2>
          <p className="board-caption">把想做的事放在这里。可以补充、修改，等大家准备好。</p>
          <div className="roster">
            {state.seats.map((s) => (
              <div key={s.id}>
                <span className="avatar">{s.name.slice(0, 1)}</span>
                <span>
                  {s.name}
                  <small>
                    {s.characters.length} 个角色{s.host ? ' · 房主' : ''}
                  </small>
                </span>
                <i className={state.submittedSeats.includes(s.id) ? 'submitted' : ''} />
              </div>
            ))}
          </div>
          <div className="board-items">
            {state.boardCount > state.board.length && (
              <p className="muted">
                另有 {state.boardCount - state.board.length} 项私密行动已提交，将随本批一起裁决。
              </p>
            )}
            {state.board.length ? (
              state.board.map((a, i) => (
                <article key={a.id} className="intent">
                  <header>
                    <span>{String(i + 1).padStart(2, '0')}</span>
                    <b>{name(a.characterId)}</b>
                    {!a.audience.includes('table') && <EyeOff size={12} />}
                  </header>
                  <p>{a.text}</p>
                  {a.seatId === state.me.id && (
                    <div className="intent-actions">
                      <button
                        disabled={busy}
                        onClick={() => {
                          setCharacterId(a.characterId);
                          setText(a.text);
                          setEditing(a.id);
                          setPrivateInput(!a.audience.includes('table'));
                          setMode('action');
                          setMobile('story');
                        }}
                      >
                        <Edit3 size={12} />
                        修改
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => void send('withdraw', { actionId: a.id })}
                      >
                        撤回
                      </button>
                    </div>
                  )}
                </article>
              ))
            ) : (
              <Empty icon={FileText} title={state.run ? '本批正在处理' : '等你写下第一步'}>
                {state.run ? '你可以继续准备下一批行动。' : '同伴的行动会一起出现在这里。'}
              </Empty>
            )}
          </div>
          <div className="board-footer">
            {state.me.host ? (
              <>
                <button
                  className="primary wide"
                  disabled={busy || !!pending || !!state.run || !state.boardCount}
                  onClick={() => void send('run')}
                >
                  <Play size={16} />
                  发起本轮裁决
                </button>
                {state.run?.status === 'running' && (
                  <button
                    className="quiet wide"
                    disabled={busy}
                    onClick={() => void send('stop', { runId: state.run!.id })}
                  >
                    <Pause size={14} />
                    暂停主持，保留进度
                  </button>
                )}
                <p>只执行已提交的意图。未提交的角色不会被默认托管。</p>
              </>
            ) : (
              <p>
                <Shield size={15} />
                由房主发起本轮裁决。
              </p>
            )}
          </div>
        </aside>
      </main>
      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-label={modal === 'map' ? '已知地图' : modal === 'rules' ? '规则手册' : '创建角色'}
            className={'modal ' + (modal === 'new' ? 'new-character' : '')}
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <div>
                <span className="eyebrow">灰区 · 团桌资料</span>
                <h2>
                  {modal === 'map' ? '已知地图' : modal === 'rules' ? '规则手册' : '创建一个角色'}
                </h2>
              </div>
              <button className="icon-button" aria-label="关闭" onClick={() => setModal(null)}>
                <X size={22} />
              </button>
            </header>
            {modal === 'map' ? (
              <MapView records={state.records} />
            ) : modal === 'rules' ? (
              <Paragraphs text={rules || '正在读取…'} />
            ) : (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const ok = await send('characters', { name: newName, concept });
                  if (ok) {
                    setModal(null);
                    setText(concept);
                    setNewName('');
                    setConcept('');
                    setMode('action');
                  }
                }}
              >
                <label>
                  姓名
                  <input
                    autoFocus
                    required
                    maxLength={60}
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="这个人叫什么？"
                  />
                </label>
                <label>
                  最初的想法
                  <textarea
                    rows={6}
                    maxLength={12000}
                    value={concept}
                    onChange={(e) => setConcept(e.target.value)}
                    placeholder="经历、想找的人、擅长的事、你想玩的内容。一句话也可以。"
                  />
                </label>
                <p className="muted">
                  创建后，与主持人讨论装备、能力、关系和开场。采用档案之前可以反复修改。
                </p>
                <button className="primary wide" disabled={busy}>
                  创建并继续讨论
                  <ArrowRight size={16} />
                </button>
              </form>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
