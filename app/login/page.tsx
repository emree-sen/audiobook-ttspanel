'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
    if (res.ok) router.push('/');
    else setErr((await res.json()).error ?? 'Giriş başarısız');
  }

  return (
    <form onSubmit={submit} className="card" style={{ maxWidth: '22rem', margin: '4rem auto' }}>
      <h1>Giriş</h1>
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Panel şifresi" autoFocus />
      {err && <p className="err">{err}</p>}
      <p><button type="submit">Giriş yap</button></p>
    </form>
  );
}
