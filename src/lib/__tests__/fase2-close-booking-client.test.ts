import { describe, expect, it } from 'vitest';

// ═══════════════════════════════════════════════════════════════
// HOMOLOGAÇÃO · FASE 2 fechamento — contrato do cadastro REAL no
// agendamento (sem temporário) e do cadastro unificado vet/menor.
// ═══════════════════════════════════════════════════════════════

describe('fechamento · cadastro real no agendamento', () => {
  it('NewBookingSheet não declara stages de cliente temporário', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/components/dashboard/NewBookingSheet.tsx', 'utf8');
    expect(src).not.toContain('new-form');
    expect(src).not.toContain('new-ready');
    expect(src).not.toContain('confirmNewDraft');
    expect(src).not.toContain('O cliente será cadastrado quando este agendamento');
    // Usa o cadastro REAL
    expect(src).toContain('NewClientSheet');
    expect(src).toContain('setRegisterOpen(true)');
    // picked = contato JÁ existente no CRM
    expect(src).toContain('const picked = !!contactId');
  });

  it('vetMode vem do business (pets sem tutorId), não de contactId', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/components/dashboard/NewBookingSheet.tsx', 'utf8');
    expect(src).toMatch(/pets\?businessId=\$\{encodeURIComponent\(businessId\)\}[^&]*`/);
    expect(src).toContain('setVetMode');
  });

  it('NewClientSheet: WorkspaceSheet + tutor/pet unificado + responsável menor', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/components/dashboard/NewClientSheet.tsx', 'utf8');
    expect(src).toContain('WorkspaceSheet');
    expect(src).not.toContain('Drawer');
    expect(src).toContain('vetMode');
    expect(src).toContain('Adicionar pet');
    expect(src).toContain('Responsável legal');
    expect(src).toContain('birthDate');
    expect(src).toContain("action: 'create'");
    // Sem formulário duplicado dentro do agendamento
    const booking = readFileSync('src/components/dashboard/NewBookingSheet.tsx', 'utf8');
    expect(booking).not.toContain('data-new-client-form');
  });

  it('responsável legal é guardian aditivo (profile.guardian), não segundo paciente', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/components/dashboard/NewClientSheet.tsx', 'utf8');
    expect(src).toContain('profile.guardian');
    expect(src).toContain('isMinor: true');
    expect(src).toContain('ageFromBirthDate');
    // Só humano
    expect(src).toContain('!vetMode && age !== null');
  });

  it('cadastro salvo no CRM antes de voltar ao agendamento', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/components/dashboard/NewClientSheet.tsx', 'utf8');
    expect(src).toContain("'/api/contacts', 'POST'");
    const booking = readFileSync('src/components/dashboard/NewBookingSheet.tsx', 'utf8');
    expect(booking).toContain('onClientRegistered');
    // Abandonar agendamento não apaga: cadastro é independente (confirmado no CRM)
    const client = readFileSync('src/components/dashboard/NewClientSheet.tsx', 'utf8');
    expect(client).toContain('Cadastro salvo');
    expect(client).toContain("'/api/contacts', 'POST'");
  });
});
