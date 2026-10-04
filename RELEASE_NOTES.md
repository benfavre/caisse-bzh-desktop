# caisse.bzh 1.4.0

- Après une coupure, une ancienne tentative de reconnexion ne recharge plus une caisse ou une cuisine déjà rouverte.
- Les mises à jour attendent un état récent sans commande ouverte, service en cours, paiement incertain ou travail à synchroniser.
- Les ventes hors ligne et les commandes enregistrées en attente conservent une copie locale indépendante du stockage du navigateur. Après perte de ce stockage, les demandes retrouvent leur identité initiale pour éviter de les envoyer comme de nouvelles opérations.
- L’impression utilise le document de caisse et mémorise la soumission avant de contacter le système. Un résultat inconnu ne provoque pas de renvoi automatique.
- Les rapports de poste impriment les montants du comptage signé et des copies explicitement marquées, avec protection contre le renvoi du même document après une interruption.
- Les sauvegardes volumineuses vérifient toutes leurs parties avant de remplacer la copie précédente. Les parties remplacées et les fragments inutilisés d’une copie interrompue sont ensuite nettoyés en arrière-plan ; les journaux de ventes restent conservés. Les fichiers temporaires laissés par une interruption sont aussi retirés lorsqu’une copie identique est déjà sauvegardée et vérifiée ; les fichiers uniques ou endommagés sont préservés.
- Le minimum macOS est corrigé à macOS 13, conformément à la version Electron embarquée.

Le fonctionnement hors ligne nécessite une première connexion et la préparation du poste. Les échanges entre appareils pendant une coupure internet nécessitent leur réseau local et un appairage direct préparé dans la caisse. La soumission au système d’impression ne confirme pas la sortie papier.

Les signatures Mac et la validation Apple introduites en 1.3.3 sont conservées. Pour remplacer une ancienne version non signée, installez une fois la nouvelle application depuis caisse.bzh/telecharger.
