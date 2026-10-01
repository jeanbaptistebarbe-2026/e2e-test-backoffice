import type { TestDetails } from '@playwright/test';

/**
 * Métadonnées d'un test, affichées dans le rapport HTML :
 *   - annotations « ID » (identifiant Squash) et « Description » (ce que fait le
 *     test), visibles dans la page de détail du test ;
 *   - tag `@ecriture` si le test MODIFIE des données (création, envoi, changement
 *     de statut…), pour l'exclure d'une non-régression en lecture seule :
 *     `--grep-invert @ecriture`.
 *
 * Les autres tags (rôle `@role-admin` / `@role-bpo`, module `@auth`, `@navigation`,
 * `@messagerie`, `@controles`, `@administration`, `@parametres`) se posent sur le
 * `test.describe`. Règle : au plus 3 tags visibles par test.
 */
export function meta(id: string, description: string, opts: { ecriture?: boolean } = {}): TestDetails {
  return {
    tag: opts.ecriture ? ['@ecriture'] : [],
    annotation: [
      { type: 'ID', description: id },
      { type: 'Description', description },
    ],
  };
}
