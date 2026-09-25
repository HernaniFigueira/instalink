import type { Metadata } from 'next';
import { LegalDocument, type LegalSection } from '@/components/public/LegalDocument';

export const metadata: Metadata = {
  title: 'Exclusão de Dados | GoDoutor',
  description: 'Saiba como solicitar a exclusão de conta, dados de clínica, pacientes, clientes e integrações no GoDoutor, respeitadas as retenções legais.',
  openGraph: {
    title: 'Exclusão de Dados | GoDoutor',
    description: 'Instruções públicas para solicitar exclusão de dados no GoDoutor.',
    type: 'article',
    locale: 'pt_BR',
    siteName: 'GoDoutor',
  },
  robots: { index: true, follow: true },
};

function BulletList({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc space-y-2 pl-5 marker:text-[#8a7ce4]">{children}</ul>;
}

const sections: LegalSection[] = [
  {
    id: 'quem-pode-solicitar',
    number: '01',
    title: 'Quem pode solicitar',
    content: <>
      <p>Esta página explica como pedir a exclusão de dados tratados pelo GoDoutor. A pessoa titular pode solicitar a exclusão dos próprios dados. O administrador autorizado da clínica pode solicitar a exclusão da conta da clínica e dos dados inseridos sob sua responsabilidade.</p>
      <p>Quando você é paciente, cliente, responsável ou tutor e seus dados foram cadastrados por uma clínica, procure primeiro a própria clínica. Ela define a finalidade do tratamento, consegue confirmar o contexto do atendimento e encaminha ao GoDoutor o que for necessário. Quando o GoDoutor atuar como controlador da sua conta, você pode usar o canal de suporte indicado na conta.</p>
    </>,
  },
  {
    id: 'como-solicitar',
    number: '02',
    title: 'Como fazer o pedido',
    content: <>
      <p>Para iniciar uma solicitação:</p>
      <ol className="list-decimal space-y-2 pl-5 marker:font-semibold marker:text-[#6b5dd3]">
        <li>envie o pedido ao administrador da clínica ou pelo canal de suporte disponibilizado na sua conta ou na contratação do GoDoutor;</li>
        <li>informe que deseja “solicitar a exclusão de dados” e indique se o pedido é sobre uma conta, clínica, paciente/cliente, contato, conversa, agenda, arquivo ou integração;</li>
        <li>informe nome, e-mail ou telefone usados no cadastro, clínica relacionada e um meio seguro para retorno;</li>
        <li>aguarde a confirmação de identidade e de escopo. Não envie senha, token de acesso, App Secret, código de autenticação ou dados desnecessários.</li>
      </ol>
      <p>O canal eletrônico oficial de privacidade ainda não foi cadastrado no projeto. Até que seja preenchido, o caminho operacional é o administrador da clínica ou o canal de suporte fornecido na contratação. A clínica não deve pedir senha ou credencial de integração para receber o pedido.</p>
    </>,
  },
  {
    id: 'o-que-pode-ser-removido',
    number: '03',
    title: 'O que pode ser removido',
    content: <>
      <p>Após validar a solicitação e o vínculo com os dados, podemos excluir, anonimizar ou desassociar, conforme o caso e as instruções da clínica:</p>
      <BulletList>
        <li>conta de usuário, perfil, sessões e identificadores de acesso;</li>
        <li>cadastro da clínica, preferências e configurações que não precisem ser mantidas;</li>
        <li>contatos, pacientes, clientes, responsáveis, pets e dados de relacionamento;</li>
        <li>agendamentos, conversas, mensagens, anexos e registros de atendimento sob responsabilidade da clínica;</li>
        <li>credenciais e dados de conexão de integrações, incluindo tokens, WABA ID, Phone Number ID e configurações do canal WhatsApp/Meta;</li>
        <li>arquivos armazenados e referências técnicas quando a exclusão não impedir uma obrigação de guarda.</li>
      </BulletList>
      <p>Alguns dados podem ser anonimizados em vez de apagados quando isso for suficiente para retirar a identificação e manter métricas ou segurança legítimas.</p>
    </>,
  },
  {
    id: 'retencao',
    number: '04',
    title: 'Retenção legal e exceções',
    content: <>
      <p>A exclusão não é absoluta quando a manutenção for necessária ou permitida para cumprir obrigação legal ou regulatória, preservar registros profissionais, exercer ou defender direitos, prevenir fraude, investigar incidentes ou atender uma ordem válida. A clínica também pode precisar conservar determinados registros de atendimento.</p>
      <p>Podemos manter por prazo limitado:</p>
      <BulletList>
        <li>registros mínimos de auditoria e segurança;</li>
        <li>informações necessárias para comprovar uma transação ou cumprir obrigação legal;</li>
        <li>dados anonimizados que não identifiquem uma pessoa;</li>
        <li>cópias de segurança até sua rotação segura, sem restaurá-las para uso normal salvo necessidade operacional.</li>
      </BulletList>
      <p>Quando não for possível excluir um item imediatamente, restringiremos seu uso à finalidade de retenção aplicável e informaremos a razão de forma compatível com a solicitação.</p>
    </>,
  },
  {
    id: 'whatsapp-meta',
    number: '05',
    title: 'WhatsApp, Meta e outros provedores',
    content: <>
      <p>Excluir um dado do GoDoutor não apaga automaticamente cópias mantidas pela Meta/WhatsApp, pelo paciente, pela clínica ou por outro provedor. Para dados que estiverem diretamente sob controle de um terceiro, o titular ou a clínica deve usar também o canal de privacidade desse terceiro.</p>
      <p>Ao desconectar o WhatsApp, o GoDoutor remove ou deixa de usar as credenciais armazenadas para a integração, conforme o fluxo disponível. Mensagens e registros já recebidos podem permanecer pelo período solicitado pela clínica ou exigido pelas regras de retenção. WABA ID e Phone Number ID são identificadores técnicos; a remoção deles não substitui a exclusão de mensagens ou dados no provedor.</p>
    </>,
  },
  {
    id: 'validacao-prazo',
    number: '06',
    title: 'Validação, retorno e prazo',
    content: <>
      <p>Para proteger titulares e clínicas, podemos confirmar identidade, pedir esclarecimento do escopo e verificar se o solicitante tem autorização para excluir dados de uma clínica. Não excluímos dados de outra pessoa ou unidade apenas com nome, telefone ou pedido de terceiro não autorizado.</p>
      <p>Depois da validação, o pedido será analisado e executado sem demora indevida, respeitando a complexidade, as retenções legais e as dependências de provedores. O retorno será feito pelo meio seguro informado no pedido. Se a exclusão não puder ser integral, explicaremos a categoria retida e o motivo aplicável, na medida permitida pela lei.</p>
    </>,
  },
  {
    id: 'direitos',
    number: '07',
    title: 'Outros direitos pela LGPD',
    content: <>
      <p>Se você não quiser ou não puder pedir exclusão, também pode exercer os direitos de confirmação, acesso, correção, anonimização, bloqueio, portabilidade, informação sobre compartilhamentos, revogação do consentimento e oposição quando cabível, conforme a LGPD e o papel de cada agente.</p>
      <p>Pedidos sobre dados inseridos pela clínica devem ser dirigidos primeiro à clínica responsável. O GoDoutor apoia a clínica quando atua como operador. Se a resposta não for suficiente, o titular pode procurar a Autoridade Nacional de Proteção de Dados (ANPD).</p>
      <div className="rounded-2xl border border-[#e7e6e0] bg-white px-5 py-5 text-[#555568] shadow-[0_8px_30px_-24px_rgba(23,24,39,0.5)]">
        <p className="font-semibold text-[#29283a]">Canal para o pedido</p>
        <p className="mt-2">Use o suporte disponibilizado na conta GoDoutor ou contate a clínica que cadastrou os dados. O e-mail oficial, a razão social, o CNPJ e o endereço jurídico do controlador ainda precisam ser preenchidos antes da publicação jurídica definitiva.</p>
      </div>
    </>,
  },
  {
    id: 'alteracoes',
    number: '08',
    title: 'Atualizações desta instrução',
    content: <p>Esta página pode ser atualizada quando o fluxo de exclusão, os recursos do GoDoutor, as integrações ou as exigências legais mudarem. A versão vigente ficará disponível nesta mesma URL, com a data da última atualização.</p>,
  },
];

export default function DataDeletionPage() {
  return (
    <LegalDocument
      title="Exclusão de Dados"
      intro="Instruções públicas para solicitar a exclusão da sua conta ou de dados tratados pelo GoDoutor, sem esconder as situações em que a lei exige retenção."
      updatedAt="24 de setembro de 2026"
      notice={<><strong className="font-bold">Antes de enviar:</strong> se seus dados foram cadastrados por uma clínica, procure primeiro essa clínica. Para proteger sua conta, nunca envie senha, token ou credencial de integração no pedido.</>}
      sections={sections}
    />
  );
}
