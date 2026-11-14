"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "@/app/app/app.module.css";

const LINKS = [
  { href: "/app", label: "Ask", hint: "Answer a customer" },
  { href: "/app/policies", label: "Policies", hint: "22 files, by date" },
  { href: "/app/conflicts", label: "Conflicts", hint: "Where files disagree" },
  { href: "/app/evaluation", label: "Evaluation", hint: "Red-team results" },
];

export function AppNav() {
  const path = usePathname();
  return (
    <nav className={styles.nav} aria-label="Desk">
      {LINKS.map((l) => {
        const current = l.href === "/app" ? path === "/app" : path.startsWith(l.href);
        return (
          <Link key={l.href} href={l.href} className={styles.navLink} aria-current={current ? "page" : undefined}>
            <span>{l.label}</span>
            <span className={styles.navHint}>{l.hint}</span>
          </Link>
        );
      })}
    </nav>
  );
}
