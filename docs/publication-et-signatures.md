# Suivi des publications et signatures

État au **3 octobre 2026**, pour caisse.bzh et Webdesign29, contact `ben@webdesign29.net`. Ce document sert à reprendre le travail ; les validations de comptes en attente doivent être revérifiées dans leurs portails à la prochaine session.

**Prochaine action : vérifier la validation de l'association à l'entreprise dans Microsoft Store.** Le paquet Windows et la fiche française sont préparés, mais aucune application Store n'est encore créée, soumise ou publiée. La voie AppX permet à Microsoft de signer après certification, pendant que la vérification Azure/AU10TIX reste bloquée.

## État des plateformes

| Plateforme | Réalisé | Reste à faire |
| --- | --- | --- |
| macOS | Version **1.3.3 publiée**, DMG/ZIP Intel et Apple Silicon signés Developer ID et notarisés. Adhésion Apple renouvelée. | Continuer les releases avec les secrets Actions existants. |
| Windows, téléchargement direct | Installateur NSIS x64 **1.3.3 publié**, toujours non signé. | Signature commerciale bloquée par la vérification Azure/AU10TIX ; voir ci-dessous. |
| Windows, Microsoft Store | AppX de préparation **1.3.3.0**, installation et lancement vérifiés ; fiche française préparée. Courriel et entreprise validés. | Association à l'entreprise en cours d'examen, identité Store définitive, confidentialité, captures, essais et certification. |
| Android | APK **1.0.0** disponible ; AAB construit et validé ; nouveau compte Google Play payé et accès administrateur accepté. | Vérification Google encore en attente lors du dernier contrôle, puis création et soumission de l'application. |
| iOS | Compte Apple actif, identifiant `bzh.caisse.ios`, certificat Apple Distribution et profil App Store créés. | Aucun projet iOS natif trouvé, aucune IPA ni application App Store Connect créée. Il faut encore réaliser le client et sa publication. |

