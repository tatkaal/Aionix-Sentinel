// MiniLM context validator: decides whether a PERSON ↔ SENSITIVE window reads like a record or
// disclosure about a specific individual, or like a general question / public-information request.
// Nearest-anchor comparison (1-NN cosine per class) over hand-written anchor sentences.
import type { Embedder } from '../embed/minilm';
import { cosine } from '../embed/minilm';

const PERSONAL_ANCHORS = [
  'Patient John Smith, MRN 12345678, was diagnosed with type 2 diabetes and prescribed metformin 500 mg twice daily.',
  'Discharge summary for Maria Garcia: admitted with pneumonia and treated with intravenous antibiotics.',
  "Mrs Chen's biopsy confirmed stage II breast cancer; she starts chemotherapy next week.",
  'Our client David Lee takes lithium 300 mg for bipolar disorder and missed his last appointment.',
  'Referral letter for Ahmed Hassan, date of birth 12/03/1965, history of hypertension and chronic kidney disease.',
  'Employee Sarah Johnson disclosed that she is being treated for depression and anxiety.',
  'Lab results for patient Emily Brown show HbA1c of 9.2 percent, indicating poorly controlled diabetes.',
  'Update the chart for Robert Wilson: new diagnosis of atrial fibrillation, started on warfarin 5 mg.',
  'Client Daniel Whitford has an account balance of $1.2 million and an outstanding margin loan of $310,000.',
  'Customer Priya Raman, account 123456789, is three months in arrears on her mortgage.',
  "Jane Doe's portfolio is valued at $4.5 million and her annual income is $350,000.",
  'Statement for Michael Brown: closing balance $82,450.17, last transfer $15,000 to savings.',
  'Our high net worth client Mr Tanaka holds $12 million in equities and a $2 million credit facility.',
  "Wire $75,000 from Laura Martinez's brokerage account to her trust account today.",
];

const GENERAL_ANCHORS = [
  'What are the common symptoms of type 2 diabetes?',
  'How is metformin usually dosed for adults?',
  'Explain how chemotherapy works for breast cancer.',
  'What are the side effects of lithium?',
  "Summarise the latest research on Alzheimer's disease treatments.",
  'Write a blog post about managing anxiety at work.',
  'Draft a policy describing how we protect patient medical records.',
  'What is the difference between a mortgage offset account and a redraw facility?',
  'How do margin loans work and what triggers a margin call?',
  "What is Warren Buffett's net worth and how did he build his wealth?",
  'How should a bank calculate interest on a savings account?',
  'What does a credit score measure and how can I improve it?',
  'Explain the history of the Federal Reserve and interest rate policy.',
  'Give me a study plan for learning pharmacology.',
];

/** Positive margin → personal. Slightly negative default favours recall (compliance F2). */
export const VALIDATOR_MARGIN = -0.02;

export interface ValidationResult {
  personal: boolean;
  score: number;
  personalSim: number;
  generalSim: number;
}

export interface ContextValidator {
  validate(window: string): Promise<ValidationResult>;
}

export async function createContextValidator(embedder: Embedder): Promise<ContextValidator> {
  const personal = await embedder.embed(PERSONAL_ANCHORS);
  const general = await embedder.embed(GENERAL_ANCHORS);
  const nearest = (v: Float32Array, set: Float32Array[]) => set.reduce((m, a) => Math.max(m, cosine(v, a)), -1);
  return {
    async validate(window) {
      const [v] = await embedder.embed([window]);
      const personalSim = nearest(v!, personal);
      const generalSim = nearest(v!, general);
      const score = personalSim - generalSim;
      return { personal: score >= VALIDATOR_MARGIN, score, personalSim, generalSim };
    },
  };
}
