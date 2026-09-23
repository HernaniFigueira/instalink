'use client';
import { useCallback, useEffect, useState } from 'react';
import { Icon } from '@/components/icons';
import { WorkspaceSheet } from '@/components/dashboard/WorkspaceSheet';
import { Button, IconButton, Input, Textarea, Select, Field, Switch, Badge, Notice, EmptyState, ListSkeleton } from '@/components/ui';
import { apiGet, apiSend } from '@/lib/api-client';
import type { AnamneseField, AnamneseFieldType, AnamneseTemplate, ClinicType } from '@/lib/types';

const FIELD_TYPES: Array<{ id: AnamneseFieldType; label: string }> = [
  { id: 'text', label: 'Texto curto' },
  { id: 'textarea', label: 'Texto longo' },
  { id: 'boolean', label: 'Sim / Não' },
  { id: 'select', label: 'Seleção única' },
  { id: 'multiselect', label: 'Múltipla escolha' },
  { id: 'number', label: 'Número' },
  { id: 'date', label: 'Data' },
  { id: 'scale', label: 'Escala' },
  { id: 'note', label: 'Observação (informativa)' },
];

const uid = () => `f_${Math.random().toString(36).slice(2, 9)}`;

function emptyField(): AnamneseField {
  return { id: uid(), label: '', type: 'text', required: false };
}

