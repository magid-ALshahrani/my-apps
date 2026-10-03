// منطق دالة إدارة المستخدمين، مستقل عن بيئة التشغيل (Deno في Supabase، وNode في الاختبارات المحلية).
// القاعدة: المنادي يجب أن يكون موجهًا صحيًا نشطًا، والدور يُقرأ من جدول profiles وليس من الطلب.

export type Role = 'health_guide' | 'principal' | 'nurse' | 'committee_member';
export const ROLES: Role[] = ['health_guide', 'principal', 'nurse', 'committee_member'];

export interface Profile { id: string; full_name: string; email: string | null; role: Role; active: boolean; must_change_password: boolean }

export interface Deps {
  /** يتحقق من JWT عبر Auth ويُرجع معرّف المستخدم، أو null */
  verifyCaller(jwt: string): Promise<string | null>;
  getProfile(id: string): Promise<Profile | null>;
  listProfiles(): Promise<Profile[]>;
  createAuthUser(email: string, password: string): Promise<string>;
  setAuthPassword(id: string, password: string): Promise<void>;
  setAuthBanned(id: string, banned: boolean): Promise<void>;
  insertProfile(p: Profile): Promise<void>;
  updateProfile(id: string, patch: Partial<Omit<Profile, 'id'>>): Promise<void>;
  addCommitteeMember(profileId: string, fullName: string, title: string): Promise<void>;
  audit(callerId: string, action: 'INSERT' | 'UPDATE', rowId: string, columns: string[]): Promise<void>;
  randomPassword(): string;
}

export interface Result { status: number; body: unknown }
const err = (status: number, message: string): Result => ({ status, body: { error: message } });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function handle(authorization: string | null, body: unknown, deps: Deps): Promise<Result> {
  const jwt = authorization?.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return err(401, 'يلزم تسجيل الدخول');
  const callerId = await deps.verifyCaller(jwt);
  if (!callerId) return err(401, 'جلسة غير صالحة');
  const caller = await deps.getProfile(callerId);
  if (!caller || caller.role !== 'health_guide' || !caller.active || caller.must_change_password) {
    return err(403, 'هذه العملية للموجه الصحي فقط');
  }

  const b = (body ?? {}) as Record<string, unknown>;
  const action = String(b.action ?? '');
  const targetId = typeof b.user_id === 'string' ? b.user_id : '';

  switch (action) {
    case 'list':
      return { status: 200, body: { users: await deps.listProfiles() } };

    case 'create': {
      const email = String(b.email ?? '').trim().toLowerCase();
      const fullName = String(b.full_name ?? '').trim();
      const role = b.role as Role;
      if (!EMAIL_RE.test(email)) return err(400, 'البريد الإلكتروني غير صالح');
      if (fullName.length < 3) return err(400, 'الاسم مطلوب');
      if (!ROLES.includes(role)) return err(400, 'الدور غير صالح');
      const password = deps.randomPassword();
      let id: string;
      try {
        id = await deps.createAuthUser(email, password);
      } catch {
        return err(409, 'تعذّر إنشاء الحساب. ربما البريد مستخدم مسبقًا.');
      }
      await deps.insertProfile({ id, full_name: fullName, email, role, active: true, must_change_password: true });
      if (role === 'committee_member') {
        await deps.addCommitteeMember(id, fullName, String(b.title ?? 'عضو').trim() || 'عضو');
      }
      await deps.audit(callerId, 'INSERT', id, ['role']);
      // كلمة المرور المؤقتة تُعرض مرة واحدة للموجه ليسلّمها، ويُلزم صاحبها بتغييرها عند أول دخول
      return { status: 200, body: { user_id: id, temporary_password: password } };
    }

    case 'set_role': {
      const role = b.role as Role;
      if (!ROLES.includes(role)) return err(400, 'الدور غير صالح');
      if (targetId === callerId) return err(400, 'لا يمكنك تغيير دورك بنفسك');
      const target = await deps.getProfile(targetId);
      if (!target) return err(404, 'المستخدم غير موجود');
      await deps.updateProfile(targetId, { role });
      if (role === 'committee_member') await deps.addCommitteeMember(targetId, target.full_name, String(b.title ?? 'عضو'));
      await deps.audit(callerId, 'UPDATE', targetId, ['role']);
      return { status: 200, body: { ok: true } };
    }

    case 'set_active': {
      const active = b.active === true;
      if (targetId === callerId) return err(400, 'لا يمكنك تعطيل حسابك');
      const target = await deps.getProfile(targetId);
      if (!target) return err(404, 'المستخدم غير موجود');
      await deps.setAuthBanned(targetId, !active);
      await deps.updateProfile(targetId, { active });
      await deps.audit(callerId, 'UPDATE', targetId, ['active']);
      return { status: 200, body: { ok: true } };
    }

    case 'reset_password': {
      const target = await deps.getProfile(targetId);
      if (!target) return err(404, 'المستخدم غير موجود');
      if (targetId === callerId) return err(400, 'غيّر كلمة مرورك من صفحة حسابك');
      const password = deps.randomPassword();
      await deps.setAuthPassword(targetId, password);
      // بعد تحديث كلمة المرور (الذي يرفع الإلزام تلقائيًا) نعيد الإلزام
      await deps.updateProfile(targetId, { must_change_password: true });
      await deps.audit(callerId, 'UPDATE', targetId, ['must_change_password']);
      return { status: 200, body: { temporary_password: password } };
    }

    default:
      return err(400, 'عملية غير معروفة');
  }
}

