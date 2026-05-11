"""Supabase service-role client (RLS bypassed). Used by all backend tools."""
from __future__ import annotations

import os
from functools import lru_cache

from dotenv import load_dotenv
from supabase import create_client, Client

# Load repo-root .env (three levels up from this file: tools/ -> documents-backend/ -> practiceiq/ -> repo).
_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO_ROOT = os.path.abspath(os.path.join(_HERE, "..", "..", ".."))
load_dotenv(os.path.join(_REPO_ROOT, ".env"))


@lru_cache(maxsize=1)
def supa() -> Client:
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_KEY"]
    return create_client(url, key)
