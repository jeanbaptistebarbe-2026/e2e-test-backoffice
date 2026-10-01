# Rapport — Suite de tests E2E du backoffice Neo

> Document de présentation à destination des devs. Décrit l'objectif, la stack, l'infrastructure,
> le mécanisme d'authentification (MFA), la couverture de tests et les conventions du projet.
> Repo : `github.com/jeanbaptistebarbe-2026/e2e-test-backoffice` — backoffice testé : **Neo**, `https://qg.swapn.tech/`.

---

## 1. Objectif

Mettre en place une suite de tests **end-to-end (E2E)** automatisés qui pilote un vrai navigateur sur
le backoffice **Neo** (SPA React/Vite) et vérifie, du point de vue utilisateur, que les parcours clés
fonctionnent, avec deux rôles (**ADMIN** et **BPO**) : authentification, traitement des tickets FDE
(Contrôles), messagerie e-mail et interne (Inbox), affichage sans erreur des pages de tous les menus,
et écrans d'administration (signatures, templates, collaborateurs, intégrations).

Les tests tournent **en local** (dev) et sont intégrés à **SquashTM** (orchestration QA Tiime).

---

## 2. Stack technique

| Élément | Choix | Notes |
|---|---|---|
| Framework E2E | **Playwright** (`@playwright/test` ^1.59) | navigateur réel, auto-wait, traces, rapport HTML |
| Langage | **TypeScript** | transpilé à la volée par Playwright (pas de build) |
| Navigateur | **Chromium** (Desktop Chrome) | un seul navigateur pour l'instant |
| Runtime | **Node.js 20** | |
| Lecture e-mail OTP | **imapflow** (IMAP) + **mailparser** | récupération du code MFA, voir §5 |
| Config secrets | `secrets_e2e.enc.yml` (AES-256-GCM, versionné) ; `secrets_e2e.yml` en clair en local | clé `E2E_SECRETS_KEY` |
| Architecture | **Page Object Model (POM)** | un Page Object par écran/feature |

Aucune dépendance applicative : c'est un projet de test autonome qui attaque le backoffice déployé.

---

## 3. Architecture du projet

```
.
├── tests/
│   ├── fixtures.ts            # auth par rôle en fixture, santé de page, capture + trace d'échec
│   ├── meta.ts                # meta() : ID Squash + description (rapport), tag @ecriture
│   ├── data/routes.ts         # table des pages des menus
│   ├── login.spec.ts          # écrans Auth0 (sans session)
│   ├── auth/                  # session.spec.ts (sans session) · roles.spec.ts (rôles, déconnexion)
│   ├── navigation/pages.spec.ts   # affichage sans erreur de toutes les pages (ADMIN, BPO)
│   ├── inbox/messagerie.spec.ts   # e-mail, commentaires internes, brouillons (ADMIN)
│   ├── controles/tickets.spec.ts  # traitement des tickets FDE (BPO)
│   └── templates · signatures · collaborators · integrations .spec.ts
├── pages/                     # Page Object Model
│   ├── BasePage.ts  AppShell.ts         # navigation, rail, sous-menus, toasts, écrans d'erreur
│   ├── LoginPage.ts                     # login Auth0 (+ MFA e-mail facultatif)
│   ├── InboxPage.ts  ComposerDialog.ts  ConversationPanel.ts  TicketsPage.ts
│   └── AdminListPage.ts (+ Signatures, Templates)  CollaboratorsPage.ts  IntegrationsPage.ts
├── utils/
│   ├── roles.ts  secrets.ts   # identifiants par rôle ; secrets (clair local / chiffré)
│   ├── email-otp.ts           # lecture IMAP : code MFA, mails envoyés par les tests
│   ├── api.ts                 # client API de remise à l'état (jamais pour l'action testée)
│   └── page-health.ts         # erreurs JS / console / 5xx relevées sur la page
├── reporters/slack-reporter.ts
└── playwright.config.ts       # 1 projet Chromium, reporters, timeouts, retries (local)
```

### Authentification gérée par une fixture (`tests/fixtures.ts`)

L'authentification n'est **pas** câblée via des `projects`/`dependencies` Playwright (ignorés par
SquashTM, voir §4) mais **en code**, dans une fixture :

- Les specs authentifiés importent `test` depuis `./fixtures`. L'option `role` (`admin` par défaut,
  `test.use({ role: 'bpo' })`) choisit le compte. `ensureAuthState()` **se connecte une seule fois par
  rôle**, met l'état en cache (`playwright/.auth/<role>.json`, réutilisé 10 min) et **sérialise les
  logins via un verrou fichier** (deux logins simultanés du même compte se voleraient leur code MFA).
