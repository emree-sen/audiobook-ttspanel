'use client';
import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

// confirm() yerine iki aşamalı onay: ilk tık "Emin misin?"e dönüşür (3 sn), ikinci tık onaylar.
export function ConfirmButton({ onConfirm, ariaLabel = 'Sil' }: { onConfirm: () => void; ariaLabel?: string }) {
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
    <button className="danger" onClick={click}>Emin misin?</button>
  ) : (
    <button className="icon" onClick={click} aria-label={ariaLabel} title={ariaLabel}>
      <Icon name="trash" />
    </button>
  );
}
