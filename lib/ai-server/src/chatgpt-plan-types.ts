/** Backend-only. Never serialize credentials into public connection responses. */
export interface ChatGPTRegistrationCredentials {
  accessToken: string;
  refreshToken?: string;
  idToken: string;
  grants: string[];
  expiresAt: number;
  earliestRefreshAt?: number;
}

export interface ChatGPTRegistrationInput {
  id: string;
  hostId: string;
  clientId: string;
  /** App profile identity bound to validated issuer, issued client and subject. */
  accountId: string;
  subject: string;
  email?: string;
  displayName?: string;
  credentials: ChatGPTRegistrationCredentials | null;
}

export interface ChatGPTRegistration extends ChatGPTRegistrationInput {
  revision: number;
  updatedAt: number;
}

export interface ChatGPTRegistrationPublicStatus {
  id: string;
  accountId: string;
  email?: string;
  displayName?: string;
  revision: number;
  signedIn: boolean;
  canUsePlan: boolean;
  expiresAt: number | null;
}

export interface ChatGPTRegistrationAccess {
  getHostId(): Promise<string>;
  readRegistration(id: string): Promise<ChatGPTRegistration | null>;
  readActiveRegistration(): Promise<ChatGPTRegistration | null>;
  activateRegistration(id: string, expectedRevision: number): Promise<void>;
  readPublicStatus(id: string): Promise<ChatGPTRegistrationPublicStatus | null>;
  listPublicStatus(): Promise<ChatGPTRegistrationPublicStatus[]>;
  replaceRegistration(
    expectedRevision: number,
    registration: ChatGPTRegistrationInput,
  ): Promise<ChatGPTRegistration>;
}

export interface ChatGPTRegistrationStore extends ChatGPTRegistrationAccess {
  withRegistrationRefreshLock<T>(
    id: string,
    action: (locked: ChatGPTRegistrationAccess) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T>;
}
