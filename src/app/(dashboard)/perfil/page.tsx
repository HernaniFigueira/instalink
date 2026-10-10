'use client';
// ═══════════════════════════════════════════════════════════════
// MEU PERFIL — foto, nome, contato, cargo e dados profissionais
// ═══════════════════════════════════════════════════════════════
// Rota do USUÁRIO (login), não da unidade. "Também atende" cria/vincula
// Professional a este User sem unir as entidades.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge, Button, buttonCls, Field, FormSection, Input, Notice, PageHeader, PageSkeleton, Textarea } from '@/components/ui';
import { ImageUpload } from '@/components/dashboard/ImageUpload';
import { apiGet, apiSend } from '@/lib/api-client';
import { Icon } from '@/components/icons';
import { roleLabel as accessRoleLabel } from '@/lib/role-labels';
import { usePanelPermissions } from '@/components/dashboard/usePanelPermissions';

interface MeProfile {
  id: string; name: string; email: string; role: string;
  phone: string; photo: string; title: string; conselho: string;
  professionalBio: string; createdAt: string; lastLoginAt: string;
}

export default function MeuPerfilPage() {
  // A unidade/papel abaixo vêm da mesma projeção que o shell recebe do
  // servidor. O parâmetro da URL sozinho nunca decide o que este perfil diz.
  const {
    businessId,
    role: unitRole,
    professionalId,
    professionalName,
    ready: accessReady,
  } = usePanelPermissions();
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [linking, setLinking] = useState(false);
  // Apenas o resultado recém-criado localmente. O vínculo já existente vem
  // do contexto autorizado da unidade ativa, não de estado persistido nesta
  // tela nem do papel global da conta.
  const [linkedPro, setLinkedPro] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    setLinkedPro(null);
  }, [businessId]);

  // Form local (edita e salva em um passo)
  const [form, setForm] = useState({ name: '', email: '', phone: '', photo: '', title: '', conselho: '', professionalBio: '' });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    apiGet<{ user: MeProfile }>(`/api/account`, { scope: 'area', area: 'Perfil' })
      .then((res) => {
        const u = res.data?.user;
        if (u) {
          setForm({
            name: u.name, email: u.email, phone: u.phone || '', photo: u.photo || '',
            title: u.title || '', conselho: u.conselho || '', professionalBio: u.professionalBio || '',
          });
        }
      })
      .catch(() => setErr('Não foi possível carregar o perfil.'))
      .finally(() => setLoaded(true));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setErr(''); setMsg('');
    try {
      const res = await apiSend<{ user?: MeProfile; error?: string }>(
        '/api/account', 'PATCH', form, { scope: 'area', area: 'Perfil' },
      );
      if (res.ok && res.data?.user) {
        setMsg('Perfil salvo.');
      } else {
        setErr(res.data?.error || res.message || 'Não foi possível salvar.');
      }
    } catch {
      setErr('Não foi possível salvar o perfil.');
    } finally {
      setSaving(false);
    }
  }

  async function linkAsProfessional() {
    if (!businessId) {
      setErr('Escolha uma unidade ativa para criar um vínculo clínico.');
      return;
    }
    setLinking(true); setErr(''); setMsg('');
    try {
      const res = await apiSend('/api/account', 'POST', {
        action: 'link_as_professional', businessId,
        professionalName: form.title ? `${form.name}` : `Dr. ${form.name}`,
      }, { scope: 'action', area: 'Profissionais' });
      if (res.data?.professional) {
        setLinkedPro(res.data.professional);
        // Atualiza a projeção visual do shell; não muda papel, permissões ou
        // escopo no cliente — o servidor continua sendo a autoridade.
        window.dispatchEvent(new Event('godoutor:business-refresh'));
        setMsg(res.data.alreadyLinked
          ? `Você já é ${res.data.professional.name} nesta unidade.`
          : `Criado e vinculado: ${res.data.professional.name}. Edite o nome/cargo em Profissionais.`);
      } else setErr(res.data?.error || 'Não foi possível vincular.');
    } catch {
      setErr('Não foi possível vincular o profissional.');
    } finally {
      setLinking(false);
    }
  }

  if (!loaded) return <PageSkeleton />;

  const officialRole = accessRoleLabel(unitRole);
  const activeLinkedProfessional = linkedPro || (professionalId
    ? { id: professionalId, name: professionalName || 'Profissional vinculado' }
    : null);
  const unitContextLabel = !accessReady
    ? 'Carregando unidade…'
    : businessId
      ? officialRole || 'Equipe'
      : 'Escolha uma unidade';

  return (
    <div className="space-y-4 pb-10">
      <PageHeader icon="userCircle" title="Meu perfil"
        hint="Sua conta de acesso e sua identidade profissional na clínica." />

      {msg && <Notice tone="success" className="mb-4">{msg}</Notice>}
      {err && <Notice tone="warning" className="mb-4">{err}</Notice>}

      <form onSubmit={save} className="space-y-4">
        <FormSection title="Dados pessoais" hint="Informações da sua conta de acesso.">
          {businessId ? (
            <ImageUpload label="FOTO DE PERFIL" value={form.photo} onChange={(url) => set('photo', url)}
              businessId={businessId} circle previewH="h-24" />
          ) : (
            <Field label="Foto de perfil — URL" htmlFor="pf-photo">
              <Input id="pf-photo" value={form.photo} onChange={(e) => set('photo', e.target.value)} placeholder="https://…" />
            </Field>
          )}

          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Nome" htmlFor="pf-name">
              <Input id="pf-name" required value={form.name} onChange={(e) => set('name', e.target.value)} />
            </Field>
            <Field label="E-mail da conta" htmlFor="pf-email">
              <Input id="pf-email" type="email" required value={form.email} onChange={(e) => set('email', e.target.value)} />
            </Field>
            <Field label="Telefone / WhatsApp" htmlFor="pf-phone">
              <Input id="pf-phone" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="(21) 99999-0000" />
            </Field>
            <div className="space-y-1.5" data-profile-unit-access>
              <span className="block text-xs font-semibold text-[var(--text-muted)]">Papel de acesso nesta unidade</span>
              <Badge tone="blue" title="Papel de acesso da unidade ativa — não é o cargo profissional">
                {unitContextLabel}
              </Badge>
              <p className="text-xs text-[var(--text-muted)]">
                {businessId
                  ? 'Define o que esta conta pode acessar nesta unidade; não é um cargo clínico.'
                  : 'Selecione uma unidade no painel para ver o papel de acesso aplicável.'}
              </p>
            </div>
          </div>
        </FormSection>

        <FormSection title="Identidade profissional" hint="Cargo e credenciais profissionais são diferentes do papel de acesso.">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Cargo / função" htmlFor="pf-title" hint="Opcional">
              <Input id="pf-title" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Ex.: Médica veterinária responsável" />
            </Field>
            <Field label="Conselho profissional" htmlFor="pf-conselho" hint="Opcional">
              <Input id="pf-conselho" value={form.conselho} onChange={(e) => set('conselho', e.target.value)} placeholder="Ex.: CRMV 123456" />
            </Field>
          </div>
          <Field label="Formação e especialidades" htmlFor="pf-bio" hint="Identificação profissional. Não altera permissões de acesso.">
            <Textarea id="pf-bio" rows={3} value={form.professionalBio} onChange={(e) => set('professionalBio', e.target.value)} />
          </Field>

          <div className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-4" data-profile-clinical-link>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold">Também realiza atendimentos</h3>
              <span className="text-xs text-[var(--text-muted)]">· vínculo clínico nesta unidade</span>
            </div>
            {activeLinkedProfessional ? (
              <>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge tone="green">Vinculado à equipe clínica</Badge>
                  <span className="text-xs text-[var(--text-muted)]">
                    Profissional: <strong className="text-[var(--text)]">{activeLinkedProfessional.name}</strong>
                  </span>
                </div>
                <p className="text-xs text-[var(--text-muted)] mt-2 leading-relaxed">
                  Você aparece na agenda desta unidade. Esse vínculo não altera seu papel de acesso nem suas permissões.
                </p>
              </>
            ) : (
              <>
                <div className="mt-2"><Badge tone="zinc">Sem vínculo clínico nesta unidade</Badge></div>
                <p className="text-xs text-[var(--text-muted)] mt-2 leading-relaxed">
                  Vincule seu perfil à equipe clínica para aparecer na agenda. O papel de acesso{officialRole ? ` de ${officialRole}` : ''} não cria esse vínculo automaticamente.
                </p>
              </>
            )}
            <div className="mt-3">
              {activeLinkedProfessional && businessId ? (
                <Link href={`/equipe?b=${encodeURIComponent(businessId)}`} className={buttonCls('secondary')}>
                  Gerenciar na Equipe
                </Link>
              ) : (
                <Button type="button" variant="secondary" disabled={linking || !businessId || !accessReady} onClick={linkAsProfessional}>
                  {linking ? 'Vinculando…' : 'Vincular à equipe clínica'}
                </Button>
              )}
              {!businessId && (
                <p className="text-[11px] text-[var(--text-muted)] mt-1.5">
                  {accessReady ? 'Escolha uma unidade no painel para vincular.' : 'Carregando a unidade ativa…'}
                </p>
              )}
            </div>
          </div>
        </FormSection>

        <div className="flex justify-end pt-3">
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? 'Salvando…' : 'Salvar alterações'}
          </Button>
        </div>
      </form>



      <FormSection title="Segurança" hint="A senha continua sendo gerenciada pela autenticação existente da sua conta.">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-[var(--text-muted)]">Altere a senha da mesma conta de acesso.</p>
          <Link href={`/alterar-senha${businessId ? `?b=${encodeURIComponent(businessId)}` : ''}`} className={buttonCls('secondary')}>
            <Icon n="lock" size={15} /> Alterar senha
          </Link>
        </div>
      </FormSection>
    </div>
  );
}
