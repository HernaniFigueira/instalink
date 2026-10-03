'use client';
import { useRef, useState } from 'react';
import { buttonCls } from '@/components/ui';
import { Icon } from '@/components/icons';

// Upload reutilizável de imagem (Vercel Blob). Mantém compatibilidade com
// URLs antigas (o valor salvo continua sendo uma string com a URL final).
// Uso: <ImageUpload label="LOGO" value={...} onChange={(url) => ...} businessId={...} />
export function ImageUpload({ label, value, onChange, businessId, circle = false, previewH = 'h-28' }: {
  label: string;
  value: string;
  onChange: (url: string) => void;
  businessId: string;
  circle?: boolean;
  previewH?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [showUrl, setShowUrl] = useState(false);
  const [urlDraft, setUrlDraft] = useState(value || '');

  async function handleFile(file: File) {
    setError('');
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('businessId', businessId);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha no upload.');
      onChange(data.url);
      setUrlDraft(data.url);
    } catch (e: any) {
      setError(e.message || 'Falha no upload.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <span className="text-xs font-semibold text-zinc-500">{label}</span>
      <div className="mt-1.5 flex items-start gap-3">
        <div
          className={`${circle ? 'w-16 h-16 rounded-full' : `w-20 ${previewH}`} shrink-0 overflow-hidden border border-zinc-200 bg-zinc-50 flex items-center justify-center`}
        >
          {value ? (
            <img src={value} alt="" className="w-full h-full object-cover" />
          ) : (
            <Icon n="image" size={22} className="text-zinc-300" />
          )}
        </div>
        <div className="flex-1 min-w-0 space-y-1.5">
          <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading}
              className={buttonCls('secondary', 'sm')}>
              {uploading ? 'Enviando…' : value ? 'Alterar' : 'Adicionar imagem'}
            </button>
            {value && (
              <button type="button" onClick={() => { onChange(''); setUrlDraft(''); }}
                className={buttonCls('destructive', 'sm')}>
                Remover
              </button>
            )}
            <button type="button" onClick={() => setShowUrl((s) => !s)}
              className={buttonCls('secondary', 'sm')}>
              Usar URL
            </button>
          </div>
          {showUrl && (
            <div className="flex gap-1.5">
              <input value={urlDraft} onChange={(e) => setUrlDraft(e.target.value)}
                placeholder="https://… (para imagens já hospedadas)"
                className="flex-1 min-w-0 rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs" />
              <button type="button" onClick={() => onChange(urlDraft.trim())}
                className={buttonCls('secondary', 'sm')}>
                Aplicar
              </button>
            </div>
          )}
          {error && <p className="text-[11px] font-semibold text-red-600">{error}</p>}
          <p className="text-[11px] text-zinc-400">JPG, PNG, WebP ou GIF · até 5 MB.</p>
        </div>
      </div>
    </div>
  );
}
