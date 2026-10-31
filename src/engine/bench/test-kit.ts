// Shape of assets/engine/test-kit.json (built by scripts/build-test-kit.ts, shown in the options page).
import type { ProtectedType } from '../tier3/custom-vault';
import type { CategoryId } from '../types';

export interface KitPrompt {
  title: string;
  text: string;
  expect: 'block' | 'allow';
  /** Which tier / path is expected to decide, and why. */
  note: string;
  /** Present when the prompt needs protected data first (bundled demo vault or a sample). */
  needs?: 'demo-vault' | `sample:${string}`;
  /** Text to paste as a large attachment (≥ 1,200 characters becomes a pasted-content chip). */
  paste?: string;
}

export interface TestKit {
  version: 1;
  categories: { id: CategoryId; title: string; how: string; prompts: KitPrompt[] }[];
  edgeCases: {
    id: string;
    title: string;
    expect: 'block' | 'allow';
    categories: CategoryId[];
    text: string;
    steps?: { text: string; expect: 'block' | 'allow'; paste?: string }[];
    paste?: string;
  }[];
  samples: { id: string; type: ProtectedType; title: string; fileName: string; text: string }[];
}
