import type { CloudProviderId } from "../provider/types";

const CREDENTIAL_KEYS: Record<CloudProviderId, string> = {
  elevenlabs: "elevenLabsCredential",
  speechify: "speechifyCredential",
};

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

  async save(
    provider: CloudProviderId,
    credential: string,
    rememberOnDevice: boolean,
  ): Promise<void> {
    if (!validCredential(credential)) {
      throw new Error("Enter a valid Provider Credential.");
    }

    const key = CREDENTIAL_KEYS[provider];
    await this.session.set({ [key]: credential });
    if (rememberOnDevice) {
      await this.local.set({ [key]: credential });
    } else {
      await this.local.remove(key);
    }
  }

  async load(provider: CloudProviderId): Promise<string | null> {
    const key = CREDENTIAL_KEYS[provider];
    const sessionValue = (await this.session.get(key))[key];
    if (validCredential(sessionValue)) return sessionValue;

    const localValue = (await this.local.get(key))[key];
    return validCredential(localValue) ? localValue : null;
  }

  async describe(
    provider: CloudProviderId,
  ): Promise<ProviderConnectionDescription> {
    const key = CREDENTIAL_KEYS[provider];
    const localValue = (await this.local.get(key))[key];
    const remembered = validCredential(localValue);
    const credential = await this.load(provider);

    return {
      connected: credential !== null,
      remembered,
      maskedSuffix: credential === null ? null : `••••${credential.slice(-4)}`,
    };
  }

  async disconnect(provider: CloudProviderId): Promise<void> {
    const key = CREDENTIAL_KEYS[provider];
    await Promise.all([this.session.remove(key), this.local.remove(key)]);
  }
}
