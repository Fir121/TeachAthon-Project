"""Untrusted artifacts never enter the application DOM. CSP/sandbox are the boundary.
Static checks reduce accidental unsupported output; they are not a JavaScript verifier.
"""

import html
import json
import re
from html.parser import HTMLParser
from pydantic import BaseModel, ConfigDict, Field

RENDER_CSP = (
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; "
    "img-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; "
    "form-action 'none'; frame-src 'none'; worker-src 'none'; media-src 'none'; "
    "frame-ancestors 'self'; sandbox allow-scripts"
)


class DiagramValidationError(ValueError):
    """Only fixed, source-free validation messages may cross the worker boundary."""


class Artifact(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=160)
    summary: str = Field(min_length=1, max_length=1200)
    instructions: str = Field(min_length=1, max_length=1800)
    accessibility_description: str = Field(min_length=1, max_length=2000)
    html: str = Field(min_length=1, max_length=60000)
    css: str = Field(min_length=1, max_length=24000)
    javascript: str = Field(min_length=1, max_length=60000)


class Fragment(HTMLParser):
    TAGS = set(
        "div span p h1 h2 h3 h4 section article header footer main label input button select option output fieldset legend details summary small strong em b i ul ol li dl dt dd table thead tbody tr th td caption br hr pre code canvas svg g path rect circle ellipse line polyline polygon text tspan defs marker title desc lineargradient stop clippath img".split()
    )
    VOID = {"input", "br", "hr", "img"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.controls = 0
        self.stack = []
        self.layout_roots = 0
        self.layout_regions = []
        self.layout_controls = 0
        self.layout_invalid = False

    def handle_starttag(self, tag, attrs):
        if tag not in self.TAGS:
            raise DiagramValidationError(
                "Unsupported HTML element. Generate a self-contained interaction without links or embeds."
            )
        attributes = dict(attrs)
        is_root = attributes.get("id") == "ll-diagram" and attributes.get("data-layout") == "responsive-v2"
        if (not self.stack and not is_root) or (is_root and tag != "div"):
            self.layout_invalid = True
        if is_root:
            self.layout_roots += 1
            if self.stack or self.parts:
                # Whitespace outside the root is harmless.
                if self.stack or any(part.strip() for part in self.parts):
                    self.layout_invalid = True
        region = attributes.get("data-region")
        if region in {"visual", "controls"}:
            if tag != "section":
                self.layout_invalid = True
            if len(self.stack) != 1 or not self.stack[0][1]:
                self.layout_invalid = True
            self.layout_regions.append(region)
        if tag in {"input", "button", "select"} and any(entry[2] == "controls" for entry in self.stack):
            self.layout_controls += 1
        if tag not in self.VOID:
            self.stack.append((tag, is_root, region))
        safe = []
        for name, value in attrs:
            value = value or ""
            if name.startswith("on") or name in {
                "srcdoc",
                "style",
                "form",
                "formaction",
                "action",
                "target",
                "nonce",
                "is",
                "ping",
                "download",
                "autofocus",
                "contenteditable",
                "srcset",
            }:
                raise DiagramValidationError("Unsupported HTML attribute. Put event listeners in the JavaScript field.")
            if name in {"href", "xlink:href", "src"}:
                if not (
                    tag == "img"
                    and name == "src"
                    and re.fullmatch(r"data:image/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+", value)
                ):
                    raise DiagramValidationError("Remote assets and links are not supported.")
            # Names are normalized by HTMLParser and reconstructed, never copied raw.
            if not re.fullmatch(r"[a-z][a-z0-9_:\-]*", name):
                raise DiagramValidationError("Invalid HTML attribute.")
            safe.append(f' {name}="{html.escape(value, quote=True)}"')
        self.parts.append(f"<{tag}{''.join(safe)}>")
        if tag in {"input", "button", "select"}:
            self.controls += 1

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in self.VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if tag not in self.TAGS:
            raise DiagramValidationError("Unsupported closing HTML element.")
        if tag not in self.VOID:
            if not self.stack or self.stack[-1][0] != tag:
                self.layout_invalid = True
            else:
                self.stack.pop()
            self.parts.append(f"</{tag}>")

    def handle_data(self, data):
        self.parts.append(html.escape(data))

    def handle_decl(self, decl):
        raise DiagramValidationError("Return an HTML fragment, not a whole document.")


def validate_artifact(value, *, require_responsive=False):
    artifact = Artifact.model_validate(value)
    if len(artifact.model_dump_json().encode()) > 150_000:
        raise DiagramValidationError("Diagram output exceeds 150 KB. Regenerate a smaller interaction.")
    fragment = Fragment()
    fragment.feed(artifact.html)
    fragment.close()
    if not fragment.controls:
        raise DiagramValidationError(
            "The diagram needs an operable input, select or button. Regenerate with meaningful controls."
        )
    if re.search(r"</?style|@import|url\s*\(|expression\s*\(|-moz-binding", artifact.css, re.I):
        raise DiagramValidationError("Diagram CSS must be self-contained without URL assets.")
    capability = re.search(
        r"\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|Worker|SharedWorker|importScripts|import|eval|Function|open|location|parent|opener|frames|cookie|localStorage|sessionStorage|indexedDB|serviceWorker|sendBeacon|postMessage)\b",
        artifact.javascript,
    )
    # `top` is also an ordinary geometry property/local variable. Reject explicit
    # outer-frame access rather than every occurrence of that word. These cheap
    # checks remain compatibility guards; opaque sandbox + CSP are the boundary.
    outer_frame = re.search(
        r"\b(?:window|self|globalThis)\s*(?:\??\.\s*top\b|\[\s*['\"]top['\"]\s*\])"
        r"|(?<![\w$.])top[ \t]*(?:\??\.[ \t]*[A-Za-z_$]|\[)",
        artifact.javascript,
    )
    if re.search(r"</?script", artifact.javascript, re.I) or capability or outer_frame:
        # Only fixed labels/known capability tokens enter source-free diagnostics.
        token = capability.group() if capability else "top" if outer_frame else "script tag"
        detail = f" ({token})"
        raise DiagramValidationError(
            f"Unsupported JavaScript capability{detail}. Regenerate without network, navigation, storage or parent access."
        )
    if require_responsive and (
        fragment.layout_roots != 1
        or sorted(fragment.layout_regions) != ["controls", "visual"]
        or not fragment.layout_controls
        or fragment.layout_invalid
        or fragment.stack
    ):
        raise DiagramValidationError(
            "Diagram needs the responsive-v2 root with separate visual and controls regions. Regenerate the layout."
        )
    artifact.html = "".join(fragment.parts)
    return artifact


def document(artifact, artifact_id, viewer):
    """Only trusted wrapper tags/scripts; generated HTML has been reconstructed."""
    data = json.dumps({"viewer": viewer, "artifact_id": artifact_id})
    fragment = Fragment()
    fragment.feed(artifact.html)
    responsive = (
        fragment.layout_roots == 1
        and sorted(fragment.layout_regions) == ["controls", "visual"]
        and not fragment.layout_invalid
    )
    body_class = ' class="ll-responsive"' if responsive else ""

    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(artifact.title)}</title>
