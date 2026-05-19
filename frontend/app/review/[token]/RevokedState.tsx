import styles from './styles.module.css';

export function RevokedState() {
  return (
    <div className={styles.shell}>
      <div className={styles.header}>
        <div className={styles.lockup}>
          <img src="/logo.png" alt="Lumidian" />
          <span className="wordmark" style={{ fontFamily: 'var(--font-instrument), Georgia, serif', fontSize: 16, color: 'var(--ink)' }}>Lumidian</span>
        </div>
      </div>
      <div className={styles.content}>
        <div className={styles.hero}>
          <div className={styles.tracker}>REVIEW LINK</div>
          <h1 className={styles.headline}>This link is no longer active.</h1>
          <p className={styles.headlineSub}>Please contact your Lumidian point of contact for a new link.</p>
        </div>
      </div>
    </div>
  );
}
