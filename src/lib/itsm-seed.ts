import type { Article, Project, ServiceItem, Ticket } from "./itsm-types";
import { resolvePriority, slaFor } from "./itsm-types";

const now = Date.now();
const h = (n: number) => new Date(now + n * 3600_000).toISOString();

function mk(
  t: Omit<Ticket, "prioridade" | "prazoSla" | "prazoResposta" | "criadoEm"> & {
    criadoHaHoras: number;
  },
): Ticket {
  const prioridade = resolvePriority(t.impacto, t.urgencia);
  const criadoEm = h(-t.criadoHaHoras);
  const meta = slaFor(t.tipo, prioridade);
  const base = new Date(criadoEm).getTime();
  return {
    ...t,
    prioridade,
    criadoEm,
    prazoSla: new Date(base + meta.solucao * 3600_000).toISOString(),
    prazoResposta: new Date(base + meta.resposta * 3600_000).toISOString(),
    ...(t.status !== "novo" && t.status !== "triagem"
      ? { respondidoEm: new Date(base + (meta.resposta / 2) * 3600_000).toISOString() }
      : {}),
  };
}

export const SEED_TICKETS: Ticket[] = [
  mk({
    id: "INC-1042",
    titulo: "ERP indisponível para toda a operação fiscal",
    descricao:
      "Usuários da unidade matriz não conseguem autenticar no ERP. Impacto total no faturamento.",
    tipo: "incidente",
    categoria: "Sistemas corporativos",
    servico: "ERP · Disponibilidade",
    impacto: "alto",
    urgencia: "alta",
    status: "em_andamento",
    solicitante: "Marina Duarte",
    responsavel: "Rafael Lima",
    equipe: "Sustentação de Sistemas",
    criadoHaHoras: 2,
    origem: "ia",
    problemaVinculado: "PRB-018",
  }),
  mk({
    id: "INC-1041",
    titulo: "Lentidão recorrente no acesso ao compartilhamento de arquivos",
    descricao: "Terceira ocorrência na semana no setor de Engenharia.",
    tipo: "incidente",
    categoria: "Infraestrutura",
    servico: "Rede e conectividade",
    impacto: "medio",
    urgencia: "alta",
    status: "triagem",
    solicitante: "Carlos Prado",
    responsavel: "Bruna Sato",
    equipe: "Infraestrutura",
    criadoHaHoras: 6,
    origem: "portal",
    problemaVinculado: "PRB-018",
  }),
  mk({
    id: "REQ-2211",
    titulo: "Criação de acesso ao Power BI para novo analista",
    descricao: "Solicitação padronizada de concessão de acesso com aprovação do gestor.",
    tipo: "requisicao",
    categoria: "Acessos e identidade",
    servico: "Gestão de acessos",
    impacto: "baixo",
    urgencia: "media",
    status: "aguardando",
    solicitante: "Helena Costa",
    responsavel: "João Vitor",
    equipe: "Service Desk",
    criadoHaHoras: 20,
    origem: "ia",
  }),
  mk({
    id: "REQ-2210",
    titulo: "Instalação de AutoCAD na estação da Engenharia",
    descricao: "Instalação de software licenciado em estação de trabalho.",
    tipo: "requisicao",
    categoria: "Estações de trabalho",
    servico: "Instalação de software",
    impacto: "baixo",
    urgencia: "baixa",
    status: "novo",
    solicitante: "Diego Alves",
    responsavel: "Não atribuído",
    equipe: "Service Desk",
    criadoHaHoras: 30,
    origem: "portal",
  }),
  mk({
    id: "MEL-0304",
    titulo: "Automatizar relatório mensal de chamados por área",
    descricao: "Evolução pontual no painel de indicadores para envio automático.",
    tipo: "melhoria",
    categoria: "Melhoria contínua",
    servico: "Indicadores e relatórios",
    impacto: "medio",
    urgencia: "baixa",
    status: "triagem",
    solicitante: "Patrícia Nunes",
    responsavel: "Rafael Lima",
    equipe: "Sustentação de Sistemas",
    criadoHaHoras: 72,
    origem: "portal",
  }),
  mk({
    id: "PRB-018",
    titulo: "Degradação recorrente do link primário da matriz",
    descricao:
      "Padrão identificado pela IA em 7 incidentes correlatos nos últimos 14 dias. Causa em investigação junto à operadora.",
    tipo: "problema",
    categoria: "Infraestrutura",
    servico: "Rede e conectividade",
    impacto: "alto",
    urgencia: "media",
    status: "em_andamento",
    solicitante: "Equipe de TI",
    responsavel: "Bruna Sato",
    equipe: "Infraestrutura",
    criadoHaHoras: 96,
    origem: "ia",
  }),
  mk({
    id: "TSK-0771",
    titulo: "Coletar evidências de tráfego do link primário",
    descricao: "Atividade interna vinculada ao PRB-018.",
    tipo: "tarefa",
    categoria: "Infraestrutura",
    servico: "Rede e conectividade",
    impacto: "baixo",
    urgencia: "media",
    status: "em_andamento",
    solicitante: "Bruna Sato",
    responsavel: "Tiago Mendes",
    equipe: "Infraestrutura",
    criadoHaHoras: 40,
    origem: "portal",
    problemaVinculado: "PRB-018",
  }),
  mk({
    id: "INC-1038",
    titulo: "Impressora fiscal sem comunicação no PDV 04",
    descricao: "Operação parcial, PDV alternativo disponível.",
    tipo: "incidente",
    categoria: "Estações de trabalho",
    servico: "Suporte a periféricos",
    impacto: "medio",
    urgencia: "media",
    status: "resolvido",
    solicitante: "Luiz Ramos",
    responsavel: "João Vitor",
    equipe: "Service Desk",
    criadoHaHoras: 52,
    origem: "telefone",
  }),
];

