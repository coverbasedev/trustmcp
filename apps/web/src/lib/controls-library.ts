// Curated library of standard security/compliance controls a vendor can publish
// on their trust center. Mirrors compliance-frameworks.ts: the Controls builder
// lets owners search this catalog and add controls in a click instead of
// hand-typing every row. Controls are grouped by category (the same category is
// shown as a section heading on the public trust center).
//
// `id` is a stable machine value (handy for de-duping / future framework maps).
// `name` is the default control statement; `description` gives optional context.
// Owners can still add fully custom controls from the grid below the picker.

export type LibraryControl = {
  id: string;
  category: string;
  name: string;
  description: string;
};

export const CONTROL_CATEGORIES = [
  "Governance, Risk & Compliance",
  "Access Control",
  "Authentication & Identity",
  "Infrastructure & Cloud Security",
  "Network Security",
  "Data Security & Encryption",
  "Application & Product Security",
  "Endpoint Security",
  "Logging, Monitoring & Detection",
  "Vulnerability & Patch Management",
  "Change Management",
  "Incident Response",
  "Business Continuity & Disaster Recovery",
  "Backup & Resilience",
  "Vendor & Third-Party Risk",
  "Human Resources & Personnel Security",
  "Physical & Environmental Security",
  "Privacy & Data Protection",
] as const;

export type ControlCategory = (typeof CONTROL_CATEGORIES)[number];

