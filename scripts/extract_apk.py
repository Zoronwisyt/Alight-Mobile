#!/usr/bin/env python3
"""
Alight Motion 5.0.280 APK Static Reverse-Engineering Extractor
Reconstructs UI tokens, layouts, vector icons, 315 GLSL/JS effects, 13 preset packs,
20 procedural shapes, and bundled fonts/textures from the unpacked APK directory.
"""
import glob
import json
import os
import re
import shutil
import struct
import xml.etree.ElementTree as ET
from pathlib import Path

APK_DIR = Path(r"C:\Users\jeduc\Downloads\AM Web 2\Alight_Motion_5.0.280_1789568706_latestmodapks.com")
ROOT_DIR = Path(__file__).resolve().parent.parent
GEN_DIR = ROOT_DIR / "src" / "generated"
PUBLIC_AM_DIR = ROOT_DIR / "public" / "am"


def read_str_pool(buf: bytes, off: int) -> tuple[list[str], int]:
    ctype, hsize, size = struct.unpack_from("<HHI", buf, off)
    str_cnt, style_cnt, flags, str_start, style_start = struct.unpack_from("<IIIII", buf, off + 8)
    is_utf8 = bool(flags & (1 << 8))
    offsets = struct.unpack_from(f"<{str_cnt}I", buf, off + hsize)
    base = off + str_start
    strings: list[str] = []
    for o in offsets:
        p = base + o
        if is_utf8:
            b = buf[p]
            p += 1
            if b & 0x80:
                p += 1
            b = buf[p]
            p += 1
            if b & 0x80:
                b2 = buf[p]
                p += 1
                blen = ((b & 0x7F) << 8) | b2
            else:
                blen = b
            strings.append(buf[p : p + blen].decode("utf-8", errors="replace"))
        else:
            u = struct.unpack_from("<H", buf, p)[0]
            p += 2
            if u & 0x8000:
                u2 = struct.unpack_from("<H", buf, p)[0]
                p += 2
                u = ((u & 0x7FFF) << 16) | u2
            strings.append(buf[p : p + u * 2].decode("utf-16le", errors="replace"))
    return strings, off + size


def parse_arsc(arsc_path: Path) -> dict:
    data = arsc_path.read_bytes()
    ctype, hsize, total_size = struct.unpack_from("<HHI", data, 0)
    global_strings, pos = read_str_pool(data, hsize)

    colors: dict[str, str] = {}
    strings_map: dict[str, str] = {}
    dimens: dict[str, str] = {}
    res_id_to_name: dict[int, str] = {}
    color_by_id: dict[int, str] = {}

    def fmt_dimen(vdata: int) -> str:
        unit_idx = vdata & 0xF
        radix = (vdata >> 4) & 0x3
        mantissa = struct.unpack("<i", struct.pack("<I", vdata))[0] >> 8
        shifts = [0, 7, 15, 23]
        val = mantissa / float(1 << shifts[radix])
        units = ["px", "dp", "sp", "pt", "in", "mm"]
        u = units[unit_idx] if unit_idx < len(units) else "dp"
        return f"{val:g}{u}"

    while pos < len(data):
        ct, hs, sz = struct.unpack_from("<HHI", data, pos)
        if sz == 0:
            break
        if ct == 0x0200:  # RES_TABLE_PACKAGE_TYPE
            pkg_id = struct.unpack_from("<I", data, pos + 8)[0]
            type_str_off, _, key_str_off, _ = struct.unpack_from("<IIII", data, pos + 268)
            type_strings, _ = read_str_pool(data, pos + type_str_off)
            key_strings, _ = read_str_pool(data, pos + key_str_off)

            sub = pos + hs
            end = pos + sz
            while sub < end:
                sct, shs, ssz = struct.unpack_from("<HHI", data, sub)
                if ssz == 0:
                    break
                if sct == 0x0201:  # RES_TABLE_TYPE_TYPE
                    tid = data[sub + 8]
                    flags = data[sub + 9]
                    entry_cnt, entries_start = struct.unpack_from("<II", data, sub + 12)
                    lang = data[sub + 28 : sub + 30]
                    tname = type_strings[tid - 1] if 0 < tid <= len(type_strings) else f"t{tid}"
                    is_default = lang == b"\x00\x00"
                    is_sparse = bool(flags & 1)
                    is_offset16 = bool(flags & 2)

                    if not is_sparse:
                        if is_offset16:
                            raw_offs = struct.unpack_from(f"<{entry_cnt}H", data, sub + shs)
                            eoffs = [x * 4 if x != 0xFFFF else 0xFFFFFFFF for x in raw_offs]
                        else:
                            eoffs = struct.unpack_from(f"<{entry_cnt}I", data, sub + shs)
                        ebase = sub + entries_start
                        for idx, eo in enumerate(eoffs):
                            if eo == 0xFFFFFFFF:
                                continue
                            ep = ebase + eo
                            esize, eflags, key_idx = struct.unpack_from("<HHI", data, ep)
                            kname = key_strings[key_idx] if key_idx < len(key_strings) else f"k{key_idx}"
                            res_id = (pkg_id << 24) | (tid << 16) | idx
                            if res_id not in res_id_to_name:
                                res_id_to_name[res_id] = f"{tname}/{kname}"
                            if eflags & 1:
                                continue
                            _, _, vtype, vdata = struct.unpack_from("<HBBI", data, ep + esize)
                            if tname == "color" and vtype in (0x1C, 0x1D, 0x1E, 0x1F):
                                hex_argb = f"#{vdata:08X}"
                                if res_id not in color_by_id or is_default:
                                    color_by_id[res_id] = hex_argb
                                if is_default and kname not in colors:
                                    colors[kname] = hex_argb
                            elif tname == "string" and vtype == 0x03 and is_default:
                                if kname not in strings_map and vdata < len(global_strings):
                                    strings_map[kname] = global_strings[vdata]
                            elif tname == "dimen" and vtype == 0x05 and is_default:
                                if kname not in dimens:
                                    dimens[kname] = fmt_dimen(vdata)
                sub += ssz
        pos += sz

    return {
        "colors": colors,
        "strings": strings_map,
        "dimens": dimens,
        "resIdToName": {f"0x{k:08x}": v for k, v in res_id_to_name.items()},
        "colorById": color_by_id,
    }


