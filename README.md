# caisse.bzh — application de bureau

Application Electron de [caisse.bzh](https://caisse.bzh) (by Inklura) : une fenêtre sécurisée autour de la caisse en ligne, avec ce qu'un poste de caisse attend en plus du navigateur.

- **Impression silencieuse** des tickets et rapports Z sur l'imprimante choisie (menu *Imprimante*) ; sans choix, la boîte d'impression habituelle.
- **Ticket de test** (menu *Imprimante*, Ctrl+Maj+P) pour régler l'imprimante avant le service.
- Menu *Poste* : **mode kiosque** (Ctrl+Maj+K pour en sortir), **lancement au démarrage** de l'ordinateur, **écran toujours allumé**, zoom retenu ; fenêtre retenue (et ramenée si l'écran a disparu). Raccourcis Caisse / Cuisine / Tableau de bord / Journal fiscal (Ctrl+1…4).
- **Page au démarrage** (Caisse, Cuisine, Tableau de bord). **Reprise automatique** sur la page en cours après un plantage, une coupure ou un blocage d'une minute ; journal local (`logs/caisse-bzh.log` dans le dossier de données) et informations de diagnostic copiables (menu *Aide*).
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

## Microsoft Store

Le workflow manuel **Microsoft Store package** construit un AppX x64 pour Windows 10 (version 2004 ou plus) et Windows 11. Microsoft accepte ce format et signe les paquets après certification : aucun certificat commercial n'est nécessaire pour cette distribution. Les installateurs NSIS du site restent une distribution distincte.

Tant que le compte entreprise n'est pas validé, laisser **preparation** activé. Le paquet porte une identité provisoire, contient les icônes caisse.bzh et sert à valider la chaîne de construction ; il ne peut pas être soumis au Store. Les artefacts et le rapport de validation sont conservés 30 jours dans Actions et ne sont pas publiés dans les releases GitHub.

Après validation du compte, réserver le nom de l'application dans Partner Center, ouvrir **Gestion du produit > Identité de l'application**, puis copier exactement **Package/Identity/Name** et **Package/Identity/Publisher**. Relancer le workflow avec **preparation** désactivé et les champs **identity_name** et **publisher** renseignés. Le quatrième numéro de version reste `0`, comme l'exige le Store. En local sur Windows : `npm run dist:store` avec `STORE_IDENTITY_NAME` et `STORE_PUBLISHER`, ou `STORE_PREPARATION=true` pour préparer la construction.

L'édition Store utilise les mises à jour du Store ; elle ne contacte pas le flux de mises à jour NSIS et ne peut pas installer ces mises à jour. Le lancement automatique est désactivé dans cette première édition : l'API de registre utilisée par les installateurs classiques ne gère pas les tâches de démarrage des paquets Windows. Impression, mode kiosque et maintien de l'écran allumé restent disponibles.

Le workflow vérifie le manifeste généré par MakeAppx, l'exécutable, les ressources et le contenu de l'application. Il faut encore tester le paquet installé sur Windows et exécuter le **Windows App Certification Kit** avant la soumission. La certification Microsoft et la publication nécessitent ensuite un compte approuvé, la fiche Store, les déclarations et les informations permettant aux testeurs d'accéder au service.

Références : [exigences des paquets Microsoft Store](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-package-requirements), [détection des paquets Windows par Electron](https://www.electronjs.org/docs/latest/api/process#processwindowsstore-readonly).
