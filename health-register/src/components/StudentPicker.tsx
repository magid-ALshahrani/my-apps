import { useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAsync, must } from '../lib/data';
import { nameKey } from '../lib/text';
import { Icon } from './Icon';

export interface StudentLite { id: string; full_name: string; guardian_phone: string | null; classLabel: string }

/** قائمة الطلاب مع اسم الصف والفصل (للمنتقي والجداول) */
export function useStudents() {
  return useAsync(async () => {
    const rows = must(await supabase.from('students')
      .select('id,full_name,guardian_phone,sections(name,grades(name,stages(name)))').order('full_name')) as unknown as
      { id: string; full_name: string; guardian_phone: string | null; sections: { name: string; grades: { name: string; stages: { name: string } } } | null }[];
    return rows.map((r) => ({
      id: r.id, full_name: r.full_name, guardian_phone: r.guardian_phone,
      classLabel: r.sections ? `${r.sections.grades.stages.name} ${r.sections.grades.name} / ${r.sections.name}` : 'بلا فصل',
    })) as StudentLite[];
  });
}

export function StudentPicker({ students, value, onChange }: { students: StudentLite[]; value: string | null; onChange(s: StudentLite): void }) {
  const [q, setQ] = useState('');
  const selected = students.find((s) => s.id === value);
  const matches = useMemo(() => {
    const k = nameKey(q);
    return k ? students.filter((s) => nameKey(s.full_name).includes(k)).slice(0, 8) : [];
  }, [q, students]);
  return (
    <div>
      {selected && (
        <div className="flex items-center gap-2 rounded-xl bg-primary-soft px-3 mb-2" style={{ minHeight: 44 }}>
          <Icon name="check" className="text-primary" />
          <span className="font-medium">{selected.full_name}</span>
          <span className="text-sm text-muted">{selected.classLabel}</span>
        </div>
      )}
      <div className="relative">
        <Icon name="search" className="absolute start-3 top-3 text-muted" />
        <input className="field ps-10" placeholder="ابحث باسم الطالب…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="البحث عن طالب" />
      </div>
      {matches.length > 0 && (
        <ul className="mt-1 rounded-xl border border-border divide-y divide-border bg-surface max-h-64 overflow-y-auto" role="listbox">
          {matches.map((s) => (
            <li key={s.id}>
              <button type="button" role="option" aria-selected={s.id === value} className="w-full text-start px-3 hover:bg-surface-2 flex items-center gap-2" style={{ minHeight: 44 }}
                onClick={() => { onChange(s); setQ(''); }}>
                <span className="font-medium">{s.full_name}</span><span className="text-sm text-muted ms-auto">{s.classLabel}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
