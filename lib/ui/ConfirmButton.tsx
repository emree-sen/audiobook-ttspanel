'use client';
import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { useT } from './LanguageProvider';

// confirm() yerine iki aşamalı onay: ilk tık "Emin misin?"e dönüşür (3 sn), ikinci tık onaylar.
export function ConfirmButton({ onConfirm, ariaLabel }: { onConfirm: () => void; ariaLabel?: string }) {
  const t = useT();
  const label = ariaLabel ?? t('common.delete');
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  function click(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    if (!armed) {
      setArmed(true);
      timer.current = setTimeout(() => setArmed(false), 3000);
    } else {
      clearTimeout(timer.current);
      setArmed(false);
      onConfirm();
    }
  }

  return armed ? (
    <button className="danger" onClick={click}>{t('common.confirmAgain')}</button>
  ) : (
    <button className="icon" onClick={click} aria-label={label} title={label}>
      <Icon name="trash" />
    </button>
  );
}
