'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

type Chapter = { id: string; projectId: string; title: string; rawText: string; narrationStyle: string | null; status: string };
type Segment = { id: string; idx: number; speaker: string; style: string | null; text: string; status: string; error: string | null };
type Render = { id: string; path: string; durationSec: number | null; createdAt: number };
type Detail = { chapter: Chapter; script: { id: string; version: number; segmentCount: number } | null; segments: Segment[]; renders: Render[] };

// POST + SSE: EventSource sadece GET desteklediği için fetch-stream ile okunur.
async function streamGenerate(chapterId: string, onEvent: (ev: string, data: any) => void) {
  const res = await fetch(`/api/chapters/${chapterId}/generate`, { method: 'POST' });
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

export default function ChapterPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [rawText, setRawText] = useState('');
  const [narrationStyle, setNarrationStyle] = useState('');
  const [scriptJson, setScriptJson] = useState('');
  const [scriptErr, setScriptErr] = useState('');
  const [genState, setGenState] = useState<{ busy: boolean; done: number; total: number; err: string }>({ busy: false, done: 0, total: 0, err: '' });

  async function load() {
    const res = await fetch(`/api/chapters/${id}`);
    if (!res.ok) return;
    const d: Detail = await res.json();
    setDetail(d);
    setRawText(d.chapter.rawText);
    setNarrationStyle(d.chapter.narrationStyle ?? '');
  }
  useEffect(() => { load(); }, [id]);

  async function saveText() {
    await fetch(`/api/chapters/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rawText, narrationStyle }) });
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
      await streamGenerate(id, (ev, data) => {
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
  const { chapter, script, segments, renders } = detail;

  return (
    <>
      <p><Link href={`/projects/${chapter.projectId}`}>← Bölümler</Link></p>
      <h1>{chapter.title} <span className={`badge ${chapter.status}`}>{chapter.status}</span></h1>

      <div className="card">
        <h2>Ham metin + anlatım tarzı</h2>
        <p><textarea value={rawText} onChange={(e) => setRawText(e.target.value)} placeholder="Bölümün ham metni (Dilim B'de LLM bunu script'e çevirecek)" /></p>
        <p><input value={narrationStyle} onChange={(e) => setNarrationStyle(e.target.value)} placeholder="Anlatım tarzı (ör. sakin, gizemli, üçüncü şahıs)" /></p>
        <button onClick={saveText}>Kaydet</button>
      </div>

      <div className="card">
        <h2>Seslendirme script’i {script && <span className="muted">(v{script.version}, {script.segmentCount} segment)</span>}</h2>
        <p><textarea value={scriptJson} onChange={(e) => setScriptJson(e.target.value)} placeholder='Claude’un ürettiği JSON script’i buraya yapıştır' /></p>
        {scriptErr && <p className="err">{scriptErr}</p>}
        <button onClick={saveScript} disabled={!scriptJson.trim()}>Script kaydet</button>
      </div>

      <div className="card">
        <h2>Üretim</h2>
        <p className="row">
          <button onClick={generate} disabled={!script || genState.busy}>{genState.busy ? 'Üretiliyor…' : 'Üret'}</button>
          {genState.busy && <span className="muted">{genState.done}/{genState.total} segment</span>}
        </p>
        {genState.total > 0 && <progress value={genState.done} max={genState.total} />}
        {genState.err && <p className="err">{genState.err}</p>}
        {renders.map((r) => (
          <p key={r.id} className="row">
            <audio controls src={`/api/audio/${r.path}`} />
            <span className="muted">{r.durationSec ? `${r.durationSec.toFixed(1)} sn` : ''} · {new Date(r.createdAt).toLocaleString('tr-TR')}</span>
          </p>
        ))}
      </div>

      {segments.length > 0 && (
        <div className="card">
          <h2>Segmentler</h2>
          <table>
            <thead><tr><th>#</th><th>Konuşan</th><th>Stil</th><th>Metin</th><th>Durum</th></tr></thead>
            <tbody>
              {segments.map((s) => (
                <tr key={s.id}>
                  <td>{s.idx + 1}</td><td>{s.speaker}</td><td className="muted">{s.style ?? ''}</td>
                  <td>{s.text.length > 80 ? s.text.slice(0, 80) + '…' : s.text}</td>
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
