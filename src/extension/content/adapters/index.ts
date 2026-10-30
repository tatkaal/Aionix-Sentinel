import { chatgptAdapter } from './chatgpt';
import { claudeAdapter } from './claude';
import { geminiAdapter } from './gemini';
import type { PortalAdapter, PortalId } from './types';

export const ADAPTERS: Record<PortalId, PortalAdapter> = {
  claude: claudeAdapter,
  chatgpt: chatgptAdapter,
  gemini: geminiAdapter,
};

export function adapterForHost(hostname: string): PortalAdapter | null {
  return Object.values(ADAPTERS).find((a) => a.hosts.some((h) => hostname === h || hostname.endsWith(`.${h}`))) ?? null;
}

export type { PortalAdapter, PortalId } from './types';
