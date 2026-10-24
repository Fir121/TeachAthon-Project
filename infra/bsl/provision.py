"""Fetch pinned upstream assets at image build; never vendor corpus/engine into git."""

import hashlib
import io
import tarfile
import urllib.request
from pathlib import Path

REVISION = "ce93d533b24740879df1e84cbb5341dfa575fc1f"
SHA256 = "53953807b3b13650f9ff012a4b1ad9568ace06c867987cdd40b9a8db7501a448"
blob = urllib.request.urlopen(
    f"https://codeload.github.com/zhan-a/Kozha/tar.gz/{REVISION}", timeout=120
).read()
assert hashlib.sha256(blob).hexdigest() == SHA256, "Kozha archive checksum mismatch"
# Package only the English planner, BSL corpus and the selected unchanged avatar.
# In particular do not redistribute unrelated upstream corpora/authoring artifacts.
KEEP = {
    "LICENSE",
    "README.md",
    "public/credits.html",
    "data/hamnosys_bsl.csv",
    "data/hamnosys_bsl_version1.sigml",
    "data/hamnosys_bsl_version1.sigml.meta.json",
    "extension/panel.html",
    "extension/panel.js",
    "extension/cwa/allcsa.js",
    "extension/cwa/cwasa.css",
    "extension/cwa/cwacfg.json",
    "extension/cwa/avatars/anna.jar",
}
with tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz") as archive:
    selected = []
    for entry in archive.getmembers():
        relative = entry.name.partition("/")[2]
        if entry.isfile() and (
            relative in KEEP
            or (relative.startswith("server/") and "/tests/" not in relative)
        ):
            selected.append(entry)
    archive.extractall("/opt", members=selected, filter="data")
Path(f"/opt/Kozha-{REVISION}").rename("/opt/kozha")

# Kozha omits these standard CWASA support files. Keep official resources unchanged.
CWASA_BASE = "https://vhg.cmp.uea.ac.uk/tech/jas/vhg2024/"
SUPPORT = {
    "cwa/h2s.xsl": "e96036c343e15a29c1e00f9e95e7ef0b47196eb61583e97b1984b4aa2674cdea",
    "cwa/shaders/qskin.vert": "9b5f055bcef49472c10925daff47d7dfdb00a7b19d1ba4c3aad1ab4b7b13fd7b",
    "cwa/shaders/qskin.frag": "3986a7a7ffb26e5aff8677d216decd45945ff5e84dd2c99eb5042bf0986f48ff",
    "avatars/COMMON.jar": "80e35056778ff74b1ea81eed42342051e6f11964afc5d8858563a2016f3585cb",
}
for name, checksum in SUPPORT.items():
    payload = urllib.request.urlopen(CWASA_BASE + name, timeout=60).read()
    assert hashlib.sha256(payload).hexdigest() == checksum, (
        f"CWASA checksum mismatch: {name}"
    )
    target = Path("/opt/cwasa-support") / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(payload)
