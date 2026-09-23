'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Icon } from '@/components/icons';
import {
  Badge, Button, Card, Field, Input, ListSkeleton, Notice, PageHeader, Select, Switch, EmptyState,
} from '@/components/ui';
import { AccessDenied, AreaLoadError } from '@/components/dashboard/AccessNotice';
import { apiGet, apiSend } from '@/lib/api-client';
import type { FollowUpRule, FollowUpTrigger } from '@/lib/types';

// ═══════════════════════════════════════════════════════════════
// FASE 2 · P10 — FOLLOW-UP: FUNDAÇÃO (receitas + prévia honesta)
// ═══════════════════════════════════════════════════════════════
// Seis receitas internas (gatilho · atraso · público · ação). NADA é
// enviado nesta fase: sem canal operacional a tela mostra "Aguardando
// conexão do WhatsApp" — nunca finge envio nem chama integração quebrada.
interface Recipe { trigger: FollowUpTrigger; name: string; hint: string; audience: string; action: string }
interface Candidate {
  ruleId: string; trigger: FollowUpTrigger; name: string; phone: string;
  dueAt: string; context: string; contactId: string;
}

export default function FollowUpPage() {
  const params = useSearchParams();
  const businessId = params.get('b') || '';

  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [denied, setDenied] = useState(false);
  const [catalog, setCatalog] = useState<Recipe[]>([]);
  const [rules, setRules] = useState<FollowUpRule[]>([]);
  const [channel, setChannel] = useState<{ ready: boolean; label: string }>({ ready: false, label: 'Aguardando conexão do WhatsApp' });
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [busy, setBusy] = useState('');
  const [flash, setFlash] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoaded(false);
    const res = await apiGet<any>(`/api/followup?businessId=${businessId}`, { scope: 'area', area: 'Follow-up' });
    if (!res.ok) {
      setLoadError(res.message || 'Falha de conexão.');
      setDenied(res.status === 403);
      setLoaded(true);
      return;
    }
    setLoadError('');
    setCatalog(res.data?.catalog || []);
    setChannel(res.data?.channel || { ready: false, label: 'Aguardando conexão do WhatsApp' });
    setCandidates(res.data?.candidates || []);
    let rulesList: FollowUpRule[] = res.data?.rules || [];
    // Primeira visita: semeia as 6 receitas (idempotente, server-side).
    if (!rulesList.length) {
      const seeded = await apiSend<{ rules: FollowUpRule[] }>('/api/followup', 'POST', { action: 'seed', businessId }, { scope: 'action', area: 'Follow-up' });
      if (seeded.ok) rulesList = seeded.data?.rules || [];
    }
    setRules(rulesList);
    setLoaded(true);
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  const byTrigger = useMemo(() => new Map(rules.map((r) => [r.trigger, r])), [rules]);
  const candidatesOf = (ruleId: string) => candidates.filter((c) => c.ruleId === ruleId);

  async function toggle(rule: FollowUpRule) {
    setBusy(rule.id); setError(''); setFlash('');
    const res = await apiSend('/api/followup', 'POST', { action: 'toggle', businessId, id: rule.id, active: !rule.active }, { scope: 'action', area: 'Follow-up' });
    setBusy('');
    if (!res.ok) { setError(res.message || 'Não foi possível atualizar.'); return; }
    setRules((rs) => rs.map((r) => (r.id === rule.id ? { ...r, active: !rule.active } : r)));
    setFlash(!rule.active ? 'Receita ligada.' : 'Receita desligada.');
  }

  async function saveDelay(rule: FollowUpRule, value: number, unit: FollowUpRule['delayUnit']) {
    setBusy(rule.id); setError(''); setFlash('');
    const res = await apiSend('/api/followup', 'POST', { action: 'update', businessId, id: rule.id, delayValue: value, delayUnit: unit }, { scope: 'action', area: 'Follow-up' });
    setBusy('');
    if (!res.ok) { setError(res.message || 'Não foi possível salvar o atraso.'); return; }
    setRules((rs) => rs.map((r) => (r.id === rule.id ? { ...r, delayValue: value, delayUnit: unit } : r)));
    setFlash('Atraso salvo.');
    load(); // recalcula a prévia com o novo atraso
  }

  const header = (
    <PageHeader
      icon="send"
      title="Follow-up"
      hint="Receitas de retorno: confirmação, falta, pós-atendimento, retorno e reativação. Prévia com dado real — nada é enviado ainda."
    />
  );

  if (denied) return <>{header}<AccessDenied area="Follow-up" /></>;
  if (loadError) return <>{header}<AreaLoadError area="Follow-up" message={loadError} onRetry={load} /></>;

  const unitLabel = (u: string) => (u === 'days' ? 'dia(s)' : u === 'hours' ? 'hora(s)' : 'minuto(s)');

  return (
    <>
      {header}

      {/* Estado honesto do canal — nunca fingir envio. */}
      {!channel.ready ? (
        <Notice tone="warning" title={channel.label}>
          As receitas ficam salvas e a prévia já funciona com dados reais. O envio
          automático entra quando o WhatsApp estiver conectado — nada é enviado por
          enquanto.
        </Notice>
      ) : (
        <Notice tone="success" title={channel.label}>
          Canal pronto. Os envios desta fase continuam manuais — a automação de
          disparo é a próxima etapa.
        </Notice>
      )}

      {error && <Notice tone="error">{error}</Notice>}
      {!error && flash && <Notice tone="success">{flash}</Notice>}

      {!loaded ? <ListSkeleton rows={5} /> : rules.length === 0 ? (
        <EmptyState icon="send" title="Sem receitas" hint="Não foi possível criar as receitas padrão. Tente recarregar." />
      ) : (
        <div className="space-y-3">
          {rules.map((rule) => {
            const recipe = catalog.find((c) => c.trigger === rule.trigger);
            const mine = candidatesOf(rule.id);
            return (
              <Card key={rule.id} className="p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="flex-1 min-w-[240px]">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-[14px] font-extrabold text-[var(--text)]">{rule.name}</h3>
                      <Badge tone={rule.active ? 'green' : 'zinc'}>{rule.active ? 'Ativa' : 'Desligada'}</Badge>
                      {!channel.ready && <Badge tone="amber" icon="whatsapp">Aguardando conexão do WhatsApp</Badge>}
                    </div>
                    <p className="text-[12.5px] text-[var(--text-muted)] mt-0.5">{recipe?.hint || rule.action}</p>
                    <p className="text-[12px] text-[var(--text-muted)] mt-1">
                      <strong className="text-[var(--text)]">Público:</strong> {rule.audience} ·{' '}
                      <strong className="text-[var(--text)]">Ação:</strong> {rule.action}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={rule.active} label={`Ativar ${rule.name}`} disabled={busy === rule.id}
                      onChange={() => { void toggle(rule); }} />
                  </div>
                </div>

                <div className="flex flex-wrap items-end gap-2 mt-3">
                  <Field label="Atraso" htmlFor={`d-${rule.id}`}>
                    <Input id={`d-${rule.id}`} type="number" min={0} max={365} defaultValue={rule.delayValue}
                      disabled={busy === rule.id}
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v) && v >= 0 && v <= 365 && v !== rule.delayValue) void saveDelay(rule, v, rule.delayUnit);
                      }}
                      className="w-[90px]" />
                  </Field>
                  <Field label="Unidade" htmlFor={`u-${rule.id}`}>
                    <Select id={`u-${rule.id}`} defaultValue={rule.delayUnit} disabled={busy === rule.id}
                      onChange={(e) => void saveDelay(rule, rule.delayValue, e.target.value as FollowUpRule['delayUnit'])}
                      className="w-[130px]">
                      <option value="minutes">minuto(s)</option>
                      <option value="hours">hora(s)</option>
                      <option value="days">dia(s)</option>
                    </Select>
                  </Field>
                  <span className="text-[12px] text-[var(--text-muted)] pb-2.5">
                    {rule.trigger === 'return_due'
                      ? 'Na data/intervalo definido pelo profissional'
                      : `em relação ao gatilho (${unitLabel(rule.delayUnit)})`}
                  </span>
                </div>

                {/* Prévia REAL: sobre quem a regra agiria agora (dry-run). */}
                <div className="mt-3 rounded-md bg-[var(--surface-2)] border border-[var(--border)] p-3">
                  <p className="text-[12px] font-bold text-[var(--text)]">
                    Prévia agora: {mine.length} {mine.length === 1 ? 'pessoa' : 'pessoas'}
                    <span className="font-normal text-[var(--text-muted)]"> — nada é enviado ainda</span>
                  </p>
                  {mine.length > 0 && (
                    <ul className="mt-1.5 space-y-1">
                      {mine.slice(0, 5).map((c, i) => (
                        <li key={`${c.ruleId}-${c.trigger}-${c.contactId || c.name}-${i}`} className="text-[12px] text-[var(--text-muted)] flex gap-2">
                          <span className="font-semibold text-[var(--text)] shrink-0">{c.name || 'Sem nome'}</span>
                          <span className="truncate">{c.context}{c.dueAt ? ` · até ${c.dueAt.split('-').reverse().join('/')}` : ''}</span>
                        </li>
                      ))}
                      {mine.length > 5 && <li className="text-[11.5px] text-[var(--text-faint)]">+ {mine.length - 5} outras…</li>}
                    </ul>
                  )}
                  {!channel.ready && (
                    <p className="text-[11.5px] text-[var(--warning-fg)] mt-1.5 inline-flex items-center gap-1">
                      <Icon n="whatsapp" size={12} /> Aguardando conexão do WhatsApp para agir.
                    </p>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
