# E2E Backoffice — Tests Playwright Swapn

Tests end-to-end [Playwright](https://playwright.dev) du backoffice Swapn (`qg.swapn.tech`).
Couvre, avec deux rôles (**ADMIN** et **BPO**) :
- l'**authentification** Auth0 Tiime (login + MFA : le test bascule sur le facteur **« E-mail »**
  et lit le code en IMAP — aucun téléphone requis ; le compte BPO n'a pas de MFA) ;
- le **traitement des tickets FDE** (Contrôles, rôle BPO) ;
- la **messagerie** e-mail et interne (Inbox, rôle ADMIN) ;
- l'**affichage sans erreur** des pages de tous les menus ;
- les écrans d'administration (templates, signatures, collaborateurs, intégrations).

Architecture **Page Object Model**. Référence fonctionnelle : « Swapn QG — source de vérité e2e ».

---

## Prérequis

### 1. Logiciels à installer

| Outil | Version | Lien |
|-------|---------|------|
| **Node.js** | ≥ 18 (LTS recommandé) | https://nodejs.org |
| **npm** | fourni avec Node.js | — |
| **git** | récent | https://git-scm.com |

### 2. Dépendances du projet

```bash
npm install
```

Installe les dépendances npm (`@playwright/test`, `dotenv`, …).

> ⚠️ **Étape souvent oubliée** : `npm install` n'installe **pas** les navigateurs.
> Il faut les télécharger séparément :
>
> ```bash
> npx playwright install chromium
> ```
>
> Sans cette étape, les tests échouent avec « browser executable not found ».

### 3. Variables d'environnement (`.env`)

Le fichier `.env` contient des **secrets** et n'est **pas versionné**. Recrée-le à partir du template :

```bash
cp .env.example .env      # Windows PowerShell : copy .env.example .env
```

> En local, le fichier **`secrets_e2e.yml`** (en clair, non versionné) est lu directement et
> **prime sur `.env`**. Sur Squash/CI, les secrets viennent de `secrets_e2e.enc.yml` (chiffré,
> versionné), déchiffré avec la clé `E2E_SECRETS_KEY`. Après toute modification de
> `secrets_e2e.yml` : `npm run secrets:encrypt -- --key=<clé>` puis commit du fichier chiffré.

| Variable | Requis ? | Rôle / défaut |
|----------|----------|---------------|
| `AUTH_EMAIL` | ✅ **obligatoire** | email du compte de test « admin » (= adresse qui reçoit le code MFA) |
| `AUTH_PASSWORD` | ✅ **obligatoire** | mot de passe du compte « admin » |
| `AUTH_EMAIL_BPO` / `AUTH_PASSWORD_BPO` | pour les tests BPO | compte BPO ; absents → tests BPO **sautés** |
| `GMAIL_USER_BPO` / `GMAIL_APP_PASSWORD_BPO` | optionnel | boîte IMAP du BPO si elle diffère de celle de l'admin |
| `FDE_TEST_COMPANY` | optionnel | société des tickets FDE de test — défaut : `Demo Setex 1` |
| `API_URL` | optionnel | API QG (remise à l'état des données) — défaut : `https://api.preprod.swapn.tech` |
| `E2E_SECRETS_KEY` | Squash / CI | clé de déchiffrement de `secrets_e2e.enc.yml` (active aussi la notification Slack) |
| `GMAIL_APP_PASSWORD` | ✅ **obligatoire** (secret) | mot de passe d'application IMAP de la boîte du compte — voir [aide Google](https://support.google.com/accounts/answer/185833) |
| `BASE_URL` | optionnel | URL du backoffice — défaut : `https://qg.swapn.tech/` |
| `GMAIL_USER` | optionnel | boîte IMAP lue — défaut : `jean.baptiste.barbe@swapn.fr` |
| `OTP_SENDER` | optionnel | expéditeur du mail OTP Auth0 — défaut : `no-reply@apps.tiime.fr` |

> **Intégration CI / SquashTM** : déclarer les variables obligatoires comme variables
> d'environnement (associées au projet/orchestrateur). `BASE_URL`, `GMAIL_USER` et
> `OTP_SENDER` ayant un défaut, elles sont facultatives sur le runner.

### 4. MFA par e-mail (sans téléphone)

Le compte de test a deux facteurs MFA Auth0 : **SMS** (défaut) et **E-mail**. Le test bascule
automatiquement sur le facteur **« E-mail »** après le mot de passe (« Essayer une autre méthode »
→ « E-mail ») ; Auth0 envoie alors le code à l'adresse du compte, que le test lit en **IMAP**
(`utils/email-otp.ts`). Aucune dépendance à un téléphone ni à un quelconque relais.

Sur une nouvelle machine, rien à réinstaller pour ça : il faut seulement que la boîte du compte
soit accessible en IMAP (renseigner `GMAIL_APP_PASSWORD`).

---

## Installation rapide (résumé)

```bash
git clone https://github.com/jeanbaptistebarbe-2026/e2e-test-backoffice.git
cd e2e-test-backoffice
npm install
npx playwright install chromium
cp .env.example .env          # puis remplir les secrets
npm run test:headed
```

---

## Lancer les tests

| Commande | Description |
|----------|-------------|
| `npm test` | Toute la suite (headless) |
| `npm run test:headed` | Toute la suite, navigateur visible |
| `npm run test:readonly` | Tests sans modification de données (non-régression quotidienne) |
| `npm run test:write` | Tests qui modifient des données (envoi de mail, statuts de tickets, CRUD…) |
| `npm run test:auth` | Authentification |
| `npm run test:admin` / `npm run test:bpo` | Tests d'un rôle |
| `npm run report` | Ouvre le dernier rapport HTML |

**Tags** (au plus 3 par test, visibles dans le rapport) : le rôle (`@role-admin`, `@role-bpo`),
le module (`@auth`, `@navigation`, `@messagerie`, `@controles`, `@administration`, `@parametres`)
et `@ecriture` pour les tests qui modifient des données. L'identifiant Squash (`TC-…`) et une
description du test sont des **annotations**, affichées dans la page de détail du test du rapport
(helper `meta()` de `tests/meta.ts`).

---

## Structure du projet

```
.
├── tests/
│   ├── fixtures.ts            # auth par rôle en fixture, santé de page, capture + trace d'échec
│   ├── meta.ts                # meta() : ID Squash + description (rapport), tag @ecriture
│   ├── data/routes.ts         # table des pages des menus (spec « affichage sans erreur »)
│   ├── login.spec.ts          # écrans Auth0 (sans session)
│   ├── auth/                  # session.spec.ts (sans session) · roles.spec.ts (rôles, déconnexion)
│   ├── navigation/            # pages.spec.ts : toutes les pages des menus, ADMIN et BPO
│   ├── inbox/                 # messagerie.spec.ts : e-mail, commentaires internes, brouillons
│   ├── controles/             # tickets.spec.ts : traitement des tickets FDE (BPO)
│   └── templates · signatures · collaborators · integrations .spec.ts
├── pages/                     # Page Object Model
│   ├── BasePage.ts  AppShell.ts         # navigation, rail, sous-menus, toasts, erreurs
│   ├── LoginPage.ts                     # login Auth0 (+ MFA e-mail facultatif)
│   ├── InboxPage.ts  ComposerDialog.ts  ConversationPanel.ts
│   ├── TicketsPage.ts
│   └── AdminListPage.ts  SignaturesPage.ts  TemplatesPage.ts  CollaboratorsPage.ts  IntegrationsPage.ts
├── utils/
│   ├── roles.ts               # identifiants par rôle (admin / bpo)
│   ├── email-otp.ts           # lecture IMAP : code MFA, mails envoyés par les tests
│   ├── api.ts                 # client API de remise à l'état (jamais pour l'action testée)
│   ├── page-health.ts         # erreurs JS / console / 5xx relevées sur la page
│   └── secrets.ts             # secrets : secrets_e2e.yml (local) ou secrets_e2e.enc.yml (chiffré)
├── reporters/slack-reporter.ts
├── playwright.config.ts       # 1 projet Chromium (auth en fixture, pas en projet)
└── .env.example               # template des variables d'environnement
```

### Authentification (fixture, pas de projet)

L'auth est gérée **en code** dans `tests/fixtures.ts` (et non via des `projects`/`dependencies`, que
l'orchestrateur SquashTM ignore) :

- les specs authentifiés importent `test` → une fixture se connecte **une fois par rôle**
  (`test.use({ role: 'bpo' })`, défaut `admin`), met l'état en cache
  (`playwright/.auth/<role>.json`, réutilisé 10 min) et sérialise les logins par un verrou fichier ;
- les specs sans session importent `loggedOutTest` → contexte vierge ;
- la déconnexion utilise `freshLoggedInContext()` : une session privée, pour ne pas révoquer celle
  des autres tests.

### Données de test

- **Messagerie** : chaque run s'envoie un mail depuis le BO (objet `E2E <horodatage>`), le vérifie
  en IMAP, puis archive les conversations de test (y compris les copies tardives remontées par la
  synchronisation Gmail lors des runs précédents).
- **Tickets FDE** : sur la société `FDE_TEST_COMPANY` ; tout ticket modifié est remis « À traiter »
  après le test. La réservation posée à l'ouverture par le BPO n'est pas libérable par l'API et
  expire seule (30 min).
- **Administration** : templates, signatures, vues et brouillons créés sont supprimés en fin de test.

Chaque spec est donc **autonome** : on peut lancer toute la suite (ou un sous-ensemble) sans
orchestration de config — y compris sur SquashTM (réf. du test auto = `tests/`).
