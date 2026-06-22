# Rapport — Suite de tests E2E du backoffice Neo

> Document de présentation à destination des devs. Décrit l'objectif, la stack, l'infrastructure,
> le mécanisme d'authentification (MFA), la couverture de tests et les conventions du projet.
> Repo : `github.com/jeanbaptistebarbe-2026/e2e-test-backoffice` — backoffice testé : **Neo**, `https://qg.swapn.tech/`.

---

## 1. Objectif

Mettre en place une suite de tests **end-to-end (E2E)** automatisés qui pilote un vrai navigateur sur
le backoffice **Neo** (SPA React/Vite) et vérifie, du point de vue utilisateur, que les parcours clés
fonctionnent : authentification, et les features métier (signatures, templates, collaborateurs,
intégrations, calendrier).

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
| Config secrets | **dotenv** (`.env`, non versionné) | |
| Architecture | **Page Object Model (POM)** | un Page Object par écran/feature |

Aucune dépendance applicative : c'est un projet de test autonome qui attaque le backoffice déployé.

---

## 3. Architecture du projet

```
.
├── tests/                     # Les specs (*.spec.ts) + fixtures
│   ├── fixtures.ts            # Base partagée : auth en fixture + screenshot d'échec
│   ├── login.spec.ts          # Flux de login Auth0 (sans auth)
│   ├── signatures.spec.ts     # CRUD signatures
│   ├── templates.spec.ts      # CRUD templates
│   ├── collaborators.spec.ts  # Liste + invitation
│   ├── integrations.spec.ts   # Page intégrations
│   ├── calendar.spec.ts       # Calendrier (conditionné au SSO Google)
│   └── smoke.spec.ts          # Smoke test authentifié
├── pages/                     # Page Object Model
│   ├── BasePage.ts            # Base : navigation, résolution d'URL
│   ├── AdminListPage.ts       # Base réutilisable des listes CRUD admin
│   ├── LoginPage.ts           # Login Auth0 + bascule MFA e-mail
│   ├── SignaturesPage.ts      # (étend AdminListPage)
│   ├── TemplatesPage.ts       # (étend AdminListPage)
│   ├── CollaboratorsPage.ts   # liste + modale d'invitation
│   ├── IntegrationsPage.ts    # cartes d'intégration + détecteur SSO
│   ├── CalendarPage.ts
│   └── HomePage.ts
├── utils/
│   └── email-otp.ts           # Récupération du code MFA via IMAP
├── playwright.config.ts       # 1 projet Chromium, reporters, timeouts, retries
└── .env                       # secrets (non versionné)
```

### Authentification gérée par une fixture (`tests/fixtures.ts`)

L'authentification n'est **pas** câblée via des `projects`/`dependencies` Playwright (ignorés par
SquashTM, voir §4) mais **en code**, dans une fixture :

- Les specs authentifiés importent `test` depuis `./fixtures` : une fixture override le `storageState`
  et garantit une session via `ensureAuthState()` — qui **se connecte une seule fois** (login + MFA
  e-mail), met l'état en cache sur disque (`playwright/.auth/user.json`) et **sérialise via un verrou
  fichier** pour qu'un seul worker se connecte (les autres réutilisent le fichier produit).
- Les tests de login importent `loggedOutTest` : contexte **vierge** (pas de session), pour valider le
  flux de connexion lui-même.

> Conséquence clé : chaque spec est **autonome**. On peut lancer **toute la suite** (ou n'importe quel
> sous-ensemble) sans orchestration de config → ce qui la rend **exécutable telle quelle par SquashTM**
> (réf. du test auto = `tests/`). On s'authentifie une seule fois par run, puis tous les tests métier
> repartent de cette session (login à froid ~30 s, puis cache).

---

## 4. Infrastructure & cibles

- **Frontend testé** : `https://qg.swapn.tech/` (le backoffice Neo).
- **Backend API** : `https://neo.preprod.tiime.tech` (environnement de **préprod** — c'est là que partent
  les POST/PATCH/DELETE de création de signatures, templates, invitations…).
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

Le compte de test (`jean.baptiste.barbe@swapn.fr`) est protégé par une **MFA**. C'est le point le plus
délicat de l'automatisation. Voici le parcours réel :

1. `qg.swapn.tech` redirige vers la page locale **`/auth`** (bouton « Se connecter avec Auth0 »).
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

## 6. Couverture de tests (18 tests)

> L'authentification (login + MFA e-mail) n'est plus un « test » mais une **fixture** (§3) ; elle est
> donc exercée dès qu'un test authentifié tourne, et `smoke.spec.ts` vérifie que la session aboutit.

