// Compiled by `npm run typecheck`, never run: proves the published types say what the SDK does.
import Compliwa, {
  verifyWebhook,
  CompliwaError,
  type Verification,
  type WebhookEvent,
} from '../types/index.js';

async function check(): Promise<void> {
  const compliwa = new Compliwa('cw_test_x', { timeoutMs: 10_000 });
  const env: 'test' | 'live' = compliwa.environment;

  const page = await compliwa.verifications.list({ limit: 10 });
  const first: Verification | undefined = page.data[0];
  const requestId: string | null = page.lastResponse.requestId;

  for await (const verification of compliwa.verifications.list()) {
    const id: string = verification.id;
    void id;
  }

  const transfer = await compliwa.travelRule.transfers.retrieve('trt_1');
  const status: string = transfer.status;

  // @ts-expect-error — an id is required
  compliwa.cases.retrieve();
  // @ts-expect-error — no such resource
  compliwa.checks.create({});

  try {
    await compliwa.apiKey.retrieve({ signal: AbortSignal.timeout(1000) });
  } catch (error) {
    if (error instanceof CompliwaError) {
      const code: string | null = error.code;
      void code;
    }
  }

  const event: WebhookEvent = verifyWebhook('{}', 't=1,v1=00', 'whsec_x');
  void [env, first, requestId, status, event];
}
void check;
