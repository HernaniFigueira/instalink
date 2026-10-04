import { durationLabel } from './duration-label';
// Vet Service Catalog — sugestões iniciais pesquisáveis (não cria registros automaticamente)
// Cada sugestão vira Service real da clínica apenas quando selecionada/confirmada pelo usuário.
//
// IMPORTANTE — `duracaoMin` é SOMENTE SUGESTÃO DE PRODUTO (ponto de partida
// editável). NÃO é regra clínica, regulatória nem norma do CFMV/CRMV: a clínica
// é a autoridade sobre a duração padrão dos seus serviços (Service.durationMin
// = duração PADRÃO para novos agendamentos). A UI deve apresentar o número como
// "Duração sugerida" e permitir alterá-lo antes de criar o Service.
//
// Inspiração de estrutura (VISUAL/ARQUITETURAL, sem cópia de conteúdo): conceito
// de "tipos de atendimento" com duração padrão e grupos, comum em sistemas de
// gestão veterinária. Taxonomia e nomes são próprios do GoDoutor.
export interface VetCatalogSuggestion {
  id: string;
  name: string;
  grupo: string; // Grupo sugerido (ex: Consultas, Vacinas...)
  duracaoMin?: number;
  keywords?: string[];
}

export const VET_SERVICE_GROUPS = [
  'Consultas',
  'Vacinas',
  'Exames',
  'Diagnóstico por imagem',
  'Cirurgias',
  'Preventivo',
  'Odontologia',
  'Dermatologia',
  'Cardiologia',
  'Ortopedia',
  'Oftalmologia',
  'Oncologia',
  'Procedimentos',
  'Internação',
  'Anestesia',
  'Pet care',
] as const;

export type VetServiceGroup = typeof VET_SERVICE_GROUPS[number];

