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
    // Usa o cadastro REAL, agora na página /clientes/novo (Missão 02): o
    // agendamento vai para o rascunho de sessão e a rota de cadastro recebe o fluxo.
    expect(src).toContain('newClientFromBookingHref');
    expect(src).toContain('writeBookingReturn(');
    // Painel lateral de cadastro removido (Missão 02): sem NewClientForm aninhado.
    expect(src).not.toContain('side={registerOpen');
    // picked = contato JÁ existente no CRM
    expect(src).toContain('const picked = !!contactId');
  });

  it('vetMode vem do business (pets sem tutorId), não de contactId', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/components/dashboard/NewBookingSheet.tsx', 'utf8');
    expect(src).toMatch(/pets\?businessId=\$\{encodeURIComponent\(businessId\)\}[^&]*`/);
    expect(src).toContain('setVetMode');
  });

  it('NewClientSheet: formulário único de PÁGINA (sem Sheet/Drawer) + tutor/pet unificado + responsável menor', async () => {
    // Missão 02: o cadastro completo é tela própria (/clientes/novo); não é mais WorkspaceSheet.
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/components/dashboard/NewClientSheet.tsx', 'utf8');
    expect(src).not.toContain('WorkspaceSheet');
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
    // Missão 02: o retorno é o rascunho de sessão + a página de cadastro (sem onClientRegistered).
    expect(booking).toContain('writeBookingReturn(');
    const page = readFileSync('src/app/(dashboard)/clientes/novo/page.tsx', 'utf8');
    expect(page).toContain('withRegisteredClient(draft');
    // Abandonar agendamento não apaga: cadastro é independente (confirmado no CRM)
    const client = readFileSync('src/components/dashboard/NewClientSheet.tsx', 'utf8');
    expect(client).toContain('Cadastro salvo');
    expect(client).toContain("'/api/contacts', 'POST'");
  });
});
