import { describe, expect, it } from 'vitest';
import {
  agentActive, agentFor, applyAgentVoice, buildKnowledge, defaultAgent, objectiveActions,
  parseKnowledgeOverride, renderGreeting, sanitizeAgentInput,
} from '../agent';
import type { Business, BusinessAgent, DB, Service } from '../types';

function agent(partial: Partial<BusinessAgent> = {}): BusinessAgent {
  return { ...defaultAgent('b1', 'Clínica Vita'), ...partial };
}

function business(partial: Partial<Business> = {}): Business {
  return {
    id: 'b1', ownerId: 'u1', name: 'Clínica Vita', slug: 'clinicavitta', description: 'Odontologia',
    logo: '', cover: '', niche: 'saude', modes: ['bookings', 'services'],
    features: { reviews: false, faq: true, gallery: false, location: false, whatsapp: true, about: true, agent: true },
    phone: '', whatsapp: '11999999999', email: '', instagram: '', tiktok: '', address: 'Rua A, 100', mapsUrl: '',
    hours: { '1': { open: '09:00', close: '18:00' }, '2': { open: '09:00', close: '18:00' } },
    paymentMethods: [], pixKey: '', deliveryFee: 0, minOrder: 0, googleUrl: '', googlePlaceId: '', googleApiKey: '',
    booking: { teamMode: 'team', leadMin: 30, cancelUntilMin: 120, horizonDays: 60, bufferMin: 10 },
    nav: [], navCustom: true,
    about: { title: 'Sobre nós', text: 'Clínica com 10 anos de história', image: '', enabled: true },
    published: true, createdAt: '', updatedAt: '', ...partial,
  } as Business;
}

function db(partial: Partial<DB> = {}): DB {
  return { agents: [], services: [], ...partial } as unknown as DB;
}

const service: Service = {
  id: 's1', businessId: 'b1', name: 'Limpeza', description: '', price: 20000, promoPrice: 0,
  durationMin: 40, active: true, bookable: true, professionalIds: [], order: 0,
  categoryId: '', image: '', featured: false, questions: [],
} as Service;

describe('agente de atendimento — configuração', () => {
  it('sem configuração salva, cai num padrão coerente e habilitado', () => {
    const a = agentFor(db(), business());
    expect(a.businessId).toBe('b1');
    expect(a.name).toContain('Clínica Vita');
    expect(a.tone).toBe('acolhedor');
    expect(a.enabled).toBe(true);
    expect(a.greeting).toContain('{empresa}');
  });

  it('configuração salva vence o padrão e é saneada (tom/objetivos inválidos caem fora)', () => {
    const a = agentFor(db({ agents: [agent({ tone: 'cantor' as any, objectives: ['duvidas' as any, 'xpto' as any], name: 'Vita' })] }), business());
    expect(a.tone).toBe('acolhedor');
    expect(a.objectives).toEqual(['duvidas']);
    expect(a.name).toBe('Vita');
  });

  it('módulo desligado OU agente desativado OU canal site off = agente fora do ar', () => {
    const on = business();
    expect(agentActive(on, agent())).toBe(true);
    expect(agentActive(business({ features: { ...on.features!, agent: false } }), agent())).toBe(false);
    expect(agentActive(on, agent({ enabled: false }))).toBe(false);
    expect(agentActive(on, agent({ channels: { site: false, whatsapp: false } }))).toBe(false);
  });

  it('a saudação substitui {empresa} e {agente} e nunca sai vazia', () => {
    expect(renderGreeting(agent(), 'Clínica Vita')).toBe('Olá! Sou o assistente virtual da Clínica Vita. Como posso ajudar?');
    expect(renderGreeting(agent({ greeting: '' }), 'Clínica Vita').length).toBeGreaterThan(0);
  });

  it('a escalada para humano usa a mensagem configurada, não texto genérico', () => {
    const a = agent({ handoffMessage: 'Já chamo a equipe da Clínica no WhatsApp.' });
    expect(applyAgentVoice(a, 'Clínica Vita', 'texto base do motor', 'fallback')).toBe('Já chamo a equipe da Clínica no WhatsApp.');
    expect(applyAgentVoice(a, 'Clínica Vita', 'Temos horário amanhã.', 'booking')).toBe('Temos horário amanhã.');
  });

  it('objetivos nunca oferecem módulo desligado', () => {
    const a = agent({ objectives: ['orientar_agendamento', 'servicos', 'whatsapp'] });
    const actions = objectiveActions(a, { canBook: false, hasProducts: false, hasQuote: false, hasWhatsapp: true });
    expect(actions.map((x) => x.target)).toEqual(['#servicos', 'whatsapp']);
  });

  it('salvar é saneado: campos longos cortados, booleanos normalizados', () => {
    const cur = agent();
    const out = sanitizeAgentInput('b1', { name: 'x'.repeat(200), enabled: 'sim', objectives: ['duvidas'], tone: 'comercial' }, cur);
    expect(out.name.length).toBe(60);
    expect(out.enabled).toBe(false); // só true explícito liga
    expect(out.objectives).toEqual(['duvidas']);
    expect(out.tone).toBe('comercial');
    expect(out.businessId).toBe('b1');
  });
});

