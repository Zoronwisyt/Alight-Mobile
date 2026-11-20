// am_class_dump.mjs — compact member inventory printer for REA class Evidence.
//
// usage: node am_class_dump.mjs <class_*.json> [more...]
//
// REA's class Evidence reports members as { name, reported_type, dex_static_value }
// for fields and { name, reported_signature, overload_index, dex_descriptor } for
// methods. Synthetic members are filtered so an R8-heavy class stays readable.
import { readFileSync } from 'node:fs';

const SYNTHETIC = /^\$|^access\$|^component\d+$|^copy(\$default)?$|^equals$|^hashCode$|^toString$/;

for (const path of process.argv.slice(2)) {
  let doc;
  try {
    doc = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    console.log(`${path}: unreadable (${err.message})`);
    continue;
  }
  const cls = doc.class_name ?? doc.name ?? path;
  console.log(`\n=== ${cls} ===`);
  if (doc.superclass) console.log(`extends ${doc.superclass}`);
  if (doc.interfaces?.length) console.log(`implements ${doc.interfaces.join(', ')}`);

  const fields = (doc.fields ?? []).filter((f) => !SYNTHETIC.test(f.name));
  const methods = (doc.methods ?? []).filter((m) => !SYNTHETIC.test(m.name));

  console.log(`-- fields (${fields.length}/${doc.fields?.length ?? 0}) --`);
  for (const f of fields) {
    const v = f.dex_static_value === null || f.dex_static_value === undefined
      ? ''
      : ` = ${JSON.stringify(f.dex_static_value)}`;
    console.log(`  ${String(f.reported_type ?? '?').padEnd(40)} ${f.name}${v}`);
  }
  console.log(`-- methods (${methods.length}/${doc.methods?.length ?? 0}) --`);
  for (const m of methods) {
    console.log(`  ${m.reported_signature}`);
  }
}
