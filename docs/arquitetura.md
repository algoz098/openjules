# Arquitetura do Sistema

Este documento descreve a arquitetura tecnica do OpenJules, um sistema de engenharia de software autonomo e continuo, inspirado no Google Jules e ferramentas como AutoCodeRover e Plandex.

## Visao Geral

O OpenJules opera como um **Agente de Continuous AI**. Ele nao e apenas um chatbot; e um sistema distribuido que monitora repositorios, planeja mudancas complexas e executa codigo de forma segura.

### Principais Componentes

1.  **Core Orchestrator (Cerebro):** Gerencia o ciclo de vida das tarefas (Issues, Cron Jobs, PRs).
2.  **Code Map Service (Contexto):** Mantem um indice estruturado (Tree-sitter) do repositorio para navegacao eficiente.
3.  **Sandbox Runtime (Execucao):** Ambientes isolados (Docker/Firecracker) onde o codigo e clonado, builtado e testado.
4.  **LLM Gateway:** Abstracao para modelos de IA (OpenAI, Anthropic, Ollama, vLLM).
5.  **Interface (TUI & Web):** Dashboards para humanos revisarem planos e diffs.

---

## 1. Core Orchestrator (Node.js/TypeScript)

O coracao do sistema. Baseado em eventos e maquinas de estado.

-   **Event Loop:** Escuta Webhooks (GitHub/GitLab) e Cron Triggers.
-   **Task Queue:** Gerencia filas de prioridade (ex: BullMQ no Redis).
    -   `queue:planning` -> Agente Planner
    -   `queue:coding` -> Agente Coder
    -   `queue:review` -> Agente Reviewer
-   **State Management:** Persiste o estado de cada "Missao" no banco (Postgres).
    -   *Ex:* `Mission #123: STATUS=WAITING_USER_APPROVAL, STEPS=[Step1: DONE, Step2: PENDING]`

## 2. Code Map Service (Search & Retrieval)

Inspirado no *Plandex* e *AutoCodeRover*. Resolve o problema de limite de contexto.

-   **Indexer:** Ao iniciar uma missao, clona o repo e gera uma AST (Abstract Syntax Tree) leve usando `tree-sitter`.
-   **Symbol Graph:** Cria um grafo de dependencias: `Function A calls Function B in File C`.
-   **Semantic Search:** (Opcional) Indexa chunks de codigo em um banco vetorial (pgvector) para buscas por linguagem natural ("Onde esta a logica de autenticacao?").
-   **API:**
    -   `get_file_structure(path)` -> Retorna classes/metodos, nao o conteudo todo.
    -   `find_usages(symbol)` -> Retorna todas as ocorrencias de uma funcao.

## 3. Sandbox Runtime (Docker)

Seguranca e reprodutibilidade. O agente nunca roda na maquina do orquestrador.

-   **Ephemeral Environments:** Para cada Missao, sobe um container (ex: `node:18-alpine` ou `python:3.11`).
-   **Toolbelt:** O container ja vem com ferramentas pre-instaladas: `git`, `ag` (silver searcher), `sed`, `LSP servers`.
-   **Execution API:**
    -   `exec_cmd("npm test")` -> Retorna `stdout`, `stderr`, `exit_code`.
    -   `apply_patch(diff)` -> Aplica mudancas.
    -   `read_file(path)` -> Le conteudo seguro.
-   **Isolation:** Sem acesso a rede externa (exceto allowlist para `npm install`/`pip`).

## 4. Agentes Especializados (Prompts & Flows)

O sistema nao usa um "agente generico". Usa personas:

-   **Planner:** Le a issue, consulta o Code Map e gera um plano (YAML/JSON) de passos.
    -   *Input:* "Corrigir bug no login".
    -   *Output:* "1. Criar teste de reproducao em `tests/auth.spec.ts`. 2. Modificar `src/auth.ts`..."
-   **Coder:** Recebe um **unico passo** do plano e executa.
    -   *Loop:* Escreve codigo -> Roda Teste -> Le Erro -> Corrige -> Repete (Max 5x).
-   **Reviewer:** Analisa o diff final. Busca por `console.log` esquecidos, chaves vazadas, padroes ruins.

## 5. Interface Humana (TUI First)

Focada em **supervisao**, nao microgerenciamento.

-   **CLI (`openjules`):**
    -   `openjules start "refactor database module"`
    -   `openjules status` (Mostra progresso em tempo real)
    -   `openjules review <mission-id>` (Mostra diff colorido e pede [Y/n])

---

## Fluxo de Dados (Exemplo: Bug Fix)

1.  **Trigger:** Webhook de Issue "Bug na tela de Login".
2.  **Orchestrator:** Cria `Mission #55` e enfileira para o **Planner**.
3.  **Planner:**
    -   Consulta **Code Map**: "Onde estao os arquivos de login?"
    -   Retorna lista: `src/controllers/auth.ts`, `src/views/login.tsx`.
    -   Cria Plano: "1. Reproduzir erro. 2. Corrigir regex de email."
4.  **Coder (Passo 1):**
    -   Sobe **Sandbox**.
    -   Cria arquivo `repro_test.ts`.
    -   Roda `npm test`. Falha (bom!).
5.  **Coder (Passo 2):**
    -   Le `src/controllers/auth.ts`.
    -   Aplica patch via `sed` ou escrita direta.
    -   Roda `npm test`. Passou!
6.  **Reviewer:** Verifica estilo.
7.  **Human:** Recebe notificacao. Roda `openjules review`. Aprova.
8.  **Orchestrator:** Abre PR no GitHub.

## Tecnologias Escolhidas (Stack Inicial)

-   **Lang:** TypeScript (Node.js) para Orquestrador e CLI (fácil manutencao).
-   **Database:** PostgreSQL (Metadados + pgvector).
-   **Queue:** Redis (BullMQ).
-   **Runtime:** Docker (via Dockerode).
-   **LLM Integration:** Vercel AI SDK ou LangChain.js.
