'use client';
import { useRouter } from 'next/navigation';
import { Icon } from './Icon';
import { useT } from './LanguageProvider';

export function LogoutButton() {
  const t = useT();
  const router = useRouter();
  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  }
  return (
    <button className="icon" onClick={logout} aria-label={t('common.logout')} title={t('common.logout')}>
      <Icon name="logout" />
    </button>
  );
}
