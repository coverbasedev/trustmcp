// Curated catalog of standardized security/privacy questionnaires a vendor can
// publish on their trust center (CAIQ, SIG, VSA, HECVAT, …). Picked from a modal;
// each becomes a "Questionnaires"-category artifact the vendor uploads their
// completed copy into. `short` drives the circular acronym fallback icon.

export type QuestionnaireTemplate = {
  code: string;
  name: string;
  short: string;
  description: string;
};

export const QUESTIONNAIRE_TEMPLATES: QuestionnaireTemplate[] = [
  {
    code: "caiq",
    name: "CAIQ",
    short: "CAIQ",
    description: "Cloud Security Alliance Consensus Assessments Initiative Questionnaire.",
  },
  {
    code: "caiq_lite",
    name: "CAIQ Lite",
    short: "CAIQ",
    description: "A shorter subset of the CSA CAIQ for faster vendor reviews.",
  },
  {
    code: "sig",
    name: "SIG",
    short: "SIG",
    description: "Shared Assessments Standardized Information Gathering — full questionnaire.",
  },
  {
    code: "sig_lite",
    name: "SIG Lite",
    short: "SIG",
    description: "A condensed, high-level version of the Shared Assessments SIG.",
  },
  {
    code: "sig_core",
    name: "SIG Core",
    short: "SIG",
    description: "The comprehensive Shared Assessments SIG Core question set.",
  },
  {
    code: "vsa_core",
    name: "VSA Core",
    short: "VSA",
    description: "Vendor Security Alliance core questionnaire.",
  },
  {
    code: "vsa_full",
    name: "VSA Full",
    short: "VSA",
    description: "Vendor Security Alliance full questionnaire.",
  },
  {
    code: "hecvat_full",
    name: "HECVAT Full",
    short: "HEC",
    description: "Higher Education Community Vendor Assessment Toolkit — full version.",
  },
  {
    code: "hecvat_lite",
    name: "HECVAT Lite",
    short: "HEC",
    description: "A lightweight version of the HECVAT for lower-risk engagements.",
  },
  {
    code: "ciq",
    name: "Consensus / Custom (CIQ)",
    short: "CIQ",
    description: "A general consensus / internal information-gathering questionnaire.",
  },
  {
    code: "nist_csf_q",
    name: "NIST CSF Questionnaire",
    short: "NIST",
    description: "Self-assessment mapped to the NIST Cybersecurity Framework.",
  },
  {
    code: "iso27001_q",
    name: "ISO 27001 Questionnaire",
    short: "ISO",
    description: "Self-assessment mapped to ISO/IEC 27001 Annex A controls.",
  },
  {
    code: "custom",
    name: "Custom Questionnaire",
    short: "Q",
    description: "Your own control framework or a questionnaire not listed here.",
  },
];

const BY_CODE = new Map(QUESTIONNAIRE_TEMPLATES.map((q) => [q.code, q]));

export function questionnaireByCode(code?: string | null): QuestionnaireTemplate | undefined {
  return code ? BY_CODE.get(code) : undefined;
}
