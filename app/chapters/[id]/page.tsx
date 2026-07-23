'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Icon } from '@/lib/ui/Icon';
import { EmptyState } from '@/lib/ui/EmptyState';
import { refreshTree } from '@/lib/ui/refresh';
import { useLang, useT } from '@/lib/ui/LanguageProvider';

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
  const t = useT();
  const { lang } = useLang();
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
  type Preflight = { total: number; cached: number; newCalls: number; supportsStyle: boolean; styledSegments: number; providerMismatch: boolean; quota: { provider: string; used: number; limit: number; remaining: number } | null; fits: boolean };
  const [pf, setPf] = useState<Preflight | null>(null);
  const [genState, setGenState] = useState<{ busy: boolean; done: number; total: number; err: string; paused: { reason: string; jobId: string } | null }>({ busy: false, done: 0, total: 0, err: '', paused: null });
  const [playingSeg, setPlayingSeg] = useState<string | null>(null);
  const [regenBusy, setRegenBusy] = useState<string | null>(null);
  const [voicePool, setVoicePool] = useState<PoolVoice[]>([]);
  const [stitchBusy, setStitchBusy] = useState(false);
  const [editSeg, setEditSeg] = useState<{ id: string; text: string; style: string } | null>(null);
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
      setGenState({ busy: false, done: d.done, total: d.total, err: d.failedCount ? t('chapter.errSegmentsFailedCount', { n: d.failedCount }) : '', paused: null });
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
      setGenState((s) => ({ ...s, busy: false, err: d.message ?? t('chapter.errProductionFailed'), paused: null }));
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
      setAnnState((s) => ({ ...s, err: e instanceof Error ? e.message : t('chapter.connectionError') }));
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
    if (!res.ok) setScriptErr((await res.json()).error ?? t('chapter.errVoiceChangeFailed'));
    load(); loadPreflight();
  }

  async function saveScript() {
    setScriptErr('');
    const res = await fetch(`/api/chapters/${id}/script`, { method: 'PUT', body: scriptJson });
    if (res.ok) { setScriptJson(''); refreshTree(); load(); loadPreflight(); }
    else setScriptErr((await res.json()).error ?? t('chapter.errScriptSaveFailed'));
  }

  async function generate(limitCalls?: number) {
    setGenState({ busy: true, done: 0, total: pf?.total ?? 0, err: '', paused: null });
    const res = await fetch(`/api/chapters/${id}/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(limitCalls ? { limitCalls } : {}),
    });
    if (!res.ok) { const err = (await res.json()).error ?? t('chapter.errProduceFailed'); setGenState((s) => ({ ...s, busy: false, err })); return; }
    watchProgress();
  }

  async function resume(jobId: string) {
    const res = await fetch(`/api/jobs/${jobId}/resume`, { method: 'POST' });
    if (res.ok) watchProgress();
    else setGenState((s) => ({ ...s, err: t('chapter.errResumeFailed') }));
  }

  async function regenerate(segmentId: string) {
    setRegenBusy(segmentId);
    try {
      const res = await fetch(`/api/segments/${segmentId}/regenerate`, { method: 'POST' });
      if (!res.ok) { const err = (await res.json()).error ?? t('chapter.errSegmentRegenFailed'); setGenState((s) => ({ ...s, err })); }
      refreshTree(); load(); loadPreflight();
    } finally { setRegenBusy(null); }
  }

  async function stitch() {
    setStitchBusy(true);
    try {
      const res = await fetch(`/api/chapters/${id}/stitch`, { method: 'POST' });
      if (!res.ok) {
        const err = (await res.json()).error ?? t('chapter.errStitchFailed');
        setGenState((s) => ({ ...s, err }));
      }
      refreshTree(); load();
    } finally { setStitchBusy(false); }
  }

  async function loadScriptJson() {
    setScriptErr('');
    const res = await fetch(`/api/chapters/${id}/script`);
    if (res.ok) setScriptJson(JSON.stringify(await res.json(), null, 2));
    else setScriptErr(t('chapter.errScriptLoadFailed'));
  }

  async function saveSegmentEdit() {
    if (!editSeg) return;
    const res = await fetch(`/api/segments/${editSeg.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: editSeg.text, style: editSeg.style.trim() ? editSeg.style : null }),
    });
    if (!res.ok) {
      const err = (await res.json()).error ?? t('chapter.errSegmentSaveFailed');
      setGenState((s) => ({ ...s, err }));
    } else setEditSeg(null);
    refreshTree(); load(); loadPreflight();
  }

  if (!detail) return <p className="muted">{t('common.loading')}</p>;
  const { chapter, script, cast, segments, renders } = detail;
  // Havuz aktif sağlayıcıdan gelir; mevcut ses havuzda değilse (ör. sağlayıcı değişti) tek başına eklenir.
  const voiceOptions = (current: string) =>
    voicePool.some((v) => v.voiceId === current) ? voicePool : [{ voiceId: current, gender: '', tone: t('chapter.currentVoiceTone') }, ...voicePool];

  return (
    <>
      <div className="crumbs">
        <Link href="/">{t('home.title')}</Link>
        <span className="sep">›</span>
        <Link href={`/projects/${chapter.projectId}`}>{t('chapter.crumbChapters')}</Link>
        <span className="sep">›</span>
        <span className="here">{chapter.title}</span>
      </div>
      <h1>{chapter.title} <span className={`badge ${chapter.status}`}>{chapter.status}</span></h1>

      <div className="card">
        <h2><span className="stage">01</span> {t('chapter.stepText')} {annState.busy && <Icon name="spinner" />}</h2>
        <p><textarea value={rawText} onChange={(e) => setRawText(e.target.value)} placeholder={t('chapter.rawTextPlaceholder')} /></p>
        <p><input value={narrationStyle} onChange={(e) => setNarrationStyle(e.target.value)} placeholder={t('chapter.narrationStylePlaceholder')} /></p>
        <p className="row">
          <span className="seg" role="group" aria-label={t('chapter.voiceModeGroup')}>
            <button type="button" className={voiceMode === 'narrator' ? 'on' : ''} onClick={() => setVoiceMode('narrator')}>{t('chapter.voiceModeNarrator')}</button>
            <button type="button" className={voiceMode === 'multi' ? 'on' : ''} onClick={() => setVoiceMode('multi')}>{t('chapter.voiceModeMulti')}</button>
          </span>
          {voiceMode === 'multi' && (
            <label className="row">{t('chapter.maxCharactersLabel')}
              <input type="number" min={1} max={12} value={maxCharacters} onChange={(e) => setMaxCharacters(Number(e.target.value) || 6)} style={{ width: '4.5rem' }} />
            </label>
          )}
        </p>
        <p className="row">
          <button className="ghost" onClick={saveText}>{t('common.save')}</button>
          <button onClick={() => annotate(false)} disabled={annState.busy || !rawText.trim()}>
            <Icon name="wave" /> {annState.busy ? t('chapter.generating') : t('chapter.generateScript')}
          </button>
          {annState.busy && <Eq />}
          {annState.busy && annState.totalChunks > 0 && <span className="muted">{t('chapter.chunksProgress', { chunk: annState.chunk, totalChunks: annState.totalChunks })}</span>}
        </p>
        {annState.busy && annState.totalChunks > 1 && <progress value={annState.chunk} max={annState.totalChunks} />}
        {annState.err && <p className="err">{annState.err}</p>}
      </div>

      <div className="card">
        <h2>
          <span className="stage">02</span> {t('chapter.scriptStepTitle')}
          {script && (
            <span className="muted">
              v{script.version} · {t('chapter.scriptSegmentCount', { n: script.segmentCount })} · {script.source === 'llm' ? 'LLM' : t('chapter.scriptSourceManual')}
              {script.usage ? ` · ${t('chapter.usageTokens', { input: script.usage.inputTokens, output: script.usage.outputTokens })}` : ''}
            </span>
          )}
        </h2>

        {cast.length > 0 && (
          <table>
            <thead><tr><th>{t('chapter.castCharacter')}</th><th>{t('chapter.castTone')}</th><th>{t('chapter.castVoice')}</th></tr></thead>
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
            <input value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder={t('chapter.extraInstructionPlaceholder')} />
            <button className="ghost" onClick={() => annotate(true)} disabled={annState.busy}><Icon name="pencil" /> {t('chapter.regenerateScript')}</button>
          </p>
        )}

        {!script && !annState.busy && (
          <EmptyState icon="doc" title={t('chapter.noScriptTitle')}>{t('chapter.noScriptBody')}</EmptyState>
        )}

        <details>
          <summary>{t('chapter.scriptJsonSummary')}</summary>
          <p className="row">
            {script && <button className="ghost" onClick={loadScriptJson}><Icon name="doc" /> {t('chapter.fetchCurrentJson')}</button>}
          </p>
          <p><textarea value={scriptJson} onChange={(e) => setScriptJson(e.target.value)} placeholder={t('chapter.scriptJsonPlaceholder')} /></p>
          <button className="ghost" onClick={saveScript} disabled={!scriptJson.trim()}>{t('chapter.saveScript')}</button>
        </details>
        {scriptErr && <p className="err">{scriptErr}</p>}
      </div>

      <div className="card">
        <h2><span className="stage">03</span> {t('chapter.stepProduction')} {genState.busy && <Icon name="spinner" />}</h2>
        {pf && (
          <p className="muted">
            {t('chapter.preflightBase', { total: pf.total, cached: pf.cached })} · <strong>{t('chapter.preflightNewCalls', { n: pf.newCalls })}</strong>
            {pf.quota && <>{t('chapter.preflightQuota', { provider: pf.quota.provider, used: pf.quota.used, limit: pf.quota.limit })}</>}
          </p>
        )}
        {pf && !pf.supportsStyle && pf.styledSegments > 0 && (
          <p className="muted"><Icon name="warn" size={12} /> {t('chapter.noStyleSupport')}</p>
        )}
        {pf && pf.providerMismatch && (
          <p className="muted"><Icon name="warn" size={12} /> {t('chapter.providerMismatch')}</p>
        )}
        <p className="row">
          {(!pf || pf.fits) && (
            <button onClick={() => generate()} disabled={!script || genState.busy}>
              <Icon name="play" /> {genState.busy ? t('chapter.generating') : t('chapter.produce')}
            </button>
          )}
          {pf && !pf.fits && pf.quota && (
            <>
              <button onClick={() => generate(pf.quota!.remaining)} disabled={genState.busy || pf.quota.remaining < 1}>
                <Icon name="play" /> {t('chapter.produceFirstN', { n: pf.quota.remaining })}
              </button>
              <button className="ghost" onClick={() => generate()} disabled={genState.busy}>{t('chapter.tryAllAnyway')}</button>
            </>
          )}
          {genState.busy && <Eq />}
          {genState.busy && <span className="muted">{t('chapter.segmentsCountLabel', { done: genState.done, total: genState.total })}</span>}
        </p>
        {genState.total > 0 && (genState.busy || genState.paused) && <progress value={genState.done} max={genState.total} />}
        {genState.paused && (
          <p className="row">
            <span className="badge generating">{t('chapter.pausedBadge')}</span>
            <span className="muted">
              {genState.paused.reason === 'quota' ? t('chapter.pausedQuota') : t('chapter.pausedCallLimit')} — {t('chapter.pausedProgress', { done: genState.done, total: genState.total })}
            </span>
            <button className="ghost" onClick={() => resume(genState.paused!.jobId)}>{t('chapter.resume')}</button>
          </p>
        )}
        {genState.err && <p className="err">{genState.err}</p>}
        <p className="row">
          <button onClick={stitch} disabled={stitchBusy || genState.busy || annState.busy || regenBusy !== null || !['voiced', 'done'].includes(chapter.status)}>
            {stitchBusy ? <Icon name="spinner" /> : <Icon name="doc" />} {t('chapter.stitch')}
          </button>
          {chapter.status === 'voiced' && (
            <span className="muted">
              {renders.length > 0 ? t('chapter.stitchedStale') : t('chapter.stitchReady')}
            </span>
          )}
          {chapter.status === 'voiced' && segments.some((s) => s.status === 'failed') && (
            <span className="muted"><Icon name="warn" size={12} /> {t('chapter.stitchFailedSegments', { n: segments.filter((s) => s.status === 'failed').length })}</span>
          )}
        </p>
        {renders.map((r) => (
          <p key={r.id} className="player">
            <audio controls src={`/api/audio/${r.path}`} />
            <span className="muted">{r.durationSec ? t('chapter.durationLabel', { n: r.durationSec.toFixed(1) }) : ''} · {new Date(r.createdAt).toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-US')}</span>
          </p>
        ))}
      </div>

      {segments.length > 0 && (
        <div className="card">
          <h2><Icon name="speaker" /> {t('chapter.segmentsTitle')} <span className="muted">{segments.length}</span></h2>
          <table>
            <thead><tr><th>#</th><th>{t('chapter.tableSpeaker')}</th><th>{t('chapter.tableStyle')}</th><th>{t('chapter.tableText')}</th><th>{t('chapter.tableStatus')}</th></tr></thead>
            <tbody>
              {segments.map((s) => (
                <tr key={s.id}>
                  <td className="mono">{s.idx + 1}</td>
                  <td>{s.speaker}</td>
                  <td className="muted">{s.style ?? ''}</td>
                  <td className="mono">
                    {editSeg?.id === s.id ? (
                      <span className="rows">
                        <textarea value={editSeg.text} onChange={(e) => setEditSeg({ ...editSeg, text: e.target.value })} rows={3} />
                        <input value={editSeg.style} onChange={(e) => setEditSeg({ ...editSeg, style: e.target.value })} placeholder={t('chapter.styleEditPlaceholder')} />
                        <span className="row">
                          <button className="ghost" onClick={saveSegmentEdit} disabled={!editSeg.text.trim()}>{t('common.save')}</button>
                          <button className="ghost" onClick={() => setEditSeg(null)}>{t('common.cancel')}</button>
                        </span>
                      </span>
                    ) : (
                      s.text.length > 80 ? s.text.slice(0, 80) + '…' : s.text
                    )}
                  </td>
                  <td>
                    <span className="row" style={{ gap: '0.3rem', flexWrap: 'nowrap' }}>
                      <span className={`badge ${s.status}`}>{s.status}</span>
                      {s.audioPath && (
                        <button className="icon" onClick={() => setPlayingSeg(playingSeg === s.id ? null : s.id)} aria-label={t('chapter.playSegment')} title={t('chapter.playSegment')}><Icon name="play" size={13} /></button>
                      )}
                      <button className="icon" onClick={() => setEditSeg({ id: s.id, text: s.text, style: s.style ?? '' })} disabled={genState.busy || annState.busy || regenBusy !== null} aria-label={t('chapter.editSegment')} title={t('chapter.editSegment')}><Icon name="pencil" size={13} /></button>
                      <button className="icon" onClick={() => regenerate(s.id)} disabled={genState.busy || annState.busy || regenBusy !== null} aria-label={t('chapter.regenerateSegment')} title={t('chapter.regenerateSegment')}>
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