def argb_to_css(argb: str) -> str:
    if not argb.startswith("#") or len(argb) != 9:
        return argb
    a = int(argb[1:3], 16)
    rgb = argb[3:9]
    if a == 255:
        return f"#{rgb}"
    r = int(rgb[0:2], 16)
    g = int(rgb[2:4], 16)
    b = int(rgb[4:6], 16)
    return f"rgba({r},{g},{b},{a / 255.0:.3f})"


def parse_axml_tree(path: Path, res_id_to_name: dict[str, str], color_by_id: dict[int, str]) -> dict | None:
    data = path.read_bytes()
    if len(data) < 8:
        return None
    pos = 8
    strings: list[str] = []
    root = None
    stack: list[dict] = []

    while pos + 8 <= len(data):
        ctype, hsize, size = struct.unpack_from("<HHI", data, pos)
        if size == 0 or pos + size > len(data):
            break
        if ctype == 0x0001:  # STRING_POOL
            strings, _ = read_str_pool(data, pos)
        elif ctype == 0x0102:  # START_ELEMENT
            _, name_idx = struct.unpack_from("<II", data, pos + 16)
            attr_start, attr_size, attr_cnt = struct.unpack_from("<HHH", data, pos + 24)
            tag = strings[name_idx] if name_idx < len(strings) else "node"
            attrs: dict[str, str] = {}
            ap = pos + hsize + attr_start
            for _ in range(attr_cnt):
                _, aname, _, _, _, atype, adata = struct.unpack_from("<IIIHBBI", data, ap)
                an = strings[aname] if aname < len(strings) else f"a{aname}"
                if atype == 0x03 and adata < len(strings):
                    av = strings[adata]
                elif atype == 0x04:
                    fval = struct.unpack("<f", struct.pack("<I", adata))[0]
                    av = f"{fval:g}"
                elif atype == 0x01:
                    if adata in color_by_id:
                        av = argb_to_css(color_by_id[adata])
                    elif adata == 0x0106000B:  # @android:color/white
                        av = "#FFFFFF"
                    elif adata == 0x0106000C:  # @android:color/black
                        av = "#000000"
                    elif adata == 0x0106000D:  # @android:color/transparent
                        av = "transparent"
                    else:
                        hex_id = f"0x{adata:08x}"
                        av = "@" + res_id_to_name.get(hex_id, hex_id)
                elif atype in (0x1C, 0x1D, 0x1E, 0x1F):
                    av = argb_to_css(f"#{adata:08X}")
                elif atype == 0x05:
                    unit_idx = adata & 0xF
                    radix = (adata >> 4) & 0x3
                    mantissa = struct.unpack("<i", struct.pack("<I", adata))[0] >> 8
                    val = mantissa / float(1 << [0, 7, 15, 23][radix])
                    units = ["px", "dp", "sp", "pt", "in", "mm"]
                    av = f"{val:g}{units[unit_idx] if unit_idx < 6 else 'dp'}"
                elif atype == 0x12:
                    av = "true" if adata != 0 else "false"
                elif atype in (0x10, 0x11):
                    sval = struct.unpack("<i", struct.pack("<I", adata))[0]
                    av = str(sval)
                else:
                    av = f"{atype}:{adata}"
                attrs[an] = av
                ap += attr_size
            node = {"tag": tag, "attrs": attrs, "children": []}
            if stack:
                stack[-1]["children"].append(node)
            else:
                root = node
            stack.append(node)
        elif ctype == 0x0103:  # END_ELEMENT
            if stack:
                stack.pop()
        pos += size
    return root


