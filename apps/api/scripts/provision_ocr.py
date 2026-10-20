"""Build-time provisioning only; documents never leave the worker for OCR."""

import hashlib
import json
import os
from pathlib import Path
from urllib.request import urlopen

root = Path(os.environ.get("OCR_MODEL_ROOT", "/opt/lectureloop/models"))
manifest = json.loads(Path("app/ocr_models.json").read_text())
checksums = json.loads(Path("app/ocr_checksums.json").read_text())
for name, revision in manifest.items():
    folder = root / name
    folder.mkdir(parents=True, exist_ok=True)
    for file in ("inference.onnx", "inference.yml"):
        url = f"https://huggingface.co/PaddlePaddle/{name}_onnx/resolve/{revision}/{file}"
        path = folder / file
        with urlopen(url, timeout=180) as response, path.open("wb") as output:
            while data := response.read(1024 * 1024):
                output.write(data)
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest != checksums[name][file]:
            raise RuntimeError(f"Model checksum mismatch: {name}/{file}")
        print(name, file, path.stat().st_size, digest, flush=True)
(root / "revisions.json").write_text(json.dumps(manifest, indent=2))
