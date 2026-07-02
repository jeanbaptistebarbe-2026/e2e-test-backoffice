import type {
  Reporter,
  FullConfig,
  Suite,
  TestCase,
  TestResult,
  FullResult,
} from '@playwright/test/reporter';
import fs from 'fs';
import { WebClient } from '@slack/web-api';
import { requireSecret } from '../utils/secrets';

/**
 * Reporter Slack : à la fin du run, poste un message de synthèse formaté dans un
 * canal Slack, puis, pour chaque test en échec, ajoute EN THREAD le détail de
 * l'erreur + la capture d'écran (inline) + la trace (`trace.zip`, ouvrable sur
 * https://trace.playwright.dev).
 *
 * Secrets requis (déchiffrés via utils/secrets.ts avec la clé E2E) :
 *   - SLACK_BOT_TOKEN  (xoxb-…, scopes chat:write + files:write)
 *   - SLACK_CHANNEL_ID (Cxxxx)
 *
 * Si les secrets ne sont pas résolubles (aucune clé fournie, ex. `npm test` local
 * nu), le reporter se désactive silencieusement — il ne fait donc rien ni ne casse
 * les runs qui ne veulent pas notifier.
 */

type FailInfo = {
  title: string;
  error: string;
  screenshot?: string;
  trace?: string;
};

const stripAnsi = (s: string): string =>
  // eslint-disable-next-line no-control-regex
  s.replace(/\[[0-9;]*m/g, '');

export default class SlackReporter implements Reporter {
  private suite!: Suite;
  private startTime = 0;
  private enabled = false;
  private token = '';
  private channel = '';

  onBegin(_config: FullConfig, suite: Suite): void {
    this.suite = suite;
    this.startTime = Date.now();
    try {
      this.token = requireSecret('SLACK_BOT_TOKEN');
      this.channel = requireSecret('SLACK_CHANNEL_ID');
      this.enabled = true;
    } catch {
      this.enabled = false; // pas de clé/secrets → notification désactivée
    }
  }

  // Requis par l'interface, mais on agrège tout dans onEnd via le suite.
  onTestEnd(_test: TestCase, _result: TestResult): void {}

  async onEnd(result: FullResult): Promise<void> {
    if (!this.enabled) {
      console.log('[slack-reporter] désactivé (secrets Slack non résolus) — aucun message envoyé.');
      return;
    }

    let passed = 0;
    let failed = 0;
    let skipped = 0;
    let flaky = 0;
    const failures: FailInfo[] = [];

    for (const test of this.suite.allTests()) {
      const outcome = test.outcome();
      if (outcome === 'skipped') skipped++;
      else if (outcome === 'expected') passed++;
      else if (outcome === 'flaky') {
        flaky++;
        passed++;
      } else if (outcome === 'unexpected') {
        failed++;
        const last = test.results[test.results.length - 1];
        const err = last?.error?.message ? stripAnsi(last.error.message).trim() : 'Échec';
        const findPath = (name: string): string | undefined =>
          last?.attachments.find((a) => a.name === name && a.path)?.path;
        failures.push({
          title: test.titlePath().slice(1).filter(Boolean).join(' › '),
          error: err.length > 600 ? err.slice(0, 600) + '…' : err,
          screenshot: findPath('screenshot-échec'),
          trace: findPath('trace'),
        });
      }
    }

    const durationSec = Math.round((Date.now() - this.startTime) / 1000);
    const ok = result.status === 'passed' || failed === 0;
    const emoji = ok ? ':large_green_circle:' : ':red_circle:';
    const headline = `${emoji} E2E Backoffice — ${passed} passés · ${failed} échoués · ${skipped} skippés${flaky ? ` · ${flaky} flaky` : ''} · ${durationSec}s`;

    const client = new WebClient(this.token);
    try {
      const summary = await client.chat.postMessage({
        channel: this.channel,
        text: headline,
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: ok ? '✅ Tests E2E — OK' : '❌ Tests E2E — échecs', emoji: true } },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Passés:*\n${passed}` },
              { type: 'mrkdwn', text: `*Échoués:*\n${failed}` },
              { type: 'mrkdwn', text: `*Skippés:*\n${skipped}` },
              { type: 'mrkdwn', text: `*Durée:*\n${durationSec}s` },
            ],
          },
          ...(failures.length
            ? [
                {
                  type: 'section',
                  text: {
                    type: 'mrkdwn',
                    text: '*Tests en échec:*\n' + failures.map((f) => `• ${f.title}`).join('\n'),
                  },
                },
              ]
            : []),
        ],
      });

      const thread_ts = summary.ts as string | undefined;

      for (const f of failures) {
        await client.chat.postMessage({
          channel: this.channel,
          thread_ts,
          text: `*${f.title}*\n\`\`\`${f.error}\`\`\``,
        });
        if (f.screenshot && fs.existsSync(f.screenshot)) {
          await client.files.uploadV2({
            channel_id: this.channel,
            thread_ts,
            file: fs.readFileSync(f.screenshot),
            filename: 'screenshot.png',
            title: `${f.title} — capture`,
          });
        }
        if (f.trace && fs.existsSync(f.trace)) {
          await client.files.uploadV2({
            channel_id: this.channel,
            thread_ts,
            file: fs.readFileSync(f.trace),
            filename: 'trace.zip',
            title: `${f.title} — trace (ouvrir sur trace.playwright.dev)`,
          });
        }
      }
      console.log(`[slack-reporter] message envoyé (${failed} échec(s)).`);
    } catch (e) {
      // On ne fait jamais échouer le run à cause de Slack.
      console.error('[slack-reporter] envoi Slack échoué :', (e as Error).message);
    }
  }
}
