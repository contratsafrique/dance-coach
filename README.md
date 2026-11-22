# Dance Coach (prototype)
Analyse une vidéo de salsa compte par compte : 4 fenêtres synchronisées (originale, décryptée, haut du corps, pieds),
affichage 4 fenêtres ou 1 seule, explications en français, anglais et espagnol.

- Détection des corps : MediaPipe (dans le navigateur, gratuit)
- Rythme : détection automatique + calage du 1 à la main
- Décryptage : Gemini (une image par compte, 48 comptes max, 60 s max)

Variables d'environnement Vercel :
- APP_PASSWORD (Secret) — mot de passe de l'appli
- GEMINI_API_KEY (Secret)
- GEMINI_MODEL (Config, optionnel, défaut gemini-flash-latest)
