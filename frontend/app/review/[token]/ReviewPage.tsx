'use client';

import { useState } from 'react';
import type { ReviewClientPage, PublicDocumentSummary } from '@/lib/api';
import { DraftCard } from './DraftCard';
import { DocumentCard } from './DocumentCard';
import { DocumentReader } from './DocumentReader';
import { EmptyState } from './EmptyState';
import styles from './styles.module.css';

interface DraftRowState {
  status: 'pending' | 'approved' | 'changes_requested' | 'rejected';
  reviewedAt?: Date;
}

interface Props {
  token: string;
  initial: ReviewClientPage;
  initialDocuments: PublicDocumentSummary[];
}

export function ReviewPage({ token, initial, initialDocuments }: Props) {
  const [draftStates, setDraftStates] = useState<Record<number, DraftRowState>>(
    Object.fromEntries(initial.drafts.map((d) => [d.id, { status: 'pending' as const }])),
  );
  const [openDocId, setOpenDocId] = useState<number | null>(null);

  const pendingDrafts = initial.drafts.filter((d) => draftStates[d.id]?.status === 'pending');
  const handledDrafts = initial.drafts.filter((d) => draftStates[d.id]?.status !== 'pending');

  const pendingCount = pendingDrafts.length;
  const headline =
    pendingCount === 1
      ? '1 draft ready for your review.'
      : pendingCount > 1
        ? `${pendingCount} drafts ready for your review.`
        : initialDocuments.length > 0
          ? 'Your Lumidian library.'
          : 'Nothing waiting for you right now.';

  const subhead = pendingCount > 0
    ? 'Approve, request changes, or reject each draft. We see your decision instantly.'
    : initialDocuments.length > 0
      ? `Every report Lumidian has published for ${initial.client_name}.`
      : 'Lumidian will email you when there’s something to review.';

  const openDoc = initialDocuments.find((d) => d.id === openDocId) ?? null;

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.lockup}>
          <img src="/logo.png" alt="Lumidian" />
          <span className="wordmark" style={{ fontFamily: 'var(--font-instrument), Georgia, serif', fontSize: 16, color: 'var(--ink)' }}>Lumidian</span>
        </div>
        <div className={styles.secureBadge}>Secure review link</div>
      </header>

      <main className={styles.content}>
        <section className={styles.hero}>
          <div className={styles.tracker}>LUMIDIAN × {initial.client_name.toUpperCase()}</div>
          <h1 className={styles.headline}>{headline}</h1>
          <p className={styles.headlineSub}>{subhead}</p>
        </section>

        {initial.drafts.length > 0 && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Drafts</h2>
            {pendingDrafts.length === 0 && handledDrafts.length === 0 ? (
              <EmptyState message="No drafts waiting." />
            ) : (
              <>
                {pendingDrafts.map((d) => (
                  <DraftCard
                    key={d.id}
                    draft={d}
                    token={token}
                    onResolved={(status) =>
                      setDraftStates((prev) => ({ ...prev, [d.id]: { status, reviewedAt: new Date() } }))
                    }
                  />
                ))}
                {handledDrafts.map((d) => {
                  const st = draftStates[d.id];
                  return (
                    <DraftCard
                      key={d.id}
                      draft={d}
                      token={token}
                      resolvedStatus={st.status as Exclude<DraftRowState['status'], 'pending'>}
                      resolvedAt={st.reviewedAt}
                      onResolved={() => {}}
                    />
                  );
                })}
              </>
            )}
          </section>
        )}

        {initialDocuments.length > 0 && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Documents</h2>
            {initialDocuments.map((doc) => (
              <DocumentCard
                key={doc.id}
                doc={doc}
                token={token}
                onOpen={() => setOpenDocId(doc.id)}
              />
            ))}
          </section>
        )}

        {initial.drafts.length === 0 && initialDocuments.length === 0 && (
          <EmptyState message="Nothing here yet." />
        )}
      </main>

      <footer className={styles.footer}>
        Powered by <a href="https://lumidian.com" target="_blank" rel="noreferrer">Lumidian</a>
      </footer>

      {openDoc && (
        <DocumentReader
          token={token}
          doc={openDoc}
          onClose={() => setOpenDocId(null)}
        />
      )}
    </div>
  );
}
