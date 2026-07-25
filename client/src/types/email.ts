export interface VerificationFlags {
  syntaxValid: boolean;
  mxFound: boolean;
  smtpConnected: boolean;
  starttls: boolean;
  recipientAccepted: boolean;
  catchAll: boolean;
  greylisted: boolean;
  temporaryFailure: boolean;
  timedOut: boolean;
}

export interface Classification {
  category: string;
  score: number;
  flags: VerificationFlags;
}

export interface VerificationResult {
  email: string;
  domain: string;
  elapsedMs: number;
  mxHostUsed: string;
  classification: Classification;
}

export interface VerifyApiResponse {
  success: boolean;
  data: VerificationResult;
}