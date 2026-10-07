import json
import os
import re
import shutil
import sys
from pathlib import Path

import pymupdf as fitz
import pdfplumber


MAX_PAGES = 100
MAX_EVIDENCE_CHARS = 120_000
FOCUS_SECTIONS = {1, 2, 3, 4, 5, 6, 7, 8, 13, 14, 15, 16}
SECTION_RE = re.compile(r"^\s*(?:SECTION\s*)?(1[0-6]|[1-9])\s*[.\-:]\s*", re.IGNORECASE)


def emit(payload):
    print(json.dumps(payload, ensure_ascii=False))


def normalize_text(value):
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()


def detect_section_pages(page_texts):
    section_pages = {}
    current_section = None
    for page_number, text in enumerate(page_texts, start=1):
        for line in text.splitlines():
            match = SECTION_RE.match(line)
            if match:
                section_number = int(match.group(1))
                current_section = section_number
                section_pages.setdefault(str(section_number), [])
                if page_number not in section_pages[str(section_number)]:
                    section_pages[str(section_number)].append(page_number)
        if current_section is not None:
            section_pages.setdefault(str(current_section), [])
            if page_number not in section_pages[str(current_section)]:
                section_pages[str(current_section)].append(page_number)
    return section_pages


def extract_best_tables(page):
    candidates = []
    settings_list = [
        {},
        {
            "vertical_strategy": "text",
            "horizontal_strategy": "text",
            "min_words_vertical": 2,
            "min_words_horizontal": 1,
            "intersection_tolerance": 5,
            "snap_tolerance": 4,
            "join_tolerance": 4,
        },
    ]
    for setting_index, settings in enumerate(settings_list):
        if setting_index > 0 and candidates:
            break
        try:
            tables = page.extract_tables(settings or None) or []
        except Exception:
            continue
        for table in tables:
            rows = []
            for row in table or []:
                cleaned = [normalize_text(cell) for cell in (row or [])]
                if any(cleaned):
                    rows.append(cleaned)
            if len(rows) < 2:
                continue
            width = max((len(row) for row in rows), default=0)
            if width == 0 or width > 10:
                continue
            non_empty = sum(1 for row in rows for cell in row if cell)
            score = non_empty + len(rows) * 2
            signature = json.dumps(rows, ensure_ascii=False, sort_keys=True)
            candidates.append((score, signature, rows))

    best_by_signature = {}
    for score, signature, rows in candidates:
        if signature not in best_by_signature or score > best_by_signature[signature][0]:
            best_by_signature[signature] = (score, rows)
    ranked = sorted(best_by_signature.values(), key=lambda item: item[0], reverse=True)
    return [rows for _, rows in ranked[:6]]


def table_to_markdown(table):
    width = max((len(row) for row in table), default=0)
    if width == 0:
        return ""
    padded = [row + [""] * (width - len(row)) for row in table]
    output = ["| " + " | ".join(padded[0]) + " |"]
    output.append("| " + " | ".join(["---"] * width) + " |")
    output.extend("| " + " | ".join(row) + " |" for row in padded[1:])
    return "\n".join(output)


def extract_pdf_content(pdf_path):
    path = Path(pdf_path)
    if not path.exists() or not path.is_file():
        raise ValueError("PDF file was not found.")
    if path.stat().st_size == 0:
        raise ValueError("PDF file is empty.")
    if b"%PDF-" not in path.read_bytes()[:1024]:
        raise ValueError("File signature is not PDF.")

    warnings = []
    page_texts = []
    page_metrics = []

    with fitz.open(path) as document:
        if document.needs_pass:
            raise ValueError("Password-protected PDFs are not supported.")
        if document.page_count == 0:
            raise ValueError("PDF has no pages.")
        if document.page_count > MAX_PAGES:
            raise ValueError(f"PDF exceeds the {MAX_PAGES}-page safety limit.")

        for index, page in enumerate(document):
            blocks = page.get_text("blocks", sort=True)
            text = "\n".join(
                block[4].strip() for block in blocks
                if len(block) > 4 and isinstance(block[4], str) and block[4].strip()
            )
            page_texts.append(text)
            image_count = len(page.get_images(full=True))
            char_count = len(re.sub(r"\s", "", text))
            needs_ocr = char_count < 40 and image_count > 0
            page_metrics.append({
                "page": index + 1,
                "text_chars": char_count,
                "image_count": image_count,
                "needs_ocr": needs_ocr,
            })

    section_pages = detect_section_pages(page_texts)
    detected_sections = {int(section) for section in section_pages}
    probable_msds = {1, 2, 3, 16}.issubset(detected_sections) and len(detected_sections) >= 12
    if not probable_msds:
        warnings.append(
            "The document does not contain enough of the standard 16 MSDS sections. "
            "Confirm that this is a product-specific MSDS rather than a label or safety guide."
        )
    focus_pages = set()
    for section in FOCUS_SECTIONS:
        focus_pages.update(section_pages.get(str(section), []))
    if not focus_pages:
        focus_pages = set(range(1, len(page_texts) + 1))

    tables_by_page = {}
    with pdfplumber.open(path) as pdf:
        for page_number in sorted(focus_pages):
            if page_number < 1 or page_number > len(pdf.pages):
                continue
            tables = extract_best_tables(pdf.pages[page_number - 1])
            if tables:
                tables_by_page[str(page_number)] = tables

    evidence_parts = []
    for page_number, text in enumerate(page_texts, start=1):
        if page_number not in focus_pages:
            continue
        evidence_parts.append(f"## Source page {page_number}\n{text.strip()}")
        for table_index, table in enumerate(tables_by_page.get(str(page_number), []), start=1):
            evidence_parts.append(
                f"### Detected table {table_index} on page {page_number}\n{table_to_markdown(table)}"
            )

    evidence = "\n\n".join(evidence_parts)
    if len(evidence) > MAX_EVIDENCE_CHARS:
        evidence = evidence[:MAX_EVIDENCE_CHARS]
        warnings.append("Extraction evidence was truncated at the configured character limit.")

    ocr_pages = [metric["page"] for metric in page_metrics if metric["needs_ocr"]]
    text_pages = len(page_metrics) - len(ocr_pages)
    if not ocr_pages:
        document_type = "text"
    elif text_pages == 0:
        document_type = "scanned"
    else:
        document_type = "mixed"

    ocr_available = bool(shutil.which("tesseract"))
    if ocr_pages and not ocr_available:
        warnings.append(
            "Some pages contain little embedded text. Native Gemini PDF vision will be used; "
            "install Tesseract kor+eng for a local OCR fallback."
        )

    return {
        "success": True,
        "markdown": evidence,
        "document_type": document_type,
        "page_count": len(page_texts),
        "probable_msds": probable_msds,
        "ocr_required": bool(ocr_pages),
        "ocr_available": ocr_available,
        "ocr_pages": ocr_pages,
        "section_pages": section_pages,
        "tables_extracted": sum(len(items) for items in tables_by_page.values()),
        "page_metrics": page_metrics,
        "warnings": warnings,
    }


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if len(sys.argv) != 2:
        emit({"success": False, "error": "Usage: extract_table.py <pdf_path>"})
        return
    try:
        emit(extract_pdf_content(sys.argv[1]))
    except Exception as error:
        emit({
            "success": False,
            "error": str(error),
            "error_type": type(error).__name__,
        })


if __name__ == "__main__":
    main()
