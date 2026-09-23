'use client';
// ═══════════════════════════════════════════════════════════════
// MEU PERFIL — foto, nome, contato, cargo e dados profissionais
// ═══════════════════════════════════════════════════════════════
// Rota do USUÁRIO (login), não da unidade. "Também atende" cria/vincula
// Professional a este User sem unir as entidades.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Avatar, Button, Field, Input, Notice, PageHeader, PageSkeleton, Textarea } from '@/components/ui';
import { Icon } from '@/components/icons';
import { ImageUpload } from '@/components/dashboard/ImageUpload';
import { apiGet, apiSend } from '@/lib/api-client';

interface MeProfile {
  id: string; name: string; email: string; role: string;
  phone: string; photo: string; title: string; conselho: string;
  professionalBio: string; createdAt: string; lastLoginAt: string;
}

export default function MeuPerfilPage() {
  const params = useSearchParams();
  const businessId = params.get('b') || '';
  const [me, setMe] = useState<MeProfile | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [linking, setLinking] = useState(false);
  const [linkedPro, setLinkedPro] = useState<{ id: string; name: string } | null>(null);

  // Form local (edita e salva em um passo)
  const [form, setForm] = useState({ name: '', email: '', phone: '', photo: '', title: '', conselho: '', professionalBio: '' });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    apiGet<{ user: MeProfile }>(`/api/account`, { scope: 'area', area: 'Perfil' })
      .then((res) => {
        const u = res.data?.user;
        if (u) {
          setMe(u);
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
        setMe(res.data.user);
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
    if (!businessId) { setErr('Abra esta tela a partir de uma unidade (parâmetro ?b=).'); return; }
    setLinking(true); setErr(''); setMsg('');
    try {
      const res = await apiSend('/api/account', 'POST', {
        action: 'link_as_professional', businessId,
        professionalName: form.title ? `${form.name}` : `Dr. ${form.name}`,
      }, { scope: 'action', area: 'Profissionais' });
      if (res.data?.professional) {
        setLinkedPro(res.data.professional);
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

  const roleLabel = me?.role === 'master' ? 'Master' : me?.role === 'admin' ? 'Admin' : 'Proprietário';

  return (
    <div className="max-w-[720px] mx-auto pb-10">
      <PageHeader icon="userCircle" title="Meu perfil"
        hint="Dados da sua conta de acesso — a topbar usa a foto quando presente." />

      {msg && <Notice tone="success" className="mb-4">{msg}</Notice>}
      {err && <Notice tone="warning" className="mb-4">{err}</Notice>}

      <form onSubmit={save} className="bg-white border border-[var(--border)] rounded-lg p-5 space-y-4">
        <div className="flex items-center gap-4">
          <Avatar name={form.name || me?.name || '?'} src={form.photo || undefined} size={72} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">{form.name || me?.name}</p>
            <p className="text-xs text-[var(--text-muted)]">{roleLabel} · {me?.email}</p>
          </div>
        </div>

        {businessId && (
          <ImageUpload label="FOTO DE PERFIL" value={form.photo} onChange={(url) => set('photo', url)}
            businessId={businessId} circle previewH="h-24" />
        )}
        {!businessId && (
          <Field label="URL da foto" htmlFor="pf-photo">
            <Input id="pf-photo" value={form.photo} onChange={(e) => set('photo', e.target.value)}
              placeholder="https://…" />
          </Field>
        )}

        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Nome" htmlFor="pf-name">
            <Input id="pf-name" required value={form.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="E-mail" htmlFor="pf-email">
            <Input id="pf-email" type="email" required value={form.email} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <Field label="Telefone / WhatsApp" htmlFor="pf-phone">
            <Input id="pf-phone" value={form.phone} onChange={(e) => set('phone', e.target.value)}
              placeholder="(21) 99999-0000" />
          </Field>
          <Field label="Cargo" htmlFor="pf-title">
            <Input id="pf-title" value={form.title} onChange={(e) => set('title', e.target.value)}
              placeholder="Ex.: Clínico responsável" />
          </Field>
          <Field label="Conselho (CRM, CRO…)" htmlFor="pf-conselho" hint="Opcional">
            <Input id="pf-conselho" value={form.conselho} onChange={(e) => set('conselho', e.target.value)}
              placeholder="CRM 123456" />
          </Field>
        </div>

        <Field label="Dados profissionais" htmlFor="pf-bio" hint="Formação, especialidades — aparece na sua identificação.">
          <Textarea id="pf-bio" rows={3} value={form.professionalBio} onChange={(e) => set('professionalBio', e.target.value)} />
        </Field>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? 'Salvando…' : 'Salvar perfil'}
          </Button>
        </div>
      </form>

      {/* Também atende — vínculo User → Professional, sem unir entidades */}
      <section className="bg-white border border-[var(--border)] rounded-lg p-5 mt-5">
        <h2 className="text-sm font-bold flex items-center gap-2">
          <Icon n="idcard" size={16} /> Também atende pacientes
        </h2>
        <p className="text-xs text-[var(--text-muted)] mt-1.5 leading-relaxed">
          Cria (ou reutiliza) um <strong>Profissional</strong> vinculado ao <strong>seu login</strong> nesta unidade.
          As duas entidades continuam separadas: seu acesso é o User; quem atende na agenda é o Professional.
        </p>
        {linkedPro && (
          <p className="text-xs mt-2 text-[var(--success-fg)]">
            Vinculado: <strong>{linkedPro.name}</strong> ·{' '}
            <Link href={`/profissionais?b=${businessId}`} className="underline">abrir Profissionais</Link>
          </p>
        )}
        <div className="mt-3">
          <Button type="button" variant="secondary" disabled={linking || !businessId} onClick={linkAsProfessional}>
            {linking ? 'Vinculando…' : linkedPro ? 'Gerenciar em Profissionais' : 'Também atende pacientes'}
          </Button>
          {!businessId && (
            <p className="text-[11px] text-[var(--text-muted)] mt-1.5">
              Abra o perfil a partir de uma unidade para vincular.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
