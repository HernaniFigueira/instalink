'use client';
// ═══════════════════════════════════════════════════════════════
// CADASTRO REAL de paciente/tutor — formulário ÚNICO do GoDoutor.
// Vive na PÁGINA própria `/clientes/novo` (Missão 02), usada pelos dois
// pontos de entrada: Clientes e Novo agendamento. Não é overlay: é uma tela. Salva NO CRM (POST /api/contacts) ao confirmar.
//
// Regras:
//   • duplicidade é verificada ANTES de gravar (GET /api/contacts por
//     WhatsApp): o POST faria upsert silencioso no contato existente, então
//     o cadastro duplicado é bloqueado aqui com o caminho para o existente;
//   • falha parcial (tutor salvo, pet não): o tutor NÃO é regravado; o
//     formulário fica no estado "pet pendente" e só o pet é tentado de novo;
//   • veterinária → Tutor + Paciente (pet) na MESMA tela;
//   • nascimento <18 (humano) → Responsável legal (contato vinculado,
//     aditivo em profile.guardian — nunca um "segundo paciente");
//   • CPF e endereço são opcionais, recolhidos; validados pelo servidor.
// ═══════════════════════════════════════════════════════════════
import { useState } from 'react';
import { apiGet, apiSend } from '@/lib/api-client';
import { onlyDigits } from '@/lib/utils';
import { cepError, emailError, normalizeEmail, phoneError } from '@/lib/field-quality';
import { ageFromBirthDate, BRAZILIAN_STATES, emptyAddress, formatCep, formatCpf, profileCpfError } from '@/lib/contact-profile';
import { PhoneBRInput } from '@/components/dashboard/PhoneBRInput';
import { Icon } from '@/components/icons';
import { Button, Disclosure, Notice, PageBackAction, PageHeader, Select } from '@/components/ui';
import { PET_SPECIES, PET_SPECIES_LABELS, breedSuggestions, validatePet } from '@/lib/pets';
import { useUnsavedChangesGuard, type DismissGuardState } from './OverlayDismissGuard';
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
  /** Nome e WhatsApp (dígitos) gravados — o retorno ao agendamento usa os dados reais. */
  name?: string;
  phone?: string;
}

const input = 'w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-900 focus:border-zinc-900';
const label = 'block text-xs font-semibold tracking-[0.06em] uppercase text-[var(--text-muted)]';
const fieldError = 'mt-1 block text-xs font-medium text-[var(--danger)]';

