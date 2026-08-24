import {
  ProviderConnectionService,
  type OptionalHostPermissionPort,
} from "../../src/provider/provider-connection";

describe("Provider Connection lifecycle", () => {
  it("requests one exact origin, saves only after validation, and revokes access on disconnect", async () => {
    const permissionEvents: string[] = [];
    const permissions: OptionalHostPermissionPort = {
      async request(originPattern) {
        permissionEvents.push(`request:${originPattern}`);
        return true;
      },
      async remove(originPattern) {
        permissionEvents.push(`remove:${originPattern}`);
        return true;
      },
    };
    const credentialEvents: string[] = [];
    const credentials = {
      async save(_credential: string, remembered: boolean) {
        credentialEvents.push(`save:${remembered}`);
      },
      async disconnect() {
        credentialEvents.push("disconnect");
      },
    };
    const transportEvents: string[] = [];
    const service = new ProviderConnectionService(
      permissions,
      credentials,
      {
        async validateAndLoad() {
          return { voices: [], models: [] };
        },
      },
      { abortAll: () => transportEvents.push("abort") },
    );

    await service.connect({
      credential: "sk_connection_123",
      rememberOnDevice: false,
      region: "singapore",
    });
    expect(permissionEvents).toEqual([
      "request:https://api.sg.residency.elevenlabs.io/*",
    ]);
    expect(credentialEvents).toEqual(["save:false"]);

    await service.disconnect("singapore");
    expect(transportEvents).toEqual(["abort"]);
    expect(credentialEvents).toEqual(["save:false", "disconnect"]);
    expect(permissionEvents).toEqual([
      "request:https://api.sg.residency.elevenlabs.io/*",
      "remove:https://api.sg.residency.elevenlabs.io/*",
    ]);
  });
});
