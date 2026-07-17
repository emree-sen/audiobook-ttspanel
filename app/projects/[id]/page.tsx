'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Icon } from '@/lib/ui/Icon';
import { ConfirmButton } from '@/lib/ui/ConfirmButton';
import { EmptyState } from '@/lib/ui/EmptyState';

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
      <div className="crumbs">
        <Link href="/">Projeler</Link>
        <span className="sep">›</span>
        <span className="here">{detail.project.title}</span>
      </div>
      <h1>{detail.project.title}</h1>
      <form onSubmit={create} className="row">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Yeni bölüm adı" style={{ maxWidth: '20rem' }} />
        <button type="submit"><Icon name="plus" /> Ekle</button>
      </form>

      {detail.chapters.length > 0 && (
        <div className="rows">
          {detail.chapters.map((c, i) => (
            <div key={c.id} className="rowitem">
              <span className="pos">{c.position}</span>
              <Link href={`/chapters/${c.id}`} className="name">{c.title}</Link>
              <span className={`badge ${c.status}`}>{c.status}</span>
              <span className="tools">
                <button className="icon" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Yukarı taşı" title="Yukarı taşı"><Icon name="up" /></button>
                <button className="icon" onClick={() => move(i, 1)} disabled={i === detail.chapters.length - 1} aria-label="Aşağı taşı" title="Aşağı taşı"><Icon name="down" /></button>
                <ConfirmButton onConfirm={() => remove(c.id)} ariaLabel="Bölümü sil" />
              </span>
            </div>
          ))}
        </div>
      )}

      {detail.chapters.length === 0 && (
        <EmptyState icon="doc" title="Henüz bölüm yok">İlk bölümü yukarıdaki alandan ekle.</EmptyState>
      )}
    </>
  );
}
