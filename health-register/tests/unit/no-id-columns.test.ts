// لا يوجد في مهاجرات SQL أو الأنواع أي عمود أو حقل يشير إلى الهوية.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const BAD = /\b(national_?id|nationalid|iqama\w*|civil_?(id|no|number|record)\w*|identity_?(no|number)|id_?number|hawiy\w*|nid)\b|هوية|هويه|السجل المدني|الإقامة/i;
const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);

describe('لا أعمدة هوية', () => {
  it('مهاجرات SQL: لا معرّف ولا تعليق يشير للهوية', () => {
    for (const f of walk('supabase/migrations')) {
      const lines = fs.readFileSync(f, 'utf8').split('\n').filter((l) => BAD.test(l));
      expect(lines, f).toEqual([]);
    }
  });
  it('الأنواع والواجهات في الكود: لا حقل باسم يشير للهوية', () => {
    const fieldDecl = /^\s*(readonly\s+)?["']?(\w+)["']?\??\s*:/;
    const offenders: string[] = [];
    for (const f of walk('src').filter((x) => /\.(ts|tsx)$/.test(x))) {
      for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
        const m = line.match(fieldDecl);
        if (m && BAD.test(m[2])) offenders.push(`${f}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
