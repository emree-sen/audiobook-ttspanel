'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/lib/ui/Icon';
import { ConfirmButton } from '@/lib/ui/ConfirmButton';
import { EmptyState } from '@/lib/ui/EmptyState';
import { refreshTree } from '@/lib/ui/refresh';
import { useLang, useT } from '@/lib/ui/LanguageProvider';

type Project = { id: string; title: string; description: string | null; updatedAt: number };

export default function ProjectsPage() {
  const t = useT();
  const { lang } = useLang();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [title, setTitle] = useState('');

  async function load() { setProjects(await (await fetch('/api/projects')).json()); }
  useEffect(() => { load(); }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) });
    setTitle(''); refreshTree(); load();
  }

  async function remove(id: string) {
    await fetch(`/api/projects/${id}`, { method: 'DELETE' }); refreshTree(); load();
  }

  async function rename(p: Project) {
    const title = prompt(t('home.renamePrompt'), p.title);
    if (!title?.trim() || title === p.title) return;
    await fetch(`/api/projects/${p.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: title.trim() }) });
    refreshTree(); load();
  }

  return (
    <>
      <div className="crumbs"><span className="here">{t('home.title')}</span></div>
      <h1>{t('home.title')}</h1>
      <form onSubmit={create} className="row">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('home.newProjectPlaceholder')} style={{ maxWidth: '20rem' }} />
        <button type="submit"><Icon name="plus" /> {t('common.add')}</button>
      </form>

      {projects === null && <p className="muted">{t('common.loading')}</p>}

      {projects && projects.length > 0 && (
        <div className="grid">
          {projects.map((p) => (
            <div key={p.id} className="tile">
              <Link href={`/projects/${p.id}`} className="title">{p.title}</Link>
              <div className="sub">{new Date(p.updatedAt).toLocaleDateString(lang === 'tr' ? 'tr-TR' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
              <div className="actions">
                <button className="icon" onClick={() => rename(p)} aria-label={t('common.rename')} title={t('common.rename')}><Icon name="pencil" /></button>
                <ConfirmButton onConfirm={() => remove(p.id)} ariaLabel={t('home.deleteProject')} />
              </div>
            </div>
          ))}
        </div>
      )}

      {projects && projects.length === 0 && (
        <EmptyState icon="doc" title={t('home.emptyTitle')}>{t('home.emptyBody')}</EmptyState>
      )}
    </>
  );
}
