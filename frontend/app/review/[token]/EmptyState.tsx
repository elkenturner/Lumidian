interface Props {
  message: string;
}

export function EmptyState({ message }: Props) {
  return (
    <div style={{
      textAlign: 'center',
      color: 'var(--ink-mute)',
      fontSize: 14,
      padding: '64px 0',
      fontStyle: 'italic',
      fontFamily: 'var(--font-instrument), Georgia, serif',
    }}>
      {message}
    </div>
  );
}
