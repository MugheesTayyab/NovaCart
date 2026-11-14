import Link from "next/link";
import styles from "./marketing.module.css";

import { REPO_URL } from "@/lib/site";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.site}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}>
          <span className={styles.mark} aria-hidden="true" />
          Policy Desk
        </Link>
        <nav className={styles.nav} aria-label="Sections">
          <a href="#answer">An answer</a>
          <a href="#limits">When files are silent</a>
          <a href="#decides">How it decides</a>
          <a href="#policies">Policy set</a>
        </nav>
        <Link href="/app" className={styles.cta}>
          Open the desk
        </Link>
      </header>
      <main>{children}</main>
      <footer className={styles.footer}>
        <p>
          Built at Tech Fusion &apos;26, Bahria University Islamabad, for Challenge A. NovaCart is a fictional store and
          its policies were written by the organizers.
        </p>
        <div className={styles.footerLinks}>
          <a href={REPO_URL}>Source on GitHub</a>
          <Link href="/app">Open the desk</Link>
        </div>
      </footer>
    </div>
  );
}
