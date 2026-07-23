'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/lib/ui/Icon';
import { EmptyState } from '@/lib/ui/EmptyState';
import { usePlayer, type PlayerTrack } from '@/lib/ui/player/PlayerProvider';
import { audioUrl, downloadChapter, downloadedSet, removeDownload, storageEstimateText } from '@/lib/ui/player/offline';
import { useT } from '@/lib/ui/LanguageProvider';

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
  const t = useT();
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
      if (!res.ok) { setErr((await res.json().catch(() => ({}))).error ?? t('library.loadError')); setLib([]); return; }
      setLib(await res.json());
    } catch { setErr(t('library.offlineError')); setLib([]); }
    setDl(await downloadedSet());
    setSpace(await storageEstimateText());
  }, [t]);
  useEffect(() => { load(); }, [load]);

  async function toggleDownload(c: LibChapter) {
    if (!c.renderPath) return;
    setDlBusy(c.id); setErr('');
    try {
      if (dl.has(c.renderPath)) await removeDownload(c.renderPath);
      else if (!(await downloadChapter(c.renderPath))) setErr(t('library.downloadFailed'));
      setDl(await downloadedSet());
      setSpace(await storageEstimateText());
    } finally { setDlBusy(null); }
  }

  if (lib === null) return <p className="muted">{t('common.loading')}</p>;

  // "Devam et": en son dinlenen, bitmemiş bölüm.
  const all = lib.flatMap((s) => s.chapters.filter((c) => c.renderPath).map((c) => ({ s, c })));
  const cont = all
    .filter(({ c }) => c.progressSec != null && c.durationSec != null && c.progressSec < c.durationSec - 5)
    .sort((a, b) => b.c.progressUpdatedAt - a.c.progressUpdatedAt)[0];
  const queueOf = (s: LibSeries) => s.chapters.filter((c) => c.renderPath).map((c) => toTrack(s.project.title, c));

  return (
    <>
      <div className="crumbs"><span className="here">{t('sidebar.library')}</span></div>
      <h1>{t('sidebar.library')} {space && <span className="muted" style={{ fontSize: '0.8rem' }}>{t('library.downloadsLabel', { space })}</span>}</h1>
      {err && <p className="muted" role="alert"><Icon name="warn" size={14} /> {err}</p>}

      {cont && (() => {
        const contCurrent = track?.chapterId === cont.c.id;
        return (
          <div className="card continue">
            <h2><Icon name="headphones" /> {t('library.continue')}</h2>
            <p className="row">
              <button onClick={() => (contCurrent ? toggle() : playChapter(toTrack(cont.s.project.title, cont.c), queueOf(cont.s)))}>
                <Icon name={contCurrent && playing ? 'pause' : 'play'} /> {cont.c.title}
              </button>
              <span className="muted">{cont.s.project.title} · {fmt(cont.c.progressSec)} / {fmt(cont.c.durationSec)}</span>
            </p>
          </div>
        );
      })()}

      {lib.length === 0 && !err && (
        <EmptyState icon="headphones" title={t('library.emptyTitle')}>{t('library.emptyBody')}</EmptyState>
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
                      aria-label={isCurrent && playing ? t('common.pause') : t('common.play')}>
                      <Icon name={isCurrent && playing ? 'pause' : 'play'} size={15} />
                    </button>
                  ) : (
                    <span title={c.status === 'voiced' ? t('library.stitchFirst') : t('library.offlineNotDownloaded')}><Icon name="warn" size={13} /></span>
                  )}
                  <span className="name">{c.title}</span>
                  {isCurrent && playing && <span className="eq" aria-hidden="true"><span /><span /><span /><span /><span /></span>}
                  {playable ? (
                    <span className="tools">
                      <span className="muted mono">{pct != null ? `%${pct}` : ''} {fmt(c.durationSec)}</span>
                      <button className="icon" onClick={() => toggleDownload(c)} disabled={dlBusy !== null}
                        aria-label={dl.has(c.renderPath!) ? t('library.deleteDownload') : t('library.download')}
                        title={dl.has(c.renderPath!) ? t('library.downloadedTapToDelete') : t('library.download')}>
                        {dlBusy === c.id ? <Icon name="spinner" size={14} /> : <Icon name={dl.has(c.renderPath!) ? 'check' : 'download'} size={14} />}
                      </button>
                    </span>
                  ) : c.status === 'voiced' ? (
                    <span className="tools"><Link className="muted" href={`/chapters/${c.id}`}>{t('library.awaitingStitch')}</Link></span>
                  ) : (
                    <span className="tools"><span className="muted">{t('library.offlineNotDownloaded')}</span></span>
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
