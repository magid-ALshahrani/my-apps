import { Icon } from './Icon';

export interface ConditionType { id: string; name: string; color: string; icon: string; is_critical: boolean; is_builtin: boolean; sort: number }

const TOKENS = ['diabetes', 'bp', 'allergy', 'exempt', 'chronic', 'followup', 'critical'];
/** الحالات ذات الخلفية الفاتحة تحتاج رمزًا داكنًا */
const DARK_GLYPH = ['allergy'];

/** لون الحالة: رمز من نظام التصميم، أو لون مخصص (hex) للأنواع التي يضيفها الموجه */
export function conditionColor(color: string) {
  return TOKENS.includes(color) ? `rgb(var(--c-${color}))` : color;
}

/** نقطة الحالة: لون + رمز داخلي، فلا يعتمد التمييز على اللون وحده */
export function ConditionDot({ type, size = 28, inactive, onClick, label }: { type: ConditionType; size?: number; inactive?: boolean; onClick?(): void; label?: string }) {
  const glyph = DARK_GLYPH.includes(type.color) ? 'rgb(var(--on-c-dark))' : 'rgb(var(--on-c-light))';
  const dot = (
    <span
      className="inline-flex items-center justify-center rounded-full ring-2 ring-surface"
      data-condition={type.color}
      style={{ width: size, height: size, background: conditionColor(type.color), color: glyph, opacity: inactive ? 0.45 : 1 }}>
      <Icon name={type.icon} size={Math.round(size * 0.6)} strokeWidth={2.4} />
    </span>
  );
  const text = label ?? `${type.name}${inactive ? ' (متعافية)' : ''}`;
  if (!onClick) return <span title={text} aria-label={text} role="img">{dot}</span>;
  return (
    <button type="button" onClick={onClick} title={text} aria-label={text}
      className="inline-flex items-center justify-center rounded-full" style={{ minWidth: 44, minHeight: 44 }}>
      {dot}
    </button>
  );
}

/** الحالة الحرجة: شريط تنبيه بأيقونة تحذير، وليس نقطة حمراء */
export function CriticalBanner({ names, onClick }: { names: string[]; onClick?(): void }) {
  if (!names.length) return null;
  return (
    <button type="button" onClick={onClick}
      className="flex w-full items-center gap-2 rounded-lg border-2 border-danger bg-danger-soft px-2 py-1 text-sm font-bold text-text text-start"
      style={{ minHeight: 36 }}>
      <Icon name="warning" className="text-danger" size={18} />
      <span>تنبيه حرج: {names.join('، ')}</span>
    </button>
  );
}
