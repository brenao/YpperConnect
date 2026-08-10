import path from "node:path";
import { defineConfig, loadEnv } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { nitro } from "nitro/vite";

// Carrega variáveis sem prefixo VITE_ em process.env, para uso apenas
// no servidor (server functions e rotas de API).
const serverEnv = loadEnv(process.env["NODE_ENV"] ?? "development", process.cwd(), "");
Object.assign(process.env, serverEnv);

// Prefixo de URL em que o app e servido. Padrao "/" (raiz).
// Atras do nginx do rosset16 sob /ypper, o build recebe APP_BASE_PATH=/ypper/.
// O Vite grava esse valor nas URLs dos assets e o expoe como
// import.meta.env.BASE_URL — que o router le em src/router.tsx, para o
// prefixo nunca ficar declarado em dois lugares e sair de sincronia.
const basePath = process.env["APP_BASE_PATH"] ?? "/";

export default defineConfig({
  base: basePath,
  plugins: [
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tailwindcss(),
    tanstackStart({
      server: { entry: "server" },
    }),
    viteReact(),
    // O `base` acima so reescreve as URLs DENTRO do HTML. Sem repetir o
    // prefixo aqui, o Nitro continua servindo .output/public na raiz: a pagina
    // responde 200 e todo JS/CSS da 404 — tela branca depois da hidratacao.
    // Precisa ser no build; a variavel NITRO_APP_BASE_URL em runtime nao
    // alcanca o handler de assets estaticos, que ja foi gerado com o prefixo.
    nitro({ baseURL: basePath }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "entities/lib/decode.js": path.resolve(__dirname, "node_modules/entities/lib/decode.js"),
      "entities/lib/encode.js": path.resolve(__dirname, "node_modules/entities/lib/encode.js"),
      entities: path.resolve(__dirname, "node_modules/entities"),
    },
    dedupe: ["react", "react-dom", "@tanstack/react-router"],
  },
  ssr: {
    // oracledb tem binário nativo — o Vite não consegue empacotar.
    external: ["oracledb", "nodemailer"],
  },
  server: {
    port: 8080,
    host: true,
  },
});
