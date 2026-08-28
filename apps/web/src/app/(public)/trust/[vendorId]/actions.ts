"use server";

import { trustmcp } from "@/lib/trustmcp";

export type RequestResult = { ok: boolean; message: string; key?: string };

/** Derive a domain from an email or company-name fallback for the network's
 * requester model (which keys auto-release decisions off the domain). */
function domainFromEmail(email: string, fallback: string): string {
  const at = email.indexOf("@");
  if (at > -1 && at < email.length - 1) return email.slice(at + 1).toLowerCase();
  return (fallback || "unknown").toLowerCase().replace(/\s+/g, "");
}

export async function submitRequestAccess(
  vendorId: string,
  data: {
    firstName: string;
    lastName: string;
    email: string;
    company: string;
    reason: string;
    accessLevel: "full" | "limited";
    artifactIds: string[];
    ndaAccepted?: boolean;
    contract?: File | null;
  },
): Promise<RequestResult> {
  const name = `${data.firstName} ${data.lastName}`.trim();
  const email = data.email.trim();
  if (!name || !email) {
    return { ok: false, message: "Name and email are required." };
  }
  const requester = {
    name,
    domain: domainFromEmail(email, data.company),
    contact: email,
  };
  const artifact_ids = data.accessLevel === "limited" ? data.artifactIds : [];
  try {
    // If a contract is attached, use the contract endpoint (may auto-release). The
    // contract proves an existing agreement, so it requests full scope.
    if (data.contract instanceof File && data.contract.size > 0) {
      const res = await trustmcp().requestAccessWithContract(
        {
          vendor_id: vendorId,
          requester,
          scope: ["manifest", "attestations", "artifacts"],
          nda_accepted: data.ndaAccepted,
        },
        data.contract,
        data.contract.name,
      );
      if (res.status === "granted") {
        return {
          ok: true,
          key: res.key,
          message: "Access granted automatically. Save this scoped key - it won't be shown again:",
        };
      }
      return { ok: true, message: "Request submitted. The team will review it and email you." };
    }
    const res = await trustmcp().requestAccess({
      vendor_id: vendorId,
      requester,
      artifact_ids,
      company: data.company.trim() || undefined,
      reason: data.reason.trim() || undefined,
      nda_accepted: data.ndaAccepted,
    });
    if ((res as { status?: string }).status === "granted") {
      return {
        ok: true,
        key: (res as { key?: string }).key,
        message: "Access granted automatically. Save this scoped key - it won't be shown again:",
      };
    }
    return { ok: true, message: "Request submitted. The team will review it and email you." };
  } catch {
    return { ok: false, message: "Could not submit request. Please try again." };
  }
}

export async function subscribeToUpdates(
  vendorId: string,
  email: string,
): Promise<RequestResult> {
  if (!email.includes("@")) return { ok: false, message: "Enter a valid email." };
  try {
    await trustmcp().subscribe(vendorId, email.trim());
    return { ok: true, message: "Subscribed. We'll email you when this trust center updates." };
  } catch {
    return { ok: false, message: "Could not subscribe. Please try again." };
  }
}

export async function askQuestion(
  vendorId: string,
  question: string,
): Promise<{ available: boolean; answer: string }> {
  try {
    return await trustmcp().ask(vendorId, question.trim());
  } catch {
    return { available: true, answer: "Sorry - I couldn't answer that right now. Please try again." };
  }
}

export async function reclaimAccess(
  vendorId: string,
  email: string,
): Promise<RequestResult> {
  if (!email.includes("@")) return { ok: false, message: "Enter a valid email." };
  try {
    const res = await trustmcp().reclaimAccess(vendorId, email.trim());
    return { ok: true, message: res.message };
  } catch {
    return { ok: false, message: "Could not process that. Please try again." };
  }
}

export async function submitDpa(
  vendorId: string,
  data: {
    company_name: string;
    signer_name: string;
    signer_email: string;
    signer_title: string;
    contact_details: string;
    address: Record<string, string>;
    doing_business_as: string;
    registration_number: string;
    subscribe_email: string;
  },
): Promise<RequestResult> {
  if (!data.company_name || !data.signer_name || !data.signer_email.includes("@")) {
    return { ok: false, message: "Company name, signer name, and a valid signer email are required." };
  }
  try {
    await trustmcp().submitAgreement(vendorId, {
      type: "dpa",
      company_name: data.company_name.trim(),
      signer_name: data.signer_name.trim(),
      signer_email: data.signer_email.trim(),
      signer_title: data.signer_title.trim() || undefined,
      contact_details: data.contact_details.trim() || undefined,
      address: data.address,
      doing_business_as: data.doing_business_as.trim() || undefined,
      registration_number: data.registration_number.trim() || undefined,
      subscribe_email: data.subscribe_email.trim() || undefined,
    });
    return {
      ok: true,
      message: "Submitted. A signature request will be sent to the signer's email.",
    };
  } catch {
    return { ok: false, message: "Could not submit the DPA request. Please try again." };
  }
}

/** Resolve a short-lived download URL for a public artifact (for the inline viewer). */
export async function getPublicArtifactUrl(
  vendorId: string,
  artifactId: string,
): Promise<{ url?: string; contentType?: string | null }> {
  try {
    const res = await trustmcp().getPublicArtifact(vendorId, artifactId);
    return { url: res.url, contentType: res.content_type };
  } catch {
    return {};
  }
}
