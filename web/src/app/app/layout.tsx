import Link from "next/link";
import type { Metadata } from "next";
import styles from "./app.module.css";
import { AppNav } from "@/components/app/AppNav";
import { API_URL } from "@/lib/site";

export const metadata: Metadata = { title: "Desk" };

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.shell}>
      <aside className={styles.side}>
        <Link href="/" className={styles.brand}>
          <span className={styles.mark} aria-hidden="true" />
          Policy Desk
        </Link>
        <AppNav />
        <div className={styles.conn}>
          {API_URL ? (
            <>
              <p className={styles.connTitle}>Answer service</p>
              <p className="mono">{API_URL.replace(/^https?:\/\//, "")}</p>
            </>
          ) : (
            <>
              <p className={styles.connTitle}>Preview mode</p>
              <p>The answer service is not connected. The four sample questions have hand-checked answers.</p>
            </>
          )}
        </div>
      </aside>
      <div className={styles.main}>{children}</div>
    </div>
  );
}
