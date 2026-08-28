# The `agent-ready` Mark — Policy (DRAFT)

> **Status: non-binding draft.** Trademark and enforcement details require counsel.

The `agent-ready` mark is the consortium's **low-barrier verified** trust floor. It
answers the question: *if anyone can publish, what stops a vendor from just signing
any BS document?*

The honest, scoped answer: TrustMCP verifies **identity and custody**, not the truth of
every claim. The mark means **"this publisher controls the domain it publishes under,
and is publishing through the network."** It does **not** mean the evidence is good —
customers verify that themselves by reading the artifacts. That separation is the
whole point of TrustMCP.

## What the mark asserts

1. **Domain control.** The publisher proved control of each listed domain via a DNS
   `TXT` record (`_trustmcp-challenge.<domain>`) or a file at
   `https://<domain>/.well-known/trustmcp-challenge.txt`.
2. **Network custody.** The profile is served through an accredited TrustMCP network node
   that mints/validates keys and keeps an audit log.
3. **Verifiability.** Anyone can confirm the mark at `GET /v1/mark/{vendor_id}` —
   which returns the verified domains and issuance state. A self-asserted `mark`
   field in a discovery record is **not** valid without this network record.

## What the mark does NOT assert

- That a SOC 2 / pentest / certificate is genuine, current, or favorable.
- Any score, rating, or pass/fail judgment.
- Fitness for any particular customer's risk appetite.

## Granting

- **Free.** No fee, no manual vetting for the base mark.
- Granted automatically once at least one domain is verified.
- Tied to the verified domain(s); publishing under an unverified domain does not
  carry the mark.

## Maintaining & revocation

The mark may be **suspended or revoked** if:

- domain control can no longer be confirmed (e.g. the challenge is removed and a
  re-check fails),
- the publisher uploads content that is unlawful, malware, or knowingly forged
  (reported + reviewed),
- the publisher abuses the network (e.g. impersonation of another entity).

Revocation is reflected immediately at `GET /v1/mark/{vendor_id}` and in the audit
log. There is an appeal path to the Board `[…]`.

## Anti-impersonation

Because the mark is domain-bound, a publisher cannot claim a domain it does not
control. Legal-name collisions are allowed (two real "Acme"s may exist); the domain
is the disambiguator, and consumers resolve from a domain they already trust.

## Trademark

"TrustMCP", "TrustMCP", and the `agent-ready` mark are intended to be
trademarks held by the non-profit and licensed for use only on verified profiles per
this policy. Misuse (e.g. displaying the mark without a valid network record) is a
license violation.
