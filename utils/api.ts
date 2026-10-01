import fs from 'fs';
import { APIRequestContext, APIResponse, Page, request } from '@playwright/test';

/**
 * Client de l'API QG, réservé à la REMISE À L'ÉTAT et au nettoyage des données de
 * test (statut d'un ticket, brouillons, vues FDE…). Il ne sert JAMAIS à réaliser
 * l'action testée : celle-ci passe toujours par l'UI.
 *
 * Le jeton est lu dans le `localStorage` de l'application (clé `access_token`), soit
 * sur la page vivante (toujours à jour, y compris après un refresh), soit dans un
 * fichier storageState. Il n'est jamais journalisé (cf. ANO-17).
 */

/** URL de l'API QG (défaut : preprod). Surchargeable par la variable `API_URL`. */
export const API_URL = (process.env.API_URL?.trim() || 'https://api.preprod.swapn.tech').replace(/\/+$/, '');
const API_HOST = new URL(API_URL).host;

/** L'URL vise-t-elle l'API QG ? (filtre des requêtes observées par les tests). */
export const isApiUrl = (url: string): boolean => {
  try {
    return new URL(url).host === API_HOST;
  } catch {
    return false;
  }
};

export class QgApi {
  private constructor(private readonly ctx: APIRequestContext) {}

  private static async withToken(token: string): Promise<QgApi> {
    const ctx = await request.newContext({
      baseURL: API_URL,
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });
    return new QgApi(ctx);
  }

  /** Client authentifié avec la session de la page (le rôle du test courant). */
  static async fromPage(page: Page): Promise<QgApi> {
    const token = await page.evaluate(() => localStorage.getItem('access_token'));
    if (!token) throw new Error('Aucun access_token dans le localStorage de la page (session absente ?)');
    return QgApi.withToken(token);
  }

  /** Client authentifié avec un storageState enregistré (ex. session admin depuis un test BPO). */
  static async fromStorageState(path: string): Promise<QgApi> {
    const state = JSON.parse(fs.readFileSync(path, 'utf8')) as {
      origins: { localStorage: { name: string; value: string }[] }[];
    };
    const token = state.origins
      .flatMap((o) => o.localStorage)
      .find((e) => e.name === 'access_token')?.value;
    if (!token) throw new Error(`Aucun access_token dans le storageState ${path}`);
    return QgApi.withToken(token);
  }

  /** Échoue avec un message lisible (méthode + chemin + statut, sans jeton). */
  private async check(res: APIResponse, what: string): Promise<APIResponse> {
    if (!res.ok()) {
      const body = (await res.text().catch(() => '')).slice(0, 300);
      throw new Error(`API ${what} → ${res.status()} ${body}`);
    }
    return res;
  }

  async get<T = unknown>(path: string): Promise<T> {
    const res = await this.check(await this.ctx.get(path), `GET ${path}`);
    return (await res.json()) as T;
  }

  async patch(path: string, data?: unknown): Promise<APIResponse> {
    return this.check(await this.ctx.patch(path, { data }), `PATCH ${path}`);
  }

  async post(path: string, data?: unknown): Promise<APIResponse> {
    return this.check(await this.ctx.post(path, { data }), `POST ${path}`);
  }

  async delete(path: string): Promise<APIResponse> {
    return this.check(await this.ctx.delete(path), `DELETE ${path}`);
  }

  /** Collaborateur connecté (`GET /collaborators/me`) : rôle réel du compte de test. */
  async me(): Promise<{ id: string; role: string; status: string }> {
    return this.get('/collaborators/me');
  }

  // ─── Remises à l'état ──────────────────────────────────────────────────────

  /**
   * Remet un ticket FDE dans un statut donné (défaut « À traiter »).
   * NB : la RÉSERVATION d'un ticket (collaboratorId + reservedUntil, posée à
   * l'ouverture par un BPO) n'est pas libérable par l'API (`collaboratorId: null`
   * refusé en 422) : elle expire seule au bout de 30 min.
   */
  async setTicketStatus(companyId: string, ticketId: string, status = 'PENDING'): Promise<void> {
    await this.patch(`/companies/${companyId}/tickets/${ticketId}/status`, { status });
  }

  /** Archive une conversation pour l'utilisateur courant (la retire d'Envoyés / Ouvert). */
  async archiveThread(threadId: string): Promise<void> {
    await this.post(`/thread-archives/${threadId}`);
  }

  /**
   * Archive toutes les conversations ENVOYÉES non archivées dont l'objet correspond
   * au motif. La synchronisation Gmail remonte des copies (« E2E <ts> », « Re: E2E
   * <ts> ») APRÈS la fin d'un run : chaque run balaie donc aussi celles des runs
   * précédents. Renvoie le nombre de conversations archivées.
   */
  async archiveSentThreads(subject: RegExp, search = 'E2E'): Promise<number> {
    const { threads } = await this.get<{ threads: { id: string; subject?: string; displayTitle?: string; viewerArchived?: boolean }[] }>(
      `/threads?page=1&page_size=100&sort=desc&flow=sent&search=${encodeURIComponent(search)}`,
    );
    const targets = threads.filter((t) => !t.viewerArchived && subject.test(t.subject ?? t.displayTitle ?? ''));
    for (const t of targets) await this.archiveThread(t.id);
    return targets.length;
  }

  async deleteDraft(draftId: string): Promise<void> {
    await this.delete(`/drafts/${draftId}`);
  }

  async dispose(): Promise<void> {
    await this.ctx.dispose();
  }
}
