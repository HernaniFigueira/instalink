// @vitest-environment jsdom
// PR #46 · deep link /disponibilidade?professionalId= + horário próprio sem configuração.
import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { apiSend } from '@/lib/api-client';
import { BusinessHoursPanel } from '@/components/dashboard/BusinessHours';

vi.mock('@/lib/api-client', () => ({ apiGet: vi.fn(), apiSend: vi.fn() }));

const NOW = '2026-09-30T12:00:00.000Z';
const pro = (id: string, name: string, follow: boolean) => ({ id, businessId: 'b1', name, role: 'Vet', photo: '', active: true, userId: '', followBusinessHours: follow, createdAt: NOW, updatedAt: NOW }) as any;
const rule = (professionalId: string, weekday: number, start = '08:00', end = '18:00') => ({ id: `r-${professionalId}-${weekday}`, businessId: 'b1', professionalId, serviceId: '', weekday, start, end, slotMin: 30 }) as any;
const clinic = [1, 2, 3, 4, 5].map((d) => rule('', d));

afterEach(() => { cleanup(); vi.mocked(apiSend).mockReset(); });

describe('BusinessHoursPanel — deep link e horário próprio', () => {
  it('professionalId de quem usa horário próprio SEM regra abre o editor, com aviso e cópia não persistida', () => {
    render(<BusinessHoursPanel businessId="b1" professionals={[pro('orl', 'Orlando', false), pro('bia', 'Bia', true)]} rules={clinic} onChanged={() => {}} focusProfessionalId="orl" />);
    expect(screen.getByText('Horário próprio ainda não configurado')).toBeTruthy();
    expect(screen.getByText(/Começar copiando o horário da clínica/)).toBeTruthy();
    expect(screen.getByText('Salvar horário personalizado')).toBeTruthy();
    expect(apiSend).not.toHaveBeenCalled(); // nada gravado antes da confirmação
  });

  it('deep link para quem SEGUE a clínica não abre editor sozinho', () => {
    render(<BusinessHoursPanel businessId="b1" professionals={[pro('orl', 'Orlando', false), pro('bia', 'Bia', true)]} rules={clinic} onChanged={() => {}} focusProfessionalId="bia" />);
    expect(screen.queryByText('Salvar horário personalizado')).toBeNull();
    expect(screen.getByText('Segue a clínica')).toBeTruthy();
  });

  it('seguir a clínica avisa que o horário próprio fica guardado e envia follow sem apagar regras', async () => {
    vi.mocked(apiSend).mockResolvedValue({ ok: true, status: 200, data: {} } as any);
    render(<BusinessHoursPanel businessId="b1" professionals={[pro('orl', 'Orlando', false)]} rules={[...clinic, rule('orl', 1, '09:00', '12:00')]} onChanged={() => {}} />);
    expect(screen.getByText('Personalizado')).toBeTruthy();
    fireEvent.click(screen.getByText('Seguir a clínica'));
    const dlg = screen.getByRole('dialog', { name: /Voltar a seguir/ });
    expect(dlg.textContent).toMatch(/fica guardado/);
    fireEvent.click(within(dlg).getByText('Seguir horário da clínica'));
    await vi.waitFor(() => expect(apiSend).toHaveBeenCalled());
    const body = vi.mocked(apiSend).mock.calls[0][2] as any;
    expect(body).toMatchObject({ action: 'professional.hours', id: 'orl', follow: true });
    expect(body.rules).toBeUndefined();
  });

  it('página /disponibilidade repassa professionalId do querystring ao painel', () => {
    const src = fs.readFileSync('src/app/(dashboard)/disponibilidade/page.tsx', 'utf8');
    expect(src).toMatch(/get\('professionalId'\)/);
    expect(src).toMatch(/focusProfessionalId=\{/);
  });
});
