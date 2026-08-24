import { defineConfig } from "wxt";

const elevenLabsOrigins = [
  "https://api.elevenlabs.io/*",
  "https://api.us.elevenlabs.io/*",
  "https://api.eu.residency.elevenlabs.io/*",
  "https://api.in.residency.elevenlabs.io/*",
  "https://api.sg.residency.elevenlabs.io/*",
];

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  srcDir: ".",
  manifest: {
    name: "__MSG_extensionName__",
    description: "__MSG_extensionDescription__",
    version: "0.1.0",
    minimum_chrome_version: "124",
    default_locale: "en",
    incognito: "not_allowed",
    permissions: [
      "activeTab",
      "contextMenus",
      "offscreen",
      "scripting",
      "storage",
      "tts",
    ],
    optional_host_permissions: elevenLabsOrigins,
    action: {
      default_title: "__MSG_actionTitle__",
      default_icon: {
        "16": "icon/16.png",
        "32": "icon/32.png",
        "48": "icon/48.png",
        "128": "icon/128.png",
      },
    },
    icons: {
      "16": "icon/16.png",
      "32": "icon/32.png",
      "48": "icon/48.png",
      "128": "icon/128.png",
    },
    commands: {
      "read-article": {
        suggested_key: {
          default: "Alt+Shift+R",
          mac: "Alt+Shift+R",
        },
        description: "__MSG_commandRead__",
      },
      "toggle-playback": {
        suggested_key: {
          default: "Alt+Shift+P",
          mac: "Alt+Shift+P",
        },
        description: "__MSG_commandToggle__",
      },
    },
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'",
    },
  },
  zip: {
    artifactTemplate: "{{name}}-{{version}}-chrome.zip",
    sourcesTemplate: "{{name}}-{{version}}-sources.zip",
  },
});
