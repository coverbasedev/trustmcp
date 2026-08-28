"use server";

import { redirect } from "next/navigation";
import type { VendorCreated } from "@trustmcp/sdk";
import { db } from "@/lib/db";
import { trustmcp, TrustMCPError } from "@/lib/trustmcp";
import { activeOrg } from "@/lib/team";
import { requireUser } from "@/lib/trustcenter";

export type CreateTrustCenterState = { error?: string };

/**
 * Create a trust center from the dashboard modal. Returns an inline error on
 * failure (so the modal can show it without a full-page reload) and redirects
 * into the new builder on success. Used with React's useActionState.
 */
export async function createTrustCenter(
  _prev: CreateTrustCenterState,
  formData: FormData,
): Promise<CreateTrustCenterState> {
  const user = await requireUser();
  const legalName = String(formData.get("legal_name") ?? "").trim();
  // Multiple product lines: blank entries are ignored; duplicates collapsed.
  const products = [
    ...new Set(
      formData
        .getAll("products")
        .map((p) => String(p).trim())
        .filter(Boolean),
    ),
  ];
  const domain = String(formData.get("domain") ?? "").trim().toLowerCase();
  if (!legalName) return { error: "Legal name is required." };
  // Light domain-format validation (a hostname, no scheme/spaces/path).
  if (domain && !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) {
    return { error: "Enter a valid primary domain like acme.com (no http:// or paths)." };
  }

  const org = await activeOrg(user.id, user.email);

  let created: VendorCreated;
  try {
    created = await trustmcp().createVendor({
      legal_name: legalName,
      products,
      domains: domain ? [domain] : [],
      notify_email: user.email ?? undefined,
    });
  } catch (e) {
    if (e instanceof TrustMCPError && (e.status >= 500 || e.status === 0)) {
      return {
        error:
          "Couldn't reach the TrustMCP network, or its service token isn't configured " +
          "(set TRUSTMCP_SERVICE_TOKEN). Please try again.",
      };
    }
    return { error: "Could not create the trust center. Please try again." };
  }

  try {
    await db.trustCenter.create({
      data: {
        orgId: org.id,
        vendorId: created.id,
        ownerToken: created.owner_token,
        legalName,
        createdById: user.id,
      },
    });
  } catch {
    return { error: "Created the vendor but couldn't save it locally. Please try again." };
  }

  // Success: redirect throws NEXT_REDIRECT, which Next handles (not an error).
  redirect(`/tc/${created.id}`);
}
