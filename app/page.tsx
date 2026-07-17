'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/lib/ui/Icon';
import { ConfirmButton } from '@/lib/ui/ConfirmButton';
import { EmptyState } from '@/lib/ui/EmptyState';

type Project = { id: string; title: string; description: string | null; updatedAt: number };

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [title, setTitle] = useState('');

  async function load() { setProjects(await (await fetch('/api/projects')).json()); }
  useEffect(() => { load(); }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) });
    setTitle(''); load();
  }

  async function remove(id: string) {
    await fetch(`/api/projects/${id}`, { method: 'DELETE' }); load();
  }

  async function rename(p: Project) {
    const title = prompt('Yeni proje adı:', p.title);
    if (!title?.trim() || title === p.title) return;
    await fetch(`/api/projects/${p.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: title.trim() }) });
    load();
  }

  return (
    <>
      <div className="crumbs"><span className="here">Projeler</span></div>
      <h1>Projeler</h1>
      <form onSubmit={create} className="row">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Yeni proje adı" style={{ maxWidth: '20rem' }} />
        <button type="submit"><Icon name="plus" /> Ekle</button>
      </form>

      {projects === null && <p className="muted">Yükleniyor…</p>}

      {projects && projects.length > 0 && (
        <div className="grid">
          {projects.map((p) => (
            <div key={p.id} className="tile">
              <Link href={`/projects/${p.id}`} className="title">{p.title}</Link>
              <div className="sub">{new Date(p.updatedAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
              <div className="actions">
                <button className="icon" onClick={() => rename(p)} aria-label="Yeniden adlandır" title="Yeniden adlandır"><Icon name="pencil" /></button>
                <ConfirmButton onConfirm={() => remove(p.id)} ariaLabel="Projeyi sil" />
              </div>
            </div>
          ))}
        </div>
      )}

      {projects && projects.length === 0 && (
        <EmptyState icon="doc" title="Henüz proje yok">İlk projeni yukarıdaki alandan ekle.</EmptyState>
      )}
    </>
  );
}