def extract_vector_icons(arsc: dict) -> dict:
    icons: dict[str, dict] = {}
    res_map = arsc["resIdToName"]
    color_by_id = arsc["colorById"]
    drawable_dirs = [
        APK_DIR / "res" / "drawable",
        APK_DIR / "res" / "drawable-anydpi",
    ]

    def collect_paths(node: dict, group_tf: dict, out_paths: list):
        tag = node["tag"]
        a = node["attrs"]
        if tag == "group":
            g = {
                "tx": float(a.get("translateX", 0) or 0),
                "ty": float(a.get("translateY", 0) or 0),
                "sx": float(a.get("scaleX", 1) or 1),
                "sy": float(a.get("scaleY", 1) or 1),
                "rot": float(a.get("rotation", 0) or 0),
                "px": float(a.get("pivotX", 0) or 0),
                "py": float(a.get("pivotY", 0) or 0),
            }
            for ch in node["children"]:
                collect_paths(ch, g, out_paths)
        elif tag == "path":
            d = a.get("pathData")
            if not d:
                return
            entry: dict = {"d": d}
            if "fillColor" in a:
                fc = a["fillColor"]
                entry["fill"] = "currentColor" if fc.upper() in ("#FFFFFF", "#FFFFFFFF") else fc
            if "strokeColor" in a:
                sc = a["strokeColor"]
                entry["stroke"] = "currentColor" if sc.upper() in ("#FFFFFF", "#FFFFFFFF") else sc
            if "strokeWidth" in a:
                entry["sw"] = float(a["strokeWidth"])
            if "fillAlpha" in a:
                entry["fa"] = float(a["fillAlpha"])
            if "strokeAlpha" in a:
                entry["sa"] = float(a["strokeAlpha"])
            if a.get("fillType") == "1":
                entry["fr"] = "evenodd"
            if "strokeLineCap" in a:
                cap_map = {"0": "butt", "1": "round", "2": "square"}
                entry["lc"] = cap_map.get(a["strokeLineCap"], "butt")
            if "strokeLineJoin" in a:
                join_map = {"0": "miter", "1": "round", "2": "bevel"}
                entry["lj"] = join_map.get(a["strokeLineJoin"], "miter")
            if group_tf and any(
                [
                    group_tf["tx"] != 0,
                    group_tf["ty"] != 0,
                    group_tf["rot"] != 0,
                    group_tf["sx"] != 1,
                    group_tf["sy"] != 1,
                ]
            ):
                entry["g"] = group_tf
            out_paths.append(entry)
        else:
            for ch in node["children"]:
                collect_paths(ch, group_tf, out_paths)

    for ddir in drawable_dirs:
        if not ddir.exists():
            continue
        for p in sorted(ddir.glob("*.xml")):
            name = p.stem
            if not (name.startswith("ic_") or name.startswith("am_") or name.startswith("shape_") or name.startswith("btn_")):
                continue
            try:
                tree = parse_axml_tree(p, res_map, color_by_id)
            except Exception:
                continue
            if not tree or tree["tag"] != "vector":
                continue
            va = tree["attrs"]
            try:
                vw = float(va.get("viewportWidth", "24"))
                vh = float(va.get("viewportHeight", "24"))
            except ValueError:
                vw, vh = 24.0, 24.0
            paths: list[dict] = []
            collect_paths(tree, None, paths)
            if paths:
                icons[name] = {"vb": [vw, vh], "paths": paths}
    return icons


