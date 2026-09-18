'use client';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import type { Availability, AvailabilityException, Professional } from '@/lib/types';
import { ListSkeleton } from '@/components/ui';
import { BusinessHoursPanel } from '@/components/dashboard/BusinessHours';
import { AccessDenied } from '@/components/dashboard/AccessNotice';
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
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState('');
  // 403 nesta tela → aviso amigável (o usuário continua logado).
  const [denied, setDenied] = useState(false);

  const load = useCallback(async () => {
    if (!businessId) return;
    const res = await apiGet<any>(`/api/catalog/get?businessId=${businessId}`, { scope: 'area', area: 'Disponibilidade' });
    if (!res.ok) {
      setDenied(res.status === 403);
      setLoaded(true);
      return;
    }
    const d = res.data || {};
    setPros(d.professionals || []);
    setRules(d.availability || []);
    setExceptions(d.exceptions || []);
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

  if (denied) {
    return (
      <>
        <h1 className="text-2xl font-bold tracking-tight">Disponibilidade</h1>
        <p className="text-sm text-zinc-500 mt-1 mb-5">Quando a casa e cada profissional podem atender.</p>
        <AccessDenied area="Disponibilidade" />
      </>
    );
  }

  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Disponibilidade</h1>
      <p className="text-sm text-zinc-500 mt-1 mb-5">Quando a casa e cada profissional podem atender — a base de tudo. Profissionais podem seguir a janela da casa ou ter a sua.</p>

      {loaded && <CatalogCrossLinks businessId={businessId} current="/disponibilidade" />}

      {msg && <p className="mb-4 text-sm font-medium bg-zinc-900 text-white rounded-md px-4 py-3">{msg}</p>}
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
          {/* A1.2 · Bloco 2: "como o cliente reserva" é configuração do
              negócio — mora em Configurações → Agenda. Atalho contextual
              (classe B): ajuda quem está aqui a achar a regra certa. */}
          <div className="bg-white border border-zinc-200 rounded-lg p-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-bold text-sm">Regras de reserva</p>
              <p className="text-xs text-zinc-500 mt-0.5">Antecedência mínima, prazo de cancelamento, dias de agenda aberta e intervalo entre atendimentos.</p>
            </div>
            <Link href={`/configuracoes?tab=agenda&b=${businessId}`}
              className="text-xs font-bold bg-zinc-900 text-white px-4 py-2.5 rounded-md shrink-0">
              Configurar em Configurações → Agenda
            </Link>
          </div>
        </div>
      )}
    </>
  );
}