export const SEED_SERVICES: ServiceItem[] = [
  {
    id: "SVC-01",
    nome: "Gestão de acessos e identidade",
    categoria: "Acessos e identidade",
    descricao: "Criação, alteração e revogação de acessos a sistemas corporativos.",
    tipoPadrao: "requisicao",
    slaHoras: 24,
    equipe: "Service Desk",
    geradoPorIA: true,
  },
  {
    id: "SVC-02",
    nome: "Instalação e atualização de software",
    categoria: "Estações de trabalho",
    descricao: "Instalação de softwares homologados e licenciados em estações.",
    tipoPadrao: "requisicao",
    slaHoras: 24,
    equipe: "Service Desk",
    geradoPorIA: true,
  },
  {
    id: "SVC-03",
    nome: "Configuração de estação de trabalho",
    categoria: "Estações de trabalho",
    descricao: "Preparação, troca e configuração de equipamentos e periféricos.",
    tipoPadrao: "requisicao",
    slaHoras: 48,
    equipe: "Service Desk",
  },
  {
    id: "SVC-04",
    nome: "Rede e conectividade",
    categoria: "Infraestrutura",
    descricao: "Links, Wi-Fi, VPN e compartilhamentos de rede.",
    tipoPadrao: "incidente",
    slaHoras: 8,
    equipe: "Infraestrutura",
  },
  {
    id: "SVC-05",
    nome: "ERP · Disponibilidade e suporte",
    categoria: "Sistemas corporativos",
    descricao: "Suporte funcional e técnico ao ERP e integrações.",
    tipoPadrao: "incidente",
    slaHoras: 4,
    equipe: "Sustentação de Sistemas",
  },
  {
    id: "SVC-06",
    nome: "E-mail e colaboração",
    categoria: "Sistemas corporativos",
    descricao: "Caixas postais, listas de distribuição e ferramentas de colaboração.",
    tipoPadrao: "requisicao",
    slaHoras: 24,
    equipe: "Service Desk",
    geradoPorIA: true,
  },
  {
    id: "SVC-07",
    nome: "Indicadores e relatórios",
    categoria: "Governança",
    descricao: "Extrações, painéis e relatórios gerenciais da área de TI.",
    tipoPadrao: "melhoria",
    slaHoras: 72,
    equipe: "Sustentação de Sistemas",
  },
  {
    id: "SVC-08",
    nome: "Segurança da informação",
    categoria: "Segurança",
    descricao: "Incidentes de segurança, phishing, antivírus e políticas de acesso.",
    tipoPadrao: "incidente",
    slaHoras: 4,
    equipe: "Segurança",
    geradoPorIA: true,
  },
];

