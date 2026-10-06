// ───────────────────────────────────────────────────────────────
// CLINICAL ACCESS — smoke HTTP sobre a fixture descartável (§23).
// ───────────────────────────────────────────────────────────────
// Roda contra um servidor LOCAL com `GODOUTOR_DB_FILE` apontando para a
// fixture de `scripts/seed-clinical-access-qa.mjs`. São checagens de
// LEITURA + tentativas de ESCRITA recusadas (nada destrutivo fora do
// próprio registro de teste do Orlando/Michele na base descartável).
//
// Uso: node scripts/smoke-clinical-access.mjs   (SMOKE_BASE opcional)
const BASE = process.env.SMOKE_BASE || 'http://localhost:3000';
const PASSWORD = 'GodoutorCA2026!';
const A = 'ca-andrioni-qa';
const B = 'ca-bioclin-qa';

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name); console.log(`  ✗ ${name} ${extra}`); }
}
async function api(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}
async function login(email) {
  const r = await api('POST', '/api/auth/login', { email, password: PASSWORD });
  if (r.status !== 200 || !r.data.token) throw new Error(`login ${email} falhou (${r.status})`);
  return r.data.token;
}

console.log(`\nCLINICAL ACCESS SMOKE ${BASE}`);
const owner = await login('owner.ca@godoutor.test');
const maria = await login('recepcao.ca@godoutor.test');
const orlando = await login('orlando.ca@godoutor.test');
const michele = await login('michele.ca@godoutor.test');
const fora = await login('fora.ca@godoutor.test');

// ── A/B/C · Michele localiza e lê o paciente de outro profissional ──
const pets = await api('GET', `/api/pets?businessId=${A}`, null, michele);
check('A · Michele lista os pacientes da unidade (Isabelle incluso, sem vínculo próprio)',
  pets.status === 200 && pets.data.pets.some((p) => p.id === 'pet-isabelle'), `(${pets.status})`);
const search = await api('GET', `/api/search?businessId=${A}&q=Isabelle`, null, michele);
check('A · busca encontra o paciente da unidade', search.status === 200 && search.data.groups.some((h) => h.group === 'pets'),
  `(${search.status})`);
const searchAna = await api('GET', `/api/search?businessId=${A}&q=Ana`, null, michele);
check('A · busca não vaza a agenda do outro profissional',
  searchAna.status === 200 && !searchAna.data.groups.some((h) => h.id === 'booking:bk-orlando'),
  JSON.stringify(searchAna.data.groups?.filter((h) => h.group === 'agendamentos') || []));
check('A · busca sem permissão de WhatsApp não traz conversas',
  searchAna.status === 200 && !searchAna.data.groups.some((h) => h.group === 'conversas'));

const contacts = await api('GET', `/api/contacts?businessId=${A}&q=Ana`, null, michele);
const clinicalContact = contacts.data.contacts?.[0];
check('B · /api/contacts entrega ao Professional somente id/nome/telefone',
  contacts.status === 200 && JSON.stringify(Object.keys(clinicalContact || {}).sort()) === JSON.stringify(['id', 'name', 'phone']),
  JSON.stringify(clinicalContact));

const p360 = await api('GET', `/api/people360?businessId=${A}&q=Ana`, null, michele);
const ana = (p360.data.people || []).find((p) => p.name === 'Tutora Ana QA');
check('B · Paciente 360 do tutor abre para quem atende', p360.status === 200 && !!ana, `(${p360.status})`);
check('B · People 360 usa projeção clínica allow-list sem CRM/conta/perfil',
  !!ana && JSON.stringify(Object.keys(ana).sort()) === JSON.stringify(['bookings', 'contactId', 'key', 'name', 'phone'])
  && !JSON.stringify({ contact: clinicalContact, person: ana }).match(/customer-ana-private-sentinel|privado@example\.test|conta-privada@example\.test|campanha-privada|NOTA_ADMIN_PRIVADA|HISTORICO_ADMIN_PRIVADO|PROFILE_ADMIN_SENTINEL|RUA_PRIVADA_SENTINELA|TAG_PERFIL_PRIVADA/),
  JSON.stringify({ fields: Object.keys(ana || {}), key: ana?.key }));

const hist = await api('GET', `/api/encounters?businessId=${A}&petId=pet-isabelle`, null, michele);
const histIds = (hist.data.encounters || []).map((e) => e.id).sort();
check('C · histórico longitudinal da Isabelle inclui o Encounter do Orlando',
  hist.status === 200 && histIds.join(',') === 'enc-orlando,enc-orlando-final', `(${hist.status}) ${histIds}`);
const orlandoRow = (hist.data.encounters || []).find((e) => e.id === 'enc-orlando');
check('C · o registro diz QUEM atendeu', !!orlandoRow && orlandoRow.professionalName === 'Dr. Orlando QA',
  orlandoRow?.professionalName);

// ── D · read-only no Encounter alheio (leitura sim; escrita não) ──
const byId = await api('GET', `/api/encounters?businessId=${A}&id=enc-orlando`, null, michele);
check('D · Michele abre o Encounter do Orlando', byId.status === 200, `(${byId.status})`);
check('D · …em READ-ONLY (canEditCore=false)', byId.data?.encounter?.access?.canEditCore === false);
const writeOther = await api('PATCH', '/api/encounters', { businessId: A, id: 'enc-orlando', expectedVersion: 3, evolution: 'x' }, michele);
check('D · escrita no Encounter alheio é 403', writeOther.status === 403, `(${writeOther.status})`);
const finalOther = await api('PATCH', '/api/encounters', { businessId: A, id: 'enc-orlando-final', expectedVersion: 5, action: 'addendum', text: 'x' }, michele);
check('D · nota complementar em registro alheio é recusada', finalOther.status === 403, `(${finalOther.status})`);

