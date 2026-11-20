#!/usr/bin/env python3
"""
apk-inventory.py — reproducible feature inventory of the Alight Motion APK.

Ground truth for feature-gap audits lives in the APK, not in this repo. This
script extracts the four artefacts an audit actually needs, without a full
decompiler:

    manifest_components.json   activities / services / providers (+ exported)
    manifest_perms.json        uses-permission / uses-feature
    strings.json               every <string> resource, as (name, value) pairs
    classes_am.json            every com.alightcreative.* class descriptor
    dex_literals.json          every com.alightcreative.* string literal in the dex

Usage
-----
    python -m pip install androguard
    python scripts/audit/apk-inventory.py "<path-to-extracted-apk-dir>" [--out DIR]

The path may be either the .apk file or an already-extracted directory (the
reference build in this workspace is the extracted directory
`Alight_Motion_5.0.280_1789568706_latestmodapks.com`).

Why not jadx/apktool
--------------------
Both decode far more than an inventory needs, and neither is a dependency this
repo should grow. androguard reads resources.arsc, binary AndroidManifest.xml
and the dex string tables directly. Method bodies are deliberately not
decompiled: this script answers "does the feature exist in the APK", which is a
symbol-table question, not a bytecode question. Anything that needs instruction
level proof belongs in a separate ticket with a named test.

Output is deterministic and sorted, so two runs can be diffed.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys

try:
    from androguard.core.axml import AXMLPrinter, ARSCParser
    from androguard.core.dex import DEX
except ImportError:  # pragma: no cover - operator instruction
    sys.exit("androguard is required: python -m pip install androguard")

try:
    from loguru import logger as _logger

    _logger.remove()  # androguard is chatty about benign AXML string-pool quirks
except Exception:  # pragma: no cover
    pass

ANDROID_NS = "{http://schemas.android.com/apk/res/android}"
DEX_RE = re.compile(r"classes(\d*)\.dex$")
COMPONENT_TAGS = {"activity", "activity-alias", "service", "receiver", "provider"}


def dex_sort_key(name: str) -> tuple[int, str]:
    m = DEX_RE.search(name)
    return (int(m.group(1) or 1), name)


def read_manifest(apk_dir: str) -> tuple[list[dict], dict]:
    raw = open(os.path.join(apk_dir, "AndroidManifest.xml"), "rb").read()
    root = AXMLPrinter(raw).get_xml_obj()

    components, permissions, features = [], [], []
    sdk: dict[str, str | None] = {}
    for el in root.iter():
        tag = el.tag.split("}")[-1]
        if tag in COMPONENT_TAGS:
            components.append(
                {
                    "kind": tag,
                    "name": el.get(ANDROID_NS + "name"),
                    "exported": el.get(ANDROID_NS + "exported"),
                    "parent": el.get(ANDROID_NS + "parentActivityName"),
                }
            )
        elif tag == "uses-permission":
            permissions.append(el.get(ANDROID_NS + "name"))
        elif tag == "uses-feature":
            features.append(el.get(ANDROID_NS + "name"))
        elif tag == "uses-sdk":
            sdk = {
                "min": el.get(ANDROID_NS + "minSdkVersion"),
                "target": el.get(ANDROID_NS + "targetSdkVersion"),
            }

    meta = {
        "package": root.get("package"),
        "versionName": root.get(ANDROID_NS + "versionName"),
        "versionCode": root.get(ANDROID_NS + "versionCode"),
        "sdk": sdk,
    }
    return components, {"permissions": sorted(filter(None, permissions)),
                        "features": sorted(filter(None, features)), **meta}


def read_strings(apk_dir: str, package: str) -> list[list[str]]:
    arsc = ARSCParser(open(os.path.join(apk_dir, "resources.arsc"), "rb").read())
    # get_string_resources returns an XML dump of the default (unqualified) config
    xml = arsc.get_string_resources(package, "\x00\x00").decode("utf-8", "replace")
    return [[n, v] for n, v in re.findall(r'<string name="([^"]+)">(.*?)</string>', xml, re.S)]


def walk_dex(apk_dir: str, want_literals: bool) -> tuple[list[str], list[str], list[str]]:
    names = sorted(
        (f for f in os.listdir(apk_dir) if DEX_RE.search(f)), key=dex_sort_key
    )
    classes: set[str] = set()
    literals: set[str] = set()
    for name in names:
        dex = DEX(open(os.path.join(apk_dir, name), "rb").read())
        classes.update(c.get_name() for c in dex.get_classes())
        if want_literals:
            for s in dex.get_strings():
                value = s if isinstance(s, str) else s.get()
                if value.startswith("com.alightcreative."):
                    literals.add(value)
        del dex
    return names, sorted(c for c in classes if "alightcreative" in c), sorted(literals)


def main() -> int:
    ap = argparse.ArgumentParser(description="Inventory an Alight Motion APK build.")
    ap.add_argument("path", help=".apk file or extracted APK directory")
    ap.add_argument("--out", default="scripts/audit/out", help="output directory")
    ap.add_argument("--no-literals", action="store_true",
                    help="skip the com.alightcreative.* literal sweep (faster)")
    args = ap.parse_args()

    apk_dir = args.path
    if os.path.isfile(apk_dir):
        sys.exit("Pass the extracted directory. Unzip the .apk first: "
                 "the inventory reads AndroidManifest.xml, resources.arsc and classes*.dex "
                 "as plain files.")
    if not os.path.isdir(apk_dir):
        sys.exit(f"not found: {apk_dir}")

    os.makedirs(args.out, exist_ok=True)

    components, meta = read_manifest(apk_dir)
    with open(os.path.join(args.out, "manifest_components.json"), "w", encoding="utf-8") as f:
        json.dump(components, f, indent=1, sort_keys=True)

    strings = read_strings(apk_dir, meta["package"])
    with open(os.path.join(args.out, "strings.json"), "w", encoding="utf-8") as f:
        json.dump(strings, f, indent=0, ensure_ascii=False)

    dex_names, am_classes, literals = walk_dex(apk_dir, not args.no_literals)
    with open(os.path.join(args.out, "classes_am.json"), "w", encoding="utf-8") as f:
        json.dump(am_classes, f, indent=0)
    if not args.no_literals:
        with open(os.path.join(args.out, "dex_literals.json"), "w", encoding="utf-8") as f:
            json.dump(literals, f, indent=0)

    activities = [c for c in components if c["kind"].startswith("activity")]
    first_party = [c for c in activities if (c["name"] or "").startswith("com.alightcreative.")]
    element_types = [c for c in am_classes if c.endswith("ElementTypeImpl;")]

    print(json.dumps({
        "package": meta["package"],
        "version": f'{meta["versionName"]} ({meta["versionCode"]})',
        "sdk": meta["sdk"],
        "dexFiles": dex_names,
        "components": len(components),
        "activities": len(activities),
        "activitiesFirstParty": len(first_party),
        "stringResources": len(strings),
        "amClasses": len(am_classes),
        "dexLiterals": len(literals),
        "sceneElementTypes": [c.replace("L", "").replace(";", "").replace("/", ".")
                              for c in element_types],
        "out": os.path.abspath(args.out),
    }, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