export const SEED_ARTICLES: Article[] = [
  {
    id: "KB-001",
    titulo: "Como solicitar acesso a um sistema corporativo",
    categoria: "Acessos e identidade",
    resumo: "Passo a passo para abertura de requisição de acesso com aprovação do gestor.",
    conteudo:
      "1. Abra um chamado do tipo Requisição de serviço.\n2. Selecione o serviço 'Gestão de acessos'.\n3. Informe sistema, perfil desejado e justificativa.\n4. O gestor imediato receberá a aprovação.\n5. Após aprovação, o Service Desk executa em até 24h úteis.",
    atualizadoEm: "2026-07-28",
    visualizacoes: 412,
    status: "publicado",
    geradoPorIA: true,
  },
  {
    id: "KB-002",
    titulo: "Procedimento para incidentes críticos (P1)",
    categoria: "Gestão de incidentes",
    resumo: "Fluxo de acionamento, comunicação e encerramento de incidentes críticos.",
    conteudo:
      "Acionamento imediato da ponte de crise, comunicação a cada 30 minutos, registro de linha do tempo e RCA obrigatório em até 5 dias úteis.",
    atualizadoEm: "2026-07-30",
    visualizacoes: 188,
    status: "publicado",
  },
  {
    id: "KB-003",
    titulo: "VPN não conecta: verificações iniciais",
    categoria: "Infraestrutura",
    resumo: "Checklist de autoatendimento antes de abrir chamado.",
    conteudo:
      "Verifique conexão local, reinicie o cliente VPN, confirme MFA ativo e valide credenciais. Persistindo, abra incidente informando o código de erro.",
    atualizadoEm: "2026-06-12",
    visualizacoes: 733,
    status: "revisar",
    geradoPorIA: true,
  },
  {
    id: "KB-004",
    titulo: "Padrão de descrição de chamados",
    categoria: "Governança",
    resumo: "O que informar para acelerar a triagem e a resolução.",
    conteudo:
      "Descreva o que aconteceu, quando começou, quantas pessoas foram afetadas, se há alternativa de continuidade e anexe evidências.",
    atualizadoEm: "2026-07-02",
    visualizacoes: 265,
    status: "publicado",
  },
  {
    id: "KB-005",
    titulo: "Impressoras e periféricos: erros comuns",
    categoria: "Estações de trabalho",
    resumo: "Soluções recorrentes sugeridas pela IA a partir do histórico.",
    conteudo:
      "Reinstale o driver homologado, valide a fila de impressão e confirme o cabo/porta. Em PDV fiscal, valide o serviço de comunicação antes de acionar o fornecedor.",
    atualizadoEm: "2026-05-20",
    visualizacoes: 97,
    status: "rascunho",
    geradoPorIA: true,
  },
];

