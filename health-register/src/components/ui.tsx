import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold font-heading leading-tight">{title}</h1>
        {subtitle && <div className="text-muted text-sm mt-1">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2 no-print">{actions}</div>}
    </div>
  );
}

export function Spinner({ label = 'جارٍ التحميل…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-3 text-muted py-8 justify-center">
      <span className="h-5 w-5 rounded-full border-2 border-border border-t-primary animate-spin" />
      {label}
    </div>
  );
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="card p-8 text-center">
      <p className="font-heading font-bold text-lg">{title}</p>
      {hint && <p className="text-muted mt-1">{hint}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function Alert({ tone = 'info', children }: { tone?: 'info' | 'danger' | 'warning' | 'success'; children: ReactNode }) {
  const cls = {
    info: 'bg-primary-soft text-text border-primary/40',
    danger: 'bg-danger-soft text-text border-danger/50',
    warning: 'bg-warning-soft text-text border-warning/50',
    success: 'bg-primary-soft text-text border-success/50',
  }[tone];
  const icon = { info: 'info', danger: 'warning', warning: 'warning', success: 'check' }[tone];
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={`flex gap-2 items-start rounded-xl border px-3 py-2 ${cls}`}>
      <Icon name={icon} className={tone === 'danger' ? 'text-danger mt-0.5' : tone === 'warning' ? 'text-warning mt-0.5' : 'text-primary mt-0.5'} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** نافذة: ورقة سفلية على الجوال، ووسط الشاشة على سطح المكتب */
export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose(): void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); prev?.focus(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 no-print" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={id}
        className={`bg-surface text-text w-full ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'} max-h-[92vh] flex flex-col rounded-t-2xl sm:rounded-2xl border border-border shadow-2xl`}>
        <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-border">
          <h2 id={id} className="font-heading font-bold text-lg">{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="إغلاق"><Icon name="close" /></button>
        </div>
        <div className="overflow-y-auto px-4 py-4 flex-1">{children}</div>
        {footer && <div className="px-4 py-3 border-t border-border flex flex-wrap gap-2 justify-end safe-bottom">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint, error, required }: { label: string; children: ReactNode; hint?: string; error?: string | null; required?: boolean }) {
  return (
    <label className="block">
      <span className="label">{label}{required && <span className="text-danger"> *</span>}</span>
      {children}
      {hint && !error && <span className="block text-xs text-muted mt-1">{hint}</span>}
      {error && <span className="block text-sm text-danger mt-1" role="alert">{error}</span>}
    </label>
  );
}

/** تأكيد بسيط قبل الحذف */
export function useConfirm() {
  const [state, setState] = useState<{ text: string; resolve(v: boolean): void } | null>(null);
  const ask = useCallback((text: string) => new Promise<boolean>((resolve) => setState({ text, resolve })), []);
  const ui = (
    <Modal open={!!state} onClose={() => { state?.resolve(false); setState(null); }} title="تأكيد"
      footer={<>
        <button className="btn-ghost" onClick={() => { state?.resolve(false); setState(null); }}>إلغاء</button>
        <button className="btn-danger" onClick={() => { state?.resolve(true); setState(null); }}>تأكيد</button>
      </>}>
      <p>{state?.text}</p>
    </Modal>
  );
  return { ask, ui };
}

// ===== إشعارات قصيرة =====
type Toast = { id: number; text: string; tone: 'success' | 'danger' };
const ToastCtx = createContext<(text: string, tone?: Toast['tone']) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast['tone'] = 'success') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, text, tone }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed z-[60] inset-x-0 bottom-24 lg:bottom-6 flex flex-col items-center gap-2 pointer-events-none px-4" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`pointer-events-auto rounded-xl px-4 py-2 shadow-lg border ${t.tone === 'danger' ? 'bg-danger-soft border-danger/50' : 'bg-surface border-border'}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'primary' | 'accent' | 'danger' }) {
  const color = tone === 'accent' ? 'text-accent' : tone === 'danger' ? 'text-danger' : 'text-primary';
  return (
    <div className="card p-4">
      <div className="text-sm text-muted">{label}</div>
      <div className={`text-3xl font-bold font-heading mt-1 ${color}`}>{value}</div>
      {hint && <div className="text-xs text-muted mt-1">{hint}</div>}
    </div>
  );
}
