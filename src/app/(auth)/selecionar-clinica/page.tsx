'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { landingPathFor } from '@/lib/landing';
import { rememberLastBusinessId } from '@/lib/business-context';

interface ClinicChoice {
  id: string;
  name: string;
  clinicType?: string;
  role?: string;
  permissions?: Record<string, boolean>;
  modes?: string[];
  features?: Record<string, boolean>;
}

function destinationFor(business: ClinicChoice): string {
  const dest = landingPathFor({
    role: business.role,
    permissions: (business.permissions || {}) as any,
    modes: (business.modes || []) as any,
    features: (business.features || {}) as any,
  }) || '/dashboard';
  return `${dest}${dest.includes('?') ? '&' : '?'}b=${encodeURIComponent(business.id)}`;
}

export default function SelecionarClinicaPage() {
  const router = useRouter();
  const [userId, setUserId] = useState('');
  const [clinics, setClinics] = useState<ClinicChoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    fetch('/api/auth/me', { credentials: 'same-origin' })
      .then(async (res) => {
        if (res.status === 401) {
          router.replace('/login?session=expired');
          return null;
        }
        if (!res.ok) throw new Error('Não foi possível carregar suas clínicas.');
        return res.json();
      })
      .then((data) => {
        if (!alive || !data) return;
        // A preferência de unidade é POR CONTA (P0): a escolha feita aqui vale
        // só para o usuário logado — nunca para a próxima conta do navegador.
        setUserId(String(data.user?.id || ''));
        if (data.isMaster && !data.support) {
          router.replace('/master');
          return;
        }
        const list = Array.isArray(data.businesses) ? data.businesses as ClinicChoice[] : [];
        if (list.length === 0) {
          router.replace('/onboarding');
          return;
        }
        if (list.length === 1) {
          rememberLastBusinessId(list[0].id, String(data.user?.id || ''));
          router.replace(destinationFor(list[0]));
          return;
        }
        setClinics(list);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : 'Não foi possível carregar suas clínicas.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [router]);

  function choose(clinic: ClinicChoice) {
    rememberLastBusinessId(clinic.id, userId);
    router.replace(destinationFor(clinic));
  }

  return (
    <>
      <h1 className="text-2xl font-bold">Qual clínica você quer acessar?</h1>
      <p className="text-sm text-zinc-400 mt-1">
        Sua conta tem acesso a mais de uma unidade. Escolha o contexto antes de entrar.
      </p>

      {loading && <p className="mt-6 text-sm text-zinc-400">Carregando clínicas…</p>}
      {error && (
        <p className="mt-6 text-sm font-medium text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
          {error}
        </p>
      )}

      {!loading && !error && (
        <div className="mt-6 space-y-2">
          {clinics.map((clinic) => (
            <button
              key={clinic.id}
              type="button"
              onClick={() => choose(clinic)}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-left hover:border-emerald-500 hover:bg-zinc-750 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            >
              <span className="block text-sm font-semibold text-white">{clinic.name}</span>
              <span className="mt-0.5 block text-xs text-zinc-400">
                {clinic.clinicType ? clinic.clinicType.replace(/-/g, ' ') : 'Clínica'}
                {clinic.role ? ` · ${clinic.role}` : ''}
              </span>
            </button>
          ))}
        </div>
      )}

      <p className="mt-5 text-xs text-zinc-500">
        O GoDoutor lembra a última clínica escolhida neste navegador. Você pode trocar de unidade pelo painel depois.
      </p>
    </>
  );
}
