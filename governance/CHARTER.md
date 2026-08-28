# TrustMCP Consortium — Charter (DRAFT)

> **Status: non-binding draft for discussion.** Not legal advice. Before adoption,
> review with counsel and the founding members. Placeholders are marked `[…]`.

## 1. Purpose

The TrustMCP Consortium stewards an **open standard** for
publishing and accessing third-party assurance evidence in a machine-readable form.
Its mission is to move third-party risk from a **request model** to a **publish
model**: a vendor publishes once; each customer assesses on its own terms.

The Consortium is **neutral by design**. TrustMCP is not a product of any single company,
and the standard is licensed under Apache-2.0.

## 2. What the Consortium does

1. Maintains the TrustMCP **specification** and JSON Schemas.
2. Operates (or accredits operators of) the **reference network** — a thin trust
   anchor that verifies domain ownership, issues and validates the `agent-ready`
   mark, mints and validates access keys, and records an audit log.
3. Defines and enforces the **mark policy** (see `MARK_POLICY.md`).
4. Runs an open governance process for changes to the standard.

## 3. What the Consortium does NOT do

- It does **not** score, rate, rank, or certify the *quality* of any vendor.
- It does **not** interpret or transform the underlying evidence.
- It does **not** sell verdicts. The verdict is always computed by the customer.

This is the deliberate difference from pooled-assessment approaches that shipped
stale, one-size verdicts. TrustMCP shares the raw, current data.

## 4. Legal form

The Consortium is intended to be a **non-profit** ([501(c)(6) trade association] or
[directed fund of a neutral foundation such as the Linux Foundation / Joint
Development Foundation]). Final structure to be decided with counsel. Goals:

- Vendor-neutral ownership of the trademark (`agent-ready` mark) and the domain
  `trustmcp.org`.
- A low-cost or no-cost path to participation (see `MEMBERSHIP.md`).
- Clear IP terms: spec under Apache-2.0; trademark held by the non-profit and
  licensed under the mark policy.

## 5. Membership classes (summary)

| Class | Who | Rights |
|-------|-----|--------|
| Publisher | Vendors publishing a profile | Free. Get the mark after domain verification. |
| Consumer | Customers / GRC tools reading profiles | Free. |
| Steward | Funding members who govern the standard | Dues `[…]`; board seats. |
| Operator | Entities running an accredited network node | Conformance + audit obligations. |

Details and dues in `MEMBERSHIP.md`.

## 6. Governance

- A **Technical Steering Committee (TSC)** owns the spec; changes via public proposal
  + review. Initial seats from founding members; rotating thereafter.
- A **Board** owns trademark, budget, and the mark policy.
- Decisions default to **lazy consensus**; contested items go to a vote `[…]`.
- All spec work happens in the open (public repo, public issues).

## 7. Antitrust & neutrality commitments

- No member receives preferential access to another member's evidence.
- The standard and reference implementations remain open and forkable.
- Operators must meet the same conformance bar regardless of membership class.
- Standard antitrust guidelines apply to all meetings `[…]`.

## 8. Funding

Stewardship dues and grants fund spec maintenance and the reference network.
Publishing and consuming are free at the point of use. The Consortium does not
monetize access to evidence.

## 9. Amendments

This charter is amended by the Board with TSC consultation, by `[supermajority]`,
with `[30 days]` public notice.

---

### Founding-group call to action

We are assembling a founding group of vendors (publishers) and customers/GRC tools
(consumers) willing to commit to v0.1. If you operate a trust center today (Vanta,
Drata, SafeBase, etc.), TrustMCP gives you a better story: publish once, become
agent-ready, and keep full control with scoped, revocable access.
