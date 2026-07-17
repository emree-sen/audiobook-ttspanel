'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { VOICE_POOL } from '@/lib/voices-pool';
import { Icon } from '@/lib/ui/Icon';
import { EmptyState } from '@/lib/ui/EmptyState';

type Chapter = { id: string; projectId: string; title: string; rawText: string; narrationStyle: string | null; voiceMode: string; maxCharacters: number; status: string };
type Segment = { id: string; idx: number; speaker: string; style: string | null; text: string; status: string; error: string | null };
type Render = { id: string; path: string; durationSec: number | null; createdAt: number };
type CastMember = { character_id: string; display_name: string; voice_id: string; base_style?: string };
type ScriptInfo = { id: string; version: number; segmentCount: number; source: string; usage: { inputTokens: number; outputTokens: number; chunks: number } | null };
type Detail = { chapter: Chapter; script: ScriptInfo | null; cast: CastMember[]; segments: Segment[]; renders: Render[] };

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
  const [genState, setGenState] = useState<{ busy: boolean; done: number; total: number; err: string }>({ busy: false, done: 0, total: 0, err: '' });

  async function load() {
    const res = await fetch(`/api/chapters/${id}`);
    if (!res.ok) return;
    const d: Detail = await res.json();
    setDetail(d);
    setRawText(d.chapter.rawText);
    setNarrationStyle(d.chapter.narrationStyle ?? '');
    setVoiceMode(d.chapter.voiceMode);
    setMaxCharacters(d.chapter.maxCharacters);
  }
  useEffect(() => { load(); }, [id]);

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
      load();
    }
  }

  async function changeVoice(characterId: string, voiceId: string) {
    const res = await fetch(`/api/chapters/${id}/cast-voice`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ characterId, voiceId }),
    });
    if (!res.ok) setScriptErr((await res.json()).error ?? 'Ses değiştirilemedi');
    load();
  }

  async function saveScript() {
    setScriptErr('');
    const res = await fetch(`/api/chapters/${id}/script`, { method: 'PUT', body: scriptJson });
    if (res.ok) { setScriptJson(''); load(); }
    else setScriptErr((await res.json()).error ?? 'Script kaydedilemedi');
  }

  async function generate() {
    setGenState({ busy: true, done: 0, total: detail?.script?.segmentCount ?? 0, err: '' });
    try {
      await streamSse(`/api/chapters/${id}/generate`, {}, (ev, data) => {
        if (ev === 'progress') setGenState((s) => ({ ...s, done: data.done, total: data.total }));
        if (ev === 'error') setGenState((s) => ({ ...s, err: data.message }));
      });
    } catch (e) {
      setGenState((s) => ({ ...s, err: e instanceof Error ? e.message : 'Bağlantı hatası' }));
    } finally {
      setGenState((s) => ({ ...s, busy: false }));
      load();
    }
  }

  if (!detail) return <p className="muted">Yükleniyor…</p>;
  const { chapter, script, cast, segments, renders } = detail;
  const voiceOptions = (current: string) =>
    VOICE_POOL.some((v) => v.voiceId === current) ? VOICE_POOL : [{ voiceId: current, gender: 'male' as const, tone: 'mevcut' }, ...VOICE_POOL];

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
        <p className="row">
          <button onClick={generate} disabled={!script || genState.busy}>
            <Icon name="play" /> {genState.busy ? 'Üretiliyor…' : 'Üret'}
          </button>
          {genState.busy && <Eq />}
          {genState.busy && <span className="muted">{genState.done}/{genState.total} segment</span>}
        </p>
        {genState.total > 0 && <progress value={genState.done} max={genState.total} />}
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
                  <td><span className={`badge ${s.status}`}>{s.status}</span>{s.error && <div className="err">{s.error}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
