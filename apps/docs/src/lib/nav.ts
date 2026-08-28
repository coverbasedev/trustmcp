// Sidebar structure for the documentation site.
export type NavItem = { title: string; href: string };
export type NavSection = { title: string; items: NavItem[] };

export const NAV: NavSection[] = [
  {
    title: "Getting started",
    items: [
      { title: "Introduction", href: "/" },
      { title: "Quickstart", href: "/getting-started" },
    ],
  },
  {
    title: "Core concepts",
    items: [
      { title: "The five objects", href: "/concepts/the-five-objects" },
      { title: "Neutrality & governance", href: "/concepts/governance" },
    ],
  },
  {
    title: "For vendors",
    items: [
      { title: "Publish your trust center", href: "/vendors/publishing" },
      { title: "Branding", href: "/vendors/branding" },
      { title: "Artifacts & visibility", href: "/vendors/artifacts" },
      { title: "Google Drive sync", href: "/vendors/google-drive" },
      { title: "Resource presentation", href: "/vendors/artifacts#presentation" },
      { title: "Attestations", href: "/vendors/attestations" },
      { title: "Domains", href: "/vendors/publishing#verify-your-domain" },
      { title: "Access & approvals", href: "/vendors/access-and-approvals" },
      { title: "Reviewing requests & insights", href: "/vendors/reviewing-requests" },
      { title: "Connect HubSpot & Salesforce", href: "/vendors/crm-and-agent" },
      { title: "Auto-release policies", href: "/vendors/auto-release" },
      { title: "NDA & webhooks", href: "/vendors/nda-and-webhooks" },
      { title: "Teams & roles", href: "/vendors/teams-and-roles" },
    ],
  },
  {
    title: "For customers",
    items: [
      { title: "The assessment loop", href: "/customers/assessment-loop" },
      { title: "MCP server", href: "/customers/mcp" },
      { title: "REST integration", href: "/customers/rest" },
      { title: "Framework mapping", href: "/customers/frameworks" },
      { title: "OSCAL", href: "/customers/oscal" },
      { title: "Continuous OSCAL", href: "/customers/oscal-continuous" },
      { title: "Supply-chain graph", href: "/customers/graph" },
      { title: "Verifying signatures", href: "/customers/verifying-signatures" },
    ],
  },
  {
    title: "Operate",
    items: [
      { title: "Architecture", href: "/operate/architecture" },
      { title: "Self-hosting", href: "/operate/self-hosting" },
      { title: "Running a network node", href: "/operate/operators" },
    ],
  },
  {
    title: "Reference",
    items: [
      { title: "API reference", href: "/reference/api" },
      { title: "Schemas", href: "/reference/schemas" },
      { title: "Conformance & badge", href: "/reference/conformance" },
      { title: "FAQ", href: "/reference/faq" },
    ],
  },
];
