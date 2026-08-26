import englishCatalog from "../public/_locales/en/messages.json";

interface CatalogPlaceholder {
  content: string;
}

interface CatalogMessage {
  message: string;
  placeholders?: Record<string, CatalogPlaceholder>;
}

export type MessageKey = keyof typeof englishCatalog;
export type MessageSubstitutions =
  string | number | readonly (string | number)[];

function normalizeSubstitutions(
  substitutions?: MessageSubstitutions,
): string[] {
  if (substitutions === undefined) return [];
  return (Array.isArray(substitutions) ? substitutions : [substitutions]).map(
    String,
  );
}

function expandEnglishMessage(
  key: MessageKey,
  substitutions?: MessageSubstitutions,
): string {
  const entry = englishCatalog[key] as CatalogMessage;
  const values = normalizeSubstitutions(substitutions);
  let result = entry.message;

  for (const [name, placeholder] of Object.entries(entry.placeholders ?? {})) {
    const replacement = placeholder.content.replace(
      /\$(\d)/g,
      (_match, position: string) => values[Number(position) - 1] ?? "",
    );
    result = result.replace(
      new RegExp(`\\$${name.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\$`, "gi"),
      replacement,
    );
  }

  return result.replace(
    /\$(\d)/g,
    (_match, position: string) => values[Number(position) - 1] ?? "",
  );
}

export function message(
  key: MessageKey,
  substitutions?: MessageSubstitutions,
): string {
  const values = normalizeSubstitutions(substitutions);
  try {
    const localized = globalThis.chrome?.i18n?.getMessage?.(
      key,
      values.length === 0 ? undefined : values,
    );
    if (localized) return localized;
  } catch {
    // Tests and non-extension renderers use the checked-in English catalog.
  }
  return expandEnglishMessage(key, values);
}

export function interfaceDirection(): "ltr" | "rtl" {
  try {
    return globalThis.chrome?.i18n?.getMessage?.("@@bidi_dir") === "rtl"
      ? "rtl"
      : "ltr";
  } catch {
    return "ltr";
  }
}

export function applyInterfaceDirection(element: HTMLElement): "ltr" | "rtl" {
  const direction = interfaceDirection();
  element.dir = direction;
  return direction;
}
