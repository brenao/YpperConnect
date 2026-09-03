import type { ComponentType } from "react";

/**
 * Dados que alimentam um template.
 *
 * `unknown` em vez de `any` no valor: obriga quem lê a estreitar o tipo
 * antes de usar. Os dados vêm da fila de notificações, montados em
 * runtime, então não há como tipá-los de forma fechada aqui.
 */
export type DadosTemplate = Record<string, unknown>;

export interface TemplateEntry {
  /**
   * `ComponentType<never>` porque o registro é heterogêneo: cada
   * template declara suas próprias props, e não existe um tipo único
   * que aceite todos sem `any`.
   *
   * `never` funciona por contravariância — qualquer componente é
   * atribuível a ele. O preço é uma conversão no ponto de renderização,
   * em `send-email.ts`, que é onde a garantia passa a ser humana.
   */
  component: ComponentType<never>;
  subject: string | ((data: DadosTemplate) => string);
  displayName?: string;
  previewData?: DadosTemplate;
  /** Destinatário fixo — ignora o e-mail passado por quem chama. */
  to?: string;
}

/**
 * Registro de templates — associa nome ao componente React Email.
 * Importe e registre aqui depois de criar o template neste diretório.
 *
 * Exemplo:
 *   import { template as welcomeTemplate } from './welcome'
 *   // e acrescente a TEMPLATES: 'welcome': welcomeTemplate
 */
import { template as notificacaoItsm } from "./notificacao-itsm";

export const TEMPLATES: Record<string, TemplateEntry> = {
  "notificacao-itsm": notificacaoItsm,
};
