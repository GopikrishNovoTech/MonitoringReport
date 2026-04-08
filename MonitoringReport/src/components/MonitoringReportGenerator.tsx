
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { generateGxPSentence, mapNotesToChecklist, performOCR, performAIPeerReview, refineGxPWithClarification } from '../services/aiService';
import { saveIMVReport, getAllIMVReports } from '../services/dbService';
import { IMVReport, IMVReportAudit, AIPeerReviewResult } from '../types';
import { extractRawText } from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist';

// Initialize PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.worker.min.mjs`;

interface ChecklistItem {
  id: string;
  type: string;
  seq: number;
  description: string;
  annotation: string;
}

interface PeerReviewState {
    keywords: string;
    questions: string[];
    authorClarification: string;
    stage: 'idle' | 'reviewed' | 'refining' | 'finalized';
    resolution?: 'Incorporate' | 'Ignore';
    aiPeerReview?: AIPeerReviewResult;
}

interface ActionFinding {
    id: string;
    pdWording: string;
    fuiWording: string;
    pdLogged: boolean;
    fuiLogged: boolean;
}

const LANGUAGES = [
    { label: 'English', value: 'English' },
    { label: 'Traditional Chinese (繁體中文)', value: 'Traditional Chinese' },
    { label: 'Simplified Chinese (简体中文)', value: 'Simplified Chinese' },
    { label: 'Korean (한국어)', value: 'Korean' },
    { label: 'Japanese (日本語)', value: 'Japanese' },
    { label: 'Spanish (Español)', value: 'Spanish' },
    { label: 'German (Deutsch)', value: 'German' }
];