- Les specs sans session importent `loggedOutTest` : contexte **vierge**.
- La déconnexion utilise `freshLoggedInContext()` : une session **privée**, car `POST /auth/logout`
  révoque le refresh token et casserait la session partagée des autres tests.

> Conséquence clé : chaque spec est **autonome**, donc **exécutable telle quelle par SquashTM**.

---

## 4. Infrastructure & cibles

- **Frontend testé** : `https://qg.swapn.tech/` (le backoffice Neo).
- **Backend API** : `https://api.preprod.swapn.tech` (environnement de **préprod**, surchargeable par
  `API_URL`) — c'est là que partent les écritures de l'UI, et les appels de remise à l'état des tests.
- **Auth** : **Auth0 Tiime** (`auth0.tiime.fr`), le même IdP que les autres produits Tiime.
- **Exécution locale** : `npm test` (voir §8).
- **Exécution CI / QA** : **SquashTM Tiime** (orchestrateur « Squash AUTOM », tags `linux, playwright`).
  Le runner **clone le repo à chaque run** et exécute Playwright.

### ⚠️ Particularité Squash importante pour les devs

L'orchestrateur SquashTM exécute Playwright avec **sa propre configuration générée** et **ne charge PAS
notre `playwright.config.ts`**. Conséquence : `use.baseURL`, `projects`, `reporter`, `dependencies`, etc.
ne s'appliquent pas sur le runner.

**Règle d'or du repo** : tout ce qui doit marcher sous Squash est résolu **dans le code** via
`process.env` + valeurs par défaut, ou via des **fixtures**, jamais via `playwright.config.ts`.
Exemples : `BasePage` reconstruit une URL absolue depuis `BASE_URL` ; le screenshot d'échec et
**l'authentification** sont des **fixtures** (cf. §3) et non des `projects`/`dependencies`/`use.screenshot`.
C'est ce qui permet d'exécuter **toute la suite** sur le runner (réf. du test auto = `tests/`). Les
réglages de stabilité (`workers`, `retries`, `expect.timeout`) sont, eux, purement **locaux**.

---

## 5. Authentification & mécanisme du code OTP (le cœur du sujet)

Le compte « admin » (`jean.baptiste.barbe@swapn.fr`) est protégé par une **MFA** ; le compte BPO
(alias `+demoswapn`) n'en a pas, et `LoginPage` gère les deux cas. Voici le parcours réel :

1. Toute route protégée sans session passe par **`/auth`**, qui redirige **automatiquement** vers Auth0.
2. Redirection vers **Auth0 Tiime** → saisie identifiant → mot de passe.
3. Auth0 présente un **challenge MFA**. Le compte a **deux facteurs** : **SMS** (par défaut) et **E-mail**.

### Solution retenue : MFA par e-mail + lecture IMAP

Plutôt que le SMS (impossible à lire de façon fiable en CI), le test **bascule sur le facteur e-mail** :

1. Après le mot de passe, on clique **« Essayer une autre méthode »** → **« E-mail »**
   (`/u/mfa-email-challenge`).
2. Auth0 envoie un code à 6 chiffres par e-mail à l'adresse du compte. Expéditeur :
   **`no-reply@apps.tiime.fr`**, sujet « Vérification de votre identité ».
3. Le test lit cette boîte en **IMAP** (`utils/email-otp.ts` : `imapflow` pour la connexion,
   `mailparser` pour décoder le corps), filtre le dernier mail non lu de cet expéditeur, en extrait le
   code (regex), le saisit, et la connexion aboutit.

```
SMS (ignoré)
                                   ┌─────────────────────────────┐
Auth0 ──(facteur e-mail)──> e-mail │ no-reply@apps.tiime.fr       │
                                   │ "Voici votre code … 123456"  │
                                   └──────────────┬──────────────┘
                                                  │ IMAP (imapflow + mailparser)
                                                  ▼
                                   utils/email-otp.ts → code → saisie OTP → session OK
```

**Pourquoi c'est robuste :** aucune dépendance à un téléphone ni à une quelconque machine. Le code part
par e-mail (infra Auth0) et est lu par IMAP. Variables nécessaires : `GMAIL_USER` (boîte lue),
`GMAIL_APP_PASSWORD` (**seul secret strictement requis**), `OTP_SENDER` (défaut `no-reply@apps.tiime.fr`).

