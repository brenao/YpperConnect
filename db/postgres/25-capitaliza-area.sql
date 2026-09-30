-- =====================================================================
-- 25 - Capitalizacao de area demandante e departamento
--
-- A migration 24 unificou as variantes de caixa adotando a grafia MAIS
-- USADA de cada area. Funcionou, mas o resultado dependia de quem tinha
-- digitado mais vezes: se duas pessoas escreveram "comercial" e uma
-- escreveu "Comercial", o sistema inteiro passou a exibir "comercial".
--
-- Nome de area e de departamento e nome proprio de setor, e a grafia
-- esperada e com inicial maiuscula em cada palavra. Esta migration
-- aplica essa regra, e o codigo passa a aplica-la em toda gravacao.
--
-- AS DUAS EXCECOES
--   Conectivo no meio fica minusculo: "Diretoria de Operacoes", nao
--   "Diretoria De Operacoes". E o que qualquer pessoa escreveria.
--
--   Sigla curta em maiuscula fica como esta: "TI" nao vira "Ti", e o
--   mesmo vale para "RH", "PCP", "SAC". O limite de quatro letras evita
--   confundir sigla com palavra escrita de Caps Lock ligado —
--   "COMERCIAL" vira "Comercial", "TI" continua "TI".
--
-- DEPARTAMENTO DE USUARIO TAMBEM ENTRA
--   O filtro por departamento do gestor le `usuarios.departamento`, que
--   vem da carga do GLPI e tem a mesma bagunca. Normalizar so a area
--   deixaria metade do problema em pe.
--
-- APLICAR:
--   node --env-file=.env db/run-sql.mjs db/postgres/25-capitaliza-area.sql
-- =====================================================================

SET ROLE ypper;

BEGIN;

-- ---------------------------------------------------------------------
-- A regra, como funcao
--
-- Fica no banco porque duas colunas precisam dela e porque uma proxima
-- carga do GLPI pode querer chama-la. O codigo da aplicacao tem a mesma
-- regra em `src/lib/texto.ts`: as duas precisam concordar, e por isso
-- as excecoes estao escritas igual nos dois lugares.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION titulo_de_texto(entrada TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT NULLIF(
        STRING_AGG(
            CASE
                -- Sigla curta em maiuscula: preservada como foi digitada.
                WHEN LENGTH(palavra) <= 4 AND palavra = UPPER(palavra) AND palavra ~ '[A-ZÀ-Ý]'
                    THEN palavra
                -- Conectivo no meio do nome: minusculo.
                WHEN posicao > 1 AND LOWER(palavra) IN
                    ('de','da','do','das','dos','e','em','para','com','a','o')
                    THEN LOWER(palavra)
                -- Demais palavras: inicial maiuscula, inclusive depois
                -- de hifen ("Pos-Venda").
                ELSE INITCAP(LOWER(palavra))
            END,
            ' ' ORDER BY posicao
        ),
        ''
    )
    FROM REGEXP_SPLIT_TO_TABLE(
             TRIM(REGEXP_REPLACE(COALESCE(entrada, ''), '\s+', ' ', 'g')),
             ' '
         ) WITH ORDINALITY AS t(palavra, posicao)
    WHERE palavra <> '';
$$;

COMMENT ON FUNCTION titulo_de_texto(TEXT) IS
    'Inicial maiuscula por palavra, com conectivos em minuscula e siglas curtas preservadas. '
    'Espelha src/lib/texto.ts — alterar uma exige alterar a outra.';

-- ---------------------------------------------------------------------
-- Aplicacao
-- ---------------------------------------------------------------------

UPDATE projetos
   SET area_demandante = titulo_de_texto(area_demandante)
 WHERE area_demandante IS NOT NULL
   AND area_demandante IS DISTINCT FROM titulo_de_texto(area_demandante);

UPDATE usuarios
   SET departamento = titulo_de_texto(departamento)
 WHERE departamento IS NOT NULL
   AND departamento IS DISTINCT FROM titulo_de_texto(departamento);

-- ---------------------------------------------------------------------
-- Registro
-- ---------------------------------------------------------------------

INSERT INTO db_migrations (arquivo) VALUES ('25-capitaliza-area.sql')
ON CONFLICT (arquivo) DO NOTHING;

COMMIT;

RESET ROLE;

-- ---------------------------------------------------------------------
-- Conferencia
--
--   SELECT DISTINCT area_demandante FROM projetos
--    WHERE area_demandante IS NOT NULL ORDER BY 1;
--
--   SELECT DISTINCT departamento FROM usuarios
--    WHERE departamento IS NOT NULL ORDER BY 1;
--
-- Cada area deve aparecer uma vez so, com inicial maiuscula.
-- ---------------------------------------------------------------------