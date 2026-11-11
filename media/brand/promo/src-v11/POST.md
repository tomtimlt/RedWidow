# Textes de publication LinkedIn — vidéo V11

Trois propositions en français, trois en anglais. La première ligne est l'accroche
(c'est elle qu'on lit avant « … voir plus »). Aucune promesse hors des sources
(`docs/readme-main/README.md`, `README.fr.md`) : pas de chiffre d'usage, pas de
garantie de résultat, lab fictif `10.10.10.14`.

Couverture à choisir sur LinkedIn : `../redwidow-v11-cover-fr.png` (ou
`../redwidow-v11-cover.png` pour un post en anglais).

## Français

### FR 1 — la démonstration

Une phrase tapée dans VS Code. nmap, whatweb, ffuf, sqlmap s'enchaînent.

C'est RedWidow, une extension VS Code de pentest, open source et gratuite (licence MIT).

Dans la vidéo, sur un lab fictif :
→ l'agent lance les outils dans ton conteneur Kali ou Exegol, et le Monitor suit chaque commande en direct
→ la kill chain relie hôtes, identifiants et étapes, avec leur technique MITRE ATT&CK
→ une carte d'autorisation avant chaque action : Autoriser une fois, Refuser, Toujours. Ou le mode Auto, pour une durée que tu fixes
→ le rapport de constats s'écrit en Markdown
→ bloqué sur une box ? Le mode Apprentissage lit ton cours et ton terminal, donne un indice, et n'exécute rien

Tu branches le modèle de ton choix : Claude, GPT, Ollama.

Version 1.0 en bêta publique, Windows et Linux. Le code est là, une étoile aide beaucoup :
https://github.com/tomtimlt/redwidow

Réservé aux tests autorisés.

#pentest #redteam #cybersécurité #opensource #vscode

### FR 2 — le quotidien du pentesteur

Tes terminaux, ton Monitor, ta kill chain et ton rapport : dans la même fenêtre VS Code.

RedWidow réunit tout ça, pour ne plus jongler entre les onglets pendant un pentest ou une box HackTheBox.

Ce que montre la vidéo (lab fictif) :
• des conteneurs Exegol et Kali préparés depuis le cockpit, terminaux ouverts dedans
• un agent IA qui lance les outils, lit les résultats et propose la suite
• tu le pilotes action par action, ou tu le lâches pour une durée fixée, de 1 minute à 48 heures
• une kill chain que tu peux rejouer étape par étape
• un brouillon de rapport en Markdown

Open source, gratuit, licence MIT. Bêta publique 1.0.

Le dépôt : https://github.com/tomtimlt/redwidow
Si le projet te parle, mets-lui une étoile : c'est ce qui le fait connaître.

Réservé aux tests autorisés.

#pentest #ctf #hackthebox #cybersécurité #opensource

### FR 3 — le mode Apprentissage

Bloqué sur une box ? Elle lit ton terminal. Elle n'exécute rien.

RedWidow a un mode Apprentissage pour les étudiants en cyber et les joueurs de CTF : tu fournis ton cours, tu cites ton terminal avec #, et l'agent te donne un indice plutôt que la réponse. Il cite ses sources. Il n'écrit rien, il ne lance rien.

Et quand tu veux passer à l'action, le même outil lance nmap, ffuf ou sqlmap dans ton conteneur Kali ou Exegol, trace la kill chain et prépare le rapport.

Extension VS Code, open source et gratuite (MIT), bêta publique 1.0.

https://github.com/tomtimlt/redwidow
Une étoile sur GitHub, et tu aides le projet à grandir.

Réservé aux tests autorisés.

#cybersécurité #ctf #hackthebox #étudiants #opensource

## English

### EN 1 — the demo

One sentence typed in VS Code. nmap, whatweb, ffuf and sqlmap run in sequence.

This is RedWidow: a pentest extension for VS Code. Open source, free, MIT license.

In the video, on a fictional lab:
→ the agent runs the tools inside your Kali or Exegol container, and the Monitor follows every command live
→ the kill chain links hosts, credentials and steps, each with its MITRE ATT&CK technique
→ an authorization card before each action: Allow once, Deny, Always. Or Auto mode, for a duration you set
→ the findings report is drafted in Markdown
→ stuck on a box? Learning mode reads your course and your terminal, gives a hint, and never executes

Bring any model: Claude, GPT, Ollama.

Version 1.0, public beta, Windows and Linux. The code is here, and a star helps a lot:
https://github.com/tomtimlt/redwidow

For authorized testing only.

#pentest #redteam #cybersecurity #opensource #vscode

### EN 2 — the pentester's day

Your terminals, your Monitor, your kill chain and your report: in one VS Code window.

RedWidow brings them together, so you stop juggling tabs during a pentest or a HackTheBox machine.

What the video shows (fictional lab):
• Exegol and Kali containers set up from the cockpit, with terminals opened inside
• an AI agent that runs the tools, reads the results and suggests what comes next
• drive it one action at a time, or unleash it for a set duration, from 1 minute to 48 hours
• a kill chain you can replay step by step
• a report draft in Markdown

Open source, free, MIT license. Public beta 1.0.

The repo: https://github.com/tomtimlt/redwidow
If it speaks to you, star it. That is how the project gets found.

For authorized testing only.

#pentest #ctf #hackthebox #cybersecurity #opensource

### EN 3 — Learning mode

Stuck on a box? It reads your terminal. It never executes.

RedWidow has a Learning mode for security students and CTF players: you give it your course, you cite your terminal with #, and the agent gives you a hint instead of the answer. It cites its sources. It writes nothing and runs nothing.

When you are ready to act, the same tool runs nmap, ffuf or sqlmap in your Kali or Exegol container, maps the kill chain and drafts the report.

A VS Code extension, open source and free (MIT), public beta 1.0.

https://github.com/tomtimlt/redwidow
Star it on GitHub and help the project grow.

For authorized testing only.

#cybersecurity #ctf #hackthebox #students #opensource
