FROM kalilinux/kali-rolling:latest
WORKDIR /workspace
RUN printf 'Acquire::Retries "2";\nAcquire::http::Timeout "30";\nAcquire::https::Timeout "30";\n' > /etc/apt/apt.conf.d/80warband-network \
    && for source in /etc/apt/sources.list /etc/apt/sources.list.d/*.sources /etc/apt/sources.list.d/*.list; do \
        if [ -f "$source" ]; then sed -i 's|://http\.kali\.org/kali|://kali.download/kali|g' "$source"; fi; \
    done \
    && printf '#!/bin/sh\nexit 101\n' > /usr/sbin/policy-rc.d \
    && chmod +x /usr/sbin/policy-rc.d \
    && apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends kali-linux-headless python3 mcp-kali-server nmap libcap2-bin curl bind9-dnsutils iproute2 jq subfinder httpx-toolkit nuclei \
    && if [ -f /usr/lib/nmap/nmap ]; then setcap cap_net_bind_service,cap_net_raw=eip /usr/lib/nmap/nmap; fi \
    && apt-get clean && rm -rf /var/lib/apt/lists/*
CMD ["/bin/bash"]
