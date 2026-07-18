'use client';
import { useCallback, useEffect, useState } from 'react';
import { Icon } from '@/lib/ui/Icon';
import { ConfirmButton } from '@/lib/ui/ConfirmButton';

type VoiceRow = { id: string; provider: string; voice: string; gender: string; tone: string; path: string | null };
type Conn = { id: string; label: string; baseUrl: string; model: string; hasKey: boolean };
type SettingsData = {
  provider: string; model: string; llmProvider: string; llmModel: string; piperExe: string;
  geminiKey: string | null; geminiKeySource: 'db' | 'env' | null;
  quotaLimits: Record<string, number | null>;
  connections: Conn[]; voices: Record<string, VoiceRow[]>;
};

const GENDER_LABEL: Record<string, string> = { male: 'Erkek', female: 'Kadın', '': '—' };

async function patchVoice(id: string, patch: { gender?: string; tone?: string }) {
  await fetch(`/api/voices/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
}

// Üst seviye bileşen (SettingsPage İÇİNDE TANIMLAMA — iç içe bileşen her render'da remount olur, state kaybedilir).
function VoicePool({ provider, rows, withPath, reload, onError }: {
  provider: string; rows: VoiceRow[]; withPath?: boolean;
  reload: () => Promise<void>; onError: (msg: string) => void;
}) {
  const [nv, setNv] = useState({ voice: '', gender: '', tone: '', path: '' });

  async function add(body: unknown) {
    const res = await fetch('/api/voices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) onError((await res.json().catch(() => ({})) as { error?: string }).error ?? 'Ses eklenemedi');
    else setNv({ voice: '', gender: '', tone: '', path: '' });
    await reload();
  }

  return (
    <div className="rows">
      {rows.length === 0 && <p className="muted">Havuz boş.</p>}
      {rows.map((v) => (
        <div key={v.id} className="rowitem">
          <span className="mono">{v.voice}</span>
          <select
            value={v.gender} aria-label="Cinsiyet"
            onChange={async (e) => { await patchVoice(v.id, { gender: e.target.value }); reload(); }}
          >
            {Object.entries(GENDER_LABEL).map(([val, lab]) => <option key={val} value={val}>{lab}</option>)}
          </select>
          <input
            defaultValue={v.tone} placeholder="ton (ör. olgun, anlatıcı)" aria-label="Ton"
            onBlur={async (e) => { if (e.target.value !== v.tone) { await patchVoice(v.id, { tone: e.target.value }); reload(); } }}
          />
          <ConfirmButton onConfirm={async () => { await fetch(`/api/voices/${v.id}`, { method: 'DELETE' }); reload(); }} ariaLabel="Sesi sil" />
        </div>
      ))}
      {withPath ? (
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (nv.path.trim()) add({ provider: 'piper', path: nv.path.trim() }); }}>
          <input value={nv.path} onChange={(e) => setNv({ ...nv, path: e.target.value })} placeholder="C:\piper\sesler\tr_TR-fahrettin-medium.onnx" />
          <button type="submit"><Icon name="plus" /> Model ekle</button>
        </form>
      ) : (
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (nv.voice.trim()) add({ provider, voice: nv.voice.trim(), gender: nv.gender, tone: nv.tone }); }}>
          <input value={nv.voice} onChange={(e) => setNv({ ...nv, voice: e.target.value })} placeholder="ses adı" style={{ maxWidth: '10rem' }} />
          <select value={nv.gender} onChange={(e) => setNv({ ...nv, gender: e.target.value })} aria-label="Cinsiyet">
            {Object.entries(GENDER_LABEL).map(([val, lab]) => <option key={val} value={val}>{lab}</option>)}
          </select>
          <input value={nv.tone} onChange={(e) => setNv({ ...nv, tone: e.target.value })} placeholder="ton" style={{ maxWidth: '10rem' }} />
          <button type="submit"><Icon name="plus" /> Ekle</button>
        </form>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [err, setErr] = useState('');
  const [keyInput, setKeyInput] = useState('');
  const [modelInput, setModelInput] = useState('');
  const [piperInput, setPiperInput] = useState('');
  const [llmModelInput, setLlmModelInput] = useState('');
  const [conn, setConn] = useState({ id: '', label: '', baseUrl: '', apiKey: '', model: '' });

  const load = useCallback(async () => {
    const res = await fetch('/api/settings');
    if (!res.ok) { setErr('Ayarlar yüklenemedi'); return; }
    const d: SettingsData = await res.json();
    setData(d); setModelInput(d.model); setPiperInput(d.piperExe); setLlmModelInput(d.llmModel);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function put(patch: Record<string, unknown>) {
    setErr('');
    const res = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    if (!res.ok) setErr((await res.json().catch(() => ({})) as { error?: string }).error ?? 'Kaydedilemedi');
    await load();
    return res.ok;
  }

  async function addConnection() {
    setErr('');
    const res = await fetch('/api/connections', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: conn.id, label: conn.label || undefined, baseUrl: conn.baseUrl, apiKey: conn.apiKey || undefined, model: conn.model }),
    });
    if (!res.ok) setErr((await res.json().catch(() => ({})) as { error?: string }).error ?? 'Bağlantı eklenemedi');
    else setConn({ id: '', label: '', baseUrl: '', apiKey: '', model: '' });
    await load();
  }

  async function addDefaults(provider: string) {
    setErr('');
    const res = await fetch('/api/voices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, defaults: true }) });
    if (!res.ok) setErr('Sesler eklenemedi');
    await load();
  }

  async function delConnection(id: string) { setErr(''); await fetch(`/api/connections/${id}`, { method: 'DELETE' }); await load(); }

  if (data === null) return <p className="muted">Yükleniyor…</p>;

  const providerOptions = [
    { value: 'gemini', label: 'Gemini' },
    { value: 'piper', label: 'Piper (lokal)' },
    ...data.connections.map((c) => ({ value: c.id, label: `${c.label} (OpenAI-uyumlu)` })),
    { value: 'mock', label: 'Mock (test)' },
  ];

  return (
    <>
      <div className="crumbs"><span className="here">Ayarlar</span></div>
      <h1>Ayarlar</h1>
      {err && <p className="muted" role="alert"><Icon name="warn" size={14} /> {err}</p>}

      <div className="card">
        <h2><Icon name="speaker" /> Aktif TTS sağlayıcısı</h2>
        <p className="row">
          <select value={data.provider} onChange={(e) => put({ provider: e.target.value })} aria-label="Aktif sağlayıcı">
            {providerOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </p>
      </div>

      <div className="card">
        <h2><Icon name="wave" /> Gemini</h2>
        <div className="rows">
          <div className="rowitem">
            <span>API anahtarı</span>
            <span className="mono muted">
              {data.geminiKeySource === 'db' && data.geminiKey}
              {data.geminiKeySource === 'env' && <span className="badge">env&#39;den</span>}
              {data.geminiKeySource === null && '—'}
            </span>
          </div>
          <form className="row" onSubmit={async (e) => { e.preventDefault(); if (keyInput.trim()) { if (await put({ geminiKey: keyInput.trim() })) setKeyInput(''); } }}>
            <input type="password" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} placeholder="Yeni anahtar (DB&#39;ye kaydedilir)" autoComplete="off" />
            <button type="submit">Kaydet</button>
            {data.geminiKeySource === 'db' && <button type="button" className="ghost" onClick={() => put({ geminiKey: null })}>DB&#39;den sil</button>}
          </form>
          <form className="row" onSubmit={async (e) => { e.preventDefault(); await put({ model: modelInput.trim() }); }}>
            <input value={modelInput} onChange={(e) => setModelInput(e.target.value)} placeholder="model (boş = varsayılan)" />
            <button type="submit">Kaydet</button>
          </form>
        </div>
        <h2 style={{ marginTop: '1rem' }}><Icon name="person" /> Gemini ses havuzu</h2>
        <VoicePool provider="gemini" rows={data.voices.gemini ?? []} reload={load} onError={setErr} />
      </div>

      <div className="card">
        <h2><Icon name="doc" /> OpenAI-uyumlu bağlantılar</h2>
        {data.connections.length === 0 && <p className="muted">Henüz bağlantı yok. Lokal bir sunucu (AllTalk, openedai-speech…) veya OpenAI için ekle.</p>}
        {data.connections.map((c) => (
          <details key={c.id} className="conn">
            <summary className="rowitem">
              <span className="mono">{c.id}</span>
              <span className="muted">{c.baseUrl} · {c.model}</span>
              {c.hasKey && <span className="badge">anahtarlı</span>}
              {/* summary içindeki tıklamalar details'i açıp kapatmasın */}
              <span onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
                <ConfirmButton onConfirm={() => delConnection(c.id)} ariaLabel="Bağlantıyı sil" />
              </span>
            </summary>
            <button className="ghost" onClick={() => addDefaults(c.id)}>Resmî OpenAI seslerini ekle</button>
            <VoicePool provider={c.id} rows={data.voices[c.id] ?? []} reload={load} onError={setErr} />
          </details>
        ))}
        <form className="row wrap" onSubmit={(e) => { e.preventDefault(); addConnection(); }}>
          <input value={conn.id} onChange={(e) => setConn({ ...conn, id: e.target.value })} placeholder="ad (ör. alltalk-lokal)" style={{ maxWidth: '10rem' }} />
          <input value={conn.baseUrl} onChange={(e) => setConn({ ...conn, baseUrl: e.target.value })} placeholder="http://localhost:8000/v1" />
          <input value={conn.model} onChange={(e) => setConn({ ...conn, model: e.target.value })} placeholder="model (ör. tts-1)" style={{ maxWidth: '9rem' }} />
          <input type="password" value={conn.apiKey} onChange={(e) => setConn({ ...conn, apiKey: e.target.value })} placeholder="anahtar (opsiyonel)" style={{ maxWidth: '10rem' }} autoComplete="off" />
          <button type="submit"><Icon name="plus" /> Bağlantı ekle</button>
        </form>
      </div>

      <div className="card">
        <h2><Icon name="speaker" /> Piper (lokal)</h2>
        <form className="row" onSubmit={async (e) => { e.preventDefault(); await put({ piperExe: piperInput.trim() }); }}>
          <input value={piperInput} onChange={(e) => setPiperInput(e.target.value)} placeholder="C:\piper\piper.exe" />
          <button type="submit">Kaydet</button>
        </form>
        <p className="muted">Kurulum ve Türkçe ses modelleri için README&#39;deki Piper bölümüne bak.</p>
        <VoicePool provider="piper" rows={data.voices.piper ?? []} withPath reload={load} onError={setErr} />
      </div>

      <div className="card">
        <h2><Icon name="warn" /> Günlük kota limitleri</h2>
        <div className="rows">
          {Object.entries(data.quotaLimits).map(([p, lim]) => (
            <div key={p} className="rowitem">
              <span className="mono">{p}</span>
              <input
                key={`${p}:${lim ?? ''}`}
                type="number" min={1} defaultValue={lim ?? ''} placeholder="limitsiz" aria-label={`${p} günlük limit`}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  const n = v === '' ? null : Number(v);
                  if (n === lim) return;
                  if (n === null || (Number.isInteger(n) && n > 0)) put({ quotaLimits: { [p]: n } });
                  else setErr('Kota limiti pozitif tam sayı olmalı (boş = limitsiz)');
                }}
                style={{ maxWidth: '8rem' }}
              />
              <span className="muted">{lim == null ? 'limitsiz' : `${lim}/gün`}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2><Icon name="doc" /> LLM (annotation)</h2>
        <div className="row">
          <select value={data.llmProvider} onChange={(e) => put({ llmProvider: e.target.value })} aria-label="LLM sağlayıcısı">
            <option value="gemini">Gemini</option>
            <option value="mock">Mock (test)</option>
          </select>
          <form className="row" onSubmit={async (e) => { e.preventDefault(); await put({ llmModel: llmModelInput.trim() }); }}>
            <input value={llmModelInput} onChange={(e) => setLlmModelInput(e.target.value)} placeholder="model (boş = varsayılan)" />
            <button type="submit">Kaydet</button>
          </form>
        </div>
        <p className="muted">Gemini LLM, yukarıdaki Gemini API anahtarını kullanır.</p>
      </div>
    </>
  );
}
