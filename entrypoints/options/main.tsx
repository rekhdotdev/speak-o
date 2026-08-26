import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { OptionsApp } from "../../src/ui/OptionsApp";
import { applyInterfaceDirection, message } from "../../src/i18n";
import "../../src/ui/options.css";

const root = document.getElementById("root");
if (!root) throw new Error(message("optionsRootMissing"));
applyInterfaceDirection(root);
document.documentElement.dir = root.dir;
document.title = message("optionsDocumentTitle");

createRoot(root).render(
  <StrictMode>
    <OptionsApp />
  </StrictMode>,
);
