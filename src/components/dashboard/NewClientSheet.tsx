'use client';
// ═══════════════════════════════════════════════════════════════
// CADASTRO REAL de paciente/tutor — UMA experiência única.
// Usada em Clientes (Quick Create) e DENTRO do Novo agendamento.
// Salva NO CRM de imediato (POST /api/contacts) — abandone o
// agendamento depois e o cadastro permanece.
//
// HOMOLOGAÇÃO · FASE 2 fechamento:
//   • WorkspaceSheet (padrão operacional do GoDoutor);
//   • clinicType veterinária → Tutor + Paciente (pet) na MESMA tela;
//   • nascimento <18 (humano) → Responsável legal (contato vinculado,
//     aditivo em profile.guardian — nunca um "segundo paciente").
// ═══════════════════════════════════════════════════════════════
import { useEffect, useState } from 'react';
import { apiSend } from '@/lib/api-client';
import { onlyDigits } from '@/lib/utils';
import { emailError, normalizeEmail, phoneError } from '@/lib/field-quality';
import { ageFromBirthDate } from '@/lib/contact-profile';
import { PhoneBRInput } from '@/components/dashboard/PhoneBRInput';
import { WorkspaceSheet } from '@/components/dashboard/WorkspaceSheet';
import { Button, Field, Input, Notice, Select, Textarea } from '@/components/ui';
import { PET_SPECIES, PET_SPECIES_LABELS, breedSuggestions, validatePet } from '@/lib/pets';
import type { Pet } from '@/lib/types';

interface SavedContact {
  id: string;
  accountStatus?: 'none' | 'active';
}

interface SaveResponse {
  ok?: boolean;
  contact?: SavedContact;
  temporaryPassword?: string;
  access?: { status?: string; temporaryCredentialIssued?: boolean };
}

export interface NewClientResult {
  contactId: string;
  petId?: string;
}