def extract_layouts(arsc: dict) -> dict:
    layout_dir = APK_DIR / "res" / "layout"
    target_layouts = [
        "activity_home_screen.xml",
        "activity_project_list.xml",
        "activity_edit.xml",
        "activity_edit_actionbar.xml",
        "activity_edit_playbar.xml",
        "activity_edit_addpopup.xml",
        "activity_edit_selectbar.xml",
        "fragment_element_props.xml",
        "fragment_move_transform.xml",
        "fragment_effects.xml",
        "fragment_effect_settings.xml",
        "fragment_blending_opacity.xml",
        "fragment_color_and_fill.xml",
        "fragment_border_and_shadow.xml",
        "fragment_animation_curve.xml",
        "fragment_camera_options.xml",
        "fragment_live_shape.xml",
        "fragment_edit_points2.xml",
        "fragment_text_edit.xml",
        "fragment_drawing.xml",
        "fragment_speed_keyframe.xml",
        "effect_browser_activity.xml",
        "export_list_popup_frag.xml",
        "activity_colorpicker.xml",
        "timeline_item.xml",
        "timeline_header.xml",
    ]
    out = {}
    for fn in target_layouts:
        p = layout_dir / fn
        if p.exists():
            tree = parse_axml_tree(p, arsc["resIdToName"], arsc["colorById"])
            if tree:
                out[fn] = tree
    return out


def resolve_am_string(raw: str | None, arsc_strings: dict[str, str], inline_strings: dict[str, str]) -> str:
    if not raw:
        return ""
    if raw.startswith("@am:string/"):
        key = raw[len("@am:string/") :]
        if key in arsc_strings:
            return arsc_strings[key]
        if key in inline_strings:
            return inline_strings[key]
        return key.replace("effect_param_", "").replace("effect_", "").replace("_", " ").strip().title()
    if raw.startswith("@string/"):
        key = raw[len("@string/") :]
        if key in inline_strings:
            return inline_strings[key]
        if key in arsc_strings:
            return arsc_strings[key]
        return key.replace("_", " ").strip().title()
    return raw


def parse_inline_strings(root: ET.Element) -> dict[str, str]:
    out: dict[str, str] = {}
    s_el = root.find("strings")
    if s_el is None:
        return out
    for loc in s_el.findall("locale"):
        if loc.attrib.get("lang", "en") == "en":
            for item in loc.findall("string"):
                if "name" in item.attrib and item.text:
                    out[item.attrib["name"]] = item.text.strip()
    if not out:
        for loc in s_el.findall("locale"):
            for item in loc.findall("string"):
                if "name" in item.attrib and item.text:
                    out[item.attrib["name"]] = item.text.strip()
    return out


