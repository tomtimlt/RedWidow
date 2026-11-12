#!/usr/bin/env node
import { ConfigError, loadConfig } from "./config.js";
import { createServer } from "./http.js";

function serve(): void {
  const config = loadConfig(process.env);
  const server = createServer(config);
  server.listen(config.port, config.host, () => {
    // Ligne de démarrage : adresse et dossier seulement, aucun secret.
    console.log(
      `redwidow-server : écoute sur http://${config.host}:${config.port} (données : ${config.dataDir})`,
    );
  });
  const stop = () => {
    server.close(() => process.exit(0));
    server.closeAllConnections();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

const command = process.argv[2] ?? "serve";
try {
  if (command !== "serve") {
    console.error(`redwidow-server : sous-commande inconnue « ${command} » (attendu : serve)`);
    process.exit(2);
  }
  serve();
} catch (err) {
  console.error(
    `redwidow-server : ${err instanceof ConfigError ? err.message : "échec du démarrage"}`,
  );
  process.exit(1);
}
