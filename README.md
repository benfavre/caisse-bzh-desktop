# caisse.bzh — application de bureau

Application Electron de [caisse.bzh](https://caisse.bzh) (by Inklura) : une fenêtre sécurisée autour de la caisse en ligne, avec ce qu'un poste de caisse attend en plus du navigateur.

- **Impression silencieuse** des tickets et rapports Z sur l'imprimante choisie (menu *Imprimante*) ; sans choix, la boîte d'impression habituelle.
- **Ticket de test** (menu *Imprimante*, Ctrl+Maj+P) pour régler l'imprimante avant le service.
- Menu *Poste* : **mode kiosque** (Ctrl+Maj+K pour en sortir), **lancement au démarrage** de l'ordinateur, **écran toujours allumé**, zoom retenu ; fenêtre retenue (et ramenée si l'écran a disparu). Raccourcis Caisse / Cuisine / Tableau de bord / Journal fiscal (Ctrl+1…4).
- **Page au démarrage** (Caisse, Cuisine, Tableau de bord). **Reprise automatique** sur la page en cours après un plantage, une coupure ou un blocage d'une minute ; journal local (`logs/caisse-bzh.log` dans le dossier de données) et informations de diagnostic copiables (menu *Aide*).
- **Mises à jour automatiques** (`electron-updater`, flux GitHub Releases de ce dépôt) : vérification 15 s après le lancement puis toutes les 4 h, téléchargement en arrière-plan, **installation après clôture et synchronisation**, sur demande (*Redémarrer et installer*) ou la nuit (3 h–5 h, après 30 min sans utilisation, sans fenêtre) pour un poste jamais éteint — jamais pendant un service.
- Session conservée, navigation limitée à `caisse.bzh` et `auth.1clic.pro` (le reste s'ouvre dans le navigateur), permissions refusées (caméra, micro, localisation, notifications) sauf l'écriture dans le presse-papiers et le plein écran pour `caisse.bzh`, redirections hors domaine bloquées, rendu isolé (`contextIsolation`, `sandbox`, pas de Node).
- La page web détecte l'application via `window.caisseDesktop` et le suffixe `caisse-bzh-desktop/<version>` de l'user-agent.

Même modèle de publication que [benfavre/caviard](https://github.com/benfavre/caviard).

## Développer

Node 22 ou plus.

```sh
npm ci
npm test            # sécurité des URL, réglages d'impression, mises à jour
npm start           # lance l'application (charge https://caisse.bzh)
npm run pack        # application décompressée dans release/
npm run dist        # installateur pour l'OS courant
```

## Publier une version

1. `npm version patch --no-git-tag-version`, réécrire `RELEASE_NOTES.md` pour cette version, `npm test`.
2. Commit, push, puis `git tag vX.Y.Z && git push --tags`.
3. Le workflow *Desktop releases* construit Windows (NSIS), macOS (DMG/ZIP Intel + Apple Silicon) et Linux (AppImage) sur des runners natifs, puis publie la release avec les manifestes `latest*.yml` lus par les applications installées.

Les notes de la release (= `RELEASE_NOTES.md` au moment du tag) forment le **journal des modifications de l'application**, affiché sur [caisse.bzh/nouveautes/application-de-bureau](https://caisse.bzh/nouveautes/application-de-bureau) (lu depuis l'API GitHub, actualisé toutes les 10 min). Écrivez-les pour les utilisateurs : un titre `# caisse.bzh X.Y.Z`, puis une liste de ce qui change pour eux, en français simple, sans tiret cadratin. Le journal de la caisse elle-même (l'application web) est tenu à part, dans `sites/pos-inklura-prism/src/lib/changelog.ts` du dépôt bext.

Ne jamais publier un manifeste sans tous les fichiers qu'il référence. Aucun jeton ni certificat dans le dépôt.

## Signature

Les premières versions ne sont pas signées : Windows affiche SmartScreen au premier lancement, macOS a une signature ad hoc. **Les versions macOS non signées ne se mettent pas à jour seules** : elles signalent une nouvelle version et renvoient vers caisse.bzh/telecharger. Pour signer : secrets Actions `CSC_LINK` / `CSC_KEY_PASSWORD` (Developer ID), `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` pour la notarisation, `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` pour Windows.

À partir de 1.3.3, les publications par tag exigent les cinq identifiants macOS. Le workflow vérifie la signature Developer ID, l'équipe Apple, le ticket de notarisation et Gatekeeper avant de publier. `CSC_LINK` contient le PKCS12 encodé en base64 dans un secret Actions, jamais dans un fichier suivi par Git.

`npm ci` applique une correction ciblée à electron-builder 26.15.3 : le mot de passe du trousseau temporaire doit être utilisé pour `set-key-partition-list`, distinct du mot de passe PKCS12. Lors d'une mise à jour du packager, revoir `scripts/fix-macos-keychain.cjs`.

Sous Linux, gardez l'AppImage dans un dossier accessible en écriture pour les mises à jour.

## Plateformes et reprise hors ligne

Windows 10/11 x64, macOS 13+ Intel/Apple Silicon, Linux x64 AppImage. Le runtime Electron 44 exige macOS 13 ([référence Electron](https://www.electronjs.org/docs/latest/breaking-changes#removed-macos-12-support)).

Les commandes et ventes locales de la caisse sont conservées dans le profil de l’application. Garder ce profil et installer les mises à jour par-dessus la version existante. Une mise à jour attend un état récent sans commande ouverte, service ouvert, paiement incertain, opération en attente ou impression en cours. Un écran sans état vérifiable bloque l’installation automatique.

L’impression inscrit une réservation durable avant l’envoi au système. Une interruption ne déclenche aucun renvoi automatique. Un accusé du système d’impression ne prouve pas la sortie papier ; vérifier le ticket puis demander un duplicata si nécessaire.

Une copie native conserve aussi les commandes en attente, les identités des paiements incertains et les demandes de remboursement. Chaque instantané a une génération et une révision : une écriture retardée ne remplace jamais la plus récente. Après perte d’IndexedDB, reconnecter le même compte et établissement pour restaurer les demandes ; les commandes restaurées doivent être rapprochées du serveur avant un nouvel encaissement hors ligne. Les autorisations de création de ventes ne sont pas copiées. Une panne du disque est signalée et bloque le succès de l’enregistrement ; une vente déjà enregistrée reste une vente, avec un avertissement de sauvegarde. Une désinstallation avec suppression du profil détruit aussi ces copies.
