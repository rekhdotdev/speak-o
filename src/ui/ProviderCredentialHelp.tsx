import { message } from "../i18n";
import type { CloudProviderId } from "../provider/types";

const apiKeyHelpUrl: Record<CloudProviderId, string> = {
  elevenlabs: "https://elevenlabs.io/docs/eleven-api/quickstart",
  speechify:
    "https://docs.sws.speechify.com/text-to-speech/get-started/quickstart",
};

const providerName = (provider: CloudProviderId) =>
  provider === "elevenlabs" ? "ElevenLabs" : "Speechify";

export function ProviderCredentialHelp({
  provider,
}: {
  provider: CloudProviderId;
}) {
  const name = providerName(provider);

  return (
    <small className="provider-credential-help">
      {message("providerApiKeyHelpPrompt")}{" "}
      <a
        aria-label={message("providerApiKeyHelpLabel", name)}
        href={apiKeyHelpUrl[provider]}
        rel="noreferrer"
        target="_blank"
      >
        {message("providerApiKeyHelpLink", name)}{" "}
        <span aria-hidden="true">↗</span>
      </a>
    </small>
  );
}
