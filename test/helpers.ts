import type Anthropic from '@anthropic-ai/sdk';
import type { LlmClient } from '../src/assistant.js';
import type { SenderCredentials, WhatsAppSender } from '../src/whatsapp.js';

export function response(
  stopReason: 'end_turn' | 'tool_use',
  content: Anthropic.ContentBlock[],
): Anthropic.Message {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'test-model',
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  } as unknown as Anthropic.Message;
}

export function textBlock(text: string): Anthropic.ContentBlock {
  return { type: 'text', text, citations: null } as unknown as Anthropic.ContentBlock;
}

export function toolUseBlock(id: string, name: string, input: unknown): Anthropic.ContentBlock {
  return { type: 'tool_use', id, name, input } as unknown as Anthropic.ContentBlock;
}

// Returns scripted responses in order and records every request sent to it.
export function scriptedLlm(script: Anthropic.Message[]) {
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const llm = {
    messages: {
      create: async (params: Anthropic.MessageCreateParamsNonStreaming) => {
        requests.push(structuredClone(params));
        const next = script[requests.length - 1];
        if (!next) {
          throw new Error('unexpected LLM call');
        }
        return next;
      },
    },
  };
  return { llm: llm as unknown as LlmClient, requests };
}

export interface SentMessage {
  credentials: SenderCredentials;
  to: string;
  body: string;
}

export function recordingSender() {
  const sent: SentMessage[] = [];
  const sender: WhatsAppSender = {
    async sendText(credentials, to, body) {
      sent.push({ credentials, to, body });
    },
  };
  return { sender, sent };
}
