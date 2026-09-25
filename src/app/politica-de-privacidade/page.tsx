import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Política de Privacidade | GoDoutor',
  description: 'Entenda como o GoDoutor trata dados de clínicas, equipes, pacientes, contatos e conversas, incluindo a integração oficial com WhatsApp e Meta.',
  openGraph: {
    title: 'Política de Privacidade | GoDoutor',
    description: 'Como o GoDoutor trata dados de clínicas, equipes, pacientes, contatos e conversas.',
    type: 'article',
    locale: 'pt_BR',
    siteName: 'GoDoutor',
  },
  robots: { index: true, follow: true },
};

const contents = [
  ['escopo', '1. Escopo e papéis'],
  ['dados', '2. Dados tratados'],
  ['finalidades', '3. Finalidades e bases'],
  ['whatsapp', '4. WhatsApp e Meta'],
  ['compartilhamento', '5. Compartilhamento'],
  ['seguranca', '6. Segurança'],
  ['retencao', '7. Retenção e exclusão'],
  ['direitos', '8. Direitos pela LGPD'],
  ['cookies', '9. Cookies e sessão'],
  ['alteracoes', '10. Alterações e contato'],
];

function Section({ id, number, title, children }: { id: string; number: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-28 border-t border-[#e7e6e0] pt-9 first:border-t-0 first:pt-0">
      <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-[#6b5dd3]">{number}</p>
      <h2 className="font-display text-2xl font-bold tracking-[-0.03em] text-[#171827] sm:text-[1.7rem]">{title}</h2>
      <div className="mt-4 space-y-4 text-[0.98rem] leading-7 text-[#555568]">{children}</div>
    </section>
  );
}

function BulletList({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc space-y-2 pl-5 marker:text-[#8a7ce4]">{children}</ul>;
}

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-[#f7f7f4] text-[#171827]">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-[#171827] focus:px-4 focus:py-3 focus:text-white">
        Ir para o conteúdo
      </a>

      <header className="border-b border-[#e7e6e0] bg-[#f7f7f4]/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
          <Link href="/" className="font-display text-lg font-extrabold tracking-[-0.05em] text-[#171827]" aria-label="GoDoutor, página inicial">
            Go<span className="text-[#6b5dd3]">Doutor</span>
          </Link>
          <Link href="/login" className="rounded-full border border-[#d9d8d1] px-4 py-2 text-sm font-semibold text-[#464657] transition hover:border-[#6b5dd3] hover:text-[#5c4ec2]">
            Acesso da equipe <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </header>

      <div id="conteudo" className="mx-auto grid max-w-6xl gap-12 px-5 py-12 sm:px-8 sm:py-16 lg:grid-cols-[220px_minmax(0,720px)] lg:gap-20">
        <aside className="lg:sticky lg:top-8 lg:h-fit" aria-label="Índice da política">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#8c8b96]">Nesta política</p>
          <nav className="mt-4 grid gap-2 border-l border-[#deddd6] pl-4 text-sm text-[#6a6976]">
            {contents.map(([id, label]) => (
              <a key={id} href={`#${id}`} className="py-1 transition hover:text-[#5c4ec2]">{label}</a>
            ))}
          </nav>
          <p className="mt-8 text-xs leading-5 text-[#8c8b96]">Última atualização<br /><strong className="font-semibold text-[#6a6976]">24 de setembro de 2026</strong></p>
        </aside>

        <article className="max-w-3xl">
          <header className="mb-12">
            <p className="mb-4 text-xs font-bold uppercase tracking-[0.2em] text-[#6b5dd3]">GoDoutor · transparência</p>
            <h1 className="max-w-2xl font-display text-4xl font-extrabold leading-[1.08] tracking-[-0.055em] text-[#171827] sm:text-6xl">Política de Privacidade</h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-[#626173]">
              Esta política explica, em linguagem clara, como o GoDoutor trata dados para oferecer uma plataforma de organização para clínicas, equipes e atendimento — incluindo páginas públicas, agenda, contatos, conversas e a integração oficial com WhatsApp e Meta.
            </p>
            <div className="mt-7 rounded-2xl border border-[#ded9fa] bg-[#f0edff] px-5 py-4 text-sm leading-6 text-[#4f467f]">
              <strong className="font-bold">Importante:</strong> quando uma clínica cadastra dados de seus pacientes, clientes ou responsáveis, ela normalmente define as finalidades do tratamento e atua como controladora. O GoDoutor trata esses dados para prestar o serviço, conforme as instruções e configurações da clínica. A clínica deve apresentar suas próprias informações e avisos de privacidade aos titulares.
            </div>
          </header>

          <div className="space-y-12">
            <Section id="escopo" number="01" title="Escopo e papéis">
              <p>O GoDoutor é um software como serviço (SaaS) para apoiar a operação de clínicas e negócios de atendimento. A plataforma pode ser usada por clínicas médicas, odontológicas, veterinárias, de estética e outras operações que configurem seus serviços.</p>
              <p>Para dados de cadastro, segurança, cobrança quando aplicável e uso da própria plataforma, o GoDoutor poderá atuar como controlador, conforme o contexto. Para dados inseridos pela clínica sobre pacientes, clientes, responsáveis, pets e atendimentos, a clínica é, em regra, a controladora, e o GoDoutor atua como operador. Se a clínica fornecer um aviso específico, ele também deve ser consultado.</p>
              <p>Esta política vale para o site, o painel da equipe, páginas públicas de clínicas, fluxos de agendamento, APIs e integrações operadas pelo GoDoutor. Ela não substitui o aviso de privacidade da clínica nem as políticas da Meta.</p>
            </Section>

            <Section id="dados" number="02" title="Dados que podem ser tratados">
              <p>Tratamos somente os dados necessários ao uso configurado pela clínica e ao funcionamento seguro do serviço. Dependendo do recurso utilizado, isso pode incluir:</p>
              <BulletList>
                <li><strong className="font-semibold text-[#363546]">Conta e equipe:</strong> nome, e-mail, telefone, cargo, unidade, permissões, credenciais de acesso, histórico de sessão e informações usadas para recuperação da conta.</li>
                <li><strong className="font-semibold text-[#363546]">Clínica:</strong> nome de exibição, logotipo, descrição, serviços, profissionais, horários, localização, canais de contato, configurações da página e preferências operacionais.</li>
                <li><strong className="font-semibold text-[#363546]">Pacientes, clientes e responsáveis:</strong> nome, telefone, e-mail, identificadores informados pela clínica, dados de contato, preferências, observações, consentimentos e informações de relacionamento.</li>
                <li><strong className="font-semibold text-[#363546]">Agenda e atendimento:</strong> agendamentos, serviço escolhido, profissional, unidade, status, presença, cancelamento, retorno, anotações, arquivos e registros que a clínica decidir inserir. Em clínicas de saúde, isso pode incluir dados pessoais sensíveis, inclusive informações de saúde; a clínica deve ter base legal adequada para tratá-los.</li>
                <li><strong className="font-semibold text-[#363546]">Contatos e conversas:</strong> mensagens, histórico de conversa, remetente, destinatário, data e hora, status de entrega/leitura quando fornecido pelo canal, anexos ou referências a arquivos e identificadores da mensagem.</li>
                <li><strong className="font-semibold text-[#363546]">Dados técnicos:</strong> endereço IP, data e hora de acesso, navegador, sistema, páginas e APIs acessadas, eventos de segurança, identificadores de sessão e registros necessários para diagnóstico e prevenção de abuso.</li>
              </BulletList>
              <p>Também podemos tratar identificadores técnicos de integrações, como <strong className="font-semibold text-[#363546]">WABA ID</strong> e <strong className="font-semibold text-[#363546]">Phone Number ID</strong>. Eles identificam a conta empresarial e o número conectado à API oficial do WhatsApp; não são, por si só, senhas ou tokens de acesso.</p>
            </Section>

            <Section id="finalidades" number="03" title="Finalidades e bases legais">
              <p>Os dados podem ser usados para:</p>
              <BulletList>
                <li>criar e administrar contas, clínicas, unidades, equipes e permissões;</li>
                <li>publicar a página da clínica e permitir agendamentos, confirmações, cancelamentos e acompanhamento;</li>
                <li>organizar agenda, fila, contatos, pacientes, atendimentos, tarefas e conversas;</li>
                <li>receber, classificar, encaminhar, responder e registrar mensagens por canais habilitados pela clínica;</li>
                <li>operar, proteger, manter, corrigir e melhorar a plataforma, com registros técnicos mínimos;</li>
                <li>prevenir fraude, abuso, acesso indevido e incidentes de segurança;</li>
                <li>cumprir obrigações legais, atender solicitações de autoridades e exercer ou defender direitos.</li>
              </BulletList>
              <p>As bases legais podem incluir execução de contrato ou de procedimentos preliminares, cumprimento de obrigação legal ou regulatória, exercício regular de direitos, legítimo interesse com avaliação de impacto e consentimento, quando aplicável. Para dados pessoais sensíveis, inclusive dados de saúde, a clínica deve observar as hipóteses do art. 11 da LGPD e informar os titulares.</p>
              <p>O GoDoutor não usa dados de pacientes para vender listas ou publicidade comportamental. Campanhas e comunicações dependem das configurações da clínica e dos consentimentos ou outras bases adequadas exigidos para cada finalidade.</p>
            </Section>

            <Section id="whatsapp" number="04" title="Integração oficial com WhatsApp e Meta">
              <p>Quando a clínica habilita o WhatsApp, o GoDoutor usa a integração oficial da Meta/WhatsApp Cloud API e os webhooks configurados para a conta. A conexão pode envolver autorização da clínica, WABA ID, Phone Number ID, nome verificado, número exibido, status de registro e eventos de entrega.</p>
              <p>Para operar o canal, podemos tratar:</p>
              <BulletList>
                <li>mensagens recebidas do WhatsApp, incluindo conteúdo, tipo, remetente, destinatário, timestamp, identificador da mensagem e eventuais mídias ou referências;</li>
                <li>mensagens enviadas pela clínica e seus status de envio, entrega, leitura ou erro, quando disponibilizados pela Meta;</li>
                <li>dados de contato necessários para associar a conversa ao paciente, cliente ou responsável correto dentro da clínica;</li>
                <li>metadados técnicos do webhook e os identificadores WABA ID e Phone Number ID para validar a origem e resolver a clínica destinatária.</li>
              </BulletList>
              <p>A Meta/WhatsApp recebe e trata dados de acordo com seus próprios termos e políticas. A clínica é responsável por garantir que tem autorização e base legal para iniciar ou responder conversas, inclusive quando houver dados sensíveis. O GoDoutor não utiliza APIs não oficiais, QR codes paralelos ou métodos destinados a contornar as regras da Meta.</p>
            </Section>

            <Section id="compartilhamento" number="05" title="Com quem os dados podem ser compartilhados">
              <p>Não vendemos dados pessoais. O compartilhamento ocorre apenas quando necessário à finalidade informada, autorizado pela clínica ou exigido por lei, incluindo:</p>
              <BulletList>
                <li><strong className="font-semibold text-[#363546]">Meta Platforms/WhatsApp:</strong> para autenticação, operação da conta empresarial, envio e recebimento de mensagens, webhooks e status do canal.</li>
                <li><strong className="font-semibold text-[#363546]">Hospedagem e infraestrutura:</strong> provedores de computação, rede, monitoramento e segurança que hospedam o serviço e processam requisições sob instruções e controles contratuais.</li>
                <li><strong className="font-semibold text-[#363546]">Banco de dados e armazenamento:</strong> provedores necessários para manter registros da plataforma e arquivos enviados, com acesso limitado à operação.</li>
                <li><strong className="font-semibold text-[#363546]">Clínica e equipe autorizada:</strong> usuários, profissionais e unidades recebem somente o acesso compatível com seus vínculos e permissões.</li>
                <li><strong className="font-semibold text-[#363546]">Autoridades e terceiros autorizados:</strong> quando houver obrigação legal, ordem válida, prevenção de fraude ou proteção de direitos.</li>
              </BulletList>
              <p>Alguns provedores podem processar dados fora do Brasil. Nesses casos, buscamos aplicar as salvaguardas exigidas pela LGPD e pelos contratos com os fornecedores. As políticas próprias da Meta e dos provedores também podem se aplicar.</p>
            </Section>

            <Section id="seguranca" number="06" title="Segurança e credenciais">
              <p>Adotamos medidas técnicas e administrativas compatíveis com os riscos do serviço, como controle de acesso por conta, unidade e permissão, isolamento entre clínicas, autenticação de sessão, conexão segura, registros de auditoria e redução de dados sensíveis em logs.</p>
              <p>Tokens de acesso e credenciais de integrações, incluindo credenciais utilizadas no WhatsApp/Meta, são mantidos no lado do servidor e, quando armazenados pelo GoDoutor, protegidos com criptografia de aplicação <strong className="font-semibold text-[#363546]">AES-256-GCM</strong>. Eles não devem ser exibidos no navegador, em respostas públicas, URLs ou logs. WABA ID e Phone Number ID são identificadores técnicos e não substituem a proteção das credenciais.</p>
              <p>Nenhum serviço conectado à internet é absolutamente imune a incidentes. Se identificarmos um incidente relevante, adotaremos as medidas de contenção, investigação, comunicação e cooperação exigidas pela legislação e pelas circunstâncias.</p>
            </Section>

            <Section id="retencao" number="07" title="Retenção e exclusão">
              <p>Guardamos cada categoria de dado pelo tempo necessário à finalidade correspondente:</p>
              <BulletList>
                <li>dados de conta e clínica: enquanto a conta estiver ativa e pelo período necessário para obrigações legais, auditoria e defesa de direitos;</li>
                <li>agenda, contatos, conversas e registros de atendimento: conforme a configuração e as instruções da clínica, respeitando prazos legais e profissionais aplicáveis;</li>
                <li>credenciais de integração: enquanto o canal estiver conectado ou até a revogação, desconexão ou substituição, observadas as necessidades de segurança;</li>
                <li>logs e registros de segurança: pelo período mínimo necessário para diagnóstico, prevenção de abuso e cumprimento de obrigações;</li>
                <li>cópias de segurança: podem permanecer por um período limitado até a rotação segura, sem voltar a ser usadas para operação normal.</li>
              </BulletList>
              <p>A clínica pode solicitar a exclusão da conta e dos dados sob sua responsabilidade pelo canal de suporte da conta, observadas retenções legais e obrigações de guarda. O titular de dados de paciente ou cliente deve, em primeiro lugar, procurar a clínica que realizou a coleta; quando aplicável, a clínica encaminhará a solicitação ao GoDoutor.</p>
            </Section>

            <Section id="direitos" number="08" title="Direitos previstos na LGPD">
              <p>Nos limites da LGPD e conforme o papel de cada agente, o titular pode solicitar confirmação da existência de tratamento, acesso, correção, anonimização, bloqueio ou eliminação de dados desnecessários ou tratados em desconformidade, portabilidade, informação sobre compartilhamentos, revogação do consentimento, oposição quando cabível e revisão de decisões unicamente automatizadas.</p>
              <p>Pedidos sobre dados cadastrados por uma clínica devem ser enviados primeiro à própria clínica, que é quem conhece a finalidade do atendimento e pode precisar preservar informações por obrigação legal. O GoDoutor apoiará a clínica quando atuar como operador. Pedidos sobre a conta e o uso direto da plataforma podem ser feitos pelo canal de contato indicado abaixo. Também é possível peticionar à Autoridade Nacional de Proteção de Dados (ANPD).</p>
            </Section>

            <Section id="cookies" number="09" title="Cookies, sessão e armazenamento local">
              <p>Usamos tecnologias estritamente necessárias para manter login, segurança, preferências e funcionamento do site e do painel. Elas podem incluir cookies de sessão, armazenamento temporário em memória e armazenamento local do navegador para preservar uma sessão quando o navegador bloquear cookies. Esses recursos não são usados, nesta política, para publicidade comportamental.</p>
              <p>Ao bloquear ou apagar cookies e armazenamento local, algumas funções de login e continuidade da sessão podem deixar de funcionar. Cookies e tokens de sessão podem ser apagados ao sair da conta, expirar a sessão ou solicitar o encerramento da conta.</p>
            </Section>

            <Section id="alteracoes" number="10" title="Alterações e contato">
              <p>Podemos atualizar esta política para refletir mudanças no produto, na legislação, nos provedores ou nas integrações. A versão vigente ficará disponível nesta mesma URL, com a data de atualização no início da página. Mudanças relevantes poderão ser comunicadas pelo produto ou por outro canal apropriado.</p>
              <div className="rounded-2xl border border-[#e7e6e0] bg-white px-5 py-5 text-[#555568] shadow-[0_8px_30px_-24px_rgba(23,24,39,0.5)]">
                <p className="font-semibold text-[#29283a]">Canal de privacidade</p>
                <p className="mt-2">Para dúvidas, solicitações de titulares ou exercício de direitos, use o canal de suporte disponibilizado na conta GoDoutor ou procure a clínica responsável pelo atendimento. O e-mail oficial, a identidade jurídica e o endereço do controlador ainda precisam ser preenchidos nesta política antes da publicação jurídica definitiva.</p>
              </div>
            </Section>
          </div>

          <div className="mt-14 border-t border-[#e7e6e0] pt-7 text-sm leading-6 text-[#7a7985]">
            Esta página é pública e pode ser consultada sem login. Para voltar ao site do produto, acesse a <Link href="/" className="font-semibold text-[#5c4ec2] underline decoration-[#c9c3f3] underline-offset-4 hover:text-[#4437a7]">página inicial</Link>.
          </div>
        </article>
      </div>

      <footer className="border-t border-[#e7e6e0] bg-white/45">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-8 text-sm text-[#777684] sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p><span className="font-display font-bold text-[#29283a]">GoDoutor</span> · organização para clínicas e equipes.</p>
          <div className="flex gap-5"><Link href="/" className="hover:text-[#5c4ec2]">Início</Link><Link href="/login" className="hover:text-[#5c4ec2]">Acesso da equipe</Link></div>
        </div>
      </footer>
    </main>
  );
}
