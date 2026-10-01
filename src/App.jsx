import React, { useState, useEffect, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, GeoJSON, ZoomControl, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Activity, Wind, Search, RefreshCw, MapPin, ChevronUp, ChevronDown, Terminal, X, Filter,
  TrendingUp, Play, Pause, BarChart2, Info, AlertTriangle, BookOpen
} from 'lucide-react';

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'https://spiro-backend-production-5a52.up.railway.app';
// Optional. The map works without any key (region shapes on a dark background).
// If you want street context, get a free key at https://carto.com/basemaps/apikey and set VITE_CARTO_KEY.
const CARTO_KEY = import.meta.env.VITE_CARTO_KEY;

const PH_BOUNDS = [[4.5, 116.0], [21.5, 127.0]];
const POLLUTANTS = [
  { key: 'pm2_5', label: 'PM2.5' }, { key: 'pm10', label: 'PM10' }, { key: 'no2', label: 'NO₂' },
  { key: 'o3', label: 'O₃' }, { key: 'so2', label: 'SO₂' }, { key: 'co', label: 'CO' }
];
const WHO_PM25_24H = 15; // WHO 2021 24-hour guideline, µg/m³

// Yellow -> red: higher rate = darker red. NO_DATA = grey.
const RAMP = ['#fef3c7', '#fcd34d', '#fb923c', '#ef4444', '#7f1d1d'];
const NO_DATA = '#334155';
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rampColor = (t) => {
  const n = RAMP.length - 1;
  const s = Math.min(Math.max(t, 0), 1) * n;
  const i = Math.min(Math.floor(s), n - 1);
  const a = hex(RAMP[i]), b = hex(RAMP[i + 1]);
  return `rgb(${a.map((x, k) => Math.round(x + (b[k] - x) * (s - i))).join(',')})`;
};

// Plain-language wording per indicator ("deaths per 1,000 population <what>").
const WHAT = {
  '3.4.1': 'from heart disease, cancer, diabetes or chronic lung disease',
  '3.4.1.1': 'from heart and blood-vessel disease',
  '3.4.1.2': 'from cancer',
  '3.4.1.3': 'from diabetes',
  '3.4.1.4': 'from chronic lung disease',
  '3.2.1': 'among children under five',
  '3.2.s1': 'among babies under one year old'
};

const fmt = (v) => (v === null || v === undefined ? 'N/A' : +Number(v).toFixed(2));
const valueAt = (pts, year) => pts?.find((p) => p.year === year)?.value ?? null;
const shortName = (n = '') => n.replace(/^Mortality rate attributed to /i, '');
const isSub = (code) => code.split('.').length > 3;

function MapResizeController() {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize();
    map.setMaxBounds(PH_BOUNDS);
  }, [map]);
  return null;
}

// Colour-coded region polygons. All callbacks read refs, so they never go stale.
function RegionsLayer({ data, selectedCode, onSelect, mapData }) {
  const map = useMap();
  const layerRef = useRef(null);
  const selRef = useRef(selectedCode);
  const valRef = useRef(mapData);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  selRef.current = selectedCode;
  valRef.current = mapData;

  const styleFor = (feature) => {
    const code = feature.properties.region_code;
    const m = valRef.current;
    const v = m?.values?.[code]?.value;
    const has = v !== undefined && v !== null;
    const sel = code === selRef.current;
    return {
      fillColor: has ? rampColor((v - m.min) / (m.max - m.min || 1)) : NO_DATA,
      fillOpacity: has ? 0.85 : 0.55,
      color: sel ? '#ffffff' : '#94a3b8', weight: sel ? 3 : 0.8, opacity: sel ? 1 : 0.6
    };
  };

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.setStyle(styleFor);
    layer.eachLayer((l) => { if (l.feature.properties.region_code === selectedCode) l.bringToFront(); });
  }, [selectedCode, mapData]);

  useEffect(() => { // zoom to the selected region (leave room for the bottom sheet on phones)
    const layer = layerRef.current;
    if (!layer || !selectedCode) return;
    layer.eachLayer((l) => {
      if (l.feature.properties.region_code !== selectedCode) return;
      const mobile = window.innerWidth < 768;
      map.flyToBounds(l.getBounds(), {
        maxZoom: 8, duration: 0.6, paddingTopLeft: [20, 20],
        paddingBottomRight: [20, mobile ? window.innerHeight * 0.6 : 20]
      });
    });
  }, [selectedCode, data]);

  const onEachFeature = (feature, layer) => {
    const { region_code: code, region_name: name } = feature.properties;
    layer.bindTooltip(() => {
      const m = valRef.current, v = m?.values?.[code];
      return `<b>${name}</b><br/>${v ? `${v.value} ${m.unit} · rank ${v.rank}/${m.count}` : 'No data'}`;
    }, { sticky: true });
    layer.on({
      mouseover: (e) => { if (code !== selRef.current) e.target.setStyle({ weight: 2, opacity: 1, color: '#fff', fillOpacity: 1 }); },
      mouseout: (e) => layerRef.current?.resetStyle(e.target),
      click: () => onSelectRef.current(code)
    });
  };

  return <GeoJSON ref={layerRef} data={data} style={styleFor} onEachFeature={onEachFeature} />;
}

