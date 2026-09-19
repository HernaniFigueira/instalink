'use client';
// ═══════════════════════════════════════════════════════════════
// A3.4 · BLOCO 7 — TRAZER A BASE PARA DENTRO (painel de importação)
// ═══════════════════════════════════════════════════════════════
// O fluxo tem as etapas do produto, e a ordem importa:
//
//   1. ARQUIVO   — CSV (colar ou escolher) ou planilha .xlsx;
//   2. PRÉVIA     — o servidor lê e mostra, linha por linha, o que aconteceria;
//   3. MAPEAMENTO — só aparece quando alguma coluna não foi reconhecida; o
//      usuário escolhe no dropdown e a prévia é recalculada;
//   4. MODO       — "Manter cadastros existentes" (padrão) ou "Preencher
//      somente dados que estiverem vazios";
//   5. IMPORTAR   — só aqui se escreve. No fim, o resultado e, se houver
//      linhas com erro, o download do relatório.
//
// Nada é gravado antes da confirmação, e a tela diz o que vai acontecer com
// quem já existe — sem prometer "atualização" que o modo não faz.
import { useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/icons';
import { Badge, Button, Drawer, Field, Notice, Select } from '@/components/ui';
import { apiSend } from '@/lib/api-client';
import {
  EXISTING_MODE_LABELS, IMPORT_FIELD_LABELS, IMPORT_MAX_CHARS, errorReportCSV, importTemplateCSV,
  type ExistingMode, type ImportColumn, type ImportField, type ImportPlan,
} from '@/lib/client-import';
import { cn } from '@/lib/utils';

type Result = { created: number; filled: number; notes: number; skipped: number; errors: number; total: number };

const ACTION_LABEL: Record<string, string> = {
  create: 'Novo', fill: 'Complementa', skip: 'Não altera', error: 'Erro',
};
const ACTION_TONE: Record<string, 'green' | 'blue' | 'zinc' | 'red'> = {
  create: 'green', fill: 'blue', skip: 'zinc', error: 'red',
};

const XLSX_EXT = /\.xlsx$/i;

export function ImportClientsSheet({ businessId, onClose, onImported }: {
  businessId: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const [csv, setCsv] = useState('');
  const [file, setFile] = useState<{ name: string; base64: string } | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [columns, setColumns] = useState<ImportColumn[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [existingMode, setExistingMode] = useState<ExistingMode>('skip');
  const [summary, setSummary] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  const source = useMemo(
    () => (file ? { fileBase64: file.base64, fileName: file.name } : { csv, fileName: '' }),
    [file, csv],
  );
  const pending = useMemo(() => (plan ? plan.create + plan.fill : 0), [plan]);
  const failedRows = useMemo(() => (plan ? plan.rows.filter((r) => r.action === 'error') : []), [plan]);
  // Colunas de histórico do nosso próprio export são reconhecidas e ignoradas
  // de propósito — não pedem mapeamento (elas não voltam na importação).
  const unmappedColumns = useMemo(
    () => columns.filter((c) => !c.detected && !c.exportOnly),
    [columns],
  );
  const needsMapping = unmappedColumns.length > 0;

  /** Monta o mapeamento do formulário para o formato do servidor. */
  function mappingPayload() {
    const out: Record<string, number> = {};
    for (const [field, value] of Object.entries(mapping)) {
      if (!value || value === 'ignore') continue;
      out[field] = Number(value);
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }

  function download(text: string, name: string) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function preview(overrides: { mapping?: Record<string, string> } = {}) {
    const localMapping = overrides.mapping ?? mapping;
    const payload = Object.fromEntries(
      Object.entries(localMapping).filter(([, v]) => v && v !== 'ignore').map(([k, v]) => [k, Number(v)]),
    );
    setBusy('preview'); setError(''); setResult(null);
    const res = await apiSend<{ plan: ImportPlan; summary: string }>(
      '/api/contacts/import', 'POST',
      {
        businessId, ...source, mode: 'preview', existingMode,
        mapping: Object.keys(payload).length > 0 ? payload : undefined,
      },
      { scope: 'action', area: 'Clientes' },
    );
    setBusy('');
    if (!res.ok) {
      // Mesmo quando o cabeçalho não é reconhecido, o servidor devolve as
      // colunas: a tela monta o mapeamento e a pessoa resolve aqui mesmo.
      const cols = (res.data as any)?.columns as ImportColumn[] | undefined;
      if (cols?.length) {
        setColumns(cols);
        setMapping((m) => Object.keys(m).length > 0 ? m : {});
      }
      setError(res.message || 'Não foi possível ler o arquivo.');
      return false;
    }
    setPlan(res.data!.plan);
    setColumns(res.data!.plan.columns);
    setSummary(res.data!.summary);
    if (Object.keys(localMapping).length === 0) {
      // Semeia o mapeamento com o que foi detectado, para os dropdowns abrirem
      // já mostrando a leitura atual do arquivo.
      const seeded: Record<string, string> = {};
      for (const [field, idx] of Object.entries(res.data!.plan.mapped)) seeded[field] = String(idx);
      setMapping(seeded);
    }
    return true;
  }

  async function pickFile(f: File) {
    setError(''); setResult(null); setPlan(null); setColumns([]); setMapping({});
    if (XLSX_EXT.test(f.name)) {
      if (f.size > IMPORT_MAX_CHARS * 2) { setError('Planilha grande demais. Divida em partes.'); return; }
      const buf = await f.arrayBuffer();
      let binary = '';
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const base64 = btoa(binary);
      setFile({ name: f.name, base64 });
      setCsv('');
      await previewWith({ fileBase64: base64, fileName: f.name });
      return;
    }
    if (f.size > IMPORT_MAX_CHARS) { setError('Arquivo grande demais (máximo ~2 MB). Divida em partes.'); return; }
    const text = await f.text();
    setFile(null);
    setCsv(text);
    await previewWith({ csv: text, fileName: f.name });
  }

  /** Prévia usando uma fonte explícita (o estado do React ainda não atualizou). */
  async function previewWith(src: { csv?: string; fileBase64?: string; fileName?: string }) {
    setBusy('preview'); setError(''); setResult(null);
    const res = await apiSend<{ plan: ImportPlan; summary: string }>(
      '/api/contacts/import', 'POST',
      { businessId, ...src, mode: 'preview', existingMode },
      { scope: 'action', area: 'Clientes' },
    );
    setBusy('');
    if (!res.ok) {
      const cols = (res.data as any)?.columns as ImportColumn[] | undefined;
      if (cols?.length) setColumns(cols);
      setError(res.message || 'Não foi possível ler o arquivo.');
      return;
    }
    setPlan(res.data!.plan);
    setColumns(res.data!.plan.columns);
    setSummary(res.data!.summary);
    const seeded: Record<string, string> = {};
    for (const [field, idx] of Object.entries(res.data!.plan.mapped)) seeded[field] = String(idx);
    setMapping(seeded);
  }

  async function commit() {
    setBusy('commit'); setError('');
    const res = await apiSend<{ result: Result; summary: string; plan: ImportPlan }>(
      '/api/contacts/import', 'POST',
      { businessId, ...source, mode: 'commit', existingMode, mapping: mappingPayload() },
      { scope: 'action', area: 'Clientes' },
    );
    setBusy('');
    if (!res.ok) { setError(res.message || 'Não foi possível importar agora.'); return; }
    setResult(res.data!.result);
    setPlan(res.data!.plan);
    setSummary(res.data!.summary);
    onImported();
  }

  /** Campos que o usuário pode escolher no mapeamento. */
  const fields = Object.keys(IMPORT_FIELD_LABELS) as ImportField[];
  const ignore = 'ignore';

  return (
    <Drawer
      open
      onClose={onClose}
      title="Importar clientes"
      subtitle="CSV ou planilha .xlsx — nada é gravado antes de você conferir."
      width="max-w-[920px]"
      footer={(
        <>
          <Button variant="ghost" size="sm" onClick={() => download(importTemplateCSV(), 'modelo-clientes.csv')}>
            <Icon n="printer" size={13} /> Baixar modelo
          </Button>
          {plan && failedRows.length > 0 && (
            <Button variant="secondary" size="sm"
              onClick={() => download(errorReportCSV(plan.rows), 'erros-importacao.csv')}>
              <Icon n="download" size={13} /> Baixar relatório de erros ({failedRows.length})
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => { void preview(); }} disabled={(!csv.trim() && !file) || !!busy}>
            {busy === 'preview' ? 'Lendo…' : 'Atualizar prévia'}
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
            {result.created} novo{result.created === 1 ? '' : 's'}
            {result.filled > 0 ? ` · ${result.filled} complementado${result.filled === 1 ? '' : 's'}` : ''}
            {result.notes > 0 ? ` · ${result.notes} observação${result.notes === 1 ? '' : 'ões'} no histórico` : ''}
            {result.skipped > 0 ? ` · ${result.skipped} mantido${result.skipped === 1 ? '' : 's'} sem alteração` : ''}
            {result.errors > 0 ? ` · ${result.errors} com erro (não entraram)` : ''}.
          </Notice>
        )}

        {/* ── 1. Arquivo ── */}
        <div className="space-y-2">
          <p className="text-sm text-[var(--text-muted)]">
            Aceito <strong className="text-[var(--text)]">CSV</strong> (separador <code>,</code> <code>;</code> ou TAB) e
            {' '}<strong className="text-[var(--text)]">planilha .xlsx</strong> (a primeira aba).
            O cabeçalho precisa ter <strong className="text-[var(--text)]">Nome</strong> e
            {' '}<strong className="text-[var(--text)]">Telefone</strong> ou <strong className="text-[var(--text)]">E-mail</strong>;
            também entendo CPF, nascimento, endereço, tags, responsável e observação.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef} type="file" accept=".csv,.xlsx,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void pickFile(f); e.target.value = ''; }}
            />
            <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>
              <Icon n="upload" size={14} /> Escolher arquivo
            </Button>
            {(file?.name || csv) && (
              <span className="text-xs text-[var(--text-muted)]">
                {file ? file.name : `CSV colado (${csv.split('\n').length} linhas)`}
              </span>
            )}
            <span className="text-xs text-[var(--text-faint)]">ou cole o CSV abaixo</span>
          </div>
          <textarea
            value={csv}
            onChange={(e) => { setCsv(e.target.value); setFile(null); setPlan(null); setResult(null); }}
            rows={5}
            placeholder={'Nome;Telefone;E-mail\nMaria Souza;(21) 98888-7777;maria@exemplo.com'}
            aria-label="Conteúdo do CSV"
            className="w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-xs font-mono text-[var(--text)] focus:outline-none focus:shadow-focus"
          />
        </div>

        {/* ── 3. Mapeamento (aparece quando há coluna não reconhecida) ── */}
        {columns.length > 0 && needsMapping && (
          <div className="space-y-2 border border-[var(--border)] rounded-md p-3 bg-[var(--surface-2)]">
            <p className="text-sm font-semibold text-[var(--text)]">Mapeamento das colunas</p>
            <p className="text-xs text-[var(--text-muted)]">
              Não reconheci {unmappedColumns.length} coluna(s). Diga o que é cada uma
              (ou deixe em “Ignorar”) e a prévia é recalculada.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {unmappedColumns.map((c) => (
                <Field key={`col-${c.index}`} label={c.label} hint={c.sample.length > 0 ? `ex: ${c.sample.join(' · ').slice(0, 40)}` : undefined}>
                  <Select
                    value={Object.entries(mapping).find(([, v]) => v === String(c.index))?.[0] || ignore}
                    onChange={(e) => {
                      const next = { ...mapping };
                      for (const [f, v] of Object.entries(next)) if (v === String(c.index)) delete next[f];
                      if (e.target.value !== ignore) next[e.target.value] = String(c.index);
                      setMapping(next);
                      void preview({ mapping: next });
                    }}>
                    <option value={ignore}>Ignorar</option>
                    {fields.map((f) => (
                      <option key={f} value={f} disabled={mapping[f] !== undefined && mapping[f] !== String(c.index)}>
                        {IMPORT_FIELD_LABELS[f]}
                      </option>
                    ))}
                  </Select>
                </Field>
              ))}
            </div>
          </div>
        )}

        {/* ── 4. O que fazer com quem já existe ── */}
        {plan && (
          <div className="space-y-2">
            <p className="text-sm font-semibold text-[var(--text)]">Quem já está na base</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {(['skip', 'fill_empty'] as ExistingMode[]).map((m) => (
                <label key={m} className={cn(
                  'flex items-start gap-2.5 rounded-md border px-3 py-2.5 cursor-pointer',
                  existingMode === m ? 'border-[var(--brand)] bg-[var(--brand-soft)]' : 'border-[var(--border)] bg-[var(--surface)]',
                )}>
                  <input type="radio" name="existing-mode" className="mt-0.5" checked={existingMode === m}
                    onChange={() => { setExistingMode(m); void preview(); }} />
                  <span>
                    <span className="block text-sm font-semibold text-[var(--text)]">{EXISTING_MODE_LABELS[m]}</span>
                    <span className="block text-xs text-[var(--text-muted)] mt-0.5">
                      {m === 'skip'
                        ? 'Recomendado. Ninguém é alterado — os dados da unidade continuam como estão.'
                        : 'Preenche apenas campos VAZIOS (telefone, e-mail, CPF, endereço, tags…). Nada preenchido é substituído.'}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <p className="text-xs text-[var(--text-muted)]">
              A importação nunca sobrescreve um cadastro existente e nunca junta duas pessoas.
              Consentimento de marketing só é ativado com “sim” explícito no arquivo.
            </p>
          </div>
        )}

        {/* ── 2 + 5. Prévia e resultado ── */}
        {plan && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-[var(--text)]">Prévia</span>
              <span className="text-xs text-[var(--text-muted)]">{summary}</span>
              {plan.create > 0 && <Badge tone="green">{plan.create} novos</Badge>}
              {plan.fill > 0 && <Badge tone="blue">{plan.fill} complementam</Badge>}
              {plan.skip > 0 && <Badge tone="zinc">{plan.skip} mantidos</Badge>}
              {plan.error > 0 && <Badge tone="red">{plan.error} com erro</Badge>}
            </div>

            {plan.unknownColumns.length > 0 && (
              <p className="text-xs text-[var(--text-muted)] bg-[var(--surface-3)] border border-[var(--border)] rounded-md px-3 py-2">
                Colunas que ficaram de fora: {plan.unknownColumns.join(', ')}.
                Use o mapeamento acima para aproveitá-las.
              </p>
            )}
            {plan.exportOnlyColumns.length > 0 && (
              <p className="text-xs text-[var(--text-muted)] bg-[var(--surface-3)] border border-[var(--border)] rounded-md px-3 py-2">
                {plan.exportOnlyColumns.join(', ')}: são o histórico do próprio sistema
                (quando o cadastro foi criado, de onde veio, última conversa). Ficam só na
                exportação — reimportar não recria histórico.
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
                        className={cn(row.action === 'error' && 'bg-[var(--danger-bg)]', row.action === 'skip' && 'opacity-70')}>
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
              Linhas com erro não entram (CPF inválido, DDD inexistente, telefone e e-mail de pessoas
              diferentes…). Repetidas no arquivo contam uma vez — e o relatório de erros fica disponível
              para baixar depois de importar.
            </p>
          </div>
        )}
      </div>
    </Drawer>
  );
}
