'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

type Chapter = { id: string; title: string; position: number; status: string };
type Detail = { project: { id: string; title: string }; chapters: Chapter[] };

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [title, setTitle] = useState('');

  async function load() {
    const res = await fetch(`/api/projects/${id}`);
    if (res.ok) setDetail(await res.json());
  }
  useEffect(() => { load(); }, [id]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    await fetch(`/api/projects/${id}/chapters`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) });
    setTitle(''); load();
  }

  async function remove(chapterId: string) {
    if (!confirm('Bölüm silinecek. Emin misin?')) return;
    await fetch(`/api/chapters/${chapterId}`, { method: 'DELETE' }); load();
  }

  async function move(idx: number, dir: -1 | 1) {
    const list = detail!.chapters;
    const a = list[idx], b = list[idx + dir];
    if (!b) return;
    await Promise.all([
      fetch(`/api/chapters/${a.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ position: b.position }) }),
      fetch(`/api/chapters/${b.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ position: a.position }) }),
    ]);
    load();
  }

  if (!detail) return <p className="muted">Yükleniyor…</p>;
  return (
    <>
      <p><Link href="/">← Projeler</Link></p>
      <h1>{detail.project.title}</h1>
      <form onSubmit={create} className="row">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Yeni bölüm adı" />
        <button type="submit">Ekle</button>
      </form>
      {detail.chapters.map((c, i) => (
        <div key={c.id} className="card row" style={{ justifyContent: 'space-between' }}>
          <Link href={`/chapters/${c.id}`}><strong>{c.position}. {c.title}</strong></Link>
          <span className="row">
            <button className="ghost" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
            <button className="ghost" onClick={() => move(i, 1)} disabled={i === detail.chapters.length - 1}>↓</button>
            <span className={`badge ${c.status}`}>{c.status}</span>
            <button className="danger" onClick={() => remove(c.id)}>Sil</button>
          </span>
        </div>
      ))}
      {detail.chapters.length === 0 && <p className="muted">Henüz bölüm yok.</p>}
    </>
  );
}
