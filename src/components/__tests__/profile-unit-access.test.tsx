// @vitest-environment jsdom
// A3 — Perfil separa o papel de acesso da unidade do vínculo clínico.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const panel = vi.hoisted(() => ({
  state: {
    permissions: {}, role: '', professionalId: '', professionalName: '', businessId: '', ready: true,
  },
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));
vi.mock('@/components/dashboard/usePanelPermissions', () => ({
  usePanelPermissions: () => panel.state,
}));
vi.mock('@/components/dashboard/ImageUpload', () => ({
  ImageUpload: () => <div data-testid="profile-image-upload" />,
}));
vi.mock('@/lib/api-client', () => ({
  apiGet: vi.fn(async () => ({
    ok: true,
    data: {
      // Deliberadamente diferente do papel da unidade nos dois cenários: a
      // página não pode projetar este role global como autoridade local.
      user: {
        id: 'user-1', name: 'Ana', email: 'ana@example.test', role: 'profissional',
        phone: '', photo: '', title: '', conselho: '', professionalBio: '', createdAt: '', lastLoginAt: '',
      },
    },
  })),
  apiSend: vi.fn(async () => ({ ok: true, data: {} })),
}));

import MeuPerfilPage from '@/app/(dashboard)/perfil/page';

beforeEach(() => {
  panel.state = {
    permissions: {}, role: '', professionalId: '', professionalName: '', businessId: '', ready: true,
  };
});
afterEach(cleanup);

describe('Meu perfil — acesso e vínculo clínico da unidade ativa', () => {
  it('mostra Professional vinculado sem promover nem inferir outro papel', async () => {
    panel.state = {
      permissions: {}, role: 'PROFISSIONAL', professionalId: 'pro-ana', professionalName: 'Dra. Ana',
      businessId: 'clinic-a', ready: true,
    };

    render(<MeuPerfilPage />);
    await screen.findByLabelText('Nome');

    const access = document.querySelector('[data-profile-unit-access]');
    const clinical = document.querySelector('[data-profile-clinical-link]');
    expect(access?.textContent).toContain('Profissional');
    expect(access?.textContent).toContain('nesta unidade');
    expect(clinical?.textContent).toContain('Vinculado à equipe clínica');
    expect(clinical?.textContent).toContain('Dra. Ana');
    expect(clinical?.textContent).toContain('não altera seu papel de acesso nem suas permissões');
    expect(screen.getByRole('link', { name: 'Gerenciar na Equipe' }).getAttribute('href')).toBe('/equipe?b=clinic-a');
  });

  it('mostra Owner/Admin sem vínculo como acesso administrativo, não como Professional', async () => {
    panel.state = {
      permissions: {}, role: 'ADMIN', professionalId: '', professionalName: '', businessId: 'clinic-b', ready: true,
    };

    render(<MeuPerfilPage />);
    await screen.findByLabelText('Nome');

    const access = document.querySelector('[data-profile-unit-access]');
    const clinical = document.querySelector('[data-profile-clinical-link]');
    expect(access?.textContent).toContain('Administrador');
    expect(clinical?.textContent).toContain('Sem vínculo clínico nesta unidade');
    expect(clinical?.textContent).toContain('papel de acesso de Administrador não cria esse vínculo automaticamente');
    expect(screen.getByRole('button', { name: 'Vincular à equipe clínica' })).toBeTruthy();
    expect(clinical?.textContent).not.toContain('Vinculado à equipe clínica');
  });
});
