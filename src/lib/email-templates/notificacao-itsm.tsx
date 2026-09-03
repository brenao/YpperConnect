import React from "react";
import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type { DadosTemplate, TemplateEntry } from "./registry";

interface Props {
  assunto?: string;
  corpo?: string;
  rodape?: string;
}

const Email = ({ assunto, corpo, rodape }: Props) => {
  const linhas = (corpo ?? "").split("\n").filter(Boolean);
  return (
    <Html lang="pt-BR" dir="ltr">
      <Head />
      <Preview>{assunto ?? "Notificação YpperConnect"}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Text style={brand}>YpperConnect</Text>
          <Heading style={h1}>{assunto ?? "Notificação"}</Heading>
          <Section>
            {linhas.length ? (
              linhas.map((linha, i) => (
                <Text key={i} style={paragraph}>
                  {linha}
                </Text>
              ))
            ) : (
              <Text style={paragraph}>Há uma atualização registrada no YpperConnect.</Text>
            )}
          </Section>
          <Hr style={hr} />
          <Text style={footer}>
            {rodape ?? "Mensagem automática do YpperConnect — Gestão de TI."}
          </Text>
        </Container>
      </Body>
    </Html>
  );
};

export const template = {
  component: Email,
  subject: (data: DadosTemplate) => (data["assunto"] as string) || "Notificação YpperConnect",
  displayName: "Notificação ITSM",
  previewData: {
    assunto: "[INC-1042] Status alterado para Em atendimento",
    corpo:
      'O chamado INC-1042 — Falha no acesso ao ERP mudou de "Novo" para "Em atendimento".\nServiço: Suporte a sistemas · Sistema: ERP\nResponsável: Ana Souza · Equipe: Sustentação',
  },
} satisfies TemplateEntry;

const main = { backgroundColor: "#ffffff", fontFamily: "Arial, Helvetica, sans-serif" };
const container = { padding: "28px 28px 20px", maxWidth: "560px" };
const brand = {
  fontSize: "12px",
  letterSpacing: "2px",
  textTransform: "uppercase" as const,
  // Equivale ao --primary do tema claro, oklch(0.55 0.12 195). Hex fixo
  // porque cliente de e-mail não lê variável CSS nem entende oklch, e
  // fundo branco pede o tom escuro: o do tema black some no papel.
  color: "#008687",
  margin: "0 0 6px",
  fontWeight: 700,
};
const h1 = { fontSize: "20px", lineHeight: "28px", color: "#0f172a", margin: "0 0 16px" };
const paragraph = { fontSize: "14px", lineHeight: "22px", color: "#334155", margin: "0 0 10px" };
const hr = { borderColor: "#e2e8f0", margin: "20px 0 12px" };
const footer = { fontSize: "12px", color: "#94a3b8", margin: 0 };
