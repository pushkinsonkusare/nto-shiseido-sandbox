import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function BaseIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    />
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </BaseIcon>
  );
}

export function StoreIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M4 10V7.5L6 4h12l2 3.5V10" />
      <path d="M3 10h18" />
      <path d="M5 10v9h14v-9" />
      <path d="M9 19v-5h6v5" />
    </BaseIcon>
  );
}

export function UserIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c1.8-3 4.5-4.5 8-4.5s6.2 1.5 8 4.5" />
    </BaseIcon>
  );
}

export function ShoppingCartIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <circle cx="9" cy="20" r="1.5" />
      <circle cx="18" cy="20" r="1.5" />
      <path d="M3 4h2l2.2 10.2a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 2-1.6L21 7H7" />
    </BaseIcon>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="m9 18 6-6-6-6" />
    </BaseIcon>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="m6 9 6 6 6-6" />
    </BaseIcon>
  );
}

export function ChevronUpIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="m18 15-6-6-6 6" />
    </BaseIcon>
  );
}

export function TruckIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" />
      <path d="M15 18H9" />
      <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14" />
      <circle cx="17" cy="18" r="2" />
      <circle cx="7" cy="18" r="2" />
    </BaseIcon>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </BaseIcon>
  );
}

export function MinusIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M5 12h14" />
    </BaseIcon>
  );
}

export function DollarSignIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <line x1="12" x2="12" y1="2" y2="22" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </BaseIcon>
  );
}

export function LoaderCircleIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </BaseIcon>
  );
}

export function HistoryIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M3 12a9 9 0 1 0 9-9 9.74 9.74 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </BaseIcon>
  );
}

export function RefreshCcwIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M3 12a9 9 0 0 1 15.5-6.36L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15.5 6.36L3 16" />
      <path d="M3 21v-5h5" />
    </BaseIcon>
  );
}

export function PaperclipIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M21.44 11.05 12.25 20.24a6 6 0 1 1-8.49-8.49l9.19-9.19a4 4 0 1 1 5.66 5.66l-9.2 9.19a2 2 0 1 1-2.83-2.83l8.49-8.48" />
    </BaseIcon>
  );
}

export function AppleIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d="M16.365 1.43c0 1.14-.41 2.225-1.13 3.025-.78.86-2.05 1.52-3.07 1.43-.13-1.13.43-2.32 1.13-3.07.78-.84 2.13-1.46 3.07-1.385zM20.25 17.32c-.55 1.27-.81 1.84-1.51 2.96-.97 1.55-2.34 3.49-4.04 3.5-1.51.01-1.9-.99-3.95-.98-2.05.01-2.48.99-4 .98-1.7-.02-3-1.77-3.97-3.32C.07 16.06-.4 10.91 1.32 8.18c1.21-1.93 3.13-3.06 4.93-3.06 1.84 0 3 1.01 4.52 1.01 1.48 0 2.38-1.01 4.5-1.01 1.6 0 3.3.87 4.51 2.38-3.96 2.18-3.32 7.86.47 9.82z" />
    </svg>
  );
}

export function ChevronRightSlimIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M9 18l6-6-6-6" />
    </BaseIcon>
  );
}

export function BuildingIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M3 21h18" />
      <path d="M5 21V7l7-3 7 3v14" />
      <path d="M9 10h.01" />
      <path d="M12 10h.01" />
      <path d="M15 10h.01" />
      <path d="M9 14h.01" />
      <path d="M12 14h.01" />
      <path d="M15 14h.01" />
    </BaseIcon>
  );
}

export function HeartIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="m12 21-1.5-1.4C5.3 15 2 12 2 8.3 2 5.4 4.4 3 7.3 3c1.8 0 3.4.9 4.4 2.3C12.7 3.9 14.3 3 16.1 3 19 3 21.4 5.4 21.4 8.3c0 3.7-3.3 6.7-8.5 11.3z" />
    </BaseIcon>
  );
}

export function GlobeIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M2 12h20A10 10 0 1 1 12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 4-10" />
    </BaseIcon>
  );
}

export function BadgeHelpIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </BaseIcon>
  );
}

export function TableOfContentsIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M8 6h13" />
      <path d="M8 12h13" />
      <path d="M8 18h13" />
      <path d="M3 6h.01" />
      <path d="M3 12h.01" />
      <path d="M3 18h.01" />
    </BaseIcon>
  );
}

export function BookOpenIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M2.5 6.5A2.5 2.5 0 0 1 5 4h5a3 3 0 0 1 3 3v13a3 3 0 0 0-3-3H5a2.5 2.5 0 0 0-2.5 2.5z" />
      <path d="M21.5 6.5A2.5 2.5 0 0 0 19 4h-5a3 3 0 0 0-3 3v13a3 3 0 0 1 3-3h5a2.5 2.5 0 0 1 2.5 2.5z" />
    </BaseIcon>
  );
}

export function StarIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="m12 3 2.85 5.78 6.38.93-4.61 4.49 1.09 6.35L12 17.77l-5.71 3 1.09-6.35-4.61-4.49 6.38-.93Z" />
    </BaseIcon>
  );
}

