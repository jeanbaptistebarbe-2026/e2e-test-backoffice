import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';

/** Entrées du rail (boutons icônes, nommés par `aria-label`). */
export type RailEntry =
  | 'Inbox'
  | 'Agenda'
  | 'Annuaire'
  | 'Contrôles'
  | 'Kiosk'
  | 'Administration'
  | 'Paramètres';

export const RAIL_ENTRIES: RailEntry[] = [
  'Inbox',
  'Agenda',
  'Annuaire',
  'Contrôles',
  'Kiosk',
  'Administration',
  'Paramètres',
];

/**
 * Coque de l'application, commune à tous les écrans authentifiés :
 *   - rail de navigation à gauche (`navigation` + boutons icônes nommés par `aria-label`,
 *     sans texte visible ; le dernier bouton est l'avatar, nommé par le nom complet) ;
 *   - panneau secondaire des sous-menus (boutons À TEXTE visible, entrée active en
 *     `aria-current="page"`) ;
 *   - écrans d'erreur (route inconnue, accès refusé) ;
 *   - toasts (région « Notifications alt+T », bibliothèque sonner).
 * Réf. : swapn-qg-source-de-verite.md §6.1.
 */
export class AppShell extends BasePage {
  /** Le rail (la page peut contenir d'autres `navigation`, ex. la pagination). */
  readonly rail: Locator;
  readonly errorScreen: Locator;
  readonly accessDenied: Locator;
  readonly toasts: Locator;

  constructor(page: Page) {
    super(page);
    this.rail = page
      .getByRole('navigation')
      .filter({ has: page.getByRole('button', { name: 'Kiosk', exact: true }) });
    this.errorScreen = page.getByRole('heading', { name: 'Une erreur est survenue' });
    this.accessDenied = page.getByText('Accès refusé', { exact: true });
    this.toasts = page.getByRole('region', { name: /^Notifications/ });
  }

  /** Bouton du rail (`exact` : par défaut Playwright accepte un nom partiel). */
  railButton(name: RailEntry): Locator {
    return this.rail.getByRole('button', { name, exact: true });
  }

  /** Noms des entrées visibles du rail, avatar exclu. */
  async visibleRailEntries(): Promise<string[]> {
    const names = await this.rail
      .getByRole('button')
      .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
    return names.filter((n) => (RAIL_ENTRIES as string[]).includes(n));
  }

  /**
   * Entrée du panneau secondaire, par son texte visible. Les boutons du rail n'ont pas
   * de texte, d'où l'absence de collision avec « Inbox » (rail) / « Inbox » (sous-menu).
   */
  submenuButton(label: string): Locator {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return this.page.locator('button', { hasText: new RegExp(`^\\s*${escaped}\\s*$`) });
  }

  /** Toast contenant le texte donné. */
  toast(text: string | RegExp): Locator {
    return this.toasts.getByText(text);
  }

  /** L'écran courant n'est ni l'écran d'erreur générique ni la carte « Accès refusé ». */
  async expectNoErrorScreen(): Promise<void> {
    await expect(this.errorScreen).toHaveCount(0);
    await expect(this.accessDenied).toHaveCount(0);
  }

  /** Carte « Accès refusé » d'une route non autorisée au rôle (F-GLB-003). */
  async expectAccessDenied(): Promise<void> {
    await expect(this.accessDenied).toBeVisible({ timeout: 15_000 });
    // `.` sur l'apostrophe : droite ou typographique selon la source.
    await expect(
      this.page.getByText(/^Vous n.avez pas les droits nécessaires pour accéder à cette page\.$/),
    ).toBeVisible();
  }

  /** Nom complet de l'utilisateur connecté (nom accessible de l'avatar du rail). */
  async currentUserName(): Promise<string> {
    return (await this.rail.getByRole('button').last().getAttribute('aria-label')) ?? '';
  }

  /** Menu de l'avatar (dernier bouton du rail) → « Déconnexion ». */
  async logout(): Promise<void> {
    await this.rail.getByRole('button').last().click();
    await this.page.getByRole('menuitem', { name: 'Déconnexion' }).click();
  }
}
