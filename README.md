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

## Reprendre la publication

Le [suivi des publications et signatures](docs/publication-et-signatures.md), mis à jour le **3 octobre 2026**, rassemble l'état des comptes, les builds vérifiés, les fichiers locaux et les prochaines étapes pour Windows, macOS, Android et iOS. La prochaine étape est la validation du compte **Microsoft Store**, puis la création de l'application avec son identité définitive.

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


## Native checkpoint part lifecycle (staged 1.4.0)

The shared web engine partitions large recovery snapshots. Before a native parent index is committed, the desktop validates every part, scoped hash, byte length and the reconstructed JSON. All checkpoint writes in a directory are serialized. A complete replacement is synced before superseded parts from its predecessor are retired. Missing or altered parts cannot publish an incomplete index; competing web writers can recopy their immutable parts and retry the same revision. The original sale journal is separate and is never pruned here.

A reader racing retirement can reread a strictly newer index under the same generation. Ship the current shared web recovery assets before publishing this wrapper. After acknowledged root backups, a background collector also removes verified orphan parts from failed staging or interrupted cleanup. It advances through at most eight directory entries per batch, yields between batches, and rechecks a changed current index before deleting anything. A backup acknowledged during a pass requests another pass. Parts belonging to another root/account and malformed or unknown files are preserved. A restart begins a fresh pass on the next root backup acknowledgment. Total original history stays retained. Cleanup failures leave extra copies without invalidating an already durable replacement.


## Local signaling carrier (staged, not connected to the app)

`electron/local-peer-signals.mjs` provides a bounded IPv4 UDP discovery/TCP
carrier for a future authenticated peer-resumption flow. Android implements the
same wire contract. It is not imported by the main process or exposed through
preload, so normal application use starts no listener and gains no automatic
reconnection yet. Existing manual WebRTC pairing remains unchanged.

The carrier moves only opaque tags and encrypted boxes. Small JSON headers
are limited to 1,400 bytes; the base64 body has a separate bounded line, so
Android does not parse a large encrypted payload as JSON. A queue receipt is not
a kitchen or fiscal acknowledgment. The web layer must authenticate every box
and bind it to a confirmed pairing, scope and fresh process instances before
using its contents. Native process IDs and discovery tags alone prove no peer
identity. No arbitrary destination address is accepted through the carrier API.

Local heartbeat leases, stale-handle fencing, private IPv4 destinations, socket
and queue limits, five-second idle timeouts and ten-second absolute socket
deadlines bound its lifetime and work. Removing a tag clears queued signals and
prevents a pending hello from authorizing transmission. All nine carrier tests
use real loopback UDP/TCP sockets; they do not establish physical LAN multicast,
firewall permission or app cold-reconnection behavior. The full native suite is
46 tests. Pairing-key persistence, authenticated resumption, trusted bridge
exposure and native permission/lifecycle handling remain required integration.


The staged desktop now exposes document-owned opaque signaling through five
`peerSignal*` preload methods. Only the main POS/kitchen frame can call them;
reload, navigation, renderer exit and suspend invalidate listeners and pending
results. Startup advertises no tags until caller ownership is checked again.
Stale handles cannot stop a replacement, and the carrier's 15-second heartbeat
lease remains required. No page starts discovery merely by loading the wrapper;
the automatic web reconnection controller is still being integrated.

