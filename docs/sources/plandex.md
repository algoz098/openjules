# Plandex (Inspiração de Planejamento)

**Foco:** Agente para Tarefas Longas e Complexas.
**Repositório:** `https://github.com/plandex-ai/plandex`

## O Que Resolve?
A perda de contexto e coerência em tarefas que exigem múltiplos passos ou edição de muitos arquivos simultaneamente.

## Inovações Arquiteturais

### 1. Context Slicing (Code Map)
- **Problema:** Repositórios grandes não cabem no contexto do LLM.
- **Solução:** Plandex cria um **Mapa do Repositório** (usando Tree-sitter) que lista arquivos e símbolos (funções/classes) sem o conteúdo.
- **Dinâmica:** O agente consulta esse mapa e carrega apenas as definições necessárias para o passo atual, "fatiando" o contexto dinamicamente.

### 2. Versionamento de Pensamentos (Git for Thoughts)
- **Conceito:** O planejamento do agente é versionado.
- **Branching de Raciocínio:** Se o agente segue um caminho ruim (ex: tentar uma biblioteca que não existe), ele pode fazer "backtrack" (voltar atrás) na árvore de pensamentos sem reverter o código git real.
- **Persistência:** O estado do plano é salvo externamente, permitindo pausas e retomadas.

### 3. Staging Area (Sandbox de Diff)
- **Segurança:** O agente cria um ambiente de "rascunho". As mudanças vão acumulando nesse buffer.
- **Review Cumulativo:** O usuário revisa o conjunto de alterações de vários passos de uma vez, garantindo coesão antes de aplicar ao disco real.

## Lições para o OpenJules
- **Camada de Mapa de Código:** Essencial para lidar com repositórios reais.
- **Agente Stateful:** O orquestrador precisa manter o estado da "Missão" (histórico de passos, arquivos carregados e plano atual) no banco de dados.
