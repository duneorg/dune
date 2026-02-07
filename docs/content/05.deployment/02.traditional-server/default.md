---
title: "Traditional Server"
published: true
visible: true
taxonomy:
  audience: [webmaster]
  difficulty: [intermediate]
  topic: [deployment, server]
metadata:
  description: "Deploying Dune on a traditional VPS or server"
---

# Traditional Server

Run Dune on any machine with Deno installed — a VPS, a dedicated server, or your own hardware.

## Production setup

### 1. Install Deno

```bash
curl -fsSL https://deno.land/install.sh | sh
```

### 2. Clone and configure

```bash
git clone https://github.com/you/my-site.git
cd my-site
```

Set up production config:

`config/env/production/system.yaml`:
```yaml
debug: false
cache:
  enabled: true
  driver: "filesystem"
  lifetime: 7200
  check: "file"
```

### 3. Build and serve

```bash
# Build the content index
DUNE_ENV=production dune build

# Start the server
DUNE_ENV=production dune serve --port 8000
```

### 4. Reverse proxy

Put Dune behind nginx or Caddy for HTTPS and static asset caching:

```nginx
server {
    server_name example.com;
    listen 443 ssl;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Serve static files directly
    location /static/ {
        root /path/to/my-site;
        expires 30d;
    }
}
```

## Process management

Use systemd or a process manager to keep Dune running:

```ini
# /etc/systemd/system/dune.service
[Unit]
Description=Dune CMS
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/path/to/my-site
Environment=DUNE_ENV=production
ExecStart=/home/user/.deno/bin/deno run -A src/main.ts serve --port 8000
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

## Updating content

On a traditional server, content lives on the filesystem. Update it however you like:

- **Git pull**: `git pull origin main && dune cache:rebuild`
- **rsync**: Sync from a local machine
- **SFTP**: Upload changed files
- **Admin panel**: When available (v0.2)

After updating content, rebuild the index:

```bash
dune cache:rebuild
```

Or run in dev mode which watches for changes automatically.