def extract_effects(arsc_strings: dict[str, str], thumb_files: set[str]) -> list[dict]:
    effects_dir = APK_DIR / "assets" / "effects"
    effects: list[dict] = []
    for p in sorted(effects_dir.glob("*.xml")):
        root = ET.parse(p).getroot()
        inline = parse_inline_strings(root)
        attrs = root.attrib
        params: list[dict] = []
        params_el = root.find("params")
        if params_el is not None:
            for pm in params_el:
                pa = dict(pm.attrib)
                item: dict = {"tag": pm.tag}
                for k, v in pa.items():
                    if k in ("label", "text"):
                        item[k] = resolve_am_string(v, arsc_strings, inline)
                    else:
                        item[k] = v
                if pm.tag == "selector":
                    choices = []
                    for ch in pm.findall("choice"):
                        choices.append(
                            {
                                "label": resolve_am_string(ch.attrib.get("label", ""), arsc_strings, inline),
                                "value": ch.attrib.get("value", "0"),
                                "enableTargets": ch.attrib.get("enableTargets", ""),
                            }
                        )
                    item["choices"] = choices
                params.append(item)

        passes = []
        passes_el = root.find("passes")
        if passes_el is not None:
            for ps in passes_el:
                passes.append(dict(ps.attrib))

        it_el = root.find("iterations")
        iterations = it_el.attrib.get("param") if it_el is not None else None

        shaders = []
        for sh in root.findall("shader"):
            shaders.append(
                {
                    "type": sh.attrib.get("type", "fragment"),
                    "precision": sh.attrib.get("precision", "high"),
                    "group": sh.attrib.get("group"),
                    "fastMath": sh.attrib.get("fastMath") != "false",
                    "code": (sh.text or "").strip(),
                }
            )

        sc_el = root.find("script")
        script = (sc_el.text or "").strip() if sc_el is not None and sc_el.text else None

        eff_name = resolve_am_string(attrs.get("name", p.stem), arsc_strings, inline)
        slug = re.sub(r"[^a-z0-9]+", "_", eff_name.lower()).strip("_")
        raw_thumb = attrs.get("thumb", "")
        if raw_thumb.startswith("thumb/"):
            raw_thumb = raw_thumb[len("thumb/") :]
        resolved_thumb = ""
        resolved_thumb_bg = ""
        if f"{slug}.webp" in thumb_files:
            resolved_thumb = f"{slug}.webp"
            if f"{slug}_bg.webp" in thumb_files:
                resolved_thumb_bg = f"{slug}_bg.webp"
        elif raw_thumb in thumb_files:
            resolved_thumb = raw_thumb

        effects.append(
            {
                "id": attrs.get("id", p.stem),
                "file": p.name,
                "name": eff_name,
                "desc": resolve_am_string(attrs.get("desc", ""), arsc_strings, inline),
                "category": attrs.get("category", "other"),
                "tags": [t.strip() for t in attrs.get("tags", "").split(",") if t.strip()],
                "thumb": resolved_thumb,
                "thumbBg": resolved_thumb_bg,
                "deprecated": attrs.get("deprecated") == "true",
                "experimental": attrs.get("experimental") == "true",
                "internal": attrs.get("internal") == "true",
                "overdraw": attrs.get("overdraw") == "true",
                "maxOverdraw": float(attrs.get("max-overdraw") or attrs.get("maxOverdraw") or 0),
                "autoTransform": attrs.get("auto-transform") == "true",
                "compat": attrs.get("compat") or None,
                "afxver": attrs.get("afxver") or None,
                "affinity": attrs.get("affinity", ""),
                "type": attrs.get("type", ""),
                "params": params,
                "passes": passes,
                "iterations": iterations,
                "shaders": shaders,
                "script": script,
            }
        )
    return effects


def extract_presets() -> dict[str, list[dict]]:
    presets_dir = APK_DIR / "assets" / "effects" / "presets"
    by_effect: dict[str, list[dict]] = {}
    for p in sorted(presets_dir.glob("*.xml")):
        try:
            root = ET.parse(p).getroot()
        except Exception:
            continue
        pack_title = root.attrib.get("title", p.stem)
        for sh in root.findall("shape"):
            shape_label = sh.attrib.get("label", "Preset")
            for eff in sh.findall("effect"):
                eid = eff.attrib.get("id")
                if not eid:
                    continue
                props = []
                for prop in eff.findall("property"):
                    pname = prop.attrib.get("name")
                    ptype = prop.attrib.get("type", "float")
                    if not pname:
                        continue
                    kfs = []
                    for kf in prop.findall("kf"):
                        kfs.append(
                            {
                                "t": float(kf.attrib.get("t", "0")),
                                "v": kf.attrib.get("v", ""),
                                "e": kf.attrib.get("e", ""),
                            }
                        )
                    props.append(
                        {
                            "name": pname,
                            "type": ptype,
                            "value": prop.attrib.get("value"),
                            "kfs": kfs,
                        }
                    )
                by_effect.setdefault(eid, []).append(
                    {
                        "name": shape_label,
                        "pack": pack_title,
                        "locallyApplied": eff.attrib.get("locallyApplied") == "true",
                        "props": props,
                    }
                )
    return by_effect