export function NewClientForm({
  businessId,
  vetMode = false,
  initialName = '',
  initialPhone = '',
  onCancel,
  onSaved,
  onOpenExisting,
  existingActionLabel = 'Abrir cadastro existente',
  backLabel,
}: {
  businessId: string;
  /** Saída confirmada (Cancelar, Voltar, navegação): a página decide o destino. */
  onCancel: () => void;
  /** Cadastro COMPLETO salvo (tutor e, se houver, pet). */
  onSaved: (contactId: string, extra: NewClientResult) => void;
  /** Duplicidade: leva ao cadastro existente (decidido pela página). */
  onOpenExisting?: (contact: { id: string; name: string; phone: string }) => void;
  existingActionLabel?: string;
  /**
   * Rótulo do link "Voltar" acima do cabeçalho. O link sai pela MESMA guarda
   * de Cancelar (requestFormClose), nunca direto para a rota.
   */
  backLabel?: string;
  /** Veterinária: bloco "Paciente (pet)" na mesma tela do tutor. */
  vetMode?: boolean;
  initialName?: string;
  initialPhone?: string;
}) {
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [cpf, setCpf] = useState('');
  const [address, setAddress] = useState(emptyAddress());
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [createAccess, setCreateAccess] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [duplicate, setDuplicate] = useState<{ id: string; name: string; phone: string } | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // Tutor gravado, pet ainda pendente: o tutor fica travado e só o pet é retentado.
  const [savedContactId, setSavedContactId] = useState('');
  const [tutorResponse, setTutorResponse] = useState<SaveResponse | null>(null);
  const [saved, setSaved] = useState<SaveResponse | null>(null);
  const [savedResult, setSavedResult] = useState<NewClientResult | null>(null);

  // Responsável legal — só humana e só quando a idade < 18.
  const age = ageFromBirthDate(birthDate);
  const showGuardian = !vetMode && age !== null && age >= 0 && age < 18;
  const [guardian, setGuardian] = useState({ name: '', relationship: '', phone: '', email: '', cpf: '' });

  // Pet (só veterinária) — persistido na MESMA experiência do tutor.
  const [petOn, setPetOn] = useState(vetMode);
  const [pet, setPet] = useState({ name: '', species: 'cachorro', breed: '', sex: '', birthDate: '', weightKg: '' as string | number, notes: '' });

  const initialSnapshot = JSON.stringify({
    name: initialName, phone: initialPhone, email: '', note: '', birthDate: '', cpf: '', address: emptyAddress(),
    marketingOptIn: false, createAccess: false,
    guardian: { name: '', relationship: '', phone: '', email: '', cpf: '' }, petOn: vetMode,
    pet: { name: '', species: 'cachorro', breed: '', sex: '', birthDate: '', weightKg: '', notes: '' },
  });
  const currentSnapshot = JSON.stringify({ name, phone, email, note, birthDate, cpf, address, marketingOptIn, createAccess, guardian, petOn, pet });
  const dirty = !saved && (!!savedContactId || currentSnapshot !== initialSnapshot);
  // Pet pendente: o tutor JÁ existe. Sair agora deixa o cadastro incompleto — o
  // aviso diz isso, em vez do genérico "dados serão perdidos".
  const petPending = !!savedContactId && !saved;
  const dismissState: DismissGuardState = {
    dirty, saving, error, context: 'new-client',
    ...(petPending ? {
      title: 'Pet ainda não gravado',
      description: 'O tutor já foi salvo, mas o pet não. Se você sair agora, o pet não será cadastrado.',
    } : {}),
  };
  // Uma ÚNICA guarda para Cancelar, Voltar e navegação para fora (links,
  // histórico e fechamento da aba) — a mesma proteção dos editores de página.
  const closeGuard = useUnsavedChangesGuard(dismissState);
  const leaveForm = () => { closeGuard.allowNavigation(); onCancel(); };
  const requestFormClose = () => closeGuard.requestClose('close-button', dismissState, leaveForm);

  const cpfMsg = cpf.trim() ? profileCpfError({ cpf }) : '';
  const cepMsg = address.cep.trim() ? cepError(address.cep) : '';
  const advancedHasError = !!cpfMsg || !!cepMsg;

  function finish(contactId: string, petId: string | undefined, tutor: SaveResponse | null) {
    const result: NewClientResult = { contactId, ...(petId ? { petId } : {}), name: name.trim(), phone: onlyDigits(phone) };
    setSaved(tutor || {});
    setSavedResult(result);
    onSaved(contactId, result);
  }

  /** Só o pet: usada após o tutor já ter sido gravado (nunca duplica o tutor). */
  async function savePet(contactId: string, tutor: SaveResponse | null) {
    const petMsg = validatePet(pet);
    if (petMsg) { setError(petMsg); return; }
    setSaving(true);
    const petRes = await apiSend<{ ok?: boolean; pet?: Pet }>('/api/pets', 'POST', {
      action: 'create', businessId, tutorId: contactId, pet: {
        name: pet.name, species: pet.species, breed: pet.breed, sex: pet.sex,
        birthDate: pet.birthDate, weightKg: pet.weightKg === '' ? 0 : Number(pet.weightKg),
        notes: pet.notes,
      },
    }, { scope: 'action', area: 'Agenda' });
    setSaving(false);
    if (!petRes.ok || !petRes.data?.pet) {
      setError(`Tutor salvo, mas o pet não foi gravado${petRes.message ? `: ${petRes.message}` : '.'} Corrija o pet e tente de novo — o tutor não será duplicado.`);
      return;
    }
    finish(contactId, petRes.data.pet.id, tutor);
  }

  async function save() {
    if (saving || saved) return;
    setError('');
    setDuplicate(null);
    if (savedContactId) { await savePet(savedContactId, tutorResponse); return; }

    if (!name.trim()) { setError('Informe o nome do cliente.'); return; }
    const phoneMsg = phoneError(phone, { required: true });
    if (phoneMsg) { setError(phoneMsg); return; }
    const emailMsg = emailError(email);
    if (emailMsg) { setError(emailMsg); return; }
    // CPF/CEP: o erro fica JUNTO do campo (aria-invalid), sem repetir no aviso geral.
    if (cpfMsg || cepMsg) { setAdvancedOpen(true); return; }
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
    // Duplicidade ANTES de gravar: o POST faria upsert no contato existente.
    const digits = onlyDigits(phone);
    const lookup = await apiGet<{ contacts?: Array<{ id: string; name: string; phone: string }> }>(
      `/api/contacts?businessId=${encodeURIComponent(businessId)}&q=${digits}&limit=10`,
      { scope: 'action', area: 'Clientes' },
    );
    if (!lookup.ok) {
      setSaving(false);
      setError(lookup.message || 'Não foi possível verificar se o cliente já existe. Tente de novo.');
      return;
    }
    const hit = (lookup.data?.contacts || []).find((c) => onlyDigits(c.phone) === digits);
    if (hit) {
      setSaving(false);
      setDuplicate({ id: hit.id, name: hit.name, phone: hit.phone });
      setError('Já existe um cliente com este WhatsApp. Use o cadastro existente em vez de criar outro.');
      return;
    }

    // Perfil aditivo: nascimento, CPF, endereço (+ responsável quando menor).
    // Campos ausentes são preservados pelo normalizador do servidor.
    const profile: Record<string, unknown> = {};
    if (birthDate) profile.birthDate = birthDate;
    if (cpf.trim()) profile.cpf = onlyDigits(cpf);
    const hasAddress = Object.values(address).some((v) => String(v).trim());
    if (hasAddress) profile.address = { ...address, cep: onlyDigits(address.cep) };
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
      phone: digits,
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
    setTutorResponse(res.data);
    setSavedContactId(contactId);

    if (!(vetMode && petOn)) {
      setSaving(false);
      finish(contactId, undefined, res.data);
      return;
    }
    await savePet(contactId, res.data);
  }

  const primaryLabel = saving
    ? 'Salvando…'
    : savedContactId
      ? 'Tentar salvar o pet de novo'
      : (vetMode && petOn ? 'Salvar tutor e pet' : 'Salvar cliente');
  const subtitle = saved
    ? 'Cadastro salvo na base de clientes.'
    : vetMode
      ? `Tutor: ${name.trim() || '—'} · o pet entra como paciente no mesmo cadastro`
      : 'Cadastro direto no CRM — se você sair antes de agendar, o cliente permanece.';

  return (
    <section className="mx-auto w-full max-w-[720px] space-y-5" aria-label={vetMode ? 'Cadastrar tutor e paciente' : 'Novo cliente'}>
      {backLabel && <PageBackAction onClick={requestFormClose} label={backLabel} />}
      <PageHeader icon={vetMode ? 'paw' : 'users'} title={vetMode ? 'Cadastrar tutor e paciente' : 'Novo cliente'} hint={subtitle} />

      {saved ? (
        <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-5 py-6 space-y-4" data-client-saved="true">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4">
            <p className="font-semibold text-emerald-900 flex items-center gap-2"><span className="text-lg">✓</span> Cadastro salvo</p>
            <p className="text-sm text-emerald-800 mt-1">O registro está no CRM e permanece mesmo se o agendamento for abandonado.</p>
            {savedResult?.petId && <p className="text-sm text-emerald-800 mt-1">Pet vinculado ao tutor.</p>}
          </div>
          {saved.temporaryPassword ? (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-4 space-y-2">
              <p className="text-sm font-semibold text-amber-950">Acesso criado — credencial temporária</p>
              <p className="text-xs text-amber-900">Mostre ou copie esta senha agora. Ela não será exibida novamente e não é uma senha universal.</p>
              <div className="flex gap-2">
                <code className="flex-1 select-all rounded-lg bg-white border border-amber-200 px-3 py-2 text-sm font-semibold tracking-wider text-amber-950">{saved.temporaryPassword}</code>
                <button type="button" onClick={() => navigator.clipboard?.writeText(saved.temporaryPassword || '')} className="text-xs font-semibold bg-white border border-amber-300 rounded-lg px-3 py-2 text-amber-950">Copiar</button>
              </div>
            </div>
          ) : createAccess ? (
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-xs text-zinc-700">
              Esta pessoa já tinha uma conta. O acesso foi vinculado sem gerar ou revelar uma nova senha.
            </div>
          ) : null}
        </div>
      ) : (
        <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-5 space-y-5">
          {/* Tutor — travado enquanto só o pet está pendente (não regrava o tutor). */}
          <fieldset disabled={!!savedContactId} className="space-y-4 min-w-0">
            {vetMode && (
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--brand-fg)]">Tutor (contato)</p>
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

            <Disclosure
              label="Documento e endereço"
              hint="Opcional"
              open={advancedOpen || advancedHasError}
              onOpenChange={setAdvancedOpen}
            >
              <div className="space-y-4 pt-2">
                <label className="block">
                  <span className={label}>CPF</span>
                  <input
                    value={cpf}
                    onChange={(e) => setCpf(formatCpf(e.target.value))}
                    className={input + ' mt-1'}
                    inputMode="numeric"
                    placeholder="000.000.000-00"
                    maxLength={14}
                    aria-invalid={cpfMsg ? true : undefined}
                    aria-describedby={cpfMsg ? 'client-cpf-error' : undefined}
                  />
                  {cpfMsg && <span id="client-cpf-error" role="alert" className={fieldError}>{cpfMsg}</span>}
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className={label}>CEP</span>
                    <input
                      value={address.cep ? formatCep(address.cep) : ''}
                      onChange={(e) => setAddress({ ...address, cep: onlyDigits(e.target.value).slice(0, 8) })}
                      className={input + ' mt-1'}
                      inputMode="numeric"
                      placeholder="00000-000"
                      maxLength={9}
                      aria-invalid={cepMsg ? true : undefined}
                      aria-describedby={cepMsg ? 'client-cep-error' : undefined}
                    />
                    {cepMsg && <span id="client-cep-error" role="alert" className={fieldError}>{cepMsg}</span>}
                  </label>
                  <label className="block">
                    <span className={label}>UF</span>
                    <Select value={address.state} onChange={(e) => setAddress({ ...address, state: e.target.value })} aria-label="Estado (UF)">
                      <option value="">—</option>
                      {BRAZILIAN_STATES.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
                    </Select>
                  </label>
                </div>
                <label className="block"><span className={label}>RUA</span>
                  <input value={address.street} onChange={(e) => setAddress({ ...address, street: e.target.value })} className={input + ' mt-1'} placeholder="Opcional" /></label>
                <div className="grid grid-cols-3 gap-3">
                  <label className="block"><span className={label}>NÚMERO</span>
                    <input value={address.number} onChange={(e) => setAddress({ ...address, number: e.target.value })} className={input + ' mt-1'} placeholder="Opcional" /></label>
                  <label className="block col-span-2"><span className={label}>COMPLEMENTO</span>
                    <input value={address.complement} onChange={(e) => setAddress({ ...address, complement: e.target.value })} className={input + ' mt-1'} placeholder="Opcional" /></label>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block"><span className={label}>BAIRRO</span>
                    <input value={address.district} onChange={(e) => setAddress({ ...address, district: e.target.value })} className={input + ' mt-1'} placeholder="Opcional" /></label>
                  <label className="block"><span className={label}>CIDADE</span>
                    <input value={address.city} onChange={(e) => setAddress({ ...address, city: e.target.value })} className={input + ' mt-1'} placeholder="Opcional" /></label>
                </div>
              </div>
            </Disclosure>

            {/* ── Responsável legal (humano · menor de 18) ── aditivo, NÃO um segundo paciente. */}
            {showGuardian && (
              <section data-testid="guardian-section" className="rounded-lg border border-amber-200 bg-amber-50/60 p-3.5 space-y-2.5">
                <p className="text-xs font-semibold text-amber-950 uppercase tracking-wide">Responsável legal</p>
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
          </fieldset>

          {/* ── Veterinária: Paciente (pet) na MESMA experiência ── */}
          {vetMode && (
            <section data-testid="vet-pet-section" className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3">
              {/* MISSÃO 5 — o PET é o paciente: bloco creme protagonista. */}
              <div className="flex items-center justify-between gap-2">
                <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-[var(--text)]">
                  <Icon n="paw" size={14} /> Paciente (pet)
                </p>
                <label className="flex items-center gap-2 text-xs font-semibold text-[var(--text)] cursor-pointer">
                  <input type="checkbox" checked={petOn} disabled={!!savedContactId} onChange={(e) => setPetOn(e.target.checked)} className="il-check" />
                  Adicionar pet
                </label>
              </div>
              {petOn && (
                <div className="space-y-3 pt-1">
                  <label className="block"><span className={label}>NOME DO PET *</span>
                    <input value={pet.name} onChange={(e) => setPet({ ...pet, name: e.target.value })} className={input + ' mt-1'} placeholder="Ex.: Greg" /></label>
                  <div className="grid grid-cols-2 gap-3">
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
                  <div className="grid grid-cols-3 gap-3">
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
                    <textarea value={pet.notes} onChange={(e) => setPet({ ...pet, notes: e.target.value })} rows={3} maxLength={1000}
                      className={input + ' mt-1 min-h-[84px] resize-none leading-relaxed'} placeholder="Alergias, cuidados, comportamento…" /></label>
                </div>
              )}
            </section>
          )}

          {error && (
            <Notice tone="error">
              {error}
              {duplicate && onOpenExisting && (
                <span className="mt-2 block">
                  <Button type="button" variant="secondary" size="sm" className="h-auto min-h-8 w-full max-w-full py-1.5" onClick={() => onOpenExisting(duplicate)}>
                    <span className="block max-w-full whitespace-normal break-words text-center">{existingActionLabel} — {duplicate.name}</span>
                  </Button>
                </span>
              )}
            </Notice>
          )}

          <footer className="il-actionbar flex flex-wrap items-center justify-end gap-2 -mx-5 -mb-5 px-5 py-3 rounded-b-md">
            <Button variant="secondary" onClick={requestFormClose} disabled={saving}>Cancelar</Button>
            <Button variant="primary" onClick={save} disabled={saving}>{primaryLabel}</Button>
          </footer>
        </div>
      )}
      {closeGuard.dialog}
    </section>
  );
}
