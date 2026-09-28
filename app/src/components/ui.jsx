import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { money, monthName, hijriMonth } from '../lib/format.js';
import { friendlyError } from '../api.js';

/* ---------- الإشعارات مع زر التراجع ---------- */
const ToastCtx = createContext(null);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const remove = useCallback((id) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (text, { error = false, undo = null, ms = undo ? 10000 : 3500 } = {}) => {
      const id = Math.random().toString(36).slice(2);
      setItems((xs) => [...xs.slice(-2), { id, text, error, undo }]);
      setTimeout(() => remove(id), ms);
    },
    [remove],
  );
  const api = useRef(null);
  api.current = {
    ok: (t, opts) => push(t, opts),
    error: (e) => push(typeof e === 'string' ? e : friendlyError(e), { error: true, ms: 6000 }),
  };
  const value = useRef({ ok: (...a) => api.current.ok(...a), error: (...a) => api.current.error(...a) }).current;
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="toast-wrap" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.error ? 'err' : ''}`}>
            <span>{t.text}</span>
            {t.undo && (
              <button
                onClick={() => {
                  remove(t.id);
                  t.undo();
                }}
              >
                تراجع
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------- نافذة ---------- */
export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className="ov" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={wide ? { maxWidth: 680 } : undefined}>
        <div className="modal-h">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="إغلاق">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ---------- تأكيد ---------- */
export function Confirm({ title, message, confirmLabel = 'تأكيد', danger, onConfirm, onClose }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <Modal title={title} onClose={onClose}>
      <p style={{ marginBottom: 16 }}>{message}</p>
      <div className="row">
        <button
          className={`btn ${danger ? 'danger' : 'primary'}`}
          style={{ flex: 1 }}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
              onClose();
            } catch (e) {
              toast.error(e);
              setBusy(false);
            }
          }}
        >
          {busy ? '...' : confirmLabel}
        </button>
        <button className="btn" style={{ flex: 1 }} onClick={onClose}>
          إلغاء
        </button>
      </div>
    </Modal>
  );
}

/* ---------- حقول ---------- */
export function Field({ label, error, hint, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {error ? <em className="err">{error}</em> : hint ? <em className="hint">{hint}</em> : null}
    </label>
  );
}

export function MonthSelect({ value, onChange, months, closed, hijri, ...rest }) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)} {...rest}>
      {months.map((p) => (
        <option key={p} value={p}>
          {monthName(p)}
          {hijri ? ` — ${hijriMonth(p)}` : ''}
          {closed?.has(p) ? ' 🔒' : ''}
        </option>
      ))}
    </select>
  );
}

export const Money = ({ v, className }) => <span className={`money ${className || ''}`}>{money(v)}</span>;

export function MonthLabel({ period, hijri }) {
  return (
    <>
      {monthName(period)}
      {hijri && <span className="muted small"> · {hijriMonth(period)}</span>}
    </>
  );
}

export function Stat({ label, value, tone }) {
  return (
    <div className={`stat ${tone || ''}`}>
      <div className="l">{label}</div>
      <div className="v">
        <Money v={value} />
      </div>
    </div>
  );
}

/** نموذج عام مع معالجة الإرسال والأخطاء */
export function useSubmit(fn, { onDone } = {}) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const run = async (...args) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fn(...args);
      onDone?.(r);
      return r;
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return [run, busy];
}

export function download(filename, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** CSV مع BOM ليفتح في Excel بالعربية بشكل صحيح */
export function toCSV(rows) {
  const esc = (v) => {
    let s = v == null ? '' : String(v);
    // منع حقن الصيغ في Excel
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `﻿${rows.map((r) => r.map(esc).join(',')).join('\r\n')}`;
}
