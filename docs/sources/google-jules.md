# Google Jules (Engenharia Reversa)

**URL Oficial:** `https://jules.google.com/`

## Conceito Fundamental
Diferente de assistentes de chat (Copilot, ChatGPT), o Jules é posicionado como um **"Continuous AI"**. Ele não espera o usuário pedir; ele monitora o repositório e age proativamente.

## Funcionalidades Chave para Clonar

### 1. Proatividade & Monitoramento
- **Suggested Tasks:** O sistema escaneia o código em busca de `#TODO`, dependências desatualizadas ou vulnerabilidades e cria "Sugestões de Tarefa" no dashboard.
- **Scheduled Tasks:** Suporte a Cron Jobs para manutenção (ex: "Rodar linter toda sexta-feira").
- **Integração com Deploy:** Se integra a plataformas (como Render/Google Cloud). Se um deploy falha, o Jules intercepta o erro e tenta consertar.

### 2. Arquitetura de Execução (Sandbox)
- **VM Isolada:** O código não roda na máquina do desenvolvedor. O Jules clona o repo em uma VM segura na infra do Google.
- **Segurança:** Isolação total para evitar que dependências maliciosas afetem a infraestrutura.

### 3. Fluxo de Revisão (Reviewer)
- **Built-in Peer Review:** O agente atua como seu próprio revisor. Ele roda testes e tira screenshots da UI alterada *antes* de notificar o humano.
- **Artifacts:** Gera evidências do trabalho (logs de teste, diffs) para dar confiança ao usuário.

### 4. Experiência do Usuário (TUI First)
- **CLI Poderosa:** Comandos como `jules task "fix bug"` iniciam o processo.
- **Dashboard no Terminal:** Interface rica (TUI) para visualizar status e diffs sem sair do terminal.
- **Arquivos de Configuração:** Uso de `AGENTS.md` ou similar para ditar regras do projeto ao agente.

## Lições para o OpenJules
- **Não ser apenas reativo:** Implementar *watchers* de Webhook e Cron.
- **Sandbox é Mandatório:** Usar Docker/Proxmox para emular a "VM do Google".
- **Foco na Confiança:** O sistema só deve pedir review quando tiver certeza (testes passando).
