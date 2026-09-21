import Link from 'next/link';
import { Icon } from '@/components/icons';

const journeys = [
  { n: '01', title: 'Receber bem começa antes da consulta.', role: 'PARA A RECEPÇÃO', text: 'Agenda, cadastro, fila e tarefas no mesmo ambiente. Encontre o paciente, acompanhe a chegada e saiba o que ainda precisa de atenção.', items: ['Agenda por dia, semana ou mês', 'Cadastro e histórico reunidos', 'Fila e pendências da operação'] },
  { n: '02', title: 'Mais contexto para cada atendimento.', role: 'PARA O PROFISSIONAL', text: 'Consulte sua agenda, abra o atendimento e registre orientações. Cada pessoa da equipe acessa o que seu papel e seus vínculos permitem.', items: ['Agenda vinculada ao profissional', 'Registro e histórico autorizado', 'Orientações e retorno sugerido'] },
  { n: '03', title: 'Uma visão clara da sua clínica.', role: 'PARA A GESTÃO', text: 'Organize serviços, equipe e unidades. Acompanhe os indicadores disponíveis e configure a página que apresenta sua clínica ao paciente.', items: ['Equipe com permissões por unidade', 'Serviços e disponibilidade', 'Resultados com origem e período definidos'] },
];
const questions = [
  ['Para quais clínicas o InstaLink foi pensado?', 'Clínicas médicas, odontológicas, veterinárias e de estética. Você organiza os serviços e os profissionais conforme sua operação. O sistema não substitui sistemas clínicos especializados nem representa um prontuário veterinário de pets.'],
  ['O paciente precisa instalar um aplicativo?', 'Não. A página da clínica, o agendamento e a área da conta abrem no navegador. As opções de acompanhamento, cancelamento e remarcação seguem as regras configuradas pela clínica.'],
  ['Posso manter a identidade da minha clínica?', 'Sim. Sua página pública tem logo, conteúdo, cores e aparência próprios. O painel da equipe mantém uma interface consistente para o trabalho diário.'],
  ['Toda a equipe vê as mesmas informações?', 'Não. O acesso depende do papel, das permissões e das unidades às quais cada pessoa está vinculada. O profissional pode ter a agenda limitada ao seu próprio vínculo.'],
  ['Como começar?', 'Crie seu acesso, configure a clínica e cadastre os serviços, profissionais e horários. Revise a página e as regras de reserva antes de compartilhar o link com pacientes.'],
  ['Há envio automático por WhatsApp ou Instagram?', 'Esta apresentação não promete integração homologada ou envio automático por esses canais. A disponibilidade depende de configuração e validação específicas, fora desta entrega.'],
];
export default function Landing() {
  return <main className="il-marketing">
    <a className="marketing-skip" href="#conteudo">Ir para o conteúdo</a>
    <header className="marketing-nav marketing-wrap">
      <Link href="/" className="marketing-wordmark">instalink<span> / clínicas</span></Link>
      <nav aria-label="Principal"><a href="#produto">O produto</a><a href="#rotina">Na sua rotina</a><a href="#duvidas">Dúvidas</a></nav>
      <Link href="/login" className="marketing-login">Acesso da equipe <span aria-hidden="true">↗</span></Link>
    </header>
    <section id="conteudo" className="marketing-hero marketing-wrap">
      <div>
        <p className="marketing-eyebrow"><span /> MAIS CLAREZA NA ROTINA DA CLÍNICA</p>
        <h1>Sua clínica organizada,<br />do primeiro contato ao <em>próximo atendimento.</em></h1>
        <p className="marketing-intro">Da recepção ao acompanhamento do paciente. Agenda, equipe, atendimento e sua página online em um só lugar — cada pessoa com o acesso de que precisa.</p>
        <div className="marketing-actions"><Link className="marketing-cta" href="/register">Começar a organizar <span aria-hidden="true">→</span></Link><a className="marketing-text-link" href="#produto">Conhecer o produto ↓</a></div>
        <p className="marketing-note">Médica · Odontológica · Veterinária · Estética</p>
      </div>
      <div className="marketing-product" aria-label="Demonstração ilustrativa da agenda, com dados fictícios">
        <div className="marketing-window"><span /><span /><span /><p>Clínica Aurora · demonstração ilustrativa</p></div>
        <div className="marketing-demo-body">
          <div className="marketing-demo-heading"><div><p className="marketing-eyebrow">ATENDIMENTO</p><h2>Uma boa manhã começa aqui.</h2></div><span className="marketing-demo-date">SEG<br /><strong>21</strong></span></div>
          <div className="marketing-demo-toolbar"><strong>Agenda de hoje</strong><span>Dia　 Semana　 Mês</span></div>
          <div className="marketing-demo-appointment"><time>09:00</time><div><strong>Marina Alves</strong><p>Consulta · Dra. Helena</p></div><span>Confirmado</span></div>
          <div className="marketing-demo-appointment is-arrived"><time>09:30</time><div><strong>Rafael Lima</strong><p>Avaliação · Dr. Pedro</p></div><span>Na recepção</span></div>
          <div className="marketing-demo-appointment"><time>10:00</time><div><strong>Clara Souza</strong><p>Retorno · Dra. Helena</p></div><span>Confirmado</span></div>
          <div className="marketing-demo-task"><Icon n="checkCircle" size={20} /><div><strong>O próximo passo, sem procurar.</strong><p>Agenda, fila e histórico ao alcance da equipe.</p></div></div>
        </div>
        <p className="marketing-demo-caption">Visão ilustrativa. Nomes e atendimentos fictícios.</p>
      </div>
    </section>
    <section id="produto" className="marketing-product-section">
      <div className="marketing-wrap"><div className="marketing-section-heading"><p className="marketing-eyebrow">DO ONLINE À RECEPÇÃO</p><h2>Uma experiência contínua.<br />Dos dois lados do balcão.</h2><p>A clínica organiza a operação. O paciente encontra o caminho para o próximo cuidado.</p></div>
        <div className="marketing-split">
          <article><span className="marketing-feature-icon"><Icon n="calendar" size={26} /></span><h3>Por dentro, uma rotina mais clara.</h3><p>Agenda com profissionais e disponibilidade, pacientes e responsáveis, fila de chegada e registros de atendimento. Sem trocar o contexto da unidade a cada tarefa.</p><ul><li>Reaproveite cadastros ao agendar</li><li>Veja o que está marcado e o que precisa de ação</li><li>Organize acessos da recepção, profissionais e gestão</li></ul></article>
          <article><span className="marketing-feature-icon"><Icon n="globe" size={26} /></span><h3>Por fora, a identidade da sua clínica.</h3><p>Uma página própria para apresentar serviços, equipe e localização. O paciente escolhe o atendimento e consulta os horários realmente disponíveis.</p><ul><li>Página com suas cores e seu conteúdo</li><li>Agendamento online com revisão antes de confirmar</li><li>Conta para acompanhar as próprias consultas</li></ul></article>
        </div>
      </div>
    </section>
    <section id="rotina" className="marketing-wrap marketing-journeys"><div className="marketing-section-heading"><p className="marketing-eyebrow">CADA PAPEL, SEU FOCO</p><h2>Menos ruído.<br />Mais atenção ao que importa.</h2></div>
      {journeys.map(j => <article key={j.n} className="marketing-journey"><span className="marketing-number">{j.n}</span><div><p className="marketing-eyebrow">{j.role}</p><h3>{j.title}</h3></div><div><p>{j.text}</p><ul>{j.items.map(i => <li key={i}><Icon n="check" size={15} />{i}</li>)}</ul></div></article>)}
    </section>
    <section className="marketing-start"><div className="marketing-wrap"><p className="marketing-eyebrow">COMECE COM O QUE JÁ FAZ PARTE DA SUA ROTINA</p><h2>Da configuração<br />ao primeiro agendamento.</h2><ol><li><strong>01 / Configure sua clínica</strong><p>Identidade, equipe, serviços e horários de atendimento.</p></li><li><strong>02 / Revise a experiência</strong><p>Confira sua página e as regras de reserva antes de compartilhar.</p></li><li><strong>03 / Receba e acompanhe</strong><p>Organize a agenda e dê continuidade ao atendimento.</p></li></ol></div></section>
    <section id="duvidas" className="marketing-wrap marketing-faq"><div><p className="marketing-eyebrow">ANTES DE COMEÇAR</p><h2>Perguntas<br />frequentes.</h2></div><div>{questions.map(([q,a]) => <details key={q}><summary>{q}<span aria-hidden="true">+</span></summary><p>{a}</p></details>)}</div></section>
    <section className="marketing-wrap marketing-final"><p className="marketing-eyebrow">UM PRÓXIMO PASSO MAIS SIMPLES</p><h2>Cuide da sua clínica.<br />Organize o caminho até ela.</h2><Link href="/register" className="marketing-cta">Criar meu acesso →</Link><p>Já faz parte da equipe? <Link href="/login">Entrar no painel</Link></p></section>
    <footer className="marketing-wrap marketing-footer"><Link href="/" className="marketing-wordmark">instalink</Link><p>Organização para clínicas e equipes de atendimento.</p><Link href="/login">Acesso da equipe</Link><p>Paciente? Acesse pelo link da sua clínica.</p></footer>
  </main>;
}