export const VET_CATALOG: VetCatalogSuggestion[] = [
  // Consultas
  { id: 'consulta-geral', name: 'Consulta geral', grupo: 'Consultas', duracaoMin: 30, keywords: ['consulta', 'clínica', 'geral'] },
  { id: 'consulta-retorno', name: 'Consulta de retorno', grupo: 'Consultas', duracaoMin: 20, keywords: ['retorno'] },
  { id: 'consulta-urgencia', name: 'Consulta de urgência', grupo: 'Consultas', duracaoMin: 30, keywords: ['urgência', 'emergência'] },
  { id: 'consulta-dermatologica', name: 'Consulta dermatológica', grupo: 'Dermatologia', duracaoMin: 30, keywords: ['pele', 'dermato'] },
  { id: 'consulta-cardiologica', name: 'Consulta cardiológica', grupo: 'Cardiologia', duracaoMin: 40, keywords: ['coração', 'cardio'] },
  { id: 'consulta-ortopedica', name: 'Consulta ortopédica', grupo: 'Ortopedia', duracaoMin: 40, keywords: ['ortopedia', 'osso'] },
  { id: 'consulta-oftalmologica', name: 'Consulta oftalmológica', grupo: 'Oftalmologia', duracaoMin: 30, keywords: ['olho', 'oftalmo'] },
  { id: 'consulta-oncologica', name: 'Consulta oncológica', grupo: 'Oncologia', duracaoMin: 40, keywords: ['oncologia', 'tumor'] },
  { id: 'consulta-pre-operatoria', name: 'Avaliação pré-operatória', grupo: 'Cirurgias', duracaoMin: 30, keywords: ['pré-operatória', 'cirurgia'] },
  { id: 'consulta-pediatrica', name: 'Consulta pediátrica (filhote)', grupo: 'Consultas', duracaoMin: 30, keywords: ['filhote', 'pediátrica'] },
  { id: 'consulta-geriatrica', name: 'Consulta geriátrica', grupo: 'Consultas', duracaoMin: 30, keywords: ['idoso', 'geriátrica'] },
  // Vacinas / Preventivo
  { id: 'vacinacao', name: 'Vacinação', grupo: 'Vacinas', duracaoMin: 15, keywords: ['vacina', 'imunização'] },
  { id: 'vacinacao-filhote', name: 'Vacinação filhote', grupo: 'Vacinas', duracaoMin: 20, keywords: ['vacina', 'filhote'] },
  { id: 'vacinacao-antirrabica', name: 'Vacinação antirrábica', grupo: 'Vacinas', duracaoMin: 15, keywords: ['raiva', 'antirrábica'] },
  { id: 'aplicacao-medicacao', name: 'Aplicação de medicação', grupo: 'Preventivo', duracaoMin: 15, keywords: ['medicação', 'injeção'] },
  { id: 'vermifugacao', name: 'Vermifugação', grupo: 'Preventivo', duracaoMin: 15, keywords: ['verme'] },
  { id: 'controle-parasitas', name: 'Controle de pulgas e carrapatos', grupo: 'Preventivo', duracaoMin: 15, keywords: ['pulga', 'carrapato'] },
  // Exames
  { id: 'coleta-exames', name: 'Coleta para exames', grupo: 'Exames', duracaoMin: 15, keywords: ['coleta', 'sangue'] },
  { id: 'exame-laboratorial', name: 'Exame laboratorial', grupo: 'Exames', duracaoMin: 20, keywords: ['laboratório', 'sangue'] },
  { id: 'hemograma', name: 'Hemograma', grupo: 'Exames', duracaoMin: 15, keywords: ['sangue'] },
  { id: 'bioquimica', name: 'Exame bioquímico', grupo: 'Exames', duracaoMin: 15, keywords: ['bioquímico'] },
  { id: 'exame-urina', name: 'Exame de urina', grupo: 'Exames', duracaoMin: 15, keywords: ['urina'] },
  { id: 'exame-fezes', name: 'Exame de fezes', grupo: 'Exames', duracaoMin: 15, keywords: ['fezes'] },
  // Diagnóstico por imagem
  { id: 'ultrassonografia', name: 'Ultrassonografia', grupo: 'Diagnóstico por imagem', duracaoMin: 30, keywords: ['ultrassom', 'imagem'] },
  { id: 'radiografia', name: 'Radiografia', grupo: 'Diagnóstico por imagem', duracaoMin: 20, keywords: ['raio-x', 'rx', 'imagem'] },
  { id: 'ecocardiograma', name: 'Ecocardiograma', grupo: 'Diagnóstico por imagem', duracaoMin: 40, keywords: ['coração'] },
  { id: 'eletrocardiograma', name: 'Eletrocardiograma', grupo: 'Diagnóstico por imagem', duracaoMin: 20, keywords: ['ecg'] },
  { id: 'tomografia', name: 'Tomografia', grupo: 'Diagnóstico por imagem', duracaoMin: 60, keywords: ['tomografia'] },
  // Cirurgias / Procedimentos
  { id: 'cirurgia-geral', name: 'Cirurgia geral', grupo: 'Cirurgias', duracaoMin: 60, keywords: ['cirurgia'] },
  { id: 'cirurgia-ortopedica', name: 'Cirurgia ortopédica', grupo: 'Cirurgias', duracaoMin: 90, keywords: ['ortopedia', 'cirurgia'] },
  { id: 'castracao', name: 'Castração', grupo: 'Cirurgias', duracaoMin: 60, keywords: ['castração', 'cirurgia'] },
  { id: 'cirurgia-tecido-mole', name: 'Cirurgia de tecidos moles', grupo: 'Cirurgias', duracaoMin: 60, keywords: ['cirurgia', 'tecido'] },
  { id: 'curativo', name: 'Curativo', grupo: 'Procedimentos', duracaoMin: 20, keywords: ['curativo', 'ferida'] },
  { id: 'sutura', name: 'Sutura', grupo: 'Procedimentos', duracaoMin: 30, keywords: ['sutura'] },
  { id: 'drenagem', name: 'Drenagem', grupo: 'Procedimentos', duracaoMin: 30, keywords: ['drenagem'] },
  // Odontologia
  { id: 'limpeza-tartaro', name: 'Limpeza de tártaro', grupo: 'Odontologia', duracaoMin: 45, keywords: ['tártaro', 'dente'] },
  { id: 'extracao-dentaria', name: 'Extração dentária', grupo: 'Odontologia', duracaoMin: 60, keywords: ['dente', 'extração'] },
  // Internação / Anestesia
  { id: 'internacao', name: 'Internação', grupo: 'Internação', duracaoMin: 0, keywords: ['internação', 'hospital'] },
  { id: 'internacao-dia', name: 'Diária de internação', grupo: 'Internação', duracaoMin: 0, keywords: ['diária', 'internação'] },
  { id: 'anestesia', name: 'Anestesia', grupo: 'Anestesia', duracaoMin: 30, keywords: ['anestesia'] },
  { id: 'sedacao', name: 'Sedação', grupo: 'Anestesia', duracaoMin: 30, keywords: ['sedação'] },
  // Pet care
  { id: 'banho-tosa', name: 'Banho e tosa', grupo: 'Pet care', duracaoMin: 60, keywords: ['banho', 'tosa'] },
  { id: 'hospedagem', name: 'Hospedagem', grupo: 'Pet care', duracaoMin: 0, keywords: ['hospedagem', 'hotel'] },
  { id: 'adestramento', name: 'Avaliação comportamental', grupo: 'Pet care', duracaoMin: 30, keywords: ['comportamento'] },
];

