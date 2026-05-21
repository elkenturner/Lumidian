'use client';

interface Props {
  filename: string;
  content: string;
  label: string;
}

export function CaptionDownloadButton({ filename, content, label }: Props) {
  function download() {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <button
      type="button"
      onClick={download}
      className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
    >
      Download {label}
    </button>
  );
}
