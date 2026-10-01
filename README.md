# caisse.bzh — application de bureau

Application Electron de [caisse.bzh](https://caisse.bzh) (by Inklura) : une fenêtre sécurisée autour de la caisse en ligne, avec ce qu'un poste de caisse attend en plus du navigateur.

- **Impression silencieuse** des tickets et rapports Z sur l'imprimante choisie (menu *Imprimante*) ; sans choix, la boîte d'impression habituelle.
- **Ticket de test** (menu *Imprimante*, Ctrl+Maj+P) pour régler l'imprimante avant le service.
- Menu *Poste* : **mode kiosque** (Ctrl+Maj+K pour en sortir), **lancement au démarrage** de l'ordinateur, **écran toujours allumé**, zoom retenu ; fenêtre retenue (et ramenée si l'écran a disparu). Raccourcis Caisse / Cuisine / Tableau de bord / Journal fiscal (Ctrl+1…4).
- **Reprise automatique** après un plantage de la page ; journal local (`logs/caisse-bzh.log` dans le dossier de données) et informations de diagnostic copiables (menu *Aide*).
- **Mises à jour automatiques** (`electron-updater`, flux GitHub Releases de ce dépôt) : vérification 15 s après le lancement puis toutes les 4 h, téléchargement en arrière-plan, **installation à la fermeture**, sur demande (*Redémarrer et installer*) ou la nuit (3 h–5 h, après 30 min sans utilisation, sans fenêtre) pour un poste jamais éteint — jamais pendant un service.
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

1. `npm version patch --no-git-tag-version`, mettre à jour `RELEASE_NOTES.md`, `npm test`.
2. Commit, push, puis `git tag vX.Y.Z && git push --tags`.
3. Le workflow *Desktop releases* construit Windows (NSIS), macOS (DMG/ZIP Intel + Apple Silicon) et Linux (AppImage) sur des runners natifs, puis publie la release avec les manifestes `latest*.yml` lus par les applications installées.

Ne jamais publier un manifeste sans tous les fichiers qu'il référence. Aucun jeton ni certificat dans le dépôt.

## Signature

Les premières versions ne sont pas signées : Windows affiche SmartScreen au premier lancement, macOS a une signature ad hoc. **Les versions macOS non signées ne se mettent pas à jour seules** (l'application l'indique). Pour signer : secrets Actions `CSC_LINK` / `CSC_KEY_PASSWORD` (Developer ID), `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` pour la notarisation, `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` pour Windows.

Sous Linux, gardez l'AppImage dans un dossier accessible en écriture pour les mises à jour.
