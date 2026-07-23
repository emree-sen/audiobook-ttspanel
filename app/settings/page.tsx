'use client';
import { useCallback, useEffect, useState } from 'react';
import { Icon } from '@/lib/ui/Icon';
import { ConfirmButton } from '@/lib/ui/ConfirmButton';
import { useLang, useT } from '@/lib/ui/LanguageProvider';
import { setupStatus } from '@/lib/ui/setup-status';

type VoiceRow = { id: string; provider: string; voice: string; gender: string; tone: string; path: string | null };
type Conn = { id: string; label: string; baseUrl: string; model: string; hasKey: boolean };
type SettingsData = {
  provider: string; model: string; llmProvider: string; llmModel: string; piperExe: string;
  llmBaseUrl: string; llmApiKey: string | null;
  geminiKey: string | null; geminiKeySource: 'db' | 'env' | null;
  quotaLimits: Record<string, number | null>;
  connections: Conn[]; voices: Record<string, VoiceRow[]>;
};

async function patchVoice(id: string, patch: { gender?: string; tone?: string }) {
  await fetch(`/api/voices/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
}

// Üst seviye bileşen (SettingsPage İÇİNDE TANIMLAMA — iç içe bileşen her render'da remount olur, state kaybedilir).
function VoicePool({ provider, rows, withPath, reload, onError }: {
  provider: string; rows: VoiceRow[]; withPath?: boolean;
  reload: () => Promise<void>; onError: (msg: string) => void;
}) {
  const t = useT();
  const genderLabel: Record<string, string> = { male: t('settings.genderMale'), female: t('settings.genderFemale'), '': '—' };
  const [nv, setNv] = useState({ voice: '', gender: '', tone: '', path: '' });

  async function add(body: unknown) {
    const res = await fetch('/api/voices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) onError((await res.json().catch(() => ({})) as { error?: string }).error ?? t('settings.addVoiceError'));
    else setNv({ voice: '', gender: '', tone: '', path: '' });
    await reload();
  }

  return (
    <div className="rows">
      {rows.length === 0 && <p className="muted">{t('settings.poolEmpty')}</p>}
      {rows.map((v) => (
        <div key={v.id} className="rowitem">
          <span className="mono">{v.voice}</span>
          <select
            value={v.gender} aria-label={t('settings.genderAria')}
            onChange={async (e) => { await patchVoice(v.id, { gender: e.target.value }); reload(); }}
          >
            {Object.entries(genderLabel).map(([val, lab]) => <option key={val} value={val}>{lab}</option>)}
          </select>
          <input
            defaultValue={v.tone} placeholder={t('settings.toneHintPlaceholder')} aria-label={t('settings.toneAria')}
            onBlur={async (e) => { if (e.target.value !== v.tone) { await patchVoice(v.id, { tone: e.target.value }); reload(); } }}
          />
          <ConfirmButton onConfirm={async () => { await fetch(`/api/voices/${v.id}`, { method: 'DELETE' }); reload(); }} ariaLabel={t('settings.deleteVoice')} />
        </div>
      ))}
      {withPath ? (
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (nv.path.trim()) add({ provider: 'piper', path: nv.path.trim() }); }}>
          <input value={nv.path} onChange={(e) => setNv({ ...nv, path: e.target.value })} placeholder="C:\piper\sesler\tr_TR-fahrettin-medium.onnx" />
          <button type="submit"><Icon name="plus" /> {t('settings.addModelButton')}</button>
        </form>
      ) : (
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (nv.voice.trim()) add({ provider, voice: nv.voice.trim(), gender: nv.gender, tone: nv.tone }); }}>
          <input value={nv.voice} onChange={(e) => setNv({ ...nv, voice: e.target.value })} placeholder={t('settings.voiceNamePlaceholder')} style={{ maxWidth: '10rem' }} />
          <select value={nv.gender} onChange={(e) => setNv({ ...nv, gender: e.target.value })} aria-label={t('settings.genderAria')}>
            {Object.entries(genderLabel).map(([val, lab]) => <option key={val} value={val}>{lab}</option>)}
          </select>
          <input value={nv.tone} onChange={(e) => setNv({ ...nv, tone: e.target.value })} placeholder={t('settings.toneShortPlaceholder')} style={{ maxWidth: '10rem' }} />
          <button type="submit"><Icon name="plus" /> {t('common.add')}</button>
        </form>
      )}
    </div>
  );
}

// Üst seviye bileşen (SettingsPage İÇİNDE TANIMLAMA — iç içe bileşen her render'da remount olur, state kaybedilir).
function QuickSetupRow({ ok, label, hint, target, go }: { ok: boolean; label: string; hint: string; target: string; go: (id: string) => void }) {
  const t = useT();
  return (
    <div className="rowitem">
      <span aria-hidden>{ok ? '✓' : '—'}</span>
      <span>{label}</span>
      <span className="muted">{hint}</span>
      {!ok && <button className="ghost" onClick={() => go(target)}>{t('settings.quickGo')}</button>}
    </div>
  );
}

export default function SettingsPage() {
  const t = useT();
  const { lang, setLang } = useLang();
  const [data, setData] = useState<SettingsData | null>(null);
  const [err, setErr] = useState('');
  const [keyInput, setKeyInput] = useState('');
  const [modelInput, setModelInput] = useState('');
  const [piperInput, setPiperInput] = useState('');
  const [llmModelInput, setLlmModelInput] = useState('');
  const [llmBaseInput, setLlmBaseInput] = useState('');
  const [llmKeyInput, setLlmKeyInput] = useState('');
  const [conn, setConn] = useState({ id: '', label: '', baseUrl: '', apiKey: '', model: '' });
  const [probeMsg, setProbeMsg] = useState<Record<string, string>>({}); // anahtar: 'llm' | bağlantı id'si
  const [detected, setDetected] = useState<Record<string, boolean>>({});
  const [xtts, setXtts] = useState<{ state: string; log: string[]; exitInfo: string; voices: string[] }>({ state: 'stopped', log: [], exitInfo: '', voices: [] });
  const [llmModels, setLlmModels] = useState<string[]>([]);
  const [xttsFiles, setXttsFiles] = useState<string[]>([]);

  const refreshXtts = useCallback(async () => {
    const res = await fetch('/api/xtts');
    if (res.ok) setXtts(await res.json());
  }, []);
  useEffect(() => { refreshXtts(); }, [refreshXtts]);
  useEffect(() => {
    if (xtts.state !== 'starting' && xtts.state !== 'running') return;
    const id = setInterval(refreshXtts, 2000);
    return () => clearInterval(id);
  }, [xtts.state, refreshXtts]);

  const refreshXttsFiles = useCallback(async () => {
    const res = await fetch('/api/xtts/voices');
    if (res.ok) setXttsFiles((await res.json()).voices ?? []);
  }, []);
  useEffect(() => { refreshXttsFiles(); }, [refreshXttsFiles]);

  async function probe(kind: 'llm' | 'tts', baseUrl: string, msgKey: string) {
    const res = await fetch('/api/probe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, baseUrl }) });
    const d = await res.json().catch(() => ({ ok: false, detail: '?' }));
    if (d.models) setLlmModels(d.models);
    setProbeMsg((m) => ({ ...m, [msgKey]: `${d.ok ? '✓' : '✗'} ${d.detail}` }));
    return !!d.ok;
  }

  // Sayfa açılışında bilinen portları sessizce yokla (yalnızca rozet için).
  useEffect(() => {
    const targets: [string, 'llm' | 'tts', string][] = [
      ['lmstudio', 'llm', 'http://localhost:1234/v1'],
      ['ollama', 'llm', 'http://localhost:11434/v1'],
      ['xtts', 'tts', 'http://localhost:8020/v1'],
    ];
    for (const [key, kind, baseUrl] of targets) {
      fetch('/api/probe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, baseUrl }) })
        .then((r) => r.json()).then((d) => setDetected((m) => ({ ...m, [key]: !!d.ok }))).catch(() => {});
    }
  }, []);

  const load = useCallback(async () => {
    const res = await fetch('/api/settings');
    if (!res.ok) { setErr(t('settings.loadError')); return; }
    const d: SettingsData = await res.json();
    setData(d); setModelInput(d.model); setPiperInput(d.piperExe); setLlmModelInput(d.llmModel); setLlmBaseInput(d.llmBaseUrl);
  }, [t]);
  useEffect(() => { load(); }, [load]);

  async function put(patch: Record<string, unknown>) {
    setErr('');
    const res = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    if (!res.ok) setErr((await res.json().catch(() => ({})) as { error?: string }).error ?? t('settings.saveError'));
    await load();
    return res.ok;
  }

  async function addConnection() {
    setErr('');
    const res = await fetch('/api/connections', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: conn.id, label: conn.label || undefined, baseUrl: conn.baseUrl, apiKey: conn.apiKey || undefined, model: conn.model }),
    });
    if (!res.ok) setErr((await res.json().catch(() => ({})) as { error?: string }).error ?? t('settings.connectionAddError'));
    else setConn({ id: '', label: '', baseUrl: '', apiKey: '', model: '' });
    await load();
  }

  async function addDefaults(provider: string) {
    setErr('');
    const res = await fetch('/api/voices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, defaults: true }) });
    if (!res.ok) setErr(t('settings.voicesAddError'));
    await load();
  }

  async function delConnection(id: string) { setErr(''); await fetch(`/api/connections/${id}`, { method: 'DELETE' }); await load(); }

  async function setupXtts() {
    setErr('');
    const cur = data;
    if (!cur) return;
    if (!cur.connections.some((c) => c.id === 'xtts')) {
      const res = await fetch('/api/connections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'xtts', baseUrl: 'http://localhost:8020/v1', model: 'xtts-v2' }) });
      if (!res.ok) { setErr((await res.json().catch(() => ({})) as { error?: string }).error ?? t('settings.connectionAddError')); return; }
    }
    await put({ provider: 'xtts' }); // aktif sağlayıcıyı da geçir — yeni kullanıcı tuzağı #2
    const pr = await fetch('/api/probe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'tts', baseUrl: 'http://localhost:8020/v1' }) });
    const d = await pr.json().catch(() => ({ ok: false, detail: '?', voices: [] as string[] }));
    if (d.ok) {
      const fresh: SettingsData = await (await fetch('/api/settings')).json(); // eşitleme öncesi güncel havuz (stale state'e karşı)
      const have = new Set((fresh.voices.xtts ?? []).map((v) => v.voice));
      for (const v of (d.voices ?? []) as string[]) {
        if (!have.has(v)) await fetch('/api/voices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'xtts', voice: v }) });
      }
    }
    setProbeMsg((m) => ({ ...m, xtts: `${d.ok ? '✓' : '✗'} ${d.detail}` }));
    await load();
  }

  if (data === null) return <p className="muted">{t('common.loading')}</p>;

  const providerOptions = [
    { value: 'gemini', label: 'Gemini' },
    { value: 'piper', label: t('settings.piperLocal') },
    ...data.connections.map((c) => ({ value: c.id, label: t('settings.connectionOpenaiCompatible', { label: c.label }) })),
    { value: 'mock', label: t('settings.mockTest') },
  ];

  const s = setupStatus(data);
  const poolTarget = data.provider === 'gemini' ? 'card-gemini' : data.provider === 'piper' ? 'card-piper' : 'card-connections';
  const goToCard = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });

  return (
    <>
      <div className="crumbs"><span className="here">{t('settings.title')}</span></div>
      <h1>{t('settings.title')}</h1>
      {err && <p className="muted" role="alert"><Icon name="warn" size={14} /> {err}</p>}

      <div className="card">
        <h2>{t('settings.language')}</h2>
        <div className="row">
          <label><input type="radio" name="lang" checked={lang === 'tr'} onChange={() => setLang('tr')} /> Türkçe</label>
          <label><input type="radio" name="lang" checked={lang === 'en'} onChange={() => setLang('en')} /> English</label>
        </div>
      </div>

      <div className="card" id="quick-setup">
        <h2><Icon name="doc" /> {t('settings.quickHeading')}</h2>
        <div className="rows">
          <QuickSetupRow ok={s.llm} label={t('settings.quickLlm')} hint={t('settings.quickLlmHint')} target="card-llm" go={goToCard} />
          <QuickSetupRow ok={s.tts} label={t('settings.quickTts')} hint={t('settings.quickTtsHint')} target="card-tts" go={goToCard} />
          <QuickSetupRow ok={s.pool} label={t('settings.quickPool')} hint={t('settings.quickPoolHint')} target={poolTarget} go={goToCard} />
        </div>
        {s.llm && s.tts && s.pool && <p className="muted">{t('settings.quickReady')}</p>}
      </div>

      <div className="card" id="card-tts">
        <h2><Icon name="speaker" /> {t('settings.activeProviderHeading')}</h2>
        <p className="row">
          <select value={data.provider} onChange={(e) => put({ provider: e.target.value })} aria-label={t('settings.activeProviderAria')}>
            {providerOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </p>
      </div>

      <div className="card" id="card-gemini">
        <h2><Icon name="wave" /> Gemini</h2>
        <div className="rows">
          <div className="rowitem">
            <span>{t('settings.apiKeyLabel')}</span>
            <span className="mono muted">
              {data.geminiKeySource === 'db' && data.geminiKey}
              {data.geminiKeySource === 'env' && <span className="badge">{t('settings.fromEnv')}</span>}
              {data.geminiKeySource === null && '—'}
            </span>
          </div>
          <form className="row" onSubmit={async (e) => { e.preventDefault(); if (keyInput.trim()) { if (await put({ geminiKey: keyInput.trim() })) setKeyInput(''); } }}>
            <input type="password" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} placeholder={t('settings.newKeyPlaceholder')} autoComplete="off" />
            <button type="submit">{t('common.save')}</button>
            {data.geminiKeySource === 'db' && <button type="button" className="ghost" onClick={() => put({ geminiKey: null })}>{t('settings.deleteFromDb')}</button>}
          </form>
          <form className="row" onSubmit={async (e) => { e.preventDefault(); await put({ model: modelInput.trim() }); }}>
            <input value={modelInput} onChange={(e) => setModelInput(e.target.value)} placeholder={t('settings.modelPlaceholder')} />
            <button type="submit">{t('common.save')}</button>
          </form>
        </div>
        <h2 style={{ marginTop: '1rem' }}><Icon name="person" /> {t('settings.geminiVoicePool')}</h2>
        <VoicePool provider="gemini" rows={data.voices.gemini ?? []} reload={load} onError={setErr} />
      </div>

      <div className="card" id="card-connections">
        <h2><Icon name="doc" /> {t('settings.connectionsHeading')}</h2>
        {data.connections.length === 0 && <p className="muted">{t('settings.connectionsEmpty')}</p>}
        {data.connections.map((c) => (
          <details key={c.id} className="conn">
            <summary className="rowitem">
              <span className="mono">{c.id}</span>
              <span className="muted">{c.baseUrl} · {c.model}</span>
              {c.hasKey && <span className="badge">{t('settings.hasKeyBadge')}</span>}
              {/* summary içindeki tıklamalar details'i açıp kapatmasın */}
              <span onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
                <ConfirmButton onConfirm={() => delConnection(c.id)} ariaLabel={t('settings.deleteConnection')} />
              </span>
            </summary>
            <button className="ghost" onClick={() => addDefaults(c.id)}>{t('settings.addOfficialVoices')}</button>
            <button className="ghost" onClick={() => probe('tts', c.baseUrl, c.id)}>{t('settings.probeButton')}</button>
            {probeMsg[c.id] && <span className="muted">{probeMsg[c.id]}</span>}
            <VoicePool provider={c.id} rows={data.voices[c.id] ?? []} reload={load} onError={setErr} />
          </details>
        ))}
        <div className="row">
          <button type="button" className="ghost" onClick={setupXtts}>
            <Icon name="plus" /> {data.connections.some((c) => c.id === 'xtts') ? t('settings.xttsSyncVoices') : t('settings.xttsPresetButton')} {detected.xtts && <span className="badge">{t('settings.detectedBadge')}</span>}
          </button>
          {probeMsg.xtts && <span className="muted">{probeMsg.xtts}</span>}
          <span className="muted">{t('settings.presetHint')}</span>
        </div>
        <form className="row wrap" onSubmit={(e) => { e.preventDefault(); addConnection(); }}>
          <input value={conn.id} onChange={(e) => setConn({ ...conn, id: e.target.value })} placeholder={t('settings.connIdPlaceholder')} style={{ maxWidth: '10rem' }} />
          <input value={conn.baseUrl} onChange={(e) => setConn({ ...conn, baseUrl: e.target.value })} placeholder="http://localhost:8000/v1" />
          <input value={conn.model} onChange={(e) => setConn({ ...conn, model: e.target.value })} placeholder={t('settings.connModelPlaceholder')} style={{ maxWidth: '9rem' }} />
          <input type="password" value={conn.apiKey} onChange={(e) => setConn({ ...conn, apiKey: e.target.value })} placeholder={t('settings.connKeyPlaceholder')} style={{ maxWidth: '10rem' }} autoComplete="off" />
          <button type="submit"><Icon name="plus" /> {t('settings.addConnectionButton')}</button>
        </form>
      </div>

      <div className="card" id="card-piper">
        <h2><Icon name="speaker" /> {t('settings.piperLocal')}</h2>
        <form className="row" onSubmit={async (e) => { e.preventDefault(); await put({ piperExe: piperInput.trim() }); }}>
          <input value={piperInput} onChange={(e) => setPiperInput(e.target.value)} placeholder="C:\piper\piper.exe" />
          <button type="submit">{t('common.save')}</button>
        </form>
        <p className="muted">{t('settings.piperReadmeHint')}</p>
        <VoicePool provider="piper" rows={data.voices.piper ?? []} withPath reload={load} onError={setErr} />
      </div>

      <div className="card" id="card-xtts">
        <h2><Icon name="speaker" /> {t('settings.xttsHeading')}</h2>
        <div className="row">
          {xtts.state === 'stopped' || xtts.state === 'error' ? (
            <button onClick={async () => {
              const res = await fetch('/api/xtts', { method: 'POST' });
              if (!res.ok) setErr((await res.json().catch(() => ({})) as { error?: string }).error ?? t('settings.saveError'));
              await refreshXtts();
            }}>{t('settings.xttsStart')}</button>
          ) : (
            <button className="ghost" onClick={async () => {
              const res = await fetch('/api/xtts', { method: 'DELETE' });
              if (!res.ok) setErr((await res.json().catch(() => ({})) as { error?: string }).error ?? t('settings.saveError'));
              await refreshXtts();
            }}>{t('settings.xttsStop')}</button>
          )}
          <span className="muted">
            {xtts.state === 'stopped' && t('settings.xttsState.stopped')}
            {xtts.state === 'starting' && t('settings.xttsState.starting')}
            {xtts.state === 'running' && t('settings.xttsState.running', { count: xtts.voices.length })}
            {xtts.state === 'error' && t('settings.xttsState.error', { detail: xtts.exitInfo })}
          </span>
        </div>
        {xtts.log.length > 0 && xtts.state !== 'stopped' && (
          <pre className="mono muted" style={{ maxHeight: '8rem', overflow: 'auto', fontSize: '0.75rem' }}>{xtts.log.slice(-12).join('\n')}</pre>
        )}
        <p className="muted">{t('settings.xttsHint')}</p>
        <div className="rows">
          {xttsFiles.map((f) => (
            <div key={f} className="rowitem">
              <span className="mono">{f}</span>
              <ConfirmButton onConfirm={async () => { await fetch(`/api/xtts/voices/${encodeURIComponent(f)}`, { method: 'DELETE' }); await refreshXttsFiles(); }} ariaLabel={t('settings.deleteVoice')} />
            </div>
          ))}
          <input type="file" accept=".wav" aria-label={t('settings.xttsUploadAria')} onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setErr('');
            const fd = new FormData(); fd.append('file', f);
            const res = await fetch('/api/xtts/voices', { method: 'POST', body: fd });
            if (!res.ok) setErr((await res.json().catch(() => ({})) as { error?: string }).error ?? t('settings.saveError'));
            e.target.value = '';
            await refreshXttsFiles(); await load();
          }} />
          <p className="muted">{t('settings.xttsVoicesHint')}</p>
        </div>
      </div>

      <div className="card">
        <h2><Icon name="warn" /> {t('settings.quotaHeading')}</h2>
        <div className="rows">
          {Object.entries(data.quotaLimits).map(([p, lim]) => (
            <div key={p} className="rowitem">
              <span className="mono">{p}</span>
              <input
                key={`${p}:${lim ?? ''}`}
                type="number" min={1} defaultValue={lim ?? ''} placeholder={t('settings.unlimited')} aria-label={t('settings.dailyLimitAria', { provider: p })}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  const n = v === '' ? null : Number(v);
                  if (n === lim) return;
                  if (n === null || (Number.isInteger(n) && n > 0)) put({ quotaLimits: { [p]: n } });
                  else setErr(t('settings.quotaLimitError'));
                }}
                style={{ maxWidth: '8rem' }}
              />
              <span className="muted">{lim == null ? t('settings.unlimited') : t('settings.quotaPerDay', { limit: lim })}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card" id="card-llm">
        <h2><Icon name="doc" /> {t('settings.llmHeading')}</h2>
        <div className="row">
          <select value={data.llmProvider} onChange={(e) => put({ llmProvider: e.target.value })} aria-label={t('settings.llmProviderAria')}>
            <option value="gemini">Gemini</option>
            <option value="openai-compat">{t('settings.llmOpenaiCompat')}</option>
            <option value="mock">{t('settings.mockTest')}</option>
          </select>
          <form className="row" onSubmit={async (e) => { e.preventDefault(); await put({ llmModel: llmModelInput.trim() }); }}>
            <input value={llmModelInput} onChange={(e) => setLlmModelInput(e.target.value)} placeholder={t('settings.modelPlaceholder')} />
            <button type="submit">{t('common.save')}</button>
          </form>
        </div>
        <div className="row">
          <button type="button" className="ghost" onClick={() => { setLlmBaseInput('http://localhost:1234/v1'); put({ llmProvider: 'openai-compat', llmBaseUrl: 'http://localhost:1234/v1' }); }}>
            LM Studio {detected.lmstudio && <span className="badge">{t('settings.detectedBadge')}</span>}
          </button>
          <button type="button" className="ghost" onClick={() => { setLlmBaseInput('http://localhost:11434/v1'); put({ llmProvider: 'openai-compat', llmBaseUrl: 'http://localhost:11434/v1' }); }}>
            Ollama {detected.ollama && <span className="badge">{t('settings.detectedBadge')}</span>}
          </button>
          <button type="button" className="ghost" onClick={() => probe('llm', llmBaseInput.trim() || 'http://localhost:1234/v1', 'llm')}>{t('settings.probeButton')}</button>
          {probeMsg.llm && <span className="muted">{probeMsg.llm}</span>}
        </div>
        {llmModels.length > 0 && (
          <select aria-label={t('settings.llmProviderAria')} value="" onChange={async (e) => { const v = e.target.value; if (v) { setLlmModelInput(v); await put({ llmModel: v }); } }}>
            <option value="">{t('settings.llmModelPick')}</option>
            {llmModels.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        )}
        {data.llmProvider === 'openai-compat' && (
          <>
            <form className="row" onSubmit={async (e) => {
              e.preventDefault();
              if (await put({ llmBaseUrl: llmBaseInput.trim(), ...(llmKeyInput.trim() ? { llmApiKey: llmKeyInput.trim() } : {}) })) setLlmKeyInput('');
            }}>
              <input value={llmBaseInput} onChange={(e) => setLlmBaseInput(e.target.value)} placeholder={t('settings.llmBaseUrlPlaceholder')} aria-label={t('settings.llmBaseUrlAria')} />
              <input value={llmKeyInput} onChange={(e) => setLlmKeyInput(e.target.value)} placeholder={data.llmApiKey ?? t('settings.llmApiKeyPlaceholder')} type="password" autoComplete="off" />
              <button type="submit">{t('common.save')}</button>
            </form>
            <p className="muted">{t('settings.llmLocalHint')}</p>
          </>
        )}
        {data.llmProvider === 'gemini' && <p className="muted">{t('settings.llmUsesGeminiKey')}</p>}
      </div>
    </>
  );
}
