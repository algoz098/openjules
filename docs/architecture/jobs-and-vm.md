# Job System & Sandbox Architecture

This document details the asynchronous job processing system and the sandbox execution environment for OpenJules, leveraging **FeathersJS**, **Koa**, **SQLite**, and **Dockerode**.

## 1. Job Lifecycle (Async)

 The system uses a persistent, database-backed job queue to decouple HTTP requests from long-running agent tasks.

### Creation Flow
1.  **Client Request**: A user or external system calls `POST /missions` service.
2.  **Mission Service**: The `missions` service validates the request (e.g., target repository, prompt).
3.  **Job Dispatch**: Instead of executing immediately, the mission service creates a record in the `jobs` service (SQLite table `jobs`).
    *   **Initial State**: `PENDING`
    *   **Payload**: Contains `missionId`, `repoUrl`, `instruction`, and configuration overrides.
4.  **Response**: The API responds immediately with `201 Created` returning the `mission` and `job` object, allowing the frontend to subscribe to updates.

### Worker Loop (Polling)
A background worker (initialized in `app.ts` or a separate process) polls the SQLite database for pending jobs.

*   **Polling Interval**: Configurable (e.g., every 500ms - 2s).
*   **Locking Mechanism**: To prevent race conditions (especially if scaling horizontally later), the worker performs an atomic update to "claim" a job.

```sql
UPDATE jobs
SET status = 'LOCKED',
    workerId = :currentWorkerId,
    startedAt = CURRENT_TIMESTAMP
WHERE id = (
  SELECT id
  FROM jobs
  WHERE status = 'PENDING'
  ORDER BY createdAt ASC
  LIMIT 1
)
RETURNING *;
```

### State Transitions & Recovery
The job moves through the following states:

*   `PENDING`: Waiting to be picked up.
*   `LOCKED`: Picked up by a worker, container provisioning starting.
*   `RUNNING`: Sandbox active, agent executing.
*   `COMPLETED`: Execution finished successfully.
*   `FAILED`: Execution encountered an error.
*   `TIMED_OUT`: Execution exceeded maximum duration.

**Crash Recovery**:
If the server crashes while a job is `LOCKED` or `RUNNING`:
1.  On startup, a **Recovery Service** scans for jobs that have been in `LOCKED` or `RUNNING` state for longer than a threshold (e.g., 5 minutes without heartbeats).
2.  These jobs are transitioned to `FAILED` (with error "Unexpected termination") or reset to `PENDING` (if idempotent and safe to retry).
3.  Orphaned Docker containers are identified via labels and cleaned up.

## 2. Execution Drivers & Sandbox

To support various deployment environments (local dev, secure SaaS, on-premise), OpenJules abstracts the execution environment using **Drivers**. The system supports three levels of isolation:

### 2.1. Node.js Worker Threads (Local/Insecure)
For lightweight local testing or environments where installing Docker is not possible.
*   **Isolation**: Process-level only (Shared Memory/FS risk).
*   **Use Case**: Development, trustable internal scripts, "quick agent" runs.
*   **Mechanism**: Uses Node.js `worker_threads` to spawn a new thread for the agent code.
*   **Pros**: Zero external dependencies (no Docker daemon needed), extremely fast startup.
*   **Cons**: ZERO security isolation. Malicious code can access the host file system and environment variables.

### 2.2. Docker Containers (Standard)
The default mechanism for standard deployments.
*   **Isolation**: Container-level (Kernel namespaces/cgroups).
*   **Use Case**: Standard production, SaaS with moderate trust.
*   **Mechanism**: Uses `dockerode` to manage ephemeral containers.
*   **Configuration**:
    *   **Image**: `openjules-node-agent:latest` (contains runtime + CLI tools).
    *   **Mounts**: Workspaces are mounted from Host `/var/lib/openjules` to Container `/workspace`.
    *   **Limits**: CPU/Memory limited via Docker HostConfig.

### 2.3. Proxmox VMs (High Security)
For executing untrusted code or requiring full OS-level isolation (e.g., kernel exploits research, malware analysis).
*   **Isolation**: Hardware virtualization (KVM/QEMU).
*   **Use Case**: Enterprise, Public SaaS handling untrusted user code.
*   **Mechanism**: Interacts with Proxmox API to clone/start VMs from a "Gold Image".
*   **Workflow**:
    1.  **Clone**: Clone a template VM (snapshot) for the job.
    2.  **Inject**: Use cloud-init or SSH to inject the job payload/agent.
    3.  **Execute**: Run the agent.
    4.  **Destroy**: Destroy the VM immediately after job completion.
*   **Pros**: Hardest security boundary provided by hypervisors.
*   **Cons**: Slower startup (seconds to minutes), high resource usage.

### Driver Configuration
The active driver is selected via the "Settings" screen in the Frontend or environment variables.
*   `EXECUTION_DRIVER`: `node`, `docker`, or `proxmox`.
*   **Docker Config**: Socket path, registry credentials.
*   **Proxmox Config**: API URL, User, Token, Node Name, Template ID.

### Log Streaming (stdout/stderr -> Frontend)
Real-time feedback is critical for the user experience.

1.  **Driver Stream**: The active driver attaches to the execution stream (Worker stdout, Docker attach, or VM Serial Console/SSH stream).
2.  **Feathers Events**: As chunks of data arrive from the container stream, the worker emits Feathers service events (or uses a dedicated `logs` service).
3.  **Socket.io**: The frontend, listening via Socket.io, receives these events in real-time and renders the terminal output.

```javascript
stream.on('data', (chunk) => {
  app.service('job-logs').create({
    jobId: job.id,
    content: chunk.toString(),
    type: 'stdout'
  });
});
```

## 3. Future-Proofing (VMs)

To prevent vendor lock-in to Docker and support stronger isolation (e.g., for multi-tenant SaaS hosting), the architecture uses a **Driver Pattern**.

### Sandbox Driver Interface
The `JobWorker` does not call `dockerode` directly. Instead, it relies on an abstraction:

```typescript
interface SandboxDriver {
  /**
   * Provisions the environment and prepares it for execution.
   */
  spawn(config: SandboxConfig): Promise<SandboxInstance>;

  /**
   * Cleans up resources (containers, VMs, network bridges).
   */
  teardown(instanceId: string): Promise<void>;
}

interface SandboxInstance {
  id: string;
  command(cmd: string): Promise<ExecutionResult>;
  streamLogs(onLog: (log: string) => void): void;
}
```

### Implementations

1.  **`DockerDriver` (Current)**: Implements the interface using `dockerode`. Ideal for local development and self-hosted, single-tenant instances.
2.  **`FirecrackerDriver` (Future)**: Will implement the interface using AWS Firecracker or similar microVM technologies.
    *   **Why?** MicroVMs offer hardware virtualization security, isolating tenants significantly better than containers sharing a kernel.
3.  **`CloudDriver` (Future)**: Could spawn EC2 instances or Kubernetes Pods for heavy workloads.

By coding the `Worker Loop` against `SandboxDriver`, switching from local Docker containers to Firecracker microVMs becomes a configuration change in `app.json`, requiring zero changes to the core orchestration logic.