The Mac package now declares its local-network purpose in `Info.plist`, as
required by [Apple's local network privacy guidance](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy).
Local verification passes 52 tests and the actual packaged Linux IPC smoke for
POS/kitchen access, subframe navigation, reload, suspension, logout-page refusal
and stale-handle safety. This does not establish physical Mac/Windows networking.


### Private discovery interfaces

Discovery now advertises only on private/link-local, non-loopback IPv4 addresses,
bounded to 32 source addresses. Public interfaces, IPv6 and malformed addresses
are excluded; loopback remains available to the existing direct socket fixtures.
On mixed public/private interfaces, the selected private IPv4 address is explicit.
The UDP sender waits for each send callback before changing interfaces, rechecks
current tags between packets, and drops memberships when an address disappears.
A failed interface does not fall back to the system default. Retired listener
callbacks cannot continue an old advertisement burst.

All 55 desktop tests pass locally, including interface selection, asynchronous
send ordering, tag removal, cancellation and interface failure checks. A fresh
two-carrier multicast probe still discovers zero peers on this cloud host's five
private bridge addresses. This is not physical shop-LAN verification. The normal
web panel has not enabled automatic discovery; native release publication remains
disabled. See Node's [UDP interface and send contract](https://nodejs.org/api/dgram.html)
for the socket behavior used here.


## Offline navigation retries (staged 1.4.0)

Only the displayed native offline page owns automatic connectivity polling.
Leaving it cancels the timer and current request; a delayed reply cannot reload
a working POS, kitchen or authentication page. Probes do not overlap and expire
after ten seconds. Returning to a new offline page starts a new generation, so
an earlier reply cannot navigate or clear its request. A current successful
probe still returns to the remembered application page. Main-frame load errors
select the fallback once; an aborted load promise does not create another one.

Seven deterministic tests cover stale replies, replacement sessions, bounded
requests, missing connectivity, server errors and failures during request setup.
The packaged-app regression forces a native fallback, resumes a kitchen page,
then delivers the old network response and verifies that the page stays intact.
It also checks cancellation of future polling and successful current recovery.


## Interrupted checkpoint temporary files (staged 1.4.0)

The background collector now removes writer-generated temporary files only when
an exact byte-for-byte copy is committed in the current checkpoint root or one
of its retained parts, and the complete current backup verifies. Cleanup shares
the directory lock with writers and examines at most eight entries per batch.
It never uses file age as evidence. Unique, partial, malformed, oversized,
foreign, unknown-name and non-file candidates remain untouched. Original sales
remain in their separate journal. The collector revalidates the backup for a
batch containing duplicates even when a previous batch cached the same parent.

Four regressions cover interrupted publication followed by successful retry,
bounded duplicate cleanup, preservation including invalid UTF-8 that decodes to
the same text, damage after an earlier verification and serialization with an
active writer. This bounds redundant crash leftovers; it does not bound all
retained business history or automatically dispose of unique recovery files.

## Microsoft Store

Pour l'état du dossier, les résultats des derniers essais et l'ordre des étapes restantes, consulter le [suivi Microsoft Store](docs/publication-et-signatures.md#reprendre-microsoft-store).

Le workflow manuel **Microsoft Store package** construit un AppX x64 pour Windows 10 (version 2004 ou plus) et Windows 11. Microsoft accepte ce format et signe les paquets après certification : aucun certificat commercial n'est nécessaire pour cette distribution. Les installateurs NSIS du site restent une distribution distincte. Le SDK Windows et son outil de manifeste `mt.exe` sont nécessaires : le paquet conserve les réglages Electron et déclare explicitement la mise à l'échelle Windows **PerMonitorV2**, vérifiée dans l'exécutable empaqueté.

Tant que le compte entreprise n'est pas validé, laisser **preparation** activé. Le paquet porte une identité provisoire, contient les icônes caisse.bzh et sert à valider la chaîne de construction ; il ne peut pas être soumis au Store. Les artefacts et le rapport de validation sont conservés 30 jours dans Actions et ne sont pas publiés dans les releases GitHub.

Après validation du compte, réserver le nom de l'application dans Partner Center, ouvrir **Gestion du produit > Identité de l'application**, puis copier exactement **Package/Identity/Name** et **Package/Identity/Publisher**. Relancer le workflow avec **preparation** désactivé et les champs **identity_name** et **publisher** renseignés. Le quatrième numéro de version reste `0`, comme l'exige le Store. En local sur Windows : `npm run dist:store` avec `STORE_IDENTITY_NAME` et `STORE_PUBLISHER`, ou `STORE_PREPARATION=true` pour préparer la construction.

L'édition Store utilise les mises à jour du Store ; elle ne contacte pas le flux de mises à jour NSIS et ne peut pas installer ces mises à jour. Le lancement automatique est désactivé dans cette première édition : l'API de registre utilisée par les installateurs classiques ne gère pas les tâches de démarrage des paquets Windows. Impression, mode kiosque et maintien de l'écran allumé restent disponibles.

Le workflow vérifie le manifeste généré par MakeAppx, l'exécutable, les ressources et le contenu de l'application. Pour tenter un test d'installation sur le runner isolé, activer **test_install** sur une construction de préparation. Une copie reçoit un certificat temporaire, est installée et lancée, puis le paquet et le certificat sont retirés ; l'artefact non signé destiné au Store reste intact. **run_wack** tente aussi le **Windows App Certification Kit** si le kit et une session interactive sont disponibles. Un contrôle non exécuté est signalé comme tel dans le rapport. Le résultat global, les avertissements et les échecs facultatifs restent visibles ; un échec obligatoire fait échouer le workflow. Lire les résultats avant la soumission et vérifier le comportement sur Windows 10/11 : un runner Windows Server ne remplace pas la certification Microsoft ni les essais d'impression et de mise à l'échelle sur un poste réel.

Le brouillon français de la fiche Store est dans `build/store-listing.fr-FR.json`. Le menu **Aide > Essayer la démo** de l'édition Store donne accès à la démo partagée sans compte ; les instructions pour les testeurs sont déjà dans la fiche. Avant la soumission, il faut encore compléter la politique de confidentialité, les captures Windows et les déclarations dans Partner Center.

Références : [exigences des paquets Microsoft Store](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-package-requirements), [détection des paquets Windows par Electron](https://www.electronjs.org/docs/latest/api/process#processwindowsstore-readonly).


### Store distribution and offline update guards

The offline branch includes the Microsoft Store preparation workflow and
publisher handoff from main (`6a34e0c`). Direct desktop downloads keep the fresh
recovery-state installation guard and disable installation merely on application
quit. Store builds keep self-download, NSIS update checks and self-installation
disabled, including after stray updater events; Microsoft manages their updates.
The app's direct-updater guard cannot schedule or veto a Store-managed update.
Recovery storage is included in both distributions. Store activation, update
preservation and device behavior require their own verification; a provisional
AppX is not a published or certified Store release.
