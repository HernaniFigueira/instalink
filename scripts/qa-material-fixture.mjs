// ═══════════════════════════════════════════════════════════════
// DS 1.1 — FIXTURE EXTRA (prontuário SOMENTE LEITURA)
// ═══════════════════════════════════════════════════════════════
// A fixture da UX Closure cobre Shell/Agenda, mas não tem atendimento — e o §11
// da missão exige evidência REAL da leitura do prontuário (registro finalizado,
// campos vazios, nota interna recolhida).
//
// Este script percorre o caminho de autoridade do sistema, sem atalho nenhum:
//
//   1. login do dono (nunca cria conta nova de dono);
//   2. "Adicionar pessoa" (/api/team person.save) cria o PROFISSIONAL com acesso
//      clínico e login — é o vínculo real `Professional.userId` que o servidor
//      exige para escrever conteúdo clínico;
//   3. o tutor da fixture ganha um pet (/api/pets) — clínica veterinária exige
//      paciente válido para o registro clínico;
//   4. o PROFISSIONAL abre dois atendimentos de balcão e FINALIZA os dois:
//      um com conteúdo (parágrafos, retorno, nota interna) e outro só com a
//      queixa — o segundo é a evidência do estado "Não informado", porque a
//      regra clínica (`canFinalize`) não permite finalizar registro sem corpo;
//   5. grava `material.json` com os ids, para a captura logar como DONO (que
//      enxerga o registro finalizado em LEITURA) e fotografar as duas telas.
//
// Local, sintético, DATABASE_URL proibido. As rotas são as do produto.
import fs from 'node:fs/promises';

const base = process.env.DESIGN_TEST_BASE_URL || 'http://127.0.0.1:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname) || process.env.DATABASE_URL) {
  throw Error('Fixture local e isolada: somente servidor local, DATABASE_URL proibido.');
}
const fixtureFile = process.env.QA_UX_FIXTURE || '/home/user/.cache/qa-ux/fixture.json';
const outFile = process.env.QA_UX_MATERIAL_FIXTURE || '/home/user/.cache/qa-ux/material.json';
try { await fs.access(outFile); throw Error('Fixture material já existe — reutilize, não duplique.'); }
catch (e) { if (e.code !== 'ENOENT') throw e; }

const fx = JSON.parse(await fs.readFile(fixtureFile, 'utf8'));
const SENHA_CLINICA = 'GodoutorDS11-QA!';
const EMAIL_CLINICA = `clinico-${Date.now().toString(36)}@example.invalid`;

async function api(path, body, method = 'POST', token = '') {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Error(`${method} ${path}: ${res.status} ${JSON.stringify(data)}`);
  return data;
}
const login = async (email, password) => (await api('/api/auth/login', { email, password })).token;

const auth = await login(fx.owner.email, fx.owner.password);

// 2) PROFISSIONAL com acesso clínico (vínculo real Professional.userId).
const pessoa = await api('/api/team', {
  businessId: fx.b, action: 'person.save', mode: 'create',
  name: 'Dra. Orlanda Vet QA', email: EMAIL_CLINICA, role: 'PROFISSIONAL',
  hasAccess: true, hasClinical: true, password: SENHA_CLINICA,
  funcao: 'Clínica médica veterinária', serviceIds: [fx.serviceId], serviceSelectionExplicit: true,
}, 'POST', auth);
const professionalId = pessoa.professionalId || pessoa.professional?.id || pessoa.pessoa?.professionalId || '';
if (!professionalId) throw Error(`person.save não devolveu o profissional: ${JSON.stringify(pessoa).slice(0, 300)}`);

// 2b) SERVIÇO do profissional do QA. Os serviços da fixture têm lista explícita
//     de profissionais (Dra. Helena/Dr. Pedro) e o servidor recusa atendimento
//     de serviço que o profissional não realiza — regra real, não contornada.
const servico = await api('/api/catalog', {
  businessId: fx.b, action: 'service.save', id: crypto.randomUUID(),
  name: 'Consulta clínica (QA leitura)', description: 'Serviço sintético do QA visual.',
  durationMin: 30, price: 15000, showPrice: true, bookable: true, professionalIds: [professionalId],
}, 'POST', auth);
const serviceId = servico.serviceId || servico.service?.id || '';
if (!serviceId) throw Error(`service.save não devolveu o serviço: ${JSON.stringify(servico).slice(0, 200)}`);

