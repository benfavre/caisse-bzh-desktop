# caisse.bzh 1.4.0

- Les mises à jour attendent un état récent sans commande ouverte, service en cours, paiement incertain ou travail à synchroniser.
- Chaque vente encaissée hors ligne conserve une copie locale indépendante du stockage du navigateur, récupérable par la caisse après perte de ce stockage.
- L’impression utilise le document de caisse et mémorise la soumission avant de contacter le système. Un résultat inconnu ne provoque pas de renvoi automatique.
- Le minimum macOS est corrigé à macOS 13, conformément à la version Electron embarquée.

Le fonctionnement hors ligne nécessite une première connexion et la préparation du poste. Deux appareils déconnectés ne peuvent pas recevoir mutuellement leurs commandes. La soumission au système d’impression ne confirme pas la sortie papier.
