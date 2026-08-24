import type { ElevenLabsRegion } from "../storage/preferences";
import { elevenLabsOriginPattern, type ElevenLabsMetadata } from "./elevenlabs";

export interface OptionalHostPermissionPort {
  request(originPattern: string): Promise<boolean>;
  remove(originPattern: string): Promise<boolean>;
}

export interface CredentialConnectionPort {
  save(credential: string, rememberOnDevice: boolean): Promise<void>;
  disconnect(): Promise<void>;
}

export interface ProviderMetadataPort {
  validateAndLoad(
    credential: string,
    region: ElevenLabsRegion,
  ): Promise<ElevenLabsMetadata>;
}

export interface ProviderTransportPort {
  abortAll(): void;
}

export interface ConnectProviderInput {
  credential: string;
  rememberOnDevice: boolean;
  region: ElevenLabsRegion;
}

export class ProviderPermissionError extends Error {
  readonly code = "PROVIDER_PERMISSION_DENIED";

  constructor() {
    super("Allow access to the selected ElevenLabs API Region to connect.");
    this.name = "ProviderPermissionError";
  }
}

export class ProviderConnectionService {
  constructor(
    private readonly permissions: OptionalHostPermissionPort,
    private readonly credentials: CredentialConnectionPort,
    private readonly metadata: ProviderMetadataPort,
    private readonly transport: ProviderTransportPort,
  ) {}

  async connect(input: ConnectProviderInput): Promise<ElevenLabsMetadata> {
    const originPattern = elevenLabsOriginPattern(input.region);
    const granted = await this.permissions.request(originPattern);
    if (!granted) throw new ProviderPermissionError();

    try {
      const metadata = await this.metadata.validateAndLoad(
        input.credential,
        input.region,
      );
      await this.credentials.save(input.credential, input.rememberOnDevice);
      return metadata;
    } catch (error) {
      await this.permissions.remove(originPattern);
      throw error;
    }
  }

  async disconnect(region: ElevenLabsRegion): Promise<void> {
    this.transport.abortAll();
    await this.credentials.disconnect();
    await this.permissions.remove(elevenLabsOriginPattern(region));
  }
}
