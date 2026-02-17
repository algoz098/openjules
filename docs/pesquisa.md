# Pesquisa e Referencia Tecnica

Este arquivo consolida informacoes sobre o **Google Jules** e projetos similares, servindo de base para nosso sistema open-source.

## O que e o Google Jules (Analise do Clone)

URL Oficial: `https://jules.google.com/`

**Definicao:** Um agente de "Continuous AI" projetado para ser um parceiro proativo de desenvolvimento. Diferente de chat-bots, ele monitora o repositorio e age autonomamente.

### Funcionalidades Key (Reverse Engineering)
1.  **Continuous AI & Proatividade:**
    -   **Suggested Tasks:** Escaneia o codigo por `#TODO` ou bugs obvios e cria sugestoes de tarefas.
    -   **Scheduled Tasks:** Permite agendar jobs recorrentes (ex: "verificar deps", "otimizar imagens").
    -   **Auto-Correction:** Se integra ao deploy (ex: Render). Se falhar, ele tenta corrigir e commitar sozinho.

2.  **Arquitetura de Execucao:**
    -   **VM Isolada:** Executa codigo real (build, testes) em uma infra segura, nao na maquina do usuario.
    -   **Built-in Review:** O agente roda testes e tira screenshots da UI antes de pedir review humano.

3.  **Experiencia do Usuario (UX):**
    -   **TUI First:** Forte foco em CLI (`jules`) e dashboards no terminal, alem da web.
    -   **Manifesto:** Usa arquivos como `AGENTS.md` para entender contexto e regras do projeto.

## Projetos de Referencia (Benchmarks)

| Projeto | Tipo | Descricao | Status |
| :--- | :--- | :--- | :--- |
| **Devin** (Cognition AI) | Proprietario | O benchmark atual. Agentico, planeja e executa tarefas end-to-end, com terminal e browser integrados. | Fechado / Pago |
| **OpenHands** (ex-OpenDevin) | Open Source | A principal alternativa aberta. Usa Docker para sandbox e permite plugar LLMs (OpenAI, Anthropic, Ollama). | Ativo / Referencia |
| **SWE-agent** (Princeton) | Open Source | Focado em resolver GitHub Issues reais. Introduziu a interface simplificada "ACI" (Agent-Computer Interface) para LLMs. | Ativo / Pesquisa |
| **GitHub Copilot Workspace** | Proprietario | Focado em "task-centric" workflow: Issue -> Plano -> Codigo -> Review humano. | Beta / Pago |

## Arquitetura de Referencia para o Nosso Clone

Para clonar o Jules, precisaremos de:

### 1. Camada de Eventos "Continuous"
- Nao apenas "pedir", mas **monitorar**.
- **Watcher:** Servico que escuta webhooks (GitHub Push/PR/Workflow Fail) e Cron Jobs.

### 2. Sandbox Runtime (O Core)
- Substituir a "VM do Google" por **Docker/Proxmox**.
- Capacidade de clonar, instalar dependencias, rodar `npm test` e capturar logs/screenshots.

### 3. TUI & CLI
- Alem de uma Web UI, criar uma CLI robusta (em Go ou Node) que permita:
  - `openjules init`
  - `openjules task "fix login"`
  - `openjules status` (dashboard no terminal)

### 4. Protocolo de Contexto
- Implementar suporte a um arquivo de configuracao no repo (ex: `.openjules/config.yaml` ou `AGENTS.md`) que defina comandos de teste, lint e deploy.

## Engenharia Reversa e Tecnicas Avancadas

Analise tecnica profunda de ferramentas especializadas em manutencao autonoma.

### 1. AutoCodeRover (Foco: Bug Fixing)
- **O que resolve:** Localizacao precisa de bugs e geracao de patches testados.
- **Workflow:**
    1.  **Busca Estruturada (AST):** Nao usa `grep` (texto). Busca simbolos (classes/funcoes) usando a AST. Ex: "Me de o metodo X e quem chama ele".
    2.  **Fault Localization:** Roda testes existentes para ver quais linhas sao executadas na falha (Spectrum-based Fault Localization), estreitando o escopo.
    3.  **Patch & Validate:** Gera o patch, aplica e roda os testes novamente para confirmar a correcao.
- **Licao para nos:** O agente nao deve apenas "ler arquivos", deve navegar pela **estrutura do codigo** (AST) e usar testes como criterio de sucesso.

### 2. GritQL (Foco: Refatoracao em Massa)
- **O que resolve:** Transformacao de codigo complexa e repetitiva (ex: migracoes de framework, padronizacao de logs).
- **Como funciona:** Engine declarativa (Rust). Voce escreve padroes com "buracos" (ex: `console.log($msg)`) e a regra de reescrita. O engine aplica em paralelo em todo o repo.
- **Licao para nos:** Para tarefas repetitivas, o agente pode gerar scripts GritQL/Codemod em vez de editar arquivo por arquivo manualmente, garantindo consistencia.

### 3. Plandex (Foco: Planejamento Longo)
- **O que resolve:** Perda de contexto em tarefas grandes que tocam muitos arquivos.
- **Solucoes Inteligentes:**
    -   **Mapas de Codigo (Tree-sitter):** Cria um indice leve da estrutura do projeto (classes, funcoes, imports) sem carregar o conteudo dos arquivos. O LLM consulta esse mapa para decidir o que ler.
    -   **GIT de Pensamentos:** Mantem versionamento dos proprios planos. Permite fazer "undo" no raciocinio sem reverter o codigo.
    -   **Staging Area:** As mudancas nao vao para o disco do usuario imediatamente; ficam num ambiente isolado ate aprovacao.
- **Licao para nos:** Implementar um **"Code Map"** inicial e uma area de **Staging (Branch/Sandbox)** para mudancas nao aprovadas.

## Conclusao Arquitetural
Para o nosso clone, adotaremos um modelo hibrido:
1.  **Continuous & Proactive (Jules):** Monitoramento de Webhooks/Cron.
2.  **Estruturado (AutoCodeRover/Plandex):** Uso de Tree-sitter para mapas de codigo e busca semantica.
3.  **Seguro (Docker):** Sandbox obrigatorio para execucao de testes e apply de patches.



