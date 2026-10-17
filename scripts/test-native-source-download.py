"""Offline release-build download checks; no compiler or external network needed."""

import hashlib
import importlib.util
import io
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
module_spec = importlib.util.spec_from_file_location("native_postgres", Path(__file__).with_name("build-native-postgres.py"))
builder = importlib.util.module_from_spec(module_spec)
module_spec.loader.exec_module(builder)


class Response(io.BytesIO):
    def __init__(self, body, declared=None):
        super().__init__(body)
        self.headers = {} if declared is None else {"Content-Length": str(declared)}


class DownloadTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.cache = Path(self.temporary.name)
        self.body = b"checksum-pinned archive bytes"
        self.spec = {"url": "https://example.invalid/source.tar.gz", "sha256": hashlib.sha256(self.body).hexdigest()}
        self.destination = self.cache / "source.tar.gz"
        self.partial = self.cache / "source.tar.gz.partial"

    def test_valid_response_is_verified_before_cache_promotion(self):
        with patch.object(builder.urllib.request, "urlopen", return_value=Response(self.body, len(self.body))) as opened:
            self.assertEqual(builder.checked_download(self.spec, self.cache), self.destination)
        opened.assert_called_once_with(self.spec["url"], timeout=120)
        self.assertEqual(self.destination.read_bytes(), self.body)
        self.assertFalse(self.partial.exists())

    def test_wrong_complete_response_is_retained_without_cache_promotion_or_retry(self):
        wrong = b"unexpected upstream response"
        with patch.object(builder.urllib.request, "urlopen", return_value=Response(wrong, len(wrong))) as opened:
            with self.assertRaisesRegex(RuntimeError, "observedSha256=" + hashlib.sha256(wrong).hexdigest()):
                builder.checked_download(self.spec, self.cache)
        self.assertEqual(opened.call_count, 1)
        self.assertFalse(self.destination.exists())
        self.assertEqual(self.partial.read_bytes(), wrong)

    def test_truncated_response_reports_size_and_hash_without_cache_promotion(self):
        with patch.object(builder.urllib.request, "urlopen", return_value=Response(self.body[:3], len(self.body))) as opened:
            with self.assertRaisesRegex(RuntimeError, f"expectedBytes={len(self.body)} observedBytes=3"):
                builder.checked_download(self.spec, self.cache)
        self.assertEqual(opened.call_count, 1)
        self.assertFalse(self.destination.exists())
        self.assertEqual(self.partial.read_bytes(), self.body[:3])

    def test_valid_response_without_content_length_still_requires_hash(self):
        with patch.object(builder.urllib.request, "urlopen", return_value=Response(self.body)):
            self.assertEqual(builder.checked_download(self.spec, self.cache), self.destination)

    def test_valid_cached_archive_is_rechecked_without_fetch(self):
        self.destination.write_bytes(self.body)
        with patch.object(builder.urllib.request, "urlopen") as opened:
            self.assertEqual(builder.checked_download(self.spec, self.cache), self.destination)
        opened.assert_not_called()

    def test_bad_cache_is_rejected_and_retained_without_fetch(self):
        self.destination.write_bytes(b"bad cache")
        with patch.object(builder.urllib.request, "urlopen") as opened:
            with self.assertRaisesRegex(RuntimeError, "Native source checksum mismatch"):
                builder.checked_download(self.spec, self.cache)
        opened.assert_not_called()
        self.assertEqual(self.destination.read_bytes(), b"bad cache")


if __name__ == "__main__":
    unittest.main()
