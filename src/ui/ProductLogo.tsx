import { message } from "../i18n";
import iconSource from "../../assets/icon-source.svg?raw";

const logoDataUrl = `data:image/svg+xml,${encodeURIComponent(iconSource)}`;

export function ProductLogo({
  className,
  decorative = false,
}: {
  className: string;
  decorative?: boolean;
}) {
  return (
    <img
      aria-hidden={decorative || undefined}
      className={className}
      draggable={false}
      src={logoDataUrl}
      alt={decorative ? "" : message("extensionName")}
    />
  );
}
