-- =====================================================================
-- Catalogo inicial de servicos e sistemas.
--
-- Valores genericos de TI para o sistema subir funcional. Ajuste,
-- remova ou acrescente conforme a realidade da operacao.
--
-- equipe_id do servico define o roteamento: ao abrir um chamado, a
-- equipe responsavel vem do servico escolhido.
-- =====================================================================

INSERT INTO servicos (id, nome, categoria_id, descricao, tipo_padrao, sla_horas, equipe_id, criado_em, atualizado_em)
VALUES ('SVC-01', 'Acesso a sistemas', 'CAT-SVC-01',
        'Criação, alteração e revogação de acessos a sistemas corporativos.',
        'requisicao', 24, 'EQP-SDK', SYSTIMESTAMP, SYSTIMESTAMP);
INSERT INTO servicos (id, nome, categoria_id, descricao, tipo_padrao, sla_horas, equipe_id, criado_em, atualizado_em)
VALUES ('SVC-02', 'Estação de trabalho', 'CAT-SVC-02',
        'Instalação, configuração e manutenção de computadores e periféricos.',
        'requisicao', 24, 'EQP-SDK', SYSTIMESTAMP, SYSTIMESTAMP);
INSERT INTO servicos (id, nome, categoria_id, descricao, tipo_padrao, sla_horas, equipe_id, criado_em, atualizado_em)
VALUES ('SVC-03', 'Rede e conectividade', 'CAT-SVC-02',
        'Links, switches, Wi-Fi e conectividade entre unidades.',
        'incidente', 8, 'EQP-INF', SYSTIMESTAMP, SYSTIMESTAMP);
INSERT INTO servicos (id, nome, categoria_id, descricao, tipo_padrao, sla_horas, equipe_id, criado_em, atualizado_em)
VALUES ('SVC-04', 'Sistemas corporativos', 'CAT-SVC-03',
        'Suporte funcional e técnico aos sistemas de negócio.',
        'incidente', 4, 'EQP-SIS', SYSTIMESTAMP, SYSTIMESTAMP);
INSERT INTO servicos (id, nome, categoria_id, descricao, tipo_padrao, sla_horas, equipe_id, criado_em, atualizado_em)
VALUES ('SVC-05', 'E-mail e colaboração', 'CAT-SVC-03',
        'Caixas postais, listas de distribuição e ferramentas de colaboração.',
        'requisicao', 24, 'EQP-SDK', SYSTIMESTAMP, SYSTIMESTAMP);
INSERT INTO servicos (id, nome, categoria_id, descricao, tipo_padrao, sla_horas, equipe_id, criado_em, atualizado_em)
VALUES ('SVC-06', 'Relatórios e indicadores', 'CAT-SVC-03',
        'Extrações, painéis e relatórios gerenciais.',
        'melhoria', 72, 'EQP-SIS', SYSTIMESTAMP, SYSTIMESTAMP);

INSERT INTO sistemas (id, nome, categoria_id, equipe_id, criticidade)
VALUES ('SYS-01', 'ERP', 'CAT-SIS-01', 'EQP-SIS', 'alta');
INSERT INTO sistemas (id, nome, categoria_id, equipe_id, criticidade)
VALUES ('SYS-02', 'Portal do Colaborador', 'CAT-SIS-01', 'EQP-SDK', 'media');
INSERT INTO sistemas (id, nome, categoria_id, equipe_id, criticidade)
VALUES ('SYS-03', 'Active Directory', 'CAT-SIS-02', 'EQP-INF', 'alta');
INSERT INTO sistemas (id, nome, categoria_id, equipe_id, criticidade)
VALUES ('SYS-04', 'E-mail corporativo', 'CAT-SIS-02', 'EQP-SDK', 'alta');
INSERT INTO sistemas (id, nome, categoria_id, equipe_id, criticidade)
VALUES ('SYS-05', 'Rede e Wi-Fi', 'CAT-SIS-02', 'EQP-INF', 'alta');
INSERT INTO sistemas (id, nome, categoria_id, equipe_id, criticidade)
VALUES ('SYS-06', 'Estações de trabalho', 'CAT-SIS-02', 'EQP-SDK', 'media');

COMMIT;