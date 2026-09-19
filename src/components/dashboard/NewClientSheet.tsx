'use client';

import { useState } from 'react';
import { Icon } from '@/components/icons';
import { apiSend } from '@/lib/api-client';
import { onlyDigits } from '@/lib/utils';
import { emailError, normalizeEmail, phoneError } from '@/lib/field-quality';
import { PhoneBRInput } from '@/components/dashboard/PhoneBRInput';
import { Button } from '@/components/ui';

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

export function NewClientSheet({
  businessId,
  onClose,
  onSaved,
  onView360,
}: {
  businessId: string;
  onClose: () => void;
  onSaved: (contactId: string) => void;
  onView360?: () => void;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [createAccess, setCreateAccess] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<SaveResponse | null>(null);

  async function save() {
    if (saving) return;
    setError('');
    if (!name.trim()) { setError('Informe o nome do cliente.'); return; }
    // A3.4 · Bloco 6: mensagem ESPECÍFICA (faltou DDD? dígito a mais? e-mail
    // torto?) em vez de "informe um WhatsApp válido" para tudo.
    const phoneMsg = phoneError(phone, { required: true });
    if (phoneMsg) { setError(phoneMsg); return; }
    const emailMsg = emailError(email);
    if (emailMsg) { setError(emailMsg); return; }
    if (createAccess && !email.trim() && onlyDigits(phone).length < 10) {
      setError('Para criar acesso, informe um e-mail ou WhatsApp válido.');
      return;
    }

    setSaving(true);
    const res = await apiSend<SaveResponse>('/api/contacts', 'POST', {
      businessId,
      name: name.trim(),
      phone: onlyDigits(phone),
      email: normalizeEmail(email),
      note: note.trim() || undefined,
      marketingOptIn,
      createAccount: createAccess,
      source: 'manual',
    }, { scope: 'action', area: 'Clientes' });
    setSaving(false);
    if (!res.ok || !res.data?.contact) {
      setError(res.message || 'Não foi possível salvar o cliente.');
      return;
    }
    onSaved(res.data.contact.id);
    setSaved(res.data);
  }

  const input = 'w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-900 focus:border-zinc-900';
  const label = 'block text-xs font-semibold tracking-wide uppercase text-zinc-500';

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Novo cliente">
      <div className="absolute inset-0 bg-[var(--overlay)]" onClick={onClose} />
      <div className="relative w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl border border-zinc-200 max-h-[92vh] overflow-y-auto shadow-xl">
        <div className="sticky top-0 z-10 bg-white px-5 py-4 flex items-start justify-between border-b border-zinc-200">
          <div>
            <p className="font-bold text-zinc-900">Novo cliente</p>
            <p className="text-xs text-zinc-500 mt-0.5">Cadastro direto no CRM, sem criar lead ou agendamento.</p>
          </div>
          <button type="button" onClick={onClose} className="text-zinc-400 hover:text-zinc-700 p-1.5" aria-label="Fechar">
            <Icon n="x" size={17} />
          </button>
        </div>

        {saved ? (
          <div className="px-5 py-6 space-y-4">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4">
              <p className="font-bold text-emerald-900 flex items-center gap-2"><span className="text-lg">✓</span> Cliente cadastrado</p>
              <p className="text-sm text-emerald-800 mt-1">O cadastro foi salvo na base de clientes.</p>
              <p className="text-xs text-emerald-800 mt-2">Consentimento de marketing: {marketingOptIn ? 'concedido' : 'não concedido'}.</p>
              <p className="text-xs text-emerald-800 mt-1">Conta do cliente: {saved.contact?.accountStatus === 'active' ? 'Acesso ativo' : 'Sem acesso'}.</p>
            </div>

            {saved.temporaryPassword ? (
              <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-4 space-y-2">
                <p className="text-sm font-bold text-amber-950">Acesso criado — credencial temporária</p>
                <p className="text-xs text-amber-900">Mostre ou copie esta senha agora. Ela não será exibida novamente e não é uma senha universal.</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 select-all rounded-lg bg-white border border-amber-200 px-3 py-2 text-sm font-bold tracking-wider text-amber-950">{saved.temporaryPassword}</code>
                  <button type="button" onClick={() => navigator.clipboard?.writeText(saved.temporaryPassword || '')} className="text-xs font-semibold bg-white border border-amber-300 rounded-lg px-3 py-2">Copiar</button>
                </div>
                <p className="text-[11px] text-amber-800">A troca obrigatória está preparada no cadastro da conta para a próxima etapa de autenticação.</p>
              </div>
            ) : createAccess ? (
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-xs text-zinc-700">
                Esta pessoa já tinha uma conta. O acesso foi vinculado sem gerar ou revelar uma nova senha.
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2 pt-1">
              <Button type="button" variant="primary" className="flex-1 min-w-[110px]" onClick={onClose}>Fechar</Button>
              {onView360 && (
                <button type="button" onClick={() => { onView360(); onClose(); }} className="flex-1 min-w-[140px] rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm font-semibold text-zinc-800">Ver Cliente 360</button>
              )}
            </div>
          </div>
        ) : (
          <div className="px-5 py-5 space-y-3.5">
            <label className="block"><span className={label}>NOME *</span>
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={input + ' mt-1'} placeholder="Ex.: Marlene Silva" /></label>
            <label className="block"><span className={label}>WHATSAPP *</span>
              <PhoneBRInput value={phone} onChange={setPhone} className="mt-1" placeholder="(11) 99999-9999" /></label>
            <label className="block"><span className={label}>E-MAIL</span>
              <input value={email} onChange={(e) => setEmail(e.target.value)} className={input + ' mt-1'} inputMode="email" placeholder="Opcional" /></label>
            <label className="block"><span className={label}>OBSERVAÇÃO</span>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000} className={input + ' mt-1 resize-none'} placeholder="Opcional — fica no histórico do cliente" /></label>

            <label className="flex items-start gap-2.5 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 cursor-pointer">
              <input type="checkbox" checked={marketingOptIn} onChange={(e) => setMarketingOptIn(e.target.checked)} className="mt-0.5 h-4 w-4 accent-zinc-900" />
              <span><span className="block text-sm font-medium text-zinc-800">Consentimento de marketing</span><span className="block text-xs text-zinc-500 mt-0.5">Não marcado por padrão. Só entra em campanhas se o cliente autorizar.</span></span>
            </label>

            <label className="flex items-start gap-2.5 rounded-lg border border-zinc-200 px-3 py-2.5 cursor-pointer">
              <input type="checkbox" checked={createAccess} onChange={(e) => setCreateAccess(e.target.checked)} className="mt-0.5 h-4 w-4 accent-zinc-900" />
              <span><span className="block text-sm font-semibold text-zinc-800">Criar acesso à página</span><span className="block text-xs text-zinc-500 mt-0.5">Vincula uma conta Customer sem duplicar a identidade e gera uma senha temporária segura.</span></span>
            </label>

            {error && <p className="text-sm font-semibold text-red-600" role="alert">{error}</p>}
            <Button type="button" variant="primary" size="lg" className="w-full" onClick={save} disabled={saving}>
              {saving ? 'Salvando cliente…' : 'Salvar cliente'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