function Legend({ mapData, title }) {
  if (!mapData) return null;
  return (
    <div className="absolute top-3 left-3 z-[500] pointer-events-none bg-slate-900/90 backdrop-blur border border-slate-700 rounded-xl p-3 w-52 shadow-xl">
      <p className="text-[11px] font-semibold text-slate-100 leading-tight">{title}</p>
      <p className="text-[10px] text-slate-400 mb-2">{mapData.sex} · {mapData.year} · {mapData.unit}</p>
      {mapData.has_data ? (
        <>
          <div className="h-2.5 rounded" style={{ background: `linear-gradient(to right, ${RAMP.join(',')})` }} />
          <div className="flex justify-between text-[10px] text-slate-300 mt-1 font-mono">
            <span>{fmt(mapData.min)} lower</span><span>higher {fmt(mapData.max)}</span>
          </div>
          <p className="text-[9px] text-slate-500 mt-1">Colours compare regions within {mapData.year}.</p>
        </>
      ) : (
        <p className="text-[10px] text-amber-300">PSA has no data for {mapData.year} yet.</p>
      )}
      <div className="flex items-center gap-1.5 mt-2 text-[10px] text-slate-400">
        <span className="inline-block w-3 h-3 rounded-sm" style={{ background: NO_DATA }} /> No data
      </div>
    </div>
  );
}

