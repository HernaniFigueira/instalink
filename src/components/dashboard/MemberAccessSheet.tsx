'use client';
// ═══════════════════════════════════════════════════════════════
// A3.4 · ACESSO AO SISTEMA — um componente, duas portas
// ═══════════════════════════════════════════════════════════════
// PROFISSIONAL ("quem atende") e EQUIPE ("quem entra no sistema") são conceitos
// SEPARADOS no domínio — e continuam separados. O que não existe é obrigar a
// pessoa a digitar a mesma gente duas vezes:
//
//   • aberto a partir de /profissionais → o profissional já está escolhido
//     (papel PROFISSIONAL, nome e foto vêm do Professional);
//   • aberto em /equipe → escolhe-se o papel; se o papel for PROFISSIONAL, a
//     tela PRIMEIRO oferece vincular um profissional existente SEM acesso
//     (a lista só mostra `userId === ''`), depois pede a credencial.
//
// Quem grava é /api/team (o vínculo User→Professional mora lá, com as guardas
// de 1:1 por unidade). Este componente não cria uma segunda rota de verdade.
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Avatar, Button, Checkbox, Drawer, Field, Input, Notice, Select, SubCard } from '@/components/ui';
import { apiSend } from '@/lib/api-client';
import { useForbiddenNotice } from '@/components/dashboard/AccessNotice';
import type { MemberRole } from '@/lib/types';

export interface ProfessionalOption {
  id: string;
  name: string;
  role: string;
  active: boolean;
  /** '' = sem acesso ao sistema (candidato a vínculo). */
  userId: string;
  photo?: string;
  linkedUserName?: string;
}

export interface MemberAccessSheetProps {
  open: boolean;
  businessId: string;
  onClose: () => void;
  onCreated: (message: string) => void;
  professionals: ProfessionalOption[];
  /** Profissional já escolhido (fluxo "criar acesso" a partir do profissional). */
  professionalId?: string;
  /** Nome inicial (vem do Professional quando há vínculo declarado). */
  initialName?: string;
  /** Papel inicial. Sem profissional escolhido, o padrão é Secretária. */
  initialRole?: MemberRole;
}

const ROLE_OPTIONS: Array<{ id: MemberRole; label: string; hint: string }> = [
  { id: 'SECRETARIA', label: 'Secretária', hint: 'Agenda, clientes, leads e WhatsApp' },
  { id: 'ATENDENTE', label: 'Atendente', hint: 'Agenda, clientes e WhatsApp' },
  { id: 'ADMIN', label: 'Administrador', hint: 'Acesso total, exceto administração da plataforma' },
  { id: 'PROFISSIONAL', label: 'Profissional', hint: 'Vê somente a própria agenda e os clientes da unidade' },
  { id: 'VENDEDOR', label: 'Vendedor', hint: 'Clientes, leads e campanhas' },
  { id: 'VIEWER', label: 'Visualizador', hint: 'Somente leitura do resumo' },
];

/** Permissões padrão de cada papel (espelho do catálogo do servidor — rótulo). */
const ROLE_PERMISSION_LABEL: Record<string, string> = {
  SECRETARIA: 'Início · Agenda · Clientes · Leads · Pedidos · WhatsApp · Assistente',
  ATENDENTE: 'Início · Agenda · Clientes · WhatsApp · Assistente',
  ADMIN: 'todas, exceto administração da plataforma',
  PROFISSIONAL: 'Início · Agenda · Clientes',
  VENDEDOR: 'Início · Clientes · Leads · WhatsApp · Campanhas',
  VIEWER: 'somente leitura do resumo',
};

