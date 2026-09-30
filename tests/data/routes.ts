import { Page, Locator } from '@playwright/test';

/**
 * Table des pages des menus, pour le spec « affichage sans erreur »
 * (tests/navigation/pages.spec.ts). Une entrée = un test.
 * Repères et routes : swapn-qg-source-de-verite.md §4 (NAV-xx), vérifiés sur la
 * preprod le 30/09/2026.
 *
 * Répartition des rôles : l'ADMIN couvre tout SAUF `/tickets` (couvert en BPO).
 */
export interface PageRoute {
  /** Identifiant Squash (suffixe de `@TC-NAV-…`). */
  id: string;
  /** Menu d'origine, pour le titre du test. */
  menu: 'Inbox' | 'Agenda' | 'Annuaire' | 'Contrôles' | 'Kiosk' | 'Administration' | 'Paramètres';
  path: string;
  /** Élément qui prouve que la page est affichée (rôle ARIA + nom exact). */
  landmark: (page: Page) => Locator;
  /** Route réservée au SUPER_ADMIN (refusée à un ADMIN, cf. §3.3). */
  superAdminOnly?: boolean;
  /**
   * Anomalie connue : le test est marqué `test.fail()` (il repassera au rouge une
   * fois l'anomalie corrigée, signal pour le mettre à jour).
   */
  knownIssue?: string;
  /** Fait aussi partie du smoke test (`npm run test:smoke`). */
  smoke?: boolean;
}

const h1 = (name: string | RegExp) => (page: Page) => page.getByRole('heading', { level: 1, name });
const inboxHeading = h1(/^Ouvert \(\d+\)$/);

export const ADMIN_PAGES: PageRoute[] = [
  // --- Inbox (NAV-01) ---
  { id: 'INB-01', menu: 'Inbox', path: '/', landmark: inboxHeading, smoke: true },
  { id: 'INB-02', menu: 'Inbox', path: '/?view=assigned', landmark: inboxHeading },
  { id: 'INB-03', menu: 'Inbox', path: '/?view=followed', landmark: inboxHeading },
  { id: 'INB-04', menu: 'Inbox', path: '/?view=drafts', landmark: inboxHeading },
  { id: 'INB-05', menu: 'Inbox', path: '/?view=sent', landmark: inboxHeading },

  // --- Agenda (NAV-04) : chrome du calendrier, indépendant des données Google ---
  {
    id: 'AGD-01',
    smoke: true,
    menu: 'Agenda',
    path: '/calendar',
    landmark: (page) => page.getByRole('tab', { name: 'Semaine', exact: true }),
  },

  // --- Annuaire (NAV-05) ---
  {
    id: 'ANN-01',
    smoke: true,
    menu: 'Annuaire',
    path: '/annuaire',
    landmark: (page) => page.getByRole('columnheader', { name: 'Statut dossier' }),
  },

  // --- Kiosk (NAV-14, NAV-17) ---
  { id: 'KIO-01', menu: 'Kiosk', path: '/knowledge-bases', landmark: (page) => page.getByRole('heading', { name: 'Documentation' }), smoke: true },
  { id: 'KIO-02', menu: 'Kiosk', path: '/knowledge-bases/notes-clients', landmark: h1('Notes clients') },

  // --- Administration › Général ---
  { id: 'ADM-01', menu: 'Administration', path: '/administration/templates', landmark: h1('Templates') },
  { id: 'ADM-02', menu: 'Administration', path: '/administration/signatures', landmark: h1('Signature de mail') },
  { id: 'ADM-03', menu: 'Administration', path: '/administration/tribus-et-squads', landmark: h1('Tribus et squads') },
  { id: 'ADM-04', menu: 'Administration', path: '/administration/tribus-et-squads?tab=squad', landmark: h1('Tribus et squads') },
  { id: 'ADM-05', menu: 'Administration', path: '/collaborators', landmark: h1('Collaborateurs') },
  // « KPIs tickets » : écran d'administration (inaccessible au BPO), donc côté ADMIN.
  { id: 'ADM-06', menu: 'Administration', path: '/tickets/sla-kpi', landmark: h1('KPIs tickets') },
  { id: 'ADM-07', menu: 'Administration', path: '/administration/inbox', landmark: h1('Inbox') },
  { id: 'ADM-08', menu: 'Administration', path: '/administration/channels', landmark: h1('Canaux') },
  { id: 'ADM-09', menu: 'Administration', path: '/administration/channels/google', landmark: h1('Canaux') },
  { id: 'ADM-10', menu: 'Administration', path: '/administration/domaines-internes', landmark: h1('Domaines internes'), superAdminOnly: true },
  { id: 'ADM-11', menu: 'Administration', path: '/administration/regles-de-routage', landmark: h1('Règles de routage'), superAdminOnly: true },

  // --- Administration › AI Studio ---
  { id: 'AIS-01', menu: 'Administration', path: '/agents', landmark: h1('Agents') },
  { id: 'AIS-02', menu: 'Administration', path: '/skills', landmark: h1('Skills') },
  { id: 'AIS-03', menu: 'Administration', path: '/models', landmark: h1('Models') },
  {
    id: 'AIS-04',
    menu: 'Administration',
    path: '/llm-costs',
    landmark: h1('Coûts LLM'),
    knownIssue: 'ANO-04 : GET /llm-costs/overview répond 502',
  },
  { id: 'AIS-05', menu: 'Administration', path: '/agent-testing', landmark: h1('Agent Testing Lab') },

  // --- Paramètres ---
  { id: 'PAR-01', menu: 'Paramètres', path: '/administration/integrations', landmark: h1('Intégrations') },
  { id: 'PAR-02', menu: 'Paramètres', path: '/administration/mes-signatures', landmark: h1('Mes signatures') },
];

