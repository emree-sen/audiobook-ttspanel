'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from './Icon';

type Chapter = { id: string; title: string; position: number; status: string };
type Node = { project: { id: string; title: string }; chapters: Chapter[] };

// Sol panel: proje klasörleri → bölüm satırları. Navigasyon odaklı; yönetim sayfalarda.
export function Sidebar() {
  const pathname = usePathname();
  const [tree, setTree] = useState<Node[] | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [drawer, setDrawer] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/tree');
    if (res.ok) setTree(await res.json());
  }, []);

  useEffect(() => { load(); }, [load, pathname]);
  useEffect(() => {
    const h = () => load();
    window.addEventListener('wnt:refresh', h);
    return () => window.removeEventListener('wnt:refresh', h);
  }, [load]);
  useEffect(() => { setDrawer(false); }, [pathname]); // rota değişince drawer kapanır

  const chapterId = /^\/chapters\/([^/]+)/.exec(pathname)?.[1];

  // Aktif bölümün/projenin klasörünü otomatik aç
  useEffect(() => {
    if (!tree) return;
    const projFromUrl = /^\/projects\/([^/]+)/.exec(pathname)?.[1];
    const active = chapterId ? tree.find((n) => n.chapters.some((c) => c.id === chapterId))?.project.id : projFromUrl;
    if (active) setOpen((s) => (s.has(active) ? s : new Set(s).add(active)));
  }, [tree, pathname, chapterId]);

  if (pathname === '/login') return null;

  function toggle(id: string) {
    setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  return (
    <>
      <button className="side-toggle" onClick={() => setDrawer((d) => !d)} aria-label="Kütüphane menüsü" title="Kütüphane">
        <Icon name="menu" />
      </button>
      {drawer && <div className="side-scrim" onClick={() => setDrawer(false)} />}
      <div className={drawer ? 'side-wrap open' : 'side-wrap'}>
        <nav className="side" aria-label="Kütüphane">
          {tree === null && <p className="muted">Yükleniyor…</p>}
          {tree?.map(({ project, chapters }) => (
            <div key={project.id} className="side-proj">
              <button className="side-head" onClick={() => toggle(project.id)} aria-expanded={open.has(project.id)}>
                <Icon name="chev" size={12} className="chev" />
                <Icon name="folder" size={14} />
                <span className="t">{project.title}</span>
                <span className="muted">{chapters.length}</span>
              </button>
              {open.has(project.id) && (
                <div className="side-list">
                  {chapters.map((c) => (
                    <Link key={c.id} href={`/chapters/${c.id}`} className={c.id === chapterId ? 'side-item on' : 'side-item'}>
                      <span className="pos">{c.position}</span>
                      <span className="t">{c.title}</span>
                      <span className={`dot ${c.status}`} title={c.status} />
                    </Link>
                  ))}
                  <Link href={`/projects/${project.id}`} className="side-item manage"><Icon name="pencil" size={12} /> Yönet</Link>
                </div>
              )}
            </div>
          ))}
          {tree !== null && <Link href="/" className="side-item manage"><Icon name="plus" size={12} /> Yeni proje</Link>}
        </nav>
      </div>
    </>
  );
}
