import React, { useEffect, useRef } from 'react';
import { AmIcon } from './AmIcon';

interface AmDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  wide?: boolean;
  children: React.ReactNode;
}

export const AmDialog: React.FC<AmDialogProps> = ({ open, onClose, title, wide, children }) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = React.useId();

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      dlg.showModal();
    } else if (!open && dlg.open) {
      dlg.close();
    }
  }, [open]);

  // Fallback light-dismiss for browsers without `closedBy` support (Safari)
  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg || 'closedBy' in HTMLDialogElement.prototype) return;
    let pressedOutside = false;
    const isOutside = (e: PointerEvent) => {
      const r = dlg.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    const onDown = (e: PointerEvent) => {
      pressedOutside = isOutside(e);
    };
    const onUp = (e: PointerEvent) => {
      if (pressedOutside && isOutside(e)) dlg.close();
    };
    dlg.addEventListener('pointerdown', onDown);
    dlg.addEventListener('pointerup', onUp);
    return () => {
      dlg.removeEventListener('pointerdown', onDown);
      dlg.removeEventListener('pointerup', onUp);
    };
  }, []);

  const handleClose = () => {
    const dlg = dialogRef.current;
    if (dlg) dlg.returnValue = '';
    onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      className={`am-dialog ${wide ? 'wide' : ''}`}
      aria-labelledby={titleId}
      {...({ closedby: 'any' } as Record<string, string>)}
      onClose={handleClose}
    >
      <div className="am-dialog-head">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="am-icon-btn" onClick={handleClose} aria-label="Close">
          <AmIcon name="ic_btn_close" fallback="close" size={18} />
        </button>
      </div>
      <div className="am-dialog-body am-scroll">{children}</div>
    </dialog>
  );
};
