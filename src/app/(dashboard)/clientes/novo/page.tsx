'use client';
// ═══════════════════════════════════════════════════════════════
// NOVO CLIENTE — PÁGINA PRÓPRIA (Missão 02)
// ═══════════════════════════════════════════════════════════════
// Cadastro completo de tutor/paciente como TELA, não como Dialog, Drawer ou
// Sheet. Dois pontos de entrada usam esta mesma rota:
//   • Clientes            → /clientes/novo?b=…&from=clientes
//   • Novo agendamento    → /clientes/novo?b=…&from=agenda
//
// Contrato pós-salvamento (sem botão intermediário):
//   Salvar → "Abrindo o Cliente 360…" → ficha (router.replace) → ação de origem.
//   A ficha é resolvida pela IDENTIDADE do contato (contactId) e levada pela
//   CHAVE do Cliente 360 — nunca o contactId é usado como chave da rota.
//   Se a resolução falhar ou atrasar, a tela NÃO redireciona para a lista por
//   suposição: mostra o aviso com "Tentar de novo" e saídas explícitas.
//
// Com `from=agenda`, o agendamento em andamento está no rascunho de sessão
// (lib/booking-return.ts). Ao salvar, o tutor/pet recém-criados entram nele e
// o botão "Continuar agendamento" reabre a Agenda. NADA de agendamento é
// criado aqui: a gravação do agendamento só acontece na confirmação da
// Agenda, com revalidação do horário no servidor.
//
// Saídas (Voltar, Cancelar e navegação) passam pela guarda de descarte do
// próprio formulário (NewClientSheet). A URL carrega só `b` e `from` — nunca
// nome, telefone ou busca (a ficha recebe o estado da lista, como já fazia).
import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiGet } from '@/lib/api-client';
import { onlyDigits } from '@/lib/utils';
import { useBusinessId } from '@/components/dashboard/useBusinessId';
import { useWorkspace } from '@/components/dashboard/WorkspaceContext';
import { AreaLoadError } from '@/components/dashboard/AccessNotice';
import { NewClientForm, type NewClientResult } from '@/components/dashboard/NewClientSheet';
import { Button, Notice, PageBackAction, Skeleton } from '@/components/ui';
import {
  continueBookingHref,
  readBookingReturn,
  readClientsListQuery,
  withRegisteredClient,
  writeBookingReturn,
  type BookingReturnDraft,
} from '@/lib/booking-return';
import { clientListReturnHref } from '@/lib/client-return';

type PeopleRow = { key: string; contactId: string };

/** Pessoa já gravada aguardando a ficha: a resolução é feita a partir do contactId. */
interface OpeningState {
  contactId: string;
  phone: string;
  returnToBooking: boolean;
}

/**
 * Destino do Cliente 360 da pessoa (chave derivada da identidade). `null` quando
 * ainda não resolvida (falha ou ausência): quem chama decide — nunca redireciona
 * para a lista por suposição.
 */
async function resolveClientProfileHref(
  businessId: string,
  contactId: string,
  phoneDigits: string,
  retorno: boolean,
): Promise<string | null> {
  if (!phoneDigits) return null;
  const res = await apiGet<{ people?: PeopleRow[] }>(
    `/api/people360?businessId=${encodeURIComponent(businessId)}&q=${encodeURIComponent(phoneDigits)}&page=1`,
    { scope: 'area', area: 'Clientes' },
  );
  if (!res.ok) return null;
  const hit = (res.data?.people || []).find((p) => p.contactId === contactId);
  if (!hit) return null;
  // Origem Clientes: a ficha recebe o estado da lista (busca, filtro, página, unidade)
  // para o "Voltar para clientes" devolvê-la como estava. Origem agenda: marcador de retorno.
  const qs = new URLSearchParams(retorno ? '' : readClientsListQuery(businessId));
  qs.set('b', businessId);
  if (retorno) qs.set('retorno', 'agendamento');
  return `/clientes/${encodeURIComponent(hit.key)}?${qs.toString()}`;
}

