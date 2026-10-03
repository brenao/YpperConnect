import { Administracao } from "@/views/administracao";
import { SECOES_ADMINISTRACAO, type SecaoAdministracao } from "@/models/administracao-secoes";

/**
 * Opções de rota de uma seção de Administração.
 *
 * Cada arquivo em routes/ precisa existir (o roteador gera os tipos a
 * partir deles), mas o conteúdo é o mesmo: título, descrição e a página
 * na seção certa. Daí uma função só, e cada rota com uma linha.
 */
export function rotaAdministracao(secao: SecaoAdministracao) {
  const { titulo, subtitulo } = SECOES_ADMINISTRACAO[secao];
  return {
    head: () => ({
      meta: [
        { title: `${titulo} · Administração · BeagleOne` },
        { name: "description", content: `${subtitulo}.` },
      ],
    }),
    component: () => <Administracao secao={secao} />,
  };
}