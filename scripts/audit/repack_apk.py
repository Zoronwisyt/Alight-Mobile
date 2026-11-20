"""Repackage an extracted APK directory into a raw .apk ZIP for JADX/REA.

The directory is a plain extraction: AndroidManifest.xml, resources.arsc and
classes*.dex are already in their original binary form, so a stored ZIP is
byte-faithful apart from the container envelope and ordering.

usage: python repack_apk.py <extracted-dir> <out.apk>
"""
import os
import sys
import time
import zipfile

# Deterministic order: Android tooling tolerates any order, but a stable one
# keeps the container digest reproducible across runs.
ROOT_FIRST = ("AndroidManifest.xml", "resources.arsc")


def repack(src: str, out: str) -> None:
    if not os.path.isdir(src):
        raise SystemExit(f"not a directory: {src}")

    entries = []
    for dirpath, _dirnames, filenames in os.walk(src):
        for name in filenames:
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, src).replace(os.sep, "/")
            entries.append((rel, full))

    def sort_key(item):
        rel = item[0]
        if rel in ROOT_FIRST:
            return (0, ROOT_FIRST.index(rel), rel)
        if rel.startswith("classes") and rel.endswith(".dex"):
            return (1, rel, rel)
        return (2, rel, rel)

    entries.sort(key=sort_key)

    tmp = out + ".part"
    start = time.time()
    written = 0
    with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as zf:
        for rel, full in entries:
            zf.write(full, arcname=rel)
            written += 1
    os.replace(tmp, out)
    size_mb = os.path.getsize(out) / (1024 * 1024)
    print(f"entries={written} wrote={size_mb:.1f}MB elapsed={time.time() - start:.1f}s")
    print(f"out={out}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    repack(sys.argv[1], sys.argv[2])
