import type Anthropic from '@anthropic-ai/sdk';
import type { ChatTurn } from './conversations.js';

export type LlmClient = Pick<Anthropic, 'messages'>;

export interface AssistantRequest {
  model: string;
  system: string;
  history: ChatTurn[];
  tools: Anthropic.Tool[];
  executeTool: (name: string, input: unknown) => Promise<string>;
  maxToolRounds?: number;
}

const FALLBACK_REPLY = 'Sorry, I could not come up with an answer. Could you try rephrasing that?';

// Runs the Claude tool-use loop until the model produces a final text answer.
export async function generateReply(client: LlmClient, request: AssistantRequest): Promise<string> {
  const maxToolRounds = request.maxToolRounds ?? 5;
  const messages: Anthropic.MessageParam[] = request.history.map((turn) => ({
    role: turn.role,
    content: turn.content,
  }));

  for (let round = 0; round <= maxToolRounds; round++) {
    const response = await client.messages.create({
      model: request.model,
      max_tokens: 1024,
      system: request.system,
      tools: request.tools,
      messages,
    });

    if (response.stop_reason !== 'tool_use') {
      const text = response.content
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join('\n')
        .trim();
      return text || FALLBACK_REPLY;
    }

    messages.push({ role: 'assistant', content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') {
        continue;
      }
      try {
        const content = await request.executeTool(block.name, block.input);
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content });
      } catch (error) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: `Tool error: ${error instanceof Error ? error.message : String(error)}`,
          is_error: true,
        });
      }
    }
    messages.push({ role: 'user', content: toolResults });
  }

  return FALLBACK_REPLY;
}
