# Linux Hosting Guide

The community site is static and can be served by any ordinary HTTP server. No database, container runtime, background worker, or API key is needed.

## Quick local preview

From the directory containing `index.html`:

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080`.

## Basic Linux deployment

1. Use a supported Linux distribution and a non-root deployment account.
2. Copy only the standalone community repository to the host.
3. Serve the repository's static files with Nginx, Caddy, or another maintained HTTP server.
4. Enable automatic security updates where appropriate.
5. Keep SSH access restricted and use key-based authentication.
6. Do not place secrets or production configuration in the web root.
7. Monitor uptime, disk usage, and security updates.

## Nginx example

Replace `/srv/midad-community` with the actual deployment directory.

```nginx
server {
    listen 80;
    server_name _;
    root /srv/midad-community;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }

    location ~ /\\. {
        deny all;
    }
}
```

Use HTTPS with a valid certificate before exposing a public deployment. This guide is for the static community demonstration only, not production MIDAD services.