> **Historique (pour le contexte)** : une 1ʳᵉ approche relayait le SMS via un Raccourci iOS → e-mail, mais
> l'envoi restait coincé dans la boîte d'envoi de Mail iOS (ne partait qu'à l'ouverture de l'app) → non
> fiable en CI. Une variante webhook (Cloudflare Worker) a été prototypée puis abandonnée car le SMS
> gardait le téléphone dans la boucle. La **MFA e-mail native d'Auth0** rend tout cela inutile.

> **Limite connue** : la livraison de l'e-mail OTP par Auth0 a parfois >120 s de latence → la connexion
> (dans la fixture d'auth) peut échouer puis être rattrapée par le retry. Piste d'amélioration : passer la
> MFA du compte de test en **TOTP** (code calculé hors-ligne avec un secret, zéro e-mail) — nécessite que
> les admins Auth0 Tiime activent le facteur authenticator.

---

## 6. Couverture de tests (77 tests)

| Domaine | Spec | Ce qui est vérifié | Rôle |
|---|---|---|---|
| **Login Auth0** | `login.spec.ts` (7) | validations identifiant / mot de passe, arrivée au challenge MFA | sans session |
| **Session** | `auth/session.spec.ts` (5) | redirection vers Auth0 sans session, callback au `state` falsifié, route inconnue | sans session |
| **Rôles** | `auth/roles.spec.ts` (5) | atterrissage selon le rôle, « Accès refusé » hors périmètre, déconnexion | ADMIN, BPO |
| **Pages des menus** | `navigation/pages.spec.ts` (36) | chaque page s'affiche sans écran d'erreur, ni erreur JS, ni 5xx ; fiches société / contact ; page Kiosk ; clics rail et sous-menus | ADMIN, BPO |
| **Messagerie** | `inbox/messagerie.spec.ts` (9) | vues, recherche, filtres, formulaire ; **envoi réel** vérifié en IMAP, commentaire interne + mention, réponse, brouillon | ADMIN |
| **Tickets FDE** | `controles/tickets.spec.ts` (9) | Fil de l'eau, filtres, réservation à l'ouverture, changement de statut, résolu, ignoré avec motif, discussion interne, vues, consultation | BPO |
| **Administration** | `signatures`, `templates`, `collaborators`, `integrations` (6) | listes ; **cycles de vie complets** création → édition → suppression | ADMIN |

Chaque test porte un identifiant Squash (`TC-…`) et une description, visibles dans le rapport HTML.
Les 12 tests qui modifient des données portent le tag `@ecriture` et **nettoient** ce qu'ils créent
(tickets remis « À traiter », conversations archivées, brouillons / vues / templates / signatures
supprimés).

---

## 7. Patterns & conventions (à connaître pour contribuer)

- **Page Object Model** : chaque écran a une classe dans `pages/` exposant des locators et des actions
  métier. Les specs ne manipulent pas de sélecteurs CSS directement.
- **`AdminListPage`** : classe abstraite qui factorise le pattern « liste d'administration » (recherche,
  ligne, menu « … » Éditer/Dupliquer/Supprimer, dialog de confirmation, redirection au submit).
  `SignaturesPage` et `TemplatesPage` en héritent → ajouter une nouvelle feature CRUD admin = quelques
  lignes (champs du formulaire + libellé du bouton de validation).
- **Capture + trace en cas d'échec** : `tests/fixtures.ts` étend la base de test ; tout spec importe
  `{ test, expect }` depuis `./fixtures`. Sur échec, une capture et une trace sont écrites dans le
  dossier du test et attachées au rapport. Implémenté en code (pas via config) pour Squash.
- **Santé de page** (`utils/page-health.ts`) : chaque test relève erreurs JS, `console.error` et
  réponses 5xx de l'API ; `health.expectClean()` les rend bloquantes (spec des pages).
- **Tags et description** : au plus 3 tags par test — rôle (`@role-admin` / `@role-bpo`), module,
  et `@ecriture`. ID Squash et description via `meta()` (`tests/meta.ts`).
- **Remise à l'état par l'API** (`utils/api.ts`) : uniquement pour nettoyer, jamais pour l'action testée.
- **Assertions web-first** : toujours `await expect(locator).toBeVisible()` (auto-retry), **jamais**
  `expect(await locator.count()).toBeGreaterThan(0)` (one-shot, source de flakiness).
- **Pas de `networkidle`** : interdit dans ce repo. La SPA poll en arrière-plan → l'« idle » n'arrive
  jamais → timeouts. Les assertions web-first suffisent à attendre les éléments.
- **Anti-race au submit** : après un POST/PATCH de création/édition, on **attend la redirection** vers la
  liste (`waitForURL`) avant toute navigation, sinon un `goto` immédiat interrompt la requête en vol.
- **Données de test uniques** : noms/emails horodatés (`… ${Date.now()}`) pour éviter les collisions.

---

## 8. Exécution & rapport

```bash
npm install                 # dépendances
npx playwright install chromium   # navigateur (étape souvent oubliée)
cp .env.example .env        # ou renseigner secrets_e2e.yml (prioritaire en local)

npm test                    # toute la suite (headless)
npm run test:headed         # navigateur visible (debug)
npm run test:readonly       # sans modification de données (--grep-invert @ecriture)
npm run test:write          # uniquement les tests @ecriture
npm run test:admin          # ou test:bpo, test:auth
npm run report              # ouvre le rapport HTML du dernier run
```

Le **rapport HTML** (reporters `list` + `html`) est généré à chaque run. En cas d'échec : capture
d'écran + **trace** Playwright (rejouable pas-à-pas sur trace.playwright.dev) attachées au test.

### Variables d'environnement

| Variable | Requis ? | Rôle |
|---|---|---|
| `AUTH_EMAIL` / `AUTH_PASSWORD` | ✅ | compte « admin » Auth0 |
| `AUTH_EMAIL_BPO` / `AUTH_PASSWORD_BPO` | tests BPO | compte BPO (absent → tests BPO sautés) |
| `FDE_TEST_COMPANY` | défaut `Demo Setex 1` | société des tickets FDE de test |
| `API_URL` | défaut `api.preprod.swapn.tech` | API QG (remise à l'état) |
| `E2E_SECRETS_KEY` | Squash / CI | clé de `secrets_e2e.enc.yml` ; active la notification Slack |
| `GMAIL_APP_PASSWORD` | ✅ (secret) | mot de passe d'application IMAP de la boîte du compte |
| `BASE_URL` | défaut `qg.swapn.tech` | URL du backoffice |
| `GMAIL_USER` | défaut `jean.baptiste.barbe@swapn.fr` | boîte IMAP lue |
| `OTP_SENDER` | défaut `no-reply@apps.tiime.fr` | expéditeur du mail OTP |

---

## 9. Robustesse / gestion de la flakiness

La cible est une **préprod distante partagée** : latence variable. Mesures (locales) :

- `workers: 3` — borne le parallélisme pour ne pas saturer la préprod.
- `expect.timeout: 10 s` — marge pour les données de liste chargées en async.
- `retries: 1` (local) / `2` (CI) — absorbe les timeouts transitoires (ex. e-mail OTP lent). Un test qui
  échoue **2 fois de suite** reste rouge → ça ne masque pas un vrai bug.
- Trace + screenshot d'échec (en code) → diagnostic facile dans le rapport.
- Les specs à données partagées (tickets FDE) tournent en séquence dans un seul worker. Ne pas lancer
  `--repeat-each` avec plusieurs workers sur ce spec (copies parallèles sur les mêmes tickets).

---

## 10. Limites connues & pistes

- **OTP e-mail parfois lent** (>120 s) → login occasionnellement « flaky » (rattrapé par retry).
  Cible idéale : **TOTP** (à activer côté Auth0 Tiime) pour supprimer la dépendance e-mail.
- **Invitation collaborateur non couverte** : le flux d'invitation n'est pas testé. Il n'est pas
  self-cleaning (aucune révocation dans l'UI) → chaque run laisserait une invitation résiduelle dans la
  liste. À reprendre si une révocation (UI ou API) devient disponible.
- **Réservation des tickets** : ouvrir un ticket en BPO le réserve 30 min ; l'API ne permet pas de la
  libérer (`collaboratorId: null` refusé). Les tickets ouverts restent attribués au compte BPO de test.
- **Anomalies connues suivies par les tests** : Coûts LLM en 502 (ANO-04, test en « échec attendu »),
  route inconnue sans écran 404 (ANO-01). La preprod a des 502 et lenteurs ponctuels, absorbés par
  les retries.
- **Un seul navigateur** (Chromium) : on pourrait étendre à Firefox/WebKit si besoin.

---

## 11. En une phrase (pour le pitch)

> *Une suite Playwright/TypeScript en Page Object Model qui pilote le backoffice Neo de bout en bout, gère
> la MFA Auth0 automatiquement (bascule sur le facteur e-mail + lecture IMAP), couvre les parcours clés
> en ADMIN et en BPO (auth, tickets FDE, messagerie, pages des menus, administration) avec des tests
> qui nettoient leurs données,
> et s'intègre à SquashTM — le tout robuste face à une préprod distante (retries, traces, screenshots
> d'échec).*