const BASE_PROJECTS: Project[] = [
  {
    id: "PRJ-01",
    nome: "Implantação da Central Única de Chamados",
    objetivo:
      "Definir canal único de abertura e acompanhamento, com categorias, prioridades e responsabilidades padronizadas.",
    sponsor: "Diretoria Administrativa",
    gerente: "Rafael Lima",
    status: "execucao",
    inicio: "2026-07-06",
    fim: "2026-10-30",
    tarefas: [
      {
        id: "T1",
        nome: "Diagnóstico do atendimento atual",
        inicio: "2026-07-06",
        fim: "2026-07-24",
        progresso: 100,
        responsavel: "Rafael Lima",
      },
      {
        id: "T2",
        nome: "Padronização de categorias e prioridades",
        inicio: "2026-07-20",
        fim: "2026-08-14",
        progresso: 70,
        responsavel: "Bruna Sato",
      },
      {
        id: "T3",
        nome: "Matriz de impacto x urgência aprovada",
        inicio: "2026-08-14",
        fim: "2026-08-14",
        progresso: 0,
        responsavel: "Comitê de TI",
        marco: true,
      },
      {
        id: "T4",
        nome: "Configuração do canal único",
        inicio: "2026-08-10",
        fim: "2026-09-19",
        progresso: 25,
        responsavel: "João Vitor",
      },
      {
        id: "T5",
        nome: "Piloto assistido e go-live",
        inicio: "2026-09-21",
        fim: "2026-10-30",
        progresso: 0,
        responsavel: "Service Desk",
      },
    ],
  },
  {
    id: "PRJ-02",
    nome: "Catálogo de Serviços e Base de Conhecimento com IA",
    objetivo:
      "Gerar a primeira versão do catálogo e estruturar a base de conhecimento com apoio de IA generativa.",
    sponsor: "Gerência de TI",
    gerente: "Patrícia Nunes",
    status: "execucao",
    inicio: "2026-07-13",
    fim: "2026-11-27",
    tarefas: [
      {
        id: "T1",
        nome: "Levantamento dos serviços prestados",
        inicio: "2026-07-13",
        fim: "2026-08-07",
        progresso: 90,
        responsavel: "Patrícia Nunes",
      },
      {
        id: "T2",
        nome: "Rascunho do catálogo gerado por IA",
        inicio: "2026-08-03",
        fim: "2026-08-28",
        progresso: 45,
        responsavel: "IA + Curadoria TI",
      },
      {
        id: "T3",
        nome: "Conversão de procedimentos em artigos padronizados",
        inicio: "2026-08-24",
        fim: "2026-10-09",
        progresso: 10,
        responsavel: "Service Desk",
      },
      {
        id: "T4",
        nome: "Curadoria e publicação",
        inicio: "2026-10-05",
        fim: "2026-11-27",
        progresso: 0,
        responsavel: "Comitê de TI",
      },
    ],
  },
  {
    id: "PRJ-03",
    nome: "Gestão de Problemas e Melhoria Contínua",
    objetivo:
      "Estruturar detecção de recorrências, análise de causa raiz e ciclo de melhoria contínua.",
    sponsor: "Gerência de TI",
    gerente: "Bruna Sato",
    status: "risco",
    inicio: "2026-08-17",
    fim: "2026-12-18",
    tarefas: [
      {
        id: "T1",
        nome: "Definir critérios de recorrência",
        inicio: "2026-08-17",
        fim: "2026-09-11",
        progresso: 20,
        responsavel: "Bruna Sato",
      },
      {
        id: "T2",
        nome: "Motor de detecção de padrões (IA)",
        inicio: "2026-09-07",
        fim: "2026-10-23",
        progresso: 0,
        responsavel: "Sustentação de Sistemas",
      },
      {
        id: "T3",
        nome: "Ritual mensal de melhoria contínua",
        inicio: "2026-10-19",
        fim: "2026-12-18",
        progresso: 0,
        responsavel: "Comitê de TI",
      },
    ],
  },
];
const d = (offsetDays: number) => new Date(now + offsetDays * 86_400_000).toISOString();

// Enriquecimento: predecessoras em cadeia, múltiplos responsáveis, atualizações,
// riscos e pontos de atenção — base para os semáforos de governança.
export const SEED_PROJECTS: Project[] = BASE_PROJECTS.map((p, pi) => ({
  ...p,
  tarefas: p.tarefas.map((t, i) => ({
    ...t,
    responsaveis: [t.responsavel],
    predecessoras: i > 0 ? [p.tarefas[i - 1]!.id] : [],
    duracaoUnidade: "dias" as const,
    atividade: t.marco ? "Marco de aprovação" : "Execução",
  })),
  atualizacoes:
    pi === 2
      ? []
      : [
          {
            id: `UPD-${p.id}-1`,
            data: d(pi === 1 ? -9 : -3),
            autor: p.gerente,
            descricao:
              "Frente em andamento conforme cronograma acordado com as áreas envolvidas.",
            ultimasEntregas: "Diagnóstico consolidado e alinhamento com as áreas de negócio.",
            proximasEntregas: "Configuração do ambiente e validação com usuários-chave.",
          },
        ],
  riscos:
    pi === 2
      ? []
      : [
          {
            id: `RSK-${p.id}-1`,
            descricao: "Baixa disponibilidade das áreas de negócio para validação.",
            probabilidade: "media" as const,
            impacto: "alto" as const,
            mitigacao: "Agenda fixa semanal com os key users e escalonamento ao sponsor.",
            status: "monitorado" as const,
          },
        ],
  atencoes:
    pi === 2
      ? [
          {
            id: `ATN-${p.id}-1`,
            titulo: "Definição de responsável pela análise de causa raiz",
            descricao:
              "Sem responsável dedicado, a fila de problemas não avança e as recorrências continuam.",
            decisaoNecessaria: "Alocar analista dedicado ou contratar apoio externo.",
            responsavelDecisao: "Gerência de TI",
            criadoEm: d(-5),
            status: "aberto" as const,
          },
        ]
      : [],
}));
