# Visão Geral da Arquitetura

## Diagrama Conceitual

```mermaid
graph TD
    User[Desenvolvedor] -->|Interage via CLI/Web| API[API Gateway / Orquestrador]
    Webhook[Git Webhooks] -->|Trigger| API
    Cron[Cron Jobs] -->|Trigger| API
    
    subgraph "Core System (Node.js)"
        API --> Queue[Job Queue (Redis/BullMQ)]
        Queue --> Worker[Mission Worker]
        Worker --> DB[(PostgreSQL)]
        Worker --> LLM[LLM Gateway]
    end
    
    subgraph "Knowledge & Context"
        CodeMap[Code Map Service]
        VectorDB[(Vector Store)]
        Worker --> CodeMap
    end
    
    subgraph "Secure Runtime (Sandbox)"
        Worker --> Docker[Docker Containers]
        Docker -->|Clone/Test/Edit| Repo[Target Repository]
    end

    User -->|Revisa| DB
```

## Fluxo de Dados

1.  **Entrada (Trigger):** O sistema acorda com um evento (Issue aberta, Falha de CI, Cron schedule ou Comando manual).
2.  **Planejamento (Planner):**
    -   O Worker assume a tarefa.
    -   Consulta o **Code Map** para entender a estrutura do projeto.
    -   Usa o **LLM** para criar um plano de passos (ex: "Criar teste", "Editar arquivo X", "Validar").
3.  **Execução (Coder):**
    -   Para cada passo, o Worker sobe um container **Docker** efêmero.
    -   Executa comandos (`npm test`, `git apply`) dentro do container.
    -   Captura stdout/stderr.
4.  **Revisão (Reviewer):**
    -   O agente **Reviewer** analisa o diff acumulado.
    -   Se aprovado pelo agente, notifica o usuário.
5.  **Feedback Humano:**
    -   O usuário aprova ou rejeita via TUI/Web.
    -   Se aprovado -> Commit & Push.

## Princípios de Design

1.  **Self-Hostable Simples:** O sistema deve rodar com um comando (`npm start`), sem exigir infra complexa (Redis/Postgres externos).
2.  **Assincronicidade:** Tudo é um Job. O usuário não espera a resposta na hora.
3.  **Segurança Primeiro:** Nenhum código gerado roda fora do Docker. Nenhuma chave de API vaza para o Sandbox.
4.  **Estado Persistente:** Se o servidor reiniciar, a "Missão" continua de onde parou (SQLite em modo WAL).

## Stack Tecnológica (All-in-One)

O objetivo é minimizar dependências externas para facilitar o deploy self-hosted.

### Backend (Node.js)
- **Framework:** **FeathersJS v5 (Dove)** com adaptador **KoaJS**.
    - Por que? Suporte nativo a Realtime (Socket.io), arquitetura orientada a serviços e tipagem forte.
- **Banco de Dados:** **SQLite** (via `better-sqlite3` e Knex/Objection.js ou Sequelize).
    - Modo WAL ativado para concorrência.
    - Extensão `sqlite-vss` para busca vetorial local.
- **Fila de Jobs:** Implementação interna baseada em tabela SQLite (`polling` inteligente). Dispensa Redis.

### Frontend (SPA)
- **Framework:** **Vue.js 3** + **Quasar Framework**.
- **Comunicação:** Feathers-Client (Socket.io) para streaming de logs e updates de estado em tempo real.

### Runtime (Sandbox)
- **Dockerode:** Biblioteca Node.js para controlar o Docker Daemon local.
- **Volumes:** Bind mounts dinâmicos para compartilhar arquivos entre Host e Sandbox.

