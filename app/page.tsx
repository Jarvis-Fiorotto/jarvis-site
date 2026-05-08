const pillars = [
  {
    title: "Clareza operacional",
    text: "Transforma informação dispersa em diagnóstico, prioridade e plano executável."
  },
  {
    title: "Automação com controle",
    text: "Executa o que é seguro, pede autorização no que afeta dinheiro, reputação, produção ou dados sensíveis."
  },
  {
    title: "Coordenação de agentes",
    text: "Orquestra subagentes especializados, revisa entregas e consolida decisões em uma voz única."
  }
];

const workflows = [
  "Projetos de software, IA e automações",
  "Preparação internacional na aviação",
  "Finanças pessoais, análises e organização",
  "Documentos, SOPs, checklists e roadmaps"
];

export default function Home() {
  return (
    <main>
      <section className="hero">
        <div className="hud">JARVIS / CEO AGENT</div>
        <div className="heroGrid">
          <div>
            <p className="eyebrow">Just A Rather Very Intelligent System</p>
            <h1>Copiloto cognitivo para transformar caos em clareza acionável.</h1>
            <p className="lead">
              JARVIS é a camada executiva de IA do Danilo Fiorotto: organiza contexto,
              antecipa riscos, coordena execução e mantém o operador no controle.
            </p>
            <div className="actions">
              <a href="#operacao">Ver operação</a>
              <a className="secondary" href="#seguranca">Modelo de segurança</a>
            </div>
          </div>
          <div className="panel" aria-label="Resumo operacional">
            <div className="panelHeader">
              <span>STATUS</span>
              <strong>ONLINE</strong>
            </div>
            <ul>
              <li><span>Função</span><strong>CEO Agent</strong></li>
              <li><span>Modo</span><strong>Autonomia progressiva</strong></li>
              <li><span>Prioridade</span><strong>Clareza, segurança, execução</strong></li>
              <li><span>Stack</span><strong>Next.js · GitHub · Vercel</strong></li>
            </ul>
          </div>
        </div>
      </section>

      <section id="operacao" className="section">
        <p className="eyebrow">Operação</p>
        <h2>Uma interface central para decisões, projetos e execução.</h2>
        <div className="cards">
          {pillars.map((pillar) => (
            <article className="card" key={pillar.title}>
              <h3>{pillar.title}</h3>
              <p>{pillar.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section split">
        <div>
          <p className="eyebrow">Escopo</p>
          <h2>Feito para operar em múltiplas frentes sem perder rastreabilidade.</h2>
        </div>
        <div className="list">
          {workflows.map((item) => (
            <div className="listItem" key={item}>{item}</div>
          ))}
        </div>
      </section>

      <section id="seguranca" className="section command">
        <p className="eyebrow">Segurança</p>
        <h2>Autonomia não é cheque em branco.</h2>
        <p>
          O sistema executa tarefas reversíveis e documentadas. Ações sensíveis — produção,
          DNS, secrets, compras, envios externos e alterações destrutivas — exigem aprovação explícita.
        </p>
      </section>
    </main>
  );
}
