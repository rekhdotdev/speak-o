import { message } from "../i18n";
import { EyeIcon, EyeOffIcon } from "./icons";

export function CredentialVisibilityButton({
  revealed,
  onToggle,
}: {
  revealed: boolean;
  onToggle(): void;
}) {
  const label = message(revealed ? "optionsHide" : "optionsReveal");

  return (
    <button
      aria-label={label}
      className="credential-visibility-button"
      title={label}
      type="button"
      onClick={onToggle}
    >
      <span className="credential-visibility-icon" data-visible={!revealed}>
        <EyeIcon />
      </span>
      <span className="credential-visibility-icon" data-visible={revealed}>
        <EyeOffIcon />
      </span>
    </button>
  );
}
