'use client';
import { useRouter } from 'next/navigation';
import { Icon } from './Icon';

export function LogoutButton() {
  const router = useRouter();
  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  }
  return (
    <button className="icon" onClick={logout} aria-label="Çıkış yap" title="Çıkış yap">
      <Icon name="logout" />
    </button>
  );
}
