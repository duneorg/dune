/**
 * Built-in XSL stylesheet for sitemap.xml browser display.
 * Served at /sitemap.xsl — referenced by the <?xml-stylesheet?> PI in sitemap.xml.
 */
export const SITEMAP_XSL = `<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:sitemap="http://www.sitemaps.org/schemas/sitemap/0.9">
  <xsl:output method="html" version="1.0" encoding="UTF-8" indent="yes"/>
  <xsl:template match="/">
    <html lang="en">
      <head>
        <meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <title>XML Sitemap</title>
        <style>
          *{box-sizing:border-box;margin:0;padding:0}
          body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#222;padding:2rem 1.5rem;max-width:1100px;margin:0 auto}
          h1{font-size:1.25rem;font-weight:600;margin-bottom:.25rem}
          .meta{color:#666;font-size:.875rem;margin-bottom:1.5rem}
          table{width:100%;border-collapse:collapse;font-size:.875rem}
          thead th{background:#f5f5f5;padding:.5rem .75rem;text-align:left;border-bottom:2px solid #ddd;white-space:nowrap}
          tbody td{padding:.45rem .75rem;border-bottom:1px solid #eee;vertical-align:top}
          tbody tr:hover td{background:#fafafa}
          .url{word-break:break-all}
          a{color:#1a56db;text-decoration:none}
          a:hover{text-decoration:underline}
          .dim{color:#888}
          .prio{font-variant-numeric:tabular-nums}
        </style>
      </head>
      <body>
        <h1>XML Sitemap</h1>
        <p class="meta"><xsl:value-of select="count(sitemap:urlset/sitemap:url)"/> URLs</p>
        <table>
          <thead>
            <tr>
              <th>URL</th>
              <th>Last Modified</th>
              <th>Change Freq</th>
              <th>Priority</th>
            </tr>
          </thead>
          <tbody>
            <xsl:for-each select="sitemap:urlset/sitemap:url">
              <tr>
                <td class="url"><a href="{sitemap:loc}"><xsl:value-of select="sitemap:loc"/></a></td>
                <td class="dim"><xsl:value-of select="sitemap:lastmod"/></td>
                <td class="dim"><xsl:value-of select="sitemap:changefreq"/></td>
                <td class="prio dim"><xsl:value-of select="sitemap:priority"/></td>
              </tr>
            </xsl:for-each>
          </tbody>
        </table>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>`;
