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

const API_URL = (process.env.API_URL?.trim() || 'https://api.preprod.swapn.tech').replace(/\/+$/, '');

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

  /** Remet un ticket FDE dans un statut donné (défaut « À traiter »). */
  async setTicketStatus(companyId: string, ticketId: string, status = 'PENDING'): Promise<void> {
    await this.patch(`/companies/${companyId}/tickets/${ticketId}/status`, { status });
  }

  /**
   * Retire l'intervenant d'un ticket (libère la réservation d'un BPO).
   * Forme du corps à valider au premier passage (Q-006) : `collaboratorId: null`.
   */
  async unassignTicket(companyId: string, ticketId: string): Promise<void> {
    await this.post(`/companies/${companyId}/tickets/${ticketId}/assign`, { collaboratorId: null });
  }

  async deleteDraft(draftId: string): Promise<void> {
    await this.delete(`/drafts/${draftId}`);
  }

  async deleteFdeView(viewId: string): Promise<void> {
    await this.delete(`/fde-views/${viewId}`);
  }

  async dispose(): Promise<void> {
    await this.ctx.dispose();
  }
}
