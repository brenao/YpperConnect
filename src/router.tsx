import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

// BASE_URL vem do `base` do vite.config.ts (que le APP_BASE_PATH no build).
// Vale "/" na raiz, "/ypper/" em teste (rosset16) e "/beagleone/" em producao
// (rosset30). Precisa bater com a location da borda: se ela publica sob
// /beagleone/ e o build recebeu /ypper/, o router nao reconhece o caminho e
// o navegador acaba em /ypper/beagleone (2026-09-11). O router quer o
// prefixo sem a barra final; na raiz sobra "", e ai a opcao nem e passada —
// assim o comportamento na raiz fica identico ao de antes desta mudanca.
const basepath = import.meta.env.BASE_URL.replace(/\/$/, "");

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    ...(basepath ? { basepath } : {}),
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
