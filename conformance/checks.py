"""Transport-agnostic TrustMCP conformance checks.

`run(session, network, vendor_id, schema_dir)` exercises a network against the TrustMCP v0.1
contract and returns a list of (name, ok, detail). `session` is any object with a
`.get(url, headers=...)` returning an object that has `.status_code`, `.json()`,
`.content`, and `.headers` (httpx.Client and Starlette's TestClient both qualify).

Used by the standalone runner (`run.py`) and by the network's own test-suite.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os

Result = tuple[str, bool, str]


def _schema(schema_dir: str, name: str):
    with open(os.path.join(schema_dir, name)) as f:
        return json.load(f)


def _validate(instance, schema) -> str:
    from jsonschema import Draft202012Validator

    errors = sorted(Draft202012Validator(schema).iter_errors(instance), key=lambda e: e.path)
    return "" if not errors else f"{len(errors)} schema error(s): {errors[0].message}"


def _verify_sig(public_key_b64: str, signature_b64: str, body: bytes) -> bool:
    try:
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

        Ed25519PublicKey.from_public_bytes(base64.b64decode(public_key_b64)).verify(
            base64.b64decode(signature_b64), body
        )
        return True
    except Exception:
        return False


def run(session, network: str, vendor_id: str, schema_dir: str, key: str | None = None) -> list[Result]:
    network = network.rstrip("/")
    auth = {"Authorization": f"Bearer {key}"} if key else {}
    out: list[Result] = []

    def add(name, ok, detail=""):
        out.append((name, bool(ok), detail))

    # 1. Network public key
    pub = ""
    try:
        r = session.get(f"{network}/v1/network/key")
        pub = r.json().get("public_key", "")
        add("network key endpoint", r.status_code == 200 and bool(pub))
    except Exception as e:
        add("network key endpoint", False, str(e))

    # 2. Mark endpoint (public)
    try:
        r = session.get(f"{network}/v1/mark/{vendor_id}")
        add("mark endpoint", r.status_code == 200 and "mark" in r.json())
    except Exception as e:
        add("mark endpoint", False, str(e))

    # 3. Manifest: schema-valid + signature verifies
    try:
        r = session.get(f"{network}/v1/vendors/{vendor_id}/manifest", headers=auth)
        if r.status_code != 200:
            add("manifest readable", False, f"HTTP {r.status_code}")
        else:
            err = _validate(r.json(), _schema(schema_dir, "manifest.schema.json"))
            add("manifest schema-valid", err == "", err)
            sig = r.headers.get("X-TrustMCP-Signature", "")
            add("manifest signature", bool(sig) and _verify_sig(pub, sig, r.content),
                "missing or invalid signature")
    except Exception as e:
        add("manifest readable", False, str(e))

    # 4. Attestations: schema-valid + signature verifies
    try:
        r = session.get(f"{network}/v1/vendors/{vendor_id}/attestations", headers=auth)
        if r.status_code != 200:
            add("attestations readable", False, f"HTTP {r.status_code}")
        else:
            err = _validate(r.json(), _schema(schema_dir, "attestations.schema.json"))
            add("attestations schema-valid", err == "", err)
            sig = r.headers.get("X-TrustMCP-Signature", "")
            add("attestations signature", bool(sig) and _verify_sig(pub, sig, r.content), "")
    except Exception as e:
        add("attestations readable", False, str(e))

    # 5. Freshness
    try:
        r = session.get(f"{network}/v1/vendors/{vendor_id}/freshness", headers=auth)
        add("freshness endpoint", r.status_code == 200 and "items" in r.json())
    except Exception as e:
        add("freshness endpoint", False, str(e))

    # 6. Artifact fetch + hash verification
    try:
        manifest = session.get(f"{network}/v1/vendors/{vendor_id}/manifest", headers=auth).json()
        arts = manifest.get("artifacts", [])
        if not arts:
            add("artifact hash verification", True, "no artifacts to check")
        else:
            aid = arts[0]["id"]
            link = session.get(
                f"{network}/v1/vendors/{vendor_id}/artifacts/{aid}", headers=auth
            ).json()
            blob = session.get(link["url"])
            digest = hashlib.sha256(blob.content).hexdigest()
            add("artifact hash verification", digest == link.get("sha256"),
                "downloaded bytes do not match sha256")
    except Exception as e:
        add("artifact hash verification", False, str(e))

    # 7. OSCAL: capability descriptor, every model, and a verifying signature.
    #    A deployment claiming OSCAL support has to actually serve each model and
    #    sign it — a capabilities list nothing backs up is worse than none.
    models: list[str] = []
    try:
        r = session.get(f"{network}/v1/oscal/capabilities")
        body = r.json() if r.status_code == 200 else {}
        models = [m["name"] for m in body.get("vendor_models", [])]
        add(
            "oscal capabilities",
            r.status_code == 200 and bool(models) and bool(body.get("oscal_version")),
        )
    except Exception as e:
        add("oscal capabilities", False, str(e))

    for model in models:
        try:
            r = session.get(f"{network}/v1/vendors/{vendor_id}/oscal/{model}", headers=auth)
            if r.status_code != 200:
                add(f"oscal {model}", False, f"HTTP {r.status_code}")
                continue
            document = r.json()
            sig = r.headers.get("X-TrustMCP-Signature", "")
            add(
                f"oscal {model}",
                model in document
                and bool(sig)
                and _verify_sig(pub, sig, r.content),
                "missing root model or invalid signature",
            )
        except Exception as e:
            add(f"oscal {model}", False, str(e))

    # 8. OSCAL determinism: an unchanged export must be byte-identical, since that
    #    is what lets a continuous consumer diff digests instead of documents.
    if models:
        try:
            path = f"{network}/v1/vendors/{vendor_id}/oscal/{models[0]}"
            first = session.get(path, headers=auth)
            second = session.get(path, headers=auth)
            add(
                "oscal export is deterministic",
                first.headers.get("X-TrustMCP-OSCAL-Digest")
                == second.headers.get("X-TrustMCP-OSCAL-Digest")
                and bool(first.headers.get("X-TrustMCP-OSCAL-Digest")),
                "digest changed between identical pulls",
            )
        except Exception as e:
            add("oscal export is deterministic", False, str(e))

    # 9. OSCAL change feed: a cursor that a consumer can resume from.
    try:
        r = session.get(f"{network}/v1/vendors/{vendor_id}/oscal/changes", headers=auth)
        body = r.json() if r.status_code == 200 else {}
        add(
            "oscal change feed",
            r.status_code == 200 and "cursor" in body and "changes" in body,
        )
    except Exception as e:
        add("oscal change feed", False, str(e))

    return out


def summarize(results: list[Result]) -> tuple[int, int]:
    passed = sum(1 for _, ok, _ in results if ok)
    return passed, len(results)
