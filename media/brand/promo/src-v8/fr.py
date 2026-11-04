# Version française de la V7 et de la V8 : légendes de la pub et textes de l'interface.
# L'interface réelle est en français : les libellés reprennent ceux du produit
# (Supervisé, Rejouer, Votre consigne…), le lab fictif est traduit.
import re

NB = '&nbsp;'  # espace insécable avant ? et : dans les légendes

# Légendes du film (texte anglais exact → français)
CAP = {
    '<b>&gt;</b> 23 terminals open': '<b>&gt;</b> 23 terminaux ouverts',
    '<b>&gt;</b> nmap output lost in a .txt': '<b>&gt;</b> la sortie nmap perdue dans un .txt',
    '<b>&gt;</b> notes in four different apps': '<b>&gt;</b> des notes dans quatre applis',
    '<b>&gt;</b> report due tomorrow': '<b>&gt;</b> le rapport à rendre demain',
    'AI-native pentest workspace · in VS Code': 'L’atelier de pentest dopé à l’IA · dans VS Code',
    'Recon': 'Repérage', 'Analysis': 'Analyse', 'Action': 'Action', 'Report': 'Rapport', 'Learn': 'Apprendre',
    'Give it': 'Donne-lui', 'a target.': 'une cible.', 'It runs the scans': 'Elle lance les scans',
    'Live,': 'En direct,', 'in your Kali.': 'dans ta Kali.',
    'It maps': 'Elle trace', 'the kill chain.': 'la kill chain.',
    'Scan': 'Du scan', 'to root.': 'au root.',
    'Drive it.': 'Pilote-la.', 'Step by step · ROE Supervised': 'Pas à pas · ROE Supervisé',
    'Or': 'Ou', 'unleash': 'lâche', 'it.': 'la bête.', 'Full auto · ROE Automatic': 'Plein auto · ROE Automatique',
    'It writes': 'Elle écrit', 'the report.': 'le rapport.', 'Findings · severities · Markdown draft': 'Constats · gravités · brouillon Markdown',
    'Learning mode': 'Mode Apprentissage', 'Stuck on': 'Bloqué sur', 'a box?': 'une box' + NB + '?',
    'It studies': 'Elle étudie', 'with you.': 'avec toi.',
    'It reads': 'Elle lit', 'your terminal.': 'ton terminal.', 'It points': 'Elle pointe', 'to the flaw.': 'la faille.',
    'Stuck?': 'Bloqué' + NB + '?', 'Not for long.': 'Plus pour longtemps.',
    'Bring any model': 'Branche le modèle de ton choix',
    'All of it.': 'Tout ça.', 'Open source.': 'Open source.', 'Free.': 'Gratuit.',
    'For authorized testing only.': 'Réservé aux tests autorisés.',
    # V8 : accroche, verbes de chasse, récapitulatif
    'For pentesters · inside VS Code': 'Pour les pentesteurs · dans VS Code',
    'Your target': 'Ta cible', 'is already': 'est déjà', 'in the web.': 'dans la toile.', 'target': 'cible',
    'Weave.': 'Tisse.', 'Watch.': 'Guette.', 'Strike.': 'Frappe.', 'Wrap.': 'Emballe.', 'Learn.': 'Apprends.',
}

