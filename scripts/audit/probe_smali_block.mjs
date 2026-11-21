// Print the smali construction block for one enum constant.
// Usage: node probe_smali_block.mjs <file> <CONSTANT_NAME>
import { readFileSync } from 'node:fs';

const [, , file, name] = process.argv;
const lines = readFileSync(file, 'utf8').split(/\r?\n/);
const needle = `"${name}"`;
const at = lines.findIndex((l) => l.includes(needle));
if (at < 0) {
  console.log(`not found: ${needle}`);
  process.exit(1);
}
console.log(`${name} at line ${at + 1}`);
console.log(lines.slice(Math.max(0, at - 4), at + 16).map((s) => s.trim()).filter(Boolean).join('\n'));
