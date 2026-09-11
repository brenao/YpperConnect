/**
 * Marca reduzida do BeagleOne.
 *
 * SVG e não a imagem original de propósito. A logo completa tem 1240px
 * e fundo branco: no quadrado de 40px do menu o beagle vira uma mancha,
 * e o fundo sólido aparece como bloco no tema escuro. Marca de
 * aplicação é a versão reduzida — aqui, o "1" com o nó conectado, que é
 * o que identifica à distância.
 *
 * Inline em vez de arquivo em `public/`: não gera requisição, acompanha
 * o tamanho pedido sem perder nitidez, e o degradê pode ter id único
 * por instância — dois SVGs na mesma página com o mesmo id de degradê
 * fazem o segundo herdar o preenchimento do primeiro.
 */

import { useId } from "react";

export function MarcaBeagleOne({
  tamanho = 40,
  className,
}: {
  tamanho?: number;
  className?: string;
}) {
  const id = useId();
  const fundo = `fundo-${id}`;

  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="BeagleOne"
    >
      <defs>
        <linearGradient id={fundo} x1="4" y1="4" x2="44" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="#10327A" />
          <stop offset="0.55" stopColor="#1668E3" />
          <stop offset="1" stopColor="#2BD2F5" />
        </linearGradient>
      </defs>

      {/* Cantos bem arredondados: o menu já é ortogonal, e o contraste
          de forma ajuda a marca a se destacar da navegação. */}
      <rect width="48" height="48" rx="13" fill={`url(#${fundo})`} />

      {/* O "1" da marca original, simplificado para manter o peso visual
          em 24px. Branco puro para contrastar com o degradê inteiro. */}
      <path d="M25.6 11.5v25h-5.2V19.2l-4.7 2.4-1.7-4.3 8.3-5.8h3.3z" fill="#fff" />

      {/* Nó e conexão: é o elemento que diz "fluxo e dependência", que é
          o que o produto faz. O laranja é o único ponto quente da marca,
          e por isso fica sozinho. */}
      <path
        d="M29.5 17.5c4 1.5 6 4 6 7.5s-2.6 5.8-6.5 6.8"
        stroke="#fff"
        strokeOpacity="0.55"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="34.5" cy="15.5" r="3.6" fill="#F98A11" />
    </svg>
  );
}

/**
 * Assinatura completa: marca mais nome, para cabeçalhos e telas de
 * carregamento.
 */
export function AssinaturaBeagleOne({
  tamanho = 40,
  subtitulo = "Gestão de TI · ITIL",
}: {
  tamanho?: number;
  subtitulo?: string;
}) {
  return (
    <span className="flex items-center gap-2.5">
      <MarcaBeagleOne tamanho={tamanho} />
      <span className="min-w-0">
        {/* "Beagle" e "One" com pesos diferentes, como no logotipo: é o
            que separa as duas palavras sem precisar de espaço. */}
        <span className="block truncate text-sm leading-tight">
          <span className="font-semibold">Beagle</span>
          <span className="font-light text-primary">One</span>
        </span>
        <span className="block truncate text-[11px] leading-tight text-muted-foreground">
          {subtitulo}
        </span>
      </span>
    </span>
  );
}
