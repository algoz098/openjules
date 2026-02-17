# OpenJules: Documentação e Pesquisa

Este projeto visa criar um **Engenheiro de Software Autônomo (AI Software Engineer)** open-source e self-hostable, inspirado no conceito de "Continuous AI" do Google Jules e na robustez de ferramentas como AutoCodeRover e Plandex.

## 🧭 Índice de Navegação

A documentação está organizada modularmente para facilitar a leitura técnica e conceitual.

### 1. Fontes de Inspiração & Engenharia Reversa
Estudos detalhados sobre as ferramentas que fundamentam nossa arquitetura.
- **[Google Jules](sources/google-jules.md)**: Continuous AI, arquitetura de VM assíncrona e UX proativa.
- **[AutoCodeRover](sources/autocoderover.md)**: Técnicas de localização de bugs, busca estruturada (AST) e validação por testes.
- **[Plandex](sources/plandex.md)**: Gestão de tarefas longas, Versionamento de Pensamentos e Estratégias de Contexto (Tree-sitter Maps).
- **[GritQL](sources/gritql.md)**: Engines de refatoração declarativa e transformações de código em massa.

### 2. Arquitetura do Sistema
Como o OpenJules funciona internamente.
- **[Visão Geral](architecture/overview.md)**: Diagrama de blocos, fluxo de dados e princípios de design (Assíncrono, Seguro, Persistente).
- **[Orquestrador](architecture/orchestrator.md)**: O "cérebro" em Node.js, filas de jobs (BullMQ), Webhooks e máquinas de estado.
- **[Sandbox & Execução](architecture/sandbox.md)**: Ambientes isolados (Docker/Proxmox), segurança e file interactions controladas.
- **[Code Map & Contexto](architecture/code-map.md)**: Indexação inteligente com Tree-sitter, grafos de dependência e busca semântica para economizar tokens.
- **[Agentes & Prompts](architecture/agents.md)**: Personas (Planner, Coder, Reviewer), loops ReAct e estratégias de prompt (Chain-of-Thought).
- **[Banco de Dados](architecture/database.md)**: Schema PostgreSQL para missões, steps, logs e cache de índice.

### 3. Guia de Desenvolvimento (Draft)
- [Pesquisa Inicial e Rascunhos](pesquisa.md) (Arquivo legado com anotações brutas).

---
*Este documento é gerado e mantido pela equipe de desenvolvimento do OpenJules. Última atualização: Fevereiro de 2026.*