// ═══════════════════════════════════════════════════════════════
// FASE 2 · P4 — gerenciador de fichas de anamnese (Workspace Sheet)
// Um motor único: templates administrativos editáveis (não é diagnóstico).
// ═══════════════════════════════════════════════════════════════
export function AnamneseManager({ open, onClose, businessId, clinicType }: {
  open: boolean; onClose: () => void; businessId: string; clinicType?: ClinicType;
}) {
  const [templates, setTemplates] = useState<AnamneseTemplate[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<AnamneseTemplate | null>(null);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoaded(false);
    const res = await apiGet<{ templates: AnamneseTemplate[] }>(`/api/anamnese?businessId=${businessId}`, { scope: 'area', area: 'Atendimento' });
    if (!res.ok) { setError(res.message || 'Falha ao carregar.'); setLoaded(true); return; }
    setError('');
    setTemplates(res.data?.templates || []);
    setLoaded(true);
  }, [businessId]);

  useEffect(() => { if (open) load(); }, [open, load]);

  async function upgrade(id: string) {
    setBusy(true);
    try {
      const res = await apiSend('/api/anamnese', 'POST', { action: 'template.upgrade', businessId, id }, { scope: 'area', area: 'Atendimento' });
      if (res.ok) {
        setMsg(res.data?.message || 'Ficha atualizada.');
        await load();
      } else {
        setMsg(res.data?.error || res.message || 'Não foi possível atualizar.');
      }
    } finally { setBusy(false); }
  }

  async function seed() {
    setBusy(true); setMsg('');
    const res = await apiSend('/api/anamnese', 'POST', { action: 'template.seed', businessId }, { scope: 'area', area: 'Atendimento' });
    setBusy(false);
    if (!res.ok) { setMsg(res.message || 'Não foi possível criar a ficha.'); return; }
    setMsg('Ficha criada a partir do preset da clínica.');
    load();
  }

  async function save() {
    if (!editing) return;
    const fields = editing.fields.filter((f) => f.label.trim());
    if (!fields.length) { setMsg('Adicione ao menos um campo com nome.'); return; }
    if (!editing.name.trim()) { setMsg('Dê um nome à ficha.'); return; }
    setBusy(true); setMsg('');
    const res = await apiSend('/api/anamnese', 'POST', { action: 'template.save', businessId, template: { ...editing, fields } }, { scope: 'area', area: 'Atendimento' });
    setBusy(false);
    if (!res.ok) { setMsg(res.message || 'Não foi possível salvar.'); return; }
    setEditing(null);
    load();
  }

  async function remove(id: string) {
    setBusy(true); setMsg('');
    const res = await apiSend('/api/anamnese', 'POST', { action: 'template.delete', businessId, id }, { scope: 'area', area: 'Atendimento' });
    setBusy(false);
    if (!res.ok) { setMsg(res.message || 'Não foi possível excluir.'); return; }
    load();
  }

  const setField = (idx: number, patch: Partial<AnamneseField>) => {
    if (!editing) return;
    const fields = editing.fields.map((f, i) => (i === idx ? { ...f, ...patch } : f));
    setEditing({ ...editing, fields });
  };

  return (
    <WorkspaceSheet
      open={open}
      onClose={onClose}
      title="Fichas de anamnese"
      subtitle="Modelos administrativos editáveis — preenchidos no atendimento."
      icon="fileText"
      width="max-w-[720px]"
    >
      {error ? <Notice tone="error">{error}</Notice> : null}
      {msg ? <Notice tone="info">{msg}</Notice> : null}

      {!loaded ? <ListSkeleton rows={3} /> : editing ? (
        <div className="p-1 space-y-4">
          <Field label="Nome da ficha" required>
            <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Ex.: Anamnese médica" />
          </Field>
          <Field label="Descrição" hint="Para que serve esta ficha (visível só para a equipe).">
            <Textarea value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} rows={2} />
          </Field>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-[13px] font-extrabold text-[var(--text)]">Campos ({editing.fields.length})</h3>
              <Button variant="secondary" size="sm" onClick={() => setEditing({ ...editing, fields: [...editing.fields, emptyField()] })}>
                <Icon n="plus" size={14} /> Campo
              </Button>
            </div>
            {editing.fields.map((f, i) => (
              <div key={f.id} className="rounded-xl border border-[var(--border)] p-3 space-y-2">
                <div className="flex gap-2 items-start">
                  <div className="flex-1"><Input value={f.label} onChange={(e) => setField(i, { label: e.target.value })} placeholder="Pergunta / campo" /></div>
                  <IconButton icon="x" label="Remover campo" size="sm" onClick={() => setEditing({ ...editing, fields: editing.fields.filter((_, j) => j !== i) })} />
                </div>
                <div className="flex flex-wrap gap-2 items-center">
                  <Select value={f.type} onChange={(e) => setField(i, { type: e.target.value as AnamneseFieldType })} className="max-w-[190px]">
                    {FIELD_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </Select>
                  <label className="flex items-center gap-1.5 text-[12.5px] text-[var(--text)]">
                    <Switch checked={f.required} label="Campo obrigatório" onChange={(v) => setField(i, { required: v })} /> Obrigatório
                  </label>
                </div>
                {(f.type === 'select' || f.type === 'multiselect') && (
                  <Input
                    value={(f.options || []).join(', ')}
                    onChange={(e) => setField(i, { options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                    placeholder="Opções separadas por vírgula"
                  />
                )}
                {f.type === 'scale' && (
                  <div className="flex gap-2">
                    <Input type="number" value={f.scaleMin ?? 0} onChange={(e) => setField(i, { scaleMin: Number(e.target.value) })} className="max-w-[90px]" />
                    <Input type="number" value={f.scaleMax ?? 10} onChange={(e) => setField(i, { scaleMax: Number(e.target.value) })} className="max-w-[90px]" />
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="flex gap-2 justify-end pt-2">
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={busy}>Cancelar</Button>
            <Button variant="primary" onClick={save} disabled={busy}>{busy ? 'Salvando…' : 'Salvar ficha'}</Button>
          </div>
        </div>
      ) : templates.length === 0 ? (
        <EmptyState
          icon="fileText"
          title="Nenhuma ficha ainda"
          hint={clinicType && clinicType !== 'geral' ? 'Crie a partir do preset da sua clínica ou monte do zero.' : 'Monte uma ficha do zero ou use um preset.'}
          action={<div className="flex gap-2"><Button variant="primary" onClick={seed} disabled={busy}><Icon n="spark" size={14} /> Usar preset</Button><Button variant="secondary" onClick={() => setEditing({ id: '', businessId, name: '', description: '', preset: 'custom', fields: [emptyField()], active: true, createdAt: '', updatedAt: '' })}><Icon n="plus" size={14} /> Nova ficha</Button></div>}
        />
      ) : (
        <div className="p-1 space-y-2">
          {msg && <Notice tone="info">{msg}</Notice>}
          <div className="flex gap-2 flex-wrap">
            <Button variant="secondary" size="sm" onClick={seed} disabled={busy}><Icon n="spark" size={14} /> Do preset</Button>
            <Button variant="secondary" size="sm" onClick={() => setEditing({ id: '', businessId, name: '', description: '', preset: 'custom', fields: [emptyField()], active: true, createdAt: '', updatedAt: '' })}><Icon n="plus" size={14} /> Nova ficha</Button>
          </div>
          {templates.map((t) => (
            <div key={t.id} className="flex items-center gap-3 rounded-xl border border-[var(--border)] p-3">
              <span className="grid place-items-center h-9 w-9 rounded-lg bg-[var(--brand-soft)] text-[var(--brand-fg)] shrink-0"><Icon n="fileText" size={17} /></span>
              <div className="flex-1 min-w-0">
                <p className="text-[13.5px] font-bold text-[var(--text)] truncate">{t.name}</p>
                <p className="text-[12px] text-[var(--text-muted)]">{t.fields.length} campo(s){t.preset && t.preset !== 'custom' ? ` · preset ${t.preset}` : ''}</p>
              </div>
              {!t.active && <Badge tone="zinc">Inativa</Badge>}
              {t.preset && t.preset !== 'custom' && (
                <IconButton icon="sync" label="Atualizar do preset (mantém campos customizados)" size="sm" variant="ghost" onClick={() => upgrade(t.id)} />
              )}
              <IconButton icon="pencil" label="Editar ficha" size="sm" onClick={() => setEditing({ ...t })} />
              <IconButton icon="x" label="Excluir ficha" size="sm" variant="ghost" onClick={() => remove(t.id)} />
            </div>
          ))}
        </div>
      )}
    </WorkspaceSheet>
  );
}