const CHECKLIST_DATA: ChecklistItem[] = [
  { type: 'Protocol and Study Plan', id: 'psp_1', seq: 1, description: 'Have all enrolled participants met the inclusion/exclusion criteria? If Yes, refer to the participant Visits Monitored table at the end of the report.', annotation: 'Yes: This confirms participant’s eligibility was reviewed/confirmed. Or add comment that no new participants enrolled. No: Comment on participants not eligible, reason, PI/PM/CL discussion. Verify escalation within 24h. List CAPA and FUI.' },
  { type: 'Protocol and Study Plan', id: 'psp_2', seq: 2, description: 'Has the protocol, ICH GCP, and applicable regulations been adhered to since last visit? If No, refer to Issues table at the end of the report.', annotation: 'Yes: No further comment required. No: Issues in table. Comment if Protocol Deviations need reporting to IRB/IEC. Create FUI. Refer to PDMP/PD Specifications log for severity.' },
  { type: 'Recruitment and Informed Consent', id: 'ric_1', seq: 1, description: 'Is the site meeting the expected recruitment/enrolment target? Refer to the Monitored Metrics table.', annotation: 'Yes: Confirm recruitment target met. No: Confirm not met. Comment on barriers, reasons for failures, identified trends. Create FUI.' },
  { type: 'Recruitment and Informed Consent', id: 'ric_2', seq: 2, description: 'Were recruitment strategies and contingency planning discussed/reviewed?', annotation: 'Yes: Comment on SSRP TMP-CLO-059 review. No: Clarify why not discussed. Create FUI.' },
  { type: 'Recruitment and Informed Consent', id: 'ric_3', seq: 3, description: 'Has informed consent form (ICF) review been conducted at this visit, including any re-consents? If Yes, refer to ICF Log table.', annotation: 'Yes: Confirms versioning, process (method, who, when), identity verification, format (e/paper), assent, primary physician info. No: Clarify why not performed. Create FUI.' },
  { type: 'Recruitment and Informed Consent', id: 'ric_4', seq: 4, description: 'Have all subjects (participant) signed/dated the correct IEC/IRB approved Consent Form, and is the informed consent process adequately documented?', annotation: 'Yes: Confirms ICH-GCP compliance, copy provided, documented in source. No: Comment on deficiencies, re-training. Create FUI.' },
  { type: 'Safety and Reporting', id: 'sr_1', seq: 1, description: 'Have any adverse events of special interests (AESIs)/serious adverse events (SAEs), or follow up to AESIs/SAEs, occurred since the last visit? If Yes, refer to Monitored SAE table.', annotation: 'Yes: Ensure all listed in table. No: No further comment.' },
  { type: 'Safety and Reporting', id: 'sr_2', seq: 2, description: 'Have all AESIs/SAEs been appropriately reported to sponsor, recorded and source data verified (SDV’d), including applicable follow up information?', annotation: 'Yes: Confirms reporting within 24h, CRF up to date, SDV, IRB submission. No: Document ID, term, follow-up pending. Create FUI.' },
  { type: 'Safety and Reporting', id: 'sr_3', seq: 3, description: 'Have all AEs been appropriately reported, recorded and SDV’d (including any clinically significant laboratory values)? Are AE data consistent with other study data?', annotation: 'Yes: Detail updates based on Medical Monitor requests. No: Comment on identified issues. Create FUI.' },
  { type: 'Safety and Reporting', id: 'sr_4', seq: 4, description: 'Have any new subjects (participant) withdrawn from the study?', annotation: 'Yes: Document participants and reason (e.g. AE). No: No further comment.' },
  { type: 'Safety and Reporting', id: 'sr_5', seq: 5, description: 'Is the site compliant with SAE and Safety Report review and reporting to IRB/IEC and regulatory, as per local requirements?', annotation: 'Yes: Comment on last SAE/Safety Report (SUSAR, DSUR) reviewed. No: Create FUI.' },
  { type: 'CRF Review and SDV', id: 'crf_1', seq: 1, description: 'Has there been any changes to source documentation (source record) since the last visit, including appropriate access?', annotation: 'Yes: Comment on changes, EMR access, Source Data Location form updates. No: No further comment.' },
  { type: 'CRF Review and SDV', id: 'crf_2', seq: 2, description: 'Has case report form (CRF) review and/or source document (source record) review been conducted? If Yes, refer to Subject Visits Monitored table.', annotation: 'Yes: Confirms monitoring performed. No: Create FUI.' },
  { type: 'CRF Review and SDV', id: 'crf_3', seq: 3, description: 'Are CRFs up to date and of acceptable quality?', annotation: 'Yes: Confirmed per DM report. No: Create FUI.' },
  { type: 'CRF Review and SDV', id: 'crf_4', seq: 4, description: 'Are source documents (source records) adequate to support the CRF?', annotation: 'Yes: Confirm ALCOA+ principles, intra/inter-subject trends. No: Create FUI.' },
  { type: 'CRF Review and SDV', id: 'crf_5', seq: 5, description: 'Are all data queries and discrepancies resolved and SDV’d?', annotation: 'Yes: No further comment. No: Create FUI if open >30 days.' },
  { type: 'IP and Study Supplies', id: 'ip_1', seq: 1, description: 'Are storage requirements for investigational product (IP) adequate?', annotation: 'Yes: Locked access, valid calibrations, no excursions. No: Detail excursions, quarantine, sponsor approval. Create FUI.' },
  { type: 'IP and Study Supplies', id: 'ip_2', seq: 2, description: 'Has IP accountability been completed?', annotation: 'Yes: Review receipts, shipping docs, drug logs. No: Create FUI.' },
  { type: 'IP and Study Supplies', id: 'ip_3', seq: 3, description: 'Has subject\'s (participant\'s) physical IP compliance check been completed?', annotation: 'Yes: Confirm protocol/pharmacy manual compliance. No: Create FUI.' },
  { type: 'IP and Study Supplies', id: 'ip_4', seq: 4, description: 'Is there sufficient supply of IP within current expiration date?', annotation: 'Yes: Adequacy for upcoming visits (>3mo expiry). No: Create FUI.' },
  { type: 'IP and Study Supplies', id: 'ip_5', seq: 5, description: 'Has any IP been returned to sponsor/depot or destroyed on site since the last visit?', annotation: 'Yes: Destruction approval, TMF filing. No: No further comment.' },
  { type: 'IP and Study Supplies', id: 'ip_6', seq: 6, description: 'Was each subject (participant) randomized according to the study’s randomisation procedure and in the correct sequence?', annotation: 'Yes: No further comment. No: Create FUI.' },
  { type: 'IP and Study Supplies', id: 'ip_7', seq: 7, description: 'Has the blinding been maintained properly?', annotation: 'Yes: No further comment. No: Document unblinding reasons. Create FUI.' },
  { type: 'IP and Study Supplies', id: 'ip_8', seq: 8, description: 'Are all supplies of non–IP study related materials adequate and being maintained as required?', annotation: 'Yes: List lab kits, check expiry. No: Create FUI.' },
  { type: 'Site Personnel', id: 'sp_1', seq: 1, description: 'Have any change to site personnel been assigned to the study, or have discontinued, since the last visit?', annotation: 'Yes: List new/discontinued staff. No: No further comment.' },
  { type: 'Site Personnel', id: 'sp_2', seq: 2, description: 'For new site personnel, has an updated FDA 1572, CV, training log, GCP, ML and FDF been collected as appropriate? Was investigator credential review completed?', annotation: 'Yes: Essential docs filed, debarment check. No: Create FUI.' },
  { type: 'Site Personnel', id: 'sp_3', seq: 3, description: 'Has documentation of study-related delegation and training been completed for all site personnel?', annotation: 'Yes: Delegation log and training up to date. No: Create FUI.' },
  { type: 'Facilities and Equipment', id: 'fe_1', seq: 1, description: 'Since the last visit have there been any changes to facilities at this site (as applicable: Laboratory, Radiology, etc.)?', annotation: 'Yes: Comment on changes, FDA 1572 updates. No: No further comment.' },
  { type: 'Facilities and Equipment', id: 'fe_2', seq: 2, description: 'Has study equipment been appropriately maintained and records available?', annotation: 'Yes: List equipment and calibration dates. No: Create FUI.' },
  { type: 'Facilities and Equipment', id: 'fe_3', seq: 3, description: 'Is the laboratory sample collection, processing, storage and shipment process compliant with study requirements?', annotation: 'Yes: Protocol/Lab manual compliance. No: Create FUI.' },
  { type: 'Facilities and Equipment', id: 'fe_4', seq: 4, description: 'Were all laboratory reports received, reviewed, and evaluated appropriately and in a timely manner?', annotation: 'Yes: Confirm local lab reference range check. No: Create FUI.' },
  { type: 'Facilities and Equipment', id: 'fe_5', seq: 5, description: 'Have all imaging scans been obtained as per protocol with appropriate completion of source documentation?', annotation: 'Yes: Confirm review/sign-off. No: Create FUI.' },
  { type: 'Facilities and Equipment', id: 'fe_6', seq: 6, description: 'Have all central imaging scans been processed, reconciled, and queries resolved according to study requirements?', annotation: 'Yes: No further comment. No: Create FUI.' },
  { type: 'IRB/IEC Requirements', id: 'irb_1', seq: 1, description: 'Are all required IRB/IEC, local regulatory approvals obtained and filed?', annotation: 'Yes: Confirm approvals filed, reporting requirements checked. No: Create FUI.' },
  { type: 'IRB/IEC Requirements', id: 'irb_2', seq: 2, description: 'Is there new information requiring submission or notification to the IRB/IEC or local regulatory agency?', annotation: 'Yes: Describe plans. No: No further comment.' },
  { type: 'ISF and Essential Documents', id: 'isf_1', seq: 1, description: 'Is the Investigator Site File (ISF)/Pharmacy File (PF) being adequately maintained?', annotation: 'Yes: Full/Partial review level, tracker status. No: Create FUI.' },
  { type: 'ISF and Essential Documents', id: 'isf_2', seq: 2, description: 'Were any essential documents collected during the visit?', annotation: 'Yes: List docs, confirm TMF filing. No: No further comment.' },
  { type: 'ISF and Essential Documents', id: 'isf_3', seq: 3, description: 'Was the Site Visit Log signed and filed in ISF/PF?', annotation: 'Yes: Confirmed. No: Create FUI.' },
  { type: 'Conclusion', id: 'conc_1', seq: 1, description: 'Was the status of the study, site issues, deviations, and follow up items discussed with the PI & site staff?', annotation: 'Yes: Summarize discussion. No: Clarify deviation from CMP. Create FUI.' },
  { type: 'Conclusion', id: 'conc_2', seq: 2, description: 'Are site staff, facilities, and PI oversight acceptable for continuation of the study?', annotation: 'Yes: Confirm oversight/safety/data quality. No: Detail discussion/solutions. Create FUI.' },
  { type: 'Conclusion', id: 'conc_3', seq: 3, description: 'Has the next IMV date been confirmed?', annotation: 'Yes: Provide date. No: Note due date per study plan. Create FUI.' },
  { type: 'GMO: General', id: 'gmo_g1', seq: 1, description: 'Since the last visit have there been any changes to facilities at this site (as applicable: laboratory, radiology, etc.).', annotation: 'Yes: Verify IP administration room. No: No further comment.' },
  { type: 'GMO: General', id: 'gmo_g2', seq: 2, description: 'Have any of the procedures documented at initiation changed?', annotation: 'Yes: Document changes, update CMP. No: No further comment.' },
  { type: 'GMO: General', id: 'gmo_g3', seq: 3, description: 'Are the relevant GMO site training records up to date?', annotation: 'Yes: Signed licenses/training logs in ISF/TMF. No: Create FUI.' },
  { type: 'GMO: General', id: 'gmo_g4', seq: 4, description: 'Are there any changes at site that could influence licence compliance?', annotation: 'Yes: Document how managed. Report breaches immediately. No: No further comment.' },
  { type: 'GMO: IP and Study Supplies', id: 'gmo_ip1', seq: 1, description: 'Is the GMO IP stored correctly?', annotation: 'Yes: Double containment, spill kits, accountability. No: Create FUI.' },
  { type: 'GMO: IP and Study Supplies', id: 'gmo_ip2', seq: 2, description: 'Is the GMO IP transported within a leak-proof container labelled correctly?', annotation: 'Yes: Double containment, spill kit, GMO labels. No: Create FUI.' },
  { type: 'GMO: IP and Study Supplies', id: 'gmo_ip3', seq: 3, description: 'Have participants signed the agreement to Licence Conditions sheet provided at the time of Informed Consent?', annotation: 'Yes: No further comment. No: Create FUI.' },
  { type: 'GMO: IP and Study Supplies', id: 'gmo_ip4', seq: 4, description: 'Have participants been provided with biohazard containers with instructions for use and are the returned containers documented?', annotation: 'Yes: Return/Destruction documented. No: Create FUI.' },
  { type: 'GMO: IP and Study Supplies', id: 'gmo_ip5', seq: 5, description: 'Does the site have a supply of participant supplies per licence conditions?', annotation: 'Yes: Sufficient spill kits/biohazard bins. No: Create FUI.' },
  { type: 'GMO: IP and Study Supplies', id: 'gmo_ip6', seq: 6, description: 'Does the site have adequate personal protective equipment (PPE) supplies?', annotation: 'Yes: Confirm staff access to gowns, gloves, etc. No: Create FUI.' }
];