export function MapPinIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M12 21s6-5.33 6-11a6 6 0 1 0-12 0c0 5.67 6 11 6 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </BaseIcon>
  );
}

export function WalletCardsIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <rect x="3" y="7" width="18" height="12" rx="2" />
      <path d="M3 10h18" />
      <path d="M7 4h10a2 2 0 0 1 2 2v1" />
    </BaseIcon>
  );
}

export function KeyRoundIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <circle cx="8" cy="15" r="4" />
      <path d="M12 15h9" />
      <path d="M18 15v3" />
      <path d="M15 15v2" />
    </BaseIcon>
  );
}

export function LogOutIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </BaseIcon>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </BaseIcon>
  );
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M19 12H5" />
      <path d="m11 18-6-6 6-6" />
    </BaseIcon>
  );
}

export function ArrowUpRightIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M7 7h10v10" />
      <path d="M7 17 17 7" />
    </BaseIcon>
  );
}

export function ExternalLinkIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
    </BaseIcon>
  );
}

export function EyeIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </BaseIcon>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </BaseIcon>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </BaseIcon>
  );
}

export function EllipsisVerticalIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <circle cx="12" cy="5" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="12" cy="19" r="1" />
    </BaseIcon>
  );
}

export function SendHorizontalIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="m3 3 3 9-3 9 19-9Z" />
      <path d="M6 12h13" />
    </BaseIcon>
  );
}

export function SparkleIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M6.62479 10.3342C6.56527 10.1034 6.44502 9.89289 6.27653 9.72441C6.10805 9.55592 5.8975 9.43567 5.66679 9.37615L1.57679 8.32148C1.50701 8.30168 1.4456 8.25965 1.40186 8.20178C1.35813 8.14391 1.33447 8.07335 1.33447 8.00082C1.33447 7.92828 1.35813 7.85772 1.40186 7.79985C1.4456 7.74198 1.50701 7.69996 1.57679 7.68015L5.66679 6.62482C5.89742 6.56535 6.10792 6.4452 6.27639 6.27684C6.44486 6.10849 6.56517 5.89808 6.62479 5.66748L7.67946 1.57748C7.69906 1.50743 7.74105 1.44571 7.799 1.40175C7.85696 1.35778 7.92771 1.33398 8.00046 1.33398C8.0732 1.33398 8.14395 1.35778 8.20191 1.40175C8.25987 1.44571 8.30185 1.50743 8.32146 1.57748L9.37546 5.66748C9.43497 5.8982 9.55523 6.10875 9.72371 6.27723C9.89219 6.44571 10.1027 6.56597 10.3335 6.62548L14.4235 7.67948C14.4938 7.69888 14.5558 7.74082 14.6 7.79887C14.6442 7.85691 14.6682 7.92786 14.6682 8.00082C14.6682 8.07378 14.6442 8.14472 14.6 8.20277C14.5558 8.26081 14.4938 8.30275 14.4235 8.32215L10.3335 9.37615C10.1027 9.43567 9.89219 9.55592 9.72371 9.72441C9.55523 9.89289 9.43497 10.1034 9.37546 10.3342L8.32079 14.4242C8.30118 14.4942 8.2592 14.5559 8.20124 14.5999C8.14328 14.6439 8.07254 14.6677 7.99979 14.6677C7.92704 14.6677 7.85629 14.6439 7.79834 14.5999C7.74038 14.5559 7.69839 14.4942 7.67879 14.4242L6.62479 10.3342Z" />
    </svg>
  );
}

export function MicIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
      <path d="M9 21h6" />
    </BaseIcon>
  );
}

export function CreditCardIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
      <path d="M6 15h3" />
    </BaseIcon>
  );
}

export function LockKeyholeIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 1 1 8 0v3" />
      <circle cx="12" cy="16" r="1" />
      <path d="M12 17v2" />
    </BaseIcon>
  );
}

export function InstagramIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <path d="M17.5 6.5h.01" />
    </BaseIcon>
  );
}

export function FacebookIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M14 8h3V4h-3a5 5 0 0 0-5 5v3H6v4h3v4h4v-4h3l1-4h-4V9a1 1 0 0 1 1-1Z" />
    </BaseIcon>
  );
}

export function YoutubeIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M21 8.5a2.5 2.5 0 0 0-1.76-1.78C17.6 6.25 12 6.25 12 6.25s-5.6 0-7.24.47A2.5 2.5 0 0 0 3 8.5 26.5 26.5 0 0 0 2.5 12c0 1.18.17 2.35.5 3.5a2.5 2.5 0 0 0 1.76 1.78c1.64.47 7.24.47 7.24.47s5.6 0 7.24-.47A2.5 2.5 0 0 0 21 15.5c.33-1.15.5-2.32.5-3.5s-.17-2.35-.5-3.5Z" />
      <path d="m10 9 5 3-5 3Z" />
    </BaseIcon>
  );
}
