'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Icon } from '@/lib/ui/Icon';
import { EmptyState } from '@/lib/ui/EmptyState';
import { refreshTree } from '@/lib/ui/refresh';

type Chapter = { id: string; projectId: string; title: string; rawText: string; narrationStyle: string | null; voiceMode: string; maxCharacters: number; status: string };
type Segment = { id: string; idx: number; speaker: string; style: string | null; text: string; status: string; error: string | null; audioPath: string | null };
type Render = { id: string; path: string; durationSec: number | null; createdAt: number };
type CastMember = { character_id: string; display_name: string; voice_id: string; base_style?: string };
type ScriptInfo = { id: string; version: number; segmentCount: number; source: string; usage: { inputTokens: number; outputTokens: number; chunks: number } | null };
type Detail = { chapter: Chapter; script: ScriptInfo | null; cast: CastMember[]; segments: Segment[]; renders: Render[] };
type PoolVoice = { voiceId: string; gender: string; tone: string };

// POST + SSE: EventSource sadece GET desteklediği için fetch-stream ile okunur.
async function streamSse(url: string, body: unknown, onEvent: (ev: string, data: any) => void) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      const ev = /^event: (.*)$/m.exec(chunk)?.[1] ?? 'message';
      const data = /^data: (.*)$/m.exec(chunk)?.[1];
      onEvent(ev, data ? JSON.parse(data) : null);
    }
  }
}

// Üretim/annotation sürerken oynayan eşitleyici (imza motifi).
function Eq() {
  return <span className="eq" aria-hidden="true"><span /><span /><span /><span /><span /></span>;
}

