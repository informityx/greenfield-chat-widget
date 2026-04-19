import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { title?: string };

function wrap(props: IconProps, paths: ReactNode) {
  const { title, className, children: _children, ...rest } = props;
  void _children;
  return (
    <svg
      aria-hidden={title ? undefined : true}
      role={title ? "img" : "presentation"}
      className={className ?? "h-5 w-5 shrink-0"}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {paths}
    </svg>
  );
}

export function IconLayoutGrid(props: IconProps) {
  return wrap(
    props,
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>,
  );
}

export function IconHome(props: IconProps) {
  return wrap(
    props,
    <path d="M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-10.5Z" />,
  );
}

export function IconKey(props: IconProps) {
  return wrap(
    props,
    <>
      <path d="M15.75 5.25a3 3 0 1 1-3 3m3-3 .008-.008" />
      <path d="M4.5 19.5 10.5 13l1.5 1.5 2.25-2.25 1.5 1.5L19.5 9" />
    </>,
  );
}

export function IconArrowRightOnRectangle(props: IconProps) {
  return wrap(
    props,
    <>
      <path d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15" />
      <path d="M18 12H9m6.75-3 3 3-3 3" />
    </>,
  );
}

export function IconArrowLeftOnRectangle(props: IconProps) {
  return wrap(
    props,
    <>
      <path d="M8.25 9V5.25A2.25 2.25 0 0 1 10.5 3h6a2.25 2.25 0 0 1 2.25 2.25v13.5A2.25 2.25 0 0 1 16.5 21h-6a2.25 2.25 0 0 1-2.25-2.25V15" />
      <path d="M6 12h9m-6.75-3-3 3 3 3" />
    </>,
  );
}

export function IconClipboard(props: IconProps) {
  return wrap(
    props,
    <>
      <path d="M9 5.25H7.5a1.5 1.5 0 0 0-1.5 1.5v12a1.5 1.5 0 0 0 1.5 1.5h9a1.5 1.5 0 0 0 1.5-1.5v-12a1.5 1.5 0 0 0-1.5-1.5H15" />
      <path d="M9 5.25A2.25 2.25 0 0 1 11.25 3h1.5A2.25 2.25 0 0 1 15 5.25v.75H9v-.75Z" />
    </>,
  );
}

export function IconPlay(props: IconProps) {
  return wrap(
    props,
    <path d="M10 7.5 17.25 12 10 16.5v-9Z" />,
  );
}

export function IconTable(props: IconProps) {
  return wrap(
    props,
    <>
      <path d="M4.5 6.75h15v10.5h-15V6.75Z" />
      <path d="M4.5 12h15M12 6.75v10.5" />
    </>,
  );
}

export function IconPlusCircle(props: IconProps) {
  return wrap(
    props,
    <>
      <path d="M12 8.25v7.5M8.25 12h7.5" />
      <path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </>,
  );
}

export function IconCodeBracket(props: IconProps) {
  return wrap(
    props,
    <path d="M14.25 9.75 16.5 12l-2.25 2.25m-4.5-4.5L7.5 12l2.25 2.25M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />,
  );
}

export function IconInbox(props: IconProps) {
  return wrap(
    props,
    <>
      <path d="M2.25 13.5h3m16.5 0h3M9 3h.008v.008H9V3Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm3.75 0H15a2.25 2.25 0 0 1 2.25 2.25V9a2.25 2.25 0 0 0 2.25 2.25H21M3.75 9H6A2.25 2.25 0 0 0 8.25 6.75V5.25A2.25 2.25 0 0 1 10.5 3h3" />
      <path d="M3.75 13.5v3A2.25 2.25 0 0 0 6 18.75h12a2.25 2.25 0 0 0 2.25-2.25v-3M3.75 13.5 6 9h12l2.25 4.5" />
    </>,
  );
}
