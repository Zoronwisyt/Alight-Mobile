#!/usr/bin/env python3
"""
Convert ONLY Video Star 3D effects (from Video Star.app .fs shaders, LayoutML3D*,
LayoutSCNEffect*, ColorCIFilter3DTunnel*, ClipMixerEffectTimedCITrans3D*,
BoogieBoxesTrans, Lighting3DML, FXInfoBGStarSphere) into Alight Motion Web
EffectDef JSON at public/am/videostar_effects.json.
"""

import json
import os
import re
from pathlib import Path
from typing import Any, Dict, List

VS_APP = Path(r"C:\Users\jeduc\Downloads\Video_Star_15.2.8_ypo6m6ff\Payload\Video Star.app")
OUT_JSON = Path(__file__).resolve().parents[2] / "public" / "am" / "videostar_effects.json"

# ---------------------------------------------------------------------------
# Shared GLSL helper snippets (GLSL ES 1.00 compatible with AM shaderCompiler.ts)
# ---------------------------------------------------------------------------

GLSL_COMMON = r"""
#define VS_PI 3.14159265359

mat3 vsRotX(float a) {
    float c = cos(a), s = sin(a);
    return mat3(1.0, 0.0, 0.0,  0.0, c, -s,  0.0, s, c);
}
mat3 vsRotY(float a) {
    float c = cos(a), s = sin(a);
    return mat3(c, 0.0, s,  0.0, 1.0, 0.0,  -s, 0.0, c);
}
mat3 vsRotZ(float a) {
    float c = cos(a), s = sin(a);
    return mat3(c, -s, 0.0,  s, c, 0.0,  0.0, 0.0, 1.0);
}
mat3 vsEuler(vec3 deg) {
    vec3 r = deg * 0.01745329252;
    return vsRotZ(r.z) * vsRotY(r.y) * vsRotX(r.x);
}
vec2 vsLayerAspect() {
    float ax = max(acLayerSize.x, 1.0);
    float ay = max(acLayerSize.y, 1.0);
    return vec2(ax / ay, ay / ax);
}
vec4 vsSample(vec2 amUv, float cropMode) {
    // cropMode: 0=clamp alpha 0 outside [0,1], 1=clamp edge, 2=mirror tile
    if (cropMode > 1.5) {
        vec2 m = abs(mod(amUv, 2.0) - 1.0);
        m = vec2(1.0) - abs(mod(amUv, 2.0) - 1.0);
        // triangle mirror in [0,1]
        vec2 w = mod(amUv, 2.0);
        w = min(w, 2.0 - w);
        return texture2DCv(inputImg.texture, (vec4(clamp(w, 0.001, 0.999), 0.0, 1.0) * acLayerToScreen).xy);
    }
    if (cropMode < 0.5) {
        if (amUv.x < 0.0 || amUv.x > 1.0 || amUv.y < 0.0 || amUv.y > 1.0) {
            return vec4(0.0);
        }
    }
    vec2 suv = clamp(amUv, 0.001, 0.999);
    return texture2DCv(inputImg.texture, (vec4(suv, 0.0, 1.0) * acLayerToScreen).xy);
}
// Video Star Lighting3DML.fs + subtle specular fill
vec4 vsLightingML(vec4 col, vec3 normalWS, vec3 viewDir, float lightStrength, vec4 lightTint, float ambientAmt) {
    if (lightStrength <= 0.001) return col;
    vec3 lDir = normalize(vec3(0.45, 0.65, 0.85));
    vec3 n = normalize(normalWS);
    float diff = max(0.0, dot(n, lDir));
    float rim = max(0.0, dot(-n, lDir)) * 0.25;
    vec3 halfV = normalize(lDir - normalize(viewDir));
    float spec = pow(max(0.0, dot(n, halfV)), 24.0) * 0.35 * lightStrength;
    vec3 lit = col.rgb * (vec3(ambientAmt) + lightTint.rgb * (diff + rim) * lightStrength) + lightTint.rgb * spec * col.a;
    return vec4(mix(col.rgb, lit, clamp(lightStrength, 0.0, 1.0)), col.a);
}
float vsHash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}
float vsNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = vsHash21(i);
    float b = vsHash21(i + vec2(1.0, 0.0));
    float c = vsHash21(i + vec2(0.0, 1.0));
    float d = vsHash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
// Ray-box intersection in local box space (box half-extents b)
// returns vec4(tNear, normal.xyz); tNear < 0 means miss
vec4 vsIntersectBox(vec3 ro, vec3 rd, vec3 b) {
    vec3 m = 1.0 / (rd + vec3(1e-6));
    vec3 n = m * ro;
    vec3 k = abs(m) * b;
    vec3 t1 = -n - k;
    vec3 t2 = -n + k;
    float tN = max(max(t1.x, t1.y), t1.z);
    float tF = min(min(t2.x, t2.y), t2.z);
    if (tN > tF || tF < 0.0) return vec4(-1.0, 0.0, 0.0, 0.0);
    vec3 nor = -sign(rd) * step(t1.yzx, t1.xyz) * step(t1.zxy, t1.xyz);
    return vec4(tN, nor);
}
vec2 vsBoxFaceUV(vec3 p, vec3 n, vec3 b) {
    vec3 q = p / max(b, vec3(0.0001));
    if (n.x > 0.5) return vec2(0.5 - q.z * 0.5, q.y * 0.5 + 0.5);
    if (n.x < -0.5) return vec2(q.z * 0.5 + 0.5, q.y * 0.5 + 0.5);
    if (n.y > 0.5) return vec2(q.x * 0.5 + 0.5, 0.5 - q.z * 0.5);
    if (n.y < -0.5) return vec2(q.x * 0.5 + 0.5, q.z * 0.5 + 0.5);
    if (n.z > 0.5) return vec2(q.x * 0.5 + 0.5, q.y * 0.5 + 0.5);
    return vec2(0.5 - q.x * 0.5, q.y * 0.5 + 0.5);
}
// Ray-quad intersection in local XY plane (half-size hw, hh), double-sided
// returns vec2(t, facingSign) or (-1, 0)
vec2 vsIntersectQuad(vec3 ro, vec3 rd, float hw, float hh) {
    if (abs(rd.z) < 1e-5) return vec2(-1.0, 0.0);
    float t = -ro.z / rd.z;
    if (t <= 0.0) return vec2(-1.0, 0.0);
    vec2 hit = ro.xy + rd.xy * t;
    if (abs(hit.x) <= hw && abs(hit.y) <= hh) {
        return vec2(t, rd.z < 0.0 ? 1.0 : -1.0);
    }
    return vec2(-1.0, 0.0);
}
"""


def p_float(pid: str, name: str, default: float, pmin: float, pmax: float, ptype: str = "slider", unit: str = "", **extra) -> Dict[str, Any]:
    d: Dict[str, Any] = {
        "tag": ptype,
        "id": pid,
        "default": str(default),
        "min": str(pmin),
        "max": str(pmax),
        "label": name,
        "step": "0.01" if (pmax - pmin) <= 20 else "0.1",
    }
    if unit == "°":
        d["type"] = "angle"
    d.update(extra)
    return d


def p_xyz(pid: str, name: str, default: str = "0.0,0.0,0.0") -> Dict[str, Any]:
    return {
        "tag": "xyz",
        "id": pid,
        "default": default,
        "label": name,
        "step": "0.1",
    }


def p_orient(pid: str = "orient", name: str = "Orientation") -> Dict[str, Any]:
    return {
        "tag": "orient",
        "id": pid,
        "label": name,
        "invert": "true",
    }


def p_color(pid: str, name: str, default: str = "#FFFFFFFF") -> Dict[str, Any]:
    return {
        "tag": "color",
        "id": pid,
        "default": default,
        "label": name,
        "alpha": "true",
    }


def p_switch(pid: str, name: str, default: bool = False) -> Dict[str, Any]:
    return {
        "tag": "switch",
        "id": pid,
        "default": "true" if default else "false",
        "label": name,
    }


def p_selector(pid: str, name: str, options: List[str], default: int = 0) -> Dict[str, Any]:
    return {
        "tag": "selector",
        "id": pid,
        "default": str(default),
        "style": "dropdown",
        "label": name,
        "choices": [
            {"label": o, "value": str(i), "enableTargets": ""}
            for i, o in enumerate(options)
        ],
    }


def p_img() -> Dict[str, Any]:
    return {
        "tag": "texture",
        "id": "inputImg",
        "srcType": "content",
    }


def p_lighting() -> List[Dict[str, Any]]:
    return [
        p_float("lightAmt", "3D Lighting", 0.75, 0.0, 2.0),
        p_float("ambientAmt", "Ambient", 0.35, 0.0, 1.0),
        p_color("lightColor", "Light Color", "#FFFFFFFF"),
    ]


def make_effect(
    eid: str,
    name: str,
    desc: str,
    params: List[Dict[str, Any]],
    frag_code: str,
    tags: List[str] | None = None,
    overdraw: bool = True,
    max_overdraw: float = 0.5,
) -> Dict[str, Any]:
    all_tags = ["videostar", "3d"] + (tags or [])
    return {
        "id": f"com.videostar.effects.{eid}",
        "file": f"videostar/{eid}.xml",
        "name": name,
        "desc": desc,
        "category": "3d",
        "tags": all_tags,
        "thumb": None,
        "thumbBg": "grid",
        "deprecated": False,
        "experimental": False,
        "internal": False,
        "overdraw": overdraw,
        "maxOverdraw": max_overdraw if overdraw else 0.0,
        "autoTransform": False,
        "compat": None,
        "afxver": None,
        "affinity": "",
        "type": "",
        "params": [p_img()] + params,
        "passes": [],
        "iterations": None,
        "shaders": [
            {
                "type": "fragment",
                "precision": None,
                "group": None,
                "fastMath": False,
                "code": GLSL_COMMON + "\n" + frag_code.strip(),
            }
        ],
        "script": None,
    }


def read_vs_shader(filename: str) -> str:
    p = VS_APP / filename
    if not p.exists():
        raise FileNotFoundError(f"Missing Video Star shader: {p}")
    return p.read_text(encoding="utf-8", errors="replace")


def wrap_vs_texcoord(fs_filename: str, body_override: str | None = None) -> str:
    """
    Wrap an authentic Video Star TexCoord*.fs function so it executes directly
    in AM WebGL2 using `textureCoordinate` (top-down UV) and outputs `vsSample()`.
    """
    src = body_override if body_override is not None else read_vs_shader(fs_filename)
    # Strip uniform lines; uniforms are declared by shaderCompiler.ts from params
    lines = []
    for line in src.splitlines():
        st = line.strip()
        if st.startswith("uniform "):
            continue
        lines.append(line)
    cleaned = "\n".join(lines)
    # Map Video Star builtins -> AM equivalents
    cleaned = cleaned.replace("uv4AspectRatio", "vsAspect4")
    cleaned = cleaned.replace("uv2Resolution", "acLayerSize")
    return cleaned