// Generic SVG line chart. series: [{ label, color, dashed, points: [{x, y}] }]
function LineChart({ series, selectedX, onSelectX, formatX = String, xMax, pendingFrom }) {
  const all = series.flatMap((s) => s.points);
  if (!all.length) {
    return (
      <div className="h-32 flex items-center justify-center border border-dashed border-slate-800 rounded-xl text-slate-500 text-xs">
        No data available for this selection
      </div>
    );
  }
  const W = 340, H = 140, P = 26;
  const xs = all.map((p) => p.x), ys = all.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(xMax ?? -Infinity, ...xs);
  const pad = (Math.max(...ys) - Math.min(...ys) || 1) * 0.15;
  const minY = Math.max(0, Math.min(...ys) - pad), maxY = Math.max(...ys) + pad;
  const gx = (x) => P + ((x - minX) / (maxX - minX || 1)) * (W - P * 2);
  const gy = (y) => H - P - ((y - minY) / (maxY - minY || 1)) * (H - P * 2);

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto overflow-visible">
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={P} x2={W - P} y1={H - P - f * (H - P * 2)} y2={H - P - f * (H - P * 2)}
            stroke="#1e293b" strokeDasharray="3 3" />
        ))}
        {pendingFrom != null && maxX > pendingFrom && (
          <g>
            <rect x={gx(pendingFrom)} y={P / 2} width={gx(maxX) - gx(pendingFrom)} height={H - P - P / 2} fill="#f59e0b" opacity="0.1" />
            <text x={(gx(pendingFrom) + gx(maxX)) / 2} y={P} textAnchor="middle" fontSize="8" fill="#f59e0b">PSA data pending</text>
          </g>
        )}
        {selectedX != null && selectedX >= minX && selectedX <= maxX && (
          <line x1={gx(selectedX)} x2={gx(selectedX)} y1={P / 2} y2={H - P} stroke="#64748b" strokeDasharray="2 2" />
        )}
        {series.map((s, si) => (
          <g key={s.label}>
            <path d={s.points.map((p, i) => `${i ? 'L' : 'M'} ${gx(p.x)} ${gy(p.y)}`).join(' ')}
              fill="none" stroke={s.color} strokeWidth="2" strokeLinecap="round" strokeDasharray={s.dashed ? '4 3' : undefined} />
            {si === 0 && s.points.map((p) => (
              <g key={p.x} className="cursor-pointer" onClick={() => onSelectX?.(p.x)}>
                <circle cx={gx(p.x)} cy={gy(p.y)} r="8" fill="transparent" />
                <circle cx={gx(p.x)} cy={gy(p.y)} r={p.x === selectedX ? 4.5 : 2.5}
                  fill={p.x === selectedX ? '#fff' : s.color} stroke={s.color} strokeWidth="2" />
                <title>{`${formatX(p.x)}: ${p.y}`}</title>
              </g>
            ))}
          </g>
        ))}
      </svg>
      <div className="flex justify-between text-[10px] font-mono text-slate-500 px-1">
        <span>{formatX(minX)}</span><span>{formatX(maxX)}</span>
      </div>
      <div className="flex gap-3 mt-1 text-[10px] text-slate-400">
        {series.map((s) => (
          <span key={s.label} className="flex items-center gap-1">
            <span className="inline-block w-3 h-0.5" style={{ background: s.color }} />{s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// Big, plain-English explanation for people who just want the simple picture.
function PlainSummary({ region, ind, sex, year, value, nat, rank, count, pts, byS, causes, pm25, pending, notice }) {
  const box = 'rounded-xl border p-4 space-y-2';
  const title = (
    <p className="text-sm font-semibold flex items-center gap-1.5"><BookOpen className="w-4 h-4" /> In plain words</p>
  );
  if (pending) {
    return (
      <div className={`${box} bg-amber-950/30 border-amber-800/50 text-amber-100`}>
        {title}
        <p className="text-base leading-relaxed">{notice ?? `PSA has not published ${year} figures yet.`}</p>
      </div>
    );
  }
  if (!ind || value === null) {
    return (
      <div className={`${box} bg-slate-950 border-slate-800 text-slate-300`}>
        {title}
        <p className="text-base">There is no PSA figure for this region, measure and year.</p>
      </div>
    );
  }

  const who = sex === 'Both Sexes' ? '' : sex === 'Male' ? ' among men' : ' among women';
  const diff = nat != null ? value - nat : null;
  const first = pts[0];
  const peak = pts.reduce((m, p) => (p.value > m.value ? p : m), pts[0]);
  const lines = [`In ${year}, ${region} had about ${fmt(value)} deaths ${ind.unit} ${WHAT[ind.code] ?? `from ${shortName(ind.name).toLowerCase()}`}${who}.`];

  if (diff !== null) {
    lines.push(Math.abs(diff) < 0.05 || !nat
      ? `That matches the Philippines average (${fmt(nat)}).`
      : `That is ${fmt(Math.abs(diff))} ${diff > 0 ? 'higher' : 'lower'} than the Philippines average of ${fmt(nat)} (about ${Math.round(Math.abs(diff / nat) * 100)}% ${diff > 0 ? 'higher' : 'lower'}).`);
  }
  if (rank) lines.push(`Among the ${count} regions it ranks #${rank} (#1 is the highest rate).`);
  if (first && year > first.year) {
    lines.push(Math.abs(value - first.value) < 0.05 * first.value
      ? `It has stayed about the same since ${first.year} (${fmt(first.value)}).`
      : `It has ${value > first.value ? 'risen' : 'fallen'} from ${fmt(first.value)} in ${first.year}.`);
  }
  if (pts.length > 2) {
    lines.push(peak.year === year
      ? 'This is the highest year on record.'
      : `The highest year on record was ${peak.year} (${fmt(peak.value)})${[2020, 2021, 2022].includes(peak.year) ? ', which coincides with the COVID-19 pandemic' : ''}.`);
  }
  if (causes.length) {
    const top = causes.reduce((m, c) => (c.v > m.v ? c : m), causes[0]);
    lines.push(`The biggest contributor is ${top.name} — about ${Math.round((top.v / value) * 100)}% of the total.`);
  }
  if (pm25 != null) {
    lines.push(pm25 > WHO_PM25_24H
      ? `Today's air: fine-particle pollution (PM2.5) is ${fmt(pm25)} µg/m³, about ${fmt(pm25 / WHO_PM25_24H)}× the WHO 24-hour guideline of ${WHO_PM25_24H}.`
      : `Today's air: fine-particle pollution (PM2.5) is ${fmt(pm25)} µg/m³, within the WHO 24-hour guideline of ${WHO_PM25_24H}.`);
  }

  return (
    <div className={`${box} bg-emerald-950/30 border-emerald-800/40 text-slate-100`}>
      <div className="text-emerald-300">{title}</div>
      <p className="text-3xl font-bold text-white leading-none">
        {fmt(value)} <span className="text-base font-medium text-slate-300">deaths {ind.unit}</span>
      </p>
      {lines.map((l, i) => <p key={i} className="text-base leading-relaxed">{l}</p>)}
      {byS.m !== null && byS.f !== null && (
        <div className="grid grid-cols-2 gap-2 pt-1">
          <div className="bg-slate-950/60 rounded-lg p-2 text-center">
            <p className="text-[11px] text-slate-400">Men</p><p className="text-xl font-bold text-sky-300">{fmt(byS.m)}</p>
          </div>
          <div className="bg-slate-950/60 rounded-lg p-2 text-center">
            <p className="text-[11px] text-slate-400">Women</p><p className="text-xl font-bold text-rose-300">{fmt(byS.f)}</p>
          </div>
        </div>
      )}
      <p className="text-xs text-slate-400 pt-1">
        Air quality and health figures are shown side by side to reveal patterns. They do not prove that air pollution caused these deaths.
      </p>
    </div>
  );
}

export default function App() {
  const qs = useMemo(() => new URLSearchParams(window.location.search), []);
  const [geoJson, setGeoJson] = useState(null);
  const [directory, setDirectory] = useState([]);
  const [meta, setMeta] = useState(null);
  const [mapData, setMapData] = useState(null);
  const [selectedRegion, setSelectedRegion] = useState((qs.get('region') || '').toUpperCase() || null);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [retryTick, setRetryTick] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');

  const [indicatorCode, setIndicatorCode] = useState(qs.get('ind') || '3.4.1');
  const [sex, setSex] = useState(qs.get('sex') || 'Both Sexes');
  const [year, setYear] = useState(Number(qs.get('year')) || null);
  const [playing, setPlaying] = useState(false);

  const [isMobilePanelMinimized, setIsMobilePanelMinimized] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [debugLogs, setDebugLogs] = useState([]);

  const addDebugLog = (type, endpoint, data, status = 'OK') =>
    setDebugLogs((prev) => [{
      time: new Date().toLocaleTimeString(), type, endpoint, status,
      data: (typeof data === 'string' ? data : JSON.stringify(data, null, 2)).substring(0, 300) + '...'
    }, ...prev].slice(0, 50));

  const apiGet = async (path, label, signal) => {
    const url = `${API_BASE_URL}${path}`;
    try {
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      addDebugLog(label, url, data);
      return data;
    } catch (err) {
      if (err.name !== 'AbortError') addDebugLog('ERROR', url, err.message, 'FAIL');
      throw err;
    }
  };

  // 1. One-time loads: polygons, directory, filter metadata
  useEffect(() => {
    apiGet('/api/v1/regions', 'GET (GeoJSON)').then(setGeoJson).catch((e) => setError(`Map failed to load: ${e.message}`));
    apiGet('/api/v1/regions/list', 'GET (Directory)').then(setDirectory).catch(() => {});
    apiGet('/api/v1/health/meta', 'GET (Meta)').then((m) => {
      setMeta(m);
      setYear((y) => (m.years.includes(y) ? y : m.latest_year));
      setIndicatorCode((c) => (m.indicators.some((i) => i.code === c) ? c : m.indicators[0].code));
      setSex((s) => (m.sexes.includes(s) ? s : 'Both Sexes'));
    }).catch((e) => setError(`Could not load filters: ${e.message}`));
  }, []);

  // 2. Colour values for the map whenever the filters change
  useEffect(() => {
    if (!meta || year === null) return;
    const ctrl = new AbortController();
    apiGet(`/api/v1/health/map?indicator=${encodeURIComponent(indicatorCode)}&sex=${encodeURIComponent(sex)}&year=${year}`,
      'GET (Map values)', ctrl.signal).then(setMapData).catch(() => {});
    return () => ctrl.abort();
  }, [meta, indicatorCode, sex, year]);

  // 3. Full analytics for the clicked region
  useEffect(() => {
    if (!selectedRegion) return;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    setIsMobilePanelMinimized(false);
    apiGet(`/api/v1/analytics/region/${encodeURIComponent(selectedRegion)}`, 'GET (Analytics)', ctrl.signal)
      .then((payload) => { setAnalytics(payload); setLoading(false); })
      .catch((e) => {
        if (e.name === 'AbortError') return;
        setError(`Could not load data for ${selectedRegion}: ${e.message}`);
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [selectedRegion, retryTick]);

  // Shareable links: keep the view in the URL
  useEffect(() => {
    const p = new URLSearchParams({ ind: indicatorCode, sex });
    if (selectedRegion) p.set('region', selectedRegion);
    if (year) p.set('year', year);
    window.history.replaceState(null, '', `?${p}`);
  }, [selectedRegion, indicatorCode, sex, year]);

  // Year "play" animation (stops at the latest year with data)
  useEffect(() => {
    if (!playing || !meta) return;
    if (year >= meta.latest_year) { setPlaying(false); return; }
    const t = setTimeout(() => setYear((y) => y + 1), 1000);
    return () => clearTimeout(t);
  }, [playing, year, meta]);
  const togglePlay = () => {
    if (!playing && year >= meta.latest_year) setYear(meta.years[0]);
    setPlaying(!playing);
  };

  const health = analytics?.psa_health_indicators;
  const indicators = health?.indicators ?? [];
  const activeInd = indicators.find((i) => i.code === indicatorCode) ?? null;
  const metaInd = meta?.indicators.find((i) => i.code === indicatorCode);
  const pending = !!meta?.pending_years?.includes(year);
  const mapMatches = !!mapData && mapData.indicator === indicatorCode && mapData.sex === sex && mapData.year === year;

  const regionPts = activeInd?.series?.[sex] ?? [];
  const nationalPts = activeInd?.national_series?.[sex] ?? [];
  const value = valueAt(regionPts, year);
  const nationalValue = valueAt(nationalPts, year);
  const causes = activeInd
    ? indicators.filter((i) => i.code.startsWith(`${activeInd.code}.`))
        .map((i) => ({ name: shortName(i.name).toLowerCase(), v: valueAt(i.series?.[sex], year) }))
        .filter((c) => c.v !== null)
    : [];
  const byS = { m: valueAt(activeInd?.series?.Male, year), f: valueAt(activeInd?.series?.Female, year) };

  const healthSeries = useMemo(() => {
    const toXY = (pts) => pts.map((p) => ({ x: p.year, y: p.value }));
    const out = [{ label: analytics?.metadata?.region_code ?? 'Region', color: '#f43f5e', points: toXY(regionPts) }];
    if (nationalPts.length) out.push({ label: 'Philippines', color: '#94a3b8', dashed: true, points: toXY(nationalPts) });
    return out;
  }, [analytics, activeInd, sex]);

  const airSeries = useMemo(() => [{
    label: 'PM2.5 (µg/m³)', color: '#38bdf8',
    points: (analytics?.real_time_forecast?.forecast_next_24h ?? [])
      .filter((f) => f.pm2_5 !== null)
      .map((f) => ({ x: parseInt(f.timestamp.slice(11, 13), 10), y: f.pm2_5 }))
  }], [analytics]);

  const cc = analytics?.real_time_forecast?.current_conditions;
  const pm25 = cc?.pm2_5;

  // Directory doubles as a ranking when colour data is available
  const ranked = useMemo(() => {
    const vals = mapMatches ? mapData.values : {};
    return directory
      .filter((r) => `${r.name} ${r.code}`.toLowerCase().includes(searchQuery.toLowerCase()))
      .map((r) => ({ ...r, v: vals[r.code]?.value ?? null, rank: vals[r.code]?.rank ?? null }))
      .sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
  }, [directory, mapData, mapMatches, searchQuery]);

  const legendTitle = metaInd ? `${metaInd.code} ${shortName(metaInd.name)}` : indicatorCode;

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden relative">
      <header className="h-14 bg-slate-900 border-b border-slate-800 px-4 flex items-center justify-between z-20 shrink-0">
        <div className="flex items-center space-x-2">
          <Activity className="w-5 h-5 text-emerald-400" />
          <h1 className="font-bold text-white text-lg tracking-tight">Spiro Portal</h1>
          <span className="hidden sm:inline-block bg-slate-800 text-slate-400 text-[10px] px-2 py-0.5 rounded border border-slate-700">
            PSA SDG 3 + Air Quality
          </span>
        </div>
        <button onClick={() => setShowDebug(!showDebug)}
          className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg text-xs font-mono border border-slate-700 transition">
          <Terminal className="w-3.5 h-3.5 text-sky-400" /> Debug
        </button>
      </header>

      <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
        {/* MAP */}
        <div className="absolute inset-0 md:relative md:flex-1 bg-[#0b1220] z-0">
          <style>{'.leaflet-container{background:#0b1220}.leaflet-container path.leaflet-interactive:focus{outline:none}'}</style>
          <MapContainer center={[12.8797, 121.774]} zoom={6} minZoom={6} maxZoom={10}
            maxBounds={PH_BOUNDS} maxBoundsViscosity={1.0} zoomControl={false}
            style={{ height: '100%', width: '100%' }}>
            <MapResizeController />
            <ZoomControl position="topright" />
            {CARTO_KEY && (
              <TileLayer noWrap attribution="&copy; OpenStreetMap contributors &copy; CARTO"
                url={`https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png?key=${CARTO_KEY}`} />
            )}
            {geoJson && <RegionsLayer data={geoJson} selectedCode={selectedRegion} onSelect={setSelectedRegion} mapData={mapData} />}
          </MapContainer>
          <Legend mapData={mapData} title={legendTitle} />
          {!geoJson && !error && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[500] text-xs text-slate-400 gap-2">
              <RefreshCw className="w-4 h-4 animate-spin" /> Loading region boundaries...
            </div>
          )}
        </div>

        {/* SIDEBAR / BOTTOM SHEET */}
        <div className={`absolute md:relative bottom-0 left-0 right-0 md:w-[440px] bg-slate-900/95 backdrop-blur-xl border-t md:border-t-0 md:border-l border-slate-800 flex flex-col z-10 transition-transform duration-300 ease-in-out shadow-2xl ${
          isMobilePanelMinimized ? 'translate-y-[calc(100%-60px)] md:translate-y-0' : 'translate-y-0 h-[60vh] md:h-full'}`}>

          <div onClick={() => setIsMobilePanelMinimized(!isMobilePanelMinimized)}
            className="md:hidden h-[60px] shrink-0 flex items-center justify-between px-4 border-b border-slate-800 cursor-pointer">
            <div className="flex items-center gap-2 min-w-0">
              <MapPin className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="font-semibold text-sm truncate">
                {selectedRegion ? analytics?.metadata?.region_name ?? selectedRegion : 'Tap a region on the map'}
              </span>
            </div>
            {isMobilePanelMinimized ? <ChevronUp /> : <ChevronDown />}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {error && (
              <div className="bg-red-950/40 border border-red-900 rounded-xl p-3 text-xs text-red-200 space-y-2">
                <p className="flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> {error}</p>
                {selectedRegion && <button onClick={() => setRetryTick((t) => t + 1)} className="underline">Retry</button>}
              </div>
            )}

            {/* GLOBAL FILTERS: they colour the whole map */}
            {meta && (
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-3">
                <h3 className="text-xs font-semibold text-slate-300 flex items-center gap-1">
                  <Filter className="w-3.5 h-3.5 text-rose-400" /> What to show on the map
                </h3>
                <select value={indicatorCode} onChange={(e) => setIndicatorCode(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 text-xs text-slate-200 rounded-lg p-2 outline-none focus:border-rose-500">
                  {meta.indicators.map((i) => (
                    <option key={i.code} value={i.code}>{isSub(i.code) ? '   ' : ''}{i.code} {shortName(i.name)}</option>
                  ))}
                </select>
                <div className="grid grid-cols-3 gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800">
                  {meta.sexes.map((s) => (
                    <button key={s} onClick={() => setSex(s)}
                      className={`py-1 text-[11px] rounded transition ${
                        sex === s ? 'bg-rose-500/20 text-rose-300 font-semibold border border-rose-500/40' : 'text-slate-400 hover:text-slate-200'}`}>
                      {s}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play through the years'}
                    className="p-1.5 rounded-lg bg-slate-800 border border-slate-700 hover:bg-slate-700">
                    {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  </button>
                  <input type="range" aria-label="Year" min={meta.years[0]} max={meta.years[meta.years.length - 1]}
                    value={year ?? meta.latest_year} className="flex-1 accent-rose-500"
                    onChange={(e) => { setPlaying(false); setYear(Number(e.target.value)); }} />
                  <span className={`font-mono text-sm w-10 text-right ${pending ? 'text-amber-300' : ''}`}>{year}</span>
                </div>
                {meta.notice && (
                  <p className={`text-[11px] flex gap-1 ${pending ? 'text-amber-300' : 'text-slate-500'}`}>
                    <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {meta.notice}
                  </p>
                )}
                {pending && (
                  <button onClick={() => setYear(meta.latest_year)} className="text-xs underline text-amber-300">
                    Jump to the latest data ({meta.latest_year})
                  </button>
                )}
              </div>
            )}

            {loading ? (
              <div className="flex flex-col items-center justify-center py-12 gap-2 text-slate-400">
                <RefreshCw className="w-6 h-6 animate-spin text-emerald-400" />
                <span className="text-xs">Loading regional data...</span>
              </div>
            ) : analytics && analytics.metadata.region_code === selectedRegion ? (
              <div className="space-y-4">
                <div>
                  <h2 className="text-xl font-bold text-white leading-tight">{analytics.metadata.region_name}</h2>
                  <p className="text-xs text-slate-400 mt-0.5">Code: {analytics.metadata.region_code}</p>
                </div>

                <PlainSummary region={analytics.metadata.region_name} ind={activeInd} sex={sex} year={year}
                  value={value} nat={nationalValue} rank={mapMatches ? mapData.values?.[selectedRegion]?.rank : null}
                  count={mapData?.count} pts={regionPts} byS={byS} causes={causes} pm25={pm25}
                  pending={pending} notice={meta?.notice} />

                {/* Live air quality */}
                <div className="space-y-1.5">
                  <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                    <Wind className="w-3.5 h-3.5 text-sky-400" /> Live Air Quality
                  </h3>
                  {pm25 == null ? (
                    <p className="text-xs text-slate-500">No live air-quality data for this region (no map centroid).</p>
                  ) : (
                    <>
                      <div className="grid grid-cols-3 gap-2">
                        {POLLUTANTS.map((p) => (
                          <div key={p.key} className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                            <p className="text-[10px] text-slate-400">{p.label}</p>
                            <p className="text-lg font-bold text-sky-400 leading-tight">{fmt(cc?.[p.key])}</p>
                          </div>
                        ))}
                      </div>
                      <p className={`text-[11px] ${pm25 > WHO_PM25_24H ? 'text-amber-400' : 'text-emerald-400'}`}>
                        PM2.5 is {pm25 > WHO_PM25_24H ? 'above' : 'within'} the WHO 24-hour guideline ({WHO_PM25_24H} µg/m³). Units: {cc?.units}
                      </p>
                      <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                        <p className="text-xs text-slate-400 font-semibold mb-1">PM2.5 today (hourly, Manila time)</p>
                        <LineChart series={airSeries} formatX={(h) => `${h}:00`} />
                      </div>
                    </>
                  )}
                </div>

                {activeInd && (
                  <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-2">
                    <p className="text-xs text-slate-400 font-semibold flex items-center gap-1">
                      <TrendingUp className="w-3.5 h-3.5 text-rose-400" /> Trend · click a point to pick the year
                    </p>
                    <LineChart series={healthSeries} selectedX={year} onSelectX={setYear}
                      xMax={meta?.years[meta.years.length - 1]} pendingFrom={meta?.latest_year} />
                  </div>
                )}

                {indicators.length > 0 && (
                  <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-1">
                    <p className="text-xs text-slate-400 font-semibold mb-1">All indicators · {year} · {sex}</p>
                    {indicators.map((i) => (
                      <button key={i.code} onClick={() => setIndicatorCode(i.code)}
                        className={`w-full flex justify-between items-center text-[11px] px-2 py-1 rounded text-left ${
                          i.code === indicatorCode ? 'bg-rose-500/10 text-rose-200' : 'text-slate-300 hover:bg-slate-900'}`}>
                        <span className={`truncate pr-2 ${isSub(i.code) ? 'pl-3 text-slate-400' : 'font-semibold'}`}>{shortName(i.name)}</span>
                        <span className="font-mono shrink-0">
                          {fmt(valueAt(i.series?.[sex], year))}
                          <span className="text-slate-500"> / {fmt(valueAt(i.national_series?.[sex], year))}</span>
                        </span>
                      </button>
                    ))}
                    <p className="text-[10px] text-slate-500 pt-1">Region / Philippines · {activeInd?.unit}</p>
                  </div>
                )}
              </div>
            ) : !error && (
              <div className="text-center py-8 space-y-2">
                <BarChart2 className="w-8 h-8 text-slate-700 mx-auto" />
                <p className="text-sm text-slate-400">Click a region on the map. Darker red means a higher rate.</p>
              </div>
            )}

            <hr className="border-slate-800" />

            {/* Ranked directory */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                {mapMatches && mapData.has_data ? `Regions ranked · ${year}` : 'Regions'} ({ranked.length})
              </h4>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type="text" placeholder="Search region by name or code..." value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-9 pr-4 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500" />
              </div>
              <div className="grid grid-cols-1 gap-2">
                {ranked.map((r) => (
                  <button key={r.code} onClick={() => setSelectedRegion(r.code)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-left border transition-all ${
                      selectedRegion === r.code ? 'border-white/70 bg-slate-800 text-white' : 'bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-800'}`}>
                    <span className="w-3 h-3 rounded-sm shrink-0"
                      style={{ background: r.v !== null && mapData?.has_data ? rampColor((r.v - mapData.min) / (mapData.max - mapData.min || 1)) : NO_DATA }} />
                    {r.rank && <span className="text-[10px] text-slate-500 font-mono w-5">#{r.rank}</span>}
                    <span className="truncate flex-1">{r.name}{!r.has_geometry && ' (no map shape)'}</span>
                    <span className="font-mono text-[11px]">{r.v !== null ? fmt(r.v) : '–'}</span>
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-slate-500 pt-2">
                Sources: PSA OpenSTAT (SDG 3 database) · Open-Meteo Air Quality API (CC BY 4.0).
              </p>
            </div>
          </div>
        </div>
      </div>

      {showDebug && (
        <div className="absolute top-16 right-4 w-[90%] md:w-[460px] max-h-[70vh] bg-black/90 border border-slate-700 rounded-xl shadow-2xl z-[9999] flex flex-col font-mono text-[10px] sm:text-xs">
          <div className="flex justify-between items-center p-2 border-b border-slate-800 bg-slate-900 rounded-t-xl">
            <span className="text-emerald-400 font-bold flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5" /> API & Payload Debugger
            </span>
            <button onClick={() => setShowDebug(false)}><X className="w-4 h-4 text-slate-400 hover:text-white" /></button>
          </div>
          <div className="p-3 overflow-y-auto flex-1 space-y-3">
            {debugLogs.length === 0 && <p className="text-slate-500">No logs captured yet...</p>}
            {debugLogs.map((log, i) => (
              <div key={i} className={`p-2 rounded border ${
                log.status === 'FAIL' ? 'bg-red-900/20 border-red-800 text-red-200' : 'bg-slate-900 border-slate-700 text-slate-300'}`}>
                <div className="flex justify-between text-[10px] mb-1 opacity-70">
                  <span className="font-bold">{log.type}</span><span>{log.time}</span>
                </div>
                <div className="text-sky-300 mb-1 break-all">{log.endpoint}</div>
                <pre className="whitespace-pre-wrap mt-1 opacity-80 overflow-x-auto">{log.data}</pre>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}