La [release bureau v1.3.3](https://github.com/benfavre/caisse-bzh-desktop/releases/tag/v1.3.3) et la [page de téléchargement](https://caisse.bzh/telecharger) sont en ligne. Les changements Store présents sur `main` ne constituent pas une nouvelle release bureau publiée.

## Reprendre Microsoft Store

### 1. Terminer la validation du compte existant

Ouvrir le [portail d'inscription Store](https://storedeveloper.microsoft.com/fr-FR/onboarding) avec le compte existant de `ben@webdesign29.net` : entreprise **FAVRE BENJAMIN**, éditeur **Webdesign29**.

- Courriel : **Verified**.
- Entreprise : **Verified**.
- Association à l'entreprise/domaine : **Under review**, après transmission de la facture OVH. Le portail annonçait habituellement cinq jours ouvrés.
- **Finish account setup** était désactivé. Attendre le résultat, consulter le courriel et terminer l'inscription lorsque le bouton sera disponible.

Conserver cette inscription et l'identité légale validée. Aucune réservation de nom ni identité de paquet définitive n'a encore été obtenue.

### 2. Réserver le nom et relever l'identité du paquet

Après validation, créer l'application dans Partner Center et tenter de réserver **caisse.bzh** ; sa disponibilité n'a pas été vérifiée. Dans **Gestion du produit > Identité de l'application**, relever exactement :

- **Package/Identity/Name** ;
- **Package/Identity/Publisher**, y compris le `CN=...`.

Le paquet actuel utilise `Webdesign29.CaisseBZH.Preparation` et `CN=Webdesign29-Preparation`. **Il ne peut pas être soumis au Store.** Ne pas remplacer l'identité définitive par le nom commercial ou l'adresse de courriel.

### 3. Finaliser la fiche et les essais

Le brouillon est dans [build/store-listing.fr-FR.json](../build/store-listing.fr-FR.json) : description française, assistance, abonnement du service, justification de `runFullTrust` et instructions de certification.

Il reste à :

1. Compléter et publier la politique de confidentialité, puis renseigner son URL ou son texte dans Partner Center. Le brouillon **local uniquement** est `release/store/StorePrivacyDraft.fr-FR.txt`. Les prestataires, transferts, durées de conservation, sauvegardes, bases légales et rôles liés aux données du service web restent à confirmer ; les CGV seules ne remplacent pas ce travail.
2. Prendre des captures de l'application Windows avec les données de démonstration.
3. Vérifier sur un poste Windows 10/11 l'impression, le kiosque et la mise à l'échelle, puis examiner les deux résultats WACK décrits ci-dessous.
4. Compléter les déclarations produit et l'âge recommandé avec les informations réelles. La fiche propose la catégorie **Business** et une application gratuite donnant accès à un service payant, facturé via Stripe. Recontrôler les tarifs avant soumission : le brouillon indique un abonnement à partir de **39 € HT/mois/établissement**.

La [démo partagée](https://caisse.bzh/demo) est accessible sans compte ni paiement via **Aide > Essayer la démo**. Si le panneau d'identification du personnel apparaît, choisir **Continuer sans identification** ; si nécessaire, choisir **Ouvrir le service**. Les ventes sont des données d'entraînement, non comptabilisées, réinitialisées la nuit. Les testeurs n'ont pas besoin du compte personnel de Ben ni d'un mot de passe client.

### 4. Construire avec l'identité définitive et soumettre

Le workflow manuel est [Microsoft Store package](../.github/workflows/store.yml), avec sa configuration [electron-builder.store.cjs](../electron-builder.store.cjs). Il construit un AppX x64 pour Windows 10 **2004 / 10.0.19041.0** ou plus et Windows 11. La version Store actuelle est **1.3.3.0** ; le quatrième numéro doit rester `0`.

Pour refaire une préparation avec installation et certification locale :

```sh
gh workflow run store.yml --ref main \
  -f preparation=true \
  -f test_install=true \
  -f run_wack=true
```

Après attribution de l'identité Store, remplacer les valeurs entre chevrons avant d'exécuter :

```sh
gh workflow run store.yml --ref main \
  -f preparation=false \
  -f identity_name='<Package/Identity/Name exact>' \
  -f publisher='<Package/Identity/Publisher exact>' \
  -f run_wack=true
```

`test_install` est réservé aux builds de préparation : il utilise une copie signée avec un certificat de test temporaire. Les artefacts Actions sont conservés **30 jours**. Pour un build local, Windows et le SDK contenant `mt.exe` sont nécessaires ; les commandes et variables sont dans le [README](../README.md#microsoft-store).

Contrôler le nouveau rapport et le paquet, compléter la fiche puis soumettre l'AppX ayant l'identité définitive à Microsoft. Microsoft signe le paquet après certification ; la validation du compte seule ne vaut pas certification de l'application. Ce workflow ne publie pas de release GitHub et ne nécessite pas de tag. Conserver le tag public `v1.3.3` et ne pas présenter l'AppX de préparation comme un installateur publié.

Après soumission, ajouter ici l'identifiant de soumission, son état réel et, après publication, l'URL Store.

### Build de préparation vérifié

Le [run Windows 37149062622](https://github.com/benfavre/caisse-bzh-desktop/actions/runs/37149062622), construit depuis `e867841e329b4be67fbf27128a14b0e8fe4b4de0`, a passé les **25 tests**, la validation MakeAppx, les contrôles du manifeste et du contenu, puis l'installation et le lancement réels sur un runner Windows Server 2025. Le certificat temporaire et la copie installée ont été retirés ; l'artefact Store reste non signé.

Copie conservée sur ce poste, dans le dépôt local `/home/wd29-pc/dev/caisse-bzh-desktop` :

```text
release/store/final-preparation/caisse-bzh-1.3.3-windows-store-preparation-x64.appx
Taille : 163728270 octets
SHA-256 : c7964a98cb9539b9b9b8fdf1b9b468c2efc9d9697c7d589508f6fbcc13e2c566
```

Le même dossier contient `AppxManifest.xml`, `executable-manifest.xml`, `package-validation.json` et `wack-report.xml`. Ces fichiers sont locaux et ignorés par Git ; les anciens dossiers `preparation` et `validated-preparation` contiennent des versions antérieures. Le `main` de référence avant ce document est `5bbfcbd602124bdf1b1af4820deb24de3935f60c` ; les changements entre le build et ce commit concernent la documentation et la sérialisation du rapport.

Le **Windows App Certification Kit (WACK) 10.0.26100.8249** a exécuté l'ensemble des contrôles : **22 sur 24 réussis**, résultat global **WARNING**, aucun échec obligatoire. Deux points restent à examiner :

| Contrôle | Résultat | Suite nécessaire |
| --- | --- | --- |
| Blocked executables | **FAIL facultatif** : références statiques à des fonctions/processus dans Electron/Chromium et le contenu empaqueté. | Examiner le rapport et les usages réels, puis fournir une justification si Microsoft la demande. Le rendu web n'a pas Node et reste isolé par le sandbox. |
| DPIAwarenessValidation | **WARNING, test non facultatif** : le kit signale un échec de traitement du binaire et une absence de prise en charge DPI. | Le manifeste empaqueté contient bien `PerMonitorV2, PerMonitor`. Vérifier le comportement sur Windows 10/11 et traiter le résultat avec Microsoft si nécessaire ; ce n'est pas un faux positif confirmé. |

Ce résultat ne constitue pas une certification Microsoft réussie. L'essai sur Windows Server ne couvre pas l'impression et la mise à l'échelle sur un poste de caisse réel.

L'édition Store utilise les mises à jour du Store et désactive l'auto-updater GitHub/NSIS. Le **lancement automatique à l'ouverture de Windows est désactivé** dans cette première édition ; une prise en charge native de `StartupTask` serait nécessaire pour l'ajouter. Impression, kiosque et maintien de l'écran allumé restent disponibles.

Références : [exigences des paquets Store et signature](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-package-requirements), [informations d'assistance et confidentialité](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/support-info), [Windows App Certification Kit](https://learn.microsoft.com/en-us/windows/uwp/debug-test-perf/windows-app-certification-kit).

## Signature Windows directe : Azure/AU10TIX

Azure Artifact Signing **Basic**, compte **webdesign29-signing**, région **North Europe**, a été créé. Les rôles **Artifact Signing Identity Verifier** et **Artifact Signing Certificate Profile Signer** ont été attribués à `ben@webdesign29.net` sur ce compte.

La vérification reste **Action required** : deux sessions AU10TIX ont échoué, dont la dernière pendant le contrôle de document/selfie. Aucun Verified ID ni profil de certificat n'a été obtenu ; l'intégration CI de signature Azure n'est pas configurée.

Un courriel de support a été envoyé le **3 octobre 2026 à 20 h 26, heure de Paris**, puis renvoyé à **Support.Tickets@Au10tix.com** après le rejet de l'ancienne adresse. Objet : « Microsoft Artifact Signing: AU10TIX Verified ID enrollment repeatedly fails (France) ». Aucun accusé ni numéro de ticket n'était encore enregistré. Reprendre depuis la boîte de réception `ben@webdesign29.net` ; les références des demandes et la correspondance sont dans le dossier privé indiqué ci-dessous.

**La facturation Azure reste active : 9,99 USD/mois plus taxes**, avec 5 000 signatures incluses ; le service n'a pas été annulé. Le choix du Microsoft Store n'arrête pas cet abonnement. Aucun certificat Certum de remplacement n'a été acheté.

## Reprendre macOS

La [construction de release 37140379936](https://github.com/benfavre/caisse-bzh-desktop/actions/runs/37140379936) a publié **v1.3.3**, avec signature Developer ID, notarisation et contrôles Gatekeeper. Les builds Intel et Apple Silicon nécessitent macOS 13 ou plus. Les utilisateurs d'anciennes versions macOS non signées doivent installer cette version manuellement une fois ; les mises à jour automatiques sont ensuite disponibles.

L'équipe Apple existante est **D64Q94V632**, Benjamin Favre, compte `ben@webdesign29.net`. Réutiliser les cinq secrets Actions déjà configurés : `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_SPECIFIC_PASSWORD`. La correction du trousseau pour electron-builder **26.15.3** est dans [scripts/fix-macos-keychain.cjs](../scripts/fix-macos-keychain.cjs) ; la revoir avant une mise à jour du packager.

## Reprendre Android / Google Play

Le nouveau compte organisation Google Play a été payé. Son propriétaire permanent est **`benfavre@gmail.com`** ; **`ben@webdesign29.net`** a accepté l'accès administrateur avec toutes les permissions. L'association du site `webdesign29.net` a été approuvée dans Search Console. Lors du dernier contrôle, la vérification de l'organisation/identité restait en attente et **Create app** était désactivé ; la vérification du téléphone doit suivre l'approbation.

Reprendre dans [Google Play Console](https://play.google.com/console/) avec ce compte existant. Après validation et vérification du téléphone, créer l'application, configurer Play App Signing en préservant la continuité de la clé Android existante, puis compléter confidentialité, fiche et tests avant soumission. Aucune application Play ni inscription à Play App Signing n'est encore créée.

Le projet Android est sur le serveur, sous `/home/infra-sj278/bext/sites/pos-inklura-prism/android` : paquet **`bzh.caisse.android`**, version **1.0.0**, code **2**, min SDK **30**, cible **36**, SDK Epson **2.37.1**. L'[APK de téléchargement direct](https://caisse.bzh/downloads/caisse-bzh-android-1.0.0.apk) a été vérifié avec la signature de la clé d'origine.

L'AAB local a passé la validation et les six tests unitaires Android :

```text
release/mobile/caisse-bzh-android-1.0.0.aab
Taille : 5343867 octets
SHA-256 : 82bcddb654ba19894bc085a3506ed1a0ddb4a3b069f37c058931c00ce61f0016
```

Il n'est pas soumis au Play Store. La sauvegarde chiffrée du keystore est hors Git dans le dossier privé ; conserver cette clé pour les prochaines versions.

## Reprendre iOS

Le compte Apple renouvelé couvre aussi iOS. L'App ID **`bzh.caisse.ios`**, un certificat **Apple Distribution** et le profil **Caisse BZH App Store 2026** ont été créés. Le profil est conservé sous `caisse-bzh-app-store.mobileprovision` dans le dossier privé.

Aucun projet iOS natif n'a été trouvé, aucune IPA n'a été construite et aucun enregistrement [App Store Connect](https://appstoreconnect.apple.com/) n'a été créé. La suite est donc de retrouver ou réaliser le client iOS adapté, créer l'application App Store Connect, archiver sur macOS avec le profil existant, puis passer par TestFlight et la soumission App Store. Les certificats seuls ne constituent pas un build distribuable.

## Fichiers privés et sources à retrouver

Sur ce poste, le dossier **`/home/wd29-pc/.local/share/webdesign29-signing/2026-10-03/`** contient le registre privé **`signing-state.json`**, les certificats et clés chiffrées, les fichiers de mots de passe, le profil iOS, la sauvegarde Android et les détails du support. Il est hors Git. Consulter ce registre local pour les références détaillées, sans copier les secrets, documents d'identité ou liens de vérification dans ce dépôt public.

Le dépôt courant est **`/home/wd29-pc/dev/caisse-bzh-desktop`**. Le site et le projet Android résident sur le serveur accessible via l'alias SSH **`141.95.202.2-infra-sj278`**, dans **`/home/infra-sj278/bext/sites/pos-inklura-prism`**. Ce dépôt serveur contient de nombreuses modifications non publiées : conserver les changements existants et intervenir uniquement sur les fichiers nécessaires. Le clone local `caisse-bzh-release-source` sert à consulter les sources ; il ne remplace pas cet état de production.

À chaque reprise, mettre à jour la date, les états réellement constatés et les liens de builds/soumissions dans ce document. Le [README](../README.md) reste le point d'entrée.
