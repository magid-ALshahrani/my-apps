import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { supabase, friendlyError } from '../lib/supabase';
import { useAsync, must } from '../lib/data';
import { useRole } from '../lib/auth';
import { maskRecord } from '../lib/protect';
import { normalizeSaudiMobile, displayPhone } from '../lib/phone';
import { dual, isoDate } from '../lib/dates';
import { RECORD_KINDS, RECORD_NOTE, type RecordKind } from '../lib/register';
import { PageHeader, Spinner, Empty, Modal, Field, Alert, useConfirm, useToast } from '../components/ui';
import { StudentPicker, useStudents, type StudentLite } from '../components/StudentPicker';
import { Icon } from '../components/Icon';

export interface RecordRow { id: string; student_id: string; case_date: string; actions: string | null; guardian_phone: string | null; disease_name?: string; case_type?: string }

/** جدول سجل رسمي: يُستخدم للسجلات الثلاثة ولسجل العنف الأسري */
export function RecordTable({ rows, students, nameLabel, nameKey, canEdit, canDelete, onEdit, onDelete }: {
  rows: RecordRow[]; students: StudentLite[]; nameLabel: string; nameKey: 'disease_name' | 'case_type';
  canEdit: boolean; canDelete: boolean; onEdit(r: RecordRow): void; onDelete(r: RecordRow): void;
}) {
  const byId = new Map(students.map((s) => [s.id, s]));
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead><tr><th>م</th><th>{nameLabel}</th><th>اسم الطالب/ة</th><th>الصف</th><th>تاريخ الحالة</th><th>إجراءات واحتياطات المتابعة</th><th>رقم جوال ولي الأمر</th>{(canEdit || canDelete) && <th className="no-print"></th>}</tr></thead>
        <tbody>
          {rows.map((r, i) => {
            const s = byId.get(r.student_id);
            return (
              <tr key={r.id}>
                <td className="tabular-nums">{i + 1}</td>
                <td className="font-medium">{r[nameKey]}</td>
                <td className="whitespace-nowrap">{s?.full_name ?? '—'}</td>
                <td className="whitespace-nowrap">{s?.classLabel ?? '—'}</td>
                <td className="whitespace-nowrap">{dual(r.case_date, true)}</td>
                <td className="min-w-48 whitespace-pre-wrap">{r.actions || '—'}</td>
                <td dir="ltr" className="text-end whitespace-nowrap">{displayPhone(r.guardian_phone) || '—'}</td>
                {(canEdit || canDelete) && <td className="no-print whitespace-nowrap">
                  {canEdit && <button className="icon-btn" aria-label="تعديل" onClick={() => onEdit(r)}><Icon name="edit" /></button>}
                  {canDelete && <button className="icon-btn text-danger" aria-label="حذف" onClick={() => onDelete(r)}><Icon name="trash" /></button>}
                </td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function RecordDialog({ title, nameLabel, nameKey, row, students, onClose, onSave }: {
  title: string; nameLabel: string; nameKey: 'disease_name' | 'case_type'; row: Partial<RecordRow> | null; students: StudentLite[];
  onClose(): void; onSave(rec: Record<string, unknown>): Promise<string | null>;
}) {
  const [studentId, setStudentId] = useState<string | null>(row?.student_id ?? null);
  const [name, setName] = useState(row?.[nameKey] ?? '');
  const [date, setDate] = useState(row?.case_date ?? isoDate());
  const [actions, setActions] = useState(row?.actions ?? '');
  const [phone, setPhone] = useState(displayPhone(row?.guardian_phone));
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (!studentId) return setError('اختر الطالب');
    if (!name.trim()) return setError(`${nameLabel} مطلوب`);
    const p = phone.trim() ? normalizeSaudiMobile(phone) : null;
    if (phone.trim() && !p) return setError('رقم الجوال غير صالح (05xxxxxxxx).');
    const err = await onSave(maskRecord({ student_id: studentId, [nameKey]: name.trim(), case_date: date, actions: actions.trim() || null, guardian_phone: p }));
    if (err) setError(err);
  };
  return (
    <Modal open onClose={onClose} title={title} footer={<><button className="btn-ghost" onClick={onClose}>إلغاء</button><button className="btn-primary" onClick={save}>حفظ</button></>}>
      <div className="space-y-4">
        <Field label="الطالب/ة" required><StudentPicker students={students} value={studentId} onChange={(s) => { setStudentId(s.id); if (!phone) setPhone(displayPhone(s.guardian_phone)); }} /></Field>
        <Field label={nameLabel} required><input className="field" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="تاريخ الحالة" hint={dual(date)}><input className="field" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="إجراءات واحتياطات المتابعة"><textarea className="field py-2" rows={3} value={actions} onChange={(e) => setActions(e.target.value)} /></Field>
        <Field label="رقم جوال ولي الأمر"><input className="field" dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="05xxxxxxxx" /></Field>
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Modal>
  );
}

export default function Records() {
  const role = useRole();
  const canEdit = role === 'health_guide' || role === 'nurse';
  const canDelete = role === 'health_guide';
  const [params, setParams] = useSearchParams();
  const kind = (params.get('kind') as RecordKind) in RECORD_KINDS ? (params.get('kind') as RecordKind) : 'infectious';
  const toast = useToast();
  const { ask, ui } = useConfirm();
  const [editing, setEditing] = useState<Partial<RecordRow> | null>(null);
  const students = useStudents();
  const q = useAsync(async () => must(await supabase.from('official_records').select('*').eq('kind', kind).order('case_date', { ascending: false })) as RecordRow[], [kind]);
  const meta = RECORD_KINDS[kind];

  return (
    <div>
      <PageHeader title="سجلات المتابعة الرسمية" subtitle={RECORD_NOTE}
        actions={<>
          <button className="btn-ghost" onClick={() => window.print()}><Icon name="print" />طباعة</button>
          {canEdit && <button className="btn-primary" onClick={() => setEditing({})}><Icon name="plus" />إضافة حالة</button>}
        </>} />
      <div className="flex gap-2 overflow-x-auto pb-2 mb-4 no-print" role="tablist">
        {(Object.keys(RECORD_KINDS) as RecordKind[]).map((k) => (
          <button key={k} role="tab" aria-selected={k === kind} className={`chip shrink-0 ${k === kind ? 'chip-on' : ''}`} style={{ minHeight: 44 }} onClick={() => setParams({ kind: k })}>{RECORD_KINDS[k].short}</button>
        ))}
      </div>
      <h2 className="font-heading font-bold text-lg mb-3">{meta.title}</h2>
      {q.loading || students.loading ? <Spinner /> : q.error ? <Alert tone="danger">{q.error}</Alert> : q.data!.length === 0 ? <Empty title="لا توجد حالات مسجلة" /> : (
        <RecordTable rows={q.data!} students={students.data ?? []} nameLabel={meta.disease} nameKey="disease_name" canEdit={canEdit} canDelete={canDelete}
          onEdit={setEditing} onDelete={async (r) => {
            if (!(await ask('حذف هذه الحالة من السجل؟'))) return;
            const { error } = await supabase.from('official_records').delete().eq('id', r.id);
            if (error) toast(friendlyError(error), 'danger'); else void q.reload();
          }} />
      )}
      {editing && <RecordDialog title={`${editing.id ? 'تعديل' : 'إضافة'} — ${meta.short}`} nameLabel={meta.disease} nameKey="disease_name" row={editing} students={students.data ?? []}
        onClose={() => setEditing(null)} onSave={async (rec) => {
          const r = editing.id ? await supabase.from('official_records').update(rec).eq('id', editing.id) : await supabase.from('official_records').insert({ ...rec, kind });
          if (r.error) return friendlyError(r.error);
          setEditing(null); toast('تم الحفظ'); void q.reload(); return null;
        }} />}
      {ui}
    </div>
  );
}
