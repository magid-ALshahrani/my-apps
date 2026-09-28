// نصوص الرسائل (واتساب / نسخ) — نص عادي فقط.
import { monthName, money, fmtDate } from './format.js';

const LINE = '━━━━━━━━━━━━━━━━━━';

export function fundSummaryText({ fundName, today, summary, period, unpaid, paidCount, activeCount, loans, opts }) {
  let t = `🏦 *${fundName}*\n📅 ${fmtDate(today)}\n${LINE}\n`;
  if (opts.balance) {
    t += `💰 *الملخص المالي*\n• المحصّل: ${money(summary.collected)}\n• السحوبات: ${money(summary.withdrawals)}\n• المصروفات: ${money(summary.expenses)}\n• قروض قائمة: ${money(summary.loans_outstanding)}\n• 🏦 الرصيد: *${money(summary.balance)}*\n${LINE}\n`;
  }
  if (opts.month) {
    t += `📅 *${monthName(period)}*\n• دفعوا: ${paidCount}/${activeCount}\n`;
    if (unpaid.length) t += `• ⏳ لم يكملوا: ${unpaid.map((u) => u.member.name).join('، ')}\n`;
    t += `${LINE}\n`;
  }
  if (opts.loans && loans.length) {
    t += `🔄 *القروض القائمة*\n`;
    for (const l of loans) t += `• ${l.name}: متبقٍ ${money(l.outstanding)}${l.status === 'overdue' ? ' ⚠️ متأخر' : ''}\n`;
    t += `${LINE}\n`;
  }
  return `${t}📊 _تقرير ${fundName}_`;
}

export function statementText({ fundName, member, stats, today }) {
  let t = `🏦 *${fundName}* — كشف حساب\n👤 ${member.name}\n📅 ${fmtDate(today)}\n${LINE}\n`;
  t += `• إجمالي المدفوع: ${money(stats.paidTotal)}\n`;
  t += `• الأشهر المستحقة: ${stats.dueMonths} (مكتملة: ${stats.fullMonths})\n`;
  if (stats.arrears > 0) t += `• ⏳ المتأخرات: ${money(stats.arrears)} (${stats.arrearsMonths.map(monthName).join('، ')})\n`;
  if (stats.prepaid > 0) t += `• دفع مقدّم: ${money(stats.prepaid)}\n`;
  if (stats.withdrawals > 0) t += `• السحوبات: ${money(stats.withdrawals)}\n`;
  if (stats.loansOut > 0) t += `• قروض قائمة: ${money(stats.loansOut)}\n`;
  t += `• نسبة الالتزام: ${stats.commitment}%\n${LINE}\n📊 _${fundName}_`;
  return t;
}

export function reminderText({ fundName, member, period, remaining }) {
  return `السلام عليكم ${member.name} 👋\nتذكير لطيف باشتراك ${fundName} لشهر ${monthName(period)}.\nالمتبقي: ${money(remaining)}\nجزاك الله خيراً 🌷`;
}

/** 05xxxxxxxx → 9665xxxxxxxx */
export function waPhone(phone) {
  if (!phone) return '';
  let p = phone.replace(/[^0-9]/g, '');
  if (p.startsWith('00')) p = p.slice(2);
  if (p.startsWith('05') && p.length === 10) p = `966${p.slice(1)}`;
  return p;
}

export const waLink = (text, phone) => `https://wa.me/${waPhone(phone)}?text=${encodeURIComponent(text)}`;
