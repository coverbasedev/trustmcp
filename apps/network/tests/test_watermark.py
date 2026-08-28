from __future__ import annotations

import hashlib
import io

from tests.conftest import owner_headers


def _make_pdf() -> bytes:
    from reportlab.pdfgen import canvas

    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    c.drawString(72, 720, "Acme SOC 2 report")
    c.save()
    return buf.getvalue()


def test_watermarked_download(client, vendor):
    vid, owner = vendor
    h = owner_headers(owner)
    client.put(f"/v1/vendors/{vid}/profile", headers=h, json={"watermark_downloads": True})

    pdf = _make_pdf()
    art = client.post(f"/v1/vendors/{vid}/artifacts", headers=h,
                      json={"type": "soc2_type2", "issued_at": "2026-01-01"}).json()
    client.post(f"/v1/vendors/{vid}/artifacts/{art['id']}/content", headers=h,
                files={"file": ("soc2.pdf", pdf, "application/pdf")})
    client.post(f"/v1/vendors/{vid}/publish", headers=h)
    original_sha = hashlib.sha256(pdf).hexdigest()

    req = client.post("/v1/keys/request", json={
        "vendor_id": vid,
        "requester": {"name": "Globex", "domain": "globex.com", "contact": "t@globex.com"},
        "scope": ["artifacts"],
    }).json()
    grant = client.post(
        f"/v1/vendors/{vid}/keys/requests/{req['request_id']}/approve", headers=h, json={}
    ).json()
    bearer = {"Authorization": f"Bearer {grant['key']}"}

    link = client.get(f"/v1/vendors/{vid}/artifacts/{art['id']}", headers=bearer).json()
    assert link["watermarked"] is True
    assert link["original_sha256"] == original_sha
    assert link["sha256"] != original_sha  # watermarking changed the bytes

    # The downloaded copy is a valid, different PDF whose hash matches the response.
    blob = client.get(link["url"].replace("http://testserver", ""))
    assert blob.content[:5] == b"%PDF-"
    assert hashlib.sha256(blob.content).hexdigest() == link["sha256"]
