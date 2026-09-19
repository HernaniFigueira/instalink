'use client';
// ═══════════════════════════════════════════════════════════════
// A3.4 · BLOCO 7 — TRAZER A BASE PARA DENTRO (painel de importação)
// ═══════════════════════════════════════════════════════════════
// Quem chega de outro sistema precisa colocar a base existente no ar. O fluxo
// tem DUAS etapas de propósito:
//
//   1. PRÉVIA — o arquivo é lido e o servidor diz linha por linha o que
//      aconteceria (novo, atualização, repetido, erro). A pessoa confere
//      antes de qualquer escrita;
//   2. CONFIRMAR — só então a base é gravada, com o mesmo planejador rodando
//      de novo dentro da transação (o arquivo não é fonte de verdade).
//
// O modelo para download usa as colunas que a importação entende — inclusive
// o formato de telefone com DDD.
import { useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/icons';
import { Badge, Button, Drawer, Notice } from '@/components/ui';
import { apiSend } from '@/lib/api-client';
import { IMPORT_MAX_CHARS, importTemplateCSV, type ImportPlan } from '@/lib/client-import';
import { cn } from '@/lib/utils';

type Result = { created: number; updated: number; skipped: number; errors: number; total: number };

const ACTION_LABEL: Record<string, string> = {
  create: 'Novo', update: 'Atualiza', skip: 'Repetido', error: 'Erro',
};
const ACTION_TONE: Record<string, 'green' | 'blue' | 'zinc' | 'red'> = {
  create: 'green', update: 'blue', skip: 'zinc', error: 'red',
};

export function ImportClientsSheet({ businessId, onClose, onImported }: {
  businessId: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [summary, setSummary] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  const pending = useMemo(() => (plan ? plan.create + plan.update : 0), [plan]);

  function download(text: string, name: string) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function pickFile(file: File) {
    setError(''); setResult(null); setPlan(null);
    if (file.size > IMPORT_MAX_CHARS) { setError('Arquivo grande demais (máximo ~2 MB). Divida em partes.'); return; }
    const text = await file.text();
    setFileName(file.name);
    setCsv(text);
    await preview(text);
  }

  async function preview(text = csv) {
    setBusy('preview'); setError(''); setResult(null);
    const res = await apiSend<{ plan: ImportPlan; summary: string }>(
      '/api/contacts/import', 'POST',
      { businessId, csv: text, mode: 'preview' },
      { scope: 'action', area: 'Clientes' },
    );
    setBusy('');
    if (!res.ok) { setError(res.message || 'Não foi possível ler o arquivo.'); return; }
    setPlan(res.data!.plan);
    setSummary(res.data!.summary);
  }

  async function commit() {
    setBusy('commit'); setError('');
    const res = await apiSend<{ result: Result; summary: string; plan: ImportPlan }>(
      '/api/contacts/import', 'POST',
      { businessId, csv, mode: 'commit' },
      { scope: 'action', area: 'Clientes' },
    );
    setBusy('');
    if (!res.ok) { setError(res.message || 'Não foi possível importar agora.'); return; }
    setResult(res.data!.result);
    setPlan(res.data!.plan);
    setSummary(res.data!.summary);
    onImported();
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title="Importar clientes"
      subtitle="Cole a planilha ou escolha o arquivo — nada é gravado antes de você conferir."
      width="max-w-[860px]"
      footer={(
        <>
          <Button variant="ghost" size="sm" onClick={() => download(importTemplateCSV(), 'modelo-clientes.csv')}>
            <Icon n="printer" size={13} /> Baixar modelo
          </Button>
          <Button variant="secondary" size="sm" onClick={() => { void preview(); }} disabled={!csv.trim() || !!busy}>
            {busy === 'preview' ? 'Lendo…' : 'Conferir (prévia)'}
          </Button>
          <Button variant="primary" size="sm" onClick={commit} disabled={!plan || pending === 0 || !!busy}>
            {busy === 'commit' ? 'Importando…' : `Importar ${pending} ${pending === 1 ? 'linha' : 'linhas'}`}
          </Button>
        </>
      )}
    >
      <div className="px-5 py-4 space-y-4">
        {error && <Notice tone="error">{error}</Notice>}
        {result && (
          <Notice tone="success" title="Base atualizada">
            {result.created} novo{result.created === 1 ? '' : 's'} · {result.updated} atualizado{result.updated === 1 ? '' : 's'}
            {result.skipped > 0 ? ` · ${result.skipped} repetido${result.skipped === 1 ? '' : 's'} (ignorados)` : ''}
            {result.errors > 0 ? ` · ${result.errors} com erro (não entraram)` : ''}.
          </Notice>
        )}

        <div className="space-y-2">
          <p className="text-sm text-[var(--text-muted)]">
            O arquivo precisa de um cabeçalho com <strong className="text-[var(--text)]">Nome</strong> e
            {' '}<strong className="text-[var(--text)]">Telefone</strong> ou <strong className="text-[var(--text)]">E-mail</strong>.
            Também entendo CPF, nascimento, CEP, cidade, UF, consentimento de marketing e observação.
            Separador <code>,</code> <code>;</code> ou TAB (o Excel em português exporta com <code>;</code>).
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef} type="file" accept=".csv,text/csv,text/plain" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void pickFile(f); e.target.value = ''; }}
            />
            <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>
              <Icon n="upload" size={14} /> Escolher arquivo CSV
            </Button>
            {fileName && <span className="text-xs text-[var(--text-muted)]">{fileName}</span>}
            <span className="text-xs text-[var(--text-faint)]">ou cole abaixo</span>
          </div>
          <textarea
            value={csv}
            onChange={(e) => { setCsv(e.target.value); setPlan(null); setResult(null); }}
            rows={6}
            placeholder={'Nome;Telefone;E-mail\nMaria Souza;(21) 98888-7777;maria@exemplo.com'}
            aria-label="Conteúdo do CSV"
            className="w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-xs font-mono text-[var(--text)] focus:outline-none focus:shadow-focus"
          />
        </div>

        {plan && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-[var(--text)]">Prévia</span>
              <span className="text-xs text-[var(--text-muted)]">{summary}</span>
              {plan.create > 0 && <Badge tone="green">{plan.create} novos</Badge>}
              {plan.update > 0 && <Badge tone="blue">{plan.update} atualizam</Badge>}
              {plan.skip > 0 && <Badge tone="zinc">{plan.skip} repetidos</Badge>}
              {plan.error > 0 && <Badge tone="red">{plan.error} com erro</Badge>}
            </div>

            {plan.unknownColumns.length > 0 && (
              <p className="text-xs text-[var(--text-muted)] bg-[var(--surface-3)] border border-[var(--border)] rounded-md px-3 py-2">
                Colunas que não reconheci (ficaram de fora): {plan.unknownColumns.join(', ')}.
              </p>
            )}

            <div className="border border-[var(--border)] rounded-md overflow-hidden">
              <div className="max-h-[360px] overflow-auto">
                <table className="w-full text-xs">
                  <thead className="bg-[var(--surface-2)] sticky top-0">
                    <tr className="text-left text-[var(--text-muted)]">
                      <th className="px-2 py-1.5 font-semibold">Linha</th>
                      <th className="px-2 py-1.5 font-semibold">Situação</th>
                      <th className="px-2 py-1.5 font-semibold">Nome</th>
                      <th className="px-2 py-1.5 font-semibold">Telefone</th>
                      <th className="px-2 py-1.5 font-semibold">E-mail</th>
                      <th className="px-2 py-1.5 font-semibold">O que vai acontecer</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-soft)]">
                    {plan.rows.map((row) => (
                      <tr key={`${row.line}-${row.action}`}
                        className={cn(row.action === 'error' && 'bg-[var(--danger-bg)]', row.action === 'skip' && 'opacity-60')}>
                        <td className="px-2 py-1.5 tabular-nums text-[var(--text-faint)]">{row.line}</td>
                        <td className="px-2 py-1.5"><Badge tone={ACTION_TONE[row.action]}>{ACTION_LABEL[row.action]}</Badge></td>
                        <td className="px-2 py-1.5 text-[var(--text)] font-semibold">{row.name || '—'}</td>
                        <td className="px-2 py-1.5 text-[var(--text-muted)] tabular-nums">{row.phone || '—'}</td>
                        <td className="px-2 py-1.5 text-[var(--text-muted)]">{row.email || '—'}</td>
                        <td className="px-2 py-1.5 text-[var(--text-muted)]">{row.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="text-xs text-[var(--text-muted)]">
              Linhas com erro não entram (dado torto não vira cadastro). Repetidas no arquivo contam uma vez.
              Quem já está na base é <strong className="text-[var(--text)]">atualizado</strong> — ninguém é duplicado.
            </p>
          </div>
        )}
      </div>
    </Drawer>
  );
}
