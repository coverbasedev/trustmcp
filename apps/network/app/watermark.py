"""Per-download PDF watermarking.

Stamps each page of a PDF with the requester's identity + timestamp so leaked copies
are traceable. The watermark is laid down *behind* the page content as faint, tiled
diagonal text plus a footer line, so it's legible enough to identify the recipient
without obscuring the document. Best-effort: if the bytes aren't a parseable PDF, the
original is returned unchanged.

Note: watermarking changes the bytes, so the watermarked copy's sha256 differs from the
manifest hash. The fetch response returns both the watermarked `sha256` and the
`original_sha256`.
"""

from __future__ import annotations

import io


def is_pdf(data: bytes, content_type: str | None) -> bool:
    return (content_type or "").lower().startswith("application/pdf") or data[:5] == b"%PDF-"


def stamp_pdf(data: bytes, tiled_text: str, footer_text: str | None = None) -> bytes:
    """Lay `tiled_text` faintly across every page (behind the content) plus an optional
    `footer_text` detail line. Returns the original bytes unchanged on any failure."""
    try:
        from pypdf import PdfReader, PdfWriter
        from reportlab.lib.colors import Color
        from reportlab.pdfgen import canvas
    except Exception:
        return data
    try:
        reader = PdfReader(io.BytesIO(data))
        writer = PdfWriter()
        for page in reader.pages:
            box = page.mediabox
            width, height = float(box.width), float(box.height)
            buf = io.BytesIO()
            c = canvas.Canvas(buf, pagesize=(width, height))

            # Faint tiled diagonal watermark covering the whole page.
            c.saveState()
            c.setFillColor(Color(0.45, 0.45, 0.45, alpha=0.10))
            c.setFont("Helvetica-Bold", 18)
            c.translate(width / 2, height / 2)
            c.rotate(45)
            reach = int(width + height)
            step_x, step_y = 300, 110
            y = -reach
            while y <= reach:
                x = -reach
                while x <= reach:
                    c.drawCentredString(x, y, tiled_text)
                    x += step_x
                y += step_y
            c.restoreState()

            # Footer detail line (full identity), faint.
            if footer_text:
                c.setFillColor(Color(0.4, 0.4, 0.4, alpha=0.32))
                c.setFont("Helvetica", 8)
                c.drawString(18, 10, footer_text)

            c.save()
            buf.seek(0)

            # Merge the page content ON TOP of the watermark so the stamp sits behind it.
            backdrop = PdfReader(buf).pages[0]
            backdrop.merge_page(page)
            writer.add_page(backdrop)
        out = io.BytesIO()
        writer.write(out)
        return out.getvalue()
    except Exception:
        return data
