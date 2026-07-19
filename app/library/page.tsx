'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/lib/ui/Icon';
import { EmptyState } from '@/lib/ui/EmptyState';
import { usePlayer, type PlayerTrack } from '@/lib/ui/player/PlayerProvider';
import { audioUrl, downloadChapter, downloadedSet, removeDownload, storageEstimateText } from '@/lib/ui/player/offline';

type LibChapter = { id: string; title: string; position: number; status: string; renderPath: string | null; durationSec: number | null; progressSec: number | null; progressUpdatedAt: number };
type LibSeries = { project: { id: string; title: string }; chapters: LibChapter[] };

function fmt(s: number | null): string {
  if (s == null || !Number.isFinite(s)) return '';
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

const toTrack = (seriesTitle: string, c: LibChapter): PlayerTrack => ({
  chapterId: c.id, title: c.title, seriesTitle,
  src: audioUrl(c.renderPath!), durationSec: c.durationSec, progressSec: c.progressSec,
});

export default function LibraryPage() {
  const [lib, setLib] = useState<LibSeries[] | null>(null);
  const [err, setErr] = useState('');
  const [dl, setDl] = useState<Set<string>>(new Set());
  const [dlBusy, setDlBusy] = useState<string | null>(null);
  const [space, setSpace] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const { track, playing, playChapter, toggle } = usePlayer();

  // Offline'dayken yalnız indirilenler oynatılabilir işaretlenir (spec §5).
  useEffect(() => {
    setOffline(!navigator.onLine);
    const on = () => setOffline(false), off = () => setOffline(true);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/library');
      if (!res.ok) { setErr((await res.json().catch(() => ({}))).error ?? 'Kütüphane yüklenemedi'); setLib([]); return; }
      setLib(await res.json());
    } catch { setErr('Bağlantı yok — indirilenler dışında içerik kullanılamaz'); setLib([]); }
    setDl(await downloadedSet());
    setSpace(await storageEstimateText());
  }, []);
  useEffect(() => { load(); }, [load]);

  async function toggleDownload(c: LibChapter) {
    if (!c.renderPath) return;
    setDlBusy(c.id); setErr('');
    try {
      if (dl.has(c.renderPath)) await removeDownload(c.renderPath);
      else if (!(await downloadChapter(c.renderPath))) setErr('İndirilemedi — bağlantıyı kontrol et');
      setDl(await downloadedSet());
      setSpace(await storageEstimateText());
    } finally { setDlBusy(null); }
  }

  if (lib === null) return <p className="muted">Yükleniyor…</p>;

  // "Devam et": en son dinlenen, bitmemiş bölüm.
  const all = lib.flatMap((s) => s.chapters.filter((c) => c.renderPath).map((c) => ({ s, c })));
  const cont = all
    .filter(({ c }) => c.progressSec != null && c.durationSec != null && c.progressSec < c.durationSec - 5)
    .sort((a, b) => b.c.progressUpdatedAt - a.c.progressUpdatedAt)[0];
  const queueOf = (s: LibSeries) => s.chapters.filter((c) => c.renderPath).map((c) => toTrack(s.project.title, c));

  return (
    <>
      <div className="crumbs"><span className="here">Kütüphane</span></div>
      <h1>Kütüphane {space && <span className="muted" style={{ fontSize: '0.8rem' }}>indirilenler: {space}</span>}</h1>
      {err && <p className="muted" role="alert"><Icon name="warn" size={14} /> {err}</p>}

      {cont && (
        <div className="card continue">
          <h2><Icon name="headphones" /> Devam et</h2>
          <p className="row">
            <button onClick={() => playChapter(toTrack(cont.s.project.title, cont.c), queueOf(cont.s))}>
              <Icon name="play" /> {cont.c.title}
            </button>
            <span className="muted">{cont.s.project.title} · {fmt(cont.c.progressSec)} / {fmt(cont.c.durationSec)}</span>
          </p>
        </div>
      )}

      {lib.length === 0 && !err && (
        <EmptyState icon="headphones" title="Henüz dinlenecek bölüm yok">Bir bölümü üretip birleştirdiğinde burada görünür.</EmptyState>
      )}

      {lib.map((s) => (
        <div key={s.project.id} className="card">
          <h2><Icon name="folder" /> {s.project.title}</h2>
          <div className="rows">
            {s.chapters.map((c) => {
              const playable = !!c.renderPath && (!offline || dl.has(c.renderPath));
              const isCurrent = track?.chapterId === c.id;
              const pct = c.progressSec != null && c.durationSec ? Math.min(100, Math.round((c.progressSec / c.durationSec) * 100)) : null;
              return (
                <div key={c.id} className={playable ? 'rowitem' : 'rowitem muted'}>
                  <span className="pos mono">{c.position}</span>
                  {playable ? (
                    <button className="icon" onClick={() => (isCurrent ? toggle() : playChapter(toTrack(s.project.title, c), queueOf(s)))}
                      aria-label={isCurrent && playing ? 'Duraklat' : 'Çal'}>
                      <Icon name={isCurrent && playing ? 'pause' : 'play'} size={15} />
                    </button>
                  ) : (
                    <span title={c.status === 'voiced' ? 'Önce Birleştir' : 'Çevrimdışı — indirilmedi'}><Icon name="warn" size={13} /></span>
                  )}
                  <span className="t">{c.title}</span>
                  {playable ? (
                    <>
                      <span className="muted mono">{pct != null ? `%${pct}` : ''} {fmt(c.durationSec)}</span>
                      <button className="icon" onClick={() => toggleDownload(c)} disabled={dlBusy !== null}
                        aria-label={dl.has(c.renderPath!) ? 'İndirileni sil' : 'Offline için indir'}
                        title={dl.has(c.renderPath!) ? 'İndirildi — silmek için tıkla' : 'Offline için indir'}>
                        {dlBusy === c.id ? <Icon name="spinner" size={14} /> : <Icon name={dl.has(c.renderPath!) ? 'check' : 'download'} size={14} />}
                      </button>
                    </>
                  ) : c.status === 'voiced' ? (
                    <Link className="muted" href={`/chapters/${c.id}`}>Birleştir bekliyor →</Link>
                  ) : (
                    <span className="muted">çevrimdışı — indirilmedi</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}
