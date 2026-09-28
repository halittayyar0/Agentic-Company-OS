import type { Agent, Task } from "@workspace/api-client-react";
import { ChatPanel } from "@/components/chat/chat-panel";

export function ProjectChatPanel({
  project,
  owner,
  canStart = true,
}: {
  project: Task;
  owner: Agent;
  canStart?: boolean;
}) {
  return (
    <ChatPanel
      agent={owner}
      project={project}
      modelSel={{ modelMode: owner.modelMode, modelId: owner.modelId }}
      canStart={canStart && project.ownerAgentId === owner.id}
    />
  );
}
