"""Light text extraction (no OCR). PDF / xlsx / xls / csv / xml / txt only.

Returns extracted text or None for unsupported / image / scanned content.
Output is capped at MAX_CHARS to keep embedding inputs cheap.
"""
from __future__ import annotations

import csv
import io
import xml.etree.ElementTree as ET
from typing import Optional

from loguru import logger

MAX_CHARS = 50_000

ALLOWED_MIMES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",  # xlsx
    "application/vnd.ms-excel",  # xls / csv via Excel
    "text/csv",
    "text/xml",
    "application/xml",
    "text/plain",
    "image/jpeg",
    "image/png",
    "image/heic",
    "image/heif",
}


def is_allowed(mime: str | None) -> bool:
    return (mime or "").lower() in ALLOWED_MIMES


def _from_pdf(data: bytes) -> Optional[str]:
    try:
        import pdfplumber  # type: ignore
    except ImportError:
        logger.warning("pdfplumber not installed; cannot extract PDF text")
        return None
    try:
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            parts: list[str] = []
            for page in pdf.pages:
                t = page.extract_text() or ""
                if t:
                    parts.append(t)
                if sum(len(p) for p in parts) >= MAX_CHARS:
                    break
        text = "\n".join(parts).strip()
        return text or None
    except Exception as e:
        logger.warning(f"pdf extract failed: {e}")
        return None


def _from_xlsx(data: bytes) -> Optional[str]:
    try:
        import openpyxl  # type: ignore
    except ImportError:
        return None
    try:
        wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        rows: list[str] = []
        for ws in wb.worksheets:
            rows.append(f"[Sheet: {ws.title}]")
            for row in ws.iter_rows(values_only=True):
                cells = [str(c) for c in row if c is not None]
                if cells:
                    rows.append("\t".join(cells))
                if sum(len(r) for r in rows) >= MAX_CHARS:
                    return "\n".join(rows)[:MAX_CHARS]
        return "\n".join(rows) or None
    except Exception as e:
        logger.warning(f"xlsx extract failed: {e}")
        return None


def _from_xls(data: bytes) -> Optional[str]:
    try:
        import xlrd  # type: ignore
    except ImportError:
        return None
    try:
        book = xlrd.open_workbook(file_contents=data)
        rows: list[str] = []
        for sheet in book.sheets():
            rows.append(f"[Sheet: {sheet.name}]")
            for r in range(sheet.nrows):
                vals = [str(sheet.cell_value(r, c)) for c in range(sheet.ncols)]
                rows.append("\t".join(vals))
                if sum(len(x) for x in rows) >= MAX_CHARS:
                    return "\n".join(rows)[:MAX_CHARS]
        return "\n".join(rows) or None
    except Exception as e:
        logger.warning(f"xls extract failed: {e}")
        return None


def _from_csv(data: bytes) -> Optional[str]:
    try:
        text = _decode(data)
        reader = csv.reader(io.StringIO(text))
        rows = ["\t".join(r) for r in reader]
        out = "\n".join(rows)
        return out[:MAX_CHARS] or None
    except Exception as e:
        logger.warning(f"csv extract failed: {e}")
        return None


def _from_xml(data: bytes) -> Optional[str]:
    try:
        text = _decode(data)
        root = ET.fromstring(text)
        parts: list[str] = []

        def walk(elem):
            if elem.text and elem.text.strip():
                parts.append(elem.text.strip())
            for child in elem:
                walk(child)
                if sum(len(p) for p in parts) >= MAX_CHARS:
                    return

        walk(root)
        out = "\n".join(parts)
        return out[:MAX_CHARS] or None
    except Exception as e:
        logger.warning(f"xml extract failed: {e}")
        return None


def _from_txt(data: bytes) -> Optional[str]:
    try:
        return _decode(data)[:MAX_CHARS] or None
    except Exception:
        return None


def _decode(data: bytes) -> str:
    try:
        import chardet  # type: ignore
        guess = chardet.detect(data) or {}
        enc = guess.get("encoding") or "utf-8"
    except ImportError:
        enc = "utf-8"
    try:
        return data.decode(enc, errors="replace")
    except LookupError:
        return data.decode("utf-8", errors="replace")


def extract_text(filename: str, mime_type: str | None, data: bytes) -> Optional[str]:
    """Best-effort text extraction. Returns None for unsupported / image / scanned."""
    mime = (mime_type or "").lower()
    name = (filename or "").lower()

    if mime == "application/pdf" or name.endswith(".pdf"):
        return _from_pdf(data)
    if mime.endswith("spreadsheetml.sheet") or name.endswith(".xlsx"):
        return _from_xlsx(data)
    if mime == "application/vnd.ms-excel" and name.endswith(".xls"):
        return _from_xls(data)
    if name.endswith(".xls"):
        return _from_xls(data)
    if mime == "text/csv" or name.endswith(".csv"):
        return _from_csv(data)
    if mime in ("text/xml", "application/xml") or name.endswith(".xml"):
        return _from_xml(data)
    if mime == "text/plain" or name.endswith(".txt"):
        return _from_txt(data)
    # Images, scanned PDFs, anything else — no text in V1.
    return None