| Domaine | Spec | Ce qui est vérifié | Auth |
|---|---|---|---|
| **Login Auth0** | `login.spec.ts` (9) | page `/auth`, redirection Auth0, validations email/mot de passe, arrivée au challenge MFA | non |
| **Smoke** | `smoke.spec.ts` (1) | le backoffice charge après authentification | oui |
| **Signatures** | `signatures.spec.ts` (2) | pages liste + « mes signatures » ; **cycle de vie complet** : création → édition → suppression | oui |
| **Templates** | `templates.spec.ts` (2) | liste ; **cycle de vie complet** : création → édition → suppression | oui |
| **Collaborateurs** | `collaborators.spec.ts` (2) | liste chargée + colonnes + peuplée ; **invitation** d'un collaborateur (statut « Invité ») | oui |
| **Intégrations** | `integrations.spec.ts` (1) | la page charge ses items (carte « Google » SSO + scopes Calendar/Gmail) | oui |
| **Calendrier** | `calendar.spec.ts` (1) | le calendrier charge ses événements — **conditionné** au SSO Google actif | oui |

Les tests « CRUD » (signatures, templates) sont **self-cleaning** : ils suppriment en fin de test la
donnée qu'ils ont créée → pas de pollution, rejouables à l'infini.

---

## 7. Patterns & conventions (à connaître pour contribuer)

- **Page Object Model** : chaque écran a une classe dans `pages/` exposant des locators et des actions
  métier. Les specs ne manipulent pas de sélecteurs CSS directement.
- **`AdminListPage`** : classe abstraite qui factorise le pattern « liste d'administration » (recherche,
  ligne, menu « … » Éditer/Dupliquer/Supprimer, dialog de confirmation, redirection au submit).
  `SignaturesPage` et `TemplatesPage` en héritent → ajouter une nouvelle feature CRUD admin = quelques
  lignes (champs du formulaire + libellé du bouton de validation).
- **Screenshot automatique en cas d'échec** : `tests/fixtures.ts` étend la base de test ; tout spec
  importe `{ test, expect }` depuis `./fixtures`. Sur échec, une capture de la page est attachée au
  rapport (dossier `playwright-report/data/`). Implémenté en code (pas via config) pour fonctionner aussi
  sous Squash.
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
cp .env.example .env        # puis remplir AUTH_EMAIL / AUTH_PASSWORD / GMAIL_APP_PASSWORD

npm test                    # toute la suite (headless)
npm run test:headed         # navigateur visible (debug)
npm run test:login          # uniquement le flux de login
npm run report              # ouvre le rapport HTML du dernier run
```

Le **rapport HTML** (reporters `list` + `html`) est généré à chaque run. En cas d'échec : capture
d'écran attachée + **trace** Playwright (rejouable pas-à-pas) capturée au 1ᵉʳ retry
(`trace: 'on-first-retry'`).

### Variables d'environnement

| Variable | Requis ? | Rôle |
|---|---|---|
| `AUTH_EMAIL` / `AUTH_PASSWORD` | ✅ | compte de test Auth0 |
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
- `trace: 'on-first-retry'` + screenshot d'échec → diagnostic facile dans le rapport.

---

## 10. Limites connues & pistes

- **OTP e-mail parfois lent** (>120 s) → `setup` occasionnellement « flaky » (rattrapé par retry).
  Cible idéale : **TOTP** (à activer côté Auth0 Tiime) pour supprimer la dépendance e-mail.
- **Invitation collaborateur non nettoyable** : la liste n'offre pas de révocation UI → les invitations
  de test (email jetable `+e2e-…`) s'accumulent. Acceptable, mais à surveiller.
- **Secrets côté Squash** : `GMAIL_APP_PASSWORD` / `AUTH_PASSWORD` sont aujourd'hui à fournir en clair au
  runner. Piste : **SOPS** (déjà utilisé côté back Tiime) pour des secrets chiffrés versionnés.
- **Un seul navigateur** (Chromium) : on pourrait étendre à Firefox/WebKit si besoin.

---

## 11. En une phrase (pour le pitch)

> *Une suite Playwright/TypeScript en Page Object Model qui pilote le backoffice Neo de bout en bout, gère
> la MFA Auth0 automatiquement (bascule sur le facteur e-mail + lecture IMAP), couvre les parcours clés
> (auth, signatures, templates, collaborateurs, intégrations, calendrier) avec des tests self-cleaning,
> et s'intègre à SquashTM — le tout robuste face à une préprod distante (retries, traces, screenshots
> d'échec).*
