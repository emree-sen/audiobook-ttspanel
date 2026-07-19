'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

export type PlayerTrack = {
  chapterId: string; title: string; seriesTitle: string;
  src: string; durationSec: number | null; progressSec: number | null;
};

type PlayerCtx = {
  track: PlayerTrack | null; playing: boolean; position: number; duration: number; rate: number;
  playChapter: (t: PlayerTrack, queue?: PlayerTrack[]) => void;
  toggle: () => void; seekBy: (s: number) => void; seekTo: (s: number) => void;
  setRate: (r: number) => void; next: () => void; prev: () => void; hasNext: boolean; hasPrev: boolean;
};

const Ctx = createContext<PlayerCtx | null>(null);
export function usePlayer(): PlayerCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePlayer, PlayerProvider içinde kullanılmalı');
  return v;
}

export const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<PlayerTrack[]>([]);
  const trackRef = useRef<PlayerTrack | null>(null); // callback'ler için güncel parça (bayat closure önlemi)
  const [track, setTrack] = useState<PlayerTrack | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRateState] = useState(1);

  // Tek <audio> elemanı — rota değişse de yaşar.
  function audio(): HTMLAudioElement {
    if (!audioRef.current) {
      const el = new Audio();
      el.preload = 'metadata';
      audioRef.current = el;
    }
    return audioRef.current;
  }

  const saveProgress = useCallback((chapterId: string, pos: number, dur: number) => {
    // Ağ hatası sessizce yutulur — dinleme kesilmez; keepalive: sekme kapanırken de gitsin.
    fetch(`/api/progress/${chapterId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, keepalive: true,
      body: JSON.stringify({ positionSec: Math.floor(pos * 10) / 10, ...(dur > 0 ? { durationSec: Math.floor(dur * 10) / 10 } : {}) }),
    }).catch(() => {});
  }, []);

  // idx her zaman trackRef üzerinden okur — next/prev callback'leri track state'ine bağımlı olmadan güncel kalır.
  const idx = () => queueRef.current.findIndex((q) => q.chapterId === trackRef.current?.chapterId);
  const curIdx = queueRef.current.findIndex((q) => q.chapterId === track?.chapterId);
  const hasNext = track != null && curIdx >= 0 && curIdx < queueRef.current.length - 1;
  const hasPrev = track != null && curIdx > 0;

  const start = useCallback((t: PlayerTrack) => {
    const el = audio();
    trackRef.current = t;
    setTrack(t);
    el.src = t.src;
    // Resume: kalınan yerden; bitmişse baştan.
    const startAt = t.progressSec != null && t.durationSec != null && t.progressSec < t.durationSec - 5 ? t.progressSec : 0;
    el.currentTime = startAt;
    setPosition(startAt);
    el.playbackRate = rate;
    void el.play().catch(() => setPlaying(false));
  }, [rate]);

  const playChapter = useCallback((t: PlayerTrack, queue?: PlayerTrack[]) => {
    if (queue) queueRef.current = queue;
    else if (!queueRef.current.some((q) => q.chapterId === t.chapterId)) queueRef.current = [t];
    start(t);
  }, [start]);

  const next = useCallback(() => {
    const i = idx();
    if (i >= 0 && i < queueRef.current.length - 1) start(queueRef.current[i + 1]);
  }, [start]); // eslint-disable-line react-hooks/exhaustive-deps

  const prev = useCallback(() => {
    const i = idx();
    if (i > 0) start(queueRef.current[i - 1]);
  }, [start]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hız: localStorage'dan yükle / değişince yaz + uygula.
  useEffect(() => {
    const saved = Number(localStorage.getItem('wnt:rate'));
    if (RATES.includes(saved)) setRateState(saved);
  }, []);
  const setRate = useCallback((r: number) => {
    setRateState(r);
    localStorage.setItem('wnt:rate', String(r));
    if (audioRef.current) audioRef.current.playbackRate = r;
  }, []);

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el || !track) return;
    if (el.paused) void el.play().catch(() => {});
    else el.pause();
  }, [track]);

  const seekTo = useCallback((s: number) => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(s, el.duration || s));
  }, []);
  const seekBy = useCallback((s: number) => {
    const el = audioRef.current;
    if (el) seekTo(el.currentTime + s);
  }, [seekTo]);

  // Audio olayları + periyodik ilerleme kaydı.
  useEffect(() => {
    const el = audio();
    const onTime = () => setPosition(el.currentTime);
    const onDur = () => setDuration(el.duration || 0);
    const onPlay = () => setPlaying(true);
    // Not: track state'i değil trackRef.current okunur — start() senkron olarak trackRef'i günceller,
    // ama tarayıcının native 'pause' olayı el.src atamasından hemen sonra, React bu efekti yeniden
    // çalıştırmadan ÖNCE tetiklenebilir. Kapanmış (bayat) track state'i kullanılırsa, yeni parçanın
    // el.currentTime'ı eski parçanın ilerlemesi olarak yanlışlıkla kaydedilir.
    const onPause = () => { setPlaying(false); const t = trackRef.current; if (t) saveProgress(t.chapterId, el.currentTime, el.duration || 0); };
    const onEnded = () => {
      setPlaying(false);
      const t = trackRef.current;
      if (t) saveProgress(t.chapterId, el.duration || el.currentTime, el.duration || 0);
      next();
    };
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('durationchange', onDur);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onEnded);
    const tick = setInterval(() => { const t = trackRef.current; if (t && !el.paused) saveProgress(t.chapterId, el.currentTime, el.duration || 0); }, 5000);
    const onHide = () => { const t = trackRef.current; if (document.visibilityState === 'hidden' && t) saveProgress(t.chapterId, el.currentTime, el.duration || 0); };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('durationchange', onDur);
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onEnded);
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [next, saveProgress]); // track kaldırıldı: gövde artık trackRef.current okuyor, state değişince yeniden kaydolmaya gerek yok

  // MediaSession: kilit ekranı metadata + kontroller.
  useEffect(() => {
    if (!('mediaSession' in navigator) || !track) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title, artist: track.seriesTitle, album: 'webnovel-tts',
      artwork: [{ src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
    });
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', toggle);
    ms.setActionHandler('pause', toggle);
    ms.setActionHandler('seekbackward', () => seekBy(-15));
    ms.setActionHandler('seekforward', () => seekBy(30));
    ms.setActionHandler('previoustrack', hasPrev ? prev : null);
    ms.setActionHandler('nexttrack', hasNext ? next : null);
    ms.setActionHandler('seekto', (d) => { if (d.seekTime != null) seekTo(d.seekTime); });
    return () => {
      for (const a of ['play', 'pause', 'seekbackward', 'seekforward', 'previoustrack', 'nexttrack', 'seekto'] as MediaSessionAction[])
        ms.setActionHandler(a, null);
    };
  }, [track, toggle, seekBy, seekTo, next, prev, hasNext, hasPrev]);

  useEffect(() => {
    if ('mediaSession' in navigator && duration > 0)
      navigator.mediaSession.setPositionState?.({ duration, position: Math.min(position, duration), playbackRate: rate });
  }, [position, duration, rate]);

  return (
    <Ctx.Provider value={{ track, playing, position, duration, rate, playChapter, toggle, seekBy, seekTo, setRate, next, prev, hasNext, hasPrev }}>
      {children}
    </Ctx.Provider>
  );
}
