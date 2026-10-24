#!/usr/bin/env node
// 一次性校验：lang/zh-CN.json 与 lang/en.json 的一致性
// 1) JSON 合法（UTF-8 无 BOM） 2) 键集合递归一致 3) {占位符} 集合一致 4) 术语抽样对照
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');
const zhRaw = read('lang/zh-CN.json');
const enRaw = read('lang/en.json');

let failed = 0;
const fail = (msg) => { failed++; console.error('[FAIL] ' + msg); };

// 1) BOM / JSON 合法性
for (const [name, raw] of [['en', enRaw], ['zh-CN', zhRaw]]) {
  if (raw.charCodeAt(0) === 0xfeff) fail(`${name}.json 含 BOM`);
}
let en, zh;
try { en = JSON.parse(enRaw); } catch (e) { fail('en.json 解析失败: ' + e.message); process.exit(1); }
try { zh = JSON.parse(zhRaw); } catch (e) { fail('zh-CN.json 解析失败: ' + e.message); process.exit(1); }

// 扁平化（递归）
const flat = (o, p = '') => {
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    const key = p ? p + '.' + k : k;
    if (v && typeof v === 'object') Object.assign(out, flat(v, key));
    else out[key] = v;
  }
  return out;
};
const fe = flat(en), fz = flat(zh);
const ke = Object.keys(fe).sort(), kz = Object.keys(fz).sort();
const missing = ke.filter(k => !(k in fz));
const extra = kz.filter(k => !(k in fe));
console.log(`en 叶子键数: ${ke.length}, zh-CN 叶子键数: ${kz.length}`);
if (missing.length) fail(`缺失 ${missing.length} 键: ${missing.slice(0, 10).join(', ')} ...`);
if (extra.length) fail(`多出 ${extra.length} 键: ${extra.slice(0, 10).join(', ')} ...`);

// 值类型一致（防止字符串写成对象等）
for (const k of ke) if (k in fz && typeof fe[k] !== typeof fz[k]) fail(`类型不一致: ${k}`);

// 3) 占位符集合一致（{xxx} 与 <tag> 标签）
const ph = (s) => (String(s).match(/\{[^{}]+\}/g) || []).sort().join(',');
const tags = (s) => (String(s).match(/<\/?[a-zA-Z][^>]*>/g) || []).sort().join(',');
for (const k of ke) {
  if (!(k in fz)) continue;
  const a = ph(fe[k]), b = ph(fz[k]);
  if (a !== b) fail(`占位符不一致: ${k}\n  en: "${a}"\n  zh: "${b}"`);
  const ta = tags(fe[k]), tb = tags(fz[k]);
  if (ta !== tb) fail(`HTML 标签不一致: ${k}\n  en: "${ta}"\n  zh: "${tb}"`);
}

// 空/纯符号值原样保留
const symbolOnly = (s) => String(s).length === 0 || /^[0-9%\sA-Za-z0-9*/+.-]*$/.test(String(s)) && String(s).trim() === '' || /^[%]$/.test(String(s));
for (const k of ke) if (k in fz && fe[k] === '' && fz[k] !== '') fail(`空串被改动: ${k}`);

// 4) 术语抽样对照（15 项）
const sample = [
  'BRP.StatsPow', 'BRP.StatsCha', 'BRP.health', 'BRP.pp', 'BRP.sanity', 'BRP.sanLoss',
  'BRP.madness.tempInsane', 'BRP.madness.permaInsane', 'BRP.madness.traitTypes.X', 'BRP.luck.label',
  'BRP.critical', 'BRP.special', 'BRP.opposed', 'BRP.dmgBonus', 'BRP.skillcat'
];
console.log('\n===== 术语抽样对照 =====');
const pick = [
  ['BRP.StatsPow', '特征 POW'], ['BRP.StatsCha', '特征 APP/外貌'], ['BRP.health', '生命值'],
  ['BRP.pp', 'Power Points'], ['BRP.sanity', '理智值'], ['BRP.sanLoss', 'SAN loss'],
  ['BRP.madness.tempInsane', '临时疯狂'], ['BRP.madness.permaInsane', '永久疯狂'],
  ['BRP.traitTypes.phobia', '恐惧症'], ['BRP.traitTypes.mania', '躁狂症'],
  ['BRP.luck.label', '幸运'], ['BRP.critical', '大成功'], ['BRP.special', '特殊成功'],
  ['BRP.opposed', '对抗检定'], ['BRP.dmgBonus', '伤害加值']
];
for (const [k, note] of pick) {
  const z = k.split('.').reduce((o, x) => o?.[x], zh);
  const e = k.split('.').reduce((o, x) => o?.[x], en);
  console.log(`${k.padEnd(34)} ${String(e).padEnd(26)} -> ${z}   (${note})`);
}

console.log(failed === 0
  ? '\n[PASS] 四项校验全部通过：JSON 合法无 BOM / 键集一致 / 占位符与 HTML 标签一致 / 抽样如上'
  : `\n[FAIL] 共 ${failed} 处问题`);
process.exit(failed === 0 ? 0 : 1);
