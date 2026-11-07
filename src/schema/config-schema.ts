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
        forms: {
          type: "object",
          description:
            "Public form behaviour (forms are defined in forms/*.yaml). Needs no admin plugin.",
          properties: {
            honeypot: {
              type: "string",
              default: "_hp",
              description: "Spam-trap field name; a submission that fills it is silently discarded",
            },
            notifications: {
              type: "object",
              description: "Sent after each stored submission",
              properties: {
                email: {
                  type: "object",
                  required: ["to"],
                  description: "Sent through site.email",
                  properties: {
                    to: {
                      oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
                    },
                    subject: { type: "string", description: "{form} is replaced by the form name" },
                    from: { type: "string", description: "Defaults to site.email.from" },
                  },
                },
                webhook: {
                  type: "object",
                  required: ["url"],
                  properties: {
                    url: { type: "string" },
                    secret: { type: "string", description: "HMAC-SHA256 signing secret; supports $ENV_VAR" },
                    allow_private: { type: "boolean", default: false },
                  },
                },
              },
            },
          },
        },
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
            fail_on_startup: {
              type: "boolean",
              default: false,
              description:
                "Stop startup when a search engine fails to build. Default: log it, retry in the background, and fall back to the built-in engine.",
            },
            analytics: {
              type: "boolean",
              default: false,
              description:
                "Record GET /api/search queries (text and result count) to system.runtime_dir/search-analytics.json (bounded counters, not a request log) for top-query and zero-result reports. Off by default: it contains what visitors typed.",
            },
            custom_fields: {
              type: "array",
              items: { type: "string" },
              description: "Additional frontmatter fields to include in search index",
            },
            fields: {
              type: "object",
              description: "Per-field relevance weights (title, summary, body, or a custom field). Default weight: 1.",
              additionalProperties: {
                type: "object",
                properties: { weight: { type: "number" } },
                required: ["weight"],
              },
            },
            highlight: {
              type: "boolean",
              default: true,
              description: "Return excerpts with matched terms wrapped in <mark>.",
            },
            excerpt_length: {
              type: "integer",
              minimum: 1,
              default: 160,
              description: "Character length of returned excerpts.",
            },
            page_size: {
              type: "integer",
              minimum: 1,
              description:
                "Default results per page when a request doesn't specify limit, applied to both /api/search and the SSR /search route. Unset falls back to 20 for /api/search and 50 for SSR.",
            },
          },
        },
        metrics: {
          type: "object",
          properties: {
            enabled: { type: "boolean", default: true },
            slow_query_threshold_ms: { type: "integer", minimum: 0, default: 100 },
          },
        },
        typography: {
          type: "object",
          properties: {
            orphan_protection: { type: "boolean", default: true },
          },
        },
        debug: { type: "boolean", default: false },
        data_dir: {
          type: "string",
          default: "data",
          description:
            "Persistent data directory (git-tracked): form submissions, admin users. Replaces admin.dataDir.",
        },
        runtime_dir: {
          type: "string",
          default: ".dune/admin",
          description:
            "Machine-local runtime state (gitignored): job state, revision history, scheduled actions, search analytics. Replaces admin.runtime_dir.",
        },
        max_revisions: {
          type: "integer",
          minimum: 0,
          default: 50,
          description: "Revisions kept per page (0 keeps all). Replaces admin.max_revisions.",
        },
        webhooks: {
          type: "object",
          description: "Webhooks that need no admin plugin",
          properties: {
            incoming: {
              type: "array",
              description:
                "Tokens that let external systems POST to /api/webhook/incoming to trigger actions",
              items: {
                type: "object",
                required: ["token", "actions"],
                properties: {
                  token: { type: "string", description: 'Secret token; supports "$ENV_VAR" expansion' },
                  actions: {
                    type: "array",
                    items: { type: "string", enum: ["rebuild", "purge-cache"] },
                  },
                },
              },
            },
          },
        },
        trusted_proxies: {
          type: "boolean",
          default: false,
          description:
            "Trust X-Forwarded-For headers. Enable only behind a known reverse proxy. When false, client IP is the TCP peer.",
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
        name: { type: "string", description: "Active theme name (local folder or registered package)" },
        src: {
          type: "string",
          description: "When set, load the active theme from this pinned jsr:/npm: package",
        },
        parent: {
          type: "string",
          description: "Parent theme — local name, import alias, or pinned jsr:/npm: specifier",
        },
        custom: {
          type: "object",
          description: "Theme-specific settings passed to templates",
          additionalProperties: true,
        },
      },
    },

    themes: {
      type: "array",
      description: "Installed theme packages (JSR/npm)",
      items: {
        type: "object",
        required: ["name", "src"],
        properties: {
          name: { type: "string", description: "Logical theme name" },
          src: { type: "string", description: "Pinned jsr:/npm: specifier or local path" },
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
              integrity: {
                type: "string",
                description:
                  "Required for https: src. sha256:<64 hex> or SRI sha256-<base64>.",
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
        session_lifetime: {
          type: "integer",
          minimum: 0,
          default: 86400,
          description: "Admin session TTL in seconds",
        },
        max_upload_mb: { type: "integer", minimum: 1, default: 100 },
        git_commit: {
          type: "boolean",
          default: false,
          description: "Auto-commit page saves via git",
        },
        audit: {
          type: "object",
          properties: {
            enabled: { type: "boolean", default: true },
            log_file: { type: "string", description: "Path to JSONL audit log file" },
          },
        },
        auth_provider: {
          type: "object",
          description:
            "Auth provider. Only the built-in local password auth is configurable (omit this, or type: local); LDAP and SAML are not supported. Inject a custom provider through the admin plugin's authProvider option.",
          properties: {
            type: { type: "string", enum: ["local"] },
          },
          required: ["type"],
          additionalProperties: false,
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
                    "onPageMove",
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
      },
    },
  },
} as const;