def build_effects() -> List[Dict[str, Any]]:
    effects: List[Dict[str, Any]] = []

    # =========================================================================
    # 1. AUTHENTIC VIDEO STAR GLSL 3D SHADERS (directly from Video Star.app/*.fs)
    # =========================================================================

    # 1A. VR 360 Rotate (TexCoordVRRotate.fs + Alt)
    effects.append(make_effect(
        "vr_rotate",
        "VS: VR 360 Rotate",
        "Decompiled from Video Star TexCoordVRRotate.fs / Alt.fs — spherical 360° equirectangular 3D rotation.",
        [
            p_float("ufLayoutParameter", "Roll / Pan", 0.0, -1.0, 1.0),
            p_float("ufLayoutParam2", "Yaw Offset", 0.5, 0.0, 1.0),
            p_switch("altMode", "Alt Axis Order", False),
        ],
        r"""
        void main() {
            float s = acLayerNorm.x;
            float t = 1.0 - acLayerNorm.y;
            const float pi = 3.141592653589793;
            float phi = 2.0 * pi * s;
            float theta = pi * (1.0 - t);
            float z = sin(theta) * cos(phi);
            float x = sin(theta) * sin(phi);
            float y = cos(theta);
            float rads = 2.0 * pi * (altMode ? ufLayoutParam2 : ufLayoutParameter);
            float radsY = 2.0 * pi * ((altMode ? ufLayoutParameter : ufLayoutParam2) - 0.5);
            float xx = cos(radsY) * x - sin(radsY) * z;
            float yy = y;
            float zz = sin(radsY) * x + cos(radsY) * z;
            float xxx = cos(rads) * xx - sin(rads) * yy;
            float yyy = sin(rads) * xx + cos(rads) * yy;
            float zzz = zz;
            float xxxx = cos(-radsY) * xxx - sin(-radsY) * zzz;
            float yyyy = yyy;
            float zzzz = sin(-radsY) * xxx + cos(-radsY) * zzz;
            float newPhi = atan(xxxx, zzzz);
            float newTheta = acos(clamp(yyyy, -1.0, 1.0));
            float newS = fract(newPhi / (2.0 * pi));
            float newT = fract(1.0 - newTheta / pi);
            gl_FragColor = vsSample(vec2(newS, 1.0 - newT), 1.0);
        }
        """,
        tags=["vr", "360", "sphere"],
        overdraw=False,
    ))

    # 1B. VR 360 Pitch & Roll (TexCoordVRRotateX.fs + TexCoordVRRotateZ.fs)
    effects.append(make_effect(
        "vr_rotate_xz",
        "VS: VR 360 Pitch & Roll",
        "Decompiled from Video Star TexCoordVRRotateX.fs & Z.fs — spherical 360° pitch (X) and roll (Z).",
        [
            p_float("pitchAmt", "Pitch (X)", 0.0, -1.0, 1.0),
            p_float("rollAmt", "Roll (Z)", 0.0, -1.0, 1.0),
        ],
        r"""
        void main() {
            float s = acLayerNorm.x;
            float t = 1.0 - acLayerNorm.y;
            const float pi = 3.141592653589793;
            float phi = 2.0 * pi * s;
            float theta = pi * (1.0 - t);
            float z = sin(theta) * cos(phi);
            float x = sin(theta) * sin(phi);
            float y = cos(theta);
            float rx = 2.0 * pi * pitchAmt;
            float rz = 2.0 * pi * rollAmt;
            // TexCoordVRRotateX
            float z1 = cos(rx) * z - sin(rx) * y;
            float y1 = sin(rx) * z + cos(rx) * y;
            float x1 = x;
            // TexCoordVRRotateZ
            float x2 = cos(rz) * x1 - sin(rz) * y1;
            float y2 = sin(rz) * x1 + cos(rz) * y1;
            float z2 = z1;
            float newPhi = atan(x2, z2);
            float newTheta = acos(clamp(y2, -1.0, 1.0));
            float newS = fract(newPhi / (2.0 * pi));
            float newT = fract(1.0 - newTheta / pi);
            gl_FragColor = vsSample(vec2(newS, 1.0 - newT), 1.0);
        }
        """,
        tags=["vr", "360", "pitch", "roll"],
        overdraw=False,
    ))

    # 1C. Sphere Lens 3D (TexCoordSphereLens.fs)
    lens_body = wrap_vs_texcoord("TexCoordSphereLens.fs")
    effects.append(make_effect(
        "sphere_lens_3d",
        "VS: Sphere Lens 3D",
        "Decompiled from Video Star TexCoordSphereLens.fs — 3D spherical refraction lens.",
        [
            p_float("ufLayoutParameter", "Lens Size", 0.55, 0.05, 1.5),
            p_float("ufLayoutParam2", "Intensity", 0.5, -1.0, 1.5),
            p_switch("clipOutside", "Clip Outside", False),
        ],
        lens_body.replace("vec3 texCoord()", "vec3 vsTexCoord(vec2 textureCoordinate, vec4 vsAspect4, float ubTexCoordBool)")
        + r"""
        void main() {
            vec2 tc = vec2(acLayerNorm.x, 1.0 - acLayerNorm.y);
            float ar = max(acLayerSize.x, 1.0) / max(acLayerSize.y, 1.0);
            vec4 vsAspect4 = vec4(ar, 1.0 / ar, 1.0, 1.0);
            vec3 res = vsTexCoord(tc, vsAspect4, clipOutside ? 1.0 : 0.0);
            vec4 c = vsSample(vec2(res.x, 1.0 - res.y), 1.0);
            gl_FragColor = c * res.z;
        }
        """,
        tags=["sphere", "lens", "fisheye"],
        overdraw=False,
    ))

    # 1D. Light Tunnel 3D (TexCoordLightTunnel.fs + Inv)
    effects.append(make_effect(
        "light_tunnel_3d",
        "VS: Light Tunnel 3D",
        "Decompiled from Video Star TexCoordLightTunnel.fs & Inv — radial 3D warp tunnel.",
        [
            p_float("ufLayoutParameter", "Depth Limit", 0.5, 0.02, 1.0),
            p_switch("invertMode", "Invert Tunnel", False),
        ],
        r"""
        void main() {
            vec2 tc = vec2(acLayerNorm.x, 1.0 - acLayerNorm.y);
            float ar = max(acLayerSize.x, 1.0) / max(acLayerSize.y, 1.0);
            vec4 vsAspect4 = vec4(ar, 1.0 / ar, 1.0, 1.0);
            vec2 deltaXY = 2.0 * (tc - 0.5);
            deltaXY.x *= max(1.0, vsAspect4.x);
            deltaXY.y *= max(1.0, vsAspect4.y);
            float dist = sqrt(dot(deltaXY, deltaXY));
            if (invertMode) {
                float limit = 2.0 - 1.96 * ufLayoutParameter;
                deltaXY = (min(limit, dist) * deltaXY) / max(dist, 0.0001);
            } else {
                float limit = ufLayoutParameter;
                deltaXY = (min(1.15 * limit, dist) * deltaXY) / max(dist, 0.0001);
            }
            deltaXY.x *= min(1.0, vsAspect4.y);
            deltaXY.y *= min(1.0, vsAspect4.x);
            deltaXY = 0.5 * deltaXY + vec2(0.5);
            gl_FragColor = vsSample(vec2(deltaXY.x, 1.0 - deltaXY.y), 1.0);
        }
        """,
        tags=["tunnel", "radial"],
        overdraw=False,
    ))

    # 1E. Mirror Bowl 3D (TexCoordMirrorBowl.fs + DistMirrorBowl)
    effects.append(make_effect(
        "mirror_bowl_3d",
        "VS: Mirror Bowl 3D",
        "Decompiled from Video Star TexCoordMirrorBowl.fs — 3D parabolic mirror bowl distortion.",
        [
            p_float("ufLayoutParameter", "Curvature", 0.65, 0.0, 1.5),
            p_float("wobbleAmt", "Wobble Jitter", 0.0, 0.0, 1.0),
            p_switch("transparentEdge", "Transparent Edges", False),
        ],
        r"""
        void main() {
            vec2 tc = vec2(acLayerNorm.x, 1.0 - acLayerNorm.y);
            float ar = max(acLayerSize.x, 1.0) / max(acLayerSize.y, 1.0);
            vec4 vsAspect4 = vec4(ar, 1.0 / ar, 1.0, 1.0);
            vec2 deltaXY = tc - vec2(0.5);
            deltaXY.x *= max(1.0, vsAspect4.x);
            deltaXY.y *= max(1.0, vsAspect4.y);
            float dist = 2.0 - dot(deltaXY, deltaXY) * 4.0;
            float param = ufLayoutParameter * (1.0 + wobbleAmt * (vsHash21(vec2(floor(acTime * 15.0), 3.0)) - 0.5));
            float pSq = param * param;
            deltaXY = deltaXY * (pSq * dist + (1.0 - pSq));
            deltaXY.x *= min(1.0, vsAspect4.y);
            deltaXY.y *= min(1.0, vsAspect4.x);
            vec2 newTC = deltaXY + vec2(0.5);
            gl_FragColor = vsSample(vec2(newTC.x, 1.0 - newTC.y), transparentEdge ? 0.0 : 2.0);
        }
        """,
        tags=["mirror", "bowl", "concave"],
        overdraw=False,
    ))

    # 1F. Pucker Cubed 3D (TexCoordPuckerCubed.fs + HalfCubed)
    effects.append(make_effect(
        "pucker_cubed_3d",
        "VS: Pucker Cubed 3D",
        "Decompiled from Video Star TexCoordPuckerCubed.fs & HalfCubed.fs — cubic 3D fold pucker.",
        [
            p_float("ufLayoutParameter", "Pucker", 0.5, -1.0, 1.0),
            p_float("ufLayoutParam2", "Edge Start", 0.15, 0.0, 0.45),
            p_switch("halfCube", "Half-Cube Curve", False),
        ],
        r"""
        void main() {
            vec2 tc = vec2(acLayerNorm.x, 1.0 - acLayerNorm.y);
            float startX = ufLayoutParam2;
            float pLo = (tc.x - startX) / (0.5 - startX + 0.0005);
            float pHi = (1.0 - tc.x - startX) / (0.5 - startX + 0.0005);
            float progress = max(0.0, min(pLo, pHi));
            float modProg;
            if (halfCube) {
                modProg = 1.0 - pow(1.0 - progress, 3.0);
            } else {
                float mLo = 4.0 * progress * progress * progress;
                float mHi = 1.0 - 4.0 * pow(1.0 - progress, 3.0);
                modProg = mix(mLo, mHi, step(0.5, progress));
            }
            float adjY = ufLayoutParameter * modProg * 0.5;
            float yLo = tc.y + adjY;
            float yHi = tc.y - adjY;
            float useHi = step(0.5, tc.y);
            float newY = mix(yLo, yHi, useHi);
            float a = mix(step(newY, 0.5), step(0.5, newY), useHi);
            vec4 col = vsSample(vec2(tc.x, 1.0 - newY), 0.0);
            gl_FragColor = col * a;
        }
        """,
        tags=["pucker", "fold"],
        overdraw=False,
    ))

    # 1G. 3D Skew / Perspective Tilt (TexCoordSkewH/V/Spin/EL/ER/ET/EB.fs)
    effects.append(make_effect(
        "skew_3d",
        "VS: 3D Skew & Perspective",
        "Decompiled from Video Star TexCoordSkewH/V/Spin/EL/ER/ET/EB.fs — 3D card skew and edge tilt.",
        [
            p_selector("skewMode", "Skew Mode", ["Horizontal", "Vertical", "Spin", "Edge Left", "Edge Right", "Edge Top", "Edge Bottom"], 0),
            p_float("ufLayoutParameter", "Amount", 0.35, -1.5, 1.5),
            p_switch("reflectEdges", "Reflect Edges", False),
        ],
        r"""
        void main() {
            vec2 tc = vec2(acLayerNorm.x, 1.0 - acLayerNorm.y);
            vec2 nt = tc;
            if (skewMode == 0) {
                nt.x = tc.x + ufLayoutParameter * 2.0 * (tc.y - 0.5);
            } else if (skewMode == 1) {
                nt.y = tc.y + ufLayoutParameter * 2.0 * (tc.x - 0.5);
            } else if (skewMode == 2) {
                nt.x = tc.x + ufLayoutParameter * 2.0 * (tc.y - 0.5);
                nt.y = tc.y - ufLayoutParameter * 2.0 * (tc.x - 0.5);
            } else if (skewMode == 3) {
                nt.y = tc.y + ufLayoutParameter * (1.0 - tc.x);
            } else if (skewMode == 4) {
                nt.y = tc.y + ufLayoutParameter * tc.x;
            } else if (skewMode == 5) {
                nt.x = tc.x + ufLayoutParameter * (1.0 - tc.y);
            } else {
                nt.x = tc.x + ufLayoutParameter * tc.y;
            }
            gl_FragColor = vsSample(vec2(nt.x, 1.0 - nt.y), reflectEdges ? 2.0 : 0.0);
        }
        """,
        tags=["skew", "perspective"],
        overdraw=True,
    ))

    # 1H. Edge Extrude 3D (TexCoordEdgeExtrude.fs)
    effects.append(make_effect(
        "edge_extrude_3d",
        "VS: Edge Extrude 3D",
        "Decompiled from Video Star TexCoordEdgeExtrude.fs — stretches outer border rows into 3D extruded edges.",
        [
            p_float("extrudeAmt", "Extrude Margin", 0.2, 0.0, 0.48),
            p_float("depthShade", "Depth Shadow", 0.4, 0.0, 1.0),
        ],
        r"""
        void main() {
            vec2 uv = acLayerNorm;
            vec2 lo = vec2(extrudeAmt);
            vec2 hi = vec2(1.0 - extrudeAmt);
            vec2 clamped = clamp(uv, lo, hi);
            vec2 remapped = (clamped - lo) / max(hi - lo, vec2(0.001));
            float edgeDist = length(uv - clamped) / max(extrudeAmt, 0.001);
            vec4 col = vsSample(remapped, 1.0);
            col.rgb *= mix(1.0, 1.0 - 0.55 * depthShade, clamp(edgeDist, 0.0, 1.0));
            gl_FragColor = col;
        }
        """,
        tags=["extrude", "edge"],
        overdraw=False,
    ))

    # 1I. Depth Map 3D Parallax (TexCoordDepthMapVideo.fs)
    effects.append(make_effect(
        "depth_map_3d",
        "VS: Depth Map 3D",
        "Decompiled from Video Star TexCoordDepthMapVideo.fs — luminance-driven 3D parallax extrusion.",
        [
            p_float("depthAmt", "3D Depth", 0.45, -1.0, 1.0),
            p_float("tiltX", "Camera X", 0.35, -1.0, 1.0),
            p_float("tiltY", "Camera Y", 0.25, -1.0, 1.0),
        ],
        r"""
        void main() {
            vec2 uv = acLayerNorm;
            vec4 baseCol = vsSample(uv, 1.0);
            float lum = dot(baseCol.rgb, vec3(0.30, 0.59, 0.11));
            vec2 cam = vec2(tiltX, tiltY);
            vec2 p = uv;
            // Iterative parallax raymarch matching VS luminance depth offset
            for (int i = 0; i < 6; i++) {
                float h = dot(vsSample(p, 1.0).rgb, vec3(0.30, 0.59, 0.11)) - 0.5;
                p = uv - cam * (h * depthAmt * 0.14);
            }
            vec4 col = vsSample(p, 0.0);
            float l2 = dot(vsSample(p + vec2(0.004, 0.004), 1.0).rgb, vec3(0.30, 0.59, 0.11));
            col.rgb *= (1.0 + (lum - l2) * depthAmt * 1.5);
            gl_FragColor = col;
        }
        """,
        tags=["depth", "parallax", "displacement"],
        overdraw=False,
    ))

    # 1J. ColorCIFilter3DTunnel 1A/1B/2A/2B (famous Video Star 3D Tunnel)
    effects.append(make_effect(
        "tunnel_3d_vs",
        "VS: 3D Tunnel (1 & 2)",
        "Decompiled from Video Star ColorCIFilter3DTunnel1A/1B/2A/2B — swirling 3D perspective tunnel with vertical bounce.",
        [
            p_selector("tunnelStyle", "Tunnel Style", ["Tunnel 1 (Circle)", "Tunnel 1 (Bounce)", "Tunnel 2 (Square)", "Tunnel 2 (Bounce)"], 0),
            p_float("speedPhase", "Travel Z", 0.0, -5.0, 5.0),
            p_float("twistAmt", "Twist", 0.4, -2.0, 2.0),
            p_float("bounceAmp", "Vertical Sway", 0.2, 0.0, 1.0),
            p_float("fogAmt", "Depth Fog", 0.5, 0.0, 1.0),
            p_color("fogColor", "Fog Color", "#FF050510"),
        ],
        r"""
        void main() {
            vec2 aspect = vsLayerAspect();
            vec2 p = (acLayerNorm - 0.5) * vec2(aspect.x, 1.0);
            if (tunnelStyle == 1 || tunnelStyle == 3) {
                p.y += sin(speedPhase * 3.14159) * bounceAmp * 0.25;
                p.x += cos(speedPhase * 2.1) * bounceAmp * 0.12;
            }
            float r;
            if (tunnelStyle >= 2) {
                // Square / faceted ColorCIFilter3DTunnel2
                vec2 ap = abs(p);
                r = pow(pow(ap.x, 6.0) + pow(ap.y, 6.0), 1.0 / 6.0);
            } else {
                r = length(p);
            }
            r = max(r, 0.002);
            float invR = 0.28 / r;
            float ang = atan(p.y, p.x) + twistAmt * invR * 0.4;
            vec2 uv = vec2(ang / (2.0 * VS_PI) + 0.5, invR + speedPhase * 0.5);
            vec4 col = vsSample(uv, 2.0);
            float fogMask = clamp(1.0 - r * (2.6 - fogAmt * 1.4), 0.0, 1.0) * fogAmt;
            gl_FragColor = vec4(mix(col.rgb, fogColor.rgb, fogMask), col.a);
        }
        """,
        tags=["tunnel", "vortex"],
        overdraw=False,
    ))

    # 1K. Lighting3DML (Lighting3DML.fs direct tilt plane shader)
    effects.append(make_effect(
        "lighting_3d_ml",
        "VS: 3D Lighting (ML)",
        "Decompiled from Video Star Lighting3DML.fs — Multi-Layer directional + ambient 3D light over a curved/tilted surface.",
        [
            p_float("lightX", "Light Dir X", 0.45, -1.0, 1.0),
            p_float("lightY", "Light Dir Y", 0.65, -1.0, 1.0),
            p_float("lightZ", "Light Dir Z", 0.85, 0.05, 1.0),
            p_color("dirColor", "Directional Color", "#FFFFFFFF"),
            p_color("ambColor", "Ambient Color", "#FF353545"),
            p_float("bumpDepth", "Luma Relief", 0.25, 0.0, 1.0),
        ],
        r"""
        void main() {
            vec2 uv = acLayerNorm;
            vec4 col = vsSample(uv, 0.0);
            vec2 eps = vec2(2.0 / max(acLayerSize.x, 1.0), 2.0 / max(acLayerSize.y, 1.0));
            float hx = dot(vsSample(uv + vec2(eps.x, 0.0), 1.0).rgb, vec3(0.3, 0.6, 0.1)) -
                       dot(vsSample(uv - vec2(eps.x, 0.0), 1.0).rgb, vec3(0.3, 0.6, 0.1));
            float hy = dot(vsSample(uv + vec2(0.0, eps.y), 1.0).rgb, vec3(0.3, 0.6, 0.1)) -
                       dot(vsSample(uv - vec2(0.0, eps.y), 1.0).rgb, vec3(0.3, 0.6, 0.1));
            vec3 normal = normalize(vec3(-hx * bumpDepth * 8.0, -hy * bumpDepth * 8.0, 1.0));
            vec3 lVec = normalize(vec3(lightX, lightY, lightZ));
            float directionalIntensity = max(0.0, dot(lVec, normal));
            vec3 coloredLighting = vec3(directionalIntensity) * dirColor.rgb + ambColor.rgb;
            gl_FragColor = vec4(coloredLighting * col.rgb, col.a);
        }
        """,
        tags=["lighting", "relief"],
        overdraw=False,
    ))

    # =========================================================================
    # 2. DECOMPILED VIDEO STAR LayoutML3D* CUBES, SOLIDS & POLYHEDRA
    # =========================================================================

    # 2A. 3D Cube Spin & Cuboid (LayoutML3DCubeSpin / LayoutML3DCuboid)
    effects.append(make_effect(
        "ml3d_cube_spin",
        "VS: 3D Cube / Cuboid",
        "Decompiled from Video Star LayoutML3DCubeSpin & LayoutML3DCuboid — 3D rotating box with X/Y/Z aspect and Lighting3DML.",
        [
            p_xyz("rotDeg", "Rotation XYZ", "18.0,-28.0,0.0"),
            p_float("width", "Width", 0.55, 0.05, 1.5),
            p_float("height", "Height", 0.55, 0.05, 1.5),
            p_float("depth", "Depth", 0.55, 0.05, 1.5),
            p_float("camDist", "Distance", 2.35, 1.1, 6.0),
            p_switch("insideView", "Inside View", False),
        ] + p_lighting(),
        r"""
        void main() {
            vec2 aspect = vsLayerAspect();
            vec2 st = (acLayerNorm - 0.5) * vec2(aspect.x, 1.0) * 1.45;
            mat3 R = vsEuler(rotDeg);
            vec3 ro = transpose(R) * vec3(0.0, 0.0, camDist);
            vec3 rd = normalize(transpose(R) * vec3(st, -1.6));
            vec3 b = vec3(width, height, depth);
            if (insideView) {
                // Intersect inside of box centered around origin
                vec3 m = 1.0 / (rd + vec3(1e-6));
                vec3 n = m * (ro * 0.15);
                vec3 k = abs(m) * b;
                vec3 t2 = -n + k;
                float tF = min(min(t2.x, t2.y), t2.z);
                vec3 p = ro * 0.15 + rd * tF;
                vec3 nor = -sign(rd) * step(t2.xyz, t2.yzx) * step(t2.xyz, t2.zxy);
                vec2 uv = vsBoxFaceUV(p, nor, b);
                vec4 col = vsSample(uv, 1.0);
                gl_FragColor = vsLightingML(col, R * nor, rd, lightAmt, lightColor, ambientAmt);
                return;
            }
            vec4 hit = vsIntersectBox(ro, rd, b);
            if (hit.x < 0.0) { gl_FragColor = vec4(0.0); return; }
            vec3 p = ro + rd * hit.x;
            vec2 uv = vsBoxFaceUV(p, hit.yzw, b);
            vec4 col = vsSample(uv, 1.0);
            gl_FragColor = vsLightingML(col, R * hit.yzw, rd, lightAmt, lightColor, ambientAmt);
        }
        """,
        tags=["cube", "cuboid", "spin", "box"],
    ))

    # 2B. 3D Cube Fold / Unfold (LayoutML3DCubeFold & LayoutML3DCubeUnfold)
    effects.append(make_effect(
        "ml3d_cube_unfold",
        "VS: 3D Cube Fold / Unfold",
        "Decompiled from Video Star LayoutML3DCubeFold & Unfold — 6-face cross net hinging smoothly from flat 2D to closed 3D cube.",
        [
            p_float("foldProgress", "Fold Amount", 0.65, 0.0, 1.0),
            p_xyz("rotDeg", "Rotation XYZ", "22.0,-32.0,0.0"),
            p_float("camDist", "Distance", 3.0, 1.2, 6.5),
            p_float("faceSize", "Cube Size", 0.42, 0.15, 0.9),
        ] + p_lighting(),
        r"""
        void testHingeFace(vec3 ro, vec3 rd, vec3 pivot, vec3 axis, float ang, vec3 centerOff, float hw, inout float bestT, inout vec2 bestUV, inout vec3 bestN) {
            mat3 R;
            if (axis.x > 0.5) R = vsRotX(ang);
            else if (axis.y > 0.5) R = vsRotY(ang);
            else R = vsRotZ(ang);
            vec3 lro = transpose(R) * (ro - pivot) - centerOff;
            vec3 lrd = transpose(R) * rd;
            vec2 q = vsIntersectQuad(lro, lrd, hw, hw);
            if (q.x > 0.0 && q.x < bestT) {
                vec3 hp = lro + lrd * q.x;
                bestT = q.x;
                bestUV = hp.xy / (2.0 * hw) + 0.5;
                bestN = R * vec3(0.0, 0.0, q.y);
            }
        }
        void main() {
            vec2 aspect = vsLayerAspect();
            vec2 st = (acLayerNorm - 0.5) * vec2(aspect.x, 1.0) * 1.45;
            mat3 camR = vsEuler(rotDeg);
            vec3 ro = transpose(camR) * vec3(0.0, 0.0, camDist);
            vec3 rd = normalize(transpose(camR) * vec3(st, -1.6));
            float hw = faceSize;
            float w = 2.0 * hw;
            float a = foldProgress * (VS_PI * 0.5);
            float bestT = 1e6;
            vec2 bestUV = vec2(0.0);
            vec3 bestN = vec3(0.0, 0.0, 1.0);
            // Back base face
            testHingeFace(ro, rd, vec3(0.0), vec3(0.0, 1.0, 0.0), 0.0, vec3(0.0, 0.0, -hw), hw, bestT, bestUV, bestN);
            // Left, Right, Top, Bottom hinged around back face edges (at z = -hw)
            testHingeFace(ro, rd, vec3(-hw, 0.0, -hw), vec3(0.0, 1.0, 0.0), -a, vec3(-hw, 0.0, 0.0), hw, bestT, bestUV, bestN);
            testHingeFace(ro, rd, vec3(hw, 0.0, -hw), vec3(0.0, 1.0, 0.0), a, vec3(hw, 0.0, 0.0), hw, bestT, bestUV, bestN);
            testHingeFace(ro, rd, vec3(0.0, hw, -hw), vec3(1.0, 0.0, 0.0), -a, vec3(0.0, hw, 0.0), hw, bestT, bestUV, bestN);
            testHingeFace(ro, rd, vec3(0.0, -hw, -hw), vec3(1.0, 0.0, 0.0), a, vec3(0.0, -hw, 0.0), hw, bestT, bestUV, bestN);
            // Front lid hinged off top face
            mat3 rTop = vsRotX(-a);
            vec3 lidPivot = vec3(0.0, hw, -hw) + rTop * vec3(0.0, w, 0.0);
            mat3 rLid = vsRotX(-2.0 * a);
            vec3 lro = transpose(rLid) * (ro - lidPivot) - vec3(0.0, hw, 0.0);
            vec3 lrd = transpose(rLid) * rd;
            vec2 q = vsIntersectQuad(lro, lrd, hw, hw);
            if (q.x > 0.0 && q.x < bestT) {
                vec3 hp = lro + lrd * q.x;
                bestT = q.x;
                bestUV = hp.xy / w + 0.5;
                bestN = rLid * vec3(0.0, 0.0, q.y);
            }
            if (bestT > 1e5) { gl_FragColor = vec4(0.0); return; }
            vec4 col = vsSample(bestUV, 1.0);
            gl_FragColor = vsLightingML(col, camR * bestN, rd, lightAmt, lightColor, ambientAmt);
        }
        """,
        tags=["cube", "fold", "unfold"],
    ))

    # 2C. 3D Cube Expand / Collapse / Split (LayoutML3DCubeExpand / Collapse / Split / Slide)
    effects.append(make_effect(
        "ml3d_cube_expand",
        "VS: 3D Cube Expand / Split",
        "Decompiled from Video Star LayoutML3DCubeExpand, Collapse, Slide & Split — 6 cube faces exploding or sliding apart in 3D.",
        [
            p_float("expandAmt", "Expand / Split", 0.35, -0.45, 1.5),
            p_float("slideAmt", "Face Slide", 0.0, -1.0, 1.0),
            p_xyz("rotDeg", "Rotation XYZ", "24.0,-34.0,0.0"),
            p_float("camDist", "Distance", 2.8, 1.2, 6.5),
            p_float("cubeSize", "Cube Size", 0.48, 0.15, 0.9),
        ] + p_lighting(),
        r"""
        void testFacePanel(vec3 ro, vec3 rd, mat3 faceR, vec3 pos, float hw, inout float bestT, inout vec2 bestUV, inout vec3 bestN) {
            vec3 lro = transpose(faceR) * (ro - pos);
            vec3 lrd = transpose(faceR) * rd;
            vec2 q = vsIntersectQuad(lro, lrd, hw, hw);
            if (q.x > 0.0 && q.x < bestT) {
                vec3 hp = lro + lrd * q.x;
                bestT = q.x;
                bestUV = hp.xy / (2.0 * hw) + 0.5;
                bestN = faceR * vec3(0.0, 0.0, q.y);
            }
        }
        void main() {
            vec2 aspect = vsLayerAspect();
            vec2 st = (acLayerNorm - 0.5) * vec2(aspect.x, 1.0) * 1.45;
            mat3 camR = vsEuler(rotDeg);
            vec3 ro = transpose(camR) * vec3(0.0, 0.0, camDist);
            vec3 rd = normalize(transpose(camR) * vec3(st, -1.6));
            float hw = cubeSize;
            float off = hw + expandAmt * hw * 1.5;
            float bestT = 1e6;
            vec2 bestUV = vec2(0.0);
            vec3 bestN = vec3(0.0, 0.0, 1.0);
            testFacePanel(ro, rd, vsRotY(0.0), vec3(slideAmt * 0.25, 0.0, off), hw, bestT, bestUV, bestN);
            testFacePanel(ro, rd, vsRotY(VS_PI), vec3(-slideAmt * 0.25, 0.0, -off), hw, bestT, bestUV, bestN);
            testFacePanel(ro, rd, vsRotY(VS_PI * 0.5), vec3(off, slideAmt * 0.25, 0.0), hw, bestT, bestUV, bestN);
            testFacePanel(ro, rd, vsRotY(-VS_PI * 0.5), vec3(-off, -slideAmt * 0.25, 0.0), hw, bestT, bestUV, bestN);
            testFacePanel(ro, rd, vsRotX(-VS_PI * 0.5), vec3(0.0, off, slideAmt * 0.25), hw, bestT, bestUV, bestN);
            testFacePanel(ro, rd, vsRotX(VS_PI * 0.5), vec3(0.0, -off, -slideAmt * 0.25), hw, bestT, bestUV, bestN);
            if (bestT > 1e5) { gl_FragColor = vec4(0.0); return; }
            vec4 col = vsSample(bestUV, 1.0);
            gl_FragColor = vsLightingML(col, camR * bestN, rd, lightAmt, lightColor, ambientAmt);
        }
        """,
        tags=["cube", "expand", "collapse", "split"],
    ))

    # 2D. 3D Cube Twist & Bloated Cube (LayoutML3DCubeTwist & LayoutML3DCubeBloated)
    effects.append(make_effect(
        "ml3d_cube_twist_bloat",
        "VS: 3D Cube Twist / Bloated",
        "Decompiled from Video Star LayoutML3DCubeTwist & CubeBloated — twisted or inflated 3D cube SDF.",
        [
            p_float("twistAmt", "Twist", 0.85, -3.5, 3.5),
            p_float("bloatAmt", "Bloat / Round", 0.08, 0.0, 0.35),
            p_xyz("rotDeg", "Rotation XYZ", "18.0,-28.0,0.0"),
            p_float("camDist", "Distance", 2.45, 1.2, 6.0),
            p_float("sizeAmt", "Size", 0.52, 0.15, 1.0),
        ] + p_lighting(),
        r"""
        float sdTwistCube(vec3 p, float b, float tw, float bl) {
            float a = tw * p.y;
            float c = cos(a), s = sin(a);
            vec3 q = vec3(c * p.x - s * p.z, p.y, s * p.x + c * p.z);
            vec3 d = abs(q) - vec3(b - bl);
            return length(max(d, 0.0)) + min(max(d.x, max(d.y, d.z)), 0.0) - bl;
        }
        vec3 nTwistCube(vec3 p, float b, float tw, float bl) {
            vec2 e = vec2(0.005, 0.0);
            return normalize(vec3(
                sdTwistCube(p + e.xyy, b, tw, bl) - sdTwistCube(p - e.xyy, b, tw, bl),
                sdTwistCube(p + e.yxy, b, tw, bl) - sdTwistCube(p - e.yxy, b, tw, bl),
                sdTwistCube(p + e.yyx, b, tw, bl) - sdTwistCube(p - e.yyx, b, tw, bl)
            ));
        }
        void main() {
            vec2 aspect = vsLayerAspect();
            vec2 st = (acLayerNorm - 0.5) * vec2(aspect.x, 1.0) * 1.45;
            mat3 camR = vsEuler(rotDeg);
            vec3 ro = transpose(camR) * vec3(0.0, 0.0, camDist);
            vec3 rd = normalize(transpose(camR) * vec3(st, -1.6));
            float t = 0.0;
            bool hit = false;
            for (int i = 0; i < 42; i++) {
                float dd = sdTwistCube(ro + rd * t, sizeAmt, twistAmt * 2.2, bloatAmt);
                if (dd < 0.0015) { hit = true; break; }
                t += dd * 0.65;
                if (t > 12.0) break;
            }
            if (!hit) { gl_FragColor = vec4(0.0); return; }
            vec3 p = ro + rd * t;
            vec3 n = nTwistCube(p, sizeAmt, twistAmt * 2.2, bloatAmt);
            float a = twistAmt * 2.2 * p.y;
            float c = cos(a), s = sin(a);
            vec3 qp = vec3(c * p.x - s * p.z, p.y, s * p.x + c * p.z);
            vec3 qn = vec3(c * n.x - s * n.z, n.y, s * n.x + c * n.z);
            vec2 uv = vsBoxFaceUV(qp, qn, vec3(sizeAmt));
            vec4 col = vsSample(uv, 1.0);
            gl_FragColor = vsLightingML(col, camR * n, rd, lightAmt, lightColor, ambientAmt);
        }
        """,
        tags=["cube", "twist", "bloated"],
    ))

    # 2E. 3D Rubik's Cube & Multi Rubik's (LayoutML3DRubiksCube & MultiRubiks)
    effects.append(make_effect(
        "ml3d_rubiks_cube",
        "VS: 3D Rubik's Cube",
        "Decompiled from Video Star LayoutML3DRubiksCube & MultiRubiks — 3×3×3 Rubik's cube with animated slice twists.",
        [
            p_float("sliceTwist", "Slice Twist", 35.0, -360.0, 360.0, unit="°"),
            p_selector("twistAxis", "Active Slices", ["X/Y/Z Cascade", "Top & Bottom Y", "Middle Slices", "Tiled Multi-Rubik"], 0),
            p_float("gapAmt", "Cell Gap", 0.04, 0.0, 0.12),
            p_xyz("rotDeg", "Rotation XYZ", "24.0,-32.0,0.0"),
            p_float("camDist", "Distance", 2.8, 1.3, 6.5),
        ] + p_lighting(),
        r"""
        void main() {
            vec2 aspect = vsLayerAspect();
            vec2 st = (acLayerNorm - 0.5) * vec2(aspect.x, 1.0) * 1.45;
            if (twistAxis == 3) {
                // Multi-Rubiks 2x2 grid in screen space
                st = fract(st * 1.5 + 0.5) - 0.5;
            }
            mat3 camR = vsEuler(rotDeg);
            vec3 ro = transpose(camR) * vec3(0.0, 0.0, camDist);
            vec3 rd = normalize(transpose(camR) * vec3(st, -1.6));
            float tw = sliceTwist * 0.0174532925;
            float cell = 0.22;
            float stepP = cell * 2.0 + gapAmt;
            float bestT = 1e6;
            vec2 bestUV = vec2(0.0);
            vec3 bestN = vec3(0.0, 0.0, 1.0);
            for (int ix = -1; ix <= 1; ix++) {
                for (int iy = -1; iy <= 1; iy++) {
                    for (int iz = -1; iz <= 1; iz++) {
                        // Skip pure interior core cubie
                        if (ix == 0 && iy == 0 && iz == 0) continue;
                        mat3 sr = mat3(1.0);
                        if (twistAxis == 0) {
                            if (iy == 1) sr = vsRotY(tw);
                            else if (iy == -1) sr = vsRotY(-tw);
                            else if (ix == 1) sr = vsRotX(tw * 0.5);
                        } else if (twistAxis == 1) {
                            if (iy != 0) sr = vsRotY(tw * float(iy));
                        } else {
                            if (iy == 0) sr = vsRotY(tw);
                        }
                        vec3 center = sr * (vec3(float(ix), float(iy), float(iz)) * stepP);
                        vec3 lro = transpose(sr) * (ro - center);
                        vec3 lrd = transpose(sr) * rd;
                        vec4 h = vsIntersectBox(lro, lrd, vec3(cell));
                        if (h.x > 0.0 && h.x < bestT) {
                            bestT = h.x;
                            vec3 p = lro + lrd * h.x;
                            vec2 localUV = vsBoxFaceUV(p, h.yzw, vec3(cell));
                            // Map each face to grid quadrant so image spans across whole cube face
                            vec2 tileIdx = vec2(0.0);
                            if (abs(h.w) > 0.5) tileIdx = vec2(float(ix + 1), float(iy + 1));
                            else if (abs(h.y) > 0.5) tileIdx = vec2(float(iz + 1), float(iy + 1));
                            else tileIdx = vec2(float(ix + 1), float(iz + 1));
                            bestUV = (tileIdx + localUV) / 3.0;
                            bestN = sr * h.yzw;
                        }
                    }
                }
            }
            if (bestT > 1e5) { gl_FragColor = vec4(0.0); return; }
            vec4 col = vsSample(bestUV, 1.0);
            gl_FragColor = vsLightingML(col, camR * bestN, rd, lightAmt, lightColor, ambientAmt);
        }
        """,
        tags=["rubiks", "cube", "multi"],
    ))

    # 2F. Crystal Gem / Crystal Cube (LayoutML3DCrystal3..8 & CrystalCube)
    effects.append(make_effect(
        "ml3d_crystal",
        "VS: 3D Crystal Gem (3–8)",
        "Decompiled from Video Star LayoutML3DCrystal3–8 & CrystalCube — faceted crystalline bipyramid / prism.",
        [
            p_float("facets", "Facet Sides", 6.0, 3.0, 8.0),
            p_float("pointSharp", "Crystal Taper", 0.55, 0.0, 1.2),
            p_float("refractMix", "Facet Specular", 0.45, 0.0, 1.0),
            p_xyz("rotDeg", "Rotation XYZ", "16.0,-26.0,0.0"),
            p_float("camDist", "Distance", 2.35, 1.2, 6.0),
        ] + p_lighting(),
        r"""
        float sdCrystal(vec3 p, float sides, float sharp) {
            float nSides = max(3.0, floor(sides + 0.5));
            float ang = atan(p.z, p.x);
            float sec = (2.0 * VS_PI) / nSides;
            float a = mod(ang + 0.5 * sec, sec) - 0.5 * sec;
            float r = length(p.xz) * cos(a);
            float h = 0.65;
            float taper = mix(1.0, max(0.08, 1.0 - abs(p.y) * (0.9 * sharp + 0.1)), clamp(sharp, 0.0, 1.2));
            float radial = r - 0.48 * taper;
            float vertical = abs(p.y) - h;
            return max(radial, vertical);
        }
        vec3 nCrystal(vec3 p, float sides, float sharp) {
            vec2 e = vec2(0.004, 0.0);
            return normalize(vec3(
                sdCrystal(p + e.xyy, sides, sharp) - sdCrystal(p - e.xyy, sides, sharp),
                sdCrystal(p + e.yxy, sides, sharp) - sdCrystal(p - e.yxy, sides, sharp),
                sdCrystal(p + e.yyx, sides, sharp) - sdCrystal(p - e.yyx, sides, sharp)
            ));
        }
        void main() {
            vec2 aspect = vsLayerAspect();
            vec2 st = (acLayerNorm - 0.5) * vec2(aspect.x, 1.0) * 1.45;
            mat3 camR = vsEuler(rotDeg);
            vec3 ro = transpose(camR) * vec3(0.0, 0.0, camDist);
            vec3 rd = normalize(transpose(camR) * vec3(st, -1.6));
            float t = 0.0;
            bool hit = false;
            for (int i = 0; i < 48; i++) {
                float d = sdCrystal(ro + rd * t, facets, pointSharp);
                if (d < 0.001) { hit = true; break; }
                t += d * 0.7;
                if (t > 10.0) break;
            }
            if (!hit) { gl_FragColor = vec4(0.0); return; }
            vec3 p = ro + rd * t;
            vec3 n = nCrystal(p, facets, pointSharp);
            vec2 uv = vec2(atan(p.z, p.x) / (2.0 * VS_PI) + 0.5, p.y * 0.72 + 0.5);
            vec4 col = vsSample(uv, 2.0);
            // Glassy crystal chromatic tint + rim glint
            float fresnel = pow(1.0 - max(0.0, dot(n, -rd)), 2.5);
            col.rgb = mix(col.rgb, col.rgb + vec3(0.35, 0.55, 0.9) * fresnel, refractMix);
            gl_FragColor = vsLightingML(col, camR * n, rd, lightAmt, lightColor, ambientAmt);
        }
        """,
        tags=["crystal", "gem", "polyhedron"],
    ))

    # 2G. 3D Pyramid Spin / Unfold / Expand (LayoutML3DPyramidSpin / Unfold / Expand)
    effects.append(make_effect(
        "ml3d_pyramid",
        "VS: 3D Pyramid (Spin / Expand / Unfold)",
        "Decompiled from Video Star LayoutML3DPyramidSpin, Unfold & Expand — 4-sided textured 3D pyramid.",
        [
            p_float("expandAmt", "Expand Faces", 0.0, 0.0, 1.2),
            p_float("heightAmt", "Height", 0.85, 0.25, 1.5),
            p_xyz("rotDeg", "Rotation XYZ", "18.0,-30.0,0.0"),
            p_float("camDist", "Distance", 2.5, 1.2, 6.0),
        ] + p_lighting(),
        r"""
        // Ray-triangle intersection (double-sided), returns t or -1
        float vsTriHit(vec3 ro, vec3 rd, vec3 v0, vec3 v1, vec3 v2, out vec3 outN, out vec2 outUV) {
            vec3 e1 = v1 - v0, e2 = v2 - v0;
            vec3 h = cross(rd, e2);
            float a = dot(e1, h);
            if (abs(a) < 1e-6) return -1.0;
            float f = 1.0 / a;
            vec3 s = ro - v0;
            float u = f * dot(s, h);
            if (u < 0.0 || u > 1.0) return -1.0;
            vec3 q = cross(s, e1);
            float v = f * dot(rd, q);
            if (v < 0.0 || u + v > 1.0) return -1.0;
            float t = f * dot(e2, q);
            if (t <= 0.0) return -1.0;
            outN = normalize(cross(e1, e2));
            if (dot(outN, rd) > 0.0) outN = -outN;
            outUV = vec2(u + 0.5 * v, v);
            return t;
        }
        void main() {
            vec2 aspect = vsLayerAspect();
            vec2 st = (acLayerNorm - 0.5) * vec2(aspect.x, 1.0) * 1.45;
            mat3 camR = vsEuler(rotDeg);
            vec3 ro = transpose(camR) * vec3(0.0, 0.0, camDist);
            vec3 rd = normalize(transpose(camR) * vec3(st, -1.6));
            float w = 0.6;
            vec3 apex = vec3(0.0, heightAmt * 0.65, 0.0);
            vec3 c0 = vec3(-w, -heightAmt * 0.45, w);
            vec3 c1 = vec3(w, -heightAmt * 0.45, w);
            vec3 c2 = vec3(w, -heightAmt * 0.45, -w);
            vec3 c3 = vec3(-w, -heightAmt * 0.45, -w);
            float bestT = 1e6;
            vec3 bestN = vec3(0.0, 1.0, 0.0);
            vec2 bestUV = vec2(0.0);
            vec3 tmpN; vec2 tmpUV;
            for (int i = 0; i < 4; i++) {
                vec3 a = i == 0 ? c0 : (i == 1 ? c1 : (i == 2 ? c2 : c3));
                vec3 b = i == 0 ? c1 : (i == 1 ? c2 : (i == 2 ? c3 : c0));
                vec3 nrm = normalize(cross(b - a, apex - a));
                vec3 off = nrm * expandAmt * 0.65;
                float t = vsTriHit(ro, rd, a + off, b + off, apex + off, tmpN, tmpUV);
                if (t > 0.0 && t < bestT) { bestT = t; bestN = tmpN; bestUV = tmpUV; }
            }
            // Base quad (2 triangles)
            vec3 bOff = vec3(0.0, -expandAmt * 0.55, 0.0);
            float tb1 = vsTriHit(ro, rd, c0 + bOff, c2 + bOff, c1 + bOff, tmpN, tmpUV);
            if (tb1 > 0.0 && tb1 < bestT) { bestT = tb1; bestN = tmpN; bestUV = tmpUV; }
            float tb2 = vsTriHit(ro, rd, c0 + bOff, c3 + bOff, c2 + bOff, tmpN, tmpUV);
            if (tb2 > 0.0 && tb2 < bestT) { bestT = tb2; bestN = tmpN; bestUV = vec2(1.0 - tmpUV.x, tmpUV.y); }
            if (bestT > 1e5) { gl_FragColor = vec4(0.0); return; }
            vec4 col = vsSample(bestUV, 1.0);
            gl_FragColor = vsLightingML(col, camR * bestN, rd, lightAmt, lightColor, ambientAmt);
        }
        """,
        tags=["pyramid", "spin", "expand"],
    ))

    # 2H. 3D Icosahedron & Dodecahedron (LayoutML3DIcosaSpin/Expand & DodecaSpin/Expand)
    effects.append(make_effect(
        "ml3d_platonic",
        "VS: 3D Icosahedron / Dodecahedron",
        "Decompiled from Video Star LayoutML3DIcosaSpin, DodecaSpin & Expand — faceted 12- & 20-face Platonic solids.",
        [
            p_selector("solidType", "Solid", ["Dodecahedron (12)", "Icosahedron (20)"], 0),
            p_float("radius", "Size", 0.62, 0.2, 1.1),
            p_float("facetPinch", "Facet Sharpness", 0.02, 0.0, 0.15),
            p_xyz("rotDeg", "Rotation XYZ", "20.0,-28.0,0.0"),
            p_float("camDist", "Distance", 2.35, 1.2, 6.0),
        ] + p_lighting(),
        r"""
        float sdPlatonic(vec3 p, float r, int mode, float bevel) {
            // Golden ratio plane normals
            const float phi = 1.61803398875;
            p = abs(p);
            float d = -1e5;
            if (mode == 0) {
                // Dodecahedron: 3 pairs of normals (+-1, +-phi, 0) normalized
                vec3 n1 = normalize(vec3(0.0, 1.0, phi));
                vec3 n2 = normalize(vec3(1.0, phi, 0.0));
                vec3 n3 = normalize(vec3(phi, 0.0, 1.0));
                d = max(max(dot(p, n1), dot(p, n2)), dot(p, n3)) - r;
            } else {
                // Icosahedron: (1,1,1)/sqrt3 + (0, phi, 1/phi) permutations
                vec3 n0 = normalize(vec3(1.0, 1.0, 1.0));
                vec3 n1 = normalize(vec3(0.0, 1.0 / phi, phi));
                vec3 n2 = normalize(vec3(1.0 / phi, phi, 0.0));
                vec3 n3 = normalize(vec3(phi, 0.0, 1.0 / phi));
                d = max(max(dot(p, n0), dot(p, n1)), max(dot(p, n2), dot(p, n3))) - r;
            }
            return d - bevel * 0.2;
        }
        vec3 nPlatonic(vec3 p, float r, int mode, float bevel) {
            vec2 e = vec2(0.004, 0.0);
            return normalize(vec3(
                sdPlatonic(p + e.xyy, r, mode, bevel) - sdPlatonic(p - e.xyy, r, mode, bevel),
                sdPlatonic(p + e.yxy, r, mode, bevel) - sdPlatonic(p - e.yxy, r, mode, bevel),
                sdPlatonic(p + e.yyx, r, mode, bevel) - sdPlatonic(p - e.yyx, r, mode, bevel)
            ));
        }
        void main() {
            vec2 aspect = vsLayerAspect();
            vec2 st = (acLayerNorm - 0.5) * vec2(aspect.x, 1.0) * 1.45;
            mat3 camR = vsEuler(rotDeg);
            vec3 ro = transpose(camR) * vec3(0.0, 0.0, camDist);
            vec3 rd = normalize(transpose(camR) * vec3(st, -1.6));
            float t = 0.0;
            bool hit = false;
            for (int i = 0; i < 42; i++) {
                float d = sdPlatonic(ro + rd * t, radius, solidType, facetPinch);
                if (d < 0.001) { hit = true; break; }
                t += d;
                if (t > 10.0) break;
            }
            if (!hit) { gl_FragColor = vec4(0.0); return; }
            vec3 p = ro + rd * t;
            vec3 n = nPlatonic(p, radius, solidType, facetPinch);
            // Planar tangent UV projection per face normal
            vec3 an = normalize(n);
            vec3 up = abs(an.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
            vec3 tx = normalize(cross(up, an));
            vec3 ty = cross(an, tx);
            vec2 uv = vec2(dot(p, tx), dot(p, ty)) / (1.3 * radius) + 0.5;
            vec4 col = vsSample(uv, 1.0);
            gl_FragColor = vsLightingML(col, camR * n, rd, lightAmt, lightColor, ambientAmt);
        }
        """,
        tags=["icosahedron", "dodecahedron", "polyhedron"],
    ))

    # 2I. 3D Torus (LayoutML3DTorus)
    effects.append(make_effect(
        "ml3d_torus",
        "VS: 3D Torus",
        "Decompiled from Video Star LayoutML3DTorus — spinning 3D textured torus with Lighting3DML.",
        [
            p_float("majorR", "Ring Radius", 0.55, 0.2, 1.0),
            p_float("minorR", "Tube Thickness", 0.22, 0.05, 0.5),
            p_xyz("rotDeg", "Rotation XYZ", "30.0,-22.0,0.0"),
            p_float("camDist", "Distance", 2.4, 1.2, 6.0),
            p_float("repeatU", "Wrap Repeat", 2.0, 1.0, 6.0),
        ] + p_lighting(),
        r"""
        float sdVSTorus(vec3 p, vec2 t) {
            vec2 q = vec2(length(p.xz) - t.x, p.y);
            return length(q) - t.y;
        }
        vec3 nVSTorus(vec3 p, vec2 tv) {
            vec2 e = vec2(0.004, 0.0);
            return normalize(vec3(
                sdVSTorus(p + e.xyy, tv) - sdVSTorus(p - e.xyy, tv),
                sdVSTorus(p + e.yxy, tv) - sdVSTorus(p - e.yxy, tv),
                sdVSTorus(p + e.yyx, tv) - sdVSTorus(p - e.yyx, tv)
            ));
        }
        void main() {
            vec2 aspect = vsLayerAspect();
            vec2 st = (acLayerNorm - 0.5) * vec2(aspect.x, 1.0) * 1.45;
            mat3 camR = vsEuler(rotDeg);
            vec3 ro = transpose(camR) * vec3(0.0, 0.0, camDist);
            vec3 rd = normalize(transpose(camR) * vec3(st, -1.6));
            float t = 0.0;
            bool hit = false;
            vec2 tv = vec2(majorR, minorR);
            for (int i = 0; i < 48; i++) {
                float d = sdVSTorus(ro + rd * t, tv);
                if (d < 0.001) { hit = true; break; }
                t += d;
                if (t > 10.0) break;
            }
            if (!hit) { gl_FragColor = vec4(0.0); return; }
            vec3 p = ro + rd * t;
            vec3 n = nVSTorus(p, tv);
            float u = atan(p.z, p.x) / (2.0 * VS_PI) + 0.5;
            float v = atan(p.y, length(p.xz) - majorR) / (2.0 * VS_PI) + 0.5;
            vec4 col = vsSample(vec2(u * repeatU, v), 2.0);
            gl_FragColor = vsLightingML(col, camR * n, rd, lightAmt, lightColor, ambientAmt);
        }
        """,
        tags=["torus", "donut"],
    ))

    # 2J. 3D Tube / Ring / Ring Dual (LayoutML3DTube & LayoutML3DRing / RingDual / RingSmooth)
    effects.append(make_effect(
        "ml3d_ring_tube",
        "VS: 3D Ring & Tube",
        "Decompiled from Video Star LayoutML3DRing, RingDual & 3D Tube — double-sided cylindrical band or dual rings.",
        [
            p_selector("ringMode", "Mode", ["3D Tube", "3D Ring Carousel", "Dual Counter-Rings"], 1),
            p_float("radius", "Radius", 0.65, 0.25, 1.2),
            p_float("heightAmt", "Band Height", 0.55, 0.15, 1.3),
            p_float("spinSpin", "Ring Spin", 0.0, -360.0, 360.0, unit="°"),
            p_xyz("rotDeg", "Tilt XYZ", "18.0,0.0,0.0"),
            p_float("camDist", "Distance", 2.5, 1.1, 6.0),
        ] + p_lighting(),
        r"""
        bool hitCylinderBand(vec3 ro, vec3 rd, float r, float hh, float spinRad, float tiles, inout float bestT, inout vec2 bestUV, inout vec3 bestN) {
            float a = rd.x * rd.x + rd.z * rd.z;
            if (a < 1e-6) return false;
            float b = 2.0 * (ro.x * rd.x + ro.z * rd.z);
            float c = ro.x * ro.x + ro.z * ro.z - r * r;
            float disc = b * b - 4.0 * a * c;
            if (disc < 0.0) return false;
            float sq = sqrt(disc);
            bool found = false;
            for (int k = 0; k < 2; k++) {
                float t = (k == 0 ? (-b - sq) : (-b + sq)) / (2.0 * a);
                if (t > 0.0 && t < bestT) {
                    vec3 p = ro + rd * t;
                    if (abs(p.y) <= hh) {
                        float ang = atan(p.z, p.x) + spinRad;
                        float u = fract(ang / (2.0 * VS_PI) * tiles);
                        // Add subtle gap between carousel panels in ring mode
                        if (tiles > 1.5 && (u < 0.06 || u > 0.94)) continue;
                        bestT = t;
                        bestUV = vec2(tiles > 1.5 ? (u - 0.06) / 0.88 : fract(ang / (2.0 * VS_PI)), p.y / (2.0 * hh) + 0.5);
                        bestN = normalize(vec3(p.x, 0.0, p.z)) * (k == 0 ? 1.0 : -1.0);
                        found = true;
                    }
                }
            }
            return found;
        }
        void main() {
            vec2 aspect = vsLayerAspect();
            vec2 st = (acLayerNorm - 0.5) * vec2(aspect.x, 1.0) * 1.45;
            mat3 camR = vsEuler(rotDeg);
            vec3 ro = transpose(camR) * vec3(0.0, 0.0, camDist);
            vec3 rd = normalize(transpose(camR) * vec3(st, -1.6));
            float bestT = 1e6;
            vec2 bestUV = vec2(0.0);
            vec3 bestN = vec3(0.0, 0.0, 1.0);
            float sp = spinSpin * 0.0174532925;
            if (ringMode == 0) {
                hitCylinderBand(ro, rd, radius, heightAmt * 0.65, sp, 1.0, bestT, bestUV, bestN);
            } else if (ringMode == 1) {
                hitCylinderBand(ro, rd, radius, heightAmt * 0.45, sp, 6.0, bestT, bestUV, bestN);
            } else {
                hitCylinderBand(ro - vec3(0.0, heightAmt * 0.38, 0.0), rd, radius, heightAmt * 0.3, sp, 6.0, bestT, bestUV, bestN);
                hitCylinderBand(ro + vec3(0.0, heightAmt * 0.38, 0.0), rd, radius * 0.85, heightAmt * 0.3, -sp, 6.0, bestT, bestUV, bestN);
            }
            if (bestT > 1e5) { gl_FragColor = vec4(0.0); return; }
            vec4 col = vsSample(bestUV, 1.0);
            gl_FragColor = vsLightingML(col, camR * bestN, rd, lightAmt, lightColor, ambientAmt);
        }
        """,
        tags=["ring", "tube", "carousel", "cylinder"],
    ))

    # 2K. 2D/3D Disk & Coins (LayoutML3DDisk & LayoutSCNEffectCoinSpin/Roll)
    effects.append(make_effect(
        "ml3d_disk_coin",
        "VS: 3D Disk & Coin Spin",
        "Decompiled from Video Star LayoutML3DDisk, CoinSpin & CoinRoll — extruded 3D video disk with metallic rim.",
        [
            p_float("radius", "Radius", 0.62, 0.2, 1.1),
            p_float("thickness", "Thickness", 0.08, 0.01, 0.4),
            p_color("rimColor", "Rim Color", "#FFFFD050"),
            p_xyz("rotDeg", "Rotation XYZ", "18.0,-30.0,0.0"),
            p_float("camDist", "Distance", 2.3, 1.2, 6.0),
        ] + p_lighting(),
        r"""
        float sdVSDisk(vec3 p, float h, float r) {
            vec2 d = abs(vec2(length(p.xy), p.z)) - vec2(r, h);
            return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
        }
        vec3 nVSDisk(vec3 p, float h, float r) {
            vec2 e = vec2(0.003, 0.0);
            return normalize(vec3(
                sdVSDisk(p + e.xyy, h, r) - sdVSDisk(p - e.xyy, h, r),
                sdVSDisk(p + e.yxy, h, r) - sdVSDisk(p - e.yxy, h, r),
                sdVSDisk(p + e.yyx, h, r) - sdVSDisk(p - e.yyx, h, r)
            ));
        }
        void main() {
            vec2 aspect = vsLayerAspect();
            vec2 st = (acLayerNorm - 0.5) * vec2(aspect.x, 1.0) * 1.45;
            mat3 camR = vsEuler(rotDeg);
            vec3 ro = transpose(camR) * vec3(0.0, 0.0, camDist);
            vec3 rd = normalize(transpose(camR) * vec3(st, -1.6));
            float t = 0.0;
            bool hit = false;
            for (int i = 0; i < 42; i++) {
                float d = sdVSDisk(ro + rd * t, thickness, radius);
                if (d < 0.001) { hit = true; break; }
                t += d;
                if (t > 10.0) break;
            }
            if (!hit) { gl_FragColor = vec4(0.0); return; }
            vec3 p = ro + rd * t;
            vec3 n = nVSDisk(p, thickness, radius);
            vec4 col;
            if (abs(n.z) > 0.65) {
                vec2 uv = p.xy / (2.0 * radius) + 0.5;
                if (n.z < 0.0) uv.x = 1.0 - uv.x;
                col = vsSample(uv, 1.0);
            } else {
                col = rimColor;
            }
            gl_FragColor = vsLightingML(col, camR * n, rd, lightAmt, lightColor, ambientAmt);
        }
        """,
        tags=["disk", "coin", "spin"],
    ))

    # 2L. 2D/3D Panel & Extruded Star (LayoutML3D2DPanel & LayoutML3DExtrudeStar)
    effects.append(make_effect(
        "ml3d_panel_extrude_star",
        "VS: 3D Bevel Panel / Extrude Star",
        "Decompiled from Video Star LayoutML3D2DPanel & LayoutML3DExtrudeStar — extruded 3D card or 5-point star solid.",
        [
            p_selector("shapeMode", "Shape", ["2D/3D Bevel Panel", "3D Extruded Star"], 0),
            p_float("sizeAmt", "Size", 0.62, 0.2, 1.1),
            p_float("depthAmt", "Thickness", 0.12, 0.01, 0.5),
            p_color("sideColor", "Side Wall Color", "#FF88AACC"),
            p_xyz("rotDeg", "Rotation XYZ", "20.0,-26.0,0.0"),
            p_float("camDist", "Distance", 2.35, 1.2, 6.0),
        ] + p_lighting(),
        r"""
        float sdStar5(vec2 p, float r, float rf) {
            const vec2 k1 = vec2(0.809016994375, -0.587785252292);
            const vec2 k2 = vec2(-k1.x, k1.y);
            p.x = abs(p.x);
            p -= 2.0 * max(dot(k1, p), 0.0) * k1;
            p -= 2.0 * max(dot(k2, p), 0.0) * k2;
            p.x = abs(p.x);
            p.y -= r;
            vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
            float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
            return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
        }
        float sdPanelOrStar(vec3 p, float s, float h, int m) {
            float d2;
            if (m == 0) {
                vec2 q = abs(p.xy) - vec2(s * 0.9, s * 0.9);
                d2 = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.06;
            } else {
                d2 = sdStar5(p.xy, s, 0.45);
            }
            vec2 w = vec2(d2, abs(p.z) - h);
            return min(max(w.x, w.y), 0.0) + length(max(w, 0.0));
        }
        vec3 nPanelOrStar(vec3 p, float s, float h, int m) {
            vec2 e = vec2(0.003, 0.0);
            return normalize(vec3(
                sdPanelOrStar(p + e.xyy, s, h, m) - sdPanelOrStar(p - e.xyy, s, h, m),
                sdPanelOrStar(p + e.yxy, s, h, m) - sdPanelOrStar(p - e.yxy, s, h, m),
                sdPanelOrStar(p + e.yyx, s, h, m) - sdPanelOrStar(p - e.yyx, s, h, m)
            ));
        }
        void main() {
            vec2 aspect = vsLayerAspect();
            vec2 st = (acLayerNorm - 0.5) * vec2(aspect.x, 1.0) * 1.45;
            mat3 camR = vsEuler(rotDeg);
            vec3 ro = transpose(camR) * vec3(0.0, 0.0, camDist);
            vec3 rd = normalize(transpose(camR) * vec3(st, -1.6));
            float t = 0.0;
            bool hit = false;
            for (int i = 0; i < 44; i++) {
                float d = sdPanelOrStar(ro + rd * t, sizeAmt, depthAmt, shapeMode);
                if (d < 0.001) { hit = true; break; }
                t += d;
                if (t > 10.0) break;
            }
            if (!hit) { gl_FragColor = vec4(0.0); return; }
            vec3 p = ro + rd * t;
            vec3 n = nPanelOrStar(p, sizeAmt, depthAmt, shapeMode);
            vec4 col;
            if (abs(n.z) > 0.65) {
                vec2 uv = p.xy / (2.0 * sizeAmt) + 0.5;
                if (n.z < 0.0) uv.x = 1.0 - uv.x;
                col = vsSample(uv, 1.0);
            } else {
                col = sideColor;
            }
            gl_FragColor = vsLightingML(col, camR * n, rd, lightAmt, lightColor, ambientAmt);
        }
        """,
        tags=["panel", "extrude", "star"],
    ))

    # =========================================================================
    # 3. DECOMPILED VIDEO STAR 3D SURFACES (Wavy, Raindrops, Turbulence, Heart, Wall, Retro, Chomp)
    # =========================================================================

    # 3A. 3D Wavy / Raindrops / Turbulence Sheet (LayoutML3DWavy / Raindrops / Turbulence3)
    effects.append(make_effect(
        "ml3d_wavy_raindrops_turb",
        "VS: 3D Wavy / Raindrops / Turbulence",
        "Decompiled from Video Star LayoutML3DWavy, Raindrops & Turbulence3 — 3D displaced cloth/ripple surface with Lighting3DML.",
        [
            p_selector("surfMode", "Surface Style", ["Wavy Sheet", "3D Raindrops", "3D Turbulence"], 0),
            p_float("ampAmt", "Wave Depth", 0.14, 0.0, 0.45),
            p_float("freqAmt", "Frequency", 4.5, 1.0, 14.0),
            p_float("phaseAmt", "Phase", 0.0, -6.28, 6.28),
            p_xyz("rotDeg", "Tilt XYZ", "24.0,-18.0,0.0"),
            p_float("camDist", "Distance", 2.2, 1.1, 6.0),
        ] + p_lighting(),
        r"""
        float surfHeight(vec2 xy, int m, float amp, float freq, float ph) {
            if (m == 0) {
                return sin(xy.x * freq + ph) * cos(xy.y * freq * 0.7 - ph * 0.5) * amp;
            } else if (m == 1) {
                float r1 = length(xy - vec2(0.18, 0.12));
                float r2 = length(xy - vec2(-0.24, -0.18));
                float w1 = sin(r1 * freq * 3.0 - ph * 2.0) * exp(-r1 * 2.5);
                float w2 = sin(r2 * freq * 3.0 - ph * 2.0 + 1.5) * exp(-r2 * 2.5);
                return (w1 + w2) * amp;
            } else {
                float n1 = vsNoise(xy * freq + vec2(ph * 0.4, ph * 0.25)) - 0.5;
                float n2 = vsNoise(xy * freq * 2.1 - vec2(ph * 0.3, ph * 0.5)) - 0.5;
                return (n1 * 0.7 + n2 * 0.3) * amp * 2.2;
            }
        }
        void main() {
            vec2 aspect = vsLayerAspect();
            vec2 st = (acLayerNorm - 0.5) * vec2(aspect.x, 1.0) * 1.45;
            mat3 camR = vsEuler(rotDeg);
            vec3 ro = transpose(camR) * vec3(0.0, 0.0, camDist);
            vec3 rd = normalize(transpose(camR) * vec3(st, -1.6));
            float t = 0.0;
            bool hit = false;
            float hw = 0.72, hh = 0.72;
            for (int i = 0; i < 44; i++) {
                vec3 p = ro + rd * t;
                float h = surfHeight(p.xy, surfMode, ampAmt, freqAmt, phaseAmt);
                float dBox = max(abs(p.x) - hw, abs(p.y) - hh);
                float dSurf = abs(p.z - h) - 0.008;
                float d = max(dSurf, dBox);
                if (d < 0.002) { hit = true; break; }
                t += max(0.015, d * 0.55);
                if (t > 9.0) break;
            }
            if (!hit) { gl_FragColor = vec4(0.0); return; }
            vec3 p = ro + rd * t;
            vec2 e = vec2(0.01, 0.0);
            float hx = surfHeight(p.xy + e.xy, surfMode, ampAmt, freqAmt, phaseAmt) - surfHeight(p.xy - e.xy, surfMode, ampAmt, freqAmt, phaseAmt);
            float hy = surfHeight(p.xy + e.yx, surfMode, ampAmt, freqAmt, phaseAmt) - surfHeight(p.xy - e.yx, surfMode, ampAmt, freqAmt, phaseAmt);
            vec3 n = normalize(vec3(-hx / 0.02, -hy / 0.02, 1.0));
            if (dot(n, rd) > 0.0) n = -n;
            vec2 uv = p.xy / vec2(2.0 * hw, 2.0 * hh) + 0.5;
            vec4 col = vsSample(uv, 0.0);
            gl_FragColor = vsLightingML(col, camR * n, rd, lightAmt, lightColor, ambientAmt);
        }
        """,
        tags=["wavy", "raindrops", "turbulence", "cloth"],
    ))

    # 3B. 3D Heart Morph (LayoutML3DHeartMorph & LayoutSCNEffectHeartBasic)
    effects.append(make_effect(
        "ml3d_heart",
        "VS: 3D Heart",
        "Decompiled from Video Star LayoutML3DHeartMorph & LayoutSCNEffectHeartBasic — 3D sculpted glossy heart.",
        [
            p_float("sizeAmt", "Size", 0.65, 0.2, 1.2),
            p_float("puffAmt", "Puffiness", 0.25, 0.05, 0.6),
            p_xyz("rotDeg", "Rotation XYZ", "10.0,-24.0,0.0"),
            p_float("camDist", "Distance", 2.35, 1.2, 6.0),
        ] + p_lighting(),
        r"""
        float sdVSHeart(vec3 p, float s, float puff) {
            p /= max(s, 0.01);
            p.y += 0.28;
            float z = p.z / max(puff * 1.4, 0.1);
            vec2 q = vec2(abs(p.x), p.y);
            // Smooth 2D heart implicit distance approximation
            float a = q.x * q.x + pow(q.y - 0.48 * sqrt(abs(q.x)), 2.0);
            float d2 = (sqrt(a) - 0.72) * 0.75;
            vec2 w = vec2(d2, abs(z) - 0.45);
            return (min(max(w.x, w.y), 0.0) + length(max(w, 0.0)) - 0.1) * s;
        }
        vec3 nVSHeart(vec3 p, float s, float puff) {
            vec2 e = vec2(0.004, 0.0);
            return normalize(vec3(
                sdVSHeart(p + e.xyy, s, puff) - sdVSHeart(p - e.xyy, s, puff),
                sdVSHeart(p + e.yxy, s, puff) - sdVSHeart(p - e.yxy, s, puff),
                sdVSHeart(p + e.yyx, s, puff) - sdVSHeart(p - e.yyx, s, puff)
            ));
        }
        void main() {
            vec2 aspect = vsLayerAspect();
            vec2 st = (acLayerNorm - 0.5) * vec2(aspect.x, 1.0) * 1.45;
            mat3 camR = vsEuler(rotDeg);
            vec3 ro = transpose(camR) * vec3(0.0, 0.0, camDist);
            vec3 rd = normalize(transpose(camR) * vec3(st, -1.6));
            float t = 0.0;
            bool hit = false;
            for (int i = 0; i < 46; i++) {
                float d = sdVSHeart(ro + rd * t, sizeAmt, puffAmt);
                if (d < 0.001) { hit = true; break; }
                t += d * 0.75;
                if (t > 10.0) break;
            }
            if (!hit) { gl_FragColor = vec4(0.0); return; }
            vec3 p = ro + rd * t;
            vec3 n = nVSHeart(p, sizeAmt, puffAmt);
            vec2 uv = p.xy / (1.8 * sizeAmt) + 0.5;
            if (n.z < 0.0) uv.x = 1.0 - uv.x;
            vec4 col = vsSample(uv, 1.0);
            gl_FragColor = vsLightingML(col, camR * n, rd, lightAmt, lightColor, ambientAmt);
        }
        """,
        tags=["heart", "morph"],
    ))

    # 3C. 3D Video Wall & Multi-Wall (LayoutML3DVideoWall & LayoutML3DMultiWall)
    effects.append(make_effect(
        "ml3d_video_wall",
        "VS: 3D Curved Video Wall",
        "Decompiled from Video Star LayoutML3DVideoWall & MultiWall — curved cylindrical 3D wall of tiled video screens.",
        [
            p_float("cols", "Columns", 4.0, 1.0, 10.0),
            p_float("rows", "Rows", 3.0, 1.0, 8.0),
            p_float("curveAmt", "Wall Curvature", 0.65, 0.0, 1.4),
            p_float("tileGap", "Bezel Gap", 0.06, 0.0, 0.25),
            p_xyz("rotDeg", "Rotation XYZ", "10.0,-22.0,0.0"),
            p_float("camDist", "Distance", 2.35, 1.1, 6.0),
        ] + p_lighting(),
        r"""
        void main() {
            vec2 aspect = vsLayerAspect();
            vec2 st = (acLayerNorm - 0.5) * vec2(aspect.x, 1.0) * 1.45;
            mat3 camR = vsEuler(rotDeg);
            vec3 ro = transpose(camR) * vec3(0.0, 0.0, camDist);
            vec3 rd = normalize(transpose(camR) * vec3(st, -1.6));
            float bestT = 1e6;
            vec2 bestUV = vec2(0.0);
            vec3 bestN = vec3(0.0, 0.0, 1.0);
            if (curveAmt < 0.05) {
                vec2 q = vsIntersectQuad(ro, rd, 0.8, 0.65);
                if (q.x > 0.0) {
                    bestT = q.x;
                    vec3 hp = ro + rd * q.x;
                    bestUV = hp.xy / vec2(1.6, 1.3) + 0.5;
                    bestN = vec3(0.0, 0.0, q.y);
                }
            } else {
                float R = mix(4.0, 0.85, clamp(curveAmt / 1.4, 0.0, 1.0));
                vec3 cylC = vec3(0.0, 0.0, R);
                vec3 cro = ro - cylC;
                float a = rd.x * rd.x + rd.z * rd.z;
                float b = 2.0 * (cro.x * rd.x + cro.z * rd.z);
                float c = cro.x * cro.x + cro.z * cro.z - R * R;
                float disc = b * b - 4.0 * a * c;
                if (disc >= 0.0) {
                    float sq = sqrt(disc);
                    for (int k = 0; k < 2; k++) {
                        float t = (k == 0 ? (-b + sq) : (-b - sq)) / (2.0 * a);
                        if (t > 0.0 && t < bestT) {
                            vec3 p = cro + rd * t;
                            float ang = atan(p.x, -p.z);
                            float maxAng = 0.85 / R;
                            if (abs(ang) <= maxAng && abs(p.y) <= 0.68) {
                                bestT = t;
                                bestUV = vec2(ang / (2.0 * maxAng) + 0.5, p.y / 1.36 + 0.5);
                                bestN = normalize(vec3(-p.x, 0.0, -p.z));
                            }
                        }
                    }
                }
            }
            if (bestT > 1e5) { gl_FragColor = vec4(0.0); return; }
            vec2 gridUV = bestUV * vec2(max(1.0, floor(cols + 0.5)), max(1.0, floor(rows + 0.5)));
            vec2 cell = fract(gridUV);
            if (cell.x < tileGap * 0.5 || cell.x > 1.0 - tileGap * 0.5 || cell.y < tileGap * 0.5 || cell.y > 1.0 - tileGap * 0.5) {
                gl_FragColor = vec4(0.03, 0.03, 0.04, 1.0);
                return;
            }
            vec2 subUV = (cell - tileGap * 0.5) / max(1.0 - tileGap, 0.01);
            vec4 col = vsSample(subUV, 1.0);
            gl_FragColor = vsLightingML(col, camR * bestN, rd, lightAmt, lightColor, ambientAmt);
        }
        """,
        tags=["wall", "video wall", "curved"],
    ))

    # 3D. 3D Chomp (LayoutML3DChomp)
    effects.append(make_effect(
        "ml3d_chomp",
        "VS: 3D Chomp",
        "Decompiled from Video Star LayoutML3DChomp — top & bottom halves hinging open & chomping shut in 3D.",
        [
            p_float("jawAngle", "Jaw Open", 35.0, 0.0, 120.0, unit="°"),
            p_xyz("rotDeg", "Rotation XYZ", "10.0,-28.0,0.0"),
            p_float("camDist", "Distance", 2.35, 1.2, 6.0),
        ] + p_lighting(),
        r"""
        void main() {
            vec2 aspect = vsLayerAspect();
            vec2 st = (acLayerNorm - 0.5) * vec2(aspect.x, 1.0) * 1.45;
            mat3 camR = vsEuler(rotDeg);
            vec3 ro = transpose(camR) * vec3(0.0, 0.0, camDist);
            vec3 rd = normalize(transpose(camR) * vec3(st, -1.6));
            float a = jawAngle * 0.0174532925;
            float bestT = 1e6;
            vec2 bestUV = vec2(0.0);
            vec3 bestN = vec3(0.0, 0.0, 1.0);
            float hw = 0.65, hh = 0.325;
            // Upper jaw hinged around (0, hh, 0)? Actually jaws meet at y=0, hinge at back or middle:
            // Top half hinges at y=+0.65 or opens around z=-0.65:
            vec3 pivot = vec3(0.0, 0.0, -0.35);
            for (int j = 0; j < 2; j++) {
                float sgn = j == 0 ? 1.0 : -1.0;
                mat3 rJ = vsRotX(-sgn * a * 0.5);
                vec3 lro = transpose(rJ) * (ro - pivot) - vec3(0.0, sgn * hh, 0.35);
                vec3 lrd = transpose(rJ) * rd;
                vec2 q = vsIntersectQuad(lro, lrd, hw, hh);
                if (q.x > 0.0 && q.x < bestT) {
                    bestT = q.x;
                    vec3 hp = lro + lrd * q.x;
                    float u = hp.x / (2.0 * hw) + 0.5;
                    float vLocal = hp.y / (2.0 * hh) + 0.5;
                    bestUV = vec2(u, j == 0 ? 0.5 + 0.5 * vLocal : 0.5 * vLocal);
                    bestN = rJ * vec3(0.0, 0.0, q.y);
                }
            }
            if (bestT > 1e5) { gl_FragColor = vec4(0.0); return; }
            vec4 col = vsSample(bestUV, 1.0);
            gl_FragColor = vsLightingML(col, camR * bestN, rd, lightAmt, lightColor, ambientAmt);
        }
        """,
        tags=["chomp", "jaw", "split"],
    ))

    # 3E. 3D Retro Tunnel / Grid Cascade & Kaleido Tile (LayoutML3DRetro / LayoutML3DKaleidoTile)
    effects.append(make_effect(
        "ml3d_retro_kaleido",
        "VS: 3D Retro Cascade / Kaleido Tile",
        "Decompiled from Video Star LayoutML3DRetro & LayoutML3DKaleidoTile — stacked 3D depth planes or mirrored tiles.",
        [
            p_selector("retroStyle", "Style", ["3D Retro Echo Stack", "3D Kaleido Tiles"], 0),
            p_float("depthSpread", "Z Depth Spread", 0.5, 0.0, 1.5),
            p_float("tileSpin", "Tile Spin / Offset", 20.0, -180.0, 180.0, unit="°"),
            p_xyz("rotDeg", "Rotation XYZ", "16.0,-22.0,0.0"),
            p_float("camDist", "Distance", 2.5, 1.2, 6.0),
        ] + p_lighting(),
        r"""
        void main() {
            vec2 aspect = vsLayerAspect();
            vec2 st = (acLayerNorm - 0.5) * vec2(aspect.x, 1.0) * 1.45;
            mat3 camR = vsEuler(rotDeg);
            vec3 ro = transpose(camR) * vec3(0.0, 0.0, camDist);
            vec3 rd = normalize(transpose(camR) * vec3(st, -1.6));
            float bestT = 1e6;
            vec4 bestCol = vec4(0.0);
            vec3 bestN = vec3(0.0, 0.0, 1.0);
            if (retroStyle == 0) {
                // 5 stepped 3D planes receding along -Z with frame cutouts
                for (int i = 0; i < 5; i++) {
                    float fi = float(i);
                    float zPos = (2.0 - fi) * depthSpread * 0.25;
                    float scl = 1.0 - fi * 0.08;
                    mat3 lr = vsRotZ(fi * tileSpin * 0.008);
                    vec3 lro = transpose(lr) * (ro - vec3(0.0, 0.0, zPos));
                    vec3 lrd = transpose(lr) * rd;
                    vec2 q = vsIntersectQuad(lro, lrd, 0.68 * scl, 0.68 * scl);
                    if (q.x > 0.0 && q.x < bestT) {
                        vec3 hp = lro + lrd * q.x;
                        vec2 uv = hp.xy / (1.36 * scl) + 0.5;
                        // Outer frames for front layers so behind layers peek through
                        vec2 edge = abs(uv - 0.5);
                        if (i == 4 || max(edge.x, edge.y) > 0.34 - fi * 0.03) {
                            bestT = q.x;
                            bestCol = vsSample(uv, 1.0);
                            bestCol.rgb *= (1.0 - fi * 0.12);
                            bestN = lr * vec3(0.0, 0.0, q.y);
                        }
                    }
                }
            } else {
                // 3x3 3D Kaleido flipping tiles
                float sp = tileSpin * 0.0174532925;
                for (int ix = -1; ix <= 1; ix++) {
                    for (int iy = -1; iy <= 1; iy++) {
                        vec3 center = vec3(float(ix), float(iy), 0.0) * 0.44;
                        float ang = sp + float(ix + iy) * depthSpread * 0.4;
                        mat3 tr = vsRotY(ang) * vsRotX(ang * 0.5);
                        vec3 lro = transpose(tr) * (ro - center);
                        vec3 lrd = transpose(tr) * rd;
                        vec2 q = vsIntersectQuad(lro, lrd, 0.2, 0.2);
                        if (q.x > 0.0 && q.x < bestT) {
                            bestT = q.x;
                            vec3 hp = lro + lrd * q.x;
                            vec2 uv = abs(hp.xy / 0.4);
                            bestCol = vsSample(mix(hp.xy / 0.4 + 0.5, uv, 0.7), 2.0);
                            bestN = tr * vec3(0.0, 0.0, q.y);
                        }
                    }
                }
            }
            if (bestT > 1e5) { gl_FragColor = vec4(0.0); return; }
            gl_FragColor = vsLightingML(bestCol, camR * bestN, rd, lightAmt, lightColor, ambientAmt);
        }
        """,
        tags=["retro", "kaleido", "stack"],
    ))

    # =========================================================================
    # 4. DECOMPILED VIDEO STAR FLIP / STRIP FLIP / SHATTER / ANIM SHAPE 3D EFFECTS
    # =========================================================================

    # 4A. 3D Strip Flip & Multi-Flip (LayoutML3DStripFlipHorizontal/Vertical & MultiFlip)
    effects.append(make_effect(
        "ml3d_strip_flip",
        "VS: 3D Strip Flip / Multi-Flip",
        "Decompiled from Video Star LayoutML3DStripFlip & MultiFlip H/V — Venetian-blind 3D slats flipping in perspective.",
        [
            p_float("progress", "Flip Angle", 45.0, -360.0, 360.0, unit="°"),
            p_float("strips", "Strip Count", 6.0, 2.0, 16.0),
            p_float("stagger", "Wave Stagger", 0.45, 0.0, 1.5),
            p_switch("verticalStrips", "Vertical Strips", False),
            p_xyz("camTilt", "Camera Tilt", "6.0,-14.0,0.0"),
        ] + p_lighting(),
        r"""
        void main() {
            vec2 aspect = vsLayerAspect();
            vec2 st = (acLayerNorm - 0.5) * vec2(aspect.x, 1.0) * 1.45;
            mat3 camR = vsEuler(camTilt);
            vec3 ro = transpose(camR) * vec3(0.0, 0.0, 2.25);
            vec3 rd = normalize(transpose(camR) * vec3(st, -1.6));
            int nStrips = int(clamp(floor(strips + 0.5), 2.0, 16.0));
            float fn = float(nStrips);
            float baseAng = progress * 0.0174532925;
            float bestT = 1e6;
            vec2 bestUV = vec2(0.0);
            vec3 bestN = vec3(0.0, 0.0, 1.0);
            float hw = 0.68, hh = 0.68;
            for (int i = 0; i < 16; i++) {
                if (i >= nStrips) break;
                float frac = (float(i) + 0.5) / fn;
                float a = baseAng + (frac - 0.5) * stagger * 1.6;
                vec3 pos;
                mat3 r;
                float sw, sh;
                if (verticalStrips) {
                    pos = vec3((frac - 0.5) * 2.0 * hw, 0.0, 0.0);
                    r = vsRotY(a);
                    sw = hw / fn;
                    sh = hh;
                } else {
                    pos = vec3(0.0, (frac - 0.5) * 2.0 * hh, 0.0);
                    r = vsRotX(a);
                    sw = hw;
                    sh = hh / fn;
                }
                vec3 lro = transpose(r) * (ro - pos);
                vec3 lrd = transpose(r) * rd;
                vec2 q = vsIntersectQuad(lro, lrd, sw * 0.985, sh * 0.985);
                if (q.x > 0.0 && q.x < bestT) {
                    bestT = q.x;
                    vec3 hp = lro + lrd * q.x;
                    vec2 localUV = hp.xy / vec2(2.0 * sw, 2.0 * sh) + 0.5;
                    if (q.y < 0.0) {
                        if (verticalStrips) localUV.x = 1.0 - localUV.x;
                        else localUV.y = 1.0 - localUV.y;
                    }
                    if (verticalStrips) {
                        bestUV = vec2((float(i) + localUV.x) / fn, localUV.y);
                    } else {
                        bestUV = vec2(localUV.x, (float(i) + localUV.y) / fn);
                    }
                    bestN = r * vec3(0.0, 0.0, q.y);
                }
            }
            if (bestT > 1e5) { gl_FragColor = vec4(0.0); return; }
            vec4 col = vsSample(bestUV, 1.0);
            gl_FragColor = vsLightingML(col, camR * bestN, rd, lightAmt, lightColor, ambientAmt);
        }
        """,
        tags=["strip", "flip", "multiflip", "slats"],
    ))

    # 4B. 3D Grid Flip (□ △ ◇ ⬡) & Flipboard (LayoutML3DStripFlipSquares/Diamonds/Triangles/Hexagons & SCN3DFlipboard)
    effects.append(make_effect(
        "ml3d_grid_flip",
        "VS: 3D Grid Flip & Flipboard (□ ◇ ⬡)",
        "Decompiled from Video Star LayoutML3DStripFlipSquares/Diamonds/Hexagons & SCN3DFlipboard — staggered 3D tile grid flip.",
        [
            p_float("progress", "Flip Angle", 48.0, -360.0, 360.0, unit="°"),
            p_float("gridN", "Grid Size", 5.0, 2.0, 8.0),
            p_selector("tileShape", "Tile Mask", ["Square □", "Diamond ◇", "Hexagon ⬡", "Split-Flap Clock"], 0),
            p_float("waveAmt", "Wave Cascade", 0.55, 0.0, 1.5),
            p_xyz("camTilt", "Camera Tilt", "10.0,-16.0,0.0"),
        ] + p_lighting(),
        r"""
        bool insideTileShape(vec2 q, int shape) {
            if (shape == 1) return (abs(q.x) + abs(q.y)) <= 0.5;
            if (shape == 2) {
                vec2 a = abs(q) * 2.0;
                return max(a.x * 0.866025 + a.y * 0.5, a.y) <= 0.98;
            }
            return true;
        }
        void main() {
            vec2 aspect = vsLayerAspect();
            vec2 st = (acLayerNorm - 0.5) * vec2(aspect.x, 1.0) * 1.45;
            mat3 camR = vsEuler(camTilt);
            vec3 ro = transpose(camR) * vec3(0.0, 0.0, 2.3);
            vec3 rd = normalize(transpose(camR) * vec3(st, -1.6));
            int N = int(clamp(floor(gridN + 0.5), 2.0, 8.0));
            float fN = float(N);
            float baseAng = progress * 0.0174532925;
            float bestT = 1e6;
            vec2 bestUV = vec2(0.0);
            vec3 bestN = vec3(0.0, 0.0, 1.0);
            float halfSpan = 0.68;
            float cell = halfSpan / fN;
            for (int ix = 0; ix < 8; ix++) {
                if (ix >= N) break;
                for (int iy = 0; iy < 8; iy++) {
                    if (iy >= N) break;
                    vec2 normIdx = (vec2(float(ix), float(iy)) + 0.5) / fN;
                    vec3 pos = vec3((normIdx - 0.5) * 2.0 * halfSpan, 0.0);
                    float diag = (normIdx.x + normIdx.y) * 0.5 - 0.5;
                    float a = baseAng + diag * waveAmt * 2.5;
                    mat3 r = (tileShape == 3) ? vsRotX(a) : vsRotY(a);
                    vec3 lro = transpose(r) * (ro - pos);
                    vec3 lrd = transpose(r) * rd;
                    vec2 q = vsIntersectQuad(lro, lrd, cell * 0.96, cell * 0.96);
                    if (q.x > 0.0 && q.x < bestT) {
                        vec3 hp = lro + lrd * q.x;
                        vec2 local = hp.xy / (2.0 * cell);
                        if (!insideTileShape(local, tileShape)) continue;
                        bestT = q.x;
                        vec2 luv = local + 0.5;
                        if (q.y < 0.0) luv.x = 1.0 - luv.x;
                        bestUV = (vec2(float(ix), float(iy)) + luv) / fN;
                        bestN = r * vec3(0.0, 0.0, q.y);
                    }
                }
            }
            if (bestT > 1e5) { gl_FragColor = vec4(0.0); return; }
            vec4 col = vsSample(bestUV, 1.0);
            gl_FragColor = vsLightingML(col, camR * bestN, rd, lightAmt, lightColor, ambientAmt);
        }
        """,
        tags=["grid", "flip", "flipboard", "hexagon", "diamond"],
    ))

    # 4C. 3D Shatter & Anim Shape (LayoutML3DShatterBlocks/Bricks/Puzzle/PaperTear & AnimShape)
    effects.append(make_effect(
        "ml3d_shatter",
        "VS: 3D Shatter & Anim Shape",
        "Decompiled from Video Star LayoutML3DShatterBlocks/Bricks/Geo/PaperTear & AnimShape — 3D tumbling/exploding shards.",
        [
            p_float("progress", "Explode", 0.35, 0.0, 1.5),
            p_selector("shatterMode", "Shard Layout", ["3D Blocks", "Running Bricks", "Radial Burst", "Pop-In Wave"], 0),
            p_float("gridN", "Piece Density", 5.0, 2.0, 8.0),
            p_float("tumbleAmt", "Tumble Spin", 1.0, 0.0, 3.0),
            p_xyz("camTilt", "Camera Tilt", "12.0,-18.0,0.0"),
        ] + p_lighting(),
        r"""
        void main() {
            vec2 aspect = vsLayerAspect();
            vec2 st = (acLayerNorm - 0.5) * vec2(aspect.x, 1.0) * 1.45;
            mat3 camR = vsEuler(camTilt);
            vec3 ro = transpose(camR) * vec3(0.0, 0.0, 2.35);
            vec3 rd = normalize(transpose(camR) * vec3(st, -1.6));
            int N = int(clamp(floor(gridN + 0.5), 2.0, 8.0));
            float fN = float(N);
            float halfSpan = 0.68;
            float cell = halfSpan / fN;
            float bestT = 1e6;
            vec2 bestUV = vec2(0.0);
            vec3 bestN = vec3(0.0, 0.0, 1.0);
            for (int ix = 0; ix < 8; ix++) {
                if (ix >= N) break;
                for (int iy = 0; iy < 8; iy++) {
                    if (iy >= N) break;
                    vec2 id = vec2(float(ix), float(iy));
                    float rowOff = (shatterMode == 1 && mod(id.y, 2.0) > 0.5) ? (0.5 / fN) : 0.0;
                    vec2 normIdx = (id + 0.5) / fN;
                    vec2 rnd = vec2(vsHash21(id + 1.3), vsHash21(id + 17.7)) - 0.5;
                    float rndZ = vsHash21(id + 41.9) - 0.5;
                    vec3 basePos = vec3((normIdx - 0.5) * 2.0 * halfSpan, 0.0);
                    float localP = progress;
                    vec3 disp = vec3(rnd * 1.4, rndZ * 1.8) * localP;
                    if (shatterMode == 2) {
                        vec2 dir2 = normalize(normIdx - 0.5 + vec2(0.001));
                        disp = vec3(dir2 * 1.1 + rnd * 0.4, (0.4 + rndZ) * 1.6) * localP;
                    } else if (shatterMode == 3) {
                        float delay = (normIdx.x + normIdx.y) * 0.35;
                        float waveP = clamp(localP * 1.4 - delay, 0.0, 1.5);
                        disp = vec3(0.0, 0.0, sin(waveP * 3.14159) * 0.65);
                    }
                    mat3 tr = vsRotY(rnd.x * localP * 5.0 * tumbleAmt) * vsRotX(rnd.y * localP * 5.0 * tumbleAmt);
                    vec3 lro = transpose(tr) * (ro - (basePos + disp));
                    vec3 lrd = transpose(tr) * rd;
                    vec4 h = vsIntersectBox(lro, lrd, vec3(cell * 0.96, cell * 0.96, 0.025));
                    if (h.x > 0.0 && h.x < bestT) {
                        bestT = h.x;
                        vec3 p = lro + lrd * h.x;
                        vec2 localUV = p.xy / (2.0 * cell * 0.96) + 0.5;
                        bestUV = (id + localUV) / fN;
                        bestUV.x = fract(bestUV.x + rowOff);
                        bestN = tr * h.yzw;
                    }
                }
            }
            if (bestT > 1e5) { gl_FragColor = vec4(0.0); return; }
            vec4 col = vsSample(bestUV, 1.0);
            gl_FragColor = vsLightingML(col, camR * bestN, rd, lightAmt, lightColor, ambientAmt);
        }
        """,
        tags=["shatter", "blocks", "bricks", "explode", "animshape"],
    ))

    # =========================================================================
    # 5. DECOMPILED VIDEO STAR LayoutSCNEffect*, CITrans3D*, BoogieBoxes & StarSphere
    # =========================================================================

    # 5A. 3D Checkerboard Floor (LayoutSCNEffectCheckerboard)
    effects.append(make_effect(
        "scn_checkerboard_3d",
        "VS: 3D Checkerboard Floor",
        "Decompiled from Video Star LayoutSCNEffectCheckerboard — endless 3D tiled perspective floor/ceiling.",
        [
            p_float("pitchDeg", "Pitch", 68.0, 10.0, 88.0, unit="°"),
            p_float("yawDeg", "Yaw", 0.0, -90.0, 90.0, unit="°"),
            p_float("scrollX", "Scroll X", 0.0, -5.0, 5.0),
            p_float("scrollZ", "Scroll Z", 0.0, -5.0, 5.0),
            p_float("tileDensity", "Tile Density", 3.0, 1.0, 10.0),
            p_switch("circleTiles", "Circular Coins", False),
        ] + p_lighting(),
        r"""
        void main() {
            vec2 aspect = vsLayerAspect();
            vec2 st = (acLayerNorm - 0.5) * vec2(aspect.x, 1.0) * 1.45;
            mat3 camR = vsRotY(yawDeg * 0.0174532925) * vsRotX(pitchDeg * 0.0174532925);
            vec3 ro = vec3(scrollX, 0.85, scrollZ);
            vec3 rd = normalize(camR * vec3(st, -1.35));
            // Plane y = 0
            if (abs(rd.y) < 1e-4) { gl_FragColor = vec4(0.0); return; }
            float t = -ro.y / rd.y;
            if (t <= 0.0 || t > 30.0) { gl_FragColor = vec4(0.0); return; }
            vec3 hit = ro + rd * t;
            vec2 grid = hit.xz * tileDensity;
            vec2 cid = floor(grid);
            vec2 fuv = fract(grid);
            // Checkerboard alternating visible/dim or circle cutout
            float chk = mod(cid.x + cid.y, 2.0);
            if (circleTiles && length(fuv - 0.5) > 0.45) {
                gl_FragColor = vec4(0.0);
                return;
            }
            vec4 col = vsSample(fuv, 1.0);
            col.rgb *= (chk > 0.5 ? 1.0 : 0.72);
            float horizonFade = exp(-t * 0.1);
            vec4 lit = vsLightingML(col, vec3(0.0, 1.0, 0.0), rd, lightAmt * 0.7, lightColor, ambientAmt);
            gl_FragColor = vec4(lit.rgb * horizonFade, lit.a * horizonFade);
        }
        """,
        tags=["checkerboard", "floor", "perspective"],
    ))

    # 5B. 3D Falling Shapes (LayoutSCNEffectFallingCubes / Spheres / Cylinders)
    effects.append(make_effect(
        "scn_falling_3d",
        "VS: 3D Falling Cubes & Spheres",
        "Decompiled from Video Star LayoutSCNEffectFallingCubes & Spheres — cascading 3D textured shapes tumbling in space.",
        [
            p_float("fallProgress", "Fall Progress", 0.35, -3.0, 3.0),
            p_selector("shapeType", "Shape", ["3D Cubes", "3D Spheres"], 0),
            p_float("spread", "Spread", 0.75, 0.2, 1.5),
            p_xyz("camTilt", "Camera Tilt", "10.0,-15.0,0.0"),
        ] + p_lighting(),
        r"""
        void main() {
            vec2 aspect = vsLayerAspect();
            vec2 st = (acLayerNorm - 0.5) * vec2(aspect.x, 1.0) * 1.45;
            mat3 camR = vsEuler(camTilt);
            vec3 ro = transpose(camR) * vec3(0.0, 0.0, 2.7);
            vec3 rd = normalize(transpose(camR) * vec3(st, -1.6));
            float bestT = 1e6;
            vec2 bestUV = vec2(0.0);
            vec3 bestN = vec3(0.0, 0.0, 1.0);
            for (int i = 0; i < 9; i++) {
                float fi = float(i);
                vec3 seed = vec3(vsHash21(vec2(fi, 1.0)) - 0.5, vsHash21(vec2(fi, 2.0)), vsHash21(vec2(fi, 3.0)) - 0.5);
                float y = mod(seed.y - fallProgress * (0.6 + seed.y * 0.5) + 1.5, 2.4) - 1.2;
                vec3 pos = vec3(seed.x * 1.8 * spread, y, seed.z * 1.3 * spread);
                mat3 sr = vsRotY((fallProgress * 2.5 + fi) * 1.3) * vsRotX((fallProgress * 1.8 + fi * 0.7) * 1.1);
                vec3 lro = transpose(sr) * (ro - pos);
                vec3 lrd = transpose(sr) * rd;
                if (shapeType == 0) {
                    vec4 h = vsIntersectBox(lro, lrd, vec3(0.18));
                    if (h.x > 0.0 && h.x < bestT) {
                        bestT = h.x;
                        bestUV = vsBoxFaceUV(lro + lrd * h.x, h.yzw, vec3(0.18));
                        bestN = sr * h.yzw;
                    }
                } else {
                    float b = dot(lro, lrd);
                    float c = dot(lro, lro) - 0.21 * 0.21;
                    float disc = b * b - c;
                    if (disc >= 0.0) {
                        float t = -b - sqrt(disc);
                        if (t > 0.0 && t < bestT) {
                            bestT = t;
                            vec3 p = lro + lrd * t;
                            vec3 n = normalize(p);
                            bestUV = vec2(atan(n.z, n.x) / (2.0 * VS_PI) + 0.5, asin(clamp(n.y, -1.0, 1.0)) / VS_PI + 0.5);
                            bestN = sr * n;
                        }
                    }
                }
            }
            if (bestT > 1e5) { gl_FragColor = vec4(0.0); return; }
            vec4 col = vsSample(bestUV, 1.0);
            gl_FragColor = vsLightingML(col, camR * bestN, rd, lightAmt, lightColor, ambientAmt);
        }
        """,
        tags=["falling", "cubes", "spheres"],
    ))

    # 5C. 3D Boogie Boxes (ClipMixerEffectTimedCITrans3DBoogieBoxRotateH/V + BoogieBoxesTrans)
    effects.append(make_effect(
        "boogie_boxes_3d",
        "VS: 3D Boogie Boxes",
        "Decompiled from Video Star ClipMixerEffectTimedCITrans3DBoogieBoxRotateH/V — 3×3 grid of 3D springing/rotating cubes.",
        [
            p_float("progress", "Transition", 0.35, 0.0, 1.0),
            p_selector("boogieAxis", "Axis", ["Rotate Horizontal", "Rotate Vertical", "Spring Cascade", "Swirl Zoom"], 0),
            p_float("gapAmt", "Box Gap", 0.02, 0.0, 0.12),
            p_xyz("camTilt", "Camera Tilt", "12.0,-16.0,0.0"),
        ] + p_lighting(),
        r"""
        void main() {
            vec2 aspect = vsLayerAspect();
            vec2 st = (acLayerNorm - 0.5) * vec2(aspect.x, 1.0) * 1.45;
            mat3 camR = vsEuler(camTilt);
            vec3 ro = transpose(camR) * vec3(0.0, 0.0, 2.35);
            vec3 rd = normalize(transpose(camR) * vec3(st, -1.6));
            float cell = 0.22;
            float stepP = cell * 2.0 + gapAmt;
            float bestT = 1e6;
            vec2 bestUV = vec2(0.0);
            vec3 bestN = vec3(0.0, 0.0, 1.0);
            for (int ix = -1; ix <= 1; ix++) {
                for (int iy = -1; iy <= 1; iy++) {
                    float idx = float((iy + 1) * 3 + (ix + 1));
                    float delay = (boogieAxis == 2) ? idx * 0.05 : float(abs(ix) + abs(iy)) * 0.06;
                    float p = clamp((progress - delay) / max(1.0 - delay, 0.1), 0.0, 1.0);
                    float ang = p * VS_PI * 0.5 * (boogieAxis == 2 ? (1.0 + 0.25 * sin(p * VS_PI)) : 1.0);
                    mat3 br;
                    vec3 off = vec3(0.0);
                    if (boogieAxis == 0) {
                        br = vsRotY(ang);
                    } else if (boogieAxis == 1) {
                        br = vsRotX(ang);
                    } else if (boogieAxis == 2) {
                        br = vsRotY(ang);
                        off.z = sin(p * VS_PI) * 0.35;
                    } else {
                        br = vsRotZ(ang * 2.0) * vsRotY(ang);
                        off.z = -sin(p * VS_PI) * 0.45;
                    }
                    vec3 center = vec3(float(ix) * stepP, float(iy) * stepP, 0.0) + off;
                    vec3 lro = transpose(br) * (ro - center);
                    vec3 lrd = transpose(br) * rd;
                    vec4 h = vsIntersectBox(lro, lrd, vec3(cell));
                    if (h.x > 0.0 && h.x < bestT) {
                        bestT = h.x;
                        vec2 localUV = vsBoxFaceUV(lro + lrd * h.x, h.yzw, vec3(cell));
                        bestUV = (vec2(float(ix + 1), float(iy + 1)) + localUV) / 3.0;
                        bestN = br * h.yzw;
                    }
                }
            }
            if (bestT > 1e5) { gl_FragColor = vec4(0.0); return; }
            vec4 col = vsSample(bestUV, 1.0);
            gl_FragColor = vsLightingML(col, camR * bestN, rd, lightAmt, lightColor, ambientAmt);
        }
        """,
        tags=["boogie", "boxes", "transition", "cube"],
    ))

    # 5D. 3D Transitions (CubeRotate / BackFlip / DiagFlip / DoorSwing)
    effects.append(make_effect(
        "citrans_3d",
        "VS: 3D Transition (Flip / Door / Cube)",
        "Decompiled from Video Star ClipMixerEffectTimedCITrans3D (BackFlip, DiagFlip, DoorSwing, CubeRotate).",
        [
            p_float("progress", "Progress", 0.35, 0.0, 1.0),
            p_selector("transMode", "Transition Style", ["3D Cube Rotate", "Back Flip", "Diagonal Flip", "Door Swing"], 0),
            p_float("depthPush", "Z Pushback", 0.45, 0.0, 1.5),
        ] + p_lighting(),
        r"""
        void main() {
            vec2 aspect = vsLayerAspect();
            vec2 st = (acLayerNorm - 0.5) * vec2(aspect.x, 1.0) * 1.45;
            float tProg = clamp(progress, 0.0, 1.0);
            float zPush = sin(tProg * VS_PI) * depthPush;
            vec3 ro = vec3(0.0, 0.0, 2.25 + zPush);
            vec3 rd = normalize(vec3(st, -1.6));
            float bestT = 1e6;
            vec2 bestUV = vec2(0.0);
            vec3 bestN = vec3(0.0, 0.0, 1.0);
            float ang = tProg * VS_PI;
            if (transMode == 0) {
                // 3D Cube Rotate (90 deg cube turn around center)
                mat3 r = vsRotY(tProg * VS_PI * 0.5);
                vec3 lro = transpose(r) * ro;
                vec3 lrd = transpose(r) * rd;
                vec4 h = vsIntersectBox(lro, lrd, vec3(0.68));
                if (h.x > 0.0) {
                    bestT = h.x;
                    bestUV = vsBoxFaceUV(lro + lrd * h.x, h.yzw, vec3(0.68));
                    bestN = r * h.yzw;
                }
            } else if (transMode == 1 || transMode == 2) {
                mat3 r = (transMode == 1) ? vsRotX(ang) : (vsRotZ(0.7854) * vsRotY(ang) * vsRotZ(-0.7854));
                vec3 lro = transpose(r) * ro;
                vec3 lrd = transpose(r) * rd;
                vec2 q = vsIntersectQuad(lro, lrd, 0.68, 0.68);
                if (q.x > 0.0) {
                    bestT = q.x;
                    vec3 hp = lro + lrd * q.x;
                    bestUV = hp.xy / 1.36 + 0.5;
                    if (q.y < 0.0) bestUV.x = 1.0 - bestUV.x;
                    bestN = r * vec3(0.0, 0.0, q.y);
                }
            } else {
                // Double Door Swing
                for (int d = 0; d < 2; d++) {
                    float sgn = d == 0 ? -1.0 : 1.0;
                    vec3 hinge = vec3(sgn * 0.68, 0.0, 0.0);
                    mat3 r = vsRotY(-sgn * tProg * VS_PI * 0.65);
                    vec3 lro = transpose(r) * (ro - hinge) - vec3(-sgn * 0.34, 0.0, 0.0);
                    vec3 lrd = transpose(r) * rd;
                    vec2 q = vsIntersectQuad(lro, lrd, 0.34, 0.68);
                    if (q.x > 0.0 && q.x < bestT) {
                        bestT = q.x;
                        vec3 hp = lro + lrd * q.x;
                        float uLocal = hp.x / 0.68 + 0.5;
                        bestUV = vec2(d == 0 ? uLocal * 0.5 : 0.5 + uLocal * 0.5, hp.y / 1.36 + 0.5);
                        bestN = r * vec3(0.0, 0.0, q.y);
                    }
                }
            }
            if (bestT > 1e5) { gl_FragColor = vec4(0.0); return; }
            vec4 col = vsSample(bestUV, 1.0);
            gl_FragColor = vsLightingML(col, bestN, rd, lightAmt, lightColor, ambientAmt);
        }
        """,
        tags=["transition", "flip", "door", "cube"],
    ))

    # 5E. 3D Star Sphere / Skybox Projection (FXInfoBGStarSphere & BackgroundCubemap.fs)
    effects.append(make_effect(
        "star_sphere_3d",
        "VS: 3D Star Sphere / Skybox",
        "Decompiled from Video Star FXInfoBGStarSphere & BackgroundCubemap.fs — 3D rotating celestial sphere projection.",
        [
            p_xyz("rotDeg", "Sphere Rotation", "15.0,45.0,0.0"),
            p_float("fovAmt", "Field of View", 1.0, 0.35, 2.2),
            p_float("tileWrap", "Wrap Repeat", 2.0, 1.0, 6.0),
        ],
        r"""
        void main() {
            vec2 aspect = vsLayerAspect();
            vec2 st = (acLayerNorm - 0.5) * vec2(aspect.x, 1.0) * fovAmt;
            vec3 dir = normalize(vsEuler(rotDeg) * vec3(st, 1.0));
            float u = atan(dir.x, dir.z) / (2.0 * VS_PI) + 0.5;
            float v = asin(clamp(dir.y, -1.0, 1.0)) / VS_PI + 0.5;
            gl_FragColor = vsSample(vec2(u * tileWrap, v), 2.0);
        }
        """,
        tags=["sphere", "skybox", "vr"],
        overdraw=False,
    ))

    return effects


def main() -> None:
    effects = build_effects()
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(effects, indent=2), encoding="utf-8")
    print(f"Wrote {len(effects)} Video Star 3D effects -> {OUT_JSON}")
    for e in effects:
        print(f"  - {e['id']} | {e['name']} | overdraw={e['overdraw']} | params={len(e['params'])}")


if __name__ == "__main__":
    main()
