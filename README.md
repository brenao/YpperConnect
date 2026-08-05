# Service Navigator

Atue como um designer de startup unicornio e inspirada em ferramentas como Jira, Monday.com e Service Now crie um sistema de gestão de TI para cadastro de projetos, com cronograma e gestão ITIL conforme abaixo:

O objetivo é fortalecer a governança de TI, padronizar o atendimento, aumentar a visibilidade sobre as atividades realizadas pela área e gerar informações que apoiem a identificação de recorrências, riscos e oportunidades de melhoria.

 

Como primeira etapa, proponho estruturarmos os seguintes pontos:

 

definição de um canal único para abertura e acompanhamento de chamados;

padronização das categorias, prioridades, status e responsabilidades;

definição de uma matriz de prioridade baseada em impacto e urgência;

criação de um catálogo inicial de serviços de TI;

criação de uma base de conhecimento com procedimentos, orientações e soluções recorrentes;

acompanhamento de prazos, níveis de serviço, backlog e indicadores de atendimento;

definição de um fluxo específico para incidentes críticos;

estruturação inicial das práticas de Gestão de Incidentes, Requisições de Serviço, Problemas e Melhoria Contínua.

 

Os registros serão classificados inicialmente da seguinte forma:

Incidente: falha, erro, degradação ou indisponibilidade que afete um serviço, sistema ou processo;

Requisição de serviço: solicitação operacional padronizada, como criação ou alteração de acessos, instalação de softwares, configuração de equipamentos, redes ou estações de trabalho;

Demanda de melhoria: solicitação de evolução pontual em sistemas, processos ou serviços;

Problema: causa conhecida ou ainda em investigação de um ou mais incidentes, especialmente quando houver recorrência ou impacto relevante;

Tarefa: atividade interna necessária para a execução de um incidente, requisição, problema, demanda ou projeto.

 

Também definiremos uma matriz de prioridade, considerando o impacto e a urgência de cada chamado:

P1 – Crítica: indisponibilidade total ou impacto severo em uma operação essencial, sem alternativa de continuidade;

P2 – Alta: impacto relevante em uma área, unidade, sistema ou processo, com operação parcial ou alternativa limitada;

P3 – Média: impacto restrito a poucos usuários ou a uma atividade não crítica, sem comprometimento relevante da operação;

P4 – Baixa: solicitação planejável, dúvida, ajuste ou atividade sem impacto imediato na operação.

 

Outro ponto importante será a utilização de IA generativa para apoiar a estruturação inicial do processo. A tecnologia poderá ser utilizada para:

criar uma primeira versão do catálogo de serviços de TI, com base nos serviços atualmente prestados pela área;

apoiar a criação, organização e atualização da base de conhecimento;

transformar procedimentos existentes em conteúdos padronizados e de fácil consulta;

sugerir soluções para ocorrências recorrentes;

identificar conteúdos que precisam ser revisados ou complementados.

 

Também discutiremos a criação de uma IA conversacional integrada ao processo de atendimento, com o objetivo de facilitar a abertura de chamados pelos usuários. Essa solução poderá coletar as informações necessárias, sugerir a categoria e a prioridade, orientar o solicitante e direcionar o chamado para a equipe responsável.

 

A IA também poderá identificar padrões e recorrências entre os incidentes registrados. Ao detectar ocorrências semelhantes ou repetitivas, poderá recomendar ao time de TI a avaliação e a criação de um registro de Problema para investigação da causa raiz e definição de uma solução definitiva.

 

É importante destacar que os usuários finais não poderão criar registros classificados como Problema. A criação e a gestão de Problemas serão de responsabilidade exclusiva da equipe de TI, após a avaliação da recorrência, do impacto e das evidências identificadas.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/e88e01b0-905b-4ca4-bbd6-a5ea89c2165e).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
