import type { Metadata } from 'next';
import { LegalDocument, type LegalSection } from '@/components/public/LegalDocument';

export const metadata: Metadata = {
  title: 'Termos de Serviço | GoDoutor',
  description: 'Termos de uso do GoDoutor para clínicas, equipes, páginas públicas e integrações oficiais com WhatsApp e Meta.',
  openGraph: {
    title: 'Termos de Serviço | GoDoutor',
    description: 'Regras de uso do SaaS GoDoutor por clínicas e equipes de atendimento.',
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
    id: 'aceitacao',
    number: '01',
    title: 'Aceitação e escopo',
    content: <>
      <p>Estes Termos de Serviço regulam o acesso e o uso do GoDoutor, uma plataforma SaaS para organização de clínicas e negócios de atendimento. A plataforma pode oferecer painel da equipe, página pública da clínica, agendamento, agenda, contatos, atendimentos, conversas, automações e integrações habilitadas pela clínica.</p>
      <p>Ao criar uma conta, acessar o painel ou usar uma página e um recurso do GoDoutor, você declara que leu estes Termos. Se estiver usando o serviço em nome de uma clínica, declara que tem autorização para vinculá-la a estas regras. A Política de Privacidade explica como dados pessoais são tratados e complementa estes Termos.</p>
    </>,
  },
  {
    id: 'contas',
    number: '02',
    title: 'Contas, acesso e segurança',
    content: <>
      <p>A clínica e cada usuário da equipe devem fornecer informações verdadeiras, manter os dados de cadastro atualizados e proteger suas credenciais. Contas, permissões, unidades e vínculos de profissionais devem ser usados somente pela pessoa autorizada.</p>
      <BulletList>
        <li>não compartilhe senha, token, sessão ou credencial de integração;</li>
        <li>avise imediatamente o administrador da clínica e o GoDoutor ao suspeitar de acesso indevido;</li>
        <li>revise periodicamente os membros, perfis e permissões da equipe;</li>
        <li>não tente acessar outra clínica, unidade, conta, banco de dados ou função sem autorização.</li>
      </BulletList>
      <p>A clínica é responsável pelas ações realizadas por seus usuários e por encerrar acessos que não devam mais existir. O GoDoutor pode solicitar confirmação de identidade ou informações adicionais para proteger a conta.</p>
    </>,
  },
  {
    id: 'responsabilidades',
    number: '03',
    title: 'Responsabilidades da clínica e da equipe',
    content: <>
      <p>A clínica define seus serviços, horários, profissionais, regras de agendamento, conteúdos públicos e finalidades de uso. Ela também é responsável por revisar as informações antes de publicá-las e por orientar sua equipe sobre privacidade, segurança e atendimento.</p>
      <p>Ao usar o GoDoutor, a clínica deve:</p>
      <BulletList>
        <li>ter base legal e autorizações necessárias para cadastrar e tratar dados de pacientes, clientes, responsáveis e pets;</li>
        <li>fornecer aos titulares as informações de privacidade aplicáveis e atender solicitações que estejam sob sua responsabilidade;</li>
        <li>não inserir conteúdo ilegal, enganoso, discriminatório, abusivo ou que viole sigilo, direitos autorais ou direitos de terceiros;</li>
        <li>não usar a plataforma para diagnóstico, prescrição, emergência ou decisão clínica automatizada sem a supervisão profissional adequada;</li>
        <li>conferir destinatários, mensagens e anexos antes de enviar qualquer comunicação.</li>
      </BulletList>
      <p>O GoDoutor fornece ferramentas de organização. Ele não substitui o julgamento profissional, o prontuário ou as obrigações regulatórias da clínica.</p>
    </>,
  },
  {
    id: 'uso',
    number: '04',
    title: 'Uso permitido e condutas proibidas',
    content: <>
      <p>O serviço deve ser usado de forma lícita, segura e compatível com sua finalidade. É proibido:</p>
      <BulletList>
        <li>fraudar identidade, obter acesso por meios indevidos ou contornar controles de permissão;</li>
        <li>interferir no funcionamento, testar vulnerabilidades sem autorização, introduzir código malicioso ou sobrecarregar a infraestrutura;</li>
        <li>raspar, copiar, revender ou explorar o serviço fora das permissões destes Termos;</li>
        <li>enviar spam, fraude, assédio, conteúdo ilegal ou comunicações sem a base e o consentimento necessários;</li>
        <li>usar dados de terceiros para finalidade incompatível com a informada ou para discriminação;</li>
        <li>usar uma integração para contornar termos, limites ou políticas de um provedor.</li>
      </BulletList>
      <p>Podemos investigar violações e preservar registros necessários à segurança, ao cumprimento da lei e à defesa de direitos.</p>
    </>,
  },
  {
    id: 'integracoes',
    number: '05',
    title: 'Integrações e canais de terceiros',
    content: <>
      <p>O GoDoutor pode oferecer integrações oficiais, como WhatsApp/Meta, conforme a configuração e a disponibilidade do serviço. No WhatsApp, a clínica pode autorizar uma conta empresarial e conectar WABA ID, Phone Number ID e credenciais mantidas no servidor para enviar, receber e registrar mensagens.</p>
      <p>A clínica deve cumprir os termos, políticas, janelas de atendimento, regras de consentimento e limites do provedor. Meta/WhatsApp pode aprovar, limitar, suspender ou alterar um canal independentemente do GoDoutor. O GoDoutor não garante que toda mensagem será entregue, que um webhook será recebido ou que a conta permanecerá aprovada.</p>
      <p>Integrações de terceiros têm seus próprios termos, políticas de privacidade, disponibilidade e requisitos. A desconexão do GoDoutor não necessariamente elimina dados que já estejam no provedor; a clínica ou o titular pode precisar solicitar a exclusão diretamente ao terceiro.</p>
    </>,
  },
  {
    id: 'conteudo',
    number: '06',
    title: 'Conteúdo, dados e propriedade',
    content: <>
      <p>A clínica continua responsável pelos dados, textos, imagens, marcas, documentos e mensagens que inserir ou publicar. Ela declara que possui os direitos e autorizações necessários para usar esse conteúdo e concede ao GoDoutor apenas as permissões técnicas necessárias para hospedar, processar, exibir e transmitir o conteúdo conforme o serviço configurado.</p>
      <p>O software, a marca, a interface, a documentação e os componentes do GoDoutor pertencem ao respectivo titular e são protegidos pela legislação aplicável. Estes Termos não transferem propriedade intelectual para a clínica ou para o usuário. Feedbacks podem ser usados para melhorar o serviço sem revelar dados confidenciais.</p>
    </>,
  },
  {
    id: 'disponibilidade',
    number: '07',
    title: 'Disponibilidade, manutenção e suporte',
    content: <>
      <p>Trabalhamos para manter o GoDoutor disponível, seguro e atualizado, mas o serviço pode sofrer indisponibilidade, lentidão, manutenção, falhas de rede, incidentes, limites de provedores ou eventos fora do nosso controle. Salvo compromisso escrito específico, não há garantia de disponibilidade ininterrupta ou de prazo fixo de resposta.</p>
      <p>Podemos alterar, corrigir, retirar ou substituir funcionalidades. Quando possível, comunicaremos mudanças relevantes e preservaremos a continuidade razoável da operação. A disponibilidade de recursos, integrações e limites pode variar conforme o plano, a clínica, o ambiente e os contratos aplicáveis.</p>
    </>,
  },
  {
    id: 'cancelamento',
    number: '08',
    title: 'Suspensão, cancelamento e encerramento',
    content: <>
      <p>A clínica pode parar de usar o serviço e solicitar o encerramento da conta pelo canal de suporte disponibilizado na contratação ou na conta. O encerramento não elimina automaticamente obrigações de guarda, dados mantidos por terceiros ou registros que precisem ser preservados por lei, segurança ou defesa de direitos.</p>
      <p>O GoDoutor pode suspender ou limitar acesso, após avaliação proporcional e, quando possível, aviso prévio, se houver:</p>
      <BulletList>
        <li>violação destes Termos, da lei ou de política de provedor;</li>
        <li>risco para usuários, titulares, clínicas, terceiros ou infraestrutura;</li>
        <li>inadimplência ou encerramento do plano, quando houver contratação paga;</li>
        <li>solicitação de autoridade, provedor de canal ou outra obrigação válida;</li>
        <li>necessidade urgente de manutenção ou contenção de incidente.</li>
      </BulletList>
      <p>Quando tecnicamente possível e permitido, a clínica poderá solicitar exportação dos dados antes do encerramento. Regras específicas de planos, cobrança e prazos, se existirem, devem constar da contratação correspondente.</p>
    </>,
  },
  {
    id: 'responsabilidade',
    number: '09',
    title: 'Limites de responsabilidade',
    content: <>
      <p>Na extensão permitida pela legislação, o GoDoutor não responde por decisões clínicas, condutas da equipe, conteúdo cadastrado pela clínica, consentimentos obtidos, indisponibilidade de provedores externos, falha de dispositivo ou rede do usuário, nem por danos decorrentes do uso contrário a estes Termos.</p>
      <p>Também não garantimos que o serviço atenderá a uma finalidade específica, produzirá resultado clínico ou comercial, ficará livre de erros ou funcionará sem interrupções. Nenhuma disposição destes Termos exclui responsabilidade que não possa ser afastada por lei, nem limita direitos obrigatórios do consumidor ou do titular de dados.</p>
      <p>A clínica deve manter cópias e controles próprios adequados para informações importantes, sem substituir as medidas de segurança adotadas pelo GoDoutor e por seus provedores.</p>
    </>,
  },
  {
    id: 'alteracoes',
    number: '10',
    title: 'Alterações e disposições finais',
    content: <>
      <p>Podemos atualizar estes Termos para refletir mudanças no produto, na legislação, nos provedores ou nas integrações. A versão vigente permanecerá nesta URL, com sua data de atualização. Mudanças relevantes poderão ser comunicadas no produto ou por outro canal apropriado.</p>
      <p>A eventual invalidade de uma cláusula não prejudica as demais. A ausência de cobrança ou aplicação imediata de uma regra não representa renúncia. Estes Termos devem ser interpretados em conjunto com a Política de Privacidade e com condições específicas aceitas pela clínica.</p>
      <div className="rounded-2xl border border-[#e7e6e0] bg-white px-5 py-5 text-[#555568] shadow-[0_8px_30px_-24px_rgba(23,24,39,0.5)]">
        <p className="font-semibold text-[#29283a]">Contato e identificação jurídica</p>
        <p className="mt-2">Para dúvidas sobre estes Termos, use o canal de suporte disponibilizado na conta GoDoutor ou procure a clínica responsável. A razão social, o CNPJ, o endereço oficial e o e-mail jurídico do controlador ainda precisam ser preenchidos antes da publicação jurídica definitiva; nenhum desses dados foi inventado nesta página.</p>
      </div>
    </>,
  },
];

export default function TermsOfServicePage() {
  return (
    <LegalDocument
      title="Termos de Serviço"
      intro="As regras para usar o GoDoutor com clareza: uma plataforma para clínicas organizarem sua rotina, sua equipe, seus atendimentos e seus canais digitais."
      updatedAt="24 de setembro de 2026"
      notice={<><strong className="font-bold">Leia antes de usar:</strong> a clínica controla suas configurações, usuários e dados de atendimento. Ao usar integrações, ela também deve respeitar as regras do provedor, inclusive Meta/WhatsApp.</>}
      sections={sections}
    />
  );
}
