/** Préparation humaine uniquement : adapte les capacités du paquet Nmap à Docker, sans en ajouter au conteneur. */
export const KALI_NMAP_COMPATIBILITY_SCRIPT = String.raw`
import os, re, shutil, subprocess, sys

nmap = shutil.which("nmap")
if nmap is None:
    sys.exit(0)

def version():
    try:
        return subprocess.run([nmap, "--version"], capture_output=True, text=True)
    except OSError as error:
        return subprocess.CompletedProcess([nmap], 126, "", str(error))

result = version()
if result.returncode == 0:
    sys.exit(0)

getcap = shutil.which("getcap")
setcap = shutil.which("setcap")
known = {"cap_net_bind_service": 10, "cap_net_admin": 12, "cap_net_raw": 13}
if getcap and setcap:
    with open("/proc/self/status", encoding="utf-8") as status:
        match = re.search(r"^CapBnd:\s*([0-9a-fA-F]+)$", status.read(), re.M)
    if match:
        bound = int(match.group(1), 16)
        for path in ("/usr/lib/nmap/nmap", "/usr/bin/nmap"):
            if not os.path.isfile(path):
                continue
            listed = subprocess.run([getcap, path], capture_output=True, text=True)
            caps = listed.stdout.strip().partition(" ")[2]
            match_caps = re.fullmatch(r"(cap_[a-z_,]+)=([eip]+)", caps)
            if listed.returncode != 0 or match_caps is None:
                continue
            requested = match_caps.group(1).split(",")
            if not requested or any(cap not in known for cap in requested):
                continue
            retained = [cap for cap in requested if bound & (1 << known[cap])]
            if retained == requested:
                continue
            args = [setcap, ",".join(retained) + "=" + match_caps.group(2), path] if retained else [setcap, "-r", path]
            fixed = subprocess.run(args, capture_output=True, text=True)
            if fixed.returncode != 0:
                sys.stderr.write("Impossible d'adapter les capacites du binaire Nmap.\n")
                sys.exit(46)
            print("Nmap : capacites incompatibles retirees, capacites Docker inchangees.")

result = version()
if result.returncode != 0:
    sys.stderr.write(result.stderr or "Nmap ne peut pas etre execute dans ce conteneur.\n")
    sys.exit(46)
`;