const fold = (v: string) => (v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** Tamanho do prefixo em comum (raiz da palavra): "cardiologista" ~ "cardiologica". */
function commonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/** Palavra de busca casa com a palavra do catálogo por raiz (mín. 6 letras ou a palavra inteira). */
function stemMatch(token: string, word: string): boolean {
  if (token.length < 4 || word.length < 4) return false;
  return commonPrefix(token, word) >= Math.min(6, word.length, token.length);
}

export function searchVetCatalog(query: string, limit = 8): VetCatalogSuggestion[] {
  const q = fold((query || '').trim());
  if (!q) return [];
  const tokens = q.split(/\s+/).filter(Boolean);
  const scored = VET_CATALOG.map(s => {
    const name = fold(s.name);
    const grupo = fold(s.grupo);
    const words = [...name.split(/[^a-z0-9]+/), ...grupo.split(/[^a-z0-9]+/)].filter(Boolean);
    const kws = (s.keywords || []).map(fold);
    let score = 0;
    if (name.startsWith(q)) score += 10;
    else if (name.includes(q)) score += 5;
    if (grupo.includes(q)) score += 2;
    if (kws.some(k => k.includes(q))) score += 3;
    if (score === 0) {
      // Busca por raiz: "cardiologista" encontra "Consulta cardiológica".
      const hit = tokens.length > 0 && tokens.every(t => words.some(w => stemMatch(t, w)) || kws.some(k => stemMatch(t, k)));
      if (hit) score += 4;
    }
    return { s, score };
  }).filter(x => x.score > 0).sort((a,b)=>b.score-a.score).slice(0, limit).map(x=>x.s);
  return scored;
}

export function findVetSuggestionById(id: string): VetCatalogSuggestion | undefined {
  return VET_CATALOG.find(s=>s.id===id);
}

/**
 * Rótulo de duração vinda da biblioteca — SEMPRE como sugestão (nunca como
 * regra clínica). `0`/ausente = sem duração sugerida (ex.: internação, hospedagem).
 */
export function durationSuggestionLabel(min?: number): string {
  return min && min > 0 ? `Duração sugerida · ${durationLabel(min)}` : 'Sem duração sugerida';
}
