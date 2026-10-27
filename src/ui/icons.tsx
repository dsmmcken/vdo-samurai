// Small inline icons (24px grid, currentColor).
type P = { size?: number; title?: string; className?: string };
const svg = (d: React.ReactNode) =>
  function Icon({ size = 18, title, className }: P) {
    return (
      <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
        {title && <title>{title}</title>}
        {d}
      </svg>
    );
  };

export const Crown = svg(<path d="M3 7.5l4.6 3.9L12 4l4.4 7.4L21 7.5 19.2 17H4.8L3 7.5zM5 18.5h14V20H5z" />);
export const Screen = svg(<path d="M3 4h18a1 1 0 011 1v11a1 1 0 01-1 1h-7v2h3v1.5H7V19h3v-2H3a1 1 0 01-1-1V5a1 1 0 011-1zm1 2v9h16V6H4z" />);
export const Mic = svg(<path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z" />);
export const MicOff = svg(<path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z" />);
export const Grid = svg(<path d="M3 3h8v8H3V3zm10 0h8v8h-8V3zM3 13h8v8H3v-8zm10 0h8v8h-8v-8z" />);
export const Copy = svg(<path d="M8 3h11a2 2 0 012 2v11h-2V5H8V3zM4 7h11a2 2 0 012 2v11a2 2 0 01-2 2H4a2 2 0 01-2-2V9a2 2 0 012-2zm0 2v11h11V9H4z" />);
export const Pencil = svg(<path d="M15.6 3.6a2 2 0 012.8 0l2 2a2 2 0 010 2.8L9 19.8 3 21l1.2-6L15.6 3.6zM5.9 15.8l-.5 2.8 2.8-.5L17.6 8.7 15.3 6.4 5.9 15.8z" />);
export const Dot = svg(<circle cx="12" cy="12" r="6" />);
export const Square = svg(<rect x="6" y="6" width="12" height="12" rx="2" />);
export const User = svg(<path d="M12 3a4.5 4.5 0 110 9 4.5 4.5 0 010-9zm0 10.5c4.4 0 8 2.2 8 5V21H4v-2.5c0-2.8 3.6-5 8-5z" />);
export const Close = svg(<path d="M6.4 5L12 10.6 17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4z" />);
export const More = svg(<path d="M5 10.25a1.75 1.75 0 110 3.5 1.75 1.75 0 010-3.5zm7 0a1.75 1.75 0 110 3.5 1.75 1.75 0 010-3.5zm7 0a1.75 1.75 0 110 3.5 1.75 1.75 0 010-3.5z" />);
export const Leave = svg(<path d="M10 4H5a1 1 0 00-1 1v14a1 1 0 001 1h5v-2H6V6h4V4zm5.6 3.4L14.2 8.8 16.4 11H9v2h7.4l-2.2 2.2 1.4 1.4L20.2 12l-4.6-4.6z" />);
export const Eye = svg(<path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />);
export const EyeOff = svg(<path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z" />);
export const Info = svg(<path d="M12 2a10 10 0 110 20 10 10 0 010-20zm0 2a8 8 0 100 16 8 8 0 000-16zm1 6v7h-2v-7h2zm0-3v2h-2V7h2z" />);