/** Pages du BPO : uniquement Contrôles et Kiosk (§3.2). */
export const BPO_PAGES: PageRoute[] = [
  {
    id: 'CTL-00',
    menu: 'Contrôles',
    path: '/tickets',
    landmark: (page) => page.getByText(/^Fil de l.eau$/),
  },
  { id: 'KIO-B1', menu: 'Kiosk', path: '/knowledge-bases', landmark: (page) => page.getByRole('heading', { name: 'Documentation' }) },
];

/**
 * Destination d'un clic sur chaque entrée de menu (RG-GLB-002 : une entrée à
 * sous-menu ouvre sa première sous-entrée autorisée).
 */
export const ADMIN_RAIL_TARGETS: { entry: 'Inbox' | 'Agenda' | 'Annuaire' | 'Kiosk' | 'Administration' | 'Paramètres'; path: RegExp }[] = [
  { entry: 'Agenda', path: /^\/calendar$/ },
  { entry: 'Annuaire', path: /^\/annuaire$/ },
  { entry: 'Kiosk', path: /^\/knowledge-bases$/ },
  { entry: 'Administration', path: /^\/administration\/templates$/ },
  { entry: 'Paramètres', path: /^\/administration\/integrations$/ },
  { entry: 'Inbox', path: /^\/(inbox)?$/ },
];

/** Sous-menu Administration : libellé → chemin attendu. */
export const ADMIN_SUBMENU: { label: string; path: RegExp; superAdminOnly?: boolean }[] = [
  { label: 'Templates', path: /^\/administration\/templates$/ },
  { label: 'Signatures', path: /^\/administration\/signatures$/ },
  { label: 'Tribus et squads', path: /^\/administration\/tribus-et-squads$/ },
  { label: 'Collaborateurs', path: /^\/collaborators$/ },
  { label: 'KPIs tickets', path: /^\/tickets\/sla-kpi$/ },
  { label: 'Inbox', path: /^\/administration\/inbox$/ },
  { label: 'Canaux', path: /^\/administration\/channels$/ },
  { label: 'Domaines internes', path: /^\/administration\/domaines-internes$/, superAdminOnly: true },
  { label: 'Règles de routage', path: /^\/administration\/regles-de-routage$/, superAdminOnly: true },
  { label: 'Agents', path: /^\/agents$/ },
  { label: 'Skills', path: /^\/skills$/ },
  { label: 'Modèles', path: /^\/models$/ },
  { label: 'Coûts LLM', path: /^\/llm-costs$/ },
  { label: 'Testing lab', path: /^\/agent-testing$/ },
];
