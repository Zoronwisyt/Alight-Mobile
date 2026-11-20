// Assertion suite for the bulk font-ZIP planner.
//
// Builds a real archive with JSZip — fonts, a nested folder, a readme, a macOS
// resource fork, a hidden lockfile — then checks that planFontArchive() extracts
// exactly the font entries, in deterministic order, and nothing else.
//
// The browser-side import (FontFace + IndexedDB) is not exercised here on purpose:
// this covers the untrusted-input decision, which is the part that can go wrong
// silently. The registration path is shared with single-file import.
//
// Run: esbuild → node, same as scripts/audit/check_blend_modes.ts.

import JSZip from 'jszip';
import { planFontArchive } from '../../src/engine/fontZipImport';

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail === undefined ? '' : ` :: ${JSON.stringify(detail)}`}`);
  }
}

const zip = new JSZip();
zip.file('Inter/Inter-Regular.ttf', new Uint8Array([0, 1, 0, 0]));
zip.file('Inter/Inter-Bold.ttf', new Uint8Array([0, 1, 0, 0]));
zip.file('Inter/Inter-Italic.OTF', new Uint8Array([0, 1, 0, 0]));
zip.file('Montserrat/Montserrat.woff2', new Uint8Array([1, 2, 3]));
zip.file('legacy/Thing.woff', new Uint8Array([4, 5, 6]));
zip.file('collection/Family.ttc', new Uint8Array([7, 8, 9]));
zip.file('README.txt', 'not a font');
zip.file('LICENSE', 'not a font');
zip.file('__MACOSX/Inter/._Inter-Regular.ttf', new Uint8Array([0]));
zip.file('Inter/.DS_Store', new Uint8Array([0]));
zip.file('fonts.zip', new Uint8Array([0]));
zip.folder('Empty');

const archive = await zip.generateAsync({ type: 'uint8array' });
const reopened = await JSZip.loadAsync(archive);
const allPaths = Object.keys(reopened.files).filter((p) => !reopened.files[p].dir);

const { fontPaths, skipped } = planFontArchive(allPaths);

console.log('plan');
check('six font entries survive', fontPaths.length === 6, fontPaths);
check(
  'only font extensions remain',
  fontPaths.every((p) => /\.(ttf|otf|woff2?|ttc)$/i.test(p)),
  fontPaths
);
check('nested paths are preserved', fontPaths.includes('Inter/Inter-Regular.ttf'));
check('uppercase .OTF is accepted', fontPaths.includes('Inter/Inter-Italic.OTF'));
check('macOS resource fork excluded', !fontPaths.some((p) => p.startsWith('__MACOSX/')));
check('dotfile excluded', !fontPaths.some((p) => p.includes('.DS_Store')));
check('readme/license counted as skipped', skipped >= 3, skipped);
check('sorted deterministically', JSON.stringify(fontPaths) === JSON.stringify([...fontPaths].sort((a, b) => a.localeCompare(b))), fontPaths);

console.log('empty archive');
const empty = planFontArchive([]);
check('no fonts, no crash', empty.fontPaths.length === 0 && empty.skipped === 0);

console.log('all-junk archive');
const junk = planFontArchive(['__MACOSX/a.ttf', '.hidden.ttf', 'readme.md']);
check('junk archive yields zero fonts', junk.fontPaths.length === 0, junk);

console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
