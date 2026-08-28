"""The "Ask a question" trust-center assistant.

Grounds answers in the vendor's *published* profile (badges, controls, data
collected, subprocessors, FAQ, updates, and the list of available artifacts) and
calls the Anthropic API. It never invents evidence and never sees document
content - only the public metadata a visitor could already browse.

Degrades gracefully: if no API key is configured, returns a friendly message
pointing the visitor at the FAQ instead of erroring.
"""

from __future__ import annotations

from .config import Settings
from .models import Vendor

SYSTEM_PROMPT = (
    "You are the trust-center assistant for {name}. Answer questions about the "
    "company's security, privacy, and compliance posture using ONLY the context "
    "provided below. The context is the same information a visitor can browse on "
    "the public trust center.\n\n"
    "Rules:\n"
    "- If the answer is not in the context, say you don't have that information "
    "published and suggest requesting access to the underlying documents.\n"
    "- Never invent certifications, dates, subprocessors, or claims.\n"
    "- Be concise and factual. Respond with the final answer only - no "
    "exploratory reasoning, no preamble like 'Based on the context'.\n\n"
    "=== TRUST CENTER CONTEXT ===\n{context}\n=== END CONTEXT ==="
)


def build_context(vendor: Vendor) -> str:
    """Render the published profile into a compact text block for grounding."""
    lines: list[str] = []
    b = vendor.branding or {}
    lines.append(f"Company: {b.get('display_name') or vendor.legal_name}")
    if vendor.product:
        lines.append(f"Product: {vendor.product}")
    if b.get("description"):
        lines.append(f"About: {b['description']}")
    if vendor.domains:
        lines.append(f"Domains: {', '.join(vendor.domains)}")

    if vendor.badges:
        names = ", ".join(sorted(x.name for x in vendor.badges))
        lines.append(f"\nCompliance & certifications: {names}")

    if vendor.controls:
        lines.append("\nControls (by category):")
        by_cat: dict[str, list[str]] = {}
        for c in vendor.controls:
            mark = "" if c.status == "operating" else f" [{c.status}]"
            by_cat.setdefault(c.category, []).append(c.name + mark)
        for cat, items in by_cat.items():
            lines.append(f"- {cat}: {'; '.join(items)}")

    if vendor.data_types:
        collected = [d.label for d in vendor.data_types if d.collected]
        not_collected = [d.label for d in vendor.data_types if not d.collected]
        if collected:
            lines.append(f"\nData collected: {', '.join(collected)}")
        if not_collected:
            lines.append(f"Data NOT collected: {', '.join(not_collected)}")

    if vendor.subprocessors:
        lines.append("\nSubprocessors:")
        for s in vendor.subprocessors:
            bits = [s.name]
            if s.purpose:
                bits.append(s.purpose)
            if s.location:
                bits.append(f"({s.location})")
            lines.append(f"- {' - '.join(bits)}")

    if vendor.claims:
        lines.append("\nMachine-readable claims:")
        for c in sorted(vendor.claims, key=lambda x: x.key):
            lines.append(f"- {c.key}: {c.value}")

    if vendor.artifacts:
        lines.append("\nAvailable documents (request access to read):")
        for a in vendor.artifacts:
            access = "public" if a.access == "public" else "request access"
            lines.append(f"- {a.title or a.type} ({a.type}, {access})")

    if vendor.faqs:
        lines.append("\nFAQ:")
        for f in vendor.faqs:
            lines.append(f"Q: {f.question}\nA: {f.answer}")

    if vendor.updates:
        lines.append("\nRecent updates:")
        recent = sorted(
            vendor.updates, key=lambda x: (x.published_at or x.created_at.date()), reverse=True
        )[:10]
        for u in recent:
            when = u.published_at.isoformat() if u.published_at else ""
            lines.append(f"- {when} {u.title}: {u.body or ''}".strip())

    return "\n".join(lines)


def answer_question(vendor: Vendor, question: str, settings: Settings) -> dict:
    """Return {"answer": str, "available": bool}. Never raises on a missing key."""
    if not settings.ask_enabled:
        return {
            "available": False,
            "answer": (
                "The AI assistant isn't enabled for this trust center yet. "
                "Browse the FAQ and resources below, or request access to the "
                "underlying documents."
            ),
        }

    try:
        import anthropic
    except ModuleNotFoundError:  # pragma: no cover - dependency always present in prod
        return {
            "available": False,
            "answer": "The AI assistant is temporarily unavailable.",
        }

    name = (vendor.branding or {}).get("display_name") or vendor.legal_name
    system = SYSTEM_PROMPT.format(name=name, context=build_context(vendor))
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    try:
        message = client.messages.create(
            model=settings.ask_model,
            max_tokens=settings.ask_max_tokens,
            system=system,
            messages=[{"role": "user", "content": question}],
        )
    except anthropic.APIError:
        return {
            "available": True,
            "answer": "Sorry - I couldn't generate an answer right now. Please try again.",
        }
    text = "".join(b.text for b in message.content if b.type == "text").strip()
    return {"available": True, "answer": text or "I don't have that information published."}
