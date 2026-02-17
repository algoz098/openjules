# Sandbox & Execução Segura

O Sandbox é o ambiente onde o "trabalho sujo" acontece. O Orquestrador comanda, o Sandbox executa.

## Estratégia de Isolamento

### Opção A: Docker (Default MVP)
Uso de contêineres Docker padrão.
- **Prós:** Fácil de implementar, roda em qualquer lugar.
- **Contras:** Isolamento não é perfeito (kernel compartilhado).
- **Setup:** Um container por Missão ou por Passo. Volume montado apenas com o código do repo.

### Opção B: MicroVMs (Firecracker / Proxmox) - Futuro
Para ambientes multi-tenant ou execução de código muito hostil.
- **Ideia:** Subir uma VM leve para cada job.
- **Integração:** Usar API do Proxmox ou bibliotecas de Firecracker.

## Interface do Sandbox (Contract)

O Sandbox deve expor uma API interna (ou ser controlado via Docker API) com os métodos:

1.  `init(repo_url, base_branch)`: Clona o repo e prepara ambiente.
2.  `exec(command, workdir)`: Roda shell command. Retorna `{ stdout, stderr, exitCode }`.
3.  `write_file(path, content)`: Cria/Sobrescreve arquivo.
4.  `read_file(path)`: Lê conteúdo.
5.  `create_patch()`: Gera o diff git das alterações feitas.

## Segurança
- **Network:** Bloqueio de rede por padrão. Liberar apenas domínios necessários (npm, pip, maven) via proxy ou whitelist de DNS.
- **Resources:** Limites rígidos de CPU e RAM (ex: 2vCPU, 4GB RAM) para evitar travamento do host.
- **Timeout:** Todo job tem tempo máximo de vida (ex: 10 min).
