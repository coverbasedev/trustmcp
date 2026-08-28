from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

# Make the sibling modules (trustmcp_client, demo_assessment) importable.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# Configure a throwaway network environment before importing the app.
_tmp = tempfile.mkdtemp(prefix="trustmcp-mcp-test-")
os.environ["TRUSTMCP_ENVIRONMENT"] = "test"
os.environ["TRUSTMCP_DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["TRUSTMCP_STORAGE_LOCAL_DIR"] = f"{_tmp}/artifacts"
os.environ["TRUSTMCP_SERVICE_TOKEN"] = "test-service-token"
os.environ["TRUSTMCP_PUBLIC_BASE_URL"] = "http://network"