export function NewClientSheet({
  businessId,
  onClose,
  onSaved,
  onView360,
  /** Veterinária: bloco "Paciente (pet)" logo abaixo do Tutor. */
  vetMode = false,
  /** Prefill do nome/telefone quando o fluxo nasce na busca do agendamento. */
  initialName = '',
  initialPhone = '',
  title,
}: {
  businessId: string;
  onClose: () => void;
  onSaved: (contactId: string, extra?: NewClientResult) => void;
  onView360?: () => void;
  vetMode?: boolean;
  initialName?: string;
  initialPhone?: string;
  title?: string;
}) {
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [createAccess, setCreateAccess] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<SaveResponse | null>(null);
  const [savedResult, setSavedResult] = useState<NewClientResult | null>(null);

  // Responsável legal — só humana e só quando a idade < 18.
  const age = ageFromBirthDate(birthDate);
  const showGuardian = !vetMode && age !== null && age >= 0 && age < 18;
  const [guardian, setGuardian] = useState({ name: '', relationship: '', phone: '', email: '', cpf: '' });

  // Pet (só veterinária) — persistido na MESMA experiência do tutor.
  const [petOn, setPetOn] = useState(false);
  const [pet, setPet] = useState({ name: '', species: 'cachorro', breed: '', sex: '', birthDate: '', weightKg: '' as string | number, notes: '' });

  useEffect(() => {
    if (initialName && !name) setName(initialName);
    if (initialPhone && !phone) setPhone(initialPhone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialName, initialPhone]);

  async function save() {
    if (saving) return;
    setError('');
    if (!name.trim()) { setError('Informe o nome do cliente.'); return; }
    const phoneMsg = phoneError(phone, { required: true });
    if (phoneMsg) { setError(phoneMsg); return; }
    const emailMsg = emailError(email);
    if (emailMsg) { setError(emailMsg); return; }
    if (vetMode && petOn) {
      const petMsg = validatePet(pet);
      if (petMsg) { setError(petMsg); return; }
    }
    if (showGuardian) {
      if (!guardian.name.trim()) { setError('Informe o nome do responsável legal.'); return; }
      if (!guardian.relationship.trim()) { setError('Informe o parentesco com o paciente.'); return; }
      const gPhone = phoneError(guardian.phone, { required: true });
      if (gPhone) { setError(`Responsável — ${gPhone}`); return; }
      const gEmail = emailError(guardian.email);
      if (gEmail) { setError(`Responsável — ${gEmail}`); return; }
    }
    if (createAccess && !email.trim() && onlyDigits(phone).length < 10) {
      setError('Para criar acesso, informe um e-mail ou WhatsApp válido.'); return;
    }

    setSaving(true);
    // Perfil aditivo: nascimento (+ responsável quando menor). Campos
    // ausentes são preservados pelo normalizador do servidor.
    const profile: Record<string, unknown> = {};
    if (birthDate) profile.birthDate = birthDate;
    if (showGuardian) {
      profile.guardian = {
        isMinor: true,
        name: guardian.name.trim(),
        relationship: guardian.relationship.trim(),
        phone: onlyDigits(guardian.phone),
        cpf: onlyDigits(guardian.cpf),
        email: normalizeEmail(guardian.email),
      };
    }

    const res = await apiSend<SaveResponse>('/api/contacts', 'POST', {
      businessId,
      name: name.trim(),
      phone: onlyDigits(phone),
      email: normalizeEmail(email),
      note: note.trim() || undefined,
      marketingOptIn,
      createAccount: createAccess,
      source: 'manual',
      ...(Object.keys(profile).length ? { profile } : {}),
    }, { scope: 'action', area: 'Clientes' });
    if (!res.ok || !res.data?.contact) {
      setSaving(false);
      setError(res.message || 'Não foi possível salvar o cliente.');
      return;
    }
    const contactId = res.data.contact.id;

    // Veterinária: pet na MESMA experiência — criado e vinculado ao tutor.
    let petId: string | undefined;
    if (vetMode && petOn) {
      const petRes = await apiSend<{ ok?: boolean; pet?: Pet }>('/api/pets', 'POST', {
        action: 'create', businessId, tutorId: contactId, pet: {
          name: pet.name, species: pet.species, breed: pet.breed, sex: pet.sex,
          birthDate: pet.birthDate, weightKg: pet.weightKg === '' ? 0 : Number(pet.weightKg),
          notes: pet.notes,
        },
      }, { scope: 'action', area: 'Agenda' });
      if (!petRes.ok || !petRes.data?.pet) {
        setSaving(false);
        setError(petRes.message || 'Tutor salvo, mas não foi possível salvar o pet.');
        setSavedResult({ contactId });
        setSaved(res.data!);
        return;
      }
      petId = petRes.data.pet.id;
    }

    setSaving(false);
    setSavedResult(petId ? { contactId, petId } : { contactId });
    setSaved(res.data);
    onSaved(contactId, petId ? { contactId, petId } : { contactId });
  }

  const input = 'w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-900 focus:border-zinc-900';
  const label = 'block text-xs font-semibold tracking-wide uppercase text-zinc-500';

  return (
    <WorkspaceSheet
      open
      onClose={() => { if (!saving) onClose(); }}
      title={title || (vetMode ? 'Cadastrar tutor e paciente' : 'Novo cliente')}
      subtitle={saved
        ? 'Cadastro salvo na base de clientes.'
        : vetMode
          ? 'Tutor = contato · Paciente = pet. Tudo no CRM agora — não depende do agendamento.'
          : 'Cadastro direto no CRM — se abandonar o agendamento, o cliente permanece.'}
      icon="users"
      width="max-w-[520px]"
      footer={!saved ? (
        <div className="flex w-full gap-2 justify-end">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button variant="primary" onClick={save} disabled={saving}>
            {saving ? 'Salvando…' : vetMode && petOn ? 'Salvar tutor e pet' : 'Salvar cliente'}
          </Button>
        </div>
      ) : undefined}
    >
      {saved ? (
        <div className="px-5 py-6 space-y-4">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4">
            <p className="font-bold text-emerald-900 flex items-center gap-2"><span className="text-lg">✓</span> Cadastro salvo</p>
            <p className="text-sm text-emerald-800 mt-1">O registro está no CRM e permanece mesmo se o agendamento for abandonado.</p>
            {savedResult?.petId && <p className="text-sm text-emerald-800 mt-1">Pet vinculado ao tutor.</p>}
            <p className="text-xs text-emerald-800 mt-2">Consentimento de marketing: {marketingOptIn ? 'concedido' : 'não concedido'}.</p>
            <p className="text-xs text-emerald-800 mt-1">Conta do cliente: {saved.contact?.accountStatus === 'active' ? 'Acesso ativo' : 'Sem acesso'}.</p>
          </div>
          {saved.temporaryPassword ? (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-4 space-y-2">
              <p className="text-sm font-bold text-amber-950">Acesso criado — credencial temporária</p>
              <p className="text-xs text-amber-900">Mostre ou copie esta senha agora. Ela não será exibida novamente e não é uma senha universal.</p>
              <div className="flex gap-2">
                <code className="flex-1 select-all rounded-lg bg-white border border-amber-200 px-3 py-2 text-sm font-bold tracking-wider text-amber-950">{saved.temporaryPassword}</code>
                <button type="button" onClick={() => navigator.clipboard?.writeText(saved.temporaryPassword || '')} className="text-xs font-semibold bg-white border border-amber-300 rounded-lg px-3 py-2 text-amber-950">Copiar</button>
              </div>
            </div>
          ) : createAccess ? (
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-xs text-zinc-700">
              Esta pessoa já tinha uma conta. O acesso foi vinculado sem gerar ou revelar uma nova senha.
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="button" variant="primary" className="flex-1 min-w-[110px]" onClick={onClose}>Voltar</Button>
            {onView360 && (
              <button type="button" onClick={() => { onView360(); onClose(); }} className="flex-1 min-w-[140px] rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm font-semibold text-zinc-800">Ver Cliente 360</button>
            )}
          </div>
        </div>
      ) : (
        <div className="px-5 py-5 space-y-3.5">
          {vetMode && (
            <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--brand-fg)]">Tutor (contato)</p>
          )}
          <label className="block"><span className={label}>NOME *</span>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={input + ' mt-1'} placeholder="Ex.: Bernardo Souza" /></label>
          <label className="block"><span className={label}>WHATSAPP *</span>
            <PhoneBRInput value={phone} onChange={setPhone} className="mt-1" placeholder="(11) 99999-9999" /></label>
          <label className="block"><span className={label}>E-MAIL</span>
            <input value={email} onChange={(e) => setEmail(e.target.value)} className={input + ' mt-1'} inputMode="email" placeholder="Opcional" /></label>
          {!vetMode && (
            <label className="block"><span className={label}>DATA DE NASCIMENTO</span>
              <input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} className={input + ' mt-1'} max="2099-12-31" />
              {showGuardian && <span className="block text-[11px] text-amber-700 mt-1 font-semibold">Paciente com {age} anos — preencha o responsável legal abaixo.</span>}
            </label>
          )}
          <label className="block"><span className={label}>OBSERVAÇÃO</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000} className={input + ' mt-1 resize-none'} placeholder="Opcional — fica no histórico do cliente" /></label>

          {/* ── Responsável legal (humano · menor de 18) ── aditivo, NÃO um segundo paciente. */}
          {showGuardian && (
            <section data-testid="guardian-section" className="rounded-lg border border-amber-200 bg-amber-50/60 p-3.5 space-y-2.5">
              <p className="text-xs font-bold text-amber-950 uppercase tracking-wide">Responsável legal</p>
              <p className="text-[11px] text-amber-900 -mt-1">Vinculado ao paciente como contato responsável — não cria outro cadastro de paciente.</p>
              <label className="block"><span className={label}>NOME DO RESPONSÁVEL *</span>
                <input value={guardian.name} onChange={(e) => setGuardian({ ...guardian, name: e.target.value })} className={input + ' mt-1'} placeholder="Ex.: Maria Souza" /></label>
              <div className="grid sm:grid-cols-2 gap-2.5">
                <label className="block"><span className={label}>PARENTESCO *</span>
                  <Select value={guardian.relationship} onChange={(e) => setGuardian({ ...guardian, relationship: e.target.value })} aria-label="Parentesco">
                    <option value="">Selecione…</option>
                    <option value="mãe">Mãe</option>
                    <option value="pai">Pai</option>
                    <option value="avó">Avó</option>
                    <option value="avô">Avô</option>
                    <option value="tutora">Tutora</option>
                    <option value="tutor">Tutor</option>
                    <option value="outro">Outro</option>
                  </Select></label>
                <label className="block"><span className={label}>WHATSAPP *</span>
                  <PhoneBRInput value={guardian.phone} onChange={(v) => setGuardian({ ...guardian, phone: v })} className="mt-1" /></label>
              </div>
              <div className="grid sm:grid-cols-2 gap-2.5">
                <label className="block"><span className={label}>E-MAIL</span>
                  <input value={guardian.email} onChange={(e) => setGuardian({ ...guardian, email: e.target.value })} className={input + ' mt-1'} inputMode="email" placeholder="Opcional" /></label>
                <label className="block"><span className={label}>CPF DO RESPONSÁVEL</span>
                  <input value={guardian.cpf} onChange={(e) => setGuardian({ ...guardian, cpf: e.target.value })} className={input + ' mt-1'} inputMode="numeric" placeholder="Opcional" maxLength={14} /></label>
              </div>
            </section>
          )}

          {/* ── Veterinária: Paciente (pet) na MESMA experiência ── */}
          {vetMode && (
            <section data-testid="vet-pet-section" className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3.5 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">Paciente (pet)</p>
                <label className="flex items-center gap-2 text-xs font-semibold text-[var(--text)] cursor-pointer">
                  <input type="checkbox" checked={petOn} onChange={(e) => setPetOn(e.target.checked)} className="h-4 w-4 accent-zinc-900" />
                  Adicionar pet
                </label>
              </div>
              {petOn && (
                <div className="space-y-2.5 pt-1">
                  <label className="block"><span className={label}>NOME DO PET *</span>
                    <input value={pet.name} onChange={(e) => setPet({ ...pet, name: e.target.value })} className={input + ' mt-1'} placeholder="Ex.: Greg" /></label>
                  <div className="grid grid-cols-2 gap-2.5">
                    <label className="block"><span className={label}>ESPÉCIE</span>
                      <Select value={pet.species} onChange={(e) => setPet({ ...pet, species: e.target.value, breed: '' })} aria-label="Espécie">
                        {PET_SPECIES.map((s) => <option key={s} value={s}>{PET_SPECIES_LABELS[s] || s}</option>)}
                      </Select></label>
                    <label className="block"><span className={label}>RAÇA</span>
                      <input value={pet.breed} onChange={(e) => setPet({ ...pet, breed: e.target.value })} className={input + ' mt-1'} list="new-client-breeds" placeholder="Opcional" />
                      <datalist id="new-client-breeds">
                        {breedSuggestions(pet.species).map((b) => <option key={b} value={b} />)}
                      </datalist></label>
                  </div>
                  <div className="grid grid-cols-3 gap-2.5">
                    <label className="block"><span className={label}>SEXO</span>
                      <Select value={pet.sex} onChange={(e) => setPet({ ...pet, sex: e.target.value })} aria-label="Sexo do pet">
                        <option value="">—</option><option value="M">Macho</option><option value="F">Fêmea</option>
                      </Select></label>
                    <label className="block"><span className={label}>NASCIMENTO</span>
                      <input type="date" value={pet.birthDate} onChange={(e) => setPet({ ...pet, birthDate: e.target.value })} className={input + ' mt-1'} max="2099-12-31" /></label>
                    <label className="block"><span className={label}>PESO (KG)</span>
                      <input type="number" step="0.01" min="0" max="500" value={pet.weightKg} onChange={(e) => setPet({ ...pet, weightKg: e.target.value })} className={input + ' mt-1'} placeholder="0" /></label>
                  </div>
                  <label className="block"><span className={label}>OBSERVAÇÕES</span>
                    <textarea value={pet.notes} onChange={(e) => setPet({ ...pet, notes: e.target.value })} rows={2} maxLength={1000} className={input + ' mt-1 resize-none'} placeholder="Alergias, cuidados, comportamento…" /></label>
                </div>
              )}
            </section>
          )}

          <label className="flex items-start gap-2.5 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 cursor-pointer">
            <input type="checkbox" checked={marketingOptIn} onChange={(e) => setMarketingOptIn(e.target.checked)} className="mt-0.5 h-4 w-4 accent-zinc-900" />
            <span><span className="block text-sm font-medium text-zinc-800">Consentimento de marketing</span><span className="block text-xs text-zinc-500 mt-0.5">Não marcado por padrão. Só entra em campanhas se o cliente autorizar.</span></span>
          </label>

          <label className="flex items-start gap-2.5 rounded-lg border border-zinc-200 px-3 py-2.5 cursor-pointer">
            <input type="checkbox" checked={createAccess} onChange={(e) => setCreateAccess(e.target.checked)} className="mt-0.5 h-4 w-4 accent-zinc-900" />
            <span><span className="block text-sm font-semibold text-zinc-800">Criar acesso à página</span><span className="block text-xs text-zinc-500 mt-0.5">Vincula uma conta Customer sem duplicar a identidade e gera uma senha temporária segura.</span></span>
          </label>

          {error && <Notice tone="error">{error}</Notice>}
        </div>
      )}
    </WorkspaceSheet>
  );
}
