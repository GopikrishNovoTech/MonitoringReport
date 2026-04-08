
export interface IMVReportAudit {
  action: string;
  timestamp: number;
  user: string;
}

export interface AIPeerReviewResult {
  criticalThinking: string;
  curiosityQuestion: string;
  suggestedComments: string[];
  protocolMatch: 'Verified' | 'Conflict' | 'Ambiguous';
  ichReference: string;
}

export interface IMVReport {
  id: string;
  projectNumber: string;
  protocolNumber: string;
  sponsorName: string;
  craName: string;
  reviewerName: string;
  protocolUrl: string;
  protocolVersion: string;
  openedAt: number;
  completedAt?: number;
  peerReviewTotalSeconds: number;
  status: 'Draft' | 'Review' | 'Finalized';
  isReviewerNotified: boolean;
  auditTrail: IMVReportAudit[];
  data: {
    fieldKeywords?: Record<string, string>;
    generatedResponses?: Record<string, any>;
    peerReviews?: Record<string, any>;
    fullProtocolText?: string;
    cmpText?: string;
    annotatedReportText?: string;
    ingestedArtifacts?: Array<{ name: string; type: string; content: string }>;
  };
}

export type AppTab = 'monitoring-report';

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
  groundingMetadata?: any;
}