<style>html{{color-scheme:light;font:16px system-ui}}body{{margin:0;padding:12px;overflow-wrap:anywhere;background:white;color:#17212b}}*{{box-sizing:border-box;max-width:100%}}svg,canvas{{height:auto;max-width:100%}}button,input,select{{font:inherit;min-height:44px}}button,input,select{{touch-action:manipulation}}:focus-visible{{outline:3px solid #2464cc;outline-offset:2px}}pre{{white-space:pre-wrap}}@media(prefers-reduced-motion:reduce){{*,*::before,*::after{{animation-duration:.01ms!important;transition-duration:.01ms!important}}}}</style>
<style>{artifact.css}</style>
<style>
html:has(body.ll-responsive){{width:100%;height:100%;max-width:none!important;margin:0!important;padding:0!important}}
body.ll-responsive{{height:100dvh;width:100%;max-width:none!important;padding:0!important;margin:0!important}}
body.ll-responsive #ll-diagram{{display:grid!important;grid-template-columns:minmax(0,1fr) minmax(190px,26%);grid-template-rows:minmax(0,1fr);gap:20px;width:100%!important;max-width:none!important;height:100%!important;min-height:0!important;margin:0!important;padding:20px;box-sizing:border-box}}
body.ll-responsive #ll-diagram>[data-region]{{min-width:0;min-height:0;max-width:none;max-height:100%;overflow:auto;overflow-wrap:anywhere}}
body.ll-responsive #ll-diagram>[data-region=visual]{{display:flex;flex-direction:column;justify-content:center;align-items:stretch}}
body.ll-responsive #ll-diagram>[data-region=visual]>svg,body.ll-responsive #ll-diagram>[data-region=visual]>canvas{{width:100%;height:100%;min-height:0;object-fit:contain;flex:1}}
body.ll-responsive #ll-diagram>[data-region=controls]{{align-self:center;padding:4px;font-size:14px;line-height:1.4}}
body.ll-responsive button{{min-height:44px;border:1px solid #cad6cd;border-radius:8px;background:#f3f6f1;color:#214438;padding:8px 12px;font:inherit;cursor:pointer}}
body.ll-responsive button:disabled{{opacity:.5;cursor:default}}
body.ll-responsive input[type=range]{{width:100%;padding:0;accent-color:#1c584b}}
body.ll-responsive label{{font-weight:600}}
@media(max-width:700px){{body.ll-responsive #ll-diagram{{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(100px,1fr) auto;gap:12px;padding:12px}}body.ll-responsive #ll-diagram>[data-region=controls]{{max-height:calc(100dvh - 140px);align-self:stretch;display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;align-content:start}}body.ll-responsive #ll-diagram>[data-region=controls]>*:not(button){{grid-column:1/-1}}body.ll-responsive #ll-diagram>[data-region=controls]>button{{grid-column:auto;margin:0!important;display:inline-flex;justify-content:center;align-items:center}}}}
</style>
<script>(()=>{{const identity={data};let failed=false;
const report=(type)=>window.parent.postMessage({{...identity,type}},'*');
window.addEventListener('error',()=>{{failed=true;report('diagram.error')}});
window.addEventListener('unhandledrejection',()=>{{failed=true;report('diagram.error')}});
window.addEventListener('load',()=>{{if(!failed)report('diagram.ready')}});
window.addEventListener('keydown',e=>{{if(e.key==='Escape')report('diagram.close')}});
document.addEventListener('click',e=>{{if(e.target.closest('a'))e.preventDefault()}},true);
}})();</script></head><body{body_class}>
{artifact.html}
<script>{artifact.javascript}</script></body></html>"""
