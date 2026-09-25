import Link from 'next/link';
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <main className="il-auth">
    <section className="auth-form-side">
      <Link href="/" className="auth-wordmark">instalink<span> / clínicas</span></Link>
      <div className="auth-form-card">{children}</div>
      <p className="auth-patient-note">É paciente? Acesse sua conta pelo link da clínica onde você é atendido. <Link href="/politica-de-privacidade" className="text-[#6b5dd3] underline underline-offset-2">Política de privacidade</Link></p>
    </section>
    <aside className="auth-story"><p className="auth-eyebrow">UM DIA MAIS ORGANIZADO</p><h2>Mais clareza para a equipe.<br />Mais cuidado em cada encontro.</h2><p>Agenda, pacientes e atendimento conectados à rotina da sua clínica.</p><div className="auth-story-list"><p><span>01</span> Recepção com os próximos passos à vista.</p><p><span>02</span> Profissionais com contexto para atender.</p><p><span>03</span> Gestão com uma visão da operação.</p></div><p className="auth-story-foot">Cada pessoa com seu acesso. Cada clínica com sua identidade.</p></aside>
  </main>;
}
