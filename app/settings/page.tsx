'use client';
import { useCallback, useEffect, useState } from 'react';
import { Icon } from '@/lib/ui/Icon';
import { ConfirmButton } from '@/lib/ui/ConfirmButton';
import { useLang, useT } from '@/lib/ui/LanguageProvider';

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

  if (data === null) return <p className="muted">{t('common.loading')}</p>;

  const providerOptions = [
    { value: 'gemini', label: 'Gemini' },
    { value: 'piper', label: t('settings.piperLocal') },
    ...data.connections.map((c) => ({ value: c.id, label: t('settings.connectionOpenaiCompatible', { label: c.label }) })),
    { value: 'mock', label: t('settings.mockTest') },
  ];

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

      <div className="card">
        <h2><Icon name="speaker" /> {t('settings.activeProviderHeading')}</h2>
        <p className="row">
          <select value={data.provider} onChange={(e) => put({ provider: e.target.value })} aria-label={t('settings.activeProviderAria')}>
            {providerOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </p>
      </div>

      <div className="card">
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

      <div className="card">
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
            <VoicePool provider={c.id} rows={data.voices[c.id] ?? []} reload={load} onError={setErr} />
          </details>
        ))}
        <form className="row wrap" onSubmit={(e) => { e.preventDefault(); addConnection(); }}>
          <input value={conn.id} onChange={(e) => setConn({ ...conn, id: e.target.value })} placeholder={t('settings.connIdPlaceholder')} style={{ maxWidth: '10rem' }} />
          <input value={conn.baseUrl} onChange={(e) => setConn({ ...conn, baseUrl: e.target.value })} placeholder="http://localhost:8000/v1" />
          <input value={conn.model} onChange={(e) => setConn({ ...conn, model: e.target.value })} placeholder={t('settings.connModelPlaceholder')} style={{ maxWidth: '9rem' }} />
          <input type="password" value={conn.apiKey} onChange={(e) => setConn({ ...conn, apiKey: e.target.value })} placeholder={t('settings.connKeyPlaceholder')} style={{ maxWidth: '10rem' }} autoComplete="off" />
          <button type="submit"><Icon name="plus" /> {t('settings.addConnectionButton')}</button>
        </form>
      </div>

      <div className="card">
        <h2><Icon name="speaker" /> {t('settings.piperLocal')}</h2>
        <form className="row" onSubmit={async (e) => { e.preventDefault(); await put({ piperExe: piperInput.trim() }); }}>
          <input value={piperInput} onChange={(e) => setPiperInput(e.target.value)} placeholder="C:\piper\piper.exe" />
          <button type="submit">{t('common.save')}</button>
        </form>
        <p className="muted">{t('settings.piperReadmeHint')}</p>
        <VoicePool provider="piper" rows={data.voices.piper ?? []} withPath reload={load} onError={setErr} />
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

      <div className="card">
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
        {data.llmProvider === 'openai-compat' && (
          <>
            <form className="row" onSubmit={async (e) => {
              e.preventDefault();
              await put({ llmBaseUrl: llmBaseInput.trim(), ...(llmKeyInput.trim() ? { llmApiKey: llmKeyInput.trim() } : {}) });
              setLlmKeyInput('');
            }}>
              <input value={llmBaseInput} onChange={(e) => setLlmBaseInput(e.target.value)} placeholder={t('settings.llmBaseUrlPlaceholder')} aria-label={t('settings.llmBaseUrlAria')} />
              <input value={llmKeyInput} onChange={(e) => setLlmKeyInput(e.target.value)} placeholder={data.llmApiKey ?? t('settings.llmApiKeyPlaceholder')} type="password" />
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
