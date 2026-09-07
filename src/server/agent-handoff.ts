import { bindAgentHandoff, HANDOFF_REFRESH_MESSAGE, parseHandoffRequest } from "../shared/agent-handoff.js";
import type { AgentProducerClient } from "../producer/agent-client.js";

/** Use a server-owned, bound producer client; never send its credential to the browser. */
export async function prepareAgentHandoff(input: unknown, producer: Pick<AgentProducerClient, "manifest" | "snapshot">) {
  const request = parseHandoffRequest(input);
  const matches = (manifest: Awaited<ReturnType<AgentProducerClient["manifest"]>>) =>
    manifest.sessionId === request.sessionId && manifest.revision === request.revision && manifest.sourcePath === request.sourcePath;
  if (!matches(await producer.manifest())) throw new Error(HANDOFF_REFRESH_MESSAGE);
  const handoff = bindAgentHandoff(request, await producer.snapshot());
  if (!matches(await producer.manifest())) throw new Error(HANDOFF_REFRESH_MESSAGE);
  return handoff;
}
