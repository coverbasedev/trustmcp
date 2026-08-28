// Catalog of standardized attestation claims a vendor can publish, spanning many
// risk domains (security, privacy, legal, financial, reputational, AI, …). Picked
// from a searchable modal instead of hand-typing keys. Most are boolean (a vendor
// asserts true/false); some are enums (pick one) or multi-selects (pick several).
//
// Values are stored on the claim as bool | string | number | string[] and verified
// by linking evidence artifacts. The shape mirrors the network's ClaimIn.

export type ClaimType = "boolean" | "enum" | "multiselect" | "number" | "text";

export type ClaimTemplate = {
  key: string;
  label: string;
  domain: string;
  type: ClaimType;
  options?: string[];
};

// Compact builders to keep this list readable.
const b = (domain: string, items: [string, string][]): ClaimTemplate[] =>
  items.map(([key, label]) => ({ key, label, domain, type: "boolean" }));
const e = (domain: string, key: string, label: string, options: string[]): ClaimTemplate =>
  ({ key, label, domain, type: "enum", options });
const m = (domain: string, key: string, label: string, options: string[]): ClaimTemplate =>
  ({ key, label, domain, type: "multiselect", options });
const n = (domain: string, key: string, label: string): ClaimTemplate =>
  ({ key, label, domain, type: "number" });

const D = {
  sec: "Security Program",
  access: "Access Control & Identity",
  data: "Data Protection",
  privacy: "Privacy",
  crypto: "Encryption",
  infra: "Infrastructure & Cloud",
  app: "Application Security",
  net: "Network Security",
  endpoint: "Endpoint & Device",
  log: "Logging & Monitoring",
  ir: "Incident Response",
  bcdr: "Business Continuity & DR",
  vendor: "Third-Party / Vendor Risk",
  compliance: "Compliance & Audit",
  legal: "Legal & Contracts",
  financial: "Financial",
  hr: "HR & Personnel",
  physical: "Physical Security",
  ai: "AI / ML Governance",
  gov: "Governance & Reputational",
};

export const CLAIM_DOMAINS = Object.values(D);

