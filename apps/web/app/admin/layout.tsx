import type { ReactNode } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { Fira_Code, Fira_Sans } from "next/font/google";
import {
  IconArrowLeftOnRectangle,
  IconHome,
  IconLayoutGrid,
} from "@/app/admin/icons";

export const metadata: Metadata = {
  title: "Admin · Chat widget",
};

const firaSans = Fira_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-admin-sans",
  display: "swap",
});

const firaCode = Fira_Code({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-admin-mono",
  display: "swap",
});

const navLinkClass =
  "inline-flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors duration-200 motion-reduce:transition-none hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-2 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white dark:focus-visible:ring-offset-slate-950";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className={`${firaSans.variable} ${firaCode.variable} ${firaSans.className} min-h-full bg-slate-50 text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-100`}
    >
      <div className="mx-auto max-w-6xl px-4 pb-12 pt-4 sm:px-6">
        <header className="sticky top-4 z-30 mb-8 rounded-2xl border border-slate-200/90 bg-white/90 px-3 py-2 shadow-sm shadow-slate-900/5 backdrop-blur-md dark:border-slate-700/90 dark:bg-slate-900/90 dark:shadow-black/20 sm:px-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link
              href="/admin"
              className="inline-flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm font-semibold tracking-tight text-slate-900 transition-colors duration-200 motion-reduce:transition-none hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-2 dark:text-white dark:hover:text-blue-200 dark:focus-visible:ring-offset-slate-950"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-700 text-white dark:bg-blue-600">
                <IconLayoutGrid className="h-5 w-5" aria-hidden />
              </span>
              <span className="hidden sm:inline">Widget admin</span>
              <span className="sm:hidden">Admin</span>
            </Link>
            <nav
              className="flex flex-wrap items-center gap-1 sm:gap-2"
              aria-label="Admin navigation"
            >
              <Link href="/" className={navLinkClass}>
                <IconHome className="h-5 w-5 text-slate-500 dark:text-slate-400" />
                Home
              </Link>
              <Link href="/admin/login" className={navLinkClass}>
                <IconArrowLeftOnRectangle className="h-5 w-5 text-slate-500 dark:text-slate-400" />
                Sign in
              </Link>
            </nav>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