/** كلمة مرور مؤقتة: 14 حرفًا من أبجدية بلا حروف ملتبسة */
export function makeRandomPassword(getRandomValues: (a: Uint8Array) => Uint8Array): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = getRandomValues(new Uint8Array(14));
  return Array.from(bytes, (x) => alphabet[x % alphabet.length]).join('');
}

/** تبعيات مبنية على عميل Supabase بمفتاح الخدمة (لا يُستخدم إلا داخل الدالة على الخادم) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function supabaseDeps(admin: any, getRandomValues: (a: Uint8Array) => Uint8Array): Deps {
  const cols = 'id, full_name, email, role, active, must_change_password';
  return {
    async verifyCaller(jwt) {
      const { data, error } = await admin.auth.getUser(jwt);
      return error || !data?.user ? null : data.user.id;
    },
    async getProfile(id) {
      if (!id) return null;
      const { data } = await admin.from('profiles').select(cols).eq('id', id).maybeSingle();
      return data ?? null;
    },
    async listProfiles() {
      const { data, error } = await admin.from('profiles').select(cols).order('created_at');
      if (error) throw new Error('تعذّر جلب المستخدمين');
      return data ?? [];
    },
    async createAuthUser(email, password) {
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error || !data?.user) throw new Error('create failed');
      return data.user.id;
    },
    async setAuthPassword(id, password) {
      const { error } = await admin.auth.admin.updateUserById(id, { password });
      if (error) throw new Error('update failed');
    },
    async setAuthBanned(id, banned) {
      const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: banned ? '876000h' : 'none' });
      if (error) throw new Error('ban failed');
    },
    async insertProfile(p) {
      const { error } = await admin.from('profiles').insert(p);
      if (error) throw new Error('profile failed');
    },
    async updateProfile(id, patch) {
      const { error } = await admin.from('profiles').update(patch).eq('id', id);
      if (error) throw new Error('profile failed');
    },
    async addCommitteeMember(profileId, fullName, title) {
      const { error } = await admin.from('committee_members')
        .upsert({ profile_id: profileId, full_name: fullName, title }, { onConflict: 'profile_id' });
      if (error) throw new Error('committee failed');
    },
    async audit(callerId, action, rowId, columns) {
      await admin.from('audit_log').insert({
        user_id: callerId, user_role: 'health_guide', table_name: 'profiles', action, row_id: rowId, changed_columns: columns,
      });
    },
    randomPassword: () => makeRandomPassword(getRandomValues),
  };
}
