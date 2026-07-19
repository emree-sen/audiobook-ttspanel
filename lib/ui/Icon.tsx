import type { ReactElement } from 'react';

export type IconName =
  | 'play' | 'trash' | 'pencil' | 'up' | 'down' | 'plus'
  | 'person' | 'doc' | 'wave' | 'speaker' | 'warn' | 'logout' | 'spinner'
  | 'chev' | 'menu' | 'folder' | 'gear'
  | 'pause' | 'next' | 'back15' | 'fwd30' | 'download' | 'check' | 'headphones';

// Saf inline SVG ikon seti — bağımlılık yok; stroke tabanlı, currentColor.
const paths: Record<IconName, ReactElement> = {
  play: <path d="M5.5 3.5l8 4.5-8 4.5z" fill="currentColor" stroke="none" />,
  trash: <><path d="M2.5 4.5h11" /><path d="M6.5 4.5V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.5" /><path d="M4 4.5l.7 8.6a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9l.7-8.6" /></>,
  pencil: <><path d="M11.3 2.2l2.5 2.5L5.5 13H3v-2.5z" /><path d="M9.8 3.7l2.5 2.5" /></>,
  up: <path d="M8 12.5v-9M4.5 7 8 3.5 11.5 7" />,
  down: <path d="M8 3.5v9M4.5 9 8 12.5 11.5 9" />,
  plus: <path d="M8 3v10M3 8h10" />,
  person: <><circle cx="8" cy="5" r="2.6" /><path d="M2.8 13.5a5.2 5.2 0 0 1 10.4 0" /></>,
  doc: <><path d="M4 1.8h5.2L12.5 5v9.2H4z" /><path d="M9 2v3h3" /></>,
  wave: <path d="M2 6v4M5 4v8M8 2v12M11 5v6M14 6.5v3" />,
  speaker: <><path d="M2.5 6v4h2.8L9 13V3L5.3 6z" /><path d="M11 5.5a3.5 3.5 0 0 1 0 5" /></>,
  warn: <><path d="M8 1.8 15 13.8H1z" /><path d="M8 6v4M8 11.8v.4" /></>,
  logout: <><path d="M6 2.5H3.5v11H6" /><path d="M10 5l3 3-3 3M13 8H7" /></>,
  spinner: <path d="M8 1.5a6.5 6.5 0 1 1-6.5 6.5" />,
  chev: <path d="M6 3.5 10.5 8 6 12.5" />,
  menu: <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />,
  folder: <path d="M1.8 4.5a1 1 0 0 1 1-1h3.4l1.5 1.6h5.5a1 1 0 0 1 1 1v6.4a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1z" />,
  gear: <><circle cx="8" cy="8" r="2.4" /><path d="M8 1.6v2.2M8 12.2v2.2M1.6 8h2.2M12.2 8h2.2M3.5 3.5l1.5 1.5M11 11l1.5 1.5M12.5 3.5 11 5M5 11l-1.5 1.5" /></>,
  pause: <path d="M5 3v10M11 3v10" strokeWidth="2.4" />,
  next: <><path d="M4 3.5 10 8l-6 4.5z" fill="currentColor" stroke="none" /><path d="M12 3.5v9" strokeWidth="2" /></>,
  back15: <><path d="M8 2.8A5.2 5.2 0 1 1 2.8 8" /><path d="M8 0.8 5.4 2.8 8 4.8" fill="currentColor" stroke="none" /><text x="8.2" y="11" fontSize="6.2" fill="currentColor" stroke="none" textAnchor="middle" fontFamily="inherit">15</text></>,
  fwd30: <><path d="M8 2.8A5.2 5.2 0 1 0 13.2 8" /><path d="M8 0.8 10.6 2.8 8 4.8" fill="currentColor" stroke="none" /><text x="7.8" y="11" fontSize="6.2" fill="currentColor" stroke="none" textAnchor="middle" fontFamily="inherit">30</text></>,
  download: <><path d="M8 2.5v7M4.8 6.5 8 9.7l3.2-3.2" /><path d="M2.8 12.5h10.4" /></>,
  check: <path d="M2.8 8.6 6.4 12 13.2 4.4" />,
  headphones: <><path d="M2.5 9.5a5.5 5.5 0 0 1 11 0" /><rect x="1.8" y="9" width="3" height="4.5" rx="1.2" /><rect x="11.2" y="9" width="3" height="4.5" rx="1.2" /></>,
};

export function Icon({ name, size = 16, label, className }: { name: IconName; size?: number; label?: string; className?: string }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 16 16"
      fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden={label ? undefined : true} aria-label={label} role={label ? 'img' : undefined}
      className={[name === 'spinner' ? 'spin' : '', className ?? ''].filter(Boolean).join(' ') || undefined}
    >
      {paths[name]}
    </svg>
  );
}
