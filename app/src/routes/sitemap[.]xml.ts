import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/sitemap.xml')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = new URL(request.url).origin
        const today = new Date().toISOString().split('T')[0]
        // Public pages only. /admin is deliberately absent (and disallowed in
        // robots.txt); a booking confirmation has no stable URL to list.
        const pages = [
          { path: '/', changefreq: 'weekly', priority: '1.0' },
          { path: '/about', changefreq: 'monthly', priority: '0.7' },
          { path: '/booking', changefreq: 'weekly', priority: '0.9' },
          { path: '/terms', changefreq: 'yearly', priority: '0.3' },
        ]
        const xml = [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
          ...pages.flatMap((page) => [
            '  <url>',
            `    <loc>${origin}${page.path}</loc>`,
            `    <lastmod>${today}</lastmod>`,
            `    <changefreq>${page.changefreq}</changefreq>`,
            `    <priority>${page.priority}</priority>`,
            '  </url>',
          ]),
          '</urlset>',
        ].join('\n')
        return new Response(xml, {
          headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'Cache-Control': 'public, max-age=3600',
          },
        })
      },
    },
  },
})
