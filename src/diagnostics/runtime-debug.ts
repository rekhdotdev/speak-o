export const DEBUG_MODE = true;
export const MAX_RUNTIME_DEBUG_ENTRIES = 160;

export type RuntimeDebugScope = "content" | "background" | "tts" | "offscreen";

type RuntimeDebugValue = string | number | boolean | null;
type RuntimeDebugData = Record<string, RuntimeDebugValue>;

export interface RuntimeDebugEntry {
  timestamp: string;
  scope: RuntimeDebugScope;
  event: string;
  data?: RuntimeDebugData;
}

const PRIVATE_FIELD =
  /(?:article(?:text|title)?|audio|credential|api.?key|token|secret|url|content|text)$/i;
const URL_VALUE = /\b(?:https?|wss?):\/\/[^\s"']+/giu;
const CREDENTIAL_VALUE = /\b(?:sk|xi|api)[_-][a-z0-9_-]{8,}\b/giu;

function sanitizeString(value: string): string {
  return value
    .replace(URL_VALUE, "<URL>")
    .replace(CREDENTIAL_VALUE, "<REDACTED>")
    .replaceAll("\n", " ")
    .slice(0, 240);
}

function sanitizeData(
  data: Record<string, RuntimeDebugValue | undefined>,
): RuntimeDebugData | undefined {
  const safe = Object.entries(data)
    .filter(([key, value]) => value !== undefined && !PRIVATE_FIELD.test(key))
    .slice(0, 16)
    .map(([key, value]) => [
      key.slice(0, 64),
      typeof value === "string" ? sanitizeString(value) : value,
    ]);
  return safe.length > 0 ? Object.fromEntries(safe) : undefined;
}

export function isRuntimeDebugEntry(
  value: unknown,
): value is RuntimeDebugEntry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Partial<RuntimeDebugEntry>;
  if (
    typeof candidate.timestamp !== "string" ||
    candidate.timestamp.length > 40 ||
    !["content", "background", "tts", "offscreen"].includes(
      String(candidate.scope),
    ) ||
    typeof candidate.event !== "string" ||
    candidate.event.length === 0 ||
    candidate.event.length > 96
  ) {
    return false;
  }
  if (candidate.data === undefined) return true;
  if (
    typeof candidate.data !== "object" ||
    candidate.data === null ||
    Array.isArray(candidate.data) ||
    Object.keys(candidate.data).length > 16
  ) {
    return false;
  }
  return Object.values(candidate.data).every(
    (item) =>
      item === null ||
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean",
  );
}

export function summarizeDebugError(error: unknown): string {
  if (error instanceof Error) {
    return sanitizeString(`${error.name}: ${error.message}`);
  }
  return sanitizeString(String(error));
}

export class RuntimeDebugBuffer {
  private readonly entries: RuntimeDebugEntry[] = [];

  constructor(
    private readonly maximum = MAX_RUNTIME_DEBUG_ENTRIES,
    private readonly now: () => number = Date.now,
  ) {}

  record(
    scope: RuntimeDebugScope,
    event: string,
    data: Record<string, RuntimeDebugValue | undefined> = {},
  ): RuntimeDebugEntry {
    const safeData = sanitizeData(data);
    const entry: RuntimeDebugEntry = {
      timestamp: new Date(this.now()).toISOString(),
      scope,
      event: event.slice(0, 96),
      ...(safeData ? { data: safeData } : {}),
    };
    this.push(entry);
    return entry;
  }

  ingest(values: unknown[]): void {
    for (const value of values) {
      if (!isRuntimeDebugEntry(value)) continue;
      const safeData = value.data ? sanitizeData(value.data) : undefined;
      this.push({
        timestamp: value.timestamp,
        scope: value.scope,
        event: value.event,
        ...(safeData ? { data: safeData } : {}),
      });
    }
  }

  snapshot(): RuntimeDebugEntry[] {
    return this.entries.map((entry) => ({
      ...entry,
      ...(entry.data ? { data: { ...entry.data } } : {}),
    }));
  }

  format(): string {
    const lines = this.entries.map((entry) => {
      const data = entry.data ? ` ${JSON.stringify(entry.data)}` : "";
      return `${entry.timestamp} [${entry.scope}] ${entry.event}${data}`;
    });
    return [
      "Speak-O DEBUG_MODE=true",
      `entries=${this.entries.length}/${this.maximum}`,
      ...(lines.length > 0 ? lines : ["<no events>"]),
    ].join("\n");
  }

  private push(entry: RuntimeDebugEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.maximum) {
      this.entries.splice(0, this.entries.length - this.maximum);
    }
  }
}
