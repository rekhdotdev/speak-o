import {
  ProviderCredentialStore,
  type ProtectedStorageArea,
  type StorageAccessLevel,
} from "../../src/storage/provider-credentials";

class MemoryProtectedStorage implements ProtectedStorageArea {
  readonly values: Record<string, unknown> = {};
  accessLevel: StorageAccessLevel | undefined;

  async get(key: string): Promise<Record<string, unknown>> {
    return key in this.values ? { [key]: this.values[key] } : {};
  }

  async set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.values, items);
  }

  async remove(key: string): Promise<void> {
    delete this.values[key];
  }

  async setAccessLevel(accessOptions: {
    accessLevel: StorageAccessLevel;
  }): Promise<void> {
    this.accessLevel = accessOptions.accessLevel;
  }
}

describe("ProviderCredentialStore", () => {
  it("keeps credentials session-only unless remembering is explicit", async () => {
    const session = new MemoryProtectedStorage();
    const local = new MemoryProtectedStorage();
    const store = new ProviderCredentialStore(session, local);

    await store.initialize();
    expect(session.accessLevel).toBe("TRUSTED_CONTEXTS");
    expect(local.accessLevel).toBe("TRUSTED_CONTEXTS");

    await store.save("elevenlabs", "sk_1234567890abcdef", false);
    expect(session.values).toEqual({
      elevenLabsCredential: "sk_1234567890abcdef",
    });
    expect(local.values).toEqual({});
    await expect(store.describe("elevenlabs")).resolves.toEqual({
      connected: true,
      remembered: false,
      maskedSuffix: "••••cdef",
    });

    await store.save("elevenlabs", "sk_abcdef1234567890", true);
    expect(local.values).toEqual({
      elevenLabsCredential: "sk_abcdef1234567890",
    });
    await expect(store.describe("elevenlabs")).resolves.toMatchObject({
      remembered: true,
    });

    await store.disconnect("elevenlabs");
    await expect(store.load("elevenlabs")).resolves.toBeNull();
    expect(session.values).toEqual({});
    expect(local.values).toEqual({});
  });

  it("rejects malformed credential input rather than persisting it", async () => {
    const session = new MemoryProtectedStorage();
    const local = new MemoryProtectedStorage();
    const store = new ProviderCredentialStore(session, local);

    await expect(store.save("speechify", "  ", true)).rejects.toThrow(
      "Enter a valid Provider Credential.",
    );
    expect(session.values).toEqual({});
    expect(local.values).toEqual({});
  });

  it("keeps provider credentials independent", async () => {
    const session = new MemoryProtectedStorage();
    const local = new MemoryProtectedStorage();
    const store = new ProviderCredentialStore(session, local);

    await store.save("elevenlabs", "sk_elevenlabs_1234", false);
    await store.save("speechify", "sk_speechify_5678", false);
    await store.disconnect("elevenlabs");

    await expect(store.load("elevenlabs")).resolves.toBeNull();
    await expect(store.load("speechify")).resolves.toBe("sk_speechify_5678");
  });
});
