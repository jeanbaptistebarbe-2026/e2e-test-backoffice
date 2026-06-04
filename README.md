# E2E Backoffice — Tests Playwright Swapn

Tests end-to-end [Playwright](https://playwright.dev) du backoffice Swapn (`qg.swapn.tech`).
Couvre le flux d'authentification **Auth0 Tiime** (login + MFA SMS via OTP récupéré sur Gmail/IMAP)
et un smoke test du backoffice. Architecture **Page Object Model**.

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

Installe les dépendances npm (`@playwright/test`, `dotenv`, `imapflow`, `mailparser`, …).

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

Grâce aux valeurs par défaut intégrées au code, **seules 3 variables sont strictement
obligatoires** (les secrets) — les autres ont un défaut et ne sont à définir que pour
surcharger :

| Variable | Requis ? | Rôle / défaut |
|----------|----------|---------------|
| `AUTH_EMAIL` | ✅ **obligatoire** | email du compte de test Auth0 Tiime |
| `AUTH_PASSWORD` | ✅ **obligatoire** | mot de passe du compte de test |
| `GMAIL_APP_PASSWORD` | ✅ **obligatoire** | **App Password** Gmail (pas le mot de passe du compte) — voir [aide Google](https://support.google.com/accounts/answer/185833) |
| `BASE_URL` | optionnel | URL du backoffice — défaut : `https://qg.swapn.tech/` |
| `GMAIL_USER` | optionnel | boîte IMAP recevant l'OTP — défaut : `jean.baptiste.barbe@swapn.fr` |
| `OTP_SENDER` | optionnel | expéditeur de l'email OTP (SMS transféré) — défaut : `jeanbaptiste.barbe@gmail.com` |

> **Intégration CI / SquashTM** : il suffit de déclarer les **3 variables obligatoires**
> comme variables d'environnement (associées au projet/orchestrateur). `BASE_URL`,
> `GMAIL_USER` et `OTP_SENDER` ayant un défaut, elles sont facultatives sur le runner.

### 4. MFA SMS (dépendance « hors-code »)

Le compte de test utilise une **MFA par SMS**. Le code envoyé par Tiime par SMS doit arriver
dans la boîte Gmail configurée ci-dessus, via un **Raccourci iOS** qui transfère le SMS reçu
sur l'iPhone vers cette adresse email. Les tests lisent ensuite l'OTP en IMAP.

Sur une nouvelle machine, rien à réinstaller pour ça : c'est l'iPhone qui transfère.
Il faut simplement que la boîte Gmail du `.env` reçoive bien ces emails.

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
│   └── gmail-otp.ts       # récupération de l'OTP via IMAP Gmail
├── tools/
│   └── imap-check.mjs     # script de diagnostic IMAP
├── playwright.config.ts   # 3 projets : setup / logged-out / chromium
└── .env.example           # template des variables d'environnement
```

### Organisation des projets Playwright

- **`setup`** — `auth.setup.ts` : s'authentifie via Auth0 et sauvegarde l'état
  (`playwright/.auth/user.json`), réutilisé par les tests authentifiés.
- **`logged-out`** — `login.spec.ts` : valide le flux de login Auth0 **sans** état d'auth.
- **`chromium`** — `smoke.spec.ts` : tests authentifiés, dépendent de `setup`.