const MonitoringReportGenerator: React.FC = () => {
  const [view, setView] = useState<'dashboard' | 'editor'>('dashboard');
  const [allReports, setAllReports] = useState<IMVReport[]>([]);
  const [currentReportId, setCurrentReportId] = useState<string | null>(null);

  const [projectNumber, setProjectNumber] = useState('NVT-PH2-101');
  const [protocolNumber, setProtocolNumber] = useState('');
  const [sponsorName, setSponsorName] = useState('');
  const [craName, setCraName] = useState('');
  const [reviewerName, setReviewerName] = useState('');
  const [protocolVersion, setProtocolVersion] = useState('v1.0');
  const [selectedLanguage, setSelectedLanguage] = useState('English');
  const [openedAt, setOpenedAt] = useState<number>(0);
  const [completedAt, setCompletedAt] = useState<number | undefined>(undefined);
  const [peerReviewTotalSeconds, setPeerReviewTotalSeconds] = useState(0);
  const [auditTrail, setAuditTrail] = useState<IMVReportAudit[]>([]);

  const [fullProtocolText, setFullProtocolText] = useState('');
  const [cmpText, setCmpText] = useState('');
  const [annotatedReportText, setAnnotatedReportText] = useState('');

  const [ingestedArtifacts, setIngestedArtifacts] = useState<Array<{ name: string; type: string; content: string }>>([]);

  const [fieldKeywords, setFieldKeywords] = useState<Record<string, string>>({});
  const [generatedResponses, setGeneratedResponses] = useState<Record<string, { text: string, status: 'Pass' | 'Fail', findings?: ActionFinding[] }>>({});
  const [peerReviews, setPeerReviews] = useState<Record<string, PeerReviewState>>({});
  
  const [isProcessingField, setIsProcessingField] = useState<string | null>(null);
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);

  const fileInputRefs = {
    protocol: useRef<HTMLInputElement>(null),
    cmp: useRef<HTMLInputElement>(null),
    annotated: useRef<HTMLInputElement>(null),
    multi: useRef<HTMLInputElement>(null)
  };

  useEffect(() => {
    const load = async () => {
      const reports = await getAllIMVReports();
      setAllReports(reports.sort((a, b) => b.openedAt - a.openedAt));
    };
    if (view === 'dashboard') load();
  }, [view]);

  const addAuditEntry = (action: string) => {
    const entry: IMVReportAudit = { action, timestamp: Date.now(), user: craName || 'Operator' };
    setAuditTrail(prev => [...prev, entry]);
  };

  const handleCreateNew = () => {
    const id = `IMV-${Date.now()}`;
    setCurrentReportId(id);
    setOpenedAt(Date.now());
    setCompletedAt(undefined);
    setAuditTrail([{ action: 'Record Initialized', timestamp: Date.now(), user: 'System' }]);
    
    setProjectNumber('NVT-PH2-101'); setProtocolNumber(''); setSponsorName(''); setCraName(''); setReviewerName('');
    setFieldKeywords({}); setGeneratedResponses({}); setPeerReviews({}); 
    setFullProtocolText(''); setCmpText(''); setAnnotatedReportText('');
    setIngestedArtifacts([]);
    setView('editor');
  };

  const handleLoadReport = (report: IMVReport) => {
    setCurrentReportId(report.id);
    setProjectNumber(report.projectNumber);
    setProtocolNumber(report.protocolNumber);
    setSponsorName(report.sponsorName);
    setCraName(report.craName);
    setReviewerName(report.reviewerName);
    setProtocolVersion(report.protocolVersion);
    setOpenedAt(report.openedAt);
    setCompletedAt(report.completedAt);
    setPeerReviewTotalSeconds(report.peerReviewTotalSeconds);
    setAuditTrail(report.auditTrail);
    setFieldKeywords(report.data.fieldKeywords || {});
    setGeneratedResponses(report.data.generatedResponses || {});
    setPeerReviews(report.data.peerReviews || {});
    setFullProtocolText(report.data.fullProtocolText || '');
    setCmpText(report.data.cmpText || '');
    setAnnotatedReportText(report.data.annotatedReportText || '');
    setIngestedArtifacts(report.data.ingestedArtifacts || []);
    setView('editor');
  };

  const handleSave = async () => {
    if (!currentReportId) return;
    const report: IMVReport = {
      id: currentReportId,
      projectNumber,
      protocolNumber,
      sponsorName,
      craName,
      reviewerName,
      protocolUrl: '',
      protocolVersion,
      openedAt,
      completedAt,
      peerReviewTotalSeconds,
      status: completedAt ? 'Finalized' : 'Draft',
      isReviewerNotified: false,
      auditTrail,
      data: { fieldKeywords, generatedResponses, peerReviews, fullProtocolText, cmpText, annotatedReportText, ingestedArtifacts }
    };
    await saveIMVReport(report);
    addAuditEntry('Manual Save Performed');
    alert("Record committed to database.");
  };

  const processFileInbound = async (file: File): Promise<string> => {
    if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        return new Promise((resolve) => {
            reader.onload = async (e) => {
                const base64 = (e.target?.result as string).split(',')[1];
                const ocrText = await performOCR(base64, file.type);
                resolve(ocrText);
            };
            reader.readAsDataURL(file);
        });
    }

    if (file.type === 'application/pdf') {
      const buffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
      let text = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map((item: any) => item.str).join(' ') + '\n';
      }
      return text;
    } else if (file.name.endsWith('.docx')) {
      const buffer = await file.arrayBuffer();
      const result = await extractRawText({ arrayBuffer: buffer });
      return result.value;
    } else {
      return await file.text();
    }
  };

  const handleArtifactUpload = async (e: React.ChangeEvent<HTMLInputElement>, target: 'protocol' | 'cmp' | 'annotated' | 'multi') => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setIsProcessingField('document_ingestion');

    try {
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const text = await processFileInbound(file);
            
            if (target === 'protocol') setFullProtocolText(prev => prev ? `${prev}\n\n${text}` : text);
            else if (target === 'cmp') setCmpText(prev => prev ? `${prev}\n\n${text}` : text);
            else if (target === 'annotated') setAnnotatedReportText(prev => prev ? `${prev}\n\n${text}` : text);
            
            setIngestedArtifacts(prev => [...prev, { name: file.name, type: target, content: text }]);
            addAuditEntry(`Ingested Artifact: ${file.name} (${target})`);
        }
    } catch (err) {
        alert("Artifact processing cycle failed.");
    } finally {
        setIsProcessingField(null);
        if (e.target) e.target.value = '';
    }
  };

  const removeArtifact = (index: number) => {
    const artifactToRemove = ingestedArtifacts[index];
    const newArtifacts = ingestedArtifacts.filter((_, i) => i !== index);
    setIngestedArtifacts(newArtifacts);
    
    // Re-evaluate main text states based on remaining artifacts
    if (artifactToRemove.type === 'protocol') {
        const remaining = newArtifacts.filter(a => a.type === 'protocol');
        setFullProtocolText(remaining.map(a => a.content).join('\n\n'));
    }
    if (artifactToRemove.type === 'cmp') {
        const remaining = newArtifacts.filter(a => a.type === 'cmp');
        setCmpText(remaining.map(a => a.content).join('\n\n'));
    }
    if (artifactToRemove.type === 'annotated') {
        const remaining = newArtifacts.filter(a => a.type === 'annotated');
        setAnnotatedReportText(remaining.map(a => a.content).join('\n\n'));
    }
    
    addAuditEntry(`Removed Artifact: ${artifactToRemove.name}`);
  };

  const processNotesSegregation = async () => {
    const fieldNotes = ingestedArtifacts.filter(a => a.type === 'annotated' || a.type === 'multi');
    const combinedNotes = fieldNotes.map(a => `Source [${a.name}]: ${a.content}`).join('\n\n');
    
    if (!combinedNotes) return alert("No field notes or annotated artifacts found to segregate. Please upload 'Annotated' or 'Multi' sources.");
    
    setIsProcessingField('neural_note_processing');
    try {
        const checklistItems = CHECKLIST_DATA.map(i => ({ id: i.id, description: i.description }));
        const resultMapping = await mapNotesToChecklist(combinedNotes, checklistItems, selectedLanguage);
        setFieldKeywords(prev => ({ ...prev, ...resultMapping }));
        addAuditEntry("Neural Segregation Sequence Completed");
    } catch (e: any) {
        console.error("Segregation error:", e);
        if (e.message?.includes('429') || e.message?.includes('quota')) {
            alert("API Quota Reached. The system is attempting to recover, but you may need to wait 60 seconds before trying again.");
        } else {
            alert("Neural segregation cycle interrupted. Please ensure artifacts contain relevant monitoring data.");
        }
    } finally {
        setIsProcessingField(null);
    }
  };

  const handleSynthesizeAndReview = async (item: ChecklistItem) => {
    const keywords = fieldKeywords[item.id];
    if (!keywords || keywords === "Matching information not found") return;
    
    setIsProcessingField(item.id);
    try {
      const result = await generateGxPSentence(item.description, item.annotation, keywords, fullProtocolText, cmpText, protocolNumber, selectedLanguage);
      
      if (!result) throw new Error("Synthesis service returned no result");

      const processedFindings: ActionFinding[] | undefined = result.findings?.map((f: any, idx: number) => ({
          ...f, 
          id: `${item.id}_F${idx + 1}`, 
          pdWording: f.pdWording ?? "Unknown PD",
          fuiWording: f.fuiWording ?? "Check visit notes",
          pdLogged: false, 
          fuiLogged: false
      }));
      
      setGeneratedResponses(prev => ({ ...prev, [item.id]: { ...result, findings: processedFindings } }));

      const reviewResult = await performAIPeerReview(result.text, item.description, fullProtocolText, cmpText, annotatedReportText, selectedLanguage);
      setPeerReviews(prev => ({ ...prev, [item.id]: { 
          keywords: '', questions: [], authorClarification: '', stage: 'reviewed', aiPeerReview: reviewResult 
      }}));

      addAuditEntry(`Synthesized & AI Peer Reviewed Item ${item.seq}`);
    } catch (e: any) {
      console.error("Synthesis failed for item:", item.id, e);
      if (e.message?.includes('429') || e.message?.includes('quota')) {
          alert("API Quota Limit encountered. Processing for this item was paused. Please wait a moment and click Initialize Synthesis again.");
      } else {
          alert("Neural synthesis interrupted. Check system logs for detail.");
      }
    } finally {
      setIsProcessingField(null);
    }
  };

  const handleBulkSynthesize = async () => {
    const itemsToProcess = CHECKLIST_DATA.filter(item => fieldKeywords[item.id] && fieldKeywords[item.id] !== "Matching information not found" && !generatedResponses[item.id]);
    if (itemsToProcess.length === 0) return alert("No valid or new segregated data found.");
    setIsBulkProcessing(true);
    try {
        for (const item of itemsToProcess) {
            await handleSynthesizeAndReview(item);
            // Small artificial delay between bulk items to respect rate limits if possible
            await new Promise(r => setTimeout(r, 200));
        }
        addAuditEntry("Bulk Synthesis & Review Cycle Complete");
    } catch (e) {
        console.error("Bulk synthesis error:", e);
    } finally {
        setIsBulkProcessing(false);
    }
  };

  const handleIncorporateSuggestion = async (item: ChecklistItem) => {
      const review = peerReviews[item.id];
      const response = generatedResponses[item.id];
      if (!review || !response) return;

      setIsProcessingField(`incorporate_${item.id}`);
      try {
          const refinedResult = await refineGxPWithClarification(
              response.text, 
              review.authorClarification, 
              review.aiPeerReview?.suggestedComments?.join(', ') || '', 
              selectedLanguage
          );
          setGeneratedResponses(prev => ({ ...prev, [item.id]: { ...response, text: refinedResult.text } }));
          setPeerReviews(prev => ({ ...prev, [item.id]: { ...review, stage: 'finalized', resolution: 'Incorporate' } }));
          addAuditEntry(`Incorporate Suggestion for Item ${item.seq}`);
      } catch (e) {
          console.error("Neural refinement cycle failed:", e);
      } finally {
          setIsProcessingField(null);
      }
  };

  const handleIgnoreSuggestion = (item: ChecklistItem) => {
      const review = peerReviews[item.id];
      if (!review) return;
      setPeerReviews(prev => ({ ...prev, [item.id]: { ...review, stage: 'finalized', resolution: 'Ignore' } }));
      addAuditEntry(`Ignored Suggestion for Item ${item.seq}`);
  };

  const handleExportCSV = () => {
    if (Object.keys(generatedResponses).length === 0) {
        return alert("No synthesized data available to export.");
    }

    const headers = ["ID", "Requirement", "Author Synthesis", "Protocol Deviations", "Follow-Up Items"];
    const rows = CHECKLIST_DATA.map(item => {
        const response = generatedResponses[item.id];
        if (!response) return null;

        const pdWording = response.findings?.filter(f => f.pdLogged).map(f => f.pdWording).join('; ') || "None";
        const fuiWording = response.findings?.filter(f => f.fuiLogged).map(f => f.fuiWording).join('; ') || "None";

        return [
            item.id,
            `"${item.description.replace(/"/g, '""')}"`,
            `"${response.text.replace(/"/g, '""')}"`,
            `"${pdWording.replace(/"/g, '""')}"`,
            `"${fuiWording.replace(/"/g, '""')}"`
        ];
    }).filter(row => row !== null);

    const csvContent = [headers, ...rows].map(e => e?.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `IMV_Report_${projectNumber}_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    addAuditEntry('Report Exported to CSV');
  };

  const toggleFindingDisposition = (itemId: string, findingId: string, disposition: 'PD' | 'FUI') => {
      const response = generatedResponses[itemId];
      if (!response || !response.findings) return;
      const newFindings = response.findings.map(f => {
          if (f.id === findingId) {
              return {
                  ...f,
                  pdLogged: disposition === 'PD' ? !f.pdLogged : f.pdLogged,
                  fuiLogged: disposition === 'FUI' ? !f.fuiLogged : f.fuiLogged
              };
          }
          return f;
      });
      setGeneratedResponses(prev => ({ ...prev, [itemId]: { ...response, findings: newFindings } }));
      addAuditEntry(`Disposition Updated for ${findingId}`);
  };

  if (view === 'dashboard') {
    return (
      <div className="flex flex-col h-full bg-slate-100 p-6 animate-in fade-in duration-500 overflow-y-auto">
        <div className="w-full space-y-8">
            <div className="flex justify-between items-end">
                <div>
                    <h2 className="text-3xl font-black text-slate-800">IMV Smart Assist Tool</h2>
                    <p className="text-slate-500 font-bold uppercase tracking-widest text-[10px] mt-1">Clinical Intelligence Dashboard • Veeva Lifecycle Engine</p>
                </div>
                <button onClick={handleCreateNew} className="bg-slate-900 text-white px-8 py-4 rounded-2xl font-black text-xs uppercase tracking-widest shadow-2xl hover:bg-black transition-all active:scale-95 border-b-4 border-cyan-600 flex items-center gap-3">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 4v16m8-8H4"/></svg>
                    New Clinical Ingestion Cycle
                </button>
            </div>
            <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-2xl">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-white border-b border-slate-100 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                            <tr>
                                <th className="px-8 py-6">ID / Protocol Reference</th>
                                <th className="px-8 py-6">Operator Detail</th>
                                <th className="px-8 py-6">Initiated At</th>
                                <th className="px-8 py-6">Status</th>
                                <th className="px-8 py-6 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {allReports.map(report => (
                                <tr key={report.id} className="hover:bg-slate-50 transition-colors group">
                                    <td className="px-8 py-6"><div className="text-sm font-black text-slate-900 group-hover:text-cyan-600 transition-colors">{report.projectNumber}</div><div className="text-[10px] font-mono font-bold text-slate-400">{report.protocolNumber}</div></td>
                                    <td className="px-8 py-6"><div className="text-xs font-bold text-slate-700">{report.craName}</div><div className="text-[9px] text-slate-400 font-bold uppercase">{report.sponsorName}</div></td>
                                    <td className="px-8 py-6"><div className="text-xs font-bold text-slate-600">{new Date(report.openedAt).toLocaleString()}</div></td>
                                    <td className="px-8 py-6"><span className={`px-2.5 py-1 rounded text-[9px] font-black uppercase border-2 ${report.status === 'Finalized' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{report.status}</span></td>
                                    <td className="px-8 py-6 text-right"><button onClick={() => handleLoadReport(report)} className="bg-slate-900 text-white px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-cyan-600 transition-all">Open Record</button></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white shadow-2xl rounded-2xl border border-slate-200 overflow-hidden printable-area relative">
      <div className="p-6 bg-slate-900 text-white flex flex-col md:flex-row justify-between items-start md:items-center gap-6 sticky top-0 z-50 shadow-xl no-print">
        <div className="flex items-center gap-4">
            <button onClick={() => setView('dashboard')} className="p-2 hover:bg-white/10 rounded-xl transition-colors">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M10 19l-7-7m0 0l7-7m-7 7h18"/></svg>
            </button>
            <h1 className="text-2xl font-black flex items-center gap-3">
                 <div className="w-10 h-10 bg-cyan-500 rounded-xl flex items-center justify-center text-slate-900"><svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20"><path d="M9 2a2 2 0 00-2 2v8a2 2 0 002 2h6a2 2 0 002-2V6.414A2 2 0 0016.414 5L14 2.586A2 2 0 0012.586 2H9z" /><path d="M3 8a2 2 0 012-2v10h8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" /></svg></div>
                 AIDE Intelligent Assist
            </h1>
        </div>
        <div className="flex gap-4 items-center">
            <button onClick={handleExportCSV} className="bg-slate-700 hover:bg-slate-600 px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg active:scale-95 flex items-center gap-2 border-b-2 border-slate-800">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                Export CSV
            </button>
            <button onClick={handleSave} className="bg-cyan-600 hover:bg-cyan-700 px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg active:scale-95 flex items-center gap-2 border-b-2 border-cyan-800">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"/></svg>
                Save Record
            </button>
            <select value={selectedLanguage} onChange={(e) => setSelectedLanguage(e.target.value)} className="bg-slate-800 text-white border-0 rounded-xl px-4 py-2.5 text-[10px] font-black uppercase outline-none focus:ring-2 focus:ring-cyan-500">
                {LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-8 scrollbar-thin">
        <div className="bg-slate-50 p-6 rounded-3xl border border-slate-200 shadow-inner no-print space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div className="space-y-1"><label className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Project ID</label><input value={projectNumber} onChange={e => setProjectNumber(e.target.value)} className="w-full bg-white border border-slate-200 rounded-xl p-3 text-xs font-bold focus:ring-2 focus:ring-cyan-500/20 outline-none" /></div>
                <div className="space-y-1"><label className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Protocol Reference</label><input value={protocolNumber} onChange={e => setProtocolNumber(e.target.value)} className="w-full bg-white border border-slate-200 rounded-xl p-3 text-xs font-bold focus:ring-2 focus:ring-cyan-500/20 outline-none" /></div>
                <div className="space-y-1"><label className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Operator (CRA)</label><input value={craName} onChange={e => setCraName(e.target.value)} className="w-full bg-white border border-slate-200 rounded-xl p-3 text-xs font-bold focus:ring-2 focus:ring-cyan-500/20 outline-none" /></div>
            </div>

            <div className="border-t border-slate-200 pt-8 space-y-6">
                <div className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em]">Neural Intelligence Pipelines</div>
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                    {['protocol', 'cmp', 'annotated', 'multi'].map((type) => {
                        const filteredArtifacts = ingestedArtifacts.filter(a => a.type === type);
                        const hasArtifact = filteredArtifacts.length > 0;
                        return (
                            <div key={type} className="flex flex-col gap-3">
                                <label className="text-[8px] font-black text-slate-500 uppercase flex justify-between items-center">
                                    {type.toUpperCase()} Source
                                    {hasArtifact && <span className="text-emerald-600 font-bold bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100">INGESTED</span>}
                                </label>
                                <div className="space-y-2">
                                    <button 
                                        onClick={() => (fileInputRefs as any)[type].current?.click()} 
                                        className={`w-full py-3 px-4 rounded-xl text-[9px] font-black uppercase transition-all border-2 border-dashed flex items-center justify-center gap-2 ${hasArtifact ? 'bg-white border-cyan-200 text-cyan-700' : 'bg-white border-slate-200 text-slate-400 shadow-sm hover:border-slate-300'}`}
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4"/></svg>
                                        {type === 'multi' ? 'Upload Notes/Docs' : `Upload ${type}`}
                                    </button>
                                    <input type="file" ref={(fileInputRefs as any)[type]} className="hidden" multiple={type === 'multi'} accept=".pdf,.docx,.txt,.jpg,.png" onChange={(e) => handleArtifactUpload(e, type as any)} />
                                    <div className="flex flex-col gap-1.5">
                                        {ingestedArtifacts.map((artifact, idx) => artifact.type === type && (
                                            <div key={idx} className="flex items-center justify-between p-2.5 bg-white border border-slate-200 rounded-lg shadow-sm group hover:border-cyan-500 transition-all">
                                                <div className="flex items-center gap-2 truncate"><span className="text-[10px] font-bold text-slate-600 truncate group-hover:text-cyan-600">{artifact.name}</span></div>
                                                <button onClick={() => removeArtifact(idx)} className="p-1 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12"/></svg></button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
                {ingestedArtifacts.length > 0 && (
                    <div className="flex justify-center border-t border-slate-200 pt-8">
                        <button onClick={processNotesSegregation} disabled={isProcessingField === 'neural_note_processing'} className="bg-cyan-600 text-white px-10 py-4 rounded-2xl shadow-xl hover:bg-cyan-700 transition-all font-black text-xs uppercase tracking-widest active:scale-95 disabled:opacity-50 flex items-center gap-3">
                            {isProcessingField === 'neural_note_processing' ? 'Correlating Artifact Manifest...' : '⚡ Segregate Response to Questions'}
                        </button>
                    </div>
                )}
            </div>
        </div>

        <div className="border border-slate-200 rounded-3xl overflow-x-auto shadow-2xl bg-white">
            <div className="p-4 bg-slate-900 flex justify-between items-center no-print min-w-[1000px]">
                <span className="text-[10px] font-black text-cyan-400 uppercase tracking-[0.2em] ml-4">Advanced Risk Analysis Matrix</span>
                <button onClick={handleBulkSynthesize} disabled={isBulkProcessing || Object.keys(fieldKeywords).length === 0} className="bg-cyan-600 hover:bg-cyan-500 text-white px-8 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg active:scale-95 disabled:opacity-50 border-b-2 border-cyan-800">
                    {isBulkProcessing ? 'Executing Matrix...' : 'Bulk Ingest & AI Review'}
                </button>
            </div>
            <table className="w-full border-collapse table-fixed min-w-[1000px]">
                <thead className="bg-[#eaeff5]">
                    <tr>
                        <th className="px-8 py-6 text-left text-[11px] font-black text-slate-700 uppercase border-r border-slate-300 w-1/5">Requirement</th>
                        <th className="px-8 py-6 text-left text-[11px] font-black text-slate-700 uppercase border-r border-slate-300 w-[25%]">Factual Observations</th>
                        <th className="px-8 py-6 text-left text-[11px] font-black text-slate-700 uppercase border-r border-slate-300 w-[25%]">Author Synthesis</th>
                        <th className="px-8 py-6 text-left text-[11px] font-black text-slate-700 uppercase w-[30%]">AI Peer Review (GxP)</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                    {CHECKLIST_DATA.map((item) => {
                        const response = generatedResponses[item.id];
                        const review = peerReviews[item.id] || { keywords: '', authorClarification: '', aiPeerReview: null, stage: 'idle' };
                        const keywords = fieldKeywords[item.id] || '';
                        const isNotFound = keywords === "Matching information not found";
                        const isIncorporateBusy = isProcessingField === `incorporate_${item.id}`;

                        return (
                            <tr key={item.id} className="align-top group hover:bg-slate-50/30 transition-colors">
                                <td className="px-8 py-10 border-r border-slate-200 space-y-4">
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[9px] font-black bg-slate-900 text-white px-2 py-0.5 rounded shadow-sm">{item.seq}</span>
                                            <div className="text-[8px] font-black text-slate-400 uppercase truncate">{item.type}</div>
                                        </div>
                                        {response && (
                                            <button 
                                                onClick={() => {
                                                    const pdWording = response.findings?.filter(f => f.pdLogged).map(f => f.pdWording).join('; ') || "None";
                                                    const fuiWording = response.findings?.filter(f => f.fuiLogged).map(f => f.fuiWording).join('; ') || "None";
                                                    const content = `Requirement: ${item.description}\nAuthor Synthesis: ${response.text}\nProtocol Deviations: ${pdWording}\nFollow-Up Items: ${fuiWording}`;
                                                    const blob = new Blob([content], { type: 'text/plain' });
                                                    const url = URL.createObjectURL(blob);
                                                    const link = document.createElement("a");
                                                    link.href = url;
                                                    link.download = `Export_${item.id}.txt`;
                                                    link.click();
                                                }}
                                                className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-lg transition-all"
                                                title="Export Item"
                                            >
                                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                                            </button>
                                        )}
                                    </div>
                                    <h4 className="text-[13px] font-bold text-slate-800 leading-tight">{item.description}</h4>
                                </td>
                                <td className="px-8 py-10 border-r border-slate-200">
                                    <textarea value={keywords} onChange={(e) => setFieldKeywords(prev => ({...prev, [item.id]: e.target.value}))} className={`w-full border-2 rounded-2xl p-4 text-xs h-[140px] outline-none focus:ring-4 focus:ring-cyan-500/5 transition-all font-medium ${isNotFound ? 'bg-amber-50 border-amber-200 text-amber-800 italic' : 'bg-slate-50 border-slate-200'}`} placeholder="Observation nodes..." />
                                </td>
                                <td className="px-8 py-10 border-r border-slate-200 space-y-4">
                                    {isProcessingField === item.id ? (
                                        <div className="flex items-center gap-2 text-[10px] font-black text-cyan-600 animate-pulse uppercase">Synthesizing...</div>
                                    ) : response ? (
                                        <div className="space-y-4">
                                            <div className="bg-white border-2 border-slate-100 rounded-2xl p-5 shadow-lg space-y-3">
                                                <div className="text-[12.5px] font-medium leading-relaxed text-slate-800 italic">"{response?.text ?? "No synthesis generated"}"</div>
                                            </div>
                                            {response.findings && response.findings.length > 0 && (
                                                <div className="space-y-3 p-4 bg-red-50 border border-red-100 rounded-2xl">
                                                    <div className="flex items-center gap-2 text-[9px] font-black uppercase text-red-600">Finding Disposition Required</div>
                                                    {response.findings.map(finding => (
                                                        <div key={finding.id} className="space-y-3">
                                                            <div className="text-[10px] font-medium text-red-800 border-l-2 border-red-200 pl-3 leading-tight mb-2">{(finding?.pdWording ?? "No wording provided").substring(0, 100)}...</div>
                                                            <div className="grid grid-cols-2 gap-2">
                                                                <button onClick={() => toggleFindingDisposition(item.id, finding.id, 'PD')} className={`px-3 py-2 rounded-xl text-[9px] font-black uppercase transition-all flex items-center justify-center gap-2 border-2 ${finding.pdLogged ? 'bg-red-600 text-white border-red-600 shadow-md' : 'bg-white text-red-600 border-red-100'}`}>
                                                                    {finding.pdLogged ? '✓ PD Reported' : 'Report PD'}
                                                                </button>
                                                                <button onClick={() => toggleFindingDisposition(item.id, finding.id, 'FUI')} className={`px-3 py-2 rounded-xl text-[9px] font-black uppercase transition-all flex items-center justify-center gap-2 border-2 ${finding.fuiLogged ? 'bg-amber-500 text-white border-amber-500 shadow-md' : 'bg-white text-amber-600 border-amber-100'}`}>
                                                                    {finding.fuiLogged ? '✓ FUI Assigned' : 'Assign FUI'}
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <button onClick={() => handleSynthesizeAndReview(item)} className="text-[9px] font-black bg-slate-100 hover:bg-slate-200 text-slate-500 px-4 py-2 rounded-xl uppercase tracking-widest border border-slate-200 transition-all">Initialize Synthesis</button>
                                    )}
                                </td>
                                <td className="px-8 py-10 space-y-5">
                                    {review.aiPeerReview ? (
                                        <div className="space-y-4 animate-in slide-in-from-right duration-500">
                                            <div className="space-y-4">
                                                <div className="p-4 bg-red-50 border border-red-100 rounded-2xl">
                                                    <div className="text-[8px] font-black text-red-600 uppercase tracking-widest mb-1">Critical Challenge</div>
                                                    <div className="text-[12px] font-bold text-red-900">"{review.aiPeerReview.criticalThinking ?? "N/A"}"</div>
                                                </div>
                                                <div className="p-4 bg-cyan-50 border border-cyan-100 rounded-2xl">
                                                    <div className="text-[8px] font-black text-cyan-600 uppercase tracking-widest mb-1">Risk Curiosity</div>
                                                    <div className="text-[12px] font-bold text-cyan-900 italic">"{review.aiPeerReview.curiosityQuestion ?? "N/A"}"</div>
                                                </div>
                                                <div className="space-y-2">
                                                    <div className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Suggested Peer Feedback</div>
                                                    {review.aiPeerReview.suggestedComments?.map((c, i) => <div key={i} className="text-[11px] p-2 bg-slate-50 rounded-lg border border-slate-100 text-slate-700 font-medium">● {c}</div>)}
                                                </div>
                                            </div>
                                            {review.stage !== 'finalized' ? (
                                                <div className="pt-4 border-t border-slate-100 space-y-4">
                                                    <div className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Author's Action / Response</div>
                                                    <textarea value={review.authorClarification} onChange={(e) => setPeerReviews(prev => ({...prev, [item.id]: { ...review, authorClarification: e.target.value }}))} className="w-full bg-white border border-slate-200 rounded-xl p-4 text-[11px] font-bold text-slate-800 outline-none focus:ring-2 focus:ring-cyan-500/20 shadow-inner min-h-[100px]" placeholder="Describe remediation action or rationale for ignoring..." />
                                                    <div className="flex gap-3">
                                                        <button onClick={() => handleIncorporateSuggestion(item)} disabled={isIncorporateBusy || !review.authorClarification.trim()} className="flex-1 bg-emerald-600 text-white px-4 py-3 rounded-xl text-[10px] font-black uppercase hover:bg-emerald-700 shadow-xl active:scale-95 disabled:opacity-30 transition-all flex items-center justify-center gap-2">{isIncorporateBusy ? '...' : 'Incorporate Suggestion'}</button>
                                                        <button onClick={() => handleIgnoreSuggestion(item)} disabled={!review.authorClarification.trim()} className="flex-1 bg-slate-100 text-slate-600 px-4 py-3 rounded-xl text-[10px] font-black uppercase hover:bg-slate-200 border border-slate-200 active:scale-95 disabled:opacity-30 transition-all">Ignore / Close</button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className={`p-4 rounded-2xl border flex items-center gap-3 ${review.resolution === 'Incorporate' ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-slate-50 border-slate-100 text-slate-500'}`}>
                                                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black ${review.resolution === 'Incorporate' ? 'bg-emerald-600 text-white' : 'bg-slate-300 text-white'}`}>{review.resolution === 'Incorporate' ? '✓' : '✕'}</div>
                                                    <div><div className="text-[10px] font-black uppercase tracking-widest">Query {review.resolution === 'Incorporate' ? 'Incorporated' : 'Ignored'}</div><div className="text-[11px] font-medium italic opacity-75">"{review.authorClarification}"</div></div>
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="flex flex-col items-center justify-center h-full text-slate-300 gap-2 opacity-50"><span className="text-[9px] font-black uppercase tracking-widest">Review Cycle Pending</span></div>
                                    )}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
      </div>
    </div>
  );
};

export default MonitoringReportGenerator;