export const CONTROL_LIBRARY: LibraryControl[] = [
  // --- Governance, Risk & Compliance ---
  { id: "grc.infosec_policy", category: "Governance, Risk & Compliance", name: "Information security policy maintained and reviewed annually", description: "A documented information security policy is approved by management and reviewed at least annually." },
  { id: "grc.risk_assessment", category: "Governance, Risk & Compliance", name: "Formal risk assessments conducted periodically", description: "Security risks are identified, assessed, and treated on a recurring basis." },
  { id: "grc.security_team", category: "Governance, Risk & Compliance", name: "Dedicated security function with defined ownership", description: "A named team or individual is accountable for the security program." },
  { id: "grc.security_training", category: "Governance, Risk & Compliance", name: "Security awareness training for all personnel", description: "Employees complete security awareness training at hire and at least annually." },
  { id: "grc.policy_acknowledgement", category: "Governance, Risk & Compliance", name: "Employees acknowledge security policies", description: "Staff formally acknowledge security and acceptable-use policies." },
  { id: "grc.compliance_monitoring", category: "Governance, Risk & Compliance", name: "Continuous compliance monitoring in place", description: "Controls are continuously monitored for compliance with applicable frameworks." },
  { id: "grc.internal_audit", category: "Governance, Risk & Compliance", name: "Internal audits of the control environment", description: "The control environment is periodically audited internally." },
  { id: "grc.risk_register", category: "Governance, Risk & Compliance", name: "Risk register maintained and tracked to remediation", description: "Identified risks are tracked in a register with owners and remediation status." },

  // --- Access Control ---
  { id: "access.rbac", category: "Access Control", name: "Role-based access control enforced", description: "Access to systems and data is granted based on least-privilege roles." },
  { id: "access.least_privilege", category: "Access Control", name: "Least-privilege access granted by default", description: "Users receive the minimum access required to perform their job." },
  { id: "access.quarterly_review", category: "Access Control", name: "Periodic access reviews performed", description: "User access rights are reviewed at least quarterly and adjusted as needed." },
  { id: "access.offboarding", category: "Access Control", name: "Access revoked on termination", description: "Access is removed promptly when an employee or contractor leaves." },
  { id: "access.provisioning", category: "Access Control", name: "Formal access provisioning and approval", description: "Access requests are approved by an authorized owner before being granted." },
  { id: "access.privileged", category: "Access Control", name: "Privileged access restricted and monitored", description: "Administrative access is limited to authorized personnel and logged." },
  { id: "access.shared_accounts", category: "Access Control", name: "Shared/generic accounts prohibited or controlled", description: "Use of shared credentials is restricted and individually attributable." },

  // --- Authentication & Identity ---
  { id: "auth.mfa", category: "Authentication & Identity", name: "Multi-factor authentication enforced", description: "MFA is required for access to production systems and key applications." },
  { id: "auth.sso", category: "Authentication & Identity", name: "Single sign-on for corporate applications", description: "Centralized SSO is used to manage authentication to internal apps." },
  { id: "auth.password_policy", category: "Authentication & Identity", name: "Strong password policy enforced", description: "Password complexity, length, and rotation requirements are enforced." },
  { id: "auth.session_mgmt", category: "Authentication & Identity", name: "Secure session management", description: "Sessions expire after inactivity and on logout." },
  { id: "auth.idp", category: "Authentication & Identity", name: "Centralized identity provider", description: "Identities are managed through a central identity provider." },

  // --- Infrastructure & Cloud Security ---
  { id: "infra.hardening", category: "Infrastructure & Cloud Security", name: "Systems hardened to a defined baseline", description: "Servers and services follow documented hardening standards." },
  { id: "infra.iac", category: "Infrastructure & Cloud Security", name: "Infrastructure managed as code", description: "Infrastructure is provisioned via version-controlled configuration." },
  { id: "infra.cspm", category: "Infrastructure & Cloud Security", name: "Cloud security posture monitored", description: "Cloud configurations are continuously assessed for misconfiguration." },
  { id: "infra.secrets", category: "Infrastructure & Cloud Security", name: "Secrets stored in a managed vault", description: "Credentials and secrets are stored in a dedicated secrets manager, not in code." },
  { id: "infra.separation", category: "Infrastructure & Cloud Security", name: "Production and non-production environments separated", description: "Production is isolated from development and test environments." },
  { id: "infra.least_priv_iam", category: "Infrastructure & Cloud Security", name: "Cloud IAM follows least privilege", description: "Cloud roles and policies grant only the permissions required." },

  // --- Network Security ---
  { id: "net.firewall", category: "Network Security", name: "Firewalls/security groups restrict traffic", description: "Network traffic is restricted by default-deny firewall rules." },
  { id: "net.segmentation", category: "Network Security", name: "Network segmentation in place", description: "Sensitive systems are isolated into separate network segments." },
  { id: "net.ids", category: "Network Security", name: "Intrusion detection/prevention deployed", description: "Network or host intrusion detection monitors for malicious activity." },
  { id: "net.ddos", category: "Network Security", name: "DDoS protection enabled", description: "Edge protections mitigate distributed denial-of-service attacks." },
  { id: "net.waf", category: "Network Security", name: "Web application firewall in front of services", description: "A WAF filters malicious requests to public-facing applications." },
  { id: "net.vpn", category: "Network Security", name: "Remote access via secured VPN/zero-trust", description: "Administrative remote access requires a secured VPN or zero-trust gateway." },

  // --- Data Security & Encryption ---
  { id: "data.encrypt_rest", category: "Data Security & Encryption", name: "Data encrypted at rest", description: "Customer data is encrypted at rest using strong algorithms (e.g. AES-256)." },
  { id: "data.encrypt_transit", category: "Data Security & Encryption", name: "Data encrypted in transit", description: "Data in transit is protected with TLS 1.2+." },
  { id: "data.key_mgmt", category: "Data Security & Encryption", name: "Encryption keys managed and rotated", description: "Keys are stored in a KMS and rotated on a defined schedule." },
  { id: "data.classification", category: "Data Security & Encryption", name: "Data classification scheme applied", description: "Data is classified by sensitivity and handled accordingly." },
  { id: "data.dlp", category: "Data Security & Encryption", name: "Data loss prevention controls", description: "Controls detect and prevent unauthorized exfiltration of sensitive data." },
  { id: "data.retention", category: "Data Security & Encryption", name: "Data retention and disposal policy", description: "Data is retained only as long as needed and securely disposed of." },

  // --- Application & Product Security ---
  { id: "app.sdlc", category: "Application & Product Security", name: "Secure software development lifecycle", description: "Security is integrated throughout the development lifecycle." },
  { id: "app.code_review", category: "Application & Product Security", name: "Peer code review required", description: "Code changes are peer-reviewed before merging to production." },
  { id: "app.sast", category: "Application & Product Security", name: "Static application security testing", description: "Source code is scanned automatically for vulnerabilities (SAST)." },
  { id: "app.dast", category: "Application & Product Security", name: "Dynamic application security testing", description: "Running applications are scanned for vulnerabilities (DAST)." },
  { id: "app.sca", category: "Application & Product Security", name: "Dependency / software composition analysis", description: "Third-party dependencies are scanned for known vulnerabilities." },
  { id: "app.pentest", category: "Application & Product Security", name: "Annual third-party penetration testing", description: "Independent penetration tests are performed at least annually." },
  { id: "app.secrets_scan", category: "Application & Product Security", name: "Secret scanning in repositories", description: "Repositories are scanned to prevent committed secrets." },

  // --- Endpoint Security ---
  { id: "endpoint.edr", category: "Endpoint Security", name: "Endpoint detection & response deployed", description: "EDR/anti-malware runs on company endpoints." },
  { id: "endpoint.disk_encrypt", category: "Endpoint Security", name: "Full-disk encryption on endpoints", description: "Company laptops use full-disk encryption." },
  { id: "endpoint.mdm", category: "Endpoint Security", name: "Mobile device management enforced", description: "Endpoints are managed and policy-enforced via MDM." },
  { id: "endpoint.patching", category: "Endpoint Security", name: "Automatic endpoint patching", description: "Operating systems and software on endpoints are kept up to date." },
  { id: "endpoint.screen_lock", category: "Endpoint Security", name: "Automatic screen lock configured", description: "Endpoints lock automatically after inactivity." },

  // --- Logging, Monitoring & Detection ---
  { id: "log.centralized", category: "Logging, Monitoring & Detection", name: "Centralized logging of security events", description: "Security-relevant logs are aggregated centrally." },
  { id: "log.siem", category: "Logging, Monitoring & Detection", name: "SIEM with alerting", description: "A SIEM correlates events and raises alerts on suspicious activity." },
  { id: "log.audit_trail", category: "Logging, Monitoring & Detection", name: "Audit trails for access and changes", description: "Access and configuration changes are logged and retained." },
  { id: "log.integrity", category: "Logging, Monitoring & Detection", name: "Logs protected against tampering", description: "Logs are write-protected and retained per policy." },
  { id: "log.alert_oncall", category: "Logging, Monitoring & Detection", name: "24/7 alerting to on-call", description: "Critical alerts are routed to an on-call rotation around the clock." },

  // --- Vulnerability & Patch Management ---
  { id: "vuln.scanning", category: "Vulnerability & Patch Management", name: "Regular vulnerability scanning", description: "Systems are scanned for vulnerabilities on a recurring schedule." },
  { id: "vuln.sla", category: "Vulnerability & Patch Management", name: "Remediation SLAs by severity", description: "Vulnerabilities are remediated within defined timeframes based on severity." },
  { id: "vuln.patch_mgmt", category: "Vulnerability & Patch Management", name: "Patch management process", description: "Security patches are tested and applied in a timely manner." },
  { id: "vuln.disclosure", category: "Vulnerability & Patch Management", name: "Responsible disclosure / bug bounty program", description: "External researchers can report vulnerabilities through a defined channel." },

  // --- Change Management ---
  { id: "change.process", category: "Change Management", name: "Formal change management process", description: "Production changes follow a documented, approved process." },
  { id: "change.cicd", category: "Change Management", name: "Automated CI/CD with controls", description: "Deployments run through automated pipelines with gating controls." },
  { id: "change.rollback", category: "Change Management", name: "Tested rollback procedures", description: "Changes can be rolled back safely if issues arise." },

  // --- Incident Response ---
  { id: "ir.plan", category: "Incident Response", name: "Documented incident response plan", description: "A formal incident response plan defines roles and procedures." },
  { id: "ir.testing", category: "Incident Response", name: "Incident response plan tested", description: "The IR plan is exercised periodically (e.g. tabletop)." },
  { id: "ir.breach_notification", category: "Incident Response", name: "Breach notification procedures", description: "Customers and regulators are notified of breaches within required timelines." },
  { id: "ir.post_mortem", category: "Incident Response", name: "Post-incident reviews conducted", description: "Incidents are reviewed to identify and address root causes." },

  // --- Business Continuity & Disaster Recovery ---
  { id: "bcdr.plan", category: "Business Continuity & Disaster Recovery", name: "Business continuity plan maintained", description: "A BCP defines how operations continue during disruption." },
  { id: "bcdr.dr_plan", category: "Business Continuity & Disaster Recovery", name: "Disaster recovery plan with RTO/RPO", description: "A DR plan defines recovery time and point objectives." },
  { id: "bcdr.dr_test", category: "Business Continuity & Disaster Recovery", name: "Disaster recovery tested periodically", description: "DR procedures are tested at least annually." },
  { id: "bcdr.redundancy", category: "Business Continuity & Disaster Recovery", name: "Redundant, highly available architecture", description: "Critical systems are deployed redundantly across availability zones." },

  // --- Backup & Resilience ---
  { id: "backup.automated", category: "Backup & Resilience", name: "Automated, regular backups", description: "Production data is backed up on a regular automated schedule." },
  { id: "backup.encrypted", category: "Backup & Resilience", name: "Backups encrypted", description: "Backups are encrypted at rest." },
  { id: "backup.restore_test", category: "Backup & Resilience", name: "Backup restoration tested", description: "Backup restores are tested periodically to confirm integrity." },

  // --- Vendor & Third-Party Risk ---
  { id: "vendor.review", category: "Vendor & Third-Party Risk", name: "Vendor security reviews before onboarding", description: "Third parties are assessed for security risk before use." },
  { id: "vendor.inventory", category: "Vendor & Third-Party Risk", name: "Inventory of subprocessors maintained", description: "A current inventory of subprocessors is maintained." },
  { id: "vendor.dpa", category: "Vendor & Third-Party Risk", name: "Data processing agreements with vendors", description: "DPAs are in place with vendors that process personal data." },
  { id: "vendor.monitoring", category: "Vendor & Third-Party Risk", name: "Ongoing vendor risk monitoring", description: "Vendor risk is reassessed on a recurring basis." },

  // --- Human Resources & Personnel Security ---
  { id: "hr.background_checks", category: "Human Resources & Personnel Security", name: "Background checks for employees", description: "Background checks are performed where legally permitted." },
  { id: "hr.nda", category: "Human Resources & Personnel Security", name: "Confidentiality agreements signed", description: "Employees and contractors sign confidentiality agreements." },
  { id: "hr.onboarding", category: "Human Resources & Personnel Security", name: "Security onboarding and offboarding", description: "Defined procedures govern joiner/mover/leaver security tasks." },

  // --- Physical & Environmental Security ---
  { id: "phys.datacenter", category: "Physical & Environmental Security", name: "Data centers with physical access controls", description: "Hosting providers enforce physical access controls (e.g. SOC 2 data centers)." },
  { id: "phys.office", category: "Physical & Environmental Security", name: "Office physical access controls", description: "Offices use badge access and visitor management." },
  { id: "phys.media_disposal", category: "Physical & Environmental Security", name: "Secure media disposal", description: "Physical media is securely wiped or destroyed before disposal." },

  // --- Privacy & Data Protection ---
  { id: "privacy.policy", category: "Privacy & Data Protection", name: "Published privacy policy", description: "A public privacy policy describes data handling practices." },
  { id: "privacy.dsr", category: "Privacy & Data Protection", name: "Data subject request process", description: "Processes support access, deletion, and correction requests." },
  { id: "privacy.minimization", category: "Privacy & Data Protection", name: "Data minimization practiced", description: "Only data necessary for the service is collected and processed." },
  { id: "privacy.dpia", category: "Privacy & Data Protection", name: "Privacy impact assessments", description: "DPIAs are conducted for high-risk processing activities." },
];

/** Case-insensitive search over name, category, and description. */
export function searchControls(query: string): LibraryControl[] {
  const q = query.trim().toLowerCase();
  if (!q) return CONTROL_LIBRARY;
  return CONTROL_LIBRARY.filter((c) =>
    `${c.name} ${c.category} ${c.description}`.toLowerCase().includes(q),
  );
}