export default function NovoClientePage() {
  const router = useRouter();
  const search = useSearchParams();
  const { businessId: resolvedBusinessId, resolving, noBusiness } = useBusinessId();
  const businessId = resolvedBusinessId || search.get('b') || '';
  const fromAgenda = search.get('from') === 'agenda';
  const workspace = useWorkspace();
  // Mesma régua do botão "Novo cliente" de Clientes e do servidor (POST).
  const unitScope = !workspace.agendaScope || workspace.agendaScope === 'all';

  const [draft, setDraft] = useState<BookingReturnDraft | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  useEffect(() => {
    if (!businessId) return;
    setDraft(fromAgenda ? readBookingReturn(businessId) : null);
    setDraftReady(true);
  }, [businessId, fromAgenda]);
  // Retorno ao agendamento só existe quando há rascunho válido da mesma unidade.
  const returnToBooking = fromAgenda && !!draft;

  // Veterinária: classificada pelo servidor (fonte de verdade), nunca presumida.
  const [vet, setVet] = useState<{ status: 'loading' | 'ready' | 'error'; isVet: boolean; message: string }>({ status: 'loading', isVet: false, message: '' });
  const [vetRetry, setVetRetry] = useState(0);
  useEffect(() => {
    if (!businessId || !unitScope) return;
    let on = true;
    setVet({ status: 'loading', isVet: false, message: '' });
    apiGet<{ vet?: boolean }>(`/api/pets?businessId=${encodeURIComponent(businessId)}`, { scope: 'area', area: 'Clientes' })
      .then((r) => {
        if (!on) return;
        if (r.ok) setVet({ status: 'ready', isVet: !!r.data?.vet, message: '' });
        else setVet({ status: 'error', isVet: false, message: r.message || 'Não foi possível identificar o tipo da unidade.' });
      })
      .catch(() => { if (on) setVet({ status: 'error', isVet: false, message: 'Não foi possível identificar o tipo da unidade.' }); });
    return () => { on = false; };
  }, [businessId, unitScope, vetRetry]);

  // Pós-salvamento: a ficha é resolvida e a página segue para ela sozinha.
  const [opening, setOpening] = useState<OpeningState | null>(null);
  const [openAttempt, setOpenAttempt] = useState(0);
  const [openFailed, setOpenFailed] = useState(false);
  useEffect(() => {
    if (!opening || !businessId) return;
    let on = true;
    setOpenFailed(false);
    resolveClientProfileHref(businessId, opening.contactId, opening.phone, opening.returnToBooking)
      .then((href) => {
        if (!on) return;
        if (href) router.replace(href);
        else setOpenFailed(true);
      })
      .catch(() => { if (on) setOpenFailed(true); });
    return () => { on = false; };
  }, [opening, openAttempt, businessId, router]);

  const goCancel = useCallback(() => {
    if (returnToBooking) { router.push(continueBookingHref(businessId)); return; }
    if (fromAgenda) { router.push(`/agenda?b=${encodeURIComponent(businessId)}`); return; }
    router.push(clientListReturnHref(readClientsListQuery(businessId), businessId));
  }, [businessId, fromAgenda, returnToBooking, router]);

  const backLabel = fromAgenda ? 'Voltar para o agendamento' : 'Voltar para clientes';
  // Este link só existe fora do formulário (estados de acesso/carregamento). Dentro
  // do formulário, o link é renderizado por NewClientForm e usa a guarda de descarte.
  const back = businessId ? <PageBackAction onClick={goCancel} label={backLabel} /> : null;

  // ── Estados explícitos: loading · ready · empty · error ──
  if (noBusiness) {
    return (
      <div className="space-y-3">
        <div className="ws-panel p-6">
          <h1 className="text-[22px] font-semibold text-[var(--text)]">Novo cliente</h1>
          <p className="text-[13px] text-[var(--text-muted)] mt-1.5">Sua conta ainda não tem uma unidade ativa.</p>
        </div>
      </div>
    );
  }
  if (resolving || !draftReady) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-64 w-full max-w-[720px]" />
      </div>
    );
  }
  if (!unitScope) {
    return (
      <div className="space-y-3">
        {back}
        <Notice tone="info" title="Cadastro de novos clientes">
          O cadastro de novos clientes é feito pela recepção. Você acessa os pacientes clínicos permitidos da unidade pela lista de clientes.
        </Notice>
      </div>
    );
  }
  if (vet.status === 'loading') {
    return (
      <div className="space-y-3" aria-busy="true">
        {back}
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-64 w-full max-w-[720px]" />
      </div>
    );
  }
  if (vet.status === 'error') {
    return (
      <div className="space-y-3">
        {back}
        <AreaLoadError area="Clientes" message={vet.message} onRetry={() => setVetRetry((n) => n + 1)} />
      </div>
    );
  }

  // Cadastro gravado: a tela só mostra o estado de abertura da ficha (sem formulário,
  // portanto sem nada a descartar). Falha → aviso com saídas explícitas.
  if (opening) {
    return (
      <div className="space-y-3" aria-busy={!openFailed} data-client-saved="true" data-client-opening={openFailed ? 'failed' : 'loading'}>
        {openFailed ? (
          <Notice tone="warning" title="Cadastro salvo, mas a ficha não abriu">
            <span className="block">
              Os dados já foram gravados. Tente abrir o Cliente 360 de novo
              {opening.returnToBooking ? ', ou volte ao agendamento com este cliente selecionado.' : '.'}
            </span>
            <span className="mt-3 flex flex-wrap gap-2">
              <Button type="button" variant="primary" size="sm" onClick={() => setOpenAttempt((n) => n + 1)}>Tentar abrir o Cliente 360</Button>
              {opening.returnToBooking ? (
                <Button type="button" variant="secondary" size="sm" onClick={() => router.push(continueBookingHref(businessId))}>Continuar agendamento</Button>
              ) : (
                <Button type="button" variant="secondary" size="sm" onClick={() => router.push(clientListReturnHref(readClientsListQuery(businessId), businessId))}>Voltar para clientes</Button>
              )}
            </span>
          </Notice>
        ) : (
          <Notice tone="success" title="Cadastro salvo" live>
            <span className="block">Abrindo o Cliente 360…</span>
          </Notice>
        )}
      </div>
    );
  }

  // Rascunho do agendamento: o nome/telefone digitados na busca viram o prefill.
  const draftQuery = draft?.query.trim() || '';
  const draftDigits = onlyDigits(draftQuery);
  const initialName = draftDigits.length >= 10 ? '' : draftQuery;
  const initialPhone = draftDigits.length >= 10 ? draftQuery : '';

  const onSaved = (contactId: string, result: NewClientResult) => {
    if (returnToBooking && draft) {
      // Tutor/pet recém-criados entram no agendamento em andamento.
      const next = withRegisteredClient(draft, { contactId, petId: result.petId, name: result.name, phone: result.phone });
      writeBookingReturn(next);
      setDraft(next);
    }
    setOpening({ contactId, phone: result.phone || '', returnToBooking });
  };

  const openExisting = (contact: { id: string; name: string; phone: string }) => {
    const digits = onlyDigits(contact.phone);
    if (returnToBooking && draft) {
      // Duplicidade no agendamento: usa o cadastro que já existe, sem criar outro.
      writeBookingReturn(withRegisteredClient(draft, { contactId: contact.id, petId: '', name: contact.name, phone: digits }));
      router.push(continueBookingHref(businessId));
      return;
    }
    setOpening({ contactId: contact.id, phone: digits, returnToBooking: false });
  };

  return (
    <NewClientForm
      businessId={businessId}
      vetMode={vet.isVet}
      initialName={initialName}
      initialPhone={initialPhone}
      backLabel={businessId ? backLabel : undefined}
      onCancel={goCancel}
      onSaved={onSaved}
      onOpenExisting={openExisting}
      existingActionLabel={returnToBooking ? 'Usar este cliente no agendamento' : 'Abrir cadastro existente'}
    />
  );
}
