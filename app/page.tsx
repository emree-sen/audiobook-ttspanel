'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

type Project = { id: string; title: string; description: string | null };

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
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
    if (!confirm('Proje ve tüm bölümleri silinecek. Emin misin?')) return;
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
      <h1>Projeler</h1>
      <form onSubmit={create} className="row">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Yeni proje adı" />
        <button type="submit">Ekle</button>
      </form>
      {projects.map((p) => (
        <div key={p.id} className="card row" style={{ justifyContent: 'space-between' }}>
          <Link href={`/projects/${p.id}`}><strong>{p.title}</strong></Link>
          <span className="row">
            <button className="ghost" onClick={() => rename(p)}>Yeniden adlandır</button>
            <button className="danger" onClick={() => remove(p.id)}>Sil</button>
          </span>
        </div>
      ))}
      {projects.length === 0 && <p className="muted">Henüz proje yok. Yukarıdan ekle.</p>}
    </>
  );
}