export const CLAIMS: ClaimTemplate[] = [
  // --- Security Program ---
  ...b(D.sec, [
    ["sec.program.documented", "A documented information security program exists"],
    ["sec.policy.reviewed_annually", "Security policies are reviewed at least annually"],
    ["sec.ciso.appointed", "A CISO or equivalent security leader is appointed"],
    ["sec.risk_assessment.annual", "A formal risk assessment is performed at least annually"],
    ["sec.pentest.annual", "An independent penetration test is performed annually"],
    ["sec.vuln_scan.continuous", "Continuous vulnerability scanning is in place"],
    ["sec.bug_bounty", "A bug bounty or vulnerability disclosure program exists"],
    ["sec.awareness_training.annual", "Security awareness training is required annually"],
    ["sec.phishing_sim", "Phishing simulations are run regularly"],
    ["sec.asset_inventory", "A complete asset inventory is maintained"],
    ["sec.change_management", "A formal change management process is followed"],
    ["sec.secure_sdlc", "A secure software development lifecycle is followed"],
    ["sec.threat_modeling", "Threat modeling is performed for new features"],
    ["sec.security_committee", "A security/risk steering committee meets regularly"],
    ["sec.metrics_reported", "Security metrics are reported to leadership"],
    ["sec.config_baselines", "Hardened configuration baselines are enforced"],
    ["sec.patch_sla", "Critical patches are applied within a defined SLA"],
    ["sec.red_team", "Red team exercises are conducted"],
  ]),
  e(D.sec, "sec.patch.critical_sla", "Critical patch SLA", ["24 hours", "72 hours", "7 days", "30 days"]),
  m(D.sec, "sec.frameworks.aligned", "Security frameworks aligned to", ["NIST CSF", "NIST 800-53", "ISO 27001", "CIS Controls", "SOC 2", "PCI DSS"]),

  // --- Access Control & Identity ---
  ...b(D.access, [
    ["access.mfa.enforced", "MFA is enforced for all employees"],
    ["access.mfa.privileged", "MFA is enforced for all privileged accounts"],
    ["access.mfa.customers", "MFA is available to customers"],
    ["access.sso.supported", "SSO is supported for the product"],
    ["access.scim.supported", "SCIM provisioning is supported"],
    ["access.rbac", "Role-based access control is enforced"],
    ["access.least_privilege", "Least-privilege access is enforced"],
    ["access.access_reviews.quarterly", "Access reviews are performed at least quarterly"],
    ["access.offboarding.same_day", "Access is revoked on the same day as offboarding"],
    ["access.password_policy", "A strong password policy is enforced"],
    ["access.password_manager", "A company password manager is provided"],
    ["access.privileged_jit", "Just-in-time privileged access is used"],
    ["access.session_timeout", "Idle sessions time out automatically"],
    ["access.shared_accounts_prohibited", "Shared accounts are prohibited"],
    ["access.service_accounts_managed", "Service accounts are inventoried and rotated"],
    ["access.vpn_required", "Remote access requires VPN or zero-trust gateway"],
  ]),
  m(D.access, "access.sso.protocols", "SSO protocols supported", ["SAML 2.0", "OIDC", "OAuth 2.0", "LDAP"]),
  e(D.access, "access.mfa.method", "Strongest MFA method offered", ["Hardware key (FIDO2)", "Authenticator app (TOTP)", "Push", "SMS"]),

  // --- Data Protection ---
  ...b(D.data, [
    ["data.classification", "A data classification policy is enforced"],
    ["data.dlp", "Data loss prevention controls are in place"],
    ["data.backups.automated", "Automated backups are performed"],
    ["data.backups.tested", "Backup restoration is tested regularly"],
    ["data.backups.encrypted", "Backups are encrypted"],
    ["data.retention_policy", "A data retention and deletion policy is enforced"],
    ["data.deletion_on_request", "Customer data is deleted on request"],
    ["data.deletion_on_termination", "Customer data is deleted after contract termination"],
    ["data.tenant_isolation", "Customer data is logically isolated per tenant"],
    ["data.no_prod_in_lower", "Production data is not used in non-production environments"],
    ["data.anonymization", "Data anonymization/pseudonymization is used where possible"],
    ["data.portability", "Customers can export their data"],
    ["data.ownership_customer", "Customers retain ownership of their data"],
    ["data.no_sale", "Customer data is never sold"],
    ["data.no_training_without_consent", "Customer data is not used to train models without consent"],
  ]),
  e(D.data, "data.retention.default", "Default data retention period", ["30 days", "90 days", "1 year", "Until deletion requested", "Configurable"]),
  m(D.data, "data.residency.regions", "Data residency regions offered", ["US", "EU", "UK", "Canada", "APAC", "Australia"]),

  // --- Privacy ---
  ...b(D.privacy, [
    ["privacy.policy_published", "A public privacy policy is published"],
    ["privacy.dpo_appointed", "A Data Protection Officer is appointed"],
    ["privacy.dpa_available", "A Data Processing Agreement is available"],
    ["privacy.gdpr_compliant", "Operations are GDPR compliant"],
    ["privacy.ccpa_compliant", "Operations are CCPA/CPRA compliant"],
    ["privacy.dsr_supported", "Data subject requests are supported"],
    ["privacy.consent_management", "Consent management is implemented"],
    ["privacy.cookie_compliance", "Cookie consent compliance is implemented"],
    ["privacy.privacy_by_design", "Privacy-by-design is part of development"],
    ["privacy.pia_conducted", "Privacy impact assessments are conducted"],
    ["privacy.sccs_used", "Standard Contractual Clauses are used for transfers"],
    ["privacy.breach_notification", "Customers are notified of privacy breaches"],
    ["privacy.subprocessor_list_public", "A subprocessor list is published"],
    ["privacy.subprocessor_notice", "Advance notice is given before adding subprocessors"],
  ]),
  n(D.privacy, "privacy.breach_notification_hours", "Breach notification window (hours)"),

  // --- Encryption ---
  ...b(D.crypto, [
    ["crypto.at_rest", "Data is encrypted at rest"],
    ["crypto.in_transit", "Data is encrypted in transit"],
    ["crypto.tls12_min", "TLS 1.2 or higher is enforced"],
    ["crypto.key_management", "A formal key management process exists"],
    ["crypto.kms_used", "A managed KMS/HSM is used for keys"],
    ["crypto.key_rotation", "Encryption keys are rotated regularly"],
    ["crypto.customer_managed_keys", "Customer-managed keys (BYOK) are supported"],
    ["crypto.field_level", "Field-level encryption is available for sensitive data"],
    ["crypto.fips_validated", "FIPS 140-2/3 validated cryptography is used"],
    ["crypto.perfect_forward_secrecy", "Perfect forward secrecy is enabled"],
    ["crypto.secrets_management", "A secrets management system is used"],
    ["crypto.no_hardcoded_secrets", "Secrets are never hardcoded in source"],
  ]),
  e(D.crypto, "crypto.at_rest.algorithm", "Encryption-at-rest algorithm", ["AES-256", "AES-128", "ChaCha20-Poly1305"]),

  // --- Infrastructure & Cloud ---
  ...b(D.infra, [
    ["infra.cloud_hosted", "Infrastructure is hosted on a major cloud provider"],
    ["infra.iac", "Infrastructure is managed as code"],
    ["infra.multi_az", "Workloads run across multiple availability zones"],
    ["infra.auto_scaling", "Auto-scaling is configured"],
    ["infra.immutable", "Immutable infrastructure / golden images are used"],
    ["infra.container_scanning", "Container images are scanned for vulnerabilities"],
    ["infra.cspm", "Cloud security posture management is in place"],
    ["infra.network_segmentation", "Networks are segmented"],
    ["infra.private_subnets", "Sensitive workloads run in private subnets"],
    ["infra.iam_least_privilege", "Cloud IAM follows least privilege"],
    ["infra.root_account_locked", "Cloud root accounts are locked down with MFA"],
    ["infra.logging_enabled", "Cloud audit logging is enabled"],
    ["infra.no_public_buckets", "No object storage buckets are publicly writable"],
    ["infra.ddos_protection", "DDoS protection is in place"],
    ["infra.waf", "A web application firewall protects public endpoints"],
  ]),
  m(D.infra, "infra.providers", "Cloud / hosting providers used", ["AWS", "Google Cloud", "Microsoft Azure", "Cloudflare", "On-premises"]),

  // --- Application Security ---
  ...b(D.app, [
    ["app.sast", "Static application security testing runs in CI"],
    ["app.dast", "Dynamic application security testing is performed"],
    ["app.sca", "Software composition analysis runs on dependencies"],
    ["app.dependency_updates", "Dependencies are kept up to date automatically"],
    ["app.code_review", "All code changes are peer reviewed"],
    ["app.branch_protection", "Branch protection is enforced on main branches"],
    ["app.secrets_scanning", "Secrets scanning runs on commits"],
    ["app.owasp_top10", "OWASP Top 10 risks are tested for"],
    ["app.csp_headers", "Security headers (CSP, HSTS) are set"],
    ["app.input_validation", "Server-side input validation is enforced"],
    ["app.rate_limiting", "API rate limiting is enforced"],
    ["app.sbom_published", "A software bill of materials is produced"],
    ["app.signed_artifacts", "Build artifacts are signed"],
    ["app.no_critical_vulns", "No known critical vulnerabilities are unaddressed"],
  ]),

  // --- Network Security ---
  ...b(D.net, [
    ["net.firewall", "Firewalls restrict inbound and outbound traffic"],
    ["net.ids_ips", "Intrusion detection/prevention is deployed"],
    ["net.zero_trust", "A zero-trust network model is adopted"],
    ["net.no_public_db", "Databases are not exposed to the public internet"],
    ["net.bastion", "Administrative access goes through a bastion/jump host"],
    ["net.egress_filtering", "Egress filtering is enforced"],
    ["net.dns_security", "DNS security (DNSSEC/filtering) is enabled"],
    ["net.tls_everywhere", "Internal service traffic is encrypted (mTLS)"],
    ["net.network_monitoring", "Network traffic is monitored for anomalies"],
  ]),

  // --- Endpoint & Device ---
  ...b(D.endpoint, [
    ["endpoint.mdm", "Mobile device management is enforced on company devices"],
    ["endpoint.edr", "Endpoint detection and response is deployed"],
    ["endpoint.disk_encryption", "Full-disk encryption is enforced on endpoints"],
    ["endpoint.antivirus", "Anti-malware is deployed on endpoints"],
    ["endpoint.auto_lock", "Devices auto-lock after inactivity"],
    ["endpoint.patch_management", "Endpoint patches are centrally managed"],
    ["endpoint.no_local_admin", "Users do not have local admin by default"],
    ["endpoint.usb_controls", "Removable media is controlled"],
    ["endpoint.byod_policy", "A BYOD policy governs personal devices"],
  ]),

  // --- Logging & Monitoring ---
  ...b(D.log, [
    ["log.centralized", "Logs are centrally aggregated"],
    ["log.siem", "A SIEM correlates security events"],
    ["log.tamper_resistant", "Logs are tamper-resistant/immutable"],
    ["log.alerting", "Automated alerting is configured for security events"],
    ["log.24x7_monitoring", "Security monitoring is 24x7"],
    ["log.soc", "A security operations center (in-house or MSSP) is in place"],
    ["log.audit_trail", "An audit trail captures admin actions"],
    ["log.uptime_monitoring", "Uptime and performance are monitored"],
    ["log.anomaly_detection", "Anomaly detection is used on activity"],
  ]),
  n(D.log, "log.retention_days", "Log retention period (days)"),

  // --- Incident Response ---
  ...b(D.ir, [
    ["ir.plan_documented", "A documented incident response plan exists"],
    ["ir.plan_tested", "The incident response plan is tested regularly"],
    ["ir.oncall", "A 24x7 on-call rotation responds to incidents"],
    ["ir.runbooks", "Incident runbooks are maintained"],
    ["ir.postmortems", "Blameless postmortems follow incidents"],
    ["ir.customer_notification", "Customers are notified of incidents affecting them"],
    ["ir.forensics", "Forensic capability is available"],
    ["ir.cyber_insurance", "Cyber insurance is maintained"],
    ["ir.breach_history_disclosed", "Material breaches are disclosed"],
  ]),
  e(D.ir, "ir.notification_sla", "Customer incident notification SLA", ["24 hours", "48 hours", "72 hours", "Contractual"]),

  // --- Business Continuity & DR ---
  ...b(D.bcdr, [
    ["bcdr.bcp_documented", "A business continuity plan is documented"],
    ["bcdr.dr_documented", "A disaster recovery plan is documented"],
    ["bcdr.dr_tested", "Disaster recovery is tested at least annually"],
    ["bcdr.geo_redundancy", "Data is replicated across regions"],
    ["bcdr.failover_automated", "Failover is automated"],
    ["bcdr.status_page", "A public status page reports incidents"],
    ["bcdr.pandemic_plan", "A remote-work/pandemic continuity plan exists"],
  ]),
  e(D.bcdr, "bcdr.rto", "Recovery Time Objective (RTO)", ["< 1 hour", "< 4 hours", "< 12 hours", "< 24 hours"]),
  e(D.bcdr, "bcdr.rpo", "Recovery Point Objective (RPO)", ["< 15 min", "< 1 hour", "< 4 hours", "< 24 hours"]),
  n(D.bcdr, "bcdr.uptime_sla", "Uptime SLA (%)"),

  // --- Third-Party / Vendor Risk ---
  ...b(D.vendor, [
    ["vendor.risk_program", "A third-party risk management program exists"],
    ["vendor.security_reviews", "Vendors undergo security reviews before onboarding"],
    ["vendor.dpa_with_subs", "DPAs are in place with subprocessors"],
    ["vendor.continuous_monitoring", "Vendors are continuously monitored"],
    ["vendor.sla_requirements", "Security requirements are flowed down to vendors"],
    ["vendor.offboarding", "A vendor offboarding process exists"],
    ["vendor.fourth_party", "Fourth-party (sub-subprocessor) risk is considered"],
  ]),

  // --- Compliance & Audit ---
  ...b(D.compliance, [
    ["compliance.soc2", "A current SOC 2 report is available"],
    ["compliance.iso27001", "ISO 27001 certification is held"],
    ["compliance.independent_audit", "Independent third-party audits are conducted"],
    ["compliance.internal_audit", "An internal audit function exists"],
    ["compliance.controls_continuous", "Controls are continuously monitored"],
    ["compliance.evidence_retained", "Audit evidence is retained"],
    ["compliance.regulatory_tracking", "Regulatory obligations are tracked"],
    ["compliance.coc", "A code of conduct is enforced"],
    ["compliance.whistleblower", "A whistleblower channel is available"],
  ]),

  // --- Legal & Contracts ---
  ...b(D.legal, [
    ["legal.msa_available", "A standard MSA is available"],
    ["legal.dpa_signable", "A DPA can be signed"],
    ["legal.baa_available", "A HIPAA BAA is available"],
    ["legal.liability_defined", "Limitation of liability terms are defined"],
    ["legal.indemnification", "Indemnification terms are offered"],
    ["legal.ip_ownership", "IP ownership terms are clear"],
    ["legal.sla_credits", "SLA credits are offered for downtime"],
    ["legal.no_litigation_material", "No material adverse litigation is pending"],
    ["legal.export_compliance", "Export-control compliance is maintained"],
    ["legal.aup", "An acceptable use policy is enforced"],
    ["legal.terms_published", "Terms of service are published"],
  ]),
  e(D.legal, "legal.governing_law", "Governing law", ["Delaware (US)", "California (US)", "New York (US)", "England & Wales", "Other"]),

  // --- Financial ---
  ...b(D.financial, [
    ["financial.audited_statements", "Financial statements are independently audited"],
    ["financial.sox_compliant", "SOX controls are in place (if applicable)"],
    ["financial.positive_runway", "The company has sufficient operating runway"],
    ["financial.segregation_of_duties", "Segregation of duties is enforced in finance"],
    ["financial.fraud_controls", "Anti-fraud controls are in place"],
    ["financial.pci_compliant", "PCI DSS compliance is maintained (if handling cards)"],
    ["financial.no_material_weakness", "No material weaknesses were identified"],
    ["financial.insurance_coverage", "Adequate business insurance is maintained"],
    ["financial.escrow_available", "Source code escrow is available"],
  ]),
  e(D.financial, "financial.funding_stage", "Funding stage", ["Bootstrapped", "Seed", "Series A", "Series B+", "Public", "Private equity"]),

  // --- HR & Personnel ---
  ...b(D.hr, [
    ["hr.background_checks", "Background checks are performed on employees"],
    ["hr.nda_signed", "Employees sign confidentiality agreements"],
    ["hr.security_training_onboarding", "Security training is required at onboarding"],
    ["hr.acceptable_use_signed", "Employees acknowledge an acceptable use policy"],
    ["hr.role_based_training", "Role-specific security training is provided"],
    ["hr.termination_checklist", "A termination checklist revokes access and assets"],
    ["hr.code_of_conduct", "Employees acknowledge a code of conduct"],
    ["hr.sanctions_screening", "Personnel are screened against sanctions lists"],
  ]),

  // --- Physical Security ---
  ...b(D.physical, [
    ["physical.datacenter_certified", "Data centers hold physical security certifications"],
    ["physical.badge_access", "Facilities use badge access controls"],
    ["physical.cctv", "Facilities are monitored by CCTV"],
    ["physical.visitor_logs", "Visitor access is logged and escorted"],
    ["physical.clean_desk", "A clean-desk policy is enforced"],
    ["physical.asset_disposal", "Media is securely destroyed at end of life"],
    ["physical.environmental_controls", "Environmental controls protect facilities"],
  ]),

  // --- AI / ML Governance ---
  ...b(D.ai, [
    ["ai.governance_policy", "An AI governance policy exists"],
    ["ai.no_customer_training", "Customer data is not used to train models by default"],
    ["ai.human_oversight", "Human oversight is applied to AI decisions"],
    ["ai.model_inventory", "AI models and their uses are inventoried"],
    ["ai.bias_testing", "Models are tested for bias and fairness"],
    ["ai.explainability", "AI outputs can be explained where required"],
    ["ai.subprocessor_disclosure", "AI subprocessors (LLM providers) are disclosed"],
    ["ai.opt_out", "Customers can opt out of AI features"],
    ["ai.iso42001", "ISO 42001 (AI management) practices are followed"],
    ["ai.prompt_injection_controls", "Controls mitigate prompt injection / misuse"],
    ["ai.content_provenance", "AI-generated content is labeled where required"],
  ]),
  m(D.ai, "ai.providers", "AI / LLM providers used", ["OpenAI", "Anthropic", "Google", "AWS Bedrock", "Azure OpenAI", "Self-hosted"]),

  // --- Governance & Reputational ---
  ...b(D.gov, [
    ["gov.board_oversight", "The board provides security/risk oversight"],
    ["gov.risk_register", "An enterprise risk register is maintained"],
    ["gov.esg_program", "An ESG program is in place"],
    ["gov.ethics_policy", "A business ethics/anti-corruption policy is enforced"],
    ["gov.anti_bribery", "Anti-bribery (FCPA/UKBA) controls are in place"],
    ["gov.sanctions_compliance", "Sanctions/OFAC compliance is maintained"],
    ["gov.diversity_reporting", "Diversity and inclusion is reported on"],
    ["gov.sustainability_reporting", "Sustainability metrics are reported"],
    ["gov.responsible_disclosure", "A responsible disclosure policy is published"],
    ["gov.no_adverse_media", "No material adverse media is outstanding"],
  ]),

  // --- Additional coverage to broaden the catalog ---
  ...b(D.sec, [
    ["sec.policy.exceptions_tracked", "Security policy exceptions are tracked and approved"],
    ["sec.honeypots", "Deception/honeypot controls are deployed"],
    ["sec.tabletop_exercises", "Tabletop exercises are run regularly"],
    ["sec.kpi_dashboards", "Security KPIs are dashboarded"],
    ["sec.secure_defaults", "Products ship with secure defaults"],
    ["sec.supply_chain", "Software supply-chain security controls are in place"],
    ["sec.slsa", "Build provenance (SLSA) is attested"],
  ]),
  ...b(D.access, [
    ["access.passwordless", "Passwordless authentication is offered"],
    ["access.device_trust", "Device trust is required for access"],
    ["access.geo_restrictions", "Geographic access restrictions are available"],
    ["access.ip_allowlisting", "IP allowlisting is available to customers"],
    ["access.audit_login_events", "Login events are auditable by customers"],
    ["access.break_glass", "Break-glass procedures are documented"],
  ]),
  ...b(D.data, [
    ["data.masking", "Sensitive fields are masked in the UI"],
    ["data.immutable_backups", "Immutable/air-gapped backups protect against ransomware"],
    ["data.data_map", "A data flow map is maintained"],
    ["data.minimization", "Data minimization is practiced"],
    ["data.secure_sharing", "Secure data-sharing controls are available"],
  ]),
  ...b(D.privacy, [
    ["privacy.children_data", "No data from children is knowingly collected"],
    ["privacy.do_not_track", "Do-not-track / opt-out signals are honored"],
    ["privacy.transparency_report", "A transparency report is published"],
    ["privacy.law_enforcement_policy", "A law-enforcement request policy is published"],
    ["privacy.cross_border_documented", "Cross-border transfer mechanisms are documented"],
  ]),
  ...b(D.app, [
    ["app.api_authn", "All APIs require authentication"],
    ["app.webhooks_signed", "Outbound webhooks are signed"],
    ["app.audit_logs_exportable", "Customer-facing audit logs are exportable"],
    ["app.feature_flags", "Risky changes are gated behind feature flags"],
    ["app.canary_deploys", "Canary / staged deployments are used"],
    ["app.rollback", "Deployments can be rolled back quickly"],
  ]),
  ...b(D.infra, [
    ["infra.backup_region_separate", "Backups are stored in a separate region/account"],
    ["infra.no_long_lived_keys", "Long-lived cloud credentials are avoided"],
    ["infra.tagging", "Resources are tagged for ownership and cost"],
    ["infra.drift_detection", "Configuration drift is detected and remediated"],
  ]),
  ...b(D.ir, [
    ["ir.threat_intel", "Threat intelligence feeds inform defenses"],
    ["ir.ransomware_plan", "A ransomware-specific response plan exists"],
    ["ir.legal_engaged", "Legal/communications are integrated into IR"],
  ]),
  ...b(D.vendor, [
    ["vendor.tprm_tooling", "Dedicated TPRM tooling is used"],
    ["vendor.concentration_risk", "Vendor concentration risk is assessed"],
    ["vendor.exit_plans", "Exit/contingency plans exist for critical vendors"],
  ]),
  ...b(D.compliance, [
    ["compliance.gap_assessments", "Periodic gap assessments are performed"],
    ["compliance.policy_attestation", "Employees attest to policies annually"],
    ["compliance.continuous_evidence", "Compliance evidence is continuously collected"],
    ["compliance.audit_logs_immutable", "Compliance audit logs are immutable"],
  ]),
  ...b(D.legal, [
    ["legal.subprocessor_flowdown", "Contractual obligations flow down to subprocessors"],
    ["legal.audit_rights", "Customers have audit rights"],
    ["legal.data_breach_terms", "Contracts include data-breach notification terms"],
    ["legal.uptime_commitment", "A contractual uptime commitment is offered"],
  ]),
  ...b(D.financial, [
    ["financial.revenue_recognition", "Revenue recognition follows GAAP/IFRS"],
    ["financial.budget_for_security", "A dedicated security budget exists"],
    ["financial.dun_bradstreet", "A current business credit rating is available"],
  ]),
  ...b(D.hr, [
    ["hr.reference_checks", "Reference checks are performed for sensitive roles"],
    ["hr.separation_of_duties", "Separation of duties is enforced for critical tasks"],
    ["hr.contractor_vetting", "Contractors are vetted like employees"],
    ["hr.security_champions", "A security champions program exists"],
  ]),
  ...b(D.endpoint, [
    ["endpoint.dns_filtering", "DNS filtering protects endpoints"],
    ["endpoint.zero_touch", "Zero-touch enrollment provisions devices securely"],
  ]),
  ...b(D.net, [
    ["net.api_gateway", "Public APIs sit behind an API gateway"],
    ["net.private_connectivity", "Private connectivity (PrivateLink/peering) is offered"],
  ]),
  ...b(D.ai, [
    ["ai.data_retention_controls", "AI prompt/response retention is configurable"],
    ["ai.red_teaming", "AI systems are red-teamed for safety"],
    ["ai.eval_pipeline", "Model quality/safety evals run before release"],
  ]),
  ...b(D.gov, [
    ["gov.privacy_committee", "A privacy/governance committee meets regularly"],
    ["gov.policy_library_public", "Key trust policies are publicly available"],
    ["gov.security_contact", "A dedicated security contact is published"],
    ["gov.coordinated_disclosure_sla", "Disclosed vulnerabilities get a triage SLA"],
  ]),
];

const BY_KEY = new Map(CLAIMS.map((c) => [c.key, c]));
const BY_LABEL = new Map(CLAIMS.map((c) => [normalizeLabel(c.label), c]));

export function claimByKey(key?: string | null): ClaimTemplate | undefined {
  return key ? BY_KEY.get(key) : undefined;
}

export function normalizeLabel(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Resolve a claim template by exact key or by a normalized label match. */
export function resolveClaim(keyOrLabel: string): ClaimTemplate | undefined {
  return BY_KEY.get(keyOrLabel.trim()) ?? BY_LABEL.get(normalizeLabel(keyOrLabel));
}

export function defaultValueFor(t: ClaimTemplate): boolean | string | string[] {
  if (t.type === "boolean") return true;
  if (t.type === "multiselect") return [];
  if (t.type === "enum") return t.options?.[0] ?? "";
  return "";
}
