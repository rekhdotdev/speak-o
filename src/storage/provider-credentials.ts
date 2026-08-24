const CREDENTIAL_KEY = "elevenLabsCredential";

export interface ProtectedStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
  setAccessLevel(accessOptions: {
    accessLevel: StorageAccessLevel;
  }): Promise<void>;
}

export type StorageAccessLevel =
  "TRUSTED_CONTEXTS" | "TRUSTED_AND_UNTRUSTED_CONTEXTS";

export interface ProviderConnectionDescription {
  connected: boolean;
  remembered: boolean;
  maskedSuffix: string | null;
}

function validCredential(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 8 &&
    value.length <= 512 &&
    !/\s/.test(value)
  );
}

export class ProviderCredentialStore {
  constructor(
    private readonly session: ProtectedStorageArea,
    private readonly local: ProtectedStorageArea,
  ) {}

  async initialize(): Promise<void> {
    const trustedOnly = { accessLevel: "TRUSTED_CONTEXTS" as const };
    await Promise.all([
      this.session.setAccessLevel(trustedOnly),
      this.local.setAccessLevel(trustedOnly),
    ]);
  }

  async save(credential: string, rememberOnDevice: boolean): Promise<void> {
    if (!validCredential(credential)) {
      throw new Error("Enter a valid ElevenLabs API key.");
    }

    await this.session.set({ [CREDENTIAL_KEY]: credential });
    if (rememberOnDevice) {
      await this.local.set({ [CREDENTIAL_KEY]: credential });
    } else {
      await this.local.remove(CREDENTIAL_KEY);
    }
  }

  async load(): Promise<string | null> {
    const sessionValue = (await this.session.get(CREDENTIAL_KEY))[
      CREDENTIAL_KEY
    ];
    if (validCredential(sessionValue)) return sessionValue;

    const localValue = (await this.local.get(CREDENTIAL_KEY))[CREDENTIAL_KEY];
    return validCredential(localValue) ? localValue : null;
  }

  async describe(): Promise<ProviderConnectionDescription> {
    const localValue = (await this.local.get(CREDENTIAL_KEY))[CREDENTIAL_KEY];
    const remembered = validCredential(localValue);
    const credential = await this.load();

    return {
      connected: credential !== null,
      remembered,
      maskedSuffix: credential === null ? null : `••••${credential.slice(-4)}`,
    };
  }

  async disconnect(): Promise<void> {
    await Promise.all([
      this.session.remove(CREDENTIAL_KEY),
      this.local.remove(CREDENTIAL_KEY),
    ]);
  }
}
