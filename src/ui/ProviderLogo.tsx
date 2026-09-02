import type { SpeechProviderId } from "../provider/types";

export function ProviderLogo({ provider }: { provider: SpeechProviderId }) {
  return (
    <span
      aria-hidden="true"
      className={`provider-logo provider-logo-${provider}`}
      data-provider-logo={provider}
    >
      {provider === "elevenlabs" ? <ElevenLabsLogo /> : null}
      {provider === "speechify" ? <SpeechifyLogo /> : null}
      {provider === "browser" ? <ChromeLogo /> : null}
    </span>
  );
}

function ElevenLabsLogo() {
  return (
    <svg viewBox="0 0 876 876">
      <path d="M468 292h60v292h-60zM348 292h60v292h-60z" />
    </svg>
  );
}

function SpeechifyLogo() {
  return (
    <svg viewBox="0 0 260 260">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M59.403 96.913c6.598-9.642 12.32-14.409 20.887-11.761 5.183 1.603 7.311 8.22 5.183 16.523-3.741 14.6-5.184 22.98-5.184 32.955 13.16-27.582 37.485-64.241 48.028-76.57 7.287-8.523 17.732-7.436 21.664-5.535 6.389 3.089 6.727 9.786 4.521 16.191-15.257 44.312-15.788 67.978-17.661 90.97 9.482-25.5 21.01-49.485 34.932-66.378 5.866-8.103 16.147-10.646 22.64-8.014 6.494 2.632 7.974 8.929 6.494 16.82-3.859 20.579-5.775 30.224-5.775 38.195 7.052-5.393 12.666-9.95 25.503-10.991C233.472 128.277 260 133.387 260 133.387s-15.315 2.602-23.404 4.586c-16.582 4.066-22.373 8.822-33.108 24.543-3.119 4.568-8.356 8.076-14.256 7.63-5.9-.447-9.862-4.158-11.593-9.171-2.406-6.967-3.121-17.389 0-39.941-15.293 23.268-23.137 54.875-33.615 75.835-2.68 5.359-7.255 11.466-13.457 11.466-6.201 0-14.242-2.406-15.286-20.83-2.675-47.196 6.241-84.752 6.241-84.752-17.366 27.535-22.912 43.585-28.952 51.954-6.041 8.37-11.902 15.618-19.032 15.439-7.13-.179-11.279-8.15-12.182-15.439-.902-7.288-1.162-16.597 1.473-33.673-6.859 6.859-12.89 11.505-23.692 14.414-10.801 2.909-23.7 1.057-38.665-2.061 14.966 0 40.151-9.029 58.931-36.474Z"
      />
    </svg>
  );
}

function ChromeLogo() {
  return (
    <svg viewBox="0 0 63 63">
      <defs>
        <linearGradient
          id="chrome-green"
          x1="34.909"
          x2="7.632"
          y1="61.029"
          y2="13.785"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#1e8e3e" offset="0" />
          <stop stopColor="#34a853" offset="1" />
        </linearGradient>
        <linearGradient
          id="chrome-yellow"
          x1="26.904"
          x2="54.181"
          y1="63.079"
          y2="15.835"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#fcc934" offset="0" />
          <stop stopColor="#fbbc04" offset="1" />
        </linearGradient>
        <linearGradient
          id="chrome-red"
          x1="4.221"
          x2="58.775"
          y1="19.688"
          y2="19.688"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#d93025" offset="0" />
          <stop stopColor="#ea4335" offset="1" />
        </linearGradient>
      </defs>
      <circle cx="31.499" cy="31.497" r="15.75" fill="#fff" />
      <path
        d="m17.859 39.375-13.638-23.621A31.5 31.5 0 0 0 31.501 63l13.638-23.625-.001-.004a15.75 15.75 0 0 1-27.279.004Z"
        fill="url(#chrome-green)"
      />
      <path
        d="M45.138 39.374 31.5 62.995a31.5 31.5 0 0 0 27.273-47.226H31.498l-.003.002a15.75 15.75 0 0 1 13.643 23.603Z"
        fill="url(#chrome-yellow)"
      />
      <circle cx="31.499" cy="31.5" r="12.469" fill="#1a73e8" />
      <path
        d="M31.499 15.75h27.275A31.5 31.5 0 0 0 4.221 15.754l13.638 23.621.004.002A15.75 15.75 0 0 1 31.499 15.75Z"
        fill="url(#chrome-red)"
      />
    </svg>
  );
}
