'use client';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { buttonCls, Card, PageHeader, ListSkeleton, Badge } from '@/components/ui';
import { AccessDenied, AreaLoadError } from '@/components/dashboard/AccessNotice';
import { apiGet } from '@/lib/api-client';
import { clinicTerms } from '@/lib/clinic-presets';
import type { Availability, AvailabilityException, Business, Professional, Service } from '@/lib/types';

// ═══════════════════════════════════════════════════════════════
// FASE 2 · P1 — ESTRUTURA DA CLÍNICA (HUB)
// ═══════════════════════════════════════════════════════════════
// Uma tela que responde, em ordem: o que a clínica oferece → quem realiza →
// quando atende → quem pode entrar. Reúne Serviços, Profissionais, Horários e
// Acessos com números/status REAIS — sem unificar os modelos internos
// (Professional e User/Member seguem separados). As rotas antigas continuam
// existindo e são alcançadas daqui.
interface TeamMember { id: string; name: string; role: string; active: boolean; userId: string; }

export default function EstruturaPage() {
  const params = useSearchParams();
  const businessId = params.get('b') || '';

  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [denied, setDenied] = useState(false);
  const [biz, setBiz] = useState<Business | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [pros, setPros] = useState<Professional[]>([]);
  const [availability, setAvailability] = useState<Availability[]>([]);
  const [exceptions, setExceptions] = useState<AvailabilityException[]>([]);
  // Acessos: null = sem permissão para ler a equipe (403) — o bloco avisa.
  const [members, setMembers] = useState<TeamMember[] | null>(null);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoaded(false);
    const res = await apiGet<any>(`/api/catalog/get?businessId=${businessId}`, { scope: 'area', area: 'Estrutura da clínica' });
    if (!res.ok) {
      setLoadError(res.message || 'Falha de conexão.');
      setDenied(res.status === 403);
      setLoaded(true);
      return;
    }
    setLoadError('');
    const d = res.data || {};
    setBiz(d.business || null);
    setServices((d.services || []).filter((s: Service) => s.active !== false || true)); // todas; contamos ativas abaixo
    setPros(d.professionals || []);
    setAvailability(d.availability || []);
    setExceptions(d.exceptions || []);
    // Equipe é uma segunda chamada (permissão 'equipe'). 403 aqui NÃO derruba o hub.
    const team = await apiGet<any>(`/api/team?businessId=${businessId}`, { scope: 'area', area: 'Estrutura da clínica' });
    setMembers(team.ok ? (team.data?.members || []) : null);
    setLoaded(true);
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  const terms = clinicTerms(biz?.clinicType);
  const withB = (href: string) => `${href}?b=${businessId}`;

  // ── Métricas REAIS ──
  const servicesActive = services.filter((s) => s.active).length;
  const prosActive = pros.filter((p) => p.active).length;
  const clinicWeekdays = new Set(availability.filter((a) => !a.professionalId).map((a) => a.weekday));
  const customProCount = new Set(availability.filter((a) => a.professionalId).map((a) => a.professionalId)).size;
  const exceptionsCount = exceptions.length;
  const membersActive = members ? members.filter((m) => m.active).length : 0;
  const prosWithAccess = pros.filter((p) => p.userId).length;

  const header = (
    <PageHeader
      icon="grid"
      title="Estrutura da clínica"
      hint="O que a clínica oferece, quem realiza, quando atende e quem pode entrar."
    />
  );

  if (denied) return <>{header}<AccessDenied area="Estrutura da clínica" /></>;
  if (loadError) return <>{header}<AreaLoadError area="Estrutura da clínica" message={loadError} onRetry={load} /></>;
  if (!loaded) return <>{header}<ListSkeleton rows={4} /></>;

  const block = (
    { icon, title, question, metric, metricHint, tone, primary, onPrimary, secondary, onSecondary }: {
      icon: string; title: string; question: string; metric: string; metricHint: string;
      tone: 'brand' | 'success' | 'warning' | 'neutral';
      primary: string; onPrimary: string; secondary: string; onSecondary: string;
    },
  ) => {
    const toneCls: Record<string, string> = {
      brand: 'bg-[var(--brand-soft)] text-[var(--brand-fg)]',
      success: 'bg-[var(--success-bg)] text-[var(--success-fg)]',
      warning: 'bg-[var(--warning-bg)] text-[var(--warning-fg)]',
      neutral: 'bg-[var(--surface-3)] text-[var(--text-muted)]',
    };
    return (
      <Card className="p-5 flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <span className={`grid place-items-center h-10 w-10 rounded-xl shrink-0 ${toneCls[tone]}`}>
            <Icon n={icon} size={20} />
          </span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-extrabold text-[var(--text)] leading-tight">{title}</h2>
            <p className="text-[12.5px] text-[var(--text-muted)] mt-0.5 leading-snug">{question}</p>
          </div>
        </div>
        <div>
          <p className="text-[22px] font-extrabold text-[var(--text)] leading-none">{metric}</p>
          <p className="text-[12px] text-[var(--text-muted)] mt-1">{metricHint}</p>
        </div>
        <div className="flex flex-wrap gap-2 mt-auto">
          <Link href={onPrimary} className={buttonCls('primary', 'md')}>
            <Icon n="plus" size={14} /> {primary}
          </Link>
          <Link href={onSecondary} className={buttonCls('secondary', 'md')}>{secondary}</Link>
        </div>
      </Card>
    );
  };

  const hoursStatus = clinicWeekdays.size === 0 && customProCount === 0
    ? 'Não configurado'
    : `${clinicWeekdays.size} ${clinicWeekdays.size === 1 ? 'dia da clínica' : 'dias da clínica'}${customProCount ? ` · ${customProCount} prof. com horário próprio` : ''}`;

  return (
    <>
      {header}
      <div className="grid gap-4 sm:grid-cols-2">
        {block({
          icon: 'service', title: terms.servicePlural, question: 'O que sua clínica oferece',
          metric: String(servicesActive), metricHint: servicesActive === 0 ? 'Nenhum serviço ativo ainda' : `de ${services.length} cadastrados`,
          tone: servicesActive ? 'brand' : 'neutral',
          primary: `Adicionar ${terms.service.toLowerCase()}`, onPrimary: withB('/servicos'),
          secondary: 'Ver lista', onSecondary: withB('/servicos'),
        })}
        {block({
          icon: 'idcard', title: 'Profissionais', question: 'Quem realiza os atendimentos',
          metric: String(prosActive), metricHint: prosActive === 0 ? 'Nenhum profissional ativo ainda' : `${prosWithAccess} com acesso ao sistema`,
          tone: prosActive ? 'brand' : 'neutral',
          primary: 'Adicionar profissional', onPrimary: withB('/profissionais'),
          secondary: 'Ver lista', onSecondary: withB('/profissionais'),
        })}
        {block({
          icon: 'clock', title: 'Horários', question: 'Quando a clínica e os profissionais atendem',
          metric: hoursStatus, metricHint: exceptionsCount ? `${exceptionsCount} ${exceptionsCount === 1 ? 'exceção' : 'exceções'} agendada${exceptionsCount === 1 ? '' : 's'}` : 'Sem exceções de horário',
          tone: (clinicWeekdays.size || customProCount) ? 'success' : 'warning',
          primary: 'Configurar horários', onPrimary: withB('/disponibilidade'),
          secondary: 'Ver exceções', onSecondary: withB('/disponibilidade'),
        })}
        {block({
          icon: 'shield', title: 'Acessos', question: 'Quem pode entrar no GoDoutor',
          metric: members === null ? '—' : String(membersActive),
          metricHint: members === null
            ? 'Você não tem permissão para ver a equipe'
            : (membersActive === 0 ? 'Somente você por enquanto' : `${prosWithAccess} profissional(is) com login`),
          tone: members === null ? 'neutral' : (membersActive ? 'brand' : 'warning'),
          primary: 'Gerenciar acessos', onPrimary: withB('/equipe'),
          secondary: 'Ver equipe', onSecondary: withB('/equipe'),
        })}
      </div>

      <Card className="p-4 mt-4 flex items-center gap-3 flex-wrap">
        <Badge tone="zinc" icon="spark">Dica</Badge>
        <p className="text-[12.5px] text-[var(--text-muted)] flex-1 min-w-[220px]">
          A configuração em ordem — {terms.servicePlural.toLowerCase()} → profissionais → horários — deixa a agenda pronta para receber agendamentos.
        </p>
        <Link href={withB('/agenda')} className={buttonCls('secondary', 'sm')}>Ir para a agenda</Link>
      </Card>
    </>
  );
}
