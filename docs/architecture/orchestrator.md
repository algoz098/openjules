# Orquestrador (Core System)

O Orquestrador é a aplicação Node.js responsável por coordenar todo o trabalho. Ele não executa código do usuário, apenas gerencia o fluxo.

## Tecnologias (FeathersJS v5 + Koa)
- **Runtime:** Node.js (TypeScript).
- **Framework:** FeathersJS v5 (Dove) transportado via KoaJS.
- **Database:** SQLite (`better-sqlite3`) com modo WAL.
- **Vector Search:** `sqlite-vss` (extensão carregada dinamicamente).
- **Realtime:** Socket.io (nativo do Feathers).

## Máquina de Estados da Missão

Cada tarefa vira uma "Missão" gerenciada por serviços (`app.service('missions')`):

1.  `QUEUED`: Aguardando worker livre (polling na tabela).
2.  `PLANNING`: Agente Planner analisando o problema.
3.  `EXECUTING`: Agente Coder rodando passos no sandbox.
4.  `VALIDATING`: Executando testes finais.
5.  `WAITING_REVIEW`: Aguardando aprovação humana (Dashboard Quasar).
6.  `COMPLETED`: PR criado ou tarefa finalizada.
7.  `FAILED`: Erro irrecuperável ou timeout.

## Filas de Processamento (SQLite-based)

Para evitar a dependência do Redis (BullMQ), implementaremos um sistema de filas baseado em tabela:

- **Tabela:** `jobs`
- **Campos:** `id`, `type` (planning, execution), `status` (pending, processing, completed, failed), `payload` (JSON), `created_at`, `locked_at`.
- **Worker Loop:** Um `setInterval` no servidor busca jobs `PENDING` a cada X ms, marca como `PROCESSING` (atomicamente) e executa.

## API Endpoints (Services)

O Feathers expõe serviços via REST e Socket.io automaticamente:

- `missions`: CRUD de missões.
  - `create`: Inicia nova missão.
  - `patch`: Atualiza status/progresso.
- `mission-logs`: Stream de logs de execução (apenas leitura).
- `github-webhooks`: Endpoint customizado para receber eventos.

