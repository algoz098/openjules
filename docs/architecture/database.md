# Esquema de Banco de Dados (PostgreSQL)

Estrutura preliminar das tabelas para persistência de estado.

## Tabelas Principais

### `projects`
Configurações do repositório monitorado.
- `id`: UUID
- `repo_url`: String
- `provider`: 'github' | 'gitlab'
- `settings`: JSON (agendamentos, regras de sandboxing)

### `missions`
Unidade de trabalho (uma issue, um cron job).
- `id`: UUID
- `project_id`: FK -> projects
- `trigger_type`: 'webhook' | 'cron' | 'manual'
- `status`: 'QUEUED' | 'PLANNING' | 'EXECUTING' | 'WAITING_REVIEW' | 'COMPLETED' | 'FAILED'
- `goal`: Text (Prompt inicial)
- `created_at`: Timestamp

### `mission_steps`
Passos do plano gerado.
- `id`: UUID
- `mission_id`: FK -> missions
- `order_index`: Int
- `description`: Text
- `status`: 'PENDING' | 'IN_PROGRESS' | 'DONE' | 'FAILED'
- `result_summary`: Text

### `mission_logs`
Logs detalhados para debug e auditoria.
- `id`: UUID
- `mission_id`: FK -> missions
- `step_id`: FK -> mission_steps (Nullable)
- `type`: 'thought' | 'command' | 'tool_output' | 'error'
- `content`: JSON/Text
- `timestamp`: Timestamp

### `code_index_cache` (Opcional - Code Map)
Cache de AST/Símbolos para não reprocessar tudo.
- `file_path`: String
- `file_hash`: String
- `symbols`: JSON (Lista de funções/classes)
