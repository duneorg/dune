/**
 * JSON Schema for site.yaml / Dune configuration.
 *
 * Derived from src/config/types.ts. Used by:
 *   - GET /_dune/schema/config   (runtime endpoint)
 *   - dune schema:export          (CLI command)
 *
 * Schema version bumps with the config format, not necessarily with Dune's
 * version. Bump SCHEMA_VERSION when a breaking change is made to the format.
 */

export const SCHEMA_VERSION = "1.0";

/** JSON Schema (draft-07) describing site.yaml. */
export const CONFIG_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://dune.dev/schema/config/1.0",
  title: "Dune site.yaml configuration",
  description:
    "Configuration schema for Dune CMS site.yaml files. All fields are optional unless noted.",
  type: "object",
  properties: {
    site: {
      type: "object",
      description: "Site identity and content settings",
      required: ["title"],
      properties: {
        title: { type: "string", description: "Site title" },
        description: { type: "string", description: "Site meta description" },
        url: {
          type: "string",
          format: "uri",
          description: "Canonical site URL (e.g. https://example.com)",
        },
        author: {
          type: "object",
          properties: {
            name: { type: "string" },
            email: { type: "string", format: "email" },
          },
          required: ["name"],
        },
        home: {
          type: "string",
          description:
            "Folder slug or route that serves as homepage. Autodetected if omitted.",
        },
        metadata: {
          type: "object",
          additionalProperties: { type: "string" },
          description: "Arbitrary key/value metadata added to all pages",
        },
        taxonomies: {
          type: "array",
          items: { type: "string" },
          description: "Taxonomy field names (e.g. [tags, category])",
        },
        routes: {
          type: "object",
          additionalProperties: { type: "string" },
          description: "Route aliases: { '/old': '/new' }",
        },
        redirects: {
          type: "object",
          additionalProperties: { type: "string" },
          description: "301 redirects: { '/old': '/new' }",
        },
        cors_origins: {
          type: "array",
          items: { type: "string", format: "uri" },
          description:
            "Additional origins allowed for cross-origin API requests",
        },
        trusted_html: {
          type: "boolean",
          default: false,
          description:
            "Trust raw HTML in authored content. Only use when all authors are trusted.",
        },
        feed: {
          type: "object",
          properties: {
            enabled: { type: "boolean", default: true },
            items: {
              type: "integer",
              minimum: 1,
              default: 20,
              description: "Number of items per feed, newest-first",
            },
            content: {
              type: "string",
              enum: ["summary", "full"],
              default: "summary",
            },
          },
        },
        http_cache: {
          type: "object",
          properties: {
            default_max_age: {
              type: "integer",
              minimum: 0,
              default: 0,
              description: "Default Cache-Control max-age in seconds",
            },
            default_swr: {
              type: "integer",
              minimum: 0,
              default: 60,
              description: "Default stale-while-revalidate in seconds",
            },
            rules: {
              type: "array",
              items: {
                type: "object",
                required: ["pattern"],
                properties: {
                  pattern: { type: "string" },
                  max_age: { type: "integer", minimum: 0 },
                  stale_while_revalidate: { type: "integer", minimum: 0 },
                  no_store: { type: "boolean" },
                },
              },
            },
          },
        },
        sitemap: {
          type: "object",
          properties: {
            exclude: {
              type: "array",
              items: { type: "string" },
              description: "Route prefixes to exclude from sitemap",
            },
            changefreq: {
              type: "object",
              additionalProperties: {
                type: "string",
                enum: [
                  "always",
                  "hourly",
                  "daily",
                  "weekly",
                  "monthly",
                  "yearly",
                  "never",
                ],
              },
            },
          },
        },
        workflow: {
          type: "object",
          description: "Custom editorial workflow stages and transitions",
          required: ["stages", "transitions"],
          properties: {
            stages: {
              type: "array",
              items: {
                type: "object",
                required: ["id", "label"],
                properties: {
                  id: { type: "string" },
                  label: { type: "string" },
                  color: { type: "string" },
                  publish: { type: "boolean", default: false },
                },
              },
            },
            transitions: {
              type: "array",
              items: {
                type: "object",
                required: ["from", "to", "label"],
                properties: {
                  from: { type: "string" },
                  to: { type: "string" },
                  label: { type: "string" },
                  roles: { type: "array", items: { type: "string" } },
                },
              },
            },
          },
        },
      },
    },

    system: {
      type: "object",
      description: "Engine behavior settings",
      properties: {
        content: {
          type: "object",
          properties: {
            dir: {
              type: "string",
              default: "content",
              description: "Content directory path",
            },
            markdown: {
              type: "object",
              properties: {
                extra: { type: "boolean", default: true },
                auto_links: { type: "boolean", default: true },
                auto_url_links: { type: "boolean", default: false },
              },
            },
          },
        },
        cache: {
          type: "object",
          properties: {
            enabled: { type: "boolean", default: true },
            driver: {
              type: "string",
              enum: ["memory", "filesystem", "kv"],
              default: "memory",
            },
            lifetime: {
              type: "integer",
              minimum: 0,
              default: 300,
              description: "Cache TTL in seconds",
            },
            check: {
              type: "string",
              enum: ["file", "hash", "none"],
              default: "file",
            },
          },
        },
        page_cache: {
          type: "object",
          description: "In-process rendered HTML page cache (server mode only)",
          properties: {
            enabled: { type: "boolean", default: false },
            max_entries: { type: "integer", minimum: 1, default: 500 },
            ttl: {
              type: "integer",
              minimum: 1,
              default: 30,
              description: "Entry TTL in seconds",
            },
            warm: {
              type: "boolean",
              default: false,
              description: "Pre-render all pages at startup",
            },
          },
        },
        images: {
          type: "object",
          properties: {
            default_quality: { type: "integer", minimum: 1, maximum: 100, default: 80 },
            cache_dir: { type: "string", default: ".dune/images" },
            allowed_sizes: {
              type: "array",
              items: { type: "integer", minimum: 1 },
              default: [400, 800, 1200, 1600],
            },
          },
        },
        languages: {
          type: "object",
          properties: {
            supported: {
              type: "array",
              items: { type: "string" },
              description: "Language codes to detect in filenames (e.g. [en, de, fr])",
            },
            default: { type: "string", description: "Default language code" },
            include_default_in_url: { type: "boolean", default: false },
            rtl_override: {
              type: "array",
              items: { type: "string" },
              description: "Additional language codes to treat as RTL",
            },
          },
        },
        search: {
          type: "object",
          properties: {
            customFields: {
              type: "array",
              items: { type: "string" },
              description: "Additional frontmatter fields to include in search index",
            },
          },
        },
        metrics: {
          type: "object",
          properties: {
            enabled: { type: "boolean", default: true },
            slowQueryThresholdMs: { type: "integer", minimum: 0, default: 100 },
          },
        },
        typography: {
          type: "object",
          properties: {
            orphan_protection: { type: "boolean", default: true },
          },
        },
        debug: { type: "boolean", default: false },
        timezone: {
          type: "string",
          default: "UTC",
          description: "IANA timezone name (e.g. America/New_York)",
        },
        trusted_proxies: {
          type: "boolean",
          default: false,
          description:
            "Trust X-Forwarded-For headers. Enable only behind a known reverse proxy.",
        },
        health_token: {
          type: "string",
          description: "Token to gate /health?detailed=true responses",
        },
      },
    },

    theme: {
      type: "object",
      description: "Theme settings",
      required: ["name"],
      properties: {
        name: { type: "string", description: "Active theme name (folder under themes/)" },
        parent: {
          type: "string",
          description: "Parent theme name for inheritance",
        },
        custom: {
          type: "object",
          description: "Theme-specific settings passed to templates",
          additionalProperties: true,
        },
      },
    },

    plugins: {
      type: "array",
      description: "Ordered list of plugins to load",
      items: {
        type: "object",
        oneOf: [
          {
            required: ["src"],
            properties: {
              src: {
                type: "string",
                description: "Local path or registry specifier (jsr:, npm:, https:)",
              },
              config: {
                type: "object",
                additionalProperties: true,
                description: "Static plugin config",
              },
            },
          },
          {
            required: ["spec"],
            properties: {
              spec: {
                type: "string",
                description: "Registry specifier (jsr:@scope/name@^version)",
              },
              config: {
                type: "object",
                additionalProperties: true,
              },
            },
          },
        ],
      },
    },

    admin: {
      type: "object",
      description: "Admin panel settings",
      properties: {
        enabled: { type: "boolean", default: true },
        path: {
          type: "string",
          default: "/admin",
          description: "Admin panel route prefix (e.g. /admin, /cms)",
        },
        sessionLifetime: {
          type: "integer",
          minimum: 0,
          default: 86400,
          description: "Admin session TTL in seconds",
        },
        dataDir: { type: "string", default: "data" },
        runtimeDir: { type: "string", default: ".dune/admin" },
        maxRevisions: { type: "integer", minimum: 0, default: 50 },
        honeypot: { type: "string", default: "_hp" },
        maxUploadMb: { type: "integer", minimum: 1, default: 100 },
        git_commit: {
          type: "boolean",
          default: false,
          description: "Auto-commit page saves via git",
        },
        audit: {
          type: "object",
          properties: {
            enabled: { type: "boolean", default: true },
            logFile: { type: "string", description: "Path to JSONL audit log file" },
          },
        },
        auth_provider: {
          type: "object",
          description: "External auth provider (LDAP, SAML). Omit for built-in local auth.",
          properties: {
            type: { type: "string", enum: ["ldap", "saml"] },
          },
          required: ["type"],
          additionalProperties: true,
        },
        webhooks: {
          type: "array",
          description: "Outbound webhook endpoints for content events",
          items: {
            type: "object",
            required: ["url", "events"],
            properties: {
              url: { type: "string", format: "uri" },
              secret: { type: "string" },
              events: {
                type: "array",
                items: {
                  type: "string",
                  enum: [
                    "onPageCreate",
                    "onPageUpdate",
                    "onPageDelete",
                    "onWorkflowChange",
                  ],
                },
              },
              enabled: { type: "boolean", default: true },
              label: { type: "string" },
              allow_private: { type: "boolean", default: false },
            },
          },
        },
        incoming_webhooks: {
          type: "array",
          description: "Incoming webhook tokens for external triggers",
          items: {
            type: "object",
            required: ["token", "actions"],
            properties: {
              token: { type: "string" },
              actions: {
                type: "array",
                items: { type: "string", enum: ["rebuild", "purge-cache"] },
              },
            },
          },
        },
      },
    },
  },
} as const;
