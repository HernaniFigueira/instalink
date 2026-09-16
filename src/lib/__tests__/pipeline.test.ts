import { describe, expect, it } from 'vitest';
import { emptyDB } from '../db';
import {
  DEFAULT_PIPELINE_STAGES, SIMPLE_STAGE_IDS, getBusinessPipeline,
  updateBusinessPipeline, ingestLead, moveLeadStage, assignLead,
  addLeadNote, bookLead, findLead,
} from '../pipeline';
import type { Business, DB, Service, User } from '../types';

function mockBiz(id: string): Business {
  return {
    id,
    ownerId: 'u-owner',
    name: `Negócio ${id}`,
    slug: id,
    description: '',
    logo: '',
    cover: '',
    niche: 'beleza',
    modes: ['services', 'bookings'],
    phone: '11999990000',
    whatsapp: '11999990000',
    email: 'biz@test.com',
    instagram: '',
    tiktok: '',
    address: '',
    mapsUrl: '',
    hours: {
      '1': { open: '09:00', close: '18:00' },
      '2': { open: '09:00', close: '18:00' },
      '3': { open: '09:00', close: '18:00' },
      '4': { open: '09:00', close: '18:00' },
      '5': { open: '09:00', close: '18:00' },
    },
    paymentMethods: ['pix'],
    pixKey: '',
    deliveryFee: 0,
    minOrder: 0,
    googleUrl: '',
    googlePlaceId: '',
    googleApiKey: '',
    booking: {
      teamMode: 'solo',
      leadMin: 0,
      cancelUntilMin: 60,
      horizonDays: 60,
      bufferMin: 0,
    },
    nav: [],
    navCustom: false,
    about: { title: '', text: '', image: '', enabled: false },
    published: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function mockService(id: string, businessId: string): Service {
  return {
    id,
    businessId,
    categoryId: '',
    name: 'Corte de Cabelo',
    description: 'Corte tradicional',
    image: '',
    price: 5000,
    durationMin: 30,
    active: true,
    bookable: true,
    professionalIds: [],
    questions: [],
    featured: false,
  };
}

function mockUser(id: string, name: string, active = true): User {
  return {
    id,
    name,
    email: `${id}@teste.com`,
    passwordHash: 'hash',
    active,
    createdAt: new Date().toISOString(),
  };
}

function mockMember(id: string, businessId: string, userId: string, role: any = 'SECRETARIA', active = true): any {
  return {
    id,
    businessId,
    userId,
    role,
    permissions: {},
    active,
    note: '',
    invitedBy: 'u-owner',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe('P3 Esteira — Pipeline Configuration', () => {
  it('cria pipeline com os estágios padrão quando não configurado', () => {
    const db = emptyDB();
    const p = getBusinessPipeline(db, 'biz-1');
    expect(p.businessId).toBe('biz-1');
    expect(p.stages.map((s) => s.id)).toEqual([
      'new', 'in_progress', 'qualifying', 'qualified',
      'waiting_secretary', 'scheduled', 'converted', 'lost',
    ]);
    expect(SIMPLE_STAGE_IDS).toEqual(['new', 'in_progress', 'scheduled', 'converted']);
  });

  it('permite atualizar e renomear estágios garantindo new e converted', () => {
    const db = emptyDB();
    const custom = updateBusinessPipeline(db, 'biz-1', [
      { id: 'new', name: 'Chegou agora', order: 0 },
      { id: 'em_triagem', name: 'Triagem Inicial', order: 1 },
      { id: 'converted', name: 'Fechado com sucesso', order: 2 },
    ]);

    expect(custom.stages.find((s) => s.id === 'new')?.name).toBe('Chegou agora');
    expect(custom.stages.find((s) => s.id === 'em_triagem')?.name).toBe('Triagem Inicial');
    expect(custom.stages.find((s) => s.id === 'converted')?.name).toBe('Fechado com sucesso');
  });
});

describe('P3 Entrada Universal de Leads e Deduplicação', () => {
  it('cria novo lead externo com origem, canal e metadados preservados', () => {
    const db = emptyDB();
    db.businesses.push(mockBiz('biz-1'));

    const { lead, isNew, contact } = ingestLead(db, {
      businessId: 'biz-1',
      name: 'Carlos Alberto',
      phone: '11988887777',
      email: 'carlos@exemplo.com',
      source: 'external_site',
      sourceUrl: 'https://sitecliente.com.br/avaliacao',
      message: 'Gostaria de agendar uma consulta para a próxima semana.',
      metadata: { utm_campaign: 'google_ads_implante', page_id: 'lp-01' },
      actor: { id: 'api-key-1', name: 'Integração Site', type: 'api' },
    });

    expect(isNew).toBe(true);
    expect(lead.name).toBe('Carlos Alberto');
    expect(lead.phone).toBe('11988887777');
    expect(lead.origin).toBe('external_site');
    expect(lead.sourceUrl).toBe('https://sitecliente.com.br/avaliacao');
    expect(lead.metadata?.utm_campaign).toBe('google_ads_implante');
    expect(lead.stageId).toBe('new');
    expect(lead.status).toBe('new');
    expect(lead.notes?.[0].text).toContain('Gostaria de agendar');
    expect(lead.stageHistory?.[0].toStage).toBe('new');

    // Contato no CRM criado automaticamente
    expect(contact).not.toBeNull();
    expect(contact?.phone).toBe('11988887777');
    expect(db.contacts.length).toBe(1);
    expect(db.leads.length).toBe(1);
  });

  it('deduplica lead por telefone e atualiza informações sem duplicar pessoa', () => {
    const db = emptyDB();
    db.businesses.push(mockBiz('biz-1'));

    // Primeiro contato
    ingestLead(db, {
      businessId: 'biz-1',
      name: 'Carlos',
      phone: '(11) 98888-7777',
      source: 'public_page',
    });
    expect(db.leads.length).toBe(1);
    expect(db.contacts.length).toBe(1);

    // Segundo contato vindo de site externo com mesmo telefone
    const { lead: secondLead, isNew } = ingestLead(db, {
      businessId: 'biz-1',
      name: 'Carlos Alberto Silva',
      phone: '11988887777',
      email: 'carlos@gmail.com',
      source: 'external_site',
      message: 'Nova mensagem de interesse.',
    });

    expect(isNew).toBe(false);
    expect(db.leads.length).toBe(1); // Não criou segundo lead
    expect(db.contacts.length).toBe(1); // Não criou segundo contato
    expect(secondLead.phone).toBe('11988887777');
    expect(secondLead.email).toBe('carlos@gmail.com');
    expect(secondLead.notes?.[0].text).toBe('Nova mensagem de interesse.');
  });

  it('deduplica por email quando informado', () => {
    const db = emptyDB();
    db.businesses.push(mockBiz('biz-1'));

    ingestLead(db, {
      businessId: 'biz-1',
      name: 'Mariana',
      email: 'mariana@teste.com',
      source: 'landing_page',
    });

    const second = ingestLead(db, {
      businessId: 'biz-1',
      name: 'Mariana Souza',
      email: 'mariana@teste.com',
      phone: '11911112222',
      source: 'external_site',
    });

    expect(second.isNew).toBe(false);
    expect(db.leads.length).toBe(1);
    expect(second.lead.phone).toBe('11911112222');
  });
});

describe('P3 Movimentação de Etapas e Histórico', () => {
  it('move estágio na esteira e grava histórico append-only com autor e data', () => {
    const db = emptyDB();
    db.businesses.push(mockBiz('biz-1'));

    const { lead } = ingestLead(db, {
      businessId: 'biz-1',
      name: 'Renata',
      phone: '11977776666',
    });

    const actor = { id: 'usr-1', name: 'Ana Secretária', role: 'SECRETARIA' };
    const moved = moveLeadStage(db, {
      businessId: 'biz-1',
      leadId: lead.id,
      toStageId: 'in_progress',
      note: 'Iniciei atendimento no WhatsApp',
      actor,
    });

    expect(moved.stageId).toBe('in_progress');
    expect(moved.status).toBe('contacted');
    expect(moved.stageHistory?.length).toBe(2);

    const lastHistory = moved.stageHistory![1];
    expect(lastHistory.fromStage).toBe('new');
    expect(lastHistory.toStage).toBe('in_progress');
    expect(lastHistory.movedByName).toBe('Ana Secretária');
    expect(lastHistory.note).toBe('Iniciei atendimento no WhatsApp');

    // Movimentação subsequente para "Aguardando secretaria"
    const moved2 = moveLeadStage(db, {
      businessId: 'biz-1',
      leadId: lead.id,
      toStageId: 'waiting_secretary',
      note: 'Cliente tem dúvidas sobre valores',
      actor: { id: 'usr-bot', name: 'Assistente', role: 'bot' },
    });

    expect(moved2.stageId).toBe('waiting_secretary');
    expect(moved2.stageHistory?.length).toBe(3);
    expect(moved2.stageHistory![2].toStage).toBe('waiting_secretary');
  });

  it('permite atribuir responsável ativo da unidade e grava registro no histórico', () => {
    const db = emptyDB();
    db.businesses.push(mockBiz('biz-1'));
    db.users.push(mockUser('u-secretaria', 'Secretária Carla'));
    db.members.push(mockMember('m-1', 'biz-1', 'u-secretaria', 'SECRETARIA'));

    const { lead } = ingestLead(db, {
      businessId: 'biz-1',
      name: 'Lucas',
      phone: '11966665555',
    });

    const assigned = assignLead(db, {
      businessId: 'biz-1',
      leadId: lead.id,
      assignedUserId: 'u-secretaria',
      actor: { id: 'u-owner', name: 'Proprietário' },
    });

    expect(assigned.assignedUserId).toBe('u-secretaria');
    expect(assigned.stageHistory?.some((h) => h.note?.includes('Responsável'))).toBe(true);
  });

  describe('P3 Integridade da Atribuição (assignedUserId)', () => {
    it('aceita o proprietário do negócio', () => {
      const db = emptyDB();
      const biz = mockBiz('biz-1');
      biz.ownerId = 'u-dono';
      db.businesses.push(biz);
      db.users.push(mockUser('u-dono', 'Dono da Silva'));

      const { lead } = ingestLead(db, { businessId: 'biz-1', name: 'Lead 1', phone: '11911112222' });
      const assigned = assignLead(db, {
        businessId: 'biz-1',
        leadId: lead.id,
        assignedUserId: 'u-dono',
        actor: { id: 'u-dono', name: 'Dono' },
      });
      expect(assigned.assignedUserId).toBe('u-dono');
    });

    it('aceita membro ativo associado ao mesmo negócio', () => {
      const db = emptyDB();
      db.businesses.push(mockBiz('biz-1'));
      db.users.push(mockUser('u-atendente', 'Atendente'));
      db.members.push(mockMember('m-1', 'biz-1', 'u-atendente', 'ATENDENTE'));

      const { lead } = ingestLead(db, { businessId: 'biz-1', name: 'Lead 2', phone: '11922223333' });
      const assigned = assignLead(db, {
        businessId: 'biz-1',
        leadId: lead.id,
        assignedUserId: 'u-atendente',
        actor: { id: 'u-owner', name: 'Proprietário' },
      });
      expect(assigned.assignedUserId).toBe('u-atendente');
    });

    it('permite desatribuir responsável passando string vazia', () => {
      const db = emptyDB();
      db.businesses.push(mockBiz('biz-1'));
      db.users.push(mockUser('u-1', 'Colab'));
      db.members.push(mockMember('m-1', 'biz-1', 'u-1', 'ATENDENTE'));

      const { lead } = ingestLead(db, { businessId: 'biz-1', name: 'Lead 3', phone: '11933334444' });
      assignLead(db, { businessId: 'biz-1', leadId: lead.id, assignedUserId: 'u-1', actor: { id: 'u-owner', name: 'Owner' } });
      expect(lead.assignedUserId).toBe('u-1');

      const unassigned = assignLead(db, { businessId: 'biz-1', leadId: lead.id, assignedUserId: '', actor: { id: 'u-owner', name: 'Owner' } });
      expect(unassigned.assignedUserId).toBe('');
    });

    it('rejeita usuário de outro Business e não grava alteração parcial', () => {
      const db = emptyDB();
      db.businesses.push(mockBiz('biz-1'));
      db.businesses.push(mockBiz('biz-2'));

      db.users.push(mockUser('u-biz-2', 'Membro Biz 2'));
      db.members.push(mockMember('m-2', 'biz-2', 'u-biz-2', 'SECRETARIA'));

      const { lead } = ingestLead(db, { businessId: 'biz-1', name: 'Lead 4', phone: '11944445555' });
      const historyLenBefore = lead.stageHistory?.length || 0;

      expect(() => {
        assignLead(db, {
          businessId: 'biz-1',
          leadId: lead.id,
          assignedUserId: 'u-biz-2', // Usuário é de biz-2, não de biz-1!
          actor: { id: 'u-owner', name: 'Owner' },
        });
      }).toThrow(/não pertence à equipe/i);

      // Integridade preservada: o lead não teve responsável alterado nem histórico poluído
      expect(lead.assignedUserId).toBe('');
      expect(lead.stageHistory?.length).toBe(historyLenBefore);
    });

    it('rejeita usuário inexistente', () => {
      const db = emptyDB();
      db.businesses.push(mockBiz('biz-1'));

      const { lead } = ingestLead(db, { businessId: 'biz-1', name: 'Lead 5', phone: '11955556666' });

      expect(() => {
        assignLead(db, {
          businessId: 'biz-1',
          leadId: lead.id,
          assignedUserId: 'usr-fantasma-999',
          actor: { id: 'u-owner', name: 'Owner' },
        });
      }).toThrow(/não existe/i);

      expect(lead.assignedUserId).toBe('');
    });

    it('rejeita usuário inativo (user.active === false)', () => {
      const db = emptyDB();
      db.businesses.push(mockBiz('biz-1'));
      db.users.push(mockUser('u-inativo', 'Ex-Funcionário', false));
      db.members.push(mockMember('m-1', 'biz-1', 'u-inativo', 'ATENDENTE', true));

      const { lead } = ingestLead(db, { businessId: 'biz-1', name: 'Lead 6', phone: '11966667777' });

      expect(() => {
        assignLead(db, {
          businessId: 'biz-1',
          leadId: lead.id,
          assignedUserId: 'u-inativo',
          actor: { id: 'u-owner', name: 'Owner' },
        });
      }).toThrow(/inativo/i);

      expect(lead.assignedUserId).toBe('');
    });

    it('rejeita membro com acesso inativo na unidade (member.active === false)', () => {
      const db = emptyDB();
      db.businesses.push(mockBiz('biz-1'));
      db.users.push(mockUser('u-removido', 'Desativado da Unidade', true));
      db.members.push(mockMember('m-1', 'biz-1', 'u-removido', 'ATENDENTE', false)); // membro inativo!

      const { lead } = ingestLead(db, { businessId: 'biz-1', name: 'Lead 7', phone: '11966668888' });

      expect(() => {
        assignLead(db, {
          businessId: 'biz-1',
          leadId: lead.id,
          assignedUserId: 'u-removido',
          actor: { id: 'u-owner', name: 'Owner' },
        });
      }).toThrow(/não pertence à equipe/i);

      expect(lead.assignedUserId).toBe('');
    });

    it('ingestLead com assignedUserId inválido rejeita na entrada antes de criar o lead', () => {
      const db = emptyDB();
      db.businesses.push(mockBiz('biz-1'));

      expect(() => {
        ingestLead(db, {
          businessId: 'biz-1',
          name: 'Lead Novo',
          phone: '11977778888',
          assignedUserId: 'usr-inexistente',
        });
      }).toThrow(/não existe/i);

      // Nenhum lead criado
      expect(db.leads.length).toBe(0);
      expect(db.contacts.length).toBe(0);
    });
  });

  it('adiciona observações append-only no lead e replica no contato', () => {
    const db = emptyDB();
    db.businesses.push(mockBiz('biz-1'));

    const { lead } = ingestLead(db, {
      businessId: 'biz-1',
      name: 'Beatriz',
      phone: '11955554444',
    });

    const note = addLeadNote(db, {
      businessId: 'biz-1',
      leadId: lead.id,
      text: 'Prefere ser contatada no final da tarde.',
      actor: { id: 'u-1', name: 'Atendente' },
    });

    expect(note.text).toBe('Prefere ser contatada no final da tarde.');
    expect(lead.notes?.length).toBe(1);

    const contact = db.contacts.find((c) => c.businessId === 'biz-1');
    expect(contact?.notes?.some((n) => n.text.includes('final da tarde'))).toBe(true);
  });
});

describe('P3 Saída da Esteira para Agendamento', () => {
  it('converte lead diretamente para agendamento mantendo regras da agenda e vínculo', () => {
    const db = emptyDB();
    const biz = mockBiz('biz-1');
    const svc = mockService('svc-1', 'biz-1');
    db.businesses.push(biz);
    db.services.push(svc);

    // Regra de disponibilidade da empresa: segunda a sexta das 09:00 às 18:00
    db.availability.push({
      id: 'av-1',
      businessId: 'biz-1',
      professionalId: '',
      weekday: 1, // segunda
      start: '09:00',
      end: '18:00',
      slotMin: 0,
      serviceId: '',
    });

    const { lead } = ingestLead(db, {
      businessId: 'biz-1',
      name: 'Fernanda Lima',
      phone: '11944443333',
      interest: 'Corte de Cabelo',
    });

    // Próxima segunda-feira futura garantida
    const nextMonday = '2026-09-21'; // 2026-09-21 é segunda-feira

    const { booking, lead: updatedLead } = bookLead(db, {
      business: biz,
      service: svc,
      leadId: lead.id,
      date: nextMonday,
      time: '10:00',
      actor: { id: 'u-sec', name: 'Secretária', role: 'SECRETARIA' },
    });

    expect(booking).toBeDefined();
    expect(booking.customerName).toBe('Fernanda Lima');
    expect(booking.customerPhone).toBe('11944443333');
    expect(booking.leadId).toBe(lead.id);

    // Lead atualizado para scheduled e status converted
    expect(updatedLead.stageId).toBe('scheduled');
    expect(updatedLead.status).toBe('converted');
    expect(updatedLead.bookingId).toBe(booking.id);

    // Não duplicou contato
    expect(db.contacts.filter((c) => c.businessId === 'biz-1').length).toBe(1);
    // Não duplicou lead
    expect(db.leads.filter((l) => l.businessId === 'biz-1').length).toBe(1);
  });
});