// ── E/F · escrita só do responsável (simetria) ──
const ownWrite = await api('PATCH', '/api/encounters', { businessId: A, id: 'enc-michele-thor', expectedVersion: 3, evolution: 'Evolução da Michele (smoke).' }, michele);
check('E · Michele escreve no PRÓPRIO Encounter', ownWrite.status === 200, `(${ownWrite.status})`);
const orlandoRead = await api('GET', `/api/encounters?businessId=${A}&id=enc-michele-thor`, null, orlando);
check('F · Orlando lê o registro da Michele em read-only',
  orlandoRead.status === 200 && orlandoRead.data?.encounter?.access?.canEditCore === false, `(${orlandoRead.status})`);
const orlandoWrite = await api('PATCH', '/api/encounters', { businessId: A, id: 'enc-michele-thor', expectedVersion: 4, evolution: 'x' }, orlando);
check('F · Orlando não escreve no registro da Michele', orlandoWrite.status === 403, `(${orlandoWrite.status})`);

// ── G/H · agenda e Início continuam só do profissional ──
const manage = await api('GET', `/api/bookings?businessId=${A}&mode=manage&from=${new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)}&to=${new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)}`, null, michele);
const manageIds = (manage.data.bookings || []).map((b) => b.id).sort();
check('G · agenda da Michele só com os agendamentos dela',
  manage.status === 200 && manageIds.join(',') === 'bk-michele-isabelle,bk-michele-thor', `(${manage.status}) ${manageIds}`);
const patientBookings = await api('GET', `/api/bookings?businessId=${A}&mode=patient&petId=pet-isabelle`, null, michele);
const patientIds = (patientBookings.data.bookings || []).map((b) => b.id).sort();
check('G · contexto clínico do paciente mostra os agendamentos DELE na unidade',
  patientBookings.status === 200 && patientIds.join(',') === 'bk-michele-isabelle,bk-orlando', `(${patientBookings.status}) ${patientIds}`);
const overview = await api('GET', `/api/overview?businessId=${A}`, null, michele);
check('H · Início da Michele é o "Meu dia"', overview.status === 200 && !JSON.stringify(overview.data).includes('bk-orlando'), `(${overview.status})`);

// ── I/J · módulos comerciais não vêm com o acesso clínico ──
check('I · Conversas é 403 sem a permissão de WhatsApp', (await api('GET', `/api/conversations?businessId=${A}`, null, michele)).status === 403);
check('I · overview não devolve bloco de conversas', !overview.data?.whatsapp);
check('J · Financeiro é 403', (await api('GET', `/api/finance?businessId=${A}`, null, michele)).status === 403);
check('J · saída completa da base é 403', (await api('GET', `/api/contacts/export-full?businessId=${A}`, null, michele)).status === 403);

// ── K/L · Recepção e Owner sem identidade clínica ──
check('K · Recepção opera clientes (200)',
  (await api('GET', `/api/contacts?businessId=${A}&limit=50`, null, maria)).status === 200);
check('K · Recepção NÃO lê o registro clínico por id',
  (await api('GET', `/api/encounters?businessId=${A}&id=enc-orlando`, null, maria)).status === 403);
check('K · Recepção NÃO inicia atendimento',
  (await api('POST', '/api/encounters', { businessId: A, bookingId: 'bk-orlando' }, maria)).status === 403);
const ownerRead = await api('GET', `/api/encounters?businessId=${A}&id=enc-orlando`, null, owner);
check('L · Owner administra e lê (regra F1C preservada)', ownerRead.status === 200, `(${ownerRead.status})`);
check('L · Owner sem vínculo não assina clínica (canEditCore=false)', ownerRead.data?.encounter?.access?.canEditCore === false);
check('L · Owner sem vínculo não escreve evolução',
  (await api('PATCH', '/api/encounters', { businessId: A, id: 'enc-orlando', expectedVersion: 3, evolution: 'x' }, owner)).status === 403);

// ── M · tenant é barreira absoluta ──
check('M · Encounter de outro tenant é 404',
  (await api('GET', `/api/encounters?businessId=${A}&id=enc-fora`, null, michele)).status === 404);
check('M · pet de outro tenant não aparece',
  !(await api('GET', `/api/pets?businessId=${A}`, null, michele)).data.pets.some((p) => p.id === 'pet-fora'));
check('M · dono do outro tenant não entra na clínica A',
  (await api('GET', `/api/encounters?businessId=${A}&id=enc-orlando`, null, fora)).status === 403);
check('M · contexto do paciente nunca cruza a unidade',
  ((await api('GET', `/api/bookings?businessId=${B}&mode=patient&petId=pet-fora`, null, fora)).data.bookings || []).every((b) => b.businessId === B));

console.log(`\nRESULTADO: ${pass} PASS / ${fail} FAIL`);
if (failures.length) { console.log('Falhas:'); failures.forEach((f) => console.log(` - ${f}`)); }
process.exit(fail ? 1 : 0);
