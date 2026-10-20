"""One short-lived, CPU-only PP-StructureV3 batch process; no provider calls."""

import json
import os
import subprocess
import sys
import time
import resource
from pathlib import Path

EXTRACTION_VERSION = "ppstructure3-3.7.0-ocr5mobile-layoutplus-onnx-v1"
BATCH_SIZE = 5


def pipeline():
    # Explicit directories and disabled modules avoid downloads of unused default models.
    os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
    from paddleocr import PPStructureV3
    from .config import settings

    root = Path(settings().ocr_model_root)
    return PPStructureV3(
        device="cpu",
        engine="onnxruntime",
        engine_config={
            "onnxruntime": {
                "providers": ["CPUExecutionProvider"],
                "intra_op_num_threads": 2,
                "inter_op_num_threads": 1,
                "log_severity_level": 3,
            }
        },
        cpu_threads=2,
        layout_detection_model_name="PP-DocLayout_plus-L",
        layout_detection_model_dir=str(root / "PP-DocLayout_plus-L"),
        text_detection_model_name="PP-OCRv5_mobile_det",
        text_detection_model_dir=str(root / "PP-OCRv5_mobile_det"),
        text_recognition_model_name="PP-OCRv5_mobile_rec",
        text_recognition_model_dir=str(root / "PP-OCRv5_mobile_rec"),
        text_recognition_batch_size=1,
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
        use_table_recognition=False,
        use_formula_recognition=False,
        use_seal_recognition=False,
        use_chart_recognition=False,
        use_region_detection=False,
    )


def extract_batch(pdf, folder, first, last):
    started = time.monotonic()
    engine = pipeline()
    folder.mkdir(parents=True, exist_ok=True)
    for number in range(first, last + 1):
        target = folder / f"{number}.json"
        if target.exists():
            continue
        prefix = folder / f"ocr-{number}"
        subprocess.run(
            [
                "pdftoppm",
                "-f",
                str(number),
                "-l",
                str(number),
                "-singlefile",
                "-cropbox",
                "-r",
                "150",
                "-png",
                str(pdf),
                str(prefix),
            ],
            check=True,
            capture_output=True,
            timeout=120,
        )
        image = prefix.with_suffix(".png")
        result = next(iter(engine.predict_iter(str(image))))
        # JSON serializer supplied by PaddleX handles numpy arrays and parsing blocks.
        value = result.json
        if isinstance(value, str):
            value = json.loads(value)
        value = value.get("res", value)
        blocks = []
        for index, block in enumerate(value.get("parsing_res_list", [])):
            blocks.append(
                {
                    "label": block.get("block_label"),
                    "text": block.get("block_content", ""),
                    "bbox": block.get("block_bbox"),
                    "order": block.get("block_order", index),
                    "id": block.get("block_id", index),
                }
            )
        data = {
            "page_number": number,
            "version": EXTRACTION_VERSION,
            "blocks": blocks,
            "text": "\n\n".join(b["text"] for b in blocks if b["text"].strip()),
            "coordinates": "150dpi-cropbox-rotation-applied",
            "models": json.loads(Path(__file__).with_name("ocr_models.json").read_text()),
        }
        temporary = target.with_suffix(".tmp")
        temporary.write_text(json.dumps(data, ensure_ascii=False))
        temporary.replace(target)
        image.unlink(missing_ok=True)
    (folder / f"batch-{first}-{last}.metrics.json").write_text(
        json.dumps(
            {
                "seconds": round(time.monotonic() - started, 3),
                "peak_rss_mib": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 1),
                "pages": last - first + 1,
                "threads": 2,
            }
        )
    )


if __name__ == "__main__":
    extract_batch(Path(sys.argv[1]), Path(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]))
