# E2E Backoffice — Tests Playwright Swapn

Tests end-to-end [Playwright](https://playwright.dev) du backoffice Swapn (`qg.swapn.tech`).
Couvre le flux d'authentification **Auth0 Tiime** (login + MFA, le test bascule sur le facteur
**« E-mail »** et lit le code en IMAP — aucun téléphone requis) et un smoke test du backoffice.
Architecture **Page Object Model**.

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

| Variable | Requis ? | Rôle / défaut |
|----------|----------|---------------|
| `AUTH_EMAIL` | ✅ **obligatoire** | email du compte de test Auth0 Tiime (= adresse qui reçoit le code MFA) |
| `AUTH_PASSWORD` | ✅ **obligatoire** | mot de passe du compte de test |
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
| `npm run test:login` | Uniquement le flux de login (projet `logged-out`, sans auth) |
| `npm run test:smoke` | Uniquement le smoke test authentifié |
| `npm run report` | Ouvre le dernier rapport HTML |

---

## Structure du projet

```
.
├── tests/
│   ├── auth.setup.ts      # setup — login Auth0 + OTP → produit le storageState
│   ├── login.spec.ts      # projet logged-out — flux de login Auth0 (sans auth)
│   └── smoke.spec.ts      # projet chromium — backoffice chargé (avec auth)
├── pages/                 # Page Object Model
│   ├── BasePage.ts
│   ├── LoginPage.ts
│   └── HomePage.ts
├── utils/
│   └── email-otp.ts       # récupération du code MFA e-mail Auth0 via IMAP
├── playwright.config.ts   # 3 projets : setup / logged-out / chromium
└── .env.example           # template des variables d'environnement
```

### Organisation des projets Playwright

- **`setup`** — `auth.setup.ts` : s'authentifie via Auth0 et sauvegarde l'état
  (`playwright/.auth/user.json`), réutilisé par les tests authentifiés.
- **`logged-out`** — `login.spec.ts` : valide le flux de login Auth0 **sans** état d'auth.
- **`chromium`** — `smoke.spec.ts` : tests authentifiés, dépendent de `setup`.
