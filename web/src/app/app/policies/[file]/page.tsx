import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import shell from "../../app.module.css";
import styles from "./file.module.css";
import { PolicyBlocks } from "@/components/PolicyBlocks";
import { getPolicies, getPolicy } from "@/lib/policies";

type Params = { params: Promise<{ file: string }> };

export function generateStaticParams() {
  return getPolicies().map((f) => ({ file: f.num }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const f = getPolicy((await params).file);
  return { title: f ? `${f.num} ${f.title}` : "Policy" };
}

export default async function PolicyFilePage({ params }: Params) {
  const file = getPolicy((await params).file);
  if (!file) notFound();
  const all = getPolicies();
  const idx = all.findIndex((f) => f.num === file.num);
  const prev = all[idx - 1];
  const next = all[idx + 1];
  const citedBy = all.flatMap((f) => f.crossRefs.filter((r) => r.toFile === file.num && f.num !== file.num).map((r) => r.from));

  return (
    <div className={shell.page}>
      <p className={styles.crumb}>
        <Link href="/app/policies">Policies</Link> / <span className="mono">{file.fileName}</span>
      </p>
      <header className={shell.pageHead}>
        <h1>
          <span className={styles.num}>{file.num}</span> {file.title}
        </h1>
        <dl className={styles.front}>
          <div>
            <dt>Doc ID</dt>
            <dd>{file.docId}</dd>
          </div>
          <div>
            <dt>Version</dt>
            <dd>{file.version}</dd>
          </div>
          <div>
            <dt>Effective</dt>
            <dd>{file.effectiveDate}</dd>
          </div>
          <div>
            <dt>Last updated</dt>
            <dd>{file.lastUpdated}</dd>
          </div>
          <div>
            <dt>Scope</dt>
            <dd>{file.scope}</dd>
          </div>
        </dl>
      </header>

      <div className={styles.layout}>
        <div className={styles.body}>
          {file.intro.map((p, i) => (
            <p key={i} className={styles.intro}>
              {p}
            </p>
          ))}
          {file.sections.map((s) => (
            <section key={s.num} id={`s${s.num}`} className={styles.section}>
              <h2>
                {s.num}. {s.title}
              </h2>
              {s.items.map((it) => (
                <div key={it.id} id={`s${it.num}`} className={styles.item}>
                  <a href={`#s${it.num}`} className={styles.itemNum}>
                    {it.num}
                  </a>
                  <PolicyBlocks blocks={it.blocks} />
                </div>
              ))}
            </section>
          ))}
        </div>

        <aside className={styles.aside}>
          <h2>Sections</h2>
          <ol>
            {file.sections.map((s) => (
              <li key={s.num}>
                <a href={`#s${s.num}`}>
                  {s.num}. {s.title}
                </a>
              </li>
            ))}
          </ol>
          {citedBy.length > 0 && (
            <>
              <h2>Referenced from</h2>
              <ul className={styles.refs}>
                {[...new Set(citedBy)].map((id) => {
                  const [f, sec] = id.split("#");
                  return (
                    <li key={id}>
                      <Link href={`/app/policies/${f}#s${sec}`} className="mono">
                        {f} §{sec}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </aside>
      </div>

      <nav className={styles.pager} aria-label="Other files">
        {prev ? <Link href={`/app/policies/${prev.num}`}>{`${prev.num} ${prev.title}`}</Link> : <span />}
        {next && <Link href={`/app/policies/${next.num}`}>{`${next.num} ${next.title}`}</Link>}
      </nav>
    </div>
  );
}
