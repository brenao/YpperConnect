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

export default defineConfig({
  plugins: [
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tailwindcss(),
    tanstackStart({
      server: { entry: "server" },
    }),
    viteReact(),
    nitro(),
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
