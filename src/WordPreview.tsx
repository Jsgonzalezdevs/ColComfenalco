import { useEffect, useRef, useState } from 'react';

/** Render an original DOCX as paginated browser content instead of extracted text. */
export default function WordPreview({ blob, label }: { blob: Blob; label: string }) {
  const body = useRef<HTMLDivElement>(null);
  const styles = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    const bodyElement = body.current;
    const styleElement = styles.current;
    if (!bodyElement || !styleElement) return;

    void import('docx-preview').then(({ renderAsync }) => renderAsync(blob, bodyElement, styleElement, {
      className: 'word-page',
      inWrapper: true,
      breakPages: true,
      ignoreLastRenderedPageBreak: false,
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
      renderEndnotes: true,
      useBase64URL: true,
    })).then(() => {
      if (active) setReady(true);
    }).catch(() => {
      if (active) setError('No se pudo mostrar este archivo Word. Puedes descargar el documento original para revisarlo.');
    });

    return () => {
      active = false;
      bodyElement.replaceChildren();
      styleElement.replaceChildren();
    };
  }, [blob]);

  return <div className="word-preview" aria-label={`Vista previa de Word: ${label}`}>
    {!ready && !error && <p className="word-preview-status" role="status">Preparando vista del documento…</p>}
    {error && <p className="word-preview-error" role="alert">{error}</p>}
    <div ref={styles} className="word-preview-styles" />
    <div ref={body} className="word-preview-pages" />
  </div>;
}
