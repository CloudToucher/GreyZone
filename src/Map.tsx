import type { Location, Route } from '../shared/types';
export default function Map({
  locations,
  routes,
  current,
  selected,
  onSelect,
  fogZone = 5,
  large = false,
}: {
  locations: Location[];
  routes: Route[];
  current?: string;
  selected?: string;
  onSelect?: (id: string) => void;
  fogZone?: number;
  large?: boolean;
}) {
  return (
    <svg
      className={`zone-map ${large ? 'large' : ''}`}
      viewBox="0 0 600 590"
      role="img"
      aria-label="新沪港灰区区域地图"
    >
      <defs>
        <pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse">
          <path d="M 30 0 L 0 0 0 30" fill="none" stroke="currentColor" strokeWidth=".5" />
        </pattern>
        <pattern id="fog" width="7" height="7" patternUnits="userSpaceOnUse">
          <path d="M0 7L7 0" stroke="#829082" strokeWidth=".7" />
        </pattern>
      </defs>
      <rect width="600" height="590" fill="#20271f" />
      <rect width="600" height="590" fill="url(#grid)" opacity=".22" />
      <path
        d="M470 0 C450 60 508 95 487 160 S540 237 514 300 S569 368 539 452 L600 590 L600 0Z"
        fill="#151f20"
      />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <path
          key={i}
          d={`M${10 + i * 12} ${440 - i * 64} Q${240 - i * 10} ${520 - i * 83} ${495 - i * 10} ${360 - i * 51}`}
          fill="none"
          stroke="#8a9773"
          strokeWidth="1"
          opacity=".17"
        />
      ))}
      <path
        d="M44 473 Q195 505 287 467 T544 497"
        fill="none"
        stroke="#c3a16b"
        strokeDasharray="5 8"
        opacity=".7"
      />
      <text x="411" y="552" className="map-water">
        新 沪 港
      </text>
      <text x="450" y="570" className="map-small">
        近海 / 人工岛
      </text>
      {routes.map((r) => {
        const a = locations.find((l) => l.id === r.from),
          b = locations.find((l) => l.id === r.to);
        return a && b ? (
          <line
            key={r.id}
            x1={a.x * 5.8 + 12}
            y1={a.y * 5.5 + 15}
            x2={b.x * 5.8 + 12}
            y2={b.y * 5.5 + 15}
            className={r.from === current || r.to === current ? 'route active' : 'route'}
          />
        ) : null;
      })}
      {locations.map((l) => (
        <g
          key={l.id}
          className={`map-site ${current === l.id ? 'current' : ''} ${selected === l.id ? 'selected' : ''}`}
          transform={`translate(${l.x * 5.8 + 12},${l.y * 5.5 + 15})`}
          role={onSelect ? 'button' : undefined}
          tabIndex={onSelect ? 0 : undefined}
          aria-label={l.name}
          onClick={() => onSelect?.(l.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelect?.(l.id);
            }
          }}
        >
          {l.zone >= fogZone && <circle r="22" fill="url(#fog)" opacity=".6" />}
          {current === l.id && <circle r="13" className="location-ring" />}
          <circle r={current === l.id ? 5 : 3.5} />
          <text x="9" y={l.id === 'lab-b' ? 14 : -7}>
            {l.name.replace('地下实验室 ', '实验室')}
          </text>
        </g>
      ))}
      <g transform="translate(25,30)">
        <path d="M0 20V0L-4 7M0 0L4 7" stroke="#c9c9b7" fill="none" />
        <text x="-4" y="-6" className="map-small">
          N
        </text>
      </g>
      <text x="28" y="570" className="map-small">
        区域示意 · 通行时间以路线记录为准
      </text>
    </svg>
  );
}
