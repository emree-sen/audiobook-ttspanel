'use client';
import { usePathname } from 'next/navigation';
import { Icon } from '../Icon';
import { RATES, usePlayer } from './PlayerProvider';

function fmt(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

export function PlayerBar() {
  const pathname = usePathname();
  const { track, playing, position, duration, rate, toggle, seekBy, seekTo, setRate, next, hasNext } = usePlayer();
  if (!track || pathname === '/login') return null;

  return (
    <div className="playerbar" role="region" aria-label="Oynatıcı">
      <div className="pb-info">
        <span className="t">{track.title}</span>
        <span className="muted">{track.seriesTitle}</span>
      </div>
      <div className="pb-controls">
        <button className="icon" onClick={() => seekBy(-15)} aria-label="15 saniye geri"><Icon name="back15" size={20} /></button>
        <button className="icon pb-play" onClick={toggle} aria-label={playing ? 'Duraklat' : 'Çal'}>
          <Icon name={playing ? 'pause' : 'play'} size={22} />
        </button>
        <button className="icon" onClick={() => seekBy(30)} aria-label="30 saniye ileri"><Icon name="fwd30" size={20} /></button>
        <button className="icon" onClick={next} disabled={!hasNext} aria-label="Sonraki bölüm"><Icon name="next" size={18} /></button>
      </div>
      <div className="pb-seek">
        <span className="mono muted">{fmt(position)}</span>
        <input
          type="range" min={0} max={Math.max(duration, 1)} step={1} value={Math.min(position, duration || position)}
          onChange={(e) => seekTo(Number(e.target.value))} aria-label="İlerleme"
        />
        <span className="mono muted">{fmt(duration)}</span>
      </div>
      <select className="pb-rate" value={rate} onChange={(e) => setRate(Number(e.target.value))} aria-label="Oynatma hızı">
        {RATES.map((r) => <option key={r} value={r}>{r}x</option>)}
      </select>
    </div>
  );
}
