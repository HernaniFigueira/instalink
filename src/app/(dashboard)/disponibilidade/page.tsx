'use client';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import type { Availability, AvailabilityException, Professional } from '@/lib/types';
import { Button, ListSkeleton, Notice, PageHeader, Panel, Select } from '@/components/ui';
import { BusinessHoursPanel } from '@/components/dashboard/BusinessHours';
import { AccessDenied, AreaLoadError } from '@/components/dashboard/AccessNotice';
import { apiGet, apiSend } from '@/lib/api-client';
import { ExceptionsManager, CatalogCrossLinks } from '@/components/dashboard/catalog-panels';

// ═══════════════════════════════════════════════════════════════
// DISPONIBILIDADE — "quando atende"
// Era /horarios. O nome antigo descrevia O CAMPO (horário); o novo descreve
// O QUE A TELA ENTREGA: quando a casa e cada profissional podem atender.
// Janela semanal (base), personalização por profissional (herança já
// calculada pelo painel) e dias especiais. Reusa toda a lógica protegida —
// esta tela só expõe o que já existe. Nenhuma fórmula de agenda mudou.
//
// Lista curada (IANA): cobre os casos reais; qualquer outro fuso pode ser
// gravado via API (o servidor valida IANA). Default do produto: São Paulo.
const TIMEZONE_OPTIONS = [
  'America/Sao_Paulo', 'America/Manaus', 'America/Belem', 'America/Recife',
  'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'America/Bogota',
  'America/Buenos_Aires', 'Europe/Lisbon', 'Europe/London', 'Europe/Madrid',
  'Europe/Berlin', 'UTC',
];

// A1.2 · Bloco 2 — separação de responsabilidades:
//   • QUANDO atende  → aqui (janela semanal + dias especiais);
//   • COMO o cliente reserva (antecedência, cancelamento, horizonte, buffer)
//     → CONFIGURAÇÕES → aba Agenda. A tela aponta para lá em vez de editar
//     regras no lugar errado; a engine de agenda não foi tocada.
// ═══════════════════════════════════════════════════════════════
export default function DisponibilidadePage() {
  const params = useSearchParams();
  const businessId = params.get('b') || '';
  const [pros, setPros] = useState<Professional[]>([]);
  const [rules, setRules] = useState<Availability[]>([]);
  const [exceptions, setExceptions] = useState<AvailabilityException[]>([]);
  // A2-B5 (F9): fuso do negócio (todas as regras de agenda usam este fuso).
  const [bizTz, setBizTz] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState('');
  // 403 nesta tela → aviso amigável (o usuário continua logado).
  const [loadError, setLoadError] = useState('');
  const [denied, setDenied] = useState(false);

  const load = useCallback(async () => {
    if (!businessId) return;
    const res = await apiGet<any>(`/api/catalog/get?businessId=${businessId}`, { scope: 'area', area: 'Disponibilidade' });
    if (!res.ok) {
      setLoadError(res.message || 'Falha de conexão.');
      setDenied(res.status === 403);
      setLoaded(true);
      return;
    }
    setLoadError('');
    const d = res.data || {};
    setPros(d.professionals || []);
    setRules(d.availability || []);
    setExceptions(d.exceptions || []);
    setBizTz(d.business?.businessTimezone || 'America/Sao_Paulo');
    setDenied(false);
    setLoaded(true);
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  async function call(action: string, payload: Record<string, any>) {
    setMsg('');
    const res = await apiSend('/api/catalog', 'POST', { businessId, action, ...payload }, { scope: 'action', area: 'Disponibilidade' });
    if (!res.ok) throw new Error(res.message || 'Não foi possível salvar.');
    await load();
    setMsg('Salvo.');
    setTimeout(() => setMsg(''), 2500);
  }

  const header = (
    <PageHeader
      icon="clock"
      title="Disponibilidade"
      hint="Quando a casa e cada profissional podem atender — a base de tudo. Profissionais podem seguir a janela da casa ou ter a sua."
    />
  );

  if (denied) {
    return (
      <>
        {header}
        <AccessDenied area="Disponibilidade" />
      </>
    );
  }

  if (loadError) return <>{header}<AreaLoadError area="Disponibilidade" message={loadError} onRetry={load} /></>;

  return (
    <>
      {header}

      {loaded && <CatalogCrossLinks businessId={businessId} current="/disponibilidade" />}

      {msg && <Notice tone="info" className="mb-4">{msg}</Notice>}
      {!loaded && <ListSkeleton rows={3} />}

      {loaded && (
        <div className="space-y-4">
          {/* Horário da empresa + herança/personalização por profissional. */}
          <BusinessHoursPanel
            businessId={businessId}
            professionals={pros.filter((p) => p.active !== false)}
            rules={rules}
            onChanged={() => { load(); }}
          />
          <ExceptionsManager
            exceptions={exceptions}
            onSave={async (payload) => { await call('exception.save', payload); }}
            onDelete={async (id) => { await call('exception.delete', { id }); }}
          />
          {/* A2-B5 (F9): fuso das regras de agenda — "hoje", horizonte,
              exceções e lembretes seguem este fuso (default São Paulo).
              Inválido o servidor recusa (400); vazio volta ao default. */}
          <Panel className="p-5 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[var(--text)]">Fuso horário da agenda</p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">"Hoje", exceções e prazos seguem este fuso — não o do celular de quem agenda.</p>
            </div>
            <Select
              value={bizTz}
              onChange={async (e) => {
                const tz = e.target.value;
                const prev = bizTz;
                setBizTz(tz); // otimista; erro reverte
                const res = await apiSend(`/api/businesses/${businessId}`, 'PATCH', { businessTimezone: tz }, { scope: 'action', area: 'Disponibilidade' });
                if (!res.ok) { setBizTz(prev); setMsg(res.message || 'Não foi possível salvar o fuso.'); setTimeout(() => setMsg(''), 3000); }
                else { setMsg('Fuso salvo.'); setTimeout(() => setMsg(''), 2500); }
              }}
              className="w-auto shrink-0 font-semibold"
              aria-label="Fuso horário da agenda"
            >
              {TIMEZONE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </Panel>
          {/* A1.2 · Bloco 2: "como o cliente reserva" é configuração do
              negócio — mora em Configurações → Agenda. Atalho contextual
              (classe B): ajuda quem está aqui a achar a regra certa. */}
          <Panel className="p-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-[var(--text)]">Regras de reserva</p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">Antecedência mínima, prazo de cancelamento, dias de agenda aberta e intervalo entre atendimentos.</p>
            </div>
            <Link href={`/configuracoes?tab=agenda&b=${businessId}`} className="shrink-0">
              <Button variant="primary" size="sm">Configurar em Configurações → Agenda</Button>
            </Link>
          </Panel>
        </div>
      )}
    </>
  );
}
