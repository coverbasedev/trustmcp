import { TrustMCPClient } from "@trustmcp/sdk";

/** Server-side TrustMCP Network client configured from env. */
export function trustmcp(): TrustMCPClient {
  return new TrustMCPClient({
    network: process.env.TRUSTMCP_NETWORK_URL ?? "http://localhost:8000",
    serviceToken: process.env.TRUSTMCP_SERVICE_TOKEN,
  });
}

export { TrustMCPError } from "@trustmcp/sdk";
export type { Vendor, Branding, ArtifactOut } from "@trustmcp/sdk";
