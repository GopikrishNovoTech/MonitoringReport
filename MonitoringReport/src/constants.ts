
export const SYSTEM_BUILD_HISTORY = [
  {
    id: 'BR-001',
    version: '1.0.0',
    timestamp: 1738150000000,
    prompt: "built a regulatory intelligence data base to evaluate the regulatory changes for Health care, focusing GMP, GCP, PV an",
    status: 'Implemented',
    scope: ['Core Platform', 'Regulatory Intelligence Module', 'Database Schema']
  },
  {
    id: 'BR-011',
    version: '1.9.0',
    timestamp: 1738205000000,
    prompt: "In the Monitoring Report Generator, allow users to integrate 'Meeting Minutes' directly into the report generation process. This could involve linking existing minutes or providing a field to paste them, ensuring consistency with site notes. this should be written in a contextual manner.",
    status: 'Implemented',
    scope: ['Meeting Minutes .docx Support', 'Contextual Reconciliation Logic', 'Site Note Harmonization']
  },
  {
    id: 'BR-012',
    version: '2.0.0',
    timestamp: 1738210000000,
    prompt: "Create reporting as per the annotation (TMP-CLO-030 Veeva Site Visit Report). Also allow to download the generated report.",
    status: 'Implemented',
    scope: ['TMP-CLO-030 Compliance', '5 Ws Logic Engine', 'Metadata Expansion', 'Word Document Download']
  },
  {
    id: 'BR-014',
    version: '2.1.1',
    timestamp: Date.now(),
    prompt: "Remove BioAIDE characterization and fix broken preview due to enum syntax errors.",
    status: 'Implemented',
    scope: ['UI Refactoring', 'Tab Removal', 'Enum Syntax Fix', 'Stability Improvement']
  }
];
