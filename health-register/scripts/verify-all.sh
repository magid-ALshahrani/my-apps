#!/usr/bin/env bash
# يشغّل كل فحوص التحقق بالترتيب الصحيح على البيئة المحلية. يتطلب: npm run stack، وnpm run dev، وDEMO_PASSWORD.
set -uo pipefail
cd "$(dirname "$0")/.."
: "${DEMO_PASSWORD:?ضع DEMO_PASSWORD}"
export SUPABASE_URL=http://localhost:54321
export SUPABASE_SERVICE_ROLE_KEY=$(node -e "console.log(require('/var/tmp/hr-stack/keys.json').service)")
status=0
run() { echo; echo "▶ $1"; shift; "$@" || status=1; }
run "فحص الأنواع والبناء" npm run build --silent
run "اختبارات الوحدة" npx vitest run
run "اختبارات قاعدة البيانات وRLS والمخزن" npx vitest run --config vitest.db.config.ts
node scripts/demo-data.mjs --remove >/dev/null 2>&1; node scripts/demo-data.mjs
node tests/e2e/make-noor-sample.mjs /var/tmp/hr-stack/noor-sample.xlsx
run "حماية الهوية عبر الواجهة" node tests/e2e/import-protection.mjs
run "وحدات المرحلة 3 عبر الواجهة" node tests/e2e/phase3.mjs
run "الأمان (كلمة المرور، القفل، المفاتيح)" node tests/e2e/security.mjs
run "التصدير PDF/Word/Excel" node tests/e2e/exports.mjs
run "فحص ملفات التصدير" node tests/e2e/verify-exports.mjs
node scripts/demo-data.mjs --remove >/dev/null 2>&1; node scripts/demo-data.mjs >/dev/null
run "لقطات الشاشة وفحص RTL والتباين" env EXTRA="/plan=plan,/reports=reports" OUT=screenshots/final node tests/e2e/screens.mjs
echo; [ $status = 0 ] && echo "✅ كل الفحوص نجحت" || echo "❌ يوجد فحص فاشل"
exit $status