def extract_shapes(arsc_strings: dict[str, str]) -> list[dict]:
    shapes_dir = APK_DIR / "assets" / "shapes"
    shapes: list[dict] = []
    for p in sorted(shapes_dir.glob("*.xml")):
        root = ET.parse(p).getroot()
        inline = parse_inline_strings(root)
        params = []
        params_el = root.find("params")
        if params_el is not None:
            for pm in params_el:
                item = {"tag": pm.tag}
                for k, v in pm.attrib.items():
                    if k in ("label", "text"):
                        item[k] = resolve_am_string(v, arsc_strings, inline)
                    else:
                        item[k] = v
                params.append(item)
        handles = [dict(h.attrib) for h in root.findall("handle")]
        sc_el = root.find("script")
        script = (sc_el.text or "").strip() if sc_el is not None and sc_el.text else ""
        shapes.append(
            {
                "id": root.attrib.get("id", p.stem),
                "file": p.name,
                "name": resolve_am_string(root.attrib.get("name", p.stem), arsc_strings, inline),
                "params": params,
                "handles": handles,
                "script": script,
            }
        )
    return shapes


def copy_static_assets():
    copies = [
        (APK_DIR / "res" / "font", PUBLIC_AM_DIR / "fonts"),
        (APK_DIR / "assets" / "effects" / "thumb", PUBLIC_AM_DIR / "thumb"),
        (APK_DIR / "assets" / "effects" / "resource", PUBLIC_AM_DIR / "resource"),
        (APK_DIR / "assets" / "effects" / "textures", PUBLIC_AM_DIR / "textures"),
        (APK_DIR / "assets" / "shaders", PUBLIC_AM_DIR / "shaders"),
    ]
    counts = {}
    for src, dst in copies:
        dst.mkdir(parents=True, exist_ok=True)
        n = 0
        if src.exists():
            for item in src.iterdir():
                if item.is_file():
                    shutil.copy2(item, dst / item.name)
                    n += 1
        counts[dst.name] = n
    return counts


def main():
    GEN_DIR.mkdir(parents=True, exist_ok=True)
    PUBLIC_AM_DIR.mkdir(parents=True, exist_ok=True)

    print("[1/7] Parsing resources.arsc ...")
    arsc = parse_arsc(APK_DIR / "resources.arsc")
    arsc_tokens = {
        "colors": {k: argb_to_css(v) for k, v in arsc["colors"].items()},
        "colorsRaw": arsc["colors"],
        "strings": arsc["strings"],
        "dimens": arsc["dimens"],
    }
    (GEN_DIR / "arsc_tokens.json").write_text(json.dumps(arsc_tokens, indent=2), encoding="utf-8")
    print(f"      -> {len(arsc['colors'])} colors, {len(arsc['strings'])} strings, {len(arsc['dimens'])} dimens")

    print("[2/7] Decoding AXML UI layouts ...")
    layouts = extract_layouts(arsc)
    (GEN_DIR / "layout_inventory.json").write_text(json.dumps(layouts, indent=2), encoding="utf-8")
    print(f"      -> {len(layouts)} layouts decoded")

    print("[3/7] Decoding binary vector drawables ...")
    icons = extract_vector_icons(arsc)
    (GEN_DIR / "icons.json").write_text(json.dumps(icons, separators=(",", ":")), encoding="utf-8")
    print(f"      -> {len(icons)} vector icons extracted")

    print("[4/7] Copying fonts, thumbnails, textures, and base shaders ...")
    copied = copy_static_assets()
    thumb_files = {p.name for p in (PUBLIC_AM_DIR / "thumb").iterdir() if p.is_file()}
    print(f"      -> copied: {copied}")

    print("[5/7] Extracting 315 effects ...")
    effects = extract_effects(arsc["strings"], thumb_files)
    (PUBLIC_AM_DIR / "effects.json").write_text(json.dumps(effects, separators=(",", ":")), encoding="utf-8")
    unresolved = sum(1 for e in effects if "@" in e["name"] or "@" in e["desc"])
    matched_thumbs = sum(1 for e in effects if e["thumb"])
    print(f"      -> {len(effects)} effects extracted (unresolved labels: {unresolved}, matched thumbs: {matched_thumbs})")

    print("[6/7] Extracting effect presets ...")
    presets = extract_presets()
    (PUBLIC_AM_DIR / "presets.json").write_text(json.dumps(presets, separators=(",", ":")), encoding="utf-8")
    total_presets = sum(len(v) for v in presets.values())
    print(f"      -> {total_presets} presets across {len(presets)} effects")

    print("[7/7] Extracting procedural shapes ...")
    shapes = extract_shapes(arsc["strings"])
    (PUBLIC_AM_DIR / "shapes.json").write_text(json.dumps(shapes, separators=(",", ":")), encoding="utf-8")
    print(f"      -> {len(shapes)} shapes extracted")


if __name__ == "__main__":
    main()
