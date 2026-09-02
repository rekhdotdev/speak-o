import type { ReactNode } from "react";

interface IconProps {
  children: ReactNode;
  className?: string;
}

function Icon({ children, className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height="20"
      viewBox="0 0 24 24"
      width="20"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
    >
      {children}
    </svg>
  );
}

export function PreviousIcon() {
  return (
    <Icon className="icon-directional">
      <path d="m15 18-6-6 6-6" />
      <path d="M6 6v12" />
    </Icon>
  );
}

export function NextIcon() {
  return (
    <Icon className="icon-directional">
      <path d="m9 18 6-6-6-6" />
      <path d="M18 6v12" />
    </Icon>
  );
}

export function PlayIcon() {
  return (
    <Icon className="play-glyph">
      <path d="m8 5 11 7-11 7Z" />
    </Icon>
  );
}

export function PauseIcon() {
  return (
    <Icon>
      <path d="M9 5v14M15 5v14" />
    </Icon>
  );
}

export function CheckIcon() {
  return (
    <Icon>
      <path d="m6.5 12.5 3.5 3.5 7.5-8" />
    </Icon>
  );
}

export function MoreIcon() {
  return (
    <Icon>
      <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function MinimizeIcon() {
  return (
    <Icon>
      <path d="M4 14h6v6" />
      <path d="M20 10h-6V4" />
      <path d="m14 10 7-7" />
      <path d="m3 21 7-7" />
    </Icon>
  );
}

export function MaximizeIcon() {
  return (
    <Icon>
      <path d="M15 3h6v6" />
      <path d="M9 21H3v-6" />
      <path d="m21 3-7 7" />
      <path d="m3 21 7-7" />
    </Icon>
  );
}

export function CloseIcon() {
  return (
    <Icon>
      <path d="m6 6 12 12M18 6 6 18" />
    </Icon>
  );
}

export function SettingsIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
    </Icon>
  );
}

export function EyeIcon() {
  return (
    <Icon>
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.5" />
    </Icon>
  );
}

export function EyeOffIcon() {
  return (
    <Icon>
      <path d="m3 3 18 18" />
      <path d="M10.6 6.2Q11.3 6 12 6c6 0 9.5 6 9.5 6a14 14 0 0 1-2.2 2.8M6.8 7.8A15 15 0 0 0 2.5 12s3.5 6 9.5 6q1.9 0 3.5-.8" />
      <path d="M10.2 10.2a2.5 2.5 0 0 0 3.6 3.6" />
    </Icon>
  );
}
