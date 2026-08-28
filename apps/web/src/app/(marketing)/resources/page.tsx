import type { Metadata } from "next";
import ResourcesGate from "./resources-gate";

export const metadata: Metadata = {
  title: "Free resources — TrustMCP",
  description:
    "TrustMCP and free security resources from Coverbase: the open-source trust-center standard, a SOC 2 report analyzer, and vendor monitoring with Radar.",
};

// QR-code landing page used in talks and presentations. Visitors can leave
// their contact details, but every resource is reachable without submitting.
export default function ResourcesPage() {
  return (
    <div className="mx-auto max-w-xl py-6 md:py-12">
      <h1 className="text-3xl font-semibold text-slate-900">Thanks for scanning!</h1>
      <p className="mt-3 text-slate-600">
        Here are the free resources from the talk — TrustMCP, its open-source code, and two free
        security tools from Coverbase.
      </p>
      <ResourcesGate />
    </div>
  );
}