describe('agente — conhecimento vem do dado real', () => {
  it('monta serviços, preços e duração do cadastro', () => {
    const k = buildKnowledge(db({ services: [service] }), business());
    expect(k.services).toEqual([{ name: 'Limpeza', price: 20000, durationMin: 40, bookable: true, pricePublic: true }]);
    expect(k.businessName).toBe('Clínica Vita');
    expect(k.address).toBe('Rua A, 100');
    expect(k.about).toContain('Sobre nós');
  });

  it('preço só é público no conhecimento quando o serviço libera (showPrice)', () => {
    const k = buildKnowledge(db({ services: [{ ...service, showPrice: false }] }), business());
    expect(k.services[0].pricePublic).toBe(false);
    // O preço continua no domínio (interno) — só a EXIBIÇÃO pública muda.
    expect(k.services[0].price).toBe(20000);
  });

  it('conhece os profissionais ativos do negócio', () => {
    const k = buildKnowledge(db({
      services: [service],
      professionals: [
        { id: 'p1', businessId: 'b1', name: 'Dra. Ana', role: 'Dentista', photo: '', active: true },
        { id: 'p2', businessId: 'b1', name: 'Inativo', role: '', photo: '', active: false },
      ] as any,
    }), business());
    expect(k.professionals).toEqual([{ name: 'Dra. Ana', role: 'Dentista' }]);
  });

  it('ignora serviço inativo e inclui a FAQ publicada', () => {
    const k = buildKnowledge(
      db({ services: [service, { ...service, id: 's2', active: false }] }),
      business(),
      { faq: [{ q: 'Atende convênio?', a: 'Sim, Unimed.' }, { q: '', a: 'sem pergunta' }] },
    );
    expect(k.services).toHaveLength(1);
    expect(k.faq).toEqual([{ q: 'Atende convênio?', a: 'Sim, Unimed.' }]);
  });

  it('conhecimento adicional: linhas "Tema: resposta"', () => {
    expect(parseKnowledgeOverride('Estacionamento: convênio ao lado\nSem dois pontos')).toEqual([
      { topic: 'Estacionamento', answer: 'convênio ao lado' },
      { topic: 'Sem dois pontos', answer: 'Sem dois pontos' },
    ]);
    const k = buildKnowledge(
      db({ services: [service], agents: [agent({ knowledgeOverride: 'Estacionamento: convênio ao lado' })] }),
      business(),
    );
    expect(k.extra).toEqual([{ topic: 'Estacionamento', answer: 'convênio ao lado' }]);
  });

  it('horários saem do cadastro da empresa (não inventa)', () => {
    expect(buildKnowledge(db(), business()).hours).toBe('Seg 09:00–18:00 • Ter 09:00–18:00');
    expect(buildKnowledge(db(), business({ hours: {} })).hours).toBe('');
  });
});
