'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/lib/ui/Icon';

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
    <div className="login-wrap">
      <form onSubmit={submit} className="card login">
        <div className="brandmark"><Icon name="wave" size={32} label="webnovel-tts" /></div>
        <h1>Giriş</h1>
        <p><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Panel şifresi" autoFocus /></p>
        {err && <p className="err">{err}</p>}
        <p><button type="submit" style={{ width: '100%' }}>Giriş yap</button></p>
      </form>
    </div>
  );
}