# Interface (nœud texte exact → français)
UI = {
    # en-tête, rail, compositeur
    'Supervised': 'Supervisé', 'Learning': 'Apprentissage', 'Automatic': 'Automatique',
    'History': 'Historique', 'New': 'Nouvelle', 'Recon': 'Repérage', 'Analysis': 'Analyse', 'Report': 'Rapport',
    'Copy': 'Copier', 'Configure': 'Configurer', 'Balanced model': 'Modèle équilibré', 'done': 'réussi', 'read': 'lu',
    # Monitor
    '3 commands': '3 commandes', 'Follow': 'Suivi', 'approved': 'approuvé',
    'Live output. Click an entry to follow it read-only.': 'Sortie en direct. Cliquer une entrée pour la suivre en lecture seule.',
    # kill chain
    'Fit': 'Ajuster', 'Export draft': 'Exporter le brouillon', 'Export image': 'Exporter l’image', 'Replay': 'Rejouer',
    'Admin panel :8080': 'Panneau admin :8080', 'Default accounts': 'Comptes par défaut', 'SSH brute force': 'Force brute SSH',
    'SQLi on /login confirmed': 'SQLi sur /login confirmée', 'www-data shell via webshell': 'Shell www-data via webshell',
    'Root escalation': 'Élévation root', 'host · T1046': 'hôte · T1046', 'credential · T1078': 'identifiant · T1078',
    'step · T1190': 'étape · T1190', 'step · T1059': 'étape · T1059',
    'Legend': 'Légende', 'Host': 'Hôte', 'Credential': 'Identifiant', 'Step': 'Étape', 'State': 'État',
    'Confirmed': 'Confirmé', 'Hypothesis': 'Hypothèse', 'Failed': 'Échec',
    'Selected path: green links marked by the agent or by you. Select a link to edit it.': 'Chemin retenu : liens verts marqués par l’agent ou par vous. Sélectionnez un lien pour le modifier.',
    # accueil
    'Where do we start?': 'On commence par où ?', 'Describe the target. Every sensitive action asks for your approval.': 'Décris la cible. Chaque action sensible demande ton accord.',
    'Run recon on 10.10.10.14': 'Fais le repérage de 10.10.10.14', 'Explain this nmap output': 'Explique cette sortie nmap',
    'Draft the report from my findings': 'Rédige le rapport à partir de mes constats',
    # chat de l'agent (Repérage)
    'Recon 10.10.10.14 and find me a way in.': 'Repère 10.10.10.14 et trouve-moi une entrée.',
    'On it. Scanning the target from': 'C’est parti. Je scanne la cible depuis',
    'Way in: SQL injection on /login': 'Entrée : injection SQL sur /login',
    'sqlmap confirms a boolean-based injection on the': 'sqlmap confirme une injection booléenne sur le paramètre',
    'parameter of the admin panel.': 'du panneau admin.',
    'Admin panel on': 'Panneau admin sur', ', no rate limit on': ', aucune limite de tentatives sur',
    'Next: pull the admin hash, then try it on SSH': 'Ensuite : récupérer le hash admin, puis l’essayer sur SSH',
    # chat en bypass et rapport
    'Run recon on 10.10.10.14 and suggest an attack path.': 'Fais le repérage de 10.10.10.14 et propose un chemin d’attaque.',
    'I will scan the target from the Kali container, then check the exposed services.': 'Je scanne la cible depuis le conteneur Kali, puis je vérifie les services exposés.',
    'Attack surface identified': 'Surface d’attaque identifiée', 'Two exposed services:': 'Deux services exposés :',
    'SSH and an admin panel': 'SSH et un panneau admin', '/login form has no attempt limit': 'Le formulaire /login ne limite pas les tentatives',
    'The user parameter is echoed in the SQL error': 'Le paramètre user est renvoyé dans l’erreur SQL',
    'Status': 'État', 'filtered': 'filtré', 'to test': 'à tester',
    'Findings report': 'Rapport de constats', '4 findings': '4 constats', '1 high · 1 medium · 1 low · 1 info': '1 élevée · 1 moyenne · 1 faible · 1 info',
    'High': 'Élevée', 'Medium': 'Moyenne', 'Low': 'Faible',
    'SQL injection on /login': 'Injection SQL sur /login', 'http://10.10.10.14:8080 · user parameter': 'http://10.10.10.14:8080 · paramètre user',
    'Admin panel without rate limiting': 'Panneau admin sans limite de tentatives', '/login · brute force possible': '/login · force brute possible',
    'Verbose server banner': 'Bannière serveur trop bavarde', 'Werkzeug 3.0.1 disclosed': 'Werkzeug 3.0.1 divulgué',
    'SSH open to the lab network': 'SSH ouvert sur le réseau du lab',
    # Apprentissage
    'I am stuck on privilege escalation. Here is my course': 'Je bloque sur l’élévation de privilèges. Voici mon cours',
    '. Look at my terminal, I cannot see anything exploitable.': '. Regarde mon terminal, je ne vois rien d’exploitable.',
    'I am reading your terminal session and chapter 4 of your course. Learning mode: I run nothing.': 'Je lis ta session de terminal et le chapitre 4 de ton cours. Mode Apprentissage : je n’exécute rien.',
    'Reading terminal': 'Lecture du terminal', 'kali-1 · 16 lines': 'kali-1 · 16 lignes',
    'Reading course': 'Lecture du cours', 'privesc-linux.pdf · chapter 4': 'privesc-linux.pdf · chapitre 4',
    'The lead is already in your terminal': 'La piste est déjà dans ton terminal',
    'Your SUID search only returns standard binaries: nothing unusual there. But your last command,': 'Ta recherche SUID ne renvoie que des binaires standard : rien d’anormal. Mais ta dernière commande,',
    ', shows that': ', montre que', 'dev can run /usr/bin/find as root without a password': 'dev peut lancer /usr/bin/find en root sans mot de passe',
    'Your course covers it in §4.2, “Binaries allowed through sudo”.': 'Ton cours en parle au §4.2, « Binaires autorisés via sudo ».',
    'Check which option of': 'Regarde quelle option de', 'runs a command, then look up': 'lance une commande, puis cherche',
    'on GTFOBins.': 'sur GTFOBins.', 'Give it a try, and paste the output if you are still stuck.': 'Essaie, et colle la sortie si tu bloques encore.',
}

def ui(markup):
    """Traduit les nœuds texte exacts et le texte indicatif du compositeur."""
    def text(m):
        raw = m.group(1); s = raw.strip()
        if s in UI: raw = raw.replace(s, UI[s])
        return '>' + raw + '<'
    out = re.sub(r'>([^<>]+)<', text, markup)
    return out.replace('placeholder="Your prompt…"', 'placeholder="Votre consigne…"')

def cap(txt):
    return CAP.get(txt, txt)
