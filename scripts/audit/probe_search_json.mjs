// Read a REA search result JSON and print the class names it matched.
import { readFileSync } from 'node:fs';

for (const file of process.argv.slice(2)) {
  const raw = readFileSync(file, 'utf8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    console.log(`${file}: not JSON`);
    continue;
  }
  const matches = data.matches ?? data.normalized_result?.matches ?? [];
  console.log(`--- ${file.split(/[\\/]/).pop()} (${matches.length}) ---`);
  for (const m of matches.slice(0, 25)) {
    console.log(`   ${m.name ?? m.qualified_name ?? JSON.stringify(m)}`);
  }
}
