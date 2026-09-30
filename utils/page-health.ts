import { Page, TestInfo, expect } from '@playwright/test';

/**
 * Collecteur des signaux d'erreur d'une page, pour vérifier qu'un écran
 * « s'affiche sans erreur » au-delà de ce qui est visible :
 *   - exceptions JS non rattrapées (`pageerror`) ;
 *   - `console.error` de l'application ;
 *   - réponses de l'API QG en erreur serveur (>= 500).
 *
 * Branché automatiquement sur chaque test (fixture `health` de tests/fixtures.ts) :
 * les problèmes sont toujours joints au rapport, mais ne font échouer le test que
 * s'il appelle `health.expectClean()` — les specs existants ne changent pas de verdict.
 */

export interface HealthIssue {
  kind: 'pageerror' | 'console' | 'http';
  message: string;
  url?: string;
}

/** Hôte de l'API QG (seules ses réponses sont surveillées ; S3, Google… sont ignorés). */
const API_HOST = /api\.preprod\.swapn\.tech/;

/**
 * Bruit connu, jamais signalé :
 *   - « Failed to load resource » : doublon console des réponses HTTP (déjà suivies) ;
 *   - avertissements Radix sur les boîtes de dialogue sans description (ANO-16).
 */
const IGNORED_CONSOLE: RegExp[] = [
  /Failed to load resource/i,
  /Missing `Description` or `aria-describedby/i,
];

export class PageHealth {
  private readonly issues: HealthIssue[] = [];
  /** Motifs tolérés en plus du bruit connu, ajoutés par un test (`allow`). */
  private readonly allowed: RegExp[] = [];

  constructor(page: Page) {
    page.on('pageerror', (err) => this.push({ kind: 'pageerror', message: err.message }));
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (IGNORED_CONSOLE.some((re) => re.test(text))) return;
      this.push({ kind: 'console', message: text, url: msg.location().url });
    });
    page.on('response', (res) => {
      if (res.status() < 500 || !API_HOST.test(res.url())) return;
      // Chemin seul : jamais de query string (jetons WebSocket, cf. ANO-17).
      const { pathname } = new URL(res.url());
      this.push({
        kind: 'http',
        message: `${res.request().method()} ${pathname} → ${res.status()}`,
        url: pathname,
      });
    });
  }

  private push(issue: HealthIssue): void {
    this.issues.push(issue);
  }

  /** Tolère un problème connu pour ce test (ex. `/\/llm-costs\/overview → 502/`). */
  allow(pattern: RegExp): void {
    this.allowed.push(pattern);
  }

  /** Problèmes relevés, hors motifs tolérés. */
  get reported(): HealthIssue[] {
    return this.issues.filter((i) => !this.allowed.some((re) => re.test(i.message)));
  }

  /** Oublie les problèmes relevés jusqu'ici (ex. après une navigation préparatoire). */
  reset(): void {
    this.issues.length = 0;
  }

  /** Échoue si la page a levé une erreur JS, loggé une erreur ou reçu un 5xx de l'API. */
  expectClean(): void {
    const lines = this.reported.map((i) => `[${i.kind}] ${i.message}`);
    expect(lines, 'erreurs relevées sur la page').toEqual([]);
  }

  /** Joint les problèmes relevés au rapport (appelé en fin de test par la fixture). */
  async attachTo(testInfo: TestInfo): Promise<void> {
    if (this.issues.length === 0) return;
    await testInfo.attach('santé-de-page', {
      body: JSON.stringify(this.issues, null, 2),
      contentType: 'application/json',
    });
  }
}