export function MemberAccessSheet({
  open, businessId, onClose, onCreated, professionals,
  professionalId: presetProfessionalId = '', initialName = '', initialRole,
}: MemberAccessSheetProps) {
  const { notice: forbidden, dismiss } = useForbiddenNotice('Equipe');
  const [role, setRole] = useState<MemberRole>(initialRole || (presetProfessionalId ? 'PROFISSIONAL' : 'SECRETARIA'));
  const [professionalId, setProfessionalId] = useState(presetProfessionalId);
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [note, setNote] = useState('');
  const [grantEncounter, setGrantEncounter] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Só profissionais SEM acesso entram na lista: oferecer alguém que já tem
  // login levaria a um segundo acesso apontando para a mesma pessoa.
  const freeProfessionals = useMemo(
    () => professionals.filter((p) => !p.userId && p.active !== false),
    [professionals],
  );
  const presetProfessional = professionals.find((p) => p.id === professionalId) || null;
  const roleLabel = ROLE_OPTIONS.find((r) => r.id === role)?.label || role;

  async function save() {
    setError('');
    if (!name.trim()) { setError('Informe o nome de quem vai entrar no sistema.'); return; }
    if (!email.includes('@')) { setError('Informe um e-mail válido.'); return; }
    if (password.length < 6) { setError('A senha precisa de ao menos 6 caracteres.'); return; }
    if (role === 'PROFISSIONAL' && !professionalId) {
      setError('Escolha qual profissional este acesso representa — ou cadastre o profissional primeiro.');
      return;
    }
    setBusy(true);
    const res = await apiSend<{ linkedExistingUser?: boolean }>('/api/team', 'POST', {
      businessId, name, email, password, role, note, professionalId,
      ...(grantEncounter ? { permissions: { atendimento: true } } : {}),
    }, { scope: 'action', area: 'Equipe' });
    setBusy(false);
    if (!res.ok) { setError(res.message); return; }
    const linkedPro = professionals.find((p) => p.id === professionalId);
    onCreated(
      role === 'PROFISSIONAL' && linkedPro
        ? `Acesso criado e vinculado a ${linkedPro.name} — essa pessoa vê somente a própria agenda.`
        : res.data?.linkedExistingUser
          ? 'Acesso liberado — a pessoa já tinha login e agora entra nesta unidade.'
          : 'Acesso criado. Envie e-mail e senha para /login.',
    );
    onClose();
  }

  return (
    <Drawer open={open} onClose={onClose} title="Criar acesso ao sistema"
      subtitle={presetProfessional ? `Profissional: ${presetProfessional.name}` : 'Quem entra no painel — não é a mesma lista de quem atende'}
      width="max-w-[560px]">
      <div className="p-4 space-y-4">
        {forbidden && <Notice tone="warning" title={forbidden.title}>{forbidden.hint}</Notice>}
        {forbidden && <button type="button" onClick={dismiss} className="text-xs font-semibold underline text-[var(--text-muted)]">Fechar aviso</button>}

        {presetProfessional ? (
          <SubCard className="p-3 flex items-center gap-3">
            <Avatar name={presetProfessional.name} src={presetProfessional.photo || undefined} size={40} />
            <span className="min-w-0">
              <span className="block text-sm font-semibold truncate">{presetProfessional.name}</span>
              <span className="block text-xs text-[var(--text-muted)]">
                {presetProfessional.role || 'Profissional'} · o acesso é vinculado a este cadastro (nada de pessoa duplicada)
              </span>
            </span>
          </SubCard>
        ) : (
          <Field label="Papel" hint={ROLE_OPTIONS.find((r) => r.id === role)?.hint}>
            <Select value={role} onChange={(e) => setRole(e.target.value as MemberRole)}>
              {ROLE_OPTIONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </Select>
          </Field>
        )}

        {/* Papel PROFISSIONAL: primeiro VINCULAR, depois credencial. */}
        {role === 'PROFISSIONAL' && !presetProfessional && (
          <div className="space-y-2">
            <Field label="Vincular profissional existente" required>
              <Select value={professionalId} onChange={(e) => {
                const id = e.target.value;
                setProfessionalId(id);
                const pro = professionals.find((p) => p.id === id);
                if (pro && !name.trim()) setName(pro.name);
              }}>
                <option value="">Escolha o profissional…</option>
                {freeProfessionals.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}{p.role ? ` · ${p.role}` : ''}</option>
                ))}
              </Select>
            </Field>
            <p className="text-xs text-[var(--text-muted)]">
              A lista mostra apenas profissionais <strong>sem acesso ao sistema</strong>.{' '}
              <Link href={`/profissionais?b=${businessId}`} className="font-semibold underline">Cadastrar/editar profissionais</Link>
            </p>
          </div>
        )}

        <Field label="Nome" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Orlando Pires" autoComplete="off" />
        </Field>
        <Field label="E-mail de acesso" required>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@empresa.com" autoComplete="off" />
        </Field>
        <Field label="Senha inicial" required hint="Mínimo de 6 caracteres — a pessoa troca depois no /login.">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </Field>
        <Field label="Observação interna" hint="Opcional — aparece só para quem administra a equipe.">
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Ex: atende de terça a quinta" />
        </Field>

        <SubCard className="p-3">
          <p className="text-xs font-semibold text-[var(--text)]">O papel {roleLabel} já vem com: {ROLE_PERMISSION_LABEL[role]}</p>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Permissões individuais podem ser ajustadas depois, na lista da equipe.
          </p>
          {/* A3.4 (Bloco 5): o registro do atendimento é dado próprio e NÃO vem
              por padrão para quem não atende. Aqui o admin concede de forma
              explícita, no ato da criação. */}
          <div className="mt-2.5">
            <Checkbox checked={grantEncounter} onChange={setGrantEncounter}
              label="Conceder acesso ao registro de atendimento"
              hint="Por padrão só o profissional (e o administrador) leem o conteúdo do atendimento." />
          </div>
        </SubCard>

        {error && <Notice tone="error">{error}</Notice>}
      </div>

      <div className="px-4 pb-4 flex items-center justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>Cancelar</Button>
        <Button variant="primary" size="sm" onClick={save} disabled={busy}>
          {busy ? 'Criando acesso…' : 'Criar acesso'}
        </Button>
      </div>
    </Drawer>
  );
}
