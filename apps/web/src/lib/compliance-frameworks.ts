// Curated catalog of compliance frameworks / certifications a vendor can publish
// on their trust center. Used by the Compliance builder (pick from a list instead
// of hand-typing) and to render a consistent acronym fallback when no logo is set.
//
// `code` is the stable machine value stored on the badge's `standard`. `name` is
// the default display label. `short` is the 2-4 char acronym shown in the circular
// fallback icon. `logo` is an optional logo URL; when absent the acronym circle is
// used. Users can always override the name/logo per selection (custom standards).

export type Framework = {
  code: string;
  name: string;
  short: string;
  category: string;
  logo?: string;
};

export const FRAMEWORK_CATEGORIES = [
  "Security & Privacy Audits",
  "ISO Standards",
  "Government & Public Sector",
  "Privacy & Data Protection",
  "Healthcare",
  "Payments & Finance",
  "Cloud & Industry",
] as const;

export const FRAMEWORKS: Framework[] = [
  // --- Security & Privacy Audits ---
  { code: "soc2_type2", name: "SOC 2 Type II", short: "S2", category: "Security & Privacy Audits" },
  { code: "soc2_type1", name: "SOC 2 Type I", short: "S2", category: "Security & Privacy Audits" },
  { code: "soc1", name: "SOC 1", short: "S1", category: "Security & Privacy Audits" },
  { code: "soc3", name: "SOC 3", short: "S3", category: "Security & Privacy Audits" },

  // --- ISO Standards ---
  { code: "iso27001", name: "ISO/IEC 27001", short: "ISO", category: "ISO Standards" },
  { code: "iso27017", name: "ISO/IEC 27017", short: "ISO", category: "ISO Standards" },
  { code: "iso27018", name: "ISO/IEC 27018", short: "ISO", category: "ISO Standards" },
  { code: "iso27701", name: "ISO/IEC 27701", short: "ISO", category: "ISO Standards" },
  { code: "iso9001", name: "ISO 9001", short: "ISO", category: "ISO Standards" },
  { code: "iso22301", name: "ISO 22301", short: "ISO", category: "ISO Standards" },
  { code: "iso42001", name: "ISO/IEC 42001 (AI)", short: "AI", category: "ISO Standards" },

  // --- Government & Public Sector ---
  { code: "fedramp", name: "FedRAMP", short: "FR", category: "Government & Public Sector" },
  { code: "fisma", name: "FISMA", short: "FI", category: "Government & Public Sector" },
  { code: "cmmc", name: "CMMC", short: "CM", category: "Government & Public Sector" },
  { code: "nist_csf", name: "NIST CSF", short: "NI", category: "Government & Public Sector" },
  { code: "nist_800_53", name: "NIST 800-53", short: "NI", category: "Government & Public Sector" },
  { code: "nist_800_171", name: "NIST 800-171", short: "NI", category: "Government & Public Sector" },
  { code: "stateramp", name: "StateRAMP", short: "SR", category: "Government & Public Sector" },
  { code: "txramp", name: "TX-RAMP", short: "TX", category: "Government & Public Sector" },
  { code: "irap", name: "IRAP (Australia)", short: "IR", category: "Government & Public Sector" },

  // --- Privacy & Data Protection ---
  { code: "gdpr", name: "GDPR", short: "GD", category: "Privacy & Data Protection" },
  { code: "ccpa", name: "CCPA / CPRA", short: "CC", category: "Privacy & Data Protection" },
  { code: "lgpd", name: "LGPD (Brazil)", short: "LG", category: "Privacy & Data Protection" },
  { code: "pipeda", name: "PIPEDA (Canada)", short: "PI", category: "Privacy & Data Protection" },
  { code: "privacy_shield", name: "Data Privacy Framework", short: "DP", category: "Privacy & Data Protection" },

  // --- Healthcare ---
  { code: "hipaa", name: "HIPAA", short: "HI", category: "Healthcare" },
  { code: "hitrust", name: "HITRUST CSF", short: "HT", category: "Healthcare" },
  { code: "hitech", name: "HITECH", short: "HT", category: "Healthcare" },

  // --- Payments & Finance ---
  { code: "pci_dss", name: "PCI DSS", short: "PCI", category: "Payments & Finance" },
  { code: "sox", name: "SOX", short: "SOX", category: "Payments & Finance" },
  { code: "glba", name: "GLBA", short: "GL", category: "Payments & Finance" },
  { code: "psd2", name: "PSD2", short: "PS", category: "Payments & Finance" },

  // --- Cloud & Industry ---
  { code: "csa_star", name: "CSA STAR", short: "CSA", category: "Cloud & Industry" },
  { code: "cis", name: "CIS Controls", short: "CIS", category: "Cloud & Industry" },
  { code: "tisax", name: "TISAX (Automotive)", short: "TX", category: "Cloud & Industry" },
  { code: "cyber_essentials", name: "Cyber Essentials", short: "CE", category: "Cloud & Industry" },
];

const BY_CODE = new Map(FRAMEWORKS.map((f) => [f.code, f]));

// Bundled logos for the out-of-the-box standards live in /public/compliance. Two
// (HIPAA/HITECH) are .ico; everything else is .png.
const ICO_CODES = new Set(["hipaa", "hitech"]);

export function frameworkByCode(code?: string | null): Framework | undefined {
  return code ? BY_CODE.get(code) : undefined;
}

/** Bundled logo path for a catalog standard, or undefined for custom ones. */
export function frameworkLogo(code?: string | null): string | undefined {
  if (!code || !BY_CODE.has(code)) return undefined;
  return `/compliance/${code}.${ICO_CODES.has(code) ? "ico" : "png"}`;
}

/** Acronym shown in the circular fallback icon when a standard has no logo. */
export function acronymFor(name: string, code?: string | null): string {
  const fw = frameworkByCode(code);
  if (fw) return fw.short;
  // Derive from the display name: initials of the first words, else first 2 chars.
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}
