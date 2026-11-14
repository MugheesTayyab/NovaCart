import type { Metadata } from "next";
import styles from "../app.module.css";
import { PolicyBrowser } from "@/components/app/PolicyBrowser";
import { fileMetas, getPolicies } from "@/lib/policies";

export const metadata: Metadata = { title: "Policies" };

export default function PoliciesPage() {
  const itemCounts = Object.fromEntries(getPolicies().map((f) => [f.num, f.itemCount]));
  return (
    <div className={styles.page}>
      <header className={styles.pageHead}>
        <h1>Policies</h1>
        <p>
          The 22 NovaCart policy files, read directly from the repository. Change the contact date to see which files a
          question on that day would be answered from.
        </p>
      </header>
      <PolicyBrowser files={fileMetas()} itemCounts={itemCounts} />
    </div>
  );
}
