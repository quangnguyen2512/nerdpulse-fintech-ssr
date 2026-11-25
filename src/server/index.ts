import { createMarketplaceApp } from './app.js';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';

const { server } = createMarketplaceApp();

server.listen(port, host, () => {
  console.log(
    `[nerdpulse] Consumer Banking SSR Marketplace listening at http://${host}:${port}`,
  );
  console.log(
    `[nerdpulse] Endpoints: / | /api/products | /api/audit | /api/telemetry/summary | /sitemap.xml | /robots.txt`,
  );
});
