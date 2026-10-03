import { useState } from 'react';
import { Link } from 'react-router';
import { supabase, friendlyError } from '../lib/supabase';
import { useAsync, must, GENDER_LABEL } from '../lib/data';
import { useRole } from '../lib/auth';
import { PageHeader, Spinner, Empty, Modal, Field, Alert, useConfirm, useToast } from '../components/ui';
import { Icon } from '../components/Icon';

interface Stage { id: string; name: string; gender: 'boys' | 'girls'; sort: number }
interface Grade { id: string; stage_id: string; name: string; sort: number }
interface Section { id: string; grade_id: string; name: string; sort: number }

type Editing =
  | { kind: 'stage'; row?: Stage }
  | { kind: 'grade'; parent: string; row?: Grade }
  | { kind: 'section'; parent: string; row?: Section };

export default function Classes() {
  const isGuide = useRole() === 'health_guide';
  const toast = useToast();
  const { ask, ui } = useConfirm();
  const [editing, setEditing] = useState<Editing | null>(null);

  const q = useAsync(async () => {
    const [st, gr, se, stu] = await Promise.all([
      supabase.from('stages').select('*').order('sort'),
      supabase.from('grades').select('*').order('sort'),
      supabase.from('sections').select('*').order('sort'),
      supabase.from('students').select('section_id'),
    ]);
    const counts = new Map<string, number>();
    for (const s of must(stu) ?? []) counts.set(s.section_id, (counts.get(s.section_id) ?? 0) + 1);
    return { stages: must(st) as Stage[], grades: must(gr) as Grade[], sections: must(se) as Section[], counts };
  });

  const remove = async (table: 'stages' | 'grades' | 'sections', id: string, label: string) => {
    if (!(await ask(`حذف «${label}»؟ سيُحذف ما تحته من صفوف وفصول، ويبقى الطلاب بلا فصل.`))) return;
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) toast(friendlyError(error), 'danger'); else { toast('تم الحذف'); void q.reload(); }
  };

  if (q.loading && !q.data) return <Spinner />;
  if (q.error) return <Alert tone="danger">{q.error}</Alert>;
  const { stages, grades, sections, counts } = q.data!;

  return (
    <div>
      <PageHeader title="الصفوف والطلاب" subtitle="المراحل والصفوف والفصول، ومنها إلى قوائم الطلاب"
        actions={isGuide && <>
          <Link to="/import" className="btn-ghost"><Icon name="upload" />استيراد قائمة</Link>
          <button className="btn-primary" onClick={() => setEditing({ kind: 'stage' })}><Icon name="plus" />مرحلة</button>
        </>} />

      {stages.length === 0 ? (
        <Empty title="لا توجد مراحل بعد" hint={isGuide ? 'أضف مرحلة يدويًا أو استورد قائمة الطلاب من نور.' : 'لم يُضف الموجه الصحي أي صف بعد.'}
          action={isGuide && <Link to="/import" className="btn-primary"><Icon name="upload" />استيراد من نور</Link>} />
      ) : (
        <div className="space-y-4">
          {stages.map((st) => (
            <section key={st.id} className="card p-4">
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <h2 className="font-heading font-bold text-lg">{st.name}</h2>
                <span className="badge bg-surface-2 text-muted">{GENDER_LABEL[st.gender]}</span>
                {isGuide && <div className="ms-auto flex">
                  <button className="icon-btn" aria-label={`إضافة صف إلى ${st.name}`} onClick={() => setEditing({ kind: 'grade', parent: st.id })}><Icon name="plus" /></button>
                  <button className="icon-btn" aria-label={`تعديل ${st.name}`} onClick={() => setEditing({ kind: 'stage', row: st })}><Icon name="edit" /></button>
                  <button className="icon-btn text-danger" aria-label={`حذف ${st.name}`} onClick={() => remove('stages', st.id, st.name)}><Icon name="trash" /></button>
                </div>}
              </div>
              <div className="space-y-3">
                {grades.filter((g) => g.stage_id === st.id).map((g) => (
                  <div key={g.id} className="rounded-xl bg-surface-2 p-3">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium">{g.name}</h3>
                      {isGuide && <div className="ms-auto flex">
                        <button className="icon-btn" aria-label={`إضافة فصل إلى ${g.name}`} onClick={() => setEditing({ kind: 'section', parent: g.id })}><Icon name="plus" /></button>
                        <button className="icon-btn" aria-label={`تعديل ${g.name}`} onClick={() => setEditing({ kind: 'grade', parent: st.id, row: g })}><Icon name="edit" /></button>
                        <button className="icon-btn text-danger" aria-label={`حذف ${g.name}`} onClick={() => remove('grades', g.id, g.name)}><Icon name="trash" /></button>
                      </div>}
                    </div>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {sections.filter((s) => s.grade_id === g.id).map((s) => (
                        <div key={s.id} className="flex items-center rounded-xl border border-border bg-surface">
                          <Link to={`/classes/${s.id}`} className="flex items-center gap-2 px-3 font-medium" style={{ minHeight: 44 }}>
                            فصل {s.name}<span className="badge bg-primary-soft text-text">{counts.get(s.id) ?? 0} طالب</span>
                          </Link>
                          {isGuide && <>
                            <button className="icon-btn" aria-label={`تعديل الفصل ${s.name}`} onClick={() => setEditing({ kind: 'section', parent: g.id, row: s })}><Icon name="edit" size={16} /></button>
                            <button className="icon-btn text-danger" aria-label={`حذف الفصل ${s.name}`} onClick={() => remove('sections', s.id, `فصل ${s.name}`)}><Icon name="trash" size={16} /></button>
                          </>}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      {editing && <EditDialog editing={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void q.reload(); }} />}
      {ui}
    </div>
  );
}

function EditDialog({ editing, onClose, onSaved }: { editing: Editing; onClose(): void; onSaved(): void }) {
  const [name, setName] = useState(editing.row?.name ?? '');
  const [gender, setGender] = useState<'boys' | 'girls'>(editing.kind === 'stage' ? editing.row?.gender ?? 'boys' : 'boys');
  const [error, setError] = useState<string | null>(null);
  const title = { stage: 'المرحلة', grade: 'الصف', section: 'الفصل' }[editing.kind];

  const save = async () => {
    if (!name.trim()) return setError('الاسم مطلوب');
    const table = ({ stage: 'stages', grade: 'grades', section: 'sections' } as const)[editing.kind];
    const rec: Record<string, unknown> = { name: name.trim() };
    if (editing.kind === 'stage') rec.gender = gender;
    if (editing.kind === 'grade' && !editing.row) rec.stage_id = editing.parent;
    if (editing.kind === 'section' && !editing.row) rec.grade_id = editing.parent;
    const r = editing.row
      ? await supabase.from(table).update(rec).eq('id', editing.row.id)
      : await supabase.from(table).insert(rec);
    if (r.error) setError(friendlyError(r.error)); else onSaved();
  };

  return (
    <Modal open onClose={onClose} title={`${editing.row ? 'تعديل' : 'إضافة'} ${title}`}
      footer={<><button className="btn-ghost" onClick={onClose}>إلغاء</button><button className="btn-primary" onClick={save}>حفظ</button></>}>
      <div className="space-y-4">
        <Field label={`اسم ${title}`} required>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder={editing.kind === 'stage' ? 'ابتدائي' : editing.kind === 'grade' ? 'الأول' : '1'} />
        </Field>
        {editing.kind === 'stage' && (
          <fieldset>
            <legend className="label">الجنس</legend>
            <div className="flex gap-2">
              {(['boys', 'girls'] as const).map((g) => (
                <button key={g} type="button" className={`chip ${gender === g ? 'chip-on' : ''}`} style={{ minHeight: 44 }} aria-pressed={gender === g} onClick={() => setGender(g)}>{GENDER_LABEL[g]}</button>
              ))}
            </div>
          </fieldset>
        )}
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Modal>
  );
}
