"""Smoke tests for tools.classify_tools.classify_doc_type.

The OpenAI client is patched — these tests never hit the real API.
Run with:  python -m unittest tests.test_classify_tools
       or  python tests/test_classify_tools.py
       (working directory: practiceiq/documents-backend)
"""
from __future__ import annotations

import json
import os
import sys
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

# Add the documents-backend root to sys.path so `from tools import ...` works
# regardless of how the tests are invoked.
_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.abspath(os.path.join(_HERE, ".."))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

# The classifier module reads OPENAI_API_KEY only when the cached client is
# constructed. Tests patch the client before it's used, so this default is
# only a defensive fallback.
os.environ.setdefault("OPENAI_API_KEY", "test-key")

from tools import classify_tools  # noqa: E402  -- import after sys.path setup


def _fake_response(payload: dict) -> MagicMock:
    """Build a MagicMock shaped like an OpenAI ChatCompletion response."""
    msg = MagicMock()
    msg.content = json.dumps(payload)
    choice = MagicMock()
    choice.message = msg
    resp = MagicMock()
    resp.choices = [choice]
    return resp


def _patch_primary_returning(payload: dict):
    """Patch the primary OpenAI client so create() returns `payload` as JSON."""
    fake_client = MagicMock()
    fake_client.chat.completions.create = AsyncMock(return_value=_fake_response(payload))
    return patch.object(classify_tools, "_client_primary", lambda: fake_client)


class ClassifyDocTypeTests(unittest.IsolatedAsyncioTestCase):

    async def test_real_looking_filename_classifies_sales_register(self):
        """Clear-match filename → returns the matching doc_type with high confidence."""
        pending = [
            {"doc_type": "sales_register", "label": "Sales Register", "period": "2026-04"},
            {"doc_type": "tds_challan", "label": "TDS Challan", "period": "2026-04"},
        ]
        with _patch_primary_returning(
            {"doc_type": "sales_register", "confidence": 0.92, "suggested_period": "2026-04"}
        ):
            result = await classify_tools.classify_doc_type(
                filename="April_GSTR1_Sales_Register.xlsx",
                caption="here is the sales register for April",
                pending=pending,
            )
        self.assertEqual(result["doc_type"], "sales_register")
        self.assertGreater(result["confidence"], 0.7)
        self.assertEqual(result["suggested_period"], "2026-04")

    async def test_signature_image_returns_null(self):
        """image001.png → null doc_type, low confidence."""
        pending = [{"doc_type": "sales_register", "label": "Sales Register", "period": "2026-04"}]
        with _patch_primary_returning(
            {"doc_type": None, "confidence": 0.0, "suggested_period": None}
        ):
            result = await classify_tools.classify_doc_type(
                filename="image001.png", caption="", pending=pending,
            )
        self.assertIsNone(result["doc_type"])
        self.assertLess(result["confidence"], 0.3)

    async def test_logo_returns_null(self):
        """logo.jpg → null doc_type."""
        pending = [{"doc_type": "sales_register", "label": "Sales Register", "period": "2026-04"}]
        with _patch_primary_returning(
            {"doc_type": None, "confidence": 0.05, "suggested_period": None}
        ):
            result = await classify_tools.classify_doc_type(
                filename="logo.jpg", caption="", pending=pending,
            )
        self.assertIsNone(result["doc_type"])
        self.assertLess(result["confidence"], 0.5)

    async def test_empty_pending_short_circuits(self):
        """Empty pending list → safe default, no OpenAI call attempted."""
        fake_client = MagicMock()
        fake_client.chat.completions.create = AsyncMock(
            side_effect=AssertionError("classifier must NOT call OpenAI when pending is empty")
        )
        with patch.object(classify_tools, "_client_primary", lambda: fake_client):
            result = await classify_tools.classify_doc_type(
                filename="anything.pdf", caption="", pending=[],
            )
        self.assertIsNone(result["doc_type"])
        self.assertEqual(result["confidence"], 0.0)
        self.assertIsNone(result["suggested_period"])
        # AsyncMock would have raised if called.
        fake_client.chat.completions.create.assert_not_awaited()

    async def test_invalid_doc_type_response_falls_back_to_null(self):
        """Defensive: model picks a doc_type not in pending → coerced to null."""
        pending = [{"doc_type": "sales_register", "label": "Sales Register", "period": "2026-04"}]
        with _patch_primary_returning(
            {"doc_type": "tds_challan", "confidence": 0.95, "suggested_period": "2026-04"}
        ):
            result = await classify_tools.classify_doc_type(
                filename="something.pdf", caption="", pending=pending,
            )
        self.assertIsNone(result["doc_type"])

    async def test_invalid_period_response_drops_period_only(self):
        """Defensive: model picks a period not in pending → period coerced to null but doc_type kept."""
        pending = [{"doc_type": "sales_register", "label": "Sales Register", "period": "2026-04"}]
        with _patch_primary_returning(
            {"doc_type": "sales_register", "confidence": 0.9, "suggested_period": "2025-12"}
        ):
            result = await classify_tools.classify_doc_type(
                filename="anything.pdf", caption="", pending=pending,
            )
        self.assertEqual(result["doc_type"], "sales_register")
        self.assertIsNone(result["suggested_period"])

    async def test_confidence_clamped_above_one(self):
        """Defensive: out-of-range confidence is clamped to [0, 1]."""
        pending = [{"doc_type": "sales_register", "label": "Sales Register", "period": "2026-04"}]
        with _patch_primary_returning(
            {"doc_type": "sales_register", "confidence": 1.7, "suggested_period": None}
        ):
            result = await classify_tools.classify_doc_type(
                filename="ok.pdf", caption="", pending=pending,
            )
        self.assertLessEqual(result["confidence"], 1.0)

    async def test_malformed_json_returns_safe_default(self):
        """Model returns non-JSON content → safe default, no exception."""
        fake_client = MagicMock()
        bad = MagicMock()
        bad.content = "not json {{{ ::"
        choice = MagicMock(); choice.message = bad
        resp = MagicMock(); resp.choices = [choice]
        fake_client.chat.completions.create = AsyncMock(return_value=resp)
        pending = [{"doc_type": "sales_register", "label": "Sales Register", "period": "2026-04"}]
        with patch.object(classify_tools, "_client_primary", lambda: fake_client):
            result = await classify_tools.classify_doc_type(
                filename="x.pdf", caption="", pending=pending,
            )
        self.assertIsNone(result["doc_type"])
        self.assertEqual(result["confidence"], 0.0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