export default function ChapterPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [rawText, setRawText] = useState('');
  const [narrationStyle, setNarrationStyle] = useState('');
  const [voiceMode, setVoiceMode] = useState('narrator');
  const [maxCharacters, setMaxCharacters] = useState(6);
  const [instruction, setInstruction] = useState('');
  const [scriptJson, setScriptJson] = useState('');
  const [scriptErr, setScriptErr] = useState('');
  const [annState, setAnnState] = useState<{ busy: boolean; chunk: number; totalChunks: number; err: string }>({ busy: false, chunk: 0, totalChunks: 0, err: '' });
  type Preflight = { total: number; cached: number; newCalls: number; quota: { provider: string; used: number; limit: number; remaining: number } | null; fits: boolean };
  const [pf, setPf] = useState<Preflight | null>(null);
  const [genState, setGenState] = useState<{ busy: boolean; done: number; total: number; err: string; paused: { reason: string; jobId: string } | null }>({ busy: false, done: 0, total: 0, err: '', paused: null });
  const [playingSeg, setPlayingSeg] = useState<string | null>(null);
  const [regenBusy, setRegenBusy] = useState<string | null>(null);
  const [voicePool, setVoicePool] = useState<PoolVoice[]>([]);
  const esRef = useRef<EventSource | null>(null);

  async function load() {
    const res = await fetch(`/api/chapters/${id}`);
    if (!res.ok) return;
    const d: Detail = await res.json();
    setDetail(d);
    setRawText(d.chapter.rawText);
    setNarrationStyle(d.chapter.narrationStyle ?? '');
    setVoiceMode(d.chapter.voiceMode);
    setMaxCharacters(d.chapter.maxCharacters);
    if (d.script) loadPreflight();
    if (d.chapter.status === 'generating') watchProgress();
  }
  useEffect(() => { load(); loadVoicePool(); }, [id]);
  useEffect(() => () => esRef.current?.close(), []);

  async function loadPreflight() {
    const res = await fetch(`/api/chapters/${id}/preflight`);
    setPf(res.ok ? await res.json() : null);
  }

  // Karakter sesi düzeltme dropdown'u: aktif TTS sağlayıcısının havuzu (Dilim C2 — sağlayıcı-bazlı).
  async function loadVoicePool() {
    const res = await fetch('/api/settings');
    if (!res.ok) { setVoicePool([]); return; }
    const s: { provider: string; voices: Record<string, { voice: string; gender: string; tone: string }[]> } = await res.json();
    const rows = s.voices[s.provider] ?? [];
    setVoicePool(rows.map((v) => ({ voiceId: `${s.provider}:${v.voice}`, gender: v.gender, tone: v.tone })));
  }

  // Üretimi izle: EventSource (GET SSE). Bağlantı kopması işi etkilemez.
  function watchProgress() {
    esRef.current?.close();
    const es = new EventSource(`/api/chapters/${id}/progress`);
    esRef.current = es;
    setGenState((s) => ({ ...s, busy: true, err: '', paused: null }));
    es.addEventListener('progress', (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      setGenState((s) => ({ ...s, done: d.done, total: d.total }));
    });
    es.addEventListener('done', (e) => {
      es.close();
      const d = JSON.parse((e as MessageEvent).data);
      setGenState({ busy: false, done: d.done, total: d.total, err: d.failedCount ? `${d.failedCount} segment üretilemedi` : '', paused: null });
      refreshTree(); load(); loadPreflight();
    });
    es.addEventListener('paused', (e) => {
      es.close();
      const d = JSON.parse((e as MessageEvent).data);
      setGenState({ busy: false, done: d.done, total: d.total, err: '', paused: { reason: d.reason, jobId: d.jobId } });
      refreshTree(); load(); loadPreflight();
    });
    es.addEventListener('failed', (e) => {
      es.close();
      const d = JSON.parse((e as MessageEvent).data);
      setGenState((s) => ({ ...s, busy: false, err: d.message ?? 'Üretim başarısız', paused: null }));
      refreshTree(); load(); loadPreflight();
    });
    es.onerror = () => { es.close(); setGenState((s) => ({ ...s, busy: false })); load(); };
  }

  async function saveText() {
    await fetch(`/api/chapters/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rawText, narrationStyle, voiceMode, maxCharacters }),
    });
    load();
  }

  // LLM annotation: önce metin/mod kaydedilir, sonra SSE ile üretim izlenir.
  async function annotate(withInstruction: boolean) {
    setAnnState({ busy: true, chunk: 0, totalChunks: 0, err: '' });
    try {
      await saveText();
      await streamSse(`/api/chapters/${id}/annotate`, withInstruction && instruction.trim() ? { instruction: instruction.trim() } : {}, (ev, data) => {
        if (ev === 'progress') setAnnState((s) => ({ ...s, chunk: data.chunk, totalChunks: data.totalChunks }));
        if (ev === 'error') setAnnState((s) => ({ ...s, err: data.message }));
      });
      if (withInstruction) setInstruction('');
    } catch (e) {
      setAnnState((s) => ({ ...s, err: e instanceof Error ? e.message : 'Bağlantı hatası' }));
    } finally {
      setAnnState((s) => ({ ...s, busy: false }));
      refreshTree(); load(); loadPreflight();
    }
  }

  async function changeVoice(characterId: string, voiceId: string) {
    const res = await fetch(`/api/chapters/${id}/cast-voice`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ characterId, voiceId }),
    });
    if (!res.ok) setScriptErr((await res.json()).error ?? 'Ses değiştirilemedi');
    load(); loadPreflight();
  }

  async function saveScript() {
    setScriptErr('');
    const res = await fetch(`/api/chapters/${id}/script`, { method: 'PUT', body: scriptJson });
    if (res.ok) { setScriptJson(''); refreshTree(); load(); loadPreflight(); }
    else setScriptErr((await res.json()).error ?? 'Script kaydedilemedi');
  }

  async function generate(limitCalls?: number) {
    setGenState({ busy: true, done: 0, total: pf?.total ?? 0, err: '', paused: null });
    const res = await fetch(`/api/chapters/${id}/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(limitCalls ? { limitCalls } : {}),
    });
    if (!res.ok) { const err = (await res.json()).error ?? 'Üretim başlatılamadı'; setGenState((s) => ({ ...s, busy: false, err })); return; }
    watchProgress();
  }

  async function resume(jobId: string) {
    const res = await fetch(`/api/jobs/${jobId}/resume`, { method: 'POST' });
    if (res.ok) watchProgress();
    else setGenState((s) => ({ ...s, err: 'Devam ettirilemedi' }));
  }

  async function regenerate(segmentId: string) {
    setRegenBusy(segmentId);
    try {
      const res = await fetch(`/api/segments/${segmentId}/regenerate`, { method: 'POST' });
      if (!res.ok) { const err = (await res.json()).error ?? 'Segment yeniden üretilemedi'; setGenState((s) => ({ ...s, err })); }
      refreshTree(); load(); loadPreflight();
    } finally { setRegenBusy(null); }
  }

  if (!detail) return <p className="muted">Yükleniyor…</p>;
  const { chapter, script, cast, segments, renders } = detail;
  // Havuz aktif sağlayıcıdan gelir; mevcut ses havuzda değilse (ör. sağlayıcı değişti) tek başına eklenir.
  const voiceOptions = (current: string) =>
    voicePool.some((v) => v.voiceId === current) ? voicePool : [{ voiceId: current, gender: '', tone: 'mevcut' }, ...voicePool];

  return (
    <>
      <div className="crumbs">
        <Link href="/">Projeler</Link>
        <span className="sep">›</span>
        <Link href={`/projects/${chapter.projectId}`}>Bölümler</Link>
        <span className="sep">›</span>
        <span className="here">{chapter.title}</span>
      </div>
      <h1>{chapter.title} <span className={`badge ${chapter.status}`}>{chapter.status}</span></h1>

      <div className="card">
        <h2><span className="stage">01</span> Metin &amp; anlatım {annState.busy && <Icon name="spinner" />}</h2>
        <p><textarea value={rawText} onChange={(e) => setRawText(e.target.value)} placeholder="Bölümün ham metni" /></p>
        <p><input value={narrationStyle} onChange={(e) => setNarrationStyle(e.target.value)} placeholder="Anlatım tarzı (ör. sakin, gizemli, üçüncü şahıs)" /></p>
        <p className="row">
          <span className="seg" role="group" aria-label="Ses modu">
            <button type="button" className={voiceMode === 'narrator' ? 'on' : ''} onClick={() => setVoiceMode('narrator')}>Tek anlatıcı</button>
            <button type="button" className={voiceMode === 'multi' ? 'on' : ''} onClick={() => setVoiceMode('multi')}>Çok karakterli</button>
          </span>
          {voiceMode === 'multi' && (
            <label className="row">maks. karakter:
              <input type="number" min={1} max={12} value={maxCharacters} onChange={(e) => setMaxCharacters(Number(e.target.value) || 6)} style={{ width: '4.5rem' }} />
            </label>
          )}
        </p>
        <p className="row">
          <button className="ghost" onClick={saveText}>Kaydet</button>
          <button onClick={() => annotate(false)} disabled={annState.busy || !rawText.trim()}>
            <Icon name="wave" /> {annState.busy ? 'Üretiliyor…' : 'Script üret (LLM)'}
          </button>
          {annState.busy && <Eq />}
          {annState.busy && annState.totalChunks > 0 && <span className="muted">{annState.chunk}/{annState.totalChunks} parça</span>}
        </p>
        {annState.busy && annState.totalChunks > 1 && <progress value={annState.chunk} max={annState.totalChunks} />}
        {annState.err && <p className="err">{annState.err}</p>}
      </div>

      <div className="card">
        <h2>
          <span className="stage">02</span> Seslendirme script’i
          {script && (
            <span className="muted">
              v{script.version} · {script.segmentCount} segment · {script.source === 'llm' ? 'LLM' : 'elle'}
              {script.usage ? ` · ${script.usage.inputTokens}+${script.usage.outputTokens} token` : ''}
            </span>
          )}
        </h2>

        {cast.length > 0 && (
          <table>
            <thead><tr><th>Karakter</th><th>Ton</th><th>Ses</th></tr></thead>
            <tbody>
              {cast.map((c) => (
                <tr key={c.character_id}>
                  <td><span className="row" style={{ gap: '0.4rem' }}><Icon name="person" /> {c.display_name}</span></td>
                  <td className="muted">{c.base_style ?? ''}</td>
                  <td>
                    <select value={c.voice_id} onChange={(e) => changeVoice(c.character_id, e.target.value)} style={{ maxWidth: '16rem' }}>
                      {voiceOptions(c.voice_id).map((v) => (
                        <option key={v.voiceId} value={v.voiceId}>{v.voiceId.split(':')[1]} — {v.tone}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {script && (
          <p className="row">
            <input value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="Ek talimat (ör. daha az segment, Kaan daha öfkeli)" />
            <button className="ghost" onClick={() => annotate(true)} disabled={annState.busy}><Icon name="pencil" /> Yeniden üret</button>
          </p>
        )}

        {!script && !annState.busy && (
          <EmptyState icon="doc" title="Henüz script yok">Ham metni kaydedip “Script üret (LLM)” ile başla — ya da aşağıdan elle JSON yapıştır.</EmptyState>
        )}

        <details>
          <summary>Elle JSON yapıştır (gelişmiş)</summary>
          <p><textarea value={scriptJson} onChange={(e) => setScriptJson(e.target.value)} placeholder="JSON script’i buraya yapıştır" /></p>
          <button className="ghost" onClick={saveScript} disabled={!scriptJson.trim()}>Script kaydet</button>
        </details>
        {scriptErr && <p className="err">{scriptErr}</p>}
      </div>

      <div className="card">
        <h2><span className="stage">03</span> Üretim {genState.busy && <Icon name="spinner" />}</h2>
        {pf && (
          <p className="muted">
            {pf.total} segment · {pf.cached} önbellekte · <strong>{pf.newCalls} yeni çağrı</strong>
            {pf.quota && <> · {pf.quota.provider} bugün {pf.quota.used}/{pf.quota.limit}</>}
          </p>
        )}
        <p className="row">
          {(!pf || pf.fits) && (
            <button onClick={() => generate()} disabled={!script || genState.busy}>
              <Icon name="play" /> {genState.busy ? 'Üretiliyor…' : 'Üret'}
            </button>
          )}
          {pf && !pf.fits && pf.quota && (
            <>
              <button onClick={() => generate(pf.quota!.remaining)} disabled={genState.busy || pf.quota.remaining < 1}>
                <Icon name="play" /> İlk {pf.quota.remaining}’i üret
              </button>
              <button className="ghost" onClick={() => generate()} disabled={genState.busy}>Yine de hepsini dene</button>
            </>
          )}
          {genState.busy && <Eq />}
          {genState.busy && <span className="muted">{genState.done}/{genState.total} segment</span>}
        </p>
        {genState.total > 0 && (genState.busy || genState.paused) && <progress value={genState.done} max={genState.total} />}
        {genState.paused && (
          <p className="row">
            <span className="badge generating">duraklatıldı</span>
            <span className="muted">
              {genState.paused.reason === 'quota' ? 'Günlük kota doldu' : 'Çağrı tavanına ulaşıldı'} — {genState.done}/{genState.total} üretildi, kalanlar kuyrukta.
            </span>
            <button className="ghost" onClick={() => resume(genState.paused!.jobId)}>Devam et</button>
          </p>
        )}
        {genState.err && <p className="err">{genState.err}</p>}
        {renders.map((r) => (
          <p key={r.id} className="player">
            <audio controls src={`/api/audio/${r.path}`} />
            <span className="muted">{r.durationSec ? `${r.durationSec.toFixed(1)} sn` : ''} · {new Date(r.createdAt).toLocaleString('tr-TR')}</span>
          </p>
        ))}
      </div>

      {segments.length > 0 && (
        <div className="card">
          <h2><Icon name="speaker" /> Segmentler <span className="muted">{segments.length}</span></h2>
          <table>
            <thead><tr><th>#</th><th>Konuşan</th><th>Stil</th><th>Metin</th><th>Durum</th></tr></thead>
            <tbody>
              {segments.map((s) => (
                <tr key={s.id}>
                  <td className="mono">{s.idx + 1}</td>
                  <td>{s.speaker}</td>
                  <td className="muted">{s.style ?? ''}</td>
                  <td className="mono">{s.text.length > 80 ? s.text.slice(0, 80) + '…' : s.text}</td>
                  <td>
                    <span className="row" style={{ gap: '0.3rem', flexWrap: 'nowrap' }}>
                      <span className={`badge ${s.status}`}>{s.status}</span>
                      {s.audioPath && (
                        <button className="icon" onClick={() => setPlayingSeg(playingSeg === s.id ? null : s.id)} aria-label="Segmenti dinle" title="Segmenti dinle"><Icon name="play" size={13} /></button>
                      )}
                      <button className="icon" onClick={() => regenerate(s.id)} disabled={genState.busy || annState.busy || regenBusy !== null} aria-label="Yeniden üret (1 çağrı)" title="Yeniden üret (1 çağrı)">
                        {regenBusy === s.id ? <Icon name="spinner" size={13} /> : <Icon name="wave" size={13} />}
                      </button>
                    </span>
                    {s.error && <div className="err">{s.error}</div>}
                    {playingSeg === s.id && s.audioPath && <div><audio controls autoPlay src={`/api/audio/${s.audioPath}`} style={{ height: 28, maxWidth: '14rem' }} /></div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
