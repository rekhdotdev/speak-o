import {
  DEBUG_MODE,
  RuntimeDebugBuffer,
} from "../../src/diagnostics/runtime-debug";

describe("runtime debug trace", () => {
  it("is enabled, bounded, and redacts sensitive values", () => {
    let now = Date.parse("2026-08-25T10:00:00.000Z");
    const buffer = new RuntimeDebugBuffer(3, () => now++);

    buffer.record("content", "reader.mounted", {
      pageUrl: "https://example.com/private-article",
      status: "finding",
    });
    buffer.record("background", "session.activate", {
      articleText: "Private Article text",
      mode: "browser",
    });
    buffer.record("tts", "speak.request", {
      sentenceIndex: 4,
      rate: 1.5,
    });
    buffer.record("tts", "event", {
      eventType: "start",
      error: "Failed at https://provider.invalid/private?key=secret",
    });

    const entries = buffer.snapshot();
    const log = buffer.format();

    expect(DEBUG_MODE).toBe(true);
    expect(entries).toHaveLength(3);
    expect(entries[0]?.event).toBe("session.activate");
    expect(log).toContain("Speak-O DEBUG_MODE=true");
    expect(log).toContain('"rate":1.5');
    expect(log).toContain("<URL>");
    expect(log).not.toContain("Private Article text");
    expect(log).not.toContain("private-article");
    expect(log).not.toContain("key=secret");
  });

  it("merges valid entries received from another extension context", () => {
    const local = new RuntimeDebugBuffer(4, () => 1);
    const remote = new RuntimeDebugBuffer(4, () => 2);
    const entry = remote.record("background", "extract.request.sent", {
      tabId: 7,
    });

    local.ingest([entry, { invalid: true }]);

    expect(local.snapshot()).toEqual([entry]);
  });
});
