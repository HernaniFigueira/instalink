'use client';
// ═══════════════════════════════════════════════════════════════
// CADASTRO RÁPIDO DE CLIENTE (§11–15 · §21)
// ═══════════════════════════════════════════════════════════════
// Um único sheet reutilizável para registrar quem ainda não está na base:
//   • Conversas → CTA "Cadastrar cliente" (nome/telefone/email pré-preenchidos
//     a partir da conversa; ao salvar, a conversa é vinculada e o badge vira
//     "Na base da clínica");
//   • Overlay de Novo agendamento → "Cadastrar novo paciente" (mesmo sheet,
//     com bloco rápido de PET quando a clínica é veterinária).
//
// Contrato do OVERLAY SYSTEM (§19–25):
//   • ações focais rápidas = dialog/sheet lateral (Drawer), sem modal novo;
//   • sem backdrops empilhados (Drawer é único; nada abre por cima);
//   • header/ícone/fechar/padding/footer padronizados pelo Drawer;
//   • após salvar: onSaved(contact[, pet]) — quem chamou decide (selecionar
//     paciente, atualizar badge, voltar para o painel com dados preservados).
import { useEffect, useState } from 'react';
import { Button, Drawer, Field, Input, Select, Notice } from '@/components/ui';
import { useOverlayDismissGuard } from '@/components/dashboard/OverlayDismissGuard';
import { apiSend } from '@/lib/api-client';

export interface QuickRegisterInitial {
  name?: string;
  phone?: string;
  email?: string;
}

export interface SavedContact {
  id: string;
  name: string;
  phone: string;
  email: string;
}

export interface QuickRegisterSheetProps {
  open: boolean;
  onClose: () => void;
  businessId: string;
  /** Pré-preenche o formulário (ex.: dados da conversa atual). */
  initial?: QuickRegisterInitial;
  /** Clínica veterinária → mostra o bloco rápido de pet. */
  vet?: boolean;
  /** Origem gravada no contato (source). */
  source?: string;
  /** Chamado após salvar (contato garantido; pet quando criado). */
  onSaved?: (contact: SavedContact, petName: string) => void | Promise<void>;
}

type QuickRegisterSnapshot = { name: string; phone: string; email: string; petName: string; petSpecies: string; petBreed: string };
const quickRegisterKey = (value: QuickRegisterSnapshot) => JSON.stringify(value);

export function QuickRegisterSheet({
  open, onClose, businessId, initial, vet = false, source = 'manual', onSaved,
}: QuickRegisterSheetProps) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [petName, setPetName] = useState('');
  const [petSpecies, setPetSpecies] = useState('cachorro');
  const [petBreed, setPetBreed] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [baseline, setBaseline] = useState('');
  const dismiss = useOverlayDismissGuard();
  const currentValues = { name, phone, email, petName, petSpecies, petBreed };
  const dirty = baseline !== '' && quickRegisterKey(currentValues) !== baseline;
  const dismissState = {
    dirty, saving, context: 'new-client' as const,
    title: 'Descartar cadastro do cliente?',
    description: 'Os dados preenchidos serão perdidos.',
  };
  const requestClose = () => dismiss.requestClose('close-button', dismissState, onClose);

  // Pré-preenchimento a cada abertura (a conversa pode mudar).
  useEffect(() => {
    if (!open) return;
    const seed = { name: initial?.name || '', phone: initial?.phone || '', email: initial?.email || '', petName: '', petSpecies: 'cachorro', petBreed: '' };
    setBaseline(quickRegisterKey(seed));
    setName(seed.name);
    setPhone(seed.phone);
    setEmail(seed.email);
    setPetName(seed.petName);
    setPetSpecies(seed.petSpecies);
    setPetBreed(seed.petBreed);
    setError('');
  }, [open, initial?.name, initial?.phone, initial?.email]);

  async function save() {
    if (saving) return;
    if (!name.trim() && !phone.trim()) {
      setError('Informe ao menos o nome ou o telefone.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const contactRes = await apiSend<{ contact?: SavedContact; id?: string; name?: string; phone?: string; email?: string }>(
        '/api/contacts', 'POST',
        { businessId, name: name.trim(), phone: phone.trim(), email: email.trim(), source },
      );
      if (!contactRes.ok || !contactRes.data) {
        setError(contactRes.message || 'Não foi possível salvar o contato.');
        return;
      }
      const raw: any = contactRes.data;
      const contact: SavedContact = raw.contact || {
        id: raw.id || '', name: raw.name || name.trim(), phone: raw.phone || phone.trim(), email: raw.email || email.trim(),
      };

      let savedPetName = '';
      if (vet && petName.trim()) {
        const petRes = await apiSend<any>('/api/pets', 'POST', {
          businessId,
          tutorId: contact.id,
          pet: { name: petName.trim(), species: petSpecies, breed: petBreed.trim() },
        });
        if (petRes.ok) savedPetName = petName.trim();
      }

      await onSaved?.(contact, savedPetName);
      onClose();
    } catch {
      setError('Não foi possível salvar. Tente novamente.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      dismissGuard={dismissState}
      title="Cadastrar cliente"
      subtitle="Nome, telefone e e-mail já bastam para colocar esta pessoa na base."
      width="max-w-[440px]"
      footer={
        <>
          <Button variant="secondary" onClick={requestClose} disabled={saving}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Salvando…' : 'Salvar tutor e pet'}</Button>
        </>
      }
    >
      {dismiss.dialog}
      <div className="p-4 space-y-3">
        {error && <Notice tone="error" title="Não foi possível salvar">{error}</Notice>}
        <Field label="Nome" htmlFor="qr-name">
          <Input id="qr-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome completo" autoComplete="name" />
        </Field>
        <Field label="Telefone (WhatsApp)" htmlFor="qr-phone">
          <Input id="qr-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(21) 99999-0000" inputMode="tel" autoComplete="tel" />
        </Field>
        <Field label="E-mail" htmlFor="qr-email">
          <Input id="qr-email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@exemplo.com" inputMode="email" autoComplete="email" />
        </Field>

        {vet && (
          <section className="rounded-lg border border-[var(--border)] p-3 space-y-3" aria-label="Pet do novo cliente">
            <p className="text-[11px] font-semibold tracking-[0.08em] uppercase text-[var(--text-faint)]">
              Pet (opcional)
            </p>
            <Field label="Nome do pet" htmlFor="qr-pet-name">
              <Input id="qr-pet-name" value={petName} onChange={(e) => setPetName(e.target.value)} placeholder="Ex.: Toby" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Espécie" htmlFor="qr-pet-species">
                <Select id="qr-pet-species" value={petSpecies} onChange={(e) => setPetSpecies(e.target.value)}>
                  <option value="cachorro">Cachorro</option>
                  <option value="gato">Gato</option>
                  <option value="outro">Outro</option>
                </Select>
              </Field>
              <Field label="Raça" htmlFor="qr-pet-breed">
                <Input id="qr-pet-breed" value={petBreed} onChange={(e) => setPetBreed(e.target.value)} placeholder="Opcional" />
              </Field>
            </div>
          </section>
        )}
      </div>
    </Drawer>
  );
}
