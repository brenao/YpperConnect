export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      artigos: {
        Row: {
          atualizado_em: string
          autor_id: string | null
          categoria_id: string | null
          conteudo: string
          criado_em: string
          gerado_por_ia: boolean
          id: string
          resumo: string | null
          status: string
          titulo: string
          visualizacoes: number
        }
        Insert: {
          atualizado_em?: string
          autor_id?: string | null
          categoria_id?: string | null
          conteudo: string
          criado_em?: string
          gerado_por_ia?: boolean
          id: string
          resumo?: string | null
          status?: string
          titulo: string
          visualizacoes?: number
        }
        Update: {
          atualizado_em?: string
          autor_id?: string | null
          categoria_id?: string | null
          conteudo?: string
          criado_em?: string
          gerado_por_ia?: boolean
          id?: string
          resumo?: string | null
          status?: string
          titulo?: string
          visualizacoes?: number
        }
        Relationships: [
          {
            foreignKeyName: "artigos_autor_id_fkey"
            columns: ["autor_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "artigos_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categorias"
            referencedColumns: ["id"]
          },
        ]
      }
      baseline_tarefas: {
        Row: {
          baseline_id: string
          fim: string
          inicio: string
          nome: string
          tarefa_id: string
        }
        Insert: {
          baseline_id: string
          fim: string
          inicio: string
          nome: string
          tarefa_id: string
        }
        Update: {
          baseline_id?: string
          fim?: string
          inicio?: string
          nome?: string
          tarefa_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "baseline_tarefas_baseline_id_fkey"
            columns: ["baseline_id"]
            isOneToOne: false
            referencedRelation: "projeto_baselines"
            referencedColumns: ["id"]
          },
        ]
      }
      categorias: {
        Row: {
          ativo: boolean
          escopo: string
          id: string
          nome: string
        }
        Insert: {
          ativo?: boolean
          escopo: string
          id: string
          nome: string
        }
        Update: {
          ativo?: boolean
          escopo?: string
          id?: string
          nome?: string
        }
        Relationships: []
      }
      chamado_historico: {
        Row: {
          autor_id: string | null
          campo: string
          chamado_id: string
          criado_em: string
          id: string
          valor_anterior: string | null
          valor_novo: string | null
        }
        Insert: {
          autor_id?: string | null
          campo: string
          chamado_id: string
          criado_em?: string
          id: string
          valor_anterior?: string | null
          valor_novo?: string | null
        }
        Update: {
          autor_id?: string | null
          campo?: string
          chamado_id?: string
          criado_em?: string
          id?: string
          valor_anterior?: string | null
          valor_novo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chamado_historico_autor_id_fkey"
            columns: ["autor_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chamado_historico_chamado_id_fkey"
            columns: ["chamado_id"]
            isOneToOne: false
            referencedRelation: "chamados"
            referencedColumns: ["id"]
          },
        ]
      }
      chamado_interacoes: {
        Row: {
          autor_id: string | null
          chamado_id: string
          corpo: string
          criado_em: string
          id: string
          tipo: string
        }
        Insert: {
          autor_id?: string | null
          chamado_id: string
          corpo: string
          criado_em?: string
          id: string
          tipo: string
        }
        Update: {
          autor_id?: string | null
          chamado_id?: string
          corpo?: string
          criado_em?: string
          id?: string
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "chamado_interacoes_autor_id_fkey"
            columns: ["autor_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chamado_interacoes_chamado_id_fkey"
            columns: ["chamado_id"]
            isOneToOne: false
            referencedRelation: "chamados"
            referencedColumns: ["id"]
          },
        ]
      }
      chamados: {
        Row: {
          atualizado_em: string
          categoria_id: string | null
          codigo: string | null
          criado_em: string
          descricao: string
          descricao_encerramento: string | null
          equipe_id: string | null
          fechado_em: string | null
          id: string
          impacto: string
          numero: number
          origem: string
          prazo_resposta: string | null
          prazo_sla: string
          prefixo: string
          prioridade: string
          problema_vinculado_id: string | null
          resolvido_em: string | null
          respondido_em: string | null
          responsavel_id: string | null
          servico_id: string | null
          sistema_id: string | null
          solicitante_id: string
          status: string
          tipo: string
          titulo: string
          urgencia: string
        }
        Insert: {
          atualizado_em?: string
          categoria_id?: string | null
          codigo?: string | null
          criado_em?: string
          descricao: string
          descricao_encerramento?: string | null
          equipe_id?: string | null
          fechado_em?: string | null
          id: string
          impacto: string
          numero?: number
          origem: string
          prazo_resposta?: string | null
          prazo_sla: string
          prefixo?: string
          prioridade: string
          problema_vinculado_id?: string | null
          resolvido_em?: string | null
          respondido_em?: string | null
          responsavel_id?: string | null
          servico_id?: string | null
          sistema_id?: string | null
          solicitante_id: string
          status?: string
          tipo: string
          titulo: string
          urgencia: string
        }
        Update: {
          atualizado_em?: string
          categoria_id?: string | null
          codigo?: string | null
          criado_em?: string
          descricao?: string
          descricao_encerramento?: string | null
          equipe_id?: string | null
          fechado_em?: string | null
          id?: string
          impacto?: string
          numero?: number
          origem?: string
          prazo_resposta?: string | null
          prazo_sla?: string
          prefixo?: string
          prioridade?: string
          problema_vinculado_id?: string | null
          resolvido_em?: string | null
          respondido_em?: string | null
          responsavel_id?: string | null
          servico_id?: string | null
          sistema_id?: string | null
          solicitante_id?: string
          status?: string
          tipo?: string
          titulo?: string
          urgencia?: string
        }
        Relationships: [
          {
            foreignKeyName: "chamados_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categorias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chamados_equipe_id_fkey"
            columns: ["equipe_id"]
            isOneToOne: false
            referencedRelation: "equipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chamados_problema_vinculado_id_fkey"
            columns: ["problema_vinculado_id"]
            isOneToOne: false
            referencedRelation: "chamados"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chamados_responsavel_id_fkey"
            columns: ["responsavel_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chamados_servico_id_fkey"
            columns: ["servico_id"]
            isOneToOne: false
            referencedRelation: "servicos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chamados_sistema_id_fkey"
            columns: ["sistema_id"]
            isOneToOne: false
            referencedRelation: "sistemas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chamados_solicitante_id_fkey"
            columns: ["solicitante_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      equipes: {
        Row: {
          ativo: boolean
          id: string
          nome: string
        }
        Insert: {
          ativo?: boolean
          id: string
          nome: string
        }
        Update: {
          ativo?: boolean
          id?: string
          nome?: string
        }
        Relationships: []
      }
      expediente: {
        Row: {
          ativo: boolean
          dia_semana: number
          id: string
          minuto_fim: number
          minuto_ini: number
        }
        Insert: {
          ativo?: boolean
          dia_semana: number
          id: string
          minuto_fim: number
          minuto_ini: number
        }
        Update: {
          ativo?: boolean
          dia_semana?: number
          id?: string
          minuto_fim?: number
          minuto_ini?: number
        }
        Relationships: []
      }
      feriados: {
        Row: {
          ativo: boolean
          data_feriado: string
          descricao: string
          dia: number | null
          id: string
          mes: number | null
          recorrente: boolean
          tipo: string
        }
        Insert: {
          ativo?: boolean
          data_feriado: string
          descricao: string
          dia?: number | null
          id: string
          mes?: number | null
          recorrente?: boolean
          tipo?: string
        }
        Update: {
          ativo?: boolean
          data_feriado?: string
          descricao?: string
          dia?: number | null
          id?: string
          mes?: number | null
          recorrente?: boolean
          tipo?: string
        }
        Relationships: []
      }
      notificacoes: {
        Row: {
          assunto: string
          corpo: string | null
          criado_em: string
          destinatario_email: string
          destinatario_id: string | null
          enviado_em: string | null
          erro: string | null
          id: string
          referencia_id: string | null
          referencia_tipo: string | null
          status: string
          tentativas: number
          tipo: string
        }
        Insert: {
          assunto: string
          corpo?: string | null
          criado_em?: string
          destinatario_email: string
          destinatario_id?: string | null
          enviado_em?: string | null
          erro?: string | null
          id: string
          referencia_id?: string | null
          referencia_tipo?: string | null
          status?: string
          tentativas?: number
          tipo: string
        }
        Update: {
          assunto?: string
          corpo?: string | null
          criado_em?: string
          destinatario_email?: string
          destinatario_id?: string | null
          enviado_em?: string | null
          erro?: string | null
          id?: string
          referencia_id?: string | null
          referencia_tipo?: string | null
          status?: string
          tentativas?: number
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "notificacoes_destinatario_id_fkey"
            columns: ["destinatario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      perfil_features: {
        Row: {
          feature_key: string
          perfil_id: string
        }
        Insert: {
          feature_key: string
          perfil_id: string
        }
        Update: {
          feature_key?: string
          perfil_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "perfil_features_perfil_id_fkey"
            columns: ["perfil_id"]
            isOneToOne: false
            referencedRelation: "perfis_acesso"
            referencedColumns: ["id"]
          },
        ]
      }
      perfil_modulos: {
        Row: {
          modulo_key: string
          perfil_id: string
        }
        Insert: {
          modulo_key: string
          perfil_id: string
        }
        Update: {
          modulo_key?: string
          perfil_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "perfil_modulos_perfil_id_fkey"
            columns: ["perfil_id"]
            isOneToOne: false
            referencedRelation: "perfis_acesso"
            referencedColumns: ["id"]
          },
        ]
      }
      perfis_acesso: {
        Row: {
          ativo: boolean
          descricao: string | null
          id: string
          nome: string
          sistema: boolean
        }
        Insert: {
          ativo?: boolean
          descricao?: string | null
          id: string
          nome: string
          sistema?: boolean
        }
        Update: {
          ativo?: boolean
          descricao?: string | null
          id?: string
          nome?: string
          sistema?: boolean
        }
        Relationships: []
      }
      projeto_atencoes: {
        Row: {
          criado_em: string
          decisao_necessaria: string | null
          descricao: string | null
          id: string
          projeto_id: string
          resolvido_em: string | null
          responsavel_decisao_id: string | null
          status: string
          titulo: string
        }
        Insert: {
          criado_em?: string
          decisao_necessaria?: string | null
          descricao?: string | null
          id: string
          projeto_id: string
          resolvido_em?: string | null
          responsavel_decisao_id?: string | null
          status?: string
          titulo: string
        }
        Update: {
          criado_em?: string
          decisao_necessaria?: string | null
          descricao?: string | null
          id?: string
          projeto_id?: string
          resolvido_em?: string | null
          responsavel_decisao_id?: string | null
          status?: string
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "projeto_atencoes_projeto_id_fkey"
            columns: ["projeto_id"]
            isOneToOne: false
            referencedRelation: "projetos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projeto_atencoes_responsavel_decisao_id_fkey"
            columns: ["responsavel_decisao_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      projeto_atualizacoes: {
        Row: {
          autor_id: string | null
          criado_em: string
          data_ref: string
          descricao: string | null
          id: string
          projeto_id: string
          proximas_entregas: string | null
          ultimas_entregas: string | null
        }
        Insert: {
          autor_id?: string | null
          criado_em?: string
          data_ref: string
          descricao?: string | null
          id: string
          projeto_id: string
          proximas_entregas?: string | null
          ultimas_entregas?: string | null
        }
        Update: {
          autor_id?: string | null
          criado_em?: string
          data_ref?: string
          descricao?: string | null
          id?: string
          projeto_id?: string
          proximas_entregas?: string | null
          ultimas_entregas?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "projeto_atualizacoes_autor_id_fkey"
            columns: ["autor_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projeto_atualizacoes_projeto_id_fkey"
            columns: ["projeto_id"]
            isOneToOne: false
            referencedRelation: "projetos"
            referencedColumns: ["id"]
          },
        ]
      }
      projeto_baselines: {
        Row: {
          autor_id: string | null
          criado_em: string
          descricao: string | null
          id: string
          projeto_id: string
          versao: number
        }
        Insert: {
          autor_id?: string | null
          criado_em?: string
          descricao?: string | null
          id: string
          projeto_id: string
          versao: number
        }
        Update: {
          autor_id?: string | null
          criado_em?: string
          descricao?: string | null
          id?: string
          projeto_id?: string
          versao?: number
        }
        Relationships: [
          {
            foreignKeyName: "projeto_baselines_autor_id_fkey"
            columns: ["autor_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projeto_baselines_projeto_id_fkey"
            columns: ["projeto_id"]
            isOneToOne: false
            referencedRelation: "projetos"
            referencedColumns: ["id"]
          },
        ]
      }
      projeto_riscos: {
        Row: {
          criado_em: string
          descricao: string
          id: string
          impacto: string
          mitigacao: string | null
          probabilidade: string
          projeto_id: string
          status: string
        }
        Insert: {
          criado_em?: string
          descricao: string
          id: string
          impacto: string
          mitigacao?: string | null
          probabilidade: string
          projeto_id: string
          status?: string
        }
        Update: {
          criado_em?: string
          descricao?: string
          id?: string
          impacto?: string
          mitigacao?: string | null
          probabilidade?: string
          projeto_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "projeto_riscos_projeto_id_fkey"
            columns: ["projeto_id"]
            isOneToOne: false
            referencedRelation: "projetos"
            referencedColumns: ["id"]
          },
        ]
      }
      projeto_tarefas: {
        Row: {
          alocacao_pct: number | null
          atividade: string | null
          concluido_em: string | null
          duracao: number | null
          duracao_unidade: string | null
          fim: string
          id: string
          inicio: string
          marco: boolean
          nome: string
          ordem: number
          pai_id: string | null
          progresso: number
          projeto_id: string
          quadro: string
        }
        Insert: {
          alocacao_pct?: number | null
          atividade?: string | null
          concluido_em?: string | null
          duracao?: number | null
          duracao_unidade?: string | null
          fim: string
          id: string
          inicio: string
          marco?: boolean
          nome: string
          ordem?: number
          pai_id?: string | null
          progresso?: number
          projeto_id: string
          quadro?: string
        }
        Update: {
          alocacao_pct?: number | null
          atividade?: string | null
          concluido_em?: string | null
          duracao?: number | null
          duracao_unidade?: string | null
          fim?: string
          id?: string
          inicio?: string
          marco?: boolean
          nome?: string
          ordem?: number
          pai_id?: string | null
          progresso?: number
          projeto_id?: string
          quadro?: string
        }
        Relationships: [
          {
            foreignKeyName: "projeto_tarefas_pai_id_fkey"
            columns: ["pai_id"]
            isOneToOne: false
            referencedRelation: "projeto_tarefas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projeto_tarefas_projeto_id_fkey"
            columns: ["projeto_id"]
            isOneToOne: false
            referencedRelation: "projetos"
            referencedColumns: ["id"]
          },
        ]
      }
      projetos: {
        Row: {
          atualizado_em: string
          criado_em: string
          fim: string
          gerente_id: string | null
          id: string
          inicio: string
          nome: string
          objetivo: string | null
          sponsor_id: string | null
          status: string
        }
        Insert: {
          atualizado_em?: string
          criado_em?: string
          fim: string
          gerente_id?: string | null
          id: string
          inicio: string
          nome: string
          objetivo?: string | null
          sponsor_id?: string | null
          status?: string
        }
        Update: {
          atualizado_em?: string
          criado_em?: string
          fim?: string
          gerente_id?: string | null
          id?: string
          inicio?: string
          nome?: string
          objetivo?: string | null
          sponsor_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "projetos_gerente_id_fkey"
            columns: ["gerente_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projetos_sponsor_id_fkey"
            columns: ["sponsor_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      recursos: {
        Row: {
          ativo: boolean
          disponibilidade_projetos: number
          equipe_id: string | null
          horas_dia: number
          id: string
          nome: string
          papel: string | null
          usuario_id: string | null
        }
        Insert: {
          ativo?: boolean
          disponibilidade_projetos?: number
          equipe_id?: string | null
          horas_dia?: number
          id: string
          nome: string
          papel?: string | null
          usuario_id?: string | null
        }
        Update: {
          ativo?: boolean
          disponibilidade_projetos?: number
          equipe_id?: string | null
          horas_dia?: number
          id?: string
          nome?: string
          papel?: string | null
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recursos_equipe_id_fkey"
            columns: ["equipe_id"]
            isOneToOne: false
            referencedRelation: "equipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recursos_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: true
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      servicos: {
        Row: {
          ativo: boolean
          atualizado_em: string
          categoria_id: string | null
          criado_em: string
          descricao: string | null
          equipe_id: string | null
          gerado_por_ia: boolean
          id: string
          nome: string
          sla_horas: number
          tipo_padrao: string
        }
        Insert: {
          ativo?: boolean
          atualizado_em?: string
          categoria_id?: string | null
          criado_em?: string
          descricao?: string | null
          equipe_id?: string | null
          gerado_por_ia?: boolean
          id: string
          nome: string
          sla_horas: number
          tipo_padrao: string
        }
        Update: {
          ativo?: boolean
          atualizado_em?: string
          categoria_id?: string | null
          criado_em?: string
          descricao?: string | null
          equipe_id?: string | null
          gerado_por_ia?: boolean
          id?: string
          nome?: string
          sla_horas?: number
          tipo_padrao?: string
        }
        Relationships: [
          {
            foreignKeyName: "servicos_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categorias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "servicos_equipe_id_fkey"
            columns: ["equipe_id"]
            isOneToOne: false
            referencedRelation: "equipes"
            referencedColumns: ["id"]
          },
        ]
      }
      sistemas: {
        Row: {
          ativo: boolean
          atribuicao_id: string | null
          categoria_id: string | null
          criticidade: string
          descricao: string | null
          equipe_id: string | null
          id: string
          nome: string
          responsavel_id: string | null
        }
        Insert: {
          ativo?: boolean
          atribuicao_id?: string | null
          categoria_id?: string | null
          criticidade: string
          descricao?: string | null
          equipe_id?: string | null
          id: string
          nome: string
          responsavel_id?: string | null
        }
        Update: {
          ativo?: boolean
          atribuicao_id?: string | null
          categoria_id?: string | null
          criticidade?: string
          descricao?: string | null
          equipe_id?: string | null
          id?: string
          nome?: string
          responsavel_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sistemas_atribuicao_id_fkey"
            columns: ["atribuicao_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sistemas_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categorias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sistemas_equipe_id_fkey"
            columns: ["equipe_id"]
            isOneToOne: false
            referencedRelation: "equipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sistemas_responsavel_id_fkey"
            columns: ["responsavel_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      tarefa_predecessoras: {
        Row: {
          predecessora_id: string
          tarefa_id: string
        }
        Insert: {
          predecessora_id: string
          tarefa_id: string
        }
        Update: {
          predecessora_id?: string
          tarefa_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tarefa_predecessoras_predecessora_id_fkey"
            columns: ["predecessora_id"]
            isOneToOne: false
            referencedRelation: "projeto_tarefas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tarefa_predecessoras_tarefa_id_fkey"
            columns: ["tarefa_id"]
            isOneToOne: false
            referencedRelation: "projeto_tarefas"
            referencedColumns: ["id"]
          },
        ]
      }
      tarefa_responsaveis: {
        Row: {
          principal: boolean
          recurso_id: string
          tarefa_id: string
        }
        Insert: {
          principal?: boolean
          recurso_id: string
          tarefa_id: string
        }
        Update: {
          principal?: boolean
          recurso_id?: string
          tarefa_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tarefa_responsaveis_recurso_id_fkey"
            columns: ["recurso_id"]
            isOneToOne: false
            referencedRelation: "recursos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tarefa_responsaveis_tarefa_id_fkey"
            columns: ["tarefa_id"]
            isOneToOne: false
            referencedRelation: "projeto_tarefas"
            referencedColumns: ["id"]
          },
        ]
      }
      usuarios: {
        Row: {
          ad_object_id: string | null
          admin: boolean
          ativo: boolean
          atualizado_em: string
          criado_em: string
          departamento: string | null
          email: string
          equipe_id: string | null
          id: string
          login: string
          nome: string
          origem: string
          perfil_id: string | null
          sincronizado_em: string | null
        }
        Insert: {
          ad_object_id?: string | null
          admin?: boolean
          ativo?: boolean
          atualizado_em?: string
          criado_em?: string
          departamento?: string | null
          email: string
          equipe_id?: string | null
          id: string
          login: string
          nome: string
          origem?: string
          perfil_id?: string | null
          sincronizado_em?: string | null
        }
        Update: {
          ad_object_id?: string | null
          admin?: boolean
          ativo?: boolean
          atualizado_em?: string
          criado_em?: string
          departamento?: string | null
          email?: string
          equipe_id?: string | null
          id?: string
          login?: string
          nome?: string
          origem?: string
          perfil_id?: string | null
          sincronizado_em?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "usuarios_equipe_id_fkey"
            columns: ["equipe_id"]
            isOneToOne: false
            referencedRelation: "equipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usuarios_perfil_id_fkey"
            columns: ["perfil_id"]
            isOneToOne: false
            referencedRelation: "perfis_acesso"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