// 3) Tutor e pet da fixture (o tutor já existe: os agendamentos criaram o contato).
const tutor = (await api(`/api/contacts?businessId=${fx.b}&q=${encodeURIComponent(fx.bookings[1].customerPhone)}&limit=5`, null, 'GET', auth)).contacts?.[0];
if (!tutor?.id) throw Error('Contato da fixture não encontrado para vincular o pet.');
const petSalvo = await api('/api/pets', {
  businessId: fx.b, action: 'create', tutorId: tutor.id,
  pet: { name: `${fx.bookings[1].petName} QA`, species: 'cachorro', breed: 'SRD', sex: 'M' },
}, 'POST', auth);
const petId = petSalvo.pet?.id || petSalvo.petId || '';
if (!petId) throw Error('O pet do QA não foi criado.');

// 4) Dois atendimentos finalizados — pelo PROFISSIONAL responsável.
const authClinico = await login(EMAIL_CLINICA, SENHA_CLINICA);

async function abrirEFinalizar(conteudo) {
  // Chegada sem horário marcado = FILA do balcão (a rota recusa atendimento
  // "solto": ou vem de agendamento, ou da fila — é a regra do produto).
  const fila = await api('/api/queue', {
    businessId: fx.b, professionalId, contactId: tutor.id, serviceId: conteudo.serviceId,
    customerName: tutor.name, customerPhone: tutor.phone,
  }, 'POST', authClinico);
  const queueId = fila.entry?.id;
  if (!queueId) throw Error('A fila não devolveu a entrada.');
  const aberto = await api('/api/encounters', {
    businessId: fx.b, queueId, petId, ...conteudo,
  }, 'POST', authClinico);
  const enc = aberto.encounter;
  if (!enc?.id) throw Error('A rota não devolveu o atendimento aberto.');
  const fechado = await api('/api/encounters', {
    businessId: fx.b, id: enc.id, action: 'finalize', expectedVersion: enc.version,
  }, 'PATCH', authClinico);
  const status = fechado.encounter?.status || fechado.status;
  if (status !== 'finalized') throw Error(`Finalização não confirmou: ${JSON.stringify(fechado).slice(0, 200)}`);
  return enc.id;
}

const completo = await abrirEFinalizar({
  serviceId,
  complaint: 'Tutora relata que o paciente está comendo menos desde ontem.',
  evolution: 'Exame físico sem alterações relevantes.\n\nPeso estável em relação à última visita.\n\nOrientada hidratação e retorno se houver vômito.',
  guidance: 'Manter alimentação habitual e observar apetite por 48h. Retornar se houver vômito ou prostração.',
  internalNote: 'Tutora comentou que vai viajar na semana que vem — alinhar retorno antes da viagem.',
  followUpMode: 'interval', followUpDays: 30, followUp: 'Retorno em 30 dias para reavaliação de peso.',
  tags: 'apetite, pesagem',
});

const soQueixa = await abrirEFinalizar({
  serviceId,
  complaint: 'Tutora trouxe o paciente apenas para conferir a carteira de vacinação.',
});

// 5) Ficha de anamnese (preset da vertical, pela rota do produto) e um
//    atendimento EM RASCUNHO: é onde vive a evidência real de ERRO DE CAMPO
//    (a ficha exige campos e o `Field` canônico mostra o erro no próprio campo).
const ficha = await api('/api/anamnese', { businessId: fx.b, action: 'template.seed' }, 'POST', auth);
const rascunho = await (async () => {
  const fila = await api('/api/queue', {
    businessId: fx.b, professionalId, contactId: tutor.id, serviceId,
    customerName: tutor.name, customerPhone: tutor.phone,
  }, 'POST', authClinico);
  const aberto = await api('/api/encounters', {
    businessId: fx.b, queueId: fila.entry.id, petId, serviceId,
    complaint: 'Rascunho para homologação do formulário canônico.',
  }, 'POST', authClinico);
  return aberto.encounter.id;
})();

await fs.writeFile(outFile, JSON.stringify({
  ...fx, professionalId, petId, tutorId: tutor.id, serviceId, clinicoEmail: EMAIL_CLINICA,
  encounterId: completo, encounterVazioId: soQueixa,
  draftEncounterId: rascunho, anamneseTemplateId: ficha.template?.id || '',
}, null, 2), { mode: 0o600 });
console.log('Fixture DS 1.1 pronta:', outFile);
