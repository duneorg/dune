---
title: "Media & Images"
published: true
visible: true
taxonomy:
  audience: [editor]
  difficulty: [beginner]
  topic: [content, media]
metadata:
  description: "Working with images, files, and co-located media"
---

# Media & Images

In Dune, media files live next to the content that uses them. No media library, no upload forms — just files in folders.

## Co-located media

Place images, PDFs, or any files directly alongside your content:

```
content/02.blog/01.hello-world/
├── post.md              # your content
├── cover.jpg            # hero image
├── diagram.png          # an illustration
├── presentation.pdf     # a downloadable file
└── screenshots/
    ├── step-1.png
    └── step-2.png
```

Reference them with plain relative paths in your Markdown:

```markdown
![Cover photo](cover.jpg)
![Step 1](screenshots/step-1.png)
[Download the slides](presentation.pdf)
```

Dune resolves these to the correct served URLs. The files stay right next to the content that uses them — easy to find, easy to manage, easy to version control.

## Media metadata

Attach metadata to any media file with a YAML sidecar:

`cover.jpg.meta.yaml`:
```yaml
alt: "A sunset over the mountains"
credit: "Photo by Jane Doe"
title: "Mountain Sunset"
focal_point: [50, 30]
```

The metadata is available in templates for rendering proper alt text, image credits, and smart cropping.

### Sidecar naming

The sidecar file name is always `{filename}.meta.yaml`:

| Media file | Sidecar file |
|------------|-------------|
| `cover.jpg` | `cover.jpg.meta.yaml` |
| `diagram.png` | `diagram.png.meta.yaml` |
| `document.pdf` | `document.pdf.meta.yaml` |

## Supported file types

Dune serves any file placed in a content folder. Common types:

**Images:** `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.avif`, `.svg`

**Video:** `.mp4`, `.webm`, `.ogg`

**Audio:** `.mp3`, `.wav`

**Documents:** `.pdf`, `.zip`, `.csv`

## In TSX content pages

TSX content pages access media through the `media` helper prop:

```tsx
export default function Page({ media }: ContentPageProps) {
  return (
    <article>
      <img src={media.url("hero.jpg")} alt="Hero" />
      <p>Credit: {media.get("hero.jpg")?.meta.credit}</p>

      {media.list().map((file) => (
        <img key={file.name} src={file.url} alt={file.meta.alt || file.name} />
      ))}
    </article>
  );
}
```

The `media` helper provides:

| Method | Returns | Description |
|--------|---------|-------------|
| `media.url(filename)` | `string` | URL to serve the file |
| `media.get(filename)` | `MediaFile \| null` | Full file object with metadata |
| `media.list()` | `MediaFile[]` | All media files for this page |

## Image processing

Dune can resize, crop, and convert images on the fly. Add query parameters to any image URL:

```
/content-media/02.blog/01.post/cover.jpg?width=800&format=webp
```

### Parameters

| Param | Alias | Description |
|-------|-------|-------------|
| `width` | `w` | Target width in pixels |
| `height` | `h` | Target height in pixels |
| `quality` | `q` | Output quality 1–100 (default: 80) |
| `format` | `f` | Output format: `jpeg`, `png`, `webp`, `avif` |
| `fit` | — | Resize mode: `cover` (default), `contain`, `fill`, `inside`, `outside` |
| `focal` | — | Focal point for `cover` crop as `x,y` percentages — e.g. `50,30` |

### Example URLs

```
# Resize to 800px wide, keep aspect ratio
cover.jpg?width=800

# Resize and convert to WebP
cover.jpg?width=800&format=webp

# Thumbnail at 320×240, crop from top-center
cover.jpg?width=320&height=240&fit=cover&focal=50,20

# Keep size, convert and compress
cover.jpg?format=webp&quality=60
```

### Allowed sizes

Width and height values must match one of the sizes in `system.images.allowed_sizes` (default: 320, 640, 768, 1024, 1280, 1536, 1920). Requests outside this list return `400`. This protects against resize attacks.

### Caching

Processed images are cached on disk (`.dune/cache/images/`) and served with a one-year `immutable` cache header. The first request processes the image; all subsequent requests are served from cache.

## Best practices

**Name files descriptively.** `cover.jpg` is better than `IMG_3847.jpg`. File names appear in URLs.

**Use folders for groups.** If a page has many screenshots, put them in a `screenshots/` subfolder.

**Add alt text.** Either in the Markdown `![alt text](image.jpg)` or in the `.meta.yaml` sidecar. Screen readers and SEO need it.

**Keep files near content.** Resist the urge to create a global `images/` folder. Co-location makes content portable — move a folder and everything comes with it.